import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const testRoot = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(testRoot, '../src/online/auth-emulator-bootstrap-config.ts');
const { outputText } = ts.transpileModule(readFileSync(configPath, 'utf8'), {
  fileName: configPath,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});
const loaded = new Module(configPath);
loaded.filename = configPath;
loaded.paths = Module._nodeModulePaths(dirname(configPath));
loaded._compile(outputText, configPath);

const {
  AUTH_EMULATOR_BOOTSTRAP_CONFIG,
  resolveAuthEmulatorBootstrapConfig,
} = loaded.exports;

test('el bootstrap Auth usa un destino demo y loopback inmutable', () => {
  assert.deepEqual(AUTH_EMULATOR_BOOTSTRAP_CONFIG, {
    mode: 'emulator',
    projectId: 'demo-convergence-v2',
    host: '127.0.0.1',
    port: 9099,
    url: 'http://127.0.0.1:9099',
  });
  assert.equal(Object.isFrozen(AUTH_EMULATOR_BOOTSTRAP_CONFIG), true);
});

test('la guarda rechaza modo cloud, proyecto real, host remoto y otro puerto', () => {
  assert.throws(
    () => resolveAuthEmulatorBootstrapConfig({ mode: 'production' }),
    /solo admite modo emulator/,
  );
  assert.throws(
    () => resolveAuthEmulatorBootstrapConfig({ projectId: 'convergence-production' }),
    /projectId demo-\*/,
  );
  assert.throws(
    () => resolveAuthEmulatorBootstrapConfig({ host: '10.0.2.2' }),
    /solo admite loopback 127\.0\.0\.1/,
  );
  assert.throws(
    () => resolveAuthEmulatorBootstrapConfig({ port: 9199 }),
    /solo admite el puerto 9099/,
  );
});
