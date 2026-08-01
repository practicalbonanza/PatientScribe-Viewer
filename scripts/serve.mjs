/**
 * Development-only static file server for the browser test harness.
 *
 * Serves `site/` over loopback so the test browsers can load the page from an
 * http origin rather than a file URL, which module scripts need.
 *
 * This models nothing about production. It sets no security headers and is not
 * a stand-in for the real response headers — those are configured where the site
 * is actually hosted and are checked against the live origin, not here. Reading
 * anything into this server's responses would be reading into the wrong thing.
 *
 * It is never served to anyone, never bundled, and never part of `site/`.
 *
 * Usage: node scripts/serve.mjs [port]
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ROOT = resolve(fileURLToPath(new URL('../site', import.meta.url)));
const HOST = '127.0.0.1';
const port = Number(process.argv[2] ?? 4173);

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/vnd.microsoft.icon'],
]);

const server = createServer((req, res) => {
  const requestPath = new URL(req.url ?? '/', `http://${HOST}:${port}`).pathname;
  const relativePath = requestPath === '/' ? 'index.html' : decodeURIComponent(requestPath).replace(/^\/+/, '');
  const target = resolve(join(SITE_ROOT, relativePath));

  // Containment: never serve anything outside site/, whatever the path says.
  if (target !== SITE_ROOT && !target.startsWith(SITE_ROOT + sep)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('forbidden');
    return;
  }

  readFile(target).then(
    (body) => {
      const type = CONTENT_TYPES.get(extname(target).toLowerCase()) ?? 'application/octet-stream';
      res.writeHead(200, { 'content-type': type });
      res.end(body);
    },
    () => {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
    },
  );
});

server.on('error', (err) => {
  process.stderr.write(`serve.mjs — cannot listen on ${HOST}:${port}: ${err.message}\n`);
  process.exit(1);
});

server.listen(port, HOST, () => {
  process.stdout.write(`serve.mjs — serving site/ at http://${HOST}:${port}/\n`);
});
