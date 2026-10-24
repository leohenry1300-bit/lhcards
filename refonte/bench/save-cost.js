/* Coût d'un enregistrement dans l'application actuelle avec un volume réaliste
   (≈ 3 700 cartes, 40 000 lignes d'historique), CPU ralenti x4. Usage : node refonte/bench/save-cost.js */
const path = require('path'), http = require('http'), fs = require('fs');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');
const srv = http.createServer((q, r) => { const f = path.join(ROOT, q.url.split('?')[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
(async () => {
    await new Promise(r => srv.listen(8830, r));
    const b = await chromium.launch(), ctx = await b.newContext({ serviceWorkers: 'block' }), p = await ctx.newPage();
    await p.route(/fonts\.|supabase/, r => r.abort());
    await p.goto('http://localhost:8830/index.html'); await p.waitForSelector('.hero', { timeout: 60000 });
    await p.evaluate(() => {   // complète jusqu'à un volume réaliste
        const c0 = app.data.cards, now = Date.now();
        for (let i = c0.length; i < 3700; i++) { const s = c0[i % c0.length]; c0.push({ ...s, id: 'x' + i, tags: [...s.tags], state: 'review', interval: 10, fs: { s: 10, d: 5, t: now }, lastReview: now }); }
        for (let i = 0; i < 40000; i++) app.data.revlog.push([now - i * 60000, c0[i % c0.length].id, 3, 1, 10, 5, 4200]);
        app.initSigs();
    });
    const cdp = await ctx.newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const r = await p.evaluate(async () => {
        const out = [];
        for (let k = 0; k < 5; k++) {
            const c = app.data.cards[k]; c.due += 1;          // une notation modifie une carte
            const t = performance.now(); app.save(); const a = performance.now() - t;
            const t2 = performance.now(); const json = app.serialize(); const s = performance.now() - t2;
            const t3 = performance.now(); await Storage.save(json); const w = performance.now() - t3;
            out.push({ detectChanges: Math.round(a), serialisation: Math.round(s), ecritureIDB: Math.round(w), Ko: Math.round(json.length / 1024) });
        }
        return out;
    });
    console.log(JSON.stringify(r));
    const res = JSON.parse(fs.readFileSync(path.join(__dirname, 'resultats.json'), 'utf8'));
    res.actuelle.enregistrementVolumeReel_cpu4 = r; fs.writeFileSync(path.join(__dirname, 'resultats.json'), JSON.stringify(res, null, 2));
    await b.close(); srv.close();
})();
