const CACHE = 'bus-shell-e0f8a414b278';
const FILES = ["/hk-bus/","/hk-bus/share-qr.png","/hk-bus/school-crest.png","/hk-bus/manifest.webmanifest","/hk-bus/icons/icon-192.png","/hk-bus/icons/icon-512.png","/hk-bus/icons/maskable-512.png","/hk-bus/icons/apple-touch-icon.png","/hk-bus/assets/index-CjVU6Lbi.css","/hk-bus/assets/index-lzIHmnh7.js","/hk-bus/bus-data/gmb-network.json","/hk-bus/bus-data/kmb-routes.json","/hk-bus/bus-data/kmb-stops.json","/hk-bus/bus-data/kmb-route-stops.json","/hk-bus/bus-data/ctb-routes.json"];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('bus-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
 const url = new URL(event.request.url);
 if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
 if (event.request.mode === 'navigate') { event.respondWith(fetch(event.request).catch(() => caches.match("/hk-bus/"))); return; }
 if (FILES.includes(url.pathname)) event.respondWith(caches.match(event.request).then(saved => saved || fetch(event.request)));
});
