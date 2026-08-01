import { z } from 'zod';

export const protocolVersionSchema = z.literal(1);
export const userIdSchema = z.string().trim().min(1).max(128);
export const roomIdSchema = z.string().trim().min(1).max(128);
export const matchIdSchema = z.string().trim().min(1).max(128);
export const idempotencyKeySchema = z.string().trim().min(12).max(128);
export const epochMillisSchema = z.number().int().nonnegative();

export const gameModeSchema = z.enum([
  'clasico',
  'contrarreloj',
  'aventura',
  'supervivencia',
  'reto-diario',
]);

export type GameMode = z.infer<typeof gameModeSchema>;
