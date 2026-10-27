/* LH Cards service worker: makes the app work offline. Version: 39c09d2f56 */
const CACHE = 'superanki-39c09d2f56';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('superanki-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.hostname.endsWith('supabase.co')) return;           // sync always goes to the network
    if (url.origin === location.origin && (url.pathname.endsWith('/sw.js') || url.pathname.endsWith('/version.json'))) return;   // always read live   // the update check reads the live file
    if (url.hostname === 'api.mymemory.translated.net') return;            // translations: always live, never cached
    const sameOrigin = url.origin === location.origin;
    if (sameOrigin && (req.mode === 'navigate' || url.pathname.endsWith('index.html'))) {
        // the network gets a short moment first (an unchanged page answers "304" almost at once): a new version opens straight away,
        // instead of the old copy being shown and then reloaded a few seconds later; offline or slow network: the cached copy
        e.respondWith(caches.match('./index.html').then(hit => {
            const net = fetch(req).then(res => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); } return res; });
            if (!hit) return net.catch(() => caches.match('./'));
            e.waitUntil(net.catch(() => {}));
            return Promise.race([net.then(res => (res && res.ok ? res : hit)).catch(() => hit), new Promise(r => setTimeout(() => r(hit), 1500))]);
        }));
        return;
    }
    // Léo's animation clips are big and never change under the same name: kept apart (an app update does not clear them), cached copy first
    if (sameOrigin && url.pathname.includes('/mascot/')) {
        e.respondWith(caches.open('lh-mascot').then(c => c.match(req).then(hit => hit || fetch(req).then(res => { if (res && res.ok) c.put(req, res.clone()); return res; }))));
        return;
    }
    // fonts and libraries: cached copy first, refreshed in the background
    e.respondWith(caches.match(req).then(hit => {
        const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; }).catch(() => hit);
        return hit || net;
    }));
});
