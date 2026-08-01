import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const requestedRoot = process.argv[2] ?? 'web';
const portFlag = process.argv.indexOf('--port');
const port = Number(portFlag >= 0 ? process.argv[portFlag + 1] : 4173);
const root = resolve(clientRoot, requestedRoot);

if (root !== clientRoot && !root.startsWith(`${clientRoot}${sep}`)) {
  throw new Error('La raíz solicitada queda fuera de apps/client.');
}

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ttf', 'font/ttf'],
  ['.webmanifest', 'application/manifest+json'],
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const decodedPath = decodeURIComponent(url.pathname);
    const candidate = resolve(root, `.${decodedPath}`);

    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    let file = candidate;
    const metadata = await stat(file);
    if (metadata.isDirectory()) file = resolve(file, 'index.html');

    const finalMetadata = await stat(file);
    if (!finalMetadata.isFile()) throw new Error('Not a file');

    response.writeHead(200, {
      'Content-Type': contentTypes.get(extname(file).toLowerCase()) ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Convergence: http://127.0.0.1:${port} (${root})`);
});
