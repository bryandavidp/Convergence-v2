import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const firebaseCli = resolve(
  repositoryRoot,
  'node_modules/firebase-tools/lib/bin/firebase.js',
);

/**
 * Los emuladores de Firestore, Database y Storage son procesos Java, y
 * `Selector.open()` de Java NIO crea internamente un pipe sobre un socket
 * AF_UNIX ubicado en `java.io.tmpdir`, que en Windows sale de `%TEMP%`.
 *
 * En la máquina de desarrollo actual ese directorio concreto rechaza el
 * `connect` con `Invalid argument` (EINVAL) mientras funciona en cualquier otra
 * ruta, así que ningún emulador arrancaba: fallaban con `failed to create a
 * child event loop`. Darles un temporal propio dentro del repositorio lo evita
 * sin depender de configuración de la máquina.
 *
 * Solo se aplica en Windows: en POSIX Java resuelve `java.io.tmpdir` a `/tmp`
 * e ignora estas variables, y no hay motivo para cambiar el comportamiento de
 * CI. Ver la entrada de `docs/PROGRESS.md` del 2026-08-02.
 */
const javaBinary = process.platform === 'win32' ? 'java.exe' : 'java';

function javaAlreadyOnPath(env) {
  return spawnSync('java', ['-version'], { env, stdio: 'ignore' }).error === undefined;
}

/**
 * Los emuladores necesitan un JDK, pero el criterio de salida de la fase 1 pide
 * que una instalación limpia reproduzca las pruebas sin depender de paquetes
 * globales. Si `java` no está en el PATH se busca el JDK homologado (21) antes
 * que cualquier otro, y solo se toca el PATH del proceso hijo.
 */
function discoverJavaHome() {
  const candidates = [];
  if (process.env.JAVA_HOME) candidates.push(process.env.JAVA_HOME);

  const jdksRoot = resolve(homedir(), '.jdks');
  if (existsSync(jdksRoot)) {
    const entries = readdirSync(jdksRoot).sort().reverse();
    const homologated = (name) => name.includes('21');
    candidates.push(
      ...entries.filter(homologated).map((name) => resolve(jdksRoot, name)),
      ...entries.filter((name) => !homologated(name)).map((name) => resolve(jdksRoot, name)),
    );
  }
  candidates.push('C:\\Program Files\\Android\\Android Studio\\jbr');

  return candidates.find((home) => existsSync(resolve(home, 'bin', javaBinary))) ?? null;
}

export function emulatorEnv(env = process.env) {
  const patched = { ...env };

  if (!javaAlreadyOnPath(patched)) {
    const javaHome = discoverJavaHome();
    if (javaHome !== null) {
      patched.JAVA_HOME = javaHome;
      patched.PATH = `${resolve(javaHome, 'bin')}${delimiter}${patched.PATH ?? ''}`;
    }
  }

  if (process.platform !== 'win32') return patched;
  const tempDirectory = resolve(repositoryRoot, '.emulator-tmp');
  mkdirSync(tempDirectory, { recursive: true });
  return { ...patched, TMP: tempDirectory, TEMP: tempDirectory };
}
