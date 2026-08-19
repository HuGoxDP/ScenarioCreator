#!/usr/bin/env bash
# Move this model's textures OUT of the GLB and into standalone files.
#
# ONE-TIME SOURCE TRANSFORM — not a build step, and not idempotent. It rewrites
# the model in place and refuses to run on a GLB that has no images left.
#
# WHY
#   The benchmark harness's `maxSize` and `ktx2` flags reach textures through
#   `Resources` → `Texture2D.fromArrayBuffer` / `fromKTX2ArrayBuffer`. An
#   EMBEDDED texture never takes that path: GLTFLoader hands three.js the
#   decoded image and the engine only wraps the result
#   (`Texture2D._fromThreeTexture`). Verified in the shipped bundle —
#   `Resources._registerBuiltinDecoders` dispatches on the file extension, and
#   an image inside a GLB has no file to dispatch on:
#
#     registerDecoder(Texture2D, [".png",".jpg",".jpeg",".webp",".gif",".ktx2"],
#       async (bytes, path) => path.endsWith(".ktx2")
#         ? Texture2D.fromKTX2ArrayBuffer(ab)
#         : Texture2D.fromArrayBuffer(ab));
#
#   So with the textures embedded, `maxSize ∈ {0, 2048, 1024}` and `ktx2 ∈
#   {0, 1}` all measure exactly the same scene — six dead rows in Table 2.
#   Standalone files fix that, and are the pattern Benchscene3 already uses.
#
# WHY .jpg AND NOT .webp
#   The images inside the GLB are already WebP, so writing them out as .webp
#   would cost nothing. They are re-encoded to JPEG anyway, for one reason:
#   Benchscene3 ships .jpg + .ktx2, and the KTX2 saving reported for the two
#   scenes is only comparable if both are measured against the same kind of
#   uncompressed source. A jpg→ktx2 number and a webp→ktx2 number are not the
#   same quantity. The cost is one extra lossy generation, measured below.
#
# WHAT IS DELIBERATELY NOT CHANGED
#   The meshes keep TEXCOORD_1 and TEXCOORD_2 even though nothing reads them
#   now. Pruning them would shrink the vertex buffers and move the geometry
#   side of every Scene 2 measurement, and this transform is supposed to change
#   the texture path only. (`dedup` in compress_model.sh already collapsed the
#   three UV sets to one stored copy — they are bit-identical, which is also
#   why assigning all three maps to uv0 from script is not a visual change.)
#
# TOOLING
#   - npx @gltf-transform/cli@4 (downloaded on demand)
#   - Python + Pillow
#
# USAGE
#   ./deembed_textures.sh [input.glb]
#   Defaults to assets/models/complex_model.glb, rewritten in place.
#   Textures land in assets/textures/. Run ./convert_to_ktx2.sh afterwards.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IN="${1:-$SCRIPT_DIR/assets/models/complex_model.glb}"
TEX_DIR="$SCRIPT_DIR/assets/textures"

[[ -f "$IN" ]] || { echo "ERROR: no such file: $IN" >&2; exit 1; }

GT="npx --yes @gltf-transform/cli@4"

command -v python >/dev/null 2>&1 || { echo "ERROR: python not found" >&2; exit 1; }
python -c "from PIL import Image" 2>/dev/null || {
    echo "ERROR: Pillow not installed. Run: pip install --user Pillow" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

BEFORE=$(stat -c %s "$IN")
echo "==> input: $IN ($BEFORE bytes)"

# Unpack to .gltf so the embedded images become real files.
mkdir -p "$WORK/unpacked"
$GT copy "$IN" "$WORK/unpacked/model.gltf"

mkdir -p "$TEX_DIR"

# ---------- extract, re-encode, and strip ----------
python - "$WORK/unpacked" "$TEX_DIR" <<'PY'
import json, os, sys
from PIL import Image, ImageChops
import math

root, tex_dir = sys.argv[1], sys.argv[2]
gltf_path = os.path.join(root, "model.gltf")
g = json.load(open(gltf_path))

if not g.get("images"):
    print("ERROR: this GLB has no embedded images — already de-embedded?", file=sys.stderr)
    sys.exit(2)

# Which material slot each image serves. The names below are what the scenario
# asks Resources for, minus the extension.
SLOT_FILE = {
    "baseColorTexture":         "complex_albedo",
    "normalTexture":            "complex_normal",
    "metallicRoughnessTexture": "complex_metallic",
    "occlusionTexture":         "complex_ao",
    "emissiveTexture":          "complex_emissive",
}
# One quality for all three, and 4:4:4 for all three.
#
# Chroma subsampling is not an option here: the normal map keeps X and Y in the
# red and green channels, and 4:2:0 averages exactly those. Measured against the
# WebP the GLB carried, at 2048x2048:
#
#     baseColor          q90 4:2:0  36.7 dB    q92 4:4:4  38.7 dB
#     metallicRoughness  q90 4:2:0  50.2 dB    q92 4:4:4  52.3 dB
#     normal             q90 4:2:0  37.1 dB    q92 4:4:4  38.7 dB
#
# q92 lands on the same 38.7 dB the WebP step already spent (compress_model.sh
# records 38.1 dB for the normal against the original PNG), so this generation
# adds about as much error as the one before it and no more.
SLOT_QUALITY = {"_default": 92}


def source_of(tex):
    """A texture's image index, whether plain or behind EXT_texture_webp."""
    if "source" in tex:
        return tex["source"]
    return tex.get("extensions", {}).get("EXT_texture_webp", {}).get("source")


slot_of = {}
for mat in g.get("materials", []):
    pbr = mat.get("pbrMetallicRoughness", {})
    for slot, ref in (("baseColorTexture", pbr.get("baseColorTexture")),
                      ("metallicRoughnessTexture", pbr.get("metallicRoughnessTexture")),
                      ("normalTexture", mat.get("normalTexture")),
                      ("occlusionTexture", mat.get("occlusionTexture")),
                      ("emissiveTexture", mat.get("emissiveTexture"))):
        if ref is not None:
            slot_of[source_of(g["textures"][ref["index"]])] = slot

written = []
for i, img in enumerate(g["images"]):
    uri = img.get("uri")
    slot = slot_of.get(i)
    if uri is None or slot is None:
        print(f"    image {i}: no uri or not referenced by any material slot — skipped")
        continue

    src = os.path.join(root, uri)
    stem = SLOT_FILE.get(slot, f"complex_{slot}")
    dst = os.path.join(tex_dir, stem + ".jpg")
    quality = SLOT_QUALITY.get(slot, SLOT_QUALITY["_default"])

    original = Image.open(src).convert("RGB")
    original.save(dst, "JPEG", quality=quality, subsampling=0, optimize=True)  # 0 = 4:4:4

    # Second-generation loss, measured rather than asserted.
    reloaded = Image.open(dst).convert("RGB")
    diff = ImageChops.difference(original, reloaded)
    hist = diff.histogram()
    sq = sum(v * (n % 256) ** 2 for n, v in enumerate(hist))
    count = original.size[0] * original.size[1] * 3
    mse = sq / count
    psnr = 10 * math.log10(255 * 255 / mse) if mse > 0 else float("inf")
    peak = max(i2 % 256 for i2, v in enumerate(hist) if v)

    print(f"    [{slot}] {uri} {original.size[0]}x{original.size[1]} -> "
          f"{stem}.jpg (q{quality})  {os.path.getsize(src)} -> {os.path.getsize(dst)} bytes"
          f"   PSNR {psnr:.1f} dB / max channel error {peak}")
    written.append(stem)

# ---------- strip every trace of the textures from the model ----------
for mat in g.get("materials", []):
    mat.get("pbrMetallicRoughness", {}).pop("baseColorTexture", None)
    mat.get("pbrMetallicRoughness", {}).pop("metallicRoughnessTexture", None)
    for key in ("normalTexture", "occlusionTexture", "emissiveTexture"):
        mat.pop(key, None)

for key in ("textures", "images", "samplers"):
    g.pop(key, None)

# EXT_texture_webp was only ever there for the embedded images.
for key in ("extensionsUsed", "extensionsRequired"):
    if key in g:
        g[key] = [e for e in g[key] if e != "EXT_texture_webp"]
        if not g[key]:
            g.pop(key)

json.dump(g, open(gltf_path, "w"), indent=1)
print(f"    stripped images/textures/samplers; wrote {len(written)} texture files")
PY

# Remove the now-orphaned image files so the repack cannot pick them up again.
rm -f "$WORK/unpacked"/*.webp "$WORK/unpacked"/*.png "$WORK/unpacked"/*.jpg

$GT copy "$WORK/unpacked/model.gltf" "$WORK/final.glb"

echo "==> validate"
$GT validate "$WORK/final.glb"

mv -f "$WORK/final.glb" "$IN"
AFTER=$(stat -c %s "$IN")

echo
echo "==> $IN"
echo "    $BEFORE -> $AFTER bytes ($(( 100 - AFTER * 100 / BEFORE ))% smaller — the textures left)"
echo "    textures now in $TEX_DIR:"
ls -l "$TEX_DIR" | tail -n +2 | awk '{printf "      %-28s %10d\n", $9, $5}'
echo
echo "Next: ./convert_to_ktx2.sh   (ships the .ktx2 variant beside each .jpg)"
