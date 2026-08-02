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
const adminApp = initializeApp({ projectId }, `user-profile-e2e-${runId}`);
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

async function callCallable(name, data, options = {}) {
  const uid = options.uid ?? `profile-user-${runId}`;
  const headers = { 'content-type': 'application/json' };
  if (options.auth !== false) {
    headers.authorization = `Bearer ${unsignedDebugToken(uid, { user_id: uid })}`;
  }
  if (options.appCheck !== false) {
    headers['x-firebase-appcheck'] = unsignedDebugToken(`app-${uid}`, {
      app_id: 'user-profile-emulator-app',
    });
  }

  const response = await fetch(
    `http://${functionsHost}/${projectId}/europe-west1/${name}`,
    { method: 'POST', headers, body: JSON.stringify({ data }) },
  );
  const body = await response.json();
  return { response, body, result: body?.result };
}

function profileBody(uid, overrides = {}) {
  return {
    schemaVersion: 1,
    uid,
    displayName: 'Jugador',
    avatarIcon: 'nova',
    avatarBorder: 'starlight',
    theme: 'default',
    iconPack: 'cosmos',
    updatedAt: 1_800_000_000_000,
    ...overrides,
  };
}

function recordsBody(uid, overrides = {}) {
  return {
    schemaVersion: 1,
    uid,
    survivalBest: 12_000,
    survivalBestWave: 10,
    adventureMaxLevel: 25,
    bestCombo: 9,
    updatedAt: 1_800_000_000_000,
    ...overrides,
  };
}

function freshUid(label) {
  return `profile-${label}-${runId}-${Math.random().toString(36).slice(2, 8)}`;
}

test('putUserProfile aplica el CAS y persiste la revisión en Firestore', async () => {
  const uid = freshUid('cas');
  const { response, result } = await callCallable('putUserProfile', {
    idempotencyKey: `profile-key-${uid}`,
    baseRevision: 0,
    profile: profileBody(uid, { displayName: 'Primero' }),
  }, { uid });

  assert.equal(response.status, 200);
  assert.equal(result.revision, 1);
  assert.equal(result.profile.displayName, 'Primero');

  const stored = await firestore
    .collection('users').doc(uid)
    .collection('cloudProfile').doc('current')
    .get();
  assert.equal(stored.exists, true, 'el documento cuelga de users/{uid}');
  assert.equal(stored.get('revision'), 1);
  assert.equal(stored.get('body').displayName, 'Primero');
});

test('reintentar la misma idempotencyKey no incrementa la revisión', async () => {
  const uid = freshUid('retry');
  const write = {
    idempotencyKey: `profile-key-${uid}`,
    baseRevision: 0,
    profile: profileBody(uid),
  };

  const first = await callCallable('putUserProfile', write, { uid });
  const second = await callCallable('putUserProfile', write, { uid });

  assert.equal(first.result.revision, 1);
  assert.equal(second.result.revision, 1, 'el reintento devuelve la revisión aplicada');

  const stored = await firestore
    .collection('users').doc(uid)
    .collection('cloudProfile').doc('current')
    .get();
  assert.equal(stored.get('revision'), 1, 'el documento solo avanzó una vez');
});

test('la misma clave con otro contenido se rechaza sin sobrescribir', async () => {
  const uid = freshUid('reuse');
  const key = `profile-key-${uid}`;
  await callCallable('putUserProfile', {
    idempotencyKey: key,
    baseRevision: 0,
    profile: profileBody(uid, { displayName: 'Original' }),
  }, { uid });

  const { body } = await callCallable('putUserProfile', {
    idempotencyKey: key,
    baseRevision: 0,
    profile: profileBody(uid, { displayName: 'Suplantado' }),
  }, { uid });

  assert.equal(body?.error?.status, 'ALREADY_EXISTS');

  const stored = await firestore
    .collection('users').doc(uid)
    .collection('cloudProfile').doc('current')
    .get();
  assert.equal(stored.get('body').displayName, 'Original', 'no se sobrescribió');
});

test('una revisión base caducada produce conflicto y no escribe', async () => {
  const uid = freshUid('conflict');
  await callCallable('putUserProfile', {
    idempotencyKey: `profile-first-${uid}`,
    baseRevision: 0,
    profile: profileBody(uid, { displayName: 'Vigente' }),
  }, { uid });

  const { body } = await callCallable('putUserProfile', {
    idempotencyKey: `profile-stale-${uid}`,
    baseRevision: 0,
    profile: profileBody(uid, { displayName: 'Obsoleto' }),
  }, { uid });

  assert.equal(body?.error?.status, 'ABORTED');

  const stored = await firestore
    .collection('users').doc(uid)
    .collection('cloudProfile').doc('current')
    .get();
  assert.equal(stored.get('revision'), 1);
  assert.equal(stored.get('body').displayName, 'Vigente');
});

test('un cuerpo con uid ajeno se rechaza: la identidad sale de Auth', async () => {
  const uid = freshUid('identity');
  const { body } = await callCallable('putUserProfile', {
    idempotencyKey: `profile-key-${uid}`,
    baseRevision: 0,
    profile: profileBody('uid-de-otro'),
  }, { uid });

  assert.equal(body?.error?.status, 'PERMISSION_DENIED');

  const stored = await firestore
    .collection('users').doc('uid-de-otro')
    .collection('cloudProfile').doc('current')
    .get();
  assert.equal(stored.exists, false, 'no se creó nada en el espacio ajeno');
});

test('putUserBestRecords usa un carril propio y no colisiona con el perfil', async () => {
  const uid = freshUid('lanes');
  const sharedKey = `shared-key-${uid}`;

  const profile = await callCallable('putUserProfile', {
    idempotencyKey: sharedKey,
    baseRevision: 0,
    profile: profileBody(uid),
  }, { uid });
  // Misma clave, otro carril: debe ser otra operación, no un reintento.
  const records = await callCallable('putUserBestRecords', {
    idempotencyKey: sharedKey,
    baseRevision: 0,
    records: recordsBody(uid),
  }, { uid });

  assert.equal(profile.result.revision, 1);
  assert.equal(records.result.revision, 1);
  assert.equal(records.result.records.survivalBest, 12_000);

  const storedRecords = await firestore
    .collection('users').doc(uid)
    .collection('cloudRecords').doc('current')
    .get();
  assert.equal(storedRecords.get('body').survivalBest, 12_000);
});

test('getUserProfile devuelve null antes de existir y el documento después', async () => {
  const uid = freshUid('read');

  const empty = await callCallable('getUserProfile', null, { uid });
  assert.equal(empty.response.status, 200);
  assert.equal(empty.result, null, 'un perfil inexistente no es un error');

  await callCallable('putUserProfile', {
    idempotencyKey: `profile-key-${uid}`,
    baseRevision: 0,
    profile: profileBody(uid, { displayName: 'Leído' }),
  }, { uid });

  const stored = await callCallable('getUserProfile', null, { uid });
  assert.equal(stored.result.revision, 1);
  assert.equal(stored.result.profile.displayName, 'Leído');
});

test('la lectura está aislada por UID: nadie ve el perfil de otro', async () => {
  const owner = freshUid('owner');
  const stranger = freshUid('stranger');
  await callCallable('putUserProfile', {
    idempotencyKey: `profile-key-${owner}`,
    baseRevision: 0,
    profile: profileBody(owner, { displayName: 'Privado' }),
  }, { uid: owner });

  const seen = await callCallable('getUserProfile', null, { uid: stranger });
  assert.equal(seen.result, null, 'otro UID no puede leer este perfil');
});

test('las callables de perfil exigen identidad autenticada', async () => {
  const names = [
    'putUserProfile',
    'putUserBestRecords',
    'getUserProfile',
    'getUserBestRecords',
  ];
  for (const name of names) {
    const { body } = await callCallable(name, {}, { auth: false });
    assert.equal(body?.error?.status, 'UNAUTHENTICATED');
  }
});
