import { readFileSync } from "node:fs";
import { makeMesh } from "../src/core.mjs";

export function loadSample(rel = "../data/mesh.gltf") {
  const g = JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
  const bin = Buffer.from(g.buffers[0].uri.split(",")[1], "base64");
  const bv = g.bufferViews;
  const idx = new Uint16Array(bin.buffer, bin.byteOffset + bv[0].byteOffset, g.accessors[0].count);
  const pos = new Float32Array(bin.buffer, bin.byteOffset + bv[1].byteOffset, g.accessors[1].count * 3);
  return makeMesh(Float64Array.from(pos), Uint32Array.from(idx));
}
