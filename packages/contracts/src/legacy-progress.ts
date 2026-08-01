import { z } from 'zod';
import { protocolVersionSchema } from './common.js';

export const LEGACY_PROGRESS_SCHEMA_VERSION = 10;
export const MAX_LEGACY_PROGRESS_PAYLOAD_BYTES = 256 * 1024;
export const MAX_LEGACY_PROGRESS_PAYLOAD_DEPTH = 32;
export const MAX_LEGACY_PROGRESS_PAYLOAD_NODES = 20_000;

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type LegacyProgressPayloadV10 = {
  _v: typeof LEGACY_PROGRESS_SCHEMA_VERSION;
  [key: string]: JsonValue;
};

type JsonPath = Array<string | number>;

interface JsonInspectionSuccess {
  success: true;
}

interface JsonInspectionFailure {
  success: false;
  message: string;
  path: JsonPath;
}

type JsonInspection = JsonInspectionSuccess | JsonInspectionFailure;

interface PendingValue {
  value: unknown;
  path: JsonPath;
  depth: number;
}

const dangerousJsonKeys = new Set(['__proto__', 'prototype', 'constructor']);
const arrayIndexPattern = /^(?:0|[1-9][0-9]*)$/;
const legacyProgressEnvelopeKeys = new Set([
  'protocolVersion',
  'idempotencyKey',
  'baseRevision',
  'legacySchemaVersion',
  'payload',
]);

function invalidJson(message: string, path: JsonPath): JsonInspectionFailure {
  return { success: false, message, path };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit < 0x80) {
      bytes += 1;
    } else if (codeUnit < 0x800) {
      bytes += 2;
    } else if (
      codeUnit >= 0xd800
      && codeUnit <= 0xdbff
      && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00
      && value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function inspectLegacyPayload(value: unknown): JsonInspection {
  if (!isRecord(value)) {
    return invalidJson('El payload legacy debe ser un objeto JSON.', []);
  }

  const pending: PendingValue[] = [{ value, path: [], depth: 0 }];
  const visited = new WeakSet<object>();
  let nodes = 0;

  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) break;
    nodes += 1;
    if (nodes > MAX_LEGACY_PROGRESS_PAYLOAD_NODES) {
      return invalidJson(
        `El payload supera ${MAX_LEGACY_PROGRESS_PAYLOAD_NODES} nodos JSON.`,
        entry.path,
      );
    }
    if (entry.depth > MAX_LEGACY_PROGRESS_PAYLOAD_DEPTH) {
      return invalidJson(
        `El payload supera ${MAX_LEGACY_PROGRESS_PAYLOAD_DEPTH} niveles de profundidad.`,
        entry.path,
      );
    }

    const current = entry.value;
    if (current === null || typeof current === 'string' || typeof current === 'boolean') {
      continue;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        return invalidJson('Los números del payload deben ser finitos.', entry.path);
      }
      continue;
    }
    if (typeof current !== 'object') {
      return invalidJson('El payload solo puede contener valores JSON.', entry.path);
    }
    if (visited.has(current)) {
      return invalidJson('El payload contiene ciclos o referencias compartidas.', entry.path);
    }
    visited.add(current);

    if (Array.isArray(current)) {
      if (Object.getPrototypeOf(current) !== Array.prototype) {
        return invalidJson('Los arrays no pueden tener un prototipo personalizado.', entry.path);
      }

      for (const key of Reflect.ownKeys(current)) {
        if (key === 'length') continue;
        if (typeof key !== 'string' || !arrayIndexPattern.test(key)) {
          return invalidJson('Los arrays no pueden tener propiedades adicionales.', entry.path);
        }
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index >= current.length) {
          return invalidJson('El array contiene un índice inválido.', [...entry.path, key]);
        }
      }

      for (let index = 0; index < current.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (descriptor === undefined) {
          return invalidJson('Los arrays JSON no pueden contener huecos.', [...entry.path, index]);
        }
        if (!('value' in descriptor) || !descriptor.enumerable) {
          return invalidJson('Los arrays no pueden contener accesores.', [...entry.path, index]);
        }
        pending.push({
          value: descriptor.value,
          path: [...entry.path, index],
          depth: entry.depth + 1,
        });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidJson('Los objetos del payload no pueden tener un prototipo personalizado.', entry.path);
    }

    for (const key of Reflect.ownKeys(current)) {
      if (typeof key !== 'string') {
        return invalidJson('El payload no puede contener claves Symbol.', entry.path);
      }
      if (entry.depth === 0 && (key.length < 1 || key.length > 128)) {
        return invalidJson(
          'Las claves de primer nivel deben contener entre 1 y 128 caracteres.',
          [...entry.path, key],
        );
      }
      if (dangerousJsonKeys.has(key)) {
        return invalidJson(`Campo JSON peligroso no permitido: ${key}.`, [...entry.path, key]);
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
        return invalidJson('Los objetos JSON no pueden contener accesores ni campos ocultos.', [
          ...entry.path,
          key,
        ]);
      }
      pending.push({
        value: descriptor.value,
        path: [...entry.path, key],
        depth: entry.depth + 1,
      });
    }
  }

  const version = Object.getOwnPropertyDescriptor(value, '_v');
  if (version === undefined || !('value' in version) || version.value !== LEGACY_PROGRESS_SCHEMA_VERSION) {
    return invalidJson(
      `El payload debe declarar _v=${LEGACY_PROGRESS_SCHEMA_VERSION}.`,
      ['_v'],
    );
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return invalidJson('El payload no se puede serializar como JSON.', []);
  }
  const bytes = utf8ByteLength(serialized);
  if (bytes > MAX_LEGACY_PROGRESS_PAYLOAD_BYTES) {
    return invalidJson(
      `El payload supera el límite de ${MAX_LEGACY_PROGRESS_PAYLOAD_BYTES} bytes.`,
      [],
    );
  }

  return { success: true };
}

export const legacyProgressPayloadV10Schema = z.unknown()
  .superRefine((value, context) => {
    const result = inspectLegacyPayload(value);
    if (result.success) return;
    context.addIssue({
      code: 'custom',
      message: result.message,
      path: result.path,
    });
  })
  .transform((value) => value as LegacyProgressPayloadV10);

function hasSafeEnvelopeShape(value: unknown): value is Record<string, unknown> {
  try {
    if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== legacyProgressEnvelopeKeys.size) return false;

    for (const key of keys) {
      if (typeof key !== 'string' || !legacyProgressEnvelopeKeys.has(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

const plainEnvelopeSchema = z.unknown()
  .refine(
    hasSafeEnvelopeShape,
    {
      message: 'El sobre de importación debe contener solo campos propios, enumerables y seguros.',
    },
  )
  .transform((value) => value as Record<string, unknown>);

export const legacyProgressImportIdempotencyKeySchema = z.string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{12,96}$/);

const legacyProgressImportV1EnvelopeSchema = z.strictObject({
  protocolVersion: protocolVersionSchema,
  idempotencyKey: legacyProgressImportIdempotencyKeySchema,
  baseRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  legacySchemaVersion: z.literal(LEGACY_PROGRESS_SCHEMA_VERSION),
  payload: legacyProgressPayloadV10Schema,
});

export const legacyProgressImportV1Schema = plainEnvelopeSchema.pipe(
  legacyProgressImportV1EnvelopeSchema,
);

export type LegacyProgressImportV1 = z.infer<typeof legacyProgressImportV1Schema>;

export const LEGACY_CLOUD_PROFILE_SCHEMA_VERSION = 1;
export const LEGACY_PROGRESS_IMPORT_POLICY_VERSION = 'legacy-cv-meta-v10/1';

const legacyPreferenceIdSchema = z.string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
const legacyImportCounterSchema = z.number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const legacyLevelSchema = z.number().int().min(1).max(10_000);
const legacyXpWithinLevelSchema = z.number().int().nonnegative().max(2_500_049);
const legacyLifetimeCounterSchema = z.number().int().nonnegative().max(1_000_000_000);
const legacyScoreClaimSchema = z.number().int().nonnegative().max(1_000_000_000_000);
const legacyClaimCountSchema = z.number().int().nonnegative()
  .max(MAX_LEGACY_PROGRESS_PAYLOAD_NODES);
export const legacyImportDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const legacyProgressProjectionV1Schema = z.strictObject({
  schemaVersion: z.literal(LEGACY_CLOUD_PROFILE_SCHEMA_VERSION),
  preferences: z.strictObject({
    board: legacyPreferenceIdSchema,
    theme: legacyPreferenceIdSchema,
    skin: legacyPreferenceIdSchema,
    fx: legacyPreferenceIdSchema,
    avatarIcon: legacyPreferenceIdSchema,
    avatarBorder: legacyPreferenceIdSchema,
    iconPack: legacyPreferenceIdSchema,
  }),
  progress: z.strictObject({
    level: legacyLevelSchema,
    xp: legacyXpWithinLevelSchema,
    games: legacyLifetimeCounterSchema,
    totalRemoved: legacyLifetimeCounterSchema,
    adventureMaxLevel: legacyLevelSchema,
    survivalBest: legacyScoreClaimSchema,
    survivalBestWave: legacyLifetimeCounterSchema,
    bestCombo: legacyLifetimeCounterSchema,
  }).superRefine((progress, context) => {
    const nextLevelXp = 300 + (progress.level - 1) * 250;
    if (progress.xp >= nextLevelXp) {
      context.addIssue({
        code: 'custom',
        path: ['xp'],
        message: 'xp debe representar progreso dentro del nivel legacy.',
      });
    }
  }),
  claimCounts: z.strictObject({
    achievements: legacyClaimCountSchema,
    boards: legacyClaimCountSchema,
    cosmetics: legacyClaimCountSchema,
    chests: legacyClaimCountSchema,
    modeRecords: legacyClaimCountSchema,
  }),
  quarantinedPayloadBytes: z.number().int().nonnegative()
    .max(MAX_LEGACY_PROGRESS_PAYLOAD_BYTES),
  unknownTopLevelFields: z.array(z.string().min(1).max(128)).max(256),
});

export const legacyProgressImportWarningSchema = z.enum([
  'economy-quarantined',
  'ranked-scores-unverified',
  'temporary-state-quarantined',
  'unknown-fields-ignored',
]);

const legacyProgressImportPreviewBase = {
  protocolVersion: protocolVersionSchema,
  operationId: legacyImportDigestSchema,
  policyVersion: z.literal(LEGACY_PROGRESS_IMPORT_POLICY_VERSION),
  payloadFingerprint: legacyImportDigestSchema,
  planHash: legacyImportDigestSchema,
  baseRevision: legacyImportCounterSchema,
  currentRevision: legacyImportCounterSchema,
  nextRevision: legacyImportCounterSchema,
  legacySchemaVersion: z.literal(LEGACY_PROGRESS_SCHEMA_VERSION),
  projection: legacyProgressProjectionV1Schema,
  warnings: z.array(legacyProgressImportWarningSchema).max(4),
  expiresAt: z.number().int().nonnegative(),
};

export const legacyProgressPreviewResultV1Schema = z.strictObject({
  ...legacyProgressImportPreviewBase,
  status: z.literal('ready'),
}).superRefine((preview, context) => {
  if (preview.baseRevision !== preview.currentRevision) {
    context.addIssue({
      code: 'custom',
      path: ['baseRevision'],
      message: 'baseRevision debe coincidir con currentRevision.',
    });
  }
  if (preview.nextRevision !== preview.currentRevision + 1) {
    context.addIssue({
      code: 'custom',
      path: ['nextRevision'],
      message: 'nextRevision debe incrementar currentRevision exactamente una vez.',
    });
  }
});

export const legacyProgressCommitV1Schema = z.strictObject({
  protocolVersion: protocolVersionSchema,
  idempotencyKey: legacyProgressImportIdempotencyKeySchema,
  operationId: legacyImportDigestSchema,
  policyVersion: z.literal(LEGACY_PROGRESS_IMPORT_POLICY_VERSION),
  planHash: legacyImportDigestSchema,
  baseRevision: legacyImportCounterSchema,
  confirmation: z.literal(true),
});

export const legacyProgressCommitResultV1Schema = z.strictObject({
  protocolVersion: protocolVersionSchema,
  status: z.enum(['committed', 'already-committed']),
  operationId: legacyImportDigestSchema,
  policyVersion: z.literal(LEGACY_PROGRESS_IMPORT_POLICY_VERSION),
  payloadFingerprint: legacyImportDigestSchema,
  fromRevision: legacyImportCounterSchema,
  toRevision: legacyImportCounterSchema,
  committedAt: z.number().int().nonnegative(),
}).superRefine((result, context) => {
  if (result.toRevision !== result.fromRevision + 1) {
    context.addIssue({
      code: 'custom',
      path: ['toRevision'],
      message: 'toRevision debe incrementar fromRevision exactamente una vez.',
    });
  }
});

export type LegacyProgressProjectionV1 = z.infer<
  typeof legacyProgressProjectionV1Schema
>;
export type LegacyProgressPreviewResultV1 = z.infer<
  typeof legacyProgressPreviewResultV1Schema
>;
export type LegacyProgressCommitV1 = z.infer<
  typeof legacyProgressCommitV1Schema
>;
export type LegacyProgressCommitResultV1 = z.infer<
  typeof legacyProgressCommitResultV1Schema
>;
