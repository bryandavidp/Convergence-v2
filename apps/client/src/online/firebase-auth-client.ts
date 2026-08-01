import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  connectAuthEmulator,
  inMemoryPersistence,
  initializeAuth,
  type Auth,
} from 'firebase/auth';

export const DEFAULT_FIREBASE_EMULATOR_PROJECT_ID = 'demo-convergence-v2';
export const DEFAULT_AUTH_EMULATOR_PORT = 9099;
export const DEFAULT_WEB_EMULATOR_HOST = '127.0.0.1';
export const DEFAULT_ANDROID_EMULATOR_HOST = '10.0.2.2';

export type FirebaseEmulatorRuntime = 'web' | 'android' | 'ios';

export interface FirebaseAuthEmulatorOptions {
  runtime?: FirebaseEmulatorRuntime;
  projectId?: string;
  host?: string;
  port?: number;
  disableWarnings?: boolean;
}

export interface ResolvedFirebaseAuthEmulatorOptions {
  runtime: FirebaseEmulatorRuntime;
  projectId: string;
  host: string;
  port: number;
  disableWarnings: boolean;
  url: string;
}

export function resolveAuthEmulatorOptions(
  options: FirebaseAuthEmulatorOptions = {},
): ResolvedFirebaseAuthEmulatorOptions {
  const runtime = options.runtime ?? 'web';
  if (runtime !== 'web' && runtime !== 'android' && runtime !== 'ios') {
    throw new Error(`Runtime de emulador Firebase no soportado: ${String(runtime)}.`);
  }

  const projectId = (options.projectId ?? DEFAULT_FIREBASE_EMULATOR_PROJECT_ID).trim();
  if (!/^demo-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(projectId)) {
    throw new Error(
      `Firebase Emulator exige un projectId demo-*; recibido: ${projectId || '(vacío)'}.`,
    );
  }

  const defaultHost = runtime === 'android'
    ? DEFAULT_ANDROID_EMULATOR_HOST
    : DEFAULT_WEB_EMULATOR_HOST;
  const host = (options.host ?? defaultHost).trim();
  const validHost = /^(?:\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?)$/;
  if (!validHost.test(host)) {
    throw new Error(
      'El host del Auth Emulator debe ser solo un hostname o una IP, sin protocolo, puerto ni ruta.',
    );
  }

  const port = options.port ?? DEFAULT_AUTH_EMULATOR_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Puerto de Auth Emulator inválido: ${String(port)}.`);
  }

  const disableWarnings = options.disableWarnings ?? true;
  return {
    runtime,
    projectId,
    host,
    port,
    disableWarnings,
    url: `http://${host}:${port}`,
  };
}

function connectToAuthEmulator(
  auth: Auth,
  emulator: ResolvedFirebaseAuthEmulatorOptions,
): void {
  const current = auth.emulatorConfig;
  if (current === null) {
    connectAuthEmulator(auth, emulator.url, {
      disableWarnings: emulator.disableWarnings,
    });
    return;
  }

  const sameEndpoint = current.protocol === 'http'
    && current.host === emulator.host
    && current.port === emulator.port;
  if (!sameEndpoint) {
    throw new Error(
      `Auth ya está conectado a otro emulador: ${current.protocol}://${current.host}:${String(current.port)}.`,
    );
  }
}

/**
 * Inicializa exclusivamente Auth contra Emulator Suite.
 *
 * La persistencia en memoria evita que una identidad de desarrollo sobreviva
 * a una recarga o termine mezclada con el estado local del juego legacy.
 */
export function createFirebaseAuth(
  options: FirebaseOptions,
  appName = 'convergence-v2-auth',
  emulatorOptions: FirebaseAuthEmulatorOptions = {},
): Auth {
  const projectId = emulatorOptions.projectId ?? options.projectId
    ?? DEFAULT_FIREBASE_EMULATOR_PROJECT_ID;
  const emulator = resolveAuthEmulatorOptions({
    ...emulatorOptions,
    projectId,
  });

  if (options.projectId !== undefined && options.projectId !== emulator.projectId) {
    throw new Error(
      `El projectId de Firebase (${options.projectId}) no coincide con el emulador (${emulator.projectId}).`,
    );
  }

  const existing = getApps().some((candidate) => candidate.name === appName);
  const app = existing
    ? getApp(appName)
    : initializeApp({
        ...options,
        apiKey: options.apiKey?.trim() || 'demo-api-key',
        projectId: emulator.projectId,
      }, appName);

  if (app.options.projectId !== emulator.projectId) {
    throw new Error(
      `La app Firebase existente ${appName} usa ${String(app.options.projectId)} y no puede reutilizarse con ${emulator.projectId}.`,
    );
  }

  const auth = initializeAuth(app, {
    persistence: inMemoryPersistence,
  });
  connectToAuthEmulator(auth, emulator);
  return auth;
}
