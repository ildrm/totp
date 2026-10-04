import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('../apps/web/out/', import.meta.url)));
const headers = JSON.parse(await readFile(resolve(root, 'security-headers.json'), 'utf8'));
const api = new URL(process.env.API_URL ?? 'http://127.0.0.1:4000');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};
const server = createServer(async (req, res) => {
  if (req.url?.startsWith('/api/')) {
    const upstreamHeaders = {
      ...req.headers,
      host: api.host,
      'x-forwarded-for': req.socket.remoteAddress ?? '127.0.0.1',
      'x-forwarded-proto': 'http',
    };
    delete upstreamHeaders.forwarded;
    const upstream = (api.protocol === 'https:' ? httpsRequest : httpRequest)(
      new URL(req.url, api),
      { method: req.method, headers: upstreamHeaders, timeout: 15000 },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent)
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end('{"message":"Cloud service unavailable."}');
    });
    upstream.on('timeout', () => upstream.destroy());
    req.pipe(upstream);
    return;
  }
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  if (!['GET', 'HEAD'].includes(req.method ?? '')) {
    res.writeHead(405);
    res.end();
    return;
  }
  try {
    let path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (path === '/') path = '/index.html';
    if (path.includes('\0') || path.includes('\\')) throw new Error();
    let file = resolve(root, '.' + path);
    if (!file.startsWith(root + sep)) throw new Error();
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    const content = await readFile(file);
    res.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
    res.setHeader(
      'Cache-Control',
      file.includes(`${sep}_next${sep}static${sep}`)
        ? 'public,max-age=31536000,immutable'
        : 'no-cache',
    );
    if (path === '/sw.js') res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Content-Length', content.length);
    res.writeHead(200);
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});
server.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1', () =>
  process.stdout.write('Still web ready.\n'),
);
