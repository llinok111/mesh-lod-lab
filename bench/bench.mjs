// Timing + error benchmark. 1 warmup, then 5 timed repeats; cold start recorded
// separately. Writes bench/result.json (the only source of README numbers).
import { writeFileSync } from "node:fs";
import { meshStats, qemDecimate } from "../src/core.mjs";
import { surfaceError } from "../src/metric.mjs";
import { vertexClusterToTarget } from "../baseline/vertex-cluster.mjs";
import { loadSample } from "./load.mjs";

const REPS = 7;
const SAMPLES = 16000;
const SEED = 11;
const RATIOS = [0.5, 0.25, 0.1];

const mesh = loadSample();
const stats = meshStats(mesh);

function timeIt(fn) {
  const t0 = performance.now();
  const out = fn();
  return { ms: performance.now() - t0, out };
}

function summarize(times, cold) {
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const variance = times.reduce((a, b) => a + (b - mean) ** 2, 0) / times.length;
  const stddev = Math.sqrt(variance);
  return {
    coldMs: +cold.toFixed(2),
    medianMs: +median.toFixed(2),
    minMs: +sorted[0].toFixed(2),
    p95Ms: +sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)].toFixed(2),
    stddevMs: +stddev.toFixed(2),
    relStddev: +(stddev / mean).toFixed(4),
    samples: times.length,
  };
}

// Cold start = very first QEM call in this process, before any JIT warmup.
const cold = timeIt(() => qemDecimate(mesh, Math.round(stats.triangleCount * RATIOS[2])));

const rows = [];
for (const ratio of RATIOS) {
  const target = Math.round(stats.triangleCount * ratio);
  const qTimes = [];
  let qMesh = null;
  for (let i = 0; i < REPS; i++) {
    const r = timeIt(() => qemDecimate(mesh, target));
    qTimes.push(r.ms);
    qMesh = r.out.mesh;
  }
  const bTimes = [];
  let bMesh = null, bCells = 0;
  for (let i = 0; i < REPS; i++) {
    const r = timeIt(() => vertexClusterToTarget(mesh, target));
    bTimes.push(r.ms);
    bMesh = r.out.mesh; bCells = r.out.cells;
  }
  const eq = surfaceError(mesh, qMesh, SAMPLES, SEED);
  const eb = surfaceError(mesh, bMesh, SAMPLES, SEED);
  const diag = stats.diagonal;
  rows.push({
    ratio,
    targetTriangles: target,
    qem: {
      triangles: meshStats(qMesh).triangleCount,
      vertices: qMesh.vertexCount,
      ...summarize(qTimes, 0),
      maxErrorPctDiag: +((100 * eq.max) / diag).toFixed(3),
      rmsErrorPctDiag: +((100 * eq.rms) / diag).toFixed(3),
    },
    baseline: {
      triangles: meshStats(bMesh).triangleCount,
      gridCells: bCells,
      ...summarize(bTimes, 0),
      maxErrorPctDiag: +((100 * eb.max) / diag).toFixed(3),
      rmsErrorPctDiag: +((100 * eb.rms) / diag).toFixed(3),
    },
  });
  rows[rows.length - 1].qem.coldMs = +cold.ms.toFixed(2);
  rows[rows.length - 1].errorImprovement = +(eb.max / eq.max).toFixed(2);
}

const headline = rows[rows.length - 1];
const result = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  config: { reps: REPS, samples: SAMPLES, seed: SEED, ratios: RATIOS },
  mesh: {
    triangles: stats.triangleCount,
    vertices: stats.vertexCount,
    diagonal: +stats.diagonal.toFixed(4),
    surfaceArea: +stats.surfaceArea.toFixed(4),
  },
  coldStartMs: +cold.ms.toFixed(2),
  rows,
  headline: {
    reductionPct: +((1 - headline.qem.triangles / stats.triangleCount) * 100).toFixed(1),
    qemMaxErrorPctDiag: headline.qem.maxErrorPctDiag,
    baselineMaxErrorPctDiag: headline.baseline.maxErrorPctDiag,
    improvementX: headline.errorImprovement,
    qemMedianMs: headline.qem.medianMs,
    baselineMedianMs: headline.baseline.medianMs,
  },
};

writeFileSync(new URL("./result.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
console.log(`mesh ${stats.triangleCount} tris, cold QEM ${cold.ms.toFixed(1)} ms`);
for (const r of rows) {
  console.log(
    `${(r.ratio * 100).toFixed(0)}%: qem ${r.qem.triangles}t ${r.qem.medianMs}ms err ${r.qem.maxErrorPctDiag}% | ` +
    `cluster ${r.baseline.triangles}t ${r.baseline.medianMs}ms err ${r.baseline.maxErrorPctDiag}% | ${r.errorImprovement}x`
  );
}
