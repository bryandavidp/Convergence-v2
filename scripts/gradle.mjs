import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { emulatorEnv, repositoryRoot } from './emulator-temp.mjs';

/**
 * Envoltura de Gradle que reenvía los argumentos y corrige el entorno igual que
 * para los emuladores: el daemon de Gradle también es un proceso Java y también
 * muere con `Unable to establish loopback connection` si hereda el `%TEMP%` de
 * esta máquina. Ver `emulator-temp.mjs`.
 */
const androidRoot = resolve(repositoryRoot, 'apps/client/android');
const isWindows = process.platform === 'win32';

// Se invoca por nombre relativo desde `cwd`: la ruta absoluta del repositorio
// contiene espacios y `shell: true` la partiría en dos.
const child = spawn(isWindows ? '.\\gradlew.bat' : './gradlew', process.argv.slice(2), {
  cwd: androidRoot,
  env: emulatorEnv(),
  stdio: 'inherit',
  shell: isWindows,
});

child.on('error', (error) => {
  console.error('No se pudo iniciar Gradle.', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Gradle terminó por señal ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
