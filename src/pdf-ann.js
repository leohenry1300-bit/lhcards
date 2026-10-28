/* ============================================================
   PDF : annotations (surlignage 6 couleurs, zones de texte, notes en marge, stylo, gomme, zone), annuler / rétablir,
   corbeille des dessins effacés, pages blanches, cartes depuis un passage, extraction vers la note, menus « Pratique » et « Plus ».
   Tout est rangé à part du fichier, en coordonnées relatives à la page (0 → 1) : ça suit le zoom et la taille de l'écran.
   ============================================================ */
const PDF_TOOLS = [
    ['select', 'textcursor', 'Texte', 'Sélectionner du texte pour le surligner'], ['hand', 'hand', 'Main', 'Faire défiler la page'],
    ['area', 'area', 'Zone', 'Choisir une zone (un schéma, un tableau…)'], ['pen', 'pen', 'Stylo', 'Dessiner ou écrire à la main'],
    ['eraser', 'eraser', 'Gomme', 'Effacer des dessins'], ['text', 'typeT', 'Texte libre', 'Ajouter une zone de texte'], ['note', 'note', 'Note', 'Ajouter une note dans la marge']
];
const PDF_WIDTHS = [[0.0018, 'Fin'], [0.004, 'Moyen'], [0.009, 'Épais']];
const pdfClone = o => JSON.parse(JSON.stringify(o));

Object.assign(SuperAnki.prototype, {
    /* ---------- the bar of tools ---------- */
    pdfToolsHtml() {
        const pv = this.pv, pr = this.pdfPrefs(); if (!pv) return '';
        pv.color = pv.color || PDF_COLORS[0]; pv.pen = pv.pen || { c: PDF_PEN[0], w: PDF_WIDTHS[1][0] };
        const t = pv.tool, pen = t === 'pen';
        const tb = ([id, ico, label, tip]) => `<button class="pdft-b ${t === id ? 'on' : ''}" data-action="pdf-tool" data-t="${id}" title="${tip}" aria-label="${label}" aria-pressed="${t === id}">${ic(ico)}<span>${label}</span></button>`;
        const cols = (pen ? PDF_PEN : PDF_COLORS).map(c => `<button class="pdft-c ${(pen ? pv.pen.c : pv.color) === c ? 'on' : ''}" data-action="pdf-color" data-c="${c}" style="--c:${c}" aria-label="Couleur ${c}"></button>`).join('');
        const widths = pen ? PDF_WIDTHS.map(([w, l]) => `<button class="pdft-w ${pv.pen.w === w ? 'on' : ''}" data-action="pdf-width" data-w="${w}" title="${l}" aria-label="Trait ${l.toLowerCase()}"><i style="height:${Math.round(w * 600) + 1}px"></i></button>`).join('') : '';
        return `<div class="pdft-group">${PDF_TOOLS.map(tb).join('')}</div><span class="pdft-sep"></span><div class="pdft-group pdft-colors">${cols}${widths}</div><span class="pdft-sep"></span>
            <div class="pdft-group"><button class="pdft-i" data-action="pdf-undo" title="Annuler (Ctrl+Z)" aria-label="Annuler" ${pv.undo.length ? '' : 'disabled'}>${ic('undo')}</button><button class="pdft-i" data-action="pdf-redo" title="Rétablir (Ctrl+Maj+Z)" aria-label="Rétablir" ${pv.redo.length ? '' : 'disabled'}>${ic('redo')}</button></div><span class="pdft-sep"></span>
            <div class="pdft-group"><button class="pdft-i" data-action="pdf-zoom" data-d="-1" aria-label="Zoom arrière" title="Zoom arrière">${ic('minus')}</button><b class="pdft-z" id="pdf-zoomv">${Math.round(pv.zoom * 100)} %</b><button class="pdft-i" data-action="pdf-zoom" data-d="1" aria-label="Zoom avant" title="Zoom avant">${ic('plus')}</button></div><span class="pdft-sep"></span>
            <div class="pdft-group"><button class="pdft-i" data-action="pdf-blank" title="Ajouter une page blanche" aria-label="Ajouter une page blanche">${ic('pageadd')}</button><button class="pdft-i" data-action="pdf-pos" title="Barre d'outils en ${pr.pos === 'top' ? 'bas' : 'haut'}" aria-label="Placer la barre ${pr.pos === 'top' ? 'en bas' : 'en haut'}">${ic(pr.pos === 'top' ? 'arrowDown' : 'arrowUp')}</button>${pv.narrowClose ? '' : `<button class="pdft-i pdft-close" data-action="pdf-annotate" title="Fermer les outils" aria-label="Fermer les outils">${ic('x')}</button>`}</div>`;
    },
    pdfRefreshTools() {
        const pv = this.pv; if (!pv) return; const box = $('#pdf-tools'), v = $('.pdfv');
        if (box) box.innerHTML = this.pdfToolsHtml();
        if (v) { v.classList.toggle('ann-on', !!pv.annotate); v.className = v.className.replace(/\btool-\S+/g, '').trim() + ' tool-' + pv.tool; }
        const fab = $('#pdf-fab'); if (fab) fab.classList.toggle('hidden', !!pv.annotate || pv.mode === 'text');
        const pg = $('#pdf-pages'); if (pg) pg.dataset.tool = pv.annotate ? pv.tool : 'hand';
        if (pv.tool !== 'select') this.pdfPopClose();
    },

    /* ---------- undo / redo : a copy of the annotations before each change ---------- */
    pdfSnap() { const p = this.pv.p; return JSON.stringify({ a: p.ann, t: p.trash, g: p.pg }); },
    pdfEdit(fn) {
        const pv = this.pv, before = this.pdfSnap(); fn(); const after = this.pdfSnap();
        if (before === after) return false;
        pv.undo.push(before); if (pv.undo.length > 60) pv.undo.shift(); pv.redo = [];
        this.pdfAfterEdit(false); return true;
    },
    /* a drag in progress already changed the data : its start state was kept, the change is recorded at the end */
    pdfCommit(before) { const pv = this.pv; if (this.pdfSnap() === before) return; pv.undo.push(before); if (pv.undo.length > 60) pv.undo.shift(); pv.redo = []; this.pdfAfterEdit(false); },
    pdfAfterEdit(relayout) {
        const pv = this.pv, p = pv.p; p.mod = Date.now(); clearTimeout(pv.annT); pv.annT = setTimeout(() => this.save(false), 500);
        if (relayout) this.pdfRelayout(); else pv.pages.forEach(pg => { if (pg.state === 2) this.pdfDrawAnn(pg); });
        const u = $('[data-action=pdf-undo]'), r = $('[data-action=pdf-redo]'); if (u) u.disabled = !pv.undo.length; if (r) r.disabled = !pv.redo.length;
    },
    pdfUndo(redo = false) {
        const pv = this.pv; if (!pv) return; const from = redo ? pv.redo : pv.undo, to = redo ? pv.undo : pv.redo; if (!from.length) { this.toast(redo ? 'Rien à rétablir.' : 'Rien à annuler.', 'warning'); return; }
        const cur = this.pdfSnap(), s = JSON.parse(from.pop()), p = pv.p, now = Date.now(); to.push(cur);
        const pgChanged = JSON.stringify(s.g) !== JSON.stringify(p.pg), had = new Set(Object.values(p.ann).flat().map(a => a.i));
        p.ann = s.a; p.trash = s.t; p.pg = s.g;
        Object.values(p.ann).flat().forEach(a => { if (!had.has(a.i)) a.m = now; });   // an annotation brought back must win over the "erased" mark kept in the sync
        if (pgChanged) { p.last = clamp(p.last, 0, p.pg.length - 1); }
        this.pdfAfterEdit(pgChanged); this.toast(redo ? 'Rétabli' : 'Annulé', 'success', ic(redo ? 'redo' : 'undo'));
    },
    async pdfRelayout() {
        const pv = this.pv, sc = $('#pdf-scroll'), keep = sc ? sc.scrollTop : 0; if (pv.obs) pv.obs.disconnect(); pv.pages.forEach(pg => this.pdfUnrender(pg));
        await this.pdfLayout(); if (this.pv !== pv) return; this.pdfStartObserve(); if (sc) sc.scrollTop = keep; this.pdfUpdatePg();
    },

    /* ---------- drawing the annotations of one page ---------- */
    pdfDrawAnn(pg) {
        const pv = this.pv; if (!pv || !pg.el) return; const list = pv.p.ann[pg.g.id] || [], el = pg.el, r = pg.ch / Math.max(1, pg.cw);
        el.style.setProperty('--pw', `${pg.cw}px`);
        const svg = $('svg.pdfa', el); svg.setAttribute('viewBox', `0 0 1 ${r}`); svg.setAttribute('preserveAspectRatio', 'none');
        let h = '';
        list.forEach(a => {
            if (a.t === 'hl') h += `<g class="hl" data-i="${esc(a.i)}">${a.r.map(([x, y, w, hh]) => `<rect x="${x}" y="${y * r}" width="${w}" height="${hh * r}" fill="${esc(a.c)}" rx="0.002"/>`).join('')}</g>`;
            else if (a.t === 'dr') h += `<path class="dr" data-i="${esc(a.i)}" d="${this.pdfPath(a.p, r)}" stroke="${esc(a.c)}" stroke-width="${a.w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
        });
        svg.innerHTML = h;
        const x = $('.pdfx', el), have = new Map($$('.pdfa-box', x).map(b => [b.dataset.i, b]));
        list.filter(a => a.t === 'tx' || a.t === 'nt').forEach(a => {
            let b = have.get(a.i); have.delete(a.i);
            if (!b) { b = document.createElement('div'); b.dataset.i = a.i; b.innerHTML = `<div class="pdfa-grip" data-grip title="Déplacer">${ic('grip')}</div><div class="pdfa-t" contenteditable="true" spellcheck="false" role="textbox" aria-label="Texte"></div><div class="pdfa-rs" data-rs title="Largeur"></div><div class="pdfa-tb"><button data-action="pdf-bsize" data-d="-1" aria-label="Plus petit">A−</button><button data-action="pdf-bsize" data-d="1" aria-label="Plus grand">A+</button><button data-action="pdf-bcolor" aria-label="Couleur"><i></i></button><button data-action="pdf-bdel" aria-label="Supprimer">${ic('trash')}</button></div>`; x.appendChild(b); }
            b.className = `pdfa-box ${a.t}`; b.style.cssText = `left:${a.x * 100}%;top:${a.y * 100}%;width:${a.w * 100}%;font-size:calc(var(--pw) * ${a.fs / 600});${a.t === 'tx' ? `color:${a.c === '#fde047' ? '#111827' : a.c}` : ''}`;
            const t = $('.pdfa-t', b); if (document.activeElement !== t && t.textContent !== a.s) t.textContent = a.s;
            const i = $('.pdfa-tb i', b); if (i) i.style.background = a.t === 'nt' ? '#fde047' : (a.c === '#fde047' ? '#111827' : a.c);
        });
        have.forEach(b => b.remove());
    },
    pdfPath(pts, r) {
        if (!pts.length) return ''; if (pts.length === 1) return `M${pts[0][0]} ${pts[0][1] * r}l0.0001 0`;
        let d = `M${pts[0][0]} ${pts[0][1] * r}`;
        for (let k = 1; k < pts.length - 1; k++) { const mx = (pts[k][0] + pts[k + 1][0]) / 2, my = (pts[k][1] + pts[k + 1][1]) / 2; d += `Q${pts[k][0]} ${pts[k][1] * r} ${mx} ${my * r}`; }
        const l = pts[pts.length - 1]; return d + `L${l[0]} ${l[1] * r}`;
    },
    pdfAnnOf(pid, id) { return ((this.pv.p.ann[pid]) || []).find(a => a.i === id) || null; },
    pdfAnnAdd(pid, a) { const p = this.pv.p; a.m = Date.now(); (p.ann[pid] = p.ann[pid] || []).push(normalizePdfAnn(a)); },
    /* an annotation is "erased" by moving it to the trash (it is also what keeps it erased on the other devices) */
    pdfAnnDel(pid, id) {
        const p = this.pv.p, l = p.ann[pid] || [], k = l.findIndex(a => a.i === id); if (k < 0) return;
        const [a] = l.splice(k, 1); if (!l.length) delete p.ann[pid];
        p.trash.push({ pid, at: Date.now(), a }); if (p.trash.length > 400) p.trash.splice(0, p.trash.length - 400);
    },

    /* ---------- the selected text ---------- */
    pdfSelection() {
        const s = window.getSelection(), pv = this.pv; if (!pv || !s || s.isCollapsed || !s.rangeCount) return null;
        const rg = s.getRangeAt(0), sc = $('#pdf-pages'); if (!sc || !sc.contains(rg.commonAncestorContainer) && !(rg.commonAncestorContainer.contains && rg.commonAncestorContainer.contains(sc))) return null;
        const text = s.toString().replace(/\s+/g, ' ').trim(); if (!text) return null;
        const groups = [];
        pv.pages.forEach(pg => {
            if (!pg.el || pg.state !== 2 || !pg.divs || !pg.divs.length) return;
            const box = pg.el.getBoundingClientRect(); let rects = [];
            pg.divs.forEach(d => { if (!rg.intersectsNode(d)) return;
                const r2 = document.createRange(), t0 = d.firstChild; if (!t0) return;
                r2.selectNodeContents(d);
                if (rg.compareBoundaryPoints(Range.START_TO_START, r2) > 0 && d.contains(rg.startContainer)) r2.setStart(rg.startContainer, rg.startOffset);
                if (rg.compareBoundaryPoints(Range.END_TO_END, r2) < 0 && d.contains(rg.endContainer)) r2.setEnd(rg.endContainer, rg.endOffset);
                Array.from(r2.getClientRects()).forEach(c => { if (c.width > 1 && c.height > 2) rects.push(c); });
            });
            if (!rects.length) return;
            rects.sort((a, b) => a.top - b.top || a.left - b.left); const lines = [];
            rects.forEach(c => { const l = lines.find(z => Math.abs(z.top - c.top) < Math.max(z.h, c.height) * 0.5 && c.left <= z.right + Math.max(z.h, c.height) * 0.8); if (l) { l.left = Math.min(l.left, c.left); l.right = Math.max(l.right, c.right); l.top = Math.min(l.top, c.top); l.bottom = Math.max(l.bottom, c.bottom); l.h = l.bottom - l.top; } else lines.push({ left: c.left, right: c.right, top: c.top, bottom: c.bottom, h: c.height }); });
            const rel = lines.map(l => [(l.left - box.left) / box.width, (l.top - box.top) / box.height, (l.right - l.left) / box.width, (l.bottom - l.top) / box.height]);
            groups.push({ pid: pg.g.id, rects: rel, bottom: Math.max(...lines.map(l => l.bottom)), top: Math.min(...lines.map(l => l.top)), left: Math.min(...lines.map(l => l.left)), right: Math.max(...lines.map(l => l.right)) });
        });
        if (!groups.length) return null;
        return { text, groups, pid: groups[0].pid };
    },
    pdfPopClose() { const o = $('#pdf-pop'); if (o) o.remove(); },
    /* the small bar that appears on a selection (or on a highlight that is touched) */
    pdfPop(rect, { sel = null, ann = null, area = null } = {}) {
        this.pdfPopClose(); const pv = this.pv, v = $('.pdfv'); if (!v) return;
        const pop = document.createElement('div'); pop.id = 'pdf-pop'; pop.className = 'pdf-pop';
        const cur = ann ? ann.a.c : pv.color;
        pop.innerHTML = `<div class="pdf-pop-c">${PDF_COLORS.map(c => `<button class="pdft-c ${c === cur && !area ? 'on' : ''}" data-pop="color" data-c="${c}" style="--c:${c}" aria-label="${area ? 'Surligner la zone' : 'Surligner'} (${c})"></button>`).join('')}</div>
            <div class="pdf-pop-a"><button data-pop="cite">${ic('note')}<span>Citer</span></button><button data-pop="card">${ic('plus')}<span>Carte</span></button>${area ? `<button data-pop="img">${ic('image')}<span>Carte image</span></button>` : `<button data-pop="read">${ic('volume')}<span>Lire</span></button>`}<button data-pop="copy">${ic('copy')}<span>Copier</span></button>${ann ? `<button data-pop="del" class="danger">${ic('trash')}<span>Effacer</span></button>` : ''}<button data-pop="x" aria-label="Fermer">${ic('x')}</button></div>`;
        v.appendChild(pop);
        const vr = v.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight, touch = matchMedia('(pointer: coarse)').matches;
        let top = touch ? rect.bottom + 34 : rect.top - h - 8; if (top < vr.top + 56) top = rect.bottom + (touch ? 34 : 10); if (top + h > vr.bottom - 8) top = Math.max(vr.top + 56, rect.top - h - (touch ? 56 : 8));
        pop.style.left = `${clamp(rect.left + (rect.right - rect.left) / 2 - w / 2 - vr.left, 6, vr.width - w - 6)}px`; pop.style.top = `${top - vr.top}px`;
        pop.addEventListener('pointerdown', e => e.preventDefault());   // (keeps the text selected while a button is pressed)
        pop.addEventListener('click', e => {
            const b = e.target.closest('[data-pop]'); if (!b) return; e.stopPropagation(); const k = b.dataset.pop;
            if (k === 'x') { this.pdfPopClose(); window.getSelection().removeAllRanges(); return; }
            const text = sel ? sel.text : ann ? ann.a.s : area ? area.text : '', pid = sel ? sel.pid : ann ? ann.pid : area.pid;
            if (k === 'color') {
                pv.color = b.dataset.c; this.pdfRefreshTools();
                if (sel) { this.pdfHighlight(sel, b.dataset.c); }
                else if (ann) this.pdfEdit(() => { const a = this.pdfAnnOf(ann.pid, ann.a.i); if (a) { a.c = b.dataset.c; a.m = Date.now(); } });
                else if (area) this.pdfEdit(() => this.pdfAnnAdd(area.pid, { t: 'hl', c: b.dataset.c, r: [area.rect], s: area.text }));
                this.pdfPopClose(); window.getSelection().removeAllRanges(); return;
            }
            if (k === 'cite') { if (!text) this.toast('Pas de texte dans cette zone.', 'warning'); else this.pdfCite(text, pid); }
            else if (k === 'card') this.pdfCardModal({ text, pid });
            else if (k === 'img') this.pdfAreaCard(area);
            else if (k === 'read') this.pdfSpeak(text);
            else if (k === 'copy') { try { navigator.clipboard.writeText(text); this.toast('Copié', 'success', ic('copy')); } catch { this.toast('Impossible de copier ici.', 'warning'); } }
            else if (k === 'del') { this.pdfEdit(() => this.pdfAnnDel(ann.pid, ann.a.i)); }
            this.pdfPopClose(); if (k !== 'color') window.getSelection().removeAllRanges();
        });
    },
    pdfHighlight(sel, color) {
        this.pdfEdit(() => sel.groups.forEach((g, k) => this.pdfAnnAdd(g.pid, { t: 'hl', c: color, r: g.rects, s: k === 0 ? sel.text : '' })));
    },
    pdfSelWatch() {
        clearTimeout(this._pdfSelT);
        this._pdfSelT = setTimeout(() => {
            const pv = this.pv; if (!pv || this.view !== 'pdf' || pv.tool !== 'select' || pv.mode === 'text') return;
            const sel = this.pdfSelection(); if (!sel) { if (!pv.areaPop) this.pdfPopClose(); return; }
            const g = sel.groups[sel.groups.length - 1], gf = sel.groups[0];
            this.pdfPop({ left: gf.left, right: g.right, top: gf.top, bottom: g.bottom }, { sel });
        }, 260);
    },
    /* the text of the PDF inside a rectangle of a page (to quote an area) */
    pdfTextIn(pg, r) {
        if (!pg.divs) return ''; const box = pg.el.getBoundingClientRect(), x1 = box.left + r[0] * box.width, y1 = box.top + r[1] * box.height, x2 = x1 + r[2] * box.width, y2 = y1 + r[3] * box.height;
        return pg.divs.filter(d => { const b = d.getBoundingClientRect(); return b.right > x1 && b.left < x2 && b.bottom > y1 && b.top < y2 && (Math.min(b.right, x2) - Math.max(b.left, x1)) > b.width * 0.4; }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left).map(d => d.textContent).join(' ').replace(/\s+/g, ' ').trim();
    },
    /* a picture of an area of the page, kept as a card (front = the picture) */
    pdfAreaImage(pg, r) {
        const cv = $('canvas', pg.el); if (!cv || !cv.width) return null;
        const sx = r[0] * cv.width, sy = r[1] * cv.height, sw = Math.max(4, r[2] * cv.width), sh = Math.max(4, r[3] * cv.height), k = Math.min(1, 900 / Math.max(sw, sh)), out = document.createElement('canvas');
        out.width = Math.round(sw * k); out.height = Math.round(sh * k); out.getContext('2d').drawImage(cv, sx, sy, sw, sh, 0, 0, out.width, out.height);
        return out.toDataURL('image/jpeg', 0.85);
    },
    pdfAreaCard(area) {
        const pg = this.pv.pages.find(x => x.g.id === area.pid), url = pg && this.pdfAreaImage(pg, area.rect); if (!url) { this.toast('La page n\'est pas encore affichée.', 'warning'); return; }
        this.pdfCardModal({ text: area.text, pid: area.pid, image: this.addMedia(url) });
    },

    /* ---------- a card from a passage ---------- */
    pdfCardModal({ text = '', pid, image = '' }) {
        const pv = this.pv, p = pv.p, d = this.pdfDeckOf(p), i = this.pdfPageIndex(p, pid) + 1, t = String(text).replace(/\s+/g, ' ').trim().slice(0, 600);
        const img = image ? `<img src="${esc(this.data.media[image.slice(6)] || '')}" alt="" style="max-width:100%;max-height:150px;border-radius:8px;display:block;margin-bottom:6px">` : '';
        const m = this.openModal({
            title: 'Carte depuis le PDF', size: 'wide',
            body: `<p class="small faint" style="margin:0 0 10px">${ic('pdf')} ${esc(p.name)} · page ${i} · paquet « ${esc(d.name)} »</p>
                <div class="chip-row" style="margin-bottom:10px"><button class="chip active" data-pk="basic">Question / réponse</button><button class="chip" data-pk="cloze" ${t ? '' : 'disabled'}>Texte à trous</button></div>
                <div class="field" id="pc-f"><label class="label" for="pc-front">Recto · question</label><textarea class="input" id="pc-front" rows="3" placeholder="Écris la question…">${image ? '' : ''}</textarea>${img}</div>
                <div class="field" id="pc-b"><label class="label" for="pc-back">Verso · réponse</label><textarea class="input" id="pc-back" rows="4">${esc(image ? t : t)}</textarea></div>
                <div class="field hidden" id="pc-c"><label class="label" for="pc-text">Texte (sélectionne des mots puis touche « Cacher »)</label><textarea class="input" id="pc-text" rows="5">${esc(t)}</textarea><div class="row-gap" style="margin-top:6px"><button class="btn btn-soft btn-sm" id="pc-hide">${ic('eyeOff')}Cacher la sélection</button></div></div>
                <p class="small muted">La carte garde un lien <b>« voir dans le PDF »</b> : il ouvre la page et fait clignoter le passage.</p>`,
            foot: `<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="pc-go">${ic('check')}Créer la carte</button>`
        });
        let kind = 'basic'; const front = $('#pc-front', m), back = $('#pc-back', m), tx = $('#pc-text', m);
        $$('[data-pk]', m).forEach(b => b.addEventListener('click', () => { if (b.disabled) return; kind = b.dataset.pk; $$('[data-pk]', m).forEach(x => x.classList.toggle('active', x === b)); $('#pc-f', m).classList.toggle('hidden', kind !== 'basic'); $('#pc-b', m).classList.toggle('hidden', kind !== 'basic'); $('#pc-c', m).classList.toggle('hidden', kind !== 'cloze'); }));
        let n = 0; $('#pc-hide', m).addEventListener('click', () => { const a = tx.selectionStart, b = tx.selectionEnd; if (a === b) { this.toast('Sélectionne d\'abord un ou plusieurs mots.', 'warning'); return; } n++; tx.value = `${tx.value.slice(0, a)}{{c${n}::${tx.value.slice(a, b)}}}${tx.value.slice(b)}`; });
        setTimeout(() => (kind === 'basic' ? front : tx).focus(), 60);
        $('#pc-go', m).addEventListener('click', () => {
            const src = { pdf: p.id, pid, t: t.slice(0, 120) }; let ids;
            if (kind === 'basic') {
                const f = (front.value.trim() ? esc(front.value.trim()).replace(/\n/g, '<br>') : '') + (image ? `<img src="${esc(image)}">` : ''), b = esc(back.value.trim()).replace(/\n/g, '<br>');
                if (!f || !b) { this.toast('Il faut un recto et un verso.', 'warning'); return; }
                this.change('carte depuis un PDF', [], () => { ids = this.createNote({ type: 'basic', deckId: d.id, front: f, back: b, hint: '', detail: '', tags: [] }); ids.forEach(id => { this.card(id).src = src; }); }, { decks: true });
            } else {
                if (!/\{\{c\d+::/.test(tx.value)) { this.toast('Cache au moins un mot (sélectionne-le puis « Cacher la sélection »).', 'warning'); return; }
                this.change('carte à trous depuis un PDF', [], () => { ids = this.createNote({ type: 'cloze', deckId: d.id, front: esc(tx.value.trim()).replace(/\{\{c(\d+)::([\s\S]*?)\}\}/g, '{{c$1::$2}}'), back: '', hint: '', detail: '', tags: [] }) || []; ids.forEach(id => { this.card(id).src = src; }); }, { decks: true });
            }
            this.closeModal(m); this.save(); this.toast(`${plural((ids || []).length, 'carte')} dans « ${d.name} »`, 'success', ic('card'));
        });
    },

    /* ---------- events on the pages ---------- */
    pdfPt(e, pgEl) { const r = pgEl.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)]; },
    pdfBindAnn(root) {
        if (!root._pdfa) {
            root._pdfa = true;
            document.addEventListener('selectionchange', () => { if (this.view === 'pdf' && this.pv) this.pdfSelWatch(); });
            const pv = () => this.pv;
            /* pen, eraser, area, text, note : pointer on the overlay of a page */
            root.addEventListener('pointerdown', e => {
                const P = pv(); if (!P || !P.annotate) return;
                const ov = e.target.closest('.pdfo'); if (!ov) return;
                const pgEl = ov.closest('.pdfp'), pg = P.pages[Number(pgEl.dataset.i)], pid = pg.g.id, t = P.tool;
                if (!['pen', 'eraser', 'area', 'text', 'note'].includes(t)) return;
                e.preventDefault(); this.pdfPopClose(); const r = pg.ch / pg.cw, start = this.pdfPt(e, pgEl);
                try { ov.setPointerCapture(e.pointerId); } catch { /* ignore */ }
                if (t === 'text' || t === 'note') {
                    this.pdfEdit(() => this.pdfAnnAdd(pid, { t: t === 'text' ? 'tx' : 'nt', c: t === 'text' ? '#111827' : '#fde047', x: clamp(start[0], 0, 0.8), y: clamp(start[1], 0, 0.94), w: t === 'text' ? 0.34 : 0.3, s: '', fs: 14 }));
                    const a = (P.p.ann[pid] || []).slice(-1)[0]; P.tool = 'select'; this.pdfRefreshTools();
                    setTimeout(() => { const b = $(`.pdfa-box[data-i="${a.i}"] .pdfa-t`, pgEl); if (b) b.focus(); }, 30); return;
                }
                if (t === 'pen') {
                    const pts = [start], svg = $('svg.pdfa', pgEl), path = document.createElementNS('http://www.w3.org/2000/svg', 'path'), pen = P.pen;
                    path.setAttribute('stroke', pen.c); path.setAttribute('stroke-width', pen.w); path.setAttribute('fill', 'none'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); svg.appendChild(path);
                    const mv = ev => { (ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev]).forEach(c => { const q = this.pdfPt(c, pgEl), l = pts[pts.length - 1]; if (Math.hypot(q[0] - l[0], (q[1] - l[1]) * r) > 0.0012) pts.push(q); }); path.setAttribute('d', this.pdfPath(pts, r)); };
                    const up = () => {
                        ov.removeEventListener('pointermove', mv); ov.removeEventListener('pointerup', up); ov.removeEventListener('pointercancel', up); path.remove();
                        if (this.pv !== P) return;
                        this.pdfEdit(() => this.pdfAnnAdd(pid, { t: 'dr', c: pen.c, w: pen.w, p: pts }));
                    };
                    ov.addEventListener('pointermove', mv); ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up); mv(e); return;
                }
                if (t === 'eraser') {
                    const before = this.pdfSnap(); let any = false;
                    const hit = ev => {
                        const q = this.pdfPt(ev, pgEl), list = P.p.ann[pid] || [];
                        list.filter(a => a.t === 'dr').forEach(a => {
                            const th = 0.014 + a.w / 2; let near = false;
                            for (let k = 0; k < a.p.length && !near; k++) { const A = a.p[k], B = a.p[k + 1] || A; const dx = B[0] - A[0], dy = (B[1] - A[1]) * r, l2 = dx * dx + dy * dy, qx = q[0] - A[0], qy = (q[1] - A[1]) * r, u = l2 ? clamp((qx * dx + qy * dy) / l2, 0, 1) : 0; near = Math.hypot(qx - u * dx, qy - u * dy) < th; }
                            if (near) { this.pdfAnnDel(pid, a.i); any = true; }
                        });
                        if (any) this.pdfDrawAnn(pg);
                    };
                    const mv = ev => hit(ev), up = () => { ov.removeEventListener('pointermove', mv); ov.removeEventListener('pointerup', up); ov.removeEventListener('pointercancel', up); if (any && this.pv === P) { this.pdfCommit(before); this.toast('Dessin effacé · retrouve-le dans « Annotations effacées »', 'success', ic('trash')); } };
                    ov.addEventListener('pointermove', mv); ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up); hit(e); return;
                }
                if (t === 'area') {
                    const box = document.createElement('div'); box.className = 'pdf-areabox'; $('.pdfx', pgEl).appendChild(box); let cur = start;
                    const rect = () => { const x = Math.min(start[0], cur[0]), y = Math.min(start[1], cur[1]); return [x, y, Math.abs(cur[0] - start[0]), Math.abs(cur[1] - start[1])]; };
                    const mv = ev => { cur = this.pdfPt(ev, pgEl); const q = rect(); box.style.cssText = `left:${q[0] * 100}%;top:${q[1] * 100}%;width:${q[2] * 100}%;height:${q[3] * 100}%`; };
                    const up = () => {
                        ov.removeEventListener('pointermove', mv); ov.removeEventListener('pointerup', up); ov.removeEventListener('pointercancel', up);
                        const q = rect(); if (q[2] < 0.02 || q[3] < 0.012) { box.remove(); return; }
                        const br = box.getBoundingClientRect(); P.areaPop = true; setTimeout(() => { if (this.pv === P) P.areaPop = false; }, 400);
                        this.pdfPop(br, { area: { pid, rect: q, text: this.pdfTextIn(pg, q) } });
                        const kill = ev2 => { if (ev2.target.closest && ev2.target.closest('#pdf-pop')) return; box.remove(); this.pdfPopClose(); document.removeEventListener('pointerdown', kill, true); };
                        setTimeout(() => document.addEventListener('pointerdown', kill, true), 50);
                    };
                    ov.addEventListener('pointermove', mv); ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up);
                }
            });
            /* a text box or margin note : move (grip), widen (corner), write */
            root.addEventListener('pointerdown', e => {
                const P = pv(); if (!P) return; const grip = e.target.closest('[data-grip]'), rs = e.target.closest('[data-rs]'); if (!grip && !rs) return;
                const box = e.target.closest('.pdfa-box'), pgEl = box.closest('.pdfp'), pg = P.pages[Number(pgEl.dataset.i)], a = this.pdfAnnOf(pg.g.id, box.dataset.i); if (!a) return;
                e.preventDefault(); const before = this.pdfSnap(), p0 = this.pdfPt(e, pgEl), x0 = a.x, y0 = a.y, w0 = a.w; box.classList.add('moving');
                const mv = ev => { const q = this.pdfPt(ev, pgEl); if (grip) { a.x = clamp(x0 + q[0] - p0[0], 0, 0.95); a.y = clamp(y0 + q[1] - p0[1], 0, 0.97); box.style.left = a.x * 100 + '%'; box.style.top = a.y * 100 + '%'; } else { a.w = clamp(w0 + q[0] - p0[0], 0.08, 1 - a.x); box.style.width = a.w * 100 + '%'; } };
                const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); box.classList.remove('moving'); a.m = Date.now(); if (this.pv === P) this.pdfCommit(before); };
                window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
            });
            root.addEventListener('focusin', e => { const t = e.target.closest && e.target.closest('.pdfa-t'); if (t) { $$('.pdfa-box.sel', root).forEach(b => b.classList.remove('sel')); t.closest('.pdfa-box').classList.add('sel'); t._before = this.pdfSnap(); } });
            root.addEventListener('focusout', e => {
                const t = e.target.closest && e.target.closest('.pdfa-t'); if (!t || !this.pv) return; const box = t.closest('.pdfa-box'), pgEl = box.closest('.pdfp'), pg = this.pv.pages[Number(pgEl.dataset.i)], a = this.pdfAnnOf(pg.g.id, box.dataset.i);
                setTimeout(() => { if (!box.contains(document.activeElement)) box.classList.remove('sel'); }, 150);
                if (!a) return; const s = t.innerText.replace(/ /g, ' ').replace(/\n+$/, '').slice(0, 2000);
                if (s !== a.s) { const before = t._before; a.s = s; a.m = Date.now(); if (before) this.pdfCommit(before); }
                if (!a.s.trim() && this.pv) { const before = this.pdfSnap(); this.pdfAnnDel(pg.g.id, a.i); this.pdfAfterEdit(false); this.pv.undo.push(before); this.pv.redo = []; }   // an empty box disappears
            });
            root.addEventListener('paste', e => { const t = e.target.closest && e.target.closest('.pdfa-t'); if (!t) return; e.preventDefault(); const s = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, s); });
            root.addEventListener('keydown', e => { const t = e.target.closest && e.target.closest('.pdfa-t'); if (t && e.key === 'Escape') { e.stopPropagation(); t.blur(); } });
            /* a touch on an existing highlight : change its colour, quote it, make a card, erase it */
            root.addEventListener('click', e => {
                const P = pv(); if (!P || P.mode === 'text' || e.target.closest('.pdfa-box, #pdf-pop, button, a')) return;
                const pgEl = e.target.closest('.pdfp'); if (!pgEl || !['select', 'hand'].includes(P.annotate ? P.tool : 'hand')) return;
                const s = window.getSelection(); if (s && !s.isCollapsed) return;
                const pg = P.pages[Number(pgEl.dataset.i)], q = this.pdfPt(e, pgEl), list = (P.p.ann[pg.g.id] || []).filter(a => a.t === 'hl');
                const hit = list.slice().reverse().find(a => a.r.some(([x, y, w, h]) => q[0] >= x - 0.004 && q[0] <= x + w + 0.004 && q[1] >= y - 0.004 && q[1] <= y + h + 0.004));
                if (!hit) { this.pdfPopClose(); return; }
                const bb = pgEl.getBoundingClientRect(), r0 = hit.r[0], rect = { left: bb.left + r0[0] * bb.width, right: bb.left + (r0[0] + r0[2]) * bb.width, top: bb.top + r0[1] * bb.height, bottom: bb.top + (r0[1] + r0[3]) * bb.height };
                this.pdfPop(rect, { ann: { pid: pg.g.id, a: hit } });
            });
            $('#pdf-scroll').addEventListener('scroll', () => { if (!$('#pdf-pop')) return; this.pdfPopClose(); }, { passive: true });
        }
        this.pdfRefreshTools();
    },
    pdfAnnAction(action, el) {
        const pv = this.pv, ds = el.dataset || {}; if (!pv) return;
        const box = el.closest && el.closest('.pdfa-box'), pgEl = box && box.closest('.pdfp'), pg = pgEl && pv.pages[Number(pgEl.dataset.i)], a = box && pg && this.pdfAnnOf(pg.g.id, box.dataset.i);
        const A = {
            'pdf-tool': () => { pv.tool = ds.t; this.pdfRefreshTools(); },
            'pdf-color': () => { if (pv.tool === 'pen') pv.pen.c = ds.c; else pv.color = ds.c; this.pdfRefreshTools(); },
            'pdf-width': () => { pv.pen.w = Number(ds.w); this.pdfRefreshTools(); },
            'pdf-undo': () => this.pdfUndo(false), 'pdf-redo': () => this.pdfUndo(true),
            'pdf-zoom': () => this.pdfSetZoom(pv.zoom + 0.15 * Number(ds.d)),
            'pdf-pos': () => { const pr = this.pdfPrefs(); pr.pos = pr.pos === 'top' ? 'bottom' : 'top'; this.pdfPrefSave(); const v = $('.pdfv'); v.classList.remove('pos-top', 'pos-bottom'); v.classList.add('pos-' + pr.pos); this.pdfRefreshTools(); },
            'pdf-blank': () => this.pdfBlankMenu(el),
            'pdf-bsize': () => { if (a) this.pdfEdit(() => { a.fs = clamp(a.fs + 2 * Number(ds.d), 8, 60); a.m = Date.now(); }); },
            'pdf-bdel': () => { if (a) this.pdfEdit(() => this.pdfAnnDel(pg.g.id, a.i)); },
            'pdf-bcolor': () => { if (!a) return; const cols = a.t === 'nt' ? PDF_COLORS : PDF_PEN; const k = cols.indexOf(a.c); this.pdfEdit(() => { a.c = cols[(k + 1) % cols.length]; a.m = Date.now(); }); }
        };
        if (A[action]) A[action]();
    },

    /* ---------- blank pages ---------- */
    pdfBlankMenu(anchor) {
        const pv = this.pv, p = pv.p, cur = this.pdfCurrent();
        const add = at => { this.pdfEdit(() => p.pg.splice(at, 0, { id: uid('g'), k: 'b' })); this.pdfAfterEdit(true); setTimeout(() => this.pdfGoto(p.pg[at].id, '', true), 300); };
        this.showMenu(anchor, [
            { head: 'AJOUTER UNE PAGE BLANCHE' },
            { icon: 'arrowUp', label: `Au-dessus de la page ${cur + 1}`, fn: () => add(cur) },
            { icon: 'arrowDown', label: `En dessous de la page ${cur + 1}`, fn: () => add(cur + 1) },
            { icon: 'pageadd', label: 'À la fin du PDF', fn: () => add(p.pg.length) },
            ...(p.pg[cur] && p.pg[cur].k === 'b' ? [{ sep: true }, { icon: 'trash', label: 'Supprimer cette page blanche', danger: true, fn: () => { this.pdfEdit(() => { const g = p.pg[cur]; delete p.ann[g.id]; p.pg.splice(cur, 1); }); this.pdfAfterEdit(true); } }] : [])
        ]);
    },

    /* ---------- the menu "Plus" ---------- */
    pdfMoreMenu(anchor) {
        const pv = this.pv, p = pv.p, pr = this.pdfPrefs(), n = Object.values(p.ann).flat().length;
        this.showMenu(anchor, [
            { icon: 'pencil', label: 'Renommer le PDF', fn: () => this.pdfRenameDialog(p) },
            { icon: 'note', label: 'Extraire mes annotations dans la note', fn: () => this.pdfExtract() },
            { icon: pv.mode === 'text' ? 'file' : 'typeT', label: pv.mode === 'text' ? 'Revenir au PDF fidèle' : 'Lecteur de texte (réaffiche le texte)', fn: () => this.pdfAction('pdf-mode', anchor) },
            { icon: 'volume', label: 'Lire à voix haute…', fn: () => this.pdfReadMenu(anchor) },
            { icon: 'fullscreen', label: 'Mode concentration', fn: () => this.pdfFocus() },
            { icon: 'pageadd', label: 'Ajouter une page blanche…', fn: () => this.pdfBlankMenu(anchor) },
            { icon: 'trash', label: `Annotations effacées${p.trash.length ? ` (${p.trash.length})` : ''}`, fn: () => this.pdfTrashPanel() },
            { sep: true },
            { icon: 'export', label: 'Exporter le PDF annoté', fn: () => this.pdfExportAnnotated(p) },
            { icon: 'export', label: 'Exporter l\'original', fn: () => this.pdfExportOriginal(p) },
            { sep: true },
            { icon: 'columns', label: pr.side === 'right' ? 'Mettre la note à gauche' : 'Mettre la note à droite', fn: () => { pr.side = pr.side === 'right' ? 'left' : 'right'; this.pdfPrefSave(); const v = $('.pdfv'); v.classList.remove('side-left', 'side-right'); v.classList.add('side-' + pr.side); setTimeout(() => { this.pdfSizePages(); pv.pages.forEach(g => { if (g.state) { this.pdfUnrender(g); this.pdfRenderPage(g); } }); }, 60); } },
            ...(pv.mode === 'text' ? [{ icon: 'typeT', label: 'Texte plus grand', fn: () => { pr.fs = clamp(pr.fs + 0.12, 0.8, 1.8); this.pdfPrefSave(); $('#pdf-text').style.fontSize = `${1.02 * pr.fs}rem`; } }, { icon: 'typeT', label: 'Texte plus petit', fn: () => { pr.fs = clamp(pr.fs - 0.12, 0.8, 1.8); this.pdfPrefSave(); $('#pdf-text').style.fontSize = `${1.02 * pr.fs}rem`; } }] : []),
            { icon: 'info', label: 'Informations', fn: () => this.pdfInfo() },
            { sep: true },
            { icon: 'trash', label: 'Supprimer le PDF…', danger: true, fn: () => this.pdfDeleteAsk(p) }
        ]);
    },
    async pdfDeleteAsk(p) {
        const nc = p.pdeck ? this.data.cards.filter(c => this.descendantIds(p.pdeck).includes(c.deckId)).length : 0;
        const ok = await this.confirm({ title: 'Supprimer ce PDF ?', message: `« ${p.name} » part à la corbeille avec ${plural(Object.values(p.ann).flat().length, 'annotation')} et ${plural(nc, 'carte')}. Tu pourras tout restaurer pendant 30 jours.`, ok: 'Supprimer', danger: true });
        if (ok) this.pdfDelete(p);
    },
    pdfInfo() {
        const p = this.pv.p, here = PdfStore.mem.has(p.hash) ? true : null;
        const m = this.openModal({ title: 'Informations', size: 'narrow', body: `<div class="info-grid"><div><span>Nom</span><b>${esc(p.name)}</b></div><div><span>Pages</span><b>${p.pg.length}${p.pg.length !== p.pages ? ` (dont ${p.pg.length - p.pages} blanche${p.pg.length - p.pages > 1 ? 's' : ''})` : ''}</b></div><div><span>Taille</span><b>${fmtBytes(p.size)}</b></div><div><span>Annotations</span><b>${Object.values(p.ann).flat().length}</b></div><div><span>Cloud</span><b>${p.up ? 'envoyé' : p.size > PDF_MAX_SYNC ? 'trop lourd (reste ici)' : PdfSync.ok() ? 'en attente' : 'synchronisation désactivée'}</b></div><div><span>Empreinte</span><b class="mono" style="font-size:.78rem">${esc(p.hash.slice(0, 12))}</b></div></div>`, foot: '<button class="btn btn-primary" data-close>OK</button>' });
        return m;
    },
    /* annotations → the note of the PDF (quotes with their page, text boxes) */
    pdfExtract() {
        const pv = this.pv, p = pv.p, n = this.pdfNoteOf(p), blocks = [];
        p.pg.forEach((g, i) => {
            const list = p.ann[g.id] || []; const hl = list.filter(a => a.t === 'hl' && a.s), tx = list.filter(a => (a.t === 'tx' || a.t === 'nt') && a.s.trim());
            if (!hl.length && !tx.length) return;
            blocks.push({ t: 'h3', x: `Page ${i + 1}`, d: 0 });
            hl.forEach(a => blocks.push({ t: 'quote', x: `« ${a.s.replace(/\s+/g, ' ').trim().slice(0, 600)} » [[pdf:${p.id}:${g.id}|page ${i + 1}]]`, d: 1 }));
            tx.forEach(a => blocks.push({ t: 'p', x: `${a.s.replace(/\s+/g, ' ').trim().slice(0, 600)} [[pdf:${p.id}:${g.id}|page ${i + 1}]]`, d: 1 }));
        });
        if (!blocks.length) { this.toast('Aucun passage surligné ni texte ajouté pour l\'instant.', 'warning'); return; }
        if (!pv.notes) this.pdfToggleNotes(true);
        this.nbPush(); const last = n.b[n.b.length - 1];
        if (last && !last.x && n.b.length > 1) n.b.splice(n.b.length - 1, 1, { t: 'h2', x: 'Mes annotations', d: 0 }, ...blocks, nbEmpty()); else n.b.push({ t: 'h2', x: 'Mes annotations', d: 0 }, ...blocks);
        this.nbChanged(); this.nbRender(); this.toast(`${plural(blocks.filter(b => b.t !== 'h3').length, 'extrait')} ajouté${blocks.length > 2 ? 's' : ''} à la note`, 'success', ic('note'));
    },
    /* erased annotations : kept, can be brought back */
    pdfTrashPanel() {
        const pv = this.pv, p = pv.p; this.pdfPopClose();
        const label = t => ({ dr: 'Dessin', hl: 'Surlignage', tx: 'Texte', nt: 'Note' }[t.a.t]);
        const thumb = t => t.a.t === 'dr' ? (() => { const xs = t.a.p.map(q => q[0]), ys = t.a.p.map(q => q[1]), x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(0.02, Math.max(...xs) - x0), h = Math.max(0.02, Math.max(...ys) - y0), s = Math.max(w, h); return `<svg viewBox="${x0 - 0.01} ${y0 - 0.01} ${s + 0.02} ${s + 0.02}" width="44" height="44"><path d="${this.pdfPath(t.a.p, 1)}" stroke="${esc(t.a.c)}" stroke-width="${Math.max(t.a.w, s / 14)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`; })() : `<i class="pdf-sw" style="background:${esc(t.a.c)}"></i>`;
        const m = this.openModal({ title: 'Annotations effacées', size: 'narrow', body: `<p class="small muted" style="margin:0 0 10px">Ce que tu as effacé reste ici : touche « Remettre » pour le retrouver à sa place.</p><div class="pdf-trash">${p.trash.length ? p.trash.slice().reverse().map((t, k) => `<div class="pdf-trash-row" data-k="${p.trash.length - 1 - k}">${thumb(t)}<span><b>${label(t)}</b><small>page ${this.pdfPageIndex(p, t.pid) + 1}${t.a.s ? ' · ' + esc(truncate(t.a.s, 40)) : ''}</small></span><button class="btn btn-soft btn-sm" data-back>${ic('undo')}Remettre</button></div>`).join('') : '<p class="faint">Rien d\'effacé.</p>'}</div>`, foot: `${p.trash.length ? `<button class="btn btn-soft" id="pt-empty">${ic('trash')}Vider</button>` : ''}<button class="btn btn-primary" data-close>Fermer</button>` });
        m.addEventListener('click', e => {
            const b = e.target.closest('[data-back]'); if (b) { const row = b.closest('[data-k]'), t = p.trash[Number(row.dataset.k)]; if (!t) return; this.pdfEdit(() => { p.trash.splice(Number(row.dataset.k), 1); t.a.m = Date.now(); if (this.pdfPageIndex(p, t.pid) < 0) return; (p.ann[t.pid] = p.ann[t.pid] || []).push(t.a); }); row.remove(); this.toast('Remis à sa place', 'success', ic('undo')); }
            if (e.target.closest('#pt-empty')) { this.pdfEdit(() => { p.trash = []; }); this.closeModal(m); }
        });
    },

    /* ---------- the menu "Pratique" : the same functions as for any deck ---------- */
    pdfTrainMenu(anchor) {
        const pv = this.pv, p = pv.p, d = this.pdfDeckOf(p), st = this.deckStats().get(d.id), total = st ? st.total : 0, due = this.nbDueDeck ? this.nbDueDeck(d.id) : 0;
        this.save(false);
        const go = mode => this.nbTrain('deck', d.id, mode), need = fn => () => { if (!total) { this.toast('Aucune carte dans ce PDF pour l\'instant : surligne un passage puis touche « Carte ».', 'warning'); return; } fn(); };
        this.showMenu(anchor, [
            { head: `${esc(truncate(d.name, 30))} · ${plural(total, 'carte')}${due ? ` · ${due} à réviser` : ''}` },
            { icon: 'play', label: `S'entraîner${due ? ` (${due})` : ''}`, fn: need(() => this.pdfLeaveTo(() => go('srs'))) },
            { icon: 'repeat', label: 'Toutes les cartes (révision libre)', fn: need(() => this.pdfLeaveTo(() => go('free'))) },
            { icon: 'list', label: 'Dans l\'ordre du PDF', fn: need(() => this.pdfLeaveTo(() => go('ordered'))) },
            { icon: 'quiz', label: 'Créer un quiz', fn: need(() => this.pdfLeaveTo(() => go('quiz'))) },
            { icon: 'keyboard', label: 'Écrire les réponses', fn: need(() => this.pdfLeaveTo(() => go('write'))) },
            { icon: 'link', label: 'Association', fn: need(() => this.pdfLeaveTo(() => go('match'))) },
            { sep: true },
            { icon: 'calendar', label: 'Date d\'examen…', fn: () => this.nbExamModal(d.id) },
            { icon: 'chart', label: 'Statistiques de ce PDF', fn: () => { this.statsUi.deck = d.id; this.go('stats'); } },
            { icon: 'table', label: 'Tableau des cartes', fn: () => this.go('decks', { deck: d.id }) },
            { icon: 'sliders', label: 'Configurer la pratique', fn: () => this.openDeckOptions(d.id) },
            { icon: 'folder', label: 'Déplacer dans un dossier…', fn: () => this.pdfMoveDialog(p) },
            { sep: true },
            { icon: 'info', label: 'Comment ça marche ?', fn: () => this.pdfHelp() }
        ]);
    },
    pdfLeaveTo(fn) { this.pdfLeave(); this.view = 'notes'; fn(); },
    pdfMoveDialog(p) {
        const decks = this.sortedDecks().filter(d => !d.pdf && !(p.pdeck && this.descendantIds(p.pdeck).includes(d.id)));
        const m = this.openModal({ title: 'Déplacer dans un dossier', size: 'narrow', body: `<div class="field"><label class="label" for="pm-d">Dossier (= paquet)</label><select class="select" id="pm-d"><option value="">Aucun dossier</option>${decks.map(d => `<option value="${esc(d.id)}" ${d.id === p.deckId ? 'selected' : ''}>${esc(d.emoji)} ${esc(this.deckPath(d.id))}</option>`).join('')}</select></div><p class="small muted">Le PDF, son paquet de cartes et sa note vont ensemble.</p>`, foot: `<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="pm-go">${ic('check')}Déplacer</button>` });
        $('#pm-go', m).addEventListener('click', () => { if (this.pdfMove(p, $('#pm-d', m).value)) { this.closeModal(m); this.toast('PDF déplacé', 'success', ic('folder')); } });
    },
    pdfHelp() {
        this.openModal({
            title: 'Le PDF et ses cartes', size: 'narrow',
            body: `<div class="help-list"><p><b>Un PDF = un paquet.</b> Il se crée tout seul, avec sa note, et porte le nom du PDF.</p>
            <p><b>Surligner</b> : outil « Texte », sélectionne un passage puis choisis une couleur. <b>Carte</b> : sur la sélection, touche « Carte » ; elle garde un lien « voir dans le PDF ».</p>
            <p><b>Citer</b> met le passage dans la note avec « page N » : touche ce lien pour revenir à la page.</p>
            <p><b>Stylo / Gomme</b> : tes dessins effacés restent dans « Annotations effacées ».</p>
            <p><b>Pratique</b> : s'entraîner, quiz, date d'examen, statistiques… avec les cartes de ce PDF.</p>
            <p><b>Récupérer le PDF</b> : « Plus » → « Exporter le PDF annoté » (surlignages, textes et dessins inclus) ou « Exporter l'original ».</p></div>`,
            foot: '<button class="btn btn-primary" data-close>Compris</button>'
        });
    }
});
