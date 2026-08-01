# Plan de carga y cacheo de assets (A · B · C)

> Estado: **implementado en v2.17.0**. Este documento describe el problema, la
> causa raíz y los tres enfoques aplicados. Sirve como registro de decisiones y
> como guía para el mantenimiento futuro del Service Worker y del precargado.

## Problema reportado

1. La carga inicial se degrada a medida que crecen los assets (muchos archivos
   pequeños → muchas requests).
2. Las imágenes "no quedan cacheadas": tras cada actualización parece que hay
   que volver a descargarlo todo.
3. **Bug crítico:** al iniciar una partida, si los iconos del tablero (los del
   pack equipado, y por extensión los demás) no han terminado de cargar, el
   tablero se rompe porque las celdas se pintan sin imagen.

## Causa raíz (verificada en el código)

Hay **dos tipos de icono de tablero**:

- **Cosmos (default)** → SVG *inline* generado en JS (`Icons.svg`,
  `game.js` §Icons). No es un asset externo: se pinta al instante, nunca se
  rompe.
- **Packs raster** (`nature-basic`, `nature-advanced`, `neon`, `prismatic`) →
  `IconPacks.svg()` devuelve un `<img src="img/icon-packs/…">`
  (`game.js` §IconPacks) que se inyecta en la celda con
  `this.glyphs[i].innerHTML = …` en `Render.setGlyph`.

El `<img>` se inserta **sin esperar a que la imagen esté descargada/decodificada**
y **sin fallback**. Si el PNG no está aún en caché, la celda queda vacía → "el
tablero roto". Solo afecta a usuarios con un pack raster equipado.

Factores que impiden que el asset esté listo a tiempo:

| # | Factor | Ubicación |
|---|--------|-----------|
| 1 | El preloader de arranque **no** precarga el pack equipado | `runBootPreloader` en `game.js` |
| 2 | Caché del SW **monolítica y versionada**: `activate` borra TODAS las cachés salvo la nueva → cada release re-descarga todo | `sw.js` `activate` |
| 3 | Precache "best-effort" con `addAll(...).catch(()=>{})`: si una URL falla, se pierde el lote entero (addAll es atómico) y el error se traga en silencio | `sw.js` `install` |
| 4 | En la primerísima visita el SW aún no controla la página; la primera partida corre sin caché | registro en `game.js` |
| 5 | Escala: ~4100 archivos en `img/`; cada icono de pack pesa 100–140 KB | `img/icon-packs/*` |

---

## A — Arreglo directo del bug del tablero

**Objetivo:** que el tablero **nunca** se pinte con celdas vacías, aunque el pack
raster no esté cargado, y que sus imágenes estén calientes antes de la primera
partida.

Dos piezas complementarias, ambas en `game.js`:

1. **`IconPacks.preload(id)`** — descarga + `decode()` (patrón ya usado en
   `prepareChestAtlas`) de todos los assets del pack `id`. *Fire-and-forget*,
   idempotente (memoiza los packs ya calentados) y protegida con
   `typeof Image === 'undefined'` para no romper los tests en Node.
   - Se llama en `init()` para el **pack equipado** (no bloquea el arranque; el
     usuario suele estar en Inicio unos segundos antes de jugar, tiempo de sobra
     para calentar ≤11 PNG).
   - Se llama en `Meta.equipIconPack(id)` para calentar el pack recién equipado.
   - Cosmos no tiene assets raster → `preload('cosmos')` no hace nada.

2. **Fallback a Cosmos en `Render.setGlyph`** — tras inyectar el `<img>` de un
   pack raster, se le engancha un `onerror` (`{ once: true }`) que, si la imagen
   falla, sustituye el contenido de la celda por el SVG inline de Cosmos del
   **mismo id lógico** (`Icons.svg(id)`). La red de seguridad garantiza que el
   tablero siga siendo jugable incluso sin conexión o con un asset ausente.

Juntas: el `preload` evita el hueco visible (imagen caliente en caché) y el
`onerror` cubre el caso de fallo real/offline.

---

## B — Separar la caché del Service Worker (shell vs assets)

**Objetivo:** dejar de tirar todas las imágenes cacheadas en cada release.

- `CACHE = 'cv-cache-vX.Y.Z'` (**shell versionado**): `index.html`, `styles.css?v=`,
  `game.js?v=`, `manifest`, fuente, iconos de app, atlas de cofre base. Se
  invalida en cada release (lo sube `tools/bump-version.sh`, **sin cambios**).
- `ASSET_CACHE = 'cv-assets-vN'` (**assets persistente**): todas las imágenes de
  packs (UI, home, modos, tiendas, cofres, iconos/bordes de jugador, packs de
  tablero, iconografía v2). **No** está atada a la versión de la app y **no** se
  borra en cada release.
- `activate` borra solo las cachés que **no** sean ni `CACHE` (shell actual) ni
  `ASSET_CACHE`. Así se limpian shells viejos pero las imágenes sobreviven a los
  bumps de versión.

> `ASSET_CACHE` se versiona a mano (`cv-assets-v1` → `v2` …) **solo** cuando se
> cambia arte reutilizando la misma ruta de archivo (raro). Es el precio de tener
> assets persistentes; queda documentado con un comentario en `sw.js`.

---

## C — Precache robusto + runtime cache-first

**Objetivo:** que un asset roto no arruine el precache del resto, y que el runtime
sirva imágenes al instante desde la caché persistente.

1. **Precache por-ítem tolerante:** el shell crítico sigue con `addAll` estricto
   (si falla, la instalación falla, que es lo correcto). Las imágenes se agrupan
   en un único `IMAGE_MANIFEST` y se cachean con
   `Promise.allSettled(manifest.map((u) => assets.add(u)))`: cada URL es
   independiente, un 404 ya no arrastra a las demás ni se traga en silencio.

2. **Runtime cache-first para imágenes** contra `ASSET_CACHE`, con relleno de
   red: si está en caché se sirve al instante (arregla el bug y el rendimiento);
   si no, se descarga y se guarda. Offline: se sirve lo cacheado.
   - *Se consideró stale-while-revalidate* (revalidar en segundo plano) pero se
     descartó como runtime por defecto: revalidar cada imagen usada en cada
     apertura añade ancho de banda en segundo plano en móvil, justo lo contrario
     de lo que se busca. La frescura del arte se gestiona con el bump de
     `ASSET_CACHE`. Los PNG son inmutables por ruta en la práctica.

3. **Navegación:** se mantiene *network-first* → shell → `index.html` offline,
   para seguir recogiendo `index.html` nuevo (y sus `?v=`) en cada release. No se
   cambia, por responsividad de actualización.

---

## Impacto esperado

- **Bug del tablero:** eliminado (fallback + pack equipado precargado).
- **"Las imágenes no quedan cacheadas":** resuelto — `ASSET_CACHE` persiste entre
  releases; ya no se re-descarga todo en cada versión.
- **Carga inicial:** el precache ya no se pierde por un solo asset roto; el
  runtime sirve imágenes desde caché persistente.

## A2 — Precarga completa de iconos (anti-parpadeo) · v2.18.0

Seguía habiendo "parpadeo" al abrir por primera vez pantallas y modales: sus
iconos no estaban precargados. Causa: las vistas y modales se construyen bajo
demanda (`buildSettings`, `buildShop`, `buildResourceShop`, mode-launch…), así
que sus assets **no están en el DOM al arrancar**; y el calentado en segundo
plano solo barría `img[src]`, **ignorando las máscaras CSS `--icv2-url`** (toda
la iconografía v2).

Solución (`game.js`):

- **`Preload`** — fuente única de verdad del universo de assets de la UI:
  `iconUrls()` (los 55 PNG de `img/ui` + todos los SVG del mapa `V2_ICONS` que
  usan máscara `--icv2-url`) y `menuArtUrls()` (perfil, cofres, tiendas,
  tableros y emblemas/CTA del modal de lanzamiento de modo, tomados de las
  estructuras de datos, no del DOM).
- **Manifiesto crítico del arranque** — ahora precarga (bloqueante, con
  `decode()`) el **100% de iconos + arte de menús** vía `Preload`, no solo el
  subconjunto presente en el DOM de Login/Inicio. Los iconos son diminutos
  (~250 KB); el arte pesado ya se precargaba ahí.
- **`warmSecondaryAssets`** — reescrito: calienta primero `Preload.allUrls()` y,
  además, barre el DOM incluyendo las máscaras `--icv2-url` (antes omitidas),
  con `decode()` y concurrencia acotada.

Resultado: al llegar a Inicio, todos los iconos y el arte de menús/modales están
descargados y decodificados; abrir cualquier pantalla o modal ya no parpadea.

## Fuera de alcance (siguiente iteración)

- **D — Reducir nº/peso de assets:** sprite/atlas por pack (como los cofres),
  recompresión a tamaño real de render, WebP/AVIF o SVG. Es la mejora estructural
  de mayor calado para "muchos assets pequeños".
- Versionado por hash de contenido (ROADMAP 2.7), que permitiría dejar
  `ASSET_CACHE` totalmente inmutable sin bumps manuales.

## Verificación

- `node --test 'tests/*.test.js'` (incluye `tests/icon-packs.test.js`).
- `npx --yes eslint@9 .`
- Manual: equipar un pack raster, recargar en frío (DevTools → Application →
  Clear storage) y confirmar que el tablero se pinta completo; simular offline y
  confirmar el fallback a Cosmos.
