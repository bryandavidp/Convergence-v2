import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

import { createFirestoreEnvironment } from './support.mjs';

let testEnv;

async function seedDocuments(documents) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const batch = db.batch();

    for (const [path, data] of Object.entries(documents)) {
      batch.set(db.doc(path), data);
    }

    await batch.commit();
  });
}

before(async () => {
  testEnv = await createFirestoreEnvironment();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv?.cleanup();
});

describe('Firestore rules', () => {
  it('allows public configuration and leaderboard entry reads without authentication', async () => {
    await seedDocuments({
      'publicConfig/current': { maintenance: false },
      'leaderboards/classic/entries/alice': { score: 42_000 },
    });

    const db = testEnv.unauthenticatedContext().firestore();
    const config = await assertSucceeds(db.doc('publicConfig/current').get());
    const entry = await assertSucceeds(db.doc('leaderboards/classic/entries/alice').get());
    const configList = await assertSucceeds(db.collection('publicConfig').get());
    const leaderboard = await assertSucceeds(
      db.collection('leaderboards/classic/entries').get(),
    );

    assert.equal(config.data().maintenance, false);
    assert.equal(entry.data().score, 42_000);
    assert.equal(configList.size, 1);
    assert.equal(leaderboard.size, 1);
  });

  it('denies every client write to public configuration and leaderboards', async () => {
    await seedDocuments({
      'publicConfig/current': { maintenance: false },
      'leaderboards/classic/entries/alice': { score: 42_000 },
    });

    const anonymous = testEnv.unauthenticatedContext().firestore();
    const alice = testEnv.authenticatedContext('alice').firestore();

    await assertFails(anonymous.doc('publicConfig/new').set({ maintenance: true }));
    await assertFails(alice.doc('publicConfig/current').update({ maintenance: true }));
    await assertFails(
      alice.doc('leaderboards/classic/entries/alice').set({ score: 999_999 }),
    );
    await assertFails(alice.doc('leaderboards/classic/entries/alice').delete());
  });

  it('allows an owner to read their user document and nested documents only', async () => {
    await seedDocuments({
      'users/alice': { displayName: 'Alice' },
      'users/alice/private/economy': { coins: 500 },
      'users/bob': { displayName: 'Bob' },
    });

    const alice = testEnv.authenticatedContext('alice').firestore();
    const bob = testEnv.authenticatedContext('bob').firestore();
    const anonymous = testEnv.unauthenticatedContext().firestore();

    await assertSucceeds(alice.doc('users/alice').get());
    await assertSucceeds(alice.doc('users/alice/private/economy').get());
    await assertFails(alice.doc('users/bob').get());
    await assertFails(bob.doc('users/alice').get());
    await assertFails(anonymous.doc('users/alice').get());
  });

  it('denies user writes even when the caller owns the document', async () => {
    await seedDocuments({
      'users/alice': { displayName: 'Alice' },
      'users/alice/private/economy': { coins: 500 },
    });

    const alice = testEnv.authenticatedContext('alice').firestore();

    await assertFails(alice.doc('users/alice').update({ displayName: 'Admin Alice' }));
    await assertFails(alice.doc('users/alice/private/economy').update({ coins: 999_999 }));
    await assertFails(alice.doc('users/alice/inventory/new-item').set({ owned: true }));
    await assertFails(alice.doc('users/alice').delete());
  });

  it('allows room reads only to members and rejects malformed membership data', async () => {
    await seedDocuments({
      'rooms/room-1': { memberIds: ['alice', 'bob'], state: 'open' },
      'rooms/room-2': { memberIds: ['carol'], state: 'open' },
      'rooms/malformed': { memberIds: { alice: true }, state: 'open' },
    });

    const alice = testEnv.authenticatedContext('alice').firestore();
    const carol = testEnv.authenticatedContext('carol').firestore();
    const anonymous = testEnv.unauthenticatedContext().firestore();

    await assertSucceeds(alice.doc('rooms/room-1').get());
    await assertFails(carol.doc('rooms/room-1').get());
    await assertFails(anonymous.doc('rooms/room-1').get());
    await assertFails(alice.doc('rooms/malformed').get());
  });

  it('denies room collection queries, including membership-constrained queries', async () => {
    await seedDocuments({
      'rooms/room-1': { memberIds: ['alice', 'bob'], state: 'open' },
      'rooms/room-2': { memberIds: ['carol'], state: 'open' },
    });

    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(
      db.collection('rooms').where('memberIds', 'array-contains', 'alice').get(),
    );
    await assertFails(db.collection('rooms').get());
  });

  it('allows match reads only to members', async () => {
    await seedDocuments({
      'matches/match-1': { memberIds: ['alice', 'bob'], status: 'playing' },
    });

    const alice = testEnv.authenticatedContext('alice').firestore();
    const carol = testEnv.authenticatedContext('carol').firestore();
    const anonymous = testEnv.unauthenticatedContext().firestore();

    await assertSucceeds(alice.doc('matches/match-1').get());
    await assertFails(carol.doc('matches/match-1').get());
    await assertFails(anonymous.doc('matches/match-1').get());
  });

  it('denies all room and match writes, including writes by members', async () => {
    await seedDocuments({
      'rooms/room-1': { memberIds: ['alice', 'bob'], state: 'open' },
      'matches/match-1': { memberIds: ['alice', 'bob'], status: 'playing' },
    });

    const alice = testEnv.authenticatedContext('alice').firestore();

    await assertFails(alice.doc('rooms/room-1').update({ state: 'playing' }));
    await assertFails(alice.doc('rooms/new-room').set({ memberIds: ['alice'] }));
    await assertFails(alice.doc('matches/match-1').update({ status: 'finished' }));
    await assertFails(alice.doc('matches/match-1').delete());
  });

  it('denies unknown paths by default', async () => {
    await seedDocuments({
      'internal/secrets': { value: 'server-only' },
      'legacyImportPreviews/operation': { ownerHash: 'private' },
      'legacyImportPayloads/operation': { payloadJson: '{"_v":10}' },
      'legacyImportReceipts/operation': { ownerHash: 'private' },
      'legacyImportPreviewLocks/owner': { activeUntil: 0 },
    });

    const anonymous = testEnv.unauthenticatedContext().firestore();
    const alice = testEnv.authenticatedContext('alice').firestore();

    await assertFails(anonymous.doc('internal/secrets').get());
    await assertFails(alice.doc('internal/secrets').get());
    for (const path of [
      'legacyImportPreviews/operation',
      'legacyImportPayloads/operation',
      'legacyImportReceipts/operation',
      'legacyImportPreviewLocks/owner',
    ]) {
      await assertFails(anonymous.doc(path).get());
      await assertFails(alice.doc(path).get());
      await assertFails(alice.doc(path).set({ compromised: true }));
    }
    await assertFails(alice.doc('unknown/document').set({ value: true }));
  });
});
