import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectId = 'demo-convergence-v2';
const authEmulatorUrl = 'http://127.0.0.1:9099';
const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, '../../../..');
const clientRoot = resolve(repositoryRoot, 'apps/client');
const firebaseCli = resolve(
  repositoryRoot,
  'node_modules/firebase-tools/lib/bin/firebase.js',
);
const browserCase = resolve(testDirectory, 'auth-browser-smoke-case.mjs');
const nodeDirectory = dirname(process.execPath);

assert.equal(
  process.versions.node.split('.')[0],
  '22',
  `El smoke de navegador exige Node 22; recibido: ${process.version}.`,
);
assert.match(projectId, /^demo-[a-z0-9]+(?:-[a-z0-9]+)*$/);

async function resolveNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    resolve(nodeDirectory, 'node_modules/npm/bin/npm-cli.js'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Prueba el siguiente npm instalado junto al Node 22 activo.
    }
  }

  throw new Error(
    `No se encontro npm para el Node activo (${process.execPath}).`,
  );
}

function runChild(executable, args, options, label) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      ...options,
      stdio: 'inherit',
      windowsHide: true,
    });
    const stopOwnedChild = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    };
    const cleanup = () => process.removeListener('exit', stopOwnedChild);

    child.once('error', (error) => {
      cleanup();
      rejectPromise(new Error(`${label} no pudo iniciarse.`, { cause: error }));
    });
    child.once('exit', (code, signal) => {
      cleanup();
      if (signal !== null) {
        rejectPromise(new Error(`${label} termino por la senal ${signal}.`));
      } else if (code !== 0) {
        rejectPromise(new Error(`${label} termino con codigo ${String(code)}.`));
      } else {
        resolvePromise();
      }
    });

    process.once('exit', stopOwnedChild);
  });
}

async function waitUntilAuthEmulatorStops(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(authEmulatorUrl, { signal: AbortSignal.timeout(300) });
    } catch {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error('Auth Emulator sigue ocupando 127.0.0.1:9099 tras emulators:exec.');
}

const npmCli = await resolveNpmCli();
const childEnvironment = {
  ...process.env,
  PATH: `${nodeDirectory}${delimiter}${process.env.PATH ?? ''}`,
  CONVERGENCE_AUTH_TEST_PROJECT_ID: projectId,
  CONVERGENCE_AUTH_EMULATOR_URL: authEmulatorUrl,
};

await runChild(
  process.execPath,
  [npmCli, 'run', 'build:auth-emulator'],
  { cwd: clientRoot, env: childEnvironment },
  'build:auth-emulator',
);

await runChild(
  process.execPath,
  [
    firebaseCli,
    'emulators:exec',
    '--only',
    'auth',
    '--project',
    projectId,
    '--config',
    'firebase.json',
    'node apps/client/test/auth/auth-browser-smoke-case.mjs connected',
  ],
  { cwd: repositoryRoot, env: childEnvironment },
  'Auth Emulator browser smoke',
);

await waitUntilAuthEmulatorStops();

await runChild(
  process.execPath,
  [browserCase, 'disconnected'],
  { cwd: repositoryRoot, env: childEnvironment },
  'Browser smoke sin Auth Emulator',
);

console.log('Auth browser smoke OK: conectado y degradacion sin emulador.');
