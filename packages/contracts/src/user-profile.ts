import { z } from 'zod';
import { epochMillisSchema, userIdSchema } from './common.js';

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

export type UserProfileV1 = z.infer<typeof userProfileV1Schema>;
export type UserBestRecordsV1 = z.infer<typeof userBestRecordsV1Schema>;
export type UserSettingsV1 = z.infer<typeof userSettingsV1Schema>;
