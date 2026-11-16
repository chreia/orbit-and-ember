import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alertRelayPlugin } from './alertRelay.mjs';
import { getWorldGrid } from './worldGrid.mjs';

const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const routes = [];
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://local').pathname;
  for (const [prefix, handler] of routes) {
    if (pathname.startsWith(prefix)) {
      request.url = (request.url ?? '/').slice(prefix.length) || '/';
      await handler(request, response);
      return;
    }
  }
  if (pathname === '/api/world-grid') {
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    try {
      const feed = await getWorldGrid();
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(feed));
    } catch { response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify({ error: 'NASA FIRMS feed unavailable' })); }
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
  let relative;
  try { relative = decodeURIComponent(pathname); } catch { response.writeHead(400).end(); return; }
  const file = resolve(root, '.' + (relative === '/' ? '/index.html' : relative));
  if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Not a file');
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': type[extname(file)] ?? 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(404).end(); }
});

alertRelayPlugin().configureServer({ middlewares: { use: (path, handler) => routes.push([path, handler]) }, httpServer: server });
const port = Number(process.env.PORT ?? 5180);
server.listen(port, process.env.HOST ?? '127.0.0.1', () => console.log(`[focos] globe and signal relay listening on ${port}`));
