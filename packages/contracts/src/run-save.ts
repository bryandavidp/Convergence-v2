import { z } from 'zod';

export const RUN_SAVE_V2_VERSION = 2 as const;

export const gameModeIdSchema = z.enum([
  'clasico',
  'contrarreloj',
  'aventura',
  'supervivencia',
  'reto-diario',
  'zen',
  'tutorial',
]);

export const tileStateSchema = z
  .object({
    solid: z.boolean().optional(),
    trigger: z.boolean().optional(),
    taps: z.number().int().min(0).optional(),
  })
  .strict();

export const boardStateSchema = z
  .object({
    size: z.number().int().min(3).max(12),
    cells: z.array(z.string().nullable()),
    tiles: z.array(tileStateSchema.nullable()),
  })
  .strict();

export const runSaveV2Schema = z
  .object({
    version: z.literal(RUN_SAVE_V2_VERSION),
    seed: z.union([z.number().int(), z.string().min(1).max(64)]),
    rngState: z.number().int(),
    mode: gameModeIdSchema,
    level: z.number().int().min(1),
    score: z.number().int().min(0),
    combo: z.number().int().min(0),
    board: boardStateSchema,
    iconCount: z.number().int().min(0),
    status: z.enum(['ready', 'playing', 'paused', 'gameover', 'won']),
    updatedAt: z.number().int().min(0),
  })
  .strict();

export type RunSaveV2 = z.infer<typeof runSaveV2Schema>;
