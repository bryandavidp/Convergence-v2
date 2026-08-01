# Prompts de assets ambientales y tiles V1

> Histórico: los prompts de tiles de este documento fueron sustituidos por las
> ocho tiles full-bleed V2 de `board-theme-tile-variants-v2-prompts.md`. Los
> prompts de fondo de juego Clásico y Lava continúan vigentes.

Generación realizada con el modo integrado de `imagegen`. La captura adjunta se usó como referencia de dirección artística; `img/board-themes/v2/lava/scene.jpg` se añadió como segunda referencia únicamente en Lava.

## Clásico · fondo de juego

```text
Use case: stylized-concept
Asset type: portrait mobile game background
Primary request: create the environmental background for the purchasable "Classic Board" in Convergence. It must feel like the restrained, entry-level space theme that surrounds the game UI.
Input images: Image 1 is the approved board-catalog style reference; use only its polished painted mobile-game rendering language and cobalt/cyan visual family. Do not copy its forest scenery or any text.
Scene/backdrop: deep navy outer space with a very subtle cobalt nebula haze, sparse small stars, a few soft cyan points of light, and calm negative space through the center for HUD and an 8x8 board.
Subject: environment only; no board, no frame, no grid, no tiles, no icons, no UI.
Style/medium: premium stylized mobile-game environment painting, clean Supercell-like material polish, softly dimensional, not photorealistic.
Composition/framing: portrait 9:16; brightest accents kept near the outer edges and upper corners; center and lower-center remain dark and quiet so white UI and a blue board stay readable at phone size.
Lighting/mood: welcoming, adventurous, quiet starfield; restrained glow; clearly simpler and less spectacular than a future Cosmic premium theme.
Color palette: near-black navy, midnight blue, restrained cobalt, small cyan-white stars.
Constraints: no forest, no trees, no plants, no rocks, no planets, no galaxies, no astronaut, no board, no frame, no grid, no tiles, no text, no logo, no watermark; seamless-feeling full-screen backdrop; keep contrast low behind the gameplay area.
Avoid: vivid purple cosmic spectacle, large celestial objects, dense star clusters, lens flares, busy center, photoreal astronomy.
```

## Lava · fondo de juego

```text
Use case: stylized-concept
Asset type: portrait mobile game background
Primary request: create the environmental background for the purchasable "Lava Board" in Convergence, matching the approved catalog art.
Input images: Image 1 is the approved catalog reference and Image 2 is the current Lava scene master; use their painted mobile-game style, basalt material, ember lighting, and red-orange magma palette. They are style/environment references only. Remove every board-shaped object.
Scene/backdrop: a deep volcanic cavern made of black basalt and dark burgundy rock, with natural magma fissures and sparse embers concentrated near the outer edges; quiet dark open cavern through the center for gameplay UI.
Subject: environment only; no board, no frame, no rectangular opening, no grid, no tiles, no icons, no UI.
Style/medium: premium stylized mobile-game environment painting, dimensional hand-painted material polish, dramatic but readable, not photorealistic.
Composition/framing: portrait 9:16; rock silhouettes and modest lava glow form an irregular edge vignette, never a rectangular frame; the center from top HUD through the 8x8 board footprint stays dark and low-detail; strongest glow at far lower edges and a few side fissures.
Lighting/mood: dangerous volcanic heat, deep black-red shadows, controlled orange emission, subtle drifting embers.
Color palette: charcoal black, basalt gray, oxblood and burgundy, restrained ember red, localized molten orange.
Materials/textures: fractured basalt, cooled lava crust, natural rock facets; no smooth metal.
Constraints: no board, no frame, no square or rounded-rectangle border, no central platform, no grid, no tiles, no icons, no text, no logo, no watermark; preserve broad negative space behind gameplay; full-screen portrait background.
Avoid: wall of fire, bright center, yellow wash, symmetrical frame, repeated tile pattern, sci-fi machinery, photoreal cave photo.
```

## Clásico · tile aislada

```text
Use case: stylized-concept
Asset type: isolated mobile puzzle-game tile asset, EMPTY state
Primary request: create one single Classic Board tile, faithfully matching the glossy cobalt-blue rounded tiles in the approved catalog reference.
Input images: Image 1 is the approved visual reference. Reproduce the Classic tile's cobalt enamel material, compact rounded-square proportions, cyan-blue rim light, and polished hand-painted mobile-game finish; do not include the surrounding board.
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for local background removal.
Subject: exactly one front-facing rounded-square tile, centered, nearly filling the canvas with generous even padding; no icon or glyph.
Style/medium: premium stylized mobile-game UI asset, softly dimensional painted enamel, crisp at small size.
Composition/framing: orthographic front view, square 1:1 canvas, tile edges parallel to canvas, symmetrical rounded square, no perspective.
Lighting/mood: cool cyan highlight along top and left, deep navy bevel along bottom and right, subtle glossy highlight near upper third.
Color palette: cobalt #0641B1 and #0B55C4, deep navy #010C43, cyan highlight #35C7FF; do not use green in the subject.
Materials/textures: smooth blue enamel with very fine non-busy material grain, clean beveled rim, substantial tile body.
Constraints: background must be one perfectly uniform #00ff00 with no shadow, gradient, texture, reflection, or floor plane; crisp silhouette; no cast shadow; no contact shadow; no glow outside the tile; no icon, no symbol, no text, no logo, no watermark; do not use #00ff00 anywhere in the tile.
Avoid: glass transparency, plastic toy look, exaggerated pillow shape, multiple tiles, board frame, starfield, cracks, green hues.
```

## Lava · tile aislada

```text
Use case: stylized-concept
Asset type: isolated mobile puzzle-game tile asset
Primary request: create one single Lava Board tile faithfully matching the dark basalt tiles in the approved catalog reference.
Input images: Image 1 is the approved catalog reference and Image 2 is the current Lava scene master. Reproduce the reference tile's compact rounded-square basalt slab, dark cooled crust, restrained red-orange magma fissures, and premium hand-painted mobile-game material; exclude the surrounding frame and cave.
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for local background removal.
Subject: exactly one front-facing rounded-square basalt tile, centered and nearly filling the square canvas with even padding; no icon or glyph. Include only two or three fine, irregular, edge-connected magma hairline cracks, leaving the broad center dark and quiet for a game icon.
Style/medium: premium stylized mobile-game UI asset, painterly but crisp, dimensional rock material, readable at 40px.
Composition/framing: orthographic front view, square 1:1 canvas, tile edges parallel to canvas, gently irregular rounded corners but stable square silhouette, no perspective.
Lighting/mood: charcoal slab with subtle warm rim from magma beneath; localized ember-orange inside only the thinnest cracks; no full glowing outline.
Color palette: basalt #1B0B10, #2B181C, #201014, bevel #57302F, restrained red #702C20, tiny molten orange #FF671B; do not use green in the subject.
Materials/textures: cooled volcanic basalt, fine rock pores, small chips, dark bevel; central area remains low-detail and low-luminance.
Constraints: background must be perfectly uniform #00ff00 with no shadow, gradient, texture, reflection, or floor plane; crisp silhouette; no cast shadow, no contact shadow, no glow outside the tile; no icon, no text, no logo, no watermark; do not use #00ff00 in the tile.
Avoid: complete orange neon border, lava pool, flames, bright center, multiple tiles, board frame, rectangular scene, sci-fi metal, oversaturated yellow.
```
