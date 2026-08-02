'use strict';

// Enrutar la puntuación por el núcleo no puede cambiar ni un punto. Aquí se juega
// la MISMA partida seedeada dos veces —con el núcleo cargado y sin él, es decir
// con la expresión histórica— y se exige que el resultado sea idéntico.
//
// Es la comprobación que cubre el riesgo real de este cambio: los tests de
// paridad validan las fórmulas por separado, pero solo esto demuestra que el
// juego completo se comporta igual.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// El reloj virtual debe instalarse antes de cargar game.js.
const VCLOCK = { t: 0 };
Object.defineProperty(globalThis, 'performance', {
  value: { now: () => VCLOCK.t },
  configurable: true,
  writable: true,
});

require('./dom-stub.js');
require('../game.js');

const cv = globalThis.window.__cv;
cv.Render.buildBoard();
if (typeof cv.FX.init === 'function') cv.FX.init();
for (const key of Object.keys(cv.FX)) if (typeof cv.FX[key] === 'function') cv.FX[key] = () => {};
for (const key of Object.keys(cv.Sound)) if (typeof cv.Sound[key] === 'function') cv.Sound[key] = () => {};
for (let chapter = 0; chapter < 120; chapter += 1) cv.Meta.markAdvChapterSeen(chapter);
cv.Survival._mutOverride = 'none';

const { Game, State, Loop } = cv;

// El núcleo real, no un espía: es el que se sirve al navegador.
require(path.join(__dirname, '..', 'game-core.js'));
const realCore = globalThis.window.ConvergenceGameCore;
assert.ok(realCore, 'game-core.js debe publicar window.ConvergenceGameCore');
assert.equal(typeof realCore.convergencePoints, 'function');

/** Bot determinista: siempre la primera celda que converge. */
function playRun(mode, difficulty, seed) {
  // Aventura reanuda en el nivel más lejano alcanzado, y ese progreso persiste
  // entre partidas del mismo proceso. Sin resetearlo, la segunda run arrancaría
  // en otro nivel y la comparación mediría contaminación, no el enrutado.
  if (mode === 'aventura') {
    cv.Meta.state.adventure.maxLevel = 1;
    if (typeof cv.Adventure.resetRun === 'function') cv.Adventure.resetRun();
  }

  VCLOCK.t = 0;
  Game.start(mode, difficulty, undefined, seed);

  let nextActAt = 220;
  let taps = 0;
  while (VCLOCK.t < 90_000) {
    VCLOCK.t += 50;
    Loop.tick(VCLOCK.t);
    if (State.status === 'levelComplete') { Game.nextLevel(); continue; }
    if (State.status === 'paused') {
      const pending = cv.Picker && cv.Picker.pending;
      if (!pending) break;
      if (pending.onCancel) cv.Picker.cancel();
      else if (pending.options && pending.options.length) cv.Picker.pick(pending.options[0].id);
      else cv.Picker.cancel();
      continue;
    }
    if (State.status !== 'playing') break;
    if (VCLOCK.t < nextActAt) continue;
    nextActAt += 220;

    let played = -1;
    for (let i = 0; i < State.board.length; i += 1) {
      if (State.board[i] === null && cv.Engine.converging(i).length >= 2) { played = i; break; }
    }
    // Cada 11 intentos se falla a propósito, para ejercitar la penalización.
    if (played === -1 || taps % 11 === 10) {
      for (let i = 0; i < State.board.length; i += 1) {
        if (State.board[i] === null && cv.Engine.converging(i).length < 2) { played = i; break; }
      }
    }
    if (played === -1) continue;
    taps += 1;
    Game.activate(played);
  }

  return {
    score: State.score,
    maxCombo: State.maxCombo,
    removedTotal: State.removedTotal,
    mistakes: State.mistakes,
    level: State.level,
    taps,
  };
}

const MODES = ['tutorial', 'clasico', 'aventura', 'contrarreloj', 'supervivencia', 'zen'];

for (const mode of MODES) {
  for (const difficulty of ['facil', 'normal', 'dificil']) {
    test(`la partida es idéntica con y sin núcleo · ${mode} · ${difficulty}`, () => {
      const seed = 0xc0ffee;

      globalThis.window.ConvergenceGameCore = realCore;
      const withCore = playRun(mode, difficulty, seed);

      delete globalThis.window.ConvergenceGameCore;
      const withoutCore = playRun(mode, difficulty, seed);

      globalThis.window.ConvergenceGameCore = realCore;

      assert.ok(withCore.taps > 5, `${mode}: la partida debe jugarse de verdad`);
      assert.deepEqual(
        withCore,
        withoutCore,
        `${mode}/${difficulty}: enrutar por el núcleo cambió el resultado`,
      );
    });
  }
}

test('el núcleo real expone todo lo que game.js le pide', () => {
  for (const name of [
    'convergencePoints', 'emptyBoardBonusPoints', 'iconPenaltyCount',
    'penalizedSpawnRate', 'areaClearPoints', 'timeGainFor', 'applyTimeGain',
    'applyMistakePenalty',
  ]) {
    assert.equal(typeof realCore[name], 'function', `falta ${name}`);
  }
  assert.equal(realCore.PERFECT_BOARD_BONUS, 500);
});
