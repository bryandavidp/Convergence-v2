import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEGACY_PROGRESS_IMPORT_POLICY_VERSION,
} from '@convergence/contracts';
import {
  buildLegacyProgressProjection,
  canonicalJson,
  createLegacyProgressImportService,
  deriveLegacyImportOperationId,
  prepareLegacyProgressImport,
  sha256,
} from '../lib/legacy-progress.js';
import {
  commitLegacyProgressImport,
  previewLegacyProgressImport,
} from '../lib/index.js';

const FIXED_NOW = 1_800_000_000_000;

function validImport(overrides = {}) {
  return {
    protocolVersion: 1,
    idempotencyKey: 'legacy-import-unit-0001',
    baseRevision: 0,
    legacySchemaVersion: 10,
    payload: {
      _v: 10,
      level: 7,
      xp: 120,
      games: 3,
      totalRemoved: 40,
      boards: { owned: { classic: 1 }, equipped: 'classic' },
      cosmetics: {
        owned: {},
        theme: 'default',
        avatarIcon: 'nova',
        avatarBorder: 'starlight',
        iconPack: 'cosmos',
      },
      adventure: { maxLevel: 2 },
      stats: { bestCombo: 8 },
      survBest: 1_500,
      survBestWave: 4,
      achievements: {},
      modes: {},
      chestInventory: [],
    },
    ...overrides,
  };
}

function previewResult(input) {
  return {
    protocolVersion: 1,
    status: 'ready',
    operationId: input.operationId,
    policyVersion: LEGACY_PROGRESS_IMPORT_POLICY_VERSION,
    payloadFingerprint: input.payloadFingerprint,
    planHash: input.planHash,
    baseRevision: input.input.baseRevision,
    currentRevision: input.input.baseRevision,
    nextRevision: input.input.baseRevision + 1,
    legacySchemaVersion: 10,
    projection: input.projection,
    warnings: input.warnings,
    expiresAt: input.now + 15 * 60 * 1_000,
  };
}

test('canonicalJson ordena objetos recursivamente sin alterar el orden de arrays', () => {
  const left = {
    z: 3,
    nested: { beta: true, alpha: 'uno' },
    list: [{ y: 2, x: 1 }, 'fin'],
    a: null,
  };
  const right = {
    a: null,
    list: [{ x: 1, y: 2 }, 'fin'],
    nested: { alpha: 'uno', beta: true },
    z: 3,
  };

  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(
    canonicalJson(left),
    '{"a":null,"list":[{"x":1,"y":2},"fin"],"nested":{"alpha":"uno","beta":true},"z":3}',
  );
  assert.equal(sha256(canonicalJson(left)), sha256(canonicalJson(right)));
});

test('prepare canonicaliza fingerprints aunque cambie el orden de las claves', () => {
  const first = validImport({
    payload: { _v: 10, level: 3, xp: 40, nested: { z: 2, a: 1 } },
  });
  const second = validImport({
    payload: { nested: { a: 1, z: 2 }, xp: 40, level: 3, _v: 10 },
  });

  const preparedFirst = prepareLegacyProgressImport('unit-user', first);
  const preparedSecond = prepareLegacyProgressImport('unit-user', second);

  assert.equal(preparedFirst.payloadFingerprint, preparedSecond.payloadFingerprint);
  assert.equal(preparedFirst.requestFingerprint, preparedSecond.requestFingerprint);
  assert.equal(preparedFirst.planHash, preparedSecond.planHash);
  assert.equal(preparedFirst.operationId, preparedSecond.operationId);
  assert.deepEqual(preparedFirst.projection, preparedSecond.projection);
});

test('la proyeccion aplica catalogos, clamps y separa economia y temporales', () => {
  const input = validImport({
    payload: {
      _v: 10,
      level: 99_999,
      xp: 99_999_999,
      games: 99_999_999_999,
      totalRemoved: -8,
      coins: 800_000,
      gems: 400_000,
      tickets: 99,
      xpBoostUntil: FIXED_NOW + 1_000_000,
      boards: {
        owned: { classic: 1, jardin: '2026-01-01', falseEntry: 0 },
        equipped: '../inventado',
      },
      cosmetics: {
        owned: { neon: '2026-01-01', mono: '' },
        theme: 'neon',
        skin: 'forged-skin',
        fx: 'forged-fx',
        avatarIcon: 'void',
        avatarBorder: '<script>',
        iconPack: 'prismatic',
        avatarIcons: { nova: 1, void: '2026-01-01' },
        avatarBorders: { starlight: 1 },
        iconPacks: { cosmos: 1, prismatic: '2026-01-01' },
      },
      adventure: { maxLevel: -3 },
      stats: { bestCombo: 12.9 },
      survBest: Number.MAX_SAFE_INTEGER,
      survBestWave: '42',
      achievements: { first: '2026-01-01', combo10: '', perfect: 1 },
      modes: { clasico: { best: 100 }, contrarreloj: { best: 200 } },
      chestInventory: [{ uid: 'local-a' }, { uid: 'local-b' }],
      unknownZeta: true,
      unknownAlpha: { retainedOnlyInQuarantine: true },
    },
  });

  const projection = buildLegacyProgressProjection(input);

  assert.deepEqual(projection.preferences, {
    board: 'classic',
    theme: 'neon',
    skin: 'default',
    fx: 'default',
    avatarIcon: 'void',
    avatarBorder: 'starlight',
    iconPack: 'prismatic',
  });
  assert.deepEqual(projection.progress, {
    level: 10_000,
    xp: 2_500_049,
    games: 1_000_000_000,
    totalRemoved: 0,
    adventureMaxLevel: 1,
    survivalBest: 1_000_000_000_000,
    survivalBestWave: 42,
    bestCombo: 12,
  });
  assert.deepEqual(projection.claimCounts, {
    achievements: 2,
    boards: 2,
    cosmetics: 6,
    chests: 2,
    modeRecords: 2,
  });
  assert.deepEqual(projection.unknownTopLevelFields, [
    'unknownAlpha',
    'unknownZeta',
  ]);
  assert.equal('coins' in projection, false);
  assert.equal('gems' in projection, false);
  assert.equal('xpBoostUntil' in projection, false);
  assert.ok(projection.quarantinedPayloadBytes > 0);
});

test('el servicio rechaza parsing invalido antes de invocar el store', async () => {
  let called = false;
  const store = {
    async preview() {
      called = true;
      throw new Error('no debe ejecutarse');
    },
    async commit() {
      called = true;
      throw new Error('no debe ejecutarse');
    },
  };
  const service = createLegacyProgressImportService(store, () => FIXED_NOW);

  await assert.rejects(
    service.preview('unit-user', validImport({ payload: { _v: 9 } })),
    (error) => {
      assert.equal(error?.code, 'invalid-argument');
      assert.match(error?.message ?? '', /LegacyProgressImportV1/);
      assert.ok(Array.isArray(error?.details?.issues));
      return true;
    },
  );
  await assert.rejects(
    service.preview('unit-user', validImport({
      payload: { _v: 10, ['x'.repeat(129)]: true },
    })),
    (error) => error?.code === 'invalid-argument',
  );
  await assert.rejects(
    service.commit('unit-user', { protocolVersion: 1 }),
    (error) => error?.code === 'invalid-argument',
  );
  assert.equal(called, false);
});

test('preview prepara identidad derivada y delega una reclamacion completa al store', async () => {
  let captured;
  const store = {
    async preview(input) {
      captured = input;
      return previewResult(input);
    },
    async commit() {
      throw new Error('commit inesperado');
    },
  };
  const service = createLegacyProgressImportService(store, () => FIXED_NOW);
  const request = validImport();

  const result = await service.preview('unit-user', request);

  assert.equal(captured.uid, 'unit-user');
  assert.equal(captured.now, FIXED_NOW);
  assert.equal(
    captured.operationId,
    deriveLegacyImportOperationId('unit-user', request.idempotencyKey),
  );
  assert.equal(captured.ownerHash, sha256('unit-user'));
  assert.equal(captured.idempotencyKeyHash, sha256(request.idempotencyKey));
  assert.equal(result.status, 'ready');
  assert.equal(result.operationId, captured.operationId);
  assert.deepEqual(result.projection, captured.projection);
  assert.deepEqual(result.warnings, [
    'economy-quarantined',
    'ranked-scores-unverified',
    'temporary-state-quarantined',
  ]);
});

test('commit valida ownership del operationId y delega hashes, reloj y confirmacion', async () => {
  let captured;
  const store = {
    async preview() {
      throw new Error('preview inesperado');
    },
    async commit(input) {
      captured = input;
      return {
        protocolVersion: 1,
        status: 'committed',
        operationId: input.input.operationId,
        policyVersion: LEGACY_PROGRESS_IMPORT_POLICY_VERSION,
        payloadFingerprint: 'a'.repeat(64),
        fromRevision: input.input.baseRevision,
        toRevision: input.input.baseRevision + 1,
        committedAt: input.now,
      };
    },
  };
  const service = createLegacyProgressImportService(store, () => FIXED_NOW);
  const idempotencyKey = 'legacy-import-unit-commit';
  const operationId = deriveLegacyImportOperationId('unit-user', idempotencyKey);
  const commit = {
    protocolVersion: 1,
    idempotencyKey,
    operationId,
    policyVersion: LEGACY_PROGRESS_IMPORT_POLICY_VERSION,
    planHash: 'b'.repeat(64),
    baseRevision: 4,
    confirmation: true,
  };

  await assert.rejects(
    service.commit('other-user', commit),
    (error) => error?.code === 'invalid-argument',
  );
  assert.equal(captured, undefined);

  const result = await service.commit('unit-user', commit);
  assert.equal(result.status, 'committed');
  assert.equal(captured.uid, 'unit-user');
  assert.equal(captured.now, FIXED_NOW);
  assert.equal(captured.ownerHash, sha256('unit-user'));
  assert.equal(captured.idempotencyKeyHash, sha256(idempotencyKey));
  assert.deepEqual(captured.input, commit);
});

test('los callables rechazan identidad ausente antes de tocar Firestore', async () => {
  for (const callable of [previewLegacyProgressImport, commitLegacyProgressImport]) {
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
