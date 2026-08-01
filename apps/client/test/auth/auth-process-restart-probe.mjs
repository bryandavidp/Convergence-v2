import assert from 'node:assert/strict';

import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';

import { createAnonymousAuthSession } from '../../src/online/anonymous-auth-session.ts';

const projectId = process.env.CONVERGENCE_AUTH_TEST_PROJECT_ID;
const emulatorUrl = new URL(process.env.CONVERGENCE_AUTH_EMULATOR_URL ?? '');

assert.match(projectId ?? '', /^demo-[a-z0-9-]+$/);
assert.equal(emulatorUrl.protocol, 'http:');
assert.ok(emulatorUrl.hostname === '127.0.0.1' || emulatorUrl.hostname === 'localhost');
assert.equal(emulatorUrl.port, '9099');

const app = initializeApp(
  {
    apiKey: 'demo-api-key',
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
  },
  `auth-restart-probe-${process.pid}`,
);
const auth = getAuth(app);
connectAuthEmulator(auth, emulatorUrl.origin, { disableWarnings: true });
const session = createAnonymousAuthSession(auth);

await auth.authStateReady();
const initialUserWasNull = session.currentUser === null;
const user = await session.ensureSignedIn();
const result = {
  initialUserWasNull,
  uid: user.uid,
  isAnonymous: user.isAnonymous,
};

await session.logout();
await deleteApp(app);
process.stdout.write(`${JSON.stringify(result)}\n`, () => process.exit(0));
