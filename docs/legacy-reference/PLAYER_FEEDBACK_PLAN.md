# Plan de mejora intensivo — feedback del propietario (tareas FB-*)

> **Rol:** plan de implementación completo y autocontenido para corregir los 7 problemas reportados por el propietario el 2026-07-07 jugando la **v2.5.0**. Está pensado para que cualquier IA/desarrollador lo ejecute **sin re-investigar**: cada tarea trae síntoma, causa raíz verificada contra el código, corrección paso a paso, criterios de aceptación, pruebas y qué documentar al cerrar. Documento hermano de [`GAME_MODES_MASTER_PLAN.md`](./GAME_MODES_MASTER_PLAN.md) (GM-*) y [`QA_PERF_PLAN.md`](./QA_PERF_PLAN.md) (QP-*, B-*).
>
> **Método:** 5 investigaciones independientes del código de v2.5.0 (2026-07-07). Cada afirmación va etiquetada **[CONFIRMADO]** (traza completa leída en el código) o **[HIPÓTESIS]** (verificar antes de darla por cierta).
>
> ⚠️ **Sobre las líneas citadas:** todas son de **v2.5.0** (`game.js` = 5816 líneas; las líneas de `ARCHITECTURE.md` §4 son de v1.7.1 y están MUY desfasadas). Las líneas se desplazan con cada tarea completada: usa los **nombres de símbolo** (función / clase CSS / id de DOM) como ancla primaria y la línea como pista. Los módulos se localizan con Grep de los banners `/* ===== Nombre ===== */`.

---

## 0. Protocolo obligatorio para la IA implementadora

### 0.1 Antes de empezar

1. Lee `CLAUDE.md` (raíz del repo) completo. Resume las reglas del repo: vanilla puro, sin package.json, sin frameworks, un solo IIFE.
2. Lee la sección de la tarea que vas a ejecutar AQUÍ, y solo baja al código con los anclajes dados. **No leas `game.js` entero jamás** (5816 líneas).
3. Consulta bajo demanda: `MIGRATION_SPEC.md` (fórmulas/datos canónicos — si cambias una fórmula, actualízala ahí), `DESIGN_SYSTEM.md` (tokens/animaciones), `GAME_MODES_MASTER_PLAN.md` (intención de diseño por modo), `QA_PERF_PLAN.md` (reglas de rendimiento QP-2), `BALANCE_BASELINE.md` (métricas de referencia del simulador).

### 0.2 Comandos de verificación

| Acción | Comando | Cuándo |
|---|---|---|
| Tests | `node --test "tests/*.test.js"` | tras CADA tarea (hoy: 50/50 verde) |
| Lint | `npx --yes eslint@9 .` | tras cada tarea |
| Sintaxis | `node --check game.js` | tras cada tarea |
| Simulador de balance | `node tools/balance-sim.js --modes <modo> --runs 40` | antes/después de FB-2 y FB-6 (obligatorio) |
| Sonda de rendimiento | `node tools/perf-probe.js --assert 55` | tras FB-1 (obligatorio) |
| Servidor local | `python3 -m http.server 8080` → `http://localhost:8080/index.html?dev` | verificación manual; `?dev` expone `window.__cv` |

### 0.3 Reglas duras del repo (violarlas = tarea rechazada)

1. **i18n:** ninguna string nueva hardcodeada. Toda copy nueva se añade a `I18n.DICT` en **ES y EN** y se consume vía `I18n.t()` / `data-i18n`.
2. **Retrocompatibilidad de `cv_meta`:** campos nuevos deben auto-rellenarse al cargar perfiles viejos (patrón de migración en `Meta`, game.js:~1748–1790). Nunca rompas partidas guardadas.
3. **Sin dependencias, sin build.** Nada de npm installs ni bundlers.
4. **Animaciones (regla QP-2-j):** toda animación `infinite` debe ser transform/opacity-only y estar cubierta por `reduced-fx`; las one-shot pueden usar filter/box-shadow si duran <700 ms. Prohibido `backdrop-filter`.
5. **Economía meta con `Math.random`,** no con el PRNG seedeado (anti-exploit por semilla; comentario en game.js:~700). Aplica a cofres (FB-7).
6. **Cambios de balance:** correr `balance-sim` antes y después, comparar contra `BALANCE_BASELINE.md`, respetar el guardarraíl `tests/balance-guardrail.test.js` (mediana 52964 ±40%, umbrales de medalla verbatim). Si el guardarraíl requiere recalibración legítima, documentarla (precedente: v2.4.0 recalibró 60649→52964).
7. **Re-entrada/doble-tap:** todo botón nuevo que gasta o abre debe tolerar doble-tap sin doble efecto (patrón `armBuy`/limpiar `pending` antes del callback).

### 0.4 Release (bump de versión) — ⚠️ gotcha de Windows

Cualquier cambio a `game.js`/`styles.css` exige subir versión en **3 sitios a la vez**:
1. `VERSION` en `game.js` (línea ~19, hoy `'2.5.0'`),
2. `CACHE` en `sw.js` (`cv-cache-vX.Y.Z`),
3. los dos `?v=` de `index.html` (styles.css y game.js).

**`tools/bump-version.sh` FALLA en Git Bash de Windows** (usa `grep -oP`, no soportado): haz el triple bump **a mano** y verifica con grep que los 3 quedaron iguales. Mensaje de commit habitual: `Bump version to X.Y.Z; update cache version and asset links`. Recomendación: un bump por tarea entregada (2.5.1, 2.5.2, …; FB-7 puede ser 2.6.0 por ser feature).

### 0.5 Protocolo de documentación continua (OBLIGATORIO)

El propietario exige que el estado del trabajo sea siempre reconstruible por cualquier IA que abra el repo. Al cerrar **cada** tarea FB-*:

1. **Actualiza la tabla de estado** (§0.6) — ✅/fecha/versión.
2. **Añade una entrada al Registro de implementación** (§9 de este doc): qué se hizo, archivos tocados, tests añadidos, desviaciones respecto a este plan y POR QUÉ. Mismo formato que el registro de `GAME_MODES_MASTER_PLAN.md`.
3. **Sincroniza los docs afectados:** fórmulas/tablas nuevas → `MIGRATION_SPEC.md`; animaciones/clases nuevas → `DESIGN_SYSTEM.md`; balance re-medido → `BALANCE_BASELINE.md`; política de degradación de FX → `QA_PERF_PLAN.md` §3.3.
4. **Test de regresión:** cada bug corregido deja al menos 1 test que habría fallado antes del fix (patrón `tests/qp1-regression.test.js`). Sugerencia: agruparlos en `tests/fb-regression.test.js`.
5. **Si descubres que una causa raíz de este plan es incorrecta o incompleta:** NO diverjas en silencio — corrige la sección correspondiente de este documento y anota la corrección en §9.

### 0.6 Orden de ejecución y estado

Orden recomendado (bugs confirmados y baratos primero; balance al final porque exige iteración con el simulador):

**FB-5 → FB-3 → FB-1 → FB-6 → FB-4 → FB-7 → FB-2**

| # | Tarea | Tipo | Prio | Esf. | Estado |
|---|---|---|---|---|---|
| FB-1 | Paridad de la animación de convergencia móvil = PC | Bug percepción + política FX | P1 | 🟡 | ✅ 2026-07-07 · v2.6.0 · probe local bajo umbral |
| FB-2 | Ritmo de apertura del Contrarreloj | Balance | P1 | 🟡 | ✅ 2026-07-07 · v2.6.0 |
| FB-3 | Modal de fin de partida abre scrolleado (Supervivencia) | Bug UI | P1 | 🟢 | ✅ 2026-07-07 · v2.6.0 |
| FB-4 | Reto del día: objetivo ilegible + textos cortados | UX | P1 | 🟡🟡 | ✅ 2026-07-07 · v2.6.0 |
| FB-5 | Zen no arranca desde su selector (+ PreLevel latente) | **Bug P0** | **P0** | 🟢 | ✅ 2026-07-07 · v2.6.0 |
| FB-6 | Aventura: nivel 3 se supera "de golpe" y sin explicación | Balance + UX | P1 | 🟡 | ✅ 2026-07-07 · v2.6.0 |
| FB-7 | Cofres: compra sin feedback, revelación pobre, drops cosméticos | Bug UX + feature | P1 | 🟡🟡 | ✅ 2026-07-07 · v2.6.0 |

---

## 1. FB-1 · Paridad de la animación de convergencia móvil = PC

**Síntoma (reporte literal):** "en móvil no me hace la misma animación de convergencia que en PC; deben ser iguales, el móvil debe hacer lo mismo que el PC".

### Causa raíz [CONFIRMADO]

La cadena de feedback de una convergencia es: tap (`Input`, game.js:5126–5133) → `Game.activate` (4284) → `FX.converge` (anillo `#fx-wave` + esquirlas `_iconBurst` + camino `_spark` + `_miniBurst`; def. 1658) → `FX.scoreToHud` (1630) → vuelo de glyphs `Render.convergeFly` / `.fly-glyph` (1009; CSS styles.css:2663) → pop de celda `glyph-out` (styles.css:1208/1221) → popup de puntos WAAPI (`Render.popup`, 1089) → chip de combo (`Render.combo`, 1206).

**El vuelo, el anillo, el pop, el popup y el chip son IDÉNTICOS en móvil y PC** en cualquier nivel del gobernador `Perf`. Las diferencias reales, por orden de visibilidad:

1. **[Por ajuste — la diferencia dramática] `reduced-fx` activo** elimina TODAS las partículas (`body.reduced-fx .fx{display:none}`, styles.css:2569; guard en `FX.converge` game.js:1659) **y el vuelo completo** (guard en `convergeFly` game.js:1010 + `body.reduced-fx .fly-glyph{display:none}`, styles.css:2673). Queda solo "icono encoge + número + chip" — exactamente "otra animación". Y `reduced-fx` puede estar activo **sin decisión consciente** por dos vías: (a) su **default hereda `prefers-reduced-motion` del SO** (game.js:257–259) — en iPhone con "Reducir movimiento" activado, el juego recorta solo en ese dispositivo; (b) el **toast de auto-sugerencia** del gobernador (`Perf.suggestLight`, game.js:3948–3957) lo activa con un tap y lo deja **permanente** (persiste en `cv_settings`; el toast no reaparece: flag `cv_perf_suggested`).
2. **[Siempre en móvil dpr≥3 táctil] Menos partículas por burst:** `Perf` arranca en nivel 1 (game.js:3914–3920) → `FX.cap` 28 vs 40–50 en PC (`CAP=[50,28,18]`, 3907–3913). Los emisores del pool descartan partículas al llegar al cap (`_emit` 1429, `_spark` 1523, `_flyStar` 1552, `_beam` 1589). Se pierden esquirlas/camino/mini-burst en eventos grandes; **nunca** se pierden glyphs del vuelo (pool propio de `Render`, sin cap, game.js:1013). Con buen rendimiento el móvil baja a nivel 0 tras ~5 s (`_bootGuard`, 3943) — la diferencia permanente queda acotada al arranque y a momentos de carga.
3. **[Hallazgo lateral — código muerto]** `body.perf-2 .popup.show → popup-float-flat` (styles.css:2626) **nunca aplica**: los popups son WAAPI sin clase `.show` (game.js:922–926, 1100). El popup ya es idéntico en todas partes; la regla es ruido.

### Decisión de diseño (aprobada por este plan)

**El feedback de convergencia es sagrado:** con los mismos ajustes de usuario, la convergencia debe verse idéntica en cualquier dispositivo. El gobernador `Perf` solo puede degradar decorativos (ambientales de tablero, pulsos de tiles, confeti de celebración). Esto MODIFICA la política de QA_PERF_PLAN §3.3 ("perder motas antes que perder el vuelo" se mantiene; "menos motas en gama baja" deja de aplicar al burst de convergencia) — actualizar ese doc al cerrar.

### Corrección paso a paso

1. **Paso 0 — diagnóstico en el dispositivo del propietario** (si hay acceso; si no, implementa igual): abrir `?dev` en el móvil y en PC y comparar en consola: `__cv.Settings.reducedFx`, `document.body.className` (buscar `reduced-fx`/`perf-1`/`perf-2`) y `matchMedia('(prefers-reduced-motion: reduce)').matches`. Anotar el resultado en §9 (confirma cuál de las capas actúa en su caso).
2. **Presupuesto de burst idéntico (la corrección central):** en `FX`, los emisores usados por la cadena de convergencia (`converge` → `_beam`/`_iconBurst`/`_spark`/`_miniBurst`, y `scoreToHud` → `_flyStar`) dejan de comprobar `this.cap` y pasan a comprobar un techo duro absoluto común, p. ej. `FX.ABS_MAX = 140` partículas activas (backstop anti-runaway; los bursts viven 300–700 ms). Implementación sugerida: parámetro `force` en `_emit`/`_spark`/`_flyStar`/`_beam` que cambia el guard `active >= cap` por `active >= ABS_MAX`; `converge`/`scoreToHud` emiten con `force`. `celebrate`/`confetti` y cualquier FX ambiental siguen acotados por `cap` (ahí el gobernador conserva su función).
3. **Transparencia de `reduced-fx` (que nunca esté activo "en silencio"):**
   - Si `reducedFx` está activo por **default heredado del SO** y el usuario nunca lo fijó explícitamente (verificar cómo distingue el blob de `Settings` un valor guardado de un default, game.js:~236–266): mostrar un toast informativo **una sola vez** (flag en localStorage, p. ej. `cv_rfx_notice`): ES "Efectos reducidos por el ajuste del sistema · cámbialo en Ajustes" / EN equivalente. Claves i18n nuevas.
   - Al aceptar el toast de auto-sugerencia (`Perf.suggestLight`): verificar que el toast de confirmación existente (`perf_light_on`, game.js:365/509) menciona que se puede revertir en Ajustes; si no, ajustar la copy ES+EN.
4. **Limpiar el código muerto:** eliminar `body.perf-2 .popup.show {…}` (styles.css:2626); comprobar con grep si `.popup.show` (styles.css:1360) tiene algún consumidor real antes de decidir si se elimina también. Los popups quedan (correctamente) idénticos en todos los niveles.
5. **NO tocar:** el arranque en perf-1 para dpr≥3 (solo afecta al glow ambiental del tablero + cap de decorativos tras el paso 2 — aceptado como frontera: lo decorativo puede degradarse bajo carga real para proteger los 60 FPS), el `reduced-fx` como opción (sigue cortando vuelo y partículas: es su función), ni la media query `prefers-reduced-motion` de CSS (styles.css:2637 — capa de accesibilidad).

### Criterios de aceptación

- Con `reducedFx` OFF y mismos ajustes: una convergencia de N iconos emite exactamente el mismo plan de partículas (misma cuenta de esquirlas/camino/estrellas) con `FX.cap` 18 que con 50 — verificable por test unitario (mock de emisión contando llamadas bajo caps distintos).
- `node tools/perf-probe.js --assert 55` pasa tras el cambio (guardarraíl QP-2). **Plan B si falla:** en vez de bypass del cap, unificar el plan de burst a un valor común más bajo para TODAS las plataformas (p. ej. tope de esquirlas por icono 20→14) — la paridad es prioridad; la riqueza absoluta es secundaria.
- El toast de aviso de `reduced-fx` heredado del SO aparece exactamente una vez y solo cuando aplica.
- Suite completa verde (los 8 tests de `tests/qp2-perf.test.js` incluidos; si cambias listas de `reduced-fx` o el clamp, actualiza esos tests con justificación en §9).

### Pruebas

- Unit: nuevo test en `tests/qp2-perf.test.js` o `tests/fb-regression.test.js`: paridad del plan de emisión bajo caps distintos; `ABS_MAX` respetado.
- Manual: DevTools con emulación móvil (touch + dpr 3) vs escritorio — grabar/observar una convergencia de 3–4 iconos con combo: misma secuencia visual completa.
- Manual: activar "Reducir movimiento" en el SO → el juego avisa una vez; desactivar `reducedFx` en Ajustes → paridad total.

### Documentación al cerrar

`QA_PERF_PLAN.md` §3.3 (política nueva de degradación), `DESIGN_SYSTEM.md` (regla "el feedback de convergencia no se degrada"), claves i18n nuevas en §9, bump de versión.

---

## 2. FB-2 · Ritmo de apertura del Contrarreloj

**Síntoma:** "empieza muy lento, se hace demasiado lento el inicio de partida y hacer puntos; buscar balance para que tampoco se complique nada más empezar".

### Causa raíz [CONFIRMADO — con números]

No es que el tablero arranque vacío (arranca con 18 iconos, ~28% de ocupación: `Engine.placeInitial(DIFFICULTY.normal.initialIcons)`, game.js:4095; `initialIcons:18`, game.js:128). Lo lento es **puntuar**, por la suma de:

1. **Base de puntos minúscula y PLANA:** `base = removed×10×State.level` (game.js:4345) y en Contrarreloj `State.level` **se queda en 1 toda la partida** (`evaluate()` retorna antes del check de nivel para scoreAttack, game.js:4703–4707) → convergencia base ≈ 24 pts (con `mult` 1.2 del modo). La variedad también queda fija en 4 tipos (`varietyFor(1)=4`, game.js:758–760).
2. **El combo se cae entre spawns:** tras limpiar las convergencias fáciles iniciales llega 1 icono cada ~2.75 s (warm-up, primeros 10 s) → ~4.2–4.6 s (t=10–20 s) (`spawnRate = 5000×0.92^(elapsed/10)` clamp [300, 5000], game.js:4612; `warmupFactor` ×0.55, game.js:4274–4282), mientras la ventana de combo es 3.5 s (`comboWindow:3500`, game.js:128) → el multiplicador se resetea a ×1 entre spawns (Loop, game.js:3999–4001). Es el "dead-air post-limpieza" ya medido: **77%/57%/26% de tiempo muerto** (skilled/average/casual) — `BALANCE_BASELINE.md` hallazgo #2, que ya propone la solución ("escalar el ritmo de spawn con la velocidad de consumo del jugador — DDA suave").
3. El reloj no presiona al inicio (60 s iniciales + reposición +5…10 s por convergencia con decay=1) — correcto, no tocar.

### Corrección paso a paso

⚠️ `Config.DIFFICULTY.normal` y `Config.WARMUP` son **globales a todos los modos** — no se tocan. Todo se scopea al modo:

1. **DDA suave por hambre de tablero (la palanca principal, sancionada por BALANCE_BASELINE #2):** registrar para los modos `scoreAttack` el hook `spawnFactor` (ya existe la infraestructura: `Rules.call('spawnFactor')` en el Loop, game.js:3994–3998; la ruta de Aventura ya lo usa). Lógica propuesta: con `n = State.iconCount` (o el contador de ocupación equivalente que use `Engine`):
   - `n ≤ 10` → factor `0.55` · `n ≤ 16` → `0.75` · `n ≥ 30` → `1.1` · resto → `1.0`.
   - Devolver `1.0` mientras `elapsed < Config.WARMUP.ms` para **no apilarse** con el warm-up existente.
   - Efecto: rellena el hueco tras cada limpieza (el momento exacto del dead-air) y, como al final de partida el tablero va lleno, el factor tiende a 1 → **no toca la dificultad tardía** por construcción.
2. **Más material inicial solo en este modo:** permitir override por modo, p. ej. `Config.MODES.contrarreloj.initialIcons = 24`, consumido en `setupLevel` (game.js:4095) como `mode.initialIcons ?? d.initialIcons`. (El Reto del día hereda esto automáticamente: usa el mismo modo con seed de fecha.)
3. **NO tocar:** `spawnStart` (acelera toda la curva → dificultad tardía), `COMBO_MULTIPLIERS`/`comboWindow`/`FEVER_COMBO` (globales, romperían el balance de los demás modos), `varietyFor` (más tipos = MENOS convergencias).

### Validación de balance (obligatoria, criterio de cierre)

1. **Antes de tocar nada:** `node tools/balance-sim.js --modes contrarreloj --runs 40` → guardar salida como referencia (comparar con `BALANCE_BASELINE.md`: sc p50 246131/129463/20440 skilled/average/casual, deadAir 77/57/26%, dur50 240 s).
2. Tras el cambio, mismos comandos. Criterios:
   - `deadAir` (average) baja ≥ 10 puntos porcentuales;
   - `sc p50` (average) sube ≤ +15% (si sube más, suavizar los factores del paso 1);
   - `dur50` estable ±15%.
3. **Guardarraíl de medallas:** `tests/balance-guardrail.test.js` debe pasar; si la mediana calibrada (52964 ±40%) exige recalibración, documentarla en §9 y en `BALANCE_BASELINE.md` con la batería nueva completa. Nota de contexto: los umbrales de medalla del reto (750/1500/2500, `Meta.dailyMedal` game.js:1891–1893) están calibrados para humanos, no para los bots (superhumanos); vigila el cambio RELATIVO del score, no el absoluto, y avisa en §9 si la inflación supera el 15%.
4. El Reto del día comparte motor: verificar 1 partida manual del reto tras el cambio (mutadores intactos, misma semilla = mismo tablero).

### Criterios de aceptación (jugables)

- En los primeros 30 s de una partida nueva (normal), un jugador medio encadena su primer combo ×1.5 sin esperar parado al spawn.
- La fase final (t>120 s) se siente igual que hoy (sin aceleración extra).

### Documentación al cerrar

`MIGRATION_SPEC.md` (nueva regla DDA + initialIcons por modo, con números exactos), `BALANCE_BASELINE.md` (batería nueva), `GAME_MODES_MASTER_PLAN.md` §3.3 (nota de que el arranque frío D2 se cerró con DDA), §9 de este doc.

---

## 3. FB-3 · Modal de fin de partida abre scrolleado al medio (Supervivencia)

**Síntoma:** "el modal de fin de partida en supervivencia aparece scrolleado hacia el medio y el inicio hay que ir a buscarlo arriba".

### Causa raíz [CONFIRMADO]

`Modal.open()` (game.js:1346–1354) enfoca el **primer** elemento enfocable en orden de documento: `m.querySelector('button:not([disabled]), [href], input')` y llama `focusable.focus()` **sin `preventScroll`** (game.js:1352–1353). En `#modal-over` (index.html:364–383), `Game.fillStats()` (game.js:5011–5090) inyecta ANTES de abrir botones dentro de `#over-next` (final del `.modal-body`, vía `NextActions.html`, game.js:3545/3513). Como `.modal-body` es el único contenedor scrolleable (`overflow-y:auto`, styles.css:1458) y ese botón está al fondo, el navegador scrollea el body para revelarlo. Se nota en Supervivencia porque su resumen es el más alto (7 tiles + recompensas + peak + XP + next; game.js:5046–5067). Agravante posible: `scrollTop` persiste entre aperturas (los modales se ocultan, no se destruyen).

### Corrección (genérica — arregla todos los modales)

En `Modal.open()` (game.js:1346–1354):

1. Antes de enfocar: `const body = m.querySelector('.modal-body'); if (body) body.scrollTop = 0;`
2. Preferir el CTA del footer: `const focusable = m.querySelector('.modal-actions button:not([disabled])') || m.querySelector('button:not([disabled]), [href], input');`
3. `focusable.focus({ preventScroll: true });`

No tocar la captura/restauración de foco existente (accesibilidad).

### Criterios de aceptación

- Fin de partida en Supervivencia (con resumen largo): el modal abre mostrando título y `#over-reason`/`#over-stats` arriba; el foco queda dentro del modal (en el CTA del footer).
- Sin regresión en el resto de modales (pausa, nivel completado, ajustes, tienda, cofres): abrir y cerrar cada uno una vez.

### Pruebas

- Test de regresión en `tests/fb-regression.test.js`: sobre el dom-stub, `Modal.open('modal-over')` deja `scrollTop === 0` en el `.modal-body` y el elemento enfocado pertenece a `.modal-actions` (extender `tests/dom-stub.js` si le falta `scrollTop`/`focus` — hay precedente: se le añadieron getters `firstChild`/`lastChild` para GM-30).
- Manual: partida corta de Supervivencia → morir → verificar.

### Documentación al cerrar

Entrada en §9. Sin cambios de spec (comportamiento, no reglas).

---

## 4. FB-4 · Reto del día: objetivo ilegible + textos cortados

**Síntoma:** "no se ve cuál es su objetivo ni cómo completarlo, genera frustración; los textos del modo están en línea con elipsis cada uno".

### Causa raíz [CONFIRMADO]

1. **El objetivo nunca se comunica antes o durante la partida.** Los umbrales de medalla (750/1500/2500, `Meta.dailyMedal`, game.js:1891–1893) aparecen por primera vez **al terminar** (`dailyResultHtml` → "Siguiente medalla: supera {n}", game.js:3475–3481). Antes de jugar, la tarjeta del home solo dice "Tablero de hoy · ¡juégalo! · 🎲 <mutador> · 🔥<racha>" (game.js:5336–5355); durante la partida, el banner dice "Reto diario: bronce, plata u oro" **sin números** (`mode_note_daily`, game.js:332, vía `noteText` 3452). El efecto del mutador solo se cuenta en un toast fugaz al arrancar (game.js:4186). El ghost (▲/▼, `#hud-ghost`) existe pero nadie explica qué es. El +5💎 del primer intento solo se descubre después (game.js:4973).
2. **Textos cortados [CONFIRMADO, dos superficies]:** (a) en la pantalla de modos, la tarjeta de Contrarreloj usa `.mc-badge` con `nowrap+ellipsis` (styles.css:662) y `.mc-desc` con line-clamp a 2 líneas (styles.css:663); además `.mc-feats{display:none}` en móvil (styles.css:717) oculta el chip "Incluye el Reto del día". (b) En el home, `#home-daily-state` concatena estado+mutador+racha en un solo `<small>` dentro de `.app-card` con `overflow:hidden` y altura fija (156 px desktop / 98 px en pantallas bajas; styles.css:369–385, 465) → el texto envuelve y se **recorta** por altura. [HIPÓTESIS menor: cuál de las dos superficies vio exactamente el propietario — corrige ambas.]

### Corrección paso a paso

**FB-4a · Ficha previa del reto (la pieza central).** Nuevo modal estático `#modal-daily` en `index.html` (copiar patrón de `#modal-surv-diff`) + constructor `buildDailyInfo()` junto a los demás constructores de menú. Contenido: fecha de hoy; línea "El mismo tablero para todos — cambia a medianoche"; **mutador del día con nombre Y efecto** (reusar claves `dmut_<id>`/`dmut_<id>_n`, game.js:400); **medallas con umbrales explícitos** (🥉 750 · 🥈 1500 · 🥇 2500) marcando la ya conseguida hoy; mejor marca de hoy + ghost ("tu fantasma: tu mejor intento de hoy"); racha 🔥n con nota de congelación ética; "+5 💎 primer intento del día" si aún aplica; botón **Jugar** (→ `startDaily`, game.js:4176) y Volver. Rutas de entrada: la tarjeta del home (`data-act="home-daily"`) y el botón "Jugar" del panel de misiones (game.js:5374–5389) pasan a abrir esta ficha en vez de lanzar directo. Los umbrales se leen de una constante única nueva `Meta.DAILY_MEDALS = [750,1500,2500]` consumida también por `dailyMedal` (⚠️ el guardarraíl `tests/balance-guardrail.test.js` verifica los umbrales verbatim — actualizar el test al refactorizar, sin cambiar los valores).

**FB-4b · Objetivo vivo durante la partida.** Con `State.isDaily`: el `note` del banner (`#obj-banner`) muestra la siguiente medalla con número ("🎯 Siguiente: 🥉 750") y se actualiza al cruzar cada umbral (hook barato en `Game.evaluate` tras actualizar score, solo para isDaily), con un toast por umbral cruzado ("¡Medalla de bronce! Siguiente: 1500", una vez por partida y umbral). Claves i18n nuevas ES+EN (p. ej. `daily_note_next`, `daily_medal_up`, `daily_medal_max`).

**FB-4c · Textos sin cortes.**
- Home: reestructurar `#home-daily-state` (game.js:5336–5355) en 2 líneas cortas — línea 1 estado ("Hoy: ¡juégalo!" / "✅ Oro · 2.8k"), línea 2 "🎲 Hielo · 🔥3" — con CSS que permita 2 líneas sin recorte dentro de `.app-card` (revisar `min-height`/tamaños de styles.css:369–385, 457, 465).
- Pantalla de modos: `.mc-desc` puede quedarse en clamp de 2 líneas **si** la copy cabe — acortar las descripciones ES/EN que no quepan a 360 px; `.mc-badge`: permitir reducción de fuente o ancho en vez de elipsis; `.mc-feats` en móvil: sustituir el `display:none` (styles.css:717) por una variante compacta de una línea (el chip del reto debe ser visible en móvil).
- **Criterio duro:** a 360 px de ancho, en ES y EN, ninguna superficie del reto muestra texto truncado (ni elipsis ni recorte por altura).

### Pruebas

- Unit: paridad i18n de todas las claves nuevas (la suite ya tiene test de paridad ES/EN); test del cálculo "siguiente medalla" (750/1500/2500/max).
- Manual: viewport 360×740 — home, pantalla de modos, ficha del reto, partida del reto (banner con número, toast al cruzar 750), resultado. Repetir en EN.
- Regresión: reintentar el reto conserva semilla y mutador (matriz QA_PERF_PLAN §2.2 ⭐).

### Documentación al cerrar

`MIGRATION_SPEC.md` (nueva superficie ficha del reto + constante DAILY_MEDALS), `GAME_MODES_MASTER_PLAN.md` §3.4 (nota: comunicación del ritual cerrada), §9.

---

## 5. FB-5 · Zen no arranca desde su selector (P0) — y bug latente de PreLevel

**Síntoma:** "ZEN no se puede abrir desde su selector en modos de juego, y al elegir cualquier otro modo después de intentar jugar ZEN, se abre el selector de ZEN y ahí sí empieza".

### Causa raíz [CONFIRMADO — traza completa]

`#pick-overlay` (el overlay del `Picker`) vive **dentro de `#screen-game`** (index.html:253, dentro de la section 187–304). CSS: `[hidden]{display:none!important}` (styles.css:48) — con `#screen-game` oculto, el overlay no genera caja aunque sea `position:fixed` (styles.css:1525).

Secuencia del bug: tap en Zen → `launchZen()` (game.js:5162–5176) llama `Picker.open()` **antes** de cualquier `Screens.show('game')` → el picker queda armado (`pending`, game.js:3562) y con `hidden=false` (3575) pero **invisible** (ancestro oculto) → "no pasa nada". Tap en otro modo → su flujo llega a `Game.start()` → `Screens.show('game')` (game.js:4159) revela la pantalla **con el picker de Zen ya encima** (Game.start no llama `Picker.dismiss()`) → eliges ritmo → `onPick` ejecuta `Game.start('zen', d)` (5174) **pisando** la partida recién iniciada. `Picker.open` no tiene guarda (sobrescribe `pending` incondicionalmente).

**Bug latente hermano [CONFIRMADO por código, verificar manualmente]:** `#prelevel` (index.html:263) también vive dentro de `#screen-game`, y `PreLevel.open` se invoca desde el **mapa de mundos** (game.js:3336) — con `PRELEVEL_FROM_WORLD:1` (game.js:122) la hoja aplica desde el 2º mundo → **hoja invisible = los niveles del mundo 2+ no se pueden lanzar**. No reportado aún porque exige 25 niveles de progresión. Verificación: con `?dev`, desbloquear mundo 2 vía `__cv` y tocar un nivel.

Los usos in-game del Picker (bendiciones, rutas, reliquias, continuar) NO están afectados (siempre abren con `#screen-game` visible) [CONFIRMADO].

### Corrección

1. **Estructural (arregla Zen y PreLevel a la vez, sin JS):** en `index.html`, mover `#pick-overlay` (253–260) y `#prelevel` (263–273) **fuera** de `#screen-game` — colocarlos como últimos hijos antes de `</main>` (306), junto al resto de capas globales. Ambos son `position:fixed; inset:0`: cero cambio visual in-game. Verificar stacking: `.pick-overlay` z-index 74 debe quedar por encima de cualquier pantalla y convivir con `#overlay`/modales (no deberían coexistir: `launchZen` hace `Modal.close()` primero, game.js:5163).
2. **Defensa en profundidad:** al inicio de `Game.start()` (game.js:4115), llamar `Picker.dismiss()` (idempotente, B-06) y ocultar `#prelevel` si está abierto. Orden verificado: `Picker.pick` limpia `pending` ANTES del callback (QP-1), así que el `dismiss` dentro de `Game.start` lanzado desde `onPick` es inocuo.

### Criterios de aceptación

- Desde la pantalla de modos: tap en Zen → el selector de ritmo aparece INMEDIATAMENTE sobre esa pantalla; "Volver" (B-05) funciona; elegir ritmo arranca Zen.
- Tras cancelar Zen, elegir cualquier otro modo arranca ESE modo sin rastro del picker.
- Con mundo 2 desbloqueado (`?dev`): tocar un nivel muestra la hoja PreLevel sobre el mapa; comprar/jugar funciona.
- In-game: bendición de Supervivencia (tras evento jefe) y ruta/reliquia de Aventura siguen apareciendo bien.

### Pruebas

- Test estructural en `tests/fb-regression.test.js`: leer `index.html` como texto y afirmar que `#pick-overlay` y `#prelevel` NO están dentro de la section `#screen-game` (parseo por índices de string es suficiente).
- Manual: la secuencia del bug original, dos veces seguidas (re-entrada limpia).

### Documentación al cerrar

`ARCHITECTURE.md` §7 (los overlays Picker/PreLevel son capas globales, no hijas de una pantalla), §9.

---

## 6. FB-6 · Aventura: el nivel 3 se supera "de golpe" y sin explicación

**Síntoma:** "termina el nivel 3 de forma abrupta como superado con un par de convergencias, sin dejar claro por qué; parece un bug".

### Causa raíz [CONFIRMADO — no es un bug de estado, son dos defectos de diseño]

1. **El objetivo es intrínsecamente bajo.** El nivel 3 (lic 2 del capítulo 1) es el primer objetivo de tipo `score`: `target = 250 + chapter*120 + lic*40` = **330 pts** (game.js:2468, 2476–2478). Con la fórmula de puntos (`removed×10×State.level`, ×1.1 del modo — game.js:4345, 137) el nivel 3 da ~99–171 pts por convergencia → **2 convergencias en Difícil, 3 en Normal**. Literalmente "un par". Defecto estructural: el score por convergencia escala LINEALMENTE con `State.level`, pero el target crece casi plano → los niveles `score` se trivializan más cuanto más avanzas. Los contadores están bien: `levelScore0` se fija correctamente en cada `Adventure.setup()` (game.js:2460) y `nextLevel` no filtra score (game.js:4922–4943); el fix B-02 (reanudación) sigue intacto y no aplica aquí [CONFIRMADO].
2. **La victoria es inexplicable para el jugador.** El chip de objetivo muestra "Consigue 330 pts" **estático, sin progreso** (`objectiveText`, game.js:2516–2524 — contraste: el objetivo boss sí es vivo "({n})"), mientras el HUD muestra el score **acumulado de la run** (no se resetea entre niveles) → es imposible mapear "330" contra lo que ves. Y el modal de nivel completado dice solo "Nivel 3 superado" sin el motivo (`Game.levelComplete`, game.js:4805–4823).

### Corrección paso a paso

1. **Rebalance del target `score`** (game.js:2476): nueva fórmula **escalada por nivel**: `target = State.level * (300 + 50 * chapter)` (redondear). Valores resultantes: L3(ch0)=900 (~7–9 convergencias en Normal), L8(ch1)=2880 (~9–11), L13(ch2)=5460 (~11–13) — dificultad en rampa suave y consistente. Verificar el comportamiento al reanudar una run guardada de versión anterior (el target se recalcula en `setup` — aceptable; anotar en §9).
2. **Objetivo vivo:** para `score`, `objectiveText` pasa a incluir progreso: "Puntos: {p}/{n}" con `p = State.score − levelScore0` (clave i18n nueva `obj_score_live` ES+EN; `refreshGoal` ya se llama en cada `winCheck` tras cada convergencia — game.js:140, 2525 — así que el contador se actualiza gratis).
3. **Motivo en el modal de nivel:** en `Game.levelComplete`, añadir línea de motivo según `Adventure.objective`: "Objetivo cumplido: {n} pts" / "Tablero vaciado" / "Cristales del jefe destruidos" / "Has resistido {n}s" (claves i18n `level_reason_score|clear|boss|survive`, ES+EN).

### Validación de balance (obligatoria)

- `node tools/balance-sim.js --modes aventura --runs 40` antes/después (verificar el nombre exacto del modo que acepta el flag en `tools/balance-sim.js` — el sim cubre Aventura desde v2.3.0). Criterios: el bot average necesita ≥6 convergencias para cerrar el L3; la progresión global (niveles superados por run) no cae >25%; duración media de run estable.
- `tests/qp1-regression.test.js` (B-02) sigue verde.

### Criterios de aceptación

- En una run nueva Normal, el nivel 3 requiere un esfuerzo comparable a los niveles `clear` vecinos (~1 min de juego), con contador visible llenándose y modal que explica la victoria.

### Documentación al cerrar

`MIGRATION_SPEC.md` (fórmula nueva del objetivo score — es fuente de verdad numérica), `GAME_MODES_MASTER_PLAN.md` §3.2 (nota), `BALANCE_BASELINE.md` si la batería cambia, §9.

---

## 7. FB-7 · Cofres: compra sin feedback, revelación pobre, drops cosméticos

**Síntoma:** "la compra de cofres no funciona; los cofres que abro no dejan claro qué he obtenido ni dan satisfacción; deberían poder tocar cosméticos con probabilidad muy baja".

### Causa raíz [CONFIRMADO]

1. **La compra NO está rota — es un no-op silencioso.** El flujo completo funciona con ≥25 gemas (botón `#btn-open-premium` index.html:474 → listener en init game.js:5749 → `doOpenPremiumChest` 5582 → `Meta.openPremiumChest` 1877, gasta 25💎 y da loot). Pero `buildChests()` lo **deshabilita** con <25 gemas (`pb.disabled = Meta.gems() < 25`, game.js:5579) → un `<button disabled>` no dispara click: sin toast, sin sonido, sin explicación. La rama de feedback "no_gems" (5584) es **inalcanzable**. Ídem el botón normal con 0 cofres (`ob.disabled = n <= 0`, game.js:5575; rama `chests_none` 5593 inalcanzable). Como las gemas son escasas, el estado habitual del botón es ese silencio → "no funciona".
2. **Revelación pobre:** no hay animación de apertura (solo un wobble idle `chestWobble`, styles.css:2079–2080); al abrir: `FX.confetti` genérico que cae desde arriba de la pantalla (no anclado al cofre) + **un toast de texto plano de ~2.2 s** (game.js:5586/5595) — fácil de perderse; con `reduced-fx`, solo el toast. Sin jerarquía de rareza (el jackpot premium de 600–999 monedas se ve igual que 60 monedas).
3. **Tablas de loot actuales** (canónicas también en `MIGRATION_SPEC.md` §4:252–264): normal (`Meta.openChest`, game.js:1860–1874): 62% monedas 60–199 · 30% gemas 3–10 · 8% ticket ×1. Premium (`openPremiumChest`, 1877–1888): 55% monedas 200–499 · 30% tickets ×2 · 15% jackpot 600–999. La tabla premium NO está documentada en el spec (añadirla).

### Corrección paso a paso

**FB-7a · Compra con feedback (mata el "no funciona"):**
1. Eliminar el `disabled` de ambos botones (game.js:5575, 5579); sustituir por clase visual `is-poor` (atenuado + precio en rojo, CSS nuevo) manteniéndolos clicables.
2. Con fondos insuficientes, el tap ejecuta las ramas de feedback ya escritas (hoy inalcanzables): `no_gems` / `chests_none` + `Sound.miss`. Ampliar la copy con una pista accionable de DÓNDE conseguirlo (verificar las fuentes reales antes de escribirla: cofres = oleada 10 de Supervivencia game.js:2705, mundo completado 3356, racha 7 días del reto 1918–1926, 10 flores zen 4758; gemas = ver fuentes en `MIGRATION_SPEC.md` §4). Claves i18n nuevas ES+EN.
3. Anti doble-tap: deshabilitar ambos botones solo DURANTE la secuencia de revelación (~1 s) y re-habilitar al terminar.

**FB-7b · Revelación satisfactoria (sin modal nuevo, dentro de `#chests-body`):**
1. Secuencia al abrir: (i) el cofre grande reproduce una animación one-shot de apertura ~500 ms (transform/opacity only — regla §0.3.4; puede usar un destello con filter <700 ms); (ii) al terminar, `#chests-body` renderiza una **tarjeta de recompensa persistente**: icono grande del premio + "+120 🪙" + tinte de rareza (común / jackpot dorado / cosmético especial) + botón "Seguir" que re-renderiza `buildChests()`; (iii) confetti como acento (mantener `FX.confetti`, respetando cap/reduced-fx).
2. Con `reduced-fx`: sin animación ni confetti, pero la **tarjeta persistente se muestra igual** (es información, no decoración) — esto arregla el "no sé qué me ha tocado" en todos los perfiles.
3. Sonido: reutilizar `Sound.success`; jackpot/cosmético con capa extra (p. ej. `Sound.fanfare` sintetizado si existe, o success + celebrate).
4. i18n: claves de la tarjeta (título, rarezas, "Seguir") ES+EN.

**FB-7c · Drops cosméticos raros:**
1. Nuevas tablas (actualizar también `MIGRATION_SPEC.md` §4 — incluida la premium que faltaba):
   - Normal: **60%** monedas 60–199 · **30%** gemas 3–10 · **8%** ticket ×1 · **2% cosmético**.
   - Premium: **52%** monedas 200–499 · **30%** tickets ×2 · **10%** jackpot 600–999 · **8% cosmético**.
2. Pool del drop cosmético: skins de tablero no poseídos y no `exclusive` (`Boards.DEFS`, game.js:2300–2311 — excluye `classic` gratis y `jardin` exclusivo del Jardín Zen) **+** temas no poseídos (`Themes.DEFS`, game.js:2270–2275, excluye `default`). Elección uniforme con `Math.random` (regla §0.3.5). **Pool vacío (todo poseído):** fallback normal→gemas 8–15; premium→rama jackpot.
3. Concesión programática: tableros → `Meta.grantBoard(id)` **ya existe** (game.js:1968, usado por el skin zen); temas → crear helper simétrico `Meta.grantTheme(id)` (marca `cosmetics.owned[id]` con fecha ISO, como hace `buy` game.js:1982 — respetar el formato de cada colección: boards guardan `1`, temas guardan fecha).
4. Revelación del cosmético: tarjeta especial "✨ ¡COSMÉTICO!" con nombre + botón **Equipar** (→ `equipBoard`/`equip` + `Boards.apply`/`Cosmetics.apply`) además de "Seguir". La tienda ya refleja lo poseído sin cambios (lee `owned`).
5. Nota de economía (documentar): un drop del 2%/8% apenas canibaliza la tienda de monedas (sumidero D5 del MASTER_PLAN) y le da a los cofres su "momento lotería". No añadir pity timer en esta iteración.

### Pruebas

- Unit (con `Math.random` stubbeado para forzar ramas): fronteras exactas de ambas tablas; drop cosmético concede y NO repite poseídos; fallback con pool vacío; premium sin gemas → `null` sin roll ni gasto; `grantTheme` idempotente; formatos de `owned` correctos (board=1, theme=fecha).
- Manual: comprar sin gemas (feedback + pista), abrir normal/premium/jackpot/cosmético (forzar con `?dev` stubbeando `Math.random` en consola), equipar desde la tarjeta, verificar tienda y `reduced-fx`.
- Paridad i18n de todas las claves nuevas.

### Documentación al cerrar

`MIGRATION_SPEC.md` §4 (tablas completas nuevas, normal y premium, + helpers grant), `DESIGN_SYSTEM.md` (animación de apertura y tarjeta de revelación), §9.

---

## 8. Hallazgos laterales de la investigación (no bloquean, no perder)

| # | Hallazgo | Estado | Acción |
|---|---|---|---|
| L-1 | Regla CSS muerta `body.perf-2 .popup.show` (styles.css:2626) — los popups son WAAPI sin `.show` | [CONFIRMADO] | Se elimina en FB-1 paso 4 |
| L-2 | `#prelevel` invisible desde el mapa de mundos (mundo 2+) — **bloqueante latente de progresión** | [CONFIRMADO por código] | Se arregla en FB-5 (misma corrección estructural); verificar manualmente con `?dev` |
| L-3 | Los umbrales de medalla del reto (750/1500/2500) son frágiles ante cambios de score (ya avisado en MASTER_PLAN §3.4-3) | [CONFIRMADO] | FB-2 y FB-6 deben pasar el guardarraíl; FB-4a los centraliza en `Meta.DAILY_MEDALS` |
| L-4 | B-07 (racha del reto "viva" tras 2 días sin jugar) sigue abierto en QA_PERF_PLAN §2.1 | [SOSPECHA, heredado] | Fuera de alcance FB; buen candidato al terminar |
| L-5 | El confeti ya NO escala por `FX.cap/50` (QA_PERF_PLAN §3.4-f describe una versión anterior); hoy es `Math.min(n, cap)` (game.js:1476–1478) | [CONFIRMADO] | Corregir la mención al actualizar QA_PERF_PLAN en FB-1 |

---

## 9. Registro de implementación (bitácora — actualizar SIEMPRE)

> Plantilla por entrada:
> ```
> ### AAAA-MM-DD — FB-X implementada (vX.Y.Z)
> - Qué se hizo (por paso del plan; desviaciones y por qué)
> - Archivos tocados · claves i18n nuevas (ES+EN)
> - Tests añadidos/actualizados (nombre + qué protegen) · resultado de suite/lint/sim/probe
> - Docs sincronizados (cuáles y qué sección)
> - Pendiente/notas para la siguiente IA
> ```

### 2026-07-07 — Plan creado (sobre v2.5.0, rama `clon-vanilla`)

- Investigación de causas raíz completada con 5 análisis paralelos del código v2.5.0; los 7 reportes del propietario quedan mapeados a FB-1…FB-7 con evidencia [CONFIRMADO] file:line.
- Ninguna tarea implementada aún. Siguiente paso: **FB-5** (P0).

### 2026-07-07 — FB-5 implementada (v2.6.0)

- Qué se hizo: `#pick-overlay` y `#prelevel` se movieron fuera de `#screen-game` para que Zen y el lanzador pre-nivel puedan mostrarse sobre pantallas no-juego; `Game.start()` descarta defensivamente cualquier picker/prelevel pendiente antes de montar una partida nueva.
- Archivos tocados · claves i18n nuevas: `index.html`, `game.js`, `tests/fb-regression.test.js`, `docs/ARCHITECTURE.md`, `docs/PLAYER_FEEDBACK_PLAN.md` · sin claves i18n nuevas.
- Tests añadidos/actualizados: `tests/fb-regression.test.js` cubre que Picker/PreLevel sean capas globales y no hijas de `screen-game`. Resultado de suite/lint: pendiente al cierre del lote completo FB-*.
- Docs sincronizados: `ARCHITECTURE.md` §7 documenta Picker y PreLevel como capas globales.
- Pendiente/notas para la siguiente IA: verificar manualmente Zen desde modos y PreLevel con mundo 2 desbloqueado en `?dev`; los overlays in-game mantienen el mismo z-index y visual.

### 2026-07-07 — FB-3 implementada (v2.6.0)

- Qué se hizo: `Modal.open()` resetea el `scrollTop` de `.modal-body`, prioriza el CTA del footer para el foco inicial y llama `focus({ preventScroll: true })`; el arreglo es genérico para todos los modales.
- Archivos tocados · claves i18n nuevas: `game.js`, `tests/dom-stub.js`, `tests/fb-regression.test.js`, `docs/PLAYER_FEEDBACK_PLAN.md` · sin claves i18n nuevas.
- Tests añadidos/actualizados: `tests/fb-regression.test.js` cubre que `modal-over` abre arriba y que el foco cae en `.modal-actions`; `tests/dom-stub.js` ahora registra `activeElement`, `scrollTop` y opciones de foco. Resultado: `node --test tests/fb-regression.test.js` verde; `node --check game.js` verde.
- Docs sincronizados: solo §9 de este documento; no hay cambios de reglas/spec.
- Pendiente/notas para la siguiente IA: verificación manual pendiente en una derrota larga de Supervivencia.

### 2026-07-07 — FB-1 implementada (v2.6.0)

- Qué se hizo: `FX.converge` y `FX.scoreToHud` emiten con presupuesto común forzado (`FX.ABS_MAX = 140`) para que `FX.cap` no cambie la convergencia entre móvil/PC; como `perf-probe` falló, se aplicó el Plan B del propio FB-1 reduciendo el plan común (menos esquirlas, menos sparks y estrellas de HUD) sin reintroducir diferencias por dispositivo. `reduced-fx` conserva su función, pero ahora avisa una vez si viene heredado del sistema y la confirmación del modo ligero dice que se revierte en Ajustes. Se eliminó la ruta muerta `.popup.show`/`popup-float-flat` y las animaciones WAAPI de partículas/glyphs/popups se cancelan al terminar para no retener capas.
- Archivos tocados · claves i18n nuevas: `game.js`, `styles.css`, `tests/fb-regression.test.js`, `docs/QA_PERF_PLAN.md`, `docs/DESIGN_SYSTEM.md`, `docs/PLAYER_FEEDBACK_PLAN.md` · claves ES/EN: `rfx_system_notice`; copy actualizada: `perf_light_on`.
- Tests añadidos/actualizados: `tests/fb-regression.test.js` cubre paridad de emisión con `cap=18/50`, respeto de `ABS_MAX`, claves i18n y ausencia de `.popup.show`; `tests/qp2-perf.test.js` sigue verde. Resultado: `node --test tests/fb-regression.test.js tests/qp2-perf.test.js` verde; `node --check game.js` verde.
- Docs sincronizados: `QA_PERF_PLAN.md` §3.4 documenta que el gobernador solo degrada decorativos y que la mención antigua del confeti escalado por `FX.cap/50` estaba desfasada; `DESIGN_SYSTEM.md` §6/§10 documenta la regla sagrada de convergencia y la cancelación WAAPI.
- Pendiente/notas para la siguiente IA: diagnóstico en dispositivo del propietario no realizado (sin acceso). `node tools/perf-probe.js --assert 55` requirió Playwright temporal y descarga de Chromium; el guardarraíl sigue fallando localmente en v2.6.0 (`normal CPU×6 = 34.7 FPS`, `reduced-fx = 56.7 FPS`, `sin ambientales = 35.2 FPS`, `CPU×1 = 60.2 FPS`) aunque las animaciones vivas bajaron a ~27-40. No se rebajó el umbral.

### 2026-07-07 — FB-6 implementada (v2.6.0)

- Qué se hizo: los objetivos `score` de Aventura usan `Adventure.scoreTarget(level) = level * (300 + 50*chapter)`; el banner muestra progreso vivo `Puntos: p/n`; el modal de nivel completado añade la razón de victoria (`score/clear/boss/survive`).
- Archivos tocados · claves i18n nuevas: `game.js`, `tests/fb-regression.test.js`, `tests/qp1-regression.test.js`, `docs/MIGRATION_SPEC.md`, `docs/GAME_MODES_MASTER_PLAN.md`, `docs/BALANCE_BASELINE.md`, `docs/PLAYER_FEEDBACK_PLAN.md` · claves ES/EN: `obj_score_live`, `level_reason_score`, `level_reason_clear`, `level_reason_boss`, `level_reason_survive`.
- Tests añadidos/actualizados: `tests/fb-regression.test.js` cubre L3=900, L8=2800, objetivo vivo y razón de victoria; `tests/qp1-regression.test.js` actualiza el caso B-02 a 200/900. Resultado: `node --test tests/fb-regression.test.js tests/qp1-regression.test.js` verde; `node --check game.js` verde.
- Docs sincronizados: `MIGRATION_SPEC.md` §5.6 con fórmula nueva; `GAME_MODES_MASTER_PLAN.md` §3.2 con nota FB-6; `BALANCE_BASELINE.md` con batería antes/después.
- Balance: antes Aventura skilled/average/casual `nvl 15/7/6`; después `nvl 12/9/6`, duraciones 354/355/357s. Skilled cae -20% (dentro del límite >25%), average mejora y casual estable.
- Pendiente/notas para la siguiente IA: validar manualmente L3 en una run nueva normal para comprobar que la explicación se percibe clara.

### 2026-07-07 — FB-4 implementada (v2.6.0)

- Qué se hizo: `Meta.DAILY_MEDALS` centraliza los umbrales 750/1500/2500 y alimenta `dailyMedal`, `dailyNextMedal`, resultado y guardarraíl. Se añadió `#modal-daily` con fecha, tablero compartido, mutador+efecto, medallas, mejor marca/ghost, racha y bonus de primer intento; home y misiones abren esta ficha antes de lanzar. Durante la partida diaria el banner muestra la siguiente medalla con número y se actualiza al cruzar umbrales, con toast una vez por medalla. La tarjeta del home pasa a 2 líneas y la tarjeta de modos deja de ocultar/recortar el chip del reto en móvil.
- Archivos tocados · claves i18n nuevas: `index.html`, `game.js`, `styles.css`, `tests/fb-regression.test.js`, `tests/balance-guardrail.test.js`, `docs/MIGRATION_SPEC.md`, `docs/GAME_MODES_MASTER_PLAN.md`, `docs/PLAYER_FEEDBACK_PLAN.md` · claves ES/EN: `daily_info_same`, `daily_info_mut`, `daily_info_medals`, `daily_info_best`, `daily_info_no_best`, `daily_info_ghost`, `daily_info_streak`, `daily_info_first`, `daily_note_next`, `daily_medal_up`, `daily_medal_max`, `daily_home_pending`, `daily_home_done`, `dmut_pure`, `dmut_pure_n`.
- Tests añadidos/actualizados: `tests/fb-regression.test.js` cubre `DAILY_MEDALS`, siguiente medalla, actualización de `#daily-note`, toast de bronce y CSS sin `ellipsis`/`display:none`; `tests/balance-guardrail.test.js` verifica la constante verbatim. Resultado: `node --test tests/fb-regression.test.js tests/balance-guardrail.test.js` verde; `node --check game.js` verde.
- Docs sincronizados: `MIGRATION_SPEC.md` §2.4/§12 con la ficha del reto, constante y modal; `GAME_MODES_MASTER_PLAN.md` §3.4 y registro con el cierre de comunicación del ritual.
- Pendiente/notas para la siguiente IA: validación visual manual pendiente en 360×740 ES/EN para home, modos, ficha, banner y resultado; la semilla/mutador del reto no cambiaron.

### 2026-07-07 — FB-7 implementada (v2.6.0)

- Qué se hizo: los botones de cofres dejan de ser no-op silenciosos; permanecen clicables con clase `is-poor` y ejecutan `chests_none`/`no_gems` con pistas accionables. La apertura usa una animación one-shot cuando `reduced-fx` está off y siempre muestra una tarjeta persistente dentro de `#chests-body` con icono, rareza, recompensa y botón `Seguir`; los cosméticos añaden botón `Equipar`. Las tablas pasan a normal 60/30/8/2 y premium 52/30/10/8; el pool cosmético toma tableros no poseídos no exclusivos y temas no poseídos, con fallback si está vacío.
- Archivos tocados · claves i18n nuevas: `game.js`, `styles.css`, `tests/fb-regression.test.js`, `tests/phase-b.test.js`, `docs/MIGRATION_SPEC.md`, `docs/DESIGN_SYSTEM.md`, `docs/PLAYER_FEEDBACK_PLAN.md` · claves ES/EN: `chest_reveal_title`, `chest_cosmetic_title`, `chest_rarity_common`, `chest_rarity_jackpot`, `chest_rarity_cosmetic`, `chest_continue`, `chest_equip`, `chest_reward_coins`, `chest_reward_gems`, `chest_reward_ticket`, `chest_reward_board`, `chest_reward_theme`; copy actualizada: `chests_hint`, `chests_none`, `no_gems`.
- Tests añadidos/actualizados: `tests/fb-regression.test.js` cubre drop cosmético, no repetición de poseídos, `grantTheme`, fallback normal/premium e i18n/CSS/UI; `tests/phase-b.test.js` fuerza la rama premium de monedas para no depender de azar. Resultado: `node --test tests/fb-regression.test.js tests/phase-b.test.js` verde; `node --check game.js` verde.
- Docs sincronizados: `MIGRATION_SPEC.md` §4 documenta tablas normal/premium y helpers de concesión; `DESIGN_SYSTEM.md` §5/§6 documenta `.chest-reveal`, `chestOpen` y `rewardPop`.
- Pendiente/notas para la siguiente IA: validación manual pendiente de compra sin gemas, apertura normal/premium/jackpot/cosmético y equipar desde la tarjeta; no se añadió pity timer por decisión explícita del plan.

### 2026-07-07 — FB-2 implementada (v2.6.0)

- Qué se hizo: Contrarreloj/Reto usan `initialIcons:22` (override por modo en `setupLevel`) y `spawnFactor()` de hambre de tablero tras el warm-up: `0.65` con ≤10 iconos, `0.85` con ≤16, `1.1` con ≥30, `1` en el resto. No se tocaron dificultad global, `spawnStart`, combos, milestones ni `varietyFor`.
- Desviación del plan: se probó primero `initialIcons:24` con factores 0.55/0.75, pero `tests/balance-guardrail.test.js` falló (`84984 > 74150`). El tuning final mantiene el guardarraíl verde sin recalibrar la mediana 52964.
- Archivos tocados · claves i18n nuevas: `game.js`, `tests/fb-regression.test.js`, `docs/MIGRATION_SPEC.md`, `docs/BALANCE_BASELINE.md`, `docs/GAME_MODES_MASTER_PLAN.md`, `docs/PLAYER_FEEDBACK_PLAN.md` · sin claves i18n nuevas.
- Tests añadidos/actualizados: `tests/fb-regression.test.js` cubre `initialIcons:22` y el contrato de `spawnFactor`; `tests/balance-guardrail.test.js` sigue verde. Resultado: `node --test tests/fb-regression.test.js tests/balance-guardrail.test.js` verde; `node --check game.js` verde.
- Balance: antes Contrarreloj skilled/average/casual `deadAir 77/57/26`, score p50 `246131/129463/20440`, dur50 `240s`; después `deadAir 66/39/11`, score p50 `464250/120929/13085`, dur50 `240s`. Criterio FB-2 principal cumplido: average baja -18 puntos de deadAir, score no sube y duración estable.
- Docs sincronizados: `MIGRATION_SPEC.md` §1.4/§2.4, `BALANCE_BASELINE.md` con batería antes/después, `GAME_MODES_MASTER_PLAN.md` §3.3 y registro.
- Pendiente/notas para la siguiente IA: validación manual pendiente de los primeros 30s del modo y del reto diario para confirmar que se siente menos parado sin arrancar difícil.
