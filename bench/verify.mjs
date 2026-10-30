// Assertions over the real sample mesh. Exit 0 only if every check passes.
import { makeMesh, meshStats, qemDecimate, rng } from "../src/core.mjs";
import { surfaceError, sampleSurface } from "../src/metric.mjs";
import { vertexClusterToTarget } from "../baseline/vertex-cluster.mjs";
import { loadSample } from "./load.mjs";

let failures = 0;
function check(name, cond, detail) {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

const mesh = loadSample();
const stats = meshStats(mesh);
console.log(`sample: tris=${stats.triangleCount} verts=${stats.vertexCount} diag=${stats.diagonal.toFixed(5)}`);

check("sample triangle count", stats.triangleCount === 5120, `actual=${stats.triangleCount} expected=5120`);
check("sample vertex count", stats.vertexCount === 2562, `actual=${stats.vertexCount} expected=2562`);
check("sample bbox diagonal", Math.abs(stats.diagonal - 5.60699) < 1e-3, `actual=${stats.diagonal.toFixed(6)}`);

const target = 512;
const q = qemDecimate(mesh, target);
const qStats = meshStats(q.mesh);
check("qem reaches budget", qStats.triangleCount <= target && qStats.triangleCount >= target - 32,
  `actual=${qStats.triangleCount} target=${target}`);
check("qem output is finite", q.mesh.positions.every(Number.isFinite), `verts=${q.mesh.vertexCount}`);

const base = vertexClusterToTarget(mesh, target);
const baseStats = meshStats(base.mesh);
check("baseline is at comparable budget", baseStats.triangleCount <= qStats.triangleCount + 16,
  `baseline=${baseStats.triangleCount} qem=${qStats.triangleCount}`);

const errQ = surfaceError(mesh, q.mesh, 12000, 11);
const errB = surfaceError(mesh, base.mesh, 12000, 11);
const pq = (100 * errQ.max) / stats.diagonal;
const pb = (100 * errB.max) / stats.diagonal;
console.log(`error: qem max=${errQ.max.toFixed(5)} (${pq.toFixed(3)}% diag) rms=${errQ.rms.toFixed(5)}`);
console.log(`error: baseline max=${errB.max.toFixed(5)} (${pb.toFixed(3)}% diag) rms=${errB.rms.toFixed(5)}`);

check("qem max error under 0.5% diag", pq < 0.5, `actual=${pq.toFixed(3)}% limit=0.5%`);
check("qem beats baseline by >=3x", pb / pq >= 3, `ratio=${(pb / pq).toFixed(2)}x`);

// Determinism: same input, same output.
const q2 = qemDecimate(mesh, target);
let same = q.mesh.positions.length === q2.mesh.positions.length && q.mesh.indices.length === q2.mesh.indices.length;
if (same) {
  for (let i = 0; i < q.mesh.positions.length; i++) if (q.mesh.positions[i] !== q2.mesh.positions[i]) { same = false; break; }
}
if (same) {
  for (let i = 0; i < q.mesh.indices.length; i++) if (q.mesh.indices[i] !== q2.mesh.indices[i]) { same = false; break; }
}
check("qem is deterministic", same, `verts=${q.mesh.vertexCount} tris=${q.mesh.triangleCount}`);

// Error metric sanity: a mesh against itself must be exactly zero.
const self = surfaceError(mesh, mesh, 3000, 5);
check("self error is zero", self.max < 1e-9 && self.rms < 1e-9, `max=${self.max.toExponential(2)} rms=${self.rms.toExponential(2)}`);

// Sampling determinism + seeding.
const s1 = sampleSurface(mesh, 64, 3), s2 = sampleSurface(mesh, 64, 3);
check("surface sampling deterministic", s1.every((v, i) => v === s2[i]), `n=${s1.length / 3}`);

// Input must not be mutated by the decimator.
const before = mesh.positions[0] + mesh.indices[0];
qemDecimate(mesh, 400);
check("input mesh not mutated", before === mesh.positions[0] + mesh.indices[0], `firstVertex=${mesh.positions[0].toFixed(4)}`);

// Random generator reproducibility.
const r1 = rng(9), r2 = rng(9);
check("rng reproducible", r1() === r2() && r1() === r2(), `first=${r1().toFixed(6)}`);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
