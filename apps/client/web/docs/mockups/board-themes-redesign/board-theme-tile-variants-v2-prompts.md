# Tiles raster V2 — Clásico y Lava

Generación realizada con el modo integrado de `imagegen`. Cada resultado se
generó de forma independiente: ningún archivo runtime contiene un atlas ni más
de una tile.

## Contrato común

- Una sola tile cuadrada, ortográfica y `full-bleed` por imagen.
- La textura llega a los cuatro límites del canvas.
- Sin borde, aro, bisel, marco, contorno, padding ni transparencia authored.
- Sin icono, gema o texto incrustado: el glyph de gameplay se compone encima.
- Sin aspecto de botón, plástico o juguete.
- Centro suficientemente legible para la figura de juego.

## Clásico

Estilo compartido: espacio azul marino sobrio, de menor intensidad visual que
el tema Cósmico; negro azulado, cobalto profundo y estrellas cian-blancas
contenidas.

1. Starfield azul medianoche con estrellas dispersas y neblina estelar cian muy
   tenue.
2. Espacio cobalto-negro con una cinta diagonal sutil de polvo estelar azul.
3. Starfield casi negro con un pequeño cúmulo delicado y bruma fría.
4. Vacío zafiro oscuro con estrellas dispersas y halo azul radial apenas visible.

Restricciones negativas: sin nebulosa violeta brillante, planetas, grandes
estallidos, grid, panel, sheet de cuatro tiles ni atlas.

## Lava

Estilo compartido: basalto y obsidiana premium vistos desde arriba, con magma
rojo-naranja controlado y suficiente roca oscura para conservar el contraste del
glyph.

1. Basalto negro con una fisura orgánica de magma y centro rocoso oscuro.
2. Obsidiana agrietada con dos venas finas de magma ramificado.
3. Basalto estratificado con un pequeño bolsillo de magma y grietas capilares.
4. Roca volcánica mate con una costura fundida diagonal estrecha.

Restricciones negativas: sin roca aislada redondeada, perímetro decorativo,
botón, grid, sheet de cuatro tiles ni atlas.

## Postproceso determinista

El builder `build_board_theme_environment_v2_assets.py` centra, recorta a
cuadrado, reduce a 256 × 256 y exporta PNG RGB opaco. El radio y el clipping
pertenecen a la casilla real; nunca se rasterizan dentro de la imagen.
