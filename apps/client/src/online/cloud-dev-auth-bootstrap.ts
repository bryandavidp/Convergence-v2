import { deleteApp } from 'firebase/app';
import { deleteUser, signInAnonymously, type User } from 'firebase/auth';

import { createAnonymousAuthSession } from './anonymous-auth-session.js';
import {
  createFirebaseCloudDevAuth,
  createFirebaseCloudDevSmokeAuth,
} from './firebase-cloud-auth-client.js';

declare const __CONVERGENCE_FIREBASE_CLOUD_DEV_CONFIG__: unknown;

export const AUTH_CLOUD_DEV_STATE_EVENT =
  'convergence:auth-cloud-dev-state';

type CloudDevAuthState =
  | { status: 'connecting' | 'signed-out' | 'deleted'; uid: null; isAnonymous: false }
  | { status: 'authenticated'; uid: string; isAnonymous: true }
  | { status: 'error'; uid: null; isAnonymous: false; error: string };

let lastState = '';

function publishState(detail: CloudDevAuthState): void {
  const fingerprint = JSON.stringify(detail);
  if (fingerprint === lastState) return;
  lastState = fingerprint;
  const smokeMode = new URLSearchParams(window.location.search).get('cloudAuthSmoke');
  if (smokeMode === 'delete' && isLoopback(window.location.hostname)) {
    // Marcador deliberadamente sin UID ni token para el smoke real de navegador.
    document.documentElement.dataset.convergenceCloudAuthSmokeStatus = detail.status;
  }
  window.dispatchEvent(new CustomEvent<CloudDevAuthState>(
    AUTH_CLOUD_DEV_STATE_EVENT,
    { detail: Object.freeze(detail) },
  ));
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Error desconocido al inicializar Auth cloud dev.';
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '[::1]'
    || hostname === '::1';
}

function shouldDeleteSmokeAccount(): boolean {
  const mode = new URLSearchParams(window.location.search).get('cloudAuthSmoke');
  if (mode === null) return false;
  if (mode !== 'delete') {
    throw new Error(`Modo cloudAuthSmoke no soportado: ${mode}.`);
  }
  if (!isLoopback(window.location.hostname)) {
    throw new Error('cloudAuthSmoke=delete solo está permitido desde loopback local.');
  }
  return true;
}

async function deleteAnonymousSmokeUser(user: User): Promise<void> {
  if (!user.isAnonymous) {
    throw new Error('El smoke cloud dev nunca elimina una cuenta no anónima.');
  }
  await deleteUser(user);
}

async function runDestructiveLoopbackSmoke(config: unknown): Promise<void> {
  const auth = createFirebaseCloudDevSmokeAuth(config);
  try {
    await auth.authStateReady();
    if (auth.currentUser !== null) {
      throw new Error('La app efímera del smoke debe empezar sin sesión.');
    }

    // Esta credencial nace en una app Firebase única y con persistencia en
    // memoria; por tanto nunca puede ser la sesión normal del desarrollador.
    const { user } = await signInAnonymously(auth);
    publishState({
      status: 'authenticated',
      uid: user.uid,
      isAnonymous: true,
    });
    await deleteAnonymousSmokeUser(user);
    publishState({ status: 'deleted', uid: null, isAnonymous: false });
  } finally {
    await deleteApp(auth.app);
  }
}

async function startCloudDevAuthBootstrap(): Promise<void> {
  publishState({ status: 'connecting', uid: null, isAnonymous: false });

  try {
    const deleteAfterSignIn = shouldDeleteSmokeAccount();
    if (deleteAfterSignIn) {
      await runDestructiveLoopbackSmoke(
        __CONVERGENCE_FIREBASE_CLOUD_DEV_CONFIG__,
      );
      return;
    }

    const auth = createFirebaseCloudDevAuth(
      __CONVERGENCE_FIREBASE_CLOUD_DEV_CONFIG__,
    );
    const session = createAnonymousAuthSession(auth);

    session.onAuthState((user) => {
      if (user === null) {
        publishState({ status: 'signed-out', uid: null, isAnonymous: false });
        return;
      }
      if (!user.isAnonymous) {
        publishState({
          status: 'error',
          uid: null,
          isAnonymous: false,
          error: 'Auth cloud dev esperaba una sesión anónima.',
        });
        return;
      }
      publishState({
        status: 'authenticated',
        uid: user.uid,
        isAnonymous: true,
      });
    });

    await session.ensureSignedIn();
  } catch (error) {
    const message = readableError(error);
    publishState({
      status: 'error',
      uid: null,
      isAnonymous: false,
      error: message,
    });
    console.error(`[Convergence Auth Cloud Dev] ${message}`);
  }
}

// Auth cloud dev es un carril paralelo: nunca bloquea bridge, juego ni PWA.
void startCloudDevAuthBootstrap();
