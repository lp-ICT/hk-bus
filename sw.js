const CACHE = 'bus-shell-5848ec45612b';
const FILES = ["/","/share-qr.png","/school-crest.png","/manifest.webmanifest","/icons/icon-192.png","/icons/icon-512.png","/icons/maskable-512.png","/icons/apple-touch-icon.png","/assets/index-CmQyQrpO.css","/assets/index-B987JMM9.js","/assets/journey-worker-DkTA9jzi.js","/bus-data/gmb-network.json","/bus-data/mtr-network.json","/bus-data/resident-network.json","/bus-data/kmb-routes.json","/bus-data/kmb-stops.json","/bus-data/kmb-route-stops.json","/bus-data/ctb-routes.json","/bus-data/journey-times.json"];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('bus-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
 const url = new URL(event.request.url);
 if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
 if (event.request.mode === 'navigate') { event.respondWith(fetch(event.request, { cache: 'reload' }).catch(() => caches.match("/"))); return; }
 if (FILES.includes(url.pathname)) event.respondWith(caches.match(event.request).then(saved => saved || fetch(event.request)));
});
