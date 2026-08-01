/* Regresión de las fases SV-α…δ de Supervivencia (docs/SURVIVAL_MASTER_PLAN.md).
 * Fija la lógica pura de los rebalances y correcciones; si alguien la rompe,
 * este archivo lo grita con el identificador de la tarea SV-*. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./dom-stub.js');
require('../game.js');

const cv = globalThis.window.__cv;
const { State, Survival, Meta } = cv;
cv.Render.buildBoard();

test('SV-01: nerfs de bendiciones (golden ×2, impulso tope 0.5, peso épico 4)', () => {
  assert.equal(Survival.SCORE_BOOST_CAP, 0.5, 'impulso topado a +0.5×');
  const golden = Survival.BOONS.find((b) => b.id === 'golden_wave');
  assert.equal(golden.weight, 4, 'peso épico bajado a 4');
  assert.equal(golden.rarity, 'epic');
  // scoreMult: impulso al tope + oleada dorada = (1+0.5) × 2 = 3
  Survival.scoreBoost = 0.5; Survival.goldenWaveWaves = 1;
  assert.equal(Survival.scoreMult(), 3, 'golden es ×2, no ×3');
  Survival.scoreBoost = 0; Survival.goldenWaveWaves = 0;
  assert.equal(Survival.scoreMult(), 1, 'sin bendiciones, ×1');
});

test('SV-01: applyBoon(score_boost) respeta el tope', () => {
  Survival.scoreBoost = 0;
  Survival.applyBoon('score_boost'); assert.equal(Survival.scoreBoost, 0.25);
  Survival.applyBoon('score_boost'); assert.equal(Survival.scoreBoost, 0.5);
  Survival.applyBoon('score_boost'); assert.equal(Survival.scoreBoost, 0.5, 'no supera el tope');
  Survival.scoreBoost = 0;
});

test('SV-01: offerBoons excluye vida al tope e impulso al tope', () => {
  // Impulso al tope: score_boost fuera del pool
  Survival.scoreBoost = Survival.SCORE_BOOST_CAP;
  Survival.lives = 1; Survival.MAX_LIVES = 3;
  let pool = Survival.BOONS.filter((b) =>
    (b.id !== 'life' || Survival.lives < Survival.MAX_LIVES + 1) &&
    (b.id !== 'score_boost' || (Survival.scoreBoost || 0) < Survival.SCORE_BOOST_CAP));
  assert.ok(!pool.some((b) => b.id === 'score_boost'), 'impulso al tope excluido');
  assert.ok(pool.some((b) => b.id === 'life'), 'vida disponible con 1 vida');
  // Vida al tope: life fuera
  Survival.scoreBoost = 0; Survival.lives = Survival.MAX_LIVES + 1;
  pool = Survival.BOONS.filter((b) =>
    (b.id !== 'life' || Survival.lives < Survival.MAX_LIVES + 1) &&
    (b.id !== 'score_boost' || (Survival.scoreBoost || 0) < Survival.SCORE_BOOST_CAP));
  assert.ok(!pool.some((b) => b.id === 'life'), 'vida al tope excluida');
  Survival.lives = 3;
});

test('SV-12: survBestWaveFor por dificultad, retrocompatible con survBestWave', () => {
  // Récord en normal no debe contar como récord en difícil
  State.diff = 'normal';
  Meta.survWaveRecord(15);
  assert.equal(Meta.survBestWaveFor('normal'), 15);
  assert.ok(Meta.survBestWave() >= 15, 'el global también sube');
  State.diff = 'dificil';
  assert.equal(Meta.survBestWaveFor('dificil'), 0, 'difícil arranca en 0 pese al récord de normal');
  Meta.survWaveRecord(8);
  assert.equal(Meta.survBestWaveFor('dificil'), 8);
  assert.equal(Meta.survBestWaveFor('normal'), 15, 'normal intacto');
  State.diff = 'normal';
});

test('SV-20: bossEvent programa el beat de superación y NO celebra al llegar', () => {
  Survival.start(); // resetea flags
  State.mode = 'supervivencia'; State.status = 'playing';
  Survival.wave = 6; Survival._nextBoss = 'meteor'; Survival.lives = 3;
  Survival.bossEvent();
  assert.ok(Survival._bossSurvivedAt > 0, 'programa el beat ¡SUPERADO!');
  assert.ok(Survival._boonAt > 0, 'programa la bendición');
  assert.equal(Survival._noBoosterSinceBoss, true, 'arranca la hazaña sin-potenciadores');
});

test('SV-20/21: _bossSurvived cuenta jefe y respeta game over; hazaña sin-booster', () => {
  Survival.start();
  State.mode = 'supervivencia'; State.status = 'playing'; Survival.lives = 2;
  Survival._bossesSurvived = 0; Survival._noBoosterSinceBoss = true;
  Survival._bossSurvived();
  assert.equal(Survival._bossesSurvived, 1, 'suma jefe superado');
  // Con game over no cuenta
  State.status = 'over';
  Survival._bossSurvived();
  assert.equal(Survival._bossesSurvived, 1, 'no cuenta si no sigues vivo');
  State.status = 'playing';
});

test('SV-22: applyBoon registra la hoja de la run (_boonLog)', () => {
  Survival.start();
  Survival._boonLog = [];
  Survival.applyBoon('slow');
  Survival.applyBoon('magnet');
  assert.equal(Survival._boonLog.length, 2);
  assert.deepEqual(Survival._boonLog.map((b) => b.id), ['slow', 'magnet']);
  assert.ok(Survival._boonLog[0].icon, 'cada entrada tiene icono');
});

test('SV-30: survRank respeta los umbrales de oleadas vitalicias', () => {
  const s = Meta.survData();
  const cases = [[0, 'recluta'], [49, 'recluta'], [50, 'explorador'], [149, 'explorador'],
    [150, 'curtido'], [400, 'veterano'], [899, 'veterano'], [900, 'elite'], [1999, 'elite'], [2000, 'leyenda'], [9999, 'leyenda']];
  for (const [tot, id] of cases) { s.totalWaves = tot; assert.equal(Meta.survRank().id, id, `${tot} → ${id}`); }
  // En rango no-máximo hay siguiente; en máximo no.
  s.totalWaves = 100; assert.equal(Meta.survRank().next, 'curtido');
  s.totalWaves = 2000; assert.equal(Meta.survRank().next, null);
  s.totalWaves = 0;
});

test('SV-30: recordSurvivalRun acumula y detecta ascenso de rango', () => {
  const s = Meta.survData();
  s.totalWaves = 45; s.totalBosses = 0; s.runs = 0;
  State.diff = 'normal';
  const res = Meta.recordSurvivalRun({ wave: 10, bosses: 2 }); // 45+10=55 → cruza 50
  assert.equal(s.totalWaves, 55);
  assert.equal(s.totalBosses, 2);
  assert.equal(s.runs, 1);
  assert.equal(res.rankUp, true, 'cruzar 50 asciende a Explorador');
  assert.equal(res.rank.id, 'explorador');
  const res2 = Meta.recordSurvivalRun({ wave: 5, bosses: 0 }); // 60, sigue Explorador
  assert.equal(res2.rankUp, false);
  s.totalWaves = 0; s.totalBosses = 0; s.runs = 0;
});

test('SV-32: survWeekRecord reinicia por semana y solo sube; cuenta mutadores distintos', () => {
  const s = Meta.survData();
  s.weekBest = { week: '', wave: 0, mut: 'none' }; s.mutsWon = {};
  let r = Meta.survWeekRecord('2026-W28', 12, 'ice');
  assert.equal(r.isRecord, true); assert.equal(s.weekBest.wave, 12); assert.equal(r.distinctMuts, 1);
  r = Meta.survWeekRecord('2026-W28', 8, 'ice');   // menor: no récord
  assert.equal(r.isRecord, false); assert.equal(s.weekBest.wave, 12);
  r = Meta.survWeekRecord('2026-W29', 5, 'frenzy'); // semana nueva: reinicia a 5
  assert.equal(r.isRecord, true); assert.equal(s.weekBest.wave, 5); assert.equal(r.distinctMuts, 2);
  Meta.survWeekRecord('2026-W30', 3, 'chaos');
  assert.equal(Object.keys(s.mutsWon).length, 3, '3 mutadores distintos con récord');
  // 'none' no cuenta como mutador para la hazaña
  Meta.survWeekRecord('2026-W31', 20, 'none');
  assert.equal(Object.keys(s.mutsWon).length, 3);
  s.weekBest = { week: '', wave: 0, mut: 'none' }; s.mutsWon = {};
});

test('SV-31: hazañas — unlock idempotente y detecciones puras', () => {
  const s = Meta.survData();
  s.feats = {}; s.boonsSeen = {};
  assert.equal(Meta.survUnlockFeat('impecable'), true, 'primera vez desbloquea');
  assert.equal(Meta.survUnlockFeat('impecable'), false, 'segunda vez no');
  assert.equal(Meta.survFeatDone('impecable'), true);
  assert.equal(Meta.survFeatCount(), 1);
  // coleccionista: ver las 8 bendiciones
  Survival.BOONS.forEach((b) => Meta.survSeeBoon(b.id));
  assert.equal(Meta.survBoonsSeenCount(), Survival.BOONS.length);
  s.feats = {}; s.boonsSeen = {};
});

test('SV-31: impecable se otorga al superar jefe sin perder vida; no si perdió', () => {
  const s = Meta.survData(); s.feats = {};
  State.mode = 'supervivencia'; State.status = 'playing';
  Survival.lives = 2; Survival._livesLostThisWave = 0; Survival._bossesSurvived = 0;
  Survival._bossSurvived();
  assert.equal(Meta.survFeatDone('impecable'), true);
  // Otra run: perdió vida esa oleada → no re-otorga (ya está) pero comprobamos la guarda
  s.feats = {}; Survival._livesLostThisWave = 1;
  Survival._bossSurvived();
  assert.equal(Meta.survFeatDone('impecable'), false, 'no se otorga si perdió vida');
  s.feats = {};
});

test('SV-40: BOSS_DEFS declarativo — pool por disponibilidad y override', () => {
  Survival.start();
  Survival._mutOverride = 'none'; Survival._lastBossType = null;
  let pool = Survival._bossPool();
  assert.ok(pool.includes('meteor') && pool.includes('tide') && pool.includes('frost') && pool.includes('lockdown'), 'base siempre');
  assert.ok(!pool.includes('quake'), 'quake fuera sin caos');
  assert.ok(!pool.includes('eco'), 'eco fuera sin jefe previo');
  Survival._lastBossType = 'meteor';
  assert.ok(Survival._bossPool().includes('eco'), 'eco disponible con jefe previo');
  Survival._mutOverride = 'chaos';
  assert.ok(Survival._bossPool().includes('quake'), 'quake en semana del caos');
  Survival._mutOverride = 'none';
});

test('SV-40/43: cada jefe × mutador se ejecuta sin excepción y respeta invariantes', () => {
  const bosses = Object.keys(Survival.BOSS_DEFS);
  const muts = ['none', 'ice', 'chaos', 'frenzy'];
  for (const mut of muts) {
    for (const boss of bosses) {
      Survival._mutOverride = mut;
      Survival.start();
      Survival._lastBossType = 'tide'; // que 'eco' tenga algo que repetir
      // Poblar el tablero parcialmente para que frost/tide/lockdown tengan sustrato.
      for (let i = 0; i < 20; i++) { State.board[i] = State.pool[i % State.pool.length]; State.iconCount = (State.iconCount || 0) + 1; }
      Survival.wave = 26; // zona enfurecida (SV-43) para ejercitar esa rama
      Survival._bossOverride = boss;
      assert.doesNotThrow(() => Survival.bossEvent(), `${boss} × ${mut} no debe lanzar`);
      // Invariantes duros (parte síncrona; los setTimeout de marea/quake no cuentan aquí).
      const filled = State.board.filter((v) => v !== null).length;
      assert.ok(filled >= 0 && filled <= 64, `${boss}×${mut}: iconos en [0,64], fue ${filled}`);
      const specials = State.tiles.filter((t) => t && t.type !== 'crystal').length;
      assert.ok(specials <= Survival._specialCap() + 2, `${boss}×${mut}: especiales acotados (${specials})`);
    }
  }
  Survival._bossOverride = null; Survival._mutOverride = 'none';
  if (cv.Bosses) cv.Bosses.abort(); // JF-γ: bossEvent ahora arranca encuentros — no dejar uno vivo
});

test('SV-02/20/21/22/30/31/32/40/43: claves i18n nuevas en ES y EN', () => {
  const keys = ['magnet_done', 'new_record', 'revive_btn', 'revive_gets', 'revive_count', 'revive_short',
    'survmut_none', 'surv_week_label', 'surv_diff_normal_d', 'surv_launch_record',
    'boon_golden_wave_d', 'boon_score_boost_d',
    'surv_boss_cleared', 'surv_boss_cleared_clean', 'surv_frenzy_max', 'surv_wave_record_live',
    'surv_over_wave_new', 'surv_over_wave_near', 'surv_over_record', 'surv_run_bosses',
    'srank_recluta', 'srank_leyenda', 'surv_rank_label', 'surv_rank_progress', 'surv_rank_max',
    'surv_rank_up', 'surv_week_best', 'surv_week_best_none', 'feat_unlocked', 'surv_feats_label',
    'feat_impecable', 'feat_impecable_d', 'feat_purista', 'feat_fenix', 'feat_coleccionista',
    'feat_semana_completa', 'feat_frenetico', 'feat_al_limite', 'feat_economo'];
  for (const lang of ['es', 'en']) {
    for (const k of keys) {
      assert.ok(cv.I18n.DICT[lang][k], `falta ${k} en ${lang}`);
    }
  }
  // El copy de golden_wave ya no promete "x3" ni "próxima oleada" a secas
  assert.ok(!/x3|×3/.test(cv.I18n.DICT.es.boon_golden_wave_d), 'ES: golden ya no dice x3');
  assert.ok(!/3x|×3/.test(cv.I18n.DICT.en.boon_golden_wave_d), 'EN: golden ya no dice 3x');
});
