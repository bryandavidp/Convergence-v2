import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CRYSTAL_POINTS,
  DIFFICULTY,
  FEVER_COMBO,
  MODE_MULTIPLIERS,
  ZEN_LEVEL,
  ZEN_MODE_MULT,
  ZEN_SOFT_CLEAR_FRACTION,
  milestoneBonusFor,
  nextCombo,
  zenConvergencePoints,
  zenEmptyBoardBonus,
  zenMistakeCost,
} from '../dist/index.js';

// El reloj virtual DEBE instalarse antes de cargar game.js.
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
for (const key of Object.keys(cv.FX)) if (typeof cv.FX[key] === 'function') cv.FX[key] = () => {};
for (const key of Object.keys(cv.Sound)) if (typeof cv.Sound[key] === 'function') cv.Sound[key] = () => {};

const { Config, Game, State, Loop } = cv;

test('las constantes de Zen no se han desviado del Config legacy', () => {
  const zen = Config.MODES.zen;
  assert.equal(ZEN_MODE_MULT, zen.mult);
  assert.equal(MODE_MULTIPLIERS.zen, zen.mult);
  assert.equal(zen.noFever, true, 'Zen no puede entrar en Fiebre');
  assert.equal(zen.penalties, false, 'Zen no penaliza los fallos');
  assert.equal(zen.endless, true, 'Zen es endless: cobra bono de tablero vacío');
  assert.equal(zen.timed, false);
});

test('el multiplicador de cada modo coincide con el motor, no solo el de Zen', () => {
  for (const [mode, multiplier] of Object.entries(MODE_MULTIPLIERS)) {
    assert.equal(
      multiplier,
      Config.MODES[mode].mult,
      `el multiplicador de ${mode} se desvió del motor`,
    );
  }
});

test('Zen arranca sin niveles, sin reloj y sin fiebre posible', () => {
  Game.start('zen', 'normal', undefined, 777);
  assert.equal(State.level, ZEN_LEVEL);
  assert.equal(State.fever, false);
  assert.equal(Game.feverNeed(), Infinity, 'el umbral de fiebre debe ser inalcanzable');
  assert.equal(zenMistakeCost(), 0);
});

/**
 * Juega una partida real de Zen y compara toque a toque contra el núcleo. Zen no
 * tiene reloj, así que la única magnitud que comparar es la puntuación, pero
 * incluye combo, hitos, cristales y bono de tablero vacío.
 */
function playZen(difficulty, seed) {
  const samples = [];

  VCLOCK.t = 0;
  Game.start('zen', difficulty, undefined, seed);

  const originalActivate = Game.activate.bind(Game);
  Game.activate = (index) => {
    const converging = cv.Engine.converging(index);
    const before = {
      score: State.score,
      combo: State.combo,
      comboAt: State.comboAt,
      fever: State.fever,
      now: performance.now(),
      removed: converging.length,
      crystals: converging
        .filter((idx) => State.tiles[idx] && State.tiles[idx].type === 'crystal').length,
    };
    const emptyBoardsBefore = State.emptyBoards || 0;
    originalActivate(index);
    if (before.removed < 2) {
      samples.push({ kind: 'mistake', before, after: { score: State.score } });
      return;
    }
    samples.push({
      kind: 'convergence',
      before,
      after: {
        score: State.score,
        combo: State.combo,
        fever: State.fever,
        emptyBoardChain: (State.emptyBoards || 0) > emptyBoardsBefore ? State.emptyBoards : 0,
      },
    });
  };

  let nextActAt = 220;
  let attempts = 0;
  while (VCLOCK.t < 180_000 && samples.length < 400) {
    VCLOCK.t += 50;
    Loop.tick(VCLOCK.t);
    if (State.status !== 'playing') break;
    if (VCLOCK.t < nextActAt) continue;
    nextActAt += 220;
    attempts += 1;

    // Cada 9 intentos se falla a propósito: en Zen no debe costar nada.
    const wantsMistake = attempts % 9 === 0;
    let played = -1;
    for (let i = 0; i < State.board.length; i += 1) {
      if (State.board[i] !== null) continue;
      const converges = cv.Engine.converging(i).length >= 2;
      if (converges !== wantsMistake) { played = i; break; }
    }
    if (played === -1) continue;
    Game.activate(played);
  }

  Game.activate = originalActivate;
  return samples;
}

for (const difficulty of ['facil', 'normal', 'dificil']) {
  test(`paridad de puntuación en una partida real de Zen · ${difficulty}`, () => {
    const samples = playZen(difficulty, 0xc0ffee);
    const convergences = samples.filter((sample) => sample.kind === 'convergence');
    assert.ok(convergences.length >= 20, `muestra insuficiente: ${convergences.length}`);

    for (const [index, sample] of convergences.entries()) {
      const { before, after } = sample;
      const combo = nextCombo(
        before.combo,
        before.comboAt,
        before.now,
        DIFFICULTY[difficulty].comboWindow,
      );

      assert.equal(after.fever, false, `convergencia #${index}: Zen nunca entra en Fiebre`);

      const expected = before.crystals * CRYSTAL_POINTS
        + zenConvergencePoints({ removed: before.removed, combo, difficulty })
        + milestoneBonusFor(combo)
        + (after.emptyBoardChain > 0
          ? zenEmptyBoardBonus({ chain: after.emptyBoardChain, combo, difficulty })
          : 0);

      assert.equal(
        after.score - before.score,
        expected,
        `convergencia #${index}: puntos (removed=${before.removed}, combo=${combo})`,
      );
      assert.equal(after.combo, combo, `convergencia #${index}: combo`);
    }
  });
}

test('un fallo en Zen no resta puntos ni termina la partida', () => {
  const samples = playZen('normal', 0x5a3e);
  const failures = samples.filter((sample) => sample.kind === 'mistake');
  assert.ok(failures.length >= 3, `muestra insuficiente de fallos: ${failures.length}`);
  for (const [index, sample] of failures.entries()) {
    assert.equal(
      sample.after.score,
      sample.before.score,
      `fallo #${index}: en Zen fallar no puede costar puntos`,
    );
  }
});

test('un combo alto en Zen no dispara la Fiebre aunque supere el umbral', () => {
  const samples = playZen('facil', 0x9f1);
  const highCombo = samples.filter(
    (sample) => sample.kind === 'convergence' && sample.after.combo >= FEVER_COMBO,
  );
  for (const sample of highCombo) {
    assert.equal(sample.after.fever, false);
  }
  assert.equal(ZEN_SOFT_CLEAR_FRACTION, 0.45);
});
