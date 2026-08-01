# Arquitectura — Convergence

> Última revisión base: análisis exhaustivo sobre `v1.7.1`; actualización incremental de tiendas/XP Booster sobre `v2.7.0` (2026-07-18). Este documento responde a "¿dónde está cada cosa?". Para la especificación completa de reglas de juego, fórmulas y modelos de datos ver [`MIGRATION_SPEC.md`](./MIGRATION_SPEC.md). Para el sistema visual ver [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md).

## 1. Qué es este proyecto

**Convergence** ("Convergencia") es un juego de puzzle tipo *match* para móvil/web, implementado como **PWA 100% vanilla**: HTML + CSS + JavaScript puro, sin frameworks, sin bundler, sin dependencias de terceros y sin build step. Todo el código corre directamente en el navegador sirviendo los archivos estáticos tal cual.

Mecánica base: el tablero es una grilla 8×8; el jugador toca una celda **vacía** y el juego mira en las 4 direcciones (arriba/abajo/derecha/izquierda) buscando el icono más cercano en cada una. Si 2 o más de esos iconos "vistos" coinciden, convergen (desaparecen) y suman puntos/combo.

## 2. Stack técnico

| Aspecto | Detalle |
|---|---|
| Lenguaje | JavaScript ES6+ (un único IIFE `'use strict'`), sin TypeScript, sin JSX |
| Módulos | Ninguno (no ES modules, no CommonJS) — todo vive en un único closure dentro de `game.js` |
| Framework UI | Ninguno — manipulación directa del DOM |
| CSS | Plano, sin preprocesador, con Custom Properties (CSS variables) como sistema de theming |
| Build | Ninguno. No hay `package.json`, `node_modules`, ni bundler |
| Persistencia | `localStorage` exclusivamente (sin backend, sin red) |
| Audio | Web Audio API (osciladores sintetizados) — **no hay archivos de audio** |
| PWA | `manifest.webmanifest` + `sw.js` (Service Worker hecho a mano, cache-first) |
| Gráficos de tablero | Pack Cosmos generado como SVG + 9 packs raster con 104 PNG RGBA y miniaturas propias (`IconPacks`) |
| Iconos de UI | Dos packs de assets estáticos: PNG plano (`img/ui/`) y SVG por categorías (`img/icons-v2/`) |

## 3. Mapa de archivos del repositorio

```
/
├── index.html              # DOM estático: 4 screens + 12 hub views + modales transitorios de partida
├── styles.css              # Todo el CSS de la app (2258 líneas) — ver DESIGN_SYSTEM.md
├── game.js                 # Toda la lógica de la app, un solo IIFE (3969 líneas) — ver MIGRATION_SPEC.md
├── sw.js                   # Service Worker: precache + estrategia de fetch offline-first
├── manifest.webmanifest    # Metadata PWA (nombre, iconos, display mode, orientación)
├── apple-touch-icon.png, icon-192.png, icon-512.png, icon-maskable.png
│                           # Iconos de instalación PWA/iOS
├── img/
│   ├── icons/              # Pack LEGACY de iconos PNG, organizado por categoría
│   │   (Animal, Currency, Exclusive, Food, Item, Main, Nature, OtherTiles, Player, Social, UI)
│   │   └── License.txt     # Licencia del pack "Free Icon Pack" (@gvesster) — no comercial-reventa
│   ├── icons-v2/            # Pack NUEVO de iconos SVG, 12 categorías numeradas (~815 archivos)
│   │   (1-game, 2-items, 3-gear, 4-nature, 5-food, 6-buildings, 7-vehicles,
│   │    8-ui, 9-media, 10-editing, 11-symbols, 12-misc)
│   │   Consumido vía CSS mask + variable --icv2-url (ver DESIGN_SYSTEM.md §8)
│   └── ui/                  # ~55 iconos PNG planos de uso general (economía, HUD, modales)
│   └── ui-system/           # ⚠️ REFERENCIADO por sw.js pero AUSENTE del repo (ver §8)
└── .claude/
    ├── launch.json          # Config de lanzamiento local (VS Code / debugger)
    └── settings.json         # Permisos de Claude Code para este repo
```

No existe carpeta `src/`, `dist/`, `tests/`, ni configuración de linter/formatter — el repo es deliberadamente plano.

## 4. Estructura interna de `game.js` (mapa de módulos)

Todo vive dentro de un único `(() => { 'use strict'; ... })()`. Está organizado en "módulos" (objetos/closures) delimitados por comentarios `/* ===== Nombre ===== */`, en este orden aproximado (líneas de referencia sobre v1.7.1 — pueden desplazarse ligeramente entre versiones, usar como guía de búsqueda, no como verdad absoluta):

| # | Módulo | Línea aprox. | Responsabilidad |
|---|---|---|---|
| 1 | `ErrLog` | 24 | Log de errores a `localStorage`, sin red |
| 2 | `Config` | 39 | Todas las constantes ajustables (tamaño de tablero, tabla de combos, tiers de dificultad, registro de modos) |
| 3 | `Icons` | 94 | Catálogo de iconos SVG generados (forma × color) |
| 4 | `Storage` | 162 | Acceso simple a claves sueltas de `localStorage` |
| 5 | `Settings` | 180 | Ajustes persistentes del usuario (un blob JSON) |
| 6 | `I18n` | 201 | Diccionario ES/EN + `apply()`/`t()`/`modeT()` |
| 7 | `Haptics` | 352 | Wrapper de `navigator.vibrate` |
| 8 | `Sound` | 368 | Efectos de sonido sintetizados (Web Audio API) |
| 9 | Helpers | 442 | `$`, `clamp`, `rand`, `fmtTime`, `DIRS` |
| 10 | `State` | 449 | **El** objeto de estado mutable de la partida en curso |
| 11 | `Engine` | 469 | Lógica pura de tablero (detección de convergencia, spawns, pools de iconos) |
| 12 | `Render` | 611 | Capa de renderizado DOM (memoiza por celda para evitar tocar el DOM sin cambios) |
| 13 | `Toasts` / `announce` | 862 | Notificaciones toast + región para lector de pantalla |
| 14 | `Screens` / `HubViews` / `Modal` | 921 | Router de pantallas, vistas internas del hub y diálogos de partida |
| 15 | `FX` | 955 | Sistema de partículas DOM/WAAPI del tablero (pool fijo, sin canvas). Su hermano de menús/tienda es `ShopFX` (buscar `Celebraciones de la tienda`), con el mismo patrón de pool/cap/coalescing — ver `ANIMATION_PERF_PLAN.md` (AP-*) |
| 16 | `Music` | 1241 | Música de fondo generativa (osciladores) |
| 17 | `Meta` | 1275 | Perfil de progresión/economía persistente (`cv_meta`) |
| 18 | `Econ` | 1477 | Refresco de los "pills" de economía en el HUD |
| 18b | `Storefront` | buscar `Storefront (recursos + XP)` | Catálogos allowlist, checkout ficticio de monedas/gemas y packs temporales XP ×4 |
| 19 | Helpers de iconos PNG/SVG | 1500–1595 | `ICONS_DIR`, `icon`, `iconInline`, `V2_ICONS`, `iconV2` |
| 20 | `Art` | 1563 | Helper de ilustraciones SVG/PNG |
| 21 | `Tiles` | 1597 | Registro de celdas especiales (roca, hielo, cadenas, cristal, portal, bomba…) |
| 22 | `Boosters` | 1624 | Catálogo de potenciadores (solo modo Supervivencia) |
| 23 | `Modifiers` | 1638 | Paquetes de reglas por bioma/oleada |
| 24 | `Themes` / `Cosmetics` | 1652 | Temas de color comprables (variables CSS) |
| 25 | `Boards` | 1682 | Skins de tablero comprables (cosmético puro) |
| 26 | `Adventure` | 1710 | Lógica del modo Aventura (biomas/capítulos infinitos) |
| 27 | `Survival` | 1787 | Lógica del modo Supervivencia (oleadas/vidas/boosters/frenesí) |
| 28 | `Worlds` | 2319 | Mapa de mundos × 50 niveles del modo Clásico |
| 29 | `Classic` | 2440 | Configuración de obstáculos por nivel (modo Clásico) |
| 30 | `Rules` | 2477 | Dispatcher genérico de hooks por modo (`Rules.call(name, ctx)`) |
| 31 | `PWA` | 2486 | Registro de Service Worker + `beforeinstallprompt` |
| 32 | `Share` | 2539 | Tarjeta de resultado (canvas) + Web Share API |
| 33 | `Coach` | 2574 | Tutorial interactivo guiado (coach-marks) |
| 34 | `Loop` | 2631 | El único `requestAnimationFrame` del juego |
| 35 | `Game` | 2688 | Orquestador top-level (start/activate/evaluate/win/lose) |
| 36 | `Input` | 3438 | Wiring de puntero/teclado sobre el tablero |
| 37 | Constructores de menú | 3476–3817 | Tarjetas de modo, vista de dificultad, top bars, ajustes, perfil, tienda, cofres, mapa de aventura, recompensa diaria |
| 38 | `init()` | 3819 | Bootstrap/wiring general, se llama en `DOMContentLoaded` |
| 39 | Dev hook | 3968 | Si la URL tiene `?dev`, expone los módulos en `window.__cv` |

**Regla práctica para trabajar en este archivo:** antes de leer `game.js` completo, ubica el módulo relevante en esta tabla y usa `Read` con `offset`/`limit` acotado a ese rango (± ~100 líneas). Casi todo cambio de **gameplay** cae en `Config`/`Engine`/`Game`/`Survival`/`Adventure`/`Worlds`/`Classic`; casi todo cambio de **UI/menús** cae en los "constructores de menú" (37) o en `Render`/`Screens`.

## 5. Modelo de renderizado

No hay virtual DOM ni diffing genérico. `Render` (módulo 12) mutua el DOM real directamente pero **memoiza el último glyph/tile aplicado por celda** (`Render._cellId[i]`, `Render._cellTile[i]`) para que `setGlyph`/`setTile` sean no-op si no hay cambio — un "dirty flag" manual a nivel de celda. Las actualizaciones del HUD se agrupan con un flag `Render._hudDirty` consumido una vez por frame. Los popups/partículas usan la Web Animations API (`el.animate(...)`) para correr en el hilo de composición, desacoplados del loop de RAF.

**Loop principal:** `Loop.tick` (módulo 34) es el único callback de `requestAnimationFrame`. Cada frame: calcula `dt`, ajusta un gobernador de rendimiento (EMA del frame time que regula `FX.cap`, el máximo de partículas DOM concurrentes, entre ~18 y ~50), y si `State.status === 'playing'`: avanza el reloj, acumula el timer de spawn y llama `Game.doSpawn()` cuando corresponde, decae la ventana de combo, llama al hook `Rules.call('onTick', dt)` del modo activo, aplica el HUD acumulado y anima el score.

## 6. Flujo de arranque (`init()`, línea ~3819)

1. Bloquea pinch-zoom/dblclick.
2. `Render.buildBoard()` — construye el grid de 64 celdas en el DOM.
3. `FX.init()`.
4. Aplica clases `reduced-fx`/`large-text` según `Settings`.
5. `mountTopBars()`, `fillArt()`, `I18n.apply()`, `Cosmetics.apply()`, `Boards.apply()`.
6. `Input.init()`, `buildHomeModeCarousel()`, `PWA.init()`.
7. Etiqueta de versión, listeners de "unlock" de audio (requisito iOS).
8. Construcción del selector de avatar.
9. Se define `enterApp()` y se muestra la pantalla `login` o `start` según exista `Storage.user`.
10. Se cablean **todos** los listeners de botones/vistas/modales/`data-act` (delegación de eventos por atributo), atajos de teclado globales (Escape/P/H), y pausa automática al ocultar la pestaña.

## 7. Máquina de estados: pantallas, vistas del hub y modales

`Screens.show(name)` fija `document.body.dataset.screen` y alterna `hidden` en cada `.screen` para que coincida con `#screen-{name}`. No existe router de URL/historial del navegador; `HubViews` mantiene una pila corta en memoria para volver al origen entre vistas (por ejemplo, recursos ↔ personalización o mapa de mundos → tienda).

Pantallas (`<section class="screen" id="screen-X">` en `index.html`):

| id | Rol |
|---|---|
| `login` | Bienvenida / alta de nombre |
| `start` | Hub principal fijo: recompensa, accesos, carrusel cilíndrico de modos, contexto y nav inferior |
| `worlds` | Mapa de mundos del modo Clásico (nodos de nivel + panel lateral + tabs) |
| `game` | Pantalla de juego (tablero + HUD) |

`HubViews.open(name)`/`back()`/`home()` cambia únicamente el contenido central de Inicio y mantiene montadas la appbar y la navegación inferior. Sus 12 vistas son Eventos, Misiones, Guía, Ajustes, Diario, Aventura, Tienda de recursos (`resource-shop`), Tienda de personalización (`shop`), Cofres, Multijugador, Logros/Perfil y Colecciones. Escape y `data-view-back` usan la pila en memoria; Inicio la limpia. Salir de la tienda de personalización restaura siempre el tema equipado tras cualquier previsualización.

Las tiendas son flujos separados y enlazables: la navegación global y los botones `+` de monedas/gemas abren recursos (con foco en su sección), mientras los accesos de cosméticos abren tableros/temas. `Storefront.CURRENCY_OFFERS` resuelve IDs a cantidades y el checkout actual `mock-auto` acredita localmente sin cobro; `XP_BOOST_OFFERS` vende 6 h/3 d/7 d ×4 por gemas. `Meta` persiste `xpBoostUntil` en schema 9 y `Game` captura `State.xpMultiplier` al inicio; `RunSave` conserva ese snapshot para que caducar o comprar después no cambie una partida ya iniciada.

`Modal.open(id)`/`close()` queda reservado a estados transitorios de una partida y gestiona un overlay con **un solo diálogo activo a la vez**, capturando y restaurando foco. Los únicos cuatro modales son pausa, nivel completado, fin de partida y revivir.

Picker y PreLevel están dentro de `<main>`, no son hijos de una pantalla concreta. Esto permite abrir el selector de ritmo de Zen sobre Inicio y el lanzador pre-nivel sobre el mapa de mundos aunque `#screen-game` esté oculto; `Game.start()` limpia ambas capas de forma defensiva antes de montar una partida nueva.

## 8. PWA / Service Worker

- `sw.js` define `CACHE = 'cv-cache-v2.25.0'` — **debe subirse manualmente en cada release** junto con `VERSION` y los dos `?v=` de `index.html`.
- Precachea los assets core y listas *best-effort* independientes para iconos UI/V2, arte de Inicio/modos/lanzador, atlas de cofres, packs de iconos de tablero, los nueve PNG de `SHOP_GENERATED_ART` y los once `preview.jpg` de `BOARD_THEME_PREVIEWS`.
- El arte de la tienda de recursos vive en `img/ui-generated/shop/`; las miniaturas de personalización reutilizan `img/board-themes/v2/{id}/preview.jpg`. Ambos grupos quedan disponibles en la primera instalación offline aunque el usuario no haya abierto antes ninguna tienda.
- Estrategia de fetch: navegación → *network-first* con fallback a caché (y fallback final a `index.html` cacheado si no hay red); resto de peticiones GET del mismo origen → *cache-first* con relleno de red en background.
- `manifest.webmanifest`: `display: standalone`, `orientation: portrait`, `id: "/convergence/"`, iconos 192/512 + maskable.
- Cliente (`PWA` módulo, game.js línea ~2486): maneja `beforeinstallprompt`, detecta modo standalone, muestra instrucciones manuales de instalación en iOS (UA sniffing) cuando no hay prompt nativo disponible, y avisa por toast cuando hay una versión nueva instalada (sin auto-reload).

## 9. Convenciones de versionado / cache-busting

- `index.html` referencia `styles.css?v=vNNN` y `game.js?v=vNNN` con query strings independientes del contenido — **hay que subir ese número manualmente** al cambiar CSS o JS para invalidar cachés de navegador/CDN.
- El historial de commits confirma el patrón: mensajes tipo *"Bump version to X.Y.Z; update cache version and stylesheet link"* acompañan cada release, tocando a la vez `CACHE` en `sw.js` y los `?v=` en `index.html`.
- `VERSION` (constante en `game.js`) se usa solo para telemetría local (`ErrLog`) y el toast de "nueva versión", no está atado automáticamente al query string.

## 10. Cómo ejecutar/testear localmente

No hay build ni tests automatizados. Servir estático y abrir en navegador:

```bash
python3 -m http.server 8080   # como en .claude/launch.json
# → http://localhost:8080/index.html
```

Para depurar módulos internos en consola del navegador, abrir con `?dev` en la URL (expone `window.__cv` con todos los módulos, ver game.js línea ~3968).

**Tests y lint** (añadidos en Fase A del roadmap):
- `node --test 'tests/*.test.js'` — suite del núcleo puro (convergencia, pools, clear-assist, fórmulas, paridad i18n). Carga `game.js` completo en Node sobre un stub de DOM (`tests/dom-stub.js`) y accede a los módulos vía el hook `window.__cv`.
- `npx --yes eslint@9 .` — lint con `eslint.config.mjs` (flat config); el repo sigue sin `package.json` deliberadamente.
- CI en `.github/workflows/ci.yml`: tests + lint + `node --check` de `game.js`/`sw.js` en cada push/PR.
- Release: `tools/bump-version.sh X.Y.Z` automatiza el triple bump (VERSION/CACHE/`?v=`) descrito en §9.
