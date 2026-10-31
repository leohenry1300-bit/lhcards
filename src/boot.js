const app = new SuperAnki();
window.app = app;
app.init().catch(err => {
    console.error(err);
    const boot = document.getElementById('boot');
    if (boot) boot.innerHTML = `Oups, le chargement a échoué : ${esc(err.message)}. <br><button class="btn btn-primary" style="margin-top:12px" onclick="location.reload()">Recharger</button>`;
});

/* A new version is never applied by itself : the banner « Nouvelle version disponible » asks (Mettre à jour / Plus tard). It is checked
   a few seconds after opening, when coming back to the app, and every 15 minutes. */
setTimeout(() => { try { app.pdfGc(); app.pdfSyncAll(); } catch { /* ignore */ } }, 9000);
const lhCheckNew = async () => {
    try {
        if (!/^https?:/.test(location.protocol)) return;
        const meta = document.querySelector('meta[name=app-build]'), cur = meta ? Number(meta.content) : 0;
        const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return;
        const live = Number((await r.json()).build) || 0;
        if (cur && live && live > cur && app.updRefresh) { app._updReady = true; app.updRefresh(true); }
    } catch { /* offline: nothing to do */ }
};
setTimeout(lhCheckNew, 3500);
setInterval(lhCheckNew, 15 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(lhCheckNew, 800); });
