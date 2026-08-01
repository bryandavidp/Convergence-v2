import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import { build } from 'esbuild';

const execFileAsync = promisify(execFile);
const testRoot = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(testRoot, '..');
const workspaceRoot = resolve(clientRoot, '..', '..');
const productionRoot = resolve(clientRoot, 'dist');
const cloudDevRoot = resolve(clientRoot, 'test/.tmp/dist-cloud-dev');
const cloudDevTestRoot = resolve(clientRoot, 'test/.tmp');
const fixturePath = resolve(testRoot, 'fixtures/firebase-config.cloud-build-test.json');
const expectedAuthOrigins = [
  'https://identitytoolkit.googleapis.com',
  'https://securetoken.googleapis.com',
];
const forbiddenFirebaseSdkInput = /(?:^|[/\\])(?:@firebase|firebase)[/\\](?:analytics|database|firestore|functions)(?:[/\\]|$)/i;

async function runBuild(script, env = {}) {
  return execFileAsync(process.execPath, [resolve(clientRoot, 'scripts', script)], {
    cwd: clientRoot,
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
    env: { ...process.env, ...env },
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

test('build:cloud-dev crea Auth cloud aislado sin contaminar produccion', async (t) => {
  t.after(async () => rm(cloudDevTestRoot, { recursive: true, force: true }));
  await runBuild('build-static.mjs');
  const productionBefore = await snapshotTree(productionRoot);
  const productionHtmlBefore = await readFile(resolve(productionRoot, 'index.html'), 'utf8');
  const productionSwBefore = await readFile(resolve(productionRoot, 'sw.js'), 'utf8');
  const productionCsp = extractCsp(productionHtmlBefore);
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));

  assert.match(productionCsp, /connect-src 'self';/);
  for (const origin of expectedAuthOrigins) {
    assert.equal(productionCsp.includes(origin), false);
  }

  const { stdout, stderr } = await runBuild('build-cloud-dev.mjs', {
    CONVERGENCE_FIREBASE_CLOUD_BUILD_TEST: '1',
  });

  assert.equal(stdout.includes(fixture.apiKey), false, 'El build no debe imprimir apiKey.');
  assert.equal(stderr.includes(fixture.apiKey), false, 'El build no debe imprimir apiKey.');
  assert.deepEqual(await snapshotTree(productionRoot), productionBefore);
  assert.equal(await readFile(resolve(productionRoot, 'index.html'), 'utf8'), productionHtmlBefore);
  assert.equal(await readFile(resolve(productionRoot, 'sw.js'), 'utf8'), productionSwBefore);
  await assert.rejects(stat(resolve(productionRoot, 'modular')), /ENOENT/);

  const cloudHtml = await readFile(resolve(cloudDevRoot, 'index.html'), 'utf8');
  const cloudCsp = extractCsp(cloudHtml);
  const expectedCsp = productionCsp.replace(
    "connect-src 'self'",
    `connect-src 'self' ${expectedAuthOrigins.join(' ')}`,
  );
  assert.equal(cloudCsp, expectedCsp);
  assert.equal((cloudCsp.match(/connect-src/g) ?? []).length, 1);
  for (const origin of expectedAuthOrigins) {
    assert.equal((cloudCsp.match(new RegExp(origin.replaceAll('.', '\\.'), 'g')) ?? []).length, 1);
  }
  assert.doesNotMatch(cloudCsp, /firebaseapp\.com/);
  const connectDirective = cloudCsp
    .split(';')
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith('connect-src '));
  assert.equal(
    connectDirective,
    `connect-src 'self' ${expectedAuthOrigins.join(' ')}`,
  );

  const moduleScripts = [...cloudHtml.matchAll(
    /<script type="module" src="(modular\/cloud-dev-auth-[A-Z0-9]+\.js)"><\/script>/g,
  )];
  assert.equal(moduleScripts.length, 1);
  assert.ok(
    cloudHtml.indexOf(moduleScripts[0][0])
      < cloudHtml.indexOf('<script src="native-bridge.js?v=0.1.0" defer></script>'),
    'Auth cloud debe inicializarse antes del bridge legacy.',
  );

  const bundlePath = resolve(cloudDevRoot, moduleScripts[0][1]);
  const modularFiles = await readdir(resolve(cloudDevRoot, 'modular'));
  assert.deepEqual(modularFiles, [basename(bundlePath)]);

  const artifactFiles = await listFiles(cloudDevRoot);
  assert.equal(
    artifactFiles.some((path) => /firebase-config(?:\.dev|\.cloud-build-test)?\.json$/i.test(path)),
    false,
    'La configuracion fuente no debe copiarse al artefacto.',
  );
  assert.equal(artifactFiles.some((path) => /\.map$/i.test(path)), false);

  const bundle = await readFile(bundlePath, 'utf8');
  assert.equal(bundle.includes(fixture.apiKey), true, 'El test debe compilar exclusivamente la fixture fija.');
  assert.match(bundle, /convergence-d1a35/);
  assert.doesNotMatch(
    bundle,
    /demo-convergence-v2|https?:\/\/(?:127\.0\.0\.1|localhost):9099|:9099/,
  );
  assert.doesNotMatch(bundle, /firestore\.googleapis\.com|cloudfunctions\.net|google-analytics\.com/i);
  assert.doesNotMatch(bundle, /G-408MBD8NDD/);
  assert.doesNotMatch(bundle, /(?:from|import)\s*\(?["'](?:firebase|@firebase)(?:\/|["'])/);
  assert.doesNotMatch(bundle, /gstatic\.com\/firebasejs|sourceMappingURL/);

  const authRuntimeFixture = {
    apiKey: fixture.apiKey,
    appId: fixture.appId,
    authDomain: fixture.authDomain,
    databaseURL: fixture.databaseURL,
    messagingSenderId: fixture.messagingSenderId,
    projectId: fixture.projectId,
    storageBucket: fixture.storageBucket,
  };
  const analysisBuild = await build({
    absWorkingDir: clientRoot,
    entryPoints: [resolve(clientRoot, 'src/online/cloud-dev-auth-bootstrap.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    treeShaking: true,
    minify: true,
    legalComments: 'none',
    sourcemap: false,
    metafile: true,
    write: false,
    logLevel: 'silent',
    define: {
      __CONVERGENCE_FIREBASE_CLOUD_DEV_CONFIG__: JSON.stringify(authRuntimeFixture),
    },
  });
  const forbiddenInputs = Object.keys(analysisBuild.metafile.inputs)
    .filter((path) => forbiddenFirebaseSdkInput.test(path));
  assert.deepEqual(
    forbiddenInputs,
    [],
    'El grafo del bundle Auth-only no debe importar Analytics, RTDB, Firestore ni Functions.',
  );

  const cloudSw = await readFile(resolve(cloudDevRoot, 'sw.js'), 'utf8');
  assert.equal(cloudSw, productionSwBefore);

  const hostingConfig = JSON.parse(await readFile(resolve(workspaceRoot, 'firebase.json'), 'utf8'));
  assert.equal(hostingConfig.hosting.public, 'apps/client/dist');
  const capacitorConfig = await readFile(resolve(clientRoot, 'capacitor.config.ts'), 'utf8');
  assert.match(capacitorConfig, /webDir:\s*["']dist["']/);
  assert.doesNotMatch(capacitorConfig, /dist-cloud-dev/);
});
