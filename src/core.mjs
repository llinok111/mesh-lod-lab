// Pure geometry core: indexed triangle meshes, QEM edge-collapse decimation,
// vertex-cluster decimation, and symmetric surface (Hausdorff-ish) error.
// No three.js, no DOM, no I/O, no environment reads. Node-runnable.

/* ------------------------------------------------------------------ */
/* mesh basics                                                         */
/* ------------------------------------------------------------------ */

export function makeMesh(positions, indices) {
  const pos = positions instanceof Float64Array ? positions : Float64Array.from(positions);
  const idx = indices instanceof Uint32Array ? indices : Uint32Array.from(indices);
  if (pos.length % 3 !== 0) throw new Error("positions length must be a multiple of 3");
  if (idx.length % 3 !== 0) throw new Error("indices length must be a multiple of 3");
  return { positions: pos, indices: idx, vertexCount: pos.length / 3, triangleCount: idx.length / 3 };
}

export function meshStats(mesh) {
  let minx = Infinity, miny = Infinity, minz = Infinity;
  let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < minx) minx = p[i];
    if (p[i] > maxx) maxx = p[i];
    if (p[i + 1] < miny) miny = p[i + 1];
    if (p[i + 1] > maxy) maxy = p[i + 1];
    if (p[i + 2] < minz) minz = p[i + 2];
    if (p[i + 2] > maxz) maxz = p[i + 2];
  }
  const dx = maxx - minx, dy = maxy - miny, dz = maxz - minz;
  const diag = Math.hypot(dx, dy, dz);
  let area = 0;
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    area += 0.5 * Math.hypot(cx, cy, cz);
  }
  return {
    vertexCount: mesh.vertexCount,
    triangleCount: mesh.triangleCount,
    bounds: { min: [minx, miny, minz], max: [maxx, maxy, maxz] },
    diagonal: diag,
    surfaceArea: area,
  };
}

/* ------------------------------------------------------------------ */
/* deterministic RNG (mulberry32)                                      */
/* ------------------------------------------------------------------ */

export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* QEM edge-collapse decimation                                        */
/* ------------------------------------------------------------------ */

const Q_KEYS = 10; // a11 a12 a13 a14 a22 a23 a24 a33 a34 a44

function quadFromPlane(nx, ny, nz, d) {
  return [nx * nx, nx * ny, nx * nz, nx * d,
          ny * ny, ny * nz, ny * d,
          nz * nz, nz * d,
          d * d];
}

function quadAdd(q, r) {
  for (let i = 0; i < Q_KEYS; i++) q[i] += r[i];
  return q;
}

// v^T Q v for homogeneous v = (x, y, z, 1)
function quadError(q, x, y, z) {
  return q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x +
         q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y +
         q[7] * z * z + 2 * q[8] * z + q[9];
}

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].cost <= a[i].cost) break;
      const tmp = a[p]; a[p] = a[i]; a[i] = tmp;
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].cost < a[m].cost) m = l;
        if (r < a.length && a[r].cost < a[m].cost) m = r;
        if (m === i) break;
        const tmp = a[m]; a[m] = a[i]; a[i] = tmp;
        i = m;
      }
    }
    return top;
  }
}

// Solve the 3x3 system for the quadric-optimal position; null if near-singular.
function optimalPoint(q, out) {
  const a = q[0], b = q[1], c = q[2], d = q[4], e = q[5], f = q[7];
  const det = a * (d * f - e * e) - b * (b * f - e * c) + c * (b * e - d * c);
  if (Math.abs(det) < 1e-12) return null;
  const r0 = -q[3], r1 = -q[6], r2 = -q[8];
  const inv = 1 / det;
  const x = ((d * f - e * e) * r0 + (c * e - b * f) * r1 + (b * e - c * d) * r2) * inv;
  const y = ((c * e - b * f) * r0 + (a * f - c * c) * r1 + (b * c - a * e) * r2) * inv;
  const z = ((b * e - c * d) * r0 + (b * c - a * e) * r1 + (a * d - b * b) * r2) * inv;
  out[0] = x; out[1] = y; out[2] = z;
  return out;
}

/**
 * Decimate with quadric error metric edge collapses.
 * @returns {{mesh:object, collapsed:number, targetReached:boolean}}
 */
export function qemDecimate(mesh, targetTriangles, options = {}) {
  const maxCost = options.maxCost ?? Infinity;
  const p = Float64Array.from(mesh.positions);
  const idx = Array.from(mesh.indices);
  const nv = mesh.vertexCount;

  const alive = new Uint8Array(nv).fill(1);
  const version = new Uint32Array(nv);
  const quads = new Array(nv);
  for (let i = 0; i < nv; i++) quads[i] = new Float64Array(Q_KEYS);
  const adj = new Array(nv);
  for (let i = 0; i < nv; i++) adj[i] = new Set();

  // Face quadrics + adjacency
  for (let t = 0; t < idx.length; t += 3) {
    const ia = idx[t], ib = idx[t + 1], ic = idx[t + 2];
    const ax = p[ia * 3], ay = p[ia * 3 + 1], az = p[ia * 3 + 2];
    const ux = p[ib * 3] - ax, uy = p[ib * 3 + 1] - ay, uz = p[ib * 3 + 2] - az;
    const vx = p[ic * 3] - ax, vy = p[ic * 3 + 1] - ay, vz = p[ic * 3 + 2] - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-15) {
      nx /= len; ny /= len; nz /= len;
      const d = -(nx * ax + ny * ay + nz * az);
      const q = quadFromPlane(nx, ny, nz, d);
      for (const v of [ia, ib, ic]) for (let k = 0; k < Q_KEYS; k++) quads[v][k] += q[k];
    }
    adj[ia].add(ib); adj[ia].add(ic);
    adj[ib].add(ia); adj[ib].add(ic);
    adj[ic].add(ia); adj[ic].add(ib);
  }

  const heap = new MinHeap();
  const key = (a, b) => (a < b ? a * nv + b : b * nv + a);
  const vertTris = new Array(nv);
  for (let i = 0; i < nv; i++) vertTris[i] = new Set();
  for (let t = 0; t < idx.length; t += 3) {
    vertTris[idx[t]].add(t); vertTris[idx[t + 1]].add(t); vertTris[idx[t + 2]].add(t);
  }

  const tmp = [0, 0, 0];
  const scratch = new Float64Array(Q_KEYS);
  function evalEdge(a, b) {
    const q = scratch;
    for (let k = 0; k < Q_KEYS; k++) q[k] = quads[a][k] + quads[b][k];
    let x = (p[a * 3] + p[b * 3]) * 0.5;
    let y = (p[a * 3 + 1] + p[b * 3 + 1]) * 0.5;
    let z = (p[a * 3 + 2] + p[b * 3 + 2]) * 0.5;
    if (optimalPoint(q, tmp)) { x = tmp[0]; y = tmp[1]; z = tmp[2]; }
    const cost = Math.max(0, quadError(q, x, y, z));
    return { cost, x, y, z };
  }

  function pushEdge(a, b) {
    const e = evalEdge(a, b);
    heap.push({ a, b, cost: e.cost, va: version[a], vb: version[b], x: e.x, y: e.y, z: e.z });
  }

  for (let i = 0; i < nv; i++) for (const j of adj[i]) if (i < j) pushEdge(i, j);

  let tris = mesh.triangleCount;
  let collapsed = 0;

  // Link condition: a manifold interior edge has exactly two shared neighbours.
  function linkOk(a, b) {
    let n = 0;
    for (const x of adj[a]) if (adj[b].has(x)) n++;
    return n === 2;
  }

  while (tris > targetTriangles && heap.size > 0) {
    const e = heap.pop();
    const { a, b } = e;
    if (!alive[a] || !alive[b]) continue;
    if (version[a] !== e.va || version[b] !== e.vb) continue;
    if (e.cost > maxCost) break;
    if (!adj[a].has(b)) continue;
    if (!linkOk(a, b)) continue;

    // Collapse b into a.
    p[a * 3] = e.x; p[a * 3 + 1] = e.y; p[a * 3 + 2] = e.z;
    quadAdd(quads[a], quads[b]);
    alive[b] = 0;
    version[a]++;
    version[b]++;
    collapsed++;

    for (const n of adj[b]) {
      adj[n].delete(b);
      if (n !== a) { adj[n].add(a); adj[a].add(n); }
    }
    adj[a].delete(b);
    adj[b].clear();

    // Remap only the triangles incident to b.
    let removed = 0;
    for (const t of vertTris[b]) {
      let hit = false;
      for (let k = 0; k < 3; k++) if (idx[t + k] === b) { idx[t + k] = a; hit = true; }
      if (!hit) continue;
      const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
      if (i0 === i1 || i1 === i2 || i0 === i2) {
        idx[t] = idx[t + 1] = idx[t + 2] = 0xffffffff;
        vertTris[i0].delete(t); vertTris[i1].delete(t); vertTris[i2].delete(t);
        removed++;
      } else {
        vertTris[a].add(t);
      }
    }
    vertTris[b].clear();
    tris -= removed;

    for (const n of adj[a]) pushEdge(a, n);
  }

  // Compact.
  const remap = new Int32Array(nv).fill(-1);
  let outN = 0;
  for (let i = 0; i < nv; i++) if (alive[i]) remap[i] = outN++;
  const outPos = new Float64Array(outN * 3);
  for (let i = 0; i < nv; i++) {
    if (!alive[i]) continue;
    const o = remap[i] * 3;
    outPos[o] = p[i * 3]; outPos[o + 1] = p[i * 3 + 1]; outPos[o + 2] = p[i * 3 + 2];
  }
  const outIdx = [];
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
    if (i0 === 0xffffffff || i1 === 0xffffffff || i2 === 0xffffffff) continue;
    outIdx.push(remap[i0], remap[i1], remap[i2]);
  }
  return {
    mesh: makeMesh(outPos, Uint32Array.from(outIdx)),
    collapsed,
    targetReached: outIdx.length / 3 <= targetTriangles,
  };
}
