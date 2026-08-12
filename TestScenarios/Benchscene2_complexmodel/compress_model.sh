#!/usr/bin/env bash
# Compress a GLB down to what this engine can actually read.
#
# ONE-TIME SOURCE TRANSFORM — not a build step. Unlike convert_to_ktx2.sh, which
# writes .ktx2 *beside* the sources it reads, this rewrites the model in place.
# Running it twice would quantize already-quantized data, so it refuses to touch
# a file that already declares KHR_mesh_quantization.
#
# WHY THESE FORMATS AND NOT DRACO/MESHOPT/KTX2
#   The engine builds a bare `new GLTFLoader(manager)` (WebEngineTS
#   src/engine/core/scenario/ScenarioAssets.ts) and never calls setDRACOLoader,
#   setMeshoptDecoder or setKTX2Loader. Three.js ships those extensions but each
#   throws without a decoder wired up, so Draco-, meshopt- or KTX2-compressed
#   models would fail at load. What survives that constraint:
#     - KHR_mesh_quantization — no decoder, the GPU reads the smaller types.
#     - EXT_texture_webp      — registered unconditionally by GLTFLoader and
#                               delegated to the normal texture path; the
#                               browser does the decoding.
#
# MEASURED on assets/models/complex_model.glb (2026-08-11):
#   40 453 656 -> 12 518 232 bytes (-69%). Vertex counts, primitive counts and
#   the bounding box are unchanged; indices drop u32 -> u16 on their own once
#   the meshes fit under 65 536 vertices.
#   Texture fidelity vs the original PNGs, PSNR / max channel error:
#     baseColor 41.6 dB / 14 · metallicRoughness 50.7 dB / 12 · normal 38.1 dB / 26
#   The normal map is the weakest and stays that way on purpose: lossy WebP is
#   always YUV 4:2:0, so its error plateaus near 38 dB no matter the quality
#   (measured q92/q96/q99 -> 38.10/38.55/38.80 dB). Lossless would fix it at
#   +3.57 MB, a 29% larger file. This material sets KHR_materials_specular
#   specularFactor = 0, so the normal map only shades diffuse light, where a
#   mean error of 2/255 does not show.
#
# TOOLING
#   - npx @gltf-transform/cli (downloaded on demand)
#   - Python + Pillow for the texture step. gltf-transform's own `webp` command
#     shells out to sharp, which fails here with
#     "colourspace: parameter space not set" on plain 8-bit RGB PNGs; Pillow
#     also lets each texture slot get its own quality.
#
# USAGE
#   ./compress_model.sh [input.glb] [output.glb]
#   Defaults to assets/models/complex_model.glb, rewritten in place.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IN="${1:-$SCRIPT_DIR/assets/models/complex_model.glb}"
OUT="${2:-$IN}"

[[ -f "$IN" ]] || { echo "ERROR: no such file: $IN" >&2; exit 1; }

GT="npx --yes @gltf-transform/cli@4"

# ---------- guard: never re-quantize ----------
if $GT inspect "$IN" 2>/dev/null | grep -q "KHR_mesh_quantization"; then
    echo "ERROR: $IN already declares KHR_mesh_quantization." >&2
    echo "       This transform is not idempotent; re-running it would quantize" >&2
    echo "       quantized data. Restore the original first:" >&2
    echo "         git show <commit>:<path> > \"$IN\"" >&2
    exit 1
fi

command -v python >/dev/null 2>&1 || { echo "ERROR: python not found" >&2; exit 1; }
python -c "from PIL import Image" 2>/dev/null || {
    echo "ERROR: Pillow not installed. Run: pip install --user Pillow" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

BEFORE=$(stat -c %s "$IN")
echo "==> input: $IN ($BEFORE bytes)"

# ---------- geometry ----------
# prune  — drops vertex attributes no material reads (this model carried a dead
#          TEXCOORD_3) and any orphaned accessor.
# dedup  — the three UV sets here are bit-identical; this is what collapses them
#          to one stored copy, and it is the single largest geometry win.
# quantize — f32 -> i16/u16 normalized, guarded by KHR_mesh_quantization.
# weld is deliberately absent: measured, it produced a byte-identical result
# after quantize while making the intermediate file larger.
echo "==> geometry: prune -> dedup -> quantize"
$GT prune "$IN" "$WORK/a.glb" --keep-attributes false --keep-indices false
$GT dedup "$WORK/a.glb" "$WORK/b.glb"
$GT quantize "$WORK/b.glb" "$WORK/c.glb"

# ---------- textures ----------
# Unpack to .gltf so the images become real files Pillow can rewrite, then
# re-reference them through EXT_texture_webp and repack.
echo "==> textures: PNG -> WebP"
mkdir -p "$WORK/unpacked"
$GT copy "$WORK/c.glb" "$WORK/unpacked/model.gltf"

python - "$WORK/unpacked" <<'PY'
import json, os, sys
from PIL import Image

root = sys.argv[1]
gltf_path = os.path.join(root, "model.gltf")
g = json.load(open(gltf_path))

# Per-slot quality: colour tolerates more loss than the channel-packed maps.
SLOT_QUALITY = {"baseColorTexture": 90, "metallicRoughnessTexture": 92,
                "normalTexture": 92, "_default": 92}

slot_of = {}
for mat in g.get("materials", []):
    pbr = mat.get("pbrMetallicRoughness", {})
    for slot, ref in (("baseColorTexture", pbr.get("baseColorTexture")),
                      ("metallicRoughnessTexture", pbr.get("metallicRoughnessTexture")),
                      ("normalTexture", mat.get("normalTexture")),
                      ("occlusionTexture", mat.get("occlusionTexture")),
                      ("emissiveTexture", mat.get("emissiveTexture"))):
        if ref is not None:
            slot_of[g["textures"][ref["index"]]["source"]] = slot

for i, img in enumerate(g.get("images", [])):
    uri = img.get("uri")
    if not uri:
        continue
    src = os.path.join(root, uri)
    dst_name = os.path.splitext(uri)[0] + ".webp"
    q = SLOT_QUALITY.get(slot_of.get(i), SLOT_QUALITY["_default"])
    Image.open(src).convert("RGB").save(
        os.path.join(root, dst_name), "WEBP", quality=q, method=6)
    print(f"    [{slot_of.get(i, 'unslotted')}] {uri} -> {dst_name} (q{q}) "
          f"{os.path.getsize(src)} -> {os.path.getsize(os.path.join(root, dst_name))}")
    img["uri"] = dst_name
    img["mimeType"] = "image/webp"

# EXT_texture_webp moves the image reference under the extension. No PNG is left
# behind as a fallback, so the extension is required rather than merely used.
for tex in g.get("textures", []):
    if "source" in tex:
        tex.setdefault("extensions", {})["EXT_texture_webp"] = {"source": tex.pop("source")}
for key in ("extensionsUsed", "extensionsRequired"):
    lst = g.setdefault(key, [])
    if "EXT_texture_webp" not in lst:
        lst.append("EXT_texture_webp")

json.dump(g, open(gltf_path, "w"), indent=1)
PY

$GT copy "$WORK/unpacked/model.gltf" "$WORK/final.glb"

# ---------- verify before overwriting anything ----------
echo "==> validate"
$GT validate "$WORK/final.glb"

mv -f "$WORK/final.glb" "$OUT"
AFTER=$(stat -c %s "$OUT")
echo
echo "==> $OUT"
echo "    $BEFORE -> $AFTER bytes ($(( 100 - AFTER * 100 / BEFORE ))% smaller)"
