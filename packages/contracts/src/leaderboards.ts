import { z } from 'zod';
import {
  epochMillisSchema,
  gameModeSchema,
  idempotencyKeySchema,
  protocolVersionSchema,
  userIdSchema,
} from './common.js';

export const leaderboardScopeSchema = z.enum([
  'all-time',
  'season',
  'weekly',
  'daily',
]);

export const runResultClaimSchema = z.object({
  protocolVersion: protocolVersionSchema,
  idempotencyKey: idempotencyKeySchema,
  userId: userIdSchema,
  mode: gameModeSchema,
  score: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  seed: z.union([z.number().int(), z.string().min(1).max(128)]),
  startedAt: epochMillisSchema,
  finishedAt: epochMillisSchema,
  finalStateHash: z.string().min(1).max(128),
  actionCount: z.number().int().nonnegative(),
});

export const leaderboardEntrySchema = z.object({
  protocolVersion: protocolVersionSchema,
  userId: userIdSchema,
  displayName: z.string().trim().min(1).max(24),
  mode: gameModeSchema,
  scope: leaderboardScopeSchema,
  scopeId: z.string().trim().min(1).max(64),
  score: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  verified: z.boolean(),
  updatedAt: epochMillisSchema,
});

export type RunResultClaim = z.infer<typeof runResultClaimSchema>;
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;
