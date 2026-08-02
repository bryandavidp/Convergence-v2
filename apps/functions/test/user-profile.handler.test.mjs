import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createUserProfileService,
  deriveProfileOperationId,
} from '../lib/user-profile.js';
import { putUserBestRecords, putUserProfile } from '../lib/index.js';

const FIXED_NOW = 1_800_000_000_000;
const UID = 'uid-cloud-001';

function profile(overrides = {}) {
  return {
    schemaVersion: 1,
    uid: UID,
    displayName: 'Jugador',
    avatarIcon: 'nova',
    avatarBorder: 'starlight',
    theme: 'default',
    iconPack: 'cosmos',
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function write(overrides = {}) {
  return {
    idempotencyKey: 'user-profile-update-v1:uid-cloud-001:0:9f1c2ab3',
    baseRevision: 0,
    profile: profile(),
    ...overrides,
  };
}

/** Store en memoria que aplica el CAS igual que la transacción de Firestore. */
function createStore({ revision = 0, ownerHash = null } = {}) {
  const receipts = new Map();
  const state = { revision, ownerHash, body: null };
  return {
    state,
    calls: { putProfile: 0 },
    async putProfile(input) {
      this.calls.putProfile += 1;
      const receipt = receipts.get(input.operationId);
      if (receipt !== undefined) {
        if (receipt.bodyFingerprint !== input.bodyFingerprint) {
          throw Object.assign(new Error('reused key'), { code: 'already-exists' });
        }
        return { revision: receipt.toRevision, profile: input.body };
      }
      if (state.revision !== input.baseRevision) {
        throw Object.assign(new Error('revision changed'), { code: 'aborted' });
      }
      state.revision += 1;
      state.ownerHash = input.ownerHash;
      state.body = input.body;
      receipts.set(input.operationId, {
        bodyFingerprint: input.bodyFingerprint,
        toRevision: state.revision,
      });
      return { revision: state.revision, profile: input.body };
    },
    async putRecords() {
      throw new Error('no usado en este test');
    },
    async getProfile() {
      return state.body === null ? null : { revision: state.revision, profile: state.body };
    },
    async getRecords() {
      return null;
    },
  };
}

function service(store) {
  return createUserProfileService(store, () => FIXED_NOW);
}

test('los callables de perfil rechazan identidad ausente antes de tocar Firestore', async () => {
  for (const callable of [putUserProfile, putUserBestRecords]) {
    await assert.rejects(
      callable.run({ data: {}, auth: undefined }),
      (error) => {
        assert.equal(error?.code, 'unauthenticated');
        assert.equal(error?.message, 'Authentication required.');
        return true;
      },
    );
  }
});

test('una escritura válida aplica el CAS y devuelve la revisión incrementada', async () => {
  const store = createStore();
  const stored = await service(store).putProfile(UID, write());

  assert.equal(stored.revision, 1);
  assert.equal(stored.profile.displayName, 'Jugador');
  assert.equal(store.state.revision, 1);
});

test('reintentar la misma operación no aplica el cambio dos veces', async () => {
  const store = createStore();
  const svc = service(store);

  const first = await svc.putProfile(UID, write());
  const second = await svc.putProfile(UID, write());

  assert.equal(first.revision, 1);
  assert.equal(second.revision, 1, 'el reintento devuelve la revisión ya aplicada');
  assert.equal(store.state.revision, 1, 'el documento solo avanzó una vez');
});

test('la misma clave con otro contenido se rechaza en vez de sobrescribir', async () => {
  const store = createStore();
  const svc = service(store);
  await svc.putProfile(UID, write());

  await assert.rejects(
    () => svc.putProfile(UID, write({ profile: profile({ displayName: 'Otro' }) })),
    (error) => error.code === 'already-exists',
  );
});

test('una revisión base caducada produce conflicto y no escribe', async () => {
  const store = createStore({ revision: 5 });

  await assert.rejects(
    () => service(store).putProfile(UID, write({ baseRevision: 2 })),
    (error) => error.code === 'aborted',
  );
  assert.equal(store.state.revision, 5, 'el documento no se tocó');
});

test('un cuerpo con otro uid se rechaza: la identidad sale de Auth', async () => {
  const store = createStore();

  await assert.rejects(
    () => service(store).putProfile(UID, write({ profile: profile({ uid: 'uid-ajeno' }) })),
    (error) => error.code === 'permission-denied',
  );
  assert.equal(store.calls.putProfile, 0, 'no debe llegar siquiera al store');
});

test('un payload que no cumple el contrato se rechaza antes de tocar el store', async () => {
  const store = createStore();
  const svc = service(store);

  await assert.rejects(
    () => svc.putProfile(UID, { baseRevision: 0, profile: profile() }),
    (error) => error.code === 'invalid-argument',
  );
  await assert.rejects(
    () => svc.putProfile(UID, write({ baseRevision: -1 })),
    (error) => error.code === 'invalid-argument',
  );
  assert.equal(store.calls.putProfile, 0);
});

test('la lectura devuelve null mientras no exista documento y el estado tras escribir', async () => {
  const store = createStore();
  const svc = service(store);

  assert.equal(await svc.getProfile(UID), null, 'sin documento no es un error');

  await svc.putProfile(UID, write());
  const stored = await svc.getProfile(UID);

  assert.equal(stored.revision, 1);
  assert.equal(stored.profile.displayName, 'Jugador');
});

test('la operación se deriva del uid autenticado y del carril', () => {
  const key = 'user-profile-update-v1:uid-cloud-001:0:9f1c2ab3';
  const mine = deriveProfileOperationId(UID, 'profile', key);

  assert.notEqual(
    mine,
    deriveProfileOperationId('uid-ajeno', 'profile', key),
    'dos usuarios con la misma clave no pueden compartir operación',
  );
  assert.notEqual(
    mine,
    deriveProfileOperationId(UID, 'records', key),
    'perfil y marcas son operaciones distintas',
  );
});
