import type { ReplayAction } from './engine.js';
import { getConvergingCells, hasAvailableMoves } from './board.js';
import { Mulberry32 } from './rng.js';
import { spawnOneToken } from './spawn.js';
import type { GameStateV2 } from './state-v2.js';

export interface TapCellPayload {
  cellIndex: number;
}

export interface SpawnTickPayload {
  pool: string[];
}

export function fnv1a32Hash(value: string): string {
  let hash = 0x811c9dc5;
  for (let idx = 0; idx < value.length; idx += 1) {
    hash ^= value.charCodeAt(idx);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function calculateGameStateHash(state: Readonly<GameStateV2>): string {
  const payload = {
    v: state.version,
    s: state.seed,
    r: state.rngState,
    m: state.mode,
    l: state.level,
    sc: state.score,
    c: state.combo,
    b: state.board.cells,
    ic: state.iconCount,
    st: state.status,
  };
  return fnv1a32Hash(JSON.stringify(payload));
}

export function reduceGameStateV2(
  state: Readonly<GameStateV2>,
  action: Readonly<ReplayAction>,
): GameStateV2 {
  if (state.status === 'gameover' || state.status === 'won') {
    return { ...state };
  }

  const nextState: GameStateV2 = {
    ...state,
    board: {
      size: state.board.size,
      cells: [...state.board.cells],
      tiles: [...state.board.tiles],
    },
    updatedAt: action.elapsedMs,
  };

  const prng = new Mulberry32(state.seed);
  prng.restore(state.rngState);

  if (action.type === 'TAP_CELL') {
    const payload = action.payload as TapCellPayload;
    const cellIdx = payload.cellIndex;

    const converging = getConvergingCells(nextState.board, cellIdx);
    if (converging.length >= 2) {
      for (const idx of converging) {
        nextState.board.cells[idx] = null;
      }
      nextState.iconCount = Math.max(0, nextState.iconCount - converging.length);
      nextState.combo += 1;
      const points = converging.length * 10 * nextState.combo;
      nextState.score += points;
    } else {
      nextState.combo = 0;
    }

    nextState.rngState = prng.snapshot();
    return nextState;
  }

  if (action.type === 'SPAWN_TICK') {
    const payload = action.payload as SpawnTickPayload;
    const pool = payload.pool ?? [];

    const spawnResult = spawnOneToken(
      nextState.board,
      pool,
      nextState.iconCount,
      prng,
    );

    if (spawnResult !== null) {
      nextState.board = spawnResult.board;
      nextState.iconCount = spawnResult.iconCount;
    }

    if (!hasAvailableMoves(nextState.board)) {
      nextState.status = 'gameover';
    }

    nextState.rngState = prng.snapshot();
    return nextState;
  }

  return nextState;
}
