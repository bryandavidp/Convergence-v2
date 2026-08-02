import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boardIndex,
  calculateGameStateHash,
  createInitialGameStateV2,
  Mulberry32,
  pickSpawnTokenId,
  placeInitialTokens,
  reduceGameStateV2,
  spawnOneToken,
} from '../dist/index.js';

test('pickSpawnTokenId y placeInitialTokens son deterministas con la misma semilla PRNG', () => {
  const prng1 = new Mulberry32(12345);
  const prng2 = new Mulberry32(12345);
  const pool = ['icon-A', 'icon-B', 'icon-C', 'icon-D'];

  const state1 = createInitialGameStateV2(12345);
  const state2 = createInitialGameStateV2(12345);

  placeInitialTokens(state1.board, pool, 5, prng1);
  placeInitialTokens(state2.board, pool, 5, prng2);

  assert.deepEqual(state1.board.cells, state2.board.cells);
});

test('reduceGameStateV2 procesa TAP_CELL limpia fichas convergentes y acumula combos', () => {
  const state = createInitialGameStateV2(12345, 'clasico', 5);
  const size = 5;

  // Colocamos 2 fichas 'icon-A' a los lados de la casilla (2, 2)
  state.board.cells[boardIndex(2, 0, size)] = 'icon-A';
  state.board.cells[boardIndex(2, 4, size)] = 'icon-A';
  state.iconCount = 2;

  const action = {
    sequence: 0,
    elapsedMs: 1000,
    type: 'TAP_CELL',
    payload: { cellIndex: boardIndex(2, 2, size) },
  };

  const nextState = reduceGameStateV2(state, action);

  assert.equal(nextState.board.cells[boardIndex(2, 0, size)], null);
  assert.equal(nextState.board.cells[boardIndex(2, 4, size)], null);
  assert.equal(nextState.combo, 1);
  assert.equal(nextState.score, 20); // 2 fichas * 10 * combo 1
});

test('calculateGameStateHash produce hashes idénticos para estados equivalentes', () => {
  const state1 = createInitialGameStateV2(999, 'clasico', 7);
  const state2 = createInitialGameStateV2(999, 'clasico', 7);

  const hash1 = calculateGameStateHash(state1);
  const hash2 = calculateGameStateHash(state2);

  assert.equal(hash1, hash2);
  assert.equal(typeof hash1, 'string');
  assert.equal(hash1.length, 8);
});

test('replay de secuencia de acciones produce exactamente el mismo resultado y hash', () => {
  const seed = 54321;
  const pool = ['icon-1', 'icon-2', 'icon-3'];

  let s1 = createInitialGameStateV2(seed);
  let s2 = createInitialGameStateV2(seed);

  const actions = [
    { sequence: 0, elapsedMs: 100, type: 'SPAWN_TICK', payload: { pool } },
    { sequence: 1, elapsedMs: 200, type: 'SPAWN_TICK', payload: { pool } },
    { sequence: 2, elapsedMs: 300, type: 'TAP_CELL', payload: { cellIndex: 0 } },
  ];

  for (const act of actions) {
    s1 = reduceGameStateV2(s1, act);
    s2 = reduceGameStateV2(s2, act);
  }

  assert.equal(calculateGameStateHash(s1), calculateGameStateHash(s2));
  assert.deepEqual(s1.board.cells, s2.board.cells);
});
