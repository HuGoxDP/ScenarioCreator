#!/usr/bin/env bash
# Re-embed this model's DATA maps losslessly.
#
# ONE-TIME SOURCE TRANSFORM — not a build step. It rewrites the model in place
# and refuses to run once no lossy data map is left in it.
#
# WHAT WAS WRONG
#   compress_model.sh encoded every embedded texture as LOSSY WebP with a
#   per-slot quality (q90 colour, q92 maps). That is fine for base colour and
#   wrong for the two channel-packed maps: a normal map keeps X and Y in R and
#   G, and a metallic-roughness map keeps two independent scalars in B and G.
#   Lossy compression is tuned to hide error from the eye in a *photograph*; on
#   data channels it lands as visible blocking once the shading amplifies it.
#
#   Measured against the original PNGs recovered from git (see below):
#
#     normal              VP8 lossy   PSNR 38.1 dB   max channel error 27   RMSE 3.18
#     metallicRoughness   VP8 lossy   PSNR 50.5 dB   max channel error 12   RMSE 0.76
#
#   A 27/255 error in a normal map's X is a real deviation of the shaded normal,
#   and it is not spread evenly — it clusters on VP8 block boundaries, which is
#   exactly what shows on screen.
#
#   NOT the second UV set. TEXCOORD_1 in this model points at the SAME ACCESSOR
#   as TEXCOORD_0 in all four primitives (verified: `TEXCOORD_1=acc7 SAME
#   ACCESSOR`), so sampling with either is identical and carrying the second set
#   changes nothing. The blocking is the encoding.
#
# WHY LOSSLESS WEBP AND NOT PNG
#   Both are exact. WebP lossless is simply smaller here, and stays on the
#   EXT_texture_webp path the archive already declares — CLAUDE.md rule 5 blesses
#   it because GLTFLoader registers that extension unconditionally and the
#   browser does the decoding, so it needs no decoder the engine does not wire.
#
#     normal              PNG 7 177 138   WebP lossless 4 979 164
#     metallicRoughness   PNG   562 372   WebP lossless   433 356
#
# WHERE THE ORIGINALS COME FROM
#   Re-encoding the shipped lossy WebP as lossless would only freeze the blocks
#   that are already there. The uncompressed source is the pre-compression GLB
#   in git history — 40 453 656 bytes, three 2048x2048 PNGs — at the commit
#   before 1dadd37. This script reads it from git rather than keeping a second
#   copy of 7.7 MB of PNG in the working tree; git history *is* the archive of
#   the originals, and naming the commit is what makes that reproducible.
#
# COST
#   The GLB grows by about 3.9 MB. That is the price of exact data maps, and it
#   is transmission only — VRAM is unchanged, since both decode to the same
#   2048x2048 RGBA.
#
# TOOLING
#   - npx @gltf-transform/cli@4
#   - Python + Pillow
#   - git (to recover the originals)
#
# USAGE
#   ./relossless_data_maps.sh [input.glb]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
IN="${1:-$SCRIPT_DIR/assets/models/complex_model.glb}"

# The commit that compressed the model; its parent still holds the PNGs.
ORIGIN_COMMIT="1dadd37^"

[[ -f "$IN" ]] || { echo "ERROR: no such file: $IN" >&2; exit 1; }

GT="npx --yes @gltf-transform/cli@4"
command -v python >/dev/null 2>&1 || { echo "ERROR: python not found" >&2; exit 1; }
python -c "from PIL import Image" 2>/dev/null || {
    echo "ERROR: Pillow not installed. Run: pip install --user Pillow" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

BEFORE=$(stat -c %s "$IN")
echo "==> input: $IN ($BEFORE bytes)"

# ---------- recover the originals ----------
echo "==> recovering the pre-compression model from git ($ORIGIN_COMMIT)"
ORIG="$WORK/original.glb"
if ! git -C "$REPO" show "$ORIGIN_COMMIT:TestScenarios/Benchscene2_complexmodel/assets/models/complex_model.glb" > "$ORIG" 2>/dev/null; then
    git -C "$REPO" show "$ORIGIN_COMMIT:Scenarios/Benchscene2_complexmodel/assets/models/complex_model.glb" > "$ORIG"
fi
echo "    $(stat -c %s "$ORIG") bytes"

# ---------- unpack the current model ----------
mkdir -p "$WORK/unpacked"
$GT copy "$IN" "$WORK/unpacked/model.gltf"

python - "$WORK/unpacked" "$ORIG" <<'PY'
import io, json, os, struct, sys
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

root, orig_path = sys.argv[1], sys.argv[2]
gltf_path = os.path.join(root, "model.gltf")
g = json.load(open(gltf_path))

# Slots whose contents are DATA, not colour. Only these are re-encoded.
DATA_SLOTS = {"normalTexture", "metallicRoughnessTexture", "occlusionTexture"}


def slot_map(doc):
    """image index -> slot name, for whichever way the texture references it."""
    out = {}
    for mat in doc.get("materials", []):
        pbr = mat.get("pbrMetallicRoughness", {})
        pairs = (("baseColorTexture", pbr.get("baseColorTexture")),
                 ("metallicRoughnessTexture", pbr.get("metallicRoughnessTexture")),
                 ("normalTexture", mat.get("normalTexture")),
                 ("occlusionTexture", mat.get("occlusionTexture")),
                 ("emissiveTexture", mat.get("emissiveTexture")))
        for name, ref in pairs:
            if ref is None:
                continue
            tex = doc["textures"][ref["index"]]
            src = tex.get("source")
            if src is None:
                src = tex.get("extensions", {}).get("EXT_texture_webp", {}).get("source")
            out[src] = name
    return out


def read_glb(path):
    data = open(path, "rb").read()
    _, _, length = struct.unpack("<III", data[:12])
    off, chunks = 12, []
    while off < length:
        clen, ctype = struct.unpack("<II", data[off:off + 8])
        chunks.append((ctype, clen, off + 8))
        off += 8 + clen
    doc = json.loads(data[chunks[0][2]:chunks[0][2] + chunks[0][1]])
    return data, doc, chunks[1][2]


# Originals, keyed by slot.
odata, odoc, obin = read_glb(orig_path)
oslots = slot_map(odoc)
originals = {}
for i, img in enumerate(odoc.get("images", [])):
    name = oslots.get(i)
    if name not in DATA_SLOTS:
        continue
    bv = odoc["bufferViews"][img["bufferView"]]
    start = obin + bv.get("byteOffset", 0)
    originals[name] = odata[start:start + bv["byteLength"]]

if not originals:
    print("ERROR: the original model has no data maps to recover", file=sys.stderr)
    sys.exit(2)


def webp_is_lossy(raw):
    return raw[:4] == b"RIFF" and raw[8:12] == b"WEBP" and raw[12:16] == b"VP8 "


slots = slot_map(g)
replaced, skipped = [], []
for i, img in enumerate(g.get("images", [])):
    name = slots.get(i)
    uri = img.get("uri")
    if name not in DATA_SLOTS or uri is None:
        continue

    current_path = os.path.join(root, uri)
    current = open(current_path, "rb").read()
    if not webp_is_lossy(current):
        skipped.append(name)
        continue
    if name not in originals:
        print(f"    {name}: no original in the recovered model — left alone", file=sys.stderr)
        continue

    source = Image.open(io.BytesIO(originals[name])).convert("RGB")
    check = Image.open(io.BytesIO(current))
    if source.size != check.size:
        print(f"    {name}: original is {source.size}, embedded is {check.size} — left alone",
              file=sys.stderr)
        continue

    buf = io.BytesIO()
    source.save(buf, "WEBP", lossless=True, method=6)
    encoded = buf.getvalue()

    # Prove it round-trips exactly before writing anything.
    back = Image.open(io.BytesIO(encoded)).convert("RGB")
    if back.tobytes() != source.tobytes():
        print(f"ERROR: {name} did not round-trip losslessly", file=sys.stderr)
        sys.exit(3)

    open(current_path, "wb").write(encoded)
    print(f"    [{name}] {source.size[0]}x{source.size[1]}  lossy {len(current)} -> "
          f"lossless {len(encoded)} bytes  (exact: max channel error 0)")
    replaced.append(name)

if not replaced:
    print("ERROR: nothing to do — no lossy data map found. Already re-encoded?", file=sys.stderr)
    sys.exit(2)
if skipped:
    print(f"    already lossless, untouched: {', '.join(skipped)}")

json.dump(g, open(gltf_path, "w"), indent=1)
PY

$GT copy "$WORK/unpacked/model.gltf" "$WORK/final.glb"

echo "==> validate"
$GT validate "$WORK/final.glb"

mv -f "$WORK/final.glb" "$IN"
AFTER=$(stat -c %s "$IN")
echo
echo "==> $IN"
echo "    $BEFORE -> $AFTER bytes  (+$(( AFTER - BEFORE )))"
echo "    VRAM is unchanged: both encodings decode to the same 2048x2048 RGBA."
