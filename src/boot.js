const app = new SuperAnki();
window.app = app;
app.init().catch(err => {
    console.error(err);
    const boot = document.getElementById('boot');
    if (boot) boot.innerHTML = `Oups, le chargement a échoué : ${esc(err.message)}. <br><button class="btn btn-primary" style="margin-top:12px" onclick="location.reload()">Recharger</button>`;
});

/* Updates are applied while the loading screen is up (see checkUpdateEarly in app.js). Once the app is open it is never restarted by itself:
   if a newer build shows up later (app left open for a long time), only the "new version" banner is offered. */
setTimeout(async () => {
    try {
        if (!/^https?:/.test(location.protocol)) return;
        const meta = document.querySelector('meta[name=app-build]'), cur = meta ? Number(meta.content) : 0;
        const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return;
        const live = Number((await r.json()).build) || 0;
        if (cur && live && live > cur && app.updRefresh) app.updRefresh(true);
    } catch { /* offline: nothing to do */ }
}, 6000);
