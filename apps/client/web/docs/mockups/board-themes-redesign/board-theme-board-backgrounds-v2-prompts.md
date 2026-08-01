# Fondos interiores de tablero V2 — Clásico y Lava

Generación realizada con el modo integrado de `imagegen`. Son capas estáticas,
cuadradas y separadas del fondo de partida, el marco y las tiles.

## Contrato común

- Una única textura continua de fondo interior por tema.
- Sin grid, casillas, bordes, marco, iconos, texto ni transparencia.
- Composición ortográfica sin foco central: solo se ve detrás de las celdas y a
  través del gap real de la rejilla.
- Contraste intencional respecto a las cuatro tiles del tema.
- Sin animación; el runtime solo aplica una imagen `cover` estática.

## Clásico

Fondo espacial cobalto de brillo medio, estrellas dispersas y una nube estelar
cian-azul amplia y suave. Es deliberadamente más luminoso y calmado que las
tiles navy casi negras. Sin violeta, planetas ni espectáculo propio de Cósmico.

Prompt normalizado:

> Create exactly one square full-canvas static board underlay: a refined
> medium-dark cobalt deep-space field with sparse stars and a broad smooth
> cyan-blue stellar glow, deliberately lighter and calmer than the near-black
> navy tile textures. No grid, squares, tile outlines, board, frame, border,
> padding, transparency, icons, text, watermark, planets or purple spectacle.

## Lava

Fondo continuo de magma naranja-rojo con islas irregulares de basalto oscuro.
Es más luminoso y cálido que las tiles de basalto, de modo que el gap crea una
separación incandescente clara sin rasterizar ningún borde dentro de la tile.

Prompt normalizado:

> Create exactly one square full-canvas static board underlay: a continuous
> molten lava field with controlled orange-red glow and irregular charcoal
> basalt islands, clearly brighter and warmer than the dark basalt tile
> textures. No grid, squares, tile outlines, board, frame, border, padding,
> transparency, icons, text, watermark or dark empty center.

## Validación

El builder exporta `board-background-v2.webp` a 1024 × 1024 y registra en el
manifiesto la luminancia media. La separación mínima exigida entre el fondo y
cualquiera de sus cuatro tiles es 15 puntos; los assets aprobados alcanzan más
de 23 puntos en Clásico y más de 31 en Lava antes del overlay de legibilidad.
La auditoría del render compuesto —incluyendo overlay y slot vacío CSS— mantiene
15,46 puntos mínimos en Clásico y 16,96 en Lava.
