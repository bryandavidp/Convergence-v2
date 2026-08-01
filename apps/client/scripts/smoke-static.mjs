import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const port = 4199;
const server = spawn(
  process.execPath,
  [join(clientRoot, 'scripts', 'serve-static.mjs'), 'dist', '--port', String(port)],
  {
    cwd: clientRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  },
);

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

try {
  let response;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/`);
      break;
    } catch {
      await delay(100);
    }
  }

  if (!response?.ok) {
    throw new Error(`El servidor no respondió correctamente: ${response?.status}`);
  }

  const html = await response.text();
  if (!html.includes('game.js')) {
    throw new Error('El HTML servido no referencia game.js.');
  }

  console.log(`Smoke web OK: HTTP ${response.status}, ${html.length} caracteres.`);
} finally {
  server.kill();
}
