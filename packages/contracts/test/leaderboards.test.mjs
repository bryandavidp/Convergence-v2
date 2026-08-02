import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEADERBOARD_TIMEZONE,
  MAX_LEADERBOARD_PAGE_SIZE,
  SEASON_EPOCH_MILLIS,
  SEASON_LENGTH_DAYS,
  leaderboardBoardId,
  leaderboardBoardIdSchema,
  leaderboardEntrySchema,
  leaderboardPageQuerySchema,
  leaderboardScopeId,
  runClaimSchema,
} from '../dist/index.js';

const DAY = 24 * 60 * 60 * 1000;

test('las tablas se cortan en UTC, no en la zona del jugador', () => {
  assert.equal(LEADERBOARD_TIMEZONE, 'UTC');
  // 23:30 UTC del día 2 sigue siendo el día 2, aunque en Madrid ya sea el 3.
  assert.equal(leaderboardScopeId('daily', Date.UTC(2026, 7, 2, 23, 30)), '2026-08-02');
  assert.equal(leaderboardScopeId('daily', Date.UTC(2026, 7, 3, 0, 0)), '2026-08-03');
});

test('all-time es una sola tabla', () => {
  assert.equal(leaderboardScopeId('all-time', Date.UTC(2026, 0, 1)), 'all');
  assert.equal(leaderboardScopeId('all-time', Date.UTC(2031, 11, 31)), 'all');
});

test('la semana ISO agrupa de lunes a domingo', () => {
  // 2026-08-03 es lunes; el domingo siguiente cae en la misma semana.
  const monday = leaderboardScopeId('weekly', Date.UTC(2026, 7, 3));
  const sunday = leaderboardScopeId('weekly', Date.UTC(2026, 7, 9, 23, 59));
  const nextMonday = leaderboardScopeId('weekly', Date.UTC(2026, 7, 10));
  assert.equal(monday, sunday);
  assert.notEqual(monday, nextMonday);
  assert.match(monday, /^\d{4}-W\d{2}$/);
});

test('el cambio de año no parte una semana en dos tablas', () => {
  // 2026-12-31 es jueves: su semana ISO pertenece a 2026 y llega hasta el
  // domingo 2027-01-03. Sin la regla del primer jueves, esos días caerían en
  // semanas distintas y la misma tabla se dividiría.
  const thursday = leaderboardScopeId('weekly', Date.UTC(2026, 11, 31));
  const saturday = leaderboardScopeId('weekly', Date.UTC(2027, 0, 2));
  assert.equal(thursday, saturday);
  assert.equal(thursday, '2026-W53');

  // Y el lunes siguiente ya es la semana 1 de 2027.
  assert.equal(leaderboardScopeId('weekly', Date.UTC(2027, 0, 4)), '2027-W01');
});

test('el 1 de enero puede pertenecer a la última semana del año anterior', () => {
  // 2027-01-01 es viernes: cae en la semana 53 de 2026.
  assert.equal(leaderboardScopeId('weekly', Date.UTC(2027, 0, 1)), '2026-W53');
});

test('las temporadas duran 90 días y empiezan en la S001', () => {
  assert.equal(leaderboardScopeId('season', SEASON_EPOCH_MILLIS), 'S001');
  assert.equal(
    leaderboardScopeId('season', SEASON_EPOCH_MILLIS + (SEASON_LENGTH_DAYS - 1) * DAY),
    'S001',
  );
  assert.equal(
    leaderboardScopeId('season', SEASON_EPOCH_MILLIS + SEASON_LENGTH_DAYS * DAY),
    'S002',
  );
  assert.equal(
    leaderboardScopeId('season', SEASON_EPOCH_MILLIS + SEASON_LENGTH_DAYS * DAY * 4),
    'S005',
  );
});

test('una fecha anterior al inicio no cae en una temporada negativa', () => {
  assert.equal(leaderboardScopeId('season', SEASON_EPOCH_MILLIS - DAY * 500), 'S001');
  assert.equal(leaderboardScopeId('season', 0), 'S001');
});

test('el identificador de tabla es estable y validable', () => {
  const boardId = leaderboardBoardId('contrarreloj', 'daily', '2026-08-02');
  assert.equal(boardId, 'contrarreloj:daily:2026-08-02');
  assert.equal(leaderboardBoardIdSchema.safeParse(boardId).success, true);

  for (const scope of ['all-time', 'season', 'weekly', 'daily']) {
    const id = leaderboardBoardId('contrarreloj', scope, leaderboardScopeId(scope, Date.now()));
    assert.equal(
      leaderboardBoardIdSchema.safeParse(id).success,
      true,
      `identificador inválido para ${scope}: ${id}`,
    );
  }
  assert.equal(leaderboardBoardIdSchema.safeParse('contrarreloj:mensual:x').success, false);
});

test('la reclamación no admite userId: la identidad sale de Auth', () => {
  const base = {
    protocolVersion: 1,
    idempotencyKey: 'run-claim-0001-abcdef',
    mode: 'contrarreloj',
    difficulty: 'normal',
    claimedScore: 1234,
    seed: 42,
    startedAt: 1_800_000_000_000,
    finishedAt: 1_800_000_060_000,
    gameVersion: '2.37.6',
    finalStateHash: 'abc123',
    events: [],
  };
  assert.equal(runClaimSchema.safeParse(base).success, true);

  // Un userId enviado por el cliente permitiría reclamar por otra persona.
  assert.equal(
    runClaimSchema.safeParse({ ...base, userId: 'otra-persona' }).success,
    false,
    'el esquema es estricto: un campo de más se rechaza',
  );
  // El periodo tampoco lo elige el cliente.
  assert.equal(runClaimSchema.safeParse({ ...base, scopeId: '2020-01-01' }).success, false);
});

test('una partida que termina antes de empezar se rechaza', () => {
  const invalid = {
    protocolVersion: 1,
    idempotencyKey: 'run-claim-0001-abcdef',
    mode: 'contrarreloj',
    difficulty: 'normal',
    claimedScore: 10,
    seed: 1,
    startedAt: 1_800_000_060_000,
    finishedAt: 1_800_000_000_000,
    gameVersion: '2.37.6',
    finalStateHash: 'abc123',
    events: [],
  };
  assert.equal(runClaimSchema.safeParse(invalid).success, false);
});

test('la entrada publica alias y estado de verificación, nunca datos personales', () => {
  const entry = {
    protocolVersion: 1,
    userId: 'uid-1',
    displayName: 'Nova',
    mode: 'contrarreloj',
    scope: 'daily',
    scopeId: '2026-08-02',
    score: 4321,
    verification: 'verified',
    updatedAt: 1_800_000_000_000,
  };
  assert.equal(leaderboardEntrySchema.safeParse(entry).success, true);
  assert.equal(
    leaderboardEntrySchema.safeParse({ ...entry, email: 'a@b.c' }).success,
    false,
    'el esquema estricto impide colar datos personales',
  );
  assert.equal(
    leaderboardEntrySchema.safeParse({ ...entry, verification: 'quizá' }).success,
    false,
  );
});

test('la paginación está acotada', () => {
  const query = { mode: 'contrarreloj', scope: 'daily' };
  assert.equal(leaderboardPageQuerySchema.safeParse(query).success, true);
  assert.equal(
    leaderboardPageQuerySchema.safeParse({ ...query, limit: MAX_LEADERBOARD_PAGE_SIZE }).success,
    true,
  );
  assert.equal(
    leaderboardPageQuerySchema.safeParse({ ...query, limit: MAX_LEADERBOARD_PAGE_SIZE + 1 }).success,
    false,
    'un límite sin tope permitiría descargar la tabla entera de una vez',
  );
});
