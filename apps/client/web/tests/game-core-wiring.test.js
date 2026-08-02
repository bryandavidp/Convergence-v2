'use strict';

// Contrarreloj puntúa con `packages/game-core`, el mismo módulo que reejecuta el
// backend. Aquí se cubre el cableado: que el núcleo llegue al navegador, que
// game.js lo use de verdad cuando está presente y que siga jugándose si falta.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('./dom-stub.js');
require('../game.js');

const cv = globalThis.window.__cv;
const { Config, Game, State } = cv;

// init() no corre en Node (DOMContentLoaded nunca dispara): hay que construir el
// tablero a mano y anular FX/Sound, que son presentación pura.
cv.Render.buildBoard();
if (typeof cv.FX.init === 'function') cv.FX.init();
for (const key of Object.keys(cv.FX)) if (typeof cv.FX[key] === 'function') cv.FX[key] = () => {};
for (const key of Object.keys(cv.Sound)) if (typeof cv.Sound[key] === 'function') cv.Sound[key] = () => {};
const webRoot = path.join(__dirname, '..');
const gameJs = fs.readFileSync(path.join(webRoot, 'game.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const swJs = fs.readFileSync(path.join(webRoot, 'sw.js'), 'utf8');
const bridgeJs = fs.readFileSync(path.join(webRoot, 'native-bridge.js'), 'utf8');
const coreJs = fs.readFileSync(path.join(webRoot, 'game-core.js'), 'utf8');

test('el núcleo se declara, se cachea y se carga antes que game.js', () => {
  assert.match(indexHtml, /name="convergence-core-script" content="game-core\.js\?v=/);
  assert.match(swJs, /'\.\/game-core\.js\?v=/, 'el Service Worker debe cachear el núcleo');

  // El orden importa: game.js consulta window.ConvergenceGameCore al puntuar.
  const coreAt = bridgeJs.indexOf("'convergence-core-script'");
  const legacyAt = bridgeJs.indexOf("'convergence-legacy-script'");
  assert.ok(coreAt !== -1 && legacyAt !== -1, 'el bridge debe leer ambos <meta>');
  assert.ok(coreAt < legacyAt, 'el núcleo se inserta antes que el runtime legacy');
  assert.match(bridgeJs, /script\.async = false/, 'sin async=false no hay orden garantizado');
});

test('el bridge toma la versión del <meta> y no de una constante que se queda vieja', () => {
  const meta = indexHtml.match(/name="convergence-legacy-script" content="(game\.js\?v=[^"]+)"/);
  assert.ok(meta, 'index.html debe declarar el script legacy');
  assert.match(bridgeJs, /scriptSrcFromMeta\('convergence-legacy-script'/);

  // El respaldo del bridge no puede quedarse atrás del <meta>: fue el bug que
  // dejó a los usuarios cargando game.js?v=2.37.1 con el resto ya en 2.37.2.
  const fallback = bridgeJs.match(/const LEGACY_SCRIPT = '(game\.js\?v=[^']+)'/);
  assert.ok(fallback, 'el bridge debe conservar un respaldo');
  assert.equal(fallback[1], meta[1], 'respaldo y <meta> deben ir a la misma versión');
});

test('el núcleo generado expone todo lo que game.js le pide', () => {
  const used = [...gameJs.matchAll(/GameCore\.core\.([A-Za-z0-9_]+)\(/g)].map((m) => m[1]);
  assert.ok(used.length >= 4, 'game.js debe consumir el núcleo en varios puntos');
  for (const name of new Set(used)) {
    assert.match(
      coreJs,
      new RegExp(`exports\\.${name} =`),
      `game-core.js no exporta ${name}: regenera con npm run build:core:browser`,
    );
  }
});

/** Núcleo espía: devuelve valores imposibles para que su uso sea inconfundible. */
function installSpyCore() {
  const calls = [];
  globalThis.window.ConvergenceGameCore = {
    PERFECT_BOARD_BONUS: 321,
    convergencePoints(input) { calls.push(['convergencePoints', input]); return 777; },
    emptyBoardBonusPoints(input) { calls.push(['emptyBoardBonusPoints', input]); return 999; },
    iconPenaltyCount() { calls.push(['iconPenaltyCount']); return 4; },
    penalizedSpawnRate() { calls.push(['penalizedSpawnRate']); return 1234; },
    areaClearPoints() { calls.push(['areaClearPoints']); return 66; },
    timeGainFor() { calls.push(['timeGainFor']); return 0; },
    applyTimeGain() { calls.push(['applyTimeGain']); return 42; },
    applyMistakePenalty() { calls.push(['applyMistakePenalty']); return 11; },
  };
  return calls;
}

function firstConvergingCell() {
  for (let i = 0; i < State.board.length; i++) {
    if (State.board[i] === null && cv.Engine.converging(i).length >= 2) return i;
  }
  return -1;
}

function firstNonConvergingCell() {
  for (let i = 0; i < State.board.length; i++) {
    if (State.board[i] === null && cv.Engine.converging(i).length < 2) return i;
  }
  return -1;
}

test('Contrarreloj puntúa y ajusta el reloj a través del núcleo', () => {
  const calls = installSpyCore();
  try {
    Game.start('contrarreloj', 'normal', undefined, 4242);
    const cell = firstConvergingCell();
    assert.notEqual(cell, -1, 'el tablero inicial debe ofrecer una convergencia');

    const scoreBefore = State.score;
    Game.activate(cell);

    assert.equal(State.score - scoreBefore, 777, 'los puntos salen del núcleo');
    assert.equal(State.timeLeft, 42, 'el reloj sale del núcleo');
    const names = calls.map((call) => call[0]);
    assert.ok(names.includes('convergencePoints'));
    assert.ok(names.includes('applyTimeGain'));

    const input = calls.find((call) => call[0] === 'convergencePoints')[1];
    assert.equal(input.difficulty, 'normal');
    assert.equal(input.mode, 'contrarreloj');
    assert.equal(typeof input.removed, 'number');
    assert.equal(typeof input.level, 'number');
    assert.equal(typeof input.feverBoost, 'number');
  } finally {
    delete globalThis.window.ConvergenceGameCore;
  }
});

test('el fallo en Contrarreloj descuenta tiempo a través del núcleo', () => {
  const calls = installSpyCore();
  try {
    Game.start('contrarreloj', 'normal', undefined, 4242);
    const cell = firstNonConvergingCell();
    assert.notEqual(cell, -1);

    Game.activate(cell);

    assert.ok(calls.some((call) => call[0] === 'applyMistakePenalty'));
    assert.equal(State.timeLeft, 11);
  } finally {
    delete globalThis.window.ConvergenceGameCore;
  }
});

test('sin núcleo el juego sigue puntuando con la expresión histórica', () => {
  delete globalThis.window.ConvergenceGameCore;
  Game.start('contrarreloj', 'normal', undefined, 4242);
  const cell = firstConvergingCell();
  assert.notEqual(cell, -1);

  const scoreBefore = State.score;
  Game.activate(cell);

  assert.ok(State.score > scoreBefore, 'el modo debe seguir siendo jugable');
  assert.notEqual(State.score - scoreBefore, 777);
});

test('los seis modos puntúan a través del núcleo, cada uno con su identidad', () => {
  const modes = ['tutorial', 'clasico', 'aventura', 'contrarreloj', 'supervivencia', 'zen'];
  for (const mode of modes) {
    const calls = installSpyCore();
    try {
      Game.start(mode, 'normal', undefined, 4242);
      const cell = firstConvergingCell();
      assert.notEqual(cell, -1, `${mode}: el tablero inicial debe ofrecer una convergencia`);

      const scoreBefore = State.score;
      Game.activate(cell);

      assert.equal(State.score - scoreBefore, 777, `${mode}: los puntos salen del núcleo`);
      const input = calls.find((call) => call[0] === 'convergencePoints')[1];
      assert.equal(input.mode, mode, `${mode}: el modo debe viajar al núcleo`);
      // El Tutorial fuerza `facil`: la dificultad que viaja es la efectiva.
      assert.equal(input.difficulty, State.diff);
    } finally {
      delete globalThis.window.ConvergenceGameCore;
    }
  }
});

test('el fallo con penalización usa el núcleo para iconos y ritmo de spawn', () => {
  const calls = installSpyCore();
  try {
    Game.start('clasico', 'normal', undefined, 4242);
    const cell = firstNonConvergingCell();
    assert.notEqual(cell, -1);

    Game.activate(cell);

    const names = calls.map((call) => call[0]);
    assert.ok(names.includes('iconPenaltyCount'), 'los iconos de castigo salen del núcleo');
    assert.ok(names.includes('penalizedSpawnRate'), 'el ritmo tras fallar sale del núcleo');
    assert.equal(State.spawnRate, 1234);
  } finally {
    delete globalThis.window.ConvergenceGameCore;
  }
});

test('las constantes de Contrarreloj siguen viviendo en Config para los otros caminos', () => {
  assert.equal(Config.TIMED_START, 60);
  assert.equal(Config.TIMED_CAP, 90);
  assert.equal(Config.MODES.contrarreloj.mult, 1.2);
});
