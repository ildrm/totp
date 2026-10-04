import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
const root = resolve('out');
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else result.push(path);
  }
  return result;
}
const assets = (await files(root)).filter((path) =>
  /\.(html|js|css|svg|png|webmanifest|woff2?)$/.test(path),
);
const hashes = new Set();
const buildHash = createHash('sha256');
for (const path of assets) {
  const content = await readFile(path);
  buildHash.update(content);
  if (path.endsWith('.html')) {
    for (const match of content.toString().matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (!/\bsrc=/.test(match[1]) && match[2])
        hashes.add(`'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`);
    }
  }
}
const version = buildHash.digest('hex').slice(0, 20);
const csp = [
  "default-src 'none'",
  `script-src 'self' 'wasm-unsafe-eval' ${[...hashes].join(' ')}`,
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');
await writeFile(
  join(root, 'security-headers.json'),
  JSON.stringify({
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  }),
);
const urls = assets.map((path) => '/' + relative(root, path).replaceAll('\\', '/')).sort();
const sw = `'use strict';\nconst VERSION='still-${version}';\nconst ASSETS=${JSON.stringify(urls)};\nconst ALLOWED=new Set(ASSETS);\nself.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(ASSETS.map(url=>new Request(url,{cache:'reload'}))))));\nself.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('still-')&&key!==VERSION).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));\nself.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE')self.skipWaiting();});\nself.addEventListener('fetch',event=>{const request=event.request;const url=new URL(request.url);if(request.method!=='GET'||url.origin!==self.location.origin||url.search||url.pathname.startsWith('/api/'))return;const path=url.pathname==='/'?'/index.html':url.pathname;if(!ALLOWED.has(path))return;event.respondWith(caches.open(VERSION).then(cache=>cache.match(path).then(cached=>cached||fetch(request))));});\n`;
await writeFile(join(root, 'sw.js'), sw);
process.stdout.write(
  `Offline shell finalized: ${assets.length} static assets; ${hashes.size} CSP hashes.\n`,
);
