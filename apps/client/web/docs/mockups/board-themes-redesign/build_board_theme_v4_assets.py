"""Compile faithful V4.1 board rails and independent ornaments.

The V3 RGBA frames are the approved visual authority.  This compiler never
redraws their materials: it assigns authored pixels to either the structural
rail or the decoration layer, compresses only the rail thickness, and fills
removed rail pixels from the nearest surviving pixel of the same V3 material.
Decorations keep their original square canvas and are never stretched by axis.
"""

from __future__ import annotations

from collections import deque
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, __version__ as PILLOW_VERSION


REPO = Path(__file__).resolve().parents[3]
ASSET_ROOT = REPO / "img" / "board-themes" / "v2"
MANIFEST_PATH = Path(__file__).with_name("board-theme-v4-manifest.json")

CANVAS = 1024
SOURCE_RING = 48
TARGET_RING = 24
SOURCE_INNER_RADIUS = 42
SOURCE_OUTER_RADIUS = SOURCE_INNER_RADIUS + SOURCE_RING
AA = 4

# CSS reference geometry at the immutable 390px mockup.  The PNG alpha radius
# is compiled per theme so its raster curve agrees with the themed tile radius
# after the square asset is scaled to the real exterior frame box.
REFERENCE_BOARD_SIZE = 364.19
REFERENCE_JOINT = 3.8
REFERENCE_FRAME_THICKNESS = 9.0
REFERENCE_FRAME_SIZE = REFERENCE_BOARD_SIZE + 2 * (REFERENCE_JOINT + REFERENCE_FRAME_THICKNESS)
SOURCE_PIXELS_PER_CSS_PIXEL = CANVAS / REFERENCE_FRAME_SIZE

CELL_RADII = {
    "classic": 9, "madera": 8, "hielo": 8, "lava": 8,
    "cristal": 7, "magico": 9, "futurista": 6, "dorado": 8,
    "bosque": 9, "cosmico": 9, "jardin": 10,
}

THEMES = {
    "classic": "structural-enamel",
    "madera": "wood-rail-and-corner-foliage",
    "hielo": "ice-rail-and-corner-crystals",
    "lava": "structural-basalt",
    "cristal": "crystal-rail-and-exterior-spikes",
    "magico": "arcane-rail-and-cardinal-finials",
    "futurista": "structural-chassis",
    "dorado": "structural-gold-moulding",
    "bosque": "structural-moss-blocks",
    "cosmico": "portal-rail-and-planets",
    "jardin": "authored-garden-frame",
}

# Regions that are semantically ornaments even where they cross the nominal
# rail.  Moving the whole authored patch preserves its original antialiasing,
# highlights and proportions.  The structural hole is rebuilt from adjacent
# pixels of the same theme, never from a generated palette.
DECOR_ZONES = {
    "madera": (
        (0, 0, 118, 118), (906, 0, 1024, 118),
        (0, 906, 118, 1024), (906, 906, 1024, 1024),
    ),
    "hielo": (
        (0, 0, 112, 192), (912, 0, 1024, 192),
        (0, 832, 112, 1024), (912, 832, 1024, 1024),
    ),
    "cristal": (
        (0, 0, 88, 286), (936, 0, 1024, 286),
        (0, 738, 92, 1024), (932, 738, 1024, 1024),
    ),
    "magico": (
        (414, 0, 610, 90), (414, 934, 610, 1024),
        (0, 386, 92, 638), (932, 386, 1024, 638),
    ),
    "cosmico": (
        (0, 0, 112, 196), (912, 0, 1024, 196),
        (922, 300, 1024, 642), (0, 674, 126, 944),
        (918, 790, 1024, 1024),
    ),
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rounded_ring_mask(ring: int, inner_radius: int, outer_radius: int, antialias: bool) -> Image.Image:
    scale = AA if antialias else 1
    size = CANVAS * scale
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (0, 0, size - 1, size - 1),
        radius=outer_radius * scale,
        fill=255,
    )
    inset = ring * scale
    draw.rounded_rectangle(
        (inset, inset, size - inset - 1, size - inset - 1),
        radius=inner_radius * scale,
        fill=0,
    )
    if antialias:
        return mask.resize((CANVAS, CANVAS), Image.Resampling.LANCZOS)
    return mask


def zone_mask(theme: str) -> Image.Image:
    mask = Image.new("L", (CANVAS, CANVAS), 0)
    draw = ImageDraw.Draw(mask)
    for box in DECOR_ZONES.get(theme, ()):
        draw.rectangle(box, fill=255)
    return mask


def target_radii(theme: str) -> tuple[int, int]:
    inner = round((CELL_RADII[theme] + REFERENCE_JOINT) * SOURCE_PIXELS_PER_CSS_PIXEL)
    return inner, inner + TARGET_RING


def split_authored_pixels(theme: str, source: Image.Image) -> tuple[Image.Image, Image.Image, Image.Image]:
    alpha = source.getchannel("A")
    structural_geometry = rounded_ring_mask(
        SOURCE_RING,
        SOURCE_INNER_RADIUS,
        SOURCE_OUTER_RADIUS,
        antialias=False,
    )
    semantic_decor = zone_mask(theme)
    structural_selector = ImageChops.subtract(structural_geometry, semantic_decor)
    structural_alpha = ImageChops.multiply(alpha, structural_selector)
    decor_alpha = ImageChops.subtract(alpha, structural_alpha)

    # Every authored alpha value belongs wholly to exactly one layer.
    recomposed_alpha = ImageChops.add(structural_alpha, decor_alpha)
    if ImageChops.difference(alpha, recomposed_alpha).getbbox() is not None:
        raise RuntimeError(f"{theme}: source alpha was not partitioned exactly")

    structural = source.copy()
    structural.putalpha(structural_alpha)
    decor = source.copy()
    decor.putalpha(decor_alpha)
    return structural, decor, semantic_decor


def compress_structural_ring(source: Image.Image) -> Image.Image:
    source_axis = (0, SOURCE_RING, CANVAS - SOURCE_RING, CANVAS)
    target_axis = (0, TARGET_RING, CANVAS - TARGET_RING, CANVAS)
    output = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    for row in range(3):
        for column in range(3):
            if row == 1 and column == 1:
                continue
            source_box = (
                source_axis[column], source_axis[row],
                source_axis[column + 1], source_axis[row + 1],
            )
            target_box = (
                target_axis[column], target_axis[row],
                target_axis[column + 1], target_axis[row + 1],
            )
            patch = source.crop(source_box)
            target_size = (target_box[2] - target_box[0], target_box[3] - target_box[1])
            if patch.width and patch.height:
                patch = patch.resize(target_size, Image.Resampling.LANCZOS)
                output.alpha_composite(patch, (target_box[0], target_box[1]))
    return output


def fill_from_nearest_authored_pixel(image: Image.Image, mask: Image.Image) -> Image.Image:
    """Fill structural holes with the nearest surviving authored material.

    This is a multi-source propagation constrained to the 24px target rail.
    It changes no valid source pixel and avoids invented gradients or motifs.
    """
    rgba = image.copy()
    pixels = rgba.load()
    mask_pixels = mask.load()
    visited = bytearray(CANVAS * CANVAS)
    queue: deque[tuple[int, int]] = deque()

    for y in range(CANVAS):
        row = y * CANVAS
        for x in range(CANVAS):
            if mask_pixels[x, y] and pixels[x, y][3] > 8:
                visited[row + x] = 1
                queue.append((x, y))

    if not queue:
        raise RuntimeError("Structural frame contains no authored pixels")

    while queue:
        x, y = queue.popleft()
        colour = pixels[x, y]
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if not (0 <= nx < CANVAS and 0 <= ny < CANVAS):
                continue
            index = ny * CANVAS + nx
            if visited[index] or not mask_pixels[nx, ny]:
                continue
            visited[index] = 1
            pixels[nx, ny] = colour
            queue.append((nx, ny))

    # Use the antialiased target geometry only after RGB propagation so the
    # inner and outer silhouettes are clean and share one authored material.
    rgba.putalpha(mask)
    return rgba


def build_theme(theme: str) -> tuple[Image.Image, Image.Image, dict[str, object]]:
    source_path = ASSET_ROOT / theme / "frame-v3.png"
    source = Image.open(source_path).convert("RGBA")
    if source.size != (CANVAS, CANVAS):
        raise RuntimeError(f"{source_path} must be {CANVAS}x{CANVAS}")

    structural, decor, semantic_mask = split_authored_pixels(theme, source)
    compressed = compress_structural_ring(structural)
    target_inner_radius, target_outer_radius = target_radii(theme)
    target_mask = rounded_ring_mask(
        TARGET_RING,
        target_inner_radius,
        target_outer_radius,
        antialias=True,
    )
    frame = fill_from_nearest_authored_pixel(compressed, target_mask)

    # A sub-pixel-only blur on the alpha edge removes JPEG-era chroma specks;
    # RGB and authored shapes stay untouched.
    decor_alpha = decor.getchannel("A")
    decor.putalpha(decor_alpha.filter(ImageFilter.GaussianBlur(0.18)))

    metadata = {
        "classification": THEMES[theme],
        "hasDecor": decor.getchannel("A").getbbox() is not None,
        "sourceV3Sha256": sha256(source_path),
        "sourceRing": SOURCE_RING,
        "targetRing": TARGET_RING,
        "cellRadiusCss": CELL_RADII[theme],
        "assetInnerRadius": target_inner_radius,
        "assetOuterRadius": target_outer_radius,
        "semanticZones": list(DECOR_ZONES.get(theme, ())),
        "semanticMaskBounds": semantic_mask.getbbox(),
        "decorAlphaBounds": decor.getchannel("A").getbbox(),
        "separation": "whole-authored-pixel",
        "decorTransform": "identity-square-no-axis-stretch",
    }
    return frame, decor, metadata


def main() -> None:
    manifest: dict[str, object] = {
        "version": "4.1",
        "generator": {
            "script": Path(__file__).name,
            "pillow": PILLOW_VERSION,
            "method": "faithful V3 pixel partition; no procedural redrawing",
        },
        "geometry": {
            "frameCanvas": [CANVAS, CANVAS],
            "decorCanvas": [CANVAS, CANVAS],
            "sourceRing": SOURCE_RING,
            "frameRing": TARGET_RING,
            "referenceBoardCssPixels": REFERENCE_BOARD_SIZE,
            "referenceJointCssPixels": REFERENCE_JOINT,
            "referenceFrameCssPixels": REFERENCE_FRAME_SIZE,
            "innerRadiusByTheme": {
                theme: target_radii(theme)[0] for theme in THEMES
            },
            "outerRadiusByTheme": {
                theme: target_radii(theme)[1] for theme in THEMES
            },
        },
        "themes": {},
    }

    for theme in THEMES:
        directory = ASSET_ROOT / theme
        frame_path = directory / "frame-base-v4.png"
        decor_path = directory / "decor-v4.png"
        frame, decor, metadata = build_theme(theme)
        frame.save(frame_path, optimize=True)
        decor.save(decor_path, optimize=True)
        metadata["frameBaseV4Sha256"] = sha256(frame_path)
        metadata["decorV4Sha256"] = sha256(decor_path)
        manifest["themes"][theme] = metadata
        print(
            f"{theme:10s} {metadata['classification']:38s} "
            f"decor={metadata['decorAlphaBounds']}"
        )

    MANIFEST_PATH.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(MANIFEST_PATH)


if __name__ == "__main__":
    main()
