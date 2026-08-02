import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  COMBO_MULTIPLIERS,
  DIFFICULTY,
  FEVER_BOOST,
  FEVER_COMBO,
  MILESTONES,
  SPRINT_MULT,
  SPRINT_WINDOW,
  TIMED_CAP,
  TIMED_GAIN,
  TIMED_MISTAKE_S,
  TIMED_START,
  TIME_ATTACK_INITIAL_ICONS,
  TIME_ATTACK_MODE_MULT,
  applyMistakePenalty,
  applyTimeCapsule,
  applyTimeGain,
  CRYSTAL_POINTS,
  comboMultiplierFor,
  convergencePoints,
  emptyBoardBonusPoints,
  milestoneBonusFor,
  nextCombo,
  timeGainFor,
} from '../dist/index.js';

// El reloj virtual DEBE instalarse antes de cargar game.js: el motor lee
// performance.now() al medir la ventana de combo y el ritmo de spawn.
const VCLOCK = { t: 0 };
Object.defineProperty(globalThis, 'performance', {
  value: { now: () => VCLOCK.t },
  configurable: true,
  writable: true,
});

const require = createRequire(import.meta.url);
const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../apps/client/web',
);
require(path.join(webRoot, 'tests/dom-stub.js'));
require(path.join(webRoot, 'game.js'));

const cv = globalThis.window.__cv;
assert.ok(cv, 'game.js no expuso window.__cv');

cv.Render.buildBoard();
if (typeof cv.FX.init === 'function') cv.FX.init();
// FX y Sound son presentación pura: anularlos acelera y evita depender del DOM.
for (const key of Object.keys(cv.FX)) if (typeof cv.FX[key] === 'function') cv.FX[key] = () => {};
for (const key of Object.keys(cv.Sound)) if (typeof cv.Sound[key] === 'function') cv.Sound[key] = () => {};

const { Config, Game, State, Loop } = cv;

test('las constantes del núcleo no se han desviado del Config legacy', () => {
  assert.deepEqual(
    COMBO_MULTIPLIERS.map((pair) => [...pair]),
    Config.COMBO_MULTIPLIERS,
  );
  assert.deepEqual({ ...MILESTONES }, { ...Config.MILESTONES });
  assert.deepEqual({ ...TIMED_GAIN }, { ...Config.TIMED_GAIN });
  assert.equal(FEVER_COMBO, Config.FEVER_COMBO);
  assert.equal(FEVER_BOOST, Config.FEVER_BOOST);
  assert.equal(TIMED_START, Config.TIMED_START);
  assert.equal(TIMED_CAP, Config.TIMED_CAP);
  assert.equal(TIMED_MISTAKE_S, Config.TIMED_MISTAKE_S);
  assert.equal(SPRINT_WINDOW, Config.SPRINT_WINDOW);
  assert.equal(SPRINT_MULT, Config.SPRINT_MULT);
  assert.equal(TIME_ATTACK_MODE_MULT, Config.MODES.contrarreloj.mult);
  assert.equal(TIME_ATTACK_INITIAL_ICONS, Config.MODES.contrarreloj.initialIcons);

  for (const difficulty of ['facil', 'normal', 'dificil']) {
    assert.equal(DIFFICULTY[difficulty].comboWindow, Config.DIFFICULTY[difficulty].comboWindow);
    assert.equal(DIFFICULTY[difficulty].scoreMult, Config.DIFFICULTY[difficulty].scoreMult);
    assert.equal(DIFFICULTY[difficulty].initialIcons, Config.DIFFICULTY[difficulty].initialIcons);
  }
});

test('Contrarreloj no tiene niveles: el motor arranca y se mantiene en nivel 1', () => {
  Game.start('contrarreloj', 'normal', undefined, 12_345);
  assert.equal(State.level, 1);
  assert.equal(State.tempMult, 1, 'tempMult solo lo mueven Aventura y Supervivencia');
  assert.equal(State.timeLeft, TIMED_START);
});

/**
 * Juega una partida real de Contrarreloj y, en cada convergencia, compara lo que
 * hizo el motor con lo que predice el núcleo a partir del estado previo. Es la
 * comprobación que faltaba: sin ella el núcleo solo se validaba contra sí mismo.
 */
function playAndCompare(difficulty, seed, { forceMistakeEvery = 0 } = {}) {
  const samples = [];
  let mistakes = 0;

  VCLOCK.t = 0;
  Game.start('contrarreloj', difficulty, undefined, seed);

  const originalActivate = Game.activate.bind(Game);
  Game.activate = (index) => {
    const converging = cv.Engine.converging(index);
    const before = {
      score: State.score,
      timeLeft: State.timeLeft,
      elapsed: State.elapsed,
      combo: State.combo,
      comboAt: State.comboAt,
      fever: State.fever,
      now: performance.now(),
      removed: converging.length,
    };
    const emptyBoardsBefore = State.emptyBoards || 0;
    // Baldosas especiales de Contrarreloj: cristal (+50 pts) y cápsula (+5 s por
    // adyacencia). Hay que contarlas para poder predecir el toque completo.
    before.crystals = converging
      .filter((idx) => State.tiles[idx] && State.tiles[idx].type === 'crystal').length;
    const capsulesBefore = State.tiles
      .map((tile, idx) => (tile && tile.type === 'timecap' ? idx : -1))
      .filter((idx) => idx !== -1);
    originalActivate(index);
    const capsulesDetonated = capsulesBefore
      .filter((idx) => !State.tiles[idx] || State.tiles[idx].type !== 'timecap').length;
    if (before.removed < 2) { mistakes += 1; samples.push({ kind: 'mistake', before, after: { timeLeft: State.timeLeft } }); return; }
    samples.push({
      kind: 'convergence',
      before,
      after: {
        score: State.score,
        timeLeft: State.timeLeft,
        combo: State.combo,
        fever: State.fever,
        // El bono de tablero vacío se cobra dentro del mismo toque, así que
        // entra en este delta de puntuación y hay que predecirlo también.
        emptyBoardChain: (State.emptyBoards || 0) > emptyBoardsBefore ? State.emptyBoards : 0,
        capsulesDetonated,
      },
    });
  };

  const STEP = 50;
  let nextActAt = 220;
  let attempts = 0;
  while (VCLOCK.t < 180_000 && samples.length < 400) {
    VCLOCK.t += STEP;
    Loop.tick(VCLOCK.t);
    if (State.status !== 'playing') break;
    if (VCLOCK.t < nextActAt) continue;
    nextActAt += 220;
    attempts += 1;

    // Solo juega convergencias reales: tocar por tocar cuesta 3 s y agotaría el
    // reloj antes de reunir muestra. Los fallos se provocan a propósito.
    let played = -1;
    const wantsMistake = forceMistakeEvery > 0 && attempts % forceMistakeEvery === 0;
    for (let i = 0; i < State.board.length; i += 1) {
      if (State.board[i] !== null) continue;
      const converges = cv.Engine.converging(i).length >= 2;
      if (converges !== wantsMistake) { played = i; break; }
    }
    if (played === -1) continue;
    Game.activate(played);
  }

  Game.activate = originalActivate;
  return { samples, mistakes };
}

for (const difficulty of ['facil', 'normal', 'dificil']) {
  test(`paridad de puntuación y reloj en una partida real · ${difficulty}`, () => {
    const { samples } = playAndCompare(difficulty, 0xc0ffee);
    const convergences = samples.filter((sample) => sample.kind === 'convergence');
    assert.ok(convergences.length >= 20, `muestra insuficiente: ${convergences.length}`);

    for (const [index, sample] of convergences.entries()) {
      const { before, after } = sample;
      const window = DIFFICULTY[difficulty].comboWindow;
      const combo = nextCombo(before.combo, before.comboAt, before.now, window);
      const fever = before.fever || combo >= FEVER_COMBO;

      let expectedTimeLeft = applyTimeGain(
        before.timeLeft,
        timeGainFor(before.removed, combo, before.elapsed),
      );
      for (let n = 0; n < after.capsulesDetonated; n += 1) {
        expectedTimeLeft = applyTimeCapsule(expectedTimeLeft);
      }
      const expectedPoints = before.crystals * CRYSTAL_POINTS + convergencePoints({
        removed: before.removed,
        combo,
        difficulty,
        timeLeftSeconds: before.timeLeft,
        fever,
      })
        + milestoneBonusFor(combo)
        + (after.emptyBoardChain > 0
          ? emptyBoardBonusPoints({
            chain: after.emptyBoardChain,
            combo,
            difficulty,
            timeLeftSeconds: expectedTimeLeft,
            fever,
          })
          : 0);

      assert.equal(
        after.score - before.score,
        expectedPoints,
        `convergencia #${index}: puntos (removed=${before.removed}, combo=${combo}, fever=${fever})`,
      );
      assert.equal(after.combo, combo, `convergencia #${index}: combo`);
      assert.equal(after.fever, fever, `convergencia #${index}: fiebre`);

      assert.ok(
        Math.abs(after.timeLeft - expectedTimeLeft) < 1e-9,
        `convergencia #${index}: reloj esperado ${expectedTimeLeft}, real ${after.timeLeft}`,
      );
    }
  });
}

test('paridad de la penalización por fallo', () => {
  const { samples } = playAndCompare('normal', 0x5eed, { forceMistakeEvery: 6 });
  const failures = samples.filter((sample) => sample.kind === 'mistake');
  assert.ok(failures.length >= 3, `muestra insuficiente de fallos: ${failures.length}`);
  for (const [index, sample] of failures.entries()) {
    assert.equal(
      sample.after.timeLeft,
      applyMistakePenalty(sample.before.timeLeft),
      `fallo #${index}: el error debe costar ${TIMED_MISTAKE_S}s`,
    );
  }
});

test('la tabla de multiplicadores coincide tramo a tramo con el motor', () => {
  for (let combo = 0; combo <= 35; combo += 1) {
    let expected = 1;
    for (const [threshold, multiplier] of Config.COMBO_MULTIPLIERS) {
      if (combo >= threshold) { expected = multiplier; break; }
    }
    assert.equal(comboMultiplierFor(combo), expected, `combo ${combo}`);
  }
});
