import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  CustomProvider,
  initializeAppCheck,
  type AppCheck,
} from 'firebase/app-check';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  inMemoryPersistence,
  type Auth,
} from 'firebase/auth';
import {
  connectFunctionsEmulator,
  getFunctions,
  type Functions,
} from 'firebase/functions';

import { resolveAuthEmulatorOptions } from './firebase-auth-client.js';

export interface FirebaseProfileEmulatorOptions {
  projectId?: string;
  host?: string;
  authPort?: number;
  functionsPort?: number;
  region?: string;
}

export interface FirebaseProfileEmulatorServices {
  auth: Auth;
  appCheck: AppCheck;
  functions: Functions;
  projectId: string;
}

function assertPort(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${label} inválido: ${String(value)}.`);
  }
  return value;
}

function base64Url(value: unknown): string {
  return btoa(JSON.stringify(value))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** Token deliberadamente sintético y exclusivo del Emulator Suite local. */
export function createUnsignedEmulatorAppCheckToken(appId: string): string {
  return [
    base64Url({ alg: 'none', typ: 'JWT' }),
    base64Url({ sub: appId, app_id: appId }),
    'emulator-only-signature',
  ].join('.');
}

/**
 * Variante aislada para el vertical de perfil. A diferencia del smoke Auth,
 * conserva el UID anónimo entre recargas para poder ligar una cola durable.
 */
export function createFirebaseProfileEmulatorServices(
  options: FirebaseOptions,
  appName = 'convergence-v2-profile-emulator',
  emulatorOptions: FirebaseProfileEmulatorOptions = {},
): FirebaseProfileEmulatorServices {
  const projectId = emulatorOptions.projectId ?? options.projectId
    ?? 'demo-convergence-v2';
  const authEmulator = resolveAuthEmulatorOptions({
    runtime: 'web',
    projectId,
    disableWarnings: true,
    ...(emulatorOptions.host === undefined ? {} : { host: emulatorOptions.host }),
    ...(emulatorOptions.authPort === undefined ? {} : { port: emulatorOptions.authPort }),
  });
  const functionsPort = assertPort(
    emulatorOptions.functionsPort ?? 5_001,
    'Puerto de Functions Emulator',
  );
  const region = emulatorOptions.region ?? 'europe-west1';
  if (!/^[a-z]+(?:-[a-z0-9]+)+$/.test(region)) {
    throw new Error(`Región de Functions inválida: ${region}.`);
  }

  const existing = getApps().some((candidate) => candidate.name === appName);
  const app = existing
    ? getApp(appName)
    : initializeApp({
        ...options,
        apiKey: options.apiKey?.trim() || 'demo-api-key',
        appId: options.appId?.trim() || 'demo-convergence-v2-profile-web',
        authDomain: options.authDomain?.trim() || `${projectId}.firebaseapp.com`,
        projectId,
      }, appName);
  if (app.options.projectId !== projectId) {
    throw new Error(
      `La app Firebase existente ${appName} usa ${String(app.options.projectId)} y no ${projectId}.`,
    );
  }

  const auth = existing
    ? getAuth(app)
    : initializeAuth(app, {
        persistence: [
          indexedDBLocalPersistence,
          browserLocalPersistence,
          inMemoryPersistence,
        ],
      });
  if (auth.emulatorConfig === null) {
    connectAuthEmulator(auth, authEmulator.url, { disableWarnings: true });
  } else if (
    auth.emulatorConfig.protocol !== 'http'
    || auth.emulatorConfig.host !== authEmulator.host
    || auth.emulatorConfig.port !== authEmulator.port
  ) {
    throw new Error('Auth ya está conectado a otro endpoint.');
  }

  const appId = String(app.options.appId);
  const appCheck = initializeAppCheck(app, {
    provider: new CustomProvider({
      getToken: async () => ({
        token: createUnsignedEmulatorAppCheckToken(appId),
        expireTimeMillis: Date.now() + 60 * 60 * 1_000,
      }),
    }),
    isTokenAutoRefreshEnabled: false,
  });
  const functions = getFunctions(app, region);
  connectFunctionsEmulator(functions, authEmulator.host, functionsPort);

  return { auth, appCheck, functions, projectId };
}
