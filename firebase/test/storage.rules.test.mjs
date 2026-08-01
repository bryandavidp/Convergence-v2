import { after, before, beforeEach, describe, it } from 'node:test';

import { assertFails } from '@firebase/rules-unit-testing';

import { createStorageEnvironment, STORAGE_BUCKET } from './support.mjs';

let testEnv;

function storageFor(context) {
  return context.storage(STORAGE_BUCKET);
}

async function seedObject(path, value = 'server-owned') {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await storageFor(context)
      .ref(path)
      .putString(value, 'raw', { contentType: 'text/plain' });
  });
}

before(async () => {
  testEnv = await createStorageEnvironment();
});

beforeEach(async () => {
  await testEnv.clearStorage();
});

after(async () => {
  await testEnv?.cleanup();
});

describe('Cloud Storage rules', () => {
  it('denies uploads for anonymous and authenticated clients on every path', async () => {
    const anonymous = storageFor(testEnv.unauthenticatedContext());
    const alice = storageFor(testEnv.authenticatedContext('alice'));

    await assertFails(anonymous.ref('public/readme.txt').putString('public'));
    await assertFails(alice.ref('avatars/alice/avatar.png').putString('avatar'));
    await assertFails(alice.ref('replays/match-1.json').putString('{}'));
    await assertFails(alice.ref('unknown/file.txt').putString('unknown'));
  });

  it('denies reads of existing objects for anonymous and authenticated clients', async () => {
    await seedObject('avatars/alice/avatar.txt');

    const anonymous = storageFor(testEnv.unauthenticatedContext());
    const alice = storageFor(testEnv.authenticatedContext('alice'));

    await assertFails(anonymous.ref('avatars/alice/avatar.txt').getMetadata());
    await assertFails(alice.ref('avatars/alice/avatar.txt').getMetadata());
    await assertFails(alice.ref('avatars/alice/avatar.txt').getDownloadURL());
  });

  it('denies listing and deletion for authenticated clients', async () => {
    await seedObject('replays/match-1.json', '{}');

    const alice = storageFor(testEnv.authenticatedContext('alice'));

    await assertFails(alice.ref('replays').listAll());
    await assertFails(alice.ref('replays/match-1.json').delete());
  });
});
