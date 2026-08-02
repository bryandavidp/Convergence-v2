/* Circuito completo de rankings con una partida REAL.
 *
 * Los demás tests usan claims a mano. Este juega Contrarreloj de verdad con el
 * motor del cliente sobre el stub de DOM y un reloj virtual, arma la
 * reclamación **igual que `Ranks.publishRun`**, la manda a `submitRunClaim` en
 * el emulador y la lee de vuelta con `getLeaderboardPage`.
 *
 * Es el único test que puede cazar el fallo reportado —"juego una partida y no
 * se registra nada"—, porque cubre a la vez la bitácora, el contrato del sobre,
 * la verificación y la lectura. Un claim que viole el contrato se rechaza aquí
 * con el mismo error que en producción, en vez de en silencio.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.CONVERGENCE_TEST_PROJECT_ID;
const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST;

assert.match(projectId ?? '', /^demo-/, 'Solo con un project ID demo-*.');
assert.ok(functionsHost, 'FUNCTIONS_EMULATOR_HOST no fue inyectado.');

const runId = `${process.pid}-${Date.now().toString(36)}`;
const adminApp = initializeApp({ projectId }, `leaderboard-e2e-real-${runId}`);
const firestore = getFirestore(adminApp);

after(async () => {
  await firestore.terminate();
  await deleteApp(adminApp);
});

/* ---------- Partida real, headless ---------- */

// Reloj virtual para conducir el Loop tick a tick. Se sustituye SOLO `now`: el
// resto del objeto `performance` sigue siendo el real porque `fetch` usa sus
// internos (`markResourceTiming`) y un stub desnudo lo rompe con un error
// asíncrono que aparece después del test, no dentro.
const VCLOCK = { t: 0 };
const realPerformance = globalThis.performance;
Object.defineProperty(globalThis, 'performance', {
  value: Object.assign(Object.create(Object.getPrototypeOf(realPerformance)), realPerformance, {
    now: () => VCLOCK.t,
    markResourceTiming: realPerformance.markResourceTiming?.bind(realPerformance) ?? (() => {}),
  }),
  configurable: true,
  writable: true,
});

const require_ = createRequire(import.meta.url);
const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../../client/web',
);
require_(path.join(webRoot, 'tests/dom-stub.js'));
require_(path.join(webRoot, 'game-core.js'));
require_(path.join(webRoot, 'game.js'));

const cv = globalThis.window.__cv;
const { Game, State, Loop, Engine, RunLog } = cv;
cv.Render.buildBoard();
for (const key of Object.keys(cv.FX)) if (typeof cv.FX[key] === 'function') cv.FX[key] = () => {};
for (const key of Object.keys(cv.Sound)) if (typeof cv.Sound[key] === 'function') cv.Sound[key] = () => {};

function mulberry32(a) {
  return function random() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Juega una partida completa y devuelve el sobre tal y como lo manda el cliente. */
function playTimeAttack(seed) {
  VCLOCK.t = 0;
  Game.start('contrarreloj', 'normal', undefined, seed);
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  let nextActAt = 260;

  while (VCLOCK.t < 300_000 && State.status === 'playing') {
    VCLOCK.t += 100;
    Loop.tick(VCLOCK.t);
    if (State.status !== 'playing') break;
    if (VCLOCK.t < nextActAt) continue;
    nextActAt = VCLOCK.t + 240 + Math.floor(rng() * 200);
    const plays = [];
    for (let i = 0; i < State.board.length; i += 1) {
      if (State.board[i] !== null || State.tiles[i]) continue;
      if (Engine.converging(i).length >= 2) plays.push(i);
    }
    if (plays.length) Game.activate(plays[Math.floor(rng() * plays.length)]);
  }

  return {
    protocolVersion: 1,
    idempotencyKey: `${RunLog.startedAt}-${State.score}-${RunLog.events.length}`,
    mode: 'contrarreloj',
    difficulty: State.diff,
    claimedScore: State.score,
    seed: State.seed == null ? 0 : State.seed,
    startedAt: RunLog.startedAt,
    finishedAt: Date.now(),
    gameVersion: VERSION_OF(),
    finalStateHash: `${State.score}:${State.removedTotal}:${State.maxCombo}`,
    events: RunLog.events,
  };
}

/** La versión que declara el cliente; el backend rechaza las desconocidas. */
function VERSION_OF() {
  const source = require_('node:fs').readFileSync(path.join(webRoot, 'game.js'), 'utf8');
  return source.match(/const VERSION = '([^']+)'/)[1];
}

function unsignedDebugToken(subject, extra = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return [encode({ alg: 'none', typ: 'JWT' }), encode({ sub: subject, ...extra }), 'sig'].join('.');
}

async function callCallable(name, data, uid) {
  const response = await fetch(
    `http://${functionsHost}/${projectId}/europe-west1/${name}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${unsignedDebugToken(uid, { user_id: uid })}`,
      },
      body: JSON.stringify({ data }),
    },
  );
  return { response, body: await response.json() };
}

test('una partida real se publica y se lee de vuelta en la tabla', async () => {
  const uid = `real-run-${runId}`;
  const claim = playTimeAttack(20260802);

  assert.ok(claim.claimedScore > 0, 'la partida simulada debe puntuar');
  assert.ok(claim.events.length > 0, 'la bitacora no puede llegar vacia');
  assert.ok(claim.events.length <= 4000, 'la bitacora no puede desbordar el contrato');

  const submitted = await callCallable('submitRunClaim', claim, uid);
  assert.equal(
    submitted.response.status, 200,
    `submitRunClaim rechazo el sobre: ${JSON.stringify(submitted.body)}`,
  );
  // Esto es lo que falla cuando "no se registran puntuaciones": el servidor
  // recalcula y no le sale el mismo numero, asi que no publica.
  assert.equal(
    submitted.body.result.verification, 'verified',
    `el servidor recalculo ${submitted.body.result?.score} frente a ${claim.claimedScore}`,
  );
  assert.equal(submitted.body.result.score, claim.claimedScore);
  assert.equal(submitted.body.result.improvedBoards.length, 4, 'debe entrar en los cuatro periodos');

  // Reenviar la misma clave es un reintento, no una segunda marca.
  const retried = await callCallable('submitRunClaim', claim, uid);
  assert.equal(retried.body.result.alreadyApplied, true);

  const page = await callCallable(
    'getLeaderboardPage',
    { mode: 'contrarreloj', scope: 'daily' },
    uid,
  );
  assert.equal(page.response.status, 200, JSON.stringify(page.body));
  const mine = page.body.result.entries.find((entry) => entry.userId === uid);
  assert.ok(mine, 'la marca recien publicada debe aparecer en la tabla del dia');
  assert.equal(mine.score, claim.claimedScore);
  assert.equal(mine.verification, 'verified');
  assert.ok(page.body.result.viewerRank >= 1, 'el jugador debe tener posicion');
});

test('una puntuacion inflada se rechaza y no toca la tabla', async () => {
  const uid = `cheater-${runId}`;
  const claim = playTimeAttack(777);
  const inflated = {
    ...claim,
    idempotencyKey: `${claim.idempotencyKey}-inflado`,
    claimedScore: claim.claimedScore * 10,
  };

  const submitted = await callCallable('submitRunClaim', inflated, uid);
  assert.equal(submitted.response.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body.result.verification, 'rejected');
  assert.deepEqual(submitted.body.result.improvedBoards, []);

  const page = await callCallable(
    'getLeaderboardPage',
    { mode: 'contrarreloj', scope: 'daily' },
    uid,
  );
  assert.equal(
    page.body.result.entries.some((entry) => entry.userId === uid), false,
    'una reclamacion rechazada no puede aparecer en la tabla',
  );
});
