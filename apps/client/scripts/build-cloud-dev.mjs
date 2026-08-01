import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const clientRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const productionRoot = resolve(clientRoot, 'dist');
const isBuildTest = process.env.CONVERGENCE_FIREBASE_CLOUD_BUILD_TEST === '1';
const cloudDevRoot = isBuildTest
  ? resolve(clientRoot, 'test/.tmp/dist-cloud-dev')
  : resolve(clientRoot, 'dist-cloud-dev');
const bundleRoot = resolve(cloudDevRoot, 'modular');
const entryPoint = resolve(clientRoot, 'src/online/cloud-dev-auth-bootstrap.ts');
const indexPath = resolve(cloudDevRoot, 'index.html');
const configPath = isBuildTest
  ? resolve(clientRoot, 'test/fixtures/firebase-config.cloud-build-test.json')
  : resolve(clientRoot, 'firebase-config.dev.json');

const authOrigins = Object.freeze([
  'https://identitytoolkit.googleapis.com',
  'https://securetoken.googleapis.com',
]);

const expectedMetadata = Object.freeze({
  version: '2',
  projectId: 'convergence-d1a35',
  projectNumber: '98627547554',
  appId: '1:98627547554:web:8d293cfb4a8a99b6cd82fb',
  authDomain: 'convergence-d1a35.firebaseapp.com',
  databaseURL: 'https://convergence-d1a35-default-rtdb.europe-west1.firebasedatabase.app',
  storageBucket: 'convergence-d1a35.firebasestorage.app',
  messagingSenderId: '98627547554',
  measurementId: 'G-408MBD8NDD',
});

// Fingerprint de la API key pública descargada para la app Web registrada.
// Evita que un JSON con metadatos correctos enrute Auth a otro proyecto.
const expectedApiKeySha256 =
  '84c8bd00203fed14cc24b2529716a6ffe560b1bb80a4d366ae51619ad62c0310';

const exactConfigKeys = Object.freeze([
  ...Object.keys(expectedMetadata),
  'apiKey',
].sort());

const forbiddenFirebaseSdkInput = /(?:^|[/\\])(?:@firebase|firebase)[/\\](?:analytics|database|firestore|functions)(?:[/\\]|$)/i;

function assertExactOutput(path, expectedPath) {
  if (path !== expectedPath) {
    throw new Error(`Salida de build no segura: ${path}`);
  }
}

function count(text, fragment) {
  return text.split(fragment).length - 1;
}

function relativeWebPath(from, to) {
  const path = relative(from, to);
  if (path === '' || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`El bundle queda fuera del artefacto cloud-dev: ${to}`);
  }
  return path.split(sep).join('/');
}

function assertPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('La configuracion Firebase dev debe ser un objeto JSON.');
  }
}

function validateAndSelectAuthConfig(value) {
  assertPlainObject(value);

  const receivedKeys = Object.keys(value).sort();
  if (JSON.stringify(receivedKeys) !== JSON.stringify(exactConfigKeys)) {
    throw new Error('Las claves de firebase-config.dev.json no coinciden con el contrato esperado.');
  }

  for (const [field, expected] of Object.entries(expectedMetadata)) {
    if (value[field] !== expected) {
      throw new Error(`Metadato Firebase dev inesperado: ${field}.`);
    }
  }

  if (
    typeof value.apiKey !== 'string'
    || value.apiKey.length < 20
    || value.apiKey.length > 200
    || /\s/.test(value.apiKey)
  ) {
    throw new Error('apiKey de Firebase dev ausente o con formato invalido.');
  }
  if (
    !isBuildTest
    && createHash('sha256').update(value.apiKey, 'utf8').digest('hex')
      !== expectedApiKeySha256
  ) {
    throw new Error('La apiKey no pertenece a la app Web dev registrada.');
  }

  // Solo estas claves llegan al bundle Auth-only. Analytics, projectNumber y
  // version se validan arriba, pero se excluyen deliberadamente del runtime.
  return Object.freeze({
    apiKey: value.apiKey,
    appId: value.appId,
    authDomain: value.authDomain,
    databaseURL: value.databaseURL,
    messagingSenderId: value.messagingSenderId,
    projectId: value.projectId,
    storageBucket: value.storageBucket,
  });
}

function injectCloudDevBootstrap(html, bundlePath) {
  const cspMeta = 'http-equiv="Content-Security-Policy"';
  const productionConnect = "connect-src 'self'";
  const cloudConnect = `${productionConnect} ${authOrigins.join(' ')}`;
  const bridgePattern = /^(\s*)<script src="native-bridge\.js(?:\?[^\"]*)?" defer><\/script>$/gm;
  const bridgeMatches = [...html.matchAll(bridgePattern)];

  if (count(html, cspMeta) !== 1) {
    throw new Error('El build cloud-dev exige exactamente una meta CSP.');
  }
  if (
    count(html, productionConnect) !== 1
    || authOrigins.some((origin) => html.includes(origin))
  ) {
    throw new Error('La directiva connect-src productiva no coincide con el contrato esperado.');
  }
  if (bridgeMatches.length !== 1) {
    throw new Error('El build cloud-dev exige exactamente un script native-bridge como ancla.');
  }

  const withCsp = html.replace(productionConnect, cloudConnect);
  const bridge = bridgeMatches[0];
  const indentation = bridge[1] ?? '';
  const moduleScript = `${indentation}<script type="module" src="${bundlePath}"></script>`;
  return withCsp.replace(bridge[0], `${moduleScript}\n${bridge[0]}`);
}

async function loadConfig() {
  let source;
  try {
    source = await readFile(configPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const expectedFile = isBuildTest
        ? 'test/fixtures/firebase-config.cloud-build-test.json'
        : 'firebase-config.dev.json';
      throw new Error(`Falta la configuracion Firebase requerida: ${expectedFile}.`, { cause: error });
    }
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error('La configuracion Firebase dev no contiene JSON valido.', { cause: error });
  }
  return validateAndSelectAuthConfig(parsed);
}

assertExactOutput(productionRoot, resolve(clientRoot, 'dist'));
assertExactOutput(
  cloudDevRoot,
  isBuildTest
    ? resolve(clientRoot, 'test/.tmp/dist-cloud-dev')
    : resolve(clientRoot, 'dist-cloud-dev'),
);

try {
  await stat(resolve(productionRoot, 'index.html'));
  await stat(resolve(productionRoot, 'sw.js'));
  await stat(entryPoint);
  const firebaseAuthConfig = await loadConfig();

  await rm(cloudDevRoot, { recursive: true, force: true });
  await mkdir(cloudDevRoot, { recursive: true });
  await cp(productionRoot, cloudDevRoot, { recursive: true, force: true });
  await mkdir(bundleRoot, { recursive: true });

  const result = await build({
    absWorkingDir: clientRoot,
    entryPoints: [entryPoint],
    outdir: bundleRoot,
    entryNames: 'cloud-dev-auth-[hash]',
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
    define: {
      __CONVERGENCE_FIREBASE_CLOUD_DEV_CONFIG__: JSON.stringify(firebaseAuthConfig),
    },
  });

  const entryOutputs = Object.entries(result.metafile.outputs)
    .filter(([, metadata]) => metadata.entryPoint !== undefined);
  if (entryOutputs.length !== 1) {
    throw new Error(`Se esperaba un unico bundle de entrada; recibidos: ${String(entryOutputs.length)}.`);
  }

  const forbiddenInputs = Object.keys(result.metafile.inputs)
    .filter((path) => forbiddenFirebaseSdkInput.test(path));
  if (forbiddenInputs.length !== 0) {
    throw new Error('El bundle cloud-dev Auth-only incluye un SDK Firebase no permitido.');
  }

  const outputPath = resolve(clientRoot, entryOutputs[0][0]);
  const outputName = basename(outputPath);
  if (!/^cloud-dev-auth-[A-Z0-9]+\.js$/.test(outputName)) {
    throw new Error(`Nombre de bundle sin hash reconocido: ${outputName}`);
  }

  const modularFiles = await readdir(bundleRoot);
  if (modularFiles.length !== 1 || modularFiles[0] !== outputName) {
    throw new Error('El build cloud-dev debe producir un unico bundle modular.');
  }

  const bundlePath = relativeWebPath(cloudDevRoot, outputPath);
  const html = await readFile(indexPath, 'utf8');
  const injectedHtml = injectCloudDevBootstrap(html, bundlePath);
  await writeFile(indexPath, injectedHtml, 'utf8');

  console.log(`Cliente Firebase cloud dev aislado: ${cloudDevRoot} (${bundlePath})`);
} catch (error) {
  await rm(cloudDevRoot, { recursive: true, force: true });
  throw error;
}
