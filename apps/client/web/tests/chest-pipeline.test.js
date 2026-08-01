'use strict';

// CH-2 (docs/CHEST_SYSTEM_MASTER_PLAN.md §5): pipeline universal de cofres.
// Objetivos de cualquier modo avanzan un ciclo determinista; cofre diario de
// primera victoria; reto semanal → cofre de evento; pity calculable.

const test = require('node:test');
const assert = require('node:assert/strict');

require('./dom-stub.js');
require('../game.js');

const { Meta } = globalThis.window.__cv;

const today = () => new Date().toISOString().slice(0, 10);

function fullSnapshot() { return JSON.parse(JSON.stringify(Meta.state)); }
function restore(snap) {
  const m = Meta.state;
  for (const k of Object.keys(m)) delete m[k];
  Object.assign(m, snap);
}

// Deja el pipeline en un estado limpio y silencia el cofre diario (se prueba aparte).
function resetPipeline(m) {
  m.chests = 0; m.chestInventory = []; m.chestUnlock = null;
  m.chestPipeline = { wins: 0, cycle: 0 };
  m.dailyChest = { date: today() };
}

test('pipeline: cada 3 objetivos cae el siguiente cofre del ciclo, determinista', () => {
  const snap = fullSnapshot(), m = Meta.state;
  try {
    resetPipeline(m);
    assert.equal(Meta.recordChestProgress('clasico').chest, null);
    assert.equal(Meta.recordChestProgress('zen').chest, null);
    const third = Meta.recordChestProgress('aventura');
    assert.equal(third.chest, 'wood', 'primer cofre del ciclo');
    assert.equal(Meta.chests(), 1);
    assert.equal(Meta.chestInventory()[0].type, 'wood');
    assert.match(Meta.chestInventory()[0].source, /^pipeline:/);
    for (let i = 0; i < 2; i++) Meta.recordChestProgress('clasico');
    assert.equal(Meta.recordChestProgress('clasico').chest, 'bronze', 'segundo cofre del ciclo');
  } finally { restore(snap); }
});

test('pipeline: el primer objetivo del día crea un Choice Chest de bronce, solo una vez', () => {
  const snap = fullSnapshot(), m = Meta.state;
  try {
    resetPipeline(m);
    m.dailyChest = { date: '' };
    const first = Meta.recordChestProgress('clasico');
    assert.equal(first.daily, 'bronze');
    const daily = Meta.chestInventory().find((c) => c.source === 'daily-choice');
    assert.ok(daily && daily.choice);
    assert.equal(daily.choice.options.length, 3);
    const second = Meta.recordChestProgress('clasico');
    assert.equal(second.daily, null);
  } finally { restore(snap); }
});

test('pipeline: el pity es visible y decrece con el ciclo', () => {
  const snap = fullSnapshot(), m = Meta.state;
  try {
    resetPipeline(m);
    // champion está en el índice 23 → 24 cofres hasta el mítico garantizado.
    assert.equal(Meta.chestPipelineInfo().chestsToMythic, 24);
    assert.equal(Meta.chestPipelineInfo().nextType, 'wood');
    m.chestPipeline.cycle = 24; // tras champion: divine en el 31 → 8
    assert.equal(Meta.chestPipelineInfo().chestsToMythic, 8);
    m.chestPipeline.cycle = 23;
    assert.equal(Meta.chestPipelineInfo().chestsToMythic, 1);
    assert.equal(Meta.chestPipelineInfo().nextType, 'champion');
    // Autocuración si una migración vieja dejó el campo ausente.
    delete m.chestPipeline;
    assert.equal(Meta.chestPipelineInfo().wins, 0);
  } finally { restore(snap); }
});

test('pipeline: completar el reto semanal suelta el cofre de evento', () => {
  const snap = fullSnapshot(), m = Meta.state;
  try {
    resetPipeline(m);
    Meta.weeklyChallenge(); // fija la semana en curso
    m.weekly.id = 'w_games'; m.weekly.progress = 11; m.weekly.done = false;
    const r = Meta.recordGame({ score: 0, level: 1, maxCombo: 0, removed: 0, elapsed: 0, mode: 'clasico', perfect: false, daily: false });
    assert.equal(r.weeklyDone, true);
    assert.equal(r.weeklyChest, true);
    const event = Meta.chestInventory().find((c) => c.type === 'event' && /^event:weekly:/.test(c.source));
    assert.ok(event && event.event);
    assert.equal(event.event.challengeId, 'w_games');
  } finally { restore(snap); }
});

test('pipeline: Contrarreloj libre puntúa con ≥1000; el Reto diario no puntúa aquí', () => {
  const snap = fullSnapshot(), m = Meta.state;
  try {
    resetPipeline(m);
    const base = { level: 1, maxCombo: 0, removed: 0, elapsed: 0, perfect: false };
    const low = Meta.recordGame(Object.assign({ score: 500, mode: 'contrarreloj', daily: false }, base));
    assert.equal(low.pipeline, null);
    const ok = Meta.recordGame(Object.assign({ score: 1500, mode: 'contrarreloj', daily: false }, base));
    assert.ok(ok.pipeline && ok.pipeline.wins === 1);
    const dailyRun = Meta.recordGame(Object.assign({ score: 1500, mode: 'contrarreloj', daily: true }, base));
    assert.equal(dailyRun.pipeline, null);
  } finally { restore(snap); }
});

test('pipeline: la primera medalla del día en el Reto cuenta una sola vez', () => {
  const snap = fullSnapshot(), m = Meta.state;
  try {
    resetPipeline(m);
    m.dailyRun = { date: '', best: 0, plays: 0 };
    m.gems = 0;
    const noMedal = Meta.recordDailyRun(300); // por debajo del bronce (750)
    assert.equal(noMedal.pipeline, null);
    const medal = Meta.recordDailyRun(800);
    assert.ok(medal.pipeline && medal.pipeline.wins >= 1);
    const again = Meta.recordDailyRun(2600);
    assert.equal(again.pipeline, null, 'mismo día: sin doble punto');
  } finally { restore(snap); }
});

test('pipeline: una run de Supervivencia cuenta desde la oleada 5', () => {
  const snap = fullSnapshot(), m = Meta.state;
  try {
    resetPipeline(m);
    assert.equal(Meta.recordSurvivalRun({ wave: 4, bosses: 0 }).pipeline, null);
    const ok = Meta.recordSurvivalRun({ wave: 5, bosses: 0 });
    assert.ok(ok.pipeline && ok.pipeline.wins === 1);
  } finally { restore(snap); }
});

test('pipeline: la escalera de Supervivencia sigue intacta como bonus', () => {
  // La distribución por oleadas (10→wood … 90+→divine) no pasa por el pipeline.
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'game.js'), 'utf8');
  assert.match(src, /const ladder = \['wood', 'bronze', 'silver', 'gold', 'magic', 'royal', 'supreme', 'champion', 'divine'\]/);
  assert.match(src, /clearedWave \/ 10 - 1/);
});
