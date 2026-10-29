/* ============================================================
   Onglets de documents : plusieurs PDF et notes ouverts en même temps, on passe de l'un à l'autre
   (barre en haut de l'onglet Notes et du lecteur PDF ; mémorisée sur l'appareil).
   ============================================================ */
Object.assign(SuperAnki.prototype, {
    tabsGet() {
        if (!this._dtabs) { try { this._dtabs = JSON.parse(localStorage.getItem('lh_tabs') || '[]') || []; } catch { this._dtabs = []; } }
        this._dtabs = this._dtabs.filter(t => t && (t.k === 'pdf' ? this.pdf(t.id) : t.k === 'mem' ? true : t.k === 'folder' ? (t.id === '__root' || this.deck(t.id)) : this.note(t.id)));
        return this._dtabs;
    },
    tabsSave() { try { localStorage.setItem('lh_tabs', JSON.stringify(this._dtabs || [])); } catch { /* ignore */ } },
    tabsAdd(k, id = '') {
        if (k === 'note' && this.pdfOfNote(id)) return;
        if (k === 'mem') id = '';   // the note of a PDF lives next to its PDF
        const t = this.tabsGet(); if (!t.some(x => x.k === k && x.id === id)) { t.push({ k, id }); while (t.length > 8) t.shift(); this.tabsSave(); }
    },
    tabInfo(x) {
        if (x.k === 'pdf') return { nm: this.pdf(x.id).name, ico: ic('pdf') };
        if (x.k === 'mem') return { nm: 'Cartes mémoire', ico: ic('copy') };
        if (x.k === 'folder') { const d = x.id === '__root' ? null : this.deck(x.id); return { nm: d ? d.name : 'Dossiers', ico: d ? esc(d.emoji) : ic('folder') }; }
        return { nm: this.noteName(this.note(x.id)), ico: ic('notebook') };
    },
    tabActive(t) { if (t.k === 'mem') return this.view === 'notes' && !this.ui.note && !!this.ui.nbMem; if (t.k === 'folder') return this.view === 'notes' && !this.ui.note && !this.ui.nbMem && this.ui.nbFolder === t.id; return t.k === 'pdf' ? this.view === 'pdf' && this.pv && this.pv.p.id === t.id : this.view === 'notes' && this.ui.note === t.id; },
    tabsHtml() {
        const t = this.tabsGet(); if (t.length < 2 && !(t.length && (this.view === 'pdf' || (this.view === 'notes' && (this.ui.note || this.ui.nbMem || this.ui.nbFolder))))) return '';
        return `<div class="doc-tabs" id="doc-tabs" role="tablist"><button class="dt-home" data-action="tab-list" title="Liste des notes" aria-label="Liste des notes">${ic('list')}</button>${t.map(x => {
            const { nm, ico } = this.tabInfo(x);
            return `<div class="dt ${this.tabActive(x) ? 'on' : ''}" role="tab" data-action="tab-open" data-k="${x.k}" data-id="${esc(x.id)}" title="${esc(nm)}">${ico}<span>${esc(truncate(nm, 26))}</span><button class="dt-x" data-action="tab-close" data-k="${x.k}" data-id="${esc(x.id)}" aria-label="Fermer l'onglet">${ic('x')}</button></div>`;
        }).join('')}<button class="dt-new" data-action="tab-new" title="Ouvrir un autre document dans un nouvel onglet" aria-label="Nouvel onglet">${ic('plus')}</button></div>`;
    },
    tabsRender() {
        const old = $('#doc-tabs'); if (old) old.remove();
        const h = this.tabsHtml(); if (!h) return;
        if (this.view === 'pdf') { const v = $('.pdfv'); if (v) v.insertAdjacentHTML('afterbegin', h); }
        else if (this.view === 'notes') { const v = $('#view-notes'); if (v) v.insertAdjacentHTML('afterbegin', h); }
        const on = $('#doc-tabs .dt.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
    },
    tabAction(action, el) {
        const k = el.dataset.k, id = el.dataset.id;
        if (action === 'tab-new') { this.quickOpen(); return; }
        if (action === 'tab-list') { this.ui.note = null; this.ui.nbFolder = null; this.ui.nbMem = false; if (this.view === 'notes') this.renderNotes(); else this.go('notes'); return; }
        if (action === 'tab-open') { if (this.tabActive({ k, id })) return; if (k === 'mem' || k === 'folder') { this.ui.note = null; this.ui.nbMem = k === 'mem'; this.ui.nbFolder = k === 'folder' ? id : null; if (this.view === 'notes') { this.renderNotes(); window.scrollTo(0, 0); } else this.go('notes'); return; } if (k === 'pdf') this.pdfOpen(id, { from: 'notes' }); else this.noteOpen(id, { push: false }); return; }
        if (action === 'tab-close') {
            const t = this.tabsGet(), i = t.findIndex(x => x.k === k && x.id === id); if (i < 0) return; const was = this.tabActive(t[i]);
            t.splice(i, 1); this.tabsSave();
            if (!was) { this.tabsRender(); return; }
            const nx = t[Math.min(i, t.length - 1)];
            if (nx) this.tabAction('tab-open', { dataset: { k: nx.k, id: nx.id } });
            else { this.ui.note = null; this.ui.nbMem = false; this.ui.nbFolder = null; if (this.view === 'notes') this.renderNotes(); else this.go('notes'); }
        }
    }
});
(() => {
    const wrap = (name, fn) => { const base = SuperAnki.prototype[name]; SuperAnki.prototype[name] = function (...a) { const r = base.apply(this, a); try { fn.call(this, a); } catch (e) { console.warn(e); } return r; }; };
    wrap('renderNotes', function () { this.tabsRender(); });
    wrap('renderPdf', function () { if (this.pv) this.tabsAdd('pdf', this.pv.p.id); this.tabsRender(); });
    wrap('noteOpen', function (a) { this.tabsAdd('note', a[0]); this.tabsRender(); });
})();
