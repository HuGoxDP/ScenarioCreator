import fs from "node:fs";
const file = process.argv[2];
const buf = fs.readFileSync(file);
const magic = buf.readUInt32LE(0), ver = buf.readUInt32LE(4), len = buf.readUInt32LE(8);
let off = 12; let json = null; const chunks = [];
while (off < len) {
  const cl = buf.readUInt32LE(off), ct = buf.readUInt32LE(off + 4);
  chunks.push({ type: ct.toString(16), len: cl, start: off + 8 });
  if (ct === 0x4e4f534a) json = JSON.parse(buf.slice(off + 8, off + 8 + cl).toString("utf8"));
  off += 8 + cl + ((4 - (cl % 4)) % 4);
}
const g = json;
console.log("== file:", file, "size", buf.length, "glbVer", ver);
console.log("chunks:", JSON.stringify(chunks));
console.log("extensionsUsed:", JSON.stringify(g.extensionsUsed || []));
console.log("extensionsRequired:", JSON.stringify(g.extensionsRequired || []));
console.log("asset:", JSON.stringify(g.asset));
console.log("counts: meshes", (g.meshes||[]).length, "materials", (g.materials||[]).length, "textures", (g.textures||[]).length, "images", (g.images||[]).length, "samplers", (g.samplers||[]).length);
console.log("\n-- materials --");
for (const [i, m] of (g.materials || []).entries()) console.log(i, JSON.stringify(m));
console.log("\n-- textures --");
for (const [i, t] of (g.textures || []).entries()) console.log(i, JSON.stringify(t));
console.log("\n-- images --");
for (const [i, im] of (g.images || []).entries()) {
  let extra = "";
  if (im.bufferView !== undefined) {
    const bv = g.bufferViews[im.bufferView];
    extra = ` bytes=${bv.byteLength}`;
    const start = chunks.find(c => c.type === "4e49screwed") ; // placeholder
  }
  console.log(i, JSON.stringify(im), extra);
}
console.log("\n-- samplers --");
for (const [i, s] of (g.samplers || []).entries()) console.log(i, JSON.stringify(s));
console.log("\n-- meshes --");
for (const [i, m] of (g.meshes || []).entries()) {
  console.log(i, m.name, "prims:", m.primitives.length);
  for (const p of m.primitives) console.log("   attrs:", JSON.stringify(Object.keys(p.attributes)), "mat:", p.material, "mode:", p.mode ?? 4, "indices:", p.indices);
}
