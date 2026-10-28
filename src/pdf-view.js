/* ============================================================
   Lecteur de PDF : pages dessinées seulement quand elles sont visibles, zoom (pincement, boutons, Ctrl+molette),
   reprise à la dernière page, table des matières, recherche, lecteur de texte, lecture à voix haute, mode concentration,
   et la note du PDF à côté (PC : séparation qu'on tire, côté au choix ; téléphone : tiroir en bas).
   ============================================================ */
Object.assign(SuperAnki.prototype, {
    pdfPrefs() {
        if (!this._pdfp) { try { this._pdfp = JSON.parse(localStorage.getItem('lh_pdfui') || '{}') || {}; } catch { this._pdfp = {}; } const o = this._pdfp; o.side = o.side === 'left' ? 'left' : 'right'; o.pos = o.pos === 'bottom' ? 'bottom' : 'top'; o.notes = o.notes !== false; o.split = clamp(num(o.split, 0.4), 0.2, 0.7); o.rate = clamp(num(o.rate, 1), 0.6, 2); o.voice = String(o.voice || ''); o.fs = clamp(num(o.fs, 1), 0.8, 1.8); o.drawer = ['closed', 'half', 'full'].includes(o.drawer) ? o.drawer : 'half'; }
        return this._pdfp;
    },
    pdfPrefSave() { try { localStorage.setItem('lh_pdfui', JSON.stringify(this._pdfp)); } catch { /* ignore */ } },
    pdfWide() { return window.matchMedia('(min-width: 900px)').matches; },

    pdfOpen(id, opts = {}) {
        const p = this.pdf(id); if (!p) { this.toast('Ce PDF n\'existe plus.', 'warning'); return; }
        const pr = this.pdfPrefs(), wide = this.pdfWide();
        if (this.view === 'pdf' && this.pv && this.pv.p.id === p.id) { if (opts.pid || opts.page) this.pdfGoto(opts.pid || opts.page, opts.flash); return; }
        if (this.view === 'pdf' && this.pv) this.pdfLeave();
        this.pv = {
            p, doc: null, pages: [], tool: wide ? 'select' : 'hand', ci: 0, size: 1, zoom: p.zoom || 1, mode: p.mode, notes: pr.notes, drawer: pr.drawer, focus: false,
            undo: [], redo: [], texts: {}, goto: { pid: opts.pid || '', page: opts.page || 0, flash: opts.flash || '' }, from: opts.from === 'keep' ? 'notes' : (this.view === 'pdf' ? 'notes' : this.view), prevNote: this.ui.note, annotate: wide, read: null
        };
        this.go('pdf');
    },
    pdfLeave() {
        const pv = this.pv; if (!pv) return;
        try { this.pdfSpeakStop(); } catch { /* ignore */ }
        if (pv.obs) pv.obs.disconnect();
        pv.p.zoom = pv.zoom; pv.p.mode = pv.mode; this.nbIdle(true); this.pdfFlushNotes();
        document.body.classList.remove('pdf-open', 'pdf-zen');
        if (document.fullscreenElement) { try { document.exitFullscreen(); } catch { /* ignore */ } }
        this.ui.note = pv.prevNote && this.note(pv.prevNote) ? pv.prevNote : null; this.nbBarEnsure(false);
        this.save(); this.pv = null; this._pdfLeft = true;
    },
    pdfBack() { const f = (this.pv && this.pv.from) || 'notes'; this.go(f === 'pdf' ? 'notes' : f); },

    /* ---------- the screen ---------- */
    renderPdf() {
        const pv = this.pv; if (!pv) { this.go('notes'); return; }
        const p = pv.p, pr = this.pdfPrefs(), wide = this.pdfWide();
        document.body.classList.add('pdf-open'); document.body.classList.toggle('pdf-zen', pv.focus);
        $('#view-notes').innerHTML = '';   // the note of the PDF is shown here, with the same page elements: they must exist once
        pv.wide = wide;
        $('#view-pdf').innerHTML = `
        <div class="pdfv ${pv.focus ? 'zen' : ''} side-${pr.side} pos-${pr.pos} ${pv.notes ? 'with-notes' : ''} drawer-${pv.drawer} ${wide ? 'wide' : 'narrow'}" style="--split:${Math.round(pr.split * 100)}%">
            <header class="pdfv-top">
                <button class="icon-btn" data-action="pdf-back" aria-label="Retour" title="Retour">${ic('arrowLeft')}</button>
                <div class="pdfv-title"><b id="pdf-name" data-action="pdf-rename" title="Toucher pour renommer">${esc(p.name)}</b><small><span id="pdf-pg">…</span> <span id="pdf-sync"></span></small></div>
                <button class="icon-btn" data-action="pdf-search" aria-label="Chercher dans le PDF" title="Chercher dans le PDF (Ctrl+F)">${ic('search')}</button>
                <button class="icon-btn" data-action="pdf-toc" aria-label="Table des matières" title="Table des matières et pages">${ic('toc')}</button>
                <button class="icon-btn hide-n ${pv.mode === 'text' ? 'on' : ''}" data-action="pdf-mode" aria-label="Lecteur de texte" title="Basculer entre le PDF fidèle et le texte réaffiché">${ic(pv.mode === 'text' ? 'file' : 'typeT')}</button>
                <button class="icon-btn hide-n" data-action="pdf-read" aria-label="Lire à voix haute" title="Lire à voix haute">${ic('volume')}</button>
                <button class="btn btn-primary btn-sm pdfv-prac" data-action="pdf-train" title="S'entraîner avec les cartes de ce PDF">${ic('play')}<span>Pratique</span></button>
                <button class="icon-btn ${pv.notes ? 'on' : ''}" data-action="pdf-notes" aria-label="Notes" title="Afficher / masquer la note du PDF">${ic('note')}</button>
                <button class="icon-btn hide-n" data-action="pdf-focus" aria-label="Mode concentration" title="Mode concentration (plein écran)">${ic('fullscreen')}</button>
                <button class="icon-btn" data-action="pdf-more" aria-label="Plus d'actions" title="Plus d'actions">${ic('more')}</button>
            </header>
            <div class="pdfv-tools" id="pdf-tools">${this.pdfToolsHtml()}</div>
            <div class="pdfv-body">
                <div class="pdfv-main" id="pdf-scroll" tabindex="-1"><div class="pdf-msg" id="pdf-msg">Ouverture du PDF…</div><div class="pdf-pages" id="pdf-pages"></div><div class="pdfr hidden" id="pdf-text"></div></div>
                <div class="pdfv-split" id="pdf-split" role="separator" aria-orientation="vertical" title="Tirer pour agrandir ou réduire la note"></div>
                <aside class="pdfv-notes" id="pdf-notes" aria-label="Note du PDF"></aside>
            </div>
            <button class="pdfv-fab" data-action="pdf-annotate" id="pdf-fab" aria-label="Surligner et annoter">${ic('highlighter')}<span>Annoter</span></button>
            <button class="pdfv-unzen" data-action="pdf-focus" aria-label="Quitter le mode concentration">${ic('x')}</button>
        </div>`;
        this.pdfBindView();
        this.pdfRenderNotes();
        this.pdfLoad();
    },
    async pdfLoad() {
        const pv = this.pv, p = pv.p, msg = $('#pdf-msg');
        try { pv.doc = await this.pdfDoc(p); }
        catch (e) {
            if (!msg || this.pv !== pv) return;
            if (e.missing) {
                const canFetch = p.up && PdfSync.ok();
                msg.innerHTML = `<div class="pdf-miss">${ic('pdf')}<h3>Le fichier n'est pas sur cet appareil</h3><p class="muted">${canFetch ? 'Il a été envoyé depuis un autre appareil : je peux le télécharger depuis ton cloud chiffré.' : p.up ? 'Il a été envoyé depuis un autre appareil, mais la synchronisation n\'est pas activée ici (Profil → Données).' : 'Importe de nouveau le même PDF : l\'appli le reconnaît (annotations et cartes sont déjà là).'}</p><div class="row-gap" style="justify-content:center">${canFetch ? `<button class="btn btn-primary" data-action="pdf-fetch">${ic('cloud')}Télécharger</button>` : ''}<button class="btn btn-soft" data-action="pdf-reimport">${ic('import')}Choisir le fichier…</button></div><p class="small faint" id="pdf-fetchst"></p></div>`;
                if (canFetch) setTimeout(() => { if (this.pv === pv && $('#pdf-fetchst')) this.pdfAction('pdf-fetch', msg); }, 50);
            } else msg.innerHTML = `<div class="pdf-miss">${ic('alert')}<h3>Impossible d'ouvrir ce PDF</h3><p class="muted">${esc(e.message || '')}</p></div>`;
            return;
        }
        if (this.pv !== pv) return;
        if (msg) msg.remove();
        if (pv.doc.numPages !== p.pages) { p.pages = pv.doc.numPages; }
        await this.pdfLayout();
        if (pv.mode === 'text') this.pdfShowMode(); else this.pdfStartObserve();
        const g = pv.goto; pv.goto = { pid: '', page: 0, flash: '' };
        if (g.pid || g.page) this.pdfGoto(g.pid || g.page, g.flash, true);
        else { const sc = $('#pdf-scroll'), el = pv.pages[p.last] && pv.pages[p.last].el; if (el && sc) sc.scrollTop = el.offsetTop - 8; }
        this.pdfUpdatePg();
        if (PdfSync.ok() && !p.up) this.pdfSyncSoon(p);
    },
    /* page boxes at the right size (the pages themselves are drawn when they come into view) */
    async pdfLayout() {
        const pv = this.pv, box = $('#pdf-pages'); if (!box) return;
        const sizes = new Map(), nums = [...new Set(pv.p.pg.filter(g => g.k === 'p').map(g => g.n))];
        const first = await pv.doc.getPage(nums[0] || 1); let v = first.getViewport({ scale: 1 }); pv.base = { w: v.width, h: v.height }; sizes.set(nums[0] || 1, pv.base);
        for (let i = 0; i < Math.min(nums.length, 400); i += 25) await Promise.all(nums.slice(i, i + 25).map(async n => { if (sizes.has(n)) return; try { const pg = await pv.doc.getPage(n), vv = pg.getViewport({ scale: 1 }); sizes.set(n, { w: vv.width, h: vv.height }); } catch { sizes.set(n, pv.base); } }));
        pv.pages = pv.p.pg.map((g, i) => ({ g, i, w: (g.k === 'p' && sizes.get(g.n) || pv.base).w, h: (g.k === 'p' && sizes.get(g.n) || pv.base).h, el: null, state: 0 }));
        box.innerHTML = pv.pages.map(pg => `<div class="pdfp ${pg.g.k === 'b' ? 'blank' : ''}" data-i="${pg.i}" data-pid="${esc(pg.g.id)}"><canvas></canvas><svg class="pdfa" xmlns="http://www.w3.org/2000/svg"></svg><div class="pdft"></div><div class="pdfx"></div><div class="pdfo"></div><span class="pdfn">${pg.i + 1}</span></div>`).join('');
        $$('.pdfp', box).forEach((el, i) => { pv.pages[i].el = el; });
        this.pdfSizePages();
    },
    pdfCssWidth() { const sc = $('#pdf-scroll'); return Math.max(220, ((sc ? sc.clientWidth : 360) - (this.pdfWide() ? 36 : 12)) * this.pv.zoom); },
    pdfSizePages() {
        const pv = this.pv, w = this.pdfCssWidth();
        pv.pages.forEach(pg => { pg.cw = w; pg.ch = w * pg.h / pg.w; pg.el.style.width = `${w}px`; pg.el.style.height = `${pg.ch}px`; });
        const z = $('#pdf-zoomv'); if (z) z.textContent = `${Math.round(pv.zoom * 100)} %`;
    },
    pdfStartObserve() {
        const pv = this.pv, sc = $('#pdf-scroll'); if (pv.obs) pv.obs.disconnect();
        pv.obs = new IntersectionObserver(es => es.forEach(e => { const pg = pv.pages[Number(e.target.dataset.i)]; if (!pg) return; if (e.isIntersecting) this.pdfRenderPage(pg); else this.pdfUnrender(pg); }), { root: sc, rootMargin: '140% 0px 140% 0px' });
        pv.pages.forEach(pg => pv.obs.observe(pg.el));
        sc.onscroll = () => { if (this._pdfRaf) return; this._pdfRaf = requestAnimationFrame(() => { this._pdfRaf = 0; this.pdfUpdatePg(); }); };
    },
    async pdfRenderPage(pg) {
        const pv = this.pv; if (!pv || pg.state || !pg.el) return; pg.state = 1; const el = pg.el, token = pv.token = (pv.token || 0) + 1; pg.tok = token;
        try {
            if (pg.g.k === 'p') {
                const page = await pv.doc.getPage(pg.g.n); if (this.pv !== pv || pg.tok !== token) { pg.state = 0; return; }
                const cssW = pg.cw, vp1 = page.getViewport({ scale: 1 }), scaleCss = cssW / vp1.width, dpr = Math.min(window.devicePixelRatio || 1, 3);
                const out = Math.max(scaleCss, Math.min(scaleCss * dpr, Math.sqrt(7e6 / (vp1.width * vp1.height))));   // never more than ~7 million pixels per page (iPhone memory)
                const cv = $('canvas', el), vp = page.getViewport({ scale: out }); cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
                pg.task = page.render({ canvasContext: cv.getContext('2d', { alpha: false }), viewport: vp }); await pg.task.promise;
                if (this.pv !== pv || pg.tok !== token) return;
                const tl = $('.pdft', el); tl.innerHTML = ''; tl.style.setProperty('--scale-factor', scaleCss);
                pg.divs = []; try { const t = pdfjsLib.renderTextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: page.getViewport({ scale: scaleCss }), textDivs: pg.divs }); await t.promise; } catch { /* the page stays readable without text selection */ }
                this.pdfMarkHits(pg);
            }
            pg.state = 2; this.pdfDrawAnn(pg);
        } catch (e) { if (e && e.name === 'RenderingCancelledException') { pg.state = 0; return; } pg.state = 0; console.warn('PDF page', e); }
    },
    pdfUnrender(pg) {
        if (!pg.state || !pg.el) return;
        try { if (pg.task) pg.task.cancel(); } catch { /* ignore */ }
        const cv = $('canvas', pg.el); if (cv) { cv.width = 0; cv.height = 0; } const tl = $('.pdft', pg.el); if (tl) tl.innerHTML = '';
        pg.state = 0; pg.tok = 0; pg.divs = null;
    },
    pdfCurrent() {
        const pv = this.pv, sc = $('#pdf-scroll'); if (!pv || !sc || !pv.pages.length) return 0;
        const y = sc.scrollTop + sc.clientHeight * 0.3; let best = 0;
        for (let i = 0; i < pv.pages.length; i++) { const el = pv.pages[i].el; if (!el) break; if (el.offsetTop <= y) best = i; else break; }
        return best;
    },
    pdfUpdatePg() {
        const pv = this.pv; if (!pv) return; const i = pv.mode === 'text' ? (pv.textAt || 0) : this.pdfCurrent(), lab = $('#pdf-pg');
        if (lab) lab.textContent = `page ${i + 1} sur ${pv.p.pg.length}`;
        if (i !== pv.p.last) { pv.p.last = i; clearTimeout(pv.saveT); pv.saveT = setTimeout(() => this.save(false), 900); }
    },
    pdfGoto(target, flash = '', instant = false) {
        const pv = this.pv; if (!pv) return;
        let i = typeof target === 'number' ? target - 1 : pv.p.pg.findIndex(g => g.id === target); if (typeof target === 'number') { const k = pv.p.pg.findIndex(g => g.k === 'p' && g.n === target); i = k >= 0 ? k : target - 1; }
        i = clamp(i, 0, pv.p.pg.length - 1);
        if (pv.mode === 'text') { const el = $(`#pdf-text [data-i="${i}"]`); if (el) el.scrollIntoView({ block: 'start' }); return; }
        const sc = $('#pdf-scroll'), pg = pv.pages[i]; if (!pg || !pg.el) return;
        sc.scrollTo({ top: pg.el.offsetTop - 8, behavior: instant ? 'auto' : 'smooth' });
        if (flash) { pv.flash = { i, q: flash }; setTimeout(() => { if (pv.pages[i].state === 2) this.pdfMarkHits(pv.pages[i], flash); }, instant ? 500 : 800); }
        this.pdfUpdatePg();
    },
    pdfSetZoom(z) {
        const pv = this.pv; if (!pv || !pv.pages.length) return;
        z = clamp(Math.round(z * 100) / 100, 0.5, 4); if (z === pv.zoom) return;
        const sc = $('#pdf-scroll'), i = this.pdfCurrent(), cur = pv.pages[i], rel = cur ? (sc.scrollTop - cur.el.offsetTop) / Math.max(1, cur.ch) : 0;
        pv.zoom = z; pv.p.zoom = z; this.pdfSizePages();
        pv.pages.forEach(pg => { if (pg.state) { this.pdfUnrender(pg); } });
        sc.scrollTop = cur.el.offsetTop + rel * cur.ch;
        // the pages already in view are drawn again at once
        pv.pages.forEach(pg => { const r = pg.el.getBoundingClientRect(), s = sc.getBoundingClientRect(); if (r.bottom > s.top - s.height && r.top < s.bottom + s.height) this.pdfRenderPage(pg); });
        clearTimeout(pv.saveT); pv.saveT = setTimeout(() => this.save(false), 900);
    },

    /* ---------- the note of the PDF ---------- */
    pdfRenderNotes() {
        const pv = this.pv, box = $('#pdf-notes'); if (!box) return;
        const n = this.pdfNoteOf(pv.p); this.ui.note = n.id;
        this.nb = Object.assign(this.nb || { back: [] }, { hist: [], redo: [], active: -1, burst: 0, find: null, hits: [] });
        if (n.b.some(b => b.cd) && this.nbCardSyncAll(n)) this.save(false);
        box.innerHTML = `<div class="pdfn-head"><span class="nb-row-ico">${n.emoji ? esc(n.emoji) : '📝'}</span><b>${esc(this.noteName(n))}</b><button class="icon-btn icon-btn-sm" data-action="pdf-note-open" title="Ouvrir cette note dans l'onglet Notes" aria-label="Ouvrir dans Notes">${ic('notebook')}</button><button class="icon-btn icon-btn-sm pdfn-close" data-action="pdf-notes" aria-label="Fermer la note">${ic('chevronDown')}</button></div>
            <div class="nb-editor pdfn-ed" data-id="${esc(n.id)}"><div class="nb-blocks" id="nb-blocks">${this.nbBlocksHtml(n)}</div></div>`;
        this.nbBind($('#view-pdf')); this.nbBarEnsure(true); this.resolveMedia(box);
    },
    pdfFlushNotes() { if (this.pv && this.nb) { clearTimeout(this.nb.saveT); const n = this.note(this.ui.note); if (n && this.nb.dirty) { this.nbCardSyncAll(n); this.save(false); this.nb.dirty = false; } } },
    /* a quotation with a link back to its page, added to the note of the PDF */
    pdfCite(text, pid) {
        const pv = this.pv, n = this.pdfNoteOf(pv.p), i = this.pdfPageIndex(pv.p, pid) + 1, t = String(text).replace(/\s+/g, ' ').trim().slice(0, 600);
        if (!t) return;
        if (!pv.notes) this.pdfToggleNotes(true);
        this.nbPush(); const at = this.nb.active >= 0 && n.b[this.nb.active] ? this.nb.active + 1 : n.b.length;
        const blk = { t: 'quote', x: `« ${t} » [[pdf:${pv.p.id}:${pid}|page ${i}]]`, d: 0 };
        if (n.b.length === 2 && !n.b[1].x && at === n.b.length) n.b.splice(1, 1, blk, nbEmpty()); else n.b.splice(at, 0, blk);
        this.nbChanged(); this.nbRender(); this.toast(`Citation ajoutée à la note (page ${i})`, 'success', ic('note'));
    },
    pdfToggleNotes(on) {
        const pv = this.pv; pv.notes = on === undefined ? !pv.notes : on; this.pdfPrefs().notes = pv.notes; this.pdfPrefSave();
        const v = $('.pdfv'); if (v) { v.classList.toggle('with-notes', pv.notes); v.classList.remove('drawer-closed', 'drawer-half', 'drawer-full'); v.classList.add('drawer-' + (pv.notes ? (pv.drawer === 'closed' ? 'half' : pv.drawer) : 'closed')); }
        if (pv.notes && pv.drawer === 'closed') pv.drawer = 'half';
        const b = $('[data-action=pdf-notes]'); if (b) b.classList.toggle('on', pv.notes);
        setTimeout(() => { if (this.pv === pv && pv.mode !== 'text') { this.pdfSizePages(); pv.pages.forEach(pg => { if (pg.state) { this.pdfUnrender(pg); this.pdfRenderPage(pg); } }); } }, 80);
    },
    pdfDrawer(state) { const pv = this.pv; pv.drawer = state; this.pdfPrefs().drawer = state; this.pdfPrefSave(); const v = $('.pdfv'); if (v) { v.classList.remove('drawer-closed', 'drawer-half', 'drawer-full'); v.classList.add('drawer-' + state); } },

    /* ---------- search, contents ---------- */
    async pdfPageText(n) {
        const pv = this.pv; if (pv.texts[n] !== undefined) return pv.texts[n];
        try { const pg = await pv.doc.getPage(n), tc = await pg.getTextContent(); pv.texts[n] = tc.items.map(i => i.str + (i.hasEOL ? '\n' : '')).join(' ').replace(/[ \t]+/g, ' ').trim(); pv.items = pv.items || {}; pv.items[n] = tc.items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], h: Math.abs(i.transform[3]) || i.height || 10, w: i.width })); pv.pw = pv.pw || {}; pv.pw[n] = pg.view; }
        catch { pv.texts[n] = ''; }
        return pv.texts[n];
    },
    pdfSearchPanel() {
        const pv = this.pv; this.closePopover();
        let m = $('#pdf-searchbox'); if (m) { m.remove(); return; }
        const box = document.createElement('div'); box.id = 'pdf-searchbox'; box.className = 'pdf-sheet';
        box.innerHTML = `<div class="pdf-sheet-h"><input class="input" id="pdf-q" placeholder="Chercher dans le PDF…" autocomplete="off" enterkeyhint="search"><button class="icon-btn" data-action="pdf-search" aria-label="Fermer">${ic('x')}</button></div><div class="small faint" id="pdf-qst"></div><div class="pdf-results" id="pdf-res"></div>`;
        $('.pdfv').appendChild(box);
        const q = $('#pdf-q', box); q.focus();
        let tm = null; q.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => this.pdfSearchRun(q.value), 220); });
        q.addEventListener('keydown', e => { if (e.key === 'Enter') this.pdfSearchRun(q.value); if (e.key === 'Escape') box.remove(); });
        box.addEventListener('click', e => { const r = e.target.closest('[data-hit]'); if (!r) return; const [pid, k] = r.dataset.hit.split('|'); pv.hitQ = q.value.trim(); this.pdfGoto(pid, pv.hitQ); if (!this.pdfWide()) box.remove(); });
    },
    async pdfSearchRun(q) {
        const pv = this.pv, box = $('#pdf-res'), st = $('#pdf-qst'); q = String(q).trim(); pv.hitQ = q; if (!box) return;
        if (q.length < 2) { box.innerHTML = ''; st.textContent = 'Écris au moins 2 lettres.'; pv.pages.forEach(pg => this.pdfMarkHits(pg)); return; }
        const f = fold(q), out = [], run = pv.sr = (pv.sr || 0) + 1; let total = 0;
        const pgs = pv.p.pg.filter(g => g.k === 'p');
        for (let i = 0; i < pgs.length; i++) {
            if (pv.sr !== run) return;
            st.textContent = i < pgs.length - 1 && pv.texts[pgs[i].n] === undefined ? `Lecture du texte… ${i + 1}/${pgs.length}` : st.textContent;
            const t = await this.pdfPageText(pgs[i].n), ft = fold(t);
            let at = 0, c = 0; const snips = [];
            while ((at = ft.indexOf(f, at)) >= 0) { c++; if (snips.length < 3) snips.push(t.slice(Math.max(0, at - 30), at + q.length + 50).replace(/\n/g, ' ')); at += f.length; }
            if (c) { total += c; out.push({ g: pgs[i], c, snips }); }
        }
        if (pv.sr !== run) return;
        st.textContent = total ? `${plural(total, 'résultat')} sur ${plural(out.length, 'page')}` : 'Aucun résultat.' + (pgs.every(g => !pv.texts[g.n]) ? ' (Ce PDF est peut-être une image scannée : pas de texte à chercher.)' : '');
        const lab = n => this.pdfPageIndex(pv.p, pgs.find(g => g.n === n).id) + 1;
        box.innerHTML = out.slice(0, 200).map(r => `<button class="pdf-hit" data-hit="${esc(r.g.id)}|0"><b>Page ${lab(r.g.n)}</b><span class="small faint">${plural(r.c, 'résultat')}</span><span class="pdf-snip">${r.snips.map(s => '…' + esc(s) + '…').join('<br>')}</span></button>`).join('');
        pv.pages.forEach(pg => this.pdfMarkHits(pg));
    },
    pdfMarkHits(pg, forced) {
        const pv = this.pv; if (!pv || !pg.divs || !pg.el) return; const q = forced || pv.hitQ; $$('.pdft span.hit', pg.el).forEach(s => s.classList.remove('hit'));
        if (!q || q.length < 2) return; const f = fold(q);
        pg.divs.forEach(d => { if (fold(d.textContent).includes(f)) d.classList.add('hit'); });
        if (forced) setTimeout(() => { if (this.pv === pv && pv.hitQ !== forced) $$('.pdft span.hit', pg.el).forEach(s => s.classList.remove('hit')); }, 2600);
    },
    pdfTocMenu(anchor) {
        const pv = this.pv, p = pv.p, items = [];
        if (p.toc.length) { items.push({ head: 'Table des matières' }); p.toc.slice(0, 60).forEach(t => items.push({ icon: 'chevronRight', label: `${'· '.repeat(t.d)}${esc(truncate(t.t, 46))} <span class="faint">p. ${t.n}</span>`, fn: () => this.pdfGoto(t.n) })); items.push({ sep: true }); }
        items.push({ icon: 'layers', label: 'Aller à une page…', fn: () => { const v = prompt(`Numéro de page (1 à ${p.pg.length})`, String(this.pdfCurrent() + 1)); const n = Math.round(Number(v)); if (n >= 1 && n <= p.pg.length) this.pdfGoto(p.pg[n - 1].id); } });
        items.push({ icon: 'arrowDown', label: 'Début du PDF', fn: () => this.pdfGoto(p.pg[0].id) }, { icon: 'arrowDown', label: 'Fin du PDF', fn: () => this.pdfGoto(p.pg[p.pg.length - 1].id) });
        this.showMenu(anchor, items);
    },

    /* ---------- text reader ---------- */
    async pdfShowMode() {
        const pv = this.pv, pages = $('#pdf-pages'), tx = $('#pdf-text'); if (!pages || !tx) return;
        const b = $('[data-action=pdf-mode]'); if (b) { b.classList.toggle('on', pv.mode === 'text'); b.innerHTML = ic(pv.mode === 'text' ? 'file' : 'typeT'); }
        const tools = $('#pdf-tools'); if (tools) tools.classList.toggle('hidden', pv.mode === 'text');
        if (pv.mode !== 'text') { tx.classList.add('hidden'); pages.classList.remove('hidden'); if (pv.obs) pv.obs.disconnect(); this.pdfSizePages(); this.pdfStartObserve(); const el = pv.pages[pv.p.last] && pv.pages[pv.p.last].el; if (el) $('#pdf-scroll').scrollTop = el.offsetTop - 8; return; }
        const at = this.pdfCurrent(); if (pv.obs) pv.obs.disconnect(); pv.pages.forEach(pg => this.pdfUnrender(pg));
        pages.classList.add('hidden'); tx.classList.remove('hidden'); tx.style.fontSize = `${1.02 * this.pdfPrefs().fs}rem`;
        tx.innerHTML = '<p class="small faint" id="pdf-txst">Mise en forme du texte…</p>';
        const pgs = pv.p.pg, parts = []; let bad = 0, lines = 0, total = 0;
        for (let i = 0; i < pgs.length; i++) {
            if (this.pv !== pv || pv.mode !== 'text') return;
            const g = pgs[i];
            if (g.k === 'b') { parts.push(`<section class="pdfr-pg" data-i="${i}" data-pid="${esc(g.id)}"><h5>Page ${i + 1} · page blanche</h5></section>`); continue; }
            await this.pdfPageText(g.n); const r = this.pdfParagraphs(g.n); bad += r.cols; lines += r.lines; total += r.chars;
            parts.push(`<section class="pdfr-pg" data-i="${i}" data-pid="${esc(g.id)}"><h5>Page ${i + 1}</h5>${r.paras.length ? r.paras.map(t => `<p>${esc(t)}</p>`).join('') : '<p class="faint">(pas de texte sur cette page : image ou scan)</p>'}</section>`);
            if (i % 12 === 11) { tx.innerHTML = parts.join(''); await new Promise(r2 => setTimeout(r2, 0)); }
        }
        const msgBad = lines > 8 && (bad / lines > 0.22 || total / Math.max(1, lines) < 26);
        tx.innerHTML = (msgBad ? `<div class="pdfr-warn">${ic('alert')}<span>Ce PDF a des colonnes ou des diapositives : <b>l'ordre du texte peut être mauvais</b>. Repasse en « PDF fidèle » (bouton en haut) pour le voir tel quel.</span></div>` : '') + parts.join('');
        tx.onscroll = () => { const secs = $$('.pdfr-pg', tx), y = $('#pdf-scroll').scrollTop + 60; let k = 0; secs.forEach((s, j) => { if (s.offsetTop <= y) k = j; }); pv.textAt = k; this.pdfUpdatePg(); };
        $('#pdf-scroll').onscroll = tx.onscroll;
        const el = $(`#pdf-text [data-i="${at}"]`); if (el) $('#pdf-scroll').scrollTop = el.offsetTop - 6;
    },
    /* lines → paragraphs; counts the lines that look like columns */
    pdfParagraphs(n) {
        const pv = this.pv, items = (pv.items && pv.items[n]) || [], view = (pv.pw && pv.pw[n]) || [0, 0, 600, 800], W = view[2] - view[0];
        const rows = []; items.slice().sort((a, b) => b.y - a.y || a.x - b.x).forEach(it => { const r = rows.find(z => Math.abs(z.y - it.y) <= Math.max(2, it.h * 0.45)); if (r) r.its.push(it); else rows.push({ y: it.y, h: it.h, its: [it] }); });
        rows.sort((a, b) => b.y - a.y); let cols = 0; const lines = [];
        rows.forEach(r => { r.its.sort((a, b) => a.x - b.x); let s = '', last = null; r.its.forEach(it => { if (last && it.x - (last.x + last.w) > W * 0.2) cols++; s += (last && it.x - (last.x + last.w) > it.h * 0.15 ? ' ' : '') + it.s; last = it; }); lines.push({ s: s.replace(/\s+/g, ' ').trim(), y: r.y, h: r.h }); });
        const paras = []; let cur = '', prev = null;
        lines.forEach(l => { if (!l.s) return; const gap = prev ? prev.y - l.y : 0; if (cur && prev && gap > Math.max(prev.h, l.h) * 1.7) { paras.push(cur); cur = ''; } cur = cur ? (/[-­]$/.test(cur) && /^[a-zàâçéèêëîïôûùüÿ]/.test(l.s) ? cur.slice(0, -1) + l.s : cur + ' ' + l.s) : l.s; prev = l; });
        if (cur) paras.push(cur);
        return { paras, cols, lines: lines.length, chars: lines.reduce((s, l) => s + l.s.length, 0) };
    },

    /* ---------- reading aloud ---------- */
    pdfSpeakStop() { try { speechSynthesis.cancel(); } catch { /* ignore */ } if (this.pv) this.pv.read = null; const b = $('[data-action=pdf-read]'); if (b) b.classList.remove('on'); },
    pdfSpeak(text) {
        if (!('speechSynthesis' in window)) { this.toast('La lecture à voix haute n\'est pas disponible ici.', 'warning'); return; }
        this.pdfSpeakStop(); const pr = this.pdfPrefs(), chunks = String(text).replace(/\s+/g, ' ').match(/[^.!?;:\n]{1,180}[.!?;:]?\s*/g) || [String(text)];
        const voices = speechSynthesis.getVoices(), lang = guessLang(text), voice = voices.find(v => v.name === pr.voice) || voices.find(v => v.lang && v.lang.startsWith(lang.slice(0, 2)) && v.localService) || voices.find(v => v.lang && v.lang.startsWith(lang.slice(0, 2)));
        if (this.pv) this.pv.read = { n: chunks.length }; const b = $('[data-action=pdf-read]'); if (b) b.classList.add('on');
        chunks.forEach((c, k) => { if (!c.trim()) return; const u = new SpeechSynthesisUtterance(c); u.lang = voice ? voice.lang : lang; if (voice) u.voice = voice; u.rate = pr.rate; if (k === chunks.length - 1) u.onend = () => { if (this.pv) this.pdfSpeakStop(); }; speechSynthesis.speak(u); });
    },
    async pdfReadMenu(anchor) {
        const pv = this.pv, pr = this.pdfPrefs(); if (pv.read) { this.pdfSpeakStop(); return; }
        const sel = this.pdfSelection();
        this.showMenu(anchor, [
            ...(sel ? [{ icon: 'volume', label: 'Lire la sélection', fn: () => this.pdfSpeak(sel.text) }] : []),
            { icon: 'volume', label: 'Lire cette page', fn: async () => { const g = pv.p.pg[pv.mode === 'text' ? (pv.textAt || 0) : this.pdfCurrent()]; if (g.k === 'p') this.pdfSpeak(await this.pdfPageText(g.n) || 'Cette page n\'a pas de texte.'); } },
            { icon: 'volume', label: 'Lire à partir de cette page', fn: async () => { const i = pv.mode === 'text' ? (pv.textAt || 0) : this.pdfCurrent(); let t = ''; for (const g of pv.p.pg.slice(i, i + 4)) if (g.k === 'p') t += (await this.pdfPageText(g.n)) + ' '; this.pdfSpeak(t); } },
            { sep: true },
            ...[0.8, 1, 1.25, 1.5].map(r => ({ icon: pr.rate === r ? 'check' : 'timer', label: `Vitesse ${r === 1 ? 'normale' : '× ' + String(r).replace('.', ',')}`, fn: () => { pr.rate = r; this.pdfPrefSave(); this.toast(`Vitesse de lecture : × ${String(r).replace('.', ',')}`, 'success', ic('volume')); } })),
            ...(speechSynthesis.getVoices().length > 1 ? [{ sep: true }, { icon: 'mic', label: `Voix : ${pr.voice || 'automatique'} (changer)`, fn: () => this.pdfVoiceMenu(anchor) }] : [])
        ]);
    },
    pdfVoiceMenu(anchor) {
        const pr = this.pdfPrefs(), vs = speechSynthesis.getVoices().filter(v => /^(fr|en)/i.test(v.lang)).slice(0, 14);
        this.showMenu(anchor, [{ icon: pr.voice ? 'mic' : 'check', label: 'Automatique (selon la langue)', fn: () => { pr.voice = ''; this.pdfPrefSave(); } }, ...vs.map(v => ({ icon: pr.voice === v.name ? 'check' : 'mic', label: `${esc(v.name)} <span class="faint">${v.lang}</span>`, fn: () => { pr.voice = v.name; this.pdfPrefSave(); } }))]);
    },
    pdfFocus() {
        const pv = this.pv; pv.focus = !pv.focus; document.body.classList.toggle('pdf-zen', pv.focus); const v = $('.pdfv'); if (v) v.classList.toggle('zen', pv.focus);
        if (pv.focus && document.documentElement.requestFullscreen && !/iPhone|iPad/.test(navigator.userAgent)) { try { document.documentElement.requestFullscreen().catch(() => {}); } catch { /* ignore */ } }
        else if (!pv.focus && document.fullscreenElement) { try { document.exitFullscreen(); } catch { /* ignore */ } }
        setTimeout(() => { if (this.pv === pv && pv.mode !== 'text') { this.pdfSizePages(); pv.pages.forEach(pg => { if (pg.state) { this.pdfUnrender(pg); this.pdfRenderPage(pg); } }); } }, 120);
    },

    /* ---------- events ---------- */
    pdfBindView() {
        const root = $('#view-pdf'), pv = this.pv;
        if (!root._pdfb) {
            root._pdfb = true;
            /* the split between the PDF and its note (computer) / the drawer (phone) */
            root.addEventListener('pointerdown', e => {
                const sp = e.target.closest('#pdf-split'), hd = e.target.closest('.pdfn-head');
                if (sp && this.pv && this.pdfWide()) {
                    e.preventDefault(); const body = $('.pdfv-body'), r = body.getBoundingClientRect(), pr = this.pdfPrefs();
                    const mv = ev => { const f = pr.side === 'right' ? (r.right - ev.clientX) / r.width : (ev.clientX - r.left) / r.width; pr.split = clamp(f, 0.2, 0.7); $('.pdfv').style.setProperty('--split', Math.round(pr.split * 100) + '%'); };
                    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); this.pdfPrefSave(); if (this.pv) { this.pdfSizePages(); this.pv.pages.forEach(pg => { if (pg.state) { this.pdfUnrender(pg); this.pdfRenderPage(pg); } }); } };
                    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
                } else if (hd && this.pv && !this.pdfWide() && !e.target.closest('button')) {   // the drawer: drag up / down, or tap, to change its height
                    const y0 = e.clientY, st = this.pv.drawer; let moved = false;
                    const mv = ev => { if (Math.abs(ev.clientY - y0) > 12) moved = true; };
                    const up = ev => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); const dy = ev.clientY - y0, order = ['closed', 'half', 'full'], k = order.indexOf(st); if (moved) this.pdfDrawer(order[clamp(k + (dy < -30 ? 1 : dy > 30 ? -1 : 0), 0, 2)]); else this.pdfDrawer(st === 'half' ? 'full' : 'half'); if (this.pv && this.pv.drawer === 'closed') this.pdfToggleNotes(false); };
                    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
                }
            });
            /* pinch to zoom (two fingers) and Ctrl + wheel */
            const sc = () => $('#pdf-scroll'); let d0 = 0, z0 = 1, pinching = false, zt = 1;
            const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
            root.addEventListener('touchstart', e => { if (e.touches.length === 2 && this.pv && this.pv.mode !== 'text' && e.target.closest('#pdf-scroll')) { pinching = true; d0 = dist(e.touches); z0 = this.pv.zoom; zt = z0; } }, { passive: true });
            root.addEventListener('touchmove', e => { if (!pinching || e.touches.length !== 2) return; e.preventDefault(); zt = clamp(z0 * dist(e.touches) / d0, 0.5, 4); const box = $('#pdf-pages'); if (box) { box.style.transformOrigin = '50% 30%'; box.style.transform = `scale(${zt / z0})`; } }, { passive: false });
            root.addEventListener('touchend', e => { if (!pinching || e.touches.length > 0) return; pinching = false; const box = $('#pdf-pages'); if (box) { box.style.transform = ''; } if (this.pv) this.pdfSetZoom(zt); });
            root.addEventListener('wheel', e => { if (!e.ctrlKey || !this.pv || this.pv.mode === 'text' || !e.target.closest('#pdf-scroll')) return; e.preventDefault(); clearTimeout(this._zw); this._zacc = (this._zacc || this.pv.zoom) * (e.deltaY < 0 ? 1.08 : 0.92); this._zw = setTimeout(() => { this.pdfSetZoom(this._zacc); this._zacc = 0; }, 90); }, { passive: false });
            window.addEventListener('resize', () => { if (this.view === 'pdf' && this.pv && this.pv.pages.length && this.pv.mode !== 'text') { clearTimeout(this._rz); this._rz = setTimeout(() => { if (this.pv && this.pdfWide() !== this.pv.wide) { this.renderPdf(); return; } this.pdfSizePages(); this.pv.pages.forEach(pg => { if (pg.state) { this.pdfUnrender(pg); this.pdfRenderPage(pg); } }); }, 250); } });
            document.addEventListener('keydown', e => {
                if (this.view !== 'pdf' || !this.pv || this.modals.length) return;
                const typing = e.target.closest && e.target.closest('input, textarea, [contenteditable], .nb-t'); const mod = e.ctrlKey || e.metaKey;
                if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); this.pdfSearchPanel(); return; }
                if (typing) return;
                if (e.key === 'Escape') { if (this.pv.focus) this.pdfFocus(); else if ($('#pdf-searchbox')) $('#pdf-searchbox').remove(); else if ($('#pdf-pop')) { this.pdfPopClose(); getSelection().removeAllRanges(); } else if (this.pv.annotate && this.pv.tool !== 'select' && this.pv.tool !== 'hand') { this.pv.tool = 'select'; this.pdfRefreshTools(); } return; }
                if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); this.pdfUndo(e.shiftKey); return; }
                if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.pdfUndo(true); return; }
                if (e.key === '+' || e.key === '=') this.pdfSetZoom(this.pv.zoom + 0.1); else if (e.key === '-') this.pdfSetZoom(this.pv.zoom - 0.1);
                else if (e.key === 'PageDown' || e.key === 'ArrowRight') { if (e.key === 'ArrowRight' || true) this.pdfGoto(clamp((this.pv.mode === 'text' ? this.pv.textAt || 0 : this.pdfCurrent()) + 1, 0, this.pv.p.pg.length - 1) + 1 === 0 ? 1 : this.pv.p.pg[clamp((this.pv.mode === 'text' ? this.pv.textAt || 0 : this.pdfCurrent()) + 1, 0, this.pv.p.pg.length - 1)].id); }
                else if (e.key === 'PageUp' || e.key === 'ArrowLeft') this.pdfGoto(this.pv.p.pg[clamp((this.pv.mode === 'text' ? this.pv.textAt || 0 : this.pdfCurrent()) - 1, 0, this.pv.p.pg.length - 1)].id);
            });
        }
        this.pdfBindAnn(root);
    },
    pdfAction(action, el, e) {
        const ds = el.dataset || {}, pv = this.pv;
        const A = {
            'pdf-open': () => this.pdfOpen(ds.id),
            'pdf-back': () => this.pdfBack(),
            'pdf-search': () => this.pdfSearchPanel(),
            'pdf-toc': () => this.pdfTocMenu(el),
            'pdf-mode': () => { pv.mode = pv.mode === 'text' ? 'pdf' : 'text'; pv.p.mode = pv.mode; this.pdfShowMode(); },
            'pdf-read': () => this.pdfReadMenu(el),
            'pdf-notes': () => this.pdfToggleNotes(),
            'pdf-focus': () => this.pdfFocus(),
            'pdf-more': () => this.pdfMoreMenu(el),
            'pdf-train': () => this.pdfTrainMenu(el),
            'pdf-annotate': () => { pv.annotate = !pv.annotate; if (pv.annotate && pv.tool === 'hand') pv.tool = 'select'; if (!pv.annotate) pv.tool = 'hand'; this.pdfRefreshTools(); },
            'pdf-note-open': () => { const n = this.pdfNoteOf(pv.p); this.pdfFlushNotes(); this.noteOpen(n.id, { push: false }); },
            'pdf-rename': () => this.pdfRenameDialog(pv.p),
            'pdf-fetch': async () => { const st = $('#pdf-fetchst'); try { st.textContent = 'Téléchargement…'; await this.pdfFetch(pv.p, (k, n) => { st.textContent = `Téléchargement… ${Math.round(k / n * 100)} %`; }); this.renderPdf(); } catch (er) { if (st) st.textContent = er.message || 'Échec du téléchargement.'; } },
            'pdf-reimport': () => { const input = $('#hidden-file'); input.accept = 'application/pdf,.pdf'; input.value = ''; input.onchange = async () => { const f = input.files[0]; if (!f) return; const h = await pdfHashOf(await f.arrayBuffer()); if (h !== pv.p.hash) { this.toast('Ce n\'est pas le même PDF (empreinte différente).', 'warning'); return; } await PdfStore.put(h, await f.arrayBuffer()); this.renderPdf(); }; input.click(); }
        };
        if (A[action]) { if (!pv && !['pdf-open'].includes(action)) return; A[action](); }
        else this.pdfAnnAction(action, el, e);
    },
    pdfRenameDialog(p) {
        const m = this.openModal({ title: 'Renommer le PDF', size: 'narrow', body: `<div class="field"><label class="label" for="pr-n">Nom du PDF (et de son paquet)</label><input class="input" id="pr-n" maxlength="120" value="${esc(p.name)}"></div>`, foot: `<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="pr-go">${ic('check')}Renommer</button>` });
        const go = () => { this.pdfRename(p, $('#pr-n', m).value); this.closeModal(m); const t = $('#pdf-name'); if (t) t.textContent = p.name; };
        $('#pr-go', m).addEventListener('click', go); $('#pr-n', m).addEventListener('keydown', e => { if (e.key === 'Enter') go(); }); setTimeout(() => { const i = $('#pr-n', m); i.focus(); i.select(); }, 40);
    }
});
