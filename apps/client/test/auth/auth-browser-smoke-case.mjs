import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
const projectId = process.env.CONVERGENCE_AUTH_TEST_PROJECT_ID;
const emulatorUrl = new URL(process.env.CONVERGENCE_AUTH_EMULATOR_URL ?? '');
const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, '../../../..');
const clientRoot = resolve(repositoryRoot, 'apps/client');
const serveStatic = resolve(clientRoot, 'scripts/serve-static.mjs');
const staticPort = 4175;
const staticOrigin = `http://127.0.0.1:${String(staticPort)}`;
const devtoolsFileName = 'DevToolsActivePort';

assert.ok(mode === 'connected' || mode === 'disconnected', `Modo no soportado: ${mode}`);
assert.equal(process.versions.node.split('.')[0], '22', `Se exige Node 22; recibido: ${process.version}.`);
assert.match(projectId ?? '', /^demo-[a-z0-9]+(?:-[a-z0-9]+)*$/);
assert.equal(projectId, 'demo-convergence-v2');
assert.equal(emulatorUrl.protocol, 'http:');
assert.equal(emulatorUrl.hostname, '127.0.0.1');
assert.equal(emulatorUrl.port, '9099');

const delay = (milliseconds) => new Promise((resolvePromise) => {
  setTimeout(resolvePromise, milliseconds);
});

function boundedLog(target, chunk) {
  const next = `${target.value}${String(chunk)}`;
  target.value = next.slice(-20_000);
}

async function assertPortAvailable(port) {
  await new Promise((resolvePromise, rejectPromise) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', (error) => {
      rejectPromise(new Error(`El puerto ${String(port)} ya esta ocupado.`, { cause: error }));
    });
    probe.listen(port, '127.0.0.1', () => {
      probe.close((error) => {
        if (error) rejectPromise(error);
        else resolvePromise();
      });
    });
  });
}

async function endpointIsReachable(url, timeoutMs = 500) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}

async function waitForHttp(url, child, stderr, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`El servidor estatico termino antes de responder.\n${stderr.value}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // Sigue esperando durante el arranque.
    }
    await delay(100);
  }
  throw new Error(`Timeout esperando ${url}.\n${stderr.value}`);
}

async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolvePromise(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolvePromise(true);
    };
    child.once('exit', onExit);
  });
}

async function stopOwnedChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  if (await waitForChildExit(child, 3_000)) return;
  child.kill('SIGKILL');
  await waitForChildExit(child, 3_000);
}

async function clearAuthAccounts() {
  const response = await fetch(
    `${emulatorUrl.origin}/emulator/v1/projects/${projectId}/accounts`,
    { method: 'DELETE', signal: AbortSignal.timeout(2_000) },
  );
  assert.equal(response.status, 200, 'Auth Emulator no pudo limpiar sus cuentas.');
}

function findChromeExecutable() {
  const candidates = [
    process.env.CONVERGENCE_CHROME_PATH,
    process.platform === 'win32' && process.env.ProgramFiles
      ? join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe')
      : undefined,
    process.platform === 'win32' && process.env['ProgramFiles(x86)']
      ? join(process.env['ProgramFiles(x86)'], 'Google/Chrome/Application/chrome.exe')
      : undefined,
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')
      : undefined,
    process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : undefined,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);

  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error(
      `No se encontro Chrome/Chromium. Rutas probadas:\n${candidates.join('\n')}`,
    );
  }
  return executable;
}

class CdpConnection {
  static async connect(webSocketUrl) {
    const socket = new WebSocket(webSocketUrl);
    await new Promise((resolvePromise, rejectPromise) => {
      const onOpen = () => {
        socket.removeEventListener('error', onError);
        resolvePromise();
      };
      const onError = (event) => {
        socket.removeEventListener('open', onOpen);
        rejectPromise(new Error('No se pudo abrir WebSocket CDP.', { cause: event.error }));
      };
      socket.addEventListener('open', onOpen, { once: true });
      socket.addEventListener('error', onError, { once: true });
    });
    return new CdpConnection(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', (event) => this.handleMessage(event.data));
    socket.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error('Chrome cerro la conexion CDP.'));
      }
      this.pending.clear();
    });
  }

  handleMessage(rawMessage) {
    const message = JSON.parse(typeof rawMessage === 'string'
      ? rawMessage
      : Buffer.from(rawMessage).toString('utf8'));
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`CDP ${pending.method}: ${message.error.message}`));
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }

    const handlers = this.listeners.get(message.method);
    if (!handlers) return;
    for (const handler of handlers) handler(message);
  }

  send(method, params = {}, sessionId) {
    if (this.socket.readyState !== 1) {
      return Promise.reject(new Error(`CDP no esta abierto para ${method}.`));
    }
    const id = this.nextId;
    this.nextId += 1;
    const message = { id, method, params };
    if (sessionId !== undefined) message.sessionId = sessionId;
    return new Promise((resolvePromise, rejectPromise) => {
      this.pending.set(id, { method, resolve: resolvePromise, reject: rejectPromise });
      this.socket.send(JSON.stringify(message));
    });
  }

  on(method, handler) {
    const handlers = this.listeners.get(method) ?? new Set();
    handlers.add(handler);
    this.listeners.set(method, handlers);
    return () => handlers.delete(handler);
  }

  close() {
    if (this.socket.readyState === 0 || this.socket.readyState === 1) this.socket.close();
  }
}

async function launchChrome(userDataDirectory) {
  const stderr = { value: '' };
  const executable = findChromeExecutable();
  const child = spawn(executable, [
    '--headless=new',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-dev-shm-usage',
    '--disable-features=MediaRouter,OptimizationHints,Translate',
    '--disable-gpu',
    '--disable-sync',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-default-browser-check',
    '--no-first-run',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDirectory}`,
    '--window-size=390,844',
    'about:blank',
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  child.stderr.on('data', (chunk) => boundedLog(stderr, chunk));

  const devtoolsFile = join(userDataDirectory, devtoolsFileName);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Chrome termino durante el arranque.\n${stderr.value}`);
    }
    try {
      const [portLine] = (await readFile(devtoolsFile, 'utf8')).trim().split(/\r?\n/);
      const port = Number(portLine);
      if (Number.isInteger(port) && port > 0) {
        const response = await fetch(`http://127.0.0.1:${String(port)}/json/version`, {
          signal: AbortSignal.timeout(1_000),
        });
        if (response.ok) {
          const version = await response.json();
          assert.match(version.Browser ?? '', /Chrome|Chromium/i);
          assert.match(
            version.webSocketDebuggerUrl ?? '',
            /^ws:\/\/(?:127\.0\.0\.1|localhost):/,
          );
          return { child, stderr, version };
        }
      }
    } catch {
      // Chrome aun no publico DevToolsActivePort o /json/version.
    }
    await delay(100);
  }
  throw new Error(`Timeout esperando Chrome CDP.\n${stderr.value}`);
}

async function evaluate(connection, sessionId, expression) {
  const result = await connection.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description
        ?? result.exceptionDetails.text
        ?? 'Runtime.evaluate fallo.',
    );
  }
  return result.result?.value;
}

async function waitForPageState(connection, sessionId, expression, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(connection, sessionId, expression)) return;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Timeout esperando estado de pagina. Ultimo error: ${String(lastError ?? 'ninguno')}`);
}

function assertOnlyLoopbackRequests(requestUrls) {
  const external = requestUrls.filter((requestUrl) => {
    let parsed;
    try {
      parsed = new URL(requestUrl);
    } catch {
      return false;
    }
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) return false;
    return !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  });
  assert.deepEqual(external, [], `El navegador intento acceder fuera de loopback:\n${external.join('\n')}`);
}

await assertPortAvailable(staticPort);

if (mode === 'connected') {
  assert.equal(await endpointIsReachable(emulatorUrl.origin), true, 'Auth Emulator no esta disponible.');
  await clearAuthAccounts();
} else {
  assert.equal(await endpointIsReachable(emulatorUrl.origin), false, 'El caso disconnected exige 9099 libre.');
}

const serverStdout = { value: '' };
const serverStderr = { value: '' };
let server;
let chrome;
let connection;
let userDataDirectory;

try {
  server = spawn(
    process.execPath,
    [serveStatic, 'dist-emulator', '--port', String(staticPort)],
    {
      cwd: clientRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  server.stdout.on('data', (chunk) => boundedLog(serverStdout, chunk));
  server.stderr.on('data', (chunk) => boundedLog(serverStderr, chunk));
  await waitForHttp(`${staticOrigin}/`, server, serverStderr);

  userDataDirectory = await mkdtemp(join(tmpdir(), 'convergence-auth-cdp-'));
  chrome = await launchChrome(userDataDirectory);
  connection = await CdpConnection.connect(chrome.version.webSocketDebuggerUrl);

  const { targetId } = await connection.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await connection.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  const requestUrls = [];
  connection.on('Network.requestWillBeSent', (message) => {
    if (message.sessionId === sessionId) requestUrls.push(message.params.request.url);
  });

  await Promise.all([
    connection.send('Page.enable', {}, sessionId),
    connection.send('Runtime.enable', {}, sessionId),
    connection.send('Network.enable', {}, sessionId),
  ]);
  await connection.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
  await connection.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const smoke = {
        authStates: [],
        securityPolicyViolations: [],
        pageErrors: [],
      };
      Object.defineProperty(window, '__convergenceAuthBrowserSmoke', {
        value: smoke,
        configurable: false,
      });
      window.addEventListener('convergence:auth-emulator-state', (event) => {
        smoke.authStates.push(JSON.parse(JSON.stringify(event.detail)));
      });
      window.addEventListener('securitypolicyviolation', (event) => {
        smoke.securityPolicyViolations.push({
          blockedURI: event.blockedURI,
          effectiveDirective: event.effectiveDirective,
          violatedDirective: event.violatedDirective,
        });
      });
      window.addEventListener('error', (event) => {
        smoke.pageErrors.push(String(event.message || event.error || 'window.error'));
      });
      window.addEventListener('unhandledrejection', (event) => {
        smoke.pageErrors.push(String(event.reason || 'unhandledrejection'));
      });
    })();`,
  }, sessionId);

  const pageUrl = `${staticOrigin}/?dev=1&authBrowserSmoke=${mode}`;
  await connection.send('Page.navigate', { url: pageUrl }, sessionId);
  const expectedStatus = mode === 'connected' ? 'authenticated' : 'error';
  await waitForPageState(
    connection,
    sessionId,
    `(() => {
      const smoke = window.__convergenceAuthBrowserSmoke;
      const authReady = smoke?.authStates?.some((state) => state.status === '${expectedStatus}');
      const legacyScript = document.querySelector('script[data-convergence-legacy="true"]');
      const boot = document.getElementById('boot-loader');
      return Boolean(
        authReady
          && window.__cv
          && legacyScript
          && document.readyState === 'complete'
          && boot?.hidden
          && document.getElementById('boot-percent')?.textContent === '100'
      );
    })()`,
  );
  await delay(250);

  const snapshot = await evaluate(connection, sessionId, `(() => {
    const smoke = window.__convergenceAuthBrowserSmoke;
    return {
      authStates: smoke.authStates,
      securityPolicyViolations: smoke.securityPolicyViolations,
      pageErrors: smoke.pageErrors,
      legacyLoaded: Boolean(window.__cv),
      legacyScript: document.querySelector('script[data-convergence-legacy="true"]')?.src ?? null,
      bootHidden: document.getElementById('boot-loader')?.hidden ?? false,
      bootPercent: document.getElementById('boot-percent')?.textContent ?? null,
      bodyScreen: document.body?.dataset?.screen ?? null,
    };
  })()`);

  assert.equal(snapshot.legacyLoaded, true);
  assert.match(snapshot.legacyScript ?? '', /\/game\.js\?v=/);
  assert.equal(snapshot.bootHidden, true);
  assert.equal(snapshot.bootPercent, '100');
  assert.deepEqual(snapshot.securityPolicyViolations, []);
  assertOnlyLoopbackRequests(requestUrls);

  const finalAuthState = snapshot.authStates.find((state) => state.status === expectedStatus);
  assert.ok(finalAuthState, `No llego el estado ${expectedStatus}.`);

  if (mode === 'connected') {
    assert.equal(finalAuthState.isAnonymous, true);
    assert.match(finalAuthState.uid ?? '', /^[A-Za-z0-9_-]+$/);
    const accountsResponse = await fetch(
      `${emulatorUrl.origin}/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:batchGet?maxResults=1000`,
      {
        headers: { Authorization: 'Bearer owner' },
        signal: AbortSignal.timeout(2_000),
      },
    );
    assert.equal(accountsResponse.status, 200);
    const accounts = await accountsResponse.json();
    assert.ok(
      accounts.users?.some((user) => user.localId === finalAuthState.uid),
      `La cuenta anonima ${finalAuthState.uid} no aparece en Auth Emulator REST.`,
    );
  } else {
    assert.equal(finalAuthState.uid, null);
    assert.equal(finalAuthState.isAnonymous, false);
    assert.equal(typeof finalAuthState.error, 'string');
    assert.ok(finalAuthState.error.length > 0);
  }

  console.log(JSON.stringify({
    mode,
    browser: chrome.version.Browser,
    authStatus: finalAuthState.status,
    uid: finalAuthState.uid,
    legacyLoaded: snapshot.legacyLoaded,
    bootHidden: snapshot.bootHidden,
    securityPolicyViolations: snapshot.securityPolicyViolations.length,
    pageRequests: requestUrls.length,
  }));
} finally {
  if (connection) {
    try {
      await connection.send('Browser.close');
    } catch {
      // El proceso Chrome puede haber terminado durante un fallo de assertion.
    }
    connection.close();
  }
  await stopOwnedChild(chrome?.child);
  await stopOwnedChild(server);
  if (mode === 'connected' && await endpointIsReachable(emulatorUrl.origin)) {
    try {
      await clearAuthAccounts();
    } catch {
      // emulators:exec tambien elimina el proceso aun si falla esta limpieza.
    }
  }
  if (userDataDirectory) {
    const resolvedTemp = resolve(tmpdir());
    const resolvedProfile = resolve(userDataDirectory);
    assert.equal(dirname(resolvedProfile), resolvedTemp);
    assert.match(basename(resolvedProfile), /^convergence-auth-cdp-/);
    await rm(resolvedProfile, { recursive: true, force: true });
  }
}
