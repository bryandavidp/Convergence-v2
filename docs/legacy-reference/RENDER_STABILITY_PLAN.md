# Estabilidad de render y 60 FPS en todos los dispositivos: análisis y plan

> **Rol:** documento vivo derivado de fallos **graves** reportados en **Xiaomi Mi Pad 7** (tablet
> Android de pantalla ~3.2K, `devicePixelRatio` alto): jugando y navegando por menús **hay imágenes
> que cargan a medias**; con mucho movimiento en el tablero **el fondo glitchea y las fichas
> parpadean a NEGRO PURO**. Objetivo pedido: **60 FPS estables en todos los dispositivos bajo alta
> carga, sin eliminar ninguna animación**.
>
> Tercer documento de la familia de rendimiento, y el de raíz más profunda:
> - [`QA_PERF_PLAN.md`](./QA_PERF_PLAN.md) §3 — FPS del **gameplay** (coste de CPU/paint). QP-*.
> - [`ANIMATION_PERF_PLAN.md`](./ANIMATION_PERF_PLAN.md) — **acumulación de nodos** en menús/tienda. AP-*.
> - **Este** — **presupuesto de capas del compositor y memoria de GPU** (el parpadeo a negro). RS-*.
>
> Tareas con prefijo **RS-\*** (Render Stability). Cada afirmación va anclada a `archivo:línea`.

---

## 1. El síntoma clave y su causa raíz

**"Fichas parpadeando a negro puro" = desalojo de backing stores del compositor por presión de
memoria de GPU.** Cuando el número y tamaño de las **capas compuestas** (composited layers) supera
el presupuesto de memoria de texturas del proceso de GPU, Chromium/Android **descarta** tiles de
capa y las pinta de **negro** hasta que puede re-rasterizarlas. Es exactamente el mismo fallo que
este código **ya combatió en iOS/WebKit**, donde se manifiesta en **blanco** (de ahí los comentarios
"evita el blanco por compositing de WebKit", `styles.css:2062`, y el rechazo histórico al canvas).

Diferencia de plataforma → mismo bug:
| | iOS/WebKit | Android/Chromium |
|---|---|---|
| Capa sin backing store | flash **blanco** | flash **NEGRO** |
| Defensa existente | sin canvas, `will-change` transitorio, pool de partículas | — (no adaptada a la densidad Android) |

En la Mi Pad 7 el presupuesto es **más ajustado** que en un iPhone porque (a) la resolución es
altísima (cada capa a pantalla completa pesa decenas de MB), y (b) hemos **sumado capas persistentes**
nuevas. Cuando además re-rasterizamos una textura enorme por frame (filtro sobre todo el tablero),
el pico tira el presupuesto → negro.

**"Imágenes que cargan a medias"** es el mismo problema de memoria por otra cara: bajo presión, el
navegador **desaloja bitmaps decodificados** y los vuelve a decodificar progresivamente; y como las
`<img>` de menús **no** declaran `decoding="async"` ni dimensiones, decodifican en el hilo principal
al pintar. Liberar memoria de capas y sanear la decodificación ataca ambas caras.

---

## 2. Inventario de capas del compositor (dónde se va el presupuesto)

Contadas en `styles.css`: **62** usos de propiedades que promueven/encarecen capas (`will-change`,
`mix-blend-mode`, `backdrop-filter`, `isolation`, `backface-visibility`, `contain`).

**Capas PERSISTENTES sobre el tablero (siempre vivas durante el juego):**
1. `.board-wrap` — `contain: layout paint` + descendientes animados → capa de tablero completo (`styles.css:1088`).
2. `.board-wrap::before` — patrón con **`mix-blend-mode: screen`** + animación `infinite` (`board-drift`…): fuerza render de grupo aislado + readback, **siempre** (`styles.css:1118-1128`). Full-board.
3. `.board-wrap::after` — trim/borde interior (`styles.css:1130`). Full-board.
4. `.converge-layer` — `inset:0`, capa de coreografía (`styles.css:2071`). Full-board.

**Picos TRANSITORIOS que multiplican capas bajo carga:**
5. `.board-wrap.fever-burst` — **anima `filter: saturate/brightness` sobre TODO el tablero** cada frame (`styles.css:2110-2117`). Re-rasteriza una textura full-board a `dpr×` por frame: el disparador nº1 del parpadeo.
6. Pulsos de celda concurrentes: `special-pulse`, `cellPulse` (bomb/line/wild-cleared), `ice-hit`, `glyph-out`… En una cascada grande, **decenas** de celdas promueven a capa a la vez.
7. `.converge-tile`/`trail`/`particle` — 3 grupos preasignados (acotado, bien).

**Capas FULL-SCREEN fijas:**
8. `.fx` (z80), `.flash` (z90), `.rank`, y **`.shop-fx` (z82)** — esta última con **`will-change`
   permanente en 100 nodos del pool** (`styles.css:11389`), introducida en v2.19.0: una **regresión**
   respecto a `.fxp`, que evita a propósito el `will-change` permanente (`styles.css:2065-2068`).

**Skins de tablero:** `.board-wrap[data-board]::before` anima transform `infinite`; la futurista se
sobredimensiona a `inset:-34px` (`styles.css:1478`) → textura full-board+ extra, siempre.

---

## 3. Por qué "debería ir a 60 y no va" — el modelo mental correcto

No es falta de GPU bruta: la Mi Pad 7 mueve capas de sobra. El cuello es **cuántas capas y de qué
tamaño** hay que mantener en memoria a la vez, y **cuánta re-rasterización** pedimos por frame:
- Cada `mix-blend-mode`/`filter` animado obliga a **re-pintar** (no solo recomponer) una textura.
- Cada `will-change` permanente y cada celda que promueve **reserva** un backing store.
- A `dpr` alto, esas texturas son enormes → el presupuesto se agota → **eviction → negro** + jank.

**Meta realista:** el parpadeo a negro y las imágenes a medias son **bugs de memoria**, no "FPS
bajos" inevitables: se pueden **eliminar** en cualquier dispositivo razonable recortando memoria de
capas. Sostener 60 bajo carga es alcanzable en gama media-alta (Mi Pad 7, iPhone 12+) una vez que
**dejamos de reventar el presupuesto de GPU**. En gama muy baja el gobernador degrada por capas
(nunca pierde el feedback de jugada). Nada de esto elimina animaciones: cambia **cómo** se componen.

---

## 4. Plan de tareas (RS-\*) — orden = prioridad

| # | Tarea | Prio | Estado |
|---|---|---|---|
| RS-1 | **Quitar el `filter` animado sobre todo el tablero** (fever-burst/fever-out → transform-only; el "espectáculo" se conserva con el zoom + aura) | P0 | ✅ **Hecho v2.26.0** |
| RS-2 | **Eliminar `mix-blend-mode: screen` del `.board-wrap::before`** (a composición normal; sobre fondo oscuro es visualmente idéntico y ahorra el render de grupo aislado) | P0 | ✅ **Hecho v2.26.0** |
| RS-3 | **`will-change` disciplinado** en `.shop-fx` (quitar el permanente de los 100 nodos del pool; promoción transitoria como `.fxp`) — corrige la regresión de v2.19.0 | P0 | ✅ **Hecho v2.26.0** |
| RS-5 | **Higiene de decodificación de imágenes**: `decoding="async"` en el helper `icon()`/`<img>` generados y en las 77 `<img>` de `index.html` | P1 | ✅ **Hecho v2.26.0** (dimensiones/aspect-ratio: pendiente RS-6) |
| RS-7 | **Gobernador consciente del dispositivo**: arranque conservador en táctil `dpr≥2` o `deviceMemory≤4`, no solo iOS `dpr≥3` | P1 | ✅ **Hecho v2.26.0** |
| RS-4 | **Presupuesto de capas de celda**: acotar/coalescer pulsos de celda concurrentes en cascadas grandes (integrado con el gobernador `perf-1/2`) | P1 | ✅ **Hecho v2.27.0** |
| RS-10 | **Reflujo síncrono por celda en el spawn masivo** (`spawnAnim` → WAAPI): eliminar el `void offsetWidth` que causaba layout thrashing al aparecer muchos iconos de golpe (refill tras vaciar el tablero) — pérdida de frames en iOS | P0 | ✅ **Hecho v2.28.0** |
| RS-6 | **Reducir tamaño de capas**: acotar el pseudo sobredimensionado de skins, dimensiones explícitas en imágenes y confirmar que las capas FX full-screen no promueven hijos de más | P2 | ⬜ |
| RS-8 | **Evaluar canvas único para partículas** (1 capa en vez de ~140) detrás de bandera, midiendo el regreso del bug blanco/negro; NO cambio a ciegas | P2 | 🟡 **Backend implementado v2.36.0** (bandera OFF por defecto; falta medir/promover) |
| RS-9 | **Instrumentación multi-dispositivo**: `perf-probe` emulando Android hi-dpi + recuento de capas compuestas con presupuesto; validación real en Mi Pad 7 (chrome://inspect → Layers) | P2 | 🟡 **Sonda con perfil Android hi-dpi v2.36.0**; validación real pendiente (requiere dispositivo) |
| RS-11 | **Supervivencia bajo estrés — repintados full-board vivos que el gobernador no cortaba** (A1: `surv-frenzy-pulse` animaba `filter` sobre toda la `.board-wrap`, solo lo curaba `reduced-fx`; A2: cortar en `perf-1/2` las infinitas de estrés `dangerBorder`/frenesí) | P0 | ✅ **Hecho v2.34.0** |
| RS-12 | **Supervivencia bajo estrés — coste de hilo principal en la ráfaga de eventos** (A3: `syncAll` dirigido en meteoro/escarcha/cierre + `aria-label` memoizado en `syncCell`) | P1 | ✅ **Hecho v2.34.0** |
| RS-13 | **Gobernador proactivo/predictivo** (B1: subir de nivel al detectar ocupación alta + eventos activos, sin esperar 2 s de EMA; B2: escalonar el trabajo del evento en varios frames; B3: reacción al pico de frame, no solo al EMA) | P1 | ✅ **Hecho v2.35.0** |
| RS-14 | **Canvas único para partículas + medición** (C1: 1 capa en vez de ~140, detrás de bandera; C2: `perf-probe` emulando Android hi-dpi sobre la escena de estrés de Supervivencia) | P2 | 🟡 **Hecho v2.36.0** (backend + sonda listos; medición real en dispositivo pendiente — requiere navegador) |

> **Escenario de seguimiento (jul 2026): Supervivencia con "todo a la vez".** Reporte del
> propietario: con el **tablero lleno**, **varios eventos activos** (jefe/marea/frenesí) y cosas
> pasando, se **pierden frames y se laguean las acciones del jugador**; en PC va fino, en móvil se
> hace pesado y **solo "reducir efectos" lo cura**. Diagnóstico (anclado a código): (1) el frenesí
> —muy frecuente en Supervivencia— animaba `filter: saturate/brightness` sobre TODA la `.board-wrap`
> (`styles.css`, `surv-frenzy-pulse`), el mismo antipatrón que RS-1 quitó de la Fiebre, y **el
> gobernador no lo cortaba** (solo `reduced-fx`, `styles.css:5770`) → por eso ese modo era el único
> arreglo; (2) el gobernador es reactivo con umbral **sostenido 2 s** (`Perf.UP_MS`), pero un evento
> de jefe dura ~1-2 s → la ráfaga acaba antes de que reaccione; (3) todo el trabajo del evento
> (colocar fichas + `syncAll` de 64 celdas + N pulsos + flash + confeti) cae en **un frame** → ese
> frame se come el tap del jugador. Grupos A (RS-11/12, hecho), B (RS-13) y C (RS-14) atacan las tres.

**Invariante (igual que AP-*):** *no se elimina ninguna animación.* Se conservan estética, duración y
coreografía; solo cambia la fontanería de composición (propiedad animada barata, menos capas
persistentes, menor tamaño de textura, decodificación asíncrona).

---

## 5. Bitácora de implementación

### v2.26.0 — primera ola: eliminar los disparadores del parpadeo a negro (RS-1/2/3/5/7)

Cambios en `styles.css` (compositing del tablero + pool de tienda), `game.js` (helper de iconos,
gobernador) e `index.html` (imágenes). Bump 2.25.0 → 2.26.0. **Ninguna animación eliminada.**

- **RS-1 · Fiebre sin `filter` full-board.** `@keyframes fever-burst`/`fever-out` pasan a **solo
  `transform: scale`** (`styles.css`, ~§Capa FX). Antes animaban `filter: saturate/brightness` sobre
  todo `.board-wrap`: cada frame re-rasterizaba una textura de tablero completo a `dpr×`; en la Mi Pad 7
  ese pico agotaba la memoria de GPU y disparaba el parpadeo a negro. El zoom conserva el golpe visual;
  el "calor" lo aporta el aura `.fever` (que sigue pulsando por opacidad).
- **RS-2 · Patrón del tablero sin `mix-blend-mode`.** `.board-wrap::before` deja de usar `screen`
  (`styles.css:1118`). El blend obligaba a renderizar un grupo aislado del tablero y hacer readback cada
  frame (capa full-board **siempre** viva); sobre el fondo oscuro el patrón se ve casi igual con
  composición normal.
- **RS-3 · `will-change` disciplinado en `ShopFX`.** `.shop-fx > span` deja de declarar `will-change`
  permanente (`styles.css`). Marcarlo en los ~100 nodos del pool reservaba backing stores aunque
  estuvieran inertes: una regresión introducida en v2.19.0 respecto al criterio de `.fxp`. La animación
  WAAPI ya promueve la capa solo mientras corre.
- **RS-5 · Decodificación asíncrona.** El helper `icon()` (`game.js`) emite `decoding="async"` (cubre la
  mayoría de iconos in-game generados por JS); el `<img>` del rótulo de la tienda fija `img.decoding`;
  y las **77** `<img>` de `index.html` llevan ya `decoding="async"`. Evita la decodificación síncrona en
  el hilo principal al pintar y las "imágenes a medias" al navegar bajo presión de memoria.
- **RS-7 · Arranque conservador multi-plataforma.** `Perf.init` (`game.js:8044`) activa el `_bootGuard`
  (nivel 1 durante ~5s hasta EMA bueno) en cualquier táctil con `devicePixelRatio ≥ 2` **o**
  `navigator.deviceMemory ≤ 4`, no solo en iOS `dpr≥3`. Cubre tablets Android de alta densidad como la
  Mi Pad 7 y dispositivos de poca RAM.

**Verificación:** `node --check` OK · nuevo `tests/render-stability.test.js` **6/6** (guardarraíles CSS
de RS-1/2/3, decoding en `icon()`+index.html, arranque del gobernador por dpr y por RAM baja) ·
`tests/qp2-perf.test.js` y `tests/animation-perf.test.js` verdes · suite completa 287/289 (los 2 fallos
`board-themes-redesign` y los 3 errores de lint `Buffer` de `icon-packs.test.js` son **preexistentes**,
verificado por `git stash`; ajenos a este trabajo).

**Expectativa:** RS-1/2/3 eliminan los tres picos que reventaban el presupuesto de GPU (filtro
full-board, blend siempre-vivo, 100 capas will-change) → el parpadeo a negro debería desaparecer.
RS-5 ataca las imágenes a medias. RS-7 da colchón durante el arranque. La confirmación definitiva es
RS-9 (dispositivo real).

### v2.27.0 — RS-4: presupuesto de capas de celda

- **RS-4 · Tope de pulsos de celda concurrentes.** `Render.cellPulse` (`game.js`) ahora (a) **acota**
  el nº de pulsos decorativos simultáneos con un tope que escala con el gobernador (28 en nivel 0, 18
  en nivel 1, 10 en nivel 2): pasado el tope se omite **solo el adorno** (el estado de la celda ya lo
  pinta `syncCell`/`syncAll`), invisible en cascadas enormes; y (b) **evita el reflujo síncrono**
  (`void offsetWidth`) salvo al re-disparar sobre una celda que ya pulsa — en el camino común de
  cascada (celda nueva) desaparece la tormenta de layout que además promovía decenas de capas a la vez.
  Es justo el pico que en Android hi-dpi desalojaba backing stores → parpadeo a negro.
  Test: `tests/render-stability.test.js` (tope 28 en nivel 0, 10 en nivel 2). Bump 2.26.0 → 2.27.0.

### v2.28.0 — RS-10: eliminar el reflujo síncrono del spawn masivo (pico de hilo principal en iOS)

> **Síntoma nuevo (iOS):** al aparecer **muchos iconos de golpe** (refill tras vaciar el tablero),
> quizá con otra animación en curso, la interfaz **se laguea y pierde frames**. A diferencia del
> parpadeo a negro (RS-1…RS-7, presupuesto de capas/GPU), esto es un **pico de trabajo en el hilo
> principal**: *layout thrashing*.

- **Causa raíz.** `Render.spawnAnim` reiniciaba la animación CSS `glyph-in` con el truco
  `el.classList.remove('spawn'); void el.offsetWidth; el.classList.add('spawn')`. Ese `void
  offsetWidth` fuerza un **recálculo de layout SÍNCRONO** del documento. Se llamaba **por celda**, y el
  refill masivo lo invoca en bucle (`refilled.forEach((idx) => Render.spawnAnim(idx))`, `game.js:~9433`):
  con 30-40 iconos nuevos eran **30-40 reflujos forzados en un único frame**, intercalados con
  escrituras de clase → el hilo principal se bloquea y caen los frames (peor en Safari/iOS, cuyo layout
  es más lento). La animación en sí (`glyph-in`: `transform: scale` + `opacity`) ya era barata.
- **Corrección.** `spawnAnim` pasa a **WAAPI** (`glyph.animate([...])`): arranca sin `void offsetWidth`
  (cero reflujo forzado), corre en el compositor y no depende de `FX.cap`. Misma animación (mismo
  easing, misma duración 280 ms, mismo scale .2→1 / opacity 0→1). Al ser un cambio en `spawnAnim`,
  **beneficia a TODOS sus llamadores** (refill, penalización, robos de jefe, meteoro…), no solo al
  refill masivo. Ya no se añade la clase `.spawn` (la regla CSS `.cell.spawn .glyph` queda inerte).
  Es el mismo patrón que ya se aplicó a `Render.popup` (WAAPI en vez de `void offsetWidth`) y a
  `cellPulse` en RS-4. Test: `tests/render-stability.test.js` (usa WAAPI, no añade `.spawn`).
  Bump 2.27.0 → 2.28.0.
- **RS-10b (v2.29.0) · Mismo criterio en `iceHit`/`iceBreak`.** `iceHit` también se llama en bucle
  (`placed.forEach((i) => Render.iceHit(i))`) en oleadas de escarcha/meteoro. Ahora el `void
  offsetWidth` solo se fuerza al **re-disparar** sobre una celda que ya tiene la clase; una celda
  nueva arranca la animación con solo añadir la clase → sin reflujo en el camino de bucle. Con esto,
  ninguna animación disparada en bucle sobre celdas fuerza ya un reflujo síncrono por elemento
  (los `void offsetWidth` restantes son de **un** elemento por evento —tap fallido, shake, flash,
  fever— donde un reflujo aislado es despreciable). Bump 2.28.0 → 2.29.0.

### v2.34.0 — Grupo A: Supervivencia bajo estrés, fontanería sin pérdida visual (RS-11/RS-12)

Origen: el escenario de seguimiento de §4 (Supervivencia con tablero lleno + varios eventos a la
vez). Todo respeta el invariante: **ninguna animación se recorta**; misma estética y duración.
Cambios en `styles.css` (frenesí + cortes del gobernador) y `game.js` (módulo `Render`). Bump
2.33.0 → 2.34.0. Tests: `tests/render-stability.test.js` amplía a 12 (A1/A2/A3); suite completa 324/324.

- **A1 (RS-11) · Frenesí sin `filter` full-board.** `@keyframes surv-frenzy-pulse` deja de animar
  `filter: saturate/brightness` sobre toda la `.board-wrap` y pasa a `transform` (latido composited).
  Ese filtro re-rasterizaba una textura de tablero completo a `dpr×` **cada frame**, y como el
  frenesí está activo buena parte de una partida de Supervivencia era el mayor sumidero del hilo de
  paint. La **calidez** se conserva sin coste: el aura `#fever` (pulso de opacidad) la enciende
  `Survival._setFrenzyClass()` durante todo el frenesí, y el glow por tier (`box-shadow` estático)
  sigue. Mismo criterio que RS-1 en `fever-burst`. **Por esto `reduced-fx` era el único arreglo**
  (era el único selector que anulaba esta animación, `styles.css:5770`).
- **A2 (RS-11) · El gobernador degrada las infinitas de estrés.** Nuevas reglas `body.perf-1
  .board-wrap.danger { animation:none }` (el borde de peligro `dangerBorder` repinta `border-color`
  full-board) y `body.perf-2.surv-frenzy-active .board-wrap { animation:none }`. Antes estas
  infinitas solo se cortaban con `reduced-fx`; ahora la degradación por capas del gobernador las
  alcanza bajo carga sin que el usuario active nada. Queda el glow estático + aura `#fever` (no se
  pierde legibilidad del estado).
- **A3 (RS-12) · Menos hilo principal en la ráfaga de eventos.** (a) `Render.syncCells(list)` nuevo:
  meteoro (`meteorRain`), escarcha (`frostSurge`) y cierre (`lockdown`) llamaban a `syncAll` (barrido
  de las 64 celdas) para tocar solo un puñado; ahora sincronizan **solo las celdas afectadas** (`placed`).
  (b) `aria-label` memoizado en `syncCell`: el texto solo depende de (icono, pack, idioma); recomputar
  `cellLabel` (llama a `IconPacks.iconName`) y reescribir el atributo en las 64 celdas por barrido
  invalidaba el árbol de accesibilidad en cada `syncAll`. Con varios eventos encadenados (varios
  `syncAll` seguidos) ese coste se acumulaba. Se salta cuando no cambia; el atributo queda idéntico.

**Verificación:** `node --check game.js` OK · `node --test tests/render-stability.test.js` 12/12 ·
suite completa **324/324** · `eslint@9` 0 errores (solo warnings preexistentes de vars sin usar).

### v2.35.0 — Grupo B: gobernador proactivo/predictivo (RS-13)

El gobernador dejaba de ser puramente reactivo (EMA sostenido 2 s), que llegaba tarde a las ráfagas
de Supervivencia (un evento de jefe dura ~1-2 s). Ahora separa el **nivel reactivo** (histéresis por
EMA, intacto) del **nivel efectivo** = `max(reactivo, suelo predictivo)`, y actúa antes. Cambios en
`game.js` (módulos `Perf`, `Loop`, `Survival`). Bump 2.34.0 → 2.35.0. Tests: `render-stability.test.js`
amplía a 15 (B1/B3); suite completa 323/323. Invariante intacto: ninguna animación se recorta.

- **B1 · Suelo predictivo.** `Perf` gana `_floor`/`setFloor`/`resetFloor` y `_effective()`; `_render()`
  pinta en `<body>` el nivel efectivo (memoizado en `applied`) y acota `FX.cap` a su techo. `Loop.tick`
  llama cada frame a `Perf.setFloor(Survival.perfStress())` en Supervivencia (0 en el resto).
  `Survival.perfStress()` deriva un suelo 0/1/2 de lo que el modo YA sabe: **ocupación del tablero** +
  **evento de estrés en curso** (frenesí / lock de evento / encuentro de jefe). Tablero holgado
  (`occ<0.6`) → 0 (los eventos son baratos, no se degrada nada); casi lleno sin evento → 1; lleno +
  evento → 2. Así los cortes por capa (ambientales/pulsos) y el tope de `FX.cap` bajan **durante** la
  ráfaga, no 2 s después. El suelo sube al instante y al bajar se mantiene `FLOOR_HOLD=700ms`
  (anti-parpadeo en el límite de ocupación + colita suave); `Loop.stop()` llama a `resetFloor()` para
  que la clase `perf-*` no quede pegada si la partida acaba en plena ráfaga.
- **B2 · Menos trabajo en el frame del evento.** `activateFrenzy` sincroniza SOLO las celdas nuevas
  (`syncCells`, antes `syncAll` de 64). Nuevo `Survival._deferFx(fn)`: saca el **enjambre de partículas**
  (confeti) de frenesí y de "jefe superado" al frame SIGUIENTE (16 ms invisibles), para que el frame que
  muta el estado —y un posible tap del jugador en él— no cargue con crear decenas de animaciones WAAPI.
- **B3 · Reacción al pico, no solo a la media.** Un frame por encima de `SPIKE_MS=55ms` suelta `FX.cap`
  de inmediato y suma a un acumulador de picos con decaimiento propio (independiente de la histéresis del
  EMA, que se resetea cada frame bueno): un pico aislado (GC) se olvida, picos encadenados —la ráfaga
  real— escalan de nivel sin esperar los 2 s de EMA malo.

**Verificación:** `node --check game.js` OK · `node --test tests/render-stability.test.js` 15/15 ·
suite completa **323/323** · `eslint@9` 0 errores.

### v2.36.0 — Grupo C: canvas único de partículas (experimental, con bandera) + sonda Android (RS-14)

RS-8 avisa explícitamente: el canvas es la palanca más grande (1 capa en vez de ~140) **pero la de
más riesgo** (puede reintroducir el bug blanco/negro), así que va **detrás de bandera y con medición,
NO a ciegas**. Esta ola entrega justo eso: el backend listo (OFF por defecto, cero cambio en
producción) y el arnés para medirlo. Cambios en `game.js` (módulo `FX`, `Loop`) y `tools/perf-probe.js`.
Bump 2.35.0 → 2.36.0. Tests: `render-stability.test.js` amplía a 20 (C1/C2); suite completa 328/328.

- **C1 · Backend de partículas en un canvas (RS-8), detrás de bandera.** `FX` gana un backend
  alternativo: con la bandera activa (`?canvasfx` en la URL o `localStorage.cv_canvas_fx='1'`, o
  `FX.enableCanvas(true)` en caliente), `_emit` dibuja la partícula en **un solo `<canvas>`** en vez
  de tomar un span del pool DOM → colapsa las ~140 capas del compositor en **1**. Cubre las partículas
  de `_emit` (burst / confeti / chispas de `boardClear`); la coreografía de convergencia (iconos que
  vuelan) sigue en DOM (pocos nodos, iconos nítidos). El integrador `_particleAt` es **puro** y
  reproduce EXACTAMENTE la parábola y el fundido de los keyframes de `_emit` (probado en Node).
  `stepCanvas` (llamado por `Loop.tick`) avanza edades, descarta muertas y redibuja; respeta `FX.cap`
  (descarta al saturar, mismo contrato que el pool). **OFF por defecto**: producción sigue en el pool
  DOM hasta que la medición confirme que no reaparece el parpadeo. El tamaño del canvas se acota a
  `viewport × min(3, dpr)` (RS-6).
- **C2 · Sonda multi-dispositivo (RS-9).** `tools/perf-probe.js` gana: (a) `--android` — emula tablet
  Android hi-dpi (`deviceScaleFactor: 3`), el presupuesto de capas ajustado de la Mi Pad 7, donde el
  `dpr` alto es lo que dispara el coste de paint; (b) escena de estrés = **el caso reportado** (tablero
  cargado + eventos concurrentes de Supervivencia: marea/escarcha/meteoro/frenesí + confeti), no solo
  fiebre+confeti; (c) `--canvas` — mide el backend de C1 en la misma escena para comparar el ahorro de
  capas contra el pool DOM; (d) `--assert N` sobre la escena de estrés etiquetada.

**Cómo medir/validar (pendiente, requiere navegador):**
```bash
python3 -m http.server 8080 &
node tools/perf-probe.js --android              # pool DOM en tablet Android hi-dpi (escena de estrés)
node tools/perf-probe.js --android --canvas     # + comparación con el canvas único
node tools/perf-probe.js --android --assert 55  # guardarraíl
```
La palabra final es el dispositivo real (Mi Pad 7 → chrome://inspect → Layers): confirmar el recuento
de capas del canvas frente al pool DOM y que NO reaparece el parpadeo a negro antes de promover C1 a
producción. `playwright` debe estar disponible para Node (el repo no tiene `package.json`).

**Verificación:** `node --check game.js && node --check tools/perf-probe.js` OK ·
`node --test tests/render-stability.test.js` 20/20 · suite completa **328/328** · `eslint@9` 0 errores.

### Siguiente ola (pendiente)

- **Medir y decidir sobre C1/RS-8** en dispositivo real antes de promover el canvas a producción.
- **RS-6** — dimensiones explícitas en imágenes + acotar tamaño de pseudos de skin.

---

## 6. Referencias cruzadas

- `QA_PERF_PLAN.md` §3 y `ANIMATION_PERF_PLAN.md` — hermanos de rendimiento (gameplay y ráfaga).
- `DESIGN_SYSTEM.md` — regla de compositing (transform/opacity-only; sin blend/filter animado en superficies grandes).
- `ARCHITECTURE.md` §4-§5 — módulos `FX`/`ShopFX`, `Render`, modelo de composición y gobernador `Perf`.
