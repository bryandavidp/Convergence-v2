import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { PROFILE_EMULATOR_BUILD_CONFIG } from './profile-emulator-build-config.mjs';

const clientRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const productionRoot = resolve(clientRoot, 'dist');
const authEmulatorRoot = resolve(clientRoot, 'dist-emulator');
const sourceRoot = resolve(clientRoot, 'web');
const profileEmulatorRoot = resolve(
  clientRoot,
  PROFILE_EMULATOR_BUILD_CONFIG.artifactName,
);
const bundleRoot = resolve(profileEmulatorRoot, 'modular');
const entryPoint = resolve(clientRoot, PROFILE_EMULATOR_BUILD_CONFIG.entryPoint);
const indexPath = resolve(profileEmulatorRoot, 'index.html');
const staticEntries = Object.freeze([
  'index.html',
  'styles.css',
  'native-bridge.js',
  'game.js',
  'sw.js',
  'manifest.webmanifest',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable.png',
  'fonts',
  'img',
]);

const forbiddenFirebaseSdkInput =
  /(?:^|[/\\])(?:@firebase|firebase)[/\\](?:analytics|database|firestore|messaging|storage)(?:[/\\]|$)/i;

function assertExactOutput(path, expectedName) {
  if (dirname(path) !== clientRoot || basename(path) !== expectedName) {
    throw new Error(`Salida de build no segura: ${path}`);
  }
}

function relativeWebPath(from, to) {
  const path = relative(from, to);
  if (path === '' || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`El bundle queda fuera del artefacto Profile Emulator: ${to}`);
  }
  return path.split(sep).join('/');
}

function injectProfileEmulatorBootstrap(html, bundlePath) {
  const cspMatches = [...html.matchAll(
    /<meta http-equiv="Content-Security-Policy" content="([^"]+)" \/>/g,
  )];
  if (cspMatches.length !== 1) {
    throw new Error('El build Profile Emulator exige exactamente una meta CSP.');
  }

  const csp = cspMatches[0][1];
  const connectDirectives = csp
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => directive.startsWith('connect-src '));
  if (connectDirectives.length !== 1 || connectDirectives[0] !== "connect-src 'self'") {
    throw new Error("La CSP fuente debe declarar exactamente connect-src 'self'.");
  }
  if (PROFILE_EMULATOR_BUILD_CONFIG.connectOrigins.some((origin) => html.includes(origin))) {
    throw new Error('La CSP fuente ya contiene endpoints del Emulator Suite.');
  }

  const bridgePattern = /^(\s*)<script src="native-bridge\.js(?:\?[^\"]*)?" defer><\/script>$/gm;
  const bridgeMatches = [...html.matchAll(bridgePattern)];
  if (bridgeMatches.length !== 1) {
    throw new Error('El build Profile Emulator exige exactamente un native-bridge como ancla.');
  }

  const emulatorConnect = `connect-src 'self' ${PROFILE_EMULATOR_BUILD_CONFIG.connectOrigins.join(' ')}`;
  const withCsp = html.replace("connect-src 'self'", emulatorConnect);
  const bridge = bridgeMatches[0];
  const indentation = bridge[1] ?? '';
  const moduleScript = `${indentation}<script type="module" src="${bundlePath}"></script>`;
  return withCsp.replace(bridge[0], `${moduleScript}\n${bridge[0]}`);
}

assertExactOutput(productionRoot, 'dist');
assertExactOutput(authEmulatorRoot, 'dist-emulator');
assertExactOutput(profileEmulatorRoot, 'dist-profile-emulator');

try {
  // Compone su propio snapshot desde la misma allowlist estable. No lee ni
  // regenera dist, por lo que builds paralelos no pueden contaminarse entre si.
  await stat(entryPoint);

  await rm(profileEmulatorRoot, { recursive: true, force: true });
  await mkdir(profileEmulatorRoot, { recursive: true });
  for (const entry of staticEntries) {
    const source = resolve(sourceRoot, entry);
    await stat(source);
    await cp(source, resolve(profileEmulatorRoot, entry), {
      recursive: true,
      force: true,
    });
  }
  await rm(bundleRoot, { recursive: true, force: true });
  await mkdir(bundleRoot, { recursive: true });

  const result = await build({
    absWorkingDir: clientRoot,
    entryPoints: [entryPoint],
    outdir: bundleRoot,
    entryNames: `${PROFILE_EMULATOR_BUILD_CONFIG.bundlePrefix}-[hash]`,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    treeShaking: true,
    minify: true,
    legalComments: 'none',
    sourcemap: false,
    metafile: true,
    logLevel: 'silent',
  });

  const entryOutputs = Object.entries(result.metafile.outputs)
    .filter(([, metadata]) => metadata.entryPoint !== undefined);
  if (entryOutputs.length !== 1) {
    throw new Error(
      `Se esperaba un unico bundle de entrada; recibidos: ${String(entryOutputs.length)}.`,
    );
  }

  const forbiddenInputs = Object.keys(result.metafile.inputs)
    .filter((path) => forbiddenFirebaseSdkInput.test(path));
  if (forbiddenInputs.length !== 0) {
    throw new Error('El bundle Profile Emulator incluye un SDK Firebase no permitido.');
  }

  const outputPath = resolve(clientRoot, entryOutputs[0][0]);
  const outputName = basename(outputPath);
  const escapedPrefix = PROFILE_EMULATOR_BUILD_CONFIG.bundlePrefix.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&',
  );
  if (!new RegExp(`^${escapedPrefix}-[A-Z0-9]+\\.js$`).test(outputName)) {
    throw new Error(`Nombre de bundle sin hash reconocido: ${outputName}`);
  }

  const modularFiles = await readdir(bundleRoot);
  if (modularFiles.length !== 1 || modularFiles[0] !== outputName) {
    throw new Error('El build Profile Emulator debe producir un unico bundle modular.');
  }

  const bundlePath = relativeWebPath(profileEmulatorRoot, outputPath);
  const html = await readFile(indexPath, 'utf8');
  const injectedHtml = injectProfileEmulatorBootstrap(html, bundlePath);
  await writeFile(indexPath, injectedHtml, 'utf8');

  console.log(`Cliente Profile Emulator aislado: ${profileEmulatorRoot} (${bundlePath})`);
} catch (error) {
  await rm(profileEmulatorRoot, { recursive: true, force: true });
  throw error;
}
