import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCEPTED_GAME_VERSIONS,
  boardsForClaim,
  createLeaderboardService,
  deriveClaimOperationId,
  MAX_CLAIMS_PER_WINDOW,
  prepareClaim,
} from '../lib/leaderboard.js';
import { submitRunClaim } from '../lib/index.js';

const NOW = Date.UTC(2026, 7, 2, 12, 0, 0);
const UID = 'uid-runner-1';

function convergence(overrides = {}) {
  return {
    kind: 'convergence',
    removed: 2,
    combo: 1,
    fever: false,
    elapsedSeconds: 0,
    ...overrides,
  };
}

/** Una partida de Contrarreloj con dos convergencias: 24 + 24 = 48 puntos. */
function claim(overrides = {}) {
  return {
    protocolVersion: 1,
    idempotencyKey: 'run-claim-000000000001',
    mode: 'contrarreloj',
    difficulty: 'normal',
    claimedScore: 48,
    seed: 42,
    startedAt: NOW - 60_000,
    finishedAt: NOW,
    gameVersion: ACCEPTED_GAME_VERSIONS[0],
    finalStateHash: 'a'.repeat(16),
    events: [convergence(), convergence({ elapsedSeconds: 1 })],
    ...overrides,
  };
}

/** Store en memoria que aplica idempotencia, mejor marca y cuota como el real. */
function createStore() {
  const receipts = new Map();
  const boards = new Map();
  let claimsInWindow = 0;
  return {
    boards,
    receipts,
    async publish(input) {
      const existing = receipts.get(input.operationId);
      if (existing) {
        if (existing.claimedScore !== input.claim.claimedScore) {
          throw Object.assign(new Error('reused key'), { code: 'already-exists' });
        }
        return { ...existing, alreadyApplied: true };
      }
      claimsInWindow += 1;
      if (claimsInWindow > MAX_CLAIMS_PER_WINDOW) {
        throw Object.assign(new Error('rate'), { code: 'resource-exhausted' });
      }
      const improvedBoards = [];
      for (const board of input.boards) {
        const previous = boards.get(board.boardId);
        if (previous !== undefined && input.score <= previous.score) continue;
        improvedBoards.push(board.boardId);
        boards.set(board.boardId, {
          score: input.score,
          verification: input.verification,
          uid: input.uid,
        });
      }
      const result = {
        verification: input.verification,
        score: input.score,
        claimedScore: input.claim.claimedScore,
        improvedBoards,
        alreadyApplied: false,
      };
      receipts.set(input.operationId, result);
      return result;
    },
  };
}

function service(store) {
  return createLeaderboardService(store, () => NOW);
}

test('la versión actual del cliente está en la allowlist', async () => {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const gameJs = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/web/game.js'),
    'utf8',
  );
  const version = gameJs.match(/const VERSION = '([^']+)'/);
  assert.ok(version, 'no se encontró la versión del cliente');
  assert.ok(
    ACCEPTED_GAME_VERSIONS.includes(version[1]),
    `la versión ${version[1]} no está en ACCEPTED_GAME_VERSIONS: al publicarla, `
    + 'las puntuaciones de los jugadores se rechazarían en silencio',
  );
});

test('el callable exige identidad autenticada', async () => {
  await assert.rejects(
    submitRunClaim.run({ data: {}, auth: undefined }),
    (error) => {
      assert.equal(error?.code, 'unauthenticated');
      return true;
    },
  );
});

test('una partida honesta se verifica y entra en las cuatro tablas', async () => {
  const store = createStore();
  const result = await service(store).submit(UID, claim());

  assert.equal(result.verification, 'verified');
  assert.equal(result.score, 48);
  assert.equal(result.improvedBoards.length, 4, 'los cuatro periodos');
  // 2026-08-02 es domingo: cierra la semana ISO 31, no abre la 32.
  assert.deepEqual(result.improvedBoards.sort(), [
    'contrarreloj:all-time:all',
    'contrarreloj:daily:2026-08-02',
    'contrarreloj:season:S003',
    'contrarreloj:weekly:2026-W31',
  ]);
});

test('un score inflado se rechaza y no toca ninguna tabla', async () => {
  const store = createStore();
  const result = await service(store).submit(UID, claim({ claimedScore: 999_999 }));

  assert.equal(result.verification, 'rejected');
  assert.equal(result.score, 48, 'el recalculado manda');
  assert.deepEqual(result.improvedBoards, []);
  assert.equal(store.boards.size, 0, 'una reclamación rechazada no publica nada');
});

test('solo se guarda la mejor marca del jugador en cada tabla', async () => {
  const store = createStore();
  const svc = service(store);

  await svc.submit(UID, claim());
  const worse = await svc.submit(UID, claim({
    idempotencyKey: 'run-claim-000000000002',
    claimedScore: 24,
    events: [convergence()],
  }));

  assert.equal(worse.verification, 'verified');
  assert.deepEqual(worse.improvedBoards, [], 'una marca peor no desplaza a la buena');
  assert.equal(store.boards.get('contrarreloj:daily:2026-08-02').score, 48);
});

test('reintentar la misma reclamación no publica dos veces', async () => {
  const store = createStore();
  const svc = service(store);

  const first = await svc.submit(UID, claim());
  const second = await svc.submit(UID, claim());

  assert.equal(first.alreadyApplied, false);
  assert.equal(second.alreadyApplied, true);
  assert.deepEqual(second.improvedBoards, first.improvedBoards);
});

test('la misma clave con otra partida se rechaza', async () => {
  const store = createStore();
  const svc = service(store);
  await svc.submit(UID, claim());

  await assert.rejects(
    () => svc.submit(UID, claim({ claimedScore: 24, events: [convergence()] })),
    (error) => error.code === 'already-exists',
  );
});

test('una versión de juego desconocida no puede puntuar', async () => {
  await assert.rejects(
    () => service(createStore()).submit(UID, claim({ gameVersion: '9.9.9' })),
    (error) => error.code === 'failed-precondition',
  );
});

test('una partida que dice terminar en el futuro se rechaza', async () => {
  await assert.rejects(
    () => service(createStore()).submit(UID, claim({
      startedAt: NOW,
      finishedAt: NOW + 60 * 60 * 1000,
    })),
    (error) => error.code === 'invalid-argument',
  );
});

test('la reclamación no acepta identidad ni periodo del cliente', async () => {
  const svc = service(createStore());
  for (const extra of [{ userId: 'otro' }, { scopeId: '2020-01-01' }, { score: 10 }]) {
    await assert.rejects(
      () => svc.submit(UID, claim(extra)),
      (error) => error.code === 'invalid-argument',
      `debería rechazarse: ${Object.keys(extra)[0]}`,
    );
  }
});

test('la cuota corta una ráfaga de reclamaciones', async () => {
  const store = createStore();
  const svc = service(store);
  for (let n = 0; n < MAX_CLAIMS_PER_WINDOW; n += 1) {
    await svc.submit(UID, claim({ idempotencyKey: `run-claim-00000000${String(n).padStart(4, '0')}` }));
  }
  await assert.rejects(
    () => svc.submit(UID, claim({ idempotencyKey: 'run-claim-000000009999' })),
    (error) => error.code === 'resource-exhausted',
  );
});

test('la operación se deriva del uid autenticado', () => {
  const key = 'run-claim-000000000001';
  assert.notEqual(
    deriveClaimOperationId(UID, key),
    deriveClaimOperationId('otro-uid', key),
    'dos usuarios con la misma clave no comparten operación',
  );
});

test('los cuatro periodos salen del instante de cierre, no del cliente', () => {
  const boards = boardsForClaim('contrarreloj', Date.UTC(2026, 11, 31, 23, 59));
  assert.deepEqual(boards.map((board) => board.boardId), [
    'contrarreloj:all-time:all',
    'contrarreloj:season:S005',
    'contrarreloj:weekly:2026-W53',
    'contrarreloj:daily:2026-12-31',
  ]);
});

test('prepareClaim no publica nada: solo verifica', () => {
  const prepared = prepareClaim(UID, claim(), NOW);
  assert.equal(prepared.verification, 'verified');
  assert.equal(prepared.score, 48);
  assert.equal(prepared.boards.length, 4);

  const rejected = prepareClaim(UID, claim({ claimedScore: 1 }), NOW);
  assert.equal(rejected.verification, 'rejected');
  assert.deepEqual(rejected.boards, [], 'una rechazada no aspira a ninguna tabla');
});
