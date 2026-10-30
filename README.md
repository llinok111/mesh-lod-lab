# mesh-lod-lab

**At a fixed 90% triangle budget cut on a 5,120-triangle mesh, QEM edge-collapse decimation keeps max surface error at 0.180% of the bbox diagonal, versus 1.078% for uniform vertex clustering — 5.99× lower error for the same budget** (baseline: `baseline/vertex-cluster.mjs`, both run on the same input in `bench/bench.mjs`).

Upstream: none

This is an original implementation of quadric-error-metric (Garland & Heckbert 1997) edge collapse, plus the naive vertex-clustering baseline it is measured against. The whole geometry path is a dependency-free ES module that runs in Node and in the browser; three.js is only used to draw the result.

## Run it

```bash
node tools/gen-sample.mjs && node bench/verify.mjs && node bench/bench.mjs
```

That regenerates `data/mesh.gltf`, runs 13 assertions, then benchmarks and writes `bench/result.json`. No install step, no network.

Browser demo (three.js r160 via CDN importmap, nothing to build):

```bash
python3 -m http.server 4173   # then open http://localhost:4173
```

Left: original mesh. Right: QEM-decimated at the selected budget. Drag to orbit, scroll to zoom, use the slider or the 50/25/10% buttons. Error numbers in the panel are computed live in the browser from `src/metric.mjs` at 4,000 samples per mesh.

## What is actually measured

`bench/bench.mjs` loads the sample, warms up, then runs **7 timed repetitions** per method at each budget (50%, 25%, 10% of 5,120 triangles), recording cold start separately. Error is the symmetric surface error: 16,000 area-weighted points sampled on each mesh, nearest point on the other mesh, reported as a percentage of the bbox diagonal.

| budget | QEM tris | QEM median | QEM max err | cluster tris | cluster median | cluster max err | improvement |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 50% | 2,560 | 16.23 ms | 0.039% | 2,574 | 15.46 ms | 0.195% | 4.94× |
| 25% | 1,280 | 15.75 ms | 0.093% | 1,303 | 12.83 ms | 0.407% | 4.38× |
| 10% | 512 | 18.00 ms | 0.180% | 495 | 10.89 ms | 1.078% | 5.99× |

Cold start (very first QEM call in a fresh process, no JIT warmup): **40.35 ms**.
Machine: 4-core / 3.6 GB container, Node v24.19.0. Full numbers incl. min/p95/stddev are in `bench/result.json`.

QEM is **slower** than clustering (18.00 ms vs 10.89 ms at 10%) — that is the honest trade: it buys ~6× lower error. Both are fast enough to run interactively at this mesh size.

### Why the relative stddev is high in one row

At the 50% budget QEM shows `relStddev = 0.269` (p95 27.25 ms vs median 16.23 ms). This is a single V8 GC pause in a 3.6 GB container: each decimation run allocates a fresh priority-queue entry per edge candidate, and the collector occasionally fires mid-run. The 25% and 10% rows sit at 7.8% and 9.1%. The README quotes medians, and the raw distribution (min/median/p95/stddev) is in `bench/result.json` so the outlier is visible rather than hidden.

## Verify it yourself

```bash
node bench/verify.mjs   # exit 0, prints every asserted value
```

Asserts: sample is 5,120 tris / 2,562 verts, diag 5.607; QEM lands on the 512-triangle budget; output is finite; the baseline is at a comparable budget; QEM max error < 0.5% diag; QEM beats the baseline by ≥3×; decimation is bit-for-bit deterministic; a mesh has zero error against itself; sampling is deterministic; the input mesh is not mutated; the RNG is reproducible.

## Files

```
index.html              # importmap + HUD, single entry point
main.js                 # three.js render + orbit + slider (consumes core only)
src/core.mjs            # mesh, QEM decimation, deterministic RNG (no three/DOM/IO)
src/metric.mjs          # point-triangle distance, grid, area sampling, surface error
baseline/vertex-cluster.mjs  # the comparison baseline, tuned to the same budget
tools/gen-sample.mjs    # deterministic displaced icosphere -> data/mesh.gltf
bench/verify.mjs        # assertions
bench/bench.mjs         # timings -> bench/result.json
```

## Known limitations

- The sample is a closed, manifold, ~5 k-triangle mesh. QEM here assumes manifold-ish input; the link condition rejects collapses that would create non-manifold edges, so highly non-manifold meshes will simply stop early rather than corrupt.
- No attribute preservation: UVs, normals and colors are dropped; decimation is position-only and normals are recomputed by three.js.
- The surface-error metric is a dense point-sampled estimate (16 k points), not an exact Hausdorff distance; it is deterministic but can undershoot thin features.
- Vertex clustering's grid resolution is binary-searched over 14 integer steps, so its triangle count only approximates the budget (495 vs 512 at 10%). It is given the *smaller* count, which slightly favors the baseline.
