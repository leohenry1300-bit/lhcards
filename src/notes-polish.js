/* ============================================================
   Notes / PDF : style de puce, emoji libre, tableaux (largeur/hauteur, couleurs directes), onglets déplaçables,
   liste des documents à gauche aussi dans le lecteur PDF.
   ============================================================ */
const NB_EMOJI_CATS = [
    ['Visages', '😀😃😄😁😆😅😂🤣🙂😉😊😍🥰😘😎🤓🧐🤔🤨😐😴🤯😱😭😤😡🥳🤩😇🤗🫡🤫🤭😬🙄😮‍💨'],
    ['Mains et gens', '👍👎👏🙌🙏💪✍️🤝👀🧠🫶👋🤞✌️👨‍🎓👩‍🎓👨‍💻👩‍💻👨‍🏫👩‍🏫🧑‍⚕️🧑‍🔬🧑‍⚖️'],
    ['Nature', '🐶🐱🦁🐯🐻🐼🦊🐸🐵🐔🦉🦋🐝🐢🐬🐳🌳🌲🌴🌵🌸🌹🌻🍀🍁🌍🌙⭐🌈🔥💧⚡❄️☀️'],
    ['Nourriture', '🍎🍊🍋🍌🍉🍇🍓🍒🥑🥕🌽🍞🧀🍕🍔🍟🌮🍣🍜🍰🍫🍪☕🍵🥤🍷'],
    ['Activités', '⚽🏀🏈🎾🏐🏓🎯🎮🎲🎨🎭🎬🎤🎧🎸🎹🏆🥇🏅🧘🏃🚴🏊'],
    ['Lieux', '🏠🏫🏛️🏥🏢🏦🏭⛪🕌🗼🗽🌉🚗🚌🚆✈️🚀⛵🚲🗺️🏖️⛰️🌋'],
    ['Objets', '📚📖📝✏️🖊️📌📎📁📂🗂️📅📆⏰⏳💡🔍🔬🔭💻⌨️🖥️📱📷🎓🧪🧬🧮⚖️🔧🔨🔑🔒💰💳📈📉📊📣🔔'],
    ['Symboles', '❤️🧡💛💚💙💜🖤🤍💯✅❌⚠️❓❗♻️➕➖➡️⬅️⬆️⬇️🔴🟠🟡🟢🔵🟣⚫⚪🔶🔷💬💭🏷️🚩🎌']
];
Object.assign(SuperAnki.prototype, {
    /* ---------- bullet style of a line (and its neighbours at the same level) ---------- */
    nbBulletStyle(i, st) {
        const n = this.note(this.ui.note), d = n.b[i].d, ok = x => x && (x.t === 'p' || x.t === 'quote' || x.t === 'num') && !x.cd;
        let a = i, z = i;
        while (a > 0 && n.b[a - 1].d >= d && (n.b[a - 1].d > d || ok(n.b[a - 1]))) a--;
        while (z < n.b.length - 1 && n.b[z + 1].d >= d && (n.b[z + 1].d > d || ok(n.b[z + 1]))) z++;
        this.nbOp(() => { for (let j = a; j <= z; j++) { const x = n.b[j]; if (x.d !== d || !ok(x)) continue; if (st === 'num') { x.t = 'num'; delete x.bs; } else { if (x.t === 'num') x.t = 'p'; if (st === 'dot') delete x.bs; else x.bs = st; } } }, i, 'end');
    },

    /* ---------- any emoji for a note ---------- */
    openNoteEmoji() {
        const n = this.note(this.ui.note); if (!n) return;
        const cats = NB_EMOJI_CATS.map(([name, s]) => { const list = (window.Intl && Intl.Segmenter) ? [...new Intl.Segmenter('fr', { granularity: 'grapheme' }).segment(s)].map(x => x.segment) : Array.from(s); return `<h4 class="emo-h">${name}</h4><div class="emoji-grid">${list.map(e => `<button type="button" class="${e === n.emoji ? 'active' : ''}" data-e="${e}" aria-label="${e}">${e}</button>`).join('')}</div>`; }).join('');
        const m = this.openModal({ title: 'Emoji de la note', size: 'narrow', body: `<div class="emo-own"><input class="input" id="emo-in" maxlength="16" placeholder="Tape ou colle n'importe quel emoji" autocomplete="off" inputmode="text" aria-label="Emoji au choix"><button class="btn btn-primary" id="emo-ok">Utiliser</button></div><p class="small faint" style="margin:6px 0 12px">Sur téléphone, ouvre le clavier emoji 🙂 dans ce champ pour tous les choisir.</p><div class="emo-all">${cats}</div><button class="btn btn-soft btn-block" data-e="" style="margin-top:12px">${ic('x')}Aucun emoji</button>` });
        const set = e => { n.emoji = e; this.save(); this.closeModal(m); this.renderNotes(); };
        const first = v => { v = String(v || '').trim(); if (!v) return ''; return (window.Intl && Intl.Segmenter) ? [...new Intl.Segmenter('fr', { granularity: 'grapheme' }).segment(v)][0].segment : Array.from(v)[0]; };
        m.addEventListener('click', e => { const b = e.target.closest('[data-e]'); if (b) set(b.dataset.e); else if (e.target.closest('#emo-ok')) { const v = first($('#emo-in', m).value); if (v) set(v); } });
        $('#emo-in', m).addEventListener('keydown', e => { if (e.key === 'Enter') { const v = first(e.target.value); if (v) set(v); } });
    },

    /* ---------- tables : simple cell tools (bold, colours) ---------- */
    nbTCell(i, what, anchor) {
        const n = this.note(this.ui.note), b = n && n.b[i]; if (!b || b.t !== 'table') return;
        const c = this.nb.cell && this.nb.cell.i === i ? this.nb.cell : { i, r: 0, c: 0 }, key = `${c.r},${c.c}`, W = b.rows[0].length, H = b.rows.length;
        const fmt = fn => this.nbOp(() => { b.cf = b.cf || {}; const z = { ...(b.cf[key] || {}) }; fn(z); if (Object.keys(z).length) b.cf[key] = z; else delete b.cf[key]; }, null);
        if (what === 'bold') { fmt(z => { if (z.b) delete z.b; else z.b = true; }); return; }
        const pick = (title, cur, apply) => setTimeout(() => this.nbColorMenu(anchor, title, hex => this.nbOp(() => { b.fill = b.fill || {}; apply(hex || ''); }, null), cur, true), 30);
        this.nbMenu([{ head: `COULEURS · ligne ${c.r + 1}, colonne ${c.c + 1}` },
            { ico: 'palette', label: 'Fond de la cellule', fn: () => pick('Fond de la cellule', (b.fill || {})[key], h => { if (h) b.fill[key] = h; else delete b.fill[key]; }) },
            { ico: 'typeT', label: 'Couleur du texte de la cellule', fn: () => setTimeout(() => this.colorPicker({ anchor, title: 'Couleur du texte', cur: ((b.cf || {})[key] || {}).c || '', none: true, onPick: hex => fmt(z => { if (hex) z.c = hex; else delete z.c; }) }), 30) },
            { sep: true },
            { ico: 'palette', label: 'Fond de toute la ligne', fn: () => pick('Fond de la ligne', (b.fill || {})[`${c.r},*`], h => { Object.keys(b.fill).filter(z => z.startsWith(`${c.r},`)).forEach(z => delete b.fill[z]); if (h) b.fill[`${c.r},*`] = h; }) },
            { ico: 'palette', label: 'Fond de toute la colonne', fn: () => pick('Fond de la colonne', '', h => { for (let r = 0; r < H; r++) { const k = `${r},${c.c}`; if (h) b.fill[k] = h; else delete b.fill[k]; } }) },
            { ico: 'palette', label: 'Couleur du tableau (traits)', fn: () => setTimeout(() => this.nbColorMenu(anchor, 'Couleur du tableau', k => this.nbOp(() => { b.tc = k || ''; }, null), b.tc, true), 30) },
            { sep: true },
            { ico: 'eraser', label: 'Effacer les couleurs de la cellule', fn: () => this.nbOp(() => { if (b.fill) delete b.fill[key]; if (b.cf && b.cf[key]) { delete b.cf[key].c; if (!Object.keys(b.cf[key]).length) delete b.cf[key]; } }, null) },
            { ico: 'x', label: 'Remettre les largeurs et hauteurs automatiques', fn: () => this.nbOp(() => { delete b.cw; delete b.rh; }, null) }], anchor);
    },

    /* ---------- tabs : drag to reorder ---------- */
    tabsBindDrag() {
        if (document._tabDrag) return; document._tabDrag = true;
        document.addEventListener('pointerdown', e => {
            const t = e.target.closest && e.target.closest('#doc-tabs .dt'); if (!t || e.target.closest('.dt-x') || e.button) return;
            const bar = t.parentElement, touch = e.pointerType !== 'mouse'; let on = false, timer = null, x0 = e.clientX, moved = false;
            const start = () => { on = true; t.classList.add('dragging'); try { t.setPointerCapture(e.pointerId); } catch { /* ignore */ } };
            if (touch) timer = setTimeout(() => { start(); try { navigator.vibrate && navigator.vibrate(8); } catch { /* ignore */ } }, 380); else start();
            const mv = ev => {
                if (!on) { if (touch && Math.abs(ev.clientX - x0) > 8) { clearTimeout(timer); cleanup(); } return; }
                if (Math.abs(ev.clientX - x0) > 4) moved = true; if (!moved) return; ev.preventDefault();
                t.style.transform = `translateX(${ev.clientX - x0}px)`;
                const sibs = [...bar.querySelectorAll('.dt')].filter(s => s !== t);
                for (const s of sibs) { const r = s.getBoundingClientRect(), tr = t.getBoundingClientRect(), mid = tr.left + tr.width / 2; if (mid > r.left && mid < r.right) { const kids = [...bar.children]; bar.insertBefore(t, kids.indexOf(s) > kids.indexOf(t) ? s.nextSibling : s); t.style.transform = ''; x0 = ev.clientX; break; } }
            };
            const cleanup = () => { document.removeEventListener('pointermove', mv, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', up, true); };
            const up = () => {
                clearTimeout(timer); cleanup(); t.classList.remove('dragging'); t.style.transform = '';
                if (on && moved) {
                    const order = [...bar.querySelectorAll('.dt')].map(d => d.dataset.k + '|' + d.dataset.id), cur = this.tabsGet();
                    this._dtabs = order.map(o => cur.find(x => x.k + '|' + x.id === o)).filter(Boolean); this.tabsSave();
                    const kill = ev => { ev.stopPropagation(); ev.preventDefault(); }; t.addEventListener('click', kill, { capture: true, once: true }); setTimeout(() => t.removeEventListener('click', kill, true), 50);
                }
            };
            document.addEventListener('pointermove', mv, true); document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true);
        }, true);
    },

    /* ---------- the list of documents, on the left of the PDF reader as well ---------- */
    pdfDocsToggle(force) {
        const pv = this.pv, v = $('.pdfv'); if (!pv || !v) return;
        const P = this.pdfPrefs(); P.docs = force == null ? !P.docs : !!force; this.pdfPrefSave(); this.pdfDocsApply();
    },
    pdfDocsApply() {
        const v = $('.pdfv'); if (!v) return; const P = this.pdfPrefs(), on = !!P.docs;
        v.classList.toggle('docs-on', on); const b = $('.pdfv-docsbtn'); if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.title = on ? 'Masquer la liste des documents' : 'Afficher la liste des notes et des PDF'; }
        let side = $('#pdf-docs'); if (!on) { if (side) side.remove(); setTimeout(() => this.pdfReflow && this.pdfReflow(), 60); return; }
        if (!side) { side = document.createElement('aside'); side.id = 'pdf-docs'; side.className = 'pdfv-docs'; side.setAttribute('aria-label', 'Mes documents'); $('.pdfv-body').insertBefore(side, $('.pdfv-body').firstChild); }
        side.innerHTML = `<div class="pdfd-head"><b>Mes documents</b><button class="icon-btn icon-btn-sm" data-action="pdf-docs" aria-label="Fermer la liste">${ic('x')}</button></div><div class="nb-tree">${this.noteListHtml()}</div>`;
        setTimeout(() => this.pdfReflow && this.pdfReflow(), 60);
    }
});
(() => {
    const wrap = (name, fn) => { const base = SuperAnki.prototype[name]; SuperAnki.prototype[name] = function (...a) { const r = base.apply(this, a); try { fn.call(this, a); } catch (e) { console.warn(e); } return r; }; };
    wrap('renderPdf', function () {
        const top = $('.pdfv-top'); if (top && !$('.pdfv-docsbtn')) top.insertAdjacentHTML('afterbegin', `<button class="icon-btn pdfv-docsbtn" data-action="pdf-docs" aria-label="Liste des notes et des PDF" title="Afficher la liste des notes et des PDF">${ic('sidebar')}</button>`);
        this.pdfDocsApply(); this.tabsBindDrag();
    });
    wrap('renderNotes', function () { this.tabsBindDrag(); });
    /* resize handles of a table (column width, row height) */
    document.addEventListener('pointerdown', e => {
        const h = e.target.closest && e.target.closest('.nb-cres, .nb-rres'); if (!h || !window.app || !app.ui.note) return;
        const wrap = h.closest('.nb'), i = Number(wrap && wrap.dataset.i), n = app.note(app.ui.note), b = n && n.b[i]; if (!b || b.t !== 'table') return;
        e.preventDefault(); e.stopPropagation(); const table = wrap.querySelector('table'), col = h.classList.contains('nb-cres'), k = Number(h.dataset.k);
        try { h.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        let cg = table.querySelector('colgroup');
        if (col) {
            const first = [...table.rows[0].cells].map(c => Math.round(c.getBoundingClientRect().width));
            if (!cg) { cg = document.createElement('colgroup'); first.forEach(w => { const c = document.createElement('col'); c.style.width = w + 'px'; cg.appendChild(c); }); table.insertBefore(cg, table.firstChild); }
            table.classList.add('fixed'); table.style.width = [...cg.children].reduce((a, c) => a + parseInt(c.style.width, 10), 0) + 'px';
        }
        const x0 = e.clientX, y0 = e.clientY, tr = table.rows[k], w0 = col ? parseInt(cg.children[k].style.width, 10) : 0, h0 = tr ? tr.getBoundingClientRect().height : 0;
        const mv = ev => {
            if (col) { const w = clamp(w0 + ev.clientX - x0, 50, 700); cg.children[k].style.width = w + 'px'; table.style.width = [...cg.children].reduce((a, c) => a + parseInt(c.style.width, 10), 0) + 'px'; }
            else if (tr) tr.style.height = clamp(h0 + ev.clientY - y0, 28, 400) + 'px';
        };
        const up = () => {
            h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
            const cw = col ? [...cg.children].map(c => parseInt(c.style.width, 10)) : null, rh = !col ? [...table.rows].map(r => r.style.height ? parseInt(r.style.height, 10) : 0) : null;
            app.nbOp(() => { if (cw) b.cw = cw; if (rh) b.rh = rh; }, null);
        };
        h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    }, true);
    /* quick open from the « + » of the tabs : create first, then the documents that are not open yet */
    const baseQ = SuperAnki.prototype.quickItems;
    SuperAnki.prototype.quickItems = function (q) {
        if (!this._qTab || q.trim()) return baseQ.call(this, q);
        const d = this.data, open = new Set(this.tabsGet().map(x => x.k + '|' + x.id)), out = [];
        [['Nouvelle note', 'plus', () => this.noteNewFrom(null, {})], ['Note du jour', 'calendar', () => this.noteDaily()], ['Importer un PDF', 'pdf', () => { this.go('notes'); this.pdfPick(''); }]].forEach(a => out.push({ g: 'Créer', ico: a[1], t: a[0], fn: a[2] }));
        const rec = [...d.notes.filter(n => !this.pdfOfNote(n.id)).map(n => ({ k: 'note', id: n.id, mod: n.mod || n.created })), ...d.pdfs.map(p => ({ k: 'pdf', id: p.id, mod: p.mod || p.created }))].filter(r => !open.has(r.k + '|' + r.id)).sort((a, b) => b.mod - a.mod).slice(0, 10);
        rec.forEach(r => out.push(r.k === 'pdf' ? { g: 'À ouvrir (récents)', ico: 'pdf', t: this.pdf(r.id).name, s: this.pdfSubline(this.pdf(r.id)), fn: () => this.pdfOpen(r.id, { from: 'notes' }) } : { g: 'À ouvrir (récents)', ico: 'notebook', t: this.noteName(this.note(r.id)), s: truncate(this.notePathLabel(this.note(r.id)), 60), fn: () => this.noteOpen(r.id) }));
        out.push({ g: 'Voir aussi', ico: 'copy', t: 'Cartes mémoire', fn: () => { this.ui.note = null; this.ui.nbMem = true; this.ui.nbFolder = null; this.tabsAdd('mem'); this.view === 'notes' ? this.renderNotes() : this.go('notes'); } });
        return out;
    };
    const baseO = SuperAnki.prototype.quickOpen;
    SuperAnki.prototype.quickOpen = function (...a) { const r = baseO.apply(this, a); this._qTab = false; return r; };
})();
