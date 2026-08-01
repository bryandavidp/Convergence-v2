import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_LEGACY_PROGRESS_PAYLOAD_BYTES,
  MAX_LEGACY_PROGRESS_PAYLOAD_NODES,
  legacyProgressCommitV1Schema,
  legacyProgressCommitResultV1Schema,
  legacyProgressImportV1Schema,
  legacyProgressPreviewResultV1Schema,
  legacyProgressProjectionV1Schema,
} from '../dist/index.js';

function validImport(overrides = {}) {
  return {
    protocolVersion: 1,
    idempotencyKey: 'legacy-import-000001',
    baseRevision: 0,
    legacySchemaVersion: 10,
    payload: {
      _v: 10,
      level: 7,
      xp: 120,
      chestInventory: [{ uid: 'ch-local-1', type: 'wood' }],
    },
    ...overrides,
  };
}

test('LegacyProgressImportV1 acepta un cv_meta v10 y conserva UID locales de cofres', () => {
  const parsed = legacyProgressImportV1Schema.parse(validImport());

  assert.equal(parsed.protocolVersion, 1);
  assert.equal(parsed.legacySchemaVersion, 10);
  assert.equal(parsed.payload._v, 10);
  assert.equal(parsed.payload.chestInventory[0].uid, 'ch-local-1');
});

test('rechaza versiones de protocolo, envelope y payload incorrectas', () => {
  assert.equal(
    legacyProgressImportV1Schema.safeParse(validImport({ protocolVersion: 2 })).success,
    false,
  );
  assert.equal(
    legacyProgressImportV1Schema.safeParse(validImport({ legacySchemaVersion: 9 })).success,
    false,
  );
  assert.equal(
    legacyProgressImportV1Schema.safeParse(validImport({ payload: { _v: 9 } })).success,
    false,
  );
});

test('rechaza cualquier UID de usuario aportado por el cliente en el envelope', () => {
  for (const identityField of ['uid', 'userId', 'authUid']) {
    const result = legacyProgressImportV1Schema.safeParse({
      ...validImport(),
      [identityField]: 'uid-de-otra-persona',
    });
    assert.equal(result.success, false, `${identityField} no puede aceptarse`);
  }
});

test('rechaza payloads por encima del límite UTF-8', () => {
  const result = legacyProgressImportV1Schema.safeParse(validImport({
    payload: {
      _v: 10,
      oversized: 'x'.repeat(MAX_LEGACY_PROGRESS_PAYLOAD_BYTES),
    },
  }));

  assert.equal(result.success, false);
});

test('rechaza prototipos personalizados en envelope y payload', () => {
  const forgedEnvelope = Object.assign(
    Object.create({ uid: 'uid-heredado' }),
    validImport(),
  );
  const forgedPayload = Object.assign(Object.create({ coins: 999_999 }), { _v: 10 });

  assert.equal(legacyProgressImportV1Schema.safeParse(forgedEnvelope).success, false);
  assert.equal(
    legacyProgressImportV1Schema.safeParse(validImport({ payload: forgedPayload })).success,
    false,
  );
});

test('rechaza primitivos por debajo del límite máximo de profundidad', () => {
  let nested = 'demasiado-profundo';
  for (let depth = 0; depth < 32; depth += 1) nested = [nested];

  assert.equal(
    legacyProgressImportV1Schema.safeParse(validImport({
      payload: { _v: 10, nested },
    })).success,
    false,
  );
});

test('rechaza getters, Symbols y campos ocultos del envelope sin ejecutar código', () => {
  let getterExecuted = false;
  const accessorEnvelope = validImport();
  Object.defineProperty(accessorEnvelope, 'payload', {
    enumerable: true,
    get() {
      getterExecuted = true;
      return { _v: 10 };
    },
  });

  const symbolEnvelope = validImport();
  symbolEnvelope[Symbol('authUid')] = 'uid-oculto';

  const hiddenEnvelope = validImport();
  Object.defineProperty(hiddenEnvelope, 'authUid', {
    enumerable: false,
    value: 'uid-oculto',
  });

  assert.equal(legacyProgressImportV1Schema.safeParse(accessorEnvelope).success, false);
  assert.equal(getterExecuted, false);
  assert.equal(legacyProgressImportV1Schema.safeParse(symbolEnvelope).success, false);
  assert.equal(legacyProgressImportV1Schema.safeParse(hiddenEnvelope).success, false);
});

test('rechaza claves de prototype pollution y accesores sin ejecutarlos', () => {
  const polluted = JSON.parse('{"_v":10,"nested":{"__proto__":{"admin":true}}}');
  const constructorField = { _v: 10, nested: { constructor: { prototype: {} } } };
  let getterExecuted = false;
  const accessorPayload = { _v: 10 };
  Object.defineProperty(accessorPayload, 'coins', {
    enumerable: true,
    get() {
      getterExecuted = true;
      return 999_999;
    },
  });

  assert.equal(
    legacyProgressImportV1Schema.safeParse(validImport({ payload: polluted })).success,
    false,
  );
  assert.equal(
    legacyProgressImportV1Schema.safeParse(validImport({ payload: constructorField })).success,
    false,
  );
  assert.equal(
    legacyProgressImportV1Schema.safeParse(validImport({ payload: accessorPayload })).success,
    false,
  );
  assert.equal(getterExecuted, false);
});

test('rechaza valores no JSON, arrays dispersos, ciclos y revisiones inválidas', () => {
  const cyclic = { _v: 10 };
  cyclic.self = cyclic;
  const sparse = [];
  sparse.length = 2;
  const emptyTopLevelKey = JSON.parse('{"_v":10,"":true}');
  const oversizedTopLevelKey = { _v: 10, ['x'.repeat(129)]: true };

  for (const payload of [
    { _v: 10, invalid: undefined },
    { _v: 10, invalid: Number.POSITIVE_INFINITY },
    { _v: 10, invalid: 1n },
    { _v: 10, invalid: sparse },
    emptyTopLevelKey,
    oversizedTopLevelKey,
    cyclic,
  ]) {
    assert.equal(
      legacyProgressImportV1Schema.safeParse(validImport({ payload })).success,
      false,
    );
  }

  assert.equal(
    legacyProgressImportV1Schema.safeParse(validImport({ baseRevision: -1 })).success,
    false,
  );
  assert.equal(
    legacyProgressImportV1Schema.safeParse(validImport({
      baseRevision: Number.MAX_SAFE_INTEGER + 1,
    })).success,
    false,
  );
});

function validProjection(overrides = {}) {
  const projection = {
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
      achievements: 2,
      boards: 1,
      cosmetics: 3,
      chests: 1,
      modeRecords: 2,
    },
    quarantinedPayloadBytes: 256,
    unknownTopLevelFields: [],
  };
  return { ...projection, ...overrides };
}

function validPreview(overrides = {}) {
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
    projection: validProjection(),
    warnings: [
      'economy-quarantined',
      'ranked-scores-unverified',
      'temporary-state-quarantined',
    ],
    expiresAt: 1_722_000_900_000,
    ...overrides,
  };
}

function validCommit(overrides = {}) {
  return {
    protocolVersion: 1,
    idempotencyKey: 'legacy-import-000001',
    operationId: 'b'.repeat(64),
    policyVersion: 'legacy-cv-meta-v10/1',
    planHash: 'c'.repeat(64),
    baseRevision: 0,
    confirmation: true,
    ...overrides,
  };
}

function validCommitResult(status = 'committed', overrides = {}) {
  return {
    protocolVersion: 1,
    status,
    operationId: 'b'.repeat(64),
    policyVersion: 'legacy-cv-meta-v10/1',
    payloadFingerprint: 'a'.repeat(64),
    fromRevision: 0,
    toRevision: 1,
    committedAt: 1_722_000_000_000,
    ...overrides,
  };
}

test('preview ready es estricto, versionado y no expone identidad', () => {
  const preview = legacyProgressPreviewResultV1Schema.parse(validPreview());

  assert.equal(preview.status, 'ready');
  assert.equal(preview.policyVersion, 'legacy-cv-meta-v10/1');
  assert.equal(preview.projection.progress.level, 7);
  assert.equal('uid' in preview, false);
  assert.equal(
    legacyProgressPreviewResultV1Schema.safeParse({
      ...validPreview(),
      uid: 'forged',
    }).success,
    false,
  );
});

test('commit confirma un plan previo sin aceptar payload ni identidad', () => {
  const commit = legacyProgressCommitV1Schema.parse(validCommit());

  assert.equal(commit.confirmation, true);
  assert.equal('payload' in commit, false);
  for (const forged of [
    { payload: { _v: 10, coins: 999_999 } },
    { uid: 'uid-de-otra-persona' },
    { confirmation: false },
  ]) {
    assert.equal(
      legacyProgressCommitV1Schema.safeParse({ ...validCommit(), ...forged }).success,
      false,
    );
  }
});

test('resultados commit distinguen primera aplicación de retry idempotente', () => {
  for (const status of ['committed', 'already-committed']) {
    const result = legacyProgressCommitResultV1Schema.parse(validCommitResult(status));
    assert.equal(result.status, status);
    assert.equal(result.fromRevision, 0);
    assert.equal(result.toRevision, 1);
  }

  assert.equal(
    legacyProgressCommitResultV1Schema.safeParse({
      ...validCommitResult(),
      projection: validProjection(),
    }).success,
    false,
  );
});

test('preview y commit rechazan hashes, políticas y warnings abiertos', () => {
  for (const invalidPreview of [
    { payloadFingerprint: 'no-es-sha256' },
    { operationId: 'A'.repeat(64) },
    { planHash: 'c'.repeat(63) },
    { policyVersion: 'legacy-cv-meta-v10/2' },
    { warnings: ['warning-inventado'] },
    { status: 'preview' },
  ]) {
    assert.equal(
      legacyProgressPreviewResultV1Schema.safeParse({
        ...validPreview(),
        ...invalidPreview,
      }).success,
      false,
    );
  }

  assert.equal(
    legacyProgressCommitV1Schema.safeParse({
      ...validCommit(),
      planHash: 'no-es-sha256',
    }).success,
    false,
  );
});

test('import y commit rechazan idempotencyKey inseguras y aceptan sus bordes', () => {
  for (const idempotencyKey of [
    'corta',
    'legacy/import-000001',
    '../legacy-import-000001',
    'legacy import 000001',
    'legacy-import-\n0001',
    'importación-000001',
    'x'.repeat(97),
  ]) {
    assert.equal(
      legacyProgressImportV1Schema.safeParse(validImport({ idempotencyKey })).success,
      false,
      `el envelope no debe aceptar ${JSON.stringify(idempotencyKey)}`,
    );
    assert.equal(
      legacyProgressCommitV1Schema.safeParse(validCommit({ idempotencyKey })).success,
      false,
      `el commit no debe aceptar ${JSON.stringify(idempotencyKey)}`,
    );
  }

  for (const idempotencyKey of ['a'.repeat(12), 'Z'.repeat(96)]) {
    assert.equal(
      legacyProgressImportV1Schema.safeParse(validImport({ idempotencyKey })).success,
      true,
    );
    assert.equal(
      legacyProgressCommitV1Schema.safeParse(validCommit({ idempotencyKey })).success,
      true,
    );
  }
});

test('proyección aplica la invariante level/xp y sus límites superiores', () => {
  const maximumProgress = {
    ...validProjection().progress,
    level: 10_000,
    xp: 2_500_049,
  };
  assert.equal(
    legacyProgressProjectionV1Schema.safeParse(validProjection({
      progress: maximumProgress,
    })).success,
    true,
  );

  for (const progress of [
    { ...validProjection().progress, level: 10_001 },
    { ...validProjection().progress, level: 7, xp: 1_800 },
    { ...validProjection().progress, level: 1, xp: 300 },
  ]) {
    assert.equal(
      legacyProgressProjectionV1Schema.safeParse(validProjection({ progress })).success,
      false,
    );
  }
});

test('proyección limita contadores, claims, bytes y campos desconocidos', () => {
  const boundary = validProjection();
  boundary.progress.games = 1_000_000_000;
  boundary.progress.survivalBest = 1_000_000_000_000;
  boundary.claimCounts.achievements = MAX_LEGACY_PROGRESS_PAYLOAD_NODES;
  boundary.quarantinedPayloadBytes = MAX_LEGACY_PROGRESS_PAYLOAD_BYTES;
  boundary.unknownTopLevelFields = Array.from(
    { length: 256 },
    (_, index) => `future_${index}`,
  );
  assert.equal(legacyProgressProjectionV1Schema.safeParse(boundary).success, true);

  const invalidCases = [];
  const excessiveCounter = validProjection();
  excessiveCounter.progress.games = 1_000_000_001;
  invalidCases.push(excessiveCounter);
  const excessiveScore = validProjection();
  excessiveScore.progress.survivalBest = 1_000_000_000_001;
  invalidCases.push(excessiveScore);
  const excessiveClaims = validProjection();
  excessiveClaims.claimCounts.achievements = MAX_LEGACY_PROGRESS_PAYLOAD_NODES + 1;
  invalidCases.push(excessiveClaims);
  const excessiveBytes = validProjection();
  excessiveBytes.quarantinedPayloadBytes = MAX_LEGACY_PROGRESS_PAYLOAD_BYTES + 1;
  invalidCases.push(excessiveBytes);
  const excessiveUnknownFields = validProjection();
  excessiveUnknownFields.unknownTopLevelFields = Array.from(
    { length: 257 },
    (_, index) => `future_${index}`,
  );
  invalidCases.push(excessiveUnknownFields);
  const unsafePreference = validProjection();
  unsafePreference.preferences.board = '../otro';
  invalidCases.push(unsafePreference);
  invalidCases.push({ ...validProjection(), extraCanonicalField: true });

  for (const projection of invalidCases) {
    assert.equal(legacyProgressProjectionV1Schema.safeParse(projection).success, false);
  }
});

test('preview y commit exigen un unico incremento coherente de revision', () => {
  for (const revisions of [
    { baseRevision: 1, currentRevision: 0 },
    { currentRevision: 0, nextRevision: 0 },
    { currentRevision: 2, nextRevision: 4, baseRevision: 2 },
  ]) {
    assert.equal(
      legacyProgressPreviewResultV1Schema.safeParse({
        ...validPreview(),
        ...revisions,
      }).success,
      false,
    );
  }

  for (const revisions of [
    { fromRevision: 0, toRevision: 0 },
    { fromRevision: 2, toRevision: 4 },
  ]) {
    assert.equal(
      legacyProgressCommitResultV1Schema.safeParse({
        ...validCommitResult(),
        ...revisions,
      }).success,
      false,
    );
  }
});
