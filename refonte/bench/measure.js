/* Banc de mesure : compare l'application actuelle (racine du dépôt) et le prototype (refonte/proto).
   Usage : node refonte/bench/measure.js            → écrit refonte/bench/resultats.json et des captures
   Mesures : poids transféré au démarrage, temps jusqu'à l'accueil interactif, éléments DOM par écran,
   changement d'onglet (CPU ralenti x4, premier affichage et retour), tâches longues, coût d'une notation. */
'use strict';
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '../..');
const OUT = path.resolve(__dirname, 'resultats.json');
const SHOTS = path.resolve(__dirname, '../captures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };

function serve(root, port) {
    const server = http.createServer((req, res) => {
        const f = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
        if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
        fs.createReadStream(f).pipe(res);
    });
    return new Promise(r => server.listen(port, () => r(server)));
}

/* Chaque application décrit comment l'ouvrir et comment naviguer. */
const APPS = {
    get 'prototype-3700'() { return { ...this.prototype, url: 'index.html?charge=3700' }; },
    actuelle: {
        root: REPO, url: 'index.html', ready: '.hero',
        tabs: ['decks', 'stats', 'settings', 'toeic', 'dashboard'],
        tabSel: v => `.bottom-nav [data-nav="${v}"]`,
        viewSel: v => `#view-${v}`,
        invalidate: 'app._ver++',            // force la reconstruction (premier affichage du jour, ou après une révision)
        startReview: async page => { await page.click('.hero [data-action="study"]'); await page.waitForSelector('#view-session:not(.hidden)'); },
        reveal: '[data-action="reveal"]',
        grade: '[data-grade="3"]'
    },
    prototype: {
        root: path.join(REPO, 'refonte/proto'), url: 'index.html', ready: '[data-ready] [data-screen]',
        tabs: ['paquets', 'progres', 'toeic', 'reglages', 'accueil'],
        tabSel: v => `.tabbar [data-tab="${v}"]`,
        viewSel: v => `[data-screen="${v}"]`,
        invalidate: 'window.__lh && window.__lh.invalidate()',
        startReview: async page => { await page.click('[data-action="reviser"]'); await page.waitForSelector('.review[data-open]'); },
        reveal: '[data-action="retourner"]',
        grade: '[data-note="3"]'
    }
};

async function measureApp(name, cfg, browser, port) {
    const server = await serve(cfg.root, port);
    const base = `http://localhost:${port}/`;
    const res = { app: name };
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route(/fonts\.(googleapis|gstatic)|supabase|mymemory/, r => r.abort());

    /* 1. poids transféré jusqu'à l'accueil (hors polices externes, coupées pour les deux) */
    let bytes = 0; const files = [];
    page.on('response', async r => { try { const b = await r.body(); bytes += b.length; files.push([r.url().replace(base, ''), b.length]); } catch { /* redirections */ } });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const t0 = Date.now();
    await page.goto(base + cfg.url, { waitUntil: 'commit' });
    await page.waitForSelector(cfg.ready, { timeout: 60000 });
    res.accueilInteractifMs_cpu4 = Date.now() - t0;
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.waitForTimeout(1500);
    res.poidsDemarrageKo = Math.round(bytes / 1024);
    res.fichiersDemarrage = files.sort((a, b) => b[1] - a[1]).slice(0, 6).map(([u, b]) => `${u.slice(-40)} ${Math.round(b / 1024)} Ko`);
    res.domAccueil = await page.evaluate(() => document.querySelectorAll('*').length);
    /* relance (cas courant : l'appli installée est rouverte, données déjà en base) */
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const t1 = Date.now();
    await page.reload({ waitUntil: 'commit' });
    await page.waitForSelector(cfg.ready, { timeout: 60000 });
    res.relanceMs_cpu4 = Date.now() - t1;
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOTS, `${name}-accueil-390.png`) });

    /* 2. changement d'onglet, CPU ralenti x4 : temps entre le toucher et la 2e image peinte + tâches longues */
    await page.evaluate(() => {
        window.__lt = [];
        new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(e.duration))).observe({ type: 'longtask', buffered: false });
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const tab = async (v, invalidate) => {
        if (invalidate) await page.evaluate(cfg.invalidate);
        await page.evaluate(() => { window.__lt.length = 0; });
        const ms = await page.evaluate(async sel => {
            const b = document.querySelector(sel); const t = performance.now();
            b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.click();
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            return performance.now() - t;
        }, cfg.tabSel(v));
        await page.waitForTimeout(1600);   // les animations d'entrée et le rendu différé se terminent
        if (cfg.root.endsWith('proto')) await page.evaluate(() => scrollTo(0, 0));
        const lt = await page.evaluate(() => window.__lt.slice());
        const dom = await page.evaluate(() => document.querySelectorAll('*').length);
        const domVue = await page.evaluate(sel => { const e = document.querySelector(sel); return e ? e.querySelectorAll('*').length : 0; }, cfg.viewSel(v));
        return { ms: Math.round(ms), tachesLongues: lt.length, tacheLaPlusLongueMs: Math.round(Math.max(0, ...lt)), domTotal: dom, domEcran: domVue };
    };
    res.onglets = {};
    for (const v of cfg.tabs) res.onglets[v] = { premier: await tab(v, true) };
    for (const v of cfg.tabs) res.onglets[v].retour = await tab(v, false);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    for (const v of cfg.tabs.slice(0, 2)) { await page.click(cfg.tabSel(v)); await page.waitForTimeout(900); await page.screenshot({ path: path.join(SHOTS, `${name}-${v}-390.png`) }); }
    await page.click(cfg.tabSel(cfg.tabs[cfg.tabs.length - 1])); await page.waitForTimeout(900);

    /* 3. révision : coût d'un retournement et d'une notation (CPU x4) */
    try {
        await cfg.startReview(page);
        await page.waitForTimeout(800);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        const samples = [];
        for (let i = 0; i < 5; i++) {
            await page.evaluate(() => { window.__lt.length = 0; });
            const flip = await page.evaluate(async sel => { const b = document.querySelector(sel); if (!b) return -1; const t = performance.now(); b.click(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t; }, cfg.reveal);
            await page.waitForTimeout(500);
            const grade = await page.evaluate(async sel => { const b = document.querySelector(sel); if (!b) return -1; const t = performance.now(); b.click(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t; }, cfg.grade);
            await page.waitForTimeout(700);   // l'enregistrement différé (250 ms dans l'actuelle) a lieu ici
            const lt = await page.evaluate(() => window.__lt.slice());
            samples.push({ flip: Math.round(flip), note: Math.round(grade), tacheLaPlusLongue: Math.round(Math.max(0, ...lt)) });
        }
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        res.revision = samples;
        res.domRevision = await page.evaluate(() => document.querySelectorAll('*').length);
        await page.screenshot({ path: path.join(SHOTS, `${name}-revision-390.png`) });
    } catch (e) { res.revision = 'non mesuré : ' + e.message.split('\n')[0]; }

    /* 4. coût d'un enregistrement (application actuelle : tout l'état est re-sérialisé) */
    if (name === 'actuelle') {
        res.enregistrement = await page.evaluate(async () => {
            const t = performance.now(); app.save(); const sig = performance.now() - t;
            const t2 = performance.now(); const json = app.serialize(); const ser = performance.now() - t2;
            return { detectChangesMs_cpu1: Math.round(sig), serialiseMs_cpu1: Math.round(ser), tailleEtatKo: Math.round(json.length / 1024), cartes: app.data.cards.length, revlog: app.data.revlog.length };
        });
    }
    res.erreursConsole = errors.slice(0, 5);
    await ctx.close();
    server.close();
    return res;
}

(async () => {
    fs.mkdirSync(SHOTS, { recursive: true });
    const only = process.argv[2];
    const browser = await chromium.launch();
    const results = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
    let port = 8810;
    for (const [name, cfg] of Object.entries(APPS)) {
        if (only && only !== name) continue;
        process.stdout.write(`Mesure : ${name}… `);
        results[name] = await measureApp(name, cfg, browser, port++);
        console.log('ok');
    }
    results.date = new Date().toISOString();
    results.machine = 'Chromium (Playwright) sans GPU, conteneur Linux ; CPU ralenti x4 = approximation d\'un iPhone de milieu de gamme ancien';
    fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
    await browser.close();
    console.log(JSON.stringify(results, null, 2));
})();
