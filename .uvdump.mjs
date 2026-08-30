import fs from "node:fs";
const file = process.argv[2];
const buf = fs.readFileSync(file);
const len = buf.readUInt32LE(8);
let off = 12, json = null, binStart = 0;
while (off < len) {
  const cl = buf.readUInt32LE(off), ct = buf.readUInt32LE(off + 4);
  if (ct === 0x4e4f534a) json = JSON.parse(buf.slice(off + 8, off + 8 + cl).toString("utf8"));
  if (ct === 0x004e4942) binStart = off + 8;
  off += 8 + cl + ((4 - (cl % 4)) % 4);
}
const g = json;
const CT = { 5120: ["Int8", 1], 5121: ["Uint8", 1], 5122: ["Int16", 2], 5123: ["Uint16", 2], 5125: ["Uint32", 4], 5126: ["Float32", 4] };
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
function readVec2(accIdx, count) {
  const a = g.accessors[accIdx];
  const bv = g.bufferViews[a.bufferView];
  const [kind, sz] = CT[a.componentType];
  const stride = bv.byteStride || sz * 2;
  const base = binStart + (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = [];
  const n = Math.min(count, a.count);
  for (let i = 0; i < n; i++) {
    const p = base + i * stride;
    let x = buf[`read${kind === "Float32" ? "Float" : kind}LE`](p);
    let y = buf[`read${kind === "Float32" ? "Float" : kind}LE`](p + sz);
    if (a.normalized) { const d = NORM[a.componentType]; x = Math.max(x / d, -1); y = Math.max(y / d, -1); }
    out.push([+x.toFixed(4), +y.toFixed(4)]);
  }
  return { desc: `${kind}${a.normalized ? "(norm)" : ""} count=${a.count} min=${JSON.stringify(a.min)} max=${JSON.stringify(a.max)}`, vals: out };
}
console.log("== " + file);
for (const [mi, m] of g.meshes.entries()) {
  const p = m.primitives[0];
  const sets = Object.keys(p.attributes).filter(k => k.startsWith("TEXCOORD")).sort();
  console.log(`\nmesh ${mi} ${m.name}  vertexCount=${g.accessors[p.attributes.POSITION].count}`);
  for (const s of sets) {
    const r = readVec2(p.attributes[s], 4);
    console.log(`  ${s}: ${r.desc}`);
    console.log(`     first4 = ${JSON.stringify(r.vals)}`);
  }
  if (mi >= 1) break;
}
// Are the UV sets identical to each other within a mesh?
console.log("\n-- pairwise identity check on mesh 0 (first 2000 verts) --");
const p0 = g.meshes[0].primitives[0];
const sets0 = Object.keys(p0.attributes).filter(k => k.startsWith("TEXCOORD")).sort();
const data = {};
for (const s of sets0) data[s] = readVec2(p0.attributes[s], 2000).vals;
for (let i = 0; i < sets0.length; i++) for (let j = i + 1; j < sets0.length; j++) {
  const A = data[sets0[i]], B = data[sets0[j]];
  let maxd = 0;
  for (let k = 0; k < A.length; k++) maxd = Math.max(maxd, Math.abs(A[k][0] - B[k][0]), Math.abs(A[k][1] - B[k][1]));
  console.log(`  ${sets0[i]} vs ${sets0[j]}: maxDelta=${maxd.toFixed(4)} ${maxd < 0.01 ? "IDENTICAL" : "*** DIFFERENT ***"}`);
}
