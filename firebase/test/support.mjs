import { readFile } from 'node:fs/promises';

import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

export const PROJECT_ID = 'demo-convergence-v2';
export const DATABASE_URL = `https://${PROJECT_ID}-default-rtdb.firebaseio.com`;
export const STORAGE_BUCKET = `gs://${PROJECT_ID}.appspot.com`;

const EMULATOR_HOST = '127.0.0.1';

if (!PROJECT_ID.startsWith('demo-')) {
  throw new Error(`Rules tests require a demo-* project, received ${PROJECT_ID}`);
}

async function loadRules(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8');
}

export async function createFirestoreEnvironment() {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: EMULATOR_HOST,
      port: 8080,
      rules: await loadRules('../firestore.rules'),
    },
  });
}

export async function createDatabaseEnvironment() {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    database: {
      host: EMULATOR_HOST,
      port: 9000,
      rules: await loadRules('../database.rules.json'),
    },
  });
}

export async function createStorageEnvironment() {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: {
      host: EMULATOR_HOST,
      port: 9199,
      rules: await loadRules('../storage.rules'),
    },
  });
}
