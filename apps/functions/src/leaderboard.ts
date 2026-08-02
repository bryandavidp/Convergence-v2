import {
  leaderboardBoardId,
  leaderboardEntrySchema,
  leaderboardPageQuerySchema,
  leaderboardScopeId,
  runClaimSchema,
  type LeaderboardPage,
  type LeaderboardScope,
  type RunClaim,
  type ScoreVerification,
} from '@convergence/contracts';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { sha256 } from './legacy-progress.js';
import { recomputeRun, parseRunClaim } from './run-score.js';

/**
 * Publicación de puntuaciones en tabla.
 *
 * Regla que no se negocia: **el score del cliente nunca se guarda**. Se recalcula
 * con `@convergence/game-core` —el mismo módulo que ejecutó el cliente— y solo se
 * publica si coincide exactamente. Una reclamación que no cuadra deja recibo de
 * rechazo y no toca ninguna tabla.
 *
 * Los documentos viven en `leaderboards/{boardId}/entries/{uid}`, que ya tiene
 * reglas verificadas: lectura pública, escritura de cliente denegada. Las
 * escrituras entran por esta callable con Admin SDK, que no pasa por reglas.
 */

export const LEADERBOARD_SCOPES: readonly LeaderboardScope[] = [
  'all-time', 'season', 'weekly', 'daily',
];

/**
 * Versiones de juego cuyas puntuaciones se aceptan. Es una lista explícita y no
 * un mínimo porque las reglas de puntuación pueden cambiar entre versiones: una
 * partida de una versión con otra fórmula no es comparable. Al publicar una
 * versión nueva hay que añadirla aquí, y un test lo exige.
 */
export const ACCEPTED_GAME_VERSIONS: readonly string[] = ['2.37.6', '2.37.7', '2.37.8', '2.37.9'];

/** Ventana y tope de reclamaciones por usuario, para limitar el abuso. */
export const CLAIM_RATE_WINDOW_MS = 60 * 60 * 1000;
export const MAX_CLAIMS_PER_WINDOW = 60;

/** Margen de reloj aceptado entre el cierre declarado y el del servidor. */
export const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;

export interface BoardTarget {
  readonly scope: LeaderboardScope;
  readonly scopeId: string;
  readonly boardId: string;
}

export interface PreparedClaim {
  readonly uid: string;
  readonly operationId: string;
  readonly ownerHash: string;
  readonly claim: RunClaim;
  readonly score: number;
  readonly verification: ScoreVerification;
  readonly boards: readonly BoardTarget[];
  readonly now: number;
}

export interface ClaimResult {
  readonly verification: ScoreVerification;
  readonly score: number;
  readonly claimedScore: number;
  /** Tablas en las que esta puntuación quedó como mejor marca del jugador. */
  readonly improvedBoards: readonly string[];
  readonly alreadyApplied: boolean;
}

export interface LeaderboardStore {
  publish(input: PreparedClaim, displayNameFallback: string): Promise<ClaimResult>;
}

function invalid(message: string, details?: unknown): HttpsError {
  return new HttpsError('invalid-argument', message, details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deriveClaimOperationId(uid: string, idempotencyKey: string): string {
  return sha256(`run-claim\0${uid}\0${idempotencyKey}`);
}

/** Las cuatro tablas a las que aspira una partida, derivadas de su cierre. */
export function boardsForClaim(mode: string, finishedAt: number): BoardTarget[] {
  return LEADERBOARD_SCOPES.map((scope) => {
    const scopeId = leaderboardScopeId(scope, finishedAt);
    return { scope, scopeId, boardId: leaderboardBoardId(mode, scope, scopeId) };
  });
}

function parseClaim(data: unknown): RunClaim {
  const result = runClaimSchema.safeParse(data);
  if (!result.success) {
    throw invalid('RunClaim inválida.', {
      issues: result.error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

/**
 * Verifica una reclamación sin tocar almacenamiento: valida el sobre, rechaza
 * versiones desconocidas y relojes imposibles, y recalcula la puntuación.
 */
export function prepareClaim(uid: string, data: unknown, now: number): PreparedClaim {
  const claim = parseClaim(data);

  if (!ACCEPTED_GAME_VERSIONS.includes(claim.gameVersion)) {
    throw new HttpsError(
      'failed-precondition',
      'Versión de juego no aceptada para puntuar.',
      { gameVersion: claim.gameVersion },
    );
  }
  // Una partida que dice haber terminado en el futuro tiene el reloj manipulado,
  // y además elegiría el periodo en el que compite.
  if (claim.finishedAt > now + MAX_CLOCK_SKEW_MS) {
    throw invalid('finishedAt está demasiado por delante del reloj del servidor.');
  }

  // El fin de la run se deriva de la BITÁCORA, no de `finishedAt - startedAt`.
  //
  // Son dos relojes distintos: el sobre lleva reloj de pared y los eventos, el
  // reloj de partida, que solo corre mientras se juega. Restar marcas de pared
  // daba un final incoherente en cuanto ambos divergían —una pausa, la app en
  // segundo plano, una partida reanudada— y el sobre se rechazaba con
  // `endedAtSeconds inválido` antes siquiera de recalcular: una marca legítima
  // desaparecía sin explicación. `parseRunClaim` ya usa por defecto el último
  // evento cuando no se le pasa nada, que es la única fuente coherente.
  //
  // `finishedAt` se sigue usando, pero solo para lo que sí mide: a qué día,
  // semana y temporada pertenece la partida.
  const outcome = recomputeRun(parseRunClaim({
    mode: claim.mode,
    difficulty: claim.difficulty,
    events: claim.events,
  }));

  const verification: ScoreVerification = outcome.score === claim.claimedScore
    ? 'verified'
    : 'rejected';

  return {
    uid,
    operationId: deriveClaimOperationId(uid, claim.idempotencyKey),
    ownerHash: sha256(uid),
    claim,
    score: outcome.score,
    verification,
    // Una reclamación rechazada no aspira a ninguna tabla.
    boards: verification === 'verified' ? boardsForClaim(claim.mode, claim.finishedAt) : [],
    now,
  };
}

class FirestoreLeaderboardStore implements LeaderboardStore {
  async publish(input: PreparedClaim, displayNameFallback: string): Promise<ClaimResult> {
    const firestore = getFirestore();
    const userRef = firestore.collection('users').doc(input.uid);
    const receiptRef = userRef.collection('runClaimReceipts').doc(input.operationId);
    const rateRef = userRef.collection('runClaimReceipts').doc('_rate');
    const profileRef = userRef.collection('cloudProfile').doc('current');
    // Se emparejan tabla y referencia para no indexar arrays en paralelo, que es
    // donde se cuelan los desajustes cuando una lista cambia de longitud.
    const targets = input.boards.map((board) => ({
      board,
      ref: firestore.collection('leaderboards').doc(board.boardId)
        .collection('entries').doc(input.uid),
    }));

    return firestore.runTransaction(async (transaction) => {
      const [receiptSnapshot, rateSnapshot, profileSnapshot] = await Promise.all([
        transaction.get(receiptRef),
        transaction.get(rateRef),
        transaction.get(profileRef),
      ]);
      const entries = await Promise.all(targets.map(async (target) => ({
        ...target,
        snapshot: await transaction.get(target.ref),
      })));

      if (receiptSnapshot.exists) {
        const receipt = receiptSnapshot.data();
        if (!isRecord(receipt)) {
          throw new HttpsError('internal', 'El recibo existe sin datos.');
        }
        if (receipt.ownerHash !== input.ownerHash) {
          throw new HttpsError('internal', 'Colisión de identidad en la reclamación.');
        }
        // Misma clave con otra partida no es un reintento: es otra reclamación.
        if (receipt.claimedScore !== input.claim.claimedScore) {
          throw new HttpsError(
            'already-exists',
            'La idempotency key ya se usó con otra partida.',
          );
        }
        return {
          verification: receipt.verification as ScoreVerification,
          score: Number(receipt.score),
          claimedScore: Number(receipt.claimedScore),
          improvedBoards: Array.isArray(receipt.improvedBoards)
            ? receipt.improvedBoards.map(String)
            : [],
          alreadyApplied: true,
        };
      }

      const windowStartedAt = rateSnapshot.exists
        && Number(rateSnapshot.get('windowStartedAt')) > input.now - CLAIM_RATE_WINDOW_MS
        ? Number(rateSnapshot.get('windowStartedAt'))
        : input.now;
      const claimsInWindow = windowStartedAt === input.now
        ? 0
        : Number(rateSnapshot.get('claims') ?? 0);
      if (claimsInWindow >= MAX_CLAIMS_PER_WINDOW) {
        throw new HttpsError(
          'resource-exhausted',
          'Demasiadas reclamaciones en poco tiempo.',
          { retryAt: windowStartedAt + CLAIM_RATE_WINDOW_MS },
        );
      }

      const profileBody = profileSnapshot.exists ? profileSnapshot.get('body') : null;
      const displayName = isRecord(profileBody) && typeof profileBody.displayName === 'string'
        ? profileBody.displayName
        : displayNameFallback;

      const improvedBoards: string[] = [];
      for (const { board, ref, snapshot } of entries) {
        const previous = snapshot.exists ? Number(snapshot.get('score') ?? 0) : -1;
        // Solo se guarda la mejor marca del jugador en cada tabla.
        if (input.score <= previous) continue;
        improvedBoards.push(board.boardId);
        transaction.set(ref, {
          protocolVersion: 1,
          userId: input.uid,
          displayName,
          mode: input.claim.mode,
          scope: board.scope,
          scopeId: board.scopeId,
          score: input.score,
          verification: input.verification,
          updatedAt: input.now,
        });
      }

      transaction.create(receiptRef, {
        schemaVersion: 1,
        operationId: input.operationId,
        ownerHash: input.ownerHash,
        mode: input.claim.mode,
        gameVersion: input.claim.gameVersion,
        finalStateHash: input.claim.finalStateHash,
        score: input.score,
        claimedScore: input.claim.claimedScore,
        verification: input.verification,
        improvedBoards,
        createdAtMillis: input.now,
      });
      transaction.set(rateRef, {
        windowStartedAt,
        claims: claimsInWindow + 1,
        updatedAtMillis: input.now,
      });

      return {
        verification: input.verification,
        score: input.score,
        claimedScore: input.claim.claimedScore,
        improvedBoards,
        alreadyApplied: false,
      };
    });
  }
}

/* ===================== Lectura de tablas ===================== */

export const DEFAULT_LEADERBOARD_PAGE_SIZE = 20;

/**
 * Cursor de paginación. Es opaco a propósito: el cliente no debe poder saltar a
 * una posición arbitraria ni deducir cuántas entradas hay. Lleva la última
 * puntuación y el uid de la última fila, que es lo que Firestore necesita para
 * continuar de forma determinista (el orden real es `score desc, __name__ desc`).
 */
export interface LeaderboardCursor {
  readonly score: number;
  readonly userId: string;
}

export function encodeLeaderboardCursor(cursor: LeaderboardCursor): string {
  return Buffer.from(`${cursor.score}\0${cursor.userId}`, 'utf8').toString('base64url');
}

export function decodeLeaderboardCursor(raw: string): LeaderboardCursor {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const separator = decoded.indexOf('\0');
  if (separator <= 0) throw invalid('Cursor de paginación inválido.');
  const score = Number(decoded.slice(0, separator));
  const userId = decoded.slice(separator + 1);
  if (!Number.isSafeInteger(score) || score < 0 || userId.length === 0) {
    throw invalid('Cursor de paginación inválido.');
  }
  return { score, userId };
}

export interface LeaderboardReader {
  page(query: ResolvedPageQuery, viewerUid: string): Promise<LeaderboardPage>;
}

export interface ResolvedPageQuery {
  readonly boardId: string;
  readonly limit: number;
  readonly cursor: LeaderboardCursor | null;
}

/**
 * Traduce la consulta del cliente a una tabla concreta. El `scopeId` ausente
 * significa "el periodo en curso", y lo resuelve el servidor con su reloj: si lo
 * eligiera el cliente podría consultar —y más adelante competir en— un periodo
 * que no le toca.
 */
export function resolvePageQuery(data: unknown, now: number): ResolvedPageQuery {
  const result = leaderboardPageQuerySchema.safeParse(data);
  if (!result.success) {
    throw invalid('Consulta de tabla inválida.', {
      issues: result.error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    });
  }
  const query = result.data;
  const scopeId = query.scopeId ?? leaderboardScopeId(query.scope, now);
  return {
    boardId: leaderboardBoardId(query.mode, query.scope, scopeId),
    limit: query.limit ?? DEFAULT_LEADERBOARD_PAGE_SIZE,
    cursor: query.cursor === undefined ? null : decodeLeaderboardCursor(query.cursor),
  };
}

class FirestoreLeaderboardReader implements LeaderboardReader {
  async page(query: ResolvedPageQuery, viewerUid: string): Promise<LeaderboardPage> {
    const firestore = getFirestore();
    const entries = firestore.collection('leaderboards').doc(query.boardId).collection('entries');

    // Solo se publican entradas verificadas (una reclamación rechazada no aspira
    // a ninguna tabla), así que basta ordenar: no hace falta filtrar por estado
    // y el índice de campo simple de Firestore cubre la consulta.
    let page = entries.orderBy('score', 'desc').limit(query.limit + 1);
    if (query.cursor) {
      const anchor = await entries.doc(query.cursor.userId).get();
      // Si la fila del cursor desapareció, se continúa por puntuación: perder la
      // página es peor que repetir alguna entrada en un empate.
      page = anchor.exists ? page.startAfter(anchor) : page.startAfter(query.cursor.score);
    }

    const [snapshot, viewerSnapshot] = await Promise.all([
      page.get(),
      entries.doc(viewerUid).get(),
    ]);

    const rows = snapshot.docs.slice(0, query.limit);
    const hasMore = snapshot.docs.length > query.limit;
    const last = rows.at(-1);

    return {
      boardId: query.boardId,
      entries: rows.map((doc) => leaderboardEntrySchema.parse(doc.data())),
      nextCursor: hasMore && last
        ? encodeLeaderboardCursor({ score: Number(last.get('score')), userId: last.id })
        : null,
      viewerRank: await this.rankOf(entries, viewerSnapshot),
    };
  }

  /**
   * Posición del jugador = cuántas puntuaciones la superan, más uno. Se resuelve
   * con una agregación `count()`, que el servidor cobra por índice y no por
   * documento leído: contar trayendo la tabla entera no escala.
   */
  private async rankOf(
    entries: FirebaseFirestore.CollectionReference,
    viewer: FirebaseFirestore.DocumentSnapshot,
  ): Promise<number | null> {
    if (!viewer.exists) return null;
    const score = Number(viewer.get('score'));
    if (!Number.isFinite(score)) return null;
    const above = await entries.where('score', '>', score).count().get();
    return above.data().count + 1;
  }
}

export function createLeaderboardService(
  store: LeaderboardStore = new FirestoreLeaderboardStore(),
  now: () => number = Date.now,
  reader: LeaderboardReader = new FirestoreLeaderboardReader(),
) {
  const clock = () => {
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new HttpsError('internal', 'El reloj del servicio es inválido.');
    }
    return timestamp;
  };

  return {
    async submit(uid: string, data: unknown): Promise<ClaimResult> {
      const prepared = prepareClaim(uid, data, clock());
      return store.publish(prepared, 'Jugador');
    },
    async page(viewerUid: string, data: unknown): Promise<LeaderboardPage> {
      return reader.page(resolvePageQuery(data, clock()), viewerUid);
    },
  };
}

export const leaderboardService = createLeaderboardService();
