# Especificación de migración — Convergence

> **Propósito de este documento:** ser la única fuente de verdad necesaria para reimplementar Convergence, con paridad de funcionalidad al 100%, en **cualquier lenguaje o stack** (nativo, otro framework web, motor de juego, etc.) sin necesidad de leer `game.js`. Contiene reglas, fórmulas exactas, constantes verbatim, estructuras de datos y algoritmos extraídos por ingeniería inversa del código fuente (`game.js` v1.7.1, 3969 líneas). Para dónde vive cada cosa en el repo original ver [`ARCHITECTURE.md`](./ARCHITECTURE.md); para el sistema visual ver [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md); para el checklist de requisitos ver [`REQUIREMENTS.md`](./REQUIREMENTS.md).
>
> Convención: los nombres de campos/funciones se mantienen en su forma original (inglés/español mixto, tal como en el código fuente) porque son identificadores técnicos, no prosa.
>
> **Actualización incremental 2026-07-18:** §3.4, §4 y §7 incorporan el sistema de cofres y las tiendas vigentes hasta
> **`cv_meta._v = 9`** (CH-1…CH-5 + tienda de recursos/XP Booster). Las descripciones históricas de otros subsistemas no se reinterpretan en esta
> actualización; `CHEST_SYSTEM_MASTER_PLAN.md` conserva expresamente el baseline 2.6.85 que originó el trabajo.

## Índice
1. [Mecánica core](#1-mecánica-core)
2. [Modos de juego](#2-modos-de-juego)
3. [Modelo de datos y persistencia](#3-modelo-de-datos-y-persistencia)
4. [Economía](#4-economía)
5. [Progresión](#5-progresión)
6. [Combos y puntuación](#6-combos-y-puntuación)
7. [Power-ups / boosters (Supervivencia)](#7-power-ups--boosters-supervivencia)
8. [Ajustes e internacionalización](#8-ajustes-e-internacionalización)
9. [Audio y háptica](#9-audio-y-háptica)
10. [PWA / instalación / offline](#10-pwa--instalación--offline)
11. [Iconografía del tablero (catálogo de iconos)](#11-iconografía-del-tablero-catálogo-de-iconos)
12. [Pantallas y máquina de estados](#12-pantallas-y-máquina-de-estados)
13. [Algoritmos notables](#13-algoritmos-notables)
14. [Constantes verbatim](#14-constantes-verbatim)
15. [Notas transversales para la reimplementación](#15-notas-transversales-para-la-reimplementación)
16. [Checklist de paridad para la migración](#16-checklist-de-paridad-para-la-migración)

---

## 1. Mecánica core

### 1.1 Tablero
- Grilla de `Config.SIZE = 8` → 8×8 = 64 celdas, representada como un array plano `board[64]` (icono id en string, o `null`), con un array paralelo `tiles[64]` (celda especial/obstáculo, o `null`).
- `idx(r,c) = r*size + c`.

### 1.2 Toque de celda vacía → detección de convergencia
Algoritmo `converging(i)`:
1. Si la celda `i` está ocupada, o su tile es `solid`, o tiene un `trigger` → no-op (devuelve `[]`).
2. Se calculan fila/columna de `i`.
3. `DIRS = [-1,0, 1,0, 0,1, 0,-1]` — 4 vectores de dirección: **arriba, abajo, derecha, izquierda** (en ese orden literal de iteración; no tiene efecto de juego, solo de orden de animación/hint).
4. Para cada una de las 4 direcciones, caminar celda a celda hacia afuera:
   - Si la siguiente celda tiene un tile **sólido** → cortar el rayo (los tiles sólidos bloquean línea de visión).
   - Si la celda tiene un icono (`v !== null`) → registrarlo agrupado por id de icono y cortar esa dirección (solo cuenta el icono **más cercano**).
   - Si está vacía y no sólida → seguir avanzando.
5. Al terminar las 4 direcciones, por cada id de icono visto, si apareció en **≥ 2 direcciones**, todas esas celdas entran en la lista de convergencia.
6. Se devuelve la lista plana de índices a eliminar (puede incluir 2, 3 o las 4 direcciones si coinciden con el mismo icono).

**Regla de match:** mínimo 2 direcciones con el mismo icono más cercano disparan la convergencia; más direcciones coincidentes = más iconos eliminados de una vez (hasta 4).

### 1.3 Al tocar una celda vacía
- Si está ocupada → sonido de "tap", no-op.
- Si `converging(i).length < 2` → camino de **fallo** (ver 1.5).
- Si no:
  1. Actualizar combo (continúa si `ahora - comboAt <= comboWindow`, si no reinicia a 1).
  2. Buscar multiplicador en la tabla de combos.
  3. Comprobar entrada a modo Fiebre.
  4. Calcular puntuación (ver §6).
  5. Si es Contrarreloj, aplicar bono de tiempo.
  6. Disparar feedback (partícula/sonido/háptico).
  7. Vaciar las celdas coincidentes (`board[idx]=null`); limpiar cualquier tile en esas celdas (un tile `crystal` da +50 de bono).
  8. Animación de limpieza.
  9. Detonación en cadena de pickups `trigger` adyacentes (`_chainDetonate`).
  10. Hook de modo `onConverge(ctx)`.
  11. `evaluate()` (chequeo de victoria/derrota).

### 1.4 Generación (spawn) de iconos
- Disparado por el loop principal cada `spawnRate` ms acumulados.
- `Game.doSpawn()`: si el hook de modo `blockSpawn()` devuelve `true` (congelación en Supervivencia), no hace nada.
- `emptyCells()` = celdas con `board[i]===null` y sin tile (los tiles sólidos nunca son destino de spawn).
- Si no hay celda vacía:
  - Modos `endless` → hook `onOverflow()` (Supervivencia pierde una vida; Zen hace un despeje parcial).
  - Resto, incluido `scoreAttack` (Contrarreloj/Reto) → **derrota dura** por tablero lleno (`gameOver('reason_full')`).
- Si hay celda vacía: se elige una al azar y un id de icono vía `_pickSpawnId()` (ver §13, sesgo anti-frustración).
- **Celdas calientes (v2.37.0):** las celdas vaciadas por el jugador (iconos convergidos + punto tocado, también bombas/objetos y despejes suaves) quedan marcadas "calientes" (`Engine.noteHot`); durante **450 ms** `spawnOne()` las evita **si existe alternativa fría**. Si todas las vacías están calientes se usan igualmente: el overflow, el conteo y el número de spawns no cambian jamás. Motivo: un spawn instantáneo en la celda recién vaciada —a veces del MISMO icono por el sesgo de §13— se leía como "mi icono no se eliminó" (bug reportado, medido en vivo: relleno idéntico 7–11 ms tras eliminar). El relleno post-tablero-limpio NO evita celdas: su entrada en cascada retardada (`Render.refillAnim`, base 320 ms + 26 ms por casilla de distancia Manhattan al punto del bonus, tope 700 ms; instantánea con `reduced-fx`/`prefers-reduced-motion`) ya hace legible cualquier celda, y evitarlas ahí distorsionaba la geometría de los patrones (−12 % de score del bot estándar).
- **Auto-aceleración del spawn:**
  - Modos normales: `spawnRate = max(spawnMin, spawnRate - 3)` en cada spawn (aceleración lenta dentro del nivel).
  - Contrarreloj (`scoreAttack`): se recalcula en cada spawn a partir del tiempo transcurrido: `clamp(round(spawnStart * 0.92^(elapsed/10)), 300, spawnStart)` — decaimiento exponencial independiente del reloj de puntuación.
- **Intervalo efectivo:** el bucle usa `spawnRate * Game.warmupFactor(now) * Rules.call('spawnFactor')`. Desde FB-2, Contrarreloj/Reto añade DDA de hambre de tablero sin tocar la curva base: durante el warm-up devuelve `1`; después, con `State.iconCount <= 10` devuelve `0.65`, con `<= 16` devuelve `0.85`, con `>= 30` devuelve `1.1`, y en el resto `1`.

### 1.5 Manejo de fallo (`mistake`)
- Animación/sonido/háptico de "miss"; `mistakes++`; en Clásico actualiza en vivo el indicador de estrellas.
- **Modos `scoreAttack` (Contrarreloj/Reto del día), desde v2.2.0 (GM-11):** el error resta `TIMED_MISTAKE_S = 3` segundos del reloj (con toast "Error · −3s") y NO añade iconos ni acelera el spawn — el castigo cobra en la moneda del modo. Si el reloj llega a 0 por el error, fin de partida inmediato.
- Resto de modos con `penalties: true`:
  - Sacude el tablero.
  - `n = clamp(penaltyBase + floor((level-1)/3), 1, 5)` (penaltyBase por dificultad: fácil 1, normal 2, difícil 3).
  - Coloca `n` iconos nuevos vía `addPenalty(n)`.
  - Acelera el spawn 5% (`spawnRate *= 0.95`, con piso `spawnMin`).
  - Muestra un toast.
  - Reevalúa.

### 1.6 `hasMoves()`
Escanea todas las celdas vacías buscando alguna con `converging(i).length >= 2`. **Solo se usa para el sistema de pistas**, no para declarar derrota — el juego evita deliberadamente terminar la partida solo porque no exista un movimiento instantáneo disponible (puede aparecer uno nuevo con el próximo spawn).

### 1.7 Evaluación de victoria/derrota (`evaluate()`)
- Se omite si no se está jugando o si el tutorial guiado está activo.
- Hook de modo `winCheck()` → si es verdadero, `levelComplete(perfect = wc === 'perfect')`.
- Hook de modo `loseCheck()` → si es verdadero, `gameOver(...)`.
- Modos `endless`/`scoreAttack`: sin "nivel completado"; en su lugar se dispara `emptyBoardBonus()` una vez por cada vez que el tablero queda vacío.
- Resto (Clásico/Aventura/Tutorial): victoria por defecto = tablero completamente vacío (`iconCount === 0`), condicionado por el hook `boardClearWins()` (en Aventura solo aplica si el objetivo del nivel es `'clear'`). La derrota por tablero lleno se maneja en el spawn, no aquí.

**Razones de fin de partida:** `reason_full` (tablero lleno sin espacio para spawnear, excepto modos endless que lo interceptan), `reason_time` (reloj de Contrarreloj llega a 0), razones específicas de Aventura/Supervivencia (ej. `reason_surv`).

---

## 2. Modos de juego

Registro central `Config.MODES` con orden `MODE_ORDER = ['tutorial','clasico','aventura','contrarreloj','supervivencia','zen']` y dificultades `DIFF_ORDER = ['facil','normal','dificil']`.

Campos comunes por modo: `name`, `emoji`, `timed`, `penalties`, `mult` (multiplicador de score), `single`, `fixedDiff`, `initialIcons`, `accent` (color hex), `goal`/`desc`, `scoreAttack`, `fast`/`endless`/`relaxed`, y hooks opcionales: `onSetupLevel(ctx)`, `onTick(dt)`, `onConverge(ctx)`, `onOverflow()`, `blockSpawn()`, `spawnFactor()`, `winCheck()`, `boardClearWins()`. El dispatcher genérico es `Rules.call(name, ctx)`.

### 2.1 Tutorial (`tutorial`)
`timed:false, penalties:false, mult:0.5, single:true, fixedDiff:'facil'`. En la práctica el tutorial real es un módulo separado (`Coach`), una secuencia guiada de 2 pasos con tableros deterministas:
- Paso 1: dos círculos rojos adyacentes a una celda objetivo (demo de 2 direcciones).
- Paso 2: 4 estrellas amarillas alrededor de la celda objetivo (demo de convergencia en las 4 direcciones).

Cada paso resalta la celda objetivo hasta que el jugador la completa; al terminar marca `tutorialDone = true` y vuelve al inicio. El tutorial **bypasea** el flujo normal de `Game.start`.

### 2.2 Clásico (`clasico`)
`timed:false, penalties:true, mult:1.0`, objetivo "vaciar el tablero". Organizado en **mundos** (ver §5.4). Al completar nivel se calculan **estrellas 0-3** según errores: `STAR_ERR = [0, 2]` → 0 errores = 3★, ≤2 errores = 2★, más = 1★. Recompensa: `coins = 20 + stars*10 + round(score/60)`, multiplicada por la **racha de victorias** (v2.3.0, GM-05): `×(1 + min(5, racha−1)·0.10)` — +10% por nivel de racha desde la 2ª victoria seguida, tope +50%; solo la derrota reinicia la racha (`Meta.mastery.winStreak`).

**Potenciadores pre-nivel (v2.3.0, GM-03):** desde el 2º mundo (`PRELEVEL_FROM_WORLD = 1`), tocar un nivel del mapa abre un lanzador con hasta `PRELEVEL_MAX (2)` consumibles comprables con monedas (`PRELEVEL_BOOSTERS`: bomb 80 / freeze 60 / clearLine 90). Son por intento (reiniciar no los devuelve). Reutilizan el inventario/apuntado de Supervivencia; `blockSpawn` del modo cubre la congelación. **Continuar con gemas (v2.3.0, GM-02):** al llenarse el tablero (Clásico/Aventura), 1 oferta por nivel de continuar por `CONTINUE_GEMS (15)` 💎 despejando `CONTINUE_CLEAR (40%)`; rechazar lleva a la derrota normal (con near-miss).

Densidad de obstáculos por nivel: `dens = min(0.13, 0.015 + n*0.0021 + worldIndex*0.008)` (`n` = nivel dentro del mundo). El modificador `rush` del mundo multiplica `spawnRate` ×0.85. Desde el nivel 2, 60% de probabilidad de colocar un tile `bonus` (+30 puntos al tocarlo).

### 2.3 Aventura (`aventura`)
`timed:false, penalties:true, mult:1.1`. Progresión infinita por capítulos — ver §5.5.

**Rutas de capítulo (v2.3.0, GM-06):** al entrar en un capítulo se elige 1 de 2 rutas (estado volátil de run, no persiste en RunSave): `dense` («exigente»: refuerza el obstáculo del bioma y fija `State.tempMult = 1.25` durante el capítulo — visible en el chip de multiplicador) o `calm` («serena»: `spawnRate ×1.15`, sin bonus). La ruta caduca en la frontera de capítulo. **Reliquias de jefe (v2.3.0, GM-07):** al superar un nivel jefe se elige 1 de 3 pasivas de run (máx. 3 activas, FIFO): `combo` (ventana +400ms), `crystal` (cristales +30 extra), `hint` (+1 pista/nivel), `shield` (la 1ª derrota por tablero lleno de cada capítulo despeja el 30% en vez de terminar). Se muestran en el banner de objetivo.

### 2.4 Contrarreloj (`contrarreloj`)
`timed:true, scoreAttack:true, penalties:true, mult:1.2, initialIcons:22`, objetivo "sumar puntos a contrarreloj". `TIMED_START = 60`s, `TIMED_CAP = 90`s (tope duro del reloj). Cada convergencia repone tiempo con rendimientos decrecientes (fórmula en §6.6). El spawn se acelera exponencialmente con el tiempo transcurrido (ver §1.4) y aplica DDA de hambre de tablero tras el warm-up (`spawnFactor`: 0.65 con ≤10 iconos, 0.85 con ≤16, 1.1 con ≥30). Termina cuando `timeLeft <= 0` o cuando el tablero llega al 100% y no queda celda colocable. El Reto del día hereda estos valores porque es Contrarreloj seedeado.

**Sprint final (v2.2.0, GM-10):** mientras `0 < timeLeft <= SPRINT_WINDOW (10s)`, todos los puntos (convergencias y bonus de tablero vacío) van `× SPRINT_MULT (1.5)`. Como el tiempo puede volver a subir, el jugador puede elegir "cabalgar el borde" (riesgo-recompensa continuo). El error en este modo resta `TIMED_MISTAKE_S (3)` segundos (ver §1.5).

**Cápsula de tiempo (v2.4.0, GM-13):** 1 por partida en modos `scoreAttack`; en un segundo seedeado (`40 + rand(40)`) aparece un tile trigger `timecap` (⏰) que al detonarse por adyacencia da +5s (con el tope de reloj). **Ghost personal (v2.4.0, GM-12):** el score se muestrea cada 10s (`State.ghostSamples`); el mejor intento se guarda (`modes[mode].ghost`, o `dailyRun.ghost` para el reto) y en partida un chip muestra `▲/▼ delta` contra la muestra correspondiente al tiempo transcurrido.

**Reto del día — mutador (v2.4.0, GM-15):** `hash32('mut:' + fecha) % 8` elige entre `pure/ice(4 heladas)/window(combo −500ms, mín 1500)/variety(pool de 6)/rocks(3)/fast(curva de spawn ×0.9)/crystal(2 cristales)/nohints`. Se aplica tras montar el nivel consumiendo RNG seedeado (idéntico para todos). **Calendario y racha (v2.4.0, GM-14):** `dailyRun.history` guarda la medalla de cada día (tope 60, FIFO); la racha cuenta días consecutivos con medalla ≥ bronce con **1 congelación de regalo +1 por cada 7 días** (un día perdido pausa, no borra); cada 7 días de racha → +1 cofre (una vez por hito, `streakRewarded`).

**Ficha y objetivo vivo del reto (v2.6.0, FB-4):** los umbrales viven en `Meta.DAILY_MEDALS = [750,1500,2500]` y `Meta.dailyNextMedal(score)` devuelve el siguiente corte o `null`. El home y el panel de misiones abren `view-daily` antes de jugar: muestra fecha, tablero compartido, mutador con efecto, medallas, mejor marca/ghost, racha y bonus de primer intento. En partida diaria, `#daily-note` muestra la siguiente medalla con número y se actualiza al cruzar 750/1500/2500 con toast una vez por umbral.

### 2.5 Supervivencia (`supervivencia`)
`timed:false, penalties:true, mult:1.5, fast:true, endless:true`. Ver detalle completo en §2.5.1 más abajo y potenciadores en §7.

Antes de empezar, el jugador elige dificultad (fácil/normal/difícil), persistida. Tabla de tuning por dificultad (`Survival.TUNE`):

| diff | waveMs | lives | spawnDecay | spawnFloor | trapBase | trapCap | varEvery | bossEvery | coinMult |
|---|---|---|---|---|---|---|---|---|---|
| facil | 32000 | 4 | 0.985 | 2000 | 0.008 | 0.05 | 8 | 8 | 0.85 |
| normal | 28000 | 3 | 0.975 | 1400 | 0.010 | 0.07 | 6 | 6 | 1.0 |
| dificil | 22000 | 3 | 0.960 | 900 | 0.016 | 0.10 | 5 | 5 | 1.3 |

Constantes clave: `WAVE_MS` base 22000, `MAX_LIVES` base 3, `CHARGE_PER = 9` (carga de suministro por convergencia), `BOOSTERS = ['bomb','freeze','clearLine','wild','x2']`, `SLOWDOWN_CAP=1`. **Topes por dificultad (v2.6.2):** `SPECIAL_CAP` 6/7/8 (fácil/normal/difícil, especiales totales), `BLOCK_CAP` 4/5/6 (bloqueos rock/locked), `BOMB_CAP` 2/2/3 (pickups bomba). Los bloqueos (`rock`/`locked`, colocados como trampas con prob. 0.55 salvo semana del hielo) tienen 1 hit antes de la oleada 9/7/5 (fácil/normal/difícil) y 2 después.

**Oleadas:** `newWave()` se dispara cuando `waveAcc >= WAVE_MS`. En cada oleada: recompensa de oleada (monedas: `max(3, round((4 + oleada×1.45) × coinMult × mutCoinMult))`, **más el kicker tardío v2.6.4: `+round((oleada−14)^1.5 × 2)` desde la oleada 15**; gemas cada 5 oleadas: `2 + floor(wave/5)`; cofre cada 10 oleadas), `spawnRate = max(spawnFloor, round(spawnRate*spawnDecay))`, se recalcula `dlevel() = 1 + floor((wave-1)/tune.varEvery)` (nivel efectivo de dificultad de iconos) refrescando el pool, se añaden trampas y pickups de bomba, ocasionalmente un pickup de ralentización, y cada `bossEvery` oleadas se dispara un `bossEvent()` — uno de 3 eventos aleatorios. Desde v2.1.0 (GM-18) el tipo de evento se **pre-decide al empezar la oleada anterior** (`_planBoss()`): la oleada previa muestra una bandera «⚠ Jefe» y ~3s antes del evento llega un aviso específico del tipo; `bossEvent()` consume ese pre-roll. Los 3 eventos:
- `meteorRain()` — 8 spawns forzados + bloqueo de 900ms.
- `tideSurge()` — **Marea (v2.4.0, GM-20, sustituye al terremoto en el pool base):** marca las 2 filas exteriores 1.2s y las llena de iconos; amenaza legible con counterplay.
- `frostSurge()` — congela `3 + floor(wave/4)` celdas ocupadas + bloqueo de 760ms.
- `quake()` — baraja el tablero (Fisher-Yates de valores) tras 620ms + bloqueo de 1150ms. Desde v2.4.0 solo entra al pool en la "semana del caos" (mutador semanal).

**Mutador semanal (v2.4.0, GM-22):** `hash32('survmut:' + lunesISO) % 4` elige el tema de la semana: `none` / `ice` (todas las trampas heladas, monedas de oleada ×1.15) / `chaos` (quake vuelve al pool de jefes) / `frenzy` (duración de frenesí ×1.3). Determinista sin servidor; el simulador lo fija a `none` para reproducibilidad.

**Bendiciones post-jefe (v2.3.0, GM-17 · rediseño v2.6.4, SV-01):** ~1.7s después de cada evento jefe, pausa suave y elección de 1 entre 3, muestreadas **por peso de rareza sin reemplazo** (RNG seedeado) sobre un pool de 8. Exclusiones: `life` si `lives ≥ MAX+1`, `score_boost` si ya está al tope.

**Framework de ENCUENTROS de jefe (v2.6.15, JF-α — ⚠ APAGADO en producción):** módulo `Bosses` (plan completo en `BOSS_SYSTEM_MASTER_PLAN.md`). Con `Bosses.ENCOUNTERS=true` (lo enciende JF-γ tras las puertas de balance B-J1/B-J3), `bossEvent()` deja de ser un efecto instantáneo y arranca un **encuentro** de `~1.8 × WAVE_MS`: el jefe materializa 2-4 **anclas** (tiles `boss` no-sólidos BAJO iconos existentes, contadas en `SPECIAL_CAP`) y **ataca** cada `attackMs` (10-14s) con pre-marca de celdas 2.5s antes (patrón de la marea generalizado). Converger el icono sobre un ancla = 1 golpe; anclas **blindadas** llevan `hits>0 + solid=true` en la instancia (icono atrapado con semántica de hielo; la adyacencia o una bomba agrietan). Anclas y jaulas (`cage`, devuelve `t.loot` al romperse) son **inmunes a `_powerClear`** (objetos/alivio). Fase 2 al caer la mitad de las anclas. Resolución: **derrota** (todas las anclas rotas → `_bossesDefeated`/`_lastDefeat{id,lvl,flawless}`) o **retirada** (expira `durMs`); ambas programan el beat SV-20 y la bendición como siempre — ignorar al jefe reproduce la experiencia clásica (garantía nº1 del plan). Identidad sorteada por **actos** (`actoForWave`: I <12 / II 12-23 / III 24+; pools del `DEX`, semana del caos promueve `quake`, sin repetición inmediata) con **nivel** visible `levelForWave = min(3, 1+⌊oleada/12⌋)` (+1 eco «ha vuelto», +1 Heraldo JF-δ, tope IV «PESADILLA»). `eco` pasa de tipo a **regla de sorteo** (15% con jefe previo). Un ancla cuyo icono desaparece por vías indirectas se **re-encarna** (~0.9s) para no quedar invulnerable. Overrides de sim/tests: `Survival._bossOverride` se respeta; el bot del sim es **boss-aware** (`bossAware` por perfil: 0.7/0.35/0.1 prioriza golpear anclas). Invariante duro: máximo un encuentro activo; `Survival.start()`/`cleanup()` abortan cualquier resto.

| id | rareza | peso | efecto |
|---|---|---|---|
| `life` | común | 45 | +1 vida (tope MAX+1) |
| `charge` | común | 45 | +50 de carga de suministro (≥100 ⇒ paga monedas con remanente) |
| `slow` | común | 45 | intervalo de spawn ×1.25 durante 3 oleadas (factor en el bucle) |
| `pack` | infrecuente | 35 | +1 bomba y +1 rayo |
| `frenzy` | infrecuente | 35 | frenesí instantáneo |
| `magnet` | rara | 15 | las próximas 5 convergencias atraen +1 la figura MÁS CERCANA al toque (si no hay nada que atraer, no consume uso) |
| `score_boost` | rara | 15 | +0.25× permanente a `Survival.scoreMult()`, tope `SCORE_BOOST_CAP = 0.5` |
| `golden_wave` | épica | 4 | `Survival.scoreMult()` ×2 durante lo que queda de la oleada actual + toda la siguiente (`goldenWaveWaves = 2`, decrementa en `_waveReward`) |

`Survival.scoreMult() = (1 + scoreBoost) × (goldenWave ? 2 : 1)` entra en la fórmula de puntuación (§6.1), en el chip GM-16 y en el popup — los tres DEBEN compartir el helper. *Historia: la implementación inicial v2.6.2 (sin validar) usaba golden ×3, tope de impulso 1.0, peso épico 5 y `Math.random()`; la validación SV-01 (bisección + batería, ver `BALANCE_BASELINE.md`) aplicó la tabla de nerf pre-acordada y restauró el RNG seedeado.*

**Vidas:** 3 corazones por defecto; se pierden vía `onOverflow()` cuando el tablero no puede aceptar un spawn; al llegar a 0 → `lastChance()` (modal de revivir, restaura 1 vida); `giveUp()` termina la partida. **Precio de revivir (v2.2.0, GM-19):** `min(480, 120 × 2^usos)` por run — 120 → 240 → 480, máximo **3 revividas por run** (a la 4ª muerte no hay oferta). Antes: 120 plano ilimitado.

**Medidor de frenesí (0-100):** `addFrenzy(n)` se incrementa por convergencia (`4 + min(22, removed*2 + min(combo,10))`), por inicio de oleada (`8 + tier*3`), por uso de booster, y por bono de tablero vacío. Al llegar a 100 → `activateFrenzy()`: duración `7200 + frenzyTier()*900` ms, spawnea `2+frenzyTier()` iconos extra, multiplica score por `frenzyMult() = 1.55 + tier*0.1`. `frenzyTier() = clamp(floor((wave-1)/4)+1, 1, 3)`.

**Anillo de suministro:** se llena `CHARGE_PER(9) + min(combo,6)` por convergencia (+4 si ya está en frenesí); al llegar a 100 conserva el remanente y paga `round(2 × coinMultDificultad × coinMultMutador)` monedas. No crea boosters ni modifica `boosterStock`.

**Rocas rompibles:** `_crackRock` reduce `hits` en 1 por cada convergencia adyacente (vecinos ortogonales de la celda tocada + cada celda eliminada); se destruyen al llegar a 0 hits.

### 2.6 Zen (`zen`)
`timed:false, penalties:false, mult:0.8, relaxed:true, endless:true, noFever:true`, objetivo "sin fallos ni prisa". `onOverflow()` → `softClear(0.45)` (elimina el 45% de las celdas ocupadas al azar **en vez de terminar la partida** — literalmente sin game over). El spawn es 1.25× más lento (`relaxed`). El bono de tablero vacío otorga +1 pista (tope 9).

**Desde v2.3.0 (GM-24):** la Fiebre no se activa (`noFever` → umbral infinito), el indicador de combo y el chip de multiplicador se ocultan y el score se atenúa (santuario sin evaluación). El lanzador ofrece elegir **ritmo**: «Sereno» (tabla `facil`) o «Fluido» (`normal`), persistido en `cv_zen_diff` — único punto del juego con ritmo elegible.

**Jardín zen (v2.4.0, GM-23):** cada tablero limpio en Zen suma 1 flor permanente (`Meta.zen.flowers`, visible en el banner). Hitos: 10 flores → +1 cofre; 50 flores → skin de tablero exclusivo «Jardín Zen» (`Boards.DEFS.jardin`, `exclusive: true`, no comprable en tienda). Colección sin fallo posible: nada resta flores jamás.

### 2.7 Tabla de dificultades (`Config.DIFFICULTY`)

| diff | initialIcons | comboWindow(ms) | spawnStart(ms) | spawnMin(ms) | scoreMult | penaltyBase |
|---|---|---|---|---|---|---|
| facil | 12 | 5000 | 6000 | 2000 | 0.8 | 1 |
| normal | 18 | 3500 | 5000 | 1400 | 1.0 | 2 |
| dificil | 24 | 2500 | 3800 | 900 | 1.3 | 3 |

---

## 3. Modelo de datos y persistencia

Toda la persistencia usa `localStorage`. Tres capas: claves escalares sueltas, un blob de ajustes, y un blob grande de progresión ("Meta"). No hay backend ni sincronización — el modelo debe reproducirse tal cual (o migrarse a un backend equivalente conservando exactamente estos campos).

### 3.1 Claves escalares (`Storage`)
| Clave | Tipo | Descripción |
|---|---|---|
| `cv_best` | number | Mejor puntuación histórica global (todas las partidas, todos los modos) |
| `cv_sound` | `'on'\|'off'` | (legacy, superpuesto por `Settings.sfx`) |
| `cv_user` | string | Nombre de jugador; su presencia decide pantalla `login` vs `start` |
| `cv_profile` | JSON `{name, color}` | Perfil básico |
| `cv_tut` | `'1'|'0'` | Tutorial completado |
| `cv_ver` | string | Última versión vista (toast de "actualizado") |
| `cv_surv_diff` | `'facil'|'normal'|'dificil'` | Última dificultad de Supervivencia elegida |

### 3.2 Ajustes (`cv_settings`)
```ts
interface SettingsData {
  sfx: boolean;        // default true
  music: boolean;      // default false
  haptics: boolean;    // default true
  reducedFx: boolean;  // default = prefers-reduced-motion del SO
  lang: 'es' | 'en';   // default: 'en' si navigator.language empieza con 'en', si no 'es'
  largeText: boolean;  // default false
}
```

### 3.3 Log de errores (`cv_errlog`)
```ts
type ErrLogEntry = { t: number; v: string; kind: string; msg: string /* máx 300 chars */; extra?: any };
// array con tope de 20 entradas (FIFO)
```

### 3.4 Perfil de progresión (`cv_meta`, versión de esquema `_v: 9`)

```ts
type ChestType = 'wood' | 'bronze' | 'silver' | 'gold' | 'magic' |
  'royal' | 'supreme' | 'champion' | 'divine' | 'event';
type BoosterId = 'bomb' | 'freeze' | 'clearLine' | 'wild' | 'x2';

interface ChoiceOption {
  id: 'coins' | 'gems' | 'tickets' | 'booster';
  kind: 'coins' | 'gems' | 'ticket' | 'booster';
  amount: number;                       // entero seguro, 1..1.000.000
  rarity: 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'special';
  boosterId?: BoosterId;                // obligatorio si booster; amount limitado a 1..10
}
interface ChoiceSnapshot {
  id: `daily:${string}`; date: string;  // fecha UTC YYYY-MM-DD
  tier: 'bronze' | 'silver';
  catchUp: boolean;                     // true implica tier === 'silver'
  options: [ChoiceOption, ChoiceOption, ChoiceOption];
}
interface EventSnapshot {
  id: `weekly:${string}:w_${'games'|'remove'|'score'|'combo'}`;
  week: string;                         // YYYY-MM-DD devuelto por weekId(), capturado al ganar
  challengeId: `w_${'games'|'remove'|'score'|'combo'}`;
  featuredBooster: BoosterId;
  source: string;                       // [a-z0-9-], 1..32
}
interface ChestEntry {
  uid: string; type: ChestType; source: string; earnedAt: number;
  durationMs: number;                   // snapshot de duración de la instancia
  choice?: ChoiceSnapshot;              // solo Choice diario válido
  event?: EventSnapshot;                // solo type === 'event'
}
interface ChestUnlock {
  uid: string; startedAt: number; endsAt: number; durationMs: number; auto?: boolean;
}

interface MetaData {
  _v: 9;
  xp: number; level: number;
  xpBoostUntil: number;                 // timestamp Unix ms; 0 = inactivo
  games: number;
  totalRemoved: number;                 // iconos eliminados de por vida
  coins: number; gems: number; tickets: number; chests: number;
  achievements: Record<string /*achId*/, string /*fecha ISO desbloqueo*/>;
  daily: { date: string; id?: string; progress?: number; done?: boolean };
  streak: { count: number; date: string };
  reward: { date: string; day: number };
  adventure: { maxLevel: number };
  worlds: Record<string, { levels: Record<string, number>; reward?: string }>;
  boards: { owned: Record<string, number>; equipped: string };
  survBest: number;
  survBestWave: number;
  stats: { totalScore: number; bestCombo: number; totalTime: number };
  modes: Record<string, { best: number; plays: number }>;
  weekly: { week: string; id: string; progress: number; done: boolean };
  cosmetics: { owned: Record<string, string>; theme: string; skin: string; fx: string };

  chestInventory: ChestEntry[];
  chestUnlock: ChestUnlock | null;       // como máximo uno en curso
  chestSlots: number;                   // clamp entero 3..4
  chestSeq: number;
  chestPipeline: { wins: number; cycle: number };
  dailyChest: { date: string };          // último Choice concedido, no el último reclamado
  chestReady: string[];                 // UIDs terminados/listos o Choice inmediato
  chestNotifiedReady: string[];         // deduplicación de aviso local
  boosterStock: Record<BoosterId, number>;
}
```

**Historial aditivo del submodelo de cofres:** schema 4 introdujo inventario tipado/ranuras; schema 5 añadió
`chestPipeline` y `dailyChest`; schema 6 fijó `durationMs` por instancia y separó `chestReady`/avisos; schema 7 añadió
`boosterStock`; schema 8 versionó los snapshots `choice` y `event`; schema 9 añadió `xpBoostUntil`. No se necesita una
migración destructiva entre ellos: al cargar se rellenan campos ausentes, se validan y al final se escribe `_v = 9`.

**Invariantes de migración/corrupción:**

- `m.chests` sigue siendo el contador canónico y debe coincidir con `chestInventory.length`. Contadores legacy sin
  entrada se materializan como cofres `wood` de forma determinista, sin consumir `Math.random`.
- UID ausente, inválido o duplicado se repara sin perder el cofre; las referencias de timer/listo se podan o remapean.
  Un `durationMs` ausente recibe el mapa pre-CH-3 de su tipo, preservando `startedAt`/`endsAt` del timer ya activo.
- Solo se copian los payloads conocidos `choice` y `event`; ningún snapshot puede sobreescribir UID, tipo, fuente o
  duración. Un Choice inválido/manipulado pierde `choice` pero conserva el cofre normal del mismo tier y no aplica
  economía. Un `event` válido solo puede vivir en un cofre `event`; uno legacy recibe una foto del evento vigente una
  única vez.
- Cada `boosterStock[id]` debe ser entero seguro y queda limitado a 0..1.000.000; claves desconocidas no se conceden
  ni se gastan. Se fuerza además `boards.owned.classic = 1` como antes.
- `xpBoostUntil` se normaliza a `0` si no es un número finito no negativo. El tiempo usa reloj de pared, por lo que
  sigue transcurriendo con la app cerrada y no se mezcla con `boosterStock` (el arsenal táctico).

**Helpers derivados:**
- `xpForLevel(lvl) = 300 + (lvl-1)*250` (curva lineal de XP).
- `RANKS = ['Novato','Aprendiz','Hábil','Experto','Maestro','Leyenda','Mítico']`; `rank() = RANKS[min(RANKS.length-1, floor((level-1)/3))]` (cambia cada 3 niveles de jugador).
- `hashStr(s)` — hash polinomial simple (`h = h*31 + charCode`, coaccionado a 32 bits) usado para elegir determinísticamente la misión/desafío del día/semana a partir de la fecha, sin necesidad de servidor.
- `today() = new Date().toISOString().slice(0,10)`; `weekId(dt)` normaliza al lunes de la semana ISO.

**Snapshot del XP Booster:** `Meta.xpBoost(now)` devuelve `{active,multiplier,endsAt,remainingMs}`; el multiplicador
solo puede ser `1` o `4`. `activateXpBoost(durationMs, now)` extiende desde `max(now, xpBoostUntil)`. `Game.start()`
captura ese valor en `State.xpMultiplier`; `RunSave` lo guarda y al reanudar restaura exactamente `4` o `1`, sin
promover una partida antigua porque el booster se haya activado después. Cada nivel encadenado de Clásico se liquida
como partida y vuelve a capturar el multiplicador al comenzar el siguiente nivel.

---

## 4. Economía

Tres monedas + cofres, todo dentro de `Meta`.

- **Monedas (coins):** se ganan al final de cada partida (`recordGame()`, fórmula en §6.5), al completar niveles de Clásico, en recompensas de oleada de Supervivencia, en bonos de tablero vacío de Zen, en la recompensa diaria, y al abrir cofres. Se gastan en: skins de tablero (0-3000), temas de color (0-300), revivir en Supervivencia (escalante 120→240→480, máx. 3/run) y potenciadores pre-nivel de Clásico (60-90 cuando no hay unidad en el arsenal).
- **Gemas (gems):** se ganan en hitos de oleada de Supervivencia (`2 + floor(wave/5)` cada 5 oleadas), en recompensa de mundo completado (+20), en cofres según tipo/nivel y en el primer intento diario del Reto (+5). Sumideros: cofre premium (25💎), continuar partida en Clásico/Aventura (15💎), cuarta ranura (150💎) y saltos de cofre a `ceil(3 × horasRestantes)`.
- **Tickets:** se ganan en cofres según tipo y en tiradas bonus. Se gastan en rerollear la misión diaria (1 ticket).

### 4.1 Cofres tipados y ceremonia (CH-1…CH-5)

`CHEST_TYPES` contiene diez tipos y su tabla principal; `CHEST_DROP_SEQUENCE` es un ciclo de 32 sin `event`, con
`champion` y `divine` garantizados por vuelta. Cada tres objetivos de cualquier modo se concede el siguiente tipo. Los
eventos se conceden por su fuente semanal mediante `addEventChest`, nunca como sustituto sin contexto del ciclo.

Al abrir un cofre normal, el orden económico es exacto:

1. **Tier:** `Math.random() < 0.10` sube un escalón por `CHEST_UPGRADE_PATH`
   (`wood→bronze→silver→gold→magic→royal→supreme→champion→divine`; `event→royal`). `divine` no tira mejora. Rangos,
   rareza y número de premios pasan a ser los del tipo destino; el resultado conserva `baseChestType` y expone
   `upgradeRoll`/`tierUp`.
2. **Escala:** `scale = min(2.5, 1 + 0.05 × (max(1, level) − 1))`. Se aplica a monedas y gemas de todas las tiradas;
   tickets y unidades de booster no escalan.
3. **Premio garantizado:** una tirada uniforme del rango de monedas del tipo × `scale × 0.25`, redondeada y con mínimo 1.
4. **Tirada principal:** usa los cortes `coinCut`, `gemCut`, `ticketCut` de `CHEST_TYPES[type].reward`; la cola es
   cosmético no poseído y, con el pool agotado, fallback de recursos.
5. **Tiradas menores:** hasta completar 2 premios (small), 3 (medium/large/variable) o 4 (xlarge/huge). Cada extra usa
   52% monedas, 23% gemas, 13% ticket ×1 y 12% booster ×1 uniforme entre los cinco IDs. En un cofre `event`, el último
   extra se reemplaza por el `featuredBooster` garantizado de su snapshot.
6. Todos los elementos de `reward.items` se aplican exactamente una vez; el payload es JSON-serializable y después se
   elimina UID/listo/aviso del inventario. Si no hay otro timer, la cola auto-inicia el cofre pendiente más corto.

Los drops cosméticos usan `Math.random` de la economía meta, no el PRNG seedeado del tablero. Tableros se conceden con
`Meta.grantBoard(id)` y temas con `Meta.grantTheme(id)`; ambos son idempotentes. El «pity» visible no altera este RNG:
`chestPipelineInfo().chestsToMythic` cuenta la distancia determinista al siguiente `champion`/`divine` del ciclo.

**Choice diario (schema 8):** el primer objetivo del día UTC fija tres opciones (monedas, gemas y, al 50%, ticket o
booster), crea Bronce y llama inmediatamente a `makeChestChoiceReady`; no hay espera ni coste de salto y no se aplica
economía antes de elegir. Si `dailyChest.date` válida queda dos o más días atrás, solo el nuevo Choice sube a Plata
(`catchUp=true`); usuario nuevo o fecha del día anterior recibe Bronce. `openChest` rechaza un Choice y únicamente
`claimChestChoice(uid, optionId)` aplica una de las tres opciones; opción inválida y segundo claim son no-op.

**Evento semanal (schema 8):** `addEventChest(source)` captura `EventSnapshot` al conceder. El booster se elige de forma
determinista con el hash de `week:challengeId`; cambiar de semana no modifica cofres poseídos. Un evento legacy sin
snapshot recibe el vigente una vez al cargar y garantiza después la unidad capturada.

**Cofre premium:** cuesta `Meta.PREMIUM_CHEST_GEMS = 25`, no tira mejora y entrega tres elementos: monedas garantizadas
`80..160 × scale`, la tabla principal histórica (52% monedas 200..499, 30% tickets ×2, 10% jackpot 600..999, 8%
cosmético/fallback) y una tirada menor 52/23/13/12. La tabla principal no devuelve gemas, aunque el extra sí puede hacerlo.

**Guardarraíl reproducible:** `runChestEconomy({runs, seed, types, levels})` usa `Meta.addChest`/`addEventChest` y
`Meta.openChest`, informa EV de monedas/gemas/tickets/boosters, premios y tier-ups por tipo/nivel y restaura
`Meta.state`, `localStorage.cv_meta` y `Math.random` en `finally`. CLI: `node tools/balance-sim.js --chests --runs 200`.

**Recompensa diaria de inicio de sesión:** disponible si `reward.date !== today()`. Al reclamar: si el último reclamo fue exactamente ayer, `day++` (la racha continúa); si no, `day = 1`. `amount = 20 + 10*min(day, 7)` monedas (día 1 = 30 … día 7+ = 90, tope 90).

### Catálogos comprables (verbatim)

**Skins de tablero** (`Boards.DEFS`, coste en monedas):
```
classic 0 · madera 500 · hielo 800 · lava 1200 · cristal 1500 · magico 2000
futurista 2500 · dorado 3000 · bosque 1800 · cosmico 2200
```
Puramente cosméticos, sin efecto en el gameplay (explícito en el código fuente).

**Temas de color** (`Themes.DEFS`, coste en monedas):
```
default 0 (Cosmos) · neon 150 · sunset 200 · forest 200 · aurora 300 · mono 250 (Eclipse)
```
Cada tema sobreescribe variables CSS: `--bg-0`, `--bg-1`, `--bg-2`, `--panel`, `--panel-2`, `--accent`, `--accent-2`, `--level`, `--score`.

### 4.2 Tienda de recursos y checkout de pruebas

`Storefront` es un catálogo allowlist separado de la tienda cosmética. La UI transporta solo el `id` de oferta; la
cantidad acreditada y el coste se resuelven desde el catálogo. `checkoutCurrency(id)` usa por ahora
`PAYMENT_MODE = 'mock-auto'`: acredita localmente y de inmediato, devuelve una transacción `status:'paid'` y la vista
muestra de forma permanente que no existe cobro real. Una pasarela de producción, validación de recibos y concesión
idempotente en servidor quedan fuera de este adaptador ficticio.

| id | recurso | cantidad | referencia | precio mostrado |
|---|---:|---:|---:|---:|
| `gems-spark` | gemas | 100 | — | 1,09 EUR |
| `gems-cache` | gemas | 330 | 300 | 3,39 EUR |
| `gems-vault` | gemas | 1.200 | 1.000 | 11,99 EUR |
| `coins-pouch` | monedas | 1.000 | — | 1,09 EUR |
| `coins-crate` | monedas | 6.000 | 5.000 | 3,39 EUR |
| `coins-vault` | monedas | 18.000 | 15.000 | 5,99 EUR |

Los tres packs temporales se pagan con gemas y multiplican por `4` todo el XP base de una partida, incluidos los
bonos de misión diaria/semanal. Comprar mientras está activo acumula duración desde el vencimiento actual.

| id | duración | multiplicador | coste |
|---|---:|---:|---:|
| `xp-6h` | 6 horas | ×4 | 25 gemas |
| `xp-3d` | 3 días | ×4 | 80 gemas |
| `xp-7d` | 7 días | ×4 | 160 gemas |

**Coste de revivir (Supervivencia):** `min(480, 120 × 2^usosEnLaRun)`, máximo 3 revividas por run (v2.2.0, GM-19; antes: 120 plano ilimitado).

---

## 5. Progresión

### 5.1 Misiones diarias (`Meta.MISSIONS`)
```
m_combo   "Consigue un combo ×8"             target 8     kind 'combo'
m_remove  "Elimina 80 iconos en una partida" target 80    kind 'remove'
m_score   "Haz 2500 puntos en una partida"   target 2500  kind 'score'
m_perfect "Deja el tablero vacío una vez"    target 1     kind 'perfect'
```
Selección determinística: `hashStr(today()) % MISSIONS.length` (misma misión para todos los jugadores en la misma fecha calendario, se renueva una vez al día). Progreso = máximo corriente (`max(progress, valorDeLaPartida)`) para todos los `kind`. Recompensa al completar: **+150 XP y +60 monedas**.

### 5.2 Desafío semanal (`Meta.WEEKLY`), acumulativo durante la semana
```
w_games  "Juega 12 partidas esta semana"    target 12     kind 'games'
w_remove "Elimina 800 iconos esta semana"    target 800    kind 'remove'
w_score  "Suma 20.000 puntos esta semana"    target 20000  kind 'score'
w_combo  "Consigue un combo ×15"             target 15     kind 'combo'
```
Id de semana = fecha ISO normalizada al lunes. Progreso acumula (`+= inc`: games=1 por partida, remove=celdas eliminadas, score=puntos) excepto `combo` que usa máximo corriente. Recompensa: **+400 XP y +200 monedas**.

### 5.3 Logros/medallas (`Meta.ACH`) — 10 en total
```
first     "Primer paso"     Completa tu primera partida        games>=1
combo10   "En racha"        Consigue un combo ×10              maxCombo>=10
combo20   "Imparable"       Consigue un combo ×20              maxCombo>=20
perfect   "Impecable"       Deja el tablero vacío              perfect
score3k   "Triple millar"   Supera 3000 puntos                 score>=3000
score8k   "Leyenda viva"    Supera 8000 puntos                 score>=8000
level5    "Escalador"       Alcanza el nivel 5 (de partida)     gameLevel>=5
remove200 "Demoledor"       Elimina 200 iconos (de por vida)    totalRemoved>=200
fever     "¡Fiebre!"        Entra en modo Fever                 feverEver (esta partida)
streak3   "Constante"       Juega 3 días seguidos               streak.count>=3
```
Se comprueban una vez por partida contra el contexto de fin de juego; el desbloqueo muestra un toast y sonido específico, y persiste la fecha de desbloqueo.

### 5.4 XP y nivel de jugador
`xpForLevel(lvl) = 300 + (lvl-1)*250`. `addXp(n)`: bucle `while xp >= umbral { xp -= umbral; level++ }` (puede subir varios niveles en una partida). Fórmulas de recompensa por partida (`recordGame`, ver §6.5 para el detalle completo).

### 5.5 Mundos del modo Clásico (`Worlds`)
`PER_WORLD = 50` niveles por mundo, `REWARD_EVERY = 50`. 5 mundos:
```
bosque    Bosque Verde      🌲 #3ad07f mods:['chains']
desierto  Desierto Dorado   🏜️ #ffb24d mods:['rocks']
montana   Montaña Helada    🏔️ #7ad7ff mods:['ice','web']
cueva     Cueva Misteriosa  🔮 #a06bff mods:['crystals','portal','barrier']
neon      Ciudad Neón       🏙️ #ff5cf0 mods:['rush','bomb','magicbox']
```
Desbloqueo de mundo: el mundo 0 siempre desbloqueado; el mundo *i* se desbloquea cuando el mundo anterior tiene ≥25 niveles con ≥1 estrella (`worldCleared >= 25`, la mitad de 50). Desbloqueo de nivel: nivel 1 siempre desbloqueado; nivel *n* se desbloquea cuando el nivel *n-1* tiene estrellas > 0. Recompensa de mundo completo (requiere las 50 niveles con ≥1 estrella): **+1 cofre, +20 gemas**, reclamable una sola vez.

### 5.6 Estructura de Aventura (biomas/capítulos)
`perChapter = 5` niveles por capítulo. 6 biomas cíclicos (`chapter % 6`):
```
nebula   Nebulosa               🌌 mods:[]         accent #7a5cff
asteroid Cinturón de Asteroides 🪨 mods:['rocks']   accent #ff9838
ice      Campo de Hielo         🧊 mods:['ice']     accent #2bd4e6
core     Núcleo Ardiente        🔥 mods:['rush']    accent #ff5b6e
void     El Vacío               🕳️ mods:['scarce']  accent #a06bff
crystal  Cristalia              💎 mods:['crystals']accent #19f0d0
```
- `chapterOf(level) = floor((level-1)/5)`; `licOf(level)` = índice del nivel dentro del capítulo (0-4); `isBoss(level)` = `licOf===4` (el último nivel de cada capítulo siempre es jefe).
- Objetivo por nivel: jefe → `'boss'`; `lic===2` → `'score'`; `lic===3 && chapter>0` → `'survive'`; resto → `'clear'` (default vaciar tablero).
- Objetivo de puntuación (FB-6): `level * (300 + 50*chapter)`; el banner muestra progreso vivo `score - levelScore0` sobre el objetivo. Objetivo de supervivencia: `18 + chapter*4` segundos.
- Niveles jefe colocan `2 + min(chapter,4)` tiles de cristal que deben limpiarse todos para ganar. **Desde v2.4.0 (GM-08) el jefe ACTÚA:** cada 20s (aviso 3s antes) ejecuta el ataque de su bioma — nebulosa: 3 spawns forzados · asteroides: +2 rocas · hielo: congela 2 · núcleo: spawn ×0.9 · vacío: −1 pista · cristal: +1 cristal (se "regenera", tope 6 en tablero). **Registro de expedición (v2.4.0, GM-09):** las elecciones de la run (capítulo+ruta, reliquias) se registran y se muestran como cadena en el resumen de fin de partida.
- El spawn se acelera por capítulo: `spawnRate = max(360, round(spawnRate/(1+chapter*0.12)))`.
- Densidades/modificadores por bioma escalan con el capítulo (rocks `min(0.16, 0.06+chapter*0.012)`, ice `min(0.14,0.05+chapter*0.012)`, rush ×0.8 spawnRate, scarce fija `hintsLeft=1`).
- El progreso solo avanza (`advReach(level)`, nunca retrocede); Aventura **siempre retoma** en el nivel máximo alcanzado, nunca reinicia desde el nivel 1.

---

## 6. Combos y puntuación

### 6.1 Fórmula de puntuación por convergencia
```
removed  = cantidad de iconos eliminados en este toque (2-4; +1 con imán activo)
base     = removed * 10 * level         // "level" = nivel de dificultad efectivo del modo
survMult = Supervivencia ? Survival.scoreMult() : 1   // bendiciones (v2.6.4): (1+scoreBoost) × (goldenWave?2:1)
points   = floor(base * comboMult * diff.scoreMult * mode.mult * feverBoost() * (tempMult||1) * sprintMult() * survMult)
```
El chip GM-16 (`Render.multChip`) y el popup de puntos muestran `comboMult × feverBoost × tempMult × sprintMult × survMult` — exactamente los factores variables de la fórmula (los constantes de la run, dificultad y modo, van implícitos).
(`level` en modos sin niveles explícitos es un "nivel de dificultad sintético": en Supervivencia es `dlevel()`, en Aventura es el nivel real de aventura).

### 6.2 Tabla de multiplicador de combo (`Config.COMBO_MULTIPLIERS`)
Array `[umbral, multiplicador]`, se evalúa de mayor a menor umbral, primera coincidencia gana:
```
[[30,10], [20,8], [15,5], [10,3], [6,2], [3,1.5]]
```
Traducido: combo 1-2 → ×1 (default) · 3-5 → ×1.5 · 6-9 → ×2 · 10-14 → ×3 · 15-19 → ×5 · 20-29 → ×8 · 30+ → ×10.

### 6.3 Continuidad/decaimiento del combo
`comboWindow` = valor de la dificultad activa (fácil 5000ms, normal 3500ms, difícil 2500ms). En cada toque exitoso: si `ahora - comboAt <= comboWindow` → `combo++`; si no → `combo = 1`. `comboAt = ahora`. El loop principal comprueba cada frame: si la ventana restante llega a 0, se resetea el combo (vuelve a 0, multiplicador a 1, y sale de Fiebre si estaba activa).

### 6.4 Bonos de hito (`Config.MILESTONES`)
```
{ 10: 500, 20: 1000, 30: 2000 }
```
Puntos flat añadidos exactamente cuando `combo` es igual a 10, 20 o 30.

### 6.5 Modo Fiebre (Fever)
- Umbral para entrar: `Config.FEVER_COMBO = 10` normalmente; en Supervivencia `max(6, 10 - frenzyTier())` (el tier de frenesí baja el umbral).
- Efecto: `feverBoost() = FEVER_BOOST(1.25) + (frenzyTier()*0.06 si Supervivencia)` — multiplica la puntuación mientras está activo.
- Al ENTRAR en Fiebre los spawns se pausan **500ms** (`State.spawnHoldUntil`, "aspiración" del espectáculo de entrada — v2.1.0, GM-27).
- Sale de Fiebre cuando el combo se resetea a 0.
- `tempMult` (multiplicador temporal) se combina con Fiebre en Supervivencia: `tempMult = (x2Activo?2:1) * frenzyMult()`.

### 6.6 Bono de tiempo en Contrarreloj
```
tg = TIMED_GAIN { base:0.9, perIcon:0.6, combo:0.32, comboCap:4, decaySec:125, minDecay:0.08 }
decay = clamp(1 - elapsed/tg.decaySec, tg.minDecay, 1)             // 100%→8% hacia los ~125s
raw   = (tg.base + min(removed,4)*tg.perIcon + min(combo,4)*tg.combo) * decay
timeLeft = min(TIMED_CAP(90), timeLeft + raw)                       // tope duro
```
Diseño deliberado para que una buena racha compre segundos, pero el reloj pueda agotarse. El bono de tablero limpio no repone tiempo; la cápsula de tiempo sigue siendo el pickup puntual de +5s.

### 6.7 Callouts de "rank" al subir de tier de combo
Se muestran cuando el multiplicador sube de tier (y `combo >= 3`):
```
1.5 → '¡BIEN!'   2 → '¡GENIAL!'   3 → '¡INCREÍBLE!'   5 → '¡ÉPICO!'   8 → '¡LEGENDARIO!'   10 → '¡MÍTICO!'
```
Color por tier: ≥8 dorado `#ffd84d`, ≥5 rosa `#ff5cf0`, ≥3 morado `#b46cff`, ≥2 cian `#00d0ff`, ≥1.5 verde `#34e29b`, resto blanco.

### 6.8 Bono de tablero vacío (modos endless/scoreAttack)
```
chain = cantidad de veces que el tablero quedó vacío en esta partida
wave  = oleada actual (Supervivencia) o 1
combo = min(combo actual, 12)
raw    = EMPTY_BOARD_BONUS(500) + chain*90 + combo*28 + (Supervivencia ? wave*45 : 0)
points = max(250, round(raw * diff.scoreMult * mode.mult * feverBoost() * tempMult * sprintMult()))
coins  = clamp(round(points/220), 3, 16)
```
Además: en Supervivencia +25% de carga de suministro y +24 de frenesí; en Zen +1 pista (tope 9) y +1 flor del jardín. En modos no-endless, el bono de "tablero perfecto" es más simple: flat `EMPTY_BOARD_BONUS = 500`.

**Refill de tablero vacío (v2.6.1, `Engine.refillAfterEmpty`):** tras cobrar el bono en los modos sin fin (Contrarreloj/Supervivencia/Zen), el tablero se repuebla al instante con `EMPTY_BOARD_REFILL = { min:10, baseFactor:0.55, maxFactor:1.1, hardCap:26, maxPairs:6, perClear: {facil:2, normal:3, dificil:4} }`: hasta `maxPairs` patrones de 2-4 figuras IGUALES colocadas como primer-icono-visible en direcciones libres desde un centro vacío (cada patrón garantiza una convergencia jugable). El objetivo crece con `chain` (vaciados consecutivos). Elimina el dead-air post-limpieza (D2) a costa de sostener el combo: **inflación medida de score en Supervivencia p50 +19% / p90 +35% (bisección SV-01, `BALANCE_BASELINE.md`)** — cambio de época documentado, la oleada alcanzada no varía.

### 6.9 XP y monedas ganadas por partida (`recordGame`)
```
xpBase     = round(score/10 + maxCombo*5 + level*20 + (perfect ? 100 : 0))
xpGained   = xpBase * (xpMultiplier === 4 ? 4 : 1)
coinsGained= round(score/40 + maxCombo*2 + level*5  + (perfect ? 40  : 0))
```
Los bonos descritos en §5.1/§5.2 se suman a `xpBase` antes de multiplicar. El resultado expone `xpBase`,
`xpMultiplier`, `xpBoostBonus = xpGained - xpBase` y `xpGained` para que el modal pueda desglosarlo. Las monedas no
se multiplican; en Clásico se conserva su premio específico y no se duplica la recompensa base de `recordGame`.

---

## 7. Power-ups / boosters (Supervivencia)

Catálogo (`Boosters.DEFS`, orden `['bomb','freeze','x2','clearLine','wild']`):

| id | nombre | glyph | unidad por selección | efecto |
|---|---|---|---|---|
| bomb | Bomba | 💣 | 1 | Limpia un área de 3×3 |
| freeze | Congelación | ❄️ | 1 | Pausa el spawn de iconos por 7s |
| clearLine | Rayo | ⚡ | 1 | Limpia toda la fila y columna tocadas |
| wild | Escoba | 🧹 | 1 | Limpia el grupo de icono más numeroso del tablero |
| x2 | Comodín | 🃏 | 1 | Duplica los puntos por 11s |

> Los costes históricos ya tienen una vía real: desde el segundo mundo, el pre-nivel de Clásico permite seleccionar
> como máximo dos entre `bomb` 80, `freeze` 60 y `clearLine` 90 (`Config.PRELEVEL_BOOSTERS`). Si existe stock
> persistente del ID, consume una unidad y su coste es 0; si no, gasta monedas. `wild` y `x2` no aparecen en ese selector.
> El lanzador de Supervivencia ofrece los cinco IDs y permite confirmar hasta tres (`SURVIVAL_LOADOUT_MAX = 3`) con
> la misma política stock-antes-que-monedas.

**Arsenal persistente de cofres (schema 7):** `Meta.boosterStock` guarda los cinco IDs. `addBooster`/`spendBooster`
validan ID, impiden saldo negativo y limitan cada cantidad a 1.000.000. `quoteBoosterLoadout(ids,max)` calcula qué
unidades salen del stock y cuáles cuestan monedas; `commitBoosterLoadout` valida y aplica ambas partes de forma
atómica. Ni Clásico ni Supervivencia suman la reserva completa durante una partida:
`boosterAvailable(id) = max(0, Survival.inv[id])` y `_spendBooster` solo descuenta ese inventario de run. PreLevel o
el lanzador de Supervivencia consumen/pagan al confirmar y copian una unidad por ID elegido; un reinicio técnico no
reconfirma, no vuelve a cobrar y tampoco regala consumibles.

**Categorías de uso:**
- `SPATIAL = ['bomb','clearLine','wild']` — requieren que el jugador apunte una celda destino ("modo puntería", `body.classList.add('aiming')`, con previsualización de celdas afectadas).
- Globales (`freeze`, `x2`) — efecto instantáneo, sin apuntar.

**Detalle de efectos:**
- `bomb`: limpia el área 3×3 centrada en la celda tocada.
- `clearLine`: limpia toda la fila + columna que pasan por la celda tocada.
- `wild` (sobre celda con icono): limpia todas las celdas con ese mismo icono en el tablero completo. `wild` (sobre celda vacía): auto-limpia el grupo de icono más numeroso del tablero, o si ninguno tiene ≥2, hace un "clear de emergencia" de una celda ocupada al azar.
- `freeze` (global): `freezeUntil = ahora + 7000ms` — mientras dure, `blockSpawn()` devuelve `true`.
- `x2` (global): `x2Until = ahora + 11000ms` — duplica `tempMult`.

**Anillo de suministro:** se llena `CHARGE_PER(9) + min(combo,6)` por convergencia (+4 si ya hay frenesí); al llegar a 100 paga una cantidad acotada de monedas (`SUPPLY_COIN_BASE=2`, `PER_WAVE=0`, `CAP=2`) ajustada por dificultad/mutador y conserva el remanente. **Desde v2.2.0 (B6):** cada toque a una casilla rompible suma además **+2 de suministro**. La bendición `pack` es la única fuente regular de boosters nuevos durante la run y sus unidades son solo de ese intento.

**Otros pickups de tablero (tiles con `trigger`, no son "boosters" del jugador sino elementos del tablero):**
| tile | efecto |
|---|---|
| `bonus` | +30 puntos instantáneos al tocarlo |
| `portal` | Teletransporta un icono ocupado al azar a una celda vacía al azar |
| `magicbox` | Libera los tiles sólidos adyacentes |
| `bomb` (tile) | Limpia área 3×3, otorga `celdas*10*level` puntos |
| `slowdown` | Multiplica `spawnRate` ×1.6 (tope = `spawnStart`) |

Estos tiles se **detonan en cadena**: al limpiar celdas adyacentes a un tile trigger, se dispara un BFS (`_chainDetonate`) que puede encadenar múltiples bombas/portales/etc. en una sola jugada.

---

## 8. Ajustes e internacionalización

### 8.1 Ajustes disponibles
`sfx`, `music`, `haptics` (oculto si el dispositivo no soporta vibración), `reducedFx` ("reducir efectos" — desactiva partículas/flash/rank-flash, ver `DESIGN_SYSTEM.md §10`), `largeText` (fuerza `font-size` raíz mayor + clase de texto grande), `lang` (`es`/`en`).

### 8.2 Sistema de i18n
Un único diccionario `DICT` con claves `es`/`en`, cada uno un mapa plano de ~150 claves de mensaje → string (varios con placeholders tipo `{n}`/`{w}`/`{s}`/`{c}`/`{t}`, reemplazados manualmente en cada sitio de uso — no hay motor genérico de pluralización). Un mapa `FIELD = {name:'n', desc:'d', goal:'g'}` traduce campos de un modo (`Config.MODES`) a las claves de inglés equivalentes (`m_{modeId}_{n|d|g}`), porque el español vive directamente embebido en `Config.MODES` mientras el inglés vive en el diccionario.

`I18n.apply(root)` recorre el DOM y aplica:
- `[data-i18n]` → `textContent`
- `[data-i18n-html]` → `innerHTML` (para contenido con `<strong>`, ej. "cómo jugar")
- `[data-i18n-ph]` → `placeholder`
- `[data-i18n-al]` → `aria-label`
- Fija `document.documentElement.lang`

**Importante para la migración:** buena parte del HTML dinámico (tarjetas de modo, HUD, modales) se genera con JS usando `I18n.t()` en el momento del render, no solo vía atributos DOM — cambiar de idioma exige **reconstruir esas vistas**, no solo re-aplicar textos.

Detección de idioma por defecto: `/^en/i.test(navigator.language)` → `en`, si no `es`.

---

## 9. Audio y háptica

**No hay archivos de audio.** Todo se sintetiza en tiempo real con Web Audio API:
- Debe inicializarse dentro de un gesto de usuario (requisito de iOS). Incluye manejo específico de iOS: `navigator.audioSession.type = 'playback'` para sonar incluso con el switch de silencio activado, reproducción de un buffer silencioso para "desbloquear" el contexto, y resume automático si el contexto se suspende.
- `tone(freq, dur, type, vol, when)` — oscilador único con envolvente de ganancia exponencial.
- `chord(freqs, dur, type, vol, stagger)` — varios `tone()` con offset temporal (arpegio).
- Efectos con nombre (frecuencias/formas de onda específicas por evento): `tap`, `ui`, `success`, `eliminate(n)` (el tono sube con el tamaño del combo, limitado a 1 llamada/30ms para no saturar en combos rápidos), `combo(l)` (5 tiers de frecuencia base), `rank`, `fever`, `milestone`, `record`, `boardClear`, `miss`, `danger`, `level`, `over`, `iceCrack(stage)`, `iceBreak`, `quake`, `rain`, `lifeBlast`, `booster(id)` (acorde específico por tipo de booster).
- Todos los efectos se omiten si `Settings.sfx` es falso.

**Música procedural:** escala `[220,247,294,330,392,440,494,587]` Hz (escala tipo A menor). Secuenciador por pasos (`setInterval(60ms)` con look-ahead de 0.2s), tempo `0.30 - 0.12*intensity` (más rápido con más intensidad), nota de bajo cada 4 pasos, melodía cada paso, armonía extra por encima de intensidad 0.5. `setIntensity(v)` (0-1) también ajusta la ganancia general. La intensidad se pilota desde el nivel de combo, el estado de frenesí/oleada de Supervivencia y el modo Fiebre.

**Háptica:** wrapper sobre `navigator.vibrate`, con patrones nombrados (ms, arrays = pulso/pausa): `tap()`=8, `combo()`=14, `milestone()`=[12,30,14], `error()`=40, `level()`=[18,40,18,40], `record()`=[12,28,12,28,36], `fever()`=[20,30,20], `ice()`=[6,18,8], `quake()`=[28,28,34,28,42], `life()`=[18,36,18,22].

---

## 10. PWA / instalación / offline

- Service Worker con caché con nombre versionado (`cv-cache-v1.7.1`) que **debe subirse manualmente** en cada release.
- Precachea assets core (HTML/CSS/JS/manifest/iconos) siempre, más 3 listas best-effort de iconos (PNG legacy, SVG v2, sprites de sistema) que no rompen la instalación si fallan individualmente.
- Estrategia de fetch: navegación → network-first con fallback a caché (y a `index.html` cacheado si no hay red); resto de peticiones GET del mismo origen → cache-first con relleno de red en background.
- Manifest: `display: standalone`, `orientation: portrait`, iconos 192/512 + maskable, categorías `games, puzzle, entertainment`.
- Cliente: maneja `beforeinstallprompt` (guarda el evento, muestra botón de instalar), detecta modo standalone existente, ofrece instrucciones manuales específicas para iOS (sin `beforeinstallprompt` nativo) vía sniffing de user-agent, y notifica por toast cuando detecta una versión nueva del Service Worker instalada (sin recarga automática).

---

## 11. Iconografía del tablero (catálogo de iconos)

Los iconos del tablero **no son imágenes**: son SVG generados por código, combinando:
- 16 formas (`circle, square, triangle, diamond, star, heart, hexagon, plus, droplet, ring, pentagon, moon, sun, flower, clover, spiral`).
- 12 colores (`red #ff5b6e, blue #4b8bff, green #3ad07f, yellow #ffd23f, purple #a06bff, cyan #2bd4e6, orange #ff9838, pink #ff79c6, lime #b6e64a, white #e8eefc, teal #27b6a0, indigo #6c7bff`).

Catálogo = 3 ciclos de las 16 formas = **48 iconos** de la forma `{shape}_{color}` (ej. `circle_red`), generados con la fórmula: `for cyc in 0..3: for i in 0..16: catálogo.push([shape[i], color[(i+cyc*7)%12]])`.

**Invariante de diseño (importante para la migración):** cada nivel usa una "ventana" contigua de como máximo 8 iconos de este catálogo de 48. Como el período de ciclo de formas (16) es mayor que el tamaño máximo de ventana (8), **cualquier ventana contigua contiene 8 formas distintas** — esto garantiza que nunca puedan coexistir dos iconos "parecidos pero distintos" (misma forma, distinto color) que confundan al jugador; solo pueden converger iconos verdaderamente idénticos (misma forma + mismo color).

- `varietyFor(level) = clamp(4 + floor((level-1)/3), 4, min(8, catálogo.length))` — la variedad crece 1 icono cada 3 niveles, piso 4, techo 8.
- `poolForLevel(level)`: offset de ventana `= (level-1) % 48`, tamaño `= varietyFor(level)`, envuelve alrededor del catálogo — ventana deslizante aditiva que avanza exactamente 1 posición por nivel (niveles consecutivos comparan `n-1` iconos: se introduce 1 nuevo y sale 1 viejo por nivel).

---

## 12. Pantallas y máquina de estados

Ver también [`ARCHITECTURE.md` §7](./ARCHITECTURE.md#7-máquina-de-estados-pantallas-vistas-del-hub-y-modales) para el mecanismo genérico (`Screens.show`/`HubViews.open`/`Modal.open`).

**Pantallas:** `login`, `start`, `worlds`, `game` (una `<section class="screen">` por cada una, sin historial, sin animación de salida). El catálogo de modos vive directamente en `start`.

**Vistas del hub** (contenido central de `start`; appbar y navegación inferior persistentes):

| id | Contenido |
|---|---|
| `view-events` | Resumen de eventos, recompensa diaria, cofres y primera victoria |
| `view-missions` | Lista de misiones diarias + desafío semanal |
| `view-how` | Reglas del juego + botón de tutorial interactivo |
| `view-settings` | Toggles de ajustes + selector de idioma |
| `view-daily` | Ficha previa del reto diario: mutador, medallas, mejor marca, ghost, racha y primer intento |
| `view-adventure` | Overview del mapa de capítulos de Aventura |
| `view-resource-shop` | Tienda de recursos: packs de monedas/gemas con checkout ficticio + XP Booster |
| `view-shop` | Tienda de personalización: skins de tablero + temas |
| `view-chests` | Pantalla propia de cofres: progreso, aperturas, animación y revelado de premio |
| `view-multi` | Placeholder "Multijugador — Próximamente" |
| `view-medals` | Perfil: stats de por vida, mejores marcas por modo, logros |
| `view-collections` | Inventario de tableros/temas y acceso a personalización/logros |

**Modales transitorios de partida** (overlay, uno activo a la vez, foco capturado/restaurado):

| id | Contenido |
|---|---|
| `modal-pause` | Reanudar / reiniciar / salir |
| `modal-level` | Nivel completado: stats, preview del siguiente nivel, botones siguiente/mapa |
| `modal-over` | Fin de partida: stats, barra de XP, logros desbloqueados, reintentar/compartir/salir |
| `modal-revive` | "Última oportunidad" de Supervivencia — revivir pagando monedas |

`Game.pause()`/`resume()` alternan `State.status` entre `'playing'`/`'paused'` junto con abrir/cerrar `modal-pause`. Valores de `State.status`: `'idle'`, `'playing'`, `'paused'`, `'over'`, `'levelComplete'`.

`Screens` decide la pantalla raíz; `HubViews` decide la vista interna de Inicio; `Modal` se limita a diálogos de partida. Las transiciones siguen siendo llamadas imperativas repartidas entre `Game`, `Worlds` y los constructores de menú, cableadas en `init()` más un listener delegado por `data-act`.

---

## 13. Algoritmos notables

### 13.1 Sesgo de spawn "anti-frustración" (clear-assist)
`Config.CLEAR_ASSIST = { threshold: 6, pMax: 0.9, decay: 0.1, pMin: 0.25 }`. Con más de 6 iconos en el tablero, el spawn es 100% aleatorio dentro del pool. Con ≤6 iconos (y >0), se calcula `p = clamp(pMax - (iconCount-1)*decay, pMin, pMax)` y, con probabilidad `p`, el icono generado se elige igual al **icono menos común actualmente en el tablero** (el más "solitario", empates al azar) en vez de puramente aleatorio — ayuda activamente al jugador a emparejar los últimos iconos sueltos y terminar de vaciar el tablero, en vez de alargar la partida al azar.

### 13.2 Sistema de pistas (hint)
Escaneo lineal de todas las celdas vacías buscando la primera con `converging(i).length >= 2`; resalta esa celda + las celdas que emparejaría durante `HINT_DURATION = 2000`ms. Límite de `HINTS_PER_LEVEL = 3` por nivel, cooldown `HINT_COOLDOWN = 10000`ms entre usos. Sin ponderación: gana la primera coincidencia en orden de escaneo (row-major).

### 13.3 Escalado de dificultad por nivel
```
base = diff.spawnStart * 0.95^(level-1)     // decae 5% por nivel
if modo.relaxed: base *= 1.25                 // Zen es más lento
spawnRate = round(clamp(base, diff.spawnMin, 6000))
```
**Warm-up de apertura (v2.2.0, GM-26):** el intervalo EFECTIVO de spawn se multiplica ×`WARMUP.factor (0.55)` durante los primeros `WARMUP.ms (10000)` del nivel o hasta la `WARMUP.convs (3)`ª convergencia (lo que llegue antes), con rampa lineal de salida de `WARMUP.rampMs (2000)` hacia el ritmo normal. No aplica a modos `relaxed` (Zen) ni `single` (tutorial). No muta `State.spawnRate`: se aplica como factor en el bucle.
Se combina con: aceleración dentro del nivel (`spawnRate -= 3` por spawn, piso `spawnMin`), aceleración por fallo (`×0.95` por error), y el escalado específico por capítulo/oleada de Aventura/Supervivencia (§2.5, §5.6).

### 13.4 Medidor de ocupación / peligro
`occupation() = celdasOcupadas/celdasTotales*100`. Umbrales de HUD: `>=85%` → peligro (rojo pulsante, sonido/háptico con throttle de 900ms), `>=65%` → advertencia. **Esta es la señal principal de "estás por perder"**, ya que no existe un chequeo activo de "no hay movimientos" — el juego solo termina realmente por desbordamiento del tablero en el momento del spawn.

### 13.5 Gobernador de rendimiento
EMA del frame time (`ema += (dt-ema)*0.1`) que ajusta adaptativamente `FX.cap` (máximo de partículas DOM concurrentes) entre ~18 y ~50 — un sistema simple de "calidad adaptativa" para regular la carga en dispositivos de gama baja sin caer frames de forma abrupta.

### 13.6 Baraja de terremoto (Supervivencia)
Fisher-Yates sobre los **valores** de las celdas no-sólidas con icono (las posiciones no cambian, los valores sí) — usado por el evento "quake" para revolver el tablero sin alterar la cantidad de iconos de cada tipo.

### 13.7 Selección determinística de misión/desafío
`hashStr(fecha) % lista.length` hace que la elección de misión diaria/desafío semanal sea la misma para todos los jugadores en la misma fecha/semana, sin necesidad de servidor — efectivamente una semilla pseudoaleatoria derivada de la fecha.

---

## 14. Constantes verbatim

### `Config` (núcleo)
```js
SIZE: 8
COMBO_MULTIPLIERS: [[30,10],[20,8],[15,5],[10,3],[6,2],[3,1.5]]
MILESTONES: { 10: 500, 20: 1000, 30: 2000 }
EMPTY_BOARD_BONUS: 500
CLEAR_ASSIST: { threshold: 6, pMax: 0.9, decay: 0.1, pMin: 0.25 }
STAR_ERR: [0, 2]
FEVER_COMBO: 10
FEVER_BOOST: 1.25
TIMED_START: 60
TIMED_CAP: 90
TIMED_MISTAKE_S: 3                    // v2.2.0 (GM-11)
TIMED_GAIN: { base:0.9, perIcon:0.6, combo:0.32, comboCap:4, decaySec:125, minDecay:0.08 }
SPRINT_WINDOW: 10                     // v2.2.0 (GM-10)
SPRINT_MULT: 1.5                      // v2.2.0 (GM-10)
WARMUP: { ms: 10000, convs: 3, factor: 0.55, rampMs: 2000 }   // v2.2.0 (GM-26)
CONTINUE_GEMS: 15                     // v2.3.0 (GM-02)
CONTINUE_CLEAR: 0.40                  // v2.3.0 (GM-02)
PRELEVEL_BOOSTERS: { bomb: 80, freeze: 60, clearLine: 90 }    // v2.3.0 (GM-03)
PRELEVEL_MAX: 2                       // v2.3.0 (GM-03)
PRELEVEL_FROM_WORLD: 1                // v2.3.0 (GM-03)
HINTS_PER_LEVEL: 3
HINT_COOLDOWN: 10000
HINT_DURATION: 2000
```
(Tablas de `DIFFICULTY` y `MODES` ya detalladas en §2.7 y §2.)

### Tiles especiales (`Tiles.DEFS`)
```
rock     🪨 solid            "Roca: estorba y no converge"
locked   🔒 solid            "Bloqueada"
frozen   🧊 solid taps:2 breakable  "Helada: toca 2 veces para descongelar"
infected ☣️ (definido, sin uso activo confirmado en las reglas leídas)
crystal  💎 bonus:3 (+50 score al limpiar)   "Vale puntos extra"
chains   ⛓️ solid taps:2 breakable  "Cadenas: toca 2 veces para liberar"
web      🕸️ solid taps:2 breakable  "Telaraña: toca 2 veces para liberar"
barrier  🚧 solid              "Barrera: solo se quita con objetos especiales"
mud      🟫 taps:2 breakable   "Lodo: ralentiza y cuesta limpiar"
bonus    trigger:'bonus'    "+30 puntos al instante"
portal   trigger:'portal'  🌀  "Teletransporta una figura"
magicbox trigger:'magicbox' 🎁 "Libera figuras cercanas"
bomb     trigger:'bomb'    💣  "Detona figuras cercanas" (variante tile, distinta del booster)
slowdown trigger:'slowdown' ⏳ "Reduce la velocidad de aparición"
```

### Modificadores genéricos (`Modifiers.DEFS`)
```
rocks     Asteroides  tile:'rock'    density:0.06
ice       Hielo       tile:'frozen'  density:0.05
rush      Núcleo      spawnMult:0.8
scarce    Vacío       hints:1
crystals  Cristales   tile:'crystal' density:0.04
```
(Densidades base — Aventura y Clásico recalculan sus propias densidades por nivel/capítulo, ver §2.2/§5.6, no leen directo de esta tabla en todos los casos).

### Tarjetas de modo del menú (`MODE_CARDS`)
```
supervivencia — accent #ff5b6e, acción → abrir selector de dificultad
clasico       — accent #2f6bff, acción → abrir mapa de mundos
multi         — accent #7a5cff, disabled:true, acción → abrir placeholder multijugador
```
Más una 4ª tarjeta estática "¿Cómo se juega?".

---

## 15. Notas transversales para la reimplementación

- **Aleatoriedad no seedeada:** todo el juego usa `Math.random()` sin PRNG seedeado (`rand(n) = floor(Math.random()*n)`). No hay determinismo ni replay exacto de partidas — una reimplementación es libre de elegir cualquier generador aleatorio salvo que se requiera explícitamente paridad bit-a-bit con sesiones grabadas (el original tampoco la soporta).
- **Sin guardado de partida en curso:** `State` (el estado de una partida activa) se reinicializa por completo en cada `start()`/`setupLevel()`. Solo el perfil de progresión (`Meta`/`Storage`) persiste entre sesiones — no hay resume de un tablero a medias tras cerrar la app.
- **Todo texto es bilingüe (ES/EN)** vía el diccionario de `I18n`; una reimplementación debería mantener esta indirección por clave en vez de hardcodear español, ya que el inglés vive en claves derivadas (`m_{modeId}_{n|d|g}`) mientras el español vive embebido directamente en la config de modos.
- **Orden de direcciones** `DIRS` = arriba, abajo, derecha, izquierda — sin efecto de reglas, solo relevante si se quiere replicar el orden exacto de animaciones/hints.

---

## 16. Checklist de paridad para la migración

Usar esta lista para verificar que una reimplementación cubre el 100% de lo existente:

- [ ] Grilla 8×8 con detección de convergencia por rayo en 4 direcciones, bloqueado por tiles sólidos.
- [ ] Sistema de combo con ventana temporal + tabla de multiplicadores + modo Fiebre.
- [ ] 6 modos de juego (Tutorial, Clásico, Aventura, Contrarreloj, Supervivencia, Zen) con sus reglas y hooks diferenciados.
- [ ] 3 niveles de dificultad global con sus 6 parámetros cada uno.
- [ ] Sistema de tiles especiales (14 tipos) con comportamiento sólido/rompible/trigger y detonación en cadena.
- [ ] Modo Clásico: 5 mundos × 50 niveles, sistema de estrellas, desbloqueo secuencial, densidades de obstáculos por nivel.
- [ ] Modo Aventura: progresión infinita por capítulos/biomas, 4 tipos de objetivo, niveles jefe.
- [ ] Modo Supervivencia: oleadas, vidas, revivir, eventos de jefe, medidor de frenesí, anillo de suministro económico, loadout confirmado de hasta 3 boosters y 3 tuning por dificultad; el arsenal persistente nunca se usa implícitamente durante la run.
- [ ] Modo Contrarreloj: reloj con reposición decreciente y tope, aceleración exponencial de spawn.
- [ ] Modo Zen: despeje parcial en vez de derrota.
- [ ] Persistencia `cv_meta` schema 9: inventario/timer/listos de cofres, snapshots de duración/Choice/Event, pipeline diario, `boosterStock` y `xpBoostUntil`, con saneamiento legacy no destructivo.
- [ ] Economía: 3 monedas, ciclo de 32, cofres tipados multi-tirada con tier-up/escala, Choice diario inmediato con catch-up Plata, evento con booster garantizado, premium y recompensa diaria con racha.
- [ ] Guardarraíl de cofres determinista: EV por tipo/nivel mediante APIs reales y restauración exacta de estado, storage y RNG.
- [ ] Progresión: XP/nivel/rangos, misiones diarias determinísticas, desafío semanal determinístico, 10 logros.
- [ ] Tiendas separadas: recursos (6 packs con checkout `mock-auto` + 3 packs XP ×4) y personalización (10 skins + 6 temas), sin mezclar sus rutas.
- [ ] Sistema de iconos: 16 formas × 12 colores, ventana deslizante de variedad por nivel, invariante anti-confusión.
- [ ] Sesgo anti-frustración de spawn cuando quedan pocos iconos.
- [ ] Sistema de pistas limitado + cooldown.
- [ ] i18n ES/EN completo, incluyendo contenido generado dinámicamente.
- [ ] Ajustes: sfx, música, háptica, reducir efectos, texto grande, idioma.
- [ ] Audio 100% sintetizado (sin archivos) + música procedural + háptica con patrones.
- [ ] PWA instalable, offline-first, con estrategia de caché network-first (navegación) / cache-first (assets).
- [ ] 5 pantallas + 13 modales con el flujo de navegación descrito.
- [ ] Persistencia tolerante a esquema (migración de campos faltantes) equivalente a `Meta._v`.
