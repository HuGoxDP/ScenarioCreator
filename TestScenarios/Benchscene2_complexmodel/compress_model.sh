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
# COLOUR IS LOSSY, DATA IS NOT
#   The encoder is chosen by what the slot *holds*, not by what it looks like.
#   Base colour and emission are photographs and tolerate YUV 4:2:0. A normal map
#   keeps X and Y in R and G, and a metallic-roughness map keeps two independent
#   scalars in B and G; lossy compression is tuned to hide error from the eye in
#   a picture, and on those channels it lands as blocking that the shading then
#   amplifies. So DATA_SLOTS below encode lossless, at any file size.
#
#   This reverses an earlier decision recorded here, that q92 was good enough for
#   the normal map because the material sets specularFactor = 0 and so shades
#   only diffuse light. It is not: 27/255 of error on a normal's X is a real
#   deviation, and it clusters on VP8 block boundaries rather than spreading.
#   The model already in the tree was repaired in place by relossless_data_maps.sh;
#   this change is what stops a re-run from undoing that.
#
# MEASURED on assets/models/complex_model.glb (2026-08-11, texture rows redone
# 2026-08-24 after the lossless change):
#   40 453 656 -> 12 518 232 bytes (-69%) with everything lossy;
#   15 120 096 bytes with the data maps lossless (-63%). Vertex counts, primitive
#   counts and the bounding box are unchanged; indices drop u32 -> u16 on their
#   own once the meshes fit under 65 536 vertices.
#
#   Texture fidelity vs the original PNGs, max channel error / PSNR:
#     baseColor           lossy q90     14 / 41.6 dB
#     metallicRoughness   lossless       0 / exact   (was 12 / 50.5 dB)
#     normal              lossless       0 / exact   (was 27 / 38.1 dB)
#   Quality does not rescue the lossy normal map — its error plateaus near 38 dB
#   whatever the setting (measured q92/q96/q99 -> 38.10/38.55/38.80 dB), because
#   WebP's lossy mode is always YUV 4:2:0. Only lossless fixes it. Cost: +3.92 MB
#   in the archive, and nothing in VRAM — both encodings decode to the same
#   2048x2048 RGBA.
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
#
#   LOD_RATIOS=25,50 ./compress_model.sh
#   Emits coarser meshes into <scenario>/lods/models/ instead, for the manifest's
#   lods[]. Runs on the already-compressed model and never touches assets/.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IN="${1:-$SCRIPT_DIR/assets/models/complex_model.glb}"
OUT="${2:-$IN}"

[[ -f "$IN" ]] || { echo "ERROR: no such file: $IN" >&2; exit 1; }

GT="npx --yes @gltf-transform/cli@4"

# ---------- LOD ladder (LOD_RATIOS=25,50) ----------
# Coarser meshes for the manifest's lods[]. Written to <scenario>/lods/models/,
# outside assets/, because build-package.mjs copies assets/ verbatim and levels
# in the ZIP would make it bigger while making nothing faster — the client would
# have to take every level to use one.
#
# Named <stem>.<percent>.glb so they sort ascending coarse-to-fine, which is the
# order the engine reads levels in. The full-detail model is not copied here: it
# is already in the archive and is listed as the top rung.
#
# This mode runs on the ALREADY-COMPRESSED model, so it deliberately skips the
# re-quantize guard below — quantized input is exactly what it expects.
#
# MEASURED on the compressed complex_model.glb (2026-08-12, before the data maps
# were made lossless — the sizes below are of the all-lossy ladder):
#   436 810 triangles / 12 518 232 bytes
#     -> 50%: 218 402 tris / 8 111 952 bytes
#     -> 25%: 109 195 tris / 5 826 336 bytes
#   Both keep extensionsRequired at EXT_texture_webp + KHR_mesh_quantization,
#   so a coarse level needs no decoder the full one did not.
#
#   `weld` before simplify is not optional: without it the simplifier stalls
#   well short of the target, because this model is a Sketchfab export split
#   into four 65 532-vertex chunks and split vertices pin the topology. weld
#   also re-splits the deduplicated UV accessors and inflates the file to
#   14.54 MB, which is why dedup and quantize have to run again afterwards.
#
#   Textures are carried over untouched. A coarse mesh still ships the full
#   2.81 MB of WebP, so these levels save geometry only.
if [[ -n "${LOD_RATIOS:-}" ]]; then
    LOD_DIR="$SCRIPT_DIR/lods/models"
    STEM="$(basename "${IN%.*}")"
    mkdir -p "$LOD_DIR"

    WORK="$(mktemp -d)"
    trap 'rm -rf "$WORK"' EXIT

    echo "==> welding $IN (needed before simplification)"
    $GT weld "$IN" "$WORK/welded.glb"

    for pct in ${LOD_RATIOS//,/ }; do
        DST="$LOD_DIR/${STEM}.${pct}.glb"
        if [[ -f "$DST" && "${FORCE:-0}" != "1" ]]; then
            echo "  skip (exists): $(basename "$DST")"
            continue
        fi
        echo "==> level ${pct}%"
        # --error 0.05 lets the simplifier actually reach the ratio; the default
        # stops early on this topology and silently returns a nearly full mesh.
        $GT simplify "$WORK/welded.glb" "$WORK/s.glb" --ratio "0.${pct}" --error 0.05
        $GT dedup "$WORK/s.glb" "$WORK/d.glb"
        $GT quantize "$WORK/d.glb" "$WORK/q.glb"

        # Scale the embedded textures to match. Without this a "coarse" level
        # still carries full-resolution maps — at 25% that was 2.81 MB of WebP
        # inside a 5.83 MB file, so nearly half of the coarsest rung was not
        # coarse at all. A GLB embeds its images, so a level stays one file.
        rm -rf "$WORK/u"; mkdir -p "$WORK/u"
        $GT copy "$WORK/q.glb" "$WORK/u/m.gltf"
        python - "$WORK/u" "$pct" <<'PY'
import json, os, sys
from PIL import Image

root, pct = sys.argv[1], int(sys.argv[2])
g = json.load(open(os.path.join(root, "m.gltf")))

# Same rule as the full-detail pass: a resized data map is still data. Halving
# it is a deliberate, documented reduction; adding block noise on top of it is
# not, and a coarse normal map is sampled at a coarser mip anyway, which spreads
# the error rather than hiding it.
DATA_SLOTS = {"normalTexture", "metallicRoughnessTexture", "occlusionTexture"}

slot_of = {}
for mat in g.get("materials", []):
    pbr = mat.get("pbrMetallicRoughness", {})
    for slot, ref in (("baseColorTexture", pbr.get("baseColorTexture")),
                      ("metallicRoughnessTexture", pbr.get("metallicRoughnessTexture")),
                      ("normalTexture", mat.get("normalTexture")),
                      ("occlusionTexture", mat.get("occlusionTexture")),
                      ("emissiveTexture", mat.get("emissiveTexture"))):
        if ref is None:
            continue
        tex = g["textures"][ref["index"]]
        src = tex.get("source")
        if src is None:
            src = tex.get("extensions", {}).get("EXT_texture_webp", {}).get("source")
        slot_of[src] = slot

for i, img in enumerate(g.get("images", [])):
    uri = img.get("uri")
    if not uri or not uri.endswith(".webp"):
        continue
    f = os.path.join(root, uri)
    im = Image.open(f)
    w, h = im.size
    nw, nh = max(1, round(w * pct / 100)), max(1, round(h * pct / 100))
    before = os.path.getsize(f)
    slot = slot_of.get(i)
    lossless = slot in DATA_SLOTS
    opts = {"lossless": True} if lossless else {"quality": 90}
    im.resize((nw, nh), Image.LANCZOS).save(f, "WEBP", method=6, **opts)
    print(f"    [{slot or 'unslotted'}] {uri}: {w}x{h} -> {nw}x{nh} "
          f"({'lossless' if lossless else 'q90'}), "
          f"{before} -> {os.path.getsize(f)} bytes")
PY
        $GT copy "$WORK/u/m.gltf" "$WORK/final.glb"
        $GT validate "$WORK/final.glb"
        mv -f "$WORK/final.glb" "$DST"
        echo "    $(stat -c %s "$DST") bytes -> $DST"
    done

    echo
    echo "Ladder in $LOD_DIR:"
    ls -l "$LOD_DIR" | tail -n +2 | awk '{printf "  %-32s %12d\n", $9, $5}'
    exit 0
fi

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

# Slots that hold DATA rather than a picture. These are encoded lossless; see
# the header. Everything else is a photograph and takes a quality.
DATA_SLOTS = {"normalTexture", "metallicRoughnessTexture", "occlusionTexture"}
SLOT_QUALITY = {"baseColorTexture": 90, "emissiveTexture": 90, "_default": 92}

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
    slot = slot_of.get(i)
    lossless = slot in DATA_SLOTS
    opts = ({"lossless": True} if lossless
            else {"quality": SLOT_QUALITY.get(slot, SLOT_QUALITY["_default"])})
    Image.open(src).convert("RGB").save(
        os.path.join(root, dst_name), "WEBP", method=6, **opts)
    how = "lossless" if lossless else f"q{opts['quality']}"
    print(f"    [{slot or 'unslotted'}] {uri} -> {dst_name} ({how}) "
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
