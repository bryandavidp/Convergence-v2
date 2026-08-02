import { spawn } from 'node:child_process';

import {
  emulatorEnv,
  firebaseCli,
  repositoryRoot,
} from '../../../scripts/emulator-temp.mjs';

const projectId = 'demo-convergence-v2';
if (!projectId.startsWith('demo-')) {
  throw new Error('El runner se niega a usar un proyecto que no sea demo-*');
}

const child = spawn(
  process.execPath,
  [
    firebaseCli,
    'emulators:exec',
    '--only',
    'functions,firestore',
    '--project',
    projectId,
    '--config',
    'firebase.json',
    'node --test apps/functions/test/*.emulator.test.mjs',
  ],
  {
    cwd: repositoryRoot,
    env: {
      ...emulatorEnv(),
      CONVERGENCE_TEST_PROJECT_ID: projectId,
      GCLOUD_PROJECT: projectId,
      GOOGLE_CLOUD_PROJECT: projectId,
      // Puertos fijados en firebase.json. Se inyectan tambiÃ©n de forma
      // explÃ­cita para que un fallo de descubrimiento nunca derive a cloud.
      FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5001',
      // Defensa adicional: si una futura importación toca un servicio que este
      // test no arrancó, debe fallar contra localhost y nunca intentar la nube.
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      FIREBASE_DATABASE_EMULATOR_HOST: '127.0.0.1:9000',
      FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
      // Solo el proceso del Emulator Suite recibe tokens JWT sintéticos. La
      // protección real sigue activa y las pruebas no necesitan credenciales.
      FIREBASE_DEBUG_MODE: 'true',
      FIREBASE_DEBUG_FEATURES: JSON.stringify({ skipTokenVerification: true }),
    },
    stdio: 'inherit',
  },
);

child.on('error', (error) => {
  console.error('No se pudo iniciar Firebase Emulator Suite.', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Firebase Emulator Suite terminó por señal ${signal}.`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = code ?? 1;
});
