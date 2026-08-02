import { getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import type { FirebaseApp } from 'firebase/app';

import {
  leaderboardPageSchema,
  MAX_LEADERBOARD_PAGE_SIZE,
  type LeaderboardPage,
  type LeaderboardScope,
} from '@convergence/contracts';

/**
 * Transporte de rankings: lectura de tablas y publicación de partidas.
 *
 * Todo pasa por callables, no por el SDK de Firestore. Las entradas son de
 * lectura pública en reglas, pero el rango del jugador y la paginación no se
 * pueden resolver bien desde el cliente: `viewerRank` es una agregación y el
 * cursor debe ser opaco para que nadie salte a un offset arbitrario. Por eso el
 * artefacto cloud-dev sigue prohibiendo empaquetar Firestore.
 *
 * La región va explícita: las callables viven en `europe-west1` y el valor por
 * defecto del SDK es `us-central1`, así que omitirla llamaría a una URL que no
 * existe y fallaría con un CORS engañoso.
 */
export const FUNCTIONS_REGION = 'europe-west1';

export interface LeaderboardQuery {
  readonly mode: string;
  readonly scope: LeaderboardScope;
  /** Ausente = periodo en curso, que resuelve el servidor. */
  readonly scopeId?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface RunClaimResult {
  readonly verification: 'provisional' | 'verified' | 'rejected';
  readonly score: number;
  readonly claimedScore: number;
  readonly improvedBoards: readonly string[];
  readonly alreadyApplied: boolean;
}

export interface LeaderboardTransport {
  page(query: LeaderboardQuery): Promise<LeaderboardPage>;
  submit(claim: unknown): Promise<RunClaimResult>;
}

function functionsFor(app: FirebaseApp): Functions {
  return getFunctions(app, FUNCTIONS_REGION);
}

export function createLeaderboardTransport(app: FirebaseApp): LeaderboardTransport {
  const functions = functionsFor(app);
  const callPage = httpsCallable(functions, 'getLeaderboardPage');
  const callSubmit = httpsCallable(functions, 'submitRunClaim');

  return {
    async page(query) {
      if (query.limit !== undefined) {
        if (!Number.isInteger(query.limit) || query.limit < 1) {
          throw new Error('El tamaño de página debe ser un entero positivo.');
        }
        if (query.limit > MAX_LEADERBOARD_PAGE_SIZE) {
          throw new Error(`El tamaño de página máximo es ${MAX_LEADERBOARD_PAGE_SIZE}.`);
        }
      }
      const response = await callPage({
        mode: query.mode,
        scope: query.scope,
        ...(query.scopeId === undefined ? {} : { scopeId: query.scopeId }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      });
      // Se valida la respuesta contra el mismo contrato que aplica el servidor:
      // una tabla que no cumpla el esquema es un error de protocolo, no algo que
      // deba pintarse a medias en pantalla.
      return leaderboardPageSchema.parse(response.data);
    },

    async submit(claim) {
      const response = await callSubmit(claim);
      return response.data as RunClaimResult;
    },
  };
}
