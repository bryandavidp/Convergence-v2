import assert from 'node:assert/strict';
import test from 'node:test';

const projectId = process.env.CONVERGENCE_TEST_PROJECT_ID;
const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST;

assert.match(
  projectId ?? '',
  /^demo-/,
  'Las pruebas funcionales solo pueden ejecutarse con un project ID demo-*.',
);
assert.ok(functionsHost, 'FUNCTIONS_EMULATOR_HOST no fue inyectado por Emulator Suite.');

const healthUrl = `http://${functionsHost}/${projectId}/europe-west1/health`;

function unsignedDebugToken(subject, extra = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return [
    encode({ alg: 'none', typ: 'JWT' }),
    encode({ sub: subject, ...extra }),
    'emulator-only-signature',
  ].join('.');
}

async function callHealth(headers = {}) {
  const response = await fetch(healthUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({ data: {} }),
  });

  return {
    response,
    body: await response.json(),
  };
}

const authToken = unsignedDebugToken('health-emulator-user', {
  user_id: 'health-emulator-user',
});
const appCheckToken = unsignedDebugToken('health-emulator-app', {
  app_id: 'health-emulator-app',
});

test('callable health responde 401 a una petición anónima', async () => {
  const { response, body } = await callHealth();

  assert.equal(response.status, 401);
  assert.equal(body?.error?.status, 'UNAUTHENTICATED');
});

test('callable health mantiene App Check obligatorio aunque exista Auth', async () => {
  const { response, body } = await callHealth({
    authorization: `Bearer ${authToken}`,
  });

  assert.equal(response.status, 401);
  assert.equal(body?.error?.status, 'UNAUTHENTICATED');
});

test('callable health acepta Auth + App Check válidos en el emulador', async () => {
  const before = Date.now();
  const { response, body } = await callHealth({
    authorization: `Bearer ${authToken}`,
    'x-firebase-appcheck': appCheckToken,
  });
  const after = Date.now();

  assert.equal(response.status, 200);
  assert.deepEqual(
    {
      ok: body?.result?.ok,
      service: body?.result?.service,
      protocolVersion: body?.result?.protocolVersion,
    },
    {
      ok: true,
      service: 'convergence-v2',
      protocolVersion: 1,
    },
  );
  assert.equal(Number.isInteger(body?.result?.serverTime), true);
  // Tolerancia de un segundo: `Date.now()` en Windows avanza a saltos de ~15 ms,
  // así que en una llamada de 12-17 ms `before` y `after` caen en el mismo tick
  // y el reloj del emulador puede quedar un tick fuera de la ventana. Sin
  // margen, este test falla la mitad de las veces sin que nada esté roto.
  const CLOCK_TOLERANCE_MS = 1_000;
  assert.ok(
    body.result.serverTime >= before - CLOCK_TOLERANCE_MS
    && body.result.serverTime <= after + CLOCK_TOLERANCE_MS,
    `serverTime ${body.result.serverTime} fuera de [${before}, ${after}]`,
  );
});
