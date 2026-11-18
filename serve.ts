// PORT SOLANO — a tiny local server for playing the game during
// development. `node serve.ts` serves game/ at http://localhost:8902
// (pass --port N for another port). Standard library only; it refuses
// paths outside game/ and exists purely as a development convenience.

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const gameRoot = resolve(fileURLToPath(new URL('./game', import.meta.url)));
const args = process.argv.slice(2);
const portFlag = args.indexOf('--port');
const wanted = portFlag === -1 ? 8902 : Number(args[portFlag + 1]);
const port = Number.isInteger(wanted) && wanted > 0 && wanted < 65536 ? wanted : 8902;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

// Caching for a dev server: the HTML shell is revalidated on every load
// (no-cache) so a fresh edit is never masked by a stale page, while the
// assets under it get a short cache — long enough to skip refetching
// every module on each reload, short enough that edits land within a
// minute.
function cacheControlFor(filePath: string): string {
  return extname(filePath).toLowerCase() === '.html'
    ? 'no-cache'
    : 'public, max-age=60';
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400).end('bad request');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const filePath = resolve(join(gameRoot, normalize(pathname)));
  if (filePath !== gameRoot && !filePath.startsWith(gameRoot + sep)) {
    response.writeHead(403).end('forbidden');
    return;
  }
  let size: number;
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) throw new Error('not a file');
    size = stats.size;
  } catch {
    response.writeHead(404).end('not found');
    return;
  }
  response.writeHead(200, {
    'content-type': MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'content-length': size,
    'cache-control': cacheControlFor(filePath),
  });
  createReadStream(filePath).pipe(response);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`PORT SOLANO — port ${port} is already in use (another server is probably running).`);
    console.error(`Stop that one, or start this game on a free port: node serve.ts --port ${port + 1}`);
  } else {
    console.error(`PORT SOLANO — the server could not start: ${err.message}`);
  }
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`PORT SOLANO — game/ is live at http://localhost:${port}/ — open it in a desktop browser (Ctrl+C to stop)`);
});
