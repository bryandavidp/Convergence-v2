"""Refresh V4.1 visual-QA previews without a browser dependency.

The existing 390x844 captures supply the unchanged DOM board and UI.  This
script replaces only the exterior frame rectangle using the exact production
geometry and the freshly compiled square V4.1 layers.  It is intentionally a
review artifact; the HTML mockup remains the executable specification.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageStat


REPO = Path(__file__).resolve().parents[3]
ASSET_ROOT = REPO / "img" / "board-themes" / "v2"
OUTPUT_ROOT = Path(__file__).with_name("v4-layered")
SOURCE_CAPTURE_ROOT = Path(__file__).with_name("v3-framed")
CONTACT_PATH = Path(__file__).with_name("board-themes-v4-layered-contact-sheet.jpg")
CORNER_AUDIT_PATH = Path(__file__).with_name("board-themes-v41-corner-audit.png")

THEMES = (
    "classic", "madera", "hielo", "lava", "cristal", "magico",
    "futurista", "dorado", "bosque", "cosmico", "jardin",
)

BOARD_LEFT = 13
BOARD_TOP = 270
BOARD_SIZE = 364
FRAME_EXPAND = 13
FRAME_LEFT = BOARD_LEFT - FRAME_EXPAND
FRAME_TOP = BOARD_TOP - FRAME_EXPAND
FRAME_SIZE = BOARD_SIZE + FRAME_EXPAND * 2
JOINT = 4

CELL_RADII = {
    "classic": 9, "madera": 8, "hielo": 8, "lava": 8,
    "cristal": 7, "magico": 9, "futurista": 6, "dorado": 8,
    "bosque": 9, "cosmico": 9, "jardin": 10,
}

JOINT_COLOURS = {
    "classic": (4, 15, 43, 255), "madera": (38, 17, 7, 255),
    "hielo": (7, 43, 76, 255), "lava": (25, 6, 6, 255),
    "cristal": (29, 10, 61, 255), "magico": (17, 8, 47, 255),
    "futurista": (2, 20, 28, 255), "dorado": (52, 31, 3, 255),
    "bosque": (10, 31, 14, 255), "cosmico": (5, 6, 31, 255),
    "jardin": (23, 31, 25, 255),
}


def rounded_mask(size: int, radius: int) -> Image.Image:
    scale = 4
    mask = Image.new("L", (size * scale, size * scale), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size * scale - 1, size * scale - 1),
        radius=radius * scale,
        fill=255,
    )
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def refresh_capture(theme: str) -> Image.Image:
    path = OUTPUT_ROOT / f"{theme}-full.png"
    # Always start from the immutable V3 DOM capture so reruns cannot retain
    # an obsolete V4 decoration outside the current square frame canvas.
    capture = Image.open(SOURCE_CAPTURE_ROOT / f"{theme}-full.png").convert("RGBA")
    board = capture.crop((BOARD_LEFT, BOARD_TOP, BOARD_LEFT + BOARD_SIZE, BOARD_TOP + BOARD_SIZE))

    sample = capture.crop((170, 244, 220, 256)).convert("RGB")
    backdrop = tuple(round(value) for value in ImageStat.Stat(sample).mean) + (255,)
    ImageDraw.Draw(capture).rectangle(
        (FRAME_LEFT, FRAME_TOP, FRAME_LEFT + FRAME_SIZE, FRAME_TOP + FRAME_SIZE),
        fill=backdrop,
    )

    frame = Image.open(ASSET_ROOT / theme / "frame-base-v4.png").convert("RGBA")
    decor = Image.open(ASSET_ROOT / theme / "decor-v4.png").convert("RGBA")
    frame = frame.resize((FRAME_SIZE, FRAME_SIZE), Image.Resampling.LANCZOS)
    decor = decor.resize((FRAME_SIZE, FRAME_SIZE), Image.Resampling.LANCZOS)
    capture.alpha_composite(frame, (FRAME_LEFT, FRAME_TOP))
    capture.alpha_composite(decor, (FRAME_LEFT, FRAME_TOP))

    joint_draw = ImageDraw.Draw(capture)
    joint_draw.rounded_rectangle(
        (
            BOARD_LEFT - JOINT, BOARD_TOP - JOINT,
            BOARD_LEFT + BOARD_SIZE + JOINT - 1,
            BOARD_TOP + BOARD_SIZE + JOINT - 1,
        ),
        radius=CELL_RADII[theme] + JOINT,
        fill=JOINT_COLOURS[theme],
    )
    capture.paste(board, (BOARD_LEFT, BOARD_TOP), rounded_mask(BOARD_SIZE, CELL_RADII[theme]))
    capture.save(path, optimize=True)
    return capture


def build_contact(captures: dict[str, Image.Image]) -> None:
    column_width = 256
    row_height = 312
    contact = Image.new("RGB", (column_width * 4, row_height * 3), (3, 8, 19))
    draw = ImageDraw.Draw(contact)
    for index, theme in enumerate(THEMES):
        column = index % 4
        row = index // 4
        left = column * column_width
        top = row * row_height
        draw.text((left + 6, top + 5), theme, fill=(238, 244, 255))
        crop = captures[theme].crop((0, 220, 390, 690)).convert("RGB")
        crop.thumbnail((250, 286), Image.Resampling.LANCZOS)
        contact.paste(crop, (left + 3, top + 23))
    contact.save(CONTACT_PATH, quality=93, optimize=True)


def build_corner_audit(captures: dict[str, Image.Image]) -> None:
    label_width = 104
    corner_size = 126
    row_height = 132
    audit = Image.new(
        "RGB",
        (label_width + corner_size * 4, row_height * len(THEMES)),
        (3, 8, 19),
    )
    draw = ImageDraw.Draw(audit)
    boxes = (
        (0, FRAME_TOP, 70, FRAME_TOP + 70),
        (320, FRAME_TOP, 390, FRAME_TOP + 70),
        (0, FRAME_TOP + 320, 70, FRAME_TOP + 390),
        (320, FRAME_TOP + 320, 390, FRAME_TOP + 390),
    )
    for row, theme in enumerate(THEMES):
        top = row * row_height
        draw.text((8, top + 54), theme, fill=(238, 244, 255))
        for column, box in enumerate(boxes):
            corner = captures[theme].crop(box).convert("RGB")
            corner = corner.resize((corner_size, corner_size), Image.Resampling.NEAREST)
            audit.paste(corner, (label_width + column * corner_size, top + 3))
    audit.save(CORNER_AUDIT_PATH, optimize=True)


def main() -> None:
    captures = {theme: refresh_capture(theme) for theme in THEMES}
    build_contact(captures)
    build_corner_audit(captures)
    print(CONTACT_PATH)
    print(CORNER_AUDIT_PATH)


if __name__ == "__main__":
    main()
