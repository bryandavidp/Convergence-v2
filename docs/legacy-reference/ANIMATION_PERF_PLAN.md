# Rendimiento de animaciones bajo ráfaga: análisis, estado y plan

> **Rol:** documento vivo derivado de un análisis a raíz del feedback del propietario
> (jul 2026): *"en móvil va fluido hasta que encadenamos animaciones; y si repites una
> acción con animación —p. ej. comprar en la tienda pulsando repetidas veces en el mismo
> sitio— el sistema se sobrecarga y va lento"*. Dispositivo de prueba: **iPhone 12 Pro Max**
> (potencia de sobra, luego el problema no es de GPU bruta).
>
> Hermano de [`QA_PERF_PLAN.md`](./QA_PERF_PLAN.md) §3 (que cubre el **FPS del gameplay**
> con fiebre/confeti y ya dejó cerrado QP-2). Este documento cubre el ángulo que **no**
> estaba documentado: la **sobrecarga por repetición de acciones en menús/tienda**, más el
> cierre y verificación de lo pendiente del gameplay. Tareas con prefijo **AP-\*** (Animation
> Performance). Método idéntico al del resto de planes: cada afirmación va anclada a
> `archivo:línea` y cada tarea lleva estado explícito.

---

## 1. Diagnóstico: son DOS problemas distintos

| | Escenario A — encadenar jugando | Escenario B — repetir una acción en menús/tienda |
|---|---|---|
| **Gatillo** | Muchas convergencias/combos seguidos | Pulsar repetido el mismo botón con animación (comprar monedas/gemas/XP/cofre) |
| **Causa dominante** | Volumen de **capas de compositor** concurrentes + pintado a `dpr×3` | **Creación/destrucción de nodos DOM** en el hilo principal + rebuilds de `innerHTML` |
| **Estado** | Medido y **mitigado** (gobernador `Perf`, pool de partículas del tablero) | **Sin arquitectura de contención** hasta este plan |
| **Fuente** | `QA_PERF_PLAN.md` §3 (QP-2) | Este documento (AP-\*) |

**Por qué un iPhone 12 Pro Max potente aun así se atasca:** el cuello de botella no es la GPU,
es el **hilo principal (CPU)** y el **número de capas del compositor**. Un Pro Max rasteriza a
`devicePixelRatio = 3` → cada pintado cuesta ~9× los píxeles de un 1080p de PC. Sobra GPU para
*mover* capas ya pintadas, pero no para *crearlas, pintarlas y recolectarlas* muchas veces por
segundo. De ahí la sensación de "debería aguantar y no aguanta".

---

## 2. Causas raíz (con anclaje a código)

### 2.A — Gameplay (contexto; ya mitigado)
Ver `QA_PERF_PLAN.md` §3.2. Resumen: ~135 animaciones vivas en juego normal, keyframes que
**pintan** (ambientales de skins, pulsos infinitos de tiles), coste de paint ×3 en Pro. El FX
del tablero está **bien**: pool fijo de 140 `<span>` reutilizables y descarte al saturar
(`FX` en `game.js:2632`, `FX._slot` en `game.js:2780`). El gobernador `Perf` (`game.js:2626`… →
módulo en `game.js:8026`) degrada por capas con histéresis y **arranca en nivel 1 en móvil de
alta densidad** (`Perf.init`, `game.js:8034-8039`). Contribuyente secundario poco vigilado:
ráfaga de osciladores WebAudio por convergencia sin tope global (`Sound.match/chord`,
`game.js:1312-1324`; solo `Sound.eliminate` tiene throttle de 30 ms, `game.js:1317`).

### 2.B — Tienda (el hueco real)
El sistema de celebración de la tienda **no heredó** la arquitectura del tablero. Contraste directo:

- **FX del tablero (bien):** pool fijo reutilizable, cero `createElement` por evento.
- **`ShopFX` (mal):** `ShopFX._spawn` hace `document.createElement('span')` **por partícula, en cada
  compra** (`game.js:11628`). Sin pool, sin tope de concurrencia.

Coste por **cada** tap de compra de moneda/gema (`ShopFX.flyCurrency`, `game.js:11682`):
- 16 monedas voladoras, **cada una con un `<img>` hijo** (`game.js:11707-11709`),
- `rewardWow`: rayos + anillo + **14 estrellas** (`game.js:11643-11678`),
- 1 rótulo "+cantidad",
- 1 bucle `requestAnimationFrame` de count-up (`game.js:11739`).

→ **~33 nodos DOM nuevos + ~33 animaciones WAAPI + 1 rAF por tap.** Se limpian al terminar
(~0,5-1 s después), pero pulsar 8 veces en un segundo deja **~260 nodos vivos a la vez**, más su
posterior recolección en bloque. Eso **es** la sobrecarga reportada.

Agravantes confirmados:
1. **Sin throttle real.** El botón de moneda se deshabilita durante un `await
   Storefront.checkoutCurrency()` que es **síncrono** (devuelve un objeto, no una Promise real,
   `game.js:11764-11769`) → se rehabilita en el mismo microtask; los taps rápidos no se frenan.
2. **Los handlers de XP y cofre reconstruyen TODA la tienda por tap:** `buildResourceShop()`
   reescribe el `innerHTML` de 4 contenedores + re-attacha listeners + `FX.confetti(34)` +
   `rewardWow` (`game.js:11801` y `game.js:11813`). Spamear = rebuilds completos apilados
   (re-parseo de HTML, layout, re-decode de imágenes de tarjetas).
3. **`filter: drop-shadow` en cada moneda voladora** (`styles.css:11408`): 16 capas con filtro
   por tap = pintado caro; en iOS el `filter` animado es de lo más costoso.
4. Cada compra de moneda togglea `is-poor` en todas las tarjetas de XP y cofre
   (`game.js:11772-11779`): escrituras de DOM O(ofertas) por tap.

---

## 3. Estado de partida (lo que YA estaba hecho antes de este plan)

- ✅ **QP-2 (gameplay)**: `backdrop-filter` fuera, 7 ambientales de tablero pasadas a
  transform/opacity, pulsos de tiles a `::before`, gobernador v2 con histéresis y clases
  `perf-1/perf-2`, auto-sugerencia de modo ligero. (`QA_PERF_PLAN.md` §3.4, v2.5.0).
- ✅ **Arranque del gobernador en iOS de alta densidad** (`Perf._bootGuard`, `game.js:8036-8039`)
  — equivale a lo que en el análisis inicial se listó como pendiente "AP-7".
- 🟡 **`perf-probe --assert 55`** sigue como guardarraíl no superado en local (34,7 FPS CPU×6,
  nota v2.6.0 en `QA_PERF_PLAN.md`): señal de seguimiento, no bloqueante.

---

## 4. Plan de tareas (AP-\*) — orden = prioridad de implementación

| # | Tarea | Prioridad | Esf. | Estado |
|---|---|---|---|---|
| AP-1 | **Pool de nodos reutilizables en `ShopFX`** (fin del `createElement` por partícula) | P0 | 🟡🟡 | ✅ **Hecho v2.19.0** |
| AP-2 | **Coalescing/throttle de taps repetidos** (repetir = acumular "+N", no apilar animaciones) | P0 | 🟡 | ✅ **Hecho v2.19.0** |
| AP-3 | **Actualización quirúrgica de la tienda + guard de re-entrada** (sin `buildResourceShop()` por tap) | P0 | 🟡 | ✅ **Hecho v2.19.0** |
| AP-4 | **Presupuesto de capas concurrentes en `ShopFX`** (cap con descarte, como `FX.cap`) | P1 | 🟡 | ✅ **Hecho v2.19.0** |
| AP-5 | **Partículas compositor-only** (quitar `filter: drop-shadow` animado de las monedas) | P1 | 🟡 | ✅ **Hecho v2.19.0** |
| AP-6 | **Verificar/cerrar QP-2 gameplay** (ambientales/pulsos transform-only, pulsos en `reduced-fx`) | P1 | 🟡 | ✅ **Verificado** (ya cumplía, v2.5.0) |
| AP-7 | **Arranque del gobernador en iOS** | P2 | — | ✅ Ya hecho (`Perf._bootGuard`) |
| AP-8 | **Limitador global de osciladores WebAudio** (cadenas rápidas no saturan el scheduler) | P2 | 🟡 | ✅ **Hecho v2.19.0** |
| AP-9 | **Validación en dispositivo real + `perf-probe --assert`** | P2 | 🟡 | ⬜ **Pendiente** (requiere iPhone real / navegador) |

**Principio rector (invariante de este plan):** *no se reduce ni se elimina ninguna animación.*
Se mantienen estética, duración y coreografía; solo cambia la **fontanería** (pooling, coalescing,
actualización quirúrgica, capas compositor-only). Cualquier tarea que rebaje una animación visible
está fuera de alcance.

---

## 5. Bitácora de implementación

> Se rellena a medida que se aplica cada tarea (qué se cambió, dónde, cómo se verificó).

### v2.19.0 — bloque de la tienda (AP-1…AP-5) + audio (AP-8) + verificación (AP-6)

Todo el bloque respeta el **invariante**: ninguna animación se recorta; solo cambia la fontanería.
Cambios en `game.js` (módulo `ShopFX`, `Sound`) y `styles.css` (`.shopfx-coin`). Bump 2.18.0 → 2.19.0
(`VERSION`/`CACHE`/`?v=` sincronizados con `tools/bump-version.sh`).

- **AP-1 · Pool reutilizable en `ShopFX`.** Reescrito el módulo (`game.js`, `const ShopFX`): pool fijo
  `POOL = 96` partículas + `CHIP_POOL = 4` rótulos, construido una vez en `_buildPool()` (idempotente).
  Nuevos `_slot()` (round-robin), `_particle(cls, x, y)` (adquiere+limpia estilos) y `_run(slot,…)`
  (anima y **libera** la ranura al terminar, volviendo a la clase base). `rewardWow` y `flyCurrency`
  ya no hacen `document.createElement` por partícula: toman del pool. Fin del churn de ~33 nodos/tap y
  de las pausas de GC en ráfaga.
- **AP-4 · Cap de concurrencia.** `_slot()` devuelve `null` si `active ≥ CAP (90)`; quien llama
  **descarta** la partícula (`break`), nunca cancela una viva. Réplica exacta del contrato de `FX.cap`
  del tablero. El nº de capas del compositor queda acotado por muy rápido que se pulse.
- **AP-2 · Coalescing de taps + count-up cancelable.** `flyCurrency` fusiona compras seguidas de la
  misma divisa dentro de `COALESCE_MS = 320`: acumula "+N" en el rótulo vivo y **no** relanza el enjambre
  (feedback intacto — el número crece y el contador rebota). `countUp` registra su rAF en `_countRaf[kind]`
  y cancela el anterior: los taps seguidos ya no apilan bucles que compiten por el contador.
- **AP-3 · Actualización quirúrgica + guard.** Nueva `refreshResourceShopState()`: refresca solo
  `is-poor` y el contador "tienes N" de cofres **sin** reescribir `innerHTML` ni re-attachar listeners.
  Sustituye a `buildResourceShop()` en los handlers de moneda/XP/cofre (el rebuild completo solo queda
  en apertura de tienda y cambio de idioma, que es donde toca). Nuevo `tapThrottle(el, 200)` anti
  doble-disparo en XP y cofre.
- **AP-5 · Monedas compositor-only.** `.shopfx-coin` se pinta con `background-image` en el propio span
  del pool; eliminada la regla `.shopfx-coin img { filter: drop-shadow(…) }`. Antes eran 16 capas con
  filtro por compra (lo más caro de pintar en iOS); ahora capas puras transform/opacity.
- **AP-8 · Limitador de osciladores WebAudio.** `Sound.tone` respeta `MAX_OSC = 32` (contador `_osc`,
  decremento en `osc.onended`); por encima descarta el tono extra. Las cadenas de convergencias muy
  rápidas ya no crean ráfagas de nodos que congestionan el scheduler en el hilo principal.
- **AP-6 · Verificación del gameplay.** Confirmado por lectura de `styles.css`: `special-pulse` anima
  **solo opacity** (`@keyframes special-pulse { 50% { opacity: 1 } }`, `styles.css:1334`) y `slowdown-bob`
  **solo transform** (`styles.css:1387`); ambos apagados en `body.reduced-fx` (`styles.css:5547-5552`) y
  cortados en `body.perf-2` (`styles.css:5560-5565`); las ambientales, en `body.perf-1` (`styles.css:5559`).
  Nada que cambiar. *Residual menor fuera de alcance:* los glifos ⏳/⏰ (`::after`) llevan un
  `filter: drop-shadow` **estático** (pintado una vez, no animado) — coste puntual aceptable.

**Verificación:** `node --check game.js && node --check sw.js` OK · `node --test tests/animation-perf.test.js`
**6/6** verde (nuevo `tests/animation-perf.test.js`: pool fijo, cap con descarte, coalescing, count-up
cancelable, CSS de moneda). Suite completa 281/283 (los 2 fallos — `board-themes-redesign` — y los 3
errores de lint `Buffer` de `icon-packs.test.js` son **preexistentes**, verificado por `git stash`; ajenos
a este trabajo). `ShopFX` expuesto en `window.__cv` para test/depuración.

### Pendiente

- **AP-9 · Validación en dispositivo real.** Falta correr `node tools/perf-probe.js --assert 55` (requiere
  servir la app + Playwright) y una pasada en iPhone real con Safari Web Inspector → Timeline sobre la
  escena de estrés de la tienda (spamear compra) y de gameplay (encadenar). El emulado ×6 correlaciona,
  pero la palabra final es del compositor de WebKit.

---

## 6. Referencias cruzadas

- `QA_PERF_PLAN.md` §3 — rendimiento del **gameplay** (QP-2), del que este documento es continuación.
- `DESIGN_SYSTEM.md` — regla de animaciones (transform/opacity-only en `infinite`); ShopFX documentado ahí.
- `ARCHITECTURE.md` §4 — módulos `FX` (tablero) y `ShopFX` (tienda).
- `CLAUDE.md` — índice de documentación.
