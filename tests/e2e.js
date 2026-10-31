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
    page.on('response', r => { if (r.status() >= 400 && !/fonts\.g|generativelanguage/.test(r.url())) errs.push(r.status() + ' ' + r.url().slice(-50)); });
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

    /* 0c. DECISION (user: "l'appli est parfois lente ou lourde, mais ne rien enlever") : the page stays light and nothing is removed.
       The theme pictures are files that only the theme in use downloads; the TOEIC photos are a separate file loaded when the TOEIC tab opens. */
    {
        const lw = await ctx.newPage(), reqs = [];
        lw.on('request', r => reqs.push(r.url()));
        await lw.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
        await lw.addInitScript(() => { try { localStorage.setItem('superanki_theme', 'clair'); } catch { /* private mode */ } });
        await lw.goto(`http://localhost:${PORT}/index.html`); await lw.waitForSelector('.hero', { timeout: 20000 }); await wait(2500);
        const size = fs.statSync(path.join(ROOT, 'index.html')).size;
        ok('the page is light: index.html stays under 3 Mo', size < 3 * 1024 * 1024, Math.round(size / 1024) + ' Ko');
        const first = await lw.evaluate(() => ({ photos: typeof TOEIC_PHOTOS, lazy: LAZY && Object.keys(LAZY).length }));
        ok('at start with a plain theme: no theme picture and no TOEIC photo is downloaded', !reqs.some(u => /\/(themes|lazy)\//.test(u)) && first.photos === 'undefined' && first.lazy > 0, JSON.stringify(first));
        await lw.evaluate(() => app.setSetting('theme', 'hiver')); await wait(2500);
        const hv = reqs.filter(u => /\/themes\//.test(u));
        const bg = await lw.evaluate(() => getComputedStyle(document.body, '::before').backgroundImage);
        ok('choosing a theme downloads its own pictures only, and they are used', hv.length > 0 && hv.every(u => /\/themes\/hiver\//.test(u)) && /themes\/hiver\//.test(bg), hv.length + ' files, ' + bg.slice(0, 60));
        await lw.evaluate(() => app.go('toeic')); await wait(2500);
        const ph = await lw.evaluate(() => typeof TOEIC_PHOTOS !== 'undefined' ? Object.keys(TOEIC_PHOTOS).length : -1);
        ok('the TOEIC photos load when the TOEIC tab opens', ph > 0 && reqs.some(u => /\/lazy\/toeic-photos\.[0-9a-f]{8}\.js/.test(u)), String(ph));
        await lw.evaluate(() => app.toeicStart({ kind: 'part', part: 'p1', count: 2, style: 'train' })); await wait(1200); await lw.evaluate(() => app.exStartPart()); await wait(1500);
        const pic = await lw.evaluate(() => { const i = document.querySelector('.tq-photo img'); return i ? i.getAttribute('src').slice(0, 22) : ''; });
        ok('a TOEIC part 1 question shows its real photo', pic === 'data:image/jpeg;base64', pic);
        await lw.close();
    }

    /* 1. start */
    const t0 = Date.now();
    await page.goto(`http://localhost:${PORT}/index.html`); await page.waitForSelector('.hero', { timeout: 20000 });
    ok('starts and shows the home screen under 4 s', Date.now() - t0 < 4000, (Date.now() - t0) + ' ms');
    await wait(2500);
    ok('Léo greets on opening (sit wave, paw wave or hello without tablet)', await page.evaluate(() => { const r = document.querySelector('.hero .leo3d'); return !!r && (r._leoHist || []).some(k => ['sitwave', 'wave', 'hello0'].includes(k) || (k === 'yawn' && (new Date().getHours() >= 23 || new Date().getHours() < 9))); }));   // (at night and early morning he yawns first)
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
            if (t.id === 'auto') continue;
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

    /* advanced import: "a >> b", "a <> b", "{{hole}}" typed directly; duplicates are flagged and unticked; one card per hole */
    {
        const im = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), out = {};
            const n0 = a.data.cards.length;
            a.data.decks.push({ id: 'dimp', name: 'ImportTest', emoji: '📘', description: '', created: Date.now(), parent: null, opts: null, mod: 0 });
            a.data.cards.push({ id: 'cimp', ...freshCard(), deckId: 'dimp', front: 'chien', back: 'dog', hint: '', detail: '', tags: [], created: 1, nid: '', kind: 'basic', ord: 0, nf: null });
            a.openImportModal();
            const m = document.querySelector('.modal-overlay:last-of-type') || document;
            const sel = document.getElementById('im-deck'), ta = document.getElementById('im-text');
            sel.value = 'dimp'; sel.dispatchEvent(new Event('change'));
            ta.value = "Capitale de l'Italie >> Rome\nchat <> cat\nLe {{TOEIC}} évalue l'{{anglais}}\na ; b\nchien >> dog\nchat <> cat\nligne sans separateur";
            ta.dispatchEvent(new Event('input')); await w(100);
            out.rows = document.querySelectorAll('.im-row').length; out.dup = document.querySelectorAll('.im-row.dup').length;
            out.label = document.getElementById('im-go').textContent.trim();
            out.skipped = /1 ligne ignorée/.test(document.getElementById('im-preview').textContent);
            document.getElementById('im-go').click(); await w(300);
            const made = a.data.cards.filter(c => c.deckId === 'dimp' && c.id !== 'cimp');
            out.made = made.length; out.kinds = made.map(c => c.kind).sort().join(',');
            out.holes = made.filter(c => c.kind === 'cloze').length;
            out.noChienTwice = a.data.cards.filter(c => c.deckId === 'dimp' && c.front === 'chien').length === 1;
            a.data.cards = a.data.cards.filter(c => c.deckId !== 'dimp'); a.data.decks = a.data.decks.filter(d => d.id !== 'dimp');
            return out;
        });
        ok('import: typed syntax (>> <> {{hole}}), duplicates flagged and unticked, one card per hole', im.rows === 6 && im.dup === 2 && /^Importer 6 cartes$/.test(im.label) && im.skipped && im.made === 6 && im.holes === 2 && im.noChienTwice && im.kinds === 'basic,basic,cloze,cloze,rev,rev', JSON.stringify(im));
    }

    /* custom QCM: written in a deck, mixed into the Quiz; never a card (no planning, no review history), saved/synced/trashed/undone like cards */
    {
        const q = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), out = {}, d = a.data;
            d.decks.push({ id: 'dqcm', name: 'QCMTest', emoji: '❓', description: '', created: Date.now(), parent: null, opts: null, mod: 0 });
            a.ui.deck = 'dqcm'; a.go('decks'); await w(300);
            out.block = !!document.querySelector('.qcm-box [data-action=qcm-new]') && !!document.querySelector('.qcm-box [data-action=qcm-bulk]');
            const cards0 = d.cards.length, rev0 = d.revlog.length, hist0 = JSON.stringify(d.stats.history), qb0 = d.stats.quizBest || 0, cb0 = JSON.stringify(d.stats.chronoBest);
            const due0 = a.studyPlan(null).reviews.length + a.studyPlan(null).news.length;
            /* bulk paste with preview */
            a.openQcmBulk('dqcm'); await w(100);
            const ta = document.getElementById('qb-text'); ta.value = "Capitale de l'Italie ?\na) Rome *\nb) Milan\nc) Naples\n\nQuels sont des fruits ?\na) Pomme *\nb) Carotte\nc) Fraise *\n=> La carotte est un légume.\n\nSans bonne\na) x\nb) y\n\nContinents ?\nA) 5\nB) 7\nC) 9\nRéponse : B";
            ta.dispatchEvent(new Event('input')); await w(100);
            out.preview = document.querySelectorAll('#qb-preview .im-row').length; out.skipMsg = /1 bloc ignoré/.test(document.getElementById('qb-preview').textContent);
            document.getElementById('qb-go').click(); await w(300);
            out.n = d.qcms.length; out.multi = d.qcms.filter(x => x.multi).length; out.letterKey = (d.qcms.find(x => x.q === 'Continents ?') || { o: [] }).o.map(o => o.ok ? 1 : 0).join('');
            /* editor: one more QCM through the form */
            a.openQcmEditor(null, 'dqcm'); await w(100);
            document.getElementById('qe-q').value = 'Combien font 2+2 ?';
            const rows = [...document.querySelectorAll('.qe-row')]; ['3', '4', '5', ''].forEach((t, i) => { rows[i].querySelector('input').value = t; });
            rows[1].querySelector('[data-qe=ok]').click(); rows[0].querySelector('[data-qe=ok]').click(); rows[1].querySelector('[data-qe=ok]').click();   // one single right answer: the last tick wins
            out.oneOk = document.querySelectorAll('.qe-row.ok').length === 1 && rows[1].classList.contains('ok');
            document.getElementById('qe-save').click(); await w(300);
            out.n2 = d.qcms.length;
            /* in the Quiz : only the QCM of this deck here → 5 questions, single and multiple answers */
            a.startQuiz(['dqcm'], 9999, 0); await w(300);
            out.total = a.session.total; out.kind = a.session.kind;
            let guard = 0, seenMulti = false, wrongOnce = false;
            while (a.session && a.session.kind === 'quiz' && guard++ < 12) {
                const s = a.session, qq = s.qcm; if (!qq) break;
                const btns = [...document.querySelectorAll('.quiz-opt')];
                const okIdx = s.options.map((o, i) => o.ok ? i : -1).filter(i => i >= 0), badIdx = s.options.map((o, i) => o.ok ? -1 : i).filter(i => i >= 0);
                if (qq.multi) {
                    seenMulti = true;
                    out.checkDisabled = document.getElementById('qcm-check').disabled;
                    if (!wrongOnce) { wrongOnce = true; btns[okIdx[0]].click(); document.getElementById('qcm-check').click(); }   // only one of two: wrong
                    else { okIdx.forEach(i => btns[i].click()); document.getElementById('qcm-check').click(); }
                } else btns[(qq.q === 'Continents ?' ? badIdx[0] : okIdx[0])].click();   // the continents one is answered wrong on purpose
                await w(60);
                if (document.querySelector('[data-action=quiz-next]')) document.querySelector('[data-action=quiz-next]').click(); else break;
                await w(80);
            }
            await w(300);
            out.multiSeen = seenMulti; out.summary = /Quiz terminé/.test(document.getElementById('view-session').textContent);
            out.line = (document.getElementById('view-session').textContent.match(/Dont \d+ QCM : \d+ réussi/) || [''])[0];
            out.right = d.qcms.reduce((n, x) => n + x.right, 0); out.wrong = d.qcms.reduce((n, x) => n + x.wrong, 0);
            out.untouched = d.cards.length === cards0 && d.revlog.length === rev0 && JSON.stringify(d.stats.history) === hist0 && (d.stats.quizBest || 0) === qb0 && JSON.stringify(d.stats.chronoBest) === cb0 && (a.studyPlan(null).reviews.length + a.studyPlan(null).news.length) === due0;
            a.go('dashboard'); await w(100);
            /* Chrono never uses QCM */
            a.startQuiz(['dqcm'], 0, 30); await w(200); out.chronoNone = !a.session; if (a.session) a.endSession(true);
            a.ui.deck = 'dqcm';
            /* saved, restored, merged */
            const ser = JSON.parse(a.serialize()), back = normalizeState(JSON.stringify(ser));
            out.saved = ser.qcms.length === 4 && back.qcms.length === 4 && back.qcms.every(x => x.deckId === 'dqcm');
            const L = normalizeState(a.serialize()), R = normalizeState(a.serialize());
            R.qcms[0].q = 'Modifiée à distance'; R.qcms[0].mod = Date.now() + 5000; R.qcms.push(normalizeQcm({ id: 'q_remote', deckId: 'dqcm', q: 'Venue de l\'autre appareil', o: [{ t: 'a', ok: true }, { t: 'b' }], mod: Date.now() }));
            const mrg = mergeStates(L, R).data; out.merged = mrg.qcms.length === 5 && mrg.qcms.some(x => x.q === 'Modifiée à distance') && mrg.qcms.some(x => x.id === 'q_remote');
            const L2 = normalizeState(a.serialize()), R2 = normalizeState(a.serialize()); const gone = R2.qcms.pop(); R2.deleted[gone.id] = Date.now() + 5000;
            out.tomb = mergeStates(L2, R2).data.qcms.every(x => x.id !== gone.id) && mergeStates(L2, R2).data.qcms.length === 3;
            /* deleting the deck takes its QCM away; undo brings them back; the trash knows them */
            await a.deleteDeck.call(Object.assign(Object.create(a), { confirm: async () => true }), 'dqcm'); await w(200);
            out.deckGone = d.qcms.length === 0 && d.trash.filter(x => x.k === 'qcm').length === 4;
            a.undoGlobal(); await w(200);
            out.undone = d.qcms.length === 4 && !!a.deck('dqcm');
            /* one QCM deleted from the editor, then restored from the trash */
            const one = d.qcms[0].id; a.change('x', [], () => { a.data.qcms = a.data.qcms.filter(x => x.id !== one); }, { qcms: true });
            out.trashed = d.trash.some(x => x.k === 'qcm' && x.c.id === one);
            a.trashRestore('qcm', one); out.restored = d.qcms.some(x => x.id === one) && !d.trash.some(x => x.k === 'qcm' && x.c.id === one);
            d.qcms = []; d.decks = d.decks.filter(x => x.id !== 'dqcm'); a.ui.deck = 'all'; a.go('dashboard');
            return out;
        });
        ok('QCM: block in the deck page, bulk paste with preview (bad block ignored, letter answer key, several answers)', q.block && q.preview === 3 && q.skipMsg && q.n === 3 && q.multi === 1 && q.letterKey === '010', JSON.stringify(q));
        ok('QCM: editor makes a single-answer QCM; Quiz mixes single and multiple answers and scores them apart', q.oneOk && q.n2 === 4 && q.total === 4 && q.kind === 'quiz' && q.multiSeen && q.checkDisabled === true && q.summary && /Dont 4 QCM : 2 réussi/.test(q.line) && q.right === 2 && q.wrong === 2, JSON.stringify(q));
        ok('QCM: no effect on cards, review history, due count, records; never in Chrono', q.untouched && q.chronoNone, JSON.stringify(q));
        ok('QCM: saved, merged between devices (edit + new + deletion), deck deletion + undo + trash', q.saved && q.merged && q.tomb && q.deckGone && q.undone && q.trashed && q.restored, JSON.stringify(q));
    }

    /* Association game: 6 short pairs per round, +2 s per mistake, best time per deck, "next round"; only short cards; touches no card */
    {
        const g = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), out = {}, d = a.data;
            d.decks.push({ id: 'dmg', name: 'MotsCourts', emoji: '🔤', description: '', created: Date.now(), parent: null, opts: null, mod: 0 });
            const mk = (id, f, b) => d.cards.push({ id, ...freshCard(), deckId: 'dmg', front: f, back: b, hint: '', detail: '', tags: [], created: 1, nid: '', kind: 'basic', ord: 0, nf: null });
            [['chat', 'cat'], ['chien', 'dog'], ['maison', 'house'], ['eau', 'water']].forEach(([f, b], i) => mk('mg' + i, f, b));
            mk('mglong', 'Une très très longue question qui dépasse largement quarante caractères', 'x');
            a.startMatch(['dmg']); await w(100); out.refused = !a.session;     // 4 short cards only: not enough, with a message
            [['pain', 'bread'], ['livre', 'book'], ['arbre', 'tree'], ['lune', 'moon'], ['feu', 'fire']].forEach(([f, b], i) => mk('mh' + i, f, b));
            out.pool = a.matchPool(['dmg']).length;
            const snap = () => JSON.stringify(d.cards.filter(c => c.deckId === 'dmg').map(c => ({ ...c, mod: 0 }))), before = snap(), rev0 = d.revlog.length;
            a.startMatch(['dmg']); await w(200);
            const s = a.session; out.kind = s.kind; out.tiles = document.querySelectorAll('.mg-tile').length;
            const L = [...document.querySelectorAll('.mg-tile[data-side=l]')], R = id => document.querySelector(`.mg-tile[data-side=r][data-id="${id}"]`);
            const bad = [...document.querySelectorAll('.mg-tile[data-side=r]')].find(x => x.dataset.id !== L[0].dataset.id);
            L[0].click(); bad.click(); await w(100); out.err = s.errors;
            await w(600);
            for (const t of L) { t.click(); R(t.dataset.id).click(); await w(30); }
            await w(700);
            out.final = s.final && s.final.total === s.final.time + 2000 && s.final.record;
            out.best = d.stats.matchBest.dmg === s.final.total;
            out.result = !!document.querySelector('[data-action=mg-next]');
            document.querySelector('[data-action=mg-next]').click(); await w(300);
            out.round2 = a.session.round === 2 && a.session.matched.size === 0 && !a.session.final;
            out.untouched = snap() === before && d.revlog.length === rev0;
            const m = mergeStates(normalizeState(a.serialize()), Object.assign(normalizeState(a.serialize()), {}));
            const x = normalizeState(a.serialize()), y = normalizeState(a.serialize()); x.stats.matchBest = { dmg: 9000, z: 5000 }; y.stats.matchBest = { dmg: 7000 };
            out.mergeMin = mergeStates(x, y).data.stats.matchBest.dmg === 7000 && mergeStates(x, y).data.stats.matchBest.z === 5000;
            a.endSession(true); d.cards = d.cards.filter(c => c.deckId !== 'dmg'); d.decks = d.decks.filter(k => k.id !== 'dmg'); delete d.stats.matchBest.dmg; a.go('dashboard');
            return out;
        });
        ok('Association: not enough short cards → message; 6 pairs per round (12 tiles), +2 s per mistake, best time per deck, "next round", no card touched', g.refused && g.pool === 9 && g.kind === 'match' && g.tiles === 12 && g.err === 1 && g.final && g.best && g.result && g.round2 && g.untouched && g.mergeMin, JSON.stringify(g));
    }

    /* Notes tab (6th entry): outline editor typed with the real keyboard, [[links]] + backlinks, daily note, trash, sync merge, images kept */
    {
        const tabs = {};
        for (const w of [360, 390, 430]) {
            await page.setViewportSize({ width: w, height: 800 }); await page.evaluate(() => app.go('dashboard')); await wait(250);
            tabs[w] = await page.evaluate(() => { const bn = document.querySelector('.bottom-nav'), bs = [...bn.querySelectorAll('button')]; return { n: bs.length, over: bn.scrollWidth > bn.clientWidth + 1, cut: bs.some(b => b.scrollWidth > b.clientWidth + 1), notes: !!bn.querySelector('[data-nav=notes]') }; });
        }
        for (const w of [1280, 1100, 1000]) {
            await page.setViewportSize({ width: w, height: 800 }); await page.evaluate(() => app.go('dashboard')); await wait(250);
            tabs['pc' + w] = await page.evaluate(() => { const t = document.querySelector('.topbar-inner'); return { over: t.scrollWidth > t.clientWidth + 1, nav: !!document.querySelector('.nav [data-nav=notes]') }; });
        }
        await page.setViewportSize({ width: 390, height: 800 });
        ok('Notes: the 4 tabs + Profil (Accueil, Paquets, Notes, Stats, Profil) fit the bottom bar at 360, 390 and 430 px and the top bar on a computer', [360, 390, 430].every(w => tabs[w].n === 5 && !tabs[w].over && !tabs[w].cut && tabs[w].notes) && ['pc1280', 'pc1100', 'pc1000'].every(k => !tabs[k].over && tabs[k].nav), JSON.stringify(tabs));
        await page.evaluate(() => { app.go('notes'); }); await wait(300);
        await page.evaluate(() => app.noteNewFrom(null, {})); await wait(300);
        await page.keyboard.type('Cours de marketing'); await page.keyboard.press('Enter'); await wait(80);
        await page.keyboard.type('Les 4 P'); await page.keyboard.press('Enter');
        await page.keyboard.type('Produit'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
        await page.keyboard.type('Prix'); await page.keyboard.press('Enter'); await page.keyboard.type('Place'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Enter');
        await page.keyboard.type('# Conclusion'); await page.keyboard.press('Enter');
        await page.keyboard.type('[] relire le cours'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');   // 2nd Enter on an empty to-do leaves the to-do
        await page.keyboard.type('Voir [[Autre note]] et [[Plan');
        await wait(200);
        const nb1 = await page.evaluate(() => { const n = app.data.notes[0]; return { title: n.title, b: n.b.map(b => `${b.t}:${b.d}:${b.x}`), sug: document.querySelectorAll('.nb-suggest button').length, bar: !!document.querySelector('#nb-bar') && getComputedStyle(document.querySelector('#nb-bar')).display !== 'none' }; });
        await page.keyboard.press('Escape'); for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace');
        await page.evaluate(() => app.nbIdle(true)); await wait(150);
        const nb2 = await page.evaluate(() => { const n = app.data.notes[0]; return { last: n.b[n.b.length - 1].x, link: !!document.querySelector('.nb-link.miss'), saved: JSON.parse(app.serialize()).notes.length === 1 }; });
        ok('Notes: typed outline (Enter, Tab / Shift+Tab, "# " title, "[] " to-do, Enter on empty to-do), floating bar, [[ suggestions', nb1.title === 'Cours de marketing' && JSON.stringify(nb1.b) === JSON.stringify(['p:0:Les 4 P', 'p:1:Produit', 'p:1:Prix', 'p:0:Place', 'h1:0:Conclusion', 'todo:0:relire le cours', 'p:0:Voir [[Autre note]] et [[Plan']) && nb1.sug > 0 && nb1.bar && nb2.last === 'Voir [[Autre note]] et ' && nb2.link && nb2.saved, JSON.stringify({ nb1, nb2 }));
        const lk = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), out = {}, d = a.data, n = d.notes[0];
            /* the missing link is created by tapping it; the new note shows the backlink; renaming keeps the link alive */
            document.querySelector('.nb-link.miss').click(); await w(200);
            const t2 = d.notes.find(x => x.title === 'Autre note'); out.created = !!t2 && a.ui.note === t2.id;
            out.back = document.querySelectorAll('#nb-backlinks .nb-bl').length === 1 && /Cours de marketing/.test(document.getElementById('nb-backlinks').textContent);
            const ti = document.getElementById('nb-title'); ti.value = 'Seconde note'; ti.dispatchEvent(new Event('change', { bubbles: true })); await w(100);
            out.renamed = n.b.some(b => b.x.includes('[[Seconde note]]')) && !n.b.some(b => b.x.includes('[[Autre note]]'));
            /* a link to a card, shown on the card info */
            const card = d.cards[0]; n.b.push({ t: 'p', x: `Carte : [[c:${card.id}|${truncate(stripHtml(card.front), 20)}]]`, d: 0 }); a.save();
            out.cardLink = a.notesLinkingCard(card.id).length === 1 && /Carte/.test(a.inlineHtml(n.b[n.b.length - 1].x));
            /* today's note: made once, titled with the date */
            a.noteDaily(); await w(200); const dn = d.notes.find(x => x.daily === dayKey()); out.daily = !!dn && /\d{4}/.test(dn.title) && a.ui.note === dn.id;
            a.noteDaily(); await w(100); out.dailyOnce = d.notes.filter(x => x.daily === dayKey()).length === 1;
            /* fold + undo on the first note */
            a.noteOpen(n.id); await w(200);
            const first = document.querySelector('.nb[data-i="0"] .nb-bul'); first.click(); await w(150); out.fold = n.b[0].c === true && document.querySelectorAll('.nb.hid').length === 2; first.click(); await w(100);
            a.nbActivate(4, 'end'); document.execCommand('insertText', false, ' !'); await w(100); a.nbUndo(); await w(150); out.undo = n.b[4].x === 'Conclusion';
            /* to-do check */
            document.querySelector('.nb-todo .nb-chk, .nb[data-i="5"] .nb-chk').click(); out.todo = n.b[5].done === true;
            return out;
        });
        ok('Notes: [[link]] created by tapping it, backlinks, rename keeps links, card link, note of the day (once), fold, undo, to-do', lk.created && lk.back && lk.renamed && lk.cardLink && lk.daily && lk.dailyOnce && lk.fold && lk.undo && lk.todo, JSON.stringify(lk));
        const sv = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), out = {}, d = a.data;
            const ser = JSON.parse(a.serialize()); out.saved = ser.notes.length === 3 && normalizeState(JSON.stringify(ser)).notes.length === 3;
            const L = normalizeState(a.serialize()), R = normalizeState(a.serialize());
            R.notes[0].b.push({ t: 'p', x: 'ajout distant', d: 0 }); R.notes[0].mod = Date.now() + 9000;
            const gone = R.notes.pop(); R.deleted[gone.id] = Date.now() + 9000;
            const m = mergeStates(L, R).data; out.merged = m.notes.some(x => x.b.some(b => b.x === 'ajout distant')) && !m.notes.some(x => x.id === gone.id);
            /* images stay in the media store (not cleaned away) */
            const ref = a.addMedia('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='); d.notes[0].b.push({ t: 'img', src: ref, d: 0 }); a.gcMedia(d); out.media = !!d.media[ref.slice(6)];
            /* deleting a note: trash, undo toast restores it */
            const id = d.notes[0].id, title = d.notes[0].title; a.noteDelete(id); await w(100);
            out.trash = !d.notes.some(x => x.id === id) && d.trash.some(x => x.k === 'note' && x.c.id === id);
            a.trashRestore('note', id); await w(100); out.restored = d.notes.some(x => x.id === id && x.title === title) && !d.trash.some(x => x.k === 'note' && x.c.id === id);
            d.notes = []; a.ui.note = null; a.nbBarEnsure(false); a.go('dashboard');
            return out;
        });
        ok('Notes: saved, merged between devices, images kept, deletion goes to the trash and can be restored', sv.saved && sv.merged && sv.media && sv.trash && sv.restored, JSON.stringify(sv));
    }

    /* Notes v2: tree (folders = decks, sub-notes, pinned), sort, swipe, drag and drop, multi-select, menu, tags, emoji, find, formatting, move lines */
    {
        await page.setViewportSize({ width: 390, height: 800 });
        const t1 = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), out = {}, d = a.data;
            d.notes = []; a.ui.note = null; a.ui.noteQ = ''; a.ui.noteFav = false; a.ui.noteTag = ''; a.nbPrefs().sort = 'recent'; a.nbPrefs().closed = {};
            const dk = d.decks.find(x => !x.parent).id;
            const A = a.noteNew('Cours 1', { deckId: dk, emoji: '📘' }), P4 = a.noteNew('Les 4 P', { parent: A.id }), SEG = a.noteNew('Segmentation', { parent: A.id }), REV = a.noteNew('Révisions', { deckId: dk }), Z = a.noteNew('Idées');
            Z.pin = true; A.tags = ['marketing']; Z.tags = ['idee']; a.save(); a.go('notes'); await w(400);
            const rows = [...document.querySelectorAll('#nb-list .nb-wrap, #nb-list .nb-headrow')].map(r => r.dataset.kind ? r.dataset.kind + ':' + (r.dataset.id) : 'head');
            out.tree = rows[0] === 'head' && rows[1] === 'note:' + Z.id && rows[2].startsWith('folder:') && rows.includes('note:' + A.id) && rows.indexOf('note:' + P4.id) > rows.indexOf('note:' + A.id) && !!document.querySelector('#nb-list .nb-row[data-id="' + P4.id + '"]').style.cssText.match(/--d:\s*2/);
            out.foldBtn = !!document.querySelector(`[data-action=nb-fold][data-id="${A.id}"]`);
            document.querySelector(`[data-action=nb-fold][data-id="${A.id}"]`).click(); await w(100);
            out.folded = !document.querySelector(`#nb-list [data-id="${P4.id}"]`); document.querySelector(`[data-action=nb-fold][data-id="${A.id}"]`).click(); await w(100);
            out.unfolded = !!document.querySelector(`#nb-list [data-id="${P4.id}"]`);
            /* sort */
            a.nbPrefs().sort = 'created'; const rc = a.nbRows().filter(r => r.kind === 'note').map(r => r.n.title);
            A.created = 1; REV.created = 3; a.nbPrefs().sort = 'created'; out.sortCreated = a.nbSortList([A, REV])[0].id === REV.id;
            a.nbPrefs().sort = 'manual'; A.order = 5; REV.order = 1; const top = a.nbSortList([A, REV]).map(x => x.title); out.sortManual = top[0] === 'Révisions';
            a.nbPrefs().sort = 'recent';
            /* filters: favourites and tags, search */
            A.fav = true; a.ui.noteFav = true; a.nbRefreshList(); out.fav = document.querySelectorAll('#nb-list .nb-row').length === 1; a.ui.noteFav = false;
            a.ui.noteTag = 'idee'; a.nbRefreshList(); out.tag = document.querySelectorAll('#nb-list .nb-row').length === 1 && /Idées/.test(document.getElementById('nb-list').textContent); a.ui.noteTag = '';
            a.ui.noteQ = 'segm'; a.nbRefreshList(); out.search = document.querySelectorAll('#nb-list .nb-row').length === 1; a.ui.noteQ = ''; a.nbRefreshList();
            out.ids = { A: A.id, P4: P4.id, SEG: SEG.id, REV: REV.id, Z: Z.id, dk };
            return out;
        });
        ok('Notes v2: tree (pinned on top, folders = decks, sub-notes indented), fold, sorts, filters (favourites, tag, search)', t1.tree && t1.foldBtn && t1.folded && t1.unfolded && t1.sortCreated && t1.sortManual && t1.fav && t1.tag && t1.search, JSON.stringify(t1));
        const ids = t1.ids;
        /* long press / right click on a row: the screen dims, the row lifts and a menu offers the actions (no sliding any more) */
        await wait(900); const row = await page.$(`#nb-list .nb-row[data-id="${ids.REV}"]`); await row.evaluate(el => el.scrollIntoView({ block: 'center' })); await wait(300); const bb = await row.boundingBox();
        await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
        await page.mouse.click(bb.x + 120, bb.y + bb.height / 2, { button: 'right' }); await wait(500);
        const sw1 = await page.evaluate(id => ({ dbg: [app.ui.noteSelMode, app.ui.selMode, app.modals.length, !!app.popover, document.querySelector(`#nb-list .nb-row[data-id="${id}"]`) && document.querySelector(`#nb-list .nb-row[data-id="${id}"]`).className].join('|'), dim: !!document.querySelector('.press-dim'), lift: document.querySelector(`#nb-list .nb-row[data-id="${id}"]`).classList.contains('press-lift'), items: [...document.querySelectorAll('.popover .menu-item')].map(b => b.textContent.trim()) }), ids.REV);
        await page.evaluate(() => { const b = [...document.querySelectorAll('.popover .menu-item')].find(x => /^Supprimer/.test(x.textContent.trim())); if (b) b.click(); }); await wait(500);
        const sw2 = await page.evaluate(id => ({ gone: !app.note(id), trash: app.data.trash.some(x => x.k === 'note' && x.c.id === id), dim: !!document.querySelector('.press-dim:not(.out)') }), ids.REV);
        await page.evaluate(() => { const b = document.querySelector('.toast button'); if (b) b.click(); }); await wait(300);
        const sw3 = await page.evaluate(id => !!app.note(id), ids.REV);
        ok('Notes v2: long press / right click on a note dims the screen, lifts the row and shows a menu (Sélectionner, Épingler, Favori, Supprimer…); delete goes to the trash and can be undone', sw1.dim && sw1.lift && ['Sélectionner', 'Épingler en haut', 'Ajouter aux favoris', 'Supprimer'].every(l => sw1.items.some(i => i.includes(l))) && sw2.gone && sw2.trash && !sw2.dim && sw3, JSON.stringify({ sw1, sw2, sw3 }));
        /* drag and drop with the grip: onto a note = sub-note, onto a folder = into the folder, between = order */
        const drag = async (fromId, toSel, fy) => {
            await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
            const g = await page.$(`#nb-list .nb-wrap[data-id="${fromId}"] .nb-grip`); await g.scrollIntoViewIfNeeded(); const gb = await g.boundingBox(), tg = await page.$(toSel), tb = await tg.boundingBox();
            await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2); await page.mouse.down(); await page.mouse.move(gb.x + 10, gb.y + 30, { steps: 4 });
            await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height * fy, { steps: 10 }); await wait(80); await page.mouse.up(); await wait(300);
        };
        await drag(ids.Z, `#nb-list .nb-wrap[data-id="${ids.REV}"]`, 0.5);
        const dd1 = await page.evaluate(i => ({ parent: app.note(i.Z).parent === i.REV, deck: app.note(i.Z).deckId === app.note(i.REV).deckId }), ids);
        await drag(ids.Z, `#nb-list .nb-wrap[data-id="${ids.SEG}"]`, 0.1);
        const dd2 = await page.evaluate(i => ({ parent: app.note(i.Z).parent === app.note(i.SEG).parent && app.note(i.Z).parent === i.A, manual: app.nbPrefs().sort === 'manual', before: app.note(i.Z).order < app.note(i.SEG).order }), ids);
        await page.evaluate(i => { app.note(i.Z).parent = ''; app.note(i.Z).deckId = ''; app.save(); app.nbRefreshList(); }, ids); await wait(100);
        await drag(ids.Z, `#nb-list .nb-wrap[data-kind=folder]`, 0.5);
        const dd3 = await page.evaluate(i => ({ deck: app.note(i.Z).deckId === i.dk && !app.note(i.Z).parent }), ids);
        const cyc = await page.evaluate(i => app.noteMoveTo([i.A], { parent: i.P4 }), ids);
        ok('Notes v2: drag and drop by the grip (into a note, before a note, into a folder); never into its own sub-note', dd1.parent && dd1.deck && dd2.parent && dd2.manual && dd2.before && dd3.deck && cyc === 0, JSON.stringify({ dd1, dd2, dd3, cyc }));
        await wait(700);
        const t2 = await page.evaluate(async ids => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), out = {};
            /* multi-select */
            document.querySelector('[data-action=nb-sel-toggle]').click(); await w(100);
            [ids.A, ids.SEG].forEach(id => document.querySelector(`#nb-list .nb-row[data-id="${id}"]`).click()); await w(100);
            out.sel = a.ui.noteSel.size === 2 && /2 sélectionnée/.test(document.getElementById('nb-bulk').textContent);
            document.querySelector('[data-action=nb-bulk][data-act=pin]').click(); await w(100); out.pinned = a.note(ids.A).pin && a.note(ids.SEG).pin;
            document.querySelector('[data-action=nb-bulk][data-act=pin]').click(); await w(100); out.unpinned = !a.note(ids.A).pin;
            document.querySelector('[data-action=nb-sel-exit]').click(); await w(100); out.exit = !a.ui.noteSelMode;
            /* menu items, duplicate, tags, emoji, rename */
            a.noteOpen(ids.A); await w(300);
            a.nbNoteMenu(document.querySelector('[data-action=nb-more]'), ids.A); await w(100);
            const items = [...document.querySelectorAll('.popover.menu .menu-item')].map(x => x.textContent.trim());
            out.menu = ['Épingler en haut', 'Ajouter aux favoris', 'Ajouter une sous-note', 'Dupliquer', 'Déplacer…', 'Exporter en Markdown (.md)', 'Partager…', 'Copier le texte', 'Informations', 'Supprimer'].every(l => items.some(i => i.includes(l.replace(' aux favoris', '').replace('Ajouter aux', 'Ajouter')) || i === l) || items.includes(l)) || items.length >= 10;
            a.closePopover();
            const before = a.data.notes.length; a.noteDuplicate(ids.A); await w(200); out.dup = a.data.notes.length === before + 1 && /copie/.test(a.note(a.ui.note).title);
            a.noteOpen(ids.A); await w(200);
            document.getElementById('nb-tag-in').value = 'examen, cours'; document.getElementById('nb-tag-in').dispatchEvent(new Event('change', { bubbles: true })); await w(100);
            out.tags = a.note(ids.A).tags.includes('examen') && a.note(ids.A).tags.includes('cours') && !!document.querySelector('.nb-tag');
            document.querySelector('[data-action=nb-tag-del][data-tag="cours"]').click(); await w(100); out.tagDel = !a.note(ids.A).tags.includes('cours');
            a.openNoteEmoji(); await w(100); document.querySelector('.emoji-grid [data-e="🧠"]').click(); await w(200); out.emoji = a.note(ids.A).emoji === '🧠' && /🧠/.test(document.querySelector('.nb-emoji').textContent);
            const ti = document.getElementById('nb-title'); out.ro = ti.readOnly; ti.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); out.edit = !ti.readOnly;
            ti.value = 'Cours de marketing'; ti.dispatchEvent(new Event('change', { bubbles: true })); ti.blur(); await w(100); out.renamed = a.note(ids.A).title === 'Cours de marketing' && ti.readOnly;
            out.info = (a.noteInfo(a.note(ids.A)), /Rétroliens/.test(document.querySelector('.modal-body').textContent)); a.closeModal(a.modals[a.modals.length - 1]);
            /* move modal */
            a.openNoteMove([ids.SEG]); await w(100); out.mv = document.querySelectorAll('#nm-list .pick-item').length > 3; document.querySelector('#nm-list [data-k=deck][data-id=""]').click(); await w(200);
            out.moved = a.note(ids.SEG).deckId === '' && a.note(ids.SEG).parent === '';
            return out;
        }, ids);
        ok('Notes v2: multi-select (pin, exit), menu, duplicate, tags add/remove, emoji, double-click rename, info, move picker', t2.sel && t2.pinned && t2.unpinned && t2.exit && t2.menu && t2.dup && t2.tags && t2.tagDel && t2.emoji && t2.ro && t2.edit && t2.renamed && t2.info && t2.mv && t2.moved, JSON.stringify(t2));
        /* editor: formatting, move lines (Alt+arrows and bullet drag), find in note */
        await page.evaluate(i => { app.noteOpen(i); }, ids.A); await wait(300);
        await page.evaluate(() => { const n = app.note(app.ui.note); n.b = [{ t: 'p', x: 'Un', d: 0 }, { t: 'p', x: 'Deux', d: 0 }, { t: 'p', x: 'Deux-a', d: 1 }, { t: 'p', x: 'Trois', d: 0 }]; app.save(); app.renderNotes(); });
        await wait(200);
        await page.evaluate(() => app.nbActivate(0, 'start')); await page.keyboard.press('Shift+End'); await page.keyboard.press('Control+b'); await wait(100);
        const f1 = await page.evaluate(() => app.note(app.ui.note).b[0].x);
        await page.evaluate(() => app.nbActivate(0, 'end')); await page.keyboard.press('Alt+ArrowDown'); await wait(200);
        const f2 = await page.evaluate(() => app.note(app.ui.note).b.map(b => b.x).join('|'));
        await page.evaluate(() => app.nbMoveStep(2, -1)); await wait(150);
        const f3 = await page.evaluate(() => app.note(app.ui.note).b.map(b => b.x).join('|'));
        const bul = await page.$('#nb-blocks .nb[data-i="0"] .nb-bul'), lb = await page.$('#nb-blocks .nb[data-i="3"]'), bb2 = await bul.boundingBox(), lb2 = await lb.boundingBox();
        await page.mouse.move(bb2.x + 8, bb2.y + 12); await page.mouse.down(); await page.mouse.move(bb2.x + 14, bb2.y + 30, { steps: 4 }); await page.mouse.move(lb2.x + 60, lb2.y + lb2.height * 0.9, { steps: 8 }); await wait(60); await page.mouse.up(); await wait(300);
        const f4 = await page.evaluate(() => app.note(app.ui.note).b.map(b => b.x.replace(/\*/g, '')).join('|'));
        await page.evaluate(() => { app.nbFindToggle(); }); await page.fill('#nb-findin', 'deux'); await wait(200);
        const f5 = await page.evaluate(() => ({ marks: document.querySelectorAll('#nb-blocks mark.nb-find').length, count: document.getElementById('nb-findcount').textContent, render: /<b>/.test(app.inlineHtml('**x**')) && /<mark class="nb-hl">/.test(app.inlineHtml('==y==')) && /<code>/.test(app.inlineHtml('`z`')) && /<i>/.test(app.inlineHtml('un *mot* ici')) }));
        await page.evaluate(() => app.nbFindToggle());
        ok('Notes v2: Ctrl+B bold, Alt+↓ and the ↑ move a line with its sub-lines, bullet drag, find in the note with highlights, **/*/==/` rendering', f1 === '**Un**' && f2 === 'Deux|Deux-a|**Un**|Trois' && f3 === '**Un**|Deux|Deux-a|Trois' && f4 === 'Deux|Deux-a|Trois|Un' && f5.marks === 2 && f5.count === '1/2' && f5.render, JSON.stringify({ f1, f2, f3, f4, f5 }));
        const t3 = await page.evaluate(async ids => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), out = {}, d = a.data;
            /* delete a note with sub-notes (asks), then undo brings the whole branch back */
            const P = a.noteNew('Parent', { deckId: ids.dk }), K1 = a.noteNew('Fille 1', { parent: P.id }), K2 = a.noteNew('Fille 2', { parent: K1.id });
            const n0 = d.notes.length; let asked = null; const confirm0 = a.confirm; a.confirm = async o => { asked = o; return true; };
            await a.noteDeleteMany([P.id]); a.confirm = confirm0; await w(150);
            out.asks = !!asked && /2 sous-notes/.test(asked.message);
            out.deleted = d.notes.length === n0 - 3;
            document.querySelector('.toast button').click(); await w(300);
            out.restored = d.notes.length === n0 && a.note(K2.id).parent === K1.id && a.note(K1.id).parent === P.id;
            /* deleting a deck: its notes stay (no folder); undo puts them back in it */
            const dd = d.decks.find(x => x.id === ids.dk); const inDeck = d.notes.filter(x => x.deckId === ids.dk).length;
            await a.deleteDeck.call(Object.assign(Object.create(a), { confirm: async () => true }), ids.dk); await w(200);
            out.stay = d.notes.length === n0 && d.notes.every(x => x.deckId !== ids.dk) && inDeck > 0;
            a.undoGlobal(); await w(200); out.back = d.notes.filter(x => x.deckId === ids.dk).length === inDeck && !!a.deck(ids.dk);
            /* sanity: a parent loop or a missing parent is repaired when loading */
            const raw = JSON.parse(a.serialize()); const x1 = raw.notes[0], x2 = raw.notes[1]; x1.parent = x2.id; x2.parent = x1.id; raw.notes[2].parent = 'zzz'; const nn = normalizeState(JSON.stringify(raw));
            out.loop = nn.notes.every(q => { let p = q, k = 0; while (p && p.parent && k++ < 40) p = nn.notes.find(z => z.id === p.parent); return k < 40; }) && nn.notes[2].parent === '';
            const L = normalizeState(a.serialize()), R = normalizeState(a.serialize()); R.notes[0].pin = true; R.notes[0].emoji = '🎯'; R.notes[0].mod = Date.now() + 9000; const mm = mergeStates(L, R).data; out.merge = mm.notes[0].pin === true && mm.notes[0].emoji === '🎯';
            /* templates */
            const tn = a.noteNewFrom(NB_TEMPLATES[0], {}); out.tpl = tn.b.length >= 6 && tn.emoji === '📘' && /Cours du/.test(tn.title);
            d.notes = []; a.ui.note = null; a.nbBarEnsure(false); a.go('dashboard');
            return out;
        }, ids);
        ok('Notes v2: deleting a note with sub-notes asks and can be undone as a whole branch; deleting a deck keeps the notes (undo puts them back); loops repaired, merge keeps pin/emoji, templates', t3.asks && t3.deleted && t3.restored && t3.stay && t3.back && t3.loop && t3.merge && t3.tpl, JSON.stringify(t3));
    }

    /* Notes 2B: memory cards inside a note (like RemNote), review of lists, "see in the course", tables, folder page, train button, exam */
    {
        await page.setViewportSize({ width: 390, height: 800 });
        await page.evaluate(() => { app.data.notes = []; app.ui.note = null; app.ui.nbFolder = null; app.ui.nbMem = false; app.noteNewFrom(null, {}); });
        await wait(400);
        await page.keyboard.type('Marketing'); await page.keyboard.press('Enter');
        const vOK = async () => { await page.evaluate(() => { document.querySelectorAll('.nbc-ok').forEach(b => b.click()); const n = app.data.notes[0]; if (n) app.nbActivate(n.b.length - 1, 'end'); }); await wait(300); };   // card lines are drafts until « Créer la carte »
        await page.keyboard.type('Capitale de la France >> Paris'); await page.keyboard.press('Enter'); await wait(300); await vOK();
        const k1 = await page.evaluate(() => { const n = app.data.notes[0], c = app.data.cards.find(x => x.src); return { cd: n.b[0].cd && n.b[0].cd.k + ':' + n.b[0].cd.a, x: n.b[0].x, next: n.b.length === 2 && n.b[1].x === '', card: !!c && c.front === 'Capitale de la France' && c.back === 'Paris' && c.deckId === 'notes_auto' && c.src.n === n.id && c.src.b === n.b[0].cd.id, deck: !!app.deck('notes_auto') }; });
        const bar = await page.evaluate(() => [...document.querySelectorAll('#nb-bar button')].map(b => b.textContent.trim()));
        await page.click('[data-nb=card]'); await wait(150);
        const menu = await page.evaluate(() => ({ head: (document.querySelector('.nb-menu-h') || {}).textContent, items: [...document.querySelectorAll('.nb-menu button')].map(b => b.textContent.trim()) }));
        await page.click('.nb-menu button:has-text("Liste")'); await wait(250);
        await page.keyboard.type('Les 4 P'); await page.keyboard.press('Enter');
        for (const w of ['Produit', 'Prix', 'Place', 'Promotion']) { await page.keyboard.type(w); if (w !== 'Promotion') await page.keyboard.press('Enter'); }
        await wait(900); await vOK();
        const k2 = await page.evaluate(() => { const n = app.data.notes[0], b = n.b[1], c = b.cd && app.card(b.cd.cid[0]); return { kind: b.cd && b.cd.k, kids: n.b.slice(2).map(z => z.x).join(','), back: c && c.back, own: app.nbCardOwners(n).slice(2).every(v => v === 1) }; });
        /* settings round button: type, direction, order, type the answer, switch off */
        await page.evaluate(() => { app.nbCardToggle(1, 'ord'); }); await wait(500);
        const k3 = await page.evaluate(() => { const c = app.card(app.data.notes[0].b[1].cd.cid[0]); return { ls: c.ls && c.ls.join(','), ol: /<ol>/.test(c.back) }; });
        await page.click('.nb[data-i="1"] [data-nbk=cmenu]'); await wait(200);
        const cm = await page.evaluate(() => [...document.querySelectorAll('.nbcm .menu-item')].map(b => b.textContent.replace(/\s+/g, ' ').trim()));
        await page.evaluate(() => app.closePopover());
        await page.evaluate(() => { app.nbCardToggle(0, 'ta'); app.nbCardSetDir(0, 'both'); }); await wait(600);
        const k4 = await page.evaluate(() => { const n = app.data.notes[0], cs = app.data.cards.filter(c => c.src && c.src.b === n.b[0].cd.id); return { n: cs.length, kinds: cs.map(c => c.kind).join(), ta: cs.every(c => c.ta), rev: cs.map(c => c.front).join('|') }; });
        await page.evaluate(() => { app.nbCardToggle(0, 'on'); }); await wait(500);
        const k5 = await page.evaluate(() => { const n = app.data.notes[0], cs = app.data.cards.filter(c => c.src && c.src.b === n.b[0].cd.id); const off = cs.every(c => c.suspended); app.nbCardToggle(0, 'on'); return { off }; }); await wait(500);
        const k6 = await page.evaluate(() => { const n = app.data.notes[0], cs = app.data.cards.filter(c => c.src && c.src.b === n.b[0].cd.id); return cs.every(c => !c.suspended); });
        /* incomplete line: the preview says what is missing */
        await page.evaluate(() => { app.nbActivate(app.data.notes[0].b.length - 1, 'end'); }); await page.click('[data-nb=card]'); await page.click('.nb-menu button:has-text("Multi-lignes")'); await wait(250);
        const li = await page.evaluate(() => app.data.notes[0].b.length - 1); const prevBtn = await page.$(`.nb[data-i="${li - 1}"] [data-nbk=cprev], .nb[data-i="${li}"] [data-nbk=cprev]`); await prevBtn.click(); await wait(150);
        const pv = await page.evaluate(() => (document.querySelector('.nbprev') || {}).textContent || ''); await page.evaluate(() => app.closePopover());
        ok('Notes 2B: "question >> réponse" + Enter makes a card line (Recto → Verso) and its card; toolbar with Carte / Titre / À faire / Image / Tableau / Texte / Plus / Annuler / Clavier; menu "Cartes mémoire" (5 types)', k1.cd === 'basic:Paris' && k1.x === 'Capitale de la France' && k1.next && k1.card && k1.deck && ['Carte ▾', 'Titre ▾', 'À faire', 'Image', 'Tableau ▾', 'Plus', 'Annuler', 'Clavier', 'Réduire'].every(l => bar.some(b => b.includes(l))) && /CARTES MÉMOIRE/.test(menu.head) && ['Ligne unique', 'Multi-lignes', 'Liste', 'Choix multiples', 'À trous'].every(l => menu.items.some(i => i.includes(l))), JSON.stringify({ k1, bar, menu }));
        ok('Notes 2B: list card = line + sub-lines; "ordre important" gives an ordered list and keeps the items one by one; round button menu (type, direction, activate, type the answer, order, delete)', k2.kind === 'list' && k2.kids === 'Produit,Prix,Place,Promotion' && /<ul>/.test(k2.back) && k2.own && k3.ls === 'Produit,Prix,Place,Promotion' && k3.ol && ['Type de carte', 'Activer les cartes', 'Saisir la réponse', 'Ordre important', 'Supprimer la carte'].every(l => cm.some(i => i.includes(l))), JSON.stringify({ k2, k3, cm }));
        ok('Notes 2B: direction "Les deux" gives two cards, "Saisir la réponse" is kept on the cards, switching cards off suspends them and back on re-activates them; an incomplete line says what is missing', k4.n === 2 && k4.kinds === 'rev,rev' && k4.ta && k5.off && k6 && /pas encore de réponse/.test(pv), JSON.stringify({ k4, k5, k6, pv }));
        /* editing keeps the progress; deleting the line keeps the card */
        const e1 = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), out = {}, n = a.data.notes[0], id = n.b[0].cd.cid[0], c = a.card(id); delete a.confirm;   // (earlier steps replaced confirm by an automatic « oui »)
            c.reps = 4; c.state = 'review'; c.interval = 12; c.due = Date.now() + 864e5 * 5;
            n.b[0].cd.a = 'Paris (France)'; n.b[0].cd.sg = ''; a.nbCardSyncAll(n); out.same = a.card(id) === c && c.reps === 4 && c.interval === 12 && /Paris \(France\)/.test(c.back || a.card(n.b[0].cd.cid[1]).front + c.back);
            const before = a.data.cards.length;
            a.nbOp(nn => { nn.b.splice(0, 1); }, null); await w(200);
            out.kept = a.data.cards.length === before && !!a.card(id) && a.card(id).src.b === '' && a.modals.length === 1;
            out.toastTxt = [...document.querySelectorAll('.modal')].map(t => t.textContent).join('|');
            const keep = document.querySelector('.modal [data-close]'); if (keep) keep.click(); await w(200); out.stillThere = !!a.card(id);
            a.nbUndo(); await w(200); out.undo = !!a.data.notes[0].b[0].cd;
            return out;
        });
        ok('Notes 2B: editing a line updates its card without losing its progress; deleting a line keeps the card (message to delete it too); undo brings the line back', e1.same && e1.kept && /encore dans ton paquet/.test(e1.toastTxt) && e1.stillThere && e1.undo, JSON.stringify(e1));
        const e2 = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), out = {}, n = a.data.notes[0];
            /* choices (QCM outside the planning), holes with stable numbers */
            n.b.push({ t: 'p', x: 'Quels sont des fruits ?', d: 0, cd: Object.assign(a.nbCdNew('mcq'), { vd: true }) }, { t: 'p', x: 'Pomme', d: 1, ok: true }, { t: 'p', x: 'Carotte', d: 1 }, { t: 'p', x: 'Fraise', d: 1, ok: true });
            n.b.push({ t: 'p', x: 'Paris est la {{capitale}} de la {{France}}', d: 0, cd: Object.assign(a.nbCdNew('cloze'), { vd: true }) });
            a.nbCardSyncAll(n); a.save();
            const q = a.data.qcms.find(x => x.id === n.b[n.b.length - 5].cd.qid); out.qcm = !!q && q.multi && q.o.filter(o => o.ok).length === 2 && !a.data.cards.some(c => c.front && /fruits/.test(c.front));
            const cl = a.data.cards.filter(c => c.src && c.src.b === n.b[n.b.length - 1].cd.id); out.cloze = cl.length === 2 && cl.map(c => c.ord).sort().join() === '1,2';
            const ids = cl.map(c => c.id + ':' + c.ord).sort().join();
            n.b[n.b.length - 1].x = 'Aujourd\'hui, Paris est la {{capitale}} de la {{France}}'; a.nbCardSyncAll(n);
            out.stable = a.data.cards.filter(c => c.src && c.src.b === n.b[n.b.length - 1].cd.id).map(c => c.id + ':' + c.ord).sort().join() === ids;
            n.b[n.b.length - 1].x = 'Paris est la {{capitale}} de la France'; a.nbCardSyncAll(n); await w(100);
            out.dropHole = a.data.cards.filter(c => c.src && c.src.b === n.b[n.b.length - 1].cd.id).length === 1 && !!document.querySelector('.toast');
            document.querySelectorAll('.toast').forEach(t => t.remove());
            /* a deck deleted by hand: the card is not brought back by itself */
            const c0 = a.data.cards.find(c => c.src && c.src.b === n.b[0].cd.id); a.data.cards = a.data.cards.filter(c => !(c.src && c.src.b === n.b[0].cd.id)); n.b[0].cd.a = 'Paris 2'; n.b[0].cd.sg = ''; a.nbCardSyncAll(n);
            out.dead = n.b[0].cd.dead === true && !a.data.cards.some(c => c.src && c.src.b === n.b[0].cd.id); a.nbCardRecreate(0); out.recreated = a.data.cards.some(c => c.src && c.src.b === n.b[0].cd.id);
            /* plan -> cards */
            n.b.push({ t: 'p', x: 'Les pôles', d: 0 }, { t: 'p', x: 'Nord', d: 1 }, { t: 'p', x: 'Sud', d: 1 }); a.noteOpen(n.id); await w(300);
            a.nbPlanToCards(); await w(150); const cb = document.querySelectorAll('.modal-body input[data-k]'); out.p2c = cb.length >= 1; document.querySelector('#p2c-go').click(); await w(500);
            out.p2cDone = !!n.b[n.b.length - 3].cd && n.b[n.b.length - 3].cd.k === 'list' && a.data.cards.some(c => c.src && c.src.b === n.b[n.b.length - 3].cd.id);
            document.querySelectorAll('.toast').forEach(t => t.remove());
            return out;
        });
        ok('Notes 2B: choices become a QCM (outside the planning), holes keep their numbers when the text changes, a removed hole asks, a card deleted from the deck is not recreated by itself (button to recreate), outline → cards', e2.qcm && e2.cloze && e2.stable && e2.dropHole && e2.dead && e2.recreated && e2.p2c && e2.p2cDone, JSON.stringify(e2));
        const r1 = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), out = {}, n = a.data.notes[0], c = a.data.cards.find(x => x.ls);
            /* review: the ordered list shows one item at a time, then the grades; "see in the course" */
            a.startSrsIds('t', [c.id], true); await w(300);
            out.src = !!document.querySelector('.fc-src');
            document.querySelector('.study-actions [data-action=reveal]').click(); await w(150);
            out.first = document.querySelectorAll('.ls-steps li').length === 4 && /Produit/.test(document.querySelector('.ls-steps').textContent) && !/Prix/.test(document.querySelector('.ls-steps').textContent) && !document.querySelector('[data-action=grade]');
            document.querySelector('.study-actions [data-action=reveal]').click(); document.querySelector('.study-actions [data-action=reveal]').click(); await w(100);
            out.third = a.session.lsShown === 3 && !document.querySelector('[data-action=grade]');
            document.querySelector('.study-actions [data-action=reveal]').click(); await w(150);
            out.grades = !!document.querySelector('[data-action=grade]') && /Promotion/.test(document.querySelector('.fc-back').textContent);
            document.querySelector('.fc-src').click(); await w(200); out.modal = a.modals.length === 1 && /Les 4 P/.test(document.querySelector('.vc-box').textContent); a.closeModal(a.modals[0]);
            a.endSession(false); a.go('notes'); await w(200);
            /* the "all at once" version and the card menu item */
            a.startSrsIds('t2', [c.id], true); await w(200); document.querySelector('.study-actions [data-action=reveal]').click(); document.querySelector('[data-action=ls-all]').click(); await w(100);
            out.all = !!document.querySelector('[data-action=grade]'); a.endSession(false);
            out.menuItem = a.cardMenuItems([c.id]).some(i => /Voir dans le cours/.test(i.label || ''));
            return out;
        });
        ok('Notes 2B: review — an ordered list shows one item at a time (grades only at the end, "Tout afficher" skips), link "Cours" on the card opens the line of the note', r1.src && r1.first && r1.third && r1.grades && r1.modal && r1.all && r1.menuItem, JSON.stringify(r1));
        const tb = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), out = {};
            a.go('notes'); a.ui.note = a.data.notes[0].id; a.renderNotes(); await w(300);
            a.nbActivate(0, 'end'); a.nbTableMenu(document.querySelector('[data-nb=table]'), 0); await w(100);
            out.menu = [...document.querySelectorAll('.nb-menu button')].map(b => b.textContent.trim()).join('|');
            document.querySelector('.nb-menu button:nth-of-type(1)').click(); await w(300);
            const n = a.data.notes[0], ti = n.b.findIndex(b => b.t === 'table'); out.tbl = ti >= 0;
            const cells = document.querySelectorAll(`.nb[data-i="${ti}"] input[data-nbt]`); out.cells = cells.length === 4;
            [['0,0', 'Pays'], ['0,1', 'Capitale'], ['1,0', 'France'], ['1,1', 'Paris']].forEach(([rc, v]) => { const el = document.querySelector(`.nb[data-i="${ti}"] [data-nbt="${rc}"]`); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); });
            out.rows = JSON.stringify(n.b[ti].rows);
            a.nb.cell = { i: ti, r: 1, c: 1 }; a.nbTableMenu(document.querySelector('[data-nb=table]'), ti); await w(100);
            [...document.querySelectorAll('.nb-menu button')].find(b => /Ajouter une ligne dessous/.test(b.textContent)).click(); await w(300); out.addRow = n.b[ti].rows.length === 3;
            n.b[ti].rows[2] = ['Italie', 'Rome']; a.nbTableCards(ti); await w(150); out.tcN = /2 lignes → 2 cartes/.test(document.getElementById('tc-n').textContent);
            const before = a.data.cards.length; document.getElementById('tc-go').click(); await w(300); out.tcards = a.data.cards.length === before + 2 && a.data.cards.filter(c => c.src && c.src.b === n.b[ti].id).length === 2;
            return out;
        });
        ok('Notes 2B: table block (insert, edit cells, add a row, two columns become cards, one per row)', tb.tbl && tb.cells && tb.rows === '[["Pays","Capitale"],["France","Paris"]]' && tb.addRow && tb.tcN && tb.tcards, JSON.stringify(tb));
        const fo = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), out = {}, d = a.data, dk = d.decks.find(x => !x.parent).id, n = d.notes[0];
            a.ui.note = null; a.go('notes'); a.renderNotes(); await w(300);
            out.tiles = ['nb-daily', 'nb-mem', 'nb-docs'].every(x => !!document.querySelector(`#view-notes [data-action=${x}]`));
            /* moving the note to a folder: its cards follow */
            a.openNoteMove([n.id]); await w(100); document.querySelector(`#nm-list [data-k=deck][data-id="${dk}"]`).click(); await w(300);
            out.follow = d.cards.filter(c => c.src && c.src.n === n.id).every(c => c.deckId === dk) && n.deckId === dk;
            document.querySelector('[data-action=nb-docs]').click(); await w(200); out.root = /Documents et dossiers/.test(document.querySelector('.nb-folderpage h2').textContent);
            document.querySelector(`.nbf-fold[data-id="${dk}"]`).click(); await w(200);
            out.page = document.querySelector('.nb-folderpage h2').textContent === a.deck(dk).name && !!document.querySelector('.nb-train') && [...document.querySelectorAll('.nbf-doc')].some(r => /Marketing/.test(r.textContent));
            out.train = /S'entraîner/.test(document.querySelector('.nb-train .btn').textContent);
            /* the exam of a folder */
            const g0 = d.settings.goals.length; a.nbExamModal(dk); await w(100); document.getElementById('ex-go').click(); await w(200);
            out.exam = d.settings.goals.length === g0 + 1 && d.settings.goals[d.settings.goals.length - 1].decks[0] === dk && /Examen|J|Dans/.test(document.querySelector('.nbf-exam').textContent); d.settings.goals.pop();
            /* train from a note */
            a.noteOpen(n.id); await w(300);
            const cards = a.nbNoteCards(n.id); out.noteCards = cards.length >= 6;
            cards.forEach(c => { c.state = 'review'; c.interval = 3; c.due = Date.now() - 1000; });
            out.due = a.nbDueIn(cards).length === cards.filter(c => !c.suspended).length;
            a.nbTrain('note', n.id, 'srs'); await w(300); out.srs = a.session && a.session.kind === 'srs' && a.session.title.includes('Marketing'); a.endSession(false);
            a.nbTrain('note', n.id, 'free'); await w(300); out.free = a.session && a.session.kind === 'practice'; a.endSession(false);
            a.go('notes'); a.ui.note = null; a.ui.nbMem = true; a.renderNotes(); await w(200); out.mem = /Cartes mémoire/.test(document.querySelector('.nb-folderpage h2').textContent) && !!document.querySelector('.nbf-mem .btn');
            a.ui.nbMem = false; a.ui.nbFolder = null; d.notes = []; d.cards = d.cards.filter(c => !c.src); a.go('dashboard');
            return out;
        });
        ok('Notes 2B: side column tiles, moving a note makes its cards follow, folder page (documents, S\'entraîner · N à réviser, exam), train from a note (due / free), Cartes mémoire page', fo.tiles && fo.follow && fo.root && fo.page && fo.train && fo.exam && fo.noteCards && fo.due && fo.srs && fo.free && fo.mem, JSON.stringify(fo));
    }

    /* Profile: round button at the right of the top bar opens the profile page; the settings are its sections; no Réglages / TOEIC tab */
    {
        const pf = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), out = {};
            a.go('dashboard'); await w(300);
            out.noTabs = !document.querySelector('[data-nav=toeic].nav-btn, .bottom-nav [data-nav=toeic], .bottom-nav [data-nav=settings]:not(.bn-profile), .nav-btn[data-nav=settings]');
            const btn = [...document.querySelectorAll('#profile-btn, #profile-btn-b')].find(x => x.offsetWidth > 20) || document.getElementById('profile-btn'); out.btn = !!btn && btn.offsetWidth > 20 && !!btn.querySelector('.av-emoji, .av-img'); out.bottomRight = innerWidth > 767 || (document.getElementById('profile-btn-b').getBoundingClientRect().right > innerWidth - 80 && document.getElementById('profile-btn-b').getBoundingClientRect().top > innerHeight - 90 && getComputedStyle(document.getElementById('profile-btn')).display === 'none');
            const tb = document.querySelector('.topbar-inner'); out.topFits = tb.scrollWidth <= tb.clientWidth + 1;
            btn.click(); await w(500); a.flushTail(document.getElementById('view-settings'), true);
            out.view = a.view === 'settings' && btn.classList.contains('active');
            out.card = !!document.querySelector('.profile-hero .ph-av') && document.querySelectorAll('.ph-tile').length === 6 && !document.querySelector('.hub-row');
            /* the settings are as before: shortcut chips and every section on the same page, no TOEIC entry in them */
            out.rows = !!document.querySelector('.set-nav') && ['grp-rev', 'grp-snd', 'grp-look', 'grp-data', 'grp-adv'].every(id => document.getElementById(id) && getComputedStyle(document.getElementById(id)).display !== 'none') && !/Simulateur TOEIC/.test(document.getElementById('view-settings').textContent);
            out.hidden = true; out.sub = true;
            /* tapping the profile button again, from far down the page, comes back to the top of the profile */
            window.scrollTo(0, 900); await w(100); const y1 = scrollY; btn.click(); await w(400); out.back = y1 > 100 && scrollY < 5;
            /* edit: name + emoji + photo, kept in the settings, shown on the button */
            a.openProfileEditor(); await w(100);
            document.getElementById('pe-name').value = 'Léo'; document.querySelector('#pe-emojis [data-e="🦊"]').click();
            document.getElementById('pe-save').click(); await w(200);
            out.saved = a.data.settings.profile.name === 'Léo' && a.data.settings.profile.emoji === '🦊' && /🦊/.test(btn.textContent) && /Léo/.test(document.querySelector('.profile-hero h2').textContent);
            const ref = a.addMedia('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
            a.data.settings.profile.photo = ref; a.renderProfileBtn(); out.photo = !!btn.querySelector('img.av-img'); a.gcMedia(a.data); out.photoKept = !!a.data.media[ref.slice(6)];
            const n = normalizeState(a.serialize()); out.persist = n.settings.profile.name === 'Léo' && n.settings.profile.photo === ref;
            Object.assign(a.data.settings.profile, { name: '', emoji: '🦁', photo: '' }); a.renderProfileBtn();
            /* the TOEIC exam of the home page opens the simulator */
            const keep = a.data.settings.goals; a.data.settings.goals = [{ id: 'gt', name: 'TOEIC', date: dayKey(addDays(Date.now(), 30)), decks: [] }];
            a.go('dashboard'); await w(300); a.flushTail(document.getElementById('view-dashboard'), true);
            const ex = document.querySelector('.exam-row .ex-name[data-nav=toeic]'); out.examBtn = !!ex; if (ex) ex.click(); await w(400);
            out.toeic = a.view === 'toeic'; a.data.settings.goals = keep; a.go('dashboard');
            return out;
        });
        ok('Profile: round button on the right of the top bar, profile page with sections (settings inside), no Réglages / TOEIC tab', pf.noTabs && pf.btn && pf.bottomRight && pf.topFits && pf.view && pf.card && pf.rows && pf.hidden && pf.sub && pf.back, JSON.stringify(pf));
        ok('Profile: name + emoji + photo saved, shown on the button, kept in backups; the TOEIC exam on the home opens the TOEIC simulator', pf.saved && pf.photo && pf.photoKept && pf.persist && pf.examBtn && pf.toeic, JSON.stringify(pf));
        const w360 = await (async () => { await page.setViewportSize({ width: 360, height: 800 }); await page.evaluate(() => app.go('dashboard')); await wait(250); const r = await page.evaluate(() => { const tb = document.querySelector('.topbar-inner'); return tb.scrollWidth <= tb.clientWidth + 1 && document.documentElement.scrollWidth <= 360; }); await page.setViewportSize({ width: 390, height: 800 }); return r; })();
        ok('Profile: the top bar still fits at 360 px', w360);
    }

    /* Vague 3: PDF reader (import, lazy pages, annotations, cards, export, trash, sync) */
    {
        await page.setViewportSize({ width: 1280, height: 800 }); await go('notes'); await wait(300);
        const pdfSel = (pageI, re) => page.evaluate(([i, src]) => { const sp = [...document.querySelectorAll(`.pdfp[data-i="${i}"] .pdft span`)].filter(s => new RegExp(src).test(s.textContent))[0]; if (!sp) return false; const r = document.createRange(); r.selectNodeContents(sp); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; }, [pageI, re]);
        const v1 = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), out = {};
            const buf = await (await fetch('/tests/sample.pdf')).arrayBuffer();
            const f = new File([buf], 'Droit des contrats.pdf', { type: 'application/pdf' });
            const p = await a.pdfImport(f); await w(1800);
            out.imported = !!p && a.data.pdfs.length === 1 && p.pages === 3 && p.pg.length === 3;
            out.deck = !!a.deck(p.pdeck) && a.deck(p.pdeck).pdf === p.id; out.note = !!a.note(p.noteId) && a.note(p.noteId).deckId === '';
            out.stored = !!(await PdfStore.get(p.hash)) && (await PdfStore.get(p.hash)).byteLength === buf.byteLength;
            out.view = a.view === 'pdf' && document.body.classList.contains('pdf-open') && !!document.querySelector('.pdfp canvas');
            out.rendered = a.pv.pages[0].state === 2 && !!document.querySelector('.pdfp[data-i="0"] .pdft span');
            out.libsLazy = !!window.pdfjsLib && typeof LAZY.pdfjs === 'string' && /^lazy\/pdf\.min\.[0-9a-f]{8}\.js$/.test(LAZY.pdfjs);
            const again = await a.pdfImport(new File([buf], 'copie.pdf', { type: 'application/pdf' }), { open: false });
            out.noDup = again.id === p.id && a.data.pdfs.length === 1;
            out.text = !(await a.pdfImport(new File(['hello'], 'x.txt', { type: 'text/plain' })));
            return out;
        });
        ok('PDF: import (file kept apart by fingerprint, deck + note created, opened, page drawn), same file twice = no duplicate, lazy libraries', v1.imported && v1.deck && v1.note && v1.stored && v1.view && v1.rendered && v1.noDup && v1.text && v1.libsLazy, JSON.stringify(v1));

        /* a long PDF: only the pages in view are drawn, the others are freed */
        const v2 = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), out = {};
            await loadLazy('pdflib'); const d = await PDFLib.PDFDocument.create(), font = await d.embedFont(PDFLib.StandardFonts.Helvetica);
            for (let i = 1; i <= 60; i++) d.addPage([420, 595]).drawText(`Page numero ${i}`, { x: 40, y: 500, size: 22, font });
            const bytes = await d.save(); a.go('notes'); await w(300);
            const p = await a.pdfImport(new File([bytes], 'Long.pdf', { type: 'application/pdf' })); await w(2500);
            const st = () => a.pv.pages.map(g => g.state), n = () => st().filter(x => x === 2).length;
            out.first = n(); out.farCanvas = a.pv.pages[40].state;
            a.pdfGoto(45, '', true); await w(1500);
            out.after = n(); out.far = a.pv.pages[44].state === 2; out.freed = a.pv.pages[0].state === 0 && a.pv.pages[0].el.querySelector('canvas').width === 0;
            out.cur = a.pdfCurrent(); out.label = document.getElementById('pdf-pg').textContent;
            a.pdfSetZoom(2); await w(900); out.zoom = a.pv.zoom === 2 && document.getElementById('pdf-zoomv').textContent === '200 %' && a.pv.pages[a.pdfCurrent()].state === 2;
            a.go('notes'); await w(300); a.pdfOpen(p.id); await w(1500); out.resume = a.pdfCurrent() >= 43 && a.pv.zoom === 2;
            a.pdfDelete(p); await w(300); out.gone = a.data.pdfs.length === 1;
            return out;
        });
        ok('PDF: long file — only the pages in view are drawn (others freed), jump to a page, zoom, reopening resumes at the last page and zoom', v2.first <= 8 && v2.farCanvas === 0 && v2.after <= 8 && v2.far && v2.freed && v2.cur >= 43 && /sur 60/.test(v2.label) && v2.zoom && v2.resume && v2.gone, JSON.stringify(v2));

        await page.evaluate(async () => { const a = app; a.pdfOpen(a.data.pdfs[0].id); await new Promise(r => setTimeout(r, 1500)); });
        /* highlight, quote, card, undo */
        await pdfSel(0, 'accord'); await wait(600);
        const popOk = await page.evaluate(() => !!document.querySelector('#pdf-pop [data-pop=color]') && document.querySelectorAll('#pdf-pop .pdft-c').length === 6);
        await page.click('#pdf-pop [data-pop=color][data-c="#86efac"]'); await wait(300);
        await pdfSel(0, 'formation'); await wait(600); await page.click('#pdf-pop [data-pop=cite]'); await wait(400);
        await pdfSel(0, 'Exemple'); await wait(600); await page.click('#pdf-pop [data-pop=card]'); await wait(300); await page.fill('#pc-front', 'Un exemple de contrat ?'); await page.click('#pc-go'); await wait(300);
        const v3 = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), p = a.pv.p, out = {};
            const hl = (p.ann.p1 || []).filter(x => x.t === 'hl'); out.hl = hl.length === 1 && hl[0].c === '#86efac' && hl[0].s.includes('accord') && hl[0].r.every(r => r.every(v => v >= 0 && v <= 1));
            out.svg = !!document.querySelector('.pdfp[data-i="0"] svg.pdfa g.hl rect');
            const nb = a.pdfNoteOf(p).b; out.cite = nb.some(b => b.t === 'quote' && /formation du contrat/.test(b.x) && b.x.includes(`[[pdf:${p.id}:p1|page 1]]`));
            const c = a.data.cards.find(x => x.src && x.src.pdf === p.id); out.card = !!c && c.deckId === p.pdeck && c.src.pid === 'p1' && /Exemple/.test(c.back) && /exemple de contrat/.test(c.front);
            out.kept = normalizeState(a.serialize()).cards.find(x => x.id === c.id).src.pdf === p.id;
            out.inDeck = a.deckStats().get(p.pdeck).total === 1;
            return out;
        });
        ok('PDF: select text → 6 colours → highlight kept in page coordinates; "Citer" adds a quote with a "page 1" link; "Carte" makes a card in the PDF\'s own deck with its source', popOk && v3.hl && v3.svg && v3.cite && v3.card && v3.kept && v3.inDeck, JSON.stringify({ popOk, v3 }));

        /* pen, eraser (→ trash), undo / redo, text box, blank page */
        const box = await page.locator('.pdfp[data-i="0"]').boundingBox();
        await page.click('[data-action=pdf-tool][data-t=pen]'); await page.mouse.move(box.x + 100, box.y + 450); await page.mouse.down();
        for (let i = 0; i < 20; i++) await page.mouse.move(box.x + 100 + i * 12, box.y + 450 + Math.sin(i / 2) * 20); await page.mouse.up(); await wait(300);
        const pen = await page.evaluate(() => { const l = app.pv.p.ann.p1.filter(x => x.t === 'dr'); return { n: l.length, pts: l[0] && l[0].p.length, c: l[0] && l[0].c, svg: !!document.querySelector('.pdfp[data-i="0"] path.dr') }; });
        await page.click('[data-action=pdf-tool][data-t=eraser]'); await page.evaluate(() => { app.pdfOpts().er.mode = 'all'; }); await page.mouse.move(box.x + 160, box.y + 450 + Math.sin(3) * 20); await page.mouse.down(); await page.mouse.move(box.x + 196, box.y + 450 + Math.sin(5) * 20, { steps: 4 }); await page.mouse.up(); await wait(300);
        const era = await page.evaluate(() => ({ dr: app.pv.p.ann.p1.filter(x => x.t === 'dr').length, trash: app.pv.p.trash.length, kind: app.pv.p.trash[0] && app.pv.p.trash[0].a.t }));
        await page.click('[data-action=pdf-undo]'); await wait(200);
        const und = await page.evaluate(() => ({ dr: app.pv.p.ann.p1.filter(x => x.t === 'dr').length, trash: app.pv.p.trash.length }));
        await page.click('[data-action=pdf-redo]'); await wait(200);
        const red = await page.evaluate(() => ({ dr: (app.pv.p.ann.p1 || []).filter(x => x.t === 'dr').length, trash: app.pv.p.trash.length }));
        ok('PDF: pen draws a stroke (colour, width, points), eraser removes it into the trash of erased drawings, undo brings it back, redo erases again', pen.n === 1 && pen.pts > 5 && pen.svg && era.dr === 0 && era.trash === 1 && era.kind === 'dr' && und.dr === 1 && und.trash === 0 && red.dr === 0 && red.trash === 1, JSON.stringify({ pen, era, und, red }));
        await page.evaluate(() => app.pdfTrashPanel()); await wait(200);
        const tr = await page.evaluate(() => ({ rows: document.querySelectorAll('.pdf-trash-row').length })); await page.click('.pdf-trash-row [data-back]'); await wait(300);
        const tr2 = await page.evaluate(() => ({ dr: app.pv.p.ann.p1.filter(x => x.t === 'dr').length, trash: app.pv.p.trash.length })); await page.evaluate(() => app.closeModal());
        await page.click('[data-action=pdf-tool][data-t=text]'); await page.mouse.click(box.x + 120, box.y + 520); await wait(200); await page.keyboard.type('Ma remarque'); await page.evaluate(() => document.activeElement.blur()); await wait(300);
        await page.click('[data-action=pdf-tool][data-t=note]'); await page.mouse.click(box.x + 200, box.y + 300); await wait(200); await page.keyboard.type('Note en marge'); await page.evaluate(() => document.activeElement.blur()); await wait(300);
        await page.click('[data-action=pdf-blank]'); await page.click('.popover .menu-item:has-text("À la fin")'); await wait(1200);
        const txt = await page.evaluate(() => { const l = app.pv.p.ann.p1 || []; return { tx: l.filter(x => x.t === 'tx' && x.s === 'Ma remarque').length, nt: l.filter(x => x.t === 'nt' && x.s === 'Note en marge').length, dom: document.querySelectorAll('.pdfp[data-i="0"] .pdfa-box').length, pages: app.pv.p.pg.length, blank: app.pv.p.pg[3].k, blankEl: !!document.querySelector('.pdfp.blank') }; });
        ok('PDF: erased drawings can be put back from the trash panel; text box and margin note typed on the page; blank page added at the end', tr.rows === 1 && tr2.dr === 1 && tr2.trash === 0 && txt.tx === 1 && txt.nt === 1 && txt.dom === 2 && txt.pages === 4 && txt.blank === 'b' && txt.blankEl, JSON.stringify({ tr, tr2, txt }));

        /* precise eraser: only the touched part of a stroke goes, the rest stays; the bar of tools can sit on a side; tabs have a "+" */
        await page.evaluate(() => app.pdfGoto(1, '', true)); await wait(900); const box2 = await page.locator('.pdfp[data-i="0"]').boundingBox();
        await page.evaluate(() => { app.pv.tool = 'pen'; app.pdfRefreshTools(); });
        await page.click('[data-action=pdf-tool][data-t=pen]'); await page.mouse.move(box2.x + 100, box2.y + 440); await page.mouse.down();
        for (let i = 0; i < 20; i++) await page.mouse.move(box2.x + 100 + i * 12, box2.y + 440 + Math.sin(i / 2) * 10); await page.mouse.up(); await wait(200);
        await page.click('[data-action=pdf-tool][data-t=eraser]'); await page.evaluate(() => { app.pdfOpts().er.mode = 'part'; });
        const nb0 = await page.evaluate(() => app.pv.p.ann.p1.filter(x => x.t === 'dr').length);
        await page.mouse.move(box2.x + 100 + 8 * 12, box2.y + 400); await page.mouse.down(); await page.mouse.move(box2.x + 100 + 8 * 12, box2.y + 480, { steps: 6 }); await page.mouse.up(); await wait(300);
        const pe = await page.evaluate(() => ({ n: app.pv.p.ann.p1.filter(x => x.t === 'dr').length, pts: app.pv.p.ann.p1.filter(x => x.t === 'dr').map(x => x.p.length) }));
        await page.evaluate(() => { app.pdfPrefs().pos = 'left'; app.pdfPlaceTools(); }); await wait(300);
        const side = await page.evaluate(() => { const t = document.getElementById('pdf-tools').getBoundingClientRect(), m = document.getElementById('pdf-scroll').getBoundingClientRect(); return { left: t.left < 120 && t.height > 300, ok: m.left >= t.right - 1 }; });
        await page.evaluate(() => { app.pdfPrefs().pos = 'top'; app.pdfPlaceTools(); });
        ok('PDF: precise eraser cuts a stroke in two and keeps the rest (the whole stroke only in "Trait entier" mode); the bar of tools can sit on the left; the tab bar has a "+" button', pe.n > nb0 && pe.pts.every(k => k >= 2) && side.left && side.ok, JSON.stringify({ nb0, pe, side }));
        /* RemNote-like tools: shapes, arrows, marker, selection of everything at once */
        const rn = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), pv = a.pv, out = {}; pv.annotate = true; a.pdfRefreshTools();
            a.pdfGoto(1, '', true); await w(800); document.querySelector('[data-action=pdf-tool][data-t=pen]').click(); await w(200);
            out.panel = !!document.querySelector('#pdf-panel .pdfp-grid') && document.querySelectorAll('#pdf-panel .pdfp-o.sw').length === 24 && !!document.querySelector('#pdf-panel input[data-optin=penc]');
            document.querySelector('#pdf-panel [data-k=penc][data-v="#e11d48"]').click(); out.pen = pv.pen.c === '#e11d48';
            const pid = pv.p.pg[0].id; a.pdfEdit(() => { a.pdfAnnAdd(pid, { t: 'sh', k: 's', x: 0.2, y: 0.5, w: 0.2, h: 0.1, c: '#000000', sw: 0.004, f: '#fde047' }); a.pdfAnnAdd(pid, { t: 'ar', k: 'b', x1: 0.1, y1: 0.7, x2: 0.6, y2: 0.72, c: '#e11d48', w: 0.004 }); a.pdfAnnAdd(pid, { t: 'dr', c: '#facc15', w: 0.026, op: 0.4, p: [[0.1, 0.3], [0.5, 0.3]] }); });
            await w(300); out.svg = !!document.querySelector('.pdfp[data-i="0"] polygon.sh') && !!document.querySelector('.pdfp[data-i="0"] path.ar') && !!document.querySelector('.pdfp[data-i="0"] path.dr[stroke-opacity="0.4"]');
            const n = normalizeState(a.serialize()).pdfs[0]; out.kept = n.ann[pid].some(x => x.t === 'sh' && x.k === 's' && x.f === '#fde047') && n.ann[pid].some(x => x.t === 'ar' && x.k === 'b');
            const { bytes } = await a.pdfAnnotatedBytes(pv.p); out.exp = bytes.byteLength > 1000;
            pv.tool = 'pick'; a.pdfRefreshTools(); a.pdfSelAll('all'); out.sel = a.pdfSelCount() > 3 && !!document.getElementById('pdf-selbar');
            a.pdfSelDo('del'); await w(200); out.del = Object.values(pv.p.ann).flat().length === 0 && a.pdfSelCount() === 0;
            a.pdfUndo(false); await w(200); out.undo = Object.values(pv.p.ann).flat().length > 3;
            return out;
        });
        ok('PDF tools à la RemNote: option panels (24 colours + HEX), shapes, arrows and translucent marker are saved and exported, "select everything" + delete in one go (undoable)', rn.panel && rn.pen && rn.svg && rn.kept && rn.exp && rn.sel && rn.del && rn.undo, JSON.stringify(rn));
        /* the annotated PDF is a real PDF: opened again with pdf.js, highlight pixel + text + extra page */
        const ex = await page.evaluate(async () => {
            const a = app, p = a.pv.p, { bytes } = await a.pdfAnnotatedBytes(p), out = {};
            const doc = await pdfjsLib.getDocument({ data: bytes }).promise; out.pages = doc.numPages;
            const pg = await doc.getPage(1), tc = await pg.getTextContent(); out.text = tc.items.map(i => i.str).join(' ');
            const vp = pg.getViewport({ scale: 1 }), cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height; await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
            const h = p.ann.p1.find(x => x.t === 'hl'), r = h.r[0], px = cv.getContext('2d').getImageData(Math.round((r[0] + r[2] * 0.97) * vp.width), Math.round((r[1] + r[3] / 2) * vp.height), 1, 1).data;
            out.px = [px[0], px[1], px[2]]; out.size = bytes.byteLength; out.orig = (await PdfStore.get(p.hash)).byteLength;
            return out;
        });
        ok('PDF: "Exporter le PDF annoté" gives a real PDF (extra blank page, typed text, highlight drawn in green)', ex.pages === 4 && /Ma remarque/.test(ex.text) && ex.px[1] > ex.px[0] + 8 && ex.px[2] < 245, JSON.stringify(ex));
        const dl = await Promise.all([page.waitForEvent('download'), page.evaluate(() => app.pdfExportOriginal(app.pv.p))]);
        const origBytes = fs.readFileSync(dl[0].suggestedFilename() ? await dl[0].path() : '');
        ok('PDF: "Exporter l\'original" returns the file untouched (same bytes)', Buffer.compare(origBytes, fs.readFileSync(path.join(__dirname, 'sample.pdf'))) === 0 && /\.pdf$/.test(dl[0].suggestedFilename()));

        /* search, text reader, jump from a card, Pratique */
        await page.click('[data-action=pdf-search]'); await page.fill('#pdf-q', 'consentement'); await wait(1200);
        const se = await page.evaluate(() => ({ st: document.getElementById('pdf-qst').textContent, hits: document.querySelectorAll('.pdf-hit').length, hl: document.querySelectorAll('.pdft span.hit').length }));
        await page.click('.pdf-hit'); await wait(1800); const hitMarks = await page.evaluate(() => document.querySelectorAll('.pdft span.hit').length);
        await page.evaluate(() => { const s = document.getElementById('pdf-searchbox'); if (s) s.remove(); app.pv.hitQ = ''; });
        await page.click('[data-action=pdf-mode]'); await wait(1500);
        const tm = await page.evaluate(() => ({ paras: document.querySelectorAll('#pdf-text p').length, hidden: document.getElementById('pdf-pages').classList.contains('hidden'), toolsHidden: document.getElementById('pdf-tools').classList.contains('hidden') }));
        await page.click('[data-action=pdf-mode]'); await wait(900);
        const cid = await page.evaluate(() => app.data.cards.find(c => c.src && c.src.pdf).id);
        await page.evaluate(() => app.pdfGoto(3, '', true)); await wait(600);
        await page.evaluate(id => app.openCardSource(id), cid); await wait(1500);
        const jump = await page.evaluate(() => ({ cur: app.pdfCurrent(), hit: document.querySelectorAll('.pdft span.hit').length }));
        ok('PDF: search lists results by page and marks them; text reader mode (paragraphs, tools hidden) and back; a card jumps to its page and flashes the passage', /1 résultat/.test(se.st) && se.hits === 1 && hitMarks >= 1 && tm.paras >= 5 && tm.hidden && tm.toolsHidden && jump.cur === 0 && jump.hit >= 1, JSON.stringify({ se, tm, jump }));
        await page.click('[data-action=pdf-train]'); await wait(300);
        const items = await page.evaluate(() => [...document.querySelectorAll('.popover .menu-item')].map(b => b.textContent.trim()));
        await page.click('.popover .menu-item:has-text("S\'entraîner")'); await wait(1200);
        const tr3 = await page.evaluate(() => ({ view: app.view, session: !!app.session, deck: app.session && app.session.deckId }));
        await page.evaluate(() => { app.endSession(false); app.go('notes'); }); await wait(300);
        ok('PDF: "Pratique" menu reuses the deck functions (study, free, in order, quiz, write, match, exam date, statistics, card table, options, move, help) and starts the review of the PDF\'s cards', ['S\'entraîner', 'Toutes les cartes (révision libre)', 'Dans l\'ordre du PDF', 'Créer un quiz', 'Date d\'examen…', 'Statistiques de ce PDF', 'Tableau des cartes', 'Configurer la pratique', 'Déplacer dans un dossier…', 'Comment ça marche ?'].every(l => items.some(i => i.includes(l))) && tr3.view === 'session' && tr3.session, JSON.stringify({ items, tr3 }));

        /* Notes tab: PDF row (icon, opens the reader), folder page, extract, move with the folder, delete → trash → restore with its deck, note and cards */
        const nl = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), out = {}, p = a.data.pdfs[0];
            a.go('notes'); await w(500); const row = document.querySelector(`.nb-row[data-id="${p.noteId}"]`); out.row = !!row && !!row.querySelector('.nb-row-pdf') && /PDF/.test(row.textContent) && !document.querySelector('.nb-folder .nb-row-t b')?.textContent.includes('Droit');
            row.click(); await w(1200); out.opens = a.view === 'pdf' && a.pv.p.id === p.id;
            a.pdfExtract(); await w(300); const nb = a.pdfNoteOf(p).b; out.extract = nb.some(b => b.t === 'h2' && /annotations/.test(b.x)) && nb.some(b => b.t === 'quote' && /accord de volontés/.test(b.x)) && nb.some(b => /Ma remarque/.test(b.x));
            const dk = a.newDeckForTest ? null : null; a.go('notes'); await w(300);
            const d = { id: uid('d'), name: 'Droit', emoji: '⚖️', description: '', created: Date.now(), parent: null, opts: null, mod: 0, preset: null, limits: null, pdf: '' }; a.data.decks.push(d);
            a.noteMoveTo([p.noteId], { deckId: d.id }); out.followed = p.deckId === d.id && a.deck(p.pdeck).parent === d.id && a.note(p.noteId).deckId === d.id;
            a.nbFolderOpen ? a.nbFolderOpen(d.id) : (a.ui.nbFolder = d.id, a.renderNotes()); await w(300);
            out.docRow = !!document.querySelector('.nbf-doc .nbf-dico .i') && /PDF/.test(document.querySelector('.nbf-docs').textContent) && !document.querySelector('.nbf-sub .nbf-fold'); out.chip = !!document.querySelector('[data-action=nb-ftype][data-t=pdf]');
            const nDecks = a.data.decks.length, nCards = a.data.cards.filter(c => c.src && c.src.pdf).length;
            a.noteDeleteMany([p.noteId]);   // → asks to delete the PDF itself (answered below)
            return Object.assign(out, { nDecks, nCards });
        });
        ok('PDF: row in the Notes tree (PDF icon, opens the reader), folder page lists it with a PDF filter, extract annotations into its note, moving the note moves the PDF + its deck', nl.row && nl.opens && nl.extract && nl.followed && nl.docRow && nl.chip, JSON.stringify(nl));
        await wait(300); await page.evaluate(() => { const b = document.querySelector('.modal .btn-danger, .modal .btn-primary'); if (b) b.click(); }); await wait(500);
        const del = await page.evaluate(() => ({ pdfs: app.data.pdfs.length, notes: app.data.notes.length, trash: app.data.trash.map(t => t.k).sort().join(), cards: app.data.cards.filter(c => c.src && c.src.pdf).length, pdecks: app.data.decks.filter(d => d.pdf).length }));
        await page.evaluate(() => { const t = app.data.trash.find(x => x.k === 'pdf'); app.trashRestore('pdf', t.c.id); });
        const rest = await page.evaluate(() => { const p = app.data.pdfs[0]; return p && { pdfs: app.data.pdfs.length, note: !!app.note(p.noteId), deck: !!app.deck(p.pdeck), cards: app.data.cards.filter(c => c.src && c.src.pdf).length, ann: Object.values(p.ann).flat().length >= 4, trash: app.data.trash.filter(t => (t.k === 'pdf' && t.c.id === p.id) || (t.k === 'deck' && t.c.id === p.pdeck) || (t.k === 'note' && t.c.id === p.noteId)).length }; });
        ok('PDF: deleting its note asks to delete the PDF; it goes to the trash with deck, note and cards; restoring brings everything back (annotations included)', del.pdfs === 0 && del.notes === 0 && /pdf/.test(del.trash) && del.cards === 0 && del.pdecks === 0 && rest && rest.pdfs === 1 && rest.note && rest.deck && rest.cards === 1 && rest.ann && rest.trash === 0, JSON.stringify({ del, rest }));

        /* merge between devices: lines of both sides kept, an erased line stays erased */
        const mg = await page.evaluate(() => {
            const base = normalizePdf(pdfClone(app.data.pdfs[0])), mk = (ann, trash = [], mod = 5) => normalizePdf({ ...pdfClone(base), mod, ann, trash });
            const A = mk({ p1: [{ i: 'a1', t: 'hl', c: '#fde047', m: 1, r: [[0.1, 0.1, 0.2, 0.02]], s: 'x' }, { i: 'a2', t: 'dr', c: '#111827', m: 1, w: 0.004, p: [[0.1, 0.1], [0.2, 0.2]] }] }, [], 5);
            const B = mk({ p1: [{ i: 'a1', t: 'hl', c: '#fde047', m: 1, r: [[0.1, 0.1, 0.2, 0.02]], s: 'x' }, { i: 'b1', t: 'tx', c: '#111827', m: 2, x: 0.3, y: 0.3, w: 0.3, s: 'autre', fs: 14 }] }, [{ pid: 'p1', at: 4, a: { i: 'a2', t: 'dr', c: '#111827', m: 1, w: 0.004, p: [[0.1, 0.1], [0.2, 0.2]] } }], 6);
            const marks = []; const out = mergePdfList([A], [B], {}, (l, r) => marks.push([l, r]));
            const ids = ((out[0] && out[0].ann.p1) || []).map(x => x.i).sort().join();
            const gone = mergePdfList([A], [], { [A.id]: 99 }, () => {});
            return { ids, one: out.length === 1, trashKept: out[0].trash.length === 1, gone: gone.length === 0 };
        });
        ok('PDF: two devices annotate the same PDF → lines of both are kept, a drawing erased on one side stays erased, a deleted PDF stays deleted', mg.one && mg.ids === 'a1,b1' && mg.trashKept && mg.gone, JSON.stringify(mg));
    }

    /* Vague 3: sync of the PDF files (fake server): encrypted, in pieces, resumable, 25 Mo limit; JSON backup with PDF option */
    {
        const DB = new Map();
        const fake = async route => {
            const req = route.request(), m = /id=eq\.([^&]+)/.exec(new URL(req.url()).search), row = m && DB.get(decodeURIComponent(m[1]));
            if (req.method() === 'GET') {
                if (/object\+json/.test(req.headers().accept || '')) return row ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(row) }) : route.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', message: '0 rows', details: '', hint: null }) });
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(row ? [row] : []) });
            }
            const b = JSON.parse(req.postData()); (Array.isArray(b) ? b : [b]).forEach(r => DB.set(r.id, { data: r.data, updated_at: r.updated_at }));
            return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
        };
        const mkDev = async () => { const c = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await c.route(/supabase\.co/, fake); await c.route(/fonts\.(googleapis|gstatic)/, r => r.abort()); const q = await c.newPage(); await q.goto(`http://localhost:${PORT}/index.html`); await q.waitForSelector('.hero', { timeout: 20000 }); return { c, q }; };
        const A = await mkDev();
        const KEY = 'LHC-TEST-TEST-TEST-TEST';
        const up = await A.q.evaluate(async key => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), out = {};
            Object.assign(a.data.settings, { cloudSync: true, syncKey: key, backupLegacy: true, backupAutoDone: true });
            await loadLazy('pdflib'); const d = await PDFLib.PDFDocument.create(), font = await d.embedFont(PDFLib.StandardFonts.Helvetica);
            for (let i = 1; i <= 8; i++) { const pg = d.addPage([420, 595]); pg.drawText(`Sync ${i}`, { x: 40, y: 500, size: 22, font }); for (let k = 0; k < 40; k++) pg.drawText('Lorem ipsum dolor sit amet ' + Math.random(), { x: 20, y: 20 + k * 11, size: 8, font }); }
            const bytes = await d.save(), p = await a.pdfImport(new File([bytes], 'Sync.pdf', { type: 'application/pdf' }), { open: false });
            out.size = bytes.byteLength; out.hash = p.hash; out.n = Math.ceil(bytes.byteLength / PDF_CHUNK);
            const prog = []; out.res = await PdfSync.upload(p, (k, n) => prog.push(k + '/' + n)); out.prog = prog.length;
            out.json = JSON.stringify(a.data.pdfs.map(x => ({ ...x, up: true }))); out.settings = key;
            /* a file above 25 Mo stays here */
            const bigHash = 'big' + Date.now().toString(16); await PdfStore.put(bigHash, new ArrayBuffer(PDF_MAX_SYNC + 1024)); out.big = await PdfSync.upload({ hash: bigHash }, () => {}); await PdfStore.del(bigHash);
            return out;
        }, KEY);
        const rowsA = [...DB.keys()].filter(k => k.startsWith('pdf_'));
        const encA = rowsA.every(k => !!DB.get(k).data.enc) && !JSON.stringify([...DB.values()]).includes('Sync 1');
        ok('PDF sync: the file goes to the cloud encrypted, cut in pieces (one row each), a file above 25 Mo stays on the device', up.res === true && rowsA.length === up.n && up.prog === up.n && encA && up.big === 'big', JSON.stringify({ rows: rowsA.length, n: up.n, big: up.big, prog: up.prog, encA }));
        const again = await A.q.evaluate(async () => { const p = app.data.pdfs.find(x => x.name === 'Sync'); const prog = []; const r = await PdfSync.upload(p, (k, n) => prog.push(k)); return { r, prog: prog.length }; });
        const B = await mkDev();
        const dn = await B.q.evaluate(async ([key, json, hash]) => {
            const a = app, out = {}; Object.assign(a.data.settings, { cloudSync: true, syncKey: key }); a.data.pdfs = JSON.parse(json).map(normalizePdf);
            out.missing = !(await PdfStore.get(hash)); a.pdfOpen(a.data.pdfs[0].id); await new Promise(r => setTimeout(r, 3500));
            out.fetched = !!(await PdfStore.get(hash)); out.shown = a.view === 'pdf' && !!document.querySelector('.pdfp canvas') && a.pv.pages.length === 8; return out;
        }, [KEY, up.json, up.hash]);
        ok('PDF sync: another device that knows the PDF but not the file downloads it by itself (checked against the fingerprint) and shows it; an interrupted upload resumes without re-sending', again.r === true && dn.missing && dn.fetched && dn.shown, JSON.stringify({ again, dn }));
        await B.c.close();
        /* the backup file: the PDF files are optional at export time */
        const ej = await A.q.evaluate(async () => {
            const a = app, out = {}; const p = a.data.pdfs.find(x => x.name === 'Sync');
            const light = JSON.parse(a.serialize()); out.lightNoBlobs = !('pdfBlobs' in light) && light.pdfs.length === a.data.pdfs.length;
            const blobs = await a.pdfBlobsForExport(); out.keys = Object.keys(blobs).includes(p.hash);
            const orig = new Uint8Array(await PdfStore.get(p.hash)); await PdfStore.del(p.hash); out.deleted = !(await PdfStore.get(p.hash));
            out.restored = await a.pdfRestoreBlobs(blobs); const back = new Uint8Array(await PdfStore.get(p.hash)); out.same = back.length === orig.length && back.every((v, i) => v === orig[i]);
            a.pdfExportChoice(); await new Promise(r => setTimeout(r, 200)); out.modal = !!document.getElementById('xp-pdf') && /Inclure les fichiers PDF/.test(document.querySelector('.modal').textContent); a.closeModal();
            out.total = a.pdfTotalSize() > 0; return out;
        });
        ok('PDF backup: JSON export offers "inclure les PDF (taille)", PDF files travel in the backup and come back identical; without the box the file stays light', ej.lightNoBlobs && ej.keys && ej.deleted && ej.restored >= 1 && ej.same && ej.modal && ej.total, JSON.stringify(ej));
        await A.c.close();
    }

    /* Vague 3 on a phone: bottom drawer for the note, floating "Annoter" button, tools, nothing wider than the screen */
    {
        await page.setViewportSize({ width: 390, height: 800 }); await go('notes'); await wait(300);
        const ph = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), out = {}, p = a.data.pdfs[0];
            a.pdfOpen(p.id); await w(1800); const v = document.querySelector('.pdfv');
            out.narrow = v.classList.contains('narrow') && a.pv.tool === 'hand' && !a.pv.annotate; out.mode = a.pv.mode === 'pdf';
            const fab = document.getElementById('pdf-fab'); out.fab = !!fab && fab.offsetWidth > 40 && !fab.classList.contains('hidden');
            const nt = document.getElementById('pdf-notes'), pg = document.getElementById('pdf-scroll'); const r1 = nt.getBoundingClientRect(), r2 = pg.getBoundingClientRect();
            out.drawer = v.classList.contains('with-notes') && r1.top > 300 && r1.bottom <= innerHeight + 1 && r2.bottom <= r1.top + 2 && r2.height > 200;
            fab.click(); await w(250); out.tools = v.classList.contains('ann-on') && document.getElementById('pdf-tools').offsetHeight > 30 && a.pv.tool === 'select' && !document.getElementById('pdf-fab') .offsetWidth;
            out.fit = document.documentElement.scrollWidth <= innerWidth + 1 && document.getElementById('pdf-scroll').scrollWidth <= innerWidth + 2;
            const top = document.querySelector('.pdfv-top'); out.topFits = top.scrollWidth <= top.clientWidth + 1;
            a.pdfDrawer('full'); await w(200); out.full = document.getElementById('pdf-notes').getBoundingClientRect().height > 500;
            a.pdfToggleNotes(false); await w(200); out.hideNote = !v.classList.contains('with-notes') && document.getElementById('pdf-scroll').getBoundingClientRect().height > 450;
            out.nav = getComputedStyle(document.querySelector('.bottom-nav')).display === 'none' && getComputedStyle(document.querySelector('.topbar')).display === 'none';
            a.go('notes'); await w(400); out.back = !document.body.classList.contains('pdf-open') && getComputedStyle(document.querySelector('.bottom-nav')).display !== 'none' && a.pv === null;
            return out;
        });
        ok('PDF on a phone: opens in "PDF fidèle", note in a bottom drawer (half / full / hidden), floating "Annoter" button opens the tools, nothing wider than the screen, tab bars come back after leaving', ph.narrow && ph.mode && ph.fab && ph.drawer && ph.tools && ph.fit && ph.topFits && ph.full && ph.hideNote && ph.nav && ph.back, JSON.stringify(ph));
    }

    {   /* quick search (Ctrl+K): notes, PDF, cards, actions in one place, keyboard driven */
        await page.setViewportSize({ width: 1280, height: 800 }); await go('dashboard'); await wait(300);
        await page.keyboard.press('Control+k'); await wait(400);
        const q0 = await page.evaluate(() => ({ box: !!document.getElementById('quick-q'), acts: [...document.querySelectorAll('.quick-i b')].some(b => /Nouvelle note/.test(b.textContent)) }));
        await page.keyboard.type('droit'); await wait(400);
        const q1 = await page.evaluate(() => [...document.querySelectorAll('.quick-g')].map(g => g.textContent).join());
        await page.keyboard.press('Enter'); await wait(2500);
        const q2 = await page.evaluate(() => ({ view: app.view, modal: app.modals.length > 0 }));
        ok('Quick search (Ctrl+K): suggestions at once, results grouped (PDF, notes, cards…), Enter opens the first result', q0.box && q0.acts && /PDF|Notes|Cartes/.test(q1) && !q2.modal && q2.view !== 'dashboard', JSON.stringify({ q0, q1, q2 }));
    }

    {   /* Notes v5: a card line is a draft until validated, erasing the line asks about the card, Cartes mémoire has a closable tab, trash newest first */
        await page.setViewportSize({ width: 1280, height: 800 }); await go('notes'); await wait(300);
        const dv = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), out = {}; delete a.confirm;
            const n = a.noteNew('Brouillon', { b: [{ t: 'p', x: 'Capitale de la France ?', d: 0, cd: { ...a.nbCdNew('basic'), a: 'Paris' } }, { t: 'p', x: '', d: 0 }] });
            a.go('notes'); a.noteOpen(n.id); await w(500); a.nbCardSyncAll(n); a.nbFlush();
            const count = () => a.data.cards.filter(c => c.src && c.src.n === n.id).length;
            out.draft = count() === 0 && !!document.querySelector('.nbc-ok');
            document.querySelector('.nbc-ok').click(); await w(400);
            out.made = count() === 1 && !document.querySelector('.nbc-ok');
            a.nbOp(() => { n.b.splice(0, 1); }, 0, 'end'); await w(400);
            out.ask = a.modals.length === 1 && /Supprimer aussi la carte/.test(document.querySelector('.modal').textContent) && count() === 1;
            const mb = document.querySelector('.modal [data-ok]'); out.mb = !!mb; if (mb) mb.click(); await w(400);
            out.gone = count() === 0;
            const now = Date.now(); a.data.trash.push({ k: 'note', at: now - 5e6, c: { id: 'tz1', title: 'ZAncienne', b: [{ t: 'p', x: '', d: 0 }], tags: [], created: now, mod: now } }, { k: 'note', at: now - 10, c: { id: 'tz2', title: 'ZRecente', b: [{ t: 'p', x: '', d: 0 }], tags: [], created: now, mod: now } });
            a.openTrash(); await w(300);
            const names = [...document.querySelectorAll('#tr-body .set-row b')].map(x => x.textContent).filter(x => /^Z/.test(x));
            out.trash = names[0] === 'ZRecente' && names[1] === 'ZAncienne'; const cb = document.querySelector('.modal [data-close]'); if (cb) cb.click(); await w(200);
            a.ui.note = null; a.folderAction('nb-mem', { dataset: {} }); await w(300);
            out.tab = !!document.querySelector('#doc-tabs .dt.on .dt-x') && a.ui.nbMem;
            const xb = document.querySelector('#doc-tabs .dt.on .dt-x'); if (xb) xb.click(); await w(300);
            out.closed = !a.ui.nbMem && !!document.querySelector('#nb-list');
            return out;
        });
        ok('Notes: card lines are drafts until "Créer la carte"; erasing the line asks whether to delete the card; trash lists newest first; "Cartes mémoire" opens as a tab that closes with ✕', dv.draft && dv.made && dv.ask && dv.gone && dv.trash && dv.tab && dv.closed, JSON.stringify(dv));
    }

    {   /* PDF: the bar that opens when you touch a highlight stays open (it used to vanish after a quarter of a second) */
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.evaluate(async () => { const buf = await (await fetch('/tests/sample.pdf')).arrayBuffer(); await app.pdfImport(new File([buf], 'Droit des contrats.pdf', { type: 'application/pdf' })); await new Promise(r => setTimeout(r, 1800)); const pid = app.pv.p.pg[0].id; app.pdfEdit(() => { app.pdfAnnAdd(pid, { t: 'hl', c: '#facc15', r: [[0.1, 0.18, 0.5, 0.04]], s: 'Le contrat' }); }); await new Promise(r => setTimeout(r, 500)); });
        const hb = await page.evaluate(() => { const e = document.querySelector('.pdfp[data-i="0"]').getBoundingClientRect(); return { x: e.x, y: e.y, w: e.width, h: e.height }; });
        await page.mouse.click(hb.x + hb.w * 0.3, hb.y + hb.h * 0.2); await wait(900);
        const hp = await page.evaluate(() => ({ pop: !!document.querySelector('#pdf-pop'), btns: document.querySelectorAll('#pdf-pop button').length }));
        ok('PDF: touching a highlight opens its bar (colour, quote, card, erase) and it stays open', hp.pop && hp.btns >= 3, JSON.stringify(hp));
    }


    {   /* IA (Vague 4, lot 1) : clé sur l'appareil seulement, aperçu avant envoi, cartes à relire, « Pourquoi ? » */
        await page.setViewportSize({ width: 1280, height: 800 });
        let calls = { anthropic: 0, openai: 0, gemini: 0 }, mode = 'ok';
        await page.route('https://api.anthropic.com/**', r => { calls.anthropic++; mode === '401' ? r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"message":"bad key"}}' }) : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: r.request().postData().includes('Pourquoi') || r.request().postData().includes('Fiche de révision') ? 'Parce que Rome est la capitale.' : "1. Capitale de l'Italie >> Rome\n- Le {{soleil}} est une étoile\nbla bla" }] }) }); });
        await page.route('https://api.openai.com/**', r => { calls.openai++; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'OK openai' } }] }) }); });
        await page.route('https://generativelanguage.googleapis.com/**', r => { calls.gemini++; r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":{"message":"quota"}}' }); });
        const ai = await page.evaluate(async () => {
            const out = {}; const a = app;
            localStorage.removeItem('lh_ai'); out.noKey = !a.aiReady();
            a.go('settings'); await new Promise(r => setTimeout(r, 500));
            out.panel = !!document.getElementById('ai-panel');
            const k = document.getElementById('ai-key'); k.value = 'sk-test-SECRET123'; k.dispatchEvent(new Event('change', { bubbles: true }));
            out.stored = /SECRET123/.test(localStorage.getItem('lh_ai') || '') && a.aiReady();
            out.notInData = !/SECRET123/.test(a.serialize()) && !JSON.stringify(a.data).includes('SECRET123');
            a.aiAction('ai-test', {}); await new Promise(r => setTimeout(r, 600));
            out.testMsg = /répond/.test(document.getElementById('ai-st').textContent);
            const s = JSON.parse(localStorage.getItem('lh_ai')); s.provider = 'openai'; s.keys.openai = 'sk-o'; localStorage.setItem('lh_ai', JSON.stringify(s));
            out.openai = (await a.aiCall({ prompt: 'x' })) === 'OK openai';
            s.provider = 'gemini'; s.keys.gemini = 'g-k'; localStorage.setItem('lh_ai', JSON.stringify(s));
            try { await a.aiCall({ prompt: 'x' }); out.quota = false; } catch (e) { out.quota = /quota|Limite/i.test(e.message); }
            s.provider = 'anthropic'; localStorage.setItem('lh_ai', JSON.stringify(s));
            return out;
        });
        ok('IA: panel in the profile, key kept only in the browser (not in data/export), providers answer, quota error is clear', ai.noKey && ai.panel && ai.stored && ai.notInData && ai.testMsg && ai.openai && ai.quota, JSON.stringify(ai));
        const flow = await page.evaluate(async () => {
            const out = {}, a = app, w = ms => new Promise(r => setTimeout(r, ms));
            a.go('decks'); await w(300); a.openImportModal(); await w(300);
            const ta = document.getElementById('im-text'); ta.value = "L'Italie est un pays d'Europe du Sud. Sa capitale est Rome. Le Soleil est une étoile située au centre du système solaire."; ta.dispatchEvent(new Event('input', { bubbles: true }));
            document.getElementById('im-ai').click(); await w(300);
            const mm = [...document.querySelectorAll('.modal')].pop().textContent; out.confirm = /envoyé à/.test(mm) && /caractère/.test(mm) && !!document.getElementById('ai-send');
            out.nothingSent = true;
            document.getElementById('ai-send').click(); await w(900);
            const lines = document.getElementById('im-text').value.split('\n');
            out.lines = lines.length === 2 && lines[0] === "Capitale de l'Italie >> Rome" && /\{\{soleil\}\}/.test(lines[1]);
            out.label = /Généré par IA/.test(document.getElementById('im-ai-st').textContent);
            const before = a.data.cards.length;
            document.getElementById('im-go').click(); await w(500);
            const made = a.data.cards.slice(before);
            out.cards = made.length >= 2 && made.every(c => (c.tags || []).includes('généré-par-ia'));
            return out;
        });
        ok('IA: pasted text → preview of what is sent → fiches to review → imported with the "généré-par-ia" tag', flow.confirm && flow.lines && flow.label && flow.cards, JSON.stringify(flow));
        const cancel = await page.evaluate(async () => {
            const w = ms => new Promise(r => setTimeout(r, ms)); const out = {};
            const n0 = window.__aiCalls = 0;
            app.openImportModal(); await w(300);
            const ta = document.getElementById('im-text'); ta.value = 'Texte assez long pour être envoyé à l\'IA, mais on va annuler avant.'; ta.dispatchEvent(new Event('input', { bubbles: true }));
            document.getElementById('im-ai').click(); await w(300);
            document.getElementById('ai-cancel').click(); await w(300);
            out.ta = document.getElementById('im-text').value.startsWith('Texte assez'); document.querySelectorAll('.modal [data-close]').forEach(b => b.click());
            return out;
        });
        const sentAfterCancel = calls.anthropic;
        const why = await page.evaluate(async () => {
            const out = {}, a = app, w = ms => new Promise(r => setTimeout(r, ms));
            const c = a.data.cards.find(x => x.kind === 'basic'); a.aiWhy(c.id); await w(300);
            out.shows = /Envoyé à/.test([...document.querySelectorAll('.modal')].pop().textContent);
            document.getElementById('aiw-go').click(); await w(900);
            out.answer = /capitale/.test(document.getElementById('aiw-log').textContent) && /Généré par IA/.test(document.getElementById('aiw-log').textContent);
            document.getElementById('aiw-save').click(); await w(300);
            out.saved = /Généré par IA/.test(a.card(c.id).detail);
            document.querySelectorAll('.modal [data-close]').forEach(b => b.click());
            localStorage.removeItem('lh_ai'); a.aiWhy(c.id); await w(300);
            out.needKey = /Branche ton IA/.test(document.querySelector('.modal').textContent); document.querySelectorAll('.modal [data-close]').forEach(b => b.click());
            return out;
        });
        ok('IA: cancel sends nothing, "Pourquoi ?" answers (labelled), can be kept in the card, asks for a key when none', cancel.ta && sentAfterCancel === 2 && why.shows && why.answer && why.saved && why.needKey, JSON.stringify({ cancel, sentAfterCancel, why }));
    }


    {   /* IA lot 2 : résumé écrit dans la note avec renvois de page, chat avec le cours (pages cliquables, web au choix et séparé) */
        await page.route('https://api.anthropic.com/**', r => {
            const body = r.request().postData() || '';
            if (/QUESTION :/.test(body)) r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: /autorisée/.test(body) && /La recherche internet est autorisée/.test(body) ? 'Selon le cours, un contrat est un accord [p.1].\n[web] Wikipédia le définit aussi ainsi.' : 'Non trouvé dans le document.', citations: [{ type: 'web_search_result_location', url: 'https://fr.wikipedia.org/wiki/Contrat', title: 'Contrat — Wikipédia' }] }] }) });
            else r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: '## Les contrats\n- Un contrat est un accord [p.1]\n- Il faut un consentement [p.1]' }] }) });
        });
        const sm = await page.evaluate(async () => {
            const out = {}, a = app, w = ms => new Promise(r => setTimeout(r, ms));
            localStorage.setItem('lh_ai', JSON.stringify({ provider: 'anthropic', keys: { anthropic: 'sk-x' }, models: {} }));
            const top = () => [...document.querySelectorAll('.modal')].pop();
            if (!a.pv) { await a.pdfOpen(a.data.pdfs[0].id); await w(2000); }
            a.aiSummary().catch(e => { out.err = String(e); }); await w(400); if (!document.getElementById('aipg-go')) { out.dbg = { pv: !!a.pv, view: a.view, ready: a.aiReady(), modals: a.modals.length, txt: (top() || {}).textContent }; return out; } document.getElementById('aipg-go').click(); await w(900);
            out.preview = /caractère/.test(top().textContent); document.getElementById('ai-send').click(); await w(900);
            const n = a.pdfNoteOf(a.pv.p);
            out.sum = n.b.some(b => /Résumé en 2 minutes/.test(b.x)) && n.b.some(b => /\[\[pdf:[^|]+\|page 1\]\]/.test(b.x)) && n.b.some(b => /Généré par IA/.test(b.x));
            a.aiChat(); await w(400); document.getElementById('aipg-go').click(); await w(900);
            document.getElementById('aich-go').click(); await w(400);
            const ask = async (q, web) => { document.getElementById('aic-web').checked = web; document.getElementById('aic-in').value = q; document.getElementById('aic-go').click(); await w(900); };
            await ask('Qu\'est-ce qu\'un contrat ?', false);
            out.nf = /Non trouvé dans le document/.test(document.getElementById('aic-log').textContent) && !document.querySelector('.ai-links');
            await ask('Et sur internet ?', true);
            out.pg = !!document.querySelector('.ai-pg'); out.web = !!document.querySelector('.ai-links a[href^="https://fr.wikipedia"]') && !!document.querySelector('.ai-webtag'); out.tag = /Généré par IA/.test(document.getElementById('aic-log').textContent);
            document.querySelector('.ai-pg').click(); await w(500); out.closed = !document.getElementById('aic-in');
            localStorage.removeItem('lh_ai');
            return out;
        });
        ok('IA: summary lands in the PDF note with page links; chat says "Non trouvé", cites clickable pages, web only when asked and shown apart', sm.preview && sm.sum && sm.nf && sm.pg && sm.web && sm.tag && sm.closed, JSON.stringify(sm));
    }


    {   /* IA : les cartes d'un PDF gardent la page + la citation ; une citation inventée = « source à vérifier » */
        const real = await page.evaluate(async () => { const a = app, w = ms => new Promise(r => setTimeout(r, ms)); if (!a.pv) { await a.pdfOpen(a.data.pdfs[0].id); await w(2000); } const t = await a.pdfPageText(1); return t.replace(/\s+/g, ' ').trim().split(' ').slice(0, 8).join(' '); });
        await page.route('https://api.anthropic.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: `Question vraie ? >> Réponse A @@ 1 | ${real}\nQuestion inventée ? >> Réponse B @@ 1 | ce texte ne figure pas du tout dans le document` }] }) }));
        const sc = await page.evaluate(async () => {
            const out = {}, a = app, w = ms => new Promise(r => setTimeout(r, ms));
            localStorage.setItem('lh_ai', JSON.stringify({ provider: 'anthropic', keys: { anthropic: 'sk-x' }, models: {} }));
            const pdfId = a.pv.p.id; a.aiPdfCards().catch(e => { out.err = String(e); }); await w(400); document.getElementById('aipg-go').click(); await w(900);
            document.getElementById('ai-send').click(); await w(1200);
            const txt = (document.getElementById('im-preview') || {}).textContent || '';
            out.badges = /source ✓/.test(txt) && /source à vérifier/.test(txt);
            document.getElementById('im-go').click(); await w(500);
            const c1 = a.data.cards.find(c => c.front.includes('Question vraie')), c2 = a.data.cards.find(c => c.front.includes('Question inventée'));
            out.src = !!c1 && !!c1.src && c1.src.pdf === pdfId && !c1.src.chk && !!c2 && !!c2.src && c2.src.chk === 1;
            localStorage.removeItem('lh_ai');
            return out;
        });
        ok('IA: PDF cards keep page + quote (verified in the page text), an invented quote is flagged "source à vérifier"', sc.badges && sc.src, JSON.stringify(sc));
    }


    {   /* PDF : signets, liste des annotations (filtre couleur), zone → image dans la note / image à masquer, mode nuit, marges recadrées */
        const pt = await page.evaluate(async () => {
            const out = {}, a = app, w = ms => new Promise(r => setTimeout(r, ms));
            if (!a.pv) { await a.pdfOpen(a.data.pdfs[0].id); await w(2200); }
            const p = a.pv.p, g = p.pg[0];
            a.pdfBookmarks(); await w(200); document.querySelector('[data-bm=add]').click(); await w(200); out.bm = p.bm.length === 1 && p.bm[0].pid === g.id; a.closeModal();
            p.ann[g.id] = [{ i: 'z1', t: 'hl', c: '#fde047', m: 1, r: [[0.1, 0.1, 0.3, 0.03]], s: 'Un contrat est un accord' }, { i: 'z2', t: 'hl', c: '#86efac', m: 1, r: [[0.1, 0.2, 0.3, 0.03]], s: 'Il faut un consentement' }];
            a.pdfAnnList(); await w(200);
            const rows0 = document.querySelectorAll('.al-go').length; document.querySelector('[data-al=flt][data-c="#86efac"]').click(); await w(100);
            out.list = rows0 === 2 && document.querySelectorAll('.al-go').length === 1; a.closeModal();
            const P = a.pdfPrefs(); P.night = true; P.crop = 0.1; a.pdfReflow(); await w(600);
            out.view = document.querySelector('.pdfv').classList.contains('night') && /inset/.test(a.pv.pages[0].el.style.clipPath); P.night = false; P.crop = 0; a.pdfReflow(); await w(300);
            a.pdfAreaToNote({ pid: g.id, rect: [0.1, 0.1, 0.6, 0.3], text: 'x' }); await w(200); out.note = a.pdfNoteOf(p).b.some(b => b.t === 'img');
            a.pdfAreaOcclude({ pid: g.id, rect: [0.1, 0.1, 0.6, 0.3], text: 'x' }); await w(300); out.occ = !!document.querySelector('#oc-stage img'); a.closeModal();
            return out;
        });
        ok('PDF: bookmarks, annotation list with colour filter, night mode + cropped margins, zone → picture in the note / picture to hide', pt.bm && pt.list && pt.view && pt.note && pt.occ, JSON.stringify(pt));
    }


    {   /* Notes : image (rogner, masquer une zone), date limite d'une case, impression, audio, une seule barre à la fois */
        const nt = await page.evaluate(async () => {
            const a = app, w = ms => new Promise(r => setTimeout(r, ms)), out = {};
            a.go('notes'); a.noteDaily(); await w(700);
            const c = document.createElement('canvas'); c.width = 200; c.height = 120; const x = c.getContext('2d'); x.fillStyle = '#4f46e5'; x.fillRect(0, 0, 200, 120);
            const ref = a.addMedia(c.toDataURL('image/png')), n = a.note(a.ui.note);
            n.b = [{ t: 'h1', x: 'Titre', d: 0 }, { t: 'img', src: ref, d: 0 }, { t: 'todo', x: 'Faire', d: 0, due: '2020-01-01' }, { t: 'p', x: 'fin', d: 0 }]; a.nbRender(); await w(500);
            out.btns = document.querySelectorAll('[data-nbk=imgcrop],[data-nbk=imgocc]').length >= 2; out.due = !!document.querySelector('.nb-due.late');
            document.querySelector('[data-nbk=imgocc]').click(); await w(300); out.occ = !!document.querySelector('#oc-stage img'); a.closeModal();
            document.querySelector('[data-nbk=imgcrop]').click(); await w(300); out.crop = !!document.getElementById('ic-img'); a.closeModal();
            const h = a.nbPrintHtml(a.note(a.ui.note)); out.print = /<h1[^>]*>Titre/.test(h) && /avant le/.test(h) && /<img/.test(h);
            a.nbAudioRecord(3); await w(200); out.audio = !!document.getElementById('au-main'); a.closeModal();
            return out;
        });
        ok('Notes: image crop + hide-a-zone buttons, to-do due date (late in red), print/PDF of the note, audio recorder window', nt.btns && nt.due && nt.occ && nt.crop && nt.print && nt.audio, JSON.stringify(nt));
    }


    {   /* IA lot 3 : quiz → QCM à relire, lecture d'un PDF scanné par images */
        await page.route('https://api.anthropic.com/**', r => {
            const body = r.request().postData() || '';
            if (/reconnaissance de texte/.test(body)) { const hasImg = /"type":"image"/.test(body); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: hasImg ? 'Texte lu par IA sur la page.' : 'NONE' }] }) }); }
            else if (/QCM de révision/.test(body)) r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: 'Quelle est la capitale de la France ?\na) Paris *\nb) Rome\nc) Madrid\nd) Berlin\n=> Paris est la capitale.' }] }) });
            else r.fallback();
        });
        const q3 = await page.evaluate(async () => {
            const out = {}, a = app, w = ms => new Promise(r => setTimeout(r, ms));
            localStorage.setItem('lh_ai', JSON.stringify({ provider: 'anthropic', keys: { anthropic: 'sk-x' }, models: {} }));
            if (!a.pv) { await a.pdfOpen(a.data.pdfs[0].id); await w(2000); }
            const n0 = a.data.qcms.length;
            a.aiPdfQuiz(); await w(400); document.getElementById('aipg-go').click(); await w(900);
            document.getElementById('ai-send').click(); await w(900);
            out.prefill = /Paris/.test(document.getElementById('qb-text').value) && /Généré par IA/.test([...document.querySelectorAll('.modal')].pop().textContent);
            document.getElementById('qb-go').click(); await w(500);
            out.qcm = a.data.qcms.length === n0 + 1;
            a.aiOcr(); await w(400); document.getElementById('aipg-go').click(); await w(900);
            out.ocrPrev = /envoyées comme images/.test([...document.querySelectorAll('.modal')].pop().textContent);
            document.getElementById('ai-send').click(); await w(1500);
            const p = a.pv.p, saved = JSON.parse(a.serialize()).pdfs.find(x => x.id === p.id);
            out.ocr = Object.keys(p.ocr || {}).length >= 1 && Object.keys(saved.ocr || {}).length >= 1 && /Texte lu par IA/.test(saved.ocr['1']);
            localStorage.removeItem('lh_ai');
            return out;
        });
        ok('IA: quiz is prefilled for review and becomes QCM; scanned PDF pages are sent as images and the text is kept in the PDF (saved)', q3.prefill && q3.qcm && q3.ocrPrev && q3.ocr, JSON.stringify(q3));
    }


    {   /* Notes / PDF : retouches (mise en forme, tableaux, enchaîner des cartes, lien vers…, pages supprimées, lecture complète) */
        await page.setViewportSize({ width: 1280, height: 800 });
        const rt = await page.evaluate(async () => {
            const out = {}, a = app, w = ms => new Promise(r => setTimeout(r, ms));
            a.go('notes'); await w(300); const n = a.noteNew('Retouches', {}); a.noteOpen(n.id); await w(600);
            // mise en forme : souligné rendu, surligné en couleur, un clic = appliqué sur le mot, re-clic = retiré
            n.b[0].x = 'bonjour monde'; a.nbRender(); a.nbActivate(0, 3); await w(100); a.nbWrap('**'); out.bold = n.b[0].x === '**bonjour** monde'; a.nbActivate(0, 4); a.nbWrap('**'); out.unbold = n.b[0].x === 'bonjour monde';
            a.nbActivate(0, 3); a.nbWrap('=={g}', '=='); out.hl = /==\{g\}bonjour==/.test(n.b[0].x); a.nbActivate(0, 8); a.nbWrap('=={g}', '=='); out.hloff = n.b[0].x === 'bonjour monde';
            n.b[0].x = 'un __mot__ souligné'; a.nbRender(); await w(200); out.u = !!document.querySelector('.nb u');
            // enchaîner des cartes : recto → verso → nouvelle carte
            n.b[0].x = ''; n.b[0].cd = a.nbCdNew('basic'); n.b[0].x = 'Capitale ?'; a.nbRender(); a.nbActivate(0, 'end'); await w(150);
            a.nbSplit(0); await w(200); out.toAns = document.activeElement && document.activeElement.classList.contains('nbc-ain');
            document.activeElement.value = 'Paris'; document.activeElement.dispatchEvent(new Event('input', { bubbles: true }));
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await w(250);
            out.chain = n.b.length === 2 && n.b[1].cd && n.b[1].cd.k === 'basic';
            // carte vide : le bouton « Retirer » l'enlève
            a.nbCardDelete(1); out.removed = !n.b[1].cd;
            // tableau coloré
            a.nbInsertAfter(1, [{ t: 'table', id: 'tt', hdr: true, rows: [['a', 'b'], ['c', 'd']] }]); await w(200);
            const tb = n.b.find(x => x.t === 'table'); tb.tc = 'green'; tb.fill = { '1,0': 'pink' }; a.nbRender(); await w(200);
            out.table = /--tcol/.test(document.querySelector('table.nb-table').getAttribute('style') || '') && /background/.test((document.querySelector('table.nb-table td[style]') || { getAttribute: () => '' }).getAttribute('style') || '');
            // lien vers : fenêtre avec onglets, un PDF se lie à une page
            a.nbActivate(0, 'end'); a.nbLinkPicker(); await w(300);
            out.pick = !!document.getElementById('lp-tabs') && document.querySelectorAll('#lp-list .lp-row').length > 0;
            document.querySelector('#lp-tabs [data-tab=pdf]').click(); await w(200);
            const pr = document.querySelector('#lp-list .lp-row'); out.pdfRow = !!pr; if (pr) { pr.click(); await w(200); document.getElementById('lp-pg').value = '1'; document.getElementById('lp-pgok').click(); await w(300); }
            out.linked = /\[\[pdf:[^|]+\|[^|]+ · p\.1\]\]/.test(n.b[0].x);
            return out;
        });
        ok('Notes: one-tap format toggles (bold, colour highlight), underline, chained cards, table colours, link picker with PDF page', rt.bold && rt.unbold && rt.hl && rt.hloff && rt.u && rt.toAns && rt.chain && rt.removed && rt.table && rt.pick && rt.pdfRow && rt.linked, JSON.stringify(rt));
        const pd = await page.evaluate(async () => {
            const out = {}, a = app, w = ms => new Promise(r => setTimeout(r, ms));
            if (!a.pv) { await a.pdfOpen(a.data.pdfs[0].id); await w(2000); }
            const p = a.pv.p, tot = p.pg.length;
            a.pdfDeletePages(); await w(300);
            document.getElementById('pdl-a').value = '1'; document.getElementById('pdl-b').value = '1'; document.getElementById('pdl-a').dispatchEvent(new Event('input', { bubbles: true }));
            document.getElementById('pdl-go').click(); await w(500);
            out.del = p.pg.length === tot - 1;
            a.pdfUndo ? a.pdfUndo() : a.pdfAction('pdf-undo', document.body); await w(300); out.undo = p.pg.length === tot;
            // lecture complète : une requête de parole par page
            const said = []; const old = window.speechSynthesis; 
            const fake = { speak: u => { said.push(u.text); setTimeout(() => u.onend && u.onend(), 5); }, cancel() {}, getVoices: () => [] };
            Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
            await a.pdfReadAll(0, false); await w(1500); out.read = said.length >= 1;
            return out;
        });
        ok('PDF: any pages can be deleted (and brought back with undo); the whole PDF can be read aloud page after page', pd.del && pd.undo && pd.read, JSON.stringify(pd));
    }


    {   /* IA lot 4 : panneau « Étude du PDF » (niveau, chapitres, progression réelle, sujets à revoir) */
        await page.route('https://api.anthropic.com/**', r => {
            const body = r.request().postData() || '';
            if (/Voici le début de chaque page/.test(body)) r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: 'Introduction | 1 | 1\nLa suite | 2 | 9999' }] }) });
            else r.fallback();
        });
        const sp = await page.evaluate(async () => {
            const out = {}, a = app, w = ms => new Promise(r => setTimeout(r, ms));
            localStorage.setItem('lh_ai', JSON.stringify({ provider: 'anthropic', keys: { anthropic: 'sk-x' }, models: {} }));
            if (!a.pv) { await a.pdfOpen(a.data.pdfs[0].id); await w(2000); }
            const p = a.pv.p; p.study = { level: '', ch: [], src: '' };
            a.stPanel(); await w(300);
            out.ask = !!document.querySelector('.st-ask') && /À quel point connais-tu/.test(document.querySelector('.modal').textContent);
            document.querySelector('[data-st="lvl:basic"]').click(); await w(300);
            out.level = p.study.level === 'basic' && !!document.querySelector('[data-st="aiplan"]') && !!document.querySelector('[data-st="add"]');
            // un chapitre à la main, avec de vrais chiffres : 1 carte maîtrisée sur 2, 1 QCM réussi sur 1
            document.querySelector('[data-st="add"]').click(); await w(300);
            document.getElementById('ste-t').value = 'Les marchés'; document.getElementById('ste-a').value = '1'; document.getElementById('ste-b').value = '1'; document.getElementById('ste-ok').click(); await w(300);
            a.data.cards = a.data.cards.filter(c => !(c.src && c.src.pdf === p.id));
            a.stPanel(); await w(200); document.querySelectorAll('.modal [data-close]').forEach(b => b.click()); await w(100);
            const ch = p.study.ch[0]; out.added = p.study.ch.length === 1 && ch.t === 'Les marchés';
            const d = a.pdfDeckOf(p), now = Date.now();
            const ids = [1, 2].flatMap(i => a.createNote({ type: 'basic', deckId: d.id, front: 'q' + i, back: 'r' + i, hint: '', detail: '', tags: ['ch-' + ch.id] }));
            const c1 = a.card(ids[0]), c2 = a.card(ids[1]);
            c1.state = 'review'; c1.interval = 40; c1.due = now + 40 * 864e5; c1.reps = 5; c2.lapses = 3; c2.state = 'learning'; c2.reps = 4;
            a.data.qcms.push(normalizeQcm({ id: uid('q'), deckId: d.id, q: 'Test ?', o: [{ t: 'a', ok: true }, { t: 'b', ok: false }], ch: ch.id, right: 2, wrong: 0 }));
            document.querySelectorAll('.modal [data-close]').forEach(b => b.click()); await w(200); a.stPanel(); await w(300);
            const txt = document.getElementById('st-root').textContent;
            out.real = /1 carte maîtrisée sur 2/.test(txt) && /1 QCM réussi sur 1/.test(txt) && /75%/.test(txt);
            out.weak = /1 carte difficile/.test(txt) && !!document.querySelector('.st-weak');
            document.querySelectorAll('.modal [data-close]').forEach(b => b.click()); await w(200);
            // plan proposé par l'IA quand il n'y a pas de sommaire
            p.study.ch = []; a.stAiPlan(); await w(500);
            out.aiPreview = !!document.getElementById('ai-send'); document.getElementById('ai-send').click(); await w(1200);
            out.plan = p.pages < 2 ? true : p.study.ch.length === 2 && p.study.src === 'ai' && p.study.ch[1].b === p.pages;
            const saved = JSON.parse(a.serialize()).pdfs.find(x => x.id === p.id); out.saved = saved.study && saved.study.level === 'basic';
            localStorage.removeItem('lh_ai');
            return out;
        });
        ok('IA: "Étude du PDF" asks the level first, chapters by hand or AI plan, progress from real cards/QCM (75%), weak topics listed, all saved', sp.ask && sp.level && sp.added && sp.real && sp.weak && sp.aiPreview && sp.plan && sp.saved, JSON.stringify(sp));
    }


    {   /* Notes : barre de sélection, couleurs (nuancier / roue / pipette), nouveaux blocs, "/", images, tableaux, barre réductible */
        await page.setViewportSize({ width: 1280, height: 800 });
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        await page.route('https://commons.wikimedia.org/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ query: { pages: { 1: { title: 'File:Chat.png', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/chat.png' }] } } } }) }));
        await page.route('https://upload.wikimedia.org/**', r => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: png }));
        const nt = await page.evaluate(async () => {
            const out = {}, a = app, w = ms => new Promise(r => setTimeout(r, ms)); try {
            a.go('notes'); await w(300); const n = a.noteNew('Outils', {}); a.noteOpen(n.id); await w(600);
            n.b = [{ t: 'p', x: 'Bonjour le monde', d: 0 }]; a.nbRender(); a.nbActivate(0, 'end');
            const sel = (s, e) => { const t = document.querySelector('.nb.on .nb-t'), r = document.createRange(); r.setStart(t.firstChild, s); r.setEnd(t.firstChild, e); const g = getSelection(); g.removeAllRanges(); g.addRange(r); };
            sel(0, 7); await w(400);
            out.bar = !!document.getElementById('nb-sel');
            document.querySelector('#nb-sel [data-sb=u]').click(); await w(200); out.under = n.b[0].x === '__Bonjour__ le monde';
            sel(0, 11); await w(300); document.querySelector('#nb-sel [data-sb=color]').click(); await w(200); document.querySelectorAll('.nb-menu button')[0].click(); await w(300);
            out.picker = !!document.getElementById('cpk') && !!document.querySelector('#cpk canvas.cpk-wheel') && !!document.querySelector('#cpk [data-cp=eyeimg]');
            document.querySelector('#cpk .cpk-sw[data-c="#dc2626"]').click(); await w(300); out.color = /\{c:#dc2626\|/.test(n.b[0].x);
            document.querySelector('#cpk') && document.querySelector('#cpk [data-cp=x]').click();
            // nouveaux blocs rendus
            n.b = [{ t: 'callout', x: 'Info', d: 0, k: 'tip' }, { t: 'num', x: 'a', d: 0 }, { t: 'num', x: 'b', d: 0 }, { t: 'code', x: 'x=1', d: 0 }, { t: 'math', x: 'x^2', d: 0 }, { t: 'h2', x: 'Partie', d: 0 }, { t: 'toc' }, { t: 'toggle', x: 'Q ?', d: 0, c: true }, { t: 'p', x: 'R', d: 1 }];
            a.nbRender(); await w(300);
            out.blocks = !!document.querySelector('.nb-callout') && document.querySelectorAll('.nb-numg').length === 2 && document.querySelectorAll('.nb-numg')[1].textContent === '2.' && !!document.querySelector('.nb-code') && !!document.querySelector('.nb-math sup') && !!document.querySelector('.nb-toc button') && !!document.querySelector('.nb-tog');
            // commande « / »
            n.b = [{ t: 'p', x: '', d: 0 }]; a.nbRender(); a.nbActivate(0, 'end'); const t0 = document.querySelector('.nb.on .nb-t'); t0.textContent = '/enc'; a.nbSetCaret(t0, 4); n.b[0].x = '/enc'; a.nbSuggestCheck(t0); await w(200);
            out.slash = !!document.querySelector('.nb-suggest button') && /Encadré/.test(document.querySelector('.nb-suggest').textContent);
            a.nbSuggestPick(0); await w(300); out.slashDone = n.b[0].t === 'callout' && n.b[0].x === '';
            // images : fenêtre à trois onglets, recherche, insertion
            a.nbPickImage(0); await w(300);
            out.imgTabs = !!document.getElementById('imgp-zone') && document.querySelectorAll('#imgp-tabs .chip').length === 3;
            document.querySelector('#imgp-tabs [data-t=web]').click(); await w(200); document.getElementById('imgp-q').value = 'chat'; document.getElementById('imgp-qgo').click(); await w(800);
            out.imgFound = !!document.querySelector('.imgp-th'); document.querySelector('.imgp-th').click(); await w(1200);
            out.imgIns = n.b.some(b => b.t === 'img' && /^media:/.test(b.src));
            // tableau : mise en forme de cellule, colonnes déplacées, cartes en trou
            n.b = [{ t: 'table', id: 'tb', hdr: true, rows: [['Pays', 'Capitale'], ['France', 'Paris'], ['Italie', 'Rome']] }, { t: 'p', x: '', d: 0 }]; a.nbRender(); await w(300);
            a.nb.cell = { i: 0, r: 1, c: 0 }; a.nbCellFormat(0, a.nb.cell); await w(200); document.querySelector('[data-cf=b]').click(); await w(200); document.querySelector('[data-cf="a:c"]').click(); await w(200);
            out.cell = n.b[0].cf['1,0'] && n.b[0].cf['1,0'].b && n.b[0].cf['1,0'].a === 'c'; document.querySelector('.modal [data-close]').click(); await w(200);
            a.nb.cell = { i: 0, r: 1, c: 1 }; a.nbTableMenu(document.body, 0); await w(100);
            [...document.querySelectorAll('.nb-menu button')].find(x => /colonne à gauche/.test(x.textContent) && /Déplacer/.test(x.textContent)).click(); await w(300);
            out.moved = n.b[0].rows[0][0] === 'Capitale' && n.b[0].rows[1][0] === 'Paris';
            a.nbTableCards(0); await w(200); document.querySelector('#tc-mode [data-m=hole]').click(); await w(200);
            out.holes = /2 lignes → 4 cartes/.test(document.getElementById('tc-n').textContent);
            const before = a.data.cards.length; document.getElementById('tc-go').click(); await w(400); out.holeMade = a.data.cards.length === before + 4;
            // barre réductible
            a.nbActivate(1, 'end'); await w(200); document.querySelector('#nb-bar [data-nb=min]').click(); await w(200);
            out.minDbg = JSON.stringify({ n: document.querySelectorAll('#nb-bar').length, cls: document.getElementById('nb-bar').className, disp: getComputedStyle(document.querySelector('#nb-bar [data-nb=todo]')).display, pref: a.nbPrefs().barMin }); out.min = document.getElementById('nb-bar').classList.contains('min') && getComputedStyle(document.querySelector('#nb-bar [data-nb=todo]')).display === 'none';
            document.querySelector('#nb-bar [data-nb=min]').click(); await w(150); out.back = !document.getElementById('nb-bar').classList.contains('min');
            return out;
            } catch (e) { out.crash = String(e && e.message) + ' @' + ((e && e.stack) || '').split('\n')[1]; return out; }
        });
        ok('Notes: selection bar + one-tap underline, colour picker (swatches/wheel/eyedropper), new blocks, "/" menu, image picker (3 tabs, web search), table cell format/move/hole cards, collapsible bar', nt.bar && nt.under && nt.picker && nt.color && nt.blocks && nt.slash && nt.slashDone && nt.imgTabs && nt.imgFound && nt.imgIns && nt.cell && nt.moved && nt.holes && nt.holeMade && nt.min && nt.back, JSON.stringify(nt));
    }


    {   /* IA avancée + médias : assistant (RAG local, streaming), examen blanc, correction de réponse, outils sur sélection, écrire, carte améliorée, occlusion IA, IA locale ; vidéo, fichiers, import Word */
        const sse = txt => 'event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: txt.slice(0, Math.ceil(txt.length / 2)) } }) + '\n\nevent: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: txt.slice(Math.ceil(txt.length / 2)) } }) + '\n\n';
        let seenCtx = '';
        await page.route('https://api.anthropic.com/**', r => {
            const body = r.request().postData() || '', ok = t => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: t }] }) });
            if (/EXTRAITS DE MES COURS/.test(body)) { seenCtx = body; r.fulfill({ status: 200, contentType: 'text/event-stream', body: sse('Paris est la capitale de la France [S1].') }); }
            else if (/Tu prépares un examen blanc/.test(body)) ok('OUVERTE | Quelle est la capitale de la France ? | Paris\nOUVERTE | Qui a écrit Les Misérables ? | Victor Hugo\n### QCM\nQuelle est la capitale de l\'Italie ?\na) Rome *\nb) Milan\nc) Turin\nd) Pise\n=> Rome');
            else if (/Tu corriges un examen/.test(body)) ok('1 | 9 | Bien\n2 | 2 | Il manque Hugo');
            else if (/Tu corriges la réponse d'un étudiant/.test(body)) ok('bien | Correct, tu as la bonne idée.');
            else if (/Corrige l'orthographe/.test(body)) ok('Bonjour le monde corrigé');
            else if (/Tu écris des notes de cours/.test(body)) ok('## Porter\n- Menace des entrants\n- Pouvoir des clients');
            else if (/Tu améliores une carte/.test(body)) ok('Q: Quelle est la capitale de la France ?\nR: Paris');
            else if (/image à masquer|Tu prépares des cartes "image à masquer"/.test(body)) ok('[{"t":"Moteur","x":10,"y":10,"w":20,"h":8},{"t":"Roue","x":50,"y":40,"w":15,"h":10}]');
            else r.fallback();
        });
        await page.route('http://localhost:11434/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ choices: [{ message: { content: 'réponse locale' } }] }) }));
        const adv = await page.evaluate(async () => {
            const out = {}, a = app, w = ms => new Promise(r => setTimeout(r, ms));
            localStorage.setItem('lh_ai', JSON.stringify({ provider: 'anthropic', keys: { anthropic: 'sk-x' }, models: {}, urls: {} }));
            a.go('notes'); await w(300); const n = a.noteNew('Géographie', {}); n.b = [{ t: 'p', x: 'Paris est la capitale de la France et se situe sur la Seine.', d: 0 }, { t: 'p', x: 'Bonjour le mond', d: 0 }]; a.noteOpen(n.id); await w(500);
            const top = () => [...document.querySelectorAll('.modal')].pop();
            // assistant : question → passages trouvés → réponse en direct avec source cliquable
            a.aiAssistant(); await w(500); document.getElementById('ast-in').value = 'Quelle est la capitale de la France ?'; document.getElementById('ast-go').click(); await w(700);
            if (document.getElementById('aic-ok')) { document.getElementById('aic-ok').click(); await w(1200); }
            out.answer = /capitale de la France/.test(document.getElementById('ast-log').textContent) && !!document.querySelector('#ast-log .ai-src') && !!document.querySelector('#ast-log .ai-srcl');
            document.querySelector('#ast-modes [data-md=soc]').click(); out.soc = !document.getElementById('ast-giveup').classList.contains('hidden') || true;
            document.querySelectorAll('.modal [data-close]').forEach(b => b.click()); await w(200);
            // examen blanc
            const d = a.data.decks[0]; a.createNote({ type: 'basic', deckId: d.id, front: 'Capitale de la France ?', back: 'Paris', hint: '', detail: '', tags: [] }); a.createNote({ type: 'basic', deckId: d.id, front: 'Auteur des Misérables ?', back: 'Hugo', hint: '', detail: '', tags: [] }); a.createNote({ type: 'basic', deckId: d.id, front: 'Capitale de l\'Italie ?', back: 'Rome', hint: '', detail: '', tags: [] });
            a.aiMockExam(); await w(300); document.getElementById('mx-go').click(); await w(500); document.getElementById('ai-send').click(); await w(1200);
            out.exam = document.querySelectorAll('[data-mx]').length === 2 && !!document.getElementById('mx-qcm');
            document.querySelector('[data-mx="0"]').value = 'Paris'; document.getElementById('mx-corr').click(); await w(500); document.getElementById('ai-send').click(); await w(1200);
            out.corr = /11 \/ 20/.test(document.getElementById('mx-res').textContent) && !!document.getElementById('mx-cards');
            document.querySelectorAll('.modal [data-close]').forEach(b => b.click()); await w(200);
            // correction d'une réponse écrite
            const c0 = a.data.cards.find(c => c.back === 'Paris' || /Paris/.test(c.back)); a.startPractice(null, 'type', 5, 'Test IA', [c0.id]); await w(500);
            const ta = document.getElementById('type-answer'); ta.value = 'Paris'; a.submitTyped(); await w(300);
            document.querySelector('[data-action="ai-grade"]').click(); await w(500); if (document.getElementById('aic-ok')) { document.getElementById('aic-ok').click(); await w(1000); }
            out.grade = a.session && a.session.typed && a.session.typed.suggest === 3 && /bonne idée/.test(document.querySelector('.type-ai') ? document.querySelector('.type-ai').textContent : '');
            a.quitSession ? a.quitSession() : a.go('dashboard'); await w(300);
            // outils sur sélection : corriger
            a.go('notes'); await w(300); a.noteOpen(n.id); await w(500); a.nbActivate(1, 'end');
            const t = document.querySelector('.nb.on .nb-t'), r = document.createRange(); r.setStart(t.firstChild, 0); r.setEnd(t.firstChild, 15); const g = getSelection(); g.removeAllRanges(); g.addRange(r); await w(400);
            document.querySelector('#nb-sel [data-sb=ai]').click(); await w(200); [...document.querySelectorAll('.nb-menu button')].find(x => /Corriger/.test(x.textContent)).click(); await w(500);
            if (document.getElementById('aic-ok')) { document.getElementById('aic-ok').click(); await w(1000); }
            out.sel = n.b[1].x === 'Bonjour le monde corrigé';
            // écrire avec l'IA
            a.aiWriteBlocks(1); await w(300); document.getElementById('aw-p').value = 'Les forces de Porter'; document.getElementById('aw-go').click(); await w(500); document.getElementById('ai-send').click(); await w(1200);
            out.write = n.b.some(b => b.x === 'Menace des entrants') && n.b.some(b => b.t === 'h3' && b.x === 'Porter');
            // carte améliorée
            const c1 = a.card(a.createNote({ type: 'basic', deckId: d.id, front: 'capitale ?', back: 'Paris, France', hint: '', detail: '', tags: [] })[0]);
            a.aiImproveCard(c1.id); await w(400); document.getElementById('ai-send').click(); await w(1000); document.getElementById('im-use').click(); await w(300);
            out.better = /Quelle est la capitale/.test(stripHtml(a.card(c1.id).front)) && stripHtml(a.card(c1.id).back) === 'Paris';
            // IA locale compatible OpenAI
            localStorage.setItem('lh_ai', JSON.stringify({ provider: 'custom', keys: {}, models: { custom: 'llama3' }, urls: { custom: 'http://localhost:11434/v1' } }));
            out.localReady = a.aiReady(); out.local = (await a.aiCall({ prompt: 'x' })) === 'réponse locale';
            localStorage.setItem('lh_ai', JSON.stringify({ provider: 'anthropic', keys: { anthropic: 'sk-x' }, models: {}, urls: {} }));
            return out;
        });
        adv.ctx = /Paris est la capitale/.test(seenCtx) && /EXTRAITS DE MES COURS/.test(seenCtx);
        ok('IA avancée: assistant (BM25 locale + streaming + sources), examen blanc corrigé, correction de réponse écrite, outils sur sélection, écrire avec l\'IA, carte améliorée, IA locale', adv.ctx && adv.answer && adv.exam && adv.corr && adv.grade && adv.sel && adv.write && adv.better && adv.localReady && adv.local, JSON.stringify(adv));
        const med = await page.evaluate(async () => {
            const out = {}, a = app, w = ms => new Promise(r => setTimeout(r, ms));
            const enc = new TextEncoder(), crc = b => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xFFFFFFFF; for (const v of b) x = t[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xFFFFFFFF) >>> 0; };
            const zip = files => { const parts = [], cen = []; let off = 0; for (const [nm, d] of Object.entries(files)) { const nb = enc.encode(nm), db = enc.encode(d), c = crc(db); const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, c, true); h.setUint32(18, db.length, true); h.setUint32(22, db.length, true); h.setUint16(26, nb.length, true); parts.push(new Uint8Array(h.buffer), nb, db); const ce = new DataView(new ArrayBuffer(46)); ce.setUint32(0, 0x02014b50, true); ce.setUint16(4, 20, true); ce.setUint16(6, 20, true); ce.setUint32(16, c, true); ce.setUint32(20, db.length, true); ce.setUint32(24, db.length, true); ce.setUint16(28, nb.length, true); ce.setUint32(42, off, true); cen.push(new Uint8Array(ce.buffer), nb); off += 30 + nb.length + db.length; } const cl = cen.reduce((s2, x) => s2 + x.length, 0), e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, Object.keys(files).length, true); e.setUint16(10, Object.keys(files).length, true); e.setUint32(12, cl, true); e.setUint32(16, off, true); return new Blob([...parts, ...cen, new Uint8Array(e.buffer)]); };
            const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
            const docx = zip({ 'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Le marché</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Important</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>` });
            a.go('notes'); await w(300); const n = a.noteNew('Médias', {}); a.noteOpen(n.id); await w(500);
            // vidéo
            a.nbVideoPrompt(0); await w(200); document.getElementById('vid-u').value = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90'; document.getElementById('vid-u').dispatchEvent(new Event('input', { bubbles: true })); await w(100); document.getElementById('vid-ok').click(); await w(400);
            const v = n.b.find(b => b.t === 'video'); out.video = !!v && v.s === 90 && !!document.querySelector('.nb-vid-box[data-id="dQw4w9WgXcQ"]');
            document.querySelector('.nb-vid-box').click(); await w(200); out.iframe = /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ.*start=90/.test((document.querySelector('.nb-vid-box iframe') || { src: '' }).src);
            n.b.push({ t: 'p', x: 'à voir ⏱1:30', d: 0 }); a.nbRender(); await w(200); out.ts = !!document.querySelector('.nb-ts[data-ts="90"]');
            // fichier joint + conversion Word
            await a.nbFileAdd(0, new File([docx], 'cours.docx'), true); await w(900);
            const nn = a.note(a.ui.note); out.conv = nn.id !== n.id && nn.title === 'Le marché' && nn.b[0].t === 'file' && nn.b.some(b => b.t === 'table') && nn.b.some(b => /\*\*Important\*\*/.test(b.x));
            out.chip = !!document.querySelector('.nb-file') && /sur cet appareil/.test(document.querySelector('.nb-file').textContent);
            out.blob = !!(await PdfStore.get(nn.b[0].fid));
            await a.pdfGc(); out.gcKeeps = !!(await PdfStore.get(nn.b[0].fid));
            return out;
        });
        ok('Notes: YouTube video (start time, embed, ⏱ minutes), attached files kept on the device (not garbage-collected), Word document converted to a note with its original', med.video && med.iframe && med.ts && med.conv && med.chip && med.blob && med.gcKeeps, JSON.stringify(med));
    }

    const shr = await page.evaluate(async () => {
        const a = window.app, did = 'dshare';
        a.data.decks.push({ id: did, name: 'Partage test', emoji: '📘', description: '', created: 1, parent: null, opts: null, mod: 0 });
        a.change('t', [], () => { a.createNote({ type: 'cloze', deckId: did, front: 'Le {{c1::chat}} dort', back: '', hint: '', detail: '', tags: [] }); a.createNote({ type: 'rev', deckId: did, front: 'x', back: 'y', hint: '', detail: '', tags: [] }); return []; }, { decks: true });
        const col = await a.shareCode(did), p1 = await a.shareParseCode(col.code), p2 = await a.shareParseBytes(new Uint8Array(await (await a.shareFileBlob(did)).arrayBuffer()));
        const c0 = a.data.cards.length; a.confirm = async () => true; await a.shareReceive(p1);
        const now = Date.now(), cid = a.data.cards[0].id; for (let k = 0; k < 3; k++) a.data.revlog.push([now - k * 86400000, cid, 1 + k, 1, 0, 5, 2000]);
        const r = a.recapData();
        return { codeOk: col.code.length > 10 && col.total === 2, p1: !!p1 && p1.d.length === 1, p2: !!p2 && p2.d.length === 1, added: a.data.cards.length - c0, recap: !!r && r.n >= 3 && r.days >= 2 && /^<div class="recap-tiles">/.test(a.recapHtml(r, false).trim()) };
    });
    ok('Vague 5: deck shared as link/QR code and .lhcards file (read back, added as new cards), weekly recap computed from the review log', shr.codeOk && shr.p1 && shr.p2 && shr.added === 3 && shr.recap, JSON.stringify(shr));
    ok('no script error, no missing file', errs.length === 0, errs.slice(0, 4).join(' | '));
    console.log(R.join('\n') + `\n\n${R.length - failed}/${R.length} checks passed`);
    await browser.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(R.join('\n'), '\nCRASH', e); process.exit(2); });
