// Render + interaction only. All geometry decisions come from src/core.mjs;
// all error numbers come from src/metric.mjs. Nothing is recomputed here.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { makeMesh, meshStats, qemDecimate } from "./src/core.mjs";
import { surfaceError } from "./src/metric.mjs";
import { vertexClusterToTarget } from "./baseline/vertex-cluster.mjs";

const $ = (id) => document.getElementById(id);
const app = $("app");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);
scene.fog = new THREE.Fog(0x0b0e14, 14, 30);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 2.4, 11);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);
controls.minDistance = 4;
controls.maxDistance = 24;

scene.add(new THREE.HemisphereLight(0x9ecbff, 0x1b2430, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(4, 7, 6);
scene.add(key);
const rim = new THREE.DirectionalLight(0x66aaff, 1.4);
rim.position.set(-6, 2, -5);
scene.add(rim);

const grid = new THREE.GridHelper(24, 24, 0x1d2a38, 0x141d27);
grid.position.y = -2.6;
scene.add(grid);

const matA = new THREE.MeshStandardMaterial({ color: 0x9aa7b8, roughness: 0.55, metalness: 0.05, flatShading: true });
const matB = new THREE.MeshStandardMaterial({ color: 0x34d399, roughness: 0.42, metalness: 0.1, flatShading: true });
const wireMat = new THREE.MeshBasicMaterial({ color: 0x0b0e14, wireframe: true, transparent: true, opacity: 0.28 });

const groupA = new THREE.Group(); groupA.position.x = -1.9; scene.add(groupA);
const groupB = new THREE.Group(); groupB.position.x = 1.9; scene.add(groupB);

function toGeometry(mesh) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(mesh.positions), 3));
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(mesh.indices), 1));
  g.computeVertexNormals();
  return g;
}

function build(geo, mat, group) {
  while (group.children.length) {
    const c = group.children.pop();
    c.geometry?.dispose();
  }
  const solid = new THREE.Mesh(geo, mat);
  const wire = new THREE.Mesh(geo, wireMat);
  group.add(solid, wire);
}

let source = null;
let sourceStats = null;
let busy = false;
let pending = null;

function readGltf(json) {
  const bin = Uint8Array.from(atob(json.buffers[0].uri.split(",")[1]), (c) => c.charCodeAt(0));
  const bv = json.bufferViews;
  const idx = new Uint32Array(bin.buffer, bin.byteOffset + bv[0].byteOffset, json.accessors[0].count);
  const pos = new Float32Array(bin.buffer, bin.byteOffset + bv[1].byteOffset, json.accessors[1].count * 3);
  return makeMesh(Float64Array.from(pos), Uint32Array.from(idx));
}

async function run(ratio) {
  if (busy) { pending = ratio; return; }
  busy = true;
  $("status").textContent = "decimating…";
  await new Promise((r) => requestAnimationFrame(r));

  const target = Math.max(24, Math.round(sourceStats.triangleCount * ratio));
  const t0 = performance.now();
  const qem = qemDecimate(source, target);
  const cluster = vertexClusterToTarget(source, target);
  const ms = performance.now() - t0;

  const qStats = meshStats(qem.mesh);
  const bStats = meshStats(cluster.mesh);
  const errQ = surfaceError(source, qem.mesh, 4000, 11);
  const errB = surfaceError(source, cluster.mesh, 4000, 11);
  const diag = sourceStats.diagonal;
  const pq = (100 * errQ.max) / diag;
  const pb = (100 * errB.max) / diag;

  build(toGeometry(qem.mesh), matB, groupB);
  $("bud").textContent = `${target} tris (${(ratio * 100).toFixed(0)}%)`;
  $("qt").textContent = qStats.triangleCount;
  $("qe").textContent = `${pq.toFixed(3)}% diag`;
  $("bt").textContent = bStats.triangleCount;
  $("be").textContent = `${pb.toFixed(3)}% diag`;
  $("imp").textContent = `${(pb / pq).toFixed(2)}× lower`;
  $("ms").textContent = `${ms.toFixed(0)} ms`;
  $("l1").textContent = `${qStats.triangleCount} tris`;
  $("status").textContent = `error sampled at 4,000 points/mesh · bbox diag ${diag.toFixed(3)}`;
  busy = false;
  if (pending !== null) { const p = pending; pending = null; run(p); }
}

const url = new URL("./data/mesh.gltf", import.meta.url);
fetch(url)
  .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then((json) => {
    source = readGltf(json);
    sourceStats = meshStats(source);
    build(toGeometry(source), matA, groupA);
    $("src").textContent = `${sourceStats.triangleCount} tris / ${sourceStats.vertexCount} verts`;
    $("l0").textContent = `${sourceStats.triangleCount} tris`;
    $("status").textContent = "ready";
    run(0.1);
  })
  .catch((e) => { $("status").textContent = `failed to load sample: ${e.message}`; });

$("ratio").addEventListener("input", (e) => {
  const pct = Number(e.target.value);
  document.querySelectorAll("#panel button").forEach((b) => b.classList.toggle("on", Number(b.dataset.r) * 100 === pct));
  run(pct / 100);
});
document.querySelectorAll("#panel button").forEach((b) => {
  b.addEventListener("click", () => {
    const r = Number(b.dataset.r);
    document.querySelectorAll("#panel button").forEach((x) => x.classList.toggle("on", x === b));
    $("ratio").value = String(Math.round(r * 100));
    run(r);
  });
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
