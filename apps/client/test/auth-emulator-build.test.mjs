import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const testRoot = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(testRoot, '..');
const productionRoot = resolve(clientRoot, 'dist');
const emulatorRoot = resolve(clientRoot, 'dist-emulator');

async function runBuild(script) {
  await execFileAsync(process.execPath, [resolve(clientRoot, 'scripts', script)], {
    cwd: clientRoot,
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  });
}

function extractCsp(html) {
  const match = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)" \/>/);
  assert.notEqual(match, null, 'No se encontró la meta CSP esperada.');
  return match[1];
}

test('build:auth-emulator crea un artefacto con hash sin contaminar producción', async () => {
  await runBuild('build-static.mjs');
  const productionHtmlBefore = await readFile(resolve(productionRoot, 'index.html'), 'utf8');
  const productionSwBefore = await readFile(resolve(productionRoot, 'sw.js'), 'utf8');
  const productionCsp = extractCsp(productionHtmlBefore);

  assert.match(productionCsp, /connect-src 'self';/);
  assert.doesNotMatch(productionCsp, /127\.0\.0\.1:9099/);
  assert.doesNotMatch(productionHtmlBefore, /auth-emulator-[A-Z0-9]+\.js/);

  await runBuild('build-auth-emulator.mjs');

  const productionHtmlAfter = await readFile(resolve(productionRoot, 'index.html'), 'utf8');
  const productionSwAfter = await readFile(resolve(productionRoot, 'sw.js'), 'utf8');
  assert.equal(productionHtmlAfter, productionHtmlBefore);
  assert.equal(productionSwAfter, productionSwBefore);
  await assert.rejects(stat(resolve(productionRoot, 'modular')), /ENOENT/);

  const emulatorHtml = await readFile(resolve(emulatorRoot, 'index.html'), 'utf8');
  const emulatorCsp = extractCsp(emulatorHtml);
  assert.match(
    emulatorCsp,
    /connect-src 'self' http:\/\/127\.0\.0\.1:9099;/,
  );
  assert.equal((emulatorCsp.match(/connect-src/g) ?? []).length, 1);

  const moduleScripts = [...emulatorHtml.matchAll(
    /<script type="module" src="(modular\/auth-emulator-[A-Z0-9]+\.js)"><\/script>/g,
  )];
  assert.equal(moduleScripts.length, 1);
  assert.ok(
    emulatorHtml.indexOf(moduleScripts[0][0])
      < emulatorHtml.indexOf('<script src="native-bridge.js?v=0.1.2" defer></script>'),
    'Auth debe cargarse en paralelo sin sustituir el bridge legacy.',
  );

  const bundlePath = resolve(emulatorRoot, moduleScripts[0][1]);
  const modularFiles = await readdir(resolve(emulatorRoot, 'modular'));
  assert.deepEqual(modularFiles, [basename(bundlePath)]);

  const bundle = await readFile(bundlePath, 'utf8');
  assert.match(bundle, /demo-convergence-v2/);
  assert.match(bundle, /127\.0\.0\.1/);
  assert.doesNotMatch(bundle, /Firebase Database/);
  assert.doesNotMatch(bundle, /Firestore/);
  assert.doesNotMatch(bundle, /cloudfunctions\.net/);
  assert.doesNotMatch(bundle, /(?:from|import)\s*["'](?:firebase|@firebase)\//);
  assert.doesNotMatch(bundle, /gstatic\.com\/firebasejs/);
  assert.doesNotMatch(bundle, /sourceMappingURL/);

  const emulatorSw = await readFile(resolve(emulatorRoot, 'sw.js'), 'utf8');
  assert.equal(emulatorSw, productionSwBefore);
});
