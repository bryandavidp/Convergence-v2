import type { BoardState } from './board.js';
import type { Mulberry32 } from './rng.js';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function emptyCellIndices(board: Readonly<BoardState>): number[] {
  const { cells, tiles } = board;
  const empties: number[] = [];
  for (let idx = 0; idx < cells.length; idx += 1) {
    if (cells[idx] === null && !tiles[idx]?.solid) {
      empties.push(idx);
    }
  }
  return empties;
}

export const CLEAR_ASSIST_CONFIG = {
  threshold: 8,
  pMax: 0.85,
  pMin: 0.35,
  decay: 0.07,
} as const;

export function pickSpawnTokenId(
  board: Readonly<BoardState>,
  pool: readonly string[],
  iconCount: number,
  prng: Mulberry32,
): string {
  const randomFromPool = (): string => {
    const randomIndex = Math.floor(prng.next() * pool.length);
    return pool[randomIndex] ?? pool[0] ?? 'icon-default';
  };

  if (pool.length === 0) return 'icon-default';
  if (iconCount <= 0 || iconCount > CLEAR_ASSIST_CONFIG.threshold) {
    return randomFromPool();
  }

  const counts: Record<string, number> = Object.create(null);
  for (let idx = 0; idx < board.cells.length; idx += 1) {
    const token = board.cells[idx];
    if (token !== null && token !== undefined && !board.tiles[idx]?.solid) {
      const existing = counts[token] ?? 0;
      counts[token] = existing + 1;
    }
  }

  const presentTokens = Object.keys(counts);
  if (presentTokens.length === 0) return randomFromPool();

  const p = clamp(
    CLEAR_ASSIST_CONFIG.pMax - (iconCount - 1) * CLEAR_ASSIST_CONFIG.decay,
    CLEAR_ASSIST_CONFIG.pMin,
    CLEAR_ASSIST_CONFIG.pMax,
  );

  if (prng.next() < p) {
    let minCount = Infinity;
    for (const token of presentTokens) {
      const count = counts[token] ?? Infinity;
      if (count < minCount) minCount = count;
    }
    const candidates = presentTokens.filter((token) => counts[token] === minCount);
    const chosenIndex = Math.floor(prng.next() * candidates.length);
    return candidates[chosenIndex] ?? randomFromPool();
  }

  return randomFromPool();
}

export function placeInitialTokens(
  board: BoardState,
  pool: readonly string[],
  count: number,
  prng: Mulberry32,
): { board: BoardState; iconCount: number } {
  const empties = emptyCellIndices(board);
  let placedCount = 0;

  for (let k = 0; k < count && empties.length > 0; k += 1) {
    const pickIndex = Math.floor(prng.next() * empties.length);
    const targetCell = empties.splice(pickIndex, 1)[0];
    if (targetCell !== undefined && pool.length > 0) {
      const tokenIndex = Math.floor(prng.next() * pool.length);
      board.cells[targetCell] = pool[tokenIndex] ?? pool[0] ?? 'icon-default';
      placedCount += 1;
    }
  }

  return { board, iconCount: placedCount };
}

export function spawnOneToken(
  board: BoardState,
  pool: readonly string[],
  iconCount: number,
  prng: Mulberry32,
): { board: BoardState; iconCount: number; spawnedIndex: number; spawnedToken: string } | null {
  const empties = emptyCellIndices(board);
  if (empties.length === 0 || pool.length === 0) return null;

  const pickIndex = Math.floor(prng.next() * empties.length);
  const targetCell = empties[pickIndex];
  if (targetCell === undefined) return null;

  const tokenId = pickSpawnTokenId(board, pool, iconCount, prng);
  board.cells[targetCell] = tokenId;

  return {
    board,
    iconCount: iconCount + 1,
    spawnedIndex: targetCell,
    spawnedToken: tokenId,
  };
}
