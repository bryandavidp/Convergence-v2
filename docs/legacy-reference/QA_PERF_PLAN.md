# Plan de cierre: pendientes, caza de bugs y rendimiento móvil

> **Rol:** tras ejecutar las 4 fases del plan de modos (GM-α…δ, v2.1.0→v2.4.0), este documento cubre lo que falta: (1) el plan de implementación de lo pendiente, (2) el plan de revisión de fallos del nuevo flujo de modos **sembrado con bugs ya confirmados por auditoría**, y (3) el análisis de rendimiento de animaciones en móvil **con mediciones reales** y su plan de corrección. Hermano de [`GAME_MODES_MASTER_PLAN.md`](./GAME_MODES_MASTER_PLAN.md) (tareas QP-*).
>
> Método: nada aquí es especulativo sin marcar. Los bugs llevan etiqueta **[CONFIRMADO]** (verificado leyendo el código o midiendo) o **[SOSPECHA]** (hipótesis a verificar en la fase de caza). Las cifras de rendimiento salen de `tools/perf-probe.js` (Chromium con CPU emulada ×6 vía CDP).

---

# 1. Plan de implementación de lo pendiente

Orden recomendado: **QP-1 (bugs P0/P1) → QP-2 (rendimiento móvil) → resto**. No añadir contenido nuevo encima de flujos con bugs conocidos ni sobre una base que va a 43 FPS en móvil.

| # | Tarea | Qué es | Esf. | Criterio de cierre |
|---|---|---|---|---|
| QP-1 | ✅ **Corrección de bugs confirmados** (§2.1) — hecho v2.4.1 | Los 6 hallazgos [CONFIRMADO] de la auditoría | 🟡 | ✅ 6 tests de regresión (`tests/qp1-regression.test.js`); suite 42/42 verde |
| QP-2 | ✅ **Rendimiento móvil Fase 1** (§3.4, P0+P1) — hecho v2.5.0 | backdrop-filter fuera, ambientales a compositor, poda de pulsos infinitos, gobernador v2 con histéresis, auto-sugerencia | 🟡 | ✅ 8 tests (`tests/qp2-perf.test.js`); `perf-probe --assert 55` como guardarraíl. 🟡 Pendiente: `perf-probe`/iPhone real (P2-i) |
| QP-3 | **GM-04 · Niveles estrella** (diferido de GM-δ) | 3 nodos laterales por mundo, puzles FINITOS sin spawns, puertas de 25/60/100★ | 🟡🟡 | Ver diseño abajo |
| QP-4 | **Fase 4 de audio** (plan de engagement) | Motivos por modo, capas por intensidad, efectos diferenciados; enganches ya definidos (fiebre-espectáculo, sprint, jefes) | 🟡🟡 | Cada firma sonora de la matriz §5 del plan de modos suena; sin archivos (WebAudio) |
| QP-5 | **Sincronización documental** | ARCHITECTURE/REQUIREMENTS/DESIGN_SYSTEM siguen anclados a v1.7–1.9; documentar Picker/PreLevel/DailyMut/anillos/mutadores | 🟡 | Ningún doc afirma algo falsificable contra v2.4+ |
| QP-6 | **Suite E2E de modos** (§2.3) | Playwright sobre la matriz de casuísticas, en CI opcional | 🟡🟡 | Matriz §2.2 automatizada ≥70% |
| QP-7 | Mundo 6 + mecánica `infected` (ROADMAP 3.4/3.10) | Contenido nuevo de Clásico; encaja como bioma/ruta tras GM-06 | 🟡 | Spec + guardarraíl de balance antes de números |
| QP-8 | Fases online (ROADMAP §8: hosting formal → leaderboard → sync → duelos fantasma) | Bloqueado por decisión del propietario (proveedor) | 🔴 | Según ROADMAP; el ghost de GM-12 es la semilla del duelo fantasma |

**QP-3 · Diseño del generador de puzles solventables (lo que faltaba para GM-04).** El riesgo era generar tableros imposibles. Solución: **construcción inversa** — se parte del tablero vacío y se generan N jugadas hacia atrás: elegir una celda vacía `c`, elegir 2–4 direcciones libres desde `c`, colocar el MISMO icono como "primer icono visible" en cada dirección (respetando que ninguna celda intermedia esté ocupada ni sea sólida). Cada paso inverso garantiza al menos una convergencia jugable; la secuencia de deshacer es una solución testigo. Requisitos: (a) el generador vive en `Engine` (puro, seedeable, testeable en Node); (b) test de propiedad: 500 puzles generados × bot greedy del simulador sin spawns ⇒ 100% resolubles; (c) UI: nodos laterales en el mapa (`Worlds.render`), modo `noSpawn` en `Game` (derrota = sin jugadas con `hasMoves()===false`), recompensa única por puzle (cofre/gemas) persistida en `worlds[wid].starLevels`. Con el testigo de solución, el botón de pista puede enseñar la jugada exacta.

---

# 2. Plan de revisión de fallos y bugs del nuevo flujo

## 2.1 Hallazgos de la auditoría previa (arreglar ANTES de la caza amplia)

> **Estado (v2.4.1):** B-01…B-06 ✅ **corregidos y con test de regresión** (`tests/qp1-regression.test.js`, 6 tests; suite total 42/42). B-07/B-08 siguen abiertos (sospechas a verificar); B-09 aceptado por diseño.

| # | Sev. | Hallazgo | Detalle y corrección propuesta |
|---|---|---|---|
| B-01 | **P0 ✅ CORREGIDO (v2.4.1)** | **RunSave no excluye el Reto del día** | `RunSave.EXCLUDED` solo lista supervivencia/tutorial. Un reto interrumpido se guarda y al reanudar: `State.isDaily` no se restaura (pasa a Contrarreloj libre), el mutador del día no se re-aplica (`comboWindow` no está en el snapshot), la cápsula se pierde y la marca del día no se registra. **Corrección:** excluir `scoreAttack` de RunSave (runs de 2–4 min: reanudar aporta poco y rompe la integridad del ritual) + aviso "no se guarda" en pausa como ya hace Supervivencia. |
| B-02 | **P1 ✅ CORREGIDO (v2.4.1)** | **Aventura reanudada gana niveles de score al instante** | En `resumeSaved()`, `start()` ejecuta `Adventure.setup` (fija `levelScore0 = State.score = 0`) y DESPUÉS el snapshot pisa `State.score` con el valor guardado → en objetivo `score`, `score − levelScore0 ≥ target` se cumple al primer `evaluate()`. Preexistente (v1.8), agravado ahora que Aventura es modo estrella. **Corrección:** restaurar `levelScore0/levelStart` en el snapshot o re-derivarlos tras pisar el estado (`Adventure.levelScore0 = State.score − (progreso del nivel)` ≈ guardar ambos campos en RunSave). |
| B-03 | **P1 ✅ CORREGIDO (v2.4.1)** | **Los potenciadores pre-nivel se pierden al reanudar** | GM-03 fija `Survival.inv` DESPUÉS de `startClassic`; `resumeSaved` no lo conoce (no está en el snapshot) → cerrar la app en un nivel con potenciadores comprados los pierde (son "por intento", pero reanudar ES el mismo intento). **Corrección:** añadir `inv` al snapshot cuando `mode==='clasico'` y restaurarlo + `buildBar()`. |
| B-04 | **P1 ✅ CORREGIDO (v2.4.1)** | **`.pick-overlay` usa `backdrop-filter: blur(3px)`** | Viola la regla explícita del design system (cabecera de `styles.css`: "sin backdrop-filter") — introducido en GM-γ. En iOS el blur de composición es de lo más caro que existe. **Corrección:** sustituir por velo sólido `rgba(5,9,26,.88)` (§3.4-P0). |
| B-05 | **P2 ✅ CORREGIDO (v2.4.1)** | **El selector de ritmo Zen no se puede cancelar** | `launchZen()` abre un Picker sin `cancelLabel`: si el jugador tocó Zen por error, no hay atrás (debe elegir un ritmo y luego salir de la partida). **Corrección:** `cancelLabel: t('back')` con `onCancel` no-op. |
| B-06 | **P2 ✅ CORREGIDO (v2.4.1)** | **Endurecer Picker/PreLevel ante fin de partida externo** | Hoy ninguna ruta legítima cierra la partida con un Picker pendiente (la pausa suave bloquea spawns/reloj), pero es frágil por diseño: cualquier feature futura que llame `gameOver()`/`quit()` con un Picker abierto dejaría el overlay pegado sobre el menú. **Corrección:** `Picker.dismiss()` idempotente invocado desde `Game.endGame()` y `Game.quit()`; ídem ocultar `#prelevel`. |
| B-07 | P2 [SOSPECHA] | **Racha del reto "activa" con 2 días sin jugar** | `dailyStreak()` desplaza a ayer si hoy no hay medalla y además puede consumir congelación en ese mismo paso → una racha puede mostrarse viva tras 2 días de ausencia. Verificar con tabla de casos (test unitario con historial sintético) y ajustar si el resultado sorprende. |
| B-08 | **P2 ✅ CORREGIDO (v2.5.0)** | **Gobernador de FX poco agresivo** | El `+3` podía dejar `FX.cap` en 52 (>50). El gobernador v2 (módulo `Perf`) clampa el tope al techo del nivel cada frame (invariante dura) y actúa POR NIVELES con histéresis, no solo tocando `cap`. Test: `tests/qp2-perf.test.js` (`el tope nunca supera el techo del nivel`). |
| B-09 | P3 [CONFIRMADO, aceptar] | Bomba/rayo/escoba destruyen la cápsula ⏰ sin efecto | `_powerClear` limpia tiles trigger sin detonarlos. Coherente con el resto de triggers; documentado como regla ("los potenciadores arrasan, no detonan"). No corregir salvo feedback de jugadores. |
| B-10 | **P1 ✅ CORREGIDO (v2.37.0)** | **Spawn/relleno instantáneo en la celda recién vaciada** (reporte del propietario: "el icono eliminado no desaparece / reaparece el mismo en su casilla") | Medido en vivo con probe de Chromium: el relleno post-tablero-limpio colocaba icono en una celda de la última convergencia en el MISMO tick, 2 veces de ~50 tableros limpios con el MISMO id 7–11 ms después de eliminarlo; los spawns orgánicos podían hacer lo mismo con el sesgo de clear-assist. **Corrección:** celdas "calientes" (`Engine.noteHot`, 450 ms) que `spawnOne` evita mientras haya alternativa (overflow/conteo intactos). Tests: `tests/board-refill-races.test.js`. |
| B-11 | **P2 ✅ CORREGIDO (v2.37.0)** | **Glifo fantasma si `animationend` no llega en `clearAnim` sin target** | La rama sin target borraba el glyph solo en `animationend`; una animación cancelada (cambio de clase, pestaña oculta, `animation:none`) dejaba un icono pintado sobre `board[i]===null` — el "icono que no desaparece del todo" y el "tablero vacío con 1 icono a la vista". **Corrección:** cinturón `setTimeout(480ms)` idempotente con el mismo guard race-safe. |
| B-12 | **P1 ✅ CORREGIDO (v2.37.0)** | **El relleno post-tablero-limpio era indistinguible de los spawns normales** (reporte: "no se distingue qué rellenó el tablero"; "cree que se vació cuando queda 1 icono") | El relleno, el popup del bonus y la última convergencia caían en el MISMO frame, con los clones aún volando (165 ms), y las fichas nuevas usaban el pop del spawn normal. **Corrección:** `Render.refillAnim` — cascada radial desde el punto del bonus (base 320 ms + 26 ms por distancia, tope 700 ms; gesto propio "brota desde abajo"; instantánea con `reduced-fx`) y popup del bonus a +240 ms: el jugador VE el tablero vacío antes del relleno. |
| B-13 | Registro de método | **QA en vivo reproducible para el tablero** | Arneses de esta sesión (scratchpad, reutilizables): `invariant-sim.js` (game.js real sobre dom-stub con reloj virtual + timers falsos; invariantes iconCount/emptyBonus/render tras cada mutación con atribución de culpable; 180 partidas × 5 modos = 0 hallazgos) y `live-probe.js` (Playwright: clics reales + auditor DOM↔State cada 130 ms; ~1300 acciones × 6 configs = 0 desyncs). Conclusión: la contabilidad del tablero es sólida; los 3 síntomas reportados eran carreras visuales legales del mismo tick (B-10/B-11/B-12). |

## 2.2 Matriz de casuísticas a probar (la caza amplia)

Regla general: cada celda se prueba en ES y EN, con `reduced-fx` on/off donde haya animación, y tras **matar y reabrir la app** donde haya persistencia. Los ítems ⭐ son bloqueantes.

**Transversal (todos los modos)**
- ⭐ Interrumpir y reanudar (visibilitychange) en: partida normal, con Picker abierto, con PreLevel abierto, en modal de nivel/fin, durante fiebre y durante sprint. RunSave debe guardar/limpiar coherentemente en cada caso.
- ⭐ Cambiar de idioma con partida guardada y con Picker/PreLevel construidos: nada queda en el idioma anterior al reabrirlos.
- Perfil nuevo (localStorage limpio) pasa por: tutorial → clásico 1-1 → reto → supervivencia sin tocar código legacy (campos `cv_meta` nuevos se auto-rellenan: `mastery.winStreak`, `dailyRun.history/ghost/streakRewarded`, `zen.flowers`, `boards.owned.jardin`).
- Doble-tap rápido en toda opción de Picker/PreLevel/bendición (¿doble aplicación?). `Picker.pick` limpia `pending` antes del callback — verificar que basta también en PreLevel (`_start` re-entrante).
- Chip de multiplicador, popups y momento destacado con valores extremos (×20+, puntuaciones de 6 cifras): sin overflow visual.

**Clásico**
- ⭐ PreLevel: comprar 2 → morir → reintentar (los consumibles NO vuelven, sin cobro doble); comprar → completar → siguiente nivel (el stock restante persiste); sin monedas (chips deshabilitados, Jugar bloqueado si la selección no es pagable, "Sin potenciadores" siempre activo); mundo 1 arranca directo.
- ⭐ Congelar (freeze) en Clásico bloquea el spawn de verdad (`blockSpawn` del modo) y su temporizador muere al salir/reiniciar.
- Racha de victorias: victoria→victoria (+10%), derrota (reset a 0 y toast), salir a mitad (NO resetea), tope +50%.
- Continuar con gemas: aceptar (cobra 15, despeja 40%, sigue), rechazar (near-miss + derrota), sin gemas (ni se ofrece), segunda derrota en el mismo nivel (no re-ofrece), y encadenado con escudo en Aventura (escudo primero, gratis).
- Near-miss: solo si mínimo ≤10 y >45s; nunca en victoria; texto con el número correcto.

**Aventura**
- ⭐ Cadena intro→reliquia→ruta al entrar en capítulo nuevo por `nextLevel`; solo ruta en `start`; nada si se reanuda a mitad de capítulo.
- ⭐ Ruta exigente: chip ×1.25 visible todo el capítulo y APAGADO al cruzar frontera; obstáculos extra presentes en los 5 niveles.
- Reliquias: 4ª reliquia expulsa la más antigua (efecto retirado en el siguiente nivel); escudo exactamente 1 vez por capítulo y recargado al cambiar; combo +400ms comprobable (`State.comboWindow`).
- Jefe activo: aviso a los 17s, acción a los 20s, por bioma (las 6); cristal no supera 6 en tablero; el ataque no dispara en pausa/Picker.
- Registro de expedición presente en el resumen y con la cadena correcta tras 2+ capítulos.

**Contrarreloj / Reto del día**
- ⭐ Reto: mismo tablero Y mismo mutador al reintentar; mutadores los 8 (forzar con `?dev`: `DailyMut.apply('ice')` etc.); medalla/racha/calendario correctos tras 1ª y 2ª partida del día; +5💎 solo el primer intento.
- ⭐ Ghost: sin referencia el primer intento del día; ▲/▼ correcto en el segundo; el de Contrarreloj libre usa el récord del modo, no el del reto.
- Sprint: entra/sale al cruzar 10s varias veces (toast con throttle, sin spam); error a 2s de reloj → fin inmediato limpio.
- Cápsula: aparece entre 40–80s, detona por adyacencia (+5s, respeta tope 90), en tablero lleno espera al hueco.
- Racha: hito de 7 días (+1 cofre, una vez), congelación (falta 1 día → sigue; faltan 2 → rompe), medianoche a mitad de partida (la marca cae en el día en que se REGISTRA el fin).

**Supervivencia**
- ⭐ Bendición: aparece ~1.7s tras CADA evento jefe; pausa de verdad (oleada congelada); las 5 aplican su efecto; `life` desaparece del pool con vidas al tope+1.
- ⭐ Marea: aviso específico a −3s coincide con el evento; marcas 1.2s; llena solo huecos de las filas exteriores; puede provocar overflow→vida como cualquier presión.
- Mutador semanal: forzar los 4 con `Survival._mutOverride`; caos mete quake en el pool; hielo cambia trampas y monedas; furia alarga el frenesí.
- Revivir 120→240→480→sin oferta; el modal refleja el precio vivo; rechazar termina con el resumen correcto.
- Anillos: valores extremos (suministro 99→pago acotado con remanente, frenesí activo=100%), sin mutar `boosterStock`; barra de boosters jamás visible fuera de Supervivencia/Clásico-con-loadout.

**Zen**
- Sin fiebre jamás (combo 30+); combo/chip invisibles; flor por cada tablero limpio (persistente); hitos 10 (cofre, una vez) y 50 (skin, equipable, no comprable, visible como "Exclusivo" en tienda); ritmo recordado entre sesiones.

## 2.3 Cómo ejecutar la caza (3 capas)

1. **Unitaria (Node, ya existe la infraestructura):** tests nuevos para la lógica pura de la fase: `dailyStreak` (tabla de historiales sintéticos, incluido B-07), `DailyMut.pick` (estable por fecha), `Survival.reviveCost/_bossPool/weeklyMut` (con override), generador de puzles cuando exista (QP-3). Objetivo: +15–20 tests.
2. **Simulador (ya existe):** añadir a `balance-sim` un modo `--assert` con invariantes por run: `iconCount` nunca negativo ni >64, `score` monótono salvo diseño, sin excepción en 500 runs × 4 modos (hoy las excepciones matan el proceso: eso ya es un detector — formalizarlo como test nocturno/CI opcional).
3. **E2E navegador (QP-6):** portar los smokes de sesión (`smoke-*.js`, ya escritos y pasando) a `tests-e2e/` con Playwright estable + los ⭐ de la matriz. Los smokes existentes cubren ya ~40% de la matriz; el resto es principalmente persistencia (matar/reabrir) e idioma.

Orden: B-01…B-06 con test de regresión cada uno → capa 1 → capa 3 sobre los ⭐ → barrido completo de la matriz con el checklist manual (`PLAYTEST_CHECKLIST.md`, añadiendo sección GM-γ/δ).

---

# 3. Rendimiento de animaciones en móvil (iOS): análisis y corrección

> **Alcance de esta sección: el GAMEPLAY** (tablero, fiebre, confeti, ambientales, pulsos de
> tiles). El otro síntoma reportado —repetir una acción con animación en **menús/tienda**
> (comprar pulsando repetido) sobrecarga el hilo principal por acumulación de nodos DOM— se
> analiza y corrige aparte en **[`ANIMATION_PERF_PLAN.md`](./ANIMATION_PERF_PLAN.md)** (tareas
> AP-*). Causa raíz distinta (creación de nodos vs. coste de compositor), corrección distinta.

## 3.1 Síntoma y reproducción medida

Síntoma reportado: en PC todo fluido; en iOS va "un poco más lento" y las animaciones no lucen como en PC. Reproducido en laboratorio con `tools/perf-probe.js` (Supervivencia en juego real con fiebre + confeti periódico, CPU emulada ×6 ≈ gama media móvil):

| Configuración | FPS | Frames >34ms | Animaciones vivas |
|---|---|---|---|
| PC de referencia (CPU ×1) | **60.2** | 0 | 86 |
| Móvil emulado (CPU ×6), juego normal | **43.2** | 15 | **135** |
| Móvil emulado + solo quitar ambientales de tablero y pulsos de tiles | **49.8** | 7 | 139 |
| Móvil emulado + `reduced-fx` | **57.0** | 2 | 83 |

Lecturas: (1) el síntoma se reproduce sin iPhone — es coste de CPU/paint, no una rareza de Safari; (2) **solo** las animaciones ambientales del tablero y los pulsos infinitos de tiles cuestan ~7 FPS; (3) `reduced-fx` casi lo resuelve → el presupuesto se va en FX/animaciones, no en la lógica del juego; (4) incluso en `reduced-fx` quedan 83 animaciones vivas (los pulsos de tiles trigger no están cubiertos por él).

## 3.2 Causas, por orden de coste

1. **Animaciones que PINTAN en vez de compositar.** Auditados los 91 `@keyframes`: ~20 animan `background`/`background-position`/`box-shadow`/`filter` — cada frame re-rasteriza. Los peores por área×duración: las **6 ambientales de skins de tablero** (`board-wood/lava/leaf/runes/stars/scan`: mueven `background-position` de un pseudo-elemento del tamaño del tablero, en bucle infinito, siempre), `special-pulse` y `slowdown-bob` (tiles trigger, infinitos, hasta 6–8 celdas a la vez en Supervivencia), `ctaPulse`, `dangerBorder`, `boss-flag` (opacity, barata), `booster-grant-bar` (filter).
2. **`backdrop-filter: blur(3px)` en `.pick-overlay`** (B-04): en iOS obliga a re-componer todo lo que hay debajo; además viola la regla escrita del propio design system. Se nota exactamente en los momentos de elección (bendiciones/rutas), que ahora son frecuentes.
3. **Volumen de animaciones concurrentes:** 135 vivas en juego normal. Cada una es trabajo del compositor aunque sea transform/opacity; en iOS, con menos GPU y el pico de memoria de capas de WebKit, el margen es mucho menor que en PC.
4. **El gobernador de FX no llega a actuar en la zona mala** (B-08): a 43 FPS el EMA (~23ms) roza su umbral (22ms) y `FX.cap` se quedó en 52 (por encima incluso del tope nominal de 50 — el incremento `+3` puede saltárselo). Resultado: en el rango 40–50 FPS el juego NO se autorregula, que es justo donde vive un iPhone medio.
5. **Diferencias inherentes de iOS que amplifican lo anterior:** Safari rasteriza a resolución de dispositivo (×3 en iPhone Pro: cada paint cuesta ~9× píxeles que un 1080p de PC), el modo de ahorro de energía clava rAF a ~30–60Hz, y el primer toque llega con el contexto de audio aún desbloqueándose. Además el usuario percibe "animaciones distintas": en parte es el gobernador bajando partículas (comportamiento diseñado) y en parte frames perdidos que rompen los easings.

## 3.3 Por qué "no se parecen a PC" (y qué es aceptable)

Parte de la diferencia es **diseño correcto**: el gobernador reduce partículas en gama baja a propósito. El objetivo NO es igualar visualmente a PC, sino que (a) los 60 FPS se sostengan en el gameplay base, y (b) la degradación sea **elegante y por capas** (perder motas antes que perder el vuelo de convergencia; perder ambientales antes que el feedback de jugada). Hoy la degradación es abrupta: se pierden frames (todo tartamudea) en vez de perder adornos.

## 3.4 Plan de corrección (tareas QP-2, por prioridad)

> **Estado (v2.5.0):** P0 (a·b·c) y P1 (d·e·f·g) ✅ implementados y verificados en Chromium real
> (gobernador 0→1→2 con clases `perf-1`/`perf-2`, cortes de animación por capa, clamp del tope,
> integridad visual, cero errores de consola). **Corrección al alcance:** el plan listaba 6 ambientales
> pero **`board-drift`** (skin *classic*, el DEFECTO más visto) también animaba `background-position`;
> se corrigió también → **7 keyframes** pasados a transform/opacity. `board-scan` (futurista) NO se dejó
> solo-desktop: se convirtió en scroll compositado de un periodo exacto (34px) con el pseudo
> sobredimensionado (`inset:-34px`), así conserva el efecto en móvil a coste ~0. **Pendiente:** P2-h/P2-i
> (correr `perf-probe --assert 55` y validar en iPhone real) — la sonda ya es multiplataforma y con guardarraíl.

**P0 — sin pérdida visual apreciable (horas):**
- (a) **Quitar `backdrop-filter`** de `.pick-overlay` → velo sólido `rgba(5,9,26,.88)` (B-04).
- (b) **Reescribir las 6 ambientales de tablero a compositor**: en vez de animar `background-position` del pseudo-elemento, animar `transform: translate` de un pseudo-elemento sobredimensionado (patrón estándar: fondo al 200% y desplazamiento por transform). Misma estética, coste ~0. Las que no puedan (p. ej. `board-scan` con gradiente que cruza) se quedan solo-desktop: `@media (hover:hover) and (pointer:fine)`.
- (c) **Pulsos de tiles trigger**: `special-pulse` anima `box-shadow` — pasar a `opacity`/`transform` de un pseudo-elemento con el glow pre-pintado; incluirlos en la lista `reduced-fx` (hoy no lo están — por eso quedan 83 animaciones en modo reducido).

**P1 — degradación elegante (días):**
- (d) **Gobernador v2 con histéresis y escalones**: medir EMA como hoy pero actuar por niveles — nivel 0 (todo), nivel 1 (EMA>20ms sostenido 2s: ambientales de tablero fuera + `FX.cap` 28), nivel 2 (EMA>26ms: pulsos de tiles fuera + cap 18), con re-subida solo tras 10s buenos (histéresis). Aplicado con una clase en `<body>` (`perf-1`/`perf-2`) para que sea CSS puro y auditable. Desde FB-1, `FX.cap` solo puede degradar decorativos: el feedback de convergencia (`FX.converge` + `FX.scoreToHud`) usa `force` y respeta `FX.ABS_MAX = 140`, idéntico en móvil y PC salvo que el usuario active `reduced-fx`.
- (e) **Auto-sugerencia de `reduced-fx`**: si el nivel 2 se mantiene >30s en una sesión, toast único "¿Activar modo ligero?" con acción directa (respeta la elección para siempre) y confirmación reversible desde Ajustes. Si `reduced-fx` viene heredado del ajuste del sistema y el usuario no lo fijó, se informa una vez (`cv_rfx_notice`).
- (f) **Presupuesto de confeti por evento en móvil**: estado actual corregido respecto a la investigación inicial: `FX.confetti(n)` ya hace `Math.min(n, FX.cap)`. El confeti sigue siendo decorativo y se degrada por gobernador; no usar esta regla para la convergencia.
- (g) **Detección de iOS para el nivel inicial**: arrancar en nivel 1 del gobernador cuando `navigator.maxTouchPoints > 0 && devicePixelRatio ≥ 3` hasta tener 5s de EMA bueno (evita el primer minuto tartamudo mientras el EMA converge).

**P2 — verificación y guardia permanente:**
- (h) **`tools/perf-probe.js` como guardarraíl**: (ya en el repo) añadirle `--assert 55` y correrlo en CI opcional o en el checklist de release: la escena de estrés no baja de 55 FPS con CPU ×6.
- (i) **Validación en dispositivo real**: Safari Web Inspector → Timeline (Rendering Frames) en un iPhone no-Pro: confirmar que tras P0/P1 los picos de paint desaparecen de las escenas de fiebre/jefe/confeti. El emulado ×6 correlaciona pero WebKit tiene su propio compositor: la palabra final es del dispositivo.
- (j) **Regla nueva del design system** (documentar en DESIGN_SYSTEM al hacer QP-5): toda animación `infinite` debe ser transform/opacity-only y estar en la lista de `reduced-fx`; las one-shot pueden usar filter/box-shadow si duran <700ms.

**Resultado esperado:** P0 solo debería situar la escena de estrés cerca de ~50 FPS (la medición aislada de ambientales+pulsos ya da 49.8); P0+P1 apunta a ≥55 FPS sostenidos con degradación por capas invisible para el ojo, quedando PC exactamente como está hoy.

**Nota FB-1/v2.6.0 (2026-07-07, Windows/Chromium headless):** se eliminó la acumulación de animaciones WAAPI terminadas (`document.getAnimations()` en estrés baja de ~166 a ~27-40), pero `tools/perf-probe.js --assert 55` sigue fallando localmente. Medición final: `normal (CPU ×6) = 34.7 FPS`, `reduced-fx = 56.7 FPS`, `normal sin ambientales = 35.2 FPS`, `CPU ×1 = 60.2 FPS`. No se rebaja el umbral; queda como señal de seguimiento de QP-2/P2-h o de validación en dispositivo real.
