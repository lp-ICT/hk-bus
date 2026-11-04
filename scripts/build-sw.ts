import { readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = process.env.BASE_PATH || '/';
const assets = (await readdir('dist/assets')).map(name => `${base}assets/${name}`);
const files = ['/', '/share-qr.png', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png', ...assets].map(file => file.startsWith(base) ? file : `${base}${file.slice(1)}`);
const version = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 12);
await Bun.write('dist/sw.js', `const CACHE = 'bus-shell-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('bus-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
 const url = new URL(event.request.url);
 if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
 if (event.request.mode === 'navigate') { event.respondWith(fetch(event.request).catch(() => caches.match(${JSON.stringify(base)}))); return; }
 if (FILES.includes(url.pathname)) event.respondWith(caches.match(event.request).then(saved => saved || fetch(event.request)));
});
`);
console.log('PWA shell and icons precached; live ETA requests are never cached.');
