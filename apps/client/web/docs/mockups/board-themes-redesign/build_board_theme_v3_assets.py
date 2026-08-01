"""Build normalized board-theme V3 runtime assets.

The surface comes from the untouched center of each 1024px scene master.  The
generated frame is chroma-keyed before this script runs; here it is converted
to the same 1024px canvas and the same transparent opening for every theme.
That common opening is what lets the browser swap artwork without changing the
board's box, grid, or hit areas.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[3] / "img" / "board-themes" / "v2"
THEMES = (
    "classic",
    "madera",
    "hielo",
    "lava",
    "cristal",
    "magico",
    "futurista",
    "dorado",
    "bosque",
    "cosmico",
    "jardin",
)
CANVAS = 1024
FRAME_RING = 48
ALPHA_THRESHOLD = 24


def nearest_opaque(values: list[int], start: int, step: int) -> int:
    index = start
    while 0 <= index < len(values):
        if values[index] > ALPHA_THRESHOLD:
            return index
        index += step
    raise RuntimeError("The generated frame is not a closed ring")


def normalize_frame(source: Path, destination: Path) -> tuple[int, int, int, int]:
    image = Image.open(source).convert("RGBA")
    alpha = image.getchannel("A")
    outer = alpha.getbbox()
    if outer is None:
        raise RuntimeError(f"No visible frame pixels in {source}")

    # Drop the transparent generation margin before the nine-slice transform.
    image = image.crop(outer)
    alpha = image.getchannel("A")
    width, height = image.size
    center_x, center_y = width // 2, height // 2
    row = [alpha.getpixel((x, center_y)) for x in range(width)]
    column = [alpha.getpixel((center_x, y)) for y in range(height)]

    left_rail = nearest_opaque(row, center_x, -1)
    right_rail = nearest_opaque(row, center_x, 1)
    top_rail = nearest_opaque(column, center_y, -1)
    bottom_rail = nearest_opaque(column, center_y, 1)
    inner = (left_rail + 1, top_rail + 1, right_rail, bottom_rail)

    source_x = (0, inner[0], inner[2], width)
    source_y = (0, inner[1], inner[3], height)
    target_x = (0, FRAME_RING, CANVAS - FRAME_RING, CANVAS)
    target_y = (0, FRAME_RING, CANVAS - FRAME_RING, CANVAS)
    output = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))

    for row_index in range(3):
        for column_index in range(3):
            if row_index == 1 and column_index == 1:
                continue
            source_box = (
                source_x[column_index],
                source_y[row_index],
                source_x[column_index + 1],
                source_y[row_index + 1],
            )
            target_box = (
                target_x[column_index],
                target_y[row_index],
                target_x[column_index + 1],
                target_y[row_index + 1],
            )
            patch = image.crop(source_box)
            target_size = (target_box[2] - target_box[0], target_box[3] - target_box[1])
            if patch.width and patch.height and target_size[0] and target_size[1]:
                patch = patch.resize(target_size, Image.Resampling.LANCZOS)
                output.alpha_composite(patch, (target_box[0], target_box[1]))

    # Guarantee a clean center.  Ornamentation can live in the ring, never over
    # the functional center of a cell.
    normalized_alpha = output.getchannel("A")
    alpha_draw = ImageDraw.Draw(normalized_alpha)
    alpha_draw.rounded_rectangle(
        (FRAME_RING, FRAME_RING, CANVAS - FRAME_RING - 1, CANVAS - FRAME_RING - 1),
        radius=42,
        fill=0,
    )
    output.putalpha(normalized_alpha)
    output.save(destination, optimize=True)
    return inner


def build_surface(scene: Path, board_destination: Path, cell_destination: Path) -> None:
    image = Image.open(scene).convert("RGB")
    width, height = image.size
    crop_size = min(width, height) // 2
    left = (width - crop_size) // 2
    top = (height - crop_size) // 2
    surface = image.crop((left, top, left + crop_size, top + crop_size))
    surface = surface.resize((CANVAS, CANVAS), Image.Resampling.LANCZOS)
    surface.save(board_destination, quality=94, optimize=True, progressive=True)
    surface.resize((256, 256), Image.Resampling.LANCZOS).save(
        cell_destination,
        quality=92,
        optimize=True,
        progressive=True,
    )


def main() -> None:
    for theme in THEMES:
        directory = ROOT / theme
        frame_source = directory / "frame-alpha-v3.png"
        if not frame_source.exists():
            raise FileNotFoundError(frame_source)
        inner = normalize_frame(frame_source, directory / "frame-v3.png")
        build_surface(
            directory / "scene.jpg",
            directory / "board-surface-v3.jpg",
            directory / "cell-surface-v3.jpg",
        )
        print(f"{theme:10s} frame source opening={inner}")


if __name__ == "__main__":
    main()
