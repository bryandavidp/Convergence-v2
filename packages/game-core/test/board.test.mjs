import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boardIndex,
  calculateOccupationPercentage,
  getConvergingCells,
  hasAvailableMoves,
  isInsideBoard,
} from '../dist/index.js';

test('boardIndex y isInsideBoard calculan coordenadas correctamente', () => {
  assert.equal(boardIndex(0, 0, 7), 0);
  assert.equal(boardIndex(1, 2, 7), 9);
  assert.equal(isInsideBoard(0, 0, 7), true);
  assert.equal(isInsideBoard(-1, 0, 7), false);
  assert.equal(isInsideBoard(7, 0, 7), false);
});

test('getConvergingCells detecta convergencias en cruz cuando 2+ fichas iguales coinciden', () => {
  const size = 5;
  const cells = new Array(size * size).fill(null);
  const tiles = new Array(size * size).fill(null);

  // Colocamos 'icon-A' a la izquierda y derecha de la casilla (2, 2)
  cells[boardIndex(2, 0, size)] = 'icon-A';
  cells[boardIndex(2, 4, size)] = 'icon-A';

  const targetIdx = boardIndex(2, 2, size);
  const converging = getConvergingCells({ size, cells, tiles }, targetIdx);

  assert.equal(converging.length, 2);
  assert.ok(converging.includes(boardIndex(2, 0, size)));
  assert.ok(converging.includes(boardIndex(2, 4, size)));
});

test('getConvergingCells se detiene ante baldosas sólidas (rocas)', () => {
  const size = 5;
  const cells = new Array(size * size).fill(null);
  const tiles = new Array(size * size).fill(null);

  cells[boardIndex(2, 0, size)] = 'icon-A';
  // Roca sólida bloqueando la línea de visión en (2, 1)
  tiles[boardIndex(2, 1, size)] = { solid: true };
  cells[boardIndex(2, 4, size)] = 'icon-A';

  const targetIdx = boardIndex(2, 2, size);
  const converging = getConvergingCells({ size, cells, tiles }, targetIdx);

  assert.equal(converging.length, 0);
});

test('hasAvailableMoves y calculateOccupationPercentage evalúan estado del tablero', () => {
  const size = 5;
  const cells = new Array(size * size).fill(null);
  const tiles = new Array(size * size).fill(null);

  assert.equal(hasAvailableMoves({ size, cells, tiles }), false);
  assert.equal(calculateOccupationPercentage({ size, cells, tiles }), 0);

  cells[boardIndex(2, 0, size)] = 'icon-A';
  cells[boardIndex(2, 4, size)] = 'icon-A';

  assert.equal(hasAvailableMoves({ size, cells, tiles }), true);
  assert.equal(calculateOccupationPercentage({ size, cells, tiles }), 8);
});
