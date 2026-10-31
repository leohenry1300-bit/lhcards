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
