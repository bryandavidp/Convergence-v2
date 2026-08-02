/* Lectura de tablas contra Firestore real (emulador).
 *
 * Los tests de handler cubren la lógica con un lector en memoria; este cubre lo
 * que solo se ve contra el motor de verdad: que el orden y la paginación por
 * cursor funcionan, que `count()` resuelve la posición del jugador y —lo más
 * importante— que las consultas se sirven **sin índice compuesto**. Si algún día
 * hicieran falta, Firestore falla aquí con `FAILED_PRECONDITION` en vez de en
 * producción.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.CONVERGENCE_TEST_PROJECT_ID;
const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;

assert.match(
  projectId ?? '',
  /^demo-/,
  'Las pruebas funcionales solo pueden ejecutarse con un project ID demo-*.',
);
assert.ok(functionsHost, 'FUNCTIONS_EMULATOR_HOST no fue inyectado por Emulator Suite.');
assert.ok(firestoreHost, 'FIRESTORE_EMULATOR_HOST no fue inyectado por Emulator Suite.');

const runId = `${process.pid}-${Date.now().toString(36)}`;
const adminApp = initializeApp({ projectId }, `leaderboard-e2e-${runId}`);
const firestore = getFirestore(adminApp);

// Tabla propia por ejecución: los tests no pueden pisarse entre sí.
const BOARD_SCOPE_ID = `2026-08-02-${runId}`;
const BOARD_ID = `contrarreloj:daily:${BOARD_SCOPE_ID}`;

after(async () => {
  await firestore.terminate();
  await deleteApp(adminApp);
});

function unsignedDebugToken(subject, extra = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return [
    encode({ alg: 'none', typ: 'JWT' }),
    encode({ sub: subject, ...extra }),
    'emulator-only-signature',
  ].join('.');
}

async function callCallable(name, data, options = {}) {
  const uid = options.uid ?? `board-user-${runId}`;
  const headers = { 'content-type': 'application/json' };
  if (options.auth !== false) {
    headers.authorization = `Bearer ${unsignedDebugToken(uid, { user_id: uid })}`;
  }
  if (options.appCheck !== false) {
    headers['x-firebase-appcheck'] = unsignedDebugToken(`app-${uid}`, {
      app_id: 'leaderboard-emulator-app',
    });
  }

  const response = await fetch(
    `http://${functionsHost}/${projectId}/europe-west1/${name}`,
    { method: 'POST', headers, body: JSON.stringify({ data }) },
  );
  const body = await response.json();
  return { response, body, result: body?.result };
}

function entry(userId, score) {
  return {
    protocolVersion: 1,
    userId,
    displayName: `Jugador ${userId.slice(-2)}`,
    mode: 'contrarreloj',
    scope: 'daily',
    scopeId: BOARD_SCOPE_ID,
    score,
    verification: 'verified',
    updatedAt: Date.UTC(2026, 7, 2, 12, 0, 0),
  };
}

// Se siembra directamente con Admin SDK —igual que hace submitRunClaim— porque
// lo que se prueba aquí es la lectura, no la publicación.
const SEEDED = [
  ['uid-01', 900], ['uid-02', 800], ['uid-03', 700],
  ['uid-04', 600], ['uid-05', 500],
];

test('siembra la tabla con puntuaciones verificadas', async () => {
  const entries = firestore.collection('leaderboards').doc(BOARD_ID).collection('entries');
  await Promise.all(SEEDED.map(([uid, score]) => entries.doc(uid).set(entry(uid, score))));
  const snapshot = await entries.get();
  assert.equal(snapshot.size, SEEDED.length);
});

test('la tabla se lee ordenada y paginada sin necesitar índice compuesto', async () => {
  const first = await callCallable(
    'getLeaderboardPage',
    { mode: 'contrarreloj', scope: 'daily', scopeId: BOARD_SCOPE_ID, limit: 2 },
    { uid: 'uid-03' },
  );
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.equal(first.result.boardId, BOARD_ID);
  assert.deepEqual(first.result.entries.map((row) => row.userId), ['uid-01', 'uid-02']);
  assert.equal(first.result.viewerRank, 3, 'uid-03 es tercero con 700');
  assert.ok(first.result.nextCursor);

  const second = await callCallable(
    'getLeaderboardPage',
    {
      mode: 'contrarreloj',
      scope: 'daily',
      scopeId: BOARD_SCOPE_ID,
      limit: 2,
      cursor: first.result.nextCursor,
    },
    { uid: 'uid-03' },
  );
  assert.equal(second.response.status, 200, JSON.stringify(second.body));
  assert.deepEqual(second.result.entries.map((row) => row.userId), ['uid-03', 'uid-04']);

  const third = await callCallable(
    'getLeaderboardPage',
    {
      mode: 'contrarreloj',
      scope: 'daily',
      scopeId: BOARD_SCOPE_ID,
      limit: 2,
      cursor: second.result.nextCursor,
    },
    { uid: 'uid-03' },
  );
  assert.deepEqual(third.result.entries.map((row) => row.userId), ['uid-05']);
  assert.equal(third.result.nextCursor, null, 'agotada la tabla no encadena más');
});

test('quien no ha puntuado recibe la tabla sin posición', async () => {
  const page = await callCallable(
    'getLeaderboardPage',
    { mode: 'contrarreloj', scope: 'daily', scopeId: BOARD_SCOPE_ID },
    { uid: `forastero-${runId}` },
  );
  assert.equal(page.response.status, 200, JSON.stringify(page.body));
  assert.equal(page.result.viewerRank, null);
  assert.equal(page.result.entries.length, SEEDED.length);
});

test('una tabla que aún no existe se lee vacía, no falla', async () => {
  const page = await callCallable('getLeaderboardPage', {
    mode: 'contrarreloj',
    scope: 'daily',
    scopeId: `sin-partidas-${runId}`,
  });
  assert.equal(page.response.status, 200, JSON.stringify(page.body));
  assert.deepEqual(page.result.entries, []);
  assert.equal(page.result.viewerRank, null);
  assert.equal(page.result.nextCursor, null);
});

test('la consulta exige identidad autenticada', async () => {
  const page = await callCallable(
    'getLeaderboardPage',
    { mode: 'contrarreloj', scope: 'daily', scopeId: BOARD_SCOPE_ID },
    { auth: false },
  );
  assert.equal(page.body?.error?.status, 'UNAUTHENTICATED', JSON.stringify(page.body));
});
