import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { deleteApp, initializeApp } = require('firebase/app');

function loadTypeScriptModule(relativePath) {
  const filename = path.isAbsolute(relativePath)
    ? relativePath
    : path.resolve(testRoot, relativePath);
  const cached = loadTypeScriptModule.cache.get(filename);
  if (cached !== undefined) return cached.exports;

  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loadTypeScriptModule.cache.set(filename, loaded);

  const defaultRequire = loaded.require.bind(loaded);
  loaded.require = (specifier) => {
    if (specifier.startsWith('.') && specifier.endsWith('.js')) {
      const sourceModule = path.resolve(
        path.dirname(filename),
        `${specifier.slice(0, -3)}.ts`,
      );
      if (fs.existsSync(sourceModule)) return loadTypeScriptModule(sourceModule);
    }
    return defaultRequire(specifier);
  };
  loaded._compile(outputText, filename);
  return loaded.exports;
}

loadTypeScriptModule.cache = new Map();

const {
  FIREBASE_CLOUD_DEV_AUTH_DOMAIN,
  FIREBASE_CLOUD_DEV_DATABASE_URL,
  FIREBASE_CLOUD_DEV_PROJECT_ID,
  FIREBASE_CLOUD_DEV_PROJECT_NUMBER,
  FIREBASE_CLOUD_DEV_STORAGE_BUCKET,
  FIREBASE_CLOUD_DEV_WEB_APP_ID,
  resolveFirebaseCloudDevConfig,
} = loadTypeScriptModule('../src/online/firebase-cloud-dev-config.ts');
const {
  createFirebaseCloudDevAuth,
  createFirebaseCloudDevSmokeAuth,
  FIREBASE_CLOUD_DEV_SMOKE_APP_PREFIX,
} = loadTypeScriptModule('../src/online/firebase-cloud-auth-client.ts');

const validConfig = () => ({
  apiKey: 'AIzaSy0123456789abcdefghijklmnopqrst',
  appId: FIREBASE_CLOUD_DEV_WEB_APP_ID,
  authDomain: FIREBASE_CLOUD_DEV_AUTH_DOMAIN,
  databaseURL: FIREBASE_CLOUD_DEV_DATABASE_URL,
  measurementId: 'G-IGNORED',
  messagingSenderId: FIREBASE_CLOUD_DEV_PROJECT_NUMBER,
  projectId: FIREBASE_CLOUD_DEV_PROJECT_ID,
  projectNumber: FIREBASE_CLOUD_DEV_PROJECT_NUMBER,
  storageBucket: FIREBASE_CLOUD_DEV_STORAGE_BUCKET,
  version: 1,
});

let sequence = 0;
const uniqueAppName = () => `cloud-dev-auth-test-${process.pid}-${sequence++}`;

test('selecciona y congela solo FirebaseOptions Auth del destino cloud dev', () => {
  const resolved = resolveFirebaseCloudDevConfig({
    ...validConfig(),
    databaseURL: `${FIREBASE_CLOUD_DEV_DATABASE_URL}/`,
  });

  assert.deepEqual(resolved, {
    apiKey: validConfig().apiKey,
    appId: FIREBASE_CLOUD_DEV_WEB_APP_ID,
    authDomain: FIREBASE_CLOUD_DEV_AUTH_DOMAIN,
    databaseURL: FIREBASE_CLOUD_DEV_DATABASE_URL,
    messagingSenderId: FIREBASE_CLOUD_DEV_PROJECT_NUMBER,
    projectId: FIREBASE_CLOUD_DEV_PROJECT_ID,
    storageBucket: FIREBASE_CLOUD_DEV_STORAGE_BUCKET,
  });
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal('measurementId' in resolved, false);
  assert.equal('projectNumber' in resolved, false);
  assert.equal('version' in resolved, false);
});

test('rechaza otro proyecto, app, sender, authDomain o RTDB', () => {
  for (const [field, value] of [
    ['projectId', 'otro-proyecto'],
    ['appId', '1:98627547554:web:otra-app'],
    ['messagingSenderId', '111111111111'],
    ['projectNumber', '111111111111'],
    ['authDomain', 'otro-proyecto.firebaseapp.com'],
    ['databaseURL', 'https://otro-proyecto-default-rtdb.europe-west1.firebasedatabase.app'],
  ]) {
    assert.throws(
      () => resolveFirebaseCloudDevConfig({ ...validConfig(), [field]: value }),
      new RegExp(field),
    );
  }
});

test('rechaza configuración no JSON, apiKey inválida y campos extra', () => {
  assert.throws(() => resolveFirebaseCloudDevConfig(null), /objeto JSON/);
  assert.throws(
    () => resolveFirebaseCloudDevConfig({ ...validConfig(), apiKey: 'demo-api-key' }),
    /formato esperado/,
  );
  assert.throws(
    () => resolveFirebaseCloudDevConfig({ ...validConfig(), functionsRegion: 'europe-west1' }),
    /no permitido/,
  );
  assert.throws(
    () => resolveFirebaseCloudDevConfig(Object.create({ ...validConfig() })),
    /objeto JSON simple/,
  );
});

test('factory Auth-only es idempotente, persistente y nunca usa Emulator Suite', async (t) => {
  const appName = uniqueAppName();
  const first = createFirebaseCloudDevAuth(validConfig(), appName);
  t.after(async () => deleteApp(first.app));

  const second = createFirebaseCloudDevAuth(validConfig(), appName);
  assert.equal(second, first);
  assert.equal(first.emulatorConfig, null);
  assert.equal(first.app.options.projectId, FIREBASE_CLOUD_DEV_PROJECT_ID);
});

test('factory smoke usa una app única y separada de la sesión persistente', async (t) => {
  const auth = createFirebaseCloudDevSmokeAuth(
    validConfig(),
    '01234567-test-smoke',
  );
  t.after(async () => deleteApp(auth.app));

  assert.match(
    auth.app.name,
    new RegExp(`^${FIREBASE_CLOUD_DEV_SMOKE_APP_PREFIX}-`),
  );
  assert.notEqual(auth.app.name, 'convergence-v2-auth-cloud-dev');
  assert.equal(auth.currentUser, null);
  assert.equal(auth.emulatorConfig, null);
  assert.throws(
    () => createFirebaseCloudDevSmokeAuth(validConfig(), '../no-seguro'),
    /Nonce de Auth smoke cloud dev no válido/,
  );
});

test('factory rechaza colisión con una app preexistente de otra configuración', async (t) => {
  const appName = uniqueAppName();
  const app = initializeApp({
    ...validConfig(),
    apiKey: 'AIzaSy9999999999abcdefghijklmnopqrst',
  }, appName);
  t.after(async () => deleteApp(app));

  assert.throws(
    () => createFirebaseCloudDevAuth(validConfig(), appName),
    /no coincide con el destino cloud dev permitido/,
  );
});

test('bootstrap usa inyección opaca y un borrado smoke efímero solo local', () => {
  const bootstrap = fs.readFileSync(
    path.resolve(testRoot, '../src/online/cloud-dev-auth-bootstrap.ts'),
    'utf8',
  );
  const factory = fs.readFileSync(
    path.resolve(testRoot, '../src/online/firebase-cloud-auth-client.ts'),
    'utf8',
  );

  assert.match(bootstrap, /__CONVERGENCE_FIREBASE_CLOUD_DEV_CONFIG__/);
  assert.match(bootstrap, /convergence:auth-cloud-dev-state/);
  assert.match(bootstrap, /cloudAuthSmoke/);
  assert.match(bootstrap, /convergenceCloudAuthSmokeStatus/);
  assert.match(bootstrap, /deleteUser/);
  assert.match(bootstrap, /createFirebaseCloudDevSmokeAuth/);
  assert.match(bootstrap, /signInAnonymously/);
  assert.match(bootstrap, /auth\.currentUser !== null/);
  assert.match(bootstrap, /persistencia en[\s\S]*memoria/);
  assert.match(bootstrap, /loopback local/);
  assert.doesNotMatch(bootstrap, /getIdToken|accessToken|refreshToken/);
  assert.match(
    factory,
    /indexedDBLocalPersistence[\s\S]*browserLocalPersistence[\s\S]*inMemoryPersistence/,
  );
  assert.match(factory, /popupRedirectResolver:\s*undefined/);
  assert.doesNotMatch(factory, /connectAuthEmulator/);
});
