#!/usr/bin/env bash
# Move this model's COLOUR textures out of the GLB and into standalone files.
#
# ONE-TIME SOURCE TRANSFORM — not a build step, and not idempotent. It rewrites
# the model in place and refuses to run once there is no colour texture left in
# it.
#
# WHY ANYTHING MOVES OUT
#   The benchmark harness's `maxSize` and `ktx2` flags reach textures through
#   `Resources` → `Texture2D.fromArrayBuffer` / `fromKTX2ArrayBuffer`. An
#   EMBEDDED texture never takes that path: GLTFLoader hands three.js the
#   decoded image and the engine only wraps the result. Verified in the shipped
#   bundle — `Resources._registerBuiltinDecoders` dispatches on the file
#   extension, and an image inside a GLB has no file to dispatch on. So with
#   every texture embedded, `maxSize ∈ {0, 2048, 1024}` and `ktx2 ∈ {0, 1}`
#   measured exactly the same scene — six dead rows in Table 2.
#
# WHY ONLY THE COLOUR ONE MOVES
#   `Texture2D.fromArrayBuffer` sets `colorSpace = SRGBColorSpace`
#   unconditionally, and no `StandardMaterial` setter corrects it. That is
#   correct for base colour and emissive, and WRONG for every other slot: a
#   normal map and a metallic-roughness map hold linear data, and decoding them
#   as sRGB skews the normals and the metalness. Measured at runtime, with all
#   three maps external, `normalMap`, `metalnessMap` and `roughnessMap` all came
#   back tagged `srgb`; the model rendered dark and blotchy. See entry 5 of
#   docs/ENGINE-GAPS.md.
#
#   So the rule this script follows is: **a texture may only leave the GLB if
#   sRGB is its correct colour space.** Base colour and emissive qualify.
#   Normal, metallic-roughness and occlusion stay embedded, where GLTFLoader
#   assigns their colour space per slot and gets it right.
#
#   That costs measurement strength — the cap and the format swap now reach one
#   map instead of three — and buys two things worth more. The scene shades
#   correctly, and both arms of the KTX2 A/B shade IDENTICALLY, so that flag
#   varies a texture format and nothing else. With all three external the normal
#   map came out `srgb` at ktx2=0 and `srgb-linear` at ktx2=1, which made the
#   A/B compare two scenes that were not the same scene.
#
# WHY .jpg AND NOT .webp
#   The image inside the GLB is already WebP, so writing it out as .webp would
#   cost nothing. It is re-encoded to JPEG anyway, for one reason: Benchscene3
#   ships .jpg + .ktx2, and the KTX2 saving reported for the two scenes is only
#   comparable if both are measured against the same kind of uncompressed
#   source. A jpg→ktx2 number and a webp→ktx2 number are not the same quantity.
#   The cost is one extra lossy generation, measured below.
#
# WHAT IS DELIBERATELY NOT CHANGED
#   The meshes keep every UV set they had. Pruning unused attributes would
#   shrink the vertex buffers and move the geometry side of every Scene 2
#   measurement, and this transform is supposed to change the texture path only.
#
# TOOLING
#   - npx @gltf-transform/cli@4 (downloaded on demand)
#   - Python + Pillow
#
# USAGE
#   ./deembed_textures.sh [input.glb]
#   Defaults to assets/models/complex_model.glb, rewritten in place.
#   The colour texture lands in assets/textures/. Run ./convert_to_ktx2.sh after.

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

mkdir -p "$WORK/unpacked"
$GT copy "$IN" "$WORK/unpacked/model.gltf"
mkdir -p "$TEX_DIR"

python - "$WORK/unpacked" "$TEX_DIR" <<'PY'
import json, math, os, sys
from PIL import Image, ImageChops

root, tex_dir = sys.argv[1], sys.argv[2]
gltf_path = os.path.join(root, "model.gltf")
g = json.load(open(gltf_path))

# Only slots whose correct colour space is sRGB. See the header.
COLOUR_SLOTS = {
    "baseColorTexture": "complex_albedo",
    "emissiveTexture": "complex_emissive",
}
# 4:4:4 and q92. Chroma subsampling is avoided even for colour so the one
# texture that does move keeps the same policy the maps would have needed.
QUALITY = 92


def source_of(tex):
    if "source" in tex:
        return tex["source"]
    return tex.get("extensions", {}).get("EXT_texture_webp", {}).get("source")


moved = []
for mat in g.get("materials", []):
    pbr = mat.setdefault("pbrMetallicRoughness", {})
    for slot, stem in COLOUR_SLOTS.items():
        ref = pbr.get(slot) if slot == "baseColorTexture" else mat.get(slot)
        if ref is None:
            continue

        index = source_of(g["textures"][ref["index"]])
        img = g["images"][index]
        uri = img.get("uri")
        if uri is None:
            print(f"    {slot}: image {index} has no uri — skipped", file=sys.stderr)
            continue

        src = os.path.join(root, uri)
        dst = os.path.join(tex_dir, stem + ".jpg")
        original = Image.open(src).convert("RGB")
        original.save(dst, "JPEG", quality=QUALITY, subsampling=0, optimize=True)  # 0 = 4:4:4

        reloaded = Image.open(dst).convert("RGB")
        hist = ImageChops.difference(original, reloaded).histogram()
        sq = sum(v * (n % 256) ** 2 for n, v in enumerate(hist))
        mse = sq / (original.size[0] * original.size[1] * 3)
        psnr = 10 * math.log10(255 * 255 / mse) if mse > 0 else float("inf")
        peak = max(n % 256 for n, v in enumerate(hist) if v)

        print(f"    [{slot}] {uri} {original.size[0]}x{original.size[1]} -> {stem}.jpg (q{QUALITY})"
              f"  {os.path.getsize(src)} -> {os.path.getsize(dst)} bytes"
              f"   PSNR {psnr:.1f} dB / max channel error {peak}")

        # Drop only this reference. `gltf-transform prune` removes the orphaned
        # texture, image and sampler afterwards and reindexes everything, which
        # is far safer than renumbering the arrays by hand.
        if slot == "baseColorTexture":
            pbr.pop(slot, None)
        else:
            mat.pop(slot, None)
        moved.append(stem)

if not moved:
    print("ERROR: no colour texture found — already de-embedded?", file=sys.stderr)
    sys.exit(2)

json.dump(g, open(gltf_path, "w"), indent=1)
print(f"    moved out: {', '.join(moved)}; every linear-data map stays embedded")
PY

$GT copy "$WORK/unpacked/model.gltf" "$WORK/packed.glb"
# Drops the image, texture and sampler the reference above orphaned.
$GT prune "$WORK/packed.glb" "$WORK/final.glb"

echo "==> validate"
$GT validate "$WORK/final.glb"

mv -f "$WORK/final.glb" "$IN"
AFTER=$(stat -c %s "$IN")

echo
echo "==> $IN"
echo "    $BEFORE -> $AFTER bytes"
echo "    standalone textures in $TEX_DIR:"
ls -l "$TEX_DIR" 2>/dev/null | tail -n +2 | awk '{printf "      %-28s %10d\n", $9, $5}'
echo
echo "Next: ./convert_to_ktx2.sh   (ships the .ktx2 variant beside the .jpg)"
