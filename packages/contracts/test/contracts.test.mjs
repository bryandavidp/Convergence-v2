import assert from 'node:assert/strict';
import test from 'node:test';
import {
  leaderboardEntrySchema,
  matchCommandSchema,
  roomSchema,
} from '../dist/index.js';

test('roomSchema acepta una sala mínima versionada', () => {
  const room = roomSchema.parse({
    protocolVersion: 1,
    roomId: 'room-1',
    roomCode: 'ABC123',
    ownerId: 'user-1',
    mode: 'clasico',
    status: 'open',
    maxPlayers: 2,
    memberIds: ['user-1'],
    createdAt: 1,
    updatedAt: 1,
    revision: 0,
  });

  assert.equal(room.roomCode, 'ABC123');
});

test('matchCommandSchema exige secuencia e idempotencia válidas', () => {
  assert.equal(
    matchCommandSchema.safeParse({
      protocolVersion: 1,
      matchId: 'match-1',
      playerId: 'user-1',
      idempotencyKey: 'command-000001',
      sequence: -1,
      clientTime: 1,
      type: 'move',
      payload: {},
      previousStateHash: null,
    }).success,
    false,
  );
});

test('leaderboardEntrySchema rechaza puntuaciones negativas', () => {
  assert.equal(
    leaderboardEntrySchema.safeParse({
      protocolVersion: 1,
      userId: 'user-1',
      displayName: 'Jugador',
      mode: 'supervivencia',
      scope: 'weekly',
      scopeId: '2026-W31',
      score: -1,
      verified: false,
      updatedAt: 1,
    }).success,
    false,
  );
});
