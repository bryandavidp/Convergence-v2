import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = fs.readFileSync(path.join(root, 'web', 'native-bridge.js'), 'utf8');

function harness({
  native = false,
  nativeValues = {},
  localValues = {},
  beforePreferenceSet,
  beforePreferenceRemove,
} = {}) {
  const preferences = new Map(Object.entries(nativeValues));
  const local = new Map(Object.entries(localValues));
  const appendedScripts = [];
  const appListeners = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const events = [];
  const deletedCaches = [];
  let unregistered = 0;
  let exited = 0;
  let haptics = 0;
  let shares = 0;

  function addDomListener(target, name, listener) {
    if (!target.has(name)) target.set(name, []);
    target.get(name).push(listener);
  }

  function dispatchDomEvent(target, event) {
    for (const listener of target.get(event.type) || []) listener(event);
    return true;
  }

  const Preferences = {
    async get({ key }) { return { value: preferences.get(key) ?? null }; },
    async set({ key, value }) {
      if (beforePreferenceSet) await beforePreferenceSet({ key, value });
      preferences.set(key, value);
    },
    async remove({ key }) {
      if (beforePreferenceRemove) await beforePreferenceRemove({ key });
      preferences.delete(key);
    },
  };
  const App = {
    async addListener(name, listener) { appListeners.set(name, listener); return { remove() {} }; },
    async exitApp() { exited++; },
  };
  const NativeHaptics = { async impact() { haptics++; } };
  const NativeShare = { async share() { shares++; } };
  const Network = {
    async getStatus() { return { connected: true, connectionType: 'wifi' }; },
    async addListener(name, listener) { appListeners.set(name, listener); return { remove() {} }; },
  };
  const document = {
    documentElement: { dataset: {} },
    hidden: false,
    addEventListener(name, listener) { addDomListener(documentListeners, name, listener); },
    dispatchEvent(event) { return dispatchDomEvent(documentListeners, event); },
    querySelector() { return null; },
    createElement() { return { dataset: {}, src: '', onerror: null }; },
    body: { appendChild(script) { appendedScripts.push(script); } },
  };
  const window = {
    document,
    Capacitor: native ? {
      isNativePlatform: () => true,
      Plugins: { Preferences, App, Haptics: NativeHaptics, Share: NativeShare, Network },
    } : undefined,
    addEventListener(name, listener) { addDomListener(windowListeners, name, listener); },
    dispatchEvent(event) {
      events.push(event);
      return dispatchDomEvent(windowListeners, event);
    },
    caches: {
      async keys() { return ['cv-cache-v1', 'unrelated-cache']; },
      async delete(key) { deletedCaches.push(key); return true; },
    },
  };
  const context = vm.createContext({
    window,
    document,
    navigator: {
      serviceWorker: {
        async getRegistrations() {
          return [{ async unregister() { unregistered++; return true; } }];
        },
      },
    },
    localStorage: {
      getItem(key) { return local.get(key) ?? null; },
      setItem(key, value) { local.set(key, String(value)); },
      removeItem(key) { local.delete(key); },
    },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    },
    console: { warn() {} },
    Promise,
  });
  vm.runInContext(source, context, { filename: 'native-bridge.js' });

  return {
    window, preferences, local, appendedScripts, appListeners, events,
    deletedCaches, document,
    get unregistered() { return unregistered; }, get exited() { return exited; },
    get haptics() { return haptics; }, get shares() { return shares; },
  };
}

async function settle(state) {
  await state.window.ConvergencePlatform.ready;
  await Promise.resolve();
}

test('web conserva localStorage y carga el mismo runtime legacy sin plugins', async () => {
  const state = harness({ localValues: { cv_meta: '{"_v":10}' } });
  await settle(state);

  assert.equal(state.window.ConvergencePlatform.runtime, 'web');
  assert.equal(state.local.get('cv_meta'), '{"_v":10}');
  assert.equal(state.appendedScripts.length, 1);
  assert.equal(state.appendedScripts[0].src, 'game.js?v=2.37.1');
  assert.equal(state.unregistered, 0);
});

test('mirrorStorage emite solo la clave legacy también en web', async () => {
  const state = harness();
  await settle(state);

  await state.window.ConvergencePlatform.mirrorStorage(
    'cv_meta',
    '{"_v":10,"coins":999999}',
  );

  const event = state.events.find(
    (candidate) => candidate.type === 'convergence:legacy-storage-changed',
  );
  assert.equal(event?.detail?.key, 'cv_meta');
  assert.deepEqual(Object.keys(event?.detail ?? {}), ['key']);
  assert.equal(JSON.stringify(event).includes('999999'), false);
});

test('nativo hidrata Preferences antes del legacy y registra lifecycle/back', async () => {
  const state = harness({
    native: true,
    nativeValues: { cv_meta: '{"_v":10,"level":4}', cv_run: '{"v":1}' },
    localValues: { cv_meta: '{"_v":10,"level":1}' },
  });
  await settle(state);

  assert.equal(state.local.get('cv_meta'), '{"_v":10,"level":4}');
  assert.equal(state.local.get('cv_run'), '{"v":1}');
  assert.equal(state.appendedScripts.length, 1);
  assert.equal(state.unregistered, 1);
  assert.deepEqual(state.deletedCaches, ['cv-cache-v1']);
  assert.ok(state.appListeners.has('appStateChange'));
  assert.ok(state.appListeners.has('backButton'));
  assert.ok(state.appListeners.has('networkStatusChange'));
  assert.equal(state.window.document.documentElement.dataset.network, 'online');

  await state.appListeners.get('appStateChange')({ isActive: false });
  state.appListeners.get('backButton')({ canGoBack: false });
  assert.deepEqual(
    state.events.map((event) => event.type),
    ['convergence:network', 'convergence:app-state', 'convergence:back'],
  );

  await state.window.ConvergencePlatform.mirrorStorage('cv_meta', '{"_v":10,"level":5}');
  assert.equal(state.preferences.get('cv_meta'), '{"_v":10,"level":5}');
  await state.window.ConvergencePlatform.exitApp();
  assert.equal(state.exited, 1);
  state.window.ConvergencePlatform.haptic();
  assert.equal(await state.window.ConvergencePlatform.share({ text: 'test' }), true);
  await Promise.resolve();
  assert.equal(state.haptics, 1);
  assert.equal(state.shares, 1);
});

test('Preferences corrupta se aísla y recupera el último JSON WebView válido', async () => {
  const state = harness({
    native: true,
    nativeValues: { cv_meta: 'no-json{{{' },
    localValues: { cv_meta: '{"_v":10,"level":7}' },
  });
  await settle(state);

  assert.equal(state.local.get('cv_meta'), '{"_v":10,"level":7}');
  assert.equal(state.preferences.get('cv_meta'), '{"_v":10,"level":7}');
  assert.equal(state.preferences.get('cv_meta.corrupt'), 'no-json{{{');
});

test('background captura cv_run y cv_meta antes de un kill y los hidrata al relanzar', async () => {
  const state = harness({
    native: true,
    nativeValues: { cv_meta: '{"_v":10,"level":1}' },
  });
  await settle(state);

  // Simula el listener síncrono de game.js: RunSave.save() actualiza primero
  // localStorage cuando recibe convergence:app-state.
  state.window.addEventListener('convergence:app-state', (event) => {
    if (event.detail.active) return;
    state.local.set('cv_meta', '{"_v":10,"level":8}');
    state.local.set('cv_run', '{"v":1,"mode":"clasico","score":4200}');
  });

  await state.appListeners.get('appStateChange')({ isActive: false });
  await state.window.ConvergencePlatform.flushStorage();
  assert.equal(state.preferences.get('cv_meta'), '{"_v":10,"level":8}');
  assert.equal(state.preferences.get('cv_run'), '{"v":1,"mode":"clasico","score":4200}');

  // Un WebView nuevo no conserva su localStorage: Preferences es la copia que
  // permite recuperar el proceso tras kill/relaunch.
  const relaunched = harness({
    native: true,
    nativeValues: Object.fromEntries(state.preferences),
  });
  await settle(relaunched);
  assert.equal(relaunched.local.get('cv_meta'), '{"_v":10,"level":8}');
  assert.equal(relaunched.local.get('cv_run'), '{"v":1,"mode":"clasico","score":4200}');
  assert.equal(relaunched.appendedScripts.length, 1);
});

test('pagehide crea el checkpoint después del guardado legacy', async () => {
  const state = harness({
    native: true,
    nativeValues: { cv_meta: '{"_v":10}', cv_run: '{"v":1,"score":1}' },
  });
  await settle(state);

  // El bridge registró su listener antes que game.js. El microtask debe dejar
  // que este listener legacy actualice localStorage antes de leerlo.
  state.window.addEventListener('pagehide', () => {
    state.local.set('cv_run', '{"v":1,"score":99}');
  });
  state.window.dispatchEvent({ type: 'pagehide' });
  await Promise.resolve();
  await state.window.ConvergencePlatform.flushStorage();

  assert.equal(state.preferences.get('cv_run'), '{"v":1,"score":99}');
});

test('serializa escrituras para que una operación lenta no restaure un valor antiguo', async () => {
  let releaseFirst;
  const firstWrite = new Promise((resolve) => { releaseFirst = resolve; });
  let writesStarted = 0;
  const state = harness({
    native: true,
    nativeValues: { cv_meta: '{"_v":10,"level":1}', cv_run: '{"v":1}' },
    beforePreferenceSet: async ({ key }) => {
      if (key !== 'cv_meta') return;
      writesStarted++;
      if (writesStarted === 1) await firstWrite;
    },
  });
  await settle(state);

  const oldWrite = state.window.ConvergencePlatform.mirrorStorage('cv_meta', '{"_v":10,"level":2}');
  const newWrite = state.window.ConvergencePlatform.mirrorStorage('cv_meta', '{"_v":10,"level":3}');
  await Promise.resolve();
  assert.equal(writesStarted, 1);

  releaseFirst();
  await Promise.all([oldWrite, newWrite]);
  assert.equal(writesStarted, 2);
  assert.equal(state.preferences.get('cv_meta'), '{"_v":10,"level":3}');
});

test('exitApp espera al checkpoint y al flush antes de cerrar el proceso', async () => {
  let releaseWrite;
  const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
  let blocked = false;
  const state = harness({
    native: true,
    nativeValues: { cv_meta: '{"_v":10,"level":1}', cv_run: '{"v":1}' },
    beforePreferenceSet: async ({ key, value }) => {
      if (blocked || key !== 'cv_meta' || !value.includes('"level":9')) return;
      blocked = true;
      await writeGate;
    },
  });
  await settle(state);

  state.local.set('cv_meta', '{"_v":10,"level":9}');
  state.window.ConvergencePlatform.mirrorStorage('cv_meta', '{"_v":10,"level":9}');
  const exiting = state.window.ConvergencePlatform.exitApp();
  await Promise.resolve();
  assert.equal(state.exited, 0);

  releaseWrite();
  await exiting;
  assert.equal(state.preferences.get('cv_meta'), '{"_v":10,"level":9}');
  assert.equal(state.exited, 1);
});
