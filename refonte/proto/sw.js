/* LH Cards — service worker 177a4bdbb6 (généré) */
const V = 'lh-177a4bdbb6', SHELL = ["./","manifest.webmanifest","icon-192.png","icon-512.png","assets/Progres-CM33x3YE.css","assets/Progres-DLDhcS1t.js","assets/Revision-CQkupb_K.js","assets/Revision-mkmI0NDz.css","assets/Toeic-B6bvz4Dd.css","assets/Toeic-BFBpSow-.js","assets/index-24tjm0wZ.css","assets/index-DsSPX4CZ.js","assets/seed-B-WuoOk3.js"];
// installation : tout est mis en cache AVANT d'être utilisé ; pas de skipWaiting → la version en cours n'est jamais remplacée sous les pieds de l'élève
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('lh-') && k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
    const u = new URL(e.request.url);
    if (e.request.method !== 'GET' || u.origin !== location.origin) return;
    if (e.request.mode === 'navigate') { e.respondWith(caches.match('./', { cacheName: V }).then(r => r || fetch(e.request))); return; }
    e.respondWith(caches.match(e.request, { cacheName: V }).then(r => r || fetch(e.request)));
});
