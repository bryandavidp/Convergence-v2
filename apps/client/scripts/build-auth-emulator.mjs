import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const clientRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const productionRoot = resolve(clientRoot, 'dist');
const emulatorRoot = resolve(clientRoot, 'dist-emulator');
const bundleRoot = resolve(emulatorRoot, 'modular');
const entryPoint = resolve(clientRoot, 'src/online/auth-emulator-bootstrap.ts');
const indexPath = resolve(emulatorRoot, 'index.html');
const authEmulatorUrl = 'http://127.0.0.1:9099';

function assertExactOutput(path, expectedName) {
  if (dirname(path) !== clientRoot || basename(path) !== expectedName) {
    throw new Error(`Salida de build no segura: ${path}`);
  }
}

function count(text, fragment) {
  return text.split(fragment).length - 1;
}

function relativeWebPath(from, to) {
  const path = relative(from, to);
  if (path === '' || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`El bundle queda fuera del artefacto emulator-only: ${to}`);
  }
  return path.split(sep).join('/');
}

function injectEmulatorBootstrap(html, bundlePath) {
  const cspMeta = 'http-equiv="Content-Security-Policy"';
  const productionConnect = "connect-src 'self'";
  const emulatorConnect = `${productionConnect} ${authEmulatorUrl}`;
  const bridgePattern = /^(\s*)<script src="native-bridge\.js(?:\?[^\"]*)?" defer><\/script>$/gm;
  const bridgeMatches = [...html.matchAll(bridgePattern)];

  if (count(html, cspMeta) !== 1) {
    throw new Error('El build emulator exige exactamente una meta CSP.');
  }
  if (count(html, productionConnect) !== 1 || html.includes(authEmulatorUrl)) {
    throw new Error('La directiva connect-src productiva no coincide con el contrato esperado.');
  }
  if (bridgeMatches.length !== 1) {
    throw new Error('El build emulator exige exactamente un script native-bridge como ancla.');
  }

  const withCsp = html.replace(productionConnect, emulatorConnect);
  const bridge = bridgeMatches[0];
  const indentation = bridge[1] ?? '';
  const moduleScript = `${indentation}<script type="module" src="${bundlePath}"></script>`;
  return withCsp.replace(bridge[0], `${moduleScript}\n${bridge[0]}`);
}

assertExactOutput(productionRoot, 'dist');
assertExactOutput(emulatorRoot, 'dist-emulator');

try {
  // Reutiliza el build productivo como fuente sin cambiar su allowlist ni su HTML.
  await import('./build-static.mjs');
  await rm(emulatorRoot, { recursive: true, force: true });
  await mkdir(emulatorRoot, { recursive: true });
  await cp(productionRoot, emulatorRoot, { recursive: true, force: true });
  await mkdir(bundleRoot, { recursive: true });

  const result = await build({
    absWorkingDir: clientRoot,
    entryPoints: [entryPoint],
    outdir: bundleRoot,
    entryNames: 'auth-emulator-[hash]',
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
    throw new Error(`Se esperaba un único bundle de entrada; recibidos: ${String(entryOutputs.length)}.`);
  }

  const outputPath = resolve(clientRoot, entryOutputs[0][0]);
  const outputName = basename(outputPath);
  if (!/^auth-emulator-[A-Z0-9]+\.js$/.test(outputName)) {
    throw new Error(`Nombre de bundle sin hash reconocido: ${outputName}`);
  }

  const bundlePath = relativeWebPath(emulatorRoot, outputPath);
  const html = await readFile(indexPath, 'utf8');
  const injectedHtml = injectEmulatorBootstrap(html, bundlePath);
  await writeFile(indexPath, injectedHtml, 'utf8');

  console.log(`Cliente Auth Emulator aislado: ${emulatorRoot} (${bundlePath})`);
} catch (error) {
  await rm(emulatorRoot, { recursive: true, force: true });
  throw error;
}
