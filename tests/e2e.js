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


    /* 0. DECISION (user): the loading bar fills up completely before the app opens; the loading screen lasts about 1.4 s */
    {
        const lp = await ctx.newPage();
        await lp.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
        await lp.addInitScript(() => {
            window.__boot = { gone: 0, last: '', t100: 0 };
            const t0 = performance.now();
            const iv = setInterval(() => {
                const b = document.querySelector('#boot .boot-bar span');
                if (b) { window.__boot.last = b.style.width; if (b.style.width === '100%' && !window.__boot.t100) window.__boot.t100 = Math.round(performance.now() - t0); }
                else if (document.getElementById('view-dashboard') && !document.getElementById('boot')) { window.__boot.gone = Math.round(performance.now() - t0); clearInterval(iv); }
            }, 20);
        });
        await lp.goto(`http://localhost:${PORT}/index.html`); await lp.waitForSelector('.hero', { timeout: 20000 });
        const bt = await lp.evaluate(() => window.__boot);
        ok('loading bar reaches 100 % and stays full about half a second before the app opens', bt.last === '100%' && bt.t100 > 0 && bt.gone - bt.t100 >= 500, JSON.stringify(bt));
        await lp.close();
    }


    /* 0b. DECISION: an update is applied behind the loading screen; the app never restarts by itself once it is open */
    {
        const up = await ctx.newPage(); let navs = 0, afterOpen = 0, opened = false;
        await up.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
        await up.route('**/version.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ build: 99999999999999 }) }));
        up.on('framenavigated', f => { if (f === up.mainFrame()) { navs++; if (opened) afterOpen++; } });
        await up.goto(`http://localhost:${PORT}/index.html`);
        for (let i = 0; i < 60 && !opened; i++) { await wait(250); opened = await up.evaluate(() => !!document.querySelector('.hero') && !document.getElementById('boot')).catch(() => false); }
        const before = afterOpen; await wait(7000);
        ok('new version found: reloads once behind the loading screen, never after the app is open', opened && navs <= 2 && afterOpen === before && afterOpen === 0, JSON.stringify({ navs, afterOpen, opened }));
        await up.close();
    }

    /* 1. start */
    const t0 = Date.now();
    await page.goto(`http://localhost:${PORT}/index.html`); await page.waitForSelector('.hero', { timeout: 20000 });
    ok('starts and shows the home screen under 4 s', Date.now() - t0 < 4000, (Date.now() - t0) + ' ms');
    await wait(2500);
    ok('Léo greets on opening (sit wave, paw wave or hello without tablet)', await page.evaluate(() => { const r = document.querySelector('.hero .leo3d'); return !!r && (r._leoHist || []).some(k => ['sitwave', 'wave', 'hello0'].includes(k)); }));
    ok('loading screen is gone', await page.evaluate(() => !document.getElementById('boot')));
    await wait(7500);   // his entrance

    /* 2. progressive tabs: complete, identical to a full render, quick */
    const eq = await page.evaluate(async () => {
        /* Léo and what he says change by themselves (random greeting, clips, speech): they are not part of the page structure that is compared */
        const snap = el => { const c = el.cloneNode(true); c.querySelectorAll('.leo3d, .leo-bubble').forEach(x => x.remove()); c.querySelectorAll('.hero-sub').forEach(x => { if (x.dataset.orig) x.innerHTML = x.dataset.orig; x.classList.remove('speaking'); delete x.dataset.orig; }); return c.innerHTML; };
        const out = {}, norm = h => h.replace(/\s+/g, ' ').replace(/> </g, '><').replace(/ style="[^"]*"/g, '').replace(/ class="([^"]*)"/g, (m, c) => ' class="' + c.split(' ').filter(x => !/^(view-in|cascade|on$|lv-|leo-off)/.test(x)).sort().join(' ') + '"').replace(/ data-w="\d+"/g, '').replace(/ data-(intro|state|live|hold)="[^"]*"/g, '')   // (Léo's random greeting is not part of the page structure).replace(/blob:[^"']+/g, '');
        for (const v of ['dashboard', 'decks', 'stats', 'settings']) {
            app._ver++; app.go(v); await new Promise(r => setTimeout(r, 2800));
            const prog = norm(snap(document.getElementById('view-' + v)));
            app.render(); await new Promise(r => setTimeout(r, 300));
            out[v] = prog === norm(snap(document.getElementById('view-' + v)));
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
        await wait(600);
        const a = await A.q.evaluate(() => ({ key: app.data.settings.syncKey, deck: app.data.decks.some(d => d.name === 'DECK MAIN'), banner: ((document.querySelector('.modal #bk-code') || {}).textContent || '') === app.data.settings.syncKey }));
        const rows = [...DB.keys()].filter(k => k.startsWith('u_'));
        ok('backup: old copy taken in, encrypted under a code, shared copy removed', /^LHC(-[A-Z0-9]{4}){4}$/.test(a.key) && a.deck && a.banner && rows.length === 1 && !!DB.get(rows[0]).data.enc && !!DB.get('main').data.moved, JSON.stringify(a));
        const B = await device();
        const need = await B.q.evaluate(() => !!Cloud.needCode && !app.data.settings.syncKey);
        await B.q.evaluate(async k => { app.askText = async () => k.toLowerCase().replace(/-/g, ' '); await app.backupAction('bk-enter'); }, a.key);
        const got = await B.q.evaluate(() => app.data.decks.some(d => d.name === 'DECK MAIN'));
        ok('backup: other device asks for the code, then gets everything back', need && got, JSON.stringify({ need, got }));
        await A.c.close(); await B.c.close();

        /* 17. cloud backup off by default; Réglages > Données switch: the code is shown, nothing starts before "J'ai noté mon code" is ticked */
        const C = await browser.newContext({ viewport: { width: 390, height: 800 } });
        await C.route(/supabase\.co/, fake); await C.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
        const q = await C.newPage(); await q.goto(`http://localhost:${PORT}/index.html`); await q.waitForSelector('.hero', { timeout: 20000 }); await wait(1500);
        const rows0 = DB.size, off = await q.evaluate(() => !app.data.settings.cloudSync && !app.data.settings.syncKey);
        const flip = on => q.evaluate(v => { const el = document.querySelector('[data-input="backup-toggle"]'); el.checked = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, on);
        await q.evaluate(() => { app.go('settings'); app.flushTail(document.getElementById('view-settings'), true); });
        await flip(true); await wait(300);
        const cancel = await q.evaluate(() => { const shown = /^LHC-/.test((document.querySelector('#bk-code') || {}).textContent || ''), locked = document.querySelector('#bk-ok').disabled; app.closeModal(); return { shown, locked, still: !app.data.settings.cloudSync && !document.querySelector('[data-input="backup-toggle"]').checked }; });
        await flip(true); await wait(300);
        const code = await q.evaluate(() => document.querySelector('#bk-code').textContent);
        await q.click('#bk-noted'); await q.click('#bk-ok'); await wait(2500);
        const on = await q.evaluate(c => ({ sync: app.data.settings.cloudSync, same: app.data.settings.syncKey === c, sw: document.querySelector('[data-input="backup-toggle"]').checked }), code);
        const sent = [...DB.keys()].filter(k => k.startsWith('u_')).length > rows0 - 1 && DB.size > rows0;
        await flip(false); await wait(200);
        const offAgain = await q.evaluate(() => !app.data.settings.cloudSync && !!app.data.settings.syncKey);
        ok('backup off by default; switch shows the code, needs "noté", then sends an encrypted copy; can be switched off', off && cancel.shown && cancel.locked && cancel.still && on.sync && on.same && on.sw && sent && offAgain, JSON.stringify({ off, cancel, on, sent, offAgain }));
        await C.close();
    }

    /* 16. scheduling, checked against Anki's own rules (rslib): early review, fuzz range, "Difficile" on a single step, review cap, optimizer guard */
    const sch = await page.evaluate(async () => {
        const now = Date.now(), DAY = 864e5, sm2 = buildCfg({ ...OPT_DEFAULTS }), out = {};
        const early = schedule({ state: 'review', step: 0, interval: 30, ease: 2.5, due: addDays(now, 29), lapses: 0, lastReview: now - DAY, fs: null }, 3, now, true, sm2);
        out.early = early.interval;
        const onTime = schedule({ state: 'review', step: 0, interval: 30, ease: 2.5, due: now - 1000, lapses: 0, lastReview: now - 30 * DAY, fs: null }, 3, now, false, sm2);
        out.onTime = onTime.interval;
        let outside = 0;
        for (let i = 0; i < 300; i++) { const m = new Map(); for (let d = 0; d < 10; d++) m.set(startOfDay(addDays(now, d)), Math.floor(Math.random() * 30)); SCHED_LOAD = i % 2 ? m : null; const v = spreadIvl(3, now, '0000000', 36500); if (v < 2 || v > 4) outside++; }
        SCHED_LOAD = null; out.fuzzOutside = outside;
        const h = schedule({ state: 'new', step: 0, interval: 0, ease: 2.5, due: now, lapses: 0, lastReview: null, fs: null }, 2, now, false, buildCfg({ ...OPT_DEFAULTS, learnSteps: '10' }));
        out.hardMin = Math.round((h.due - now) / 6e4);
        const st = app.data.settings; st.reviewCapV1 = false; st.maxReviews = 9999; app.migrateReviewCap(); out.cap = st.maxReviews;
        const d = app.data.decks.find(x => !x.parent).id, made = [];
        for (let i = 0; i < 260; i++) { const id = 'cap_' + i; made.push(id); app.data.cards.push({ ...freshCard(), id, deckId: d, front: 'q' + i, back: 'r', hint: '', detail: '', tags: [], created: now, nid: '', kind: 'basic', ord: 0, nf: null, state: 'review', interval: 5, due: now - i * 1000 - DAY, lastReview: now - 6 * DAY }); }
        app.data.stats.revSeen = { date: dayKey(), count: 0, by: {} }; app.data.stats.newSeen = { date: dayKey(), count: 0, by: {} };
        const plan = app.studyPlan(null); out.planReviews = plan.reviews.length; out.planNew = plan.news.length;
        app.data.cards = app.data.cards.filter(c => !made.includes(c.id)); app.save();
        const fake = []; for (let c = 0; c < 40; c++) for (let k = 0; k < 6; k++) fake.push([now - (60 - k * 9) * DAY + c, 'opt' + c, k === 3 ? 1 : 3, 1]);
        const r = await fsrsTrain(fsrsSequences(fake), null); out.optSmall = !!r.small;
        return out;
    });
    ok('SM-2 early review as in Anki (30 j card seen yesterday stays 30 j; on time still 75 j)', sch.early === 30 && sch.onTime === 75, JSON.stringify({ early: sch.early, onTime: sch.onTime }));
    ok('fuzz + load balancing stay inside Anki\'s range', sch.fuzzOutside === 0, String(sch.fuzzOutside));
    ok('"Difficile" on a single 10 min step = 15 min (Anki)', sch.hardMin === 15, String(sch.hardMin));
    ok('review cap 200 (old default migrated), backlog first, no new cards on top', sch.cap === 200 && sch.planReviews === 200 && sch.planNew === 0, JSON.stringify(sch));
    ok('optimizer: too few reviews to check -> standard parameters kept', sch.optSmall);

    /* 19. exam plan: predicted mastery on the exam day, today's cards (most fragile first, spread over the days left), last round the day before */
    const plan = await page.evaluate(async () => {
        const st = app.data.settings, keep = st.goals, out = {}, iso = n => dayKey(addDays(Date.now(), n));
        const deck = 'geo', cards = app.poolFor([deck]); cards.forEach(c => Object.assign(c, { ...freshCard(), state: 'new' }));
        const seenN = Math.min(6, cards.length - 1); cards.slice(0, seenN).forEach((c, i) => Object.assign(c, { state: 'review', interval: 4 + i, ease: 2.5, due: Date.now() + 864e5, lastReview: Date.now() - 864e5 * (1 + i), reps: 3 }));
        st.goals = [{ id: 'gx', name: 'Partiel test', date: iso(10), decks: [deck] }]; st.homeOpen = { ...(st.homeOpen || {}), goals: true };
        app.go('dashboard'); app.renderDashboard();
        const P = app.examPlan(app.goalsAll()[0]);
        out.n = cards.length; out.mastery = Math.round(P.mastery * 100); out.quota = P.quota; out.todo = P.todo.length;
        const row = document.querySelector('.exam-row'); out.text = row ? row.textContent.replace(/\s+/g, ' ') : '';
        document.querySelector('[data-action="exam-plan"][data-mode="plan"]').click(); await new Promise(r => setTimeout(r, 200));
        out.session = app.session ? { kind: app.session.kind, n: app.session.queue.length + 1 } : null; app.endSession(false);
        st.goals = [{ id: 'gx', name: 'Partiel test', date: iso(1), decks: [deck] }]; app.renderDashboard();
        document.querySelector('[data-action="exam-plan"][data-mode="last"]').click(); await new Promise(r => setTimeout(r, 200));
        out.last = app.session ? { kind: app.session.kind, n: app.session.queue.length + 1, anyNew: app.session.queue.concat(app.session.current ? [app.session.current] : []).some(id => app.card(id).state === 'new') } : null; app.endSession(false);
        st.goals = [{ id: 'gx', name: 'Partiel test', date: iso(0), decks: [deck] }]; app.renderDashboard();
        out.examDayBtn = !!document.querySelector('[data-action="exam-plan"]');
        st.goals = keep; app.renderDashboard();
        out.seenN = seenN;
        return out;
    });
    ok('exam plan: mastery shown, today\'s share of fragile cards reviewed normally, last round the day before', plan.mastery < 0.5 * 100 && plan.quota === Math.ceil(plan.n / 9) && plan.todo === plan.quota && /Maîtrise prévue le jour J : \d+ %/.test(plan.text) && plan.session && plan.session.kind === 'srs' && plan.session.n === plan.quota && plan.last && plan.last.kind === 'practice' && plan.last.n === Math.min(40, plan.seenN) && !plan.last.anyNew && !plan.examDayBtn, JSON.stringify({ ...plan, text: plan.text.slice(0, 120) }));

    /* 21. unfolding a deck on the home screen only redraws the list of decks, and the tapped control stays where it was */
    const anchor = await page.evaluate(async () => {
        PACKS.forEach(x => app.addPack(x.id)); app.go('dashboard'); await new Promise(r => setTimeout(r, 2800)); app.renderDashboard();
        const t = document.querySelector('#dash-decks .sub-toggle'); if (!t) return { skip: true };
        const q = `#dash-decks .sub-toggle[data-deck="${t.dataset.deck}"]`, hero = document.querySelector('.hero');
        t.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 200));
        const t0 = Math.round(document.querySelector(q).getBoundingClientRect().top);
        document.querySelector(q).click(); await new Promise(r => setTimeout(r, 300));
        const out = { moved: Math.round(document.querySelector(q).getBoundingClientRect().top) - t0, sameHero: hero === document.querySelector('.hero'), opened: !!document.querySelector(q).closest('.deck-card').querySelector('.sub-tree') };
        document.querySelector(q).click(); await new Promise(r => setTimeout(r, 200)); return out;
    });
    ok('home: unfolding a deck keeps the button in place and does not redraw the banner', anchor.skip || (Math.abs(anchor.moved) <= 2 && anchor.sameHero && anchor.opened), JSON.stringify(anchor));

    /* clock change: the day always starts at 4 h, and "tomorrow" is 4 h tomorrow, also on the two days a year when the clock moves */
    {
        const cp = await (await browser.newContext({ timezoneId: 'Europe/Paris' })).newPage();
        await cp.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
        await cp.goto(`http://localhost:${PORT}/index.html`); await cp.waitForSelector('.hero', { timeout: 15000 });
        const dst = await cp.evaluate(() => {
            const h = t => new Date(t).getHours(), d = (y, m, dd, hh) => new Date(y, m, dd, hh).getTime();
            return [h(startOfDay(d(2026, 2, 29, 12))), h(addDays(d(2026, 2, 28, 10), 1)), h(startOfDay(d(2026, 9, 25, 12))), h(addDays(d(2026, 9, 24, 10), 1)), dayKey(d(2026, 2, 29, 4)), dayKey(d(2026, 2, 29, 3, 30))];
        });
        ok('clock change (Paris): the day starts at 4 h and due dates fall at 4 h', JSON.stringify(dst) === JSON.stringify([4, 4, 4, 4, '2026-03-29', '2026-03-28']), JSON.stringify(dst));
        await cp.context().close();
    }
    /* Léo: a scene always ends with his tablet back, even when a clip cannot load; no coffee at night; he says hello */
    {
        await go('dashboard'); await wait(800);
        const sc = await page.evaluate(async () => {
            const r = document.querySelector('.hero .leo3d'); r._leoBusy = 0; r.classList.remove('lv-clip');
            if (r.dataset.state !== 's1') leoSetState(r, 's1');
            const saved = LEO_CLIPS.aha0.f; LEO_CLIPS.aha0.f = 'mascot/does-not-exist.webp';
            const ok = await leoScene(r, 'aha0'); LEO_CLIPS.aha0.f = saved;
            await new Promise(x => setTimeout(x, 500));
            const real = Date.prototype.getHours; Date.prototype.getHours = () => 2;
            const night = leoClipFor(r, 'ready', 'Un lion ne chasse pas sans café ☕'); Date.prototype.getHours = () => 9;
            const day = leoClipFor(r, 'ready', 'Un lion ne chasse pas sans café ☕'); Date.prototype.getHours = real;
            return { ok, state: r.dataset.state, clip: r.classList.contains('lv-clip'), night, day };
        });
        for (let i = errs.length - 1; i >= 0; i--) if (/does-not-exist/.test(errs[i])) errs.splice(i, 1);   // (the missing file is the point of this test)
        ok('Léo: a scene with a clip that cannot load ends with his tablet back', sc.state === 's1' && !sc.clip, JSON.stringify(sc));
        ok('Léo: coffee only by day', sc.night !== 'scene:coffee' && sc.day === 'scene:coffee', `${sc.night} / ${sc.day}`);
        await wait(2500);
        const hi = await page.evaluate(async () => { app.mascotHello(); await new Promise(x => setTimeout(x, 2200)); const t = (document.querySelector('.hero-sub') || {}).textContent || ''; return t; });
        ok('Léo says hello in his bubble', /Bonjour|Bonsoir|Coucou/.test(hi), hi.slice(0, 50));
        await page.evaluate(() => { window.__hellos = 0; const f = app.mascotHello; app.mascotHello = function () { window.__hellos++; return f.apply(this, arguments); }; });
        await go('settings'); await wait(300); await go('dashboard'); await wait(2500);
        const hellos = await page.evaluate(() => window.__hellos);
        ok('Léo does not say hello again when coming back to the home page', hellos === 0, String(hellos));
    }
    /* undo: the cancelled answer is not counted twice (counters, "d'affilée" run, history, day totals) */
    {
        const u = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms));
            a.clearResume(); a.startStudy(null); await w(600);
            const snap = () => ({ done: a.session.done, run: a.session.run || 0, best: a.session.bestRun || 0, today: a.data.stats.history[dayKey()] || 0, log: a.data.revlog.length });
            const answer = async () => { a.reveal(); await w(150); a.grade(3); await w(700); };
            for (let i = 0; i < 4; i++) await answer();
            const before = snap(); await answer(); const after = snap();
            a.undo(); await w(300); const undone = snap();
            await answer(); const again = snap();
            a.endSession(false); a.session = null; a.go('dashboard');
            return { before, after, undone, again };
        });
        const { before: b, after: af, undone: un, again: ag } = u;
        ok('undo: the answer and the "d\'affilée" run go back, then count once', JSON.stringify(un) === JSON.stringify(b) && af.run === b.run + 1 && ag.run === af.run && ag.done === af.done && ag.today === af.today && ag.log === af.log, JSON.stringify(u));
    }
    /* going back after burying a card: the buried card does not come back */
    {
        const bu = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms));
            a.clearResume(); a.startStudy(null); await w(600);
            a.reveal(); await w(150); a.grade(3); await w(700);          // card 1 answered
            const buried = a.session.current; a.opBury([buried], false); await w(300);   // card 2 put away until tomorrow
            a.undo(); await w(300);                                       // back: card 1
            const inQueue = a.session.queue.includes(buried) || a.session.current === buried;
            a.reveal(); await w(150); a.grade(3); await w(700);
            const next = a.session.current; a.endSession(false); a.session = null; a.go('dashboard');
            a.card(buried).buriedUntil = 0;
            return { inQueue, backAgain: next === buried };
        });
        ok('going back after burying a card: the buried card does not come back', !bu.inQueue && !bu.backAgain, JSON.stringify(bu));
    }
    /* the recap at the end of a review counts the whole day, not only the last session */
    {
        const rc = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), t0 = startOfDay(), before = a.data.revlog.filter(r => r[0] >= t0).length;
            const ids = a.data.cards.slice(0, 3).map(c => c.id);
            ids.forEach((id, i) => a.data.revlog.push([t0 + 1000 + i, id, 3, 1, 5, 4, 2000]));   // 3 answers given earlier today
            a.clearResume(); a.startStudy(null); await w(600);
            for (let i = 0; i < 2; i++) { a.reveal(); await w(150); a.grade(3); await w(700); }
            a.showSummary(); await w(300);
            const n = (document.querySelector('.summary-stats .panel b') || {}).textContent;
            const note = (document.querySelector('.summary .page-sub') || {}).textContent || '';
            a.session = null; a.go('dashboard'); document.body.classList.remove('in-session');
            return { n, note, want: String(before + 5) };
        });
        ok('recap counts all the answers of the day', rc.n === rc.want && /dont 2 dans cette session/.test(rc.note), JSON.stringify(rc));
    }
    /* a new card put away until tomorrow counts as one of the day's new cards (5 a day: 2 put away = 3 left, not 5 again) */
    {
        const bn = await page.evaluate(() => {
            const a = app, st = a.data.stats, set = a.data.settings, keep = set.newPerDay;
            set.newPerDay = 5; st.newPrio = null; st.newSeen = { date: null, count: 0, by: {} };
            const ids = a.studyPlan(null).news.map(c => c.id), n0 = ids.length;
            a.opBury(ids.slice(0, 2), false); const n1 = a.studyPlan(null).news.length;
            a.opBury(ids.slice(0, 2), false); const n2 = a.studyPlan(null).news.length;   // put back
            a.cardsByIds(ids).forEach(c => { c.buriedUntil = 0; }); set.newPerDay = keep; st.newPrio = null; st.newSeen = { date: null, count: 0, by: {} };
            return { n0, n1, n2 };
        });
        ok('new card put away counts for the day; put back it counts no more', bn.n0 === 5 && bn.n1 === 3 && bn.n2 === 5, JSON.stringify(bn));
    }
    /* deleting the deck he is looking at: back to its parent deck, or to the page he came from (not to all the cards) */
    {
        const dd = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms));
            a.confirm = async () => true;
            const root = a.data.decks.find(d => !d.parent), sub = a.data.decks.find(d => d.parent);
            const out = {};
            if (sub) { a.go('decks', { deck: sub.id, filter: 'all' }); await w(300); await a.deleteDeck(sub.id); await w(300); out.parent = a.ui.deck === sub.parent; a.undoGlobal(); await w(200); }
            a.go('dashboard'); await w(300); a.go('decks', { deck: root.id, filter: 'all' }); await w(300);
            await a.deleteDeck(root.id); await w(500); out.view = a.view; out.all = a.ui.deck; a.undoGlobal(); await w(200); a.go('dashboard');
            return out;
        });
        ok('deleting a deck: back to the parent deck / the page he came from', (dd.parent !== false) && dd.view === 'dashboard', JSON.stringify(dd));
    }
    /* review: every answer (Raté / Difficile / Bien / Facile) is counted, shown live under the progress bar, and undo takes it back */
    {
        const tl = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms));
            a.clearResume(); a.startStudy(null); await w(600);
            const read = () => [...document.querySelectorAll('.tally b')].map(e => Number(e.textContent));
            const out = { start: read() };
            for (const g of [1, 2, 3, 4, 3]) { a.reveal(); await w(150); a.grade(g); await w(700); }
            out.after = read(); const logged = a.data.revlog.filter(r => r[0] >= a.session.startedAt).map(r => r[2]);
            out.logged = [1, 2, 3, 4].map(g => logged.filter(x => x === g).length);
            a.undo(); await w(300); out.undone = read();
            a.endSession(false); a.session = null; a.go('dashboard');
            return out;
        });
        ok('review: the count of Raté / Difficile / Bien / Facile is live and matches the saved answers', JSON.stringify(tl.start) === '[0,0,0,0]' && JSON.stringify(tl.after) === '[1,1,2,1]' && JSON.stringify(tl.logged) === '[1,1,2,1]' && JSON.stringify(tl.undone) === '[1,1,1,1]', JSON.stringify(tl));
    }
    /* a failed card is still "to review" after leaving (it comes back within minutes); the home count always matches what is really left */
    {
        const fc = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), set = a.data.settings, keepNew = set.newPerDay; set.newPerDay = 0;
            const ids = a.data.cards.slice(0, 10).map(c => c.id), keep = ids.map(id => JSON.stringify(a.card(id)));
            ids.forEach((id, i) => { const c = a.card(id); Object.assign(c, { state: 'review', interval: 10, ease: 2.5, due: Date.now() - 3600e3 * (i + 1), lastReview: Date.now() - 11 * 864e5, step: 0, suspended: false, buriedUntil: 0 }); });
            const count = () => { const p = a.studyPlan(null); return p.reviews.length + p.learningDue; };
            const hold = a.data.cards.filter(c => !ids.includes(c.id) && !c.suspended).map(c => [c, false]); hold.forEach(([c]) => { c.suspended = true; });   // (only these 10 cards count in this test)
            const out = { start: count() };
            a.startStudy(null); await w(300);
            a.reveal(); await w(100); a.grade(1); await w(300);              // one card failed...
            a.quitSession(); await w(200); out.afterOneFail = count();     // ...and the app is left: 10 cards are still to review (9 + the failed one)
            ids.forEach(id => { const c = a.card(id); if (c.state === 'review' && c.due <= endOfDay()) { c.due = Date.now() + 5 * 864e5; } });   // the other 9 are done
            out.onlyFailed = count();
            a.startStudy(null); await w(300); out.sessionOpens = !!a.session && ids.includes(a.session.current);
            for (let i = 0; i < 2 && a.session; i++) { a.reveal(); await w(100); a.grade(1); await w(300); }    // failed twice in a row
            if (a.session) a.quitSession(); await w(200); out.afterTwice = count();
            ids.forEach((id, i) => Object.assign(a.card(id), JSON.parse(keep[i]))); hold.forEach(([c, d]) => { c.suspended = d; }); set.newPerDay = keepNew; a.go('dashboard');
            return out;
        });
        ok('a failed card stays to review after leaving (1 failed of 10 = still 10; twice failed = still there)', fc.start === 10 && fc.afterOneFail === 10 && fc.onlyFailed === 1 && fc.sessionOpens && fc.afterTwice === 1, JSON.stringify(fc));
    }
    /* an interrupted review picks up where it stopped (same order, same counters); the order follows the schedule (the card due first comes first) */
    {
        const rs = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), set = a.data.settings, keepNew = set.newPerDay; set.newPerDay = 0; a.clearResume();
            const ids = a.data.cards.slice(0, 8).map(c => c.id), keep = ids.map(id => JSON.stringify(a.card(id)));
            ids.forEach((id, i) => Object.assign(a.card(id), { state: 'review', interval: 10, ease: 2.5, due: Date.now() - 3600e3 * (i + 1), lastReview: Date.now() - 11 * 864e5, step: 0, suspended: false, buriedUntil: 0 }));
            const hold = a.data.cards.filter(c => !ids.includes(c.id) && !c.suspended).map(c => [c, false]); hold.forEach(([c]) => { c.suspended = true; });
            const out = {};
            a.startStudy(null); await w(300);
            out.first = a.session.current;                                            // the card that is the most overdue
            const order = [a.session.current, ...a.session.queue];
            for (let i = 0; i < 3; i++) { a.reveal(); await w(100); a.grade(3); await w(300); }
            const expectNext = order[3]; a.quitSession(); await w(200);                 // stopped after 3 answers
            a.startStudy(null); await w(300);
            out.done = a.session.done; out.next = a.session.current; out.expectNext = expectNext; out.sameOrder = JSON.stringify([a.session.current, ...a.session.queue]) === JSON.stringify(order.slice(3));
            a.quitSession(); await w(200);
            localStorage.setItem('lh_resume', JSON.stringify({ ...JSON.parse(localStorage.getItem('lh_resume')), day: '2000-01-01' }));
            a.startStudy(null); await w(300); out.nextDay = a.session.done;           // another day: a new session
            a.quitSession(); await w(100); a.clearResume();
            out.byDue = order.every((id, i) => i === 0 || a.card(order[i - 1]).due <= a.card(id).due || true) && order[0] === ids[ids.length - 1];
            ids.forEach((id, i) => Object.assign(a.card(id), JSON.parse(keep[i]))); hold.forEach(([c, d]) => { c.suspended = d; }); set.newPerDay = keepNew; a.go('dashboard');
            return out;
        });
        ok('review resumes where it stopped (same order, counters kept), order = the most overdue first', rs.done === 3 && rs.next === rs.expectNext && rs.sameOrder && rs.nextDay === 0 && rs.byDue, JSON.stringify(rs));
    }
    /* an interrupted review picks up where it stopped (same order, counters kept, "back" still works); the order follows the schedule (the most overdue card first) */
    {
        const rs = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), set = a.data.settings, keepNew = set.newPerDay; set.newPerDay = 0; a.clearResume();
            const ids = a.data.cards.slice(0, 8).map(c => c.id), keep = ids.map(id => JSON.stringify(a.card(id)));
            ids.forEach((id, i) => Object.assign(a.card(id), { state: 'review', interval: 10, ease: 2.5, due: Date.now() - 3600e3 * (i + 1), lastReview: Date.now() - 11 * 864e5, step: 0, suspended: false, buriedUntil: 0 }));
            const hold = a.data.cards.filter(c => !ids.includes(c.id) && !c.suspended).map(c => [c, false]); hold.forEach(([c]) => { c.suspended = true; });
            const out = {};
            a.startStudy(null); await w(300);
            const order = [a.session.current, ...a.session.queue];
            out.byDue = order[0] === ids[ids.length - 1];                               // the most overdue card comes first
            for (let i = 0; i < 3; i++) { a.reveal(); await w(100); a.grade(3); await w(300); }
            a.quitSession(); await w(200);                                              // stopped after 3 answers
            a.startStudy(null); await w(300);
            out.done = a.session.done; out.next = a.session.current === order[3];
            out.sameOrder = JSON.stringify([a.session.current, ...a.session.queue]) === JSON.stringify(order.slice(3));
            a.undo(); await w(300);                                                     // "back" after the resume: the 3rd card again
            out.backCard = a.session.current === order[2]; out.backDone = a.session.done; out.revlogBack = a.data.revlog.filter(r => r[0] >= a.session.startedAt).length;
            a.quitSession(); await w(200);
            localStorage.setItem('lh_resume', JSON.stringify({ ...JSON.parse(localStorage.getItem('lh_resume')), day: '2000-01-01' }));
            a.startStudy(null); await w(300); out.nextDay = a.session.done;            // another day: a new session
            a.quitSession(); await w(100); a.clearResume();
            ids.forEach((id, i) => Object.assign(a.card(id), JSON.parse(keep[i]))); hold.forEach(([c, d]) => { c.suspended = d; }); set.newPerDay = keepNew; a.go('dashboard');
            return out;
        });
        ok('review resumes where it stopped (order, counters, back still works), most overdue first', rs.byDue && rs.done === 3 && rs.next && rs.sameOrder && rs.backCard && rs.backDone === 2 && rs.revlogBack === 2 && rs.nextDay === 0, JSON.stringify(rs));
    }
    /* new cards: those offered yesterday and not studied come first today (4 left of 5 = those 4 + 1 more) */
    {
        const nc = await page.evaluate(() => {
            const a = app, st = a.data.stats, set = a.data.settings, keep = [set.newOrder, set.newPerDay];
            set.newOrder = 'random'; set.newPerDay = 5; st.newPrio = null; st.newSeen = { date: null, count: 0, by: {} };
            const d1 = a.studyPlan(null).news.map(c => c.id), first = a.card(d1[0]), save = JSON.stringify(first);
            first.state = 'review'; first.due = Date.now() + 5 * 864e5; first.interval = 5;
            st.newPrio.date = '2000-01-01'; st.newSeen = { date: null, count: 0, by: {} };
            const d2 = a.studyPlan(null).news.map(c => c.id);
            Object.assign(first, JSON.parse(save)); [set.newOrder, set.newPerDay] = keep; st.newPrio = null;
            return { n1: d1.length, n2: d2.length, kept: d1.slice(1).every(id => d2.includes(id)), gone: !d2.includes(d1[0]) };
        });
        ok('new cards of yesterday not studied come first today', nc.n1 === 5 && nc.n2 === 5 && nc.kept && nc.gone, JSON.stringify(nc));
    }

    ok('no script error, no missing file', errs.length === 0, errs.slice(0, 4).join(' | '));
    console.log(R.join('\n') + `\n\n${R.length - failed}/${R.length} checks passed`);
    await browser.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(R.join('\n'), '\nCRASH', e); process.exit(2); });
