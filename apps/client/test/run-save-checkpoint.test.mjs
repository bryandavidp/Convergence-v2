import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const gameSource = fs.readFileSync(path.join(root, 'web', 'game.js'), 'utf8');
const objectStart = gameSource.indexOf('  const RunSave = {');
const objectEnd = gameSource.indexOf('\n  /* ===================== Game', objectStart);

assert.ok(objectStart >= 0 && objectEnd > objectStart, 'No se pudo aislar RunSave del runtime legacy.');
const objectSource = gameSource
  .slice(objectStart + '  const RunSave = '.length, objectEnd)
  .trim()
  .replace(/;$/, '');

function harness() {
  const local = new Map();
  const mirrored = [];
  const removed = [];
  const intervals = [];
  const context = vm.createContext({
    State: {
      status: 'playing', mode: 'clasico', diff: 'normal', level: 1, seed: 7,
      world: 'mundo1', worldLevel: 1, score: 10,
      board: new Array(64).fill(null), tiles: new Array(64).fill(null),
      iconCount: 0, spawnRate: 1, elapsed: 0, timeLeft: 0,
      hintsLeft: 3, mistakes: 0, maxCombo: 0, removedTotal: 0,
      emptyBoards: 0, coinsRun: 0, xpMultiplier: 1,
    },
    Coach: { active: false },
    Config: { SIZE: 8, MODES: { clasico: {} } },
    Adventure: { levelScore0: 0, levelStart: 0 },
    Survival: { inv: {} },
    Platform: {
      mirrorStorage(key, value) { mirrored.push([key, value]); },
      removeStorage(key) { removed.push(key); },
    },
    localStorage: {
      getItem(key) { return local.get(key) ?? null; },
      setItem(key, value) { local.set(key, String(value)); },
      removeItem(key) { local.delete(key); },
    },
    setInterval(callback, ms) { intervals.push({ callback, ms }); return intervals.length; },
    Date,
    JSON,
    Promise,
  });
  vm.runInContext(`globalThis.RunSave = ${objectSource}`, context);
  return { context, RunSave: context.RunSave, local, mirrored, removed, intervals };
}

test('RunSave programa un checkpoint periódico de diez segundos', async () => {
  const state = harness();
  state.RunSave.startCheckpointing();
  state.RunSave.startCheckpointing();

  assert.equal(state.intervals.length, 1);
  assert.equal(state.intervals[0].ms, 10000);
  state.intervals[0].callback();
  await Promise.resolve();

  const saved = JSON.parse(state.local.get('cv_run'));
  assert.equal(saved.v, 1);
  assert.equal(saved.mode, 'clasico');
  assert.equal(saved.score, 10);
  assert.equal(state.mirrored.length, 1);
});

test('checkpoint diferido coalesce llamadas y captura el último estado estable', async () => {
  const state = harness();
  state.RunSave.schedule();
  state.RunSave.schedule();
  state.context.State.score = 99;
  await Promise.resolve();

  assert.equal(JSON.parse(state.local.get('cv_run')).score, 99);
  assert.equal(state.mirrored.length, 1);
});

test('el intervalo no persiste modos excluidos ni una partida inactiva', async () => {
  const state = harness();
  state.RunSave.startCheckpointing();

  state.context.State.mode = 'contrarreloj';
  state.intervals[0].callback();
  await Promise.resolve();
  assert.equal(state.mirrored.length, 0);

  state.context.State.mode = 'clasico';
  state.context.State.status = 'idle';
  state.intervals[0].callback();
  await Promise.resolve();
  assert.equal(state.mirrored.length, 0);
});
