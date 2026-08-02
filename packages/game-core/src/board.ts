export const CARDINAL_DIRECTIONS = [
  -1, 0, // Arriba
  1, 0,  // Abajo
  0, -1, // Izquierda
  0, 1,  // Derecha
] as const;

export interface TileState {
  solid?: boolean;
  trigger?: boolean;
  taps?: number;
}

export interface BoardState {
  size: number;
  cells: (string | null)[];
  tiles: (TileState | null)[];
}

export function boardIndex(row: number, col: number, size: number): number {
  return row * size + col;
}

export function isInsideBoard(row: number, col: number, size: number): boolean {
  return row >= 0 && col >= 0 && row < size && col < size;
}

export function getConvergingCells(
  board: Readonly<BoardState>,
  cellIndex: number,
): number[] {
  const { size, cells, tiles } = board;

  if (cellIndex < 0 || cellIndex >= cells.length) return [];
  if (cells[cellIndex] !== null && cells[cellIndex] !== undefined) return [];

  const tileAtIndex = tiles[cellIndex];
  if (tileAtIndex?.solid || tileAtIndex?.trigger) return [];

  const row = (cellIndex / size) | 0;
  const col = cellIndex % size;
  const groups: Record<string, number[]> = Object.create(null);

  for (let dir = 0; dir < CARDINAL_DIRECTIONS.length; dir += 2) {
    const dr = CARDINAL_DIRECTIONS[dir];
    const dc = CARDINAL_DIRECTIONS[dir + 1];
    if (dr === undefined || dc === undefined) break;

    let r = row + dr;
    let c = col + dc;

    while (isInsideBoard(r, c, size)) {
      const idx = boardIndex(r, c, size);
      const currentTile = tiles[idx];
      if (currentTile?.solid) break;

      const token = cells[idx];
      if (token !== null && token !== undefined) {
        const group = groups[token] ?? [];
        group.push(idx);
        groups[token] = group;
        break;
      }

      r += dr;
      c += dc;
    }
  }

  const convergingIndices: number[] = [];
  for (const token of Object.keys(groups)) {
    const group = groups[token];
    if (group !== undefined && group.length >= 2) {
      convergingIndices.push(...group);
    }
  }

  return convergingIndices;
}

export function hasAvailableMoves(board: Readonly<BoardState>): boolean {
  const { cells } = board;
  for (let idx = 0; idx < cells.length; idx += 1) {
    if (cells[idx] === null && getConvergingCells(board, idx).length >= 2) {
      return true;
    }
  }
  return false;
}

export function calculateOccupationPercentage(board: Readonly<BoardState>): number {
  const { cells } = board;
  if (cells.length === 0) return 0;
  let occupiedCount = 0;
  for (let idx = 0; idx < cells.length; idx += 1) {
    if (cells[idx] !== null && cells[idx] !== undefined) occupiedCount += 1;
  }
  return (occupiedCount / cells.length) * 100;
}
