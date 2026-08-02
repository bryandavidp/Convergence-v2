import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const testRoot = path.dirname(fileURLToPath(import.meta.url));

function loadTypeScriptModule(relativePath) {
  const filename = path.isAbsolute(relativePath)
    ? relativePath
    : path.resolve(testRoot, relativePath);
  const cached = loadTypeScriptModule.cache.get(filename);
  if (cached !== undefined) return cached.exports;

  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loadTypeScriptModule.cache.set(filename, loaded);

  const defaultRequire = loaded.require.bind(loaded);
  loaded.require = (specifier) => {
    if (specifier === '@convergence/contracts') {
      return loadTypeScriptModule('../../../packages/contracts/src/index.ts');
    }
    // El transporte solo usa httpsCallable como valor por defecto; los tests
    // inyectan sus propios callables, así que no hace falta el SDK real.
    if (specifier === 'firebase/functions') {
      return { httpsCallable: () => { throw new Error('no debe usarse en tests'); } };
    }
    if (specifier.startsWith('.') && specifier.endsWith('.js')) {
      const sourceModule = path.resolve(
        path.dirname(filename),
        `${specifier.slice(0, -3)}.ts`,
      );
      if (fs.existsSync(sourceModule)) return loadTypeScriptModule(sourceModule);
    }
    return defaultRequire(specifier);
  };
  loaded._compile(outputText, filename);
  return loaded.exports;
}

loadTypeScriptModule.cache = new Map();

const { createFirebaseUserProfileTransport } = loadTypeScriptModule(
  '../src/online/user-profile-transport.ts',
);

const UID = 'uid-transport-001';

function profileDocument(revision = 3) {
  return {
    revision,
    profile: {
      schemaVersion: 1,
      uid: UID,
      displayName: 'Jugador',
      avatarIcon: 'nova',
      avatarBorder: 'starlight',
      theme: 'default',
      iconPack: 'cosmos',
      updatedAt: 1_800_000_000_000,
    },
  };
}

function recordsDocument(revision = 2) {
  return {
    revision,
    records: {
      schemaVersion: 1,
      uid: UID,
      survivalBest: 12_000,
      survivalBestWave: 10,
      adventureMaxLevel: 25,
      bestCombo: 9,
      updatedAt: 1_800_000_000_000,
    },
  };
}

function createCallables(overrides = {}) {
  const calls = [];
  const record = (name, data) => { calls.push({ name, data }); };
  return {
    calls,
    callables: {
      putProfile: async (data) => { record('putProfile', data); return { data: profileDocument(4) }; },
      putRecords: async (data) => { record('putRecords', data); return { data: recordsDocument(3) }; },
      getProfile: async (data) => { record('getProfile', data); return { data: profileDocument() }; },
      getRecords: async (data) => { record('getRecords', data); return { data: recordsDocument() }; },
      ...overrides,
    },
  };
}

function transport(overrides) {
  const { calls, callables } = createCallables(overrides);
  return { calls, transport: createFirebaseUserProfileTransport(null, callables) };
}

test('las lecturas devuelven el documento validado con su revisión', async () => {
  const { transport: t } = transport();

  const profile = await t.fetchRemoteProfile(UID);
  const records = await t.fetchRemoteRecords(UID);

  assert.equal(profile.revision, 3);
  assert.equal(profile.profile.displayName, 'Jugador');
  assert.equal(records.revision, 2);
  assert.equal(records.records.survivalBest, 12_000);
});

test('un documento inexistente se traduce a null, no a un error', async () => {
  const { transport: t } = transport({
    getProfile: async () => ({ data: null }),
    getRecords: async () => ({ data: undefined }),
  });

  assert.equal(await t.fetchRemoteProfile(UID), null);
  assert.equal(await t.fetchRemoteRecords(UID), null);
});

test('el uid no viaja en la petición: el servidor lo deriva de Auth', async () => {
  const { calls, transport: t } = transport();

  await t.fetchRemoteProfile(UID);
  await t.fetchRemoteRecords(UID);

  for (const call of calls) {
    assert.equal(call.data, undefined, `${call.name} no debe enviar identidad del cliente`);
  }
});

test('las escrituras reenvían el sobre CAS y devuelven la revisión aplicada', async () => {
  const { calls, transport: t } = transport();
  const write = {
    idempotencyKey: 'user-profile-update-v1:uid-transport-001:3:9f1c2ab3',
    baseRevision: 3,
    profile: profileDocument().profile,
  };

  const stored = await t.pushProfile(write);

  assert.equal(stored.revision, 4);
  assert.deepEqual(calls[0], { name: 'putProfile', data: write });
});

test('una respuesta que no cumple el contrato se rechaza en vez de propagarse', async () => {
  const { transport: t } = transport({
    getProfile: async () => ({ data: { revision: -1, profile: profileDocument().profile } }),
    putRecords: async () => ({ data: { revision: 1 } }),
  });

  await assert.rejects(() => t.fetchRemoteProfile(UID));
  await assert.rejects(() => t.pushRecords({
    idempotencyKey: 'user-records-update-v1:uid-transport-001:0:9f1c2ab3',
    baseRevision: 0,
    records: recordsDocument().records,
  }));
});
