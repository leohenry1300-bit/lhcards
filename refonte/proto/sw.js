/* LH Cards — service worker 1643277aad (généré) */
const V = 'lh-1643277aad', SHELL = ["./","manifest.webmanifest","icon-192.png","icon-512.png","assets/Progres-BqS1F4wu.js","assets/Progres-CM33x3YE.css","assets/Revision-mkmI0NDz.css","assets/Revision-sS0sd6vI.js","assets/Toeic-B6bvz4Dd.css","assets/Toeic-Duzc2Ul0.js","assets/index-BOul7O7j.css","assets/index-SryzM5NF.js","assets/seed-BdvD-X3b.js"];
// installation : tout est mis en cache AVANT d'être utilisé ; pas de skipWaiting → la version en cours n'est jamais remplacée sous les pieds de l'élève
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('lh-') && k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
    const u = new URL(e.request.url);
    if (e.request.method !== 'GET' || u.origin !== location.origin) return;
    if (e.request.mode === 'navigate') { e.respondWith(caches.match('./', { cacheName: V }).then(r => r || fetch(e.request))); return; }
    e.respondWith(caches.match(e.request, { cacheName: V }).then(r => r || fetch(e.request)));
});
