import { spawn } from 'node:child_process';

import { emulatorEnv, firebaseCli, repositoryRoot } from './emulator-temp.mjs';

/**
 * Envoltura de firebase-tools que reenvía los argumentos tal cual y corrige el
 * directorio temporal de los emuladores Java. Ver `emulator-temp.mjs`.
 */
const child = spawn(process.execPath, [firebaseCli, ...process.argv.slice(2)], {
  cwd: repositoryRoot,
  env: emulatorEnv(),
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error('No se pudo iniciar Firebase CLI.', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Firebase CLI terminó por señal ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
