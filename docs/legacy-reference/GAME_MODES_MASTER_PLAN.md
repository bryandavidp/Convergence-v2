# Plan maestro de modos de juego — Convergence

> **Rol de este documento:** auditoría profunda de los 7 modos de juego (estado real verificado contra `game.js` v2.0.3, no solo contra la documentación) + plan de mejora completo orientado a un objetivo: **una app profesional con modos muy pulidos, cada uno con identidad, energía y razón de existir propia**. Todo lo propuesto está fundamentado en (a) lo que el código ya hace, (b) psicología del jugador aplicada, y (c) patrones probados en juegos de referencia del género.
>
> Documentos hermanos: [`MIGRATION_SPEC.md`](./MIGRATION_SPEC.md) (fórmulas exactas) · [`ENGAGEMENT_GAME_FEEL_PLAN.md`](./ENGAGEMENT_GAME_FEEL_PLAN.md) (game feel, Fases 1–3 hechas) · [`V1_MASTER_PLAN.md`](./V1_MASTER_PLAN.md) (cierre V1) · [`ROADMAP.md`](./ROADMAP.md) (backlog general).
>
> Regla operativa: **ningún número de balance se cambia sin actualizar `MIGRATION_SPEC.md` y los tests**. Cada propuesta numérica de aquí lleva su justificación y su riesgo; la validación final es la simulación headless de §10 (no la intuición).

---

## Índice

1. [Método y estado verificado](#1-método-y-estado-verificado)
2. [Diagnóstico transversal (lo que afecta a todos los modos)](#2-diagnóstico-transversal)
3. [Análisis modo a modo: fortalezas, debilidades, propuesta](#3-análisis-modo-a-modo)
4. [Marco psicológico aplicado](#4-marco-psicológico-aplicado)
5. [Fragmentación: identidad única por modo](#5-fragmentación-identidad-única-por-modo)
6. [Energía y frenesí: plan de pacing](#6-energía-y-frenesí-plan-de-pacing)
7. [Balance y dificultad: cambios propuestos con justificación](#7-balance-y-dificultad)
8. [Potenciadores y penalizadores: rediseño](#8-potenciadores-y-penalizadores-rediseño)
9. [Qué NO cambiar (fortalezas a proteger)](#9-qué-no-cambiar)
10. [Metodología profesional: balance por simulación](#10-metodología-profesional-balance-por-simulación)
11. [Roadmap de ejecución por fases](#11-roadmap-de-ejecución-por-fases)
12. [Riesgos y guardarraíles](#12-riesgos-y-guardarraíles)

---

# 1. Método y estado verificado

Se leyó la documentación completa (`docs/` + `CLAUDE.md`) y se verificó contra el código real (v2.0.3), porque la documentación va por detrás: el repo ya incluye el cierre de V1 (home honesto, catálogo agrupado, intro de capítulo, coach de 3 pasos) y las Fases 1–3 del plan de engagement (`ModeSignals`, `NextActions`, medallas del reto diario, feedback diferenciado x2/x3/x4, rayos de convergencia, motas al HUD, alerta de oleada, presión de últimos segundos en Contrarreloj, racha perfecta de Clásico).

**Los 7 modos hoy (resumen operativo, verificado en código):**

| Modo | Núcleo | Sistemas propios | Fin de partida |
|---|---|---|---|
| Tutorial (Coach) | 3 pasos guiados deterministas | — | — |
| Clásico | 5 mundos × 50 niveles, vaciar tablero | Estrellas por errores, obstáculos por mundo, racha perfecta, mapa | Tablero lleno = derrota dura |
| Aventura | Capítulos infinitos de 5 niveles, 6 biomas | 4 objetivos (clear/score/survive/boss), mods de bioma, intro de capítulo | Tablero lleno = derrota dura |
| Contrarreloj | 60s→tope 90s, reposición decreciente | Aceleración exponencial de spawn, presión visual <20s/<10s | Reloj a 0 |
| Reto del día | Contrarreloj seedeado por fecha | Medallas 750/1500/2500, +5💎 primer intento, mejor marca diaria | Reloj a 0 |
| Supervivencia | Oleadas + vidas + revivir | Loadout opcional de hasta 3 boosters, anillo de suministro económico, frenesí (3 tiers), encuentros de jefe, trampas, 3 dificultades, récord de oleada | Sin vidas y sin revivir |
| Zen | Sin derrota, ritmo 1.25× más lento | softClear(45%) al llenarse, +1 pista por tablero limpio | Solo salir |

**Hallazgos de estado no documentados en ningún doc previo:**

1. **El selector global de dificultad está muerto.** `selDiff` se inicializa a `'normal'` y ninguna UI lo reasigna: Clásico, Contrarreloj, Reto y Zen juegan **siempre** en normal; Aventura también (`Game.start('aventura', selDiff)` con selDiff siempre normal). Las filas `facil`/`dificil` de `Config.DIFFICULTY` solo viven a través de `Survival.TUNE`. Consecuencia: dos tercios de la tabla de dificultad es configuración sin uso fuera de Supervivencia, y el jugador no tiene control de ritmo en ningún otro modo.
2. **Supervivencia apila 3 sistemas de multiplicador simultáneos** (comboMult × feverBoost × tempMult, donde tempMult = x2 × frenzyMult): hasta ×10 × ×1.43 × (×2 × ×1.85) ≈ **×53** teórico. El jugador no puede leer por qué una convergencia dio N puntos.
3. **En Contrarreloj, la penalización por error regala material.** `penalties:true` añade iconos al tablero; en un modo donde los iconos son la materia prima de puntuar, el "castigo" es ambiguo (el coste real del error ahí es el tiempo, y no se toca).
4. **La barra de carga y el medidor de frenesí se llenan a ritmos casi idénticos** (~9–15 vs ~8–18 por convergencia): dos barras paralelas que suben juntas → redundancia percibida, HUD de Supervivencia con 4 medidores simultáneos (oleada, carga, frenesí, aro de combo) + vidas + score.
5. **El coste de revivir es plano (120 monedas)** mientras la recompensa por oleada crece (`(4+oleada×1.45)×coinMult`): a oleada 20+ revives con ~4 oleadas de ingresos → la muerte pierde el peso emocional que sostiene el modo.
6. **Los eventos jefe no se telegrafi​an**: llegan por sorpresa dentro de `newWave()`. La anticipación (el "viene algo gordo") es la mitad del valor emocional de un jefe y hoy se desperdicia.
7. **Los boosters solo existen en Supervivencia**: los juguetes más divertidos del juego están encerrados en un modo, y las monedas no tienen sumidero de gameplay (solo cosméticos + revivir) → economía muerta para veteranos con la tienda completa.

# 2. Diagnóstico transversal

### Fortalezas del sistema (base sólida sobre la que construir)

- **Mecánica original con techo de habilidad real.** No es un clon de match-3: la lectura espacial de 4 rayos con bloqueo por sólidos tiene profundidad genuina (planificar convergencias de 3–4, encadenar detonaciones). Es el activo nº 1 del producto.
- **Arquitectura de modos por hooks** (`Rules.call`): añadir sistemas por modo es barato y seguro. Todas las propuestas de este plan se apoyan en primitivas ya existentes (tiles, modifiers, locks, toasts, modales, RNG seedeado).
- **La escalera de feedback 0–1s / 10–60s / 2–10min ya está construida** (Fases 1–3 del plan de engagement). Este plan no repite ese trabajo: lo apunta hacia identidad y pacing.
- **Determinismo seedeado sin servidor** (reto diario, compartir con semilla): infraestructura de retención y viralidad ya operativa, infrautilizada (solo la explota 1 modo).
- **Diseño ético declarado y cumplido** (sin castigos por ausencia, sin escasez falsa): es una ventaja de marca — todas las propuestas de aquí lo respetan.

### Debilidades transversales (ordenadas por impacto)

| # | Debilidad | Evidencia | Efecto en el jugador |
|---|---|---|---|
| D1 | **Ilegibilidad del multiplicador** | 5 factores multiplican el score (`combo × dificultad × modo × fiebre × temp`); solo el combo es visible | "Los puntos son ruido" → las recompensas pierden poder de refuerzo (un refuerzo que no se entiende no condiciona) |
| D2 | **Arranque frío ("dead air" inicial)** | spawnStart 5000ms en normal; tras limpiar el layout inicial el tablero respira a ~1 icono/5s; el combo (ventana 3500ms) es imposible de sostener si no hay material | Los primeros 30–60s de Clásico/Zen transmiten lentitud justo en la ventana crítica de retención |
| D3 | **La Fiebre no se siente** | +25% de puntos, aura sutil; entrar (combo 10) coincide con el hito de +500 que la eclipsa | El estado "estrella" del juego pasa desapercibido — desperdicia el mejor momento emocional |
| D4 | **Dificultad sin agencia fuera de Supervivencia** | Hallazgo §1.1 | Jugadores expertos sin reto en Clásico/Contrarreloj; casuales sin opción tranquila fuera de Zen |
| D5 | **Economía sin sumidero de gameplay** | Monedas → solo cosméticos (agotables) + revivir; gemas → solo cofre premium; `Boosters.DEFS.cost` fue eliminado sin sustituto | El bucle "jugar → ganar → gastar → querer más" se rompe al completar la tienda |
| D6 | **Solape Clásico/Aventura aún real** | El 40–60% de niveles de Aventura sigue siendo "vaciar tablero" (lic 0, 1 y lic 3 del cap. 0), igual que el 100% de Clásico | Dos modos compiten por la misma fantasía; Aventura no justifica su existencia hasta el capítulo 2+ |
| D7 | **Fin de partida sin pico emocional** | El modal de resultado muestra stats planos (score/combo/eliminados) | Regla pico-final: se recuerda el pico y el final; hoy el final es una tabla |
| D8 | **Sorpresas sin anticipación** | Eventos jefe sin aviso previo; oleadas avisan solo al 78% | La tensión anticipatoria (la emoción más barata de generar) se pierde |

# 3. Análisis modo a modo

Formato: **Fortalezas → Debilidades → Psicología en juego → Referente del género → Propuestas** (cada propuesta lleva ID `GM-xx` para el roadmap de §11).

---

## 3.1 Clásico — el modo columna vertebral

**Fortalezas.** Progresión legible (mapa, estrellas, candados); obstáculos por mundo bien dosificados (`dens = min(0.13, 0.015 + n·0.0021 + wi·0.008)`); criterio de estrellas transparente (0 err = 3★, ≤2 = 2★) con feedback en vivo al perder una; racha perfecta persistente (v2.0.2) — señal de maestría correcta; recompensa de mundo (cofre + 20💎) como meta a medio plazo.

**Debilidades.**
1. **Curva plana en la primera hora**: los niveles 1–10 del Bosque son casi idénticos entre sí (misma mecánica, densidad de cadenas creciendo ~0.2%/nivel). El "siguiente nivel" no promete nada nuevo hasta el mundo 2. 50 niveles por mundo es un ritmo de novedad demasiado lento para el estándar del género (Candy Crush introduce una mecánica cada ~10–15 niveles).
2. **Derrota dura sin puente**: tablero lleno = game over seco. No hay "estuviste cerca", no hay continuar. La distancia entre casi-ganar y perder es la misma que entre no-jugar y perder.
3. **Sin gasto pre-nivel**: el jugador con 3000 monedas y todos los skins no tiene nada que decidir antes de un nivel difícil.
4. **Las 3★ no compran nada**: coleccionarlas da monedas puntuales (`20 + stars·10 + score/60`) pero ningún sistema pide "N estrellas" salvo el desbloqueo binario de mundo (25 niveles con ≥1★). Las estrellas son la moneda de progresión estándar del género para abrir contenido lateral y aquí están infrautilizadas.

**Psicología en juego.** Este modo vive del **gradiente de meta** (mapa con progreso visible), la **maestría** (estrellas/racha) y la **aversión a la pérdida bien usada** (racha perfecta que se rompe → tensión sana). Lo que le falta es **near-miss ético** (la derrota por poco debe doler *y* motivar el reintento inmediato: es el mayor predictor de "una más") y **autonomía** (decisiones pre-nivel).

**Referente.** Candy Crush / Royal Match: (a) boosters pre-nivel como decisión estratégica y sumidero de moneda blanda, (b) racha de victorias con recompensa creciente, (c) puertas de estrellas para contenido opcional. Del lado del respeto al jugador: Monument Valley — cada mundo introduce SU mecánica y la retira.

**Propuestas.**
- **GM-01 · Near-miss en derrota** (🟢 horas): en `gameOver('reason_full')` de Clásico/Aventura, si `iconCount` al morir ≤ 10 y el nivel llevaba >45s, el modal dice "Te faltaban {n} figuras" con CTA "Reintentar" destacado. Sin coste, sin pago: puro encuadre. *Justificación: el near-miss aumenta la intención de reintento más que la victoria fácil (efecto documentado en juegos de habilidad); hoy esa información se tira.*
- **GM-02 · Continuar con gemas, 1 vez por nivel** (🟡 días): al perder por tablero lleno, ofrecer "Continuar (15💎): despeja el 40% del tablero" — máx. 1 por nivel, precio visible, sin cuenta atrás agresiva. Reutiliza `softClear`/`_relief`. *Justificación: sumidero de gemas real (ROADMAP 3.1 pendiente), rescata runs largas (aversión a pérdida), y el tope de 1 uso evita el pay-to-win emocional. El reto diario NO lo ofrece (marca igualitaria).*
- **GM-03 · Boosters pre-nivel** (🟡): desde el mundo 2, el lanzador de nivel ofrece 2 slots de consumible comprados con monedas (bomba 80 / congelar 60 / rayo 90 — recuperando los `cost` originales de `Boosters.DEFS` que se retiraron sin sustituto). Se usan en partida desde una mini-barra (reutiliza la infraestructura de `Survival.armBooster`/`aiming` extraída a helper común). *Justificación: sumidero de monedas permanente (D5), decisión estratégica pre-nivel (autonomía SDT), y suaviza picos de dificultad sin bajar la curva global. Guardarraíl: prohibidos en Reto del día; opcionales siempre.*
- **GM-04 · Puertas de estrellas para contenido lateral** (🟡, tras GM-03): cada mundo gana 3 "niveles estrella" opcionales (nodos laterales del mapa) que exigen 25/60/100★ acumuladas del mundo para abrirse, con reglas especiales (tablero prellenado, solo 4 iconos, sin spawns — puzles finitos) y recompensa cosmética/cofre. *Justificación: da valor coleccionable a las 3★ (hoy decorativas), añade variedad mecánica barata (los "puzles sin spawn" son la mecánica core en su forma más pura) y alarga cada mundo sin fabricar 50 niveles nuevos.*
- **GM-05 · Racha de victorias visible** (🟢): contador "niveles seguidos sin perder" en el banner (ya existe `classicPerfect` para perfectos; esto es la variante blanda) con bonus de monedas +10% por nivel de racha (tope +50%). *Justificación: recompensa el "una más" sin castigar el fallo (la racha se pausa, no borra nada).*

## 3.2 Aventura — de "Clásico infinito" a expedición roguelite-light

**Fortalezas.** Objetivos variables (score/survive/boss) — única fuente de variedad de objetivo del juego; biomas con acento visual y mods propios; intro de capítulo (V1-15) ya resuelve la legibilidad; retomar siempre en el máximo alcanzado (respeta el tiempo del jugador); escalado infinito honesto (`spawnRate / (1+ch·0.12)`).

**Nota FB-6 (2026-07-07):** los niveles `score` de Aventura ya no usan el objetivo plano `250 + chapter*120 + lic*40`; ahora escalan con el nivel (`level * (300 + 50*chapter)`) y el banner muestra progreso `p/n`. El modal de nivel completado explicita la razón de victoria, cerrando el "nivel 3 se completa de golpe" sin tocar el modelo de reanudación.

**Debilidades.**
1. **El 40–60% de sus niveles sigue siendo "vaciar tablero"** → solape frontal con Clásico (D6). La identidad "expedición" está en el copy, no en las reglas.
2. **Cero decisiones**: el jugador no elige nada en toda la expedición; los biomas se suceden en orden fijo cíclico. Un modo infinito sin agencia se vuelve rutina exactamente en el momento en que el jugador lo domina.
3. **Los jefes son "más cristales"**: el nivel jefe coloca 2+min(ch,4) cristales y ya. No hay comportamiento, no hay amenaza creciente, no hay clímax.
4. **Sin economía propia**: mismo XP/monedas que todo lo demás. Nada que solo la Aventura dé.

**Psicología en juego.** Un modo infinito retiene por **variedad + agencia + poder creciente** (la tríada roguelite). Hoy solo tiene variedad (biomas), y programada. La **anticipación de elección** ("¿qué me tocará elegir tras este jefe?") es de los bucles más adictivos y éticos que existen: recompensa con decisiones, no con números.

**Referente.** Slay the Spire / Vampire Survivors (elección de ruta/boon entre tramos — el 80% de su retención está ahí); Tetris Effect Journey (cada tramo cambia las reglas Y la atmósfera).

**Propuestas.**
- **GM-06 · Rutas de capítulo (elige 1 de 2)** (🟡🟡, el cambio estructural del plan): al empezar capítulo (encima de la intro ya existente), el jugador elige entre 2 variantes del bioma: p. ej. Asteroides → «Campo denso: +rocas, +25% monedas» vs «Corriente rápida: spawn ×0.85, +25% puntos». Implementación: cada bioma define 2 `routes` con 1–2 modificadores extra de la tabla `Modifiers` + 1 bonus económico; la elección vive en el estado de la run. *Justificación: mata D6 de raíz (Clásico = curado y fijo; Aventura = tú compones tu run), añade rejugabilidad real al mismo capítulo, y es barato: son combinaciones de primitivas existentes.*
- **GM-07 · Reliquias de jefe** (🟡, tras GM-06): al superar un nivel jefe, elegir 1 de 3 reliquias pasivas para el resto de la run: «Ventana de combo +400ms» / «Los cristales valen +30» / «+1 pista por nivel» / «La primera derrota del capítulo despeja el 30% en vez de terminar». Máximo 3 activas (se sustituyen). *Justificación: poder creciente percibido (fantasía roguelite), convierte a los jefes en momentos de codicia además de miedo, y crea builds ("esta run voy a combo").*
- **GM-08 · Jefes con comportamiento** (🟡): el nivel jefe, además de cristales, ejecuta un patrón periódico según bioma (cada 20s): Asteroides lanza 2 rocas, Hielo congela 2 celdas, Núcleo acelera spawn 10% durante 5s… reutilizando los eventos de Supervivencia (`meteorRain`/`frostSurge` parametrizados). Con aviso de 3s («⚠ el jefe carga…»). *Justificación: un jefe que HACE cosas + telegrafía = anticipación (D8) y clímax de capítulo memorable (regla pico-final).*
- **GM-09 · Registro de expedición** (🟢): al morir, el resumen muestra la "cadena" de la run: capítulos superados, rutas elegidas, reliquias, causa de muerte. *Justificación: narrativiza la derrota (la run se convierte en historia contable → compartible), patrón estándar roguelite.*

## 3.3 Contrarreloj — adrenalina con final anticlimático

**Fortalezas.** El mejor pacing del juego a nivel sistémico: aceleración exponencial del spawn (`0.92^(elapsed/10)`, suelo 300ms) + reposición decreciente del reloj (decay a 0.4 hacia los 150s) + tope de 90s = runs de 2–4 min que terminan solas, sin fatiga. Presión visual/sonora <20s/<10s ya implementada (v2.0.2). Es el modo con mejor "una partida más" natural.

**Debilidades.**
1. **La penalización por error no castiga lo que importa** (hallazgo §1.3): añade iconos (= material para puntuar) en vez de tocar el reloj. El error en un score-attack debe costar tiempo o puntos, y debe doler de forma legible.
2. **El final es anticlimático**: los últimos segundos son los de mayor tensión y menor recompensa (ya casi no repones tiempo por el decay). La run muere apagándose en vez de explotar. Es exactamente lo contrario a la regla pico-final.
3. **Sin referencia de ritmo**: el jugador no sabe si va "bien" hasta el final. El ghost personal (documentado como pendiente de Fase 2) es la solución correcta.
4. **Vive a la sombra del Reto del día** (mismo juego, con medallas y propósito): la partida libre necesita una razón propia de existir.

**Psicología en juego.** Score-attack puro = **flow de alta activación**: exige feedback continuo de rendimiento (¿voy por delante o por detrás?) y un final en crescendo. El **riesgo-recompensa voluntario** (jugarse algo por puntuar más) es el condimento que convierte tensión en emoción.

**Referente.** Tetris Ultra (2 min fijos, el ghost de score es el driver de mejora); OutRun/arcades de tiempo (extender el tiempo ES la recompensa audible); Crypt of the NecroDancer (multiplicador ligado a mantener el ritmo).

**Propuestas.**
- **GM-10 · Sprint final (riesgo-recompensa)** (🟢): mientras `timeLeft ≤ 10s`, todos los puntos ×1.5 con tratamiento visual/sonoro propio («SPRINT», borde encendido, música al máximo). Como el tiempo puede volver a subir por convergencias, el jugador puede *elegir* cabalgar el borde del abismo para puntuar más. *Justificación: convierte el tramo final en pico (pico-final), añade una decisión de riesgo continua (¿repongo tiempo o apuro el sprint?), coste de implementación mínimo (un factor más en `feverBoost` visible en el HUD de GM-16).*
- **GM-11 · Error = tiempo** (🟢, cambio de balance documentado): en modos `scoreAttack`, el error resta **−3s** (con animación del reloj sangrando) y NO añade iconos. *Justificación: hace legible el coste del error en la moneda del modo; elimina el "castigo-regalo" actual. Riesgo: duplicar castigo si se mantuviera el icono — por eso se sustituye, no se suma. Validar con la simulación de §10 que no acorta las runs medias >15%.*
- **GM-12 · Ghost personal** (🟡): guardar la línea de tiempo del mejor score (score cada 10s, array de ~24 enteros en `Meta.modes.contrarreloj.ghost`); en partida, un marcador fino bajo el score: «▲ +230 vs tu récord» / «▼ −120». Aplica también al Reto del día (ghost del mejor intento de HOY). *Justificación: la comparación contra uno mismo es el motivador de maestría más limpio que existe; ya estaba identificado como deuda de Fase 2.*
- **GM-13 · Cápsulas de tiempo** (🟢, azúcar): muy ocasionalmente (~1 por partida) spawna un tile pickup «+5s» que hay que detonar por adyacencia (reutiliza `trigger`). *Justificación: micro-objetivo espacial que rompe la monotonía del farmeo de convergencias; ya estaba esbozado en el plan de engagement.*
- **FB-2 · Arranque frío cerrado** (✅ 2026-07-07, v2.6.0): Contrarreloj/Reto arrancan con `initialIcons:22` y usan `spawnFactor()` tras el warm-up para reducir espera post-limpieza (0.65 con ≤10 iconos, 0.85 con ≤16, 1.1 con ≥30). Sim 40 runs: average `deadAir` 57%→39%, score p50 129463→120929, duración 240s; guardarraíl de medallas verde sin recalibración.

## 3.4 Reto del día — el ritual (el modo con mejor ratio valor/coste del juego)

**Fortalezas.** Semilla por fecha igual para todos; medallas 750/1500/2500 con "siguiente medalla" en el resultado; +5💎 el primer intento; reintentar conserva la semilla; compartir con semilla ya existe. Es la pieza de retención D1→D7 más eficiente del producto.

**Debilidades.**
1. **Sin memoria**: ayer no existe. No hay calendario, ni racha de medallas, ni total mensual. El ritual no acumula historia — y la historia es lo que hace sagrado un ritual (Wordle vive de su calendarcito).
2. **Sin variación**: es siempre exactamente Contrarreloj-normal. Los retos diarios de referencia rotan un modificador ("hoy con hielo", "hoy combo window −1s") para que cada día tenga tema de conversación.
3. **Medallas con umbral fijo** (750/1500/2500) sobre una fórmula de score que escala con `State.level`: en Contrarreloj `level` es constante, así que hoy es correcto — pero es frágil: cualquier cambio de balance de score rompe silenciosamente la dificultad de las medallas (guardarraíl en §12).

**Psicología en juego.** **Ritual + racha + FOMO ético** (perderse un día no rompe nada irrecuperable — la racha de medallas puede congelarse 1 día por semana). La **identidad compartida** ("todos jugamos EL MISMO tablero") es su superpoder: cada mejora debe reforzar eso, nunca fragmentarlo (por eso: sin boosters, sin continuar, sin dificultad elegible AQUÍ).

**Referente.** Wordle (calendario + racha + compartir resultado idéntico); los "Daily" de Slay the Spire/Balatro (mismo seed + modificador temático del día + leaderboard).

**Propuestas.**
- **GM-14 · Calendario y racha del reto** (🟡): `Meta.dailyRun` pasa a guardar historial `{fecha → medalla}` (tope 60 días, FIFO); el modal de misiones/home muestra el mes en curso como fila de puntos de medalla + racha actual de días con medalla ≥ bronce (congelable 1 día/semana, explicitado). Recompensa de hito: 7 días seguidos → +1 cofre. *Justificación: convierte el reto en ritual con historia; la congelación semanal elimina la ansiedad de racha (diseño ético declarado).*
- **GM-15 · Mutador del día** (🟡, tras GM-14): la semilla de fecha también elige 1 mutador de una tabla de ~8 (`hashStr(fecha) % 8`): «Hielo (4 celdas heladas)», «Ventana de combo −500ms», «Solo 6 iconos», «Rocas ×3», «Spawn +10% rápido», «Cristales dobles», «Sin pistas», «Clásico puro (sin mutador)». Se muestra en la tarjeta del home y en la intro. *Justificación: cada día tiene tema → conversación y screenshot distinto; determinista sin servidor (mismo truco `hashStr` de misiones); reusa tiles/parámetros existentes al 100%.*
- **FB-4 · Comunicación del ritual cerrada** (✅ 2026-07-07, v2.6.0): el home/misiones abren una ficha previa (`modal-daily`) con tablero compartido, mutador+efecto, medallas 750/1500/2500 (`Meta.DAILY_MEDALS`), mejor marca/ghost, racha y bonus de primer intento; en partida el banner muestra la siguiente medalla con número y avisa cada umbral cruzado.

## 3.5 Supervivencia — el buque insignia (profundo pero ilegible y sin decisiones)

**Fortalezas.** El modo más completo: tuning por dificultad en tabla única (`TUNE`), progresión de iconos por oleada (`dlevel` + reconcilia huérfanos — gran detalle), rocas rompibles con tope (nunca brickea el tablero), alivio al perder vida (40% + mitad de rocas — piedad bien calibrada), récord de oleada celebrado, telegrafiado del 78% de oleada (v2.0.2), frenesí con tiers, recompensas de oleada/hito/cofre. La economía del modo (coinMult 0.85/1.0/1.3) recompensa el riesgo correctamente.

**Debilidades.**
1. **Sobrecarga cognitiva sin jerarquía** (hallazgo §1.4): 4 medidores + 3 multiplicadores apilados + trampas + pickups. El modo más profundo es también el más opaco — y la explicación pre-partida (V1-14) no sustituye a la legibilidad en juego (D1).
2. **Carga y frenesí eran gemelos redundantes (resuelto en v2.7.1)**: ambos se siguen llenando con juego activo, pero ahora prometen resultados distintos y legibles —el anillo interior financia la siguiente preparación y el exterior activa poder dentro de la run—.
3. **Cero decisiones estratégicas entre oleadas**: la única decisión del modo es cuándo gastar boosters. Comparado con su referente natural (arcade wave-survival), falta el respiro-decisión que marca el ritmo tenso→alivio→tenso.
4. **Jefes sin anticipación ni recompensa**: `bossEvent()` dispara 1 de 3 eventos al azar dentro de la oleada N sin aviso previo, y superarlo no da nada distinto de una oleada normal. El "jefe" es hoy una molestia aleatoria, no un clímax.
5. **Revivir plano trivializa la muerte tardía** (hallazgo §1.5).
6. **`quake()` (barajar el tablero) es ruido, no amenaza**: puede incluso ayudar. Un evento jefe que a veces te beneficia diluye el significado de "jefe".

**Psicología en juego.** Wave-survival = **ciclos de tensión/alivio** + **fantasía de poder creciente**. La tensión necesita anticipación (D8) y la fantasía necesita elecciones de build. El **coste de la muerte** debe crecer con lo arriesgado (revivir escalado) o el clímax emocional se aplana. La redundancia carga/frenesí viola el principio de **una barra, una promesa**.

**Referente.** Vampire Survivors (elección de mejora como latido del juego); Space Invaders Extreme / Tetris Effect (frenesí = espectáculo audiovisual total, no un +55%); arcades clásicos (revivir con precio creciente — el "continue?" que dolía).

**Propuestas.**
- **GM-17 · Bendiciones post-jefe (elige 1 de 3)** (🟡🟡, el cambio estrella del modo): al sobrevivir a un evento jefe, pausa suave (lock ya existente) y elección de 1 entre 3: «+1 vida (tope MAX+1)» / «+50 de carga» / «Paquete: +1 bomba, +1 rayo» / «Spawn ×1.15 más lento durante 2 oleadas» / «Frenesí instantáneo». *Justificación: introduce la decisión estratégica que falta (3), convierte al jefe en riesgo-recompensa (4), y da dirección de build a la run. Todas las opciones son efectos ya implementados.*
- **GM-18 · Telegrafiar al jefe** (🟢): si `(wave+1) % bossEvery === 0`, la barra de oleada se tinta y muestra «⚠ JEFE» durante toda la oleada previa; 3s antes del evento, aviso específico del tipo («☄ Se acerca una lluvia…»). *Justificación: anticipación = tensión gratis (D8); además hace estratégico guardar un freeze para el jefe.*
- **GM-19 · Revivir con precio creciente** (🟢, balance): coste = `120 × 2^(revividosEstaRun)`, tope 480, máximo 3 por run, mostrado antes de pagar. *Justificación: primera muerte sigue accesible (no se castiga al nuevo), pero la inmortalidad por monedas desaparece (restaura el peso de la muerte); el tope evita el "me estafaron". Riesgo bajo; validar con §10 el efecto en duración media de run.*
- **GM-20 · Sustituir `quake` por `surge`** (🟢): el terremoto (barajar) se reemplaza por «Marea»: 2 filas exteriores se llenan de iconos en 2s (aviso previo con las celdas marcadas). *Justificación: amenaza legible con counterplay (despeja esas zonas antes), sin el azar bidireccional del quake. El quake puede quedar como mutador semanal (GM-22), donde el caos sí es tema.*
- **GM-21 · Fusión visual carga+frenesí** (🟡): un solo widget de dos anillos concéntricos (interior = suministro → monedas futuras; exterior = frenesí → furia) en lugar de dos barras paralelas, con jerarquía clara sobre la barra de oleada. *La capa visual nació en v2.1.0 y la promesa económica del anillo interior se actualizó en v2.7.1.*
- **GM-22 · Mutador semanal («Semana de…»)** (🟢, tras GM-15): `hashStr(weekId) % tabla` aplica 1 mutador temático a Supervivencia toda la semana, mostrado en la tarjeta del modo («Semana del hielo: +escarcha, +15% monedas»). *Justificación: variedad determinista sin servidor; da razón de volver al modo cada semana; comparte tabla de mutadores con GM-15.*

## 3.6 Zen — correcto como válvula, vacío como destino

**Fortalezas.** Identidad clara (sin derrota, softClear al llenarse, +1 pista por tablero limpio, 1.25× más lento); coste de mantenimiento cero; banner calmado (v2.0.2). Cumple su función de válvula de descompresión y de modo "para mi madre".

**Debilidades.** No hay razón de VOLVER a Zen: sin colección, sin memoria, sin meta blanda. Además es incoherente consigo mismo: muestra score, combos, fiebre y penaliza con `mult: 0.8` — números y presión en el modo que promete no tenerlos.

**Psicología en juego.** El jugador Zen busca **autonomía sin evaluación** (jugar sin ser medido). Mostrarle un score con multiplicador reducido es evaluarle Y pagarle peor. La colección tranquila (**progreso sin fallo posible**) es el gancho correcto: cada sesión suma algo, nada resta jamás.

**Referente.** Tetris Effect (modos sin fallo con atmósfera como recompensa); Alto's Odyssey modo Zen (sin puntuación visible); jardines de bolsillo (Viridi).

**Propuestas.**
- **GM-23 · El Jardín** (🟡): cada tablero limpiado en Zen suma 1 flor a un jardín persistente (`Meta.zen.flowers`); hitos: 10 flores → tema de color «Amanecer» gratis, 50 → skin de tablero «Jardín» exclusivo (no comprable). Un rinconcito del banner muestra el jardín crecer. *Justificación: colección pura sin fallo; el cosmético exclusivo da al modo su recompensa distintiva (fragmentación §5) sin números de presión.*
- **GM-24 · HUD zen de verdad** (🟢): en Zen se oculta el combo/multiplicador y el score se atenúa (o se reemplaza por el contador de flores de la sesión); la fiebre no se activa. Opción «ritmo» (lento/normal) en el lanzador del modo — el único lugar del juego donde elegir ritmo encaja sin fricción (resuelve parcialmente D4 reutilizando `Config.DIFFICULTY.facil`). *Justificación: coherencia identidad-reglas; la dificultad fácil por fin tiene un consumidor real fuera de Supervivencia.*

## 3.7 Tutorial (Coach) — fuera del alcance de este plan

Correcto tras V1 (3 pasos, arranque dirigido a Clásico 1-1). Única mejora ligada a este plan: cuando GM-03 (boosters pre-nivel) exista, añadir 1 coach-mark contextual la primera vez que se ofrezcan. No se toca nada más.

# 4. Marco psicológico aplicado

Principios usados en §3, con su regla de aplicación y dónde aterriza cada uno (todas las propuestas citan al menos uno — si una futura idea no encaja en ninguno, sospechar de ella):

| Principio | Regla práctica | Aterriza en |
|---|---|---|
| **Flow (reto ≈ habilidad, feedback inmediato)** | El primer minuto de cada modo debe tener material de juego constante; la dificultad sube en rampa visible, no en escalón | GM-26 (warm-up), curvas §7 |
| **Regla pico-final** | Cada run debe tener un pico identificable y un final en crescendo, y el resumen debe recordar el pico | GM-10 (sprint), GM-08 (jefes), GM-25 (momento destacado) |
| **Gradiente de meta** | Toda meta a >2 min de distancia necesita barra de progreso visible que se acelere al final | Ya cubierto por NextActions; GM-14 (calendario), GM-18 (jefe visible en barra) |
| **Anticipación > sorpresa** | Telegrafiar todo evento mayor 3–20s antes; la espera tensa vale más que el susto | GM-18, GM-08, alerta de oleada (hecha) |
| **Near-miss ético** | Comunicar la distancia a la victoria al perder, sin monetizar la frustración en caliente | GM-01; GM-02 se limita a 1 uso justamente por esto |
| **Refuerzo variable legible** | Las recompensas variables (cofres, bendiciones) funcionan solo si el jugador entiende QUÉ acción las produjo | GM-17, cofres (existente), GM-16 (multiplicador legible) |
| **Autonomía (SDT)** | Mínimo una decisión significativa por sesión y por modo | GM-03 (loadout), GM-06 (rutas), GM-17 (bendiciones), GM-24 (ritmo) |
| **Competencia (SDT)** | Señales de maestría comparadas contra uno mismo, no contra el mundo | GM-12 (ghost), racha perfecta (hecha), récord de oleada (hecho) |
| **Aversión a la pérdida, versión ética** | Lo que se pierde debe ser recuperable o pausable; nunca castigar la ausencia | GM-14 (racha congelable), GM-19 (revivir con tope), rachas existentes |
| **Una barra, una promesa** | Cada medidor del HUD promete exactamente una cosa y se distingue de los demás | GM-21, GM-16 |
| **Coste hundido inverso (respeto al tiempo)** | Toda run interrumpida debe poder retomarse o cerrarse con dignidad | RunSave (hecho), GM-09 (registro de expedición) |

# 5. Fragmentación: identidad única por modo

La matriz objetivo. Regla de oro: **cada sistema nuevo pertenece a UN modo** (la tentación de "esto mola, ponlo en todos" destruye la fragmentación). Lo compartido por todos: mecánica core, combo, fiebre, misiones/XP.

| Modo | Fantasía | Sistema exclusivo | Recompensa exclusiva | Firma sensorial (Fase 4 audio) |
|---|---|---|---|---|
| **Clásico** | «Artesano»: dominar mapas curados | Boosters pre-nivel (GM-03) + niveles estrella (GM-04) | Estrellas, racha perfecta, cofre de mundo | Motivo melódico resolutivo; paleta del mundo |
| **Aventura** | «Expedicionario»: componer tu propia run | Rutas (GM-06) + reliquias (GM-07) + jefes activos (GM-08) | Registro de expedición, insignias de bioma | Capas que se añaden por capítulo; leitmotiv de jefe |
| **Contrarreloj** | «Velocista»: el reloj es el rival | Sprint final (GM-10) + ghost (GM-12) + cápsulas (GM-13) | Récord con línea de ritmo | Tempo musical acoplado al reloj; heartbeat <10s (hecho) |
| **Reto del día** | «Ritual»: el mismo tablero que todos | Calendario/racha (GM-14) + mutador diario (GM-15) | Medallas y racha mensual | Firma de apertura reconocible («campana del día») |
| **Supervivencia** | «Superviviente»: poder contra caos | Bendiciones (GM-17) + jefes telegrafiados (GM-18) + mutador semanal (GM-22) | Cofres, récord de oleada, revivir | Percusión por oleada; silencio dramático pre-jefe |
| **Zen** | «Santuario»: nada que perder | Jardín (GM-23) + HUD sin números (GM-24) | Skin «Jardín» inconseguible fuera | Ambiente generativo sin percusión |

Anti-solape resultante: Clásico y Aventura dejan de competir (curado+consumibles vs run+elecciones); Contrarreloj libre y Reto divergen (ghost/sprint personal vs ritual igualitario con mutador); Supervivencia queda como único modo de "build en tiempo real"; Zen es el único sin evaluación.

# 6. Energía y frenesí: plan de pacing

El trabajo de Fases 1–3 resolvió el feedback **por jugada**. Lo que falta es la **curva de energía por partida**: hoy casi todos los modos arrancan fríos, suben linealmente y terminan sin clímax. Objetivo: forma de "sierra ascendente con picos" en todos los modos de acción.

1. **GM-26 · Warm-up universal** (🟢, balance): durante los primeros 10s de nivel/partida (o hasta la 3ª convergencia, lo que llegue antes), `spawnRate` efectivo ×0.55. Después, transición suave (2s) al valor normal. Aplica a Clásico, Aventura, Contrarreloj y Supervivencia; NO a Zen. *Ataca D2: material inmediato → primer combo posible en los primeros 15s → activación temprana. Validar con §10 que no infla el score medio >5%.*
2. **GM-27 · Fiebre-espectáculo** (🟡, sin tocar números): al entrar en Fiebre — 500ms de "aspiración" (los spawns se pausan, zoom sutil 1.02 del tablero, barrido de color del acento del modo), la música salta de capa (Fase 4), los popups de puntos crecen 1.3×, y el aro de combo pasa a modo llama. Al salir, "exhalación" de 300ms. Respeta `reduced-fx` (versión: solo cambio de color + audio). *Ataca D3: la Fiebre debe sentirse como el Zone de Tetris Effect, no como un +25% contable. El multiplicador no cambia: cambia la percepción.*
3. **GM-16 · Multiplicador total legible** (🟢, el quick-win más importante del plan): un chip único junto al score: `×N.N` = producto vivo de combo × fiebre × temp (dificultad y modo van implícitos, son constantes de la run). Crece/brilla al subir, se apaga en gris al romperse el combo. Los popups de puntos dejan de mostrar solo `×comboMult` y muestran el total. *Ataca D1: si el jugador ve UN número subir a ×12 y sabe que todo lo que haga vale ×12, el frenesí se vuelve tangible. Es el pegamento de GM-10/17/27.*
4. **Crescendos por modo** (ya diseñados arriba): sprint final (GM-10), jefe telegrafiado (GM-18/GM-08), marea (GM-20).
5. **GM-28 · Momento destacado en el resultado** (🟢): trackear en `State` el "pico" de la run (la jugada de más puntos: valor, combo y contexto) y mostrarlo en el modal de fin: «Tu mejor momento: +840 con combo ×14 en la oleada 7». *Regla pico-final aplicada al resumen; coste: 3 variables y una línea de HTML.*
6. **Audio por intensidad = Fase 4 del plan de engagement** (sin duplicar aquí): las firmas de §5 se implementan cuando esa fase se ejecute; GM-27 y GM-10 definen sus puntos de enganche.

# 7. Balance y dificultad

### 7.1 Decisión sobre el selector de dificultad (D4)

El selector global muerto se resuelve así, por modo (no un selector único global — la dificultad correcta es contextual):

| Modo | Decisión | Racional |
|---|---|---|
| Clásico | Sin selector; la curva la da el mapa | La dificultad elegible rompería las estrellas como medida comparable |
| Aventura | Sin selector; las **rutas (GM-06)** SON la dificultad elegible | Elegir «campo denso» ya es elegir difícil con recompensa acorde |
| Contrarreloj | Sin selector por ahora; el **sprint (GM-10)** añade el techo de skill | Mantener records comparables; revisar tras datos de §10 |
| Reto del día | Nunca | Identidad igualitaria |
| Supervivencia | Se mantiene el actual (fácil/normal/difícil) | Ya funciona y su TUNE es sólido |
| Zen | Toggle «ritmo» lento/normal (GM-24) | Único sitio donde elegir ritmo encaja sin romper nada |

Y **eliminar `selDiff`** del código (o cablearlo a GM-24): configuración muerta es deuda.

### 7.2 Cambios numéricos propuestos (todos condicionados a validación §10)

| # | Valor actual | Propuesta | Justificación | Riesgo |
|---|---|---|---|---|
| B1 | Revivir 120 plano | `120 × 2^(usos)`, tope 480, máx 3/run (GM-19) | Restaurar peso de la muerte tardía | Bajo: primera muerte intacta |
| B2 | Error en scoreAttack: +iconos | −3s, sin iconos (GM-11) | Coste legible en la moneda del modo | Medio: acorta runs de jugadores flojos → medir |
| B3 | Warm-up: no existe | spawn ×0.55 primeros 10s (GM-26) | Activación temprana (D2) | Bajo: +score inicial marginal |
| B4 | Sprint: no existe | ×1.5 con `timeLeft ≤ 10s` (GM-10) | Pico final + riesgo-recompensa | Medio: puede inflar récords ~10–20% → reset visual de "época" en el récord local si se confirma |
| B5 | Racha victorias: no existe | +10%/nivel monedas, tope +50% (GM-05) | Refuerzo de sesión larga sin castigo | Bajo: inflación de monedas leve → contrapesada por sumidero GM-03 |
| B6 | Congelar/romper hielo no da nada | +2 de carga por tap de hielo (Superv.) | El "busywork" pasa a contribuir al build | Nulo |
| B7 | Continuar en Clásico: no existe | 15💎, 1/nivel, despeja 40% (GM-02) | Primer sumidero real de gemas | Bajo con el tope de 1 |

**No se toca** (deliberadamente): tabla de combos, milestones, fórmula base de score, CLEAR_ASSIST, TUNE de Supervivencia, curva de estrellas, XP. Son el esqueleto validado por el juego real; cambiarlos sin telemetría ni simulación sería vandalismo de balance.

### 7.3 Guardarraíl de las medallas del día

Los umbrales 750/1500/2500 dependen de la fórmula de score con dificultad `normal`. Añadir un test que juegue (bot de §10) el reto con la semilla fija de un día conocido y verifique que el percentil de score del bot cae en la banda esperada — si un cambio de balance mueve las medallas, el test lo grita antes que los usuarios.

# 8. Potenciadores y penalizadores: rediseño

### Potenciadores — estado y destino

| Pieza | Hoy | Destino |
|---|---|---|
| bomb/freeze/clearLine/wild/x2 | Arsenal persistente procedente de cofres/eventos | Se equipa voluntariamente antes del intento: hasta 2 tipos en Clásico y 3 en Supervivencia; stock primero y compra con monedas para faltantes |
| Anillo de suministro | Se llena con juego hábil | Paga pocas monedas para financiar futuras preparaciones; no genera boosters aleatorios ni toca el arsenal persistente |
| x2 | Duplica 11s, se apila con frenesí y fiebre (×53 teórico §1.2) | Se mantiene el efecto; GM-16 lo hace legible. Si la simulación muestra abuso, tope de `tempMult ≤ 3` documentado |
| Tiles trigger (bonus/portal/magicbox/bomba/slowdown) | Repartidos por modos | Sin cambios; cápsulas de tiempo (GM-13) se suman a la familia en Contrarreloj |
| Reliquias (nuevo) | — | Solo Aventura (GM-07): pasivas de run, nunca compradas |
| Bendiciones (nuevo) | — | Solo Supervivencia (GM-17): elección post-jefe |

Reglas de diseño de potenciadores: (1) nunca en Reto del día; (2) nunca obligatorios ni empujados en derrota caliente; (3) todo potenciador nuevo debe ser combinación de primitivas existentes (`_powerClear`, locks, tiles, multiplicadores) — cero mecánicas huérfanas nuevas.

### Penalizadores — coherencia por modo

Principio: **el castigo debe cobrar en la moneda que el modo valora** y ser proporcional al riesgo elegido.

| Modo | Penalización hoy | Ajuste |
|---|---|---|
| Clásico/Aventura | +iconos (1–5 según dificultad/nivel) + spawn ×0.95 + estrella en vivo | Correcta (los iconos amenazan el objetivo "vaciar"). Añadir al toast el dato oculto: «+2 figuras · ritmo +5%» — hoy la aceleración es invisible |
| Contrarreloj/Reto | +iconos (ambiguo, §1.3) | −3s (B2), sin iconos |
| Supervivencia | +iconos (amenaza real de overflow) + trampas/eventos | Correcta; los eventos jefe ganan telegrafía (GM-18) para ser justos además de duros |
| Zen | Sin penalización | Correcto; GM-24 además retira la evaluación visual |

# 9. Qué NO cambiar

Fortalezas verificadas que este plan protege explícitamente (cualquier propuesta futura que las toque necesita evidencia de §10 o telemetría):

1. La mecánica core y su invariante anti-confusión de iconos (ventana ≤8 sobre ciclo de 16 formas).
2. `CLEAR_ASSIST` (sesgo anti-frustración) — piedad invisible bien calibrada.
3. La tabla TUNE de Supervivencia y su triple dificultad.
4. La estructura de recompensas de oleada (monedas/gemas/cofres en 1/5/10) — ritmo de refuerzo variable correcto.
5. El tope de reloj de Contrarreloj (90s) y su doble decaimiento — el mejor trabajo de balance del repo.
6. RunSave, reto diario seedeado, compartir con semilla — infraestructura de retención ya correcta.
7. El principio ético del plan de engagement (sin dark patterns) — es identidad de producto, no restricción.

# 10. Metodología profesional: balance por simulación

Sin telemetría (bloqueada por decisión del propietario) y sin equipo de QA, la única vía profesional de validar balance es **simular**. El repo lo permite hoy: motor puro, RNG seedeado, `game.js` ya carga en Node sobre `tests/dom-stub.js`.

**GM-30 · `tools/balance-sim.js`** (🟡🟡, prerequisito de todos los cambios B1–B7):

- **Bot parametrizable**: cada "tick" simulado escanea celdas vacías con `Engine.converging(i)`, y elige jugada con una política: `greedy` (máx. iconos), `combo-keeper` (prioriza mantener ventana), `random-válida`, con **retardo de reacción** configurable (300–1200ms) para modelar niveles de habilidad.
- **Corre N=500 runs seedeadas por modo × dificultad × política** (determinista → reproducible en CI) y emite un JSON/tabla:
  - score p50/p90, duración de run, oleada/nivel alcanzado;
  - % de tiempo sin jugada disponible («dead air») — la métrica de D2;
  - uptime de combo y de fiebre;
  - tasa de disparo del clear-assist;
  - monedas/hora por modo (salud de la economía);
  - en Supervivencia: distribución de causa de muerte (overflow post-jefe vs orgánico).
- **Uso**: (a) baseline ANTES de tocar balance; (b) re-run tras cada cambio B*; criterio de aceptación en cada tarea («B2 no reduce la duración p50 de Contrarreloj >15%»); (c) test de guardarraíl de medallas (§7.3) en CI.
- **Límite honesto**: un bot no siente — valida rangos y regresiones, no diversión. La diversión se valida con playtest manual guiado (checklist por modo en la tarea GM-31) y, a futuro, telemetría opt-in (ROADMAP 7.1).

**GM-31 · Checklist de playtest por modo** (🟢, documento): guion de 10 min por modo con qué observar (¿primer combo antes de 20s? ¿se entiende el multiplicador? ¿el jefe asusta antes de llegar?) para ejecutar en cada release que toque gameplay. Vive en `docs/` junto a este plan.

# 11. Roadmap de ejecución por fases

Orden pensado para: valor visible temprano, dependencias respetadas, y cero cambios de balance antes de tener la simulación como red. Esfuerzo: 🟢 horas · 🟡 días · 🟡🟡 semana.

### Fase GM-α — Legibilidad y picos (sin tocar balance) — *la que más energía transmite por euro*
> ✅ **Fase completada el 2026-07-06 (v2.1.0).** Detalle de lo implementado en el registro al final de este documento.
1. **GM-16** Multiplicador total legible (🟢) — ✅ v2.1.0: chip `#hud-mult` junto al score (combo × fiebre × temp) + popups con el multiplicador total.
2. **GM-28** Momento destacado en el resultado (🟢) — ✅ v2.1.0: `State.bestPlay` + tarjeta en `modal-over` con contexto (oleada/nivel).
3. **GM-18** Telegrafiar jefe en la barra de oleada (🟢) — ✅ v2.1.0: bandera «⚠ Jefe» toda la oleada previa, pre-roll del tipo de evento y aviso específico ~3s antes.
4. **GM-27** Fiebre-espectáculo (🟡) — ✅ v2.1.0: entrada con pausa de spawns 500ms + zoom/saturación one-shot, popups 1.3×, aro en llamas, exhalación al salir; anulado bajo `reduced-fx`.
5. **GM-01** Near-miss en derrota (🟢) — ✅ v2.1.0: `State.minIcons`; «Te quedaste a {n} figuras» si mínimo ≤10 y >45s de nivel.
6. **GM-21** Fusión visual carga+frenesí (🟡) — ✅ v2.1.0: widget `#power-rings` de 2 anillos concéntricos sustituye a las 2 barras; textos de ayuda actualizados.
7. **GM-31** Checklist de playtest (🟢) — ✅ v2.1.0: `docs/PLAYTEST_CHECKLIST.md`.

### Fase GM-β — Red de seguridad + primeros cambios de balance
> ✅ **Fase completada el 2026-07-07 (v2.2.0).** Baseline y comparación en [`BALANCE_BASELINE.md`](./BALANCE_BASELINE.md); detalle en el registro al final.
8. **GM-30** Simulador de balance + baseline (🟡🟡) — ✅ v2.2.0: `tools/balance-sim.js` (reloj virtual + bots deterministas, 3 perfiles); baseline v2.1.0 y comparación en `BALANCE_BASELINE.md`.
9. **GM-26** Warm-up universal (B3, 🟢) — ✅ v2.2.0: intervalo ×0.55 primeros 10s o 3 convergencias, rampa 2s; excluye Zen/tutorial. Criterio validado (sin inflación sistemática).
10. **GM-10** Sprint final de Contrarreloj (B4, 🟢) — ✅ v2.2.0: ×1.5 con ≤10s, integrado en chip/popup; récords +1.8% (✅ ≤20%); actúa de comeback mechanic para perfiles débiles (+40% casual).
11. **GM-11** Error = tiempo en scoreAttack (B2, 🟢) — ✅ v2.2.0: −3s sin iconos ni aceleración; duración de runs sin cambio (✅).
12. **GM-19** Revivir con precio creciente (B1, 🟢) — ✅ v2.2.0: `min(480, 120×2^usos)`, máx 3/run.
13. B6 hielo→carga (🟢) — ✅ v2.2.0: +2 de carga por toque de rompible en Supervivencia · guardarraíl de medallas (§7.3) — ✅ `tests/balance-guardrail.test.js` en CI.

### Fase GM-γ — Identidad y decisiones (la fragmentación real)
> ✅ **Fase completada el 2026-07-07 (v2.3.0).** Todas las elecciones comparten el componente `Picker`; detalle en el registro al final.
14. **GM-17** Bendiciones post-jefe en Supervivencia (🟡🟡) — ✅ v2.3.0: elección 1 de 3 (pool de 5) ~1.7s tras cada evento jefe.
15. **GM-06** Rutas de capítulo en Aventura (🟡🟡) — ✅ v2.3.0: exigente (+obstáculos, ×1.25) vs serena (spawn ×1.15, sin bonus), por capítulo.
16. **GM-07** Reliquias de jefe (🟡) — ✅ v2.3.0: 4 pasivas de run (combo/crystal/hint/shield), máx. 3 FIFO, visibles en el banner.
17. **GM-03** Boosters pre-nivel en Clásico (🟡) — ✅ v2.3.0: lanzador desde el 2º mundo, hasta 2 consumibles (80/60/90 monedas), aviso la primera vez.
18. **GM-02** Continuar con gemas (🟡) — ✅ v2.3.0: 15💎, 1/nivel, despeja 40%, rechazo simétrico · **GM-05** racha de victorias (🟢) — ✅ +10%/nivel de racha en monedas, tope +50%.
19. **GM-24** HUD zen + ritmo (🟢) — ✅ v2.3.0: sin Fiebre/combo/multiplicador, score atenuado, ritmo Sereno/Fluido · `selDiff` muerto retirado — ✅.

### Fase GM-δ — Ritual y variedad a largo plazo
> ✅ **Fase completada el 2026-07-07 (v2.4.0)** salvo GM-04, diferido con justificación (abajo). Detalle en el registro al final.
20. **GM-14** Calendario y racha del reto (🟡) — ✅ v2.4.0: historial de medallas (60 días), racha con congelación ética (1 + 1/7 días), +1 cofre cada 7 días, calendario de puntos en misiones y racha en home.
21. **GM-12** Ghost personal (🟡) — ✅ v2.4.0: línea de tiempo del mejor intento (modo y reto de hoy); chip ▲/▼ en el HUD cada segundo.
22. **GM-15** Mutador del día (🟡) — ✅ v2.4.0: 8 variantes deterministas por fecha → **GM-22** mutador semanal de Supervivencia (🟢) — ✅: hielo/caos/furia/ninguna por semana ISO.
23. **GM-08** Jefes con comportamiento en Aventura (🟡) — ✅ v2.4.0: ataque de bioma cada 20s con aviso a 3s · **GM-09** registro de expedición (🟢) — ✅: cadena de rutas/reliquias en el resumen.
24. **GM-13** Cápsulas de tiempo (🟢) — ✅ v2.4.0: 1/partida, momento seedeado, +5s por adyacencia · **GM-23** Jardín zen (🟡) — ✅: flores permanentes, cofre a las 10, skin exclusivo a las 50 · **GM-04** niveles estrella (🟡) — ⏸️ **diferido**: los puzles finitos sin spawns exigen un generador con solvabilidad garantizada (construcción inversa + tests) que merece sesión propia; hacerlo sin él arriesga niveles imposibles, el peor bug de confianza posible. Única tarea del plan pendiente.
25. **GM-20** Marea reemplaza quake (🟢) — ✅ v2.4.0: amenaza legible con counterplay; el quake queda como tema de la "semana del caos".

**Regla de corte:** cada fase termina con `tools/bump-version.sh`, tests+lint verdes, checklist GM-31 del modo tocado, y actualización de `MIGRATION_SPEC.md` (fórmulas) + este documento (estado). Si hay que recortar, se recorta de δ hacia α, nunca al revés — α y β son la base de percepción y seguridad de todo lo demás.

**Trabajo explícitamente NO incluido** (pertenece a otros planes): multijugador/leaderboard online (ROADMAP §8), Fase 4 de audio (plan de engagement — aquí solo se definen sus puntos de enganche), mundo 6 y mecánica `infected` (ROADMAP 3.4/3.10 — encajarían como bioma/ruta nueva tras GM-06), monetización (no existe y no se propone).

> **Post-ejecución (2026-07-07):** con las 4 fases completadas, el cierre de calidad (pendientes QP-*, caza de bugs del flujo nuevo con hallazgos confirmados, y rendimiento móvil medido con plan de corrección) vive en [`QA_PERF_PLAN.md`](./QA_PERF_PLAN.md).

# 12. Riesgos y guardarraíles

| Riesgo | Mitigación |
|---|---|
| **Inflación de complejidad** (el juego muere de sistemas) | Regla §5: cada sistema pertenece a UN modo. Presupuesto: máx. 1 sistema nuevo por modo y fase. Zen y Reto tienen prohibido crecer en sistemas de presión |
| **Romper el balance validado por uso real** | Ningún cambio B* sin baseline de GM-30; los valores actuales quedan como fallback documentado; `MIGRATION_SPEC.md` se actualiza en el mismo PR que el número |
| **Romper partidas guardadas** | Todo campo nuevo de `cv_meta` (dailyRun.history, zen.flowers, mastery…) sigue el patrón de relleno tolerante de `Meta` (`_v`); prohibido renombrar campos existentes |
| **Deriva hacia dark patterns** (GM-02/GM-19 tocan dinero-frustración) | Límites duros escritos: 1 continuar/nivel, 3 revivir/run con precio visible, racha congelable, cero popups de compra en derrota. Cualquier PR que relaje esto necesita cita a este documento |
| **Regresión de rendimiento** (GM-27, GM-08 añaden FX) | Todo efecto nuevo pasa por `FX.cap`/gobernador y tiene variante `reduced-fx`; prohibidas animaciones persistentes de box-shadow (regla del design system) |
| **i18n incompleta** | Toda string nueva en ES+EN desde el primer commit (regla CLAUDE.md); las tablas de mutadores/bendiciones/reliquias definen sus claves i18n en el mismo PR que la lógica |
| **El documento se pudre** (como pasó con MIGRATION_SPEC en v1.8–1.9) | Cada tarea GM-* cierra actualizando su línea en §11 con fecha y versión, igual que hace el registro del plan de engagement |

---

# Registro de implementación

### 2026-07-06 — Fase GM-α implementada (v2.1.0)

- **GM-16**: nuevo `Render.multChip()` alimenta `#hud-mult` (chip junto al score) con el producto vivo `comboMult × feverBoost × tempMult`; se enciende con `--mode-accent`, pasa a oro con ×6+, gris a ×1. Los popups de puntos muestran ese mismo multiplicador total (antes solo el de combo). Se refresca desde `Render.hud()`, `Render.combo()` y `Survival._syncMult()`.
- **GM-28**: `State.bestPlay` registra la jugada de más puntos (puntos, combo, oleada/nivel); `fillStats()` la pinta en `#over-peak`. En Clásico se reinicia por nivel (igual que el score).
- **GM-18**: `Survival._planBoss()` decide al empezar cada oleada si la siguiente trae jefe y pre-rolla el tipo; `render()` muestra `#surv-boss-flag` («⚠ Jefe») y tinta la barra toda la oleada previa; `onTick` avisa del tipo concreto ~3s antes; `bossEvent()` consume el pre-roll (el aviso siempre coincide con el evento).
- **GM-27**: entrada en Fiebre = `State.spawnHoldUntil` (500ms sin spawns, comprobado en `doSpawn`), `Render.feverBurst()` (zoom 1.022 + saturación, one-shot, transform/filter), popups a 1.3× vía `.board-wrap.fever-on .popup`, aro de combo en llamas (`.combo.fever`, el estado urgente mantiene prioridad); salida con `Render.feverOut()` (exhalación 340ms). Todo anulado bajo `reduced-fx`.
- **GM-01**: `State.minIcons` (mínimo de iconos del nivel, actualizado en `evaluate()`); en la derrota por tablero lleno de Clásico/Aventura, si `minIcons ≤ 10` y `elapsed > 45s`, `#over-near` muestra «Te quedaste a {n} figuras de lograrlo». Sin coste, sin pago: puro encuadre near-miss.
- **GM-21**: `#power-rings` (SVG, 2 anillos concéntricos: interior carga → potenciador, exterior frenesí → furia, llama central que se enciende en frenesí) sustituye a `.charge` + `.frenzy-meter`; `Survival.render()` escribe `stroke-dashoffset`. Textos `surv_sys_*` actualizados a «anillo» en ES/EN. Sin cambio de reglas.
- **GM-31**: `docs/PLAYTEST_CHECKLIST.md` con guion de ~10 min por modo e ítems bloqueantes ⭐.
- **Balance intacto**: sin cambios en puntos, fórmulas, spawn (salvo la micro-pausa de 500ms al entrar en Fiebre, que es la mecánica diseñada de GM-27), economía ni probabilidades. El pre-roll del jefe consume `rand()` en otro orden (sin efecto de juego: Supervivencia no es seedeada-compartida).
- i18n nuevas (ES+EN): `near_miss`, `peak_moment`, `surv_boss_soon`, `surv_boss_meteor_warn`, `surv_boss_quake_warn`, `surv_boss_frost_warn`; `surv_sys_charge`/`surv_sys_frenzy` reescritas.

### 2026-07-07 — Fase GM-β implementada (v2.2.0)

- **GM-30**: `tools/balance-sim.js` — carga `game.js` real sobre el dom-stub de tests con `performance.now` parcheado (reloj virtual) y conduce `Loop.tick` con bots deterministas (perfiles skilled/average/casual: reacción, política greedy/aleatoria, tasa de error y lapsos de atención). Mismo seed ⇒ misma partida, verificado. Baseline v2.1.0 + batería v2.2.0 + evaluación de criterios en [`BALANCE_BASELINE.md`](./BALANCE_BASELINE.md). Hallazgos estructurales: la dificultad de Contrarreloj/Supervivencia es cognitiva (ningún bot muere: la presión útil ataca la atención, no la velocidad); el dead-air de jugadores rápidos es 66–85% (confirma D2 con datos).
- **GM-26 (B3)**: warm-up de apertura — `Config.WARMUP {ms:10000, convs:3, factor:0.55, rampMs:2000}`, aplicado como factor en el bucle (no muta `spawnRate`); excluye `relaxed`/`single`. Zen idéntico bit a bit en el sim (control ✅); desviaciones de score contradictorias entre perfiles ⇒ ruido de re-muestreo, no inflación (✅ criterio).
- **GM-10 (B4)**: sprint final — `Config.SPRINT_WINDOW 10 / SPRINT_MULT 1.5` vía `Game.sprintMult()`, aplicado en convergencias y bonus de tablero vacío, visible en el chip GM-16 y el popup; toast con throttle de 6s al entrar en zona crítica. Récords (skilled) +1.8% (✅ ≤20%); descubrimiento: rubber-banding a favor de perfiles débiles (+40% casual p50), deseable.
- **GM-11 (B2)**: en `scoreAttack` el error resta `TIMED_MISTAKE_S = 3`s (toast «Error · −3s»), sin iconos ni aceleración; muerte inmediata si el reloj llega a 0. Duración de runs sin cambio en el sim (✅ ≤15%).
- **GM-19 (B1)**: revivir `min(480, 120×2^usos)`, máx 3 por run (a la 4ª muerte, fin directo); el modal muestra el precio vivo. Texto de ayuda actualizado ES/EN.
- **B6**: +2 de carga por toque a rompible en Supervivencia (mirror de la lógica de grant de `onConverge`).
- **Guardarraíl (§7.3)**: `tests/balance-guardrail.test.js` — umbrales de medalla verbatim + bot estándar (average, 3 min, seeds fijos) con mediana calibrada 60649 y banda ±40%. Corre en CI con la suite normal.
- i18n nuevas (ES+EN): `sprint_on`, `mistake_time`; `surv_sys_lives` reescrita (precio creciente).
- Infra de tests: `firstChild`/`lastChild` del dom-stub ahora son getters reales (lo exigía `Toasts.show` al correr el juego entero en Node).

### 2026-07-07 — Fase GM-γ implementada (v2.3.0)

- **`Picker`** (componente nuevo): overlay único de "elige 1 de N" con pausa suave y restauración de estado; lo comparten bendiciones, rutas, reliquias, continuar y el ritmo zen. Una sola superficie de UI para toda la agencia de la fase (regla §5: cada sistema pertenece a un modo, pero el patrón de elección es común).
- **GM-17**: `Survival.offerBoons()` ~1.7s tras cada `bossEvent()` — 1 de 3 sobre pool de 5 (`life` +1 vida tope MAX+1 · `charge` +50 · `pack` +1💣+1⚡ · `slow` spawn ×1.15 dos oleadas vía hook `spawnFactor` en el bucle · `frenzy` instantáneo). El jefe pasa de molestia a ciclo miedo→codicia.
- **GM-06**: `Adventure.maybeOfferRoute()` al entrar en capítulo (encadenada tras la intro): `dense` refuerza el obstáculo del bioma y fija `tempMult 1.25` (legible en el chip GM-16) · `calm` spawn ×1.15 sin bonus. La ruta caduca en la frontera de capítulo; estado volátil de run (no persiste en RunSave — documentado).
- **GM-07**: `Adventure.offerRelic()` al superar cada jefe (cadena intro→reliquia→ruta en `nextLevel`): combo +400ms · cristales +30 · +1 pista/nivel · escudo (1ª derrota del capítulo = despeje 30%). Máx. 3, FIFO; iconos en el banner de objetivo.
- **GM-03**: `PreLevel` — lanzador de nivel de Clásico desde el 2º mundo con hasta 2 consumibles (bomb 80 / freeze 60 / clearLine 90, los costes históricos de `Boosters.DEFS`); consumibles POR INTENTO; reutiliza el inventario/apuntado de Supervivencia (`Input` acepta armado en Clásico, `blockSpawn` del modo cubre freeze, anillos ocultos vía CSS). Coach-mark de primera vez (`cv_preboost`).
- **GM-02**: al llenarse el tablero en Clásico/Aventura, cadena escudo→continuar→derrota (`Game._overflowLose`): oferta única por nivel de continuar por 15💎 (despeja 40%), rechazo simétrico, sin cuenta atrás. Primer sumidero de gemas de gameplay.
- **GM-05**: `Meta.recordClassicWin()` — racha de victorias con bonus de monedas `+min(5, racha−1)·10%` en `_classicComplete`, línea propia en el modal de nivel; solo la derrota la reinicia.
- **GM-24**: Zen con `noFever` (umbral infinito), combo/chip ocultos y score atenuado por CSS; lanzador con ritmo Sereno (`facil`)/Fluido (`normal`) persistido en `cv_zen_diff`. El `selDiff` global muerto queda eliminado (la Aventura usa `normal` explícito).
- **Simulador**: los bots resuelven `Picker` (primera opción en elecciones, rechazo en ofertas con gasto). Batería v2.3.0: **Clásico, Contrarreloj y Zen idénticos bit a bit** (control ✅ — los cambios no se filtraron fuera de su modo); Aventura baja ~34% en bots skilled/average porque SIEMPRE eligen la ruta exigente — señal de que el trade-off es real (la ruta dura no domina); Supervivencia ±1%.
- i18n nuevas (ES+EN): 12 claves de bendiciones, 5 de rutas, 11 de reliquias, 6 de continuar, `classic_win_streak`, 5 de ritmo zen, 8 de PreLevel.

### 2026-07-07 — Fase GM-δ implementada (v2.4.0)

- **GM-20**: `Survival.tideSurge()` — marca las 2 filas exteriores 1.2s y las llena; sustituye al quake en el pool base de jefes (`_bossPool()` por id, pre-roll compatible con el telegrafiado GM-18). El quake vuelve solo en la semana del caos.
- **GM-22**: `Survival.weeklyMut()` — `hash32(lunes ISO) % 4`: hielo (trampas heladas, monedas ×1.15) / caos (quake al pool) / furia (frenesí ×1.3) / ninguna. Toast al empezar; `_mutOverride` para el simulador.
- **GM-15**: `DailyMut` — `hash32(fecha) % 8` elige el tema del reto (puro/hielo/combos exigentes/variedad/rocas/veloz/cristales/sin pistas); se aplica tras montar el nivel con RNG seedeado (idéntico para todos); nombre en la tarjeta del home y toast al empezar.
- **GM-14**: `dailyRun.history` (60 días FIFO) + `Meta.dailyStreak()` con congelación ética (1 de regalo +1 por cada 7 días — perder un día pausa, no borra) + cofre cada 7 días de racha (una vez por hito, con re-armado si la racha se reinicia). Calendario de 14 puntos en el panel de misiones y racha `🔥n` en la tarjeta del home y el resultado.
- **GM-12**: muestreo de score cada 10s en scoreAttack; el mejor intento guarda su línea de tiempo (`modes[].ghost` / `dailyRun.ghost`); chip `#hud-ghost` ▲/▼ contra la muestra del mismo minuto de partida.
- **FB-4**: ficha previa `modal-daily` para el reto con mutador+efecto, medallas, mejor marca/ghost, racha y bonus; `Meta.DAILY_MEDALS` centraliza 750/1500/2500; `#daily-note` muestra la siguiente medalla en partida y los textos de home/modos dejan de depender de elipsis o recorte móvil.
- **FB-2**: `Config.MODES.contrarreloj.initialIcons = 22` y `spawnFactor()` de hambre de tablero (warm-up excluido; 0.65/0.85/1.1 por iconCount) reducen el dead-air del perfil average 57%→39% sin inflar score ni duración; el primer tuning más agresivo se descartó por fallar el guardarraíl de medallas.
- **GM-13**: tile `timecap` (⏰, +5s al detonar por adyacencia, tope de reloj de siempre), 1 por partida en un segundo seedeado (40–80s).
- **GM-08**: `Adventure.onTick` — en niveles jefe, ataque de bioma cada 20s con aviso a 3s (nebulosa andanada / rocas / hielo / aceleración / roba-pista / regeneración de cristal con tope 6). El jefe por fin HACE cosas.
- **GM-09**: `Adventure.log` + `expeditionHtml()` — la cadena capítulo·ruta → reliquias de la run, renderizada en `#over-exped` del resumen (narrativiza la derrota).
- **GM-23**: `Meta.zen.flowers` — +1 flor por tablero limpio en Zen (visible en banner); 10 flores → +1 cofre; 50 → skin exclusivo «Jardín Zen» (`exclusive: true`, la tienda lo muestra bloqueado, no comprable). *Desviación documentada: el plan proponía regalar un tema comprable a las 10 flores; se cambia por cofre para no interferir con la economía de temas.*
- **GM-04 diferido**: los niveles estrella (puzles sin spawn) requieren generación con solvabilidad garantizada; sin ella hay riesgo de puzles imposibles. Se pospone a una sesión dedicada (generador por construcción inversa + tests de solvabilidad).
- **Guardarraíl recalibrado**: 60649 → 52964 (la cápsula desplaza el stream RNG y añade tiempo); la banda ±40% lo absorbió sin fallar — funcionó exactamente como se diseñó.
- **Simulador**: batería v2.4.0 — Clásico y Zen idénticos bit a bit (control ✅); Contrarreloj +2–11% (cápsula, esperado); limitación documentada: los efectos diferidos por `setTimeout` de los eventos jefe (marea/quake) no se ejecutan dentro del bucle síncrono del sim.
- i18n nuevas (ES+EN): marea (2), mutador semanal (3), mutador diario (14), racha/calendario (2), cápsula (1), jefe de Aventura (7), expedición (1), jardín (2), `board_excl`.

### 2026-07-23 — Bugs de tablero reportados: carreras del mismo tick (v2.37.0)

- **B-10 (celdas calientes):** `Engine.noteHot` marca las celdas de cada eliminación (convergencia + punto tocado, bombas/objetos, despejes suaves); `spawnOne` las evita 450 ms si hay alternativa fría. Elimina la ilusión "mi icono no se eliminó / reapareció en su casilla" sin cambiar overflow ni conteos.
- **B-12 (relleno legible):** el relleno post-tablero-limpio entra en cascada radial retardada (`Render.refillAnim`, 320 ms base tras el aterrizaje del vuelo de convergencia) con gesto propio, y el popup del bonus espera 240 ms: causalidad visible "convergió → tablero limpio → bonus → relleno". Con `reduced-fx` todo es instantáneo como antes.
- **B-11:** cinturón anti-glifo-fantasma en `Render.clearAnim` sin target (si `animationend` no llega, limpieza idempotente a los 480 ms).
- **Guardarraíl recalibrado**: 52964 → 29292. Dos causas sumadas: (1) deriva acumulada de merges previos sin recalibrar (el p50 real de esta base ya era 33420, a un 5% del borde de la banda); (2) el desplazamiento del stream de celdas del fix mueve cada partida seedeada de trayectoria — efecto medio real ≲5% (101 runs/config: 27758 vs 29226, ≈1.1 SEM). Medallas del reto (750/1500/2500) sin cambios: el fix solo desplaza QUÉ celda recibe un spawn durante 450 ms.
- **Método:** QA en vivo con agentes (invariant-sim con timers falsos: 180 partidas, 0 roturas de invariantes; live-probe Playwright: ~1300 acciones reales, 0 desyncs DOM↔State) + probe de métrica de carrera que confirmó el respawn idéntico a 7–11 ms. Detalle en `QA_PERF_PLAN.md` §2.1 (B-10…B-13).

### 2026-07-18 — Flujo de sesión y economía de boosters implementados (v2.7.1)

- **Economía de boosters:** se eliminan las 10 unidades gratuitas de cada intento de Supervivencia. El lanzador permite
  elegir hasta 3 tipos y cotiza stock/monedas antes de una confirmación atómica. El stock persistente nunca aparece ni
  se consume durante la run; reintentar vuelve a preparación. Daily no admite loadout.
- **Suministro:** el anillo interior paga 2 monedas por ciclo en Normal (~3 en Difícil) y no crea boosters. La bendición
  `pack` sigue siendo un premio raro, ganado y exclusivo del intento. A/B de 40 runs/config: +12,9%…+19,8% monedas/run,
  dentro del límite incremental de +20%.
- **Orientación:** Misiones vuelve a mostrar diaria/semanal, progreso, recompensa automática, reroll con ticket y CTA al
  modo recomendado. Inicio expone un único CTA contextual con prioridad reanudar → Daily → misión cercana → Clásico.
- **Flujo común:** los cinco lanzadores declaran duración, guardado, objetivo y entrada/recompensa; el Reto diario explica
  la habilidad transferible y ofrece práctica en un modo estable después del resultado.
- **Navegación:** las vistas del hub conservan una pila de retorno, incluido el regreso al mapa de mundos.
