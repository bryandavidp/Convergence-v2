import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deleteApp, initializeApp } from 'firebase/app';
import {
  deleteUser,
  inMemoryPersistence,
  initializeAuth,
  signInAnonymously,
} from 'firebase/auth';

const EXPECTED_PROJECT_ID = 'convergence-d1a35';
const EXPECTED_APP_ID = '1:98627547554:web:8d293cfb4a8a99b6cd82fb';
const EXPECTED_DATABASE_URL =
  'https://convergence-d1a35-default-rtdb.europe-west1.firebasedatabase.app';
const clientRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = resolve(clientRoot, 'firebase-config.dev.json');
const requestedProject = process.argv[2];

if (requestedProject !== EXPECTED_PROJECT_ID) {
  throw new Error(
    `El smoke cloud exige confirmar el proyecto como primer argumento: ${EXPECTED_PROJECT_ID}.`,
  );
}

const config = JSON.parse(await readFile(configPath, 'utf8'));
assert.equal(config.projectId, EXPECTED_PROJECT_ID);
assert.equal(config.appId, EXPECTED_APP_ID);
assert.equal(config.databaseURL, EXPECTED_DATABASE_URL);
assert.equal(config.messagingSenderId, '98627547554');
assert.equal(config.authDomain, 'convergence-d1a35.firebaseapp.com');
assert.equal(typeof config.apiKey, 'string');
assert.ok(config.apiKey.length > 0);

const app = initializeApp({
  apiKey: config.apiKey,
  appId: config.appId,
  authDomain: config.authDomain,
  projectId: config.projectId,
}, `convergence-cloud-auth-smoke-${process.pid}-${Date.now()}`);
const auth = initializeAuth(app, {
  persistence: inMemoryPersistence,
  popupRedirectResolver: undefined,
});

let createdUser = null;
let deleted = false;

try {
  assert.equal(auth.emulatorConfig, null);
  const credential = await signInAnonymously(auth);
  createdUser = credential.user;
  assert.equal(createdUser.isAnonymous, true);
  assert.ok(createdUser.uid.length > 0);
  const token = await createdUser.getIdToken();
  assert.ok(token.length > 0);

  await deleteUser(createdUser);
  deleted = true;
  createdUser = null;

  console.log(
    'Firebase Auth cloud smoke OK: cuenta anónima creada, token validado y cuenta eliminada.',
  );
} finally {
  if (createdUser !== null && !deleted) {
    try {
      await deleteUser(createdUser);
    } catch {
      // La cuenta de smoke puede haber sido eliminada por el servidor tras un fallo tardío.
    }
  }
  await deleteApp(app);
}
