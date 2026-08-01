import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

import { createDatabaseEnvironment, DATABASE_URL } from './support.mjs';

let testEnv;

function databaseFor(context) {
  return context.database(DATABASE_URL);
}

async function seedDatabase(path, value) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const database = databaseFor(context);
    await (path ? database.ref(path) : database.ref()).set(value);
  });
}

before(async () => {
  testEnv = await createDatabaseEnvironment();
});

beforeEach(async () => {
  await testEnv.clearDatabase();
});

after(async () => {
  await testEnv?.cleanup();
});

describe('Realtime Database rules', () => {
  it('allows an authenticated user to read an individual presence record', async () => {
    await seedDatabase('presence/alice', {
      state: 'online',
      lastChanged: 1_700_000_000_000,
    });

    const bob = databaseFor(testEnv.authenticatedContext('bob'));
    const snapshot = await assertSucceeds(bob.ref('presence/alice').once('value'));

    assert.deepEqual(snapshot.val(), {
      state: 'online',
      lastChanged: 1_700_000_000_000,
    });
  });

  it('denies anonymous presence reads and parent collection reads', async () => {
    await seedDatabase('presence/alice', {
      state: 'online',
      lastChanged: 1_700_000_000_000,
    });

    const anonymous = databaseFor(testEnv.unauthenticatedContext());
    const alice = databaseFor(testEnv.authenticatedContext('alice'));

    await assertFails(anonymous.ref('presence/alice').once('value'));
    await assertFails(alice.ref('presence').once('value'));
  });

  it('allows an owner to create and update a valid presence record', async () => {
    const alice = databaseFor(testEnv.authenticatedContext('alice'));
    const presence = alice.ref('presence/alice');

    await assertSucceeds(
      presence.set({ state: 'online', lastChanged: 1_700_000_000_000 }),
    );
    await assertSucceeds(presence.update({ state: 'away', lastChanged: 1_700_000_001_000 }));

    const snapshot = await assertSucceeds(presence.once('value'));
    assert.equal(snapshot.child('state').val(), 'away');
  });

  it('denies presence writes by anonymous users and other users', async () => {
    const value = { state: 'online', lastChanged: 1_700_000_000_000 };
    const anonymous = databaseFor(testEnv.unauthenticatedContext());
    const bob = databaseFor(testEnv.authenticatedContext('bob'));

    await assertFails(anonymous.ref('presence/alice').set(value));
    await assertFails(bob.ref('presence/alice').set(value));
  });

  it('validates required fields, field types, state values and extra fields', async () => {
    const presence = databaseFor(testEnv.authenticatedContext('alice')).ref('presence/alice');

    await assertFails(presence.set({ state: 'online' }));
    await assertFails(presence.set({ state: 'busy', lastChanged: 1_700_000_000_000 }));
    await assertFails(presence.set({ state: 'away', lastChanged: 'now' }));
    await assertFails(
      presence.set({
        state: 'offline',
        lastChanged: 1_700_000_000_000,
        role: 'admin',
      }),
    );

    await assertSucceeds(
      presence.set({ state: 'offline', lastChanged: 1_700_000_000_000 }),
    );
  });

  it('allows an owner to delete their presence record', async () => {
    await seedDatabase('presence/alice', {
      state: 'offline',
      lastChanged: 1_700_000_000_000,
    });

    const presence = databaseFor(testEnv.authenticatedContext('alice')).ref('presence/alice');

    await assertSucceeds(presence.remove());
  });

  it('allows room and match reads only to authenticated members', async () => {
    await seedDatabase('', {
      rooms: {
        'room-1': {
          memberIds: { alice: true, bob: true },
          state: 'open',
        },
      },
      matches: {
        'match-1': {
          memberIds: { alice: true, bob: true },
          status: 'playing',
        },
      },
    });

    const alice = databaseFor(testEnv.authenticatedContext('alice'));
    const carol = databaseFor(testEnv.authenticatedContext('carol'));
    const anonymous = databaseFor(testEnv.unauthenticatedContext());

    await assertSucceeds(alice.ref('rooms/room-1').once('value'));
    await assertSucceeds(alice.ref('matches/match-1').once('value'));
    await assertFails(carol.ref('rooms/room-1').once('value'));
    await assertFails(carol.ref('matches/match-1').once('value'));
    await assertFails(anonymous.ref('rooms/room-1').once('value'));
    await assertFails(anonymous.ref('matches/match-1').once('value'));
    await assertFails(alice.ref('rooms').once('value'));
    await assertFails(alice.ref('matches').once('value'));
  });

  it('denies every client write to rooms and matches', async () => {
    await seedDatabase('', {
      rooms: { 'room-1': { memberIds: { alice: true }, state: 'open' } },
      matches: { 'match-1': { memberIds: { alice: true }, status: 'playing' } },
    });

    const alice = databaseFor(testEnv.authenticatedContext('alice'));

    await assertFails(alice.ref('rooms/room-1/state').set('playing'));
    await assertFails(
      alice.ref('rooms/new-room').set({ memberIds: { alice: true }, state: 'open' }),
    );
    await assertFails(alice.ref('matches/match-1/status').set('finished'));
    await assertFails(alice.ref('matches/match-1').remove());
  });

  it('denies unknown paths by default', async () => {
    await seedDatabase('internal/secret', 'server-only');

    const alice = databaseFor(testEnv.authenticatedContext('alice'));
    const anonymous = databaseFor(testEnv.unauthenticatedContext());

    await assertFails(alice.ref('internal/secret').once('value'));
    await assertFails(anonymous.ref('internal/secret').once('value'));
    await assertFails(alice.ref('unknown/path').set(true));
  });
});
