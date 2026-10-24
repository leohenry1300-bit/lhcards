/* Produit une vraie sauvegarde de l'application actuelle après des révisions simulées (sur plusieurs « jours »),
   pour tester la migration. Usage : node refonte/bench/export-legacy.js <fichier-sortie.json> */
const path = require('path'), http = require('http'), fs = require('fs');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '../..'), OUT = process.argv[2] || 'legacy-export.json';
const srv = http.createServer((q, r) => { const f = path.join(ROOT, q.url.split('?')[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
(async () => {
    await new Promise(r => srv.listen(8831, r));
    const b = await chromium.launch(), ctx = await b.newContext({ serviceWorkers: 'block' }), p = await ctx.newPage();
    await p.route(/fonts\.|supabase/, r => r.abort());
    await p.goto('http://localhost:8831/index.html'); await p.waitForSelector('.hero', { timeout: 60000 });
    const json = await p.evaluate(async () => {
        // 10 « jours » de révision : on décale l'horloge de l'appli pour produire un vrai historique (SM-2 et FSRS)
        const realNow = Date.now; let offset = 0; Date.now = () => realNow() + offset;
        const deckFsrs = app.data.decks[1];
        app.data.presets.push({ id: 'p_test_fsrs', name: 'FSRS', opts: { scheduler: 'fsrs' }, mod: 0 }); deckFsrs.preset = 'p_test_fsrs';
        for (let day = 0; day < 10; day++) {
            const due = app.data.cards.filter(c => c.state !== 'new' && c.due <= Date.now()).slice(0, 40);
            const fresh = app.data.cards.filter(c => c.state === 'new').slice(0, 15);
            for (const c of [...due, ...fresh]) {
                const g = Math.random() < 0.15 ? 1 : Math.random() < 0.1 ? 2 : 3;
                const prev = c.state, prevIvl = c.interval;   // même séquence que SuperAnki.answer()
                Object.assign(c, schedule(c, g, Date.now(), true, app.cfgFor(c)));
                c.reps++; c.lastReview = Date.now();
                app.logReview(c, g, prev === 'review' ? 1 : prev === 'relearning' ? 2 : 0, prevIvl, 5000);
            }
            offset += 86400000;
        }
        app.data.cards[3].suspended = true; app.data.cards[4].flag = 2;
        app.save(); await app.writeNow();
        Date.now = realNow;
        return app.serialize();
    });
    fs.writeFileSync(OUT, json);
    const d = JSON.parse(json);
    console.log('export', Math.round(json.length / 1024), 'Ko', d.cards.length, 'cartes', d.revlog.length, 'lignes de journal', d.cards.filter(c => c.fs).length, 'cartes FSRS');
    await b.close(); srv.close();
})();
