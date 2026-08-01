import { spawn } from 'node:child_process';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectId = 'demo-convergence-v2';
const emulatorUrl = 'http://127.0.0.1:9099';

if (!/^demo-[a-z0-9-]+$/.test(projectId)) {
  throw new Error('El runner se niega a usar un proyecto que no sea demo-*');
}

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, '../../../..');
const firebaseCli = resolve(
  repositoryRoot,
  'node_modules/firebase-tools/lib/bin/firebase.js',
);
const nodeDirectory = dirname(process.execPath);

const child = spawn(
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
    'node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-timeout=15000 apps/client/test/auth/auth-emulator.e2e.test.mjs',
  ],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PATH: `${nodeDirectory}${delimiter}${process.env.PATH ?? ''}`,
      CONVERGENCE_AUTH_TEST_PROJECT_ID: projectId,
      CONVERGENCE_AUTH_EMULATOR_URL: emulatorUrl,
    },
    stdio: 'inherit',
  },
);

child.on('error', (error) => {
  console.error('No se pudo iniciar Auth Emulator.', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Auth Emulator terminó por señal ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
