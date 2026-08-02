import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateRunSaveV1ToV2 } from '../dist/index.js';

test('migrateRunSaveV1ToV2 convierte un RunSaveV1 legado a GameStateV2 determinista', () => {
  const legacySave = {
    version: 1,
    seed: 998877,
    mode: 'supervivencia',
    level: 5,
    score: 12500,
    combo: 3,
    size: 7,
    board: new Array(49).fill(null),
    iconCount: 0,
    status: 'playing',
    updatedAt: 5000,
  };

  const v2 = migrateRunSaveV1ToV2(legacySave);

  assert.equal(v2.version, 2);
  assert.equal(v2.seed, 998877);
  assert.equal(typeof v2.rngState, 'number');
  assert.equal(v2.mode, 'supervivencia');
  assert.equal(v2.level, 5);
  assert.equal(v2.score, 12500);
  assert.equal(v2.board.size, 7);
  assert.equal(v2.board.cells.length, 49);
});

test('migrateRunSaveV1ToV2 maneja objetos invalidos devolviendo estado inicial por defecto', () => {
  const v2Null = migrateRunSaveV1ToV2(null, 1000);
  assert.equal(v2Null.version, 2);
  assert.equal(v2Null.score, 0);
  assert.equal(v2Null.status, 'ready');
  assert.equal(v2Null.updatedAt, 1000);

  const v2Empty = migrateRunSaveV1ToV2({}, 2000);
  assert.equal(v2Empty.version, 2);
  assert.equal(v2Empty.mode, 'clasico');
});
