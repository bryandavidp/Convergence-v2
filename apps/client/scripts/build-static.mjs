import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(clientRoot, 'web');
const outputRoot = join(clientRoot, 'dist');

if (dirname(outputRoot) !== clientRoot || basename(outputRoot) !== 'dist') {
  throw new Error(`Salida de build no segura: ${outputRoot}`);
}

const entries = [
  'index.html',
  'styles.css',
  'native-bridge.js',
  'game-core.js',
  'game.js',
  'sw.js',
  'manifest.webmanifest',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable.png',
  'fonts',
  'img',
];

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const entry of entries) {
  const source = join(sourceRoot, entry);
  await stat(source);
  await cp(source, join(outputRoot, entry), {
    recursive: true,
    force: true,
  });
}

console.log(`Cliente estático copiado sin transformar: ${sourceRoot} -> ${outputRoot}`);
