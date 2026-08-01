import { createAnonymousAuthSession } from './anonymous-auth-session.js';
import { AUTH_EMULATOR_BOOTSTRAP_CONFIG } from './auth-emulator-bootstrap-config.js';
import { createFirebaseAuth } from './firebase-auth-client.js';

const AUTH_STATE_EVENT = 'convergence:auth-emulator-state';
const AUTH_APP_NAME = 'convergence-v2-auth-emulator';

type AuthBootstrapState =
  | { status: 'connecting' | 'signed-out'; uid: null; isAnonymous: false }
  | { status: 'authenticated'; uid: string; isAnonymous: boolean }
  | { status: 'error'; uid: null; isAnonymous: false; error: string };

let lastState = '';

function publishState(detail: AuthBootstrapState): void {
  const fingerprint = JSON.stringify(detail);
  if (fingerprint === lastState) return;
  lastState = fingerprint;
  window.dispatchEvent(new CustomEvent<AuthBootstrapState>(AUTH_STATE_EVENT, {
    detail: Object.freeze(detail),
  }));
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function startAuthEmulatorBootstrap(): Promise<void> {
  publishState({ status: 'connecting', uid: null, isAnonymous: false });

  try {
    const config = AUTH_EMULATOR_BOOTSTRAP_CONFIG;
    const auth = createFirebaseAuth({
      apiKey: 'demo-api-key',
      appId: 'demo-convergence-v2-web',
      authDomain: `${config.projectId}.firebaseapp.com`,
      projectId: config.projectId,
    }, AUTH_APP_NAME, {
      runtime: 'web',
      projectId: config.projectId,
      host: config.host,
      port: config.port,
      disableWarnings: true,
    });
    const session = createAnonymousAuthSession(auth);

    session.onAuthState((user) => {
      if (user === null) {
        publishState({ status: 'signed-out', uid: null, isAnonymous: false });
        return;
      }
      publishState({
        status: 'authenticated',
        uid: user.uid,
        isAnonymous: user.isAnonymous,
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
    console.error('[Convergence Auth Emulator] Bootstrap no disponible:', error);
  }
}

// Nunca bloquea native-bridge.js ni game.js: Auth es un carril de desarrollo paralelo.
void startAuthEmulatorBootstrap();
