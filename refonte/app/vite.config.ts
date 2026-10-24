import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createHash } from 'node:crypto';

/** Génère sw.js avec la liste exacte des fichiers de la version (pré-cache) et un numéro de version = empreinte du contenu. */
function serviceWorker(): Plugin {
    return {
        name: 'lh-sw', apply: 'build',
        generateBundle(_, bundle) {
            const files = Object.keys(bundle).filter(f => !f.endsWith('.map'));
            const version = createHash('sha256').update(files.sort().join('|')).digest('hex').slice(0, 10);
            const shell = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', ...files.filter(f => f !== 'index.html')];
            this.emitFile({ type: 'asset', fileName: 'sw.js', source: `/* LH Cards — service worker ${version} (généré) */
const V = 'lh-${version}', SHELL = ${JSON.stringify(shell)};
// installation : tout est mis en cache AVANT d'être utilisé ; pas de skipWaiting → la version en cours n'est jamais remplacée sous les pieds de l'élève
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('lh-') && k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
    const u = new URL(e.request.url);
    if (e.request.method !== 'GET' || u.origin !== location.origin) return;
    if (e.request.mode === 'navigate') { e.respondWith(caches.match('./', { cacheName: V }).then(r => r || fetch(e.request))); return; }
    e.respondWith(caches.match(e.request, { cacheName: V }).then(r => r || fetch(e.request)));
});
` });
        }
    };
}

// base relative : le prototype s'ouvre depuis n'importe quel sous-dossier (GitHub Pages, serveur local)
export default defineConfig({
    base: './',
    plugins: [svelte(), serviceWorker()],
    build: { outDir: '../proto', emptyOutDir: true, target: 'safari16', modulePreload: { polyfill: false }, reportCompressedSize: true }
});
