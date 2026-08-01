import assert from 'node:assert/strict';
import test from 'node:test';

import { health } from '../lib/index.js';

test('health rechaza una llamada sin identidad autenticada', async () => {
  await assert.rejects(
    health.run({ data: {}, auth: undefined }),
    (error) => {
      assert.equal(error?.code, 'unauthenticated');
      assert.equal(error?.message, 'Authentication required.');
      return true;
    },
  );
});

test('health devuelve un contrato estable para un usuario autenticado', async () => {
  const before = Date.now();
  const result = await health.run({
    data: {},
    auth: {
      uid: 'health-test-user',
      token: { sub: 'health-test-user' },
    },
  });
  const after = Date.now();

  assert.deepEqual(
    {
      ok: result.ok,
      service: result.service,
      protocolVersion: result.protocolVersion,
    },
    {
      ok: true,
      service: 'convergence-v2',
      protocolVersion: 1,
    },
  );
  assert.equal(Number.isInteger(result.serverTime), true);
  assert.ok(result.serverTime >= before && result.serverTime <= after);
});
