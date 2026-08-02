import type {
  UserBestRecordsDocumentV1,
  UserBestRecordsWriteV1,
  UserProfileDocumentV1,
  UserProfileWriteV1,
} from '@convergence/contracts';
import {
  userBestRecordsDocumentV1Schema,
  userProfileDocumentV1Schema,
} from '@convergence/contracts';
import {
  httpsCallable,
  type Functions,
  type HttpsCallable,
} from 'firebase/functions';

import type { ProfileSyncTransport } from './user-profile-sync.js';

const CALLABLE_TIMEOUT_MS = 15_000;

export interface UserProfileCallables {
  putProfile: HttpsCallable<UserProfileWriteV1, unknown>;
  putRecords: HttpsCallable<UserBestRecordsWriteV1, unknown>;
  getProfile: HttpsCallable<void, unknown>;
  getRecords: HttpsCallable<void, unknown>;
}

/**
 * Un documento inexistente no es un error: significa que este UID todavía no
 * tiene nada en la nube y el coordinador debe subir lo local como revisión 0.
 */
function parseOptional<TDocument>(
  data: unknown,
  parse: (value: unknown) => TDocument,
): TDocument | null {
  return data === null || data === undefined ? null : parse(data);
}

export function createFirebaseUserProfileTransport(
  functions: Functions,
  callables: UserProfileCallables = {
    putProfile: httpsCallable(functions, 'putUserProfile', { timeout: CALLABLE_TIMEOUT_MS }),
    putRecords: httpsCallable(functions, 'putUserBestRecords', { timeout: CALLABLE_TIMEOUT_MS }),
    getProfile: httpsCallable(functions, 'getUserProfile', { timeout: CALLABLE_TIMEOUT_MS }),
    getRecords: httpsCallable(functions, 'getUserBestRecords', { timeout: CALLABLE_TIMEOUT_MS }),
  },
): ProfileSyncTransport {
  return {
    // El UID no viaja en la petición: el servidor lo deriva de Auth. Aceptarlo
    // del cliente permitiría pedir el perfil de otra persona.
    async fetchRemoteProfile(): Promise<UserProfileDocumentV1 | null> {
      const response = await callables.getProfile();
      return parseOptional(response.data, (value) => userProfileDocumentV1Schema.parse(value));
    },

    async fetchRemoteRecords(): Promise<UserBestRecordsDocumentV1 | null> {
      const response = await callables.getRecords();
      return parseOptional(response.data, (value) => userBestRecordsDocumentV1Schema.parse(value));
    },

    async pushProfile(write: UserProfileWriteV1): Promise<UserProfileDocumentV1> {
      const response = await callables.putProfile(write);
      return userProfileDocumentV1Schema.parse(response.data);
    },

    async pushRecords(write: UserBestRecordsWriteV1): Promise<UserBestRecordsDocumentV1> {
      const response = await callables.putRecords(write);
      return userBestRecordsDocumentV1Schema.parse(response.data);
    },
  };
}
