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
const {
  UserProfileRepository,
  defaultUserProfile,
  defaultUserBestRecords,
  defaultUserSettings,
} = loadTypeScriptModule('../src/storage/user-profile-repository.ts');

test('UserProfileRepository carga valores por defecto cuando el almacenamiento esta vacio', async () => {
  const storage = new MemoryStorage();
  const jsonRepo = new JsonRepository(storage);
  const repo = new UserProfileRepository(jsonRepo, () => 1000);

  const profile = await repo.loadProfile('uid-123');
  assert.equal(profile.uid, 'uid-123');
  assert.equal(profile.displayName, 'Jugador');

  const records = await repo.loadBestRecords('uid-123');
  assert.equal(records.survivalBest, 0);

  const settings = await repo.loadSettings();
  assert.equal(settings.language, 'es');
});

test('UserProfileRepository guarda y recupera perfiles validos', async () => {
  const storage = new MemoryStorage();
  const jsonRepo = new JsonRepository(storage);
  const repo = new UserProfileRepository(jsonRepo, () => 1000);

  const customProfile = {
    ...defaultUserProfile('uid-456', 2000),
    displayName: 'Pro Player',
    theme: 'theme-neon',
  };

  await repo.saveProfile(customProfile);
  const loaded = await repo.loadProfile('uid-456');
  assert.equal(loaded.displayName, 'Pro Player');
  assert.equal(loaded.theme, 'theme-neon');
});

test('UserProfileRepository guarda y recupera mejores marcas', async () => {
  const storage = new MemoryStorage();
  const jsonRepo = new JsonRepository(storage);
  const repo = new UserProfileRepository(jsonRepo, () => 1000);

  const customRecords = {
    ...defaultUserBestRecords('uid-456', 2000),
    survivalBest: 15000,
    survivalBestWave: 20,
    adventureMaxLevel: 10,
    bestCombo: 12,
  };

  await repo.saveBestRecords(customRecords);
  const loaded = await repo.loadBestRecords('uid-456');
  assert.equal(loaded.survivalBest, 15000);
  assert.equal(loaded.survivalBestWave, 20);
});
