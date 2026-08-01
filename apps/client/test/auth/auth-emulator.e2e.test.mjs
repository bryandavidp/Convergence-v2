import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';

import { createAnonymousAuthSession } from '../../src/online/anonymous-auth-session.ts';

const execFileAsync = promisify(execFile);
const projectId = process.env.CONVERGENCE_AUTH_TEST_PROJECT_ID;
const emulatorUrl = process.env.CONVERGENCE_AUTH_EMULATOR_URL;

assert.match(
  projectId ?? '',
  /^demo-[a-z0-9-]+$/,
  'Auth E2E solo puede ejecutarse con un project ID demo-*.',
);

const parsedEmulatorUrl = new URL(emulatorUrl ?? '');
assert.equal(parsedEmulatorUrl.protocol, 'http:');
assert.ok(
  parsedEmulatorUrl.hostname === '127.0.0.1'
    || parsedEmulatorUrl.hostname === 'localhost',
  'Auth E2E solo puede conectarse a loopback.',
);
assert.equal(parsedEmulatorUrl.port, '9099');

const firebaseOptions = {
  apiKey: 'demo-api-key',
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
};

function waitForAuthState(session, predicate, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timeout esperando una transición de Auth Emulator.'));
    }, timeoutMs);

    unsubscribe = session.onAuthState((user) => {
      if (!predicate(user)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(user);
    });
  });
}

function createEmulatedAuth(appName) {
  const app = initializeApp(firebaseOptions, appName);
  const auth = getAuth(app);
  connectAuthEmulator(auth, parsedEmulatorUrl.origin, { disableWarnings: true });
  return auth;
}

async function clearEmulatorAccounts() {
  const response = await fetch(
    `${parsedEmulatorUrl.origin}/emulator/v1/projects/${projectId}/accounts`,
    { method: 'DELETE' },
  );
  assert.equal(response.status, 200, 'Auth Emulator no pudo limpiar sus cuentas.');
}

async function runFreshProcessProbe() {
  const probeUrl = new URL('./auth-process-restart-probe.mjs', import.meta.url);
  const { stdout } = await execFileAsync(
    process.execPath,
    [fileURLToPath(probeUrl)],
    {
      env: process.env,
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    },
  );
  return JSON.parse(stdout.trim());
}

test('sesión anónima completa contra Auth Emulator', async (t) => {
  await clearEmulatorAccounts();
  const auth = createEmulatedAuth(`auth-e2e-${process.pid}`);
  const session = createAnonymousAuthSession(auth);

  t.after(async () => {
    try { await session.logout(); } catch { /* La app puede estar eliminada. */ }
    try { await deleteApp(auth.app); } catch { /* Ya eliminada. */ }
    await clearEmulatorAccounts();
  });

  await t.test('empieza sin usuario y notifica el estado inicial', async () => {
    const initialState = await waitForAuthState(session, (user) => user === null);
    assert.equal(initialState, null);
    assert.equal(session.currentUser, null);
  });

  let anonymousUid;
  await t.test('ensureSignedIn crea identidad anónima y token en el proyecto demo', async () => {
    const signedInState = waitForAuthState(session, (user) => user?.isAnonymous === true);
    const user = await session.ensureSignedIn();
    const observedUser = await signedInState;

    anonymousUid = user.uid;
    assert.equal(user.isAnonymous, true);
    assert.equal(user.providerId, 'firebase');
    assert.equal(observedUser?.uid, anonymousUid);
    assert.equal(session.currentUser?.uid, anonymousUid);

    const idToken = await user.getIdToken();
    assert.equal(idToken.split('.').length, 3);
  });

  await t.test('la misma app reutiliza la sesión en memoria', () => {
    const sameAuth = getAuth(auth.app);
    assert.equal(sameAuth, auth);
    assert.equal(sameAuth.currentUser?.uid, anonymousUid);
  });

  await t.test('un proceso nuevo no hereda la sesión en memoria', async () => {
    const restarted = await runFreshProcessProbe();
    assert.equal(restarted.initialUserWasNull, true);
    assert.equal(restarted.isAnonymous, true);
    assert.notEqual(restarted.uid, anonymousUid);
  });

  await t.test('logout limpia la identidad y emite estado anónimo', async () => {
    const signedOutState = waitForAuthState(session, (user) => user === null);
    await session.logout();
    assert.equal(await signedOutState, null);
    assert.equal(session.currentUser, null);
  });
});
