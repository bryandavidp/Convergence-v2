import { createAnonymousAuthSession } from './anonymous-auth-session.js';
import { createFirebaseProfileEmulatorServices } from './firebase-profile-emulator-client.js';
import { createFirebaseLegacyProgressTransport } from './legacy-progress-transport.js';
import {
  LegacyProgressSyncCoordinator,
  type ProfileSyncPublicState,
} from './legacy-progress-sync.js';
import { createWebPlatform } from '../platform/web.js';
import { JsonRepository } from '../storage/json-repository.js';
import { Outbox } from '../storage/outbox.js';

const PROJECT_ID = 'demo-convergence-v2';
const PROFILE_STATE_EVENT = 'convergence:profile-emulator-state';
const LEGACY_STORAGE_EVENT = 'convergence:legacy-storage-changed';
const CONFIRM_EVENT = 'convergence:legacy-import-confirm';

declare global {
  interface Window {
    ConvergenceProfileMigration?: Readonly<{
      confirm(): Promise<void>;
      capture(): Promise<void>;
      state(): ProfileSyncPublicState;
    }>;
  }
}

function publish(detail: ProfileSyncPublicState): void {
  window.dispatchEvent(new CustomEvent(PROFILE_STATE_EVENT, {
    detail: Object.freeze(detail),
  }));
}

function publishFatal(error: unknown): void {
  publish({
    status: 'error',
    serverRevision: 0,
    canConfirm: false,
    lastError: (error instanceof Error ? error.message : String(error)).slice(0, 300),
    preview: null,
  });
  console.error('[Convergence Profile Emulator] Carril no disponible:', error);
}

async function start(): Promise<void> {
  try {
    const services = createFirebaseProfileEmulatorServices({
      apiKey: 'demo-api-key',
      appId: 'demo-convergence-v2-profile-web',
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
    }, 'convergence-v2-profile-emulator', {
      projectId: PROJECT_ID,
      host: '127.0.0.1',
      authPort: 9_099,
      functionsPort: 5_001,
      region: 'europe-west1',
    });
    const session = createAnonymousAuthSession(services.auth);
    const user = await session.ensureSignedIn();
    const platform = createWebPlatform();
    const repository = new JsonRepository(platform.storage);
    const outbox = new Outbox(repository);
    const transport = createFirebaseLegacyProgressTransport(services.functions);
    const coordinator = new LegacyProgressSyncCoordinator(
      user.uid,
      repository,
      outbox,
      transport,
      { publish },
    );

    window.ConvergenceProfileMigration = Object.freeze({
      confirm: () => coordinator.confirm(),
      capture: async () => {
        await coordinator.captureLegacyMeta();
        await coordinator.drain();
      },
      state: () => coordinator.snapshot(),
    });
    window.addEventListener(LEGACY_STORAGE_EVENT, (event) => {
      const detail = (event as CustomEvent<{ key?: unknown }>).detail;
      if (detail?.key !== 'cv_meta') return;
      void coordinator.captureLegacyMeta().then(() => coordinator.drain());
    });
    window.addEventListener('online', () => void coordinator.notifyOnline());
    window.addEventListener('focus', () => void coordinator.notifyOnline());
    window.addEventListener(CONFIRM_EVENT, () => void coordinator.confirm());
    await coordinator.start();
  } catch (error) {
    publishFatal(error);
  }
}

// Es un carril paralelo: native-bridge.js y game.js nunca esperan este Promise.
void start();
