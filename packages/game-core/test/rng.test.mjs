import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Mulberry32,
  hasContiguousSequence,
  normalizeGameplaySeed,
} from '../dist/index.js';

test('Mulberry32 conserva la secuencia exacta del runtime 2.37.1', () => {
  const random = new Mulberry32(123);
  const values = Array.from({ length: 5 }, () => random.next());

  assert.deepEqual(values, [
    0.7872516233474016,
    0.1785435655619949,
    0.49531551403924823,
    0.23136196262203157,
    0.375791602069512,
  ]);
});

test('semilla numérica en string equivale a la numérica', () => {
  assert.equal(normalizeGameplaySeed('12345'), normalizeGameplaySeed(12345));
});

test('snapshot y restore reanudan el stream sin divergencia', () => {
  const random = new Mulberry32('reto-2026-07-31');
  random.next();
  const snapshot = random.snapshot();
  const expected = random.next();
  random.restore(snapshot);
  assert.equal(random.next(), expected);
});

test('la secuencia de un replay debe ser contigua y empezar en cero', () => {
  assert.equal(
    hasContiguousSequence([
      { sequence: 0, elapsedMs: 0, type: 'start', payload: null },
      { sequence: 1, elapsedMs: 10, type: 'move', payload: { cell: 2 } },
    ]),
    true,
  );
  assert.equal(
    hasContiguousSequence([
      { sequence: 1, elapsedMs: 10, type: 'move', payload: { cell: 2 } },
    ]),
    false,
  );
});
