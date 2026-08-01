/* Guardarraíl de balance (GAME_MODES_MASTER_PLAN §7.3).
 *
 * Las medallas del Reto del día (750/1500/2500) dependen de la fórmula de score
 * con dificultad normal: cualquier cambio de balance que mueva el score medio
 * cambia SILENCIOSAMENTE la dificultad de las medallas. Este test lo grita antes
 * que los usuarios: corre el bot estándar del simulador (determinista: reloj
 * virtual + RNG seedeado) y exige que su mediana quede en una banda de ±40%
 * respecto a la constante calibrada.
 *
 * Si este test falla tras un cambio de balance DELIBERADO: recalibrar la
 * constante en el mismo PR, revisar los umbrales de medalla si hace falta, y
 * documentarlo en GAME_MODES_MASTER_PLAN (registro) y MIGRATION_SPEC.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// El simulador carga game.js sobre el dom-stub con reloj virtual propio.
// node --test aísla cada archivo en su proceso: no interfiere con core.test.js.
const sim = require('../tools/balance-sim.js');

test('medallas del reto diario: umbrales verbatim (750/1500/2500)', () => {
  const M = sim.cv.Meta;
  assert.deepEqual(M.DAILY_MEDALS, [750, 1500, 2500]);
  assert.equal(M.dailyMedal(0), 'none');
  assert.equal(M.dailyMedal(749), 'none');
  assert.equal(M.dailyMedal(750), 'bronze');
  assert.equal(M.dailyMedal(1499), 'bronze');
  assert.equal(M.dailyMedal(1500), 'silver');
  assert.equal(M.dailyMedal(2499), 'silver');
  assert.equal(M.dailyMedal(2500), 'gold');
});

test('deriva de fórmula: bot estándar en Contrarreloj dentro de banda ±40%', () => {
  // Configuración FIJA — no cambiar sin recalibrar la constante.
  const r = sim.runBatch(
    { mode: 'contrarreloj', diff: 'normal', profile: 'average', maxMinutes: 3, seedBase: 20260707 },
    9,
  );
  // Calibrado en v2.37.0 tras las celdas calientes anti-respawn-instantáneo
  // (S1, docs/QA_PERF_PLAN.md B-10): el desplazamiento del stream de celdas mueve
  // cada partida seedeada a otra trayectoria; el efecto medio real es ≲5% (medido
  // con 101 runs por configuración: avg 27758 con fix vs 29226 sin, diff ≈ 1.1 SEM).
  // OJO: la constante anterior (52964, v2.4.0) llevaba ya un 37% de deriva
  // acumulada de merges previos (p50 real en esta base: 33420) — esta recalibración
  // también absorbe esa deuda. Historial: 60649 (v2.2.0) → 52964 (v2.4.0) → 29292.
  const BASELINE_P50 = 29292;
  assert.ok(
    r.score.p50 >= BASELINE_P50 * 0.6 && r.score.p50 <= BASELINE_P50 * 1.4,
    `score p50 del bot (${r.score.p50}) fuera de la banda [${Math.round(BASELINE_P50 * 0.6)}, ${Math.round(BASELINE_P50 * 1.4)}] — ` +
    'la fórmula de score o el pacing de Contrarreloj han derivado; si el cambio es deliberado, recalibra BASELINE_P50 y revisa los umbrales de medalla',
  );
});

test('CH-4/5: el simulador de cofres restaura estado y modela el booster garantizado de evento', () => {
  const stateBefore = JSON.stringify(sim.cv.Meta.state);
  const storedBefore = localStorage.getItem('cv_meta');
  const randomBefore = Math.random;
  const report = sim.runChestEconomy({ runs: 40, seed: 20260718, types: ['event'], levels: [1] });

  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].avgPrizes, 3);
  assert.equal(report.rows[0].ev.boosters, 1, 'cada cofre de evento real incluye su booster del snapshot');
  assert.equal(JSON.stringify(sim.cv.Meta.state), stateBefore);
  assert.equal(localStorage.getItem('cv_meta'), storedBefore);
  assert.equal(Math.random, randomBefore);
});
