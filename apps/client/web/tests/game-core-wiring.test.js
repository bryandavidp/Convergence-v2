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
    timeAttackConvergencePoints(input) { calls.push(['timeAttackConvergencePoints', input]); return 777; },
    timeGainFor() { calls.push(['timeGainFor']); return 0; },
    applyTimeGain() { calls.push(['applyTimeGain']); return 42; },
    applyMistakePenalty() { calls.push(['applyMistakePenalty']); return 11; },
    timeAttackEmptyBoardBonus() { calls.push(['timeAttackEmptyBoardBonus']); return 999; },
    zenConvergencePoints(input) { calls.push(['zenConvergencePoints', input]); return 555; },
    zenEmptyBoardBonus() { calls.push(['zenEmptyBoardBonus']); return 888; },
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
    assert.ok(names.includes('timeAttackConvergencePoints'));
    assert.ok(names.includes('applyTimeGain'));

    const input = calls.find((call) => call[0] === 'timeAttackConvergencePoints')[1];
    assert.equal(input.difficulty, 'normal');
    assert.equal(typeof input.removed, 'number');
    assert.equal(typeof input.fever, 'boolean');
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

test('los demás modos no pasan por el núcleo mientras no estén extraídos', () => {
  const calls = installSpyCore();
  try {
    Game.start('supervivencia', 'normal', undefined, 4242);
    const cell = firstConvergingCell();
    if (cell !== -1) Game.activate(cell);
    assert.deepEqual(calls, [], 'Supervivencia aún no está extraída (ROADMAP fase 4)');
  } finally {
    delete globalThis.window.ConvergenceGameCore;
  }
});

test('Zen también puntúa a través del núcleo', () => {
  const calls = installSpyCore();
  try {
    Game.start('zen', 'normal', undefined, 4242);
    const cell = firstConvergingCell();
    assert.notEqual(cell, -1);

    const scoreBefore = State.score;
    Game.activate(cell);

    assert.equal(State.score - scoreBefore, 555, 'los puntos de Zen salen del núcleo');
    const input = calls.find((call) => call[0] === 'zenConvergencePoints')[1];
    assert.equal(input.difficulty, 'normal');
    // Zen no tiene reloj ni fiebre: su entrada no puede arrastrarlos.
    assert.equal(input.timeLeftSeconds, undefined);
    assert.equal(input.fever, undefined);
  } finally {
    delete globalThis.window.ConvergenceGameCore;
  }
});

test('las constantes de Contrarreloj siguen viviendo en Config para los otros caminos', () => {
  assert.equal(Config.TIMED_START, 60);
  assert.equal(Config.TIMED_CAP, 90);
  assert.equal(Config.MODES.contrarreloj.mult, 1.2);
});
