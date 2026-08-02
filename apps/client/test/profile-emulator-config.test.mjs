import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { PROFILE_EMULATOR_BUILD_CONFIG } from '../scripts/profile-emulator-build-config.mjs';

const testRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(testRoot, '..', '..', '..');

test('la configuracion Profile Emulator queda limitada a Auth y Functions en loopback', () => {
  assert.deepEqual(PROFILE_EMULATOR_BUILD_CONFIG, {
    artifactName: 'dist-profile-emulator',
    entryPoint: 'src/online/profile-emulator-bootstrap.ts',
    bundlePrefix: 'profile-emulator',
    connectOrigins: [
      'http://127.0.0.1:9099',
      'http://127.0.0.1:5001',
    ],
  });
  assert.equal(Object.isFrozen(PROFILE_EMULATOR_BUILD_CONFIG), true);
  assert.equal(Object.isFrozen(PROFILE_EMULATOR_BUILD_CONFIG.connectOrigins), true);
  for (const origin of PROFILE_EMULATOR_BUILD_CONFIG.connectOrigins) {
    const url = new URL(origin);
    assert.equal(url.protocol, 'http:');
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.pathname, '/');
  }
});

test('los puertos del artefacto coinciden con Emulator Suite y no cambian Hosting', async () => {
  const firebaseConfig = JSON.parse(
    await readFile(resolve(workspaceRoot, 'firebase.json'), 'utf8'),
  );
  assert.equal(firebaseConfig.emulators.auth.port, 9099);
  assert.equal(firebaseConfig.emulators.functions.port, 5001);
  assert.equal(firebaseConfig.emulators.singleProjectMode, true);
  assert.notEqual(firebaseConfig.hosting.public, 'apps/client/dist-profile-emulator');
});
