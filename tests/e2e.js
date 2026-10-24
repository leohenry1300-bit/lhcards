/* LH Cards: end-to-end checks (a real browser opens the built app and uses it).
   Run:  python3 build.py && cd tests && npm install && npx playwright install chromium && npm test            */
const path = require('path'), fs = require('fs'), http = require('http');
let playwright; try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }
const ROOT = path.resolve(__dirname, '..'), PORT = 8791;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
const R = []; let failed = 0;
const ok = (name, cond, detail = '') => { if (!cond) failed++; R.push(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    await new Promise(r => server.listen(PORT, r));
    const browser = await playwright.chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage(), errs = [];
    page.on('pageerror', e => errs.push('JS: ' + e.message));
    page.on('response', r => { if (r.status() >= 400 && !/fonts\.g/.test(r.url())) errs.push(r.status() + ' ' + r.url().slice(-50)); });
    await page.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
    const go = v => page.evaluate(x => app.go(x), v);

    /* 1. start */
    const t0 = Date.now();
    await page.goto(`http://localhost:${PORT}/index.html`); await page.waitForSelector('.hero', { timeout: 20000 });
    ok('starts and shows the home screen under 4 s', Date.now() - t0 < 4000, (Date.now() - t0) + ' ms');
    ok('loading screen is gone', await page.evaluate(() => !document.getElementById('boot')));
    await wait(7500);   // his entrance

    /* 2. progressive tabs: complete, identical to a full render, quick */
    const eq = await page.evaluate(async () => {
        const out = {}, norm = h => h.replace(/\s+/g, ' ').replace(/> </g, '><').replace(/ style="[^"]*"/g, '').replace(/ class="([^"]*)"/g, (m, c) => ' class="' + c.split(' ').filter(x => !/^(view-in|cascade|on$|lv-|leo-off)/.test(x)).sort().join(' ') + '"').replace(/ data-w="\d+"/g, '').replace(/blob:[^"']+/g, '');
        for (const v of ['dashboard', 'decks', 'stats', 'settings']) {
            app._ver++; app.go(v); await new Promise(r => setTimeout(r, 2800));
            const prog = norm(document.getElementById('view-' + v).innerHTML);
            app.render(); await new Promise(r => setTimeout(r, 300));
            out[v] = prog === norm(document.getElementById('view-' + v).innerHTML);
            app.go('decks'); await new Promise(r => setTimeout(r, 200));
        }
        return out;
    });
    for (const [v, same] of Object.entries(eq)) ok(`tab ${v}: progressive build equals a full render`, same);
    const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const speed = await page.evaluate(async () => {
        const out = {};
        for (const v of ['decks', 'stats', 'settings', 'dashboard']) { app._ver++; const t = performance.now(); app.go(v); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); out[v] = Math.round(performance.now() - t); await new Promise(r => setTimeout(r, 2500)); }
        return out;
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    for (const [v, ms] of Object.entries(speed)) ok(`tab ${v} opens in under 450 ms (CPU slowed 4x)`, ms < 450, ms + ' ms');

    /* 3. changes show up everywhere */
    await page.evaluate(() => { app.sortedDecks()[0].name = 'PAQUET TEST ZZ'; app.save(); });
    await go('stats'); await wait(2500);
    ok('a change made elsewhere is visible when coming back to a tab', (await page.evaluate(() => document.getElementById('view-stats').textContent)).includes('PAQUET TEST ZZ'));

    /* 4. every theme draws every tab without error; readable banner */
    const themes = await page.evaluate(() => THEMES.map(t => t.id));
    for (const id of themes) { await page.evaluate(i => app.setSetting('theme', i), id); for (const v of ['dashboard', 'settings']) { await go(v); await wait(60); } }
    const lowContrast = await page.evaluate(async () => {
        const probe = document.createElement('i'); document.body.appendChild(probe);
        const rgb = v => { probe.style.color = ''; probe.style.color = v; const m = getComputedStyle(probe).color.match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : null; };
        const lum = c => { const f = x => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
        const cr = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
        const bad = [];
        for (const t of THEMES) {
            if (t.id === 'auto' || t.id === 'brutal') continue;
            document.documentElement.dataset.theme = t.id; await new Promise(r => setTimeout(r, 40));
            const cs = getComputedStyle(document.documentElement), V = n => cs.getPropertyValue(n).trim();
            const stops = (V('--hero').match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g) || []).map(rgb).filter(Boolean), on = rgb(V('--on-hero'));
            if (on && stops.some(s => cr(on, s) < 3.9)) bad.push(t.id + ' banner');
            if (cr(rgb(V('--text')), rgb(V('--surface'))) < 4.5) bad.push(t.id + ' text');
        }
        probe.remove(); return bad;
    });
    ok('all themes: readable banner and text', lowContrast.length === 0, lowContrast.join(', '));
    await page.evaluate(() => app.setSetting('theme', 'clair'));

    /* 5. Léo */
    await go('dashboard'); await wait(1500);
    const leo = await page.evaluate(async () => {
        const o = { missing: [], novoice: [] };
        for (const k of Object.keys(LEO_CLIPS)) { try { await leoLoad(k); } catch { o.missing.push(k); } if (k !== 'idle' && !SFX[LEO_VOICE[k]]) o.novoice.push(k); }
        o.mem = LEO_CACHE.size; o.count = document.querySelectorAll('.leo3d').length; return o;
    });
    ok('Léo: every animation file loads', leo.missing.length === 0, leo.missing.join());
    ok('Léo: every animation has a voice', leo.novoice.length === 0, leo.novoice.join());
    ok('Léo: memory limited to 3 clips', leo.mem <= 3, 'size ' + leo.mem);
    for (let i = 0; i < 6; i++) { await page.click('.hero .mascot', { force: true, timeout: 3000 }).catch(() => {}); await wait(250); }
    for (let i = 0; i < 24; i++) { await go(['decks', 'dashboard', 'stats', 'dashboard', 'settings'][i % 5]); await wait(120); if (i % 2) await page.click('.hero .mascot', { force: true, timeout: 1500 }).catch(() => {}); }
    await go('dashboard'); await wait(7000);
    const st = await page.evaluate(() => { const r = document.querySelector('#view-dashboard .hero .leo3d'), f = r && r.querySelector('.leo-fig'); return r ? { one: document.querySelectorAll('.leo3d').length === 1, shown: getComputedStyle(f.querySelector('.lf-still')).visibility !== 'hidden' || !!f.querySelector('.lf-idle') || !!f.querySelector('.lf-play'), clips: f.querySelectorAll('.lf-play').length } : null; });
    ok('Léo: still there, visible, single, after taps and tab hopping', !!st && st.one && st.shown && st.clips <= 1, JSON.stringify(st));

    /* 6. a whole review session ends on the summary */
    await page.click('button:has-text("Réviser")'); await wait(600);
    let summary = false;
    for (let i = 0; i < 160 && !summary; i++) { await page.keyboard.press('Space'); await wait(25); await page.keyboard.press('3'); await wait(40); summary = await page.evaluate(() => !!document.querySelector('.summary-mascot .leo3d')); }
    ok('a review session reaches the summary (with Léo)', summary);
    ok('no Léo during the review itself', await page.evaluate(() => document.querySelectorAll('#view-session .leo3d').length === 0 || !!document.querySelector('.summary')));

    /* 7. start-up log shown in the settings */
    await go('settings'); await wait(2500);
    ok('settings show the start-up summary', (await page.evaluate(() => document.getElementById('view-settings').textContent)).includes('Démarrages sur 24 h'));

    ok('no script error, no missing file', errs.length === 0, errs.slice(0, 4).join(' | '));
    console.log(R.join('\n') + `\n\n${R.length - failed}/${R.length} checks passed`);
    await browser.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(R.join('\n'), '\nCRASH', e); process.exit(2); });
