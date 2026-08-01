import { z } from 'zod';
import {
  epochMillisSchema,
  gameModeSchema,
  protocolVersionSchema,
  roomIdSchema,
  userIdSchema,
} from './common.js';

export const roomMemberSchema = z.object({
  userId: userIdSchema,
  displayName: z.string().trim().min(1).max(24),
  role: z.enum(['owner', 'player', 'spectator']),
  ready: z.boolean(),
  joinedAt: epochMillisSchema,
});

export const roomStatusSchema = z.enum([
  'open',
  'starting',
  'playing',
  'finished',
  'closed',
]);

export const roomSchema = z.object({
  protocolVersion: protocolVersionSchema,
  roomId: roomIdSchema,
  roomCode: z.string().regex(/^[A-Z0-9]{6}$/),
  ownerId: userIdSchema,
  mode: gameModeSchema,
  status: roomStatusSchema,
  maxPlayers: z.number().int().min(2).max(8),
  memberIds: z.array(userIdSchema).min(1).max(8),
  createdAt: epochMillisSchema,
  updatedAt: epochMillisSchema,
  revision: z.number().int().nonnegative(),
});

export type Room = z.infer<typeof roomSchema>;
export type RoomMember = z.infer<typeof roomMemberSchema>;
