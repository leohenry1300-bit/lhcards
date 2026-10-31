/* ============================================================
   PDF : outils d'étude — liste de mes annotations (filtre couleur), signets, mode nuit, deux pages (ordinateur), marges recadrées,
   zone → image dans la note / image à masquer, barre « Plus » sur téléphone, actions IA sur une sélection.
   ============================================================ */
Object.assign(ICONS, {
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/>',
    columns: '<rect x="3" y="4" width="8" height="16" rx="1"/><rect x="13" y="4" width="8" height="16" rx="1"/>'
});
const PDF_CROPS = [['Aucun', 0], ['Léger', 0.05], ['Moyen', 0.1], ['Fort', 0.15]];
Object.assign(SuperAnki.prototype, {
    /* ---------- display: night mode, two pages (computer), cropped margins ---------- */
    pdfCropv() { const c = Number(this.pdfPrefs().crop) || 0; return PDF_CROPS.some(x => x[1] === c) ? c : 0; },
    pdfTwoOn() { const sc = $('#pdf-scroll'); return !!this.pdfPrefs().two && this.pdfWide() && !!sc && sc.clientWidth >= 820 && this.pv && this.pv.mode !== 'text'; },
    pdfCssWidth() {
        const sc = $('#pdf-scroll'), cw = Math.max(220, (sc ? sc.clientWidth : 360) - (this.pdfWide() ? 36 : 12));
        const base = this.pdfTwoOn() ? (cw - 14) / 2 : cw;
        return Math.max(220, base / (1 - 2 * this.pdfCropv()) * this.pv.zoom);
    },
    pdfApplyView() {
        const pv = this.pv, v = $('.pdfv'); if (!pv || !v) return;
        const P = this.pdfPrefs(), c = this.pdfCropv();
        v.classList.toggle('night', !!P.night); v.classList.toggle('two', this.pdfTwoOn());
        pv.pages.forEach(pg => {
            if (!pg.el) return;
            pg.el.style.clipPath = c ? `inset(${c * 100}%)` : '';
            pg.el.style.margin = c ? `${-c * (pg.ch || 0)}px ${-c * (pg.cw || 0)}px` : '';
        });
    },
    pdfReflow() {
        const pv = this.pv; if (!pv || !pv.pages.length) return;
        const sc = $('#pdf-scroll'), i = this.pdfCurrent(), cur = pv.pages[i], rel = cur ? (sc.scrollTop - cur.el.offsetTop) / Math.max(1, cur.ch) : 0;
        this.pdfSizePages(); pv.pages.forEach(pg => { if (pg.state) this.pdfUnrender(pg); });
        if (cur) sc.scrollTop = cur.el.offsetTop + rel * cur.ch;
        pv.pages.forEach(pg => { const r = pg.el.getBoundingClientRect(), s = sc.getBoundingClientRect(); if (r.bottom > s.top - s.height && r.top < s.bottom + s.height) this.pdfRenderPage(pg); });
    },
    pdfViewMenu(anchor) {
        const P = this.pdfPrefs(), c = this.pdfCropv(), wide = this.pdfWide();
        this.showMenu(anchor, [
            { icon: 'moon', label: P.night ? 'Mode nuit : activé' : 'Mode nuit (réviser le soir)', fn: () => { P.night = !P.night; this.pdfPrefSave(); this.pdfApplyView(); } },
            ...(wide ? [{ icon: 'columns', label: P.two ? 'Deux pages côte à côte : activé' : 'Deux pages côte à côte', fn: () => { P.two = !P.two; this.pdfPrefSave(); this.pdfReflow(); } }] : []),
            { sep: true },
            ...PDF_CROPS.map(([l, v]) => ({ icon: 'crop', label: `Marges recadrées : ${l}${v === c ? ' ✓' : ''}`, fn: () => { P.crop = v; this.pdfPrefSave(); this.pdfReflow(); } })),
            { sep: true },
            { icon: 'flag', label: 'Signets…', fn: () => this.pdfBookmarks() },
            { icon: 'list', label: 'Mes annotations…', fn: () => this.pdfAnnList() }
        ]);
    },

    pdfAskName(title, value) {
        return new Promise(res => {
            let done = false; const fin = v => { if (!done) { done = true; res(v); } };
            const m = this.openModal({ title, size: 'narrow', body: `<div class="field"><input class="input" id="pk-n" maxlength="40" value="${esc(value)}"></div>`, foot: '<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="pk-go">OK</button>', onClose: () => fin(null) });
            const go = () => { fin($('#pk-n', m).value); this.closeModal(m); };
            $('#pk-go', m).addEventListener('click', go); $('#pk-n', m).addEventListener('keydown', e => { if (e.key === 'Enter') go(); }); setTimeout(() => { const i = $('#pk-n', m); i.focus(); i.select(); }, 40);
        });
    },
    /* ---------- bookmarks (a few flags per PDF, kept with the PDF) ---------- */
    pdfBookmarks() {
        const pv = this.pv; if (!pv) return; const p = pv.p; p.bm = p.bm || [];
        const num = pid => this.pdfPageIndex(p, pid) + 1;
        const m = this.openModal({ title: `${ic('flag')} Signets`, size: 'narrow', body: '<div id="bm-root"></div>' });
        const paint = () => {
            $('#bm-root', m).innerHTML = `<button class="btn btn-primary btn-block" data-bm="add" ${p.bm.length >= 8 ? 'disabled' : ''}>${ic('plus')}Ajouter un signet à la page ${this.pdfCurrent() + 1}</button>
                <div class="al-list" style="margin-top:12px">${p.bm.length ? p.bm.filter(b => num(b.pid) > 0).sort((a, b) => num(a.pid) - num(b.pid)).map(b => `<div class="row-gap" style="align-items:center"><button class="btn btn-soft" style="flex:1;justify-content:flex-start" data-bm="go" data-id="${esc(b.id)}">${ic('flag')}<span>${esc(b.t || 'Page ' + num(b.pid))} · p. ${num(b.pid)}</span></button><button class="icon-btn icon-btn-sm" data-bm="ren" data-id="${esc(b.id)}" aria-label="Renommer">${ic('pencil')}</button><button class="icon-btn icon-btn-sm" data-bm="del" data-id="${esc(b.id)}" aria-label="Retirer">${ic('x')}</button></div>`).join('') : '<p class="small muted">Aucun signet. Marque jusqu\'à 8 pages clés (définitions, schémas, formules…).</p>'}</div>`;
        };
        paint();
        m.addEventListener('click', async e => {
            const b = e.target.closest('[data-bm]'); if (!b) return; const k = b.dataset.bm, id = b.dataset.id, bk = p.bm.find(x => x.id === id);
            const save = () => { p.mod = Date.now(); this.save(false); };
            if (k === 'add') { const g = p.pg[this.pdfCurrent()]; if (!g) return; if (p.bm.some(x => x.pid === g.id)) { this.toast('Cette page a déjà un signet.', 'warning'); return; } p.bm.push({ id: uid('k'), pid: g.id, t: '' }); save(); paint(); }
            else if (k === 'go' && bk) { this.closeModal(m); this.pdfGoto(bk.pid); }
            else if (k === 'del' && bk) { p.bm = p.bm.filter(x => x.id !== id); save(); paint(); }
            else if (k === 'ren' && bk) { const t = await this.pdfAskName('Nom du signet', bk.t || `Page ${num(bk.pid)}`); if (t != null) { bk.t = String(t).trim().slice(0, 40); save(); paint(); } }
        });
    },

    /* ---------- list of my annotations, with a colour filter ---------- */
    pdfAnnList() {
        const pv = this.pv; if (!pv) return; const p = pv.p;
        const all = [];
        p.pg.forEach((g, gi) => (p.ann[g.id] || []).forEach(a => { if ((a.t === 'hl' || a.t === 'tx' || a.t === 'nt') && String(a.s || '').trim()) all.push({ pid: g.id, n: gi + 1, a }); }));
        const colors = [...new Set(all.map(x => x.a.c))];
        let flt = '', q = '';
        const m = this.openModal({ title: `${ic('list')} Mes annotations`, size: 'wide', body: `<div id="al-root"></div>`, foot: `<button class="btn btn-soft" data-close>Fermer</button><button class="btn btn-primary" data-al="extract">${ic('note')}Tout extraire</button>` });
        const paint = () => {
            const rows = all.filter(x => (!flt || x.a.c === flt) && (!q || fold(x.a.s).includes(fold(q))));
            $('#al-root', m).innerHTML = `${all.length ? `<div class="row-gap" style="margin-bottom:10px;flex-wrap:wrap"><button class="chip ${flt ? '' : 'active'}" data-al="flt" data-c="">Tout <span class="count">${all.length}</span></button>${colors.map(c => `<button class="chip ${flt === c ? 'active' : ''}" data-al="flt" data-c="${esc(c)}"><i style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${esc(c)};border:1px solid rgba(0,0,0,.25)"></i> <span class="count">${all.filter(x => x.a.c === c).length}</span></button>`).join('')}</div>
                <label class="input-icon" style="margin-bottom:10px">${ic('search')}<input class="input" id="al-q" placeholder="Rechercher dans mes annotations…" value="${esc(q)}" autocomplete="off"></label>` : ''}
                <div class="al-list">${rows.length ? rows.slice(0, 300).map((x, i) => `<div class="al-row"><button class="al-go" data-al="go" data-i="${all.indexOf(x)}"><i class="al-dot" style="background:${esc(x.a.c)}"></i><span class="al-t">${esc(truncate(x.a.s, 160))}</span><b>p. ${x.n}</b></button><button class="icon-btn icon-btn-sm" data-al="cite" data-i="${all.indexOf(x)}" title="Citer dans la note" aria-label="Citer dans la note">${ic('note')}</button></div>`).join('') : `<p class="small muted">${all.length ? 'Aucune annotation ne correspond.' : 'Aucun surlignage ni texte pour l\'instant. Sélectionne du texte du PDF pour le surligner : il apparaîtra ici.'}</p>`}</div>`;
            const inp = $('#al-q', m); if (inp) inp.addEventListener('input', () => { q = inp.value; const pos = inp.selectionStart; paint(); const n2 = $('#al-q', m); if (n2) { n2.focus(); n2.setSelectionRange(pos, pos); } });
        };
        paint();
        m.addEventListener('click', e => {
            const b = e.target.closest('[data-al]'); if (!b) return; const k = b.dataset.al, x = all[Number(b.dataset.i)];
            if (k === 'flt') { flt = b.dataset.c; paint(); }
            else if (k === 'go' && x) { this.closeModal(m); this.pdfGoto(x.pid, String(x.a.s).slice(0, 80)); }
            else if (k === 'cite' && x) { this.pdfCite(x.a.s, x.pid); }
            else if (k === 'extract') { this.closeModal(m); this.pdfExtract(); }
        });
    },

    /* ---------- a zone of a page → picture in the note / picture to hide ---------- */
    pdfAreaToNote(area) {
        const pv = this.pv, pg = pv.pages.find(x => x.g.id === area.pid), url = pg && this.pdfAreaImage(pg, area.rect); if (!url) { this.toast('La page n\'est pas encore affichée.', 'warning'); return; }
        const n = this.pdfNoteOf(pv.p), i = this.pdfPageIndex(pv.p, area.pid) + 1; if (!pv.notes) this.pdfToggleNotes(true);
        this.nbPush(); const at = this.nb.active >= 0 && n.b[this.nb.active] ? this.nb.active + 1 : n.b.length;
        const blocks = [{ t: 'img', src: this.addMedia(url), d: 0 }, { t: 'quote', x: `[[pdf:${pv.p.id}:${area.pid}|page ${i}]]`, d: 0 }];
        if (n.b.length === 2 && !n.b[1].x && at === n.b.length) n.b.splice(1, 1, ...blocks, nbEmpty()); else n.b.splice(at, 0, ...blocks);
        this.nbChanged(); this.nbRender();
    },
    pdfAreaOcclude(area) {
        const pv = this.pv, pg = pv.pages.find(x => x.g.id === area.pid), url = pg && this.pdfAreaImage(pg, area.rect); if (!url) { this.toast('La page n\'est pas encore affichée.', 'warning'); return; }
        this.openOcclusionModal(null, this.pdfDeckOf(pv.p).id, { img: url, ref: '' });
    },

    /* ---------- the toolbar "Plus" on a phone ---------- */
    pdfMoreTools(anchor) {
        const pv = this.pdfOpts();
        this.showMenu(anchor, PDF_TOOLS2.filter(t => PDF_MORE.includes(t[0])).map(([id, ico, label]) => ({ icon: ico, label: label + (pv.tool === id ? ' ✓' : ''), fn: () => this.pdfAnnAction('pdf-tool', { dataset: { t: id }, closest: () => null, getBoundingClientRect: () => anchor.getBoundingClientRect() }) })));
    },

    /* ---------- AI on a selected passage ---------- */
    pdfAiSel(text, pid) {
        const n = this.pdfPageIndex(this.pv.p, pid) + 1;
        const run = async kind => {
            if (!this.aiReady()) { this.aiNeedKey(); return; }
            if (kind === 'cards') {
                const lines = await this.aiCardsFrom(`[page ${n}]\n${text}`, { label: `Sélection du PDF « ${this.pv.p.name} »`, count: 6, deckId: this.pv.p.pdeck || '' }); if (!lines) return;
                const srcs = this.aiSources(this.pv.p, `[page ${n}]\n${text}`, lines.meta || [], null);
                this.openImportModal({ text: lines.join('\n'), ai: true, deckId: this.pv.p.pdeck || '', srcs }); return;
            }
            if (!(await this.aiConsentOnce('pdfsel', 'IA sur le PDF', 'le passage que tu as sélectionné'))) return;
            const P = { explain: 'Explique ce passage de cours simplement, en 3 à 5 phrases, même langue que le texte.', short: 'Résume ce passage en une ou deux phrases, même langue.', simple: 'Reformule ce passage avec des mots plus simples, même langue.' }[kind];
            const m = this.openModal({ title: `${ic('sparkle')} ${kind === 'explain' ? 'Explication' : kind === 'short' ? 'Résumé' : 'Plus simple'}`, size: 'narrow', body: '<p class="small muted" id="ps-st">L\'IA réfléchit…</p><div id="ps-out"></div>' });
            try {
                const out = (await this.aiCall({ system: `${P} Réponds uniquement par le résultat, sans Markdown.`, prompt: text.slice(0, 4000), maxTokens: 600 })).trim();
                $('#ps-st', m).textContent = '✨ Généré par IA, à vérifier.';
                $('#ps-out', m).innerHTML = `<p style="white-space:pre-wrap">${esc(out)}</p><div class="row-gap" style="margin-top:10px"><button class="btn btn-primary btn-sm" id="ps-add">${ic('note')}Ajouter à la note</button></div>`;
                $('#ps-add', m).addEventListener('click', () => { this.closeModal(m); this.pdfCite(out, pid); });
            } catch (e) { $('#ps-st', m).textContent = e && e.ai ? e.message : 'Erreur inattendue.'; }
        };
        return run;
    }
});
const PDF_MORE = ['pick', 'marker', 'pen', 'shape', 'arrow', 'note'];
(() => {   /* pages are measured again when the view settings change */
    const base = SuperAnki.prototype.pdfSizePages;
    SuperAnki.prototype.pdfSizePages = function (...a) { const r = base.apply(this, a); try { this.pdfApplyView(); } catch { /* ignore */ } return r; };
    let w0 = window.innerWidth <= 767;
    window.addEventListener('resize', () => { const w1 = window.innerWidth <= 767; if (window.app && app.pv && app.view === 'pdf') { if (w1 !== w0) app.pdfRefreshTools(); clearTimeout(app._pdfRz); app._pdfRz = setTimeout(() => { if (app.pv && (app.pdfPrefs().two || app.pdfCropv())) app.pdfReflow(); }, 250); } w0 = w1; });
})();
