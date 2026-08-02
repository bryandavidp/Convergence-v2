import { z } from 'zod';
import {
  epochMillisSchema,
  gameModeSchema,
  idempotencyKeySchema,
  protocolVersionSchema,
  userIdSchema,
} from './common.js';

/** Los cuatro periodos de tabla. */
export const leaderboardScopeSchema = z.enum([
  'all-time',
  'season',
  'weekly',
  'daily',
]);

export type LeaderboardScope = z.infer<typeof leaderboardScopeSchema>;

/**
 * Todas las tablas se cortan en **UTC**. Usar la zona del jugador partiría una
 * tabla global en decenas de tablas distintas y permitiría reclamar dos veces el
 * mismo día cambiando el reloj del dispositivo.
 */
export const LEADERBOARD_TIMEZONE = 'UTC' as const;

export const SEASON_LENGTH_DAYS = 90;
/** Lunes 5 de enero de 2026, 00:00 UTC: inicio de la temporada 1. */
export const SEASON_EPOCH_MILLIS = Date.UTC(2026, 0, 5);
const DAY_MILLIS = 24 * 60 * 60 * 1000;

function utcDateId(atMillis: number): string {
  return new Date(atMillis).toISOString().slice(0, 10);
}

/**
 * Semana ISO-8601 en UTC: empiezan en lunes y la semana 1 es la que contiene el
 * primer jueves del año. Sin esa regla los días de fin de año caen en semanas
 * ambiguas y una misma partida podría contar en dos tablas.
 */
function isoWeekId(atMillis: number): string {
  const date = new Date(atMillis);
  const target = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
  // Se desplaza al jueves de su misma semana: ese jueves define el año ISO.
  const dayIndex = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayIndex + 3);
  const isoYear = target.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayIndex = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayIndex + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * DAY_MILLIS));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

function seasonId(atMillis: number): string {
  const elapsed = atMillis - SEASON_EPOCH_MILLIS;
  // Antes del inicio de la temporada 1 todo cuenta como temporada 1: una fecha
  // anterior no puede caer en una temporada negativa.
  const index = elapsed < 0 ? 0 : Math.floor(elapsed / (SEASON_LENGTH_DAYS * DAY_MILLIS));
  return `S${String(index + 1).padStart(3, '0')}`;
}

/**
 * Identificador del periodo al que pertenece una partida. Lo deriva siempre el
 * servidor del instante de cierre: si lo enviara el cliente, elegiría en qué día
 * o semana compite.
 */
export function leaderboardScopeId(scope: LeaderboardScope, atMillis: number): string {
  switch (scope) {
    case 'all-time': return 'all';
    case 'daily': return utcDateId(atMillis);
    case 'weekly': return isoWeekId(atMillis);
    case 'season': return seasonId(atMillis);
  }
}

/** Identidad de una tabla: modo, periodo e instancia del periodo. */
export function leaderboardBoardId(
  mode: string,
  scope: LeaderboardScope,
  scopeId: string,
): string {
  return `${mode}:${scope}:${scopeId}`;
}

export const leaderboardBoardIdSchema = z.string()
  .regex(/^[a-z-]+:(all-time|season|weekly|daily):[A-Za-z0-9-]+$/);

/**
 * Reclamación de una partida terminada.
 *
 * **No lleva `userId`**: la identidad se deriva de Auth en el servidor. Si la
 * enviara el cliente, podría reclamar puntuación en nombre de otra persona.
 * Tampoco lleva el periodo: lo deriva el servidor de `finishedAt`.
 *
 * `claimedScore` es lo que el cliente *afirma*; el servidor lo recalcula con
 * `@convergence/game-core` y solo lo acepta si coincide exactamente.
 */
export const runClaimSchema = z.strictObject({
  protocolVersion: protocolVersionSchema,
  idempotencyKey: idempotencyKeySchema,
  mode: gameModeSchema,
  difficulty: z.enum(['facil', 'normal', 'dificil']),
  claimedScore: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  seed: z.union([z.number().int(), z.string().min(1).max(128)]),
  startedAt: epochMillisSchema,
  finishedAt: epochMillisSchema,
  /** Versión del juego que produjo la partida; una desconocida se rechaza. */
  gameVersion: z.string().trim().min(1).max(32),
  finalStateHash: z.string().min(1).max(128),
  /** Bitácora de la partida, que el servidor reejecuta para verificar. */
  events: z.array(z.unknown()).max(4_000),
}).superRefine((claim, context) => {
  if (claim.finishedAt < claim.startedAt) {
    context.addIssue({
      code: 'custom',
      path: ['finishedAt'],
      message: 'finishedAt no puede ser anterior a startedAt.',
    });
  }
});

export type RunClaim = z.infer<typeof runClaimSchema>;

/**
 * Estado de verificación. `provisional` no llega a publicarse en esta fase:
 * existe para el día en que la verificación se difiera. `verified` ha superado
 * el recálculo; `rejected` no cuadró.
 */
export const scoreVerificationSchema = z.enum(['provisional', 'verified', 'rejected']);

export type ScoreVerification = z.infer<typeof scoreVerificationSchema>;

export const leaderboardEntrySchema = z.strictObject({
  protocolVersion: protocolVersionSchema,
  userId: userIdSchema,
  /** Alias público; nunca el nombre real ni el correo. */
  displayName: z.string().trim().min(1).max(24),
  mode: gameModeSchema,
  scope: leaderboardScopeSchema,
  scopeId: z.string().trim().min(1).max(64),
  score: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  verification: scoreVerificationSchema,
  updatedAt: epochMillisSchema,
});

export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

export const MAX_LEADERBOARD_PAGE_SIZE = 50;

export const leaderboardPageQuerySchema = z.strictObject({
  mode: gameModeSchema,
  scope: leaderboardScopeSchema,
  /** Ausente = periodo en curso, que resuelve el servidor. */
  scopeId: z.string().trim().min(1).max(64).optional(),
  limit: z.number().int().min(1).max(MAX_LEADERBOARD_PAGE_SIZE).optional(),
  /** Cursor opaco de paginación; lo emite el servidor. */
  cursor: z.string().trim().min(1).max(256).optional(),
});

export type LeaderboardPageQuery = z.infer<typeof leaderboardPageQuerySchema>;

export const leaderboardPageSchema = z.strictObject({
  boardId: leaderboardBoardIdSchema,
  entries: z.array(leaderboardEntrySchema).max(MAX_LEADERBOARD_PAGE_SIZE),
  nextCursor: z.string().min(1).max(256).nullable(),
  /** Posición del jugador que consulta, si tiene puntuación en esta tabla. */
  viewerRank: z.number().int().positive().nullable(),
});

export type LeaderboardPage = z.infer<typeof leaderboardPageSchema>;
