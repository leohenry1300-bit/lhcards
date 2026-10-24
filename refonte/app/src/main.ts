import './styles/tokens.css';
import './styles/base.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { app } from './state.svelte.ts';

const t0 = performance.now();
mount(App, { target: document.getElementById('app')! });
app.load().then(ms => {
    performance.mark('lh-ready');
    (window as any).__lhBoot = { loadMs: Math.round(ms), readyMs: Math.round(performance.now()) , mountMs: Math.round(performance.now() - t0) };
}).catch(err => {
    document.getElementById('app')!.insertAdjacentHTML('beforeend', `<p style="padding:24px">Impossible d'ouvrir tes données : ${String(err?.message ?? err)}. Rien n'a été effacé.</p>`);
});

/* Mises à jour : la nouvelle version s'installe en arrière-plan et ATTEND. Elle s'applique au prochain
   lancement (quand l'appli a été fermée), jamais pendant l'utilisation : pas de rechargement surprise. */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
}
