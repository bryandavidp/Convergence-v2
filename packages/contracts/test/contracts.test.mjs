import assert from 'node:assert/strict';
import test from 'node:test';
import {
  leaderboardEntrySchema,
  matchCommandSchema,
  roomSchema,
  runSaveV2Schema,
  userBestRecordsV1Schema,
  userProfileV1Schema,
  userSettingsV1Schema,
} from '../dist/index.js';

test('runSaveV2Schema valida una partida guardada V2 completa y estricta', () => {
  const save = runSaveV2Schema.parse({
    version: 2,
    seed: 12345,
    rngState: 987654,
    mode: 'clasico',
    level: 1,
    score: 500,
    combo: 2,
    board: {
      size: 5,
      cells: new Array(25).fill(null),
      tiles: new Array(25).fill(null),
    },
    iconCount: 0,
    status: 'playing',
    updatedAt: 1000,
  });

  assert.equal(save.version, 2);
  assert.equal(save.mode, 'clasico');
  assert.equal(save.score, 500);
});

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

test('userProfileV1Schema valida perfil de usuario completo y rechaza campos extras', () => {
  const valid = userProfileV1Schema.safeParse({
    schemaVersion: 1,
    uid: 'user-xyz',
    displayName: 'Jugador 1',
    avatarIcon: 'icon-default',
    avatarBorder: 'border-gold',
    theme: 'theme-cyber',
    iconPack: 'pack-classic',
    updatedAt: 1770000000000,
  });
  assert.equal(valid.success, true);

  const invalidExtra = userProfileV1Schema.safeParse({
    schemaVersion: 1,
    uid: 'user-xyz',
    displayName: 'Jugador 1',
    avatarIcon: 'icon-default',
    avatarBorder: 'border-gold',
    theme: 'theme-cyber',
    iconPack: 'pack-classic',
    updatedAt: 1770000000000,
    hackerField: true,
  });
  assert.equal(invalidExtra.success, false);
});

test('userBestRecordsV1Schema y userSettingsV1Schema validan esquemas strict', () => {
  const best = userBestRecordsV1Schema.safeParse({
    schemaVersion: 1,
    uid: 'user-xyz',
    survivalBest: 12500,
    survivalBestWave: 15,
    adventureMaxLevel: 42,
    bestCombo: 8,
    updatedAt: 1770000000000,
  });
  assert.equal(best.success, true);

  const settings = userSettingsV1Schema.safeParse({
    schemaVersion: 1,
    soundVolume: 0.8,
    musicVolume: 0.5,
    hapticsEnabled: true,
    language: 'es',
    updatedAt: 1770000000000,
  });
  assert.equal(settings.success, true);
});

