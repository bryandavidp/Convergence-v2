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

const {
  JsonRepository,
  JsonRepositoryDataError,
} = loadTypeScriptModule('../src/storage/json-repository.ts');
const {
  Outbox,
  OutboxIdentityConflictError,
  OutboxOwnershipError,
  calculateOutboxBackoff,
  classifyOutboxError,
} = loadTypeScriptModule('../src/storage/outbox.ts');

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

function createOutbox({ now = 1_000, random = 0, leaseMs = 100 } = {}) {
  const storage = new MemoryStorage();
  const repository = new JsonRepository(storage, 'test', () => now);
  const outbox = new Outbox(repository, {
    now: () => now,
    random: () => random,
    leaseMs,
    baseDelayMs: 1_000,
    maxDelayMs: 8_000,
  });
  return { storage, repository, outbox };
}

function operation(id, ownerUid = 'uid-a', createdAt = 1_000, payload = { value: 1 }) {
  return {
    id,
    ownerUid,
    kind: 'legacy-progress.preview.v1',
    createdAt,
    payload,
  };
}

test('JsonRepository serializa updates incluso entre instancias que comparten storage', async () => {
  const storage = new MemoryStorage();
  const first = new JsonRepository(storage, 'mutex');
  const second = new JsonRepository(storage, 'mutex');

  await Promise.all(Array.from({ length: 40 }, (_, index) => (
    (index % 2 === 0 ? first : second).update(
      'counter',
      async (current) => {
        await Promise.resolve();
        return { value: (current?.value ?? 0) + 1 };
      },
      (value) => typeof value === 'object'
        && value !== null
        && Number.isSafeInteger(value.value),
    )
  )));

  assert.deepEqual(await first.read('counter'), { value: 40 });
});

test('JsonRepository pone JSON corrupto e invalido en cuarentena', async () => {
  const storage = new MemoryStorage();
  const repository = new JsonRepository(storage, 'quarantine', () => 1234);
  storage.values.set('quarantine:profile', '{bad json');

  await assert.rejects(
    repository.read('profile', () => true),
    JsonRepositoryDataError,
  );
  assert.equal(storage.values.has('quarantine:profile'), false);
  assert.equal(storage.values.get('quarantine:profile.corrupt.1234'), '{bad json');

  storage.values.set('quarantine:profile', JSON.stringify({ version: 99 }));
  await assert.rejects(
    repository.read('profile', (value) => value?.version === 1),
    JsonRepositoryDataError,
  );
  assert.equal(
    storage.values.get('quarantine:profile.corrupt.1234'),
    JSON.stringify({ version: 99 }),
  );
});

test('enqueue concurrente no pierde operaciones y filtra por owner', async () => {
  const { storage } = createOutbox();
  const first = new Outbox(new JsonRepository(storage, 'test'), { now: () => 1_000 });
  const second = new Outbox(new JsonRepository(storage, 'test'), { now: () => 1_000 });
  const items = Array.from({ length: 20 }, (_, index) => operation(
    `operation-${String(index).padStart(4, '0')}`,
    index % 2 === 0 ? 'uid-a' : 'uid-b',
  ));

  const results = await Promise.all(items.map((item, index) => (
    (index % 2 === 0 ? first : second).enqueue(item)
  )));

  assert.equal(results.every((result) => result === 'inserted'), true);
  assert.equal((await first.list()).length, 20);
  assert.equal((await first.list('uid-a')).length, 10);
  assert.equal((await first.list('uid-b')).length, 10);
});

test('idempotencia exige mismo owner, kind y payload canonico', async () => {
  const { outbox } = createOutbox();
  const id = 'operation-idempotent-0001';
  assert.equal(await outbox.enqueue(operation(id, 'uid-a', 1_000, {
    alpha: 1,
    beta: 2,
  })), 'inserted');
  assert.equal(await outbox.enqueue(operation(id, 'uid-a', 1_000, {
    beta: 2,
    alpha: 1,
  })), 'duplicate');

  await assert.rejects(
    outbox.enqueue(operation(id, 'uid-a', 1_000, { alpha: 99 })),
    OutboxIdentityConflictError,
  );
  await assert.rejects(
    outbox.enqueue(operation(id, 'uid-b', 1_000, { alpha: 1, beta: 2 })),
    OutboxIdentityConflictError,
  );

  assert.equal(await outbox.enqueue(operation('operation-after-error-01')), 'inserted');
});

test('enqueue captura un snapshot inmutable del payload', async () => {
  const { outbox } = createOutbox();
  const payload = { nested: { value: 1 } };
  const enqueueing = outbox.enqueue(operation(
    'operation-snapshot-0001',
    'uid-a',
    1_000,
    payload,
  ));
  payload.nested.value = 99;
  await enqueueing;

  const [stored] = await outbox.list('uid-a');
  assert.deepEqual(stored.payload, { nested: { value: 1 } });
});

test('lease es exclusivo, incrementa intentos y se recupera tras expirar', async () => {
  const { outbox } = createOutbox({ leaseMs: 100 });
  await outbox.enqueue(operation('operation-lease-first', 'uid-a', 1_000));
  await outbox.enqueue(operation('operation-lease-second', 'uid-a', 1_001));

  const first = await outbox.leaseNext('uid-a', 1_010);
  assert.equal(first?.id, 'operation-lease-first');
  assert.equal(first?.attempts, 1);
  assert.equal(first?.leaseUntil, 1_110);

  const second = await outbox.leaseNext('uid-a', 1_010);
  assert.equal(second?.id, 'operation-lease-second');
  assert.equal(await outbox.leaseNext('uid-a', 1_010), null);

  const recovered = await outbox.leaseNext('uid-a', 1_110);
  assert.equal(recovered?.id, 'operation-lease-first');
  assert.equal(recovered?.attempts, 2);
});

test('releaseExpiredLeases recupera process death sin tocar leases activos', async () => {
  const { outbox } = createOutbox({ leaseMs: 100 });
  await outbox.enqueue(operation('operation-process-death'));
  await outbox.leaseNext('uid-a', 1_000);

  assert.equal(await outbox.releaseExpiredLeases(1_099), 0);
  assert.equal(await outbox.releaseExpiredLeases(1_100), 1);
  const [released] = await outbox.list('uid-a');
  assert.equal(released.status, 'queued');
  assert.equal(released.leaseUntil, null);
});

test('retry aplica backoff, jitter y Retry-After sin entregar antes de tiempo', async () => {
  const { outbox } = createOutbox({ random: 0 });
  await outbox.enqueue(operation('operation-retry-0001'));
  await outbox.leaseNext('uid-a', 1_000);

  const retrying = await outbox.retry(
    'operation-retry-0001',
    'uid-a',
    { code: 'functions/unavailable', message: 'offline', retryAfterMs: 5_000 },
    1_100,
  );
  assert.equal(retrying.status, 'retry-wait');
  assert.equal(retrying.nextAttemptAt, 6_100);
  assert.equal(retrying.lastError.retryable, true);
  assert.equal(await outbox.leaseNext('uid-a', 6_099), null);
  assert.equal((await outbox.leaseNext('uid-a', 6_100))?.attempts, 2);

  assert.equal(calculateOutboxBackoff(1, { random: () => 0 }), 500);
  assert.equal(calculateOutboxBackoff(4, {
    baseDelayMs: 1_000,
    maxDelayMs: 4_000,
    random: () => 1,
  }), 4_000);
});

test('errores auth, conflicto y permanentes terminan en estados diferenciados', async () => {
  const { outbox } = createOutbox();
  const cases = [
    ['operation-auth-error-01', { code: 'functions/unauthenticated' }, 'blocked-auth'],
    ['operation-conflict-01', { code: 'functions/aborted' }, 'blocked-conflict'],
    ['operation-invalid-0001', { code: 'functions/invalid-argument' }, 'failed-permanent'],
  ];

  for (const [id, error, status] of cases) {
    await outbox.enqueue(operation(id));
    await outbox.leaseNext('uid-a', 1_000);
    const item = await outbox.retry(id, 'uid-a', error, 1_010);
    assert.equal(item.status, status);
    assert.equal(item.leaseUntil, null);
  }

  assert.equal(await outbox.unblockAuth('uid-a', 1_100), 1);
  const authItem = (await outbox.list('uid-a'))
    .find((item) => item.id === 'operation-auth-error-01');
  assert.equal(authItem.status, 'queued');

  assert.deepEqual(classifyOutboxError({ httpStatus: 429 }).category, 'retry');
  assert.deepEqual(classifyOutboxError({ httpStatus: 403 }).category, 'permanent');
  assert.deepEqual(classifyOutboxError(new TypeError('network')).category, 'retry');
});

test('confirmacion, requeue y acknowledge respetan el owner', async () => {
  const { outbox } = createOutbox();
  const id = 'operation-confirm-0001';
  await outbox.enqueue(operation(id));
  await assert.rejects(
    outbox.acknowledge(id, 'uid-a'),
    /ni espera confirmacion/,
  );
  await assert.rejects(
    outbox.retry(id, 'uid-a', { code: 'functions/unavailable' }, 1_000),
    /lease activo/,
  );
  await outbox.leaseNext('uid-a', 1_000);

  const waiting = await outbox.markAwaitingConfirmation(id, 'uid-a', 1_010);
  assert.equal(waiting.status, 'awaiting-confirmation');
  assert.equal(await outbox.leaseNext('uid-a', 9_999), null);

  await assert.rejects(
    outbox.acknowledge(id, 'uid-b'),
    OutboxOwnershipError,
  );
  assert.equal((await outbox.list()).length, 1);

  const queued = await outbox.requeue(id, 'uid-a', 1_020);
  assert.equal(queued.status, 'queued');
  assert.equal((await outbox.leaseNext('uid-a', 1_020))?.id, id);
  assert.equal(await outbox.acknowledge(id, 'uid-a'), true);
  assert.equal(await outbox.acknowledge(id, 'uid-a'), false);
});

test('payloads no JSON y documentos persistidos invalidos se rechazan', async () => {
  const { storage, outbox } = createOutbox({ now: 2_000 });
  const cyclic = {};
  cyclic.self = cyclic;
  await assert.rejects(
    outbox.enqueue(operation('operation-cyclic-0001', 'uid-a', 1_000, cyclic)),
    /JSON finito/,
  );

  storage.values.set('test:outbox-v2', JSON.stringify({
    storageVersion: 999,
    items: [],
  }));
  await assert.rejects(outbox.list(), JsonRepositoryDataError);
  assert.equal(storage.values.has('test:outbox-v2'), false);
  assert.ok(storage.values.has('test:outbox-v2.corrupt.2000'));
});
