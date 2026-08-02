import { z } from 'zod';
import { epochMillisSchema, idempotencyKeySchema, userIdSchema } from './common.js';

export const USER_PROFILE_SCHEMA_VERSION = 1;

export const cosmeticIdSchema = z.string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const userProfileV1Schema = z.strictObject({
  schemaVersion: z.literal(USER_PROFILE_SCHEMA_VERSION),
  uid: userIdSchema,
  displayName: z.string().trim().min(1).max(32),
  avatarIcon: cosmeticIdSchema,
  avatarBorder: cosmeticIdSchema,
  theme: cosmeticIdSchema,
  iconPack: cosmeticIdSchema,
  updatedAt: epochMillisSchema,
});

export const userBestRecordsV1Schema = z.strictObject({
  schemaVersion: z.literal(USER_PROFILE_SCHEMA_VERSION),
  uid: userIdSchema,
  survivalBest: z.number().int().nonnegative().max(1_000_000_000_000),
  survivalBestWave: z.number().int().nonnegative().max(1_000_000),
  adventureMaxLevel: z.number().int().min(1).max(10_000),
  bestCombo: z.number().int().nonnegative().max(1_000_000),
  updatedAt: epochMillisSchema,
});

export const userSettingsV1Schema = z.strictObject({
  schemaVersion: z.literal(USER_PROFILE_SCHEMA_VERSION),
  soundVolume: z.number().min(0).max(1),
  musicVolume: z.number().min(0).max(1),
  hapticsEnabled: z.boolean(),
  language: z.enum(['es', 'en']),
  updatedAt: epochMillisSchema,
});

/**
 * La revisión es el único orden autoritativo del perfil en nube. `updatedAt` es
 * reloj de cliente y no puede decidir quién gana: dos dispositivos con relojes
 * desfasados se pisarían en silencio. El servidor incrementa la revisión en
 * cada escritura aceptada.
 */
export const profileRevisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** Documento tal y como vive en la nube: cuerpo más su revisión. */
export const userProfileDocumentV1Schema = z.strictObject({
  revision: profileRevisionSchema,
  profile: userProfileV1Schema,
});

export const userBestRecordsDocumentV1Schema = z.strictObject({
  revision: profileRevisionSchema,
  records: userBestRecordsV1Schema,
});

/**
 * Escritura compare-and-set: el servidor solo aplica el cambio si `baseRevision`
 * sigue siendo la revisión vigente, y deduplica reintentos por
 * `idempotencyKey`. Sin esto una reconexión podría aplicar dos veces la misma
 * escritura o sobrescribir el progreso que otro dispositivo acaba de subir.
 */
export const userProfileWriteV1Schema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
  baseRevision: profileRevisionSchema,
  profile: userProfileV1Schema,
});

export const userBestRecordsWriteV1Schema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
  baseRevision: profileRevisionSchema,
  records: userBestRecordsV1Schema,
});

export type UserProfileV1 = z.infer<typeof userProfileV1Schema>;
export type UserBestRecordsV1 = z.infer<typeof userBestRecordsV1Schema>;
export type UserSettingsV1 = z.infer<typeof userSettingsV1Schema>;
export type UserProfileDocumentV1 = z.infer<typeof userProfileDocumentV1Schema>;
export type UserBestRecordsDocumentV1 = z.infer<typeof userBestRecordsDocumentV1Schema>;
export type UserProfileWriteV1 = z.infer<typeof userProfileWriteV1Schema>;
export type UserBestRecordsWriteV1 = z.infer<typeof userBestRecordsWriteV1Schema>;
