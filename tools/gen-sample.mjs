// Deterministic sample-mesh generator: a displaced icosphere written as glTF 2.0
// (single buffer, data URI). Same command -> byte-identical output.
import { writeFileSync, mkdirSync } from "node:fs";
import { makeMesh, meshStats } from "../src/core.mjs";

const SUBDIV = 4;           // 20 * 4^4 = 5,120 triangles
const SEED = 1337;

function icosahedron() {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const f = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  return { v, f };
}

function normalize(p) {
  const l = Math.hypot(p[0], p[1], p[2]);
  return [p[0] / l, p[1] / l, p[2] / l];
}

function subdivide({ v, f }) {
  const verts = v.slice();
  const faces = [];
  const cache = new Map();
  const mid = (a, b) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (cache.has(key)) return cache.get(key);
    const pa = verts[a], pb = verts[b];
    const m = normalize([(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2]);
    verts.push(m);
    const id = verts.length - 1;
    cache.set(key, id);
    return id;
  };
  for (const [a, b, c] of f) {
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    faces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
  }
  return { v: verts, f: faces };
}

// Smooth deterministic displacement: a few oriented sine bands, no RNG needed.
function displace(p) {
  const [x, y, z] = p;
  const n =
    0.55 * Math.sin(3.1 * x + 1.7) * Math.sin(2.7 * y - 0.4) * Math.sin(3.3 * z + 2.1) +
    0.30 * Math.sin(6.2 * x - 0.8) * Math.sin(5.9 * y + 1.3) * Math.sin(6.4 * z - 2.4) +
    0.15 * Math.sin(11.0 * x + 0.3) * Math.sin(10.0 * y - 1.1) * Math.sin(12.0 * z + 0.7);
  const r = 1 + 0.22 * n;
  return [x * r, y * r, z * r];
}

let geo = icosahedron();
for (let i = 0; i < SUBDIV; i++) geo = subdivide(geo);
const positions = new Float32Array(geo.v.length * 3);
for (let i = 0; i < geo.v.length; i++) {
  const d = displace(geo.v[i]);
  positions[i * 3] = d[0]; positions[i * 3 + 1] = d[1]; positions[i * 3 + 2] = d[2];
}
const indices = new Uint16Array(geo.f.length * 3);
for (let i = 0; i < geo.f.length; i++) {
  indices[i * 3] = geo.f[i][0]; indices[i * 3 + 1] = geo.f[i][1]; indices[i * 3 + 2] = geo.f[i][2];
}

const idxBytes = indices.byteLength;
const pad = (4 - (idxBytes % 4)) % 4;
const buf = Buffer.alloc(idxBytes + pad + positions.byteLength);
Buffer.from(indices.buffer).copy(buf, 0);
Buffer.from(positions.buffer).copy(buf, idxBytes + pad);

const gltf = {
  asset: { version: "2.0", generator: "mesh-lod-lab gen-sample.mjs", extras: { seed: SEED } },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: "displaced-icosphere" }],
  meshes: [{ primitives: [{ attributes: { POSITION: 1 }, indices: 0, mode: 4 }] }],
  accessors: [
    { bufferView: 0, componentType: 5123, count: indices.length, type: "SCALAR", min: [0], max: [geo.v.length - 1] },
    { bufferView: 1, componentType: 5126, count: positions.length / 3, type: "VEC3",
      min: [Math.min(...positions.filter((_, i) => i % 3 === 0)), Math.min(...positions.filter((_, i) => i % 3 === 1)), Math.min(...positions.filter((_, i) => i % 3 === 2))],
      max: [Math.max(...positions.filter((_, i) => i % 3 === 0)), Math.max(...positions.filter((_, i) => i % 3 === 1)), Math.max(...positions.filter((_, i) => i % 3 === 2))] },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: idxBytes, target: 34963 },
    { buffer: 0, byteOffset: idxBytes + pad, byteLength: positions.byteLength, target: 34962 },
  ],
  buffers: [{ byteLength: buf.length, uri: `data:application/octet-stream;base64,${buf.toString("base64")}` }],
};

mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
const out = new URL("../data/mesh.gltf", import.meta.url);
writeFileSync(out, JSON.stringify(gltf, null, 1) + "\n");

const stats = meshStats(makeMesh(Float64Array.from(positions), Uint32Array.from(indices)));
const meta = { seed: SEED, subdivision: SUBDIV, ...stats, file: "mesh.gltf" };
writeFileSync(new URL("../data/meta.json", import.meta.url), JSON.stringify(meta, null, 2) + "\n");
console.log(`wrote data/mesh.gltf  tris=${stats.triangleCount} verts=${stats.vertexCount} diag=${stats.diagonal.toFixed(4)} bytes=${buf.length}`);
