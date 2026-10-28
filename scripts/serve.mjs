#!/usr/bin/env node
// Zero-dependency dev server that mirrors the GitHub Pages layout:
// public/ is the site root and src/ is served at /src/ (the deploy job
// copies it there), so the browser imports the exact modules the build uses.
//   node scripts/serve.mjs [port]

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] ?? 8080);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.csv': 'text/csv', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const [base, rel] = path.startsWith('/src/') ? [join(ROOT, 'src'), path.slice(5)] : [join(ROOT, 'public'), path.slice(1) || 'index.html'];
  let file = normalize(join(base, rel));
  if (!file.startsWith(base)) return void res.writeHead(403).end();
  // Like GitHub Pages: /charts serves charts.html.
  if (!extname(file) && (await stat(`${file}.html`).catch(() => null))) file = `${file}.html`;
  try {
    if ((await stat(file)).isDirectory()) throw new Error('dir');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`http://localhost:${port}/`));
