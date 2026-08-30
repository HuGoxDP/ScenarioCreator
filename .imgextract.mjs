import fs from "node:fs";
const file = process.argv[2], outDir = process.argv[3];
const buf = fs.readFileSync(file);
const len = buf.readUInt32LE(8);
let off = 12, json = null, binStart = 0;
while (off < len) {
  const cl = buf.readUInt32LE(off), ct = buf.readUInt32LE(off + 4);
  if (ct === 0x4e4f534a) json = JSON.parse(buf.slice(off + 8, off + 8 + cl).toString("utf8"));
  if (ct === 0x004e4942) binStart = off + 8;
  off += 8 + cl + ((4 - (cl % 4)) % 4);
}
fs.mkdirSync(outDir, { recursive: true });
for (const [i, im] of (json.images || []).entries()) {
  const bv = json.bufferViews[im.bufferView];
  const start = binStart + (bv.byteOffset || 0);
  const data = buf.slice(start, start + bv.byteLength);
  const ext = im.mimeType === "image/png" ? "png" : im.mimeType === "image/webp" ? "webp" : "jpg";
  const out = `${outDir}/img${i}.${ext}`;
  fs.writeFileSync(out, data);
  // header sniff
  let dims = "?";
  if (ext === "png") dims = `${data.readUInt32BE(16)}x${data.readUInt32BE(20)} bitDepth=${data[24]} colorType=${data[25]}`;
  if (ext === "webp") {
    const fourcc = data.slice(12, 16).toString("ascii");
    if (fourcc === "VP8L") dims = "lossless(VP8L)";
    else if (fourcc === "VP8 ") dims = "LOSSY(VP8)";
    else if (fourcc === "VP8X") {
      const w = 1 + (data[24] | data[25] << 8 | data[26] << 16), h = 1 + (data[27] | data[28] << 8 | data[29] << 16);
      const sub = data.slice(30, 34).toString("ascii");
      dims = `VP8X ${w}x${h} sub=${sub}`;
    }
  }
  console.log(`img${i}: ${im.mimeType} ${data.length} bytes -> ${out}   ${dims}`);
}
