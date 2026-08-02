import { initializeApp } from 'firebase-admin/app';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import './config/runtime.js';
import { leaderboardService } from './leaderboard.js';
import { legacyProgressImportService } from './legacy-progress.js';
import { verifyRunClaim } from './run-score.js';
import { userProfileService } from './user-profile.js';

initializeApp();

/**
 * `enforceAppCheck: false` es la fase de despliegue, no una renuncia.
 *
 * Con App Check recién configurado, forzar desde el código bloquearía en seco a
 * cualquiera cuyo navegador no consiga un token de reCAPTCHA —una extensión, un
 * dominio sin autorizar, una región donde google.com no carga— y el síntoma
 * llegaría como "no me aparecen los rankings", sin métrica que lo explique.
 *
 * En modo Monitor la consola registra qué proporción de llamadas traería token
 * válido sin rechazar ninguna. Cuando las métricas estén limpias se activa
 * Enforce **desde la consola**, sin tocar código ni redesplegar.
 *
 * Lo que NO se relaja: las callables siguen exigiendo sesión autenticada, y el
 * uid autoritativo sale de Auth, nunca del payload.
 */
const APP_CHECK = { enforceAppCheck: false } as const;

/**
 * Primera función deliberadamente mínima. Está protegida por Auth y App Check,
 * de modo que el scaffold no publique una API anónima por accidente.
 */
export const health = onCall(
  {
    enforceAppCheck: true,
  },
  (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    return {
      ok: true,
      service: 'convergence-v2',
      protocolVersion: 1,
      serverTime: Date.now(),
    };
  },
);

function authenticatedUid(request: { auth?: { uid: string } }): string {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  return request.auth.uid;
}

/** Previsualiza una reclamación legacy sin escribir perfil ni economía. */
export const previewLegacyProgressImport = onCall(
  APP_CHECK,
  (request) => legacyProgressImportService.preview(
    authenticatedUid(request),
    request.data,
  ),
);

/** Guarda una única reclamación en cuarentena mediante transacción idempotente. */
export const commitLegacyProgressImport = onCall(
  APP_CHECK,
  (request) => legacyProgressImportService.commit(
    authenticatedUid(request),
    request.data,
  ),
);

/** Escribe el perfil solo si `baseRevision` sigue vigente (compare-and-set). */
export const putUserProfile = onCall(
  APP_CHECK,
  (request) => userProfileService.putProfile(authenticatedUid(request), request.data),
);

/** Escribe las marcas personales bajo el mismo compare-and-set idempotente. */
export const putUserBestRecords = onCall(
  APP_CHECK,
  (request) => userProfileService.putRecords(authenticatedUid(request), request.data),
);

/** Devuelve el perfil con su revisión, o null si el usuario aún no tiene. */
export const getUserProfile = onCall(
  APP_CHECK,
  (request) => userProfileService.getProfile(authenticatedUid(request)),
);

/** Devuelve las marcas con su revisión, o null si aún no hay ninguna. */
export const getUserBestRecords = onCall(
  APP_CHECK,
  (request) => userProfileService.getRecords(authenticatedUid(request)),
);

/**
 * Recalcula una partida de **cualquiera de los seis modos** con el mismo núcleo
 * que ejecuta el cliente. El score que llega nunca se acepta como dato: se
 * compara con el recalculado. Es el cimiento de la verificación de la fase 6.
 */
export const verifyRun = onCall(
  APP_CHECK,
  (request) => {
    authenticatedUid(request);
    return verifyRunClaim(request.data);
  },
);

/**
 * Publica una partida en sus cuatro tablas. El score del cliente nunca se
 * guarda: se recalcula y solo se publica si coincide. Una reclamación que no
 * cuadra deja recibo de rechazo y no toca ninguna tabla.
 */
export const submitRunClaim = onCall(
  APP_CHECK,
  (request) => leaderboardService.submit(authenticatedUid(request), request.data),
);

/**
 * Devuelve una página de una tabla, con la posición del jugador que consulta.
 * Las entradas son de lectura pública en reglas, pero la paginación y el rango
 * pasan por aquí: el cursor es opaco y el periodo en curso lo fija el servidor.
 */
export const getLeaderboardPage = onCall(
  APP_CHECK,
  (request) => leaderboardService.page(authenticatedUid(request), request.data),
);
