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

    /* 8. answers are grouped during a review (no full write after each one), and written when the session ends */
    const writes = await page.evaluate(async () => {
        await app.writeNow();
        let n = 0; const orig = Storage.save; Storage.save = function (...a) { n++; return orig.apply(this, a); };
        try {
            app.startSrsIds('test', app.data.cards.slice(0, 6).map(c => c.id));
            if (!app.session) return 'no session';
            for (let i = 0; i < 3 && app.session; i++) { app.reveal(); app.grade(3); await new Promise(r => setTimeout(r, 300)); }
            const during = n; app.endSession(false); await new Promise(r => setTimeout(r, 100));
            return { during, after: n };
        } finally { Storage.save = orig; }
    });
    ok('review: answers grouped, written at the end', writes.during === 0 && writes.after >= 1, JSON.stringify(writes));

    /* 9. Léo only says "mission accomplie" when nothing is left */
    const mood = await page.evaluate(() => { const h = new Date().getHours(), night = h >= 23 || h < 5; app.data.stats.lastStudyDate = dayKey(); return { left: app.mascotMood(12), none: app.mascotMood(0), night }; });
    ok('Léo: mood follows what is left to do', mood.left === (mood.night ? 'calm' : 'ready') && mood.none === (mood.night ? 'calm' : 'happy'), JSON.stringify(mood));

    /* 10. per-deck "à revoir" counts agree with the home screen (suspended / buried cards are not due) */
    const counts = await page.evaluate(() => {
        const cs = app.data.cards.slice(0, 6), now = Date.now();
        cs.forEach((c, i) => Object.assign(c, { state: 'review', interval: 3, due: now - 1000, suspended: i < 2, buriedUntil: i === 2 ? addDays(now, 1) : 0 }));
        const st = app.deckStats(), roots = app.data.decks.filter(d => !d.parent).reduce((a, d) => a + st.get(d.id).due, 0);
        return { decks: roots, home: app.countStatuses(app.data.cards).due };
    });
    ok('deck counts = home counts', counts.decks === counts.home, JSON.stringify(counts));

    /* 11. "remettre la progression à zéro" with a deck that has its own preset: the app keeps working */
    const reset = await page.evaluate(async () => {
        const conf = app.confirm; app.confirm = async () => true;
        try {
            app.addPack('anglais-bases'); app.migrateTunedPreset();
            await app.handleAction('reset-progress');
            app.renderDashboard(); app.startStudy('pk_g_anglais'); const s = !!app.session; app.endSession(false); return s;
        } catch (e) { return e.message; } finally { app.confirm = conf; }
    });
    ok('reset progress: home and review still work', reset === true, String(reset));
    await page.evaluate(() => app.writeNow());

    /* 12. a passing read error of the database never replaces the cards by the starter set */
    const nCards = await page.evaluate(() => app.data.cards.length);
    const failing = once => { const g = IDBObjectStore.prototype.get; let left = once ? 1 : 1e9; IDBObjectStore.prototype.get = function (k) { if (k === 'state' && left-- > 0) throw new DOMException('Connection to Indexed Database server lost', 'UnknownError'); return g.call(this, k); }; };
    const p2 = await ctx.newPage(); await p2.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
    await p2.addInitScript(failing, true); await p2.goto(`http://localhost:${PORT}/index.html`); await p2.waitForSelector('.hero', { timeout: 20000 });
    ok('database read error once: cards kept', (await p2.evaluate(() => app.data.cards.length)) === nCards);
    await p2.close();
    const p3 = await ctx.newPage(); await p3.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
    await p3.addInitScript(failing, false); await p3.goto(`http://localhost:${PORT}/index.html`); await wait(3500);
    const shown = await p3.evaluate(() => (document.getElementById('boot') || {}).textContent || ''); await p3.close();
    const p4 = await ctx.newPage(); await p4.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
    await p4.goto(`http://localhost:${PORT}/index.html`); await p4.waitForSelector('.hero', { timeout: 20000 });
    ok('database unreadable: message shown, nothing overwritten', /pas pu être lues/.test(shown) && (await p4.evaluate(() => app.data.cards.length)) === nCards, shown.slice(0, 80));
    await p4.close();

    /* 13. a new version opens at once (one launch, not the old copy then a reload) */
    {
        const c2 = await browser.newContext({ viewport: { width: 390, height: 800 } });
        await c2.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
        const q = await c2.newPage();
        await q.goto(`http://localhost:${PORT}/index.html`); await q.waitForSelector('.hero', { timeout: 20000 });
        await q.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()) && !!navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
        const next = Date.now() + 5e9, html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<meta name="app-build" content="\d+">/, `<meta name="app-build" content="${next}">`);
        await c2.route(/\/index\.html(\?|$)/, r => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
        await c2.route(/\/version\.json/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ build: next }) }));
        let navs = 0; q.on('framenavigated', f => { if (f === q.mainFrame()) navs++; });
        await q.reload(); await q.waitForSelector('.hero', { timeout: 20000 }); await wait(6000);
        const build = await q.evaluate(() => document.querySelector('meta[name=app-build]').content);
        ok('new version: opened directly, no second launch', navs === 1 && build === String(next), `navigations ${navs}, build ${build === String(next) ? 'new' : 'old'}`);
        await c2.close();
    }

    /* 14. course correction: cards already installed now say "market pull / technology push", progress kept */
    const pp = await page.evaluate(() => {
        const d = app.data.decks[0].id, now = Date.now();
        app.data.cards.push({ ...freshCard(), id: 'co_test_1', deckId: d, front: 'Market push et technology pull ?', back: 'MARKET PUSH', hint: '', detail: '', tags: [], created: now, nid: '', kind: 'basic', ord: 0, nf: null, state: 'review', interval: 12, reps: 4 });
        app.data.cards.push({ ...freshCard(), id: 'co_test_2', deckId: d, front: '', back: '', hint: '', detail: '', tags: [], created: now, nid: 'co_test_2n', kind: 'cloze', ord: 1, nf: { front: '', back: '', text: 'Approche {{c1::market push}} ou technology pull', extra: '' } });
        materializeCard(app.card('co_test_2'));
        app.data.settings.fixPushPullV1 = false; app.migratePushPull();
        const a = app.card('co_test_1'), c = app.card('co_test_2');
        return { a: a.front + ' / ' + a.back, keep: a.interval === 12 && a.reps === 4, c: c.nf.text, back: c.back };
    });
    ok('course fix: market pull / technology push, progress kept', pp.a === 'Market pull et technology push ? / MARKET PULL' && pp.keep && pp.c === 'Approche {{c1::market pull}} ou technology push' && /market pull/.test(pp.back), JSON.stringify(pp));

    /* 15. cloud backup (fake server): an old shared copy is taken in, encrypted under a new code and removed; another device gets everything back with the code */
    {
        const DB = new Map();
        DB.set('main', { updated_at: new Date().toISOString(), data: { decks: [{ id: 'dmain', name: 'DECK MAIN', emoji: '📁', mod: Date.now() }], cards: [{ id: 'cmain', deckId: 'dmain', front: 'Q main', back: 'R', mod: Date.now() }], settings: {}, updatedAt: Date.now() } });
        const fake = async route => {
            const req = route.request(), m = /id=eq\.([^&]+)/.exec(new URL(req.url()).search), row = m && DB.get(decodeURIComponent(m[1]));
            if (req.method() === 'GET') {
                if (/object\+json/.test(req.headers().accept || '')) return row ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(row) }) : route.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', message: '0 rows', details: '', hint: null }) });
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(row ? [row] : []) });
            }
            const b = JSON.parse(req.postData()); (Array.isArray(b) ? b : [b]).forEach(r => DB.set(r.id, { data: r.data, updated_at: r.updated_at }));
            return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
        };
        const device = async () => {
            const c = await browser.newContext({ viewport: { width: 390, height: 800 } });
            await c.route(/supabase\.co/, fake); await c.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
            const q = await c.newPage(); await q.goto(`http://localhost:${PORT}/index.html`); await q.waitForSelector('.hero', { timeout: 20000 });
            await q.evaluate(async () => { Object.assign(app.data.settings, { cloudSync: true, backupLegacy: true, backupAutoDone: true, syncKey: '' }); app.save(false); await Cloud.sync(); });
            return { c, q };
        };
        const A = await device();
        const a = await A.q.evaluate(() => ({ key: app.data.settings.syncKey, deck: app.data.decks.some(d => d.name === 'DECK MAIN'), banner: !!document.querySelector('.backup-banner code') }));
        const rows = [...DB.keys()].filter(k => k.startsWith('u_'));
        ok('backup: old copy taken in, encrypted under a code, shared copy removed', /^LHC(-[A-Z0-9]{4}){4}$/.test(a.key) && a.deck && a.banner && rows.length === 1 && !!DB.get(rows[0]).data.enc && !!DB.get('main').data.moved, JSON.stringify(a));
        const B = await device();
        const need = await B.q.evaluate(() => !!Cloud.needCode && !app.data.settings.syncKey);
        await B.q.evaluate(async k => { app.askText = async () => k.toLowerCase().replace(/-/g, ' '); await app.backupAction('bk-enter'); }, a.key);
        const got = await B.q.evaluate(() => app.data.decks.some(d => d.name === 'DECK MAIN'));
        ok('backup: other device asks for the code, then gets everything back', need && got, JSON.stringify({ need, got }));
        await A.c.close(); await B.c.close();
    }

    ok('no script error, no missing file', errs.length === 0, errs.slice(0, 4).join(' | '));
    console.log(R.join('\n') + `\n\n${R.length - failed}/${R.length} checks passed`);
    await browser.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(R.join('\n'), '\nCRASH', e); process.exit(2); });
