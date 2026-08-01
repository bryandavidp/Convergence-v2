import { z } from 'zod';
import {
  epochMillisSchema,
  idempotencyKeySchema,
  matchIdSchema,
  protocolVersionSchema,
  userIdSchema,
} from './common.js';

export const matchCommandSchema = z.object({
  protocolVersion: protocolVersionSchema,
  matchId: matchIdSchema,
  playerId: userIdSchema,
  idempotencyKey: idempotencyKeySchema,
  sequence: z.number().int().nonnegative(),
  clientTime: epochMillisSchema,
  type: z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/),
  payload: z.unknown(),
  previousStateHash: z.string().max(128).nullable(),
});

export const matchSnapshotSchema = z.object({
  protocolVersion: protocolVersionSchema,
  matchId: matchIdSchema,
  sequence: z.number().int().nonnegative(),
  serverTime: epochMillisSchema,
  stateHash: z.string().min(1).max(128),
  state: z.unknown(),
});

export type MatchCommand = z.infer<typeof matchCommandSchema>;
export type MatchSnapshot = z.infer<typeof matchSnapshotSchema>;
