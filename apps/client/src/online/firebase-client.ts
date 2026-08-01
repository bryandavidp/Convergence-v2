import type { FirebaseOptions } from 'firebase/app';
import { getDatabase, type Database } from 'firebase/database';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getFunctions, type Functions } from 'firebase/functions';

import {
  createFirebaseAuth,
  type FirebaseAuthEmulatorOptions,
} from './firebase-auth-client.js';

export * from './firebase-auth-client.js';

export interface FirebaseServices {
  auth: ReturnType<typeof createFirebaseAuth>;
  database: Database;
  firestore: Firestore;
  functions: Functions;
}

/**
 * Factory de compatibilidad para consumidores que necesitan todos los SDK.
 * Los puntos de entrada Auth-only deben importar firebase-auth-client.ts para
 * evitar registrar Database, Firestore y Functions en su bundle.
 */
export function createFirebaseServices(
  options: FirebaseOptions,
  appName = 'convergence-v2',
  emulatorOptions: FirebaseAuthEmulatorOptions = {},
): FirebaseServices {
  const auth = createFirebaseAuth(options, appName, emulatorOptions);
  const app = auth.app;

  return {
    auth,
    database: getDatabase(app),
    firestore: getFirestore(app),
    functions: getFunctions(app, 'europe-west1'),
  };
}
