import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
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

class MemoryStorage {
  values = new Map();

  async get(key) {
    await Promise.resolve();
    return this.values.get(key) ?? null;
  }

  async set(key, value) {
    await Promise.resolve();
    this.values.set(key, value);
  }

  async remove(key) {
    await Promise.resolve();
    this.values.delete(key);
  }
}

const { JsonRepository } = loadTypeScriptModule('../src/storage/json-repository.ts');
const { Outbox } = loadTypeScriptModule('../src/storage/outbox.ts');
const {
  UserProfileRepository,
  defaultUserBestRecords,
  defaultUserProfile,
} = loadTypeScriptModule('../src/storage/user-profile-repository.ts');
const {
  deriveIdempotencyKey,
  mergeUserBestRecords,
  UserProfileSyncCoordinator,
} = loadTypeScriptModule('../src/online/user-profile-sync.ts');
const { getAppCheckConfig } = loadTypeScriptModule('../src/online/app-check-config.ts');

const UID = 'uid-777';

function failure(code) {
  return Object.assign(new Error(`fallo simulado: ${code}`), { code });
}

/**
 * Servidor en memoria que se comporta como el real: rechaza si baseRevision ya
 * no está vigente y deduplica por idempotencyKey. Sin esto los tests sólo
 * comprobarían que el cliente se habla a sí mismo.
 */
function createServer({ profile = null, records = null } = {}) {
  const applied = new Map();
  const server = {
    profile,
    records,
    calls: { fetchProfile: 0, pushProfile: 0, fetchRecords: 0, pushRecords: 0 },
    // Deja que un test simule que otro dispositivo escribió a mitad de ciclo.
    onFetchRecords: null,
    transport: {
      fetchRemoteProfile: async () => {
        server.calls.fetchProfile += 1;
        return server.profile;
      },
      pushProfile: async (write) => {
        server.calls.pushProfile += 1;
        if (applied.has(write.idempotencyKey)) return applied.get(write.idempotencyKey);
        const current = server.profile === null ? 0 : server.profile.revision;
        if (write.baseRevision !== current) throw failure('failed-precondition');
        server.profile = { revision: current + 1, profile: write.profile };
        applied.set(write.idempotencyKey, server.profile);
        return server.profile;
      },
      fetchRemoteRecords: async () => {
        server.calls.fetchRecords += 1;
        if (server.onFetchRecords) server.onFetchRecords(server);
        return server.records;
      },
      pushRecords: async (write) => {
        server.calls.pushRecords += 1;
        if (applied.has(write.idempotencyKey)) return applied.get(write.idempotencyKey);
        const current = server.records === null ? 0 : server.records.revision;
        if (write.baseRevision !== current) throw failure('failed-precondition');
        server.records = { revision: current + 1, records: write.records };
        applied.set(write.idempotencyKey, server.records);
        return server.records;
      },
    },
  };
  return server;
}

function createHarness(server, { now = () => 5000 } = {}) {
  const jsonRepo = new JsonRepository(new MemoryStorage());
  const repository = new UserProfileRepository(jsonRepo, () => 1000);
  const outbox = new Outbox(jsonRepo);
  const coordinator = new UserProfileSyncCoordinator(
    UID,
    repository,
    outbox,
    server.transport,
    now,
  );
  return { repository, outbox, coordinator };
}

function records(overrides = {}) {
  return { ...defaultUserBestRecords(UID, 1000), ...overrides };
}

function profile(overrides = {}) {
  return { ...defaultUserProfile(UID, 1000), ...overrides };
}

test('mergeUserBestRecords combina conservadoramente usando max() por campo', () => {
  const merged = mergeUserBestRecords(
    records({ survivalBest: 5000, survivalBestWave: 10, adventureMaxLevel: 15, bestCombo: 5 }),
    records({ survivalBest: 8000, survivalBestWave: 8, adventureMaxLevel: 12, bestCombo: 9 }),
    3000,
  );
  assert.equal(merged.survivalBest, 8000);
  assert.equal(merged.survivalBestWave, 10);
  assert.equal(merged.adventureMaxLevel, 15);
  assert.equal(merged.bestCombo, 9);
  assert.equal(merged.updatedAt, 3000);
});

test('records: fusiona local y remoto y sube el resultado con la revisión vigente', async () => {
  const server = createServer({
    records: { revision: 4, records: records({ survivalBest: 9000, adventureMaxLevel: 25 }) },
  });
  const harness = createHarness(server);
  await harness.repository.saveBestRecords(records({ survivalBest: 12000 }));

  const outcome = await harness.coordinator.syncBestRecords();
  assert.equal(outcome.status, 'synced');
  assert.equal(outcome.value.survivalBest, 12000);
  assert.equal(outcome.value.adventureMaxLevel, 25);
  assert.equal(outcome.revision, 5, 'el servidor incrementa exactamente una revisión');
  assert.equal(server.records.records.survivalBest, 12000);
});

test('records: si el servidor ya contiene todo lo local no se escribe nada', async () => {
  const server = createServer({
    records: { revision: 7, records: records({ survivalBest: 9000, adventureMaxLevel: 25 }) },
  });
  const harness = createHarness(server);
  await harness.repository.saveBestRecords(records({ survivalBest: 100 }));

  const outcome = await harness.coordinator.syncBestRecords();
  assert.equal(outcome.status, 'synced');
  assert.equal(outcome.revision, 7);
  assert.equal(server.calls.pushRecords, 0, 'una sincronización sin novedad no debe escribir');
});

test('records: sincronizar dos veces seguidas no genera una segunda escritura', async () => {
  const server = createServer({ records: { revision: 1, records: records({ survivalBest: 10 }) } });
  const harness = createHarness(server);
  await harness.repository.saveBestRecords(records({ survivalBest: 12000 }));

  const first = await harness.coordinator.syncBestRecords();
  const second = await harness.coordinator.syncBestRecords();

  assert.equal(first.status, 'synced');
  assert.equal(second.status, 'synced');
  assert.equal(second.revision, first.revision, 'la revisión no puede crecer sin cambios reales');
  assert.equal(server.calls.pushRecords, 1, 'la sincronización debe quedar en reposo');
});

test('records: un conflicto de revisión se resuelve refusionando, sin perder marcas', async () => {
  const server = createServer({
    records: { revision: 1, records: records({ survivalBest: 500 }) },
  });
  const harness = createHarness(server);
  await harness.repository.saveBestRecords(records({ survivalBest: 12000 }));

  // Otro dispositivo escribe justo después del primer fetch: el CAS fallará.
  let raced = false;
  server.onFetchRecords = (state) => {
    if (raced) return;
    raced = true;
    state.records = { revision: 2, records: records({ survivalBest: 700, bestCombo: 42 }) };
  };

  const outcome = await harness.coordinator.syncBestRecords();
  assert.equal(outcome.status, 'synced');
  assert.equal(outcome.value.survivalBest, 12000, 'la marca local sobrevive al conflicto');
  assert.equal(outcome.value.bestCombo, 42, 'la marca ajena también sobrevive');
});

test('perfil: sin ediciones locales se adopta lo remoto sin declarar conflicto', async () => {
  const server = createServer({
    profile: { revision: 3, profile: profile({ displayName: 'Remoto', theme: 'theme-neon' }) },
  });
  const harness = createHarness(server);
  await harness.repository.saveProfileMirror(UID, {
    revision: 1,
    body: profile({ displayName: 'Local' }),
    dirty: false,
  });

  const outcome = await harness.coordinator.syncProfile();
  assert.equal(outcome.status, 'synced');
  assert.equal(outcome.value.displayName, 'Remoto');
  assert.equal(outcome.revision, 3);
  assert.equal(server.calls.pushProfile, 0);
});

test('perfil: con ediciones locales y servidor adelantado se declara conflicto sin pisar nada', async () => {
  const server = createServer({
    profile: { revision: 9, profile: profile({ displayName: 'Remoto' }) },
  });
  const harness = createHarness(server);
  await harness.repository.saveProfileMirror(UID, {
    revision: 4,
    body: profile({ displayName: 'Local' }),
    dirty: true,
  });

  const outcome = await harness.coordinator.syncProfile();
  assert.equal(outcome.status, 'conflict');
  assert.equal(outcome.value.displayName, 'Local', 'lo local se conserva');
  assert.equal(outcome.remote.displayName, 'Remoto', 'lo remoto se ofrece para decidir');
  assert.equal(server.calls.pushProfile, 0, 'un conflicto nunca escribe en el servidor');
  assert.equal(server.profile.profile.displayName, 'Remoto');

  const mirror = await harness.repository.loadProfileMirror(UID);
  assert.equal(mirror.body.displayName, 'Local');
  assert.equal(mirror.dirty, true, 'sigue pendiente de resolver');
});

test('perfil: la escritura lleva revisión base y clave idempotente derivada del contenido', async () => {
  const server = createServer();
  const harness = createHarness(server);
  const body = profile({ displayName: 'Nuevo' });
  await harness.repository.saveProfileMirror(UID, { revision: 0, body, dirty: true });

  const outcome = await harness.coordinator.syncProfile();
  assert.equal(outcome.status, 'synced');
  assert.equal(outcome.revision, 1);

  const expected = deriveIdempotencyKey('user-profile-update-v1', UID, 0, body);
  assert.equal(
    deriveIdempotencyKey('user-profile-update-v1', UID, 0, { ...body }),
    expected,
    'la clave no puede depender del orden de las propiedades',
  );
  assert.notEqual(
    deriveIdempotencyKey('user-profile-update-v1', UID, 1, body),
    expected,
    'otra revisión base es otra operación',
  );
});

test('un fallo transitorio encola en la outbox y no se pierde el progreso', async () => {
  const server = createServer();
  server.transport.fetchRemoteRecords = async () => { throw failure('unavailable'); };
  const harness = createHarness(server);
  await harness.repository.saveBestRecords(records({ survivalBest: 4242 }));

  const outcome = await harness.coordinator.syncBestRecords();
  assert.equal(outcome.status, 'offline');
  assert.equal(outcome.value.survivalBest, 4242);

  const queued = await harness.outbox.list(UID);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, 'user-records-update-v1');
});

test('un fallo de autenticación no se encola: reintentar no lo arregla', async () => {
  const server = createServer();
  server.transport.fetchRemoteProfile = async () => { throw failure('unauthenticated'); };
  const harness = createHarness(server);

  const outcome = await harness.coordinator.syncProfile();
  assert.equal(outcome.status, 'auth-required');
  assert.ok(outcome.error, 'el motivo se propaga a la UI');
  assert.deepEqual(await harness.outbox.list(UID), []);
});

test('getAppCheckConfig genera la configuracion adecuada para dev y prod', () => {
  const devConfig = getAppCheckConfig({ env: 'dev' });
  assert.equal(devConfig.mode, 'monitor');
  assert.equal(devConfig.provider, 'debug');

  const prodConfig = getAppCheckConfig({ env: 'prod' });
  assert.equal(prodConfig.mode, 'enforce');
  assert.equal(prodConfig.provider, 'play-integrity');
});
