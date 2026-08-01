import { initializeApp } from 'firebase-admin/app';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import './config/runtime.js';
import { legacyProgressImportService } from './legacy-progress.js';

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
