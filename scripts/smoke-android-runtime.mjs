import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sdkRoot = process.env.ANDROID_SDK_ROOT
  || process.env.ANDROID_HOME
  || (process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk'));
const adb = sdkRoot && join(sdkRoot, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const apk = resolve(process.argv[2] || join(
  root,
  'apps',
  'client',
  'android',
  'app',
  'build',
  'outputs',
  'apk',
  'debug',
  'app-debug.apk',
));
const appId = 'com.deploy21.convergence';
const devtoolsPort = Number(process.env.CONVERGENCE_CDP_PORT || 9224);

if (!adb || !existsSync(adb)) throw new Error('adb no encontrado; define ANDROID_SDK_ROOT o ANDROID_HOME.');
if (!existsSync(apk)) throw new Error(`APK no encontrado: ${apk}. Ejecuta primero assembleDebug.`);

function adbRun(args, { allowFailure = false } = {}) {
  const result = spawnSync(adb, args, { encoding: 'utf8', windowsHide: true });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`adb ${args.join(' ')} falló:\n${result.stdout}${result.stderr}`);
  }
  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

function connectedEmulator() {
  const requested = process.env.CONVERGENCE_ANDROID_DEVICE;
  const devices = adbRun(['devices'])
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([, state]) => state === 'device')
    .map(([serial]) => serial);
  const serial = requested || devices.find((candidate) => candidate.startsWith('emulator-'));
  if (!serial || !devices.includes(serial)) throw new Error('No hay un Android Emulator conectado.');
  if (!serial.startsWith('emulator-')) {
    throw new Error('Este smoke borra/reinstala datos de prueba y solo admite emuladores.');
  }
  return serial;
}

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function retry(fn, label, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`${label} no estuvo disponible a tiempo.${lastError ? ` ${lastError.message}` : ''}`);
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolveMessage, rejectMessage } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) rejectMessage(new Error(message.error.message));
      else resolveMessage(message.result);
    });
    await new Promise((resolveOpen, rejectOpen) => {
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', () => rejectOpen(new Error('No se pudo abrir CDP.')), { once: true });
    });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolveMessage, rejectMessage) => {
      this.pending.set(id, { resolveMessage, rejectMessage });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    }
    return response.result.value;
  }

  close() {
    this.socket?.close();
  }
}

async function attach(serial) {
  const pid = await retry(
    () => adbRun(['-s', serial, 'shell', 'pidof', appId], { allowFailure: true }).split(/\s+/)[0],
    'PID de la app',
  );
  const socketName = await retry(() => {
    const sockets = adbRun(['-s', serial, 'shell', 'cat', '/proc/net/unix']);
    const exact = sockets.match(new RegExp(`@(webview_devtools_remote_${pid})\\s*$`, 'm'));
    return exact?.[1];
  }, 'socket CDP del WebView');

  adbRun(['-s', serial, 'forward', '--remove', `tcp:${devtoolsPort}`], { allowFailure: true });
  adbRun(['-s', serial, 'forward', `tcp:${devtoolsPort}`, `localabstract:${socketName}`]);
  const target = await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${devtoolsPort}/json`);
    const pages = await response.json();
    return pages.find((page) => page.type === 'page' && page.url.startsWith('https://localhost'));
  }, 'target CDP');

  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  return client;
}

const serial = connectedEmulator();
let airplaneModeEnabled = false;
let client;

try {
  console.log(`Dispositivo de prueba: ${serial}`);
  console.log(`Instalando: ${apk}`);
  adbRun(['-s', serial, 'install', '-r', apk]);
  adbRun(['-s', serial, 'shell', 'pm', 'clear', appId]);
  adbRun(['-s', serial, 'logcat', '-c']);

  adbRun(['-s', serial, 'shell', 'cmd', 'connectivity', 'airplane-mode', 'enable']);
  airplaneModeEnabled = true;
  adbRun(['-s', serial, 'shell', 'am', 'force-stop', appId]);
  const launch = adbRun([
    '-s', serial, 'shell', 'am', 'start', '-W', '-n', `${appId}/.MainActivity`,
  ]);
  const coldStartMs = Number(launch.match(/TotalTime:\s*(\d+)/)?.[1] || 0);

  client = await attach(serial);
  const state = await retry(async () => {
    const value = await client.evaluate(`(async () => {
      if (!window.ConvergencePlatform || !document.body) return null;
      await window.ConvergencePlatform.ready;
      const registrations = navigator.serviceWorker?.getRegistrations
        ? await navigator.serviceWorker.getRegistrations()
        : [];
      const cacheNames = window.caches?.keys ? await window.caches.keys() : [];
      return {
        readyState: document.readyState,
        runtime: window.ConvergencePlatform.runtime,
        legacyLoaded: !!document.querySelector('script[data-convergence-legacy]'),
        installHidden: document.querySelector('#btn-install')?.hidden === true,
        network: document.documentElement.dataset.network,
        orientation: screen.orientation?.type || '',
        serviceWorkers: registrations.length,
        pwaCaches: cacheNames.filter((name) => name.startsWith('cv-')),
        errorLog: localStorage.getItem('cv_errlog'),
      };
    })()`);
    return value?.readyState === 'complete' && value.legacyLoaded ? value : null;
  }, 'runtime Convergence');

  assert.equal(state.runtime, 'native');
  assert.equal(state.installHidden, true);
  assert.equal(state.network, 'offline');
  assert.match(state.orientation, /^portrait/);
  assert.equal(state.serviceWorkers, 0);
  assert.deepEqual(state.pwaCaches, []);
  assert.equal(state.errorLog, null);

  const fatalLogs = adbRun([
    '-s', serial, 'logcat', '-d', '-t', '1500',
  ]).split(/\r?\n/).filter((line) => /FATAL EXCEPTION|ANR in com\.deploy21\.convergence/.test(line));
  assert.deepEqual(fatalLogs, []);

  // Abre el hook de QA, crea una run real y fuerza el checkpoint completo. Se
  // eliminan después las copias WebView para simular un proceso/WebView nuevo:
  // el relanzamiento solo puede recuperarlas desde Preferences.
  await client.evaluate(`location.replace('https://localhost/?dev')`);
  client.close();
  await delay(500);
  client = await attach(serial);
  const checkpoint = await retry(async () => client.evaluate(`(async () => {
    if (!window.__cv?.RunSave || !window.ConvergencePlatform?.flushStorage) return null;
    window.__cv.Game.start('clasico', 'normal', 1, 424242, { silentIntro: true });
    window.__cv.State.score = 4242;
    window.__cv.RunSave.schedule();
    await Promise.resolve();
    await window.ConvergencePlatform.flushStorage();
    const run = JSON.parse(localStorage.getItem('cv_run'));
    const meta = JSON.parse(localStorage.getItem('cv_meta'));
    localStorage.removeItem('cv_run');
    localStorage.removeItem('cv_meta');
    return { run, metaVersion: meta?._v };
  })()`), 'hook de checkpoint');
  assert.equal(checkpoint.run.mode, 'clasico');
  assert.equal(checkpoint.run.score, 4242);
  assert.equal(checkpoint.metaVersion, 10);

  client.close();
  client = undefined;
  adbRun(['-s', serial, 'shell', 'am', 'force-stop', appId]);
  adbRun(['-s', serial, 'shell', 'am', 'start', '-W', '-n', `${appId}/.MainActivity`]);
  client = await attach(serial);
  const restored = await retry(async () => client.evaluate(`(() => {
    if (!window.ConvergencePlatform || document.readyState !== 'complete') return null;
    const rawRun = localStorage.getItem('cv_run');
    const rawMeta = localStorage.getItem('cv_meta');
    if (!rawRun || !rawMeta) return null;
    return {
      run: JSON.parse(rawRun),
      metaVersion: JSON.parse(rawMeta)?._v,
    };
  })()`), 'rehidratación tras process death');
  assert.equal(restored.run.mode, 'clasico');
  assert.equal(restored.run.score, 4242);
  assert.equal(restored.metaVersion, 10);

  console.log(
    `Smoke Android OK: cold start ${coldStartMs} ms, offline, runtime nativo, portrait, `
      + 'sin PWA/errores fatales y checkpoint recuperado tras process death.',
  );
} finally {
  client?.close();
  adbRun(['-s', serial, 'forward', '--remove', `tcp:${devtoolsPort}`], { allowFailure: true });
  if (airplaneModeEnabled) {
    adbRun(['-s', serial, 'shell', 'cmd', 'connectivity', 'airplane-mode', 'disable'], { allowFailure: true });
  }
}
