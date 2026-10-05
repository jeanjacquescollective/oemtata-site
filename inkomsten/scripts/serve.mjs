// Lokale preview van de site: http://localhost:8080
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/config.mjs';

const DOCS = path.join(ROOT, 'docs');
const IMG = path.join(ROOT, '..', 'img'); // logo van de hoofdsite (../../img/ vanuit docs/)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const port = Number(process.env.PORT ?? 8080);

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const base = url.startsWith('/img/') ? IMG : DOCS;
  const file = path.join(base, url.startsWith('/img/') ? url.slice(4) : url.endsWith('/') ? url + 'index.html' : url);
  if (!file.startsWith(base) || !fs.existsSync(file)) { res.writeHead(404).end('Niet gevonden'); return; }
  res.writeHead(200, { 'Content-Type': (TYPES[path.extname(file)] ?? 'application/octet-stream') + '; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Preview: http://localhost:${port}`));
