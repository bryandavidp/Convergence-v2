export const AUTH_EMULATOR_BUILD_MODE = 'emulator';
export const AUTH_EMULATOR_BOOTSTRAP_PROJECT_ID = 'demo-convergence-v2';
export const AUTH_EMULATOR_BOOTSTRAP_HOST = '127.0.0.1';
export const AUTH_EMULATOR_BOOTSTRAP_PORT = 9099;

export interface AuthEmulatorBootstrapConfigInput {
  mode?: string;
  projectId?: string;
  host?: string;
  port?: number;
}

export interface AuthEmulatorBootstrapConfig {
  readonly mode: typeof AUTH_EMULATOR_BUILD_MODE;
  readonly projectId: string;
  readonly host: typeof AUTH_EMULATOR_BOOTSTRAP_HOST;
  readonly port: typeof AUTH_EMULATOR_BOOTSTRAP_PORT;
  readonly url: string;
}

/**
 * Guardia deliberadamente más estricta que la configuración Firebase general.
 * Este artefacto web solo tiene permiso CSP para el Auth Emulator de loopback.
 */
export function resolveAuthEmulatorBootstrapConfig(
  input: AuthEmulatorBootstrapConfigInput = {},
): AuthEmulatorBootstrapConfig {
  const mode = input.mode ?? AUTH_EMULATOR_BUILD_MODE;
  if (mode !== AUTH_EMULATOR_BUILD_MODE) {
    throw new Error(`El bootstrap Auth solo admite modo emulator; recibido: ${mode}.`);
  }

  const projectId = (input.projectId ?? AUTH_EMULATOR_BOOTSTRAP_PROJECT_ID).trim();
  if (!/^demo-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(projectId)) {
    throw new Error(`El bootstrap Auth exige un projectId demo-*; recibido: ${projectId || '(vacío)'}.`);
  }

  const host = (input.host ?? AUTH_EMULATOR_BOOTSTRAP_HOST).trim();
  if (host !== AUTH_EMULATOR_BOOTSTRAP_HOST) {
    throw new Error(
      `El bootstrap web Auth solo admite loopback ${AUTH_EMULATOR_BOOTSTRAP_HOST}; recibido: ${host || '(vacío)'}.`,
    );
  }

  const port = input.port ?? AUTH_EMULATOR_BOOTSTRAP_PORT;
  if (port !== AUTH_EMULATOR_BOOTSTRAP_PORT) {
    throw new Error(
      `El bootstrap web Auth solo admite el puerto ${String(AUTH_EMULATOR_BOOTSTRAP_PORT)}; recibido: ${String(port)}.`,
    );
  }

  return Object.freeze({
    mode: AUTH_EMULATOR_BUILD_MODE,
    projectId,
    host: AUTH_EMULATOR_BOOTSTRAP_HOST,
    port: AUTH_EMULATOR_BOOTSTRAP_PORT,
    url: `http://${AUTH_EMULATOR_BOOTSTRAP_HOST}:${String(AUTH_EMULATOR_BOOTSTRAP_PORT)}`,
  });
}

export const AUTH_EMULATOR_BOOTSTRAP_CONFIG = resolveAuthEmulatorBootstrapConfig();
