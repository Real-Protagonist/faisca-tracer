// Servidor estático da versão web do Faísca Tracer (alojamento Node.js, por exemplo Hostinger).
// Serve apps/desktop/dist, gerado por `npm run build`. Sem dependências: só módulos do Node.
// Porta: variável PORT (definida pelo alojamento) ou 3000.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'apps', 'desktop', 'dist');
const PORT = Number(process.env.PORT) || 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

// A mesma política de segurança da aplicação de desktop: nada é carregado de fora.
const HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; script-src 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

/** Caminho do ficheiro pedido dentro de ROOT, ou null se tentar sair da pasta. */
function resolve(urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  const full = normalize(join(ROOT, p));
  return full === ROOT || full.startsWith(ROOT + sep) ? full : null;
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let file = resolve(req.url ?? '/');
  if (!file) {
    res.writeHead(400).end();
    return;
  }
  if (!isFile(file)) file = isFile(join(file, 'index.html')) ? join(file, 'index.html') : join(ROOT, 'index.html');
  if (!isFile(file)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Falta o build: corra «npm run build».');
    return;
  }
  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  // Os ficheiros em assets/ têm o hash no nome: cache longa. O index.html nunca fica em cache.
  const cache = file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { ...HEADERS, 'Content-Type': type, 'Cache-Control': cache, 'Content-Length': statSync(file).size });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Faísca Tracer em http://localhost:${PORT}`));
