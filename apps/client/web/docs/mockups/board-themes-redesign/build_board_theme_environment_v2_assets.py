#!/usr/bin/env python3
"""Build the V2 environment, board background and tile variants for Classic/Lava.

The image model produces one background master and four independent square tile
masters per ready theme. This builder only performs deterministic crops,
downsampling, compression and manifest generation. Runtime never consumes an
atlas: one standalone image is selected per occupied board cell.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageOps, ImageStat


SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[2]
ASSET_ROOT = ROOT / "img" / "board-themes" / "v2"
MANIFEST_PATH = SCRIPT_DIR / "board-theme-environment-v2-manifest.json"

BACKGROUND_SIZE = (780, 1688)  # exact 2x of the 390 x 844 reference viewport
BOARD_BACKGROUND_SIZE = (1024, 1024)
TILE_SIZE = (256, 256)
TILE_VARIANT_COUNT = 4
READY_THEMES = ("classic", "lava")
ALL_THEMES = (
    "classic", "madera", "hielo", "lava", "cristal", "magico",
    "futurista", "dorado", "bosque", "cosmico", "jardin",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fit_portrait(master: Path, output: Path) -> None:
    with Image.open(master) as opened:
        image = opened.convert("RGB")
    source_ratio = image.width / image.height
    target_ratio = BACKGROUND_SIZE[0] / BACKGROUND_SIZE[1]
    if source_ratio > target_ratio:
        width = round(image.height * target_ratio)
        left = (image.width - width) // 2
        image = image.crop((left, 0, left + width, image.height))
    else:
        height = round(image.width / target_ratio)
        top = (image.height - height) // 2
        image = image.crop((0, top, image.width, top + height))
    image = image.resize(BACKGROUND_SIZE, Image.Resampling.LANCZOS)
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, "WEBP", quality=92, method=6)


def build_tile(master: Path, output: Path) -> None:
    """Export one opaque full-bleed tile; clipping belongs to the board cell."""
    with Image.open(master) as opened:
        image = opened.convert("RGB")
    image = ImageOps.fit(image, TILE_SIZE, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, "PNG", optimize=True)


def build_board_background(master: Path, output: Path) -> None:
    """Export the static square layer visible behind cells and through grid gaps."""
    with Image.open(master) as opened:
        image = opened.convert("RGB")
    image = ImageOps.fit(image, BOARD_BACKGROUND_SIZE, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, "WEBP", quality=92, method=6)


def alpha_stats(path: Path) -> dict[str, int]:
    with Image.open(path) as opened:
        alpha = opened.convert("RGBA").getchannel("A")
    histogram = alpha.histogram()
    return {
        "transparent": histogram[0],
        "partial": sum(histogram[1:255]),
        "opaque": histogram[255],
    }


def mean_luminance(path: Path) -> float:
    with Image.open(path) as opened:
        mean = ImageStat.Stat(opened.convert("RGB")).mean
    return round(mean[0] * 0.2126 + mean[1] * 0.7152 + mean[2] * 0.0722, 2)


def tile_asset(path: Path, variant: int) -> dict[str, object]:
    return {
        "file": path.relative_to(ROOT).as_posix(),
        "size": list(TILE_SIZE),
        "variant": variant,
        "sha256": sha256(path),
        "alpha": alpha_stats(path),
        "runtime": True,
        "fullBleed": True,
        "authoredBorder": False,
        "meanLuminance": mean_luminance(path),
    }


def build_manifest(sources: dict[str, dict[str, object]]) -> None:
    themes: dict[str, dict[str, object]] = {}
    for theme in ALL_THEMES:
        if theme not in READY_THEMES:
            themes[theme] = {"status": "fallback-css", "assets": {}}
            continue

        folder = ASSET_ROOT / theme
        background = folder / "game-background-v1.webp"
        board_background = folder / "board-background-v2.webp"
        variants = [folder / f"tile-variant-{index}-v2.png" for index in range(1, TILE_VARIANT_COUNT + 1)]
        tile_sources = sources[theme]["tiles"]
        themes[theme] = {
            "status": "ready-v2",
            "assets": {
                "gameBackground": {
                    "file": background.relative_to(ROOT).as_posix(),
                    "size": list(BACKGROUND_SIZE),
                    "sha256": sha256(background),
                },
                "boardBackground": {
                    "file": board_background.relative_to(ROOT).as_posix(),
                    "size": list(BOARD_BACKGROUND_SIZE),
                    "sha256": sha256(board_background),
                    "runtime": True,
                    "animated": False,
                    "meanLuminance": mean_luminance(board_background),
                },
                "tileVariants": [tile_asset(path, index) for index, path in enumerate(variants, 1)],
            },
            "contrastProfile": {
                "boardMeanLuminance": mean_luminance(board_background),
                "tileMeanLuminance": [mean_luminance(path) for path in variants],
                "minimumAbsoluteSeparation": round(min(abs(mean_luminance(board_background) - mean_luminance(path)) for path in variants), 2),
            },
            "source": {
                "backgroundSha256": sha256(sources[theme]["background"]),
                "boardBackgroundSha256": sha256(sources[theme]["board_background"]),
                "tileSourceSha256": [sha256(path) for path in tile_sources],
                "backgroundPromptSpec": "board-theme-environment-v1-prompts.md",
                "boardBackgroundPromptSpec": "board-theme-board-backgrounds-v2-prompts.md",
                "tilePromptSpec": "board-theme-tile-variants-v2-prompts.md",
            },
        }

    manifest = {
        "version": "2.0",
        "system": "board-theme-environment-and-independent-tile-variants-contract",
        "generationMode": "built-in-imagegen-plus-deterministic-postprocess",
        "referenceViewport": [390, 844],
        "runtimeBackgroundSize": list(BACKGROUND_SIZE),
        "runtimeBoardBackgroundSize": list(BOARD_BACKGROUND_SIZE),
        "runtimeTileSize": list(TILE_SIZE),
        "runtimeTileVariantCount": TILE_VARIANT_COUNT,
        "rules": {
            "visualOnly": True,
            "noBoardGeometryChanges": True,
            "noGameplayChanges": True,
            "missingAssetFallback": "existing theme CSS",
            "loadPolicy": "equipped theme only",
            "runtimeAtlasForbidden": True,
            "filledCellsOnly": True,
            "emptyCellsHaveNoTileArt": True,
            "tileArtworkOwnsFullCell": True,
            "tileArtworkHasNoAuthoredBorder": True,
            "boardBackgroundStatic": True,
            "boardBackgroundBehindCellsOnly": True,
            "minimumBoardTileLuminanceSeparation": 15,
        },
        "themes": themes,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--classic-background", type=Path, required=True)
    parser.add_argument("--lava-background", type=Path, required=True)
    parser.add_argument("--classic-board-background", type=Path, required=True)
    parser.add_argument("--lava-board-background", type=Path, required=True)
    parser.add_argument("--classic-tiles", type=Path, nargs=TILE_VARIANT_COUNT, required=True)
    parser.add_argument("--lava-tiles", type=Path, nargs=TILE_VARIANT_COUNT, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    sources: dict[str, dict[str, object]] = {
        "classic": {"background": args.classic_background, "board_background": args.classic_board_background, "tiles": args.classic_tiles},
        "lava": {"background": args.lava_background, "board_background": args.lava_board_background, "tiles": args.lava_tiles},
    }
    for theme in READY_THEMES:
        folder = ASSET_ROOT / theme
        fit_portrait(sources[theme]["background"], folder / "game-background-v1.webp")
        build_board_background(sources[theme]["board_background"], folder / "board-background-v2.webp")
        for index, master in enumerate(sources[theme]["tiles"], 1):
            build_tile(master, folder / f"tile-variant-{index}-v2.png")
    build_manifest(sources)


if __name__ == "__main__":
    main()
