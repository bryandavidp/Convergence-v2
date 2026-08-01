import { createHash } from 'node:crypto';

import type {
  LegacyProgressCommitResultV1,
  LegacyProgressCommitV1,
  LegacyProgressImportV1,
  LegacyProgressPreviewResultV1,
  LegacyProgressProjectionV1,
} from '@convergence/contracts';
import {
  LEGACY_CLOUD_PROFILE_SCHEMA_VERSION,
  LEGACY_PROGRESS_IMPORT_POLICY_VERSION,
  LEGACY_PROGRESS_SCHEMA_VERSION,
  MAX_LEGACY_PROGRESS_PAYLOAD_NODES,
  legacyProgressCommitResultV1Schema,
  legacyProgressCommitV1Schema,
  legacyProgressImportV1Schema,
  legacyProgressPreviewResultV1Schema,
  legacyProgressProjectionV1Schema,
} from '@convergence/contracts';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

export const LEGACY_IMPORT_PREVIEW_TTL_MS = 15 * 60 * 1_000;
export const LEGACY_IMPORT_QUARANTINE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const LEGACY_IMPORT_RATE_WINDOW_MS = 60 * 60 * 1_000;
export const LEGACY_IMPORT_MAX_PREVIEWS_PER_WINDOW = 3;

const MAX_IMPORTED_COUNTER = 1_000_000_000;
const MAX_IMPORTED_SCORE = 1_000_000_000_000;
const MAX_IMPORTED_LEVEL = 10_000;
const SAFE_PREFERENCE_ID = /^[A-Za-z0-9_-]+$/;
const LEGACY_IMPORT_KIND = 'legacy-progress-import-v1';

const boardCatalog = new Set([
  'classic', 'jardin', 'madera', 'hielo', 'lava', 'cristal', 'magico',
  'futurista', 'dorado', 'bosque', 'cosmico',
]);
const themeCatalog = new Set(['default', 'neon', 'sunset', 'forest', 'aurora', 'mono']);
const avatarIconCatalog = new Set([
  'nova', 'comet', 'prism', 'sentinel', 'nebula', 'orbit', 'flare', 'crystal',
  'void', 'pulse',
]);
const avatarBorderCatalog = new Set([
  'starlight', 'plasma', 'royal', 'aurora', 'comet', 'crystal', 'eclipse',
  'circuit', 'bloom', 'mythic',
]);
const iconPackCatalog = new Set([
  'cosmos', 'basic-redesigned', 'gem-pattern', 'nature-basic',
  'nature-advanced', 'neon', 'marine', 'magic', 'prismatic', 'elemental',
]);

const knownTopLevelFields = new Set([
  '_v',
  'achievements',
  'adventure',
  'boards',
  'boosterStock',
  'chestInventory',
  'chestNotifiedReady',
  'chestPipeline',
  'chestReady',
  'chestSeq',
  'chestSlots',
  'chestUnlock',
  'chests',
  'coins',
  'cosmetics',
  'daily',
  'dailyChest',
  'dailyRun',
  'games',
  'gems',
  'level',
  'mastery',
  'modes',
  'reward',
  'stats',
  'streak',
  'surv',
  'survBest',
  'survBestWave',
  'survBestWaves',
  'tickets',
  'totalRemoved',
  'weekly',
  'worlds',
  'xp',
  'xpBoostUntil',
  'zen',
]);

interface ProfileState {
  revision: number;
  legacyFingerprint: string | null;
}

export interface PreparedLegacyImport {
  input: LegacyProgressImportV1;
  operationId: string;
  ownerHash: string;
  idempotencyKeyHash: string;
  payloadFingerprint: string;
  requestFingerprint: string;
  planHash: string;
  projection: LegacyProgressProjectionV1;
  warnings: LegacyProgressPreviewResultV1['warnings'];
}

export interface PreviewStoreInput extends PreparedLegacyImport {
  uid: string;
  now: number;
}

export interface CommitStoreInput {
  uid: string;
  now: number;
  ownerHash: string;
  idempotencyKeyHash: string;
  input: LegacyProgressCommitV1;
}

export interface LegacyProgressImportStore {
  preview(input: PreviewStoreInput): Promise<LegacyProgressPreviewResultV1>;
  commit(input: CommitStoreInput): Promise<LegacyProgressCommitResultV1>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON canónico determinista; el contrato de entrada ya excluye valores no JSON. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function deriveLegacyImportOperationId(uid: string, idempotencyKey: string): string {
  return sha256(`${uid}\0${idempotencyKey}`);
}

function assertNow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HttpsError('internal', 'El reloj del servicio es inválido.');
  }
  return value;
}

function counter(value: unknown, fallback = 0, maximum = MAX_IMPORTED_COUNTER): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.min(maximum, Math.floor(number));
}

function claimCount(value: unknown): number {
  return counter(value, 0, MAX_LEGACY_PROGRESS_PAYLOAD_NODES);
}

function preference(
  value: unknown,
  catalog: ReadonlySet<string>,
  fallback: string,
): string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 64
    && SAFE_PREFERENCE_ID.test(value)
    && catalog.has(value)
    ? value
    : fallback;
}

function countTruthyMap(value: unknown): number {
  if (!isRecord(value)) return 0;
  return Math.min(
    MAX_LEGACY_PROGRESS_PAYLOAD_NODES,
    Object.values(value).filter(Boolean).length,
  );
}

export function buildLegacyProgressProjection(
  input: LegacyProgressImportV1,
): LegacyProgressProjectionV1 {
  const payload = input.payload as Record<string, unknown>;
  const boards = isRecord(payload.boards) ? payload.boards : {};
  const cosmetics = isRecord(payload.cosmetics) ? payload.cosmetics : {};
  const stats = isRecord(payload.stats) ? payload.stats : {};
  const adventure = isRecord(payload.adventure) ? payload.adventure : {};
  const modes = isRecord(payload.modes) ? payload.modes : {};
  const level = Math.max(1, counter(payload.level, 1, MAX_IMPORTED_LEVEL));
  const xpForNextLevel = 300 + (level - 1) * 250;

  const cosmeticOwnership = Math.min(
    MAX_LEGACY_PROGRESS_PAYLOAD_NODES,
    [
      cosmetics.owned,
      cosmetics.avatarIcons,
      cosmetics.avatarBorders,
      cosmetics.iconPacks,
    ].reduce<number>((total, map) => total + countTruthyMap(map), 0),
  );

  return legacyProgressProjectionV1Schema.parse({
    schemaVersion: LEGACY_CLOUD_PROFILE_SCHEMA_VERSION,
    preferences: {
      board: preference(boards.equipped, boardCatalog, 'classic'),
      theme: preference(cosmetics.theme, themeCatalog, 'default'),
      // `skin` y `fx` aún no tienen catálogo/uso real en schema 10.
      skin: 'default',
      fx: 'default',
      avatarIcon: preference(cosmetics.avatarIcon, avatarIconCatalog, 'nova'),
      avatarBorder: preference(
        cosmetics.avatarBorder,
        avatarBorderCatalog,
        'starlight',
      ),
      iconPack: preference(cosmetics.iconPack, iconPackCatalog, 'cosmos'),
    },
    progress: {
      level,
      xp: counter(payload.xp, 0, xpForNextLevel - 1),
      games: counter(payload.games),
      totalRemoved: counter(payload.totalRemoved),
      adventureMaxLevel: Math.max(
        1,
        counter(adventure.maxLevel, 1, MAX_IMPORTED_LEVEL),
      ),
      survivalBest: counter(payload.survBest, 0, MAX_IMPORTED_SCORE),
      survivalBestWave: counter(payload.survBestWave),
      bestCombo: counter(stats.bestCombo),
    },
    claimCounts: {
      achievements: countTruthyMap(payload.achievements),
      boards: countTruthyMap(boards.owned),
      cosmetics: cosmeticOwnership,
      chests: Array.isArray(payload.chestInventory)
        ? Math.min(payload.chestInventory.length, MAX_LEGACY_PROGRESS_PAYLOAD_NODES)
        : claimCount(payload.chests),
      modeRecords: Math.min(
        Object.keys(modes).length,
        MAX_LEGACY_PROGRESS_PAYLOAD_NODES,
      ),
    },
    quarantinedPayloadBytes: Buffer.byteLength(canonicalJson(input.payload), 'utf8'),
    unknownTopLevelFields: Object.keys(payload)
      .filter((key) => !knownTopLevelFields.has(key))
      .sort()
      .slice(0, 256),
  });
}

function buildWarnings(
  projection: LegacyProgressProjectionV1,
): LegacyProgressPreviewResultV1['warnings'] {
  const warnings: LegacyProgressPreviewResultV1['warnings'] = [
    'economy-quarantined',
    'ranked-scores-unverified',
    'temporary-state-quarantined',
  ];
  if (projection.unknownTopLevelFields.length > 0) {
    warnings.push('unknown-fields-ignored');
  }
  return warnings;
}

function buildPlanHash(
  policyVersion: typeof LEGACY_PROGRESS_IMPORT_POLICY_VERSION,
  payloadFingerprint: string,
  baseRevision: number,
  projection: LegacyProgressProjectionV1,
  warnings: LegacyProgressPreviewResultV1['warnings'],
): string {
  return sha256(canonicalJson({
    policyVersion,
    payloadFingerprint,
    baseRevision,
    projection,
    warnings,
  }));
}

function invalidArgument(message: string, issues: unknown): HttpsError {
  return new HttpsError('invalid-argument', message, { issues });
}

function parseImport(input: unknown): LegacyProgressImportV1 {
  const result = legacyProgressImportV1Schema.safeParse(input);
  if (!result.success) {
    throw invalidArgument(
      'LegacyProgressImportV1 inválido.',
      result.error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

function parseCommit(input: unknown): LegacyProgressCommitV1 {
  const result = legacyProgressCommitV1Schema.safeParse(input);
  if (!result.success) {
    throw invalidArgument(
      'LegacyProgressCommitV1 inválido.',
      result.error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function prepareLegacyProgressImport(
  uid: string,
  data: unknown,
): PreparedLegacyImport {
  const input = parseImport(data);
  const payloadFingerprint = sha256(canonicalJson(input.payload));
  const projection = buildLegacyProgressProjection(input);
  const warnings = buildWarnings(projection);
  const operationId = deriveLegacyImportOperationId(uid, input.idempotencyKey);
  const planHash = buildPlanHash(
    LEGACY_PROGRESS_IMPORT_POLICY_VERSION,
    payloadFingerprint,
    input.baseRevision,
    projection,
    warnings,
  );

  return {
    input,
    operationId,
    ownerHash: sha256(uid),
    idempotencyKeyHash: sha256(input.idempotencyKey),
    payloadFingerprint,
    requestFingerprint: sha256(canonicalJson(input)),
    planHash,
    projection,
    warnings,
  };
}

function assertRevision(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new HttpsError('internal', 'El perfil contiene una revisión inválida.');
  }
  return Number(value);
}

function profileStateFromData(data: unknown): ProfileState {
  if (!isRecord(data)) return { revision: 0, legacyFingerprint: null };
  if (
    data.schemaVersion !== undefined
    && data.schemaVersion !== LEGACY_CLOUD_PROFILE_SCHEMA_VERSION
  ) {
    throw new HttpsError(
      'internal',
      'El perfil usa una versión no compatible; requiere migración explícita.',
    );
  }
  const legacyImport = isRecord(data.legacyImport) ? data.legacyImport : null;
  const fingerprint = legacyImport?.payloadFingerprint;
  return {
    revision: assertRevision(data.revision),
    legacyFingerprint: typeof fingerprint === 'string' ? fingerprint : null,
  };
}

function conflictForRevision(expected: number, received: number): HttpsError {
  return new HttpsError(
    'aborted',
    'La revisión del perfil cambió; vuelve a previsualizar la importación.',
    { expectedRevision: expected, receivedRevision: received },
  );
}

function assertOwner(
  data: Record<string, unknown>,
  expectedOwnerHash: string,
): void {
  if (data.ownerHash !== expectedOwnerHash) {
    throw new HttpsError('internal', 'Colisión de identidad en la importación legacy.');
  }
}

function storedPreviewResult(data: Record<string, unknown>): LegacyProgressPreviewResultV1 {
  const parsed = legacyProgressPreviewResultV1Schema.safeParse(data.result);
  if (!parsed.success) {
    throw new HttpsError('internal', 'La previsualización almacenada es inválida.');
  }
  const result = parsed.data;
  const derivedPlanHash = buildPlanHash(
    result.policyVersion,
    result.payloadFingerprint,
    result.baseRevision,
    result.projection,
    result.warnings,
  );
  if (
    data.operationId !== result.operationId
    || data.policyVersion !== result.policyVersion
    || data.payloadFingerprint !== result.payloadFingerprint
    || data.planHash !== result.planHash
    || data.baseRevision !== result.baseRevision
    || data.legacySchemaVersion !== result.legacySchemaVersion
    || result.planHash !== derivedPlanHash
  ) {
    throw new HttpsError('internal', 'La previsualización almacenada es incoherente.');
  }
  return result;
}

function storedCommitResult(data: Record<string, unknown>): LegacyProgressCommitResultV1 {
  const parsed = legacyProgressCommitResultV1Schema.safeParse(data.result);
  if (!parsed.success) {
    throw new HttpsError('internal', 'El recibo almacenado es inválido.');
  }
  const result = parsed.data;
  if (
    data.operationId !== result.operationId
    || data.policyVersion !== result.policyVersion
    || data.payloadFingerprint !== result.payloadFingerprint
    || data.baseRevision !== result.fromRevision
  ) {
    throw new HttpsError('internal', 'El recibo almacenado es incoherente.');
  }
  return result;
}

function assertStoredPayload(
  data: Record<string, unknown>,
  expectedOwnerHash: string,
  expectedRequestFingerprint: string,
  expectedPayloadFingerprint: string,
): void {
  assertOwner(data, expectedOwnerHash);
  if (
    data.requestFingerprint !== expectedRequestFingerprint
    || data.payloadFingerprint !== expectedPayloadFingerprint
    || typeof data.payloadJson !== 'string'
    || sha256(data.payloadJson) !== expectedPayloadFingerprint
  ) {
    throw new HttpsError('internal', 'El payload legacy almacenado es incoherente.');
  }
}

function requiredDocumentData(
  data: Record<string, unknown> | undefined,
  label: string,
): Record<string, unknown> {
  if (data === undefined) {
    throw new HttpsError('internal', `${label} existe sin datos.`);
  }
  return data;
}

class FirestoreLegacyProgressImportStore implements LegacyProgressImportStore {
  async preview(input: PreviewStoreInput): Promise<LegacyProgressPreviewResultV1> {
    const firestore = getFirestore();
    const profileRef = firestore.collection('users').doc(input.uid);
    const previewRef = firestore.collection('legacyImportPreviews').doc(input.operationId);
    const payloadRef = firestore.collection('legacyImportPayloads').doc(input.operationId);
    const receiptRef = firestore.collection('legacyImportReceipts').doc(input.operationId);
    const lockRef = firestore.collection('legacyImportPreviewLocks').doc(input.ownerHash);

    return firestore.runTransaction(async (transaction) => {
      const [
        profileSnapshot,
        previewSnapshot,
        payloadSnapshot,
        receiptSnapshot,
        lockSnapshot,
      ] =
        await Promise.all([
          transaction.get(profileRef),
          transaction.get(previewRef),
          transaction.get(payloadRef),
          transaction.get(receiptRef),
          transaction.get(lockRef),
        ]);
      const state = profileSnapshot.exists
        ? profileStateFromData(profileSnapshot.data())
        : { revision: 0, legacyFingerprint: null };

      if (receiptSnapshot.exists) {
        const receipt = requiredDocumentData(receiptSnapshot.data(), 'El recibo');
        assertOwner(receipt, input.ownerHash);
        if (receipt.requestFingerprint !== input.requestFingerprint) {
          throw new HttpsError(
            'already-exists',
            'La idempotency key ya se usó con otra petición.',
          );
        }
        throw new HttpsError(
          'failed-precondition',
          'Esta importación legacy ya fue confirmada.',
          { operationId: input.operationId },
        );
      }

      if (previewSnapshot.exists) {
        const preview = requiredDocumentData(
          previewSnapshot.data(),
          'La previsualización',
        );
        assertOwner(preview, input.ownerHash);
        if (preview.requestFingerprint !== input.requestFingerprint) {
          throw new HttpsError(
            'already-exists',
            'La idempotency key ya se usó con otra petición.',
          );
        }
        const result = storedPreviewResult(preview);
        if (preview.status !== 'ready' || result.expiresAt <= input.now) {
          throw new HttpsError(
            'failed-precondition',
            'La previsualización ha expirado; crea una nueva idempotency key.',
          );
        }
        if (!payloadSnapshot.exists) {
          throw new HttpsError('internal', 'Falta el payload de la previsualización activa.');
        }
        assertStoredPayload(
          requiredDocumentData(payloadSnapshot.data(), 'El payload'),
          input.ownerHash,
          input.requestFingerprint,
          input.payloadFingerprint,
        );
        return result;
      }

      if (payloadSnapshot.exists) {
        throw new HttpsError('internal', 'Existe un payload sin tombstone de previsualización.');
      }

      if (state.legacyFingerprint !== null) {
        throw new HttpsError(
          'failed-precondition',
          'El perfil ya contiene una importación legacy.',
        );
      }
      if (input.input.baseRevision !== state.revision) {
        throw conflictForRevision(state.revision, input.input.baseRevision);
      }

      const lock = lockSnapshot.exists
        ? requiredDocumentData(lockSnapshot.data(), 'El bloqueo de previsualización')
        : {};
      assertOwnerOrNewLock(lock, input.ownerHash);
      const activeOperationId = typeof lock.activeOperationId === 'string'
        ? lock.activeOperationId
        : null;
      const activeUntil = safeStoredMillis(lock.activeUntil);
      if (
        activeOperationId !== null
        && activeOperationId !== input.operationId
        && activeUntil > input.now
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Ya existe otra previsualización legacy activa.',
          { activeUntil },
        );
      }

      const storedWindowStart = safeStoredMillis(lock.windowStartedAt);
      const inCurrentWindow = storedWindowStart > 0
        && input.now - storedWindowStart < LEGACY_IMPORT_RATE_WINDOW_MS;
      const windowStartedAt = inCurrentWindow ? storedWindowStart : input.now;
      const previewCount = inCurrentWindow
        ? safeStoredCount(lock.previewCount)
        : 0;
      if (previewCount >= LEGACY_IMPORT_MAX_PREVIEWS_PER_WINDOW) {
        throw new HttpsError(
          'resource-exhausted',
          'Se alcanzó el límite temporal de previsualizaciones legacy.',
          { retryAt: windowStartedAt + LEGACY_IMPORT_RATE_WINDOW_MS },
        );
      }

      const expiresAt = input.now + LEGACY_IMPORT_PREVIEW_TTL_MS;
      const result = legacyProgressPreviewResultV1Schema.parse({
        protocolVersion: 1,
        status: 'ready',
        operationId: input.operationId,
        policyVersion: LEGACY_PROGRESS_IMPORT_POLICY_VERSION,
        payloadFingerprint: input.payloadFingerprint,
        planHash: input.planHash,
        baseRevision: input.input.baseRevision,
        currentRevision: state.revision,
        nextRevision: state.revision + 1,
        legacySchemaVersion: LEGACY_PROGRESS_SCHEMA_VERSION,
        projection: input.projection,
        warnings: input.warnings,
        expiresAt,
      });

      transaction.create(previewRef, {
        schemaVersion: 1,
        kind: LEGACY_IMPORT_KIND,
        status: 'ready',
        operationId: input.operationId,
        ownerHash: input.ownerHash,
        idempotencyKeyHash: input.idempotencyKeyHash,
        requestFingerprint: input.requestFingerprint,
        payloadFingerprint: input.payloadFingerprint,
        planHash: input.planHash,
        policyVersion: LEGACY_PROGRESS_IMPORT_POLICY_VERSION,
        baseRevision: input.input.baseRevision,
        legacySchemaVersion: LEGACY_PROGRESS_SCHEMA_VERSION,
        result,
        createdAtMillis: input.now,
        commitDeadline: Timestamp.fromMillis(expiresAt),
        commitDeadlineMillis: expiresAt,
      });
      transaction.create(payloadRef, {
        schemaVersion: 1,
        kind: LEGACY_IMPORT_KIND,
        operationId: input.operationId,
        ownerHash: input.ownerHash,
        requestFingerprint: input.requestFingerprint,
        payloadFingerprint: input.payloadFingerprint,
        payloadJson: canonicalJson(input.input.payload),
        createdAtMillis: input.now,
        deleteAt: Timestamp.fromMillis(expiresAt),
      });
      transaction.set(lockRef, {
        schemaVersion: 1,
        ownerHash: input.ownerHash,
        activeOperationId: input.operationId,
        activeUntil: expiresAt,
        windowStartedAt,
        previewCount: previewCount + 1,
        updatedAtMillis: input.now,
      });

      return result;
    });
  }

  async commit(input: CommitStoreInput): Promise<LegacyProgressCommitResultV1> {
    const firestore = getFirestore();
    const profileRef = firestore.collection('users').doc(input.uid);
    const previewRef = firestore.collection('legacyImportPreviews').doc(input.input.operationId);
    const payloadRef = firestore.collection('legacyImportPayloads').doc(input.input.operationId);
    const receiptRef = firestore.collection('legacyImportReceipts').doc(input.input.operationId);
    const lockRef = firestore.collection('legacyImportPreviewLocks').doc(input.ownerHash);

    return firestore.runTransaction(async (transaction) => {
      const [
        profileSnapshot,
        previewSnapshot,
        payloadSnapshot,
        receiptSnapshot,
        lockSnapshot,
      ] =
        await Promise.all([
          transaction.get(profileRef),
          transaction.get(previewRef),
          transaction.get(payloadRef),
          transaction.get(receiptRef),
          transaction.get(lockRef),
        ]);

      if (receiptSnapshot.exists) {
        const receipt = requiredDocumentData(receiptSnapshot.data(), 'El recibo');
        assertOwner(receipt, input.ownerHash);
        if (
          receipt.idempotencyKeyHash !== input.idempotencyKeyHash
          || receipt.planHash !== input.input.planHash
          || receipt.policyVersion !== input.input.policyVersion
          || receipt.baseRevision !== input.input.baseRevision
        ) {
          throw new HttpsError(
            'already-exists',
            'La operación confirmada no coincide con esta petición.',
          );
        }
        const stored = storedCommitResult(receipt);
        return legacyProgressCommitResultV1Schema.parse({
          ...stored,
          status: 'already-committed',
        });
      }

      if (!previewSnapshot.exists) {
        throw new HttpsError(
          'not-found',
          'No existe una previsualización para esta operación.',
        );
      }
      const preview = requiredDocumentData(
        previewSnapshot.data(),
        'La previsualización',
      );
      assertOwner(preview, input.ownerHash);
      if (
        preview.idempotencyKeyHash !== input.idempotencyKeyHash
        || preview.planHash !== input.input.planHash
        || preview.policyVersion !== input.input.policyVersion
        || preview.baseRevision !== input.input.baseRevision
      ) {
        throw new HttpsError(
          'invalid-argument',
          'La confirmación no coincide con el plan previsualizado.',
        );
      }
      if (preview.status !== 'ready') {
        throw new HttpsError('internal', 'La previsualización tiene un estado incoherente.');
      }
      const previewResult = storedPreviewResult(preview);
      if (previewResult.expiresAt <= input.now) {
        throw new HttpsError(
          'failed-precondition',
          'La previsualización ha expirado.',
        );
      }
      if (!payloadSnapshot.exists) {
        throw new HttpsError('internal', 'Falta el payload de la previsualización activa.');
      }
      const payload = requiredDocumentData(payloadSnapshot.data(), 'El payload');
      assertStoredPayload(
        payload,
        input.ownerHash,
        String(preview.requestFingerprint),
        previewResult.payloadFingerprint,
      );

      const state = profileSnapshot.exists
        ? profileStateFromData(profileSnapshot.data())
        : { revision: 0, legacyFingerprint: null };
      if (state.revision !== input.input.baseRevision) {
        throw conflictForRevision(state.revision, input.input.baseRevision);
      }
      if (state.legacyFingerprint !== null) {
        throw new HttpsError(
          'failed-precondition',
          'El perfil ya contiene una importación legacy.',
        );
      }

      const committedAt = input.now;
      const toRevision = state.revision + 1;
      const quarantineDeleteAt = committedAt + LEGACY_IMPORT_QUARANTINE_TTL_MS;
      const result = legacyProgressCommitResultV1Schema.parse({
        protocolVersion: 1,
        status: 'committed',
        operationId: input.input.operationId,
        policyVersion: LEGACY_PROGRESS_IMPORT_POLICY_VERSION,
        payloadFingerprint: previewResult.payloadFingerprint,
        fromRevision: state.revision,
        toRevision,
        committedAt,
      });

      transaction.set(profileRef, {
        schemaVersion: LEGACY_CLOUD_PROFILE_SCHEMA_VERSION,
        revision: toRevision,
        createdAt: profileSnapshot.exists
          ? profileSnapshot.get('createdAt') ?? committedAt
          : committedAt,
        updatedAt: committedAt,
        legacyImport: {
          schemaVersion: 1,
          status: 'quarantined',
          authority: 'untrusted-client',
          verification: 'unverified',
          policyVersion: LEGACY_PROGRESS_IMPORT_POLICY_VERSION,
          operationId: input.input.operationId,
          payloadFingerprint: previewResult.payloadFingerprint,
          importedAt: committedAt,
          quarantineDeleteAt,
        },
        legacyClaim: {
          schemaVersion: 1,
          authority: 'untrusted-client',
          verification: 'unverified',
          projection: previewResult.projection,
          warnings: previewResult.warnings,
          payloadFingerprint: previewResult.payloadFingerprint,
          importedAt: committedAt,
        },
      }, { merge: true });
      transaction.update(previewRef, {
        status: 'committed',
        committedAtMillis: committedAt,
      });
      transaction.update(payloadRef, {
        committedAtMillis: committedAt,
        deleteAt: Timestamp.fromMillis(quarantineDeleteAt),
      });
      transaction.create(receiptRef, {
        schemaVersion: 1,
        kind: LEGACY_IMPORT_KIND,
        operationId: input.input.operationId,
        ownerHash: input.ownerHash,
        idempotencyKeyHash: input.idempotencyKeyHash,
        requestFingerprint: preview.requestFingerprint,
        payloadFingerprint: previewResult.payloadFingerprint,
        planHash: input.input.planHash,
        policyVersion: LEGACY_PROGRESS_IMPORT_POLICY_VERSION,
        baseRevision: input.input.baseRevision,
        result,
        createdAtMillis: committedAt,
      });
      const lock = lockSnapshot.exists
        ? requiredDocumentData(lockSnapshot.data(), 'El bloqueo de previsualización')
        : {};
      assertOwnerOrNewLock(lock, input.ownerHash);
      transaction.set(lockRef, {
        schemaVersion: 1,
        ownerHash: input.ownerHash,
        activeOperationId: null,
        activeUntil: 0,
        updatedAtMillis: committedAt,
      }, { merge: true });

      return result;
    });
  }
}

function safeStoredMillis(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function safeStoredCount(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Math.min(Number(value), LEGACY_IMPORT_MAX_PREVIEWS_PER_WINDOW)
    : 0;
}

function assertOwnerOrNewLock(
  data: Record<string, unknown>,
  ownerHash: string,
): void {
  if (Object.keys(data).length > 0) assertOwner(data, ownerHash);
}

export function createLegacyProgressImportService(
  store: LegacyProgressImportStore = new FirestoreLegacyProgressImportStore(),
  now: () => number = Date.now,
) {
  return {
    async preview(uid: string, data: unknown): Promise<LegacyProgressPreviewResultV1> {
      const timestamp = assertNow(now());
      const prepared = prepareLegacyProgressImport(uid, data);
      return store.preview({ ...prepared, uid, now: timestamp });
    },

    async commit(uid: string, data: unknown): Promise<LegacyProgressCommitResultV1> {
      const timestamp = assertNow(now());
      const input = parseCommit(data);
      const expectedOperationId = deriveLegacyImportOperationId(uid, input.idempotencyKey);
      if (input.operationId !== expectedOperationId) {
        throw new HttpsError(
          'invalid-argument',
          'operationId no pertenece al usuario autenticado y la idempotency key.',
        );
      }
      return store.commit({
        uid,
        now: timestamp,
        ownerHash: sha256(uid),
        idempotencyKeyHash: sha256(input.idempotencyKey),
        input,
      });
    },
  };
}

export const legacyProgressImportService = createLegacyProgressImportService();
