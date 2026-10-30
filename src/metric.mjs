// Surface error utilities: point-triangle distance, uniform grid, area sampling.
// Pure ES module, no three.js / DOM / I/O.
import { rng } from './core.mjs';

/* ------------------------------------------------------------------ */
/* point-to-triangle distance + uniform grid                           */
/* ------------------------------------------------------------------ */

function pointTriDist2(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const qx = ax + abx * v, qy = ay + aby * v, qz = az + abz * v;
    const dx = px - qx, dy = py - qy, dz = pz - qz;
    return dx * dx + dy * dy + dz * dz;
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const qx = ax + acx * w, qy = ay + acy * w, qz = az + acz * w;
    const dx = px - qx, dy = py - qy, dz = pz - qz;
    return dx * dx + dy * dy + dz * dz;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const qx = bx + (cx - bx) * w, qy = by + (cy - by) * w, qz = bz + (cz - bz) * w;
    const dx = px - qx, dy = py - qy, dz = pz - qz;
    return dx * dx + dy * dy + dz * dz;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  const qx = ax + abx * v + acx * w;
  const qy = ay + aby * v + acy * w;
  const qz = az + abz * v + acz * w;
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}

export function buildGrid(mesh, cells = 48) {
  const p = mesh.positions, idx = mesh.indices;
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < minx) minx = p[i];
    if (p[i] > maxx) maxx = p[i];
    if (p[i + 1] < miny) miny = p[i + 1];
    if (p[i + 1] > maxy) maxy = p[i + 1];
    if (p[i + 2] < minz) minz = p[i + 2];
    if (p[i + 2] > maxz) maxz = p[i + 2];
  }
  const span = Math.max(maxx - minx, maxy - miny, maxz - minz, 1e-9);
  const cell = span / cells;
  const nx = Math.ceil((maxx - minx) / cell) + 1;
  const ny = Math.ceil((maxy - miny) / cell) + 1;
  const nz = Math.ceil((maxz - minz) / cell) + 1;
  const map = new Map();
  const ck = (x, y, z) => (x * ny + y) * nz + z;
  for (let t = 0; t < idx.length; t += 3) {
    const ia = idx[t] * 3, ib = idx[t + 1] * 3, ic = idx[t + 2] * 3;
    const x0 = Math.min(p[ia], p[ib], p[ic]), x1 = Math.max(p[ia], p[ib], p[ic]);
    const y0 = Math.min(p[ia + 1], p[ib + 1], p[ic + 1]), y1 = Math.max(p[ia + 1], p[ib + 1], p[ic + 1]);
    const z0 = Math.min(p[ia + 2], p[ib + 2], p[ic + 2]), z1 = Math.max(p[ia + 2], p[ib + 2], p[ic + 2]);
    const i0 = Math.floor((x0 - minx) / cell), i1 = Math.floor((x1 - minx) / cell);
    const j0 = Math.floor((y0 - miny) / cell), j1 = Math.floor((y1 - miny) / cell);
    const k0 = Math.floor((z0 - minz) / cell), k1 = Math.floor((z1 - minz) / cell);
    for (let x = i0; x <= i1; x++) for (let y = j0; y <= j1; y++) for (let z = k0; z <= k1; z++) {
      const k = ck(x, y, z);
      let list = map.get(k);
      if (!list) { list = []; map.set(k, list); }
      list.push(t);
    }
  }
  return { map, cell, minx, miny, minz, nx, ny, nz, maxR: Math.max(nx, ny, nz) };
}

export function nearestDistance(grid, mesh, px, py, pz, fallback = Infinity) {
  const p = mesh.positions, idx = mesh.indices;
  const { map, cell, minx, miny, minz, nx, ny, nz } = grid;
  const cx = Math.floor((px - minx) / cell), cy = Math.floor((py - miny) / cell), cz = Math.floor((pz - minz) / cell);
  let best = fallback;
  const maxR = Math.max(nx, ny, nz);
  for (let r = 0; r <= maxR; r++) {
    if (best < Infinity && (r - 1) * cell > best) break;
    const x0 = cx - r, x1 = cx + r, y0 = cy - r, y1 = cy + r, z0 = cz - r, z1 = cz + r;
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || x >= nx) continue;
      const onX = x === x0 || x === x1;
      for (let y = y0; y <= y1; y++) {
        if (y < 0 || y >= ny) continue;
        const onY = y === y0 || y === y1;
        for (let z = z0; z <= z1; z++) {
          if (z < 0 || z >= nz) continue;
          if (r > 0 && !onX && !onY && z !== z0 && z !== z1) continue; // shell only
          const list = map.get((x * ny + y) * nz + z);
          if (!list) continue;
          for (let n = 0; n < list.length; n++) {
            const t = list[n];
            const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
            const d2 = pointTriDist2(px, py, pz,
              p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]);
            if (d2 < best) best = d2;
          }
        }
      }
    }
  }
  return Math.sqrt(best);
}

/** Area-weighted deterministic surface samples. */
export function sampleSurface(mesh, count, seed = 1) {
  const p = mesh.positions, idx = mesh.indices;
  const areas = new Float64Array(mesh.triangleCount);
  let total = 0;
  for (let t = 0; t < mesh.triangleCount; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    areas[t] = 0.5 * Math.hypot(cx, cy, cz);
    total += areas[t];
  }
  const rand = rng(seed);
  const out = new Float64Array(count * 3);
  let acc = 0, cursor = 0;
  const cdf = new Float64Array(mesh.triangleCount);
  for (let t = 0; t < mesh.triangleCount; t++) { acc += areas[t]; cdf[t] = acc / total; }
  for (let s = 0; s < count; s++) {
    const u = rand();
    while (cursor < cdf.length - 1 && cdf[cursor] < u) cursor++;
    const t = cursor;
    let r1 = rand(), r2 = rand();
    if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    out[s * 3] = p[a] + r1 * (p[b] - p[a]) + r2 * (p[c] - p[a]);
    out[s * 3 + 1] = p[a + 1] + r1 * (p[b + 1] - p[a + 1]) + r2 * (p[c + 1] - p[a + 1]);
    out[s * 3 + 2] = p[a + 2] + r1 * (p[b + 2] - p[a + 2]) + r2 * (p[c + 2] - p[a + 2]);
  }
  return out;
}

/**
 * Symmetric surface error between two meshes: for each sample on A find the
 * nearest point on B and vice versa. Returns absolute distances.
 */
export function surfaceError(a, b, samples = 20000, seed = 7) {
  const ga = buildGrid(a, 48), gb = buildGrid(b, 48);
  const sa = sampleSurface(a, samples, seed);
  const sb = sampleSurface(b, samples, seed + 1);
  const stat = (pts, grid, target) => {
    let max = 0, sum = 0, sum2 = 0;
    for (let i = 0; i < pts.length; i += 3) {
      const d = nearestDistance(grid, target, pts[i], pts[i + 1], pts[i + 2]);
      if (d > max) max = d;
      sum += d; sum2 += d * d;
    }
    const n = pts.length / 3;
    return { max, mean: sum / n, rms: Math.sqrt(sum2 / n) };
  };
  const ab = stat(sa, gb, b);
  const ba = stat(sb, ga, a);
  return {
    max: Math.max(ab.max, ba.max),
    mean: (ab.mean + ba.mean) / 2,
    rms: Math.sqrt((ab.rms * ab.rms + ba.rms * ba.rms) / 2),
    samples,
  };
}
