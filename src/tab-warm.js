/* ============================================================
   Aperçu des onglets voisins : quand on glisse d'un onglet à l'autre (téléphone), l'onglet d'à côté est déjà dessiné
   (préparé en douce quand l'appli est au repos), pour qu'il apparaisse tout de suite à côté de la page, comme sur Instagram.
   ============================================================ */
Object.assign(SuperAnki.prototype, {
    tabWarmOne(view) {
        const el = $(`#view-${view}`); if (!el || this.view === view || this.session || this.modals.length) return;
        if (el._warm === this._ver && el.innerHTML.length > 300) return;
        const keep = { v: this.view, n: this.ui.note, f: this.ui.nbFolder, m: this.ui.nbMem }, hid = el.classList.contains('hidden');
        try {
            this.view = view; if (view === 'notes') { this.ui.note = null; this.ui.nbFolder = null; this.ui.nbMem = false; }
            ({ dashboard: () => this.renderDashboard(), decks: () => this.renderDecks(), notes: () => this.renderNotes(), stats: () => this.renderStats(), settings: () => this.renderSettings() })[view]();
            el._warm = this._ver; (this._rv = this._rv || {})[view] = { v: this._ver || 0, t: Date.now(), d: dayKey() };   // (go() can then simply keep this page when it is shown)
        } catch (e) { console.warn('warm', view, e); }
        finally { this.view = keep.v; this.ui.note = keep.n; this.ui.nbFolder = keep.f; this.ui.nbMem = keep.m; if (hid) el.classList.add('hidden'); }
    },
    tabWarmSoon() {
        if (!matchMedia('(pointer: coarse)').matches || this.calm() || document.documentElement.dataset.lite) return;   // only useful on a phone, never on a slow device
        clearTimeout(this._warmT);
        this._warmT = setTimeout(() => {
            const ORDER = ['dashboard', 'decks', 'notes', 'stats', 'settings'], i = ORDER.indexOf(this.view); if (i < 0) return;
            const todo = [ORDER[i + 1], ORDER[i - 1], ...ORDER].filter((v, k, a) => v && v !== this.view && a.indexOf(v) === k); let k = 0;
            const next = () => { if (k >= todo.length || this.session) return; const v = todo[k++]; (window.requestIdleCallback || (f => setTimeout(f, 60)))(() => { this.tabWarmOne(v); next(); }, { timeout: 1500 }); };
            next();
        }, 1200);
    }
});
(() => { const base = SuperAnki.prototype.go; SuperAnki.prototype.go = function (...a) { const r = base.apply(this, a); try { this.tabWarmSoon(); } catch { /* ignore */ } return r; }; })();

/* keyboard up = bottom bar hidden (never moved) ; keyboard down = the page is put back exactly where it was */
(() => {
    if (!matchMedia('(pointer: coarse)').matches) return;
    const field = el => !!(el && el.matches && el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=button]), textarea, [contenteditable=""], [contenteditable="true"]'));
    const upd = () => document.body.classList.toggle('kb-open', field(document.activeElement));
    document.addEventListener('focusin', upd);
    document.addEventListener('focusout', () => setTimeout(() => { upd(); if (!document.body.classList.contains('kb-open')) { const y = window.scrollY; window.scrollTo(0, y); } }, 120));
})();

/* Bottom bar guard : iOS sometimes leaves the page's "layout viewport" shorter than what is really visible (the bar then floats above the
   bottom edge with page content showing under it). This only measures; when the visible area is clearly taller than the layout viewport (no zoom,
   no rubber band, no keyboard) the bar is lowered by exactly that gap. A rubber band or a keyboard never counts (offsetTop / smaller height). */
(() => {
    if (!matchMedia('(pointer: coarse)').matches || !window.visualViewport) return;
    const vv = window.visualViewport; let tm = 0;
    const measure = () => {
        const nav = document.querySelector('.bottom-nav'); if (!nav || getComputedStyle(nav).display === 'none') return;
        const lay = window.innerHeight, vis = Math.round(vv.height + vv.offsetTop), ok = Math.abs(vv.scale - 1) < 0.02 && vv.offsetTop < 1;
        const cur = parseFloat(document.documentElement.style.getPropertyValue('--navgap')) || 0, gap = ok ? vis - lay : 0, r = nav.getBoundingClientRect(), under = Math.round(vis - (r.bottom - cur));
        window.__navDiag = { inner: lay, vv: Math.round(vv.height), top: Math.round(vv.offsetTop), scale: +vv.scale.toFixed(2), clientH: document.documentElement.clientHeight, screenH: screen.height, navBottom: Math.round(r.bottom), gapUnderBar: under, applied: 0 };
        /* installed app : the right layout height is remembered (the biggest one seen, per orientation, outside the keyboard); when iOS later reports a clearly shorter one
           (typically right after an update reload) the bar is lowered by exactly the missing part */
        let fixB = 0;
        try {
            const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
            if (standalone && Math.abs(vv.scale - 1) < 0.02 && !document.body.classList.contains('kb-open') && !(document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) || document.activeElement && document.activeElement.isContentEditable)) {
                const k = 'lh_vh_' + (matchMedia('(orientation: portrait)').matches ? 'p' : 'l'), g = Number(localStorage.getItem(k)) || 0;
                if (lay > g) localStorage.setItem(k, String(lay)); else if (g - lay >= 28 && g - lay <= 140) fixB = g - lay;
                window.__navDiag.good = g;
            }
        } catch { /* ignore */ }
        const fix = fixB || (ok && under > 6 && under < 160 ? under : 0);
        document.documentElement.style.setProperty('--navgap', fix + 'px'); window.__navDiag.applied = fix; if (fix && window.lhViewportKick) { /* floating bar found: ask WebKit to measure the screen again */ lhViewportKick(); }
    };
    const soon = () => { clearTimeout(tm); tm = setTimeout(measure, 120); };
    ['resize', 'orientationchange', 'pageshow', 'focusout', 'touchend', 'visibilitychange'].forEach(e => window.addEventListener(e, soon, { passive: true }));
    vv.addEventListener('resize', soon); window.addEventListener('scroll', soon, { passive: true });
    /* after the keyboard closes iOS can leave the page nudged : put it back, then measure again (a few times, the keyboard animation is slow) */
    document.addEventListener('focusout', () => { [150, 500, 1200].forEach(t => setTimeout(() => { const f = document.activeElement; if (f && (/^(INPUT|TEXTAREA)$/.test(f.tagName) || f.isContentEditable)) return; const y = window.scrollY; if (vv.offsetTop > 0 || vv.height < window.innerHeight - 2) { window.scrollTo(window.scrollX, y + 1); window.scrollTo(window.scrollX, y); } measure(); }, t)); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') [200, 800, 2000].forEach(t => setTimeout(measure, t)); });
    setInterval(measure, 4000);   // (a cheap measure : nothing moves unless a real gap is found)
    setTimeout(measure, 800); setTimeout(measure, 3000);
    /* small readout (installed app only) so a screenshot shows the real numbers : i = layout height, v = visible height, g = remembered height, a = correction */
    try {
        if ((navigator.standalone === true || matchMedia('(display-mode: standalone)').matches) && localStorage.getItem('lh_dbg') !== '0') {
            const b = document.createElement('div'); b.id = 'nav-dbg'; b.style.cssText = 'position:fixed;top:calc(env(safe-area-inset-top,0px) + 2px);left:4px;z-index:9999;font:9px/1.2 ui-monospace,monospace;background:rgba(0,0,0,.55);color:#9f9;padding:2px 5px;border-radius:5px;pointer-events:none';
            document.body.appendChild(b); setInterval(() => { const d = window.__navDiag; if (d) b.textContent = `i${d.inner} v${d.vv} t${d.top} g${d.good || '-'} u${d.gapUnderBar} a${d.applied}`; }, 700);
        }
    } catch { /* ignore */ }
})();

/* After a reload (typically the one that installs an update) iOS can leave the page's layout viewport shorter than the screen, so the bottom bar floats
   above the edge. Briefly re-writing the viewport meta tag makes WebKit measure the screen again. Done after a reload / an update, and whenever the guard
   above finds the bar floating (at most once every 20 s). The bar itself is never moved by script. */
window.lhViewportKick = () => {
    try {
        const m = document.querySelector('meta[name=viewport]'); if (!m || window.__kickAt && Date.now() - window.__kickAt < 20000) return; window.__kickAt = Date.now();
        const c = m.getAttribute('content'); m.setAttribute('content', c + ', minimum-scale=1');
        setTimeout(() => { m.setAttribute('content', c); window.dispatchEvent(new Event('resize')); }, 80);
    } catch { /* ignore */ }
};
(() => {
    let reloaded = false; try { reloaded = ((performance.getEntriesByType('navigation')[0] || {}).type === 'reload') || sessionStorage.getItem('lh_upd_done') === '1'; sessionStorage.removeItem('lh_upd_done'); } catch { /* ignore */ }
    if (reloaded) { setTimeout(window.lhViewportKick, 500); setTimeout(() => { window.__kickAt = 0; window.lhViewportKick(); }, 2500); }
    window.addEventListener('pageshow', e => { if (e.persisted) setTimeout(window.lhViewportKick, 300); });
})();
