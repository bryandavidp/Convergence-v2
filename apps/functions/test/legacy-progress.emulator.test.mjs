import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const adminApp = initializeApp({ projectId }, `legacy-progress-e2e-${runId}`);
const firestore = getFirestore(adminApp);

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

function validImport(idempotencyKey, overrides = {}) {
  return {
    protocolVersion: 1,
    idempotencyKey,
    baseRevision: 0,
    legacySchemaVersion: 10,
    payload: {
      _v: 10,
      level: 7,
      xp: 120,
      games: 4,
      totalRemoved: 55,
      coins: 999_999,
      gems: 888_888,
      tickets: 77,
      chests: 1,
      chestInventory: [{ uid: 'local-chest-1', type: 'divine' }],
      boards: { owned: { classic: 1 }, equipped: 'classic' },
      cosmetics: {
        owned: { neon: '2026-01-01' },
        theme: 'neon',
        avatarIcon: 'nova',
        avatarBorder: 'starlight',
        iconPack: 'cosmos',
      },
      adventure: { maxLevel: 3 },
      stats: { bestCombo: 9 },
      survBest: 1_200,
      survBestWave: 5,
      achievements: { first: '2026-01-01' },
      modes: { contrarreloj: { best: 3_000, plays: 2 } },
      unknownFutureField: { mustRemainInternal: true },
    },
    ...overrides,
  };
}

function commitFromPreview(idempotencyKey, preview) {
  return {
    protocolVersion: 1,
    idempotencyKey,
    operationId: preview.operationId,
    policyVersion: preview.policyVersion,
    planHash: preview.planHash,
    baseRevision: preview.baseRevision,
    confirmation: true,
  };
}

async function callCallable(name, data, options = {}) {
  const uid = options.uid ?? `legacy-user-${runId}`;
  const headers = { 'content-type': 'application/json' };
  if (options.auth !== false) {
    headers.authorization = `Bearer ${unsignedDebugToken(uid, { user_id: uid })}`;
  }
  if (options.appCheck !== false) {
    headers['x-firebase-appcheck'] = unsignedDebugToken(`app-${uid}`, {
      app_id: 'legacy-progress-emulator-app',
    });
  }

  const response = await fetch(
    `http://${functionsHost}/${projectId}/europe-west1/${name}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ data }),
    },
  );
  const body = await response.json();
  return { response, body, result: body?.result };
}

function assertCallableError(call, expectedStatus) {
  assert.equal(call.response.ok, false);
  assert.equal(call.body?.error?.status, expectedStatus);
}

async function preview(uid, key, overrides) {
  const call = await callCallable(
    'previewLegacyProgressImport',
    validImport(key, overrides),
    { uid },
  );
  assert.equal(call.response.status, 200, JSON.stringify(call.body));
  assert.equal(call.result?.status, 'ready');
  return call.result;
}

async function commit(uid, key, previewResult) {
  return callCallable(
    'commitLegacyProgressImport',
    commitFromPreview(key, previewResult),
    { uid },
  );
}

test('los callables mantienen Auth y App Check obligatorios', async () => {
  const key = `legacy-auth-${runId}`;
  const request = validImport(key);

  const anonymousPreview = await callCallable(
    'previewLegacyProgressImport',
    request,
    { auth: false },
  );
  assertCallableError(anonymousPreview, 'UNAUTHENTICATED');

  const authWithoutAppCheck = await callCallable(
    'previewLegacyProgressImport',
    request,
    { appCheck: false },
  );
  assertCallableError(authWithoutAppCheck, 'UNAUTHENTICATED');

  const anonymousCommit = await callCallable(
    'commitLegacyProgressImport',
    {},
    { auth: false },
  );
  assertCallableError(anonymousCommit, 'UNAUTHENTICATED');
});

test('preview no toca perfil y commit guarda solo claim no autoritativo', async () => {
  const uid = `legacy-main-${runId}`;
  const key = `legacy-main-key-${runId}`;
  const request = validImport(key);

  const previewCall = await callCallable(
    'previewLegacyProgressImport',
    request,
    { uid },
  );
  assert.equal(previewCall.response.status, 200, JSON.stringify(previewCall.body));
  const previewResult = previewCall.result;
  assert.equal(previewResult.status, 'ready');
  assert.equal(previewResult.currentRevision, 0);
  assert.equal(previewResult.nextRevision, 1);
  assert.equal(previewResult.projection.preferences.theme, 'neon');
  assert.equal(previewResult.projection.progress.level, 7);
  assert.deepEqual(previewResult.warnings, [
    'economy-quarantined',
    'ranked-scores-unverified',
    'temporary-state-quarantined',
    'unknown-fields-ignored',
  ]);

  const profileBefore = await firestore.collection('users').doc(uid).get();
  assert.equal(profileBefore.exists, false, 'preview no debe crear el perfil');

  const previewRef = firestore
    .collection('legacyImportPreviews')
    .doc(previewResult.operationId);
  const payloadRef = firestore
    .collection('legacyImportPayloads')
    .doc(previewResult.operationId);
  const internalPreviewBefore = await previewRef.get();
  assert.equal(internalPreviewBefore.exists, true);
  assert.equal(internalPreviewBefore.get('status'), 'ready');
  assert.equal(internalPreviewBefore.get('payloadJson'), undefined);
  const internalPayloadBefore = await payloadRef.get();
  assert.equal(internalPayloadBefore.exists, true);
  const rawPayload = internalPayloadBefore.get('payloadJson');
  assert.equal(typeof rawPayload, 'string', 'el raw debe persistirse como string interno');
  assert.deepEqual(JSON.parse(rawPayload), request.payload);
  assert.equal(internalPayloadBefore.get('payload'), undefined);
  assert.equal(
    internalPayloadBefore.get('deleteAt').toMillis(),
    previewResult.expiresAt,
  );

  const commitCall = await commit(uid, key, previewResult);
  assert.equal(commitCall.response.status, 200, JSON.stringify(commitCall.body));
  assert.equal(commitCall.result.status, 'committed');
  assert.equal(commitCall.result.fromRevision, 0);
  assert.equal(commitCall.result.toRevision, 1);

  const profileAfter = await firestore.collection('users').doc(uid).get();
  assert.equal(profileAfter.exists, true);
  assert.equal(profileAfter.get('revision'), 1);
  assert.equal(profileAfter.get('legacyImport.authority'), 'untrusted-client');
  assert.equal(profileAfter.get('legacyImport.verification'), 'unverified');
  assert.equal(profileAfter.get('legacyImport.status'), 'quarantined');
  assert.equal(profileAfter.get('legacyClaim.authority'), 'untrusted-client');
  assert.equal(profileAfter.get('legacyClaim.verification'), 'unverified');
  assert.deepEqual(
    profileAfter.get('legacyClaim.projection'),
    previewResult.projection,
  );
  for (const forbidden of [
    'coins', 'gems', 'tickets', 'chests', 'chestInventory', 'payload', 'payloadJson',
  ]) {
    assert.equal(profileAfter.get(forbidden), undefined, `${forbidden} no puede entrar al perfil`);
  }

  const internalPreviewAfter = await previewRef.get();
  assert.equal(internalPreviewAfter.get('status'), 'committed');
  assert.equal(internalPreviewAfter.get('payloadJson'), undefined);
  const internalPayloadAfter = await payloadRef.get();
  assert.equal(typeof internalPayloadAfter.get('payloadJson'), 'string');
  assert.deepEqual(JSON.parse(internalPayloadAfter.get('payloadJson')), request.payload);
  assert.ok(
    internalPayloadAfter.get('deleteAt').toMillis()
      >= commitCall.result.committedAt + 7 * 24 * 60 * 60 * 1_000,
  );

  const receipt = await firestore
    .collection('legacyImportReceipts')
    .doc(previewResult.operationId)
    .get();
  assert.equal(receipt.exists, true);
  assert.equal(receipt.get('result.toRevision'), 1);

  const retry = await commit(uid, key, previewResult);
  assert.equal(retry.response.status, 200, JSON.stringify(retry.body));
  assert.equal(retry.result.status, 'already-committed');
  assert.equal(retry.result.toRevision, 1);
  assert.equal((await firestore.collection('users').doc(uid).get()).get('revision'), 1);

  await receipt.ref.update({
    'result.payloadFingerprint': 'f'.repeat(64),
  });
  const corruptReceiptRetry = await commit(uid, key, previewResult);
  assertCallableError(corruptReceiptRetry, 'INTERNAL');

  const reusedKey = await callCallable(
    'previewLegacyProgressImport',
    validImport(key, {
      baseRevision: 1,
      payload: { ...request.payload, games: request.payload.games + 1 },
    }),
    { uid },
  );
  assertCallableError(reusedKey, 'ALREADY_EXISTS');
  assert.equal((await firestore.collection('users').doc(uid).get()).get('revision'), 1);
});

test('rechaza revision obsoleta tanto al previsualizar como al confirmar', async () => {
  const previewUid = `legacy-stale-preview-${runId}`;
  await firestore.collection('users').doc(previewUid).set({ revision: 2 });
  const stalePreview = await callCallable(
    'previewLegacyProgressImport',
    validImport(`legacy-stale-preview-key-${runId}`),
    { uid: previewUid },
  );
  assertCallableError(stalePreview, 'ABORTED');
  assert.equal(stalePreview.body.error.details.expectedRevision, 2);
  assert.equal(stalePreview.body.error.details.receivedRevision, 0);

  const commitUid = `legacy-stale-commit-${runId}`;
  const commitKey = `legacy-stale-commit-key-${runId}`;
  const ready = await preview(commitUid, commitKey);
  await firestore.collection('users').doc(commitUid).set({ revision: 1 });

  const staleCommit = await commit(commitUid, commitKey, ready);
  assertCallableError(staleCommit, 'ABORTED');
  assert.equal(staleCommit.body.error.details.expectedRevision, 1);
  assert.equal(staleCommit.body.error.details.receivedRevision, 0);
  assert.equal((await firestore.collection('users').doc(commitUid).get()).get('revision'), 1);
  assert.equal(
    (await firestore.collection('legacyImportReceipts').doc(ready.operationId).get()).exists,
    false,
  );

  const futureSchemaUid = `legacy-future-schema-${runId}`;
  await firestore.collection('users').doc(futureSchemaUid).set({
    schemaVersion: 2,
    revision: 0,
  });
  const futureSchema = await callCallable(
    'previewLegacyProgressImport',
    validImport(`legacy-future-schema-key-${runId}`),
    { uid: futureSchemaUid },
  );
  assertCallableError(futureSchema, 'INTERNAL');
});

test('una previsualizacion expirada requiere un plan nuevo y no se reintenta', async () => {
  const uid = `legacy-expired-${runId}`;
  const key = `legacy-expired-key-${runId}`;
  const ready = await preview(uid, key);
  const previewRef = firestore
    .collection('legacyImportPreviews')
    .doc(ready.operationId);
  const payloadRef = firestore
    .collection('legacyImportPayloads')
    .doc(ready.operationId);

  await previewRef.update({
    'result.expiresAt': Date.now() - 1,
  });

  const repeatedPreview = await callCallable(
    'previewLegacyProgressImport',
    validImport(key),
    { uid },
  );
  assertCallableError(repeatedPreview, 'FAILED_PRECONDITION');

  const expiredCommit = await commit(uid, key, ready);
  assertCallableError(expiredCommit, 'FAILED_PRECONDITION');
  assert.equal((await firestore.collection('users').doc(uid).get()).exists, false);
  assert.equal(
    (await firestore.collection('legacyImportReceipts').doc(ready.operationId).get()).exists,
    false,
  );

  await payloadRef.delete();
  const reusedAfterTtl = await callCallable(
    'previewLegacyProgressImport',
    validImport(key, {
      payload: { ...validImport(key).payload, games: 999 },
    }),
    { uid },
  );
  assertCallableError(reusedAfterTtl, 'ALREADY_EXISTS');

  const corruptUid = `legacy-corrupt-preview-${runId}`;
  const corruptKey = `legacy-corrupt-preview-key-${runId}`;
  const corruptPreview = await preview(corruptUid, corruptKey);
  await firestore.collection('legacyImportPreviews').doc(corruptPreview.operationId).update({
    'result.planHash': 'd'.repeat(64),
  });
  const corruptCommit = await commit(corruptUid, corruptKey, corruptPreview);
  assertCallableError(corruptCommit, 'INTERNAL');
});

test('serializa previews concurrentes y limita tres creaciones por hora y UID', async () => {
  const concurrentUid = `legacy-concurrent-${runId}`;
  const concurrentCalls = await Promise.all([
    callCallable(
      'previewLegacyProgressImport',
      validImport(`legacy-concurrent-a-${runId}`),
      { uid: concurrentUid },
    ),
    callCallable(
      'previewLegacyProgressImport',
      validImport(`legacy-concurrent-b-${runId}`),
      { uid: concurrentUid },
    ),
  ]);
  assert.equal(concurrentCalls.filter((call) => call.response.ok).length, 1);
  assert.equal(
    concurrentCalls.filter((call) => call.body?.error?.status === 'FAILED_PRECONDITION').length,
    1,
  );

  const uid = `legacy-rate-${runId}`;
  const lockRef = firestore
    .collection('legacyImportPreviewLocks')
    .doc(createHash('sha256').update(uid).digest('hex'));

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const ready = await preview(uid, `legacy-rate-${attempt}-${runId}`);
    await firestore.collection('legacyImportPreviews').doc(ready.operationId).update({
      'result.expiresAt': Date.now() - 1,
    });
    await lockRef.update({ activeUntil: 0 });
  }

  const exhausted = await callCallable(
    'previewLegacyProgressImport',
    validImport(`legacy-rate-4-${runId}`),
    { uid },
  );
  assertCallableError(exhausted, 'RESOURCE_EXHAUSTED');
  assert.ok(Number.isSafeInteger(exhausted.body.error.details.retryAt));
});

test('una segunda importacion queda bloqueada tras el primer commit', async () => {
  const uid = `legacy-second-${runId}`;
  const firstKey = `legacy-first-key-${runId}`;
  const firstPreview = await preview(uid, firstKey);
  const firstCommit = await commit(uid, firstKey, firstPreview);
  assert.equal(firstCommit.response.status, 200, JSON.stringify(firstCommit.body));
  assert.equal(firstCommit.result.status, 'committed');

  const second = await callCallable(
    'previewLegacyProgressImport',
    validImport(`legacy-second-key-${runId}`, { baseRevision: 1 }),
    { uid },
  );
  assertCallableError(second, 'FAILED_PRECONDITION');
  assert.equal((await firestore.collection('users').doc(uid).get()).get('revision'), 1);
});

test('la misma idempotency key queda aislada por UID', async () => {
  const key = `legacy-shared-key-${runId}`;
  const firstUid = `legacy-isolated-a-${runId}`;
  const secondUid = `legacy-isolated-b-${runId}`;

  const [first, second] = await Promise.all([
    preview(firstUid, key),
    preview(secondUid, key),
  ]);

  assert.notEqual(first.operationId, second.operationId);
  assert.equal(
    (await firestore.collection('legacyImportPreviews').doc(first.operationId).get()).exists,
    true,
  );
  assert.equal(
    (await firestore.collection('legacyImportPreviews').doc(second.operationId).get()).exists,
    true,
  );
  assert.notEqual(
    (await firestore.collection('legacyImportPreviews').doc(first.operationId).get()).get('ownerHash'),
    (await firestore.collection('legacyImportPreviews').doc(second.operationId).get()).get('ownerHash'),
  );
});
