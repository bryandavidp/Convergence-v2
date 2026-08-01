import {
  getApp,
  getApps,
  initializeApp,
  type FirebaseApp,
} from 'firebase/app';
import {
  browserLocalPersistence,
  indexedDBLocalPersistence,
  initializeAuth,
  inMemoryPersistence,
  type Auth,
  type Dependencies,
  type Persistence,
} from 'firebase/auth';

import {
  resolveFirebaseCloudDevConfig,
  type FirebaseCloudDevOptions,
} from './firebase-cloud-dev-config.js';

export const FIREBASE_CLOUD_DEV_AUTH_APP_NAME =
  'convergence-v2-auth-cloud-dev';
export const FIREBASE_CLOUD_DEV_SMOKE_APP_PREFIX =
  'convergence-v2-auth-cloud-dev-smoke';

function sameSelectedOptions(
  app: FirebaseApp,
  expected: FirebaseCloudDevOptions,
): boolean {
  return app.options.apiKey === expected.apiKey
    && app.options.appId === expected.appId
    && app.options.authDomain === expected.authDomain
    && app.options.databaseURL === expected.databaseURL
    && app.options.messagingSenderId === expected.messagingSenderId
    && app.options.projectId === expected.projectId
    && app.options.storageBucket === expected.storageBucket;
}

/** Inicializa exclusivamente Auth con dependencias explícitas y sin redirects. */
function initializeFirebaseCloudDevAuth(
  configInput: unknown,
  appName: string,
  persistence: Persistence[],
): Auth {
  const options = resolveFirebaseCloudDevConfig(configInput);
  const existing = getApps().some((candidate) => candidate.name === appName);
  const app = existing ? getApp(appName) : initializeApp(options, appName);

  if (!sameSelectedOptions(app, options)) {
    throw new Error(
      `La app Firebase existente ${appName} no coincide con el destino cloud dev permitido.`,
    );
  }

  const authDependencies = {
    persistence,
    popupRedirectResolver: undefined,
  };
  const auth = initializeAuth(
    app,
    // Firebase recomienda `undefined` para excluir popup/redirect; su tipo
    // opcional no modela exactOptionalPropertyTypes aunque el runtime sí.
    authDependencies as Omit<Dependencies, 'popupRedirectResolver'>,
  );

  if (auth.emulatorConfig !== null) {
    throw new Error('Auth cloud dev no puede reutilizar una instancia conectada a Emulator Suite.');
  }

  return auth;
}

export function createFirebaseCloudDevAuth(
  configInput: unknown,
  appName = FIREBASE_CLOUD_DEV_AUTH_APP_NAME,
): Auth {
  // La sesión normal cae de IndexedDB a localStorage y después a memoria.
  return initializeFirebaseCloudDevAuth(configInput, appName, [
    indexedDBLocalPersistence,
    browserLocalPersistence,
    inMemoryPersistence,
  ]);
}

/** Crea una app distinta y solo en memoria para no tocar la sesión de desarrollo. */
export function createFirebaseCloudDevSmokeAuth(
  configInput: unknown,
  nonce = crypto.randomUUID(),
): Auth {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(nonce)) {
    throw new Error('Nonce de Auth smoke cloud dev no válido.');
  }
  return initializeFirebaseCloudDevAuth(
    configInput,
    `${FIREBASE_CLOUD_DEV_SMOKE_APP_PREFIX}-${nonce}`,
    [inMemoryPersistence],
  );
}
