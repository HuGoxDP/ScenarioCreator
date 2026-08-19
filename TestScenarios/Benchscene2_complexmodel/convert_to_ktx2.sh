#!/usr/bin/env bash
# Convert all image files in assets/textures/ to .ktx2 (Basis Universal).
#
# COPIED VERBATIM from Benchscene3_solarsystem, apart from this note.
# build-package.mjs runs `<scenario>/convert_to_ktx2.sh` when --ktx2 is passed,
# so each scenario needs its own copy at that path; the script itself is generic
# and reads only $SCRIPT_DIR/assets/textures. Keeping the two identical is
# deliberate — the KTX2 saving reported for Scene 2 and Scene 3 is only
# comparable if both were encoded under the same policy, and this scene's normal
# map depends on the *normal* -> UASTC rule below.
# Output files are placed next to originals so Scenario.ts/_tex() picks them
# up when CONFIG.useKTX2 = true.
#
# Encoding policy:
#   *normal* / *_n.{ext} / *_nrm*   -> UASTC (linear, preserves normals) + zstd
#   everything else                  -> ETC1S / BasisLZ (sRGB, smaller files)
#
#   UASTC must be supercompressed explicitly. ETC1S carries BasisLZ inside the
#   payload, but UASTC is raw 8bpp blocks until zstd is applied, and KTX2 stores
#   it verbatim. Without --zstd, earth_normal.ktx2 came out at 2.67 MB with
#   supercompressionScheme = none — larger than the JPEG it replaces, and still
#   deflating to 15% inside the ZIP, which is the giveaway: a supercompressed
#   payload is close to incompressible. Sizes here are transmission only; UASTC
#   is chosen over ETC1S for normals because it survives the GPU decode, and
#   that VRAM footprint is unchanged either way.
#
# Robustness:
#   - File format is detected by magic bytes, not extension. Files with the
#     wrong extension (e.g. TIFF saved as .jpg) are normalized to a temporary
#     PNG via Python+Pillow before encoding.
#   - Per-file errors are logged but do not abort the batch.
#
# Tooling:
#   - KTX-Software (ktx 4.x or toktx legacy). Standard install path
#     C:\Program Files\KTX-Software\bin is auto-detected.
#   - Pillow (Python) for non-PNG/JPG inputs. Install: pip install --user Pillow
#
# Env vars:
#   FORCE=1            overwrite existing .ktx2
#   INCLUDE_SKYBOX=1   also convert assets/skybox/*
#   ZSTD_LEVEL=n       zstd level for UASTC, 1-22 (default 18)
#   LOD_SIZES=512,1024 also emit coarser levels into <scenario>/lods/ (off by
#                      default). These never enter the ZIP; build-manifest.mjs
#                      picks them up and lists them as ascending lods[].

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEX_DIR="$SCRIPT_DIR/assets/textures"
SKYBOX_DIR="$SCRIPT_DIR/assets/skybox"

INCLUDE_SKYBOX="${INCLUDE_SKYBOX:-0}"
FORCE="${FORCE:-0}"
ZSTD_LEVEL="${ZSTD_LEVEL:-18}"

# Coarser levels land here, outside assets/, so the ZIP never carries them.
LOD_DIR="$SCRIPT_DIR/lods"
LOD_SIZES="${LOD_SIZES:-}"

# ---------- tool detection ----------
TOOL=""
if command -v ktx >/dev/null 2>&1; then
    TOOL="ktx"
elif command -v toktx >/dev/null 2>&1; then
    TOOL="toktx"
else
    for p in "/c/Program Files/KTX-Software/bin" "/c/Program Files (x86)/KTX-Software/bin"; do
        if [[ -x "$p/ktx.exe" ]]; then export PATH="$p:$PATH"; TOOL="ktx"; break; fi
        if [[ -x "$p/toktx.exe" ]]; then export PATH="$p:$PATH"; TOOL="toktx"; break; fi
    done
fi

if [[ -z "$TOOL" ]]; then
    echo "ERROR: KTX-Software not found. Install from:"
    echo "  https://github.com/KhronosGroup/KTX-Software/releases"
    exit 1
fi
echo "Using encoder: $TOOL"

# Detect Python+Pillow availability (used to normalize non-PNG inputs).
HAS_PIL=0
if command -v python >/dev/null 2>&1; then
    if python -c "from PIL import Image" >/dev/null 2>&1; then HAS_PIL=1; fi
fi
echo "Pillow normalizer: $([[ $HAS_PIL == 1 ]] && echo available || echo MISSING)"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

OK=0; FAIL=0; SKIP=0
FAIL_LOG="$TMP_DIR/failures.log"
: > "$FAIL_LOG"

# ---------- helpers ----------
is_normal_map() {
    local b="$1"
    [[ "$b" == *normal* || "$b" == *_n.* || "$b" == *_nrm* ]]
}

# Echo "PNG" if magic bytes are PNG, "JPG" if JPEG, else "OTHER".
detect_format() {
    local f="$1"
    local hex
    hex="$(head -c 4 "$f" | od -A n -t x1 | tr -d ' \n')"
    case "$hex" in
        89504e47) echo "PNG" ;;
        ffd8ff*)  echo "JPG" ;;
        *)        echo "OTHER" ;;
    esac
}

# Normalize any image to a temp PNG. Returns path on stdout (empty on failure).
normalize_to_png() {
    local src="$1"
    local out="$TMP_DIR/$(basename "${src%.*}").png"
    python - "$src" "$out" <<'PY' 2>/dev/null
import sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src)
if im.mode not in ("RGB", "RGBA", "L"):
    im = im.convert("RGBA")
im.save(out, "PNG")
PY
    if [[ -f "$out" ]]; then echo "$out"; fi
}

convert_one() {
    local src="$1"
    local stem="${src%.*}"
    local dst="${stem}.ktx2"
    local base
    base="$(basename "$src")"

    if [[ -f "$dst" && "$FORCE" != "1" ]]; then
        echo "  skip (exists): $(basename "$dst")"
        ((SKIP++)) || true
        return 0
    fi

    local fmt input_for_ktx="$src"
    fmt="$(detect_format "$src")"

    # ktx create accepts PNG/EXR; toktx is more permissive (libjpeg+libpng).
    # For anything that isn't PNG/JPG, or for ktx with non-PNG input,
    # normalize to PNG first.
    local need_normalize=0
    if [[ "$fmt" == "OTHER" ]]; then
        need_normalize=1
    elif [[ "$TOOL" == "ktx" && "$fmt" != "PNG" ]]; then
        # ktx 4.4 supports JPG too, but is fragile (e.g. with EXIF/CMYK).
        # Normalize JPGs only when we know they will fail; here we assume
        # standard JPGs are fine and only normalize OTHER. Set FORCE_NORMALIZE_JPG=1
        # to always re-encode through Pillow.
        if [[ "${FORCE_NORMALIZE_JPG:-0}" == "1" ]]; then need_normalize=1; fi
    fi

    if [[ "$need_normalize" == "1" ]]; then
        if [[ "$HAS_PIL" != "1" ]]; then
            echo "  FAIL: $base — needs normalization but Pillow is not installed"
            echo "$src: needs Pillow" >> "$FAIL_LOG"
            ((FAIL++)) || true
            return 0
        fi
        local norm
        norm="$(normalize_to_png "$src")"
        if [[ -z "$norm" ]]; then
            echo "  FAIL: $base — Pillow could not read"
            echo "$src: Pillow read failed" >> "$FAIL_LOG"
            ((FAIL++)) || true
            return 0
        fi
        input_for_ktx="$norm"
    fi

    local mode="etc1s"
    if is_normal_map "$base"; then mode="uastc"; fi

    echo "  [$mode] $base$([[ $need_normalize == 1 ]] && echo ' (normalized)')"

    local rc=0
    case "$TOOL" in
        ktx)
            if [[ "$mode" == "uastc" ]]; then
                ktx create \
                    --encode uastc --uastc-quality 2 \
                    --zstd "$ZSTD_LEVEL" \
                    --assign-tf linear \
                    --format R8G8B8A8_UNORM \
                    --generate-mipmap \
                    "$input_for_ktx" "$dst" 2>>"$FAIL_LOG" || rc=$?
            else
                ktx create \
                    --encode basis-lz --clevel 4 --qlevel 192 \
                    --assign-tf srgb \
                    --format R8G8B8A8_SRGB \
                    --generate-mipmap \
                    "$input_for_ktx" "$dst" 2>>"$FAIL_LOG" || rc=$?
            fi
            ;;
        toktx)
            if [[ "$mode" == "uastc" ]]; then
                toktx --t2 \
                    --encode uastc --uastc_quality 2 \
                    --zcmp "$ZSTD_LEVEL" \
                    --assign_oetf linear \
                    --genmipmap \
                    "$dst" "$input_for_ktx" 2>>"$FAIL_LOG" || rc=$?
            else
                toktx --t2 \
                    --encode etc1s --clevel 4 --qlevel 192 \
                    --assign_oetf srgb \
                    --genmipmap \
                    "$dst" "$input_for_ktx" 2>>"$FAIL_LOG" || rc=$?
            fi
            ;;
    esac

    if [[ $rc -eq 0 && -f "$dst" ]]; then
        ((OK++)) || true
    else
        echo "  FAIL: $base (exit $rc)"
        echo "$src: encoder exit $rc" >> "$FAIL_LOG"
        ((FAIL++)) || true
    fi
}

# ---------- LOD ladder ----------
# Coarser copies of each texture, written to <scenario>/lods/ — deliberately
# OUTSIDE assets/, because build-package.mjs copies assets/ verbatim and variants
# inside the ZIP would make it bigger and nothing faster. That is the whole
# lesson of the dual-format archive: a ZIP has no addressability inside it, so
# the client takes everything and picks afterwards. The manifest can address
# them individually, so this is where they belong.
#
# Level numbering matches the engine's: 0 is the coarsest. The full-size encode
# beside the source stays the top level and is not re-encoded here.
lod_one() {
    local src="$1" size="$2" rel_dir="$3"
    local base stem out_dir dst
    base="$(basename "$src")"
    stem="${base%.*}"
    out_dir="$LOD_DIR/$rel_dir"
    dst="$out_dir/${stem}.${size}.ktx2"

    if [[ -f "$dst" && "$FORCE" != "1" ]]; then
        echo "  skip (exists): $rel_dir/${stem}.${size}.ktx2"
        ((SKIP++)) || true
        return 0
    fi

    mkdir -p "$out_dir"
    local resized="$TMP_DIR/${stem}.${size}.png"

    # Longest side becomes $size, aspect ratio preserved: planet maps are 2:1
    # equirectangular and squaring them would be a silent content change.
    # A source already at or below the target is skipped rather than upscaled.
    python - "$src" "$resized" "$size" <<'PY' 2>/dev/null
import sys
from PIL import Image
src, out, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert("RGB")
w, h = im.size
if max(w, h) <= size:
    raise SystemExit(3)
scale = size / max(w, h)
im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS).save(out, "PNG")
PY
    local rc=$?
    if [[ $rc -eq 3 ]]; then
        echo "  skip (source is already <= ${size}px): $base"
        ((SKIP++)) || true
        return 0
    fi
    if [[ $rc -ne 0 || ! -f "$resized" ]]; then
        echo "  FAIL: $base @${size} — resize failed"
        echo "$src @${size}: resize failed" >> "$FAIL_LOG"
        ((FAIL++)) || true
        return 0
    fi

    local mode="etc1s"
    if is_normal_map "$base"; then mode="uastc"; fi
    echo "  [$mode] ${stem}.${size}.ktx2"

    rc=0
    if [[ "$mode" == "uastc" ]]; then
        ktx create --encode uastc --uastc-quality 2 --zstd "$ZSTD_LEVEL" \
            --assign-tf linear --format R8G8B8A8_UNORM --generate-mipmap \
            "$resized" "$dst" 2>>"$FAIL_LOG" || rc=$?
    else
        ktx create --encode basis-lz --clevel 4 --qlevel 192 \
            --assign-tf srgb --format R8G8B8A8_SRGB --generate-mipmap \
            "$resized" "$dst" 2>>"$FAIL_LOG" || rc=$?
    fi

    if [[ $rc -eq 0 && -f "$dst" ]]; then ((OK++)) || true
    else
        echo "  FAIL: ${stem}.${size} (exit $rc)"
        echo "$src @${size}: encoder exit $rc" >> "$FAIL_LOG"
        ((FAIL++)) || true
    fi
}

process_lods() {
    local dir="$1" rel_dir="$2"
    [[ -z "$LOD_SIZES" ]] && return 0
    echo "==> lods for $dir → $LOD_DIR/$rel_dir"
    local f size
    for f in "$dir"/*.jpg "$dir"/*.jpeg "$dir"/*.png "$dir"/*.tif "$dir"/*.tiff "$dir"/*.bmp "$dir"/*.webp; do
        for size in ${LOD_SIZES//,/ }; do
            lod_one "$f" "$size" "$rel_dir"
        done
    done
}

# ---------- run ----------
shopt -s nullglob nocaseglob

process_dir() {
    local dir="$1"
    echo "==> $dir"
    local f
    for f in "$dir"/*.jpg "$dir"/*.jpeg "$dir"/*.png "$dir"/*.tif "$dir"/*.tiff "$dir"/*.bmp "$dir"/*.webp; do
        convert_one "$f"
    done
}

process_dir "$TEX_DIR"
[[ "$INCLUDE_SKYBOX" == "1" ]] && process_dir "$SKYBOX_DIR"

if [[ -n "$LOD_SIZES" ]]; then
    if [[ "$TOOL" != "ktx" ]]; then
        echo "WARNING: LOD_SIZES needs the 'ktx' CLI (KTX-Software 4.x); found '$TOOL'. Skipping the ladder."
    elif [[ "$HAS_PIL" != "1" ]]; then
        echo "WARNING: LOD_SIZES needs Pillow to resize. Install: pip install --user Pillow. Skipping the ladder."
    else
        process_lods "$TEX_DIR" "textures"
        [[ "$INCLUDE_SKYBOX" == "1" ]] && process_lods "$SKYBOX_DIR" "skybox"
    fi
fi

echo
echo "Summary: $OK ok, $FAIL failed, $SKIP skipped"
if [[ $FAIL -gt 0 ]]; then
    echo "Failures:"
    cat "$FAIL_LOG"
fi
echo
echo "KTX2 files in $TEX_DIR:"
du -h "$TEX_DIR"/*.ktx2 2>/dev/null | sort -k2
