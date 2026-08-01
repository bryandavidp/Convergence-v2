# Board Themes V4 — marco estructural y decoración independientes

Pack visual generado para el mockup interactivo del sistema de temas de tablero. V4 separa explícitamente superficie, acabado de celda, rail estructural y ornamentos para que ningún planeta, cristal, hoja o módulo quede comprimido dentro del marco.

## Alcance

- 11 identidades: `classic`, `madera`, `hielo`, `lava`, `cristal`, `magico`, `futurista`, `dorado`, `bosque`, `cosmico` y `jardin`.
- 44 archivos activos de runtime: cuatro por identidad.
- La referencia visual fue `Foto 1.jpg`, aportada por el usuario.
- Las propiedades especiales escritas en la referencia no se trasladan al juego.
- Ningún asset incluye piezas, símbolos jugables, texto, precios ni una cuadrícula horneada.
- El mockup arranca con 32 figuras DOM sobre 64 casillas para comparar la legibilidad de todos los temas.

## Archivos por tema

```text
<tema>/
  scene.jpg                1024 x 1024  master visual V2 con entorno y marco
  board-surface-v3.jpg     1024 x 1024  superficie continua V3 sin adornos
  cell-surface-v3.jpg       256 x 256  respaldo ligero del mismo material
  frame-v3.png             1024 x 1024  marco V3 RGBA con centro transparente
  frame-base-v4.png        1024 x 1024  rail estructural V4, anillo de 24 px
  decor-v4.png             1024 x 1088  ornamentos V4 separados y con alfa

  scene-clean.jpg          1024 x 1024  superficie legacy V2.1
  cell-surface.jpg          256 x 256  textura legacy V2
  preview.jpg               256 x 256  miniatura legacy V2
```

`board-surface-v3.jpg` se pinta en la superficie real del tablero. Cada celda reutiliza coordenadas del mismo master con una capa translúcida, por lo que la textura avanza de forma continua y no parece repetida 64 veces. `frame-base-v4.png` contiene únicamente material estructural; `decor-v4.png` contiene las figuras temáticas en otra capa. `scene.jpg`, `frame-v3.png` y los archivos V2 permanecen como historial compatible.

Revisión V4: el tablero, la junta y el marco derivan sus radios de `--board-radius`. A 390 px son respectivamente 13, 16 y 25 px; la diferencia radial coincide exactamente con la junta de 3 px y el rail de 9 px. Una máscara perfora de verdad el centro del rail. La decoración usa un canvas independiente de 1024×1088 con reserva vertical exterior y se coloca detrás del tablero, sin entrar en las tiles ni alterar hitboxes.

## Método de generación V4

- Compilación local determinista con Pillow mediante [`build_board_theme_v4_assets.py`](../../../docs/mockups/board-themes-redesign/build_board_theme_v4_assets.py).
- Fuente cromática: los `frame-v3.png` autoritativos, suavizados para conservar material sin conservar figuras incrustadas.
- Geometría del rail: 1024×1024, anillo 24 px, radio exterior 66 px y radio interior 42 px.
- Decoración: 1024×1088 RGBA, con el cuadrado de referencia del marco entre y=32 e y=1056.
- Manifiesto: checksums, clasificación y bounds alfa en `board-theme-v4-manifest.json`.
- Nueve temas usan decoración separada; Clásico y Lava cargan un overlay transparente.

### Origen visual V3

- Modo: herramienta integrada `image_gen` más postproceso local determinista.
- Tipo: `stylized-concept`, marco exterior de interfaz para videojuego.
- Referencia por marco: el `scene.jpg` del mismo tema.
- Generación: marco aislado sobre croma plano `#ff00ff` o `#00ff00`.
- Extracción: `remove_chroma_key.py` con soft matte y despill.
- Normalización: nine-slice a 1024×1024 con una apertura común y limpia; script [`build_board_theme_v3_assets.py`](../../../docs/mockups/board-themes-redesign/build_board_theme_v3_assets.py).
- Superficie: recorte central libre de adornos del master, ampliado con Lanczos y comprimido como JPEG de alta calidad.
- Runtime V4: carga `board-surface-v3.jpg`, `cell-surface-v3.jpg`, `frame-base-v4.png` y `decor-v4.png`.

## Prompt común

> Use case: stylized-concept. Asset type: production game board exterior frame asset. Input image: authoritative visual reference for the current theme. Create one isolated square exterior board frame that faithfully matches the reference material and color language. Use a perfectly flat chroma-key color everywhere outside the frame and inside its large central opening. Exact front-facing orthographic square, centered, symmetrical, filling 94% of the canvas; narrow frame and large uninterrupted opening. Frame only: no scenery, background, grid, tiles, icons, text, logo or watermark; crisp continuous silhouette; premium casual puzzle-game rendering.

## Dirección por tema

| ID | Material y ambiente |
|---|---|
| `classic` | Esmalte cobalto, doble filo cian, bosque nocturno, rocas húmedas y follaje. |
| `madera` | Madera miel barnizada, veta visible, raíces, hojas, bellotas y musgo. |
| `hielo` | Hielo translúcido, facetas, escarcha, carámbanos y cueva glaciar. |
| `lava` | Basalto casi negro, juntas de magma, rocas volcánicas y brasas. |
| `cristal` | Amatista pulida, facetas grandes, racimos de cristal y resplandor magenta. |
| `magico` | Piedra arcana índigo, cristales violetas, runas y estrellas de cuatro puntas. |
| `futurista` | Metal negro y cristal ahumado, circuitos cian/magenta y módulos técnicos. |
| `dorado` | Oro pulido y martillado, arquitectura de templo y luz cálida intensa. |
| `bosque` | Piedra musgosa, tierra húmeda, raíces, hojas, flores y luz moteada. |
| `cosmico` | Portal violeta, espacio profundo, nebulosas, planetas y órbitas. |
| `jardin` | Piedra zen, arena rastrillada, bambú, bonsái, pétalos y farol de piedra. |

## Contrato de integración

- No modificar posición, anchura, altura, abertura jugable, `gap` ni hitboxes del tablero.
- Mantener las 64 celdas como elementos reales e interactivos.
- `applyTheme()` solo intercambia las cuatro URLs visuales y variables de color.
- Precargar los 44 assets activos para evitar fotogramas con capas de temas distintos.
- El marco es una decoración del borde CSS, no crea hitboxes y nunca entra en el rectángulo funcional de una casilla.
- En el tablero principal, el rail se escala de cuadrado a cuadrado y la decoración conserva la proporción 1024:1088; no se permite estirar un ornamento por ejes independientes.
- El contenido jugable y el foco permanecen por encima de la superficie temática.
- Las animaciones ambientales solo pueden usar `opacity` y `transform`.
- `prefers-reduced-motion` y el control del mockup desactivan el movimiento ambiental.
- El cambio de tema no ejecuta automáticamente el FX de eliminación ni oculta figuras.
