import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const testRoot = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(testRoot, '..');
const workspaceRoot = resolve(clientRoot, '..', '..');
const productionRoot = resolve(clientRoot, 'dist');
const authEmulatorRoot = resolve(clientRoot, 'dist-emulator');
const profileEmulatorRoot = resolve(clientRoot, 'dist-profile-emulator');
const emulatorOrigins = [
  'http://127.0.0.1:9099',
  'http://127.0.0.1:5001',
];

async function runBuild(script) {
  return execFileAsync(process.execPath, [resolve(clientRoot, 'scripts', script)], {
    cwd: clientRoot,
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  });
}

function extractCsp(html) {
  const matches = [...html.matchAll(
    /<meta http-equiv="Content-Security-Policy" content="([^"]+)" \/>/g,
  )];
  assert.equal(matches.length, 1, 'Debe existir una unica meta CSP.');
  return matches[0][1];
}

async function snapshotTree(root) {
  const snapshot = {};

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      assert.equal(entry.isFile(), true, `Entrada no regular inesperada: ${path}`);
      const webPath = relative(root, path).split(sep).join('/');
      const bytes = await readFile(path);
      snapshot[webPath] = createHash('sha256').update(bytes).digest('hex');
    }
  }

  await visit(root);
  return snapshot;
}

async function listFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else files.push(relative(root, path).split(sep).join('/'));
    }
  }
  await visit(root);
  return files.sort();
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function snapshotIfPresent(root) {
  return await pathExists(root) ? snapshotTree(root) : null;
}

test('build:profile-emulator aisla Auth y Functions sin contaminar otros artefactos', async (t) => {
  t.after(async () => rm(profileEmulatorRoot, { recursive: true, force: true }));

  const productionBefore = await snapshotIfPresent(productionRoot);
  const authEmulatorBefore = await snapshotIfPresent(authEmulatorRoot);
  const productionHtml = await readFile(resolve(clientRoot, 'web/index.html'), 'utf8');
  const productionSw = await readFile(resolve(clientRoot, 'web/sw.js'), 'utf8');
  const productionCsp = extractCsp(productionHtml);

  const { stdout, stderr } = await runBuild('build-profile-emulator.mjs');
  assert.match(stdout, /dist-profile-emulator/);
  assert.equal(stderr, '');

  assert.deepEqual(await snapshotIfPresent(productionRoot), productionBefore);
  assert.deepEqual(await snapshotIfPresent(authEmulatorRoot), authEmulatorBefore);

  const profileHtml = await readFile(resolve(profileEmulatorRoot, 'index.html'), 'utf8');
  const profileCsp = extractCsp(profileHtml);
  assert.equal(
    profileCsp,
    productionCsp.replace(
      "connect-src 'self'",
      `connect-src 'self' ${emulatorOrigins.join(' ')}`,
    ),
  );
  const connectDirective = profileCsp
    .split(';')
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith('connect-src '));
  assert.equal(connectDirective, `connect-src 'self' ${emulatorOrigins.join(' ')}`);
  assert.equal((profileCsp.match(/connect-src/g) ?? []).length, 1);
  assert.doesNotMatch(profileCsp, /localhost|:8080|:9000|:9199|https:\/\//);

  const moduleScripts = [...profileHtml.matchAll(
    /<script type="module" src="(modular\/profile-emulator-[A-Z0-9]+\.js)"><\/script>/g,
  )];
  assert.equal(moduleScripts.length, 1);
  assert.ok(
    profileHtml.indexOf(moduleScripts[0][0])
      < profileHtml.indexOf('<script src="native-bridge.js?v=0.1.1" defer></script>'),
    'El perfil emulator debe inicializarse antes del bridge legacy.',
  );

  const bundlePath = resolve(profileEmulatorRoot, moduleScripts[0][1]);
  const modularFiles = await readdir(resolve(profileEmulatorRoot, 'modular'));
  assert.deepEqual(modularFiles, [basename(bundlePath)]);
  const artifactFiles = await listFiles(profileEmulatorRoot);
  assert.equal(artifactFiles.some((path) => /\.map$/i.test(path)), false);

  const bundle = await readFile(bundlePath, 'utf8');
  assert.match(bundle, /demo-convergence-v2/);
  assert.match(bundle, /127\.0\.0\.1/);
  assert.match(bundle, /9099/);
  assert.match(bundle, /5001/);
  assert.doesNotMatch(bundle, /(?:from|import)\s*\(?["'](?:firebase|@firebase)(?:\/|["'])/);
  assert.doesNotMatch(bundle, /gstatic\.com\/firebasejs|sourceMappingURL/);

  assert.equal(
    await readFile(resolve(profileEmulatorRoot, 'sw.js'), 'utf8'),
    productionSw,
  );
  const hostingConfig = JSON.parse(await readFile(resolve(workspaceRoot, 'firebase.json'), 'utf8'));
  assert.equal(hostingConfig.hosting.public, 'apps/client/dist');
  const capacitorConfig = await readFile(resolve(clientRoot, 'capacitor.config.ts'), 'utf8');
  assert.match(capacitorConfig, /webDir:\s*["']dist["']/);
  assert.doesNotMatch(capacitorConfig, /dist-profile-emulator/);
});
