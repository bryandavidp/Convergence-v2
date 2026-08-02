import type { BoardState } from './board.js';
import type { GameplaySeed } from './rng.js';

export const GAME_STATE_V2_VERSION = 2 as const;

export type GameModeId =
  | 'clasico'
  | 'contrarreloj'
  | 'aventura'
  | 'supervivencia'
  | 'reto-diario'
  | 'zen'
  | 'tutorial';

export interface GameStateV2 {
  version: typeof GAME_STATE_V2_VERSION;
  seed: GameplaySeed;
  rngState: number;
  mode: GameModeId;
  level: number;
  score: number;
  combo: number;
  board: BoardState;
  iconCount: number;
  status: 'ready' | 'playing' | 'paused' | 'gameover' | 'won';
  updatedAt: number;
}

export function createEmptyBoard(size: number): BoardState {
  return {
    size,
    cells: new Array<string | null>(size * size).fill(null),
    tiles: new Array(size * size).fill(null),
  };
}

export function createInitialGameStateV2(
  seed: GameplaySeed,
  mode: GameModeId = 'clasico',
  size = 7,
  rngState = 0,
  now = Date.now(),
): GameStateV2 {
  return {
    version: GAME_STATE_V2_VERSION,
    seed,
    rngState,
    mode,
    level: 1,
    score: 0,
    combo: 0,
    board: createEmptyBoard(size),
    iconCount: 0,
    status: 'ready',
    updatedAt: now,
  };
}
