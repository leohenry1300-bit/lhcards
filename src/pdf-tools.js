/* ============================================================
   PDF : barre d'outils à la RemNote — chaque outil a son petit panneau d'options (couleurs, épaisseur, mode…),
   marqueur, formes, flèches, sélection (déplacer, dupliquer, tout supprimer d'un coup).
   ============================================================ */
Object.assign(ICONS, {
    pick: '<path d="m4 4 7.5 17 2.4-7 7-2.4z"/>',
    shapes: '<rect x="3" y="3" width="8" height="8" rx="1"/><circle cx="17" cy="7" r="4"/><path d="M7 21l4-8 4 8z"/>',
    arrowdiag: '<path d="M5 19 19 5M9 5h10v10"/>'
});
const PDF_GRID = ['#e11d48', '#f87171', '#f472b6', '#ea580c', '#fb923c', '#f59e0b', '#facc15', '#fbbf24', '#10b981', '#84cc16', '#047857', '#0f766e', '#5eead4', '#38bdf8', '#3b82f6', '#1e3a8a', '#f0abfc', '#818cf8', '#a855f7', '#7e22ce', '#9ca3af', '#92400e', '#374151', '#000000'];
const PDF_TOOLS2 = [
    ['select', 'textcursor', 'Surligner', 'Surligner du texte (sélectionne-le, puis choisis une couleur)', true], ['pick', 'pick', 'Sélection', 'Sélectionner des annotations pour les déplacer, dupliquer ou supprimer', true],
    ['hand', 'hand', 'Main', 'Déplacer la page · toucher le haut = monter, le bas = descendre', false], ['marker', 'highlighter', 'Marqueur', 'Marqueur libre (traits transparents)', true],
    ['area', 'area', 'Zone', 'Choisir une zone (schéma, tableau…) pour la citer ou en faire une carte', false], ['pen', 'pen', 'Stylo', 'Dessiner ou écrire à la main', true],
    ['eraser', 'eraser', 'Gomme', 'Effacer', true], ['shape', 'shapes', 'Formes', 'Rectangle, cercle, triangle, losange, étoile…', true], ['arrow', 'arrowdiag', 'Flèche', 'Flèches et lignes', true],
    ['text', 'typeT', 'Écrire', 'Toucher n\'importe où sur la page pour écrire du texte', false], ['note', 'note', 'Note', 'Ajouter une note dans la marge', false]
];
const PDF_THICK = [0.0018, 0.004, 0.009], PDF_MK_THICK = [0.014, 0.026, 0.045];
const PDF_SHAPES = [['r', 'Rectangle', '<rect x="4" y="6" width="16" height="12" rx="1"/>'], ['o', 'Cercle', '<circle cx="12" cy="12" r="8"/>'], ['t', 'Triangle', '<path d="M12 4 21 20H3z"/>'], ['d', 'Losange', '<path d="M12 3 21 12 12 21 3 12z"/>'], ['h', 'Hexagone', '<path d="M7 4h10l5 8-5 8H7l-5-8z"/>'], ['s', 'Étoile', '<path d="m12 3 2.7 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17.2 6.4 20.3l1.2-6.3L3 9.6l6.3-.8z"/>']];

Object.assign(SuperAnki.prototype, {
    pdfOpts() {
        const pv = this.pv; pv.color = pv.color || PDF_COLORS[0]; pv.pen = pv.pen || { c: '#000000', w: PDF_THICK[1] }; pv.mk = pv.mk || { c: '#facc15', w: PDF_MK_THICK[1], op: 0.4 };
        pv.sh = pv.sh || { k: 'r', c: '#000000', w: PDF_THICK[1], f: '' }; pv.ar = pv.ar || { k: 'a', c: '#e11d48', w: PDF_THICK[1] }; pv.er = pv.er || { size: 0.016, mode: 'part', back: false };
        return pv;
    },
    pdfToolsHtml() {
        const pv = this.pdfOpts(); if (!pv) return ''; const t = pv.tool, hasSel = pv.sel && this.pdfSelCount() > 0;
        const dotOf = id => id === 'pen' ? pv.pen.c : id === 'marker' ? pv.mk.c : id === 'shape' ? pv.sh.c : id === 'arrow' ? pv.ar.c : id === 'select' ? pv.color : '';
        const tb = ([id, ico, label, tip, opt]) => `<button class="pdft-b ${t === id ? 'on' : ''}" data-action="pdf-tool" data-t="${id}" title="${tip}" aria-label="${label}" aria-pressed="${t === id}">${ic(ico)}<span>${label}</span>${opt ? '<i class="pdft-caret"></i>' : ''}${dotOf(id) ? `<em class="pdft-dot" style="background:${dotOf(id)}"></em>` : ''}</button>`;
        return `<div class="pdft-group">${PDF_TOOLS2.map(tb).join('')}</div><span class="pdft-sep"></span>
            <div class="pdft-group"><button class="pdft-i" data-action="pdf-undo" title="Annuler (Ctrl+Z)" aria-label="Annuler" ${pv.undo.length ? '' : 'disabled'}>${ic('undo')}</button><button class="pdft-i" data-action="pdf-redo" title="Rétablir (Ctrl+Maj+Z)" aria-label="Rétablir" ${pv.redo.length ? '' : 'disabled'}>${ic('redo')}</button></div><span class="pdft-sep"></span>
            <div class="pdft-group"><button class="pdft-i" data-action="pdf-zoom" data-d="-1" aria-label="Zoom arrière" title="Zoom arrière">${ic('minus')}</button><b class="pdft-z" id="pdf-zoomv">${Math.round(pv.zoom * 100)} %</b><button class="pdft-i" data-action="pdf-zoom" data-d="1" aria-label="Zoom avant" title="Zoom avant">${ic('plus')}</button></div><span class="pdft-sep"></span>
            <div class="pdft-group"><button class="pdft-i" data-action="pdf-blank" title="Ajouter une page blanche" aria-label="Ajouter une page blanche">${ic('pageadd')}</button><button class="pdft-i" data-action="pdf-pos" title="Placer la barre d'outils (haut, bas, gauche, droite)" aria-label="Placer la barre d'outils">${ic('columns')}</button><button class="pdft-i pdft-close" data-action="pdf-annotate" title="Fermer les outils" aria-label="Fermer les outils">${ic('x')}</button></div>`;
    },

    /* ---------- the little panel of options under a tool ---------- */
    pdfPanelHtml(t) {
        const pv = this.pdfOpts(), btn = (k, v, cur, inner, cls = '') => `<button class="pdfp-o ${cur === v ? 'on' : ''} ${cls}" data-action="pdf-opt" data-k="${k}" data-v="${v}">${inner}</button>`;
        const grid = (k, cur) => `<div class="pdfp-grid">${PDF_GRID.map(c => btn(k, c, cur, '', 'sw').replace('class="', `style="--c:${c}" class="`)).join('')}</div><label class="pdfp-hex"><span>#</span><input data-optin="${k}" value="${esc(String(cur).replace('#', '').toUpperCase())}" maxlength="6" autocomplete="off" spellcheck="false" aria-label="Couleur (code HEX)"><i style="background:${esc(cur)}"></i></label>`;
        const thick = (k, vals, cur) => `<div class="pdfp-row">${vals.map(w => btn(k, w, cur, `<i style="height:${Math.max(2, Math.round(w * 520))}px"></i>`, 'th')).join('')}</div>`;
        const sw = (k, label, on) => `<button class="pdfp-tg" data-action="pdf-opt" data-k="${k}" data-v="t"><span>${label}</span><i class="${on ? 'on' : ''}"></i></button>`;
        const h = x => `<div class="pdfp-h">${x}</div>`;
        if (t === 'select') return h('Couleur du surlignage') + `<div class="pdfp-row">${PDF_COLORS.map(c => btn('hlc', c, pv.color, '', 'sw').replace('class="', `style="--c:${c}" class="`)).join('')}</div>` + sw('auto', 'Surligner dès la sélection', !!pv.auto);
        if (t === 'pen') return h('Couleur du stylo') + grid('penc', pv.pen.c) + h('Épaisseur') + thick('penw', PDF_THICK, pv.pen.w);
        if (t === 'marker') return h('Couleur du marqueur') + grid('mkc', pv.mk.c) + h('Épaisseur') + thick('mkw', PDF_MK_THICK, pv.mk.w);
        if (t === 'eraser') return h('Mode') + `<div class="pdfp-seg">${btn('erm', 'part', pv.er.mode, 'Précision')}${btn('erm', 'all', pv.er.mode, 'Trait entier')}</div>` + h('Taille de la gomme') + `<div class="pdfp-row">${[0.008, 0.016, 0.034].map(w => btn('ers', w, pv.er.size, `<i style="width:${Math.round(w * 400) + 4}px;height:${Math.round(w * 400) + 4}px;border-radius:50%"></i>`, 'th')).join('')}</div>` + sw('erb', 'Revenir à l\'outil précédent après avoir effacé', !!pv.er.back);
        if (t === 'shape') return h('Forme') + `<div class="pdfp-row">${PDF_SHAPES.map(([k, l, d]) => btn('shk', k, pv.sh.k, `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">${d}</svg>`, 'sp').replace('class="', `title="${l}" class="`)).join('')}</div>` + h('Couleur du trait') + grid('shc', pv.sh.c) + h('Épaisseur') + thick('shw', PDF_THICK, pv.sh.w) + h('Remplissage') + `<div class="pdfp-row">${btn('shf', '', pv.sh.f, '∅', 'sw none')}${PDF_COLORS.map(c => btn('shf', c, pv.sh.f, '', 'sw').replace('class="', `style="--c:${c}" class="`)).join('')}</div>`;
        if (t === 'arrow') return h('Type') + `<div class="pdfp-row">${[['a', '→'], ['b', '↔'], ['l', '—']].map(([k, l]) => btn('ark', k, pv.ar.k, l, 'sp')).join('')}</div>` + h('Épaisseur') + thick('arw', PDF_THICK, pv.ar.w) + h('Couleur') + grid('arc', pv.ar.c);
        if (t === 'pick') return `<div class="pdfp-col"><button class="btn btn-soft btn-sm" data-action="pdf-selall" data-s="all">Tout sélectionner (toutes les pages)</button><button class="btn btn-soft btn-sm" data-action="pdf-selall" data-s="page">Tout sélectionner sur cette page</button><p class="small faint" style="margin:6px 0 0">Tire un cadre sur la page pour choisir. Glisse la sélection pour la déplacer · touche Suppr pour tout effacer d'un coup.</p></div>`;
        return '';
    },
    pdfPanelOpen(t, anchor) {
        const pv = this.pv, old = $('#pdf-panel'); if (old) old.remove(); if (!t || !this.pdfPanelHtml(t)) { pv.panel = ''; return; }
        pv.panel = t; const box = document.createElement('div'); box.id = 'pdf-panel'; box.className = 'pdf-panel'; box.innerHTML = this.pdfPanelHtml(t); $('.pdfv').appendChild(box);
        const a = (anchor || $(`.pdft-b[data-t="${t}"]`)); if (!a) return; const r = a.getBoundingClientRect(), v = $('.pdfv').getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
        const pos = this.pdfPrefs().pos; let left = clamp(r.left - v.left, 8, v.width - w - 8), top = r.bottom - v.top + 6;
        if (pos === 'left') { left = r.right - v.left + 8; top = clamp(r.top - v.top, 8, v.height - h - 8); } else if (pos === 'right') { left = r.left - v.left - w - 8; top = clamp(r.top - v.top, 8, v.height - h - 8); } else if (pos === 'bottom' || top + h > v.height - 8) top = Math.max(8, r.top - v.top - h - 6);
        box.style.left = `${left}px`; box.style.top = `${top}px`; box.style.maxHeight = `${v.height - 20}px`;
    },
    pdfPanelClose() { const o = $('#pdf-panel'); if (o) o.remove(); if (this.pv) this.pdfOpts().panel = ''; },
    pdfOptSet(k, v) {
        const pv = this.pdfOpts(), num2 = Number(v);
        ({ hlc: () => { pv.color = v; }, auto: () => { pv.auto = !pv.auto; }, penc: () => { pv.pen.c = v; }, penw: () => { pv.pen.w = num2; }, mkc: () => { pv.mk.c = v; }, mkw: () => { pv.mk.w = num2; },
            erm: () => { pv.er.mode = v; }, ers: () => { pv.er.size = num2; }, erb: () => { pv.er.back = !pv.er.back; }, shk: () => { pv.sh.k = v; }, shc: () => { pv.sh.c = v; }, shw: () => { pv.sh.w = num2; }, shf: () => { pv.sh.f = v; },
            ark: () => { pv.ar.k = v; }, arw: () => { pv.ar.w = num2; }, arc: () => { pv.ar.c = v; } }[k] || (() => {}))();
        const keep = pv.panel, a = $('#pdf-panel'); const left = a && a.style.left, top = a && a.style.top;
        const tools = $('#pdf-tools'); if (tools) tools.innerHTML = this.pdfToolsHtml();
        if (a) { a.innerHTML = this.pdfPanelHtml(keep); a.style.left = left; a.style.top = top; }
    },

    /* ---------- annotations that are shapes / arrows ---------- */
    pdfAnnSvg(a, r) {
        if (a.t === 'sh') { const P = pdfShapePts(a).map(([x, y]) => `${x},${y * r}`).join(' '); return `<polygon class="sh" data-i="${esc(a.i)}" points="${P}" fill="${a.f ? esc(a.f) : 'none'}" stroke="${esc(a.c)}" stroke-width="${a.sw}" stroke-linejoin="round"/>`; }
        if (a.t === 'ar') return `<path class="ar" data-i="${esc(a.i)}" d="${pdfArrowSegs(a, r).map(([A, B]) => `M${A[0]} ${A[1] * r}L${B[0]} ${B[1] * r}`).join('')}" stroke="${esc(a.c)}" stroke-width="${a.w}" fill="none" stroke-linecap="round"/>`;
        return '';
    },
    pdfAnnBox(a, r) {
        if (a.t === 'hl') { const xs = a.r.flatMap(q => [q[0], q[0] + q[2]]), ys = a.r.flatMap(q => [q[1], q[1] + q[3]]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
        if (a.t === 'dr') { const xs = a.p.map(q => q[0]), ys = a.p.map(q => q[1]), m = a.w; return [Math.min(...xs) - m, Math.min(...ys) - m / r, Math.max(...xs) + m, Math.max(...ys) + m / r]; }
        if (a.t === 'sh') return [a.x, a.y, a.x + a.w, a.y + a.h];
        if (a.t === 'ar') return [Math.min(a.x1, a.x2), Math.min(a.y1, a.y2), Math.max(a.x1, a.x2), Math.max(a.y1, a.y2)];
        return [a.x, a.y, a.x + a.w, a.y + 0.04];
    },
    pdfAnnMove(a, dx, dy) {
        if (a.t === 'hl') a.r = a.r.map(q => [q[0] + dx, q[1] + dy, q[2], q[3]]); else if (a.t === 'dr') a.p = a.p.map(q => [q[0] + dx, q[1] + dy]);
        else if (a.t === 'ar') { a.x1 += dx; a.x2 += dx; a.y1 += dy; a.y2 += dy; } else { a.x += dx; a.y += dy; }
        a.m = Date.now();
    },

    /* ---------- the selection ---------- */
    pdfSelCount() { const s = this.pv && this.pv.sel; return s ? Object.values(s).reduce((n, l) => n + l.size, 0) : 0; },
    pdfSelSet(sel) {
        const pv = this.pv; pv.sel = sel && Object.keys(sel).length ? sel : null; pv.pages.forEach(g => { if (g.state === 2) this.pdfDrawAnn(g); });
        const old = $('#pdf-selbar'); if (old) old.remove(); const n = this.pdfSelCount(); if (!n) return;
        const bar = document.createElement('div'); bar.id = 'pdf-selbar'; bar.className = 'pdf-selbar';
        bar.innerHTML = `<b>${plural(n, 'élément')}</b><button data-action="pdf-sel-do" data-d="dup">${ic('copy')}<span>Dupliquer</span></button><button data-action="pdf-sel-do" data-d="del" class="danger">${ic('trash')}<span>Supprimer</span></button><button data-action="pdf-sel-do" data-d="x" aria-label="Désélectionner">${ic('x')}</button>`;
        $('.pdfv').appendChild(bar);
    },
    pdfSelAll(scope) {
        const pv = this.pv, sel = {}; const pids = scope === 'page' ? [pv.p.pg[this.pdfCurrent()].id] : pv.p.pg.map(g => g.id);
        pids.forEach(pid => { const l = (pv.p.ann[pid] || []).filter(a => a.t !== 'tx' && a.t !== 'nt' || true); if (l.length) sel[pid] = new Set(l.map(a => a.i)); });
        if (!Object.keys(sel).length) { this.toast('Aucune annotation à sélectionner.', 'warning'); return; } this.pdfSelSet(sel); this.pdfPanelClose();
    },
    pdfSelDo(d) {
        const pv = this.pv, sel = pv.sel; if (!sel) return;
        if (d === 'x') { this.pdfSelSet(null); return; }
        const items = Object.entries(sel).flatMap(([pid, ids]) => [...ids].map(id => [pid, id]));
        if (d === 'del') { this.pdfEdit(() => items.forEach(([pid, id]) => this.pdfAnnDel(pid, id))); this.pdfSelSet(null); return; }
        if (d === 'dup') { const made = {}; this.pdfEdit(() => items.forEach(([pid, id]) => { const a = this.pdfAnnOf(pid, id); if (!a) return; const c = pdfClone(a); c.i = uid('a'); this.pdfAnnMove(c, 0.02, 0.02); (pv.p.ann[pid] = pv.p.ann[pid] || []).push(normalizePdfAnn(c)); (made[pid] = made[pid] || new Set()).add(c.i); })); this.pdfSelSet(made); }
    },
    /* a gesture on a page with the selection / shape / arrow tools; returns true when it took the gesture */
    pdfShapeDown(e, ov, pgEl, pg, pid, t) {
        const P = this.pv, r = pg.ch / pg.cw, start = this.pdfPt(e, pgEl), svg = $('svg.pdfa', pgEl), NS = 'http://www.w3.org/2000/svg'; e.preventDefault();
        try { ov.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        const live = document.createElementNS(NS, 'g'); svg.appendChild(live);
        if (t === 'shape' || t === 'arrow') {
            let cur = start; const o = P.sh, ar = P.ar;
            const mk = () => t === 'shape' ? { t: 'sh', i: 'tmp', k: o.k, x: Math.min(start[0], cur[0]), y: Math.min(start[1], cur[1]), w: Math.abs(cur[0] - start[0]), h: Math.abs(cur[1] - start[1]), c: o.c, sw: o.w, f: o.f } : { t: 'ar', i: 'tmp', k: ar.k, x1: start[0], y1: start[1], x2: cur[0], y2: cur[1], c: ar.c, w: ar.w };
            const mv = ev => { cur = this.pdfPt(ev, pgEl); if (t === 'shape' && ev.shiftKey) { const s = Math.max(Math.abs(cur[0] - start[0]), Math.abs(cur[1] - start[1]) / r); cur = [start[0] + Math.sign(cur[0] - start[0] || 1) * s, start[1] + Math.sign(cur[1] - start[1] || 1) * s * r]; } const a = mk(); live.innerHTML = a.t === 'sh' ? (a.w > 0.002 ? this.pdfAnnSvg({ ...a, w: Math.max(a.w, 0.003) }, r) : '') : this.pdfAnnSvg(a, r); };
            const up = () => { ov.removeEventListener('pointermove', mv); ov.removeEventListener('pointerup', up); ov.removeEventListener('pointercancel', up); live.remove(); if (this.pv !== P) return; const a = mk(), big = a.t === 'sh' ? a.w > 0.012 && a.h > 0.008 : Math.hypot(a.x2 - a.x1, (a.y2 - a.y1) * r) > 0.02; if (big) { delete a.i; this.pdfEdit(() => this.pdfAnnAdd(pid, a)); } };
            ov.addEventListener('pointermove', mv); ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up); return true;
        }
        if (t === 'pick') {
            const list = P.p.ann[pid] || [], inSel = P.sel && P.sel[pid] && list.some(a => P.sel[pid].has(a.i) && (b => start[0] >= b[0] && start[0] <= b[2] && start[1] >= b[1] && start[1] <= b[3])(this.pdfAnnBox(a, r)));
            if (inSel) {   // drag the selection
                const before = this.pdfSnap(); let last = start, moved = false;
                const mv = ev => { const q = this.pdfPt(ev, pgEl), dx = q[0] - last[0], dy = q[1] - last[1]; last = q; if (Math.abs(dx) + Math.abs(dy) === 0) return; moved = true; Object.entries(P.sel).forEach(([p2, ids]) => (P.p.ann[p2] || []).forEach(a => { if (ids.has(a.i)) this.pdfAnnMove(a, dx, dy); })); P.pages.forEach(g => { if (g.state === 2) this.pdfDrawAnn(g); }); };
                const up = () => { ov.removeEventListener('pointermove', mv); ov.removeEventListener('pointerup', up); ov.removeEventListener('pointercancel', up); live.remove(); if (moved && this.pv === P) this.pdfCommit(before); };
                ov.addEventListener('pointermove', mv); ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up); return true;
            }
            let cur = start; const box = document.createElementNS(NS, 'rect'); box.setAttribute('class', 'pdf-lasso'); live.appendChild(box);
            const rect = () => [Math.min(start[0], cur[0]), Math.min(start[1], cur[1]), Math.max(start[0], cur[0]), Math.max(start[1], cur[1])];
            const mv = ev => { cur = this.pdfPt(ev, pgEl); const q = rect(); box.setAttribute('x', q[0]); box.setAttribute('y', q[1] * r); box.setAttribute('width', q[2] - q[0]); box.setAttribute('height', (q[3] - q[1]) * r); };
            const up = () => {
                ov.removeEventListener('pointermove', mv); ov.removeEventListener('pointerup', up); ov.removeEventListener('pointercancel', up); live.remove(); if (this.pv !== P) return;
                const q = rect(), tap = (q[2] - q[0]) < 0.01 && (q[3] - q[1]) < 0.01, hit = a => { const b = this.pdfAnnBox(a, r); return tap ? start[0] >= b[0] - 0.01 && start[0] <= b[2] + 0.01 && start[1] >= b[1] - 0.01 && start[1] <= b[3] + 0.01 : !(b[2] < q[0] || b[0] > q[2] || b[3] < q[1] || b[1] > q[3]); };
                let ids = list.filter(hit).map(a => a.i); if (tap) ids = ids.slice(-1);
                this.pdfSelSet(ids.length ? { [pid]: new Set(ids) } : null);
            };
            ov.addEventListener('pointermove', mv); ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up); return true;
        }
        live.remove(); return false;
    }
});

Object.assign(SuperAnki.prototype, {
    pdfBindTools() {
        if (document._pdfTools) return; document._pdfTools = true;
        document.addEventListener('pointerdown', e => { if (this.view !== 'pdf' || !this.pv) return; const p = $('#pdf-panel'); if (p && !p.contains(e.target) && !e.target.closest('#pdf-tools')) this.pdfPanelClose(); }, true);
        document.addEventListener('change', e => { const i = e.target.closest && e.target.closest('[data-optin]'); if (!i || !this.pv) return; const v = i.value.trim().replace('#', ''); if (/^[0-9a-f]{6}$/i.test(v)) this.pdfOptSet(i.dataset.optin, '#' + v.toLowerCase()); else this.toast('Code couleur : 6 caractères (ex. 4B73FF).', 'warning'); });
        document.addEventListener('keydown', e => {
            if (this.view !== 'pdf' || !this.pv || this.modals.length) return; const typing = e.target.closest && e.target.closest('input, textarea, [contenteditable], .nb-t'); if (typing) return;
            if ((e.key === 'Delete' || e.key === 'Backspace') && this.pdfSelCount()) { e.preventDefault(); this.pdfSelDo('del'); }
            else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && this.pv.annotate && this.pv.tool === 'pick') { e.preventDefault(); this.pdfSelAll('all'); }
            else if (e.key === 'Escape') { if ($('#pdf-panel')) this.pdfPanelClose(); else if (this.pdfSelCount()) this.pdfSelSet(null); }
        });
    }
});
