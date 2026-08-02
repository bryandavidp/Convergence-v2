import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

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

const { JsonRepository } = loadTypeScriptModule('../src/storage/json-repository.ts');
const { Outbox } = loadTypeScriptModule('../src/storage/outbox.ts');
const { createFirebaseLegacyProgressTransport } = loadTypeScriptModule(
  '../src/online/legacy-progress-transport.ts',
);
const {
  LEGACY_PREVIEW_OUTBOX_KIND,
  LegacyProgressSyncCoordinator,
} = loadTypeScriptModule('../src/online/legacy-progress-sync.ts');

class MemoryStorage {
  values = new Map();
  async get(key) { return this.values.get(key) ?? null; }
  async set(key, value) { this.values.set(key, value); }
  async remove(key) { this.values.delete(key); }
}

function projection() {
  return {
    schemaVersion: 1,
    preferences: {
      board: 'classic',
      theme: 'default',
      skin: 'default',
      fx: 'default',
      avatarIcon: 'nova',
      avatarBorder: 'starlight',
      iconPack: 'cosmos',
    },
    progress: {
      level: 7,
      xp: 120,
      games: 3,
      totalRemoved: 40,
      adventureMaxLevel: 2,
      survivalBest: 1_500,
      survivalBestWave: 4,
      bestCombo: 8,
    },
    claimCounts: {
      achievements: 0,
      boards: 1,
      cosmetics: 0,
      chests: 0,
      modeRecords: 0,
    },
    quarantinedPayloadBytes: 128,
    unknownTopLevelFields: [],
  };
}

function previewResult(now) {
  return {
    protocolVersion: 1,
    status: 'ready',
    operationId: 'b'.repeat(64),
    policyVersion: 'legacy-cv-meta-v10/1',
    payloadFingerprint: 'a'.repeat(64),
    planHash: 'c'.repeat(64),
    baseRevision: 0,
    currentRevision: 0,
    nextRevision: 1,
    legacySchemaVersion: 10,
    projection: projection(),
    warnings: [
      'economy-quarantined',
      'ranked-scores-unverified',
      'temporary-state-quarantined',
    ],
    expiresAt: now + 900_000,
  };
}

function createHarness({ online = true, transport, initialRaw } = {}) {
  const storage = new MemoryStorage();
  const repository = new JsonRepository(storage, 'test');
  let now = 10_000;
  const outbox = new Outbox(repository, { now: () => now, random: () => 0 });
  const states = [];
  let isOnline = online;
  let raw = initialRaw === undefined ? JSON.stringify({
    _v: 10,
    level: 7,
    xp: 120,
    coins: 999_999,
  }) : initialRaw;
  const calls = { preview: 0, commit: 0 };
  const defaultTransport = {
    async preview() {
      calls.preview += 1;
      return previewResult(now);
    },
    async commit(input) {
      calls.commit += 1;
      return {
        protocolVersion: 1,
        status: 'committed',
        operationId: input.operationId,
        policyVersion: 'legacy-cv-meta-v10/1',
        payloadFingerprint: 'a'.repeat(64),
        fromRevision: 0,
        toRevision: 1,
        committedAt: now,
      };
    },
  };
  const coordinator = new LegacyProgressSyncCoordinator(
    'anonymous-owner-001',
    repository,
    outbox,
    transport ?? defaultTransport,
    {
      now: () => now,
      readLegacyMeta: () => raw,
      isOnline: () => isOnline,
      publish: (state) => states.push(state),
      setTimer: () => null,
      clearTimer: () => {},
    },
  );
  return {
    coordinator,
    repository,
    outbox,
    states,
    calls,
    setOnline(value) { isOnline = value; },
    setNow(value) { now = value; },
    setRaw(value) { raw = value; },
  };
}

test('preview queda pendiente de confirmación y commit incrementa una sola revisión', async () => {
  const harness = createHarness();
  await harness.coordinator.start();

  assert.equal(harness.coordinator.snapshot().status, 'awaiting-confirmation');
  assert.equal(harness.coordinator.snapshot().canConfirm, true);
  // La UI solo recibe el resumen presentacional: nunca economía ni cofres.
  assert.deepEqual(harness.coordinator.snapshot().preview, {
    level: 7,
    xp: 120,
    adventureMaxLevel: 2,
    achievements: 0,
    economyQuarantined: true,
  });
  assert.equal(harness.calls.preview, 1);
  assert.equal(harness.calls.commit, 0);
  assert.equal((await harness.outbox.list('anonymous-owner-001'))[0]?.status, 'awaiting-confirmation');

  await harness.coordinator.confirm();

  assert.deepEqual(harness.coordinator.snapshot(), {
    status: 'synced',
    serverRevision: 1,
    canConfirm: false,
    lastError: null,
    preview: null,
  });
  assert.equal(harness.calls.commit, 1);
  assert.deepEqual(await harness.outbox.list('anonymous-owner-001'), []);
});

test('offline conserva el comando durable y lo procesa al recuperar red', async () => {
  const harness = createHarness({ online: false });
  await harness.coordinator.start();

  assert.equal(harness.coordinator.snapshot().status, 'offline');
  assert.equal(harness.calls.preview, 0);
  assert.equal((await harness.outbox.list('anonymous-owner-001'))[0]?.status, 'queued');

  harness.setOnline(true);
  await harness.coordinator.notifyOnline();
  assert.equal(harness.calls.preview, 1);
  assert.equal(harness.coordinator.snapshot().status, 'awaiting-confirmation');
});

test('coalesce el burst inicial de cv_meta en una sola preview inmutable', async () => {
  const harness = createHarness({ online: false, initialRaw: null });
  await harness.coordinator.start();
  harness.setRaw(JSON.stringify({ _v: 10, level: 1, xp: 0 }));

  await Promise.all([
    harness.coordinator.captureLegacyMeta(),
    harness.coordinator.captureLegacyMeta(),
    harness.coordinator.captureLegacyMeta(),
  ]);
  harness.setRaw(JSON.stringify({ _v: 10, level: 2, xp: 10 }));
  await harness.coordinator.captureLegacyMeta();

  const pending = await harness.outbox.list('anonymous-owner-001');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].payload.payload.level, 1);
  assert.equal(harness.calls.preview, 0);
});

test('un conflicto de revisión se bloquea y no entra en bucle de reintentos', async () => {
  const transport = {
    async preview() {
      throw Object.assign(new Error('revision obsoleta'), { code: 'functions/aborted' });
    },
    async commit() { throw new Error('no debe llamarse'); },
  };
  const harness = createHarness({ transport });
  await harness.coordinator.start();

  assert.equal(harness.coordinator.snapshot().status, 'conflict');
  assert.equal((await harness.outbox.list('anonymous-owner-001'))[0]?.status, 'blocked-conflict');
});

test('nunca procesa una cola que pertenece a otro UID', async () => {
  const harness = createHarness();
  await harness.outbox.enqueue({
    id: 'preview:foreign-legacy-key-001',
    ownerUid: 'another-owner-001',
    kind: LEGACY_PREVIEW_OUTBOX_KIND,
    createdAt: 10_000,
    payload: {
      protocolVersion: 1,
      idempotencyKey: 'foreign-key-000001',
      baseRevision: 0,
      legacySchemaVersion: 10,
      payload: { _v: 10 },
    },
  });

  await harness.coordinator.start();

  assert.equal(harness.coordinator.snapshot().status, 'identity-mismatch');
  assert.equal(harness.calls.preview, 0);
});

test('el transporte valida las respuestas de ambas callables', async () => {
  const validPreview = previewResult(10_000);
  const transport = createFirebaseLegacyProgressTransport({}, {
    preview: async () => ({ data: validPreview }),
    commit: async () => ({ data: { ...validPreview, status: 'committed' } }),
  });
  const imported = {
    protocolVersion: 1,
    idempotencyKey: 'legacy-key-000001',
    baseRevision: 0,
    legacySchemaVersion: 10,
    payload: { _v: 10 },
  };

  assert.equal((await transport.preview(imported)).status, 'ready');
  await assert.rejects(
    transport.commit({
      protocolVersion: 1,
      idempotencyKey: 'legacy-key-000001',
      operationId: 'b'.repeat(64),
      policyVersion: 'legacy-cv-meta-v10/1',
      planHash: 'c'.repeat(64),
      baseRevision: 0,
      confirmation: true,
    }),
  );
});
