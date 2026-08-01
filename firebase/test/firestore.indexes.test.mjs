import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const indexesUrl = new URL('../firestore.indexes.json', import.meta.url);

test('Firestore versiona TTL y excluye el raw legacy de índices', async () => {
  const config = JSON.parse(await readFile(indexesUrl, 'utf8'));
  const payloadOverrides = config.fieldOverrides
    .filter((entry) => entry.collectionGroup === 'legacyImportPayloads')
    .sort((left, right) => left.fieldPath.localeCompare(right.fieldPath));

  assert.deepEqual(payloadOverrides, [
    {
      collectionGroup: 'legacyImportPayloads',
      fieldPath: 'deleteAt',
      ttl: true,
      indexes: [],
    },
    {
      collectionGroup: 'legacyImportPayloads',
      fieldPath: 'payloadJson',
      indexes: [],
    },
  ]);
});
