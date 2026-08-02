import { initializeApp } from 'firebase-admin/app';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import './config/runtime.js';
import { legacyProgressImportService } from './legacy-progress.js';
import { userProfileService } from './user-profile.js';

initializeApp();

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
  { enforceAppCheck: true },
  (request) => legacyProgressImportService.preview(
    authenticatedUid(request),
    request.data,
  ),
);

/** Guarda una única reclamación en cuarentena mediante transacción idempotente. */
export const commitLegacyProgressImport = onCall(
  { enforceAppCheck: true },
  (request) => legacyProgressImportService.commit(
    authenticatedUid(request),
    request.data,
  ),
);

/** Escribe el perfil solo si `baseRevision` sigue vigente (compare-and-set). */
export const putUserProfile = onCall(
  { enforceAppCheck: true },
  (request) => userProfileService.putProfile(authenticatedUid(request), request.data),
);

/** Escribe las marcas personales bajo el mismo compare-and-set idempotente. */
export const putUserBestRecords = onCall(
  { enforceAppCheck: true },
  (request) => userProfileService.putRecords(authenticatedUid(request), request.data),
);

/** Devuelve el perfil con su revisión, o null si el usuario aún no tiene. */
export const getUserProfile = onCall(
  { enforceAppCheck: true },
  (request) => userProfileService.getProfile(authenticatedUid(request)),
);

/** Devuelve las marcas con su revisión, o null si aún no hay ninguna. */
export const getUserBestRecords = onCall(
  { enforceAppCheck: true },
  (request) => userProfileService.getRecords(authenticatedUid(request)),
);
