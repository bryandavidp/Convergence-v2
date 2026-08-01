/* Tests de la Fase B: PRNG seedeable, guardado de partida (RunSave) y
 * sumideros de economía (cofre premium con gemas, reroll de misión con tickets). */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./dom-stub.js');
require('../game.js');

const cv = globalThis.window.__cv;
const { State, Engine, Config, Meta, RNG, RunSave } = cv;

const SIZE = Config.SIZE;
function freshBoard() {
  State.size = SIZE;
  State.board = new Array(SIZE * SIZE).fill(null);
  State.tiles = new Array(SIZE * SIZE).fill(null);
  State.iconCount = 0;
}

/* ================= PRNG seedeable ================= */

test('RNG: misma semilla numérica → misma secuencia', () => {
  RNG.seed(12345);
  const a = [RNG.random(), RNG.random(), RNG.random(), RNG.random()];
  RNG.seed(12345);
  const b = [RNG.random(), RNG.random(), RNG.random(), RNG.random()];
  assert.deepEqual(a, b);
});

test('RNG: semillas distintas → secuencias distintas', () => {
  RNG.seed(1); const a = RNG.random();
  RNG.seed(2); const b = RNG.random();
  assert.notEqual(a, b);
});

test('RNG: acepta semilla string (hash interno) y es reproducible', () => {
  RNG.seed('2026-07-05');
  const a = RNG.random();
  RNG.seed('2026-07-05');
  assert.equal(RNG.random(), a);
});

test('RNG: valores en [0,1) y distribución no degenerada', () => {
  RNG.seed(99);
  const vals = Array.from({ length: 1000 }, () => RNG.random());
  assert.ok(vals.every((v) => v >= 0 && v < 1));
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  assert.ok(mean > 0.4 && mean < 0.6, `media sospechosa: ${mean}`);
});

test('RNG: el spawn del tablero es reproducible con la misma semilla', () => {
  State.pool = Engine.poolForLevel(5);
  const run = () => {
    freshBoard();
    RNG.seed('replay-test');
    const seq = [];
    for (let k = 0; k < 20; k++) { const idx = Engine.spawnOne(); seq.push(idx + ':' + State.board[idx]); }
    return seq.join('|');
  };
  assert.equal(run(), run(), 'dos partidas con la misma semilla deben generar los mismos spawns');
});

/* ================= RunSave (guardado de partida) ================= */

function playingState() {
  freshBoard();
  State.mode = 'clasico'; State.diff = 'normal'; State.status = 'playing';
  State.level = 7; State.seed = 4242; State.world = 'bosque'; State.worldLevel = 7;
  State.score = 1234; State.iconCount = 2; State.spawnRate = 3100;
  State.elapsed = 55; State.timeLeft = 0; State.hintsLeft = 2; State.mistakes = 1;
  State.maxCombo = 6; State.removedTotal = 40; State.emptyBoards = 1; State.coinsRun = 12;
  State.board[3] = 'circle_red'; State.board[9] = 'circle_red';
  State.tiles[5] = { type: 'rock', solid: true, hits: 2 };
}

test('RunSave: guarda y recupera un snapshot fiel de la partida', () => {
  playingState();
  RunSave.save();
  const s = RunSave.load();
  assert.ok(s, 'debe existir snapshot');
  assert.equal(s.mode, 'clasico');
  assert.equal(s.level, 7);
  assert.equal(s.seed, 4242);
  assert.equal(s.score, 1234);
  assert.equal(s.worldLevel, 7);
  assert.equal(s.board[3], 'circle_red');
  assert.deepEqual(s.tiles[5], { type: 'rock', solid: true, hits: 2 });
  assert.equal(s.hintsLeft, 2);
});

test('RunSave: guardar con la partida terminada LIMPIA el snapshot', () => {
  playingState();
  RunSave.save();
  assert.ok(RunSave.load());
  State.status = 'over';
  RunSave.save();
  assert.equal(RunSave.load(), null, 'un estado no jugable debe borrar el guardado');
});

test('RunSave: excluye supervivencia y tutorial', () => {
  playingState();
  State.mode = 'supervivencia';
  RunSave.save();
  assert.equal(RunSave.load(), null);
  playingState();
  State.mode = 'tutorial';
  RunSave.save();
  assert.equal(RunSave.load(), null);
});

test('RunSave: rechaza snapshots corruptos', () => {
  localStorage.setItem(RunSave.KEY, '{"v":99,"mode":"clasico"}');
  assert.equal(RunSave.load(), null);
  localStorage.setItem(RunSave.KEY, 'no-json{{{');
  assert.equal(RunSave.load(), null);
  RunSave.clear();
});

/* ================= Sumideros de economía ================= */

test('openPremiumChest: sin gemas suficientes → null y sin cambios', () => {
  const gems0 = Meta.gems();
  // vacía gemas si las hubiera
  if (gems0 > 0) Meta.spendGems(gems0);
  const coins0 = Meta.coins(), tickets0 = Meta.tickets();
  assert.equal(Meta.openPremiumChest(), null);
  assert.equal(Meta.coins(), coins0);
  assert.equal(Meta.tickets(), tickets0);
});

test('openPremiumChest: cobra las gemas y aplica su ceremonia completa', () => {
  const prevRandom = Math.random;
  let randIdx = 0;
  const seq = [0.10, 0];
  Math.random = () => seq[Math.min(randIdx++, seq.length - 1)];
  Meta.addGems(Meta.PREMIUM_CHEST_GEMS);
  const gems0 = Meta.gems(), coins0 = Meta.coins(), tickets0 = Meta.tickets();
  const r = Meta.openPremiumChest();
  assert.ok(r, 'con gemas debe entregar recompensa');
  assert.equal(Meta.gems(), gems0 - Meta.PREMIUM_CHEST_GEMS);
  assert.ok(['coins', 'ticket'].includes(r.kind), 'la tirada principal premium nunca devuelve gemas');
  assert.equal(r.items.length, 3);
  if (r.kind === 'coins') {
    assert.ok(r.amount >= 200 && r.amount <= 999, `monedas fuera de rango: ${r.amount}`);
    const totalCoins = r.items.filter((item) => item.kind === 'coins').reduce((sum, item) => sum + item.amount, 0);
    assert.equal(Meta.coins(), coins0 + totalCoins);
  } else {
    assert.equal(r.amount, 2);
    const totalTickets = r.items.filter((item) => item.kind === 'ticket').reduce((sum, item) => sum + item.amount, 0);
    assert.equal(Meta.tickets(), tickets0 + totalTickets);
  }
  Math.random = prevRandom;
});

test('rerollDaily: cambia la misión, gasta 1 ticket y resetea el progreso', () => {
  const before = Meta.dailyMission();
  Meta.addTickets(1);
  const t0 = Meta.tickets();
  const next = Meta.rerollDaily();
  assert.ok(next, 'con ticket y misión pendiente debe rerollear');
  assert.notEqual(next.id, before.id, 'la misión debe ser distinta');
  assert.equal(next.progress, 0);
  assert.equal(Meta.tickets(), t0 - 1);
  // La misión activa persistida es la nueva
  assert.equal(Meta.dailyMission().id, next.id);
});

test('rerollDaily: sin tickets → null y sin cambios', () => {
  const t = Meta.tickets();
  if (t > 0) Meta.spendTicket(t);
  const cur = Meta.dailyMission();
  assert.equal(Meta.rerollDaily(), null);
  assert.equal(Meta.dailyMission().id, cur.id);
});

/* ================= Reto del día ================= */

test('recordDailyRun: primer intento del día premia gemas y fija la marca', () => {
  // fuerza estado "sin jugar hoy"
  Meta.state.dailyRun = { date: '', best: 0, plays: 0 };
  const gems0 = Meta.gems();
  const r1 = Meta.recordDailyRun(800);
  assert.equal(r1.firstToday, true);
  assert.equal(r1.newBest, true);
  assert.equal(r1.best, 800);
  assert.equal(Meta.gems(), gems0 + Meta.DAILY_FIRST_GEMS);
  // segundo intento peor: sin gemas extra, la marca no baja
  const r2 = Meta.recordDailyRun(500);
  assert.equal(r2.firstToday, false);
  assert.equal(r2.newBest, false);
  assert.equal(r2.best, 800);
  assert.equal(Meta.gems(), gems0 + Meta.DAILY_FIRST_GEMS);
  // tercer intento mejor: nueva marca
  const r3 = Meta.recordDailyRun(950);
  assert.equal(r3.newBest, true);
  assert.equal(Meta.dailyRunInfo().best, 950);
  assert.equal(Meta.dailyRunInfo().plays, 3);
});

/* ================= Semilla compartida (?challenge=) ================= */

test('la semilla numérica en forma de string produce el mismo tablero (normalización URL)', () => {
  State.pool = Engine.poolForLevel(1);
  const runWith = (seed) => {
    freshBoard();
    // replica la normalización de Game.start sin tocar el DOM
    if (typeof seed === 'string' && /^\d+$/.test(seed)) seed = +seed;
    RNG.seed(seed);
    const seq = [];
    for (let k = 0; k < 12; k++) { const idx = Engine.spawnOne(); seq.push(idx + ':' + State.board[idx]); }
    return seq.join('|');
  };
  assert.equal(runWith(987654), runWith('987654'),
    'la semilla que viaja por la URL como string debe reproducir el tablero del retador');
});
