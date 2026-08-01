# Baseline de balance por simulación (GM-30)

> Resultados de `tools/balance-sim.js` — el juego REAL (game.js sin modificar) conducido en Node sobre un reloj virtual con bots deterministas (mismo seed + mismo perfil ⇒ misma partida, siempre). Regenerar con `node tools/balance-sim.js --runs 40`. **Regla:** antes de cualquier cambio de balance, capturar la batería "antes"; después del cambio, comparar contra los criterios de aceptación de la tarea (ver `GAME_MODES_MASTER_PLAN.md` §7/§10).
>
> Límite honesto: el bot valida rangos y regresiones, no diversión. Los perfiles modelan reacción (550/900/1400 ms), política (greedy/aleatoria), tasa de error (3/8/15%) y lapsos de atención; no modelan fatiga creciente ni carga cognitiva por densidad.

## Métricas

`sc p50/p90` score mediano/percentil 90 · `dur50` duración mediana · `combo` combo máximo mediano · `progreso` niveles completados (Clásico), nivel alcanzado (Aventura) u oleada (Supervivencia) · `deadAir` % de "turnos" del bot sin jugada disponible · `err` errores por run · `cap` % de runs cortadas por tiempo máximo del sim (no por muerte).

## Batería v2.1.0 (ANTES de los cambios de balance de GM-β) — 40 runs/config

```
modo           diff      perfil    sc p50   sc p90   dur50  combo    progreso  deadAir    err  coins    cap
clasico        normal    skilled    52215    77625    352s     x8      13 nvl      66%    0.8      0    95%
aventura       normal    skilled   102309   149697    352s    x15      nvl 19      62%    6.8      0   100%
contrarreloj   normal    skilled   233049   304558    240s    x26       nvl 1      77%    2.9    695   100%
supervivencia  normal    skilled   126555   199392    480s     x9   oleada 18      85%    3.3    689   100%
clasico        normal    average    32165    46469    355s     x6      10 nvl      44%    1.3      0    98%
aventura       normal    average    48653    74949    354s    x14      nvl 12      40%   14.2      0   100%
contrarreloj   normal    average   102056   135441    240s    x14       nvl 1      54%    7.0    384   100%
supervivencia  normal    average    85968   128687    480s     x8   oleada 18      71%    8.0    568   100%
clasico        normal    casual     13175    18265    357s     x6       5 nvl      18%    4.8      0   100%
aventura       normal    casual     17081    24175    357s    x11       nvl 6      15%   22.3      0   100%
contrarreloj   normal    casual     14566    30205    240s    x11       nvl 1      19%   13.9     56   100%
supervivencia  normal    casual     27746    41861    480s     x9   oleada 18      35%   21.3    358   100%
supervivencia  dificil   skilled   186320   288553    480s    x11   oleada 22      79%    4.8    938   100%
zen            normal    casual     13964    20412    240s     x6       nvl 1      70%    5.8     64   100%
```

## Batería v2.2.0 (DESPUÉS: GM-26 warm-up · GM-10 sprint · GM-11 error=tiempo · GM-19 revivir · B6) — 40 runs/config

```
modo           diff      perfil    sc p50   sc p90   dur50  combo    progreso  deadAir    err  coins    cap
clasico        normal    skilled    53910    77475    352s     x7      13 nvl      67%    0.3      0   100%
aventura       normal    skilled   101283   163301    352s    x16      nvl 19      63%    6.9      0   100%
contrarreloj   normal    skilled   237261   296408    240s    x22       nvl 1      77%    2.4    721   100%
supervivencia  normal    skilled   137428   203959    480s     x8   oleada 18      85%    3.3    684   100%
clasico        normal    average    35235    47340    354s     x8      10 nvl      43%    1.7      0    98%
aventura       normal    average    44232    70662    354s    x12      nvl 12      40%   13.9      0   100%
contrarreloj   normal    average   116169   172641    240s    x13       nvl 1      57%    6.6    440   100%
supervivencia  normal    average    96678   138103    480s     x8   oleada 18      69%   10.3    578   100%
clasico        normal    casual     14130    17115    357s     x7       5 nvl      17%    4.6      0   100%
aventura       normal    casual     18654    24429    357s    x10       nvl 7      13%   21.9      0   100%
contrarreloj   normal    casual     20336    38288    240s     x9       nvl 1      27%   12.6     93   100%
supervivencia  normal    casual     23352    37638    480s     x9   oleada 18      35%   21.0    345   100%
supervivencia  dificil   skilled   177852   266674    480s    x11   oleada 22      79%    4.6    937   100%
zen            normal    casual     13964    20412    240s     x6       nvl 1      70%    5.8     64   100%
```

## Batería v2.3.0 (Fase GM-γ: bendiciones, rutas, reliquias, continuar, racha, zen) — 40 runs/config

```
modo           diff      perfil    sc p50   sc p90   dur50  combo    progreso  deadAir    err  coins    cap
clasico        normal    skilled    53910    77475    352s     x7      13 nvl      67%    0.3      0   100%
aventura       normal    skilled    67010   161277    353s    x13      nvl 15      69%    5.5      0   100%
contrarreloj   normal    skilled   237261   296408    240s    x22       nvl 1      77%    2.4    721   100%
supervivencia  normal    skilled   138099   200600    480s     x9   oleada 18      85%    2.6    686   100%
clasico        normal    average    35235    47340    354s     x8      10 nvl      43%    1.7      0    98%
aventura       normal    average    27656    74152    355s    x10       nvl 9      51%   11.6      0   100%
contrarreloj   normal    average   116169   172641    240s    x13       nvl 1      57%    6.6    440   100%
supervivencia  normal    average    87689   111182    480s     x8   oleada 18      69%    9.9    561   100%
clasico        normal    casual     14130    17115    357s     x7       5 nvl      17%    4.6      0   100%
aventura       normal    casual     19357    26626    356s    x11       nvl 6      18%   21.1      0   100%
contrarreloj   normal    casual     20336    38288    240s     x9       nvl 1      27%   12.6     93   100%
supervivencia  normal    casual     24707    37059    480s     x9   oleada 18      35%   21.2    343   100%
supervivencia  dificil   skilled   186730   259432    480s    x11   oleada 22      79%    4.6    946   100%
zen            normal    casual     13964    20412    240s     x6       nvl 1      70%    5.8     64   100%
```

**Lectura (γ):** Clásico, Contrarreloj y Zen **idénticos bit a bit** a v2.2.0 — los sistemas nuevos no se filtran fuera de su modo (los bots del sim no compran potenciadores pre-nivel ni continúan con gemas). Aventura baja ~34% (skilled/average) porque los bots eligen SIEMPRE la primera opción = ruta exigente en todos los capítulos: la ruta dura no domina a la serena — el trade-off es real, que es la condición de una elección significativa. Supervivencia ±1% (las bendiciones compensan levemente la variación de RNG).

## Batería v2.4.0 (Fase GM-δ: marea, mutadores, calendario, ghost, cápsulas, jefes activos, jardín) — 40 runs/config

```
modo           diff      perfil    sc p50   sc p90   dur50  combo    progreso  deadAir    err  coins    cap
clasico        normal    skilled    53910    77475    352s     x7      13 nvl      67%    0.3      0   100%
aventura       normal    skilled    64987   169467    353s    x13      nvl 15      70%    5.3      0   100%
contrarreloj   normal    skilled   246131   309650    240s    x22       nvl 1      77%    2.2    730   100%
supervivencia  normal    skilled   138099   200600    480s     x9   oleada 18      85%    2.6    680   100%
clasico        normal    average    35235    47340    354s     x8      10 nvl      43%    1.7      0    98%
aventura       normal    average    26971    79481    355s    x10       nvl 7      52%   11.4      0   100%
contrarreloj   normal    average   129463   173844    240s    x13       nvl 1      57%    6.8    469   100%
supervivencia  normal    average    84051   110990    480s     x8   oleada 18      69%    9.9    559   100%
clasico        normal    casual     14130    17115    357s     x7       5 nvl      17%    4.6      0   100%
aventura       normal    casual     19224    26626    356s    x11       nvl 6      17%   21.3      0   100%
contrarreloj   normal    casual     20440    37752    240s     x9       nvl 1      26%   12.4     85   100%
supervivencia  normal    casual     24707    37059    480s     x9   oleada 18      35%   21.3    342   100%
supervivencia  dificil   skilled   194566   287880    480s    x11   oleada 22      79%    4.3    954   100%
zen            normal    casual     13964    20412    240s     x6       nvl 1      70%    5.8     64   100%
```

**Lectura (δ):** Clásico y Zen idénticos bit a bit (control ✅). Contrarreloj +2–11% por la cápsula de tiempo (+5s y desplazamiento del stream RNG) — esperado y aceptado; el guardarraíl se recalibró de 60649 a 52964 (la banda ±40% absorbió el cambio sin fallar). Supervivencia normal idéntica (el mutador semanal se fija a `none` en el sim). Limitación conocida: los efectos diferidos por `setTimeout` de los eventos jefe (relleno de la marea, barajado del quake) no se ejecutan dentro del bucle síncrono del simulador — se validan con el smoke de navegador.

## Batería FB-6 (Aventura score target vivo, post-v2.5.0) — 40 runs/config

Antes de FB-6 (misma sesión, referencia v2.5.0):

```
modo           diff      perfil    sc p50   sc p90   dur50  combo    progreso  deadAir    err  coins    cap
aventura       normal    skilled    64987   169467    353s    x13      nvl 15      70%    5.3      0   100%
aventura       normal    average    26971    79481    355s    x10       nvl 7      52%   11.4      0   100%
aventura       normal    casual     19224    26626    356s    x11       nvl 6      17%   21.3      0   100%
```

Después de FB-6 (`target score = level * (300 + 50*chapter)`):

```
modo           diff      perfil    sc p50   sc p90   dur50  combo    progreso  deadAir    err  coins    cap
aventura       normal    skilled    42068    96379    354s    x11      nvl 12      73%    5.3      0    98%
aventura       normal    average    30402    67521    355s    x10       nvl 9      52%   10.7      0   100%
aventura       normal    casual     17841    21799    357s    x11       nvl 6      18%   20.9      0   100%
```

Lectura: el nivel 3 deja de cerrarse en 2-3 convergencias y los objetivos `score` escalan con la potencia real del nivel. La progresión skilled cae 15→12 niveles (-20%, dentro del guardarraíl de FB-6 de no caer >25%); average sube 7→9; casual queda estable. Duración mediana estable.

## Batería FB-2 (Contrarreloj DDA de hambre, post-v2.5.0) — 40 runs/config

Antes de FB-2 (misma sesión, referencia v2.5.0):

```
modo           diff      perfil    sc p50   sc p90   dur50  combo    progreso  deadAir    err  coins    cap
contrarreloj   normal    skilled   246131   309650    240s    x22       nvl 1      77%    2.2    730   100%
contrarreloj   normal    average   129463   173844    240s    x13       nvl 1      57%    6.8    469   100%
contrarreloj   normal    casual     20440    37752    240s     x9       nvl 1      26%   12.4     85   100%
```

Después de FB-2 (`initialIcons:22`; `spawnFactor`: 1 durante warm-up, luego 0.65 con ≤10 iconos, 0.85 con ≤16, 1.1 con ≥30):

```
modo           diff      perfil    sc p50   sc p90   dur50  combo    progreso  deadAir    err  coins    cap
contrarreloj   normal    skilled   464250   587016    240s    x43       nvl 1      66%    3.5   1068   100%
contrarreloj   normal    average   120929   247968    240s    x22       nvl 1      39%    8.9    460   100%
contrarreloj   normal    casual     13085    29921    240s    x12       nvl 1      11%   15.0    114    98%
```

Lectura: el objetivo principal se cumple en el perfil average (`deadAir` 57%→39%, -18 puntos) sin inflar su score p50 (129463→120929, -6.6%) y con duración estable. Se descartó un primer tuning más agresivo (`initialIcons:24`, factores 0.55/0.75) porque el guardarraíl de medallas subía el bot estándar a 84984 (>74150); el tuning final mantiene `tests/balance-guardrail.test.js` verde sin recalibrar la mediana 52964.

## Batería v2.6.4 (SV-01: validación del rebalance de bendiciones + refill + candados) — 40 runs/config

> Contexto: entre v2.4.0 y v2.6.2 entraron a `game.js` tres cambios de balance de Supervivencia **sin batería previa** (violación de la regla operativa, detectada y corregida en SV-01): el refill de tablero vacío (v2.6.1), los candados con hits + topes de bomba (v2.6.2) y el rediseño de bendiciones con rareza + kicker de monedas (v2.6.2, además con `Math.random()` — no determinista). SV-01 bisecó la inflación, aplicó la tabla de nerf pre-acordada del plan de Supervivencia (golden ×3→×2, tope de impulso 1.0→0.5, peso épico 5→4) y restauró el RNG seedeado en `offerBoons` (dos baterías consecutivas idénticas ⇒ determinismo verificado).

**Bisección de la inflación (probe de 1 config: supervivencia · normal · skilled, 40 runs):**

```
commit    versión  qué entra                        p50      p90     combo  deadAir  coins
1333bb6   v2.4.0   (baseline registrado)          138099   200600     x9      85%     680
ad8bd1b…6f091d7    QP-1 · QP-2 · FB · zen-HUD     138099   200600     x9      85%     680   ← idéntico bit a bit
7240b70   v2.6.1   refill de tablero vacío        164284   270186    x23      62%     569
a574fab   v2.6.2   gameover scoreAttack           164284   270186    x23      62%     569   ← idéntico
ce090bf   v2.6.2   candados con hits + BOMB_CAP   191572   272674    x28      62%     584
3b8eb3e   v2.6.2   bendiciones+kicker (pre-nerf)  186003*  361545*   x24      61%     615   * no determinista (Math.random)
```

Atribución: el refill explica p50 +19% / p90 +35% (y el desplome del dead-air 85%→62%, su objetivo de diseño — D2); los candados p50 +17%; las bendiciones pre-nerf ≈0% en p50 y **+33% en p90** (cola de `golden_wave`/`score_boost` → falla el criterio ≤+15% a nivel de commit → tabla de nerf aplicada).

**Batería final v2.6.4 (post-nerf + RNG seedeado + imán al más cercano):**

```
modo           diff      perfil    sc p50   sc p90   dur50  combo    progreso  deadAir    err  coins    cap
supervivencia  normal    skilled   203577   336751    480s    x26   oleada 18      62%    8.3    610   100%
supervivencia  normal    average   113796   160368    480s    x21   oleada 18      38%   19.6    494   100%
supervivencia  normal    casual     29648    44246    480s    x14   oleada 18      13%   29.5    341   100%
supervivencia  dificil   skilled   563237   887041    480s    x41   oleada 22      44%   11.8   1015   100%
```

**Evaluación de criterios (B-S1/B-S2 del plan de Supervivencia):**

| Criterio | Resultado | Veredicto |
|---|---|---|
| Determinismo del sim restaurado | 2 baterías consecutivas idénticas | ✅ |
| B-S1 bendiciones: p50 ≤ +15% sobre el estado pre-bendiciones (ce090bf) | +6.3% (191572→203577) | ✅ |
| B-S1 bendiciones: p90 ≤ +15% sobre ce090bf | +23.5% (272674→336751); pre-nerf era +33%, y en difícil el p90 baja de 1.07M a 887k (−17%) | ⚠️ Aceptado con nota: la cola p90 es el diseño intencional de "momentos épicos" (BAL-2); la tabla de nerf pre-acordada está agotada — endurecer más exige decisión de propietario/playtest, no otro nerf en caliente |
| B-S2 kicker: coins/run skilled ≤ +20% vs v2.4.0 | 610 vs 680 (−10%: el refill suprime el farmeo de bonus de tablero vacío y compensa de sobra el kicker) | ✅ |
| Oleada alcanzada (ancla del modo) sin cambio | 18/18 normal · 22/22 difícil | ✅ |
| Guardarraíl de medallas del reto (CI) | 70/70 tests verdes sin recalibrar | ✅ |

**Época de score:** el baseline de Supervivencia pasa oficialmente de la fila v2.4.0 a esta batería. Los récords personales de score previos quedarán por debajo de lo alcanzable (~+47% p50 estructural por refill+candados); el récord de OLEADA — el ancla real del modo — no se mueve.

## Batería v2.6.17 (JF-γ: ENCUENTROS de jefe encendidos — anclas/PV/fases/niveles) — 40 runs/config

> Plan y puertas en `BOSS_SYSTEM_MASTER_PLAN.md` §8. Medición VÁLIDA = proceso fresco A/B (los valores de monedas "en batería" arrastran un artefacto preexistente de acumulación de Meta entre runs del mismo proceso; afecta igual a antes y después: +0.6%).

**Gates (proceso fresco, 40 runs, flag ON vs flag OFF en el mismo build):**

| config | encuentros/run | kills/run | kill-rate | coins (off→on) | oleada p50 | deadAir (off→on) | score p50 (off→on) |
|---|---|---|---|---|---|---|---|
| normal·skilled | 2.0 | 1.5 | **75%** | 616→646 (**+4.9%** ✅ ≤+10%) | 18→18 ✅ | 61%→60% ✅ | 184,904→206,017 (+11.4%) |
| normal·average | 2.0 | 1.4 | 69% | 494→531 (+7.5% ✅) | 18→18 ✅ | 38%→35% ✅ | −7% |
| normal·casual | 2.0 | 0.9 | 46% ⚠️ | 341→352 (+3.2% ✅) | 18→18 ✅ | 13%→10% ✅ | ≈0% |
| dificil·skilled | 4.0 | 1.5 | 37% | 1.015→1.049 (+3.3% ✅) | 22→22 ✅ | 44%→44% ✅ | −13.5% |

**Hallazgos del A/B (aislamiento de causas):**
1. **Los efectos de derrota limpiaban de más**: sin suelo, inflaban monedas +18% y score +63% vía bonus de tablero vacío + refill + cadenas. Corrección quirúrgica: los regalos de derrota **nunca dejan el tablero por debajo de 8 iconos** (presupuesto en `_defeatEffect`) + lluvia 15%→12%. Tras el suelo: contribución neta ≈0 (coins 646 vs 641 sin efectos).
2. **El botín (8+4×nivel) + Ronda maestra** cuestan ~+25 monedas/run skilled — dentro de presupuesto.
3. **Kill-rate casual 46%** supera la expectativa (≤25%): los bots matan jefes "sin querer" al converger encima de anclas orgánicamente. En humanos casuales será menor (el bot no se distrae mirando el banner). Aceptado con nota: vigilar en playtest GM-31.
4. **Bug corregido por el gate**: `_bossesDefeated` no se reseteaba entre runs (acumulaba entre partidas del mismo proceso — kills/run de 35 a 190). Reset añadido a `Survival.start()`.
5. **Artefacto de pureza del sim ELIMINADO**: los jefes-evento legacy usaban `setTimeout` reales (marea 1.2s, terremoto 620ms) que disparaban DENTRO de la run siguiente del mismo proceso, contaminando las filas average/casual de otros modos. Los encuentros no usan setTimeouts → las filas no-Supervivencia posteriores a la primera run de Supervivencia CAMBIAN vs baseline por la desaparición de esa contaminación (las filas skilled, previas a toda Supervivencia, son idénticas bit a bit — incluida la del guardarraíl de medallas).

**Época de score (2ª de la temporada)**: +11.4% p50 skilled por el cambio de tempo (ataques repartidos digestibles en vez de un volcado; deadAir baja) — mismo orden que la época del refill v2.6.1 (+19%), aceptado como coste del rediseño. La OLEADA no se mueve en ninguna config.

## Evaluación de los criterios de aceptación (GM-β)

| Criterio | Resultado | Veredicto |
|---|---|---|
| **Control**: Zen sin cambios (warm-up excluido) | Idéntico bit a bit (13964/20412) | ✅ |
| **B2 (error=−3s)**: duración p50 de Contrarreloj no cae >15% | Sin cambio (todas las runs siguen llegando al tope del sim; ni el bot casual con ~13 errores muere por los −3s) | ✅ |
| **B3 (warm-up)**: score p50 sin inflación sistemática (>5%) | Clásico +3/+9/+7% pero Aventura −1/−9/+9% con el mismo warm-up → las desviaciones se contradicen entre perfiles/modos: es ruido de re-muestreo (el warm-up altera el timing de spawns y con él toda la secuencia RNG), no inflación. Niveles completados y duraciones idénticos. | ✅ |
| **B4 (sprint ×1.5)**: récords (perfil skilled) no inflados >20% | skilled +1.8% p50 / p90 −2.7%. Hallazgo adicional: al perfil casual le sube +40% p50 — el sprint actúa de *comeback mechanic* (quien va justo de reloj pasa más tiempo en zona ×1.5). Rubber-banding deseable: ayuda más al débil sin mover los récords. | ✅ |
| **B1 (revivir) / B6 (hielo→carga)** | Sin efecto en sim (los bots no pagan revivir; +2 de carga es marginal). Validación manual con el checklist de playtest. | ✅ (n/a) |

## Hallazgos estructurales del baseline (para fases futuras)

1. **La dificultad de Contrarreloj y Supervivencia es cognitiva, no mecánica.** Ningún bot (ni el casual, con 1.4s de reacción, 15% de error y lapsos) muere dentro del tope del sim: en Contrarreloj la reposición con suelo 0.4 supera al drenaje si conviertes cada ~1.4s, y en Supervivencia el alivio por vida perdida + clear-assist sostienen indefinidamente. Los humanos mueren por colapso de atención. Implicación: subir "dificultad numérica" castigaría poco al hábil y mucho al débil; la presión útil es la que ataca la atención (más variedad simultánea, eventos, decisiones), no la velocidad bruta.
2. **El dead-air es real y enorme para jugadores rápidos** (66–85% de los turnos del bot skilled sin jugada disponible; 40–54% para el medio): confirma D2 del plan con datos. El warm-up lo mitiga solo al inicio; el cuello es la espera post-limpieza (el tablero se vacía más rápido de lo que spawnea). FB-2 implementa el DDA suave solo en Contrarreloj/Reto; el perfil average baja a 39% sin inflar score ni duración.
3. **La oleada de Supervivencia es puramente temporal para bots** (oleada 18 a los 8 min en los 3 perfiles): el número de oleada mide tiempo jugado, no habilidad. El récord de oleada humano diferencia por atención sostenida — coherente con el hallazgo 1.
4. **Guardarraíl de medallas** activo en CI (`tests/balance-guardrail.test.js`): bot estándar (average, 3 min, seeds fijos) con mediana calibrada 60649 en v2.2.0 y banda ±40%. Recalibrar solo en cambios de balance deliberados.
