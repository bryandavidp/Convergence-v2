import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const testRoot = path.dirname(fileURLToPath(import.meta.url));

function loadTypeScriptModule(relativePath) {
  const filename = path.isAbsolute(relativePath)
    ? relativePath
    : path.resolve(testRoot, relativePath);
  const cached = loadTypeScriptModule.cache.get(filename);
  if (cached !== undefined) return cached.exports;

  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loadTypeScriptModule.cache.set(filename, loaded);

  const defaultRequire = loaded.require.bind(loaded);
  loaded.require = (specifier) => {
    if (specifier === '@convergence/contracts') {
      return loadTypeScriptModule('../../../packages/contracts/src/index.ts');
    }
    if (specifier.startsWith('.') && specifier.endsWith('.js')) {
      const sourceModule = path.resolve(
        path.dirname(filename),
        `${specifier.slice(0, -3)}.ts`,
      );
      if (fs.existsSync(sourceModule)) return loadTypeScriptModule(sourceModule);
    }
    return defaultRequire(specifier);
  };
  loaded._compile(outputText, filename);
  return loaded.exports;
}

loadTypeScriptModule.cache = new Map();

class MemoryStorage {
  values = new Map();

  async get(key) {
    await Promise.resolve();
    return this.values.get(key) ?? null;
  }

  async set(key, value) {
    await Promise.resolve();
    this.values.set(key, value);
  }

  async remove(key) {
    await Promise.resolve();
    this.values.delete(key);
  }
}

const { JsonRepository } = loadTypeScriptModule('../src/storage/json-repository.ts');
const { Outbox } = loadTypeScriptModule('../src/storage/outbox.ts');
const {
  UserProfileRepository,
  defaultUserBestRecords,
} = loadTypeScriptModule('../src/storage/user-profile-repository.ts');
const {
  mergeUserBestRecords,
  UserProfileSyncCoordinator,
} = loadTypeScriptModule('../src/online/user-profile-sync.ts');
const { getAppCheckConfig } = loadTypeScriptModule('../src/online/app-check-config.ts');

test('mergeUserBestRecords combina conservadoramente usando max() por campo', () => {
  const local = {
    ...defaultUserBestRecords('uid-1', 1000),
    survivalBest: 5000,
    survivalBestWave: 10,
    adventureMaxLevel: 15,
    bestCombo: 5,
  };
  const remote = {
    ...defaultUserBestRecords('uid-1', 2000),
    survivalBest: 8000,
    survivalBestWave: 8,
    adventureMaxLevel: 12,
    bestCombo: 9,
  };

  const merged = mergeUserBestRecords(local, remote, 3000);
  assert.equal(merged.survivalBest, 8000);
  assert.equal(merged.survivalBestWave, 10);
  assert.equal(merged.adventureMaxLevel, 15);
  assert.equal(merged.bestCombo, 9);
  assert.equal(merged.updatedAt, 3000);
});

test('UserProfileSyncCoordinator fusiona registros remotos y locales', async () => {
  const storage = new MemoryStorage();
  const jsonRepo = new JsonRepository(storage);
  const repo = new UserProfileRepository(jsonRepo, () => 1000);
  const outbox = new Outbox(jsonRepo);

  await repo.saveBestRecords({
    ...defaultUserBestRecords('uid-777', 1000),
    survivalBest: 12000,
  });

  const mockTransport = {
    fetchRemoteProfile: async () => null,
    pushProfile: async () => {},
    fetchRemoteRecords: async () => ({
      ...defaultUserBestRecords('uid-777', 2000),
      survivalBest: 9000,
      adventureMaxLevel: 25,
    }),
    pushRecords: async () => {},
  };

  const coordinator = new UserProfileSyncCoordinator(
    'uid-777',
    repo,
    outbox,
    mockTransport,
    () => 5000,
  );

  const synced = await coordinator.syncBestRecords();
  assert.equal(synced.survivalBest, 12000);
  assert.equal(synced.adventureMaxLevel, 25);
});

test('getAppCheckConfig genera la configuracion adecuada para dev y prod', () => {
  const devConfig = getAppCheckConfig({ env: 'dev' });
  assert.equal(devConfig.mode, 'monitor');
  assert.equal(devConfig.provider, 'debug');

  const prodConfig = getAppCheckConfig({ env: 'prod' });
  assert.equal(prodConfig.mode, 'enforce');
  assert.equal(prodConfig.provider, 'play-integrity');
});
