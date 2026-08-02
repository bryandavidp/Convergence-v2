import { createEmptyBoard, type GameModeId, type GameStateV2 } from './state-v2.js';
import { normalizeGameplaySeed } from './rng.js';

export interface LegacyRunSaveV1 {
  version?: number;
  seed?: number | string;
  mode?: string;
  level?: number;
  score?: number;
  combo?: number;
  board?: (string | null)[];
  size?: number;
  iconCount?: number;
  status?: string;
  updatedAt?: number;
}

export function migrateRunSaveV1ToV2(
  rawSave: unknown,
  fallbackNow = Date.now(),
): GameStateV2 {
  if (typeof rawSave !== 'object' || rawSave === null) {
    return createEmptyBoardState(fallbackNow);
  }

  const legacy = rawSave as LegacyRunSaveV1;

  if (legacy.version === 2) {
    return rawSave as GameStateV2;
  }

  const size = typeof legacy.size === 'number' && legacy.size >= 3 && legacy.size <= 12
    ? legacy.size
    : 7;

  const rawSeed = legacy.seed ?? 12345678;
  const rngState = normalizeGameplaySeed(rawSeed);

  const validMode: GameModeId =
    legacy.mode === 'clasico' ||
    legacy.mode === 'supervivencia' ||
    legacy.mode === 'aventura' ||
    legacy.mode === 'contrarreloj' ||
    legacy.mode === 'reto-diario' ||
    legacy.mode === 'zen' ||
    legacy.mode === 'tutorial'
      ? legacy.mode
      : 'clasico';

  const cells = Array.isArray(legacy.board) && legacy.board.length === size * size
    ? [...legacy.board]
    : new Array<string | null>(size * size).fill(null);

  const tiles = new Array(size * size).fill(null);

  let iconCount = typeof legacy.iconCount === 'number' ? legacy.iconCount : 0;
  if (iconCount === 0) {
    for (let idx = 0; idx < cells.length; idx += 1) {
      if (cells[idx] !== null) iconCount += 1;
    }
  }

  return {
    version: 2,
    seed: rawSeed,
    rngState,
    mode: validMode,
    level: typeof legacy.level === 'number' && legacy.level >= 1 ? legacy.level : 1,
    score: typeof legacy.score === 'number' && legacy.score >= 0 ? legacy.score : 0,
    combo: typeof legacy.combo === 'number' && legacy.combo >= 0 ? legacy.combo : 0,
    board: {
      size,
      cells,
      tiles,
    },
    iconCount,
    status:
      legacy.status === 'playing' ||
      legacy.status === 'paused' ||
      legacy.status === 'gameover' ||
      legacy.status === 'won'
        ? legacy.status
        : 'playing',
    updatedAt: typeof legacy.updatedAt === 'number' ? legacy.updatedAt : fallbackNow,
  };
}

function createEmptyBoardState(now: number): GameStateV2 {
  return {
    version: 2,
    seed: 12345678,
    rngState: normalizeGameplaySeed(12345678),
    mode: 'clasico',
    level: 1,
    score: 0,
    combo: 0,
    board: createEmptyBoard(7),
    iconCount: 0,
    status: 'ready',
    updatedAt: now,
  };
}
