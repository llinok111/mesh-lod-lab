// Baseline LOD: uniform-grid vertex clustering, tuned (binary search on grid
// resolution) to land as close as possible to the requested triangle budget.
// This is the comparison method the QEM decimator is measured against.
import { makeMesh } from "../src/core.mjs";

function clusterAt(mesh, cells) {
  const p = mesh.positions, idx = mesh.indices;
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < minx) minx = p[i]; if (p[i] > maxx) maxx = p[i];
    if (p[i + 1] < miny) miny = p[i + 1]; if (p[i + 1] > maxy) maxy = p[i + 1];
    if (p[i + 2] < minz) minz = p[i + 2]; if (p[i + 2] > maxz) maxz = p[i + 2];
  }
  const span = Math.max(maxx - minx, maxy - miny, maxz - minz, 1e-9);
  const cell = span / cells;
  const map = new Map();
  const cellOf = new Int32Array(mesh.vertexCount).fill(-1);
  const sum = [];
  for (let i = 0; i < mesh.vertexCount; i++) {
    const cx = Math.floor((p[i * 3] - minx) / cell);
    const cy = Math.floor((p[i * 3 + 1] - miny) / cell);
    const cz = Math.floor((p[i * 3 + 2] - minz) / cell);
    const key = `${cx},${cy},${cz}`;
    let id = map.get(key);
    if (id === undefined) {
      id = sum.length / 4;
      map.set(key, id);
      sum.push(0, 0, 0, 0);
    }
    cellOf[i] = id;
    sum[id * 4] += p[i * 3]; sum[id * 4 + 1] += p[i * 3 + 1]; sum[id * 4 + 2] += p[i * 3 + 2]; sum[id * 4 + 3]++;
  }
  const outPos = new Float64Array((sum.length / 4) * 3);
  for (let i = 0; i < sum.length / 4; i++) {
    outPos[i * 3] = sum[i * 4] / sum[i * 4 + 3];
    outPos[i * 3 + 1] = sum[i * 4 + 1] / sum[i * 4 + 3];
    outPos[i * 3 + 2] = sum[i * 4 + 2] / sum[i * 4 + 3];
  }
  const seen = new Set();
  const outIdx = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = cellOf[idx[t]], b = cellOf[idx[t + 1]], c = cellOf[idx[t + 2]];
    if (a === b || b === c || a === c) continue;
    const k = [a, b, c].sort((x, y) => x - y).join(",");
    if (seen.has(k)) continue;
    seen.add(k);
    outIdx.push(a, b, c);
  }
  return makeMesh(outPos, Uint32Array.from(outIdx));
}

export function vertexClusterToTarget(mesh, targetTriangles) {
  let lo = 2, hi = 256;
  let best = null;
  for (let it = 0; it < 14; it++) {
    const mid = (lo + hi) >> 1;
    const m = clusterAt(mesh, mid);
    const diff = m.triangleCount - targetTriangles;
    if (!best || Math.abs(diff) < Math.abs(best.mesh.triangleCount - targetTriangles)) best = { mesh: m, cells: mid };
    if (diff > 0) hi = mid - 1; else lo = mid + 1;
    if (lo > hi) break;
  }
  return best;
}
