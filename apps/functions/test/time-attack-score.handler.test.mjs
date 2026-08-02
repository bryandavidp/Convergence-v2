import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_TIME_ATTACK_EVENTS,
  parseTimeAttackRun,
  recomputeTimeAttackRun,
  verifyTimeAttackClaim,
} from '../lib/time-attack-score.js';
import { verifyTimeAttackRun } from '../lib/index.js';

function convergence(overrides = {}) {
  return {
    kind: 'convergence',
    removed: 2,
    combo: 1,
    fever: false,
    elapsedSeconds: 0,
    ...overrides,
  };
}

function run(events, difficulty = 'normal') {
  return { difficulty, events };
}

test('el callable exige identidad autenticada antes de recalcular', async () => {
  await assert.rejects(
    verifyTimeAttackRun.run({ data: {}, auth: undefined }),
    (error) => {
      assert.equal(error?.code, 'unauthenticated');
      return true;
    },
  );
});

test('recalcula la puntuación con las reglas del núcleo', () => {
  // 2 iconos, combo 1, normal: floor(2*10*1 * 1 * 1.0 * 1.2) = 24.
  const outcome = recomputeTimeAttackRun(run([convergence()]));
  assert.equal(outcome.score, 24);
  assert.equal(outcome.convergences, 1);
  assert.equal(outcome.mistakes, 0);
});

test('la dificultad cambia el resultado igual que en el juego', () => {
  const events = [convergence()];
  assert.equal(recomputeTimeAttackRun(run(events, 'facil')).score, 19); // floor(20*0.8*1.2)
  assert.equal(recomputeTimeAttackRun(run(events, 'dificil')).score, 31); // floor(20*1.3*1.2)
});

test('hitos, fiebre y cristales entran en el recálculo', () => {
  const withMilestone = recomputeTimeAttackRun(run([
    convergence({ combo: 10, fever: true, crystals: 1 }),
  ]));
  // floor(20 * 3 * 1.0 * 1.2 * 1.25) = 90, +500 de hito, +50 de cristal.
  assert.equal(withMilestone.score, 90 + 500 + 50);
});

test('un fallo descuenta tiempo y no puntúa', () => {
  const outcome = recomputeTimeAttackRun(run([{ kind: 'mistake', elapsedSeconds: 0 }, { kind: 'mistake', elapsedSeconds: 0 }]));
  assert.equal(outcome.score, 0);
  assert.equal(outcome.mistakes, 2);
  assert.equal(outcome.timeLeftSeconds, 54, 'dos fallos cuestan 6s de los 60 iniciales');
});

test('el score del cliente se compara, nunca se acepta como dato', () => {
  const payload = { claimedScore: 24, run: run([convergence()]) };
  assert.equal(verifyTimeAttackClaim(payload).accepted, true);

  const inflated = verifyTimeAttackClaim({ ...payload, claimedScore: 999_999 });
  assert.equal(inflated.accepted, false);
  assert.equal(inflated.score, 24, 'el recalculado manda');
  assert.equal(inflated.claimedScore, 999_999);
});

test('rechaza eventos imposibles antes de recalcular', () => {
  const invalid = [
    { claimedScore: 0, run: run([convergence({ removed: 1 })]) },
    { claimedScore: 0, run: run([convergence({ removed: 9 })]) },
    { claimedScore: 0, run: run([convergence({ combo: -1 })]) },
    { claimedScore: 0, run: run([convergence({ elapsedSeconds: -5 })]) },
    { claimedScore: 0, run: run([{ kind: 'teleport' }]) },
    { claimedScore: 0, run: run([convergence()], 'imposible') },
    { claimedScore: -1, run: run([convergence()]) },
  ];
  for (const [index, payload] of invalid.entries()) {
    assert.throws(
      () => verifyTimeAttackClaim(payload),
      (error) => error.code === 'invalid-argument',
      `caso ${index} debería rechazarse`,
    );
  }
});

test('una run desmesurada se rechaza en vez de procesarse', () => {
  const events = Array.from({ length: MAX_TIME_ATTACK_EVENTS + 1 }, () => convergence());
  assert.throws(
    () => parseTimeAttackRun(run(events)),
    (error) => error.code === 'invalid-argument',
  );
});

/**
 * La comprobación que da sentido a todo lo demás: se juega una partida real con
 * el motor del cliente y se recalcula en el backend. El motor corre aquí SIN
 * `window.ConvergenceGameCore`, así que usa su expresión histórica: si el
 * recálculo del servidor coincide, cliente y servidor puntúan igual de verdad.
 */
test('el backend recalcula exactamente lo que puntuó el motor del cliente', async () => {
  const { createRequire } = await import('node:module');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const VCLOCK = { t: 0 };
  Object.defineProperty(globalThis, 'performance', {
    value: { now: () => VCLOCK.t },
    configurable: true,
    writable: true,
  });

  const require = createRequire(import.meta.url);
  const webRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../client/web',
  );
  require(path.join(webRoot, 'tests/dom-stub.js'));
  require(path.join(webRoot, 'game.js'));

  const cv = globalThis.window.__cv;
  delete globalThis.window.ConvergenceGameCore;
  cv.Render.buildBoard();
  if (typeof cv.FX.init === 'function') cv.FX.init();
  for (const key of Object.keys(cv.FX)) if (typeof cv.FX[key] === 'function') cv.FX[key] = () => {};
  for (const key of Object.keys(cv.Sound)) if (typeof cv.Sound[key] === 'function') cv.Sound[key] = () => {};

  const { Game, State, Loop } = cv;
  const events = [];
  const difficulty = 'normal';

  VCLOCK.t = 0;
  Game.start('contrarreloj', difficulty, undefined, 0xbeef);

  const originalActivate = Game.activate.bind(Game);
  Game.activate = (index) => {
    const converging = cv.Engine.converging(index);
    const emptyBefore = State.emptyBoards || 0;
    const elapsedSeconds = State.elapsed;
    const crystals = converging
      .filter((idx) => State.tiles[idx] && State.tiles[idx].type === 'crystal').length;
    const capsulesBefore = State.tiles
      .map((tile, idx) => (tile && tile.type === 'timecap' ? idx : -1))
      .filter((idx) => idx !== -1);

    originalActivate(index);

    if (converging.length < 2) { events.push({ kind: 'mistake', elapsedSeconds }); return; }
    events.push({
      kind: 'convergence',
      removed: converging.length,
      combo: State.combo,
      fever: State.fever,
      elapsedSeconds,
      crystals,
      capsules: capsulesBefore
        .filter((idx) => !State.tiles[idx] || State.tiles[idx].type !== 'timecap').length,
      emptyBoardChain: (State.emptyBoards || 0) > emptyBefore ? State.emptyBoards : 0,
    });
  };

  let nextActAt = 220;
  while (VCLOCK.t < 120_000 && events.length < 300) {
    VCLOCK.t += 50;
    Loop.tick(VCLOCK.t);
    if (State.status !== 'playing') break;
    if (VCLOCK.t < nextActAt) continue;
    nextActAt += 220;
    let played = -1;
    for (let i = 0; i < State.board.length; i += 1) {
      if (State.board[i] === null && cv.Engine.converging(i).length >= 2) { played = i; break; }
    }
    if (played === -1) continue;
    Game.activate(played);
  }
  Game.activate = originalActivate;

  const convergences = events.filter((event) => event.kind === 'convergence').length;
  assert.ok(convergences >= 20, `muestra insuficiente: ${convergences}`);

  const verdict = verifyTimeAttackClaim({
    claimedScore: State.score,
    run: { difficulty, events, endedAtSeconds: State.elapsed },
  });
  assert.equal(
    verdict.score,
    State.score,
    'el recálculo del servidor debe cuadrar al punto con el motor del cliente',
  );
  assert.equal(verdict.accepted, true);
  assert.ok(
    Math.abs(verdict.timeLeftSeconds - State.timeLeft) < 1e-9,
    `reloj: servidor ${verdict.timeLeftSeconds} vs cliente ${State.timeLeft}`,
  );
});
