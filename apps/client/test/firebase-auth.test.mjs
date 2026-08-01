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
  createFirebaseAuth,
  createFirebaseServices,
  resolveAuthEmulatorOptions,
} = loadTypeScriptModule('../src/online/firebase-client.ts');
const { createAnonymousAuthSession } = loadTypeScriptModule(
  '../src/online/anonymous-auth-session.ts',
);

let sequence = 0;
const uniqueAppName = () => `convergence-auth-test-${process.pid}-${sequence++}`;

test('Auth Emulator usa defaults seguros para web y Android', () => {
  const web = resolveAuthEmulatorOptions();
  assert.equal(web.projectId, 'demo-convergence-v2');
  assert.equal(web.url, 'http://127.0.0.1:9099');

  const android = resolveAuthEmulatorOptions({ runtime: 'android' });
  assert.equal(android.url, 'http://10.0.2.2:9099');

  const custom = resolveAuthEmulatorOptions({
    runtime: 'android',
    host: '192.168.1.20',
    port: 19099,
    projectId: 'demo-custom-suite',
  });
  assert.equal(custom.url, 'http://192.168.1.20:19099');
});

test('la configuración rechaza cloud y endpoints ambiguos antes de inicializar', () => {
  assert.throws(
    () => resolveAuthEmulatorOptions({ projectId: 'convergence-production' }),
    /projectId demo-\*/,
  );
  assert.throws(
    () => resolveAuthEmulatorOptions({ host: 'https://127.0.0.1' }),
    /sin protocolo/,
  );
  assert.throws(
    () => resolveAuthEmulatorOptions({ port: 0 }),
    /Puerto de Auth Emulator inválido/,
  );
});

test('createFirebaseServices conecta Auth al emulador y es idempotente', async (t) => {
  const appName = uniqueAppName();
  const first = createFirebaseServices({}, appName);
  t.after(async () => deleteApp(first.auth.app));

  assert.equal(first.auth.app.options.projectId, 'demo-convergence-v2');
  assert.deepEqual(first.auth.emulatorConfig, {
    protocol: 'http',
    host: '127.0.0.1',
    port: 9099,
    options: { disableWarnings: true },
  });

  const second = createFirebaseServices({}, appName);
  assert.equal(second.auth, first.auth);
  assert.throws(
    () => createFirebaseServices({}, appName, { port: 9199 }),
    /otro emulador/,
  );
});

test('createFirebaseAuth reutiliza la instancia Auth-only con la misma configuración', async (t) => {
  const appName = uniqueAppName();
  const first = createFirebaseAuth({}, appName);
  t.after(async () => deleteApp(first.app));

  const second = createFirebaseAuth({}, appName);
  assert.equal(second, first);
  assert.deepEqual(second.emulatorConfig, {
    protocol: 'http',
    host: '127.0.0.1',
    port: 9099,
    options: { disableWarnings: true },
  });
});

test('una app Firebase real preexistente no puede colarse por nombre', async (t) => {
  const appName = uniqueAppName();
  const cloudApp = initializeApp({
    apiKey: 'not-a-real-key',
    projectId: 'convergence-production',
  }, appName);
  t.after(async () => deleteApp(cloudApp));

  assert.throws(
    () => createFirebaseServices({}, appName),
    /no puede reutilizarse/,
  );
});

test('la sesión anónima reutiliza usuario y coalesce inicios simultáneos', async () => {
  const anonymousUser = { uid: 'anonymous-1', isAnonymous: true };
  let currentUser = null;
  let signInCalls = 0;
  let releaseSignIn;
  const signInBarrier = new Promise((resolve) => {
    releaseSignIn = resolve;
  });
  const auth = {
    get currentUser() { return currentUser; },
    async authStateReady() {},
  };
  const driver = {
    async signInAnonymously() {
      signInCalls += 1;
      await signInBarrier;
      currentUser = anonymousUser;
      return { user: anonymousUser };
    },
    async signOut() {},
    onAuthStateChanged() { return () => {}; },
  };
  const session = createAnonymousAuthSession(auth, driver);

  const first = session.ensureSignedIn();
  const second = session.ensureSignedIn();
  await Promise.resolve();
  assert.equal(signInCalls, 1);
  releaseSignIn();
  assert.equal(await first, anonymousUser);
  assert.equal(await second, anonymousUser);
  assert.equal(await session.ensureSignedIn(), anonymousUser);
  assert.equal(signInCalls, 1);
  assert.equal(session.currentUser, anonymousUser);
});

test('logout y onAuthState delegan y permiten desuscribirse', async () => {
  const auth = {
    currentUser: null,
    async authStateReady() {},
  };
  let logoutCalls = 0;
  let observedListener;
  let unsubscribeCalls = 0;
  const driver = {
    async signInAnonymously() { throw new Error('No esperado'); },
    async signOut(receivedAuth) {
      assert.equal(receivedAuth, auth);
      logoutCalls += 1;
    },
    onAuthStateChanged(receivedAuth, listener) {
      assert.equal(receivedAuth, auth);
      observedListener = listener;
      return () => { unsubscribeCalls += 1; };
    },
  };
  const session = createAnonymousAuthSession(auth, driver);
  const observed = [];
  const unsubscribe = session.onAuthState((user) => observed.push(user?.uid ?? null));

  observedListener({ uid: 'anonymous-2' });
  observedListener(null);
  await session.logout();
  unsubscribe();

  assert.deepEqual(observed, ['anonymous-2', null]);
  assert.equal(logoutCalls, 1);
  assert.equal(unsubscribeCalls, 1);
});
