/* ============================================================
   Notes : un plan en puces (chaque ligne est un bloc avec une profondeur), des titres, des cases « à faire »,
   des images, des liens [[ ]] vers d'autres notes ou des cartes avec rétroliens, et la note du jour.
   Une note est un document comme un QCM : rangée dans data.notes, sauvegardée, synchronisée (fusion par note),
   mise à la corbeille 30 jours quand on la supprime.
   Bloc : { t: 'p'|'h1'|'h2'|'h3'|'todo'|'quote'|'hr'|'img', x: texte, d: profondeur, done?, src?, c?: replié }
   ============================================================ */
Object.assign(ICONS, {
    notebook: '<path d="M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6z"/><path d="M9 3v18M12.5 8h3.5M12.5 12h3.5"/>'
});
const NB_TYPES = ['p', 'h1', 'h2', 'h3', 'todo', 'quote', 'hr', 'img'], NB_MAX_DEPTH = 6, NB_MAX_BLOCKS = 4000;
const NB_CE = (() => { try { const d = document.createElement('div'); d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true'; } catch { return 'true'; } })();
const NB_LINK = /\[\[([^\[\]\n]{1,160})\]\]/g;

function normalizeNoteBlock(x) {
    if (!x || typeof x !== 'object') return null;
    const t = NB_TYPES.includes(x.t) ? x.t : 'p', b = { t, x: t === 'hr' || t === 'img' ? '' : String(x.x == null ? '' : x.x).replace(/\n+/g, ' ').slice(0, 4000), d: clamp(Math.round(num(x.d, 0)), 0, NB_MAX_DEPTH) };
    if (t === 'todo' && x.done) b.done = true;
    if (t === 'img') { b.src = String(x.src || ''); if (!/^(media:[a-z0-9]+|data:image\/[a-z+.-]+;base64,.+)$/i.test(b.src)) return null; }
    if (x.c) b.c = true;
    return b;
}
function normalizeNote(x) {
    if (!x || typeof x !== 'object') return null;
    const b = toArray(x.b).map(normalizeNoteBlock).filter(Boolean).slice(0, NB_MAX_BLOCKS);
    if (!b.length) b.push({ t: 'p', x: '', d: 0 });
    b[0].d = 0;
    for (let i = 1; i < b.length; i++) b[i].d = Math.min(b[i].d, b[i - 1].d + 1);   // an outline never jumps two levels at once
    return {
        id: String(x.id || uid('n')), title: String(x.title || '').replace(/[\n\[\]]+/g, ' ').trim().slice(0, 120), deckId: x.deckId ? String(x.deckId) : '',
        b, daily: /^\d{4}-\d{2}-\d{2}$/.test(String(x.daily || '')) ? String(x.daily) : '', fav: !!x.fav, created: num(x.created, 0), mod: num(x.mod, 0)
    };
}
const noteSig = n => JSON.stringify([n.title, n.deckId, n.b, n.daily, n.fav]);
const noteText = n => n.b.map(b => b.x).join('\n');
const nbEmpty = () => ({ t: 'p', x: '', d: 0 });

Object.assign(SuperAnki.prototype, {
    /* ---------- finding things ---------- */
    note(id) { return id && this.data.notes.find(n => n.id === id) || null; },
    noteName(n) { return n.title || 'Sans titre'; },
    noteByTitle(t) { const k = fold(String(t).trim()); return k ? this.data.notes.find(n => n.title && fold(n.title) === k) || null : null; },
    /* what a note points to: [[Titre]] → { k:'note', t }, [[c:ID|texte]] → { k:'card', id } */
    noteLinks(n) {
        const out = [];
        n.b.forEach(b => { String(b.x).replace(NB_LINK, (m, inner) => { const c = /^c:([^|]+)\|/.exec(inner); out.push(c ? { k: 'card', id: c[1] } : { k: 'note', t: inner.trim() }); return m; }); });
        return out;
    },
    /* backlinks: the other notes that cite this one */
    noteBacklinks(n) {
        const me = n.title ? fold(n.title) : null;
        if (!me) return [];
        return this.data.notes.filter(o => o.id !== n.id && this.noteLinks(o).some(l => l.k === 'note' && fold(l.t) === me));
    },
    notesLinkingCard(cardId) { return this.data.notes.filter(o => this.noteLinks(o).some(l => l.k === 'card' && l.id === cardId)); },
    dailyTitle(key) { const [y, m, d] = key.split('-').map(Number); const s = new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); },
    inlineHtml(x) {
        return esc(x).replace(/\[\[([^\[\]\n]{1,160})\]\]/g, (m, inner) => {
            const c = /^c:([^|]+)\|(.*)$/.exec(inner);
            if (c) { const card = this.card(c[1]); return `<a class="nb-link card ${card ? '' : 'miss'}" data-nbc="${c[1]}">${ic('card')}${c[2] || (card ? esc(truncate(stripHtml(card.front), 40)) : 'carte supprimée')}</a>`; }
            const hit = this.noteByTitle(inner);
            return `<a class="nb-link ${hit ? '' : 'miss'}" data-nbt="${inner}">${inner}</a>`;
        });
    },

    /* ---------- creating, opening, deleting ---------- */
    noteNew(title = '', opts = {}) {
        const n = normalizeNote({ id: uid('n'), title, b: [nbEmpty()], created: Date.now(), deckId: opts.deckId || '', daily: opts.daily || '' });
        this.data.notes.push(n); this.save();
        return n;
    },
    noteOpen(id, { push = true, focus = '' } = {}) {
        const n = this.note(id); if (!n) return;
        if (push && this.ui.note && this.ui.note !== id) (this.nb ? this.nb.back : (this.nb = { back: [] }).back).push(this.ui.note);
        this.nbIdle(true);
        this.ui.note = id; this.nb = Object.assign(this.nb || { back: [] }, { hist: [], redo: [], active: -1, burst: 0 });
        if (this.view !== 'notes') this.go('notes'); else this.renderNotes();
        if (focus === 'title') setTimeout(() => { const t = $('#nb-title'); if (t) t.focus(); }, 80);
        else if (focus === 'end') setTimeout(() => { const nn = this.note(id); if (nn) this.nbActivate(this.nbLastText(nn), 'end'); }, 80);
    },
    nbLastText(n) { for (let i = n.b.length - 1; i >= 0; i--) if (n.b[i].t !== 'hr' && n.b[i].t !== 'img') return i; return 0; },
    noteDaily() {
        const key = dayKey();
        let n = this.data.notes.find(x => x.daily === key);
        if (!n) n = this.noteNew(this.dailyTitle(key), { daily: key });
        this.noteOpen(n.id, { focus: 'end' });
    },
    noteDelete(id) {
        const n = this.note(id); if (!n) return;
        this.nbIdle(true);
        this.data.notes = this.data.notes.filter(x => x.id !== id);
        this.save();
        this.ui.note = null; if (this.nb) this.nb.back = [];
        this.renderNotes();
        this.toast('Note supprimée', 'success', ic('trash'), { label: 'Annuler', fn: () => { this.trashRestore('note', id); this.noteOpen(id, { push: false }); } });
    },
    /* renaming a note keeps the [[links]] to it working */
    noteRename(n, title) {
        title = String(title).replace(/[\n\[\]]+/g, ' ').trim().slice(0, 120);
        const old = n.title; if (title === old) return;
        n.title = title;
        if (old) {
            const k = fold(old);
            this.data.notes.forEach(o => o.b.forEach(b => { if (b.x.includes('[[')) b.x = b.x.replace(NB_LINK, (m, inner) => (!/^c:/.test(inner) && fold(inner.trim()) === k ? (title ? `[[${title}]]` : inner) : m)); }));
        }
        this.save();
    },
    noteAsText(n) {
        return [`# ${this.noteName(n)}`, ...n.b.map(b => {
            const pad = '  '.repeat(b.d), x = b.x;
            return b.t === 'h1' ? `${pad}# ${x}` : b.t === 'h2' ? `${pad}## ${x}` : b.t === 'h3' ? `${pad}### ${x}` : b.t === 'todo' ? `${pad}- [${b.done ? 'x' : ' '}] ${x}` : b.t === 'quote' ? `${pad}> ${x}` : b.t === 'hr' ? `${pad}---` : b.t === 'img' ? `${pad}[image]` : `${pad}- ${x}`;
        })].join('\n');
    },

    /* ---------- screen ---------- */
    noteListHtml() {
        const q = fold((this.ui.noteQ || '').trim()), fav = this.ui.noteFav;
        let list = this.data.notes.slice().sort((a, b) => b.mod - a.mod || b.created - a.created);
        if (fav) list = list.filter(n => n.fav);
        if (q) list = list.filter(n => fold(n.title).includes(q) || fold(noteText(n)).includes(q));
        if (!list.length) return `<p class="small faint" style="padding:14px 4px">${q ? 'Aucune note ne correspond.' : fav ? 'Aucune note favorite.' : 'Aucune note pour l\'instant. Crée la première ou ouvre la note du jour.'}</p>`;
        return list.map(n => {
            const first = n.b.find(b => b.x && b.t !== 'hr'), when = new Date(n.mod || n.created).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
            return `<button class="nb-row ${n.id === this.ui.note ? 'on' : ''}" data-action="nb-open" data-id="${esc(n.id)}"><span class="nb-row-ico">${ic(n.daily ? 'calendar' : 'notebook')}</span><span class="nb-row-t"><b>${esc(this.noteName(n))}</b><small>${esc(truncate(first ? first.x : 'Note vide', 80))}</small></span><span class="nb-row-d">${n.fav ? ic('star', 'i-fill') : ''}<small>${when}</small></span></button>`;
        }).join('');
    },
    renderNotes() {
        const ui = this.ui, n = this.note(ui.note);
        if (ui.note && !n) ui.note = null;
        $('#view-notes').innerHTML = `
        <div class="notes-shell ${n ? 'has-open' : ''}">
            <aside class="notes-side panel">
                <div class="notes-side-head"><h2 class="page-title" style="margin:0">Notes</h2>
                    <span class="row-gap"><button class="btn btn-soft btn-sm" data-action="nb-daily" title="Ouvre la note d'aujourd'hui (le jour change à 4 h)">${ic('calendar')}<span>Note du jour</span></button><button class="btn btn-primary btn-sm" data-action="nb-new">${ic('plus')}<span>Nouvelle</span></button></span></div>
                <label class="input-icon" style="display:block;margin:10px 0 8px">${ic('search')}<input class="input" id="nb-search" type="search" placeholder="Chercher dans les notes…" value="${esc(ui.noteQ || '')}" autocomplete="off" enterkeyhint="search"></label>
                <div class="chip-row" style="margin-bottom:6px"><button class="chip ${ui.noteFav ? '' : 'active'}" data-action="nb-fav-filter" data-on="0">Toutes <span class="count">${this.data.notes.length}</span></button><button class="chip ${ui.noteFav ? 'active' : ''}" data-action="nb-fav-filter" data-on="1">${ic('star', 'i-fill')} Favorites <span class="count">${this.data.notes.filter(x => x.fav).length}</span></button></div>
                <div id="nb-list">${this.noteListHtml()}</div>
            </aside>
            <section class="notes-main">${n ? this.noteEditorHtml(n) : `<div class="panel panel-pad nb-empty">${ic('notebook')}<h3>Tes notes</h3><p class="muted">Un plan en puces pour tes cours. Tape <code>[[</code> pour lier une note ou une carte.</p><div class="row-gap" style="justify-content:center"><button class="btn btn-primary" data-action="nb-new">${ic('plus')}Nouvelle note</button><button class="btn btn-soft" data-action="nb-daily">${ic('calendar')}Note du jour</button></div></div>`}</section>
        </div>`;
        this.nbBind(); this.nbBarEnsure(!!n);
        if (n) this.resolveMedia($('#nb-blocks'));
    },
    nbRefreshList() { const l = $('#nb-list'); if (l) l.innerHTML = this.noteListHtml(); },
    noteEditorHtml(n) {
        const back = this.nb && this.nb.back.length ? this.note(this.nb.back[this.nb.back.length - 1]) : null, bl = this.noteBacklinks(n);
        return `<div class="panel nb-editor" data-id="${esc(n.id)}">
            <div class="nb-head">
                <button class="icon-btn" data-action="nb-close" title="${back ? `Retour à « ${esc(this.noteName(back))} »` : 'Retour à la liste'}" aria-label="Retour">${ic('arrowLeft')}</button>
                <input class="nb-title" id="nb-title" maxlength="120" placeholder="Titre de la note" value="${esc(n.title)}" autocomplete="off" enterkeyhint="next">
                <button class="icon-btn ${n.fav ? 'nb-fav on' : 'nb-fav'}" data-action="nb-fav" title="Favori" aria-label="Favori">${ic('star', n.fav ? 'i-fill' : '')}</button>
                <button class="icon-btn" data-action="nb-more" title="Plus d'actions" aria-label="Plus d'actions">${ic('more')}</button>
            </div>
            ${n.daily ? `<p class="small faint" style="margin:-4px 0 8px">${ic('calendar')} Note du jour</p>` : ''}
            <div class="nb-blocks" id="nb-blocks">${this.nbBlocksHtml(n)}</div>
            <div class="nb-back" id="nb-backlinks">${this.nbBacklinksHtml(n, bl)}</div>
        </div>`;
    },
    /* the bar lives on the page itself (never inside an animated or blurred panel) so it can follow the keyboard */
    nbBarEnsure(open) {
        let bar = $('#nb-bar');
        if (!open) { if (bar) bar.remove(); document.body.classList.remove('nb-open', 'nb-editing'); return; }
        if (!bar) document.body.insertAdjacentHTML('beforeend', `<div class="nb-bar" id="nb-bar" role="toolbar" aria-label="Mise en forme">
    <button data-nb="out" title="Remonter d'un niveau" aria-label="Remonter d'un niveau">${ic('chevronLeft')}</button>
    <button data-nb="in" title="Descendre d'un niveau" aria-label="Descendre d'un niveau">${ic('chevronRight')}</button>
    <span class="nb-sep"></span>
    <button data-nb="head" title="Titre" aria-label="Titre"><b>Titre</b></button>
    <button data-nb="todo" title="À faire (case à cocher)" aria-label="À faire">${ic('checkSq')}</button>
    <button data-nb="img" title="Image" aria-label="Image">${ic('image')}</button>
    <button data-nb="plus" title="Plus : citation, séparateur, lien [[ ]]" aria-label="Plus">${ic('plus')}</button>
    <span class="nb-sep"></span>
    <button data-nb="undo" title="Annuler" aria-label="Annuler">${ic('undo')}</button>
</div>`);
        document.body.classList.add('nb-open'); this.nbPlaceBar();
    },
    nbBacklinksHtml(n, bl) {
        if (!bl.length) return '';
        return `<h4>Cité dans ${plural(bl.length, 'note')}</h4>${bl.map(o => `<button class="nb-bl" data-action="nb-open" data-id="${esc(o.id)}">${ic(o.daily ? 'calendar' : 'notebook')}<span><b>${esc(this.noteName(o))}</b><small>${esc(truncate((o.b.find(b => b.x.toLowerCase().includes('[[' + n.title.toLowerCase())) || o.b[0]).x.replace(NB_LINK, (m, i) => i.replace(/^c:[^|]+\|/, '')), 90))}</small></span></button>`).join('')}`;
    },
    nbHidden(b) {   // which blocks are hidden because an ancestor is folded
        const hide = new Array(b.length).fill(false);
        for (let i = 0; i < b.length; i++) if (b[i].c) { for (let j = i + 1; j < b.length && b[j].d > b[i].d; j++) hide[j] = true; }
        return hide;
    },
    nbHasKids(b, i) { return !!b[i + 1] && b[i + 1].d > b[i].d; },
    nbBlockHtml(n, i, hide) {
        const b = n.b[i], kids = this.nbHasKids(n.b, i);
        const gut = b.t === 'todo' ? `<button class="nb-chk ${b.done ? 'on' : ''}" data-nbk="chk" aria-label="${b.done ? 'Décocher' : 'Cocher'}" aria-pressed="${!!b.done}">${b.done ? ic('check') : ''}</button>`
            : b.t === 'p' || b.t === 'quote' ? `<button class="nb-bul ${kids ? 'kids' : ''} ${b.c ? 'fold' : ''}" data-nbk="bul" aria-label="${kids ? (b.c ? 'Déplier' : 'Replier') : 'Puce'}"><i></i></button>` : '<span class="nb-nogut"></span>';
        const body = b.t === 'hr' ? '<hr class="nb-hr">' : b.t === 'img' ? `<figure class="nb-img"><img src="${esc(b.src)}" alt=""><button class="icon-btn icon-btn-sm nb-img-x" data-nbk="imgx" aria-label="Retirer l'image">${ic('x')}</button></figure>`
            : `<div class="nb-view">${this.inlineHtml(b.x)}</div><div class="nb-t" contenteditable="${NB_CE}" role="textbox" aria-multiline="false" spellcheck="true" autocapitalize="sentences"></div>`;
        return `<div class="nb nb-${b.t} ${b.done ? 'done' : ''} ${hide[i] ? 'hid' : ''}" data-i="${i}" style="--d:${b.d}">${gut}<div class="nb-body">${body}</div></div>`;
    },
    nbBlocksHtml(n) { const hide = this.nbHidden(n.b); return n.b.map((_, i) => this.nbBlockHtml(n, i, hide)).join('') + `<div class="nb-tail" data-nbk="tail"></div>`; },
    /* redraws the blocks (after a structure change), then puts the cursor back */
    nbRender(focusI, pos) {
        const n = this.note(this.ui.note), box = $('#nb-blocks'); if (!n || !box) return;
        this.nb.active = -1;
        box.innerHTML = this.nbBlocksHtml(n); this.resolveMedia(box);
        if (focusI != null && focusI >= 0) this.nbActivate(focusI, pos == null ? 'end' : pos);
    },
    nbVisible(n) { const hide = this.nbHidden(n.b); return n.b.map((_, i) => i).filter(i => !hide[i] && n.b[i].t !== 'hr' && n.b[i].t !== 'img'); },

    /* ---------- one block being typed in ---------- */
    nbEl(i) { return $(`#nb-blocks .nb[data-i="${i}"]`); },
    nbActivate(i, pos = 'end') {
        const n = this.note(this.ui.note); if (!n || !n.b[i] || n.b[i].t === 'hr' || n.b[i].t === 'img') return;
        this.nbDeactivate();
        const row = this.nbEl(i); if (!row) return;
        const t = $('.nb-t', row); if (!t) return;
        row.classList.add('on'); this.nb.active = i;
        t.textContent = n.b[i].x;
        t.focus({ preventScroll: true });
        this.nbSetCaret(t, pos === 'end' ? n.b[i].x.length : pos === 'start' ? 0 : pos);
        document.body.classList.add('nb-editing');
        this.nbPlaceBar();
        row.scrollIntoView({ block: 'nearest' });
    },
    nbDeactivate() {
        const i = this.nb && this.nb.active; if (i == null || i < 0) return;
        const row = this.nbEl(i), n = this.note(this.ui.note);
        if (row && n && n.b[i]) { row.classList.remove('on'); const v = $('.nb-view', row); if (v) v.innerHTML = this.inlineHtml(n.b[i].x); }
        this.nb.active = -1; this.nbSuggestClose();
    },
    /* leave the editor: used when the focus really goes away */
    nbIdle(force = false) {
        if (!this.nb) return;
        if (!force) { const a = document.activeElement; if (a && a.closest && a.closest('.nb-t, .nb-bar, .nb-suggest, .nb-menu, #nb-title')) return; }
        this.nbDeactivate(); this.nbMenuClose(); document.body.classList.remove('nb-editing');
        clearTimeout(this.nb.saveT); this.nbFlush();
    },
    nbCaret(el) {
        const sel = getSelection(); if (!sel.rangeCount || !el.contains(sel.anchorNode)) return { s: 0, e: 0 };
        const r = sel.getRangeAt(0), a = document.createRange(); a.selectNodeContents(el); a.setEnd(r.startContainer, r.startOffset);
        const s = a.toString().length; return { s, e: s + r.toString().length };
    },
    nbSetCaret(el, pos) {
        const sel = getSelection(), r = document.createRange(), tn = el.firstChild;
        if (!tn) { r.selectNodeContents(el); r.collapse(true); } else { r.setStart(tn, clamp(pos, 0, tn.length)); r.collapse(true); }
        sel.removeAllRanges(); sel.addRange(r);
    },
    /* history for « Annuler » (a burst of typing counts as one step) */
    nbPush(force = true) {
        const n = this.note(this.ui.note); if (!n) return;
        const snap = JSON.stringify(n.b), h = this.nb.hist;
        if (h.length && h[h.length - 1].b === snap) return;
        h.push({ b: snap, i: this.nb.active }); if (h.length > 120) h.shift();
        this.nb.redo = [];
    },
    nbUndo(redo = false) {
        const n = this.note(this.ui.note); if (!n) return;
        const from = redo ? this.nb.redo : this.nb.hist, to = redo ? this.nb.hist : this.nb.redo;
        const e = from.pop(); if (!e) { this.toast(redo ? 'Rien à rétablir' : 'Rien à annuler', 'warning'); return; }
        to.push({ b: JSON.stringify(n.b), i: this.nb.active });
        n.b = JSON.parse(e.b); this.nb.burst = 0;
        this.nbSaveSoon(0); this.nbRender(Math.min(e.i == null ? n.b.length - 1 : e.i, n.b.length - 1), 'end');
    },
    nbSaveSoon(ms = 450) {
        clearTimeout(this.nb.saveT);
        this.nb.saveT = setTimeout(() => this.nbFlush(), ms);
    },
    nbFlush() {
        const n = this.note(this.ui.note); if (!n) return;
        if (this.nb.dirty !== false) { this.save(); this.nb.dirty = false; }
        this.nbRefreshList();
        const bl = $('#nb-backlinks'); if (bl) bl.innerHTML = this.nbBacklinksHtml(n, this.noteBacklinks(n));
    },
    nbChanged() { this.nb.dirty = true; this.nbSaveSoon(); },
    /* a structure change: save a step for « Annuler », do it, redraw */
    nbOp(fn, focusI, pos) {
        const n = this.note(this.ui.note); if (!n) return;
        this.nbPush(); fn(n);
        n.b[0].d = 0; for (let k = 1; k < n.b.length; k++) n.b[k].d = Math.min(n.b[k].d, n.b[k - 1].d + 1);
        this.nb.burst = 0; this.nbChanged(); this.nbRender(focusI, pos);
    },
    nbSubEnd(b, i) { let j = i + 1; while (j < b.length && b[j].d > b[i].d) j++; return j; },
    nbIndent(i, dir) {
        const n = this.note(this.ui.note), b = n.b[i]; if (!b || (dir > 0 && (i === 0 || b.d > n.b[i - 1].d)) || (dir < 0 && b.d === 0)) return;
        if (dir > 0 && b.d >= NB_MAX_DEPTH) return;
        const pos = this.nb.active === i ? this.nbCaret($('.nb-t', this.nbEl(i))).s : 'end';
        this.nbOp(nn => { const end = this.nbSubEnd(nn.b, i); for (let k = i; k < end; k++) nn.b[k].d = clamp(nn.b[k].d + dir, 0, NB_MAX_DEPTH); }, i, pos);
    },
    nbSplit(i) {
        const n = this.note(this.ui.note), b = n.b[i], t = $('.nb-t', this.nbEl(i)), pos = this.nbCaret(t).s;
        if (!b.x && b.t !== 'p') { this.nbOp(() => { b.t = 'p'; delete b.done; }, i, 0); return; }
        if (!b.x && b.d > 0) { this.nbIndent(i, -1); return; }
        const left = b.x.slice(0, pos), right = b.x.slice(pos);
        this.nbOp(nn => {
            b.x = left;
            const at = b.c ? this.nbSubEnd(nn.b, i) : i + 1;
            nn.b.splice(at, 0, { t: b.t === 'todo' ? 'todo' : 'p', x: right, d: b.d });
        }, (b.c ? this.nbSubEnd(n.b, i) : i + 1), 0);
    },
    nbBackspace(i) {
        const n = this.note(this.ui.note), b = n.b[i];
        if (b.t !== 'p') { this.nbOp(() => { b.t = 'p'; delete b.done; }, i, 0); return true; }
        if (b.d > 0) { this.nbIndent(i, -1); return true; }
        if (i === 0) return false;
        const prev = n.b[i - 1];
        if (prev.t === 'hr' || prev.t === 'img') { this.nbOp(nn => { nn.b.splice(i - 1, 1); }, i - 1, 0); return true; }
        const join = prev.x.length;
        this.nbOp(nn => { prev.x += b.x; nn.b.splice(i, 1); }, i - 1, join);
        return true;
    },
    nbInsertAfter(i, blocks, focusLast = true) {
        const n = this.note(this.ui.note), b = n.b[i], d = b ? b.d : 0;
        const at = (b && !b.x && b.t === 'p' && blocks[0].t === 'img') ? i : i + 1, replace = at === i;
        this.nbOp(nn => { nn.b.splice(at, replace ? 1 : 0, ...blocks.map(x => ({ d, ...x }))); }, focusLast ? at + blocks.length - 1 : null, 0);
    },
    /* a paste of several lines becomes several blocks (a "- " or a tab shows the level) */
    nbPaste(i, text) {
        const lines = String(text).replace(/\r/g, '').split('\n').filter(l => l.trim());
        const n = this.note(this.ui.note), b = n.b[i], t = $('.nb-t', this.nbEl(i));
        if (lines.length <= 1) { document.execCommand('insertText', false, (lines[0] || '').replace(/\s+/g, ' ')); return; }
        const pos = this.nbCaret(t), base = b.d;
        const parsed = lines.map(l => { const m = /^(\s*)([-*•]\s+|\d+[.)]\s+|#{1,3}\s+|>\s+)?(.*)$/.exec(l); const lead = m[1].replace(/\t/g, '  ').length, mk = (m[2] || '').trim(); const t2 = /^#{1,3}$/.test(mk) ? 'h' + mk.length : mk === '>' ? 'quote' : 'p'; return { d: Math.floor(lead / 2), t: t2, x: m[3].trim() }; });
        const min = Math.min(...parsed.map(p => p.d));
        this.nbOp(nn => {
            const tail = b.x.slice(pos.e); b.x = b.x.slice(0, pos.s) + parsed[0].x;
            const rest = parsed.slice(1).map(p => ({ t: p.t, x: p.x, d: clamp(base + p.d - min, 0, NB_MAX_DEPTH) }));
            if (tail) rest.push({ t: 'p', x: tail, d: base });
            nn.b.splice(i + 1, 0, ...rest.slice(0, NB_MAX_BLOCKS));
        }, i + parsed.length - 1, 'end');
    },
    /* Markdown shortcuts at the start of a line: "# " title, "[] " to do, "> " quote, "---" separator */
    nbShortcut(i, t) {
        const n = this.note(this.ui.note), b = n.b[i]; if (b.t !== 'p') return false;
        const m = /^(#{1,3}|\[\s?\]|>|[-*•])\s/.exec(b.x); if (!m) return false;
        const k = m[1], rest = b.x.slice(m[0].length);
        const type = /^#/.test(k) ? 'h' + k.length : /^\[/.test(k) ? 'todo' : k === '>' ? 'quote' : 'p';
        this.nbOp(() => { b.t = type; b.x = rest; }, i, 0); return true;
    },

    /* ---------- [[ autocomplete ---------- */
    nbSuggestCheck(t) {
        const pos = this.nbCaret(t).s, before = t.textContent.slice(0, pos), m = /\[\[([^\[\]\n]*)$/.exec(before);
        if (!m) { this.nbSuggestClose(); return; }
        const q = fold(m[1].trim()), items = [];
        this.data.notes.filter(x => x.id !== this.ui.note && x.title && (!q || fold(x.title).includes(q))).sort((a, b) => b.mod - a.mod).slice(0, 4).forEach(x => items.push({ k: 'note', label: x.title, ins: x.title, ico: x.daily ? 'calendar' : 'notebook' }));
        if (q) this.data.cards.filter(c => fold(stripHtml(c.front)).includes(q)).slice(0, 3).forEach(c => items.push({ k: 'card', label: truncate(stripHtml(c.front), 50), ins: `c:${c.id}|${truncate(stripHtml(c.front), 40).replace(/[\[\]|]/g, ' ')}`, ico: 'card' }));
        const typed = m[1].trim();
        if (typed && !this.noteByTitle(typed)) items.push({ k: 'new', label: `Créer « ${typed} »`, ins: typed, ico: 'plus' });
        if (!items.length) { this.nbSuggestClose(); return; }
        this.nb.sug = { items, start: pos - m[1].length, end: pos, i: this.nb.active };
        let box = $('.nb-suggest'); if (!box) { box = document.createElement('div'); box.className = 'nb-suggest'; document.body.appendChild(box); }
        box.innerHTML = items.map((x, k) => `<button data-sug="${k}">${ic(x.ico)}<span>${esc(x.label)}</span><small>${x.k === 'note' ? 'note' : x.k === 'card' ? 'carte' : 'nouvelle'}</small></button>`).join('');
        this.nbPlaceBar();
    },
    nbSuggestClose() { const b = $('.nb-suggest'); if (b) b.remove(); if (this.nb) this.nb.sug = null; },
    nbSuggestPick(k) {
        const s = this.nb.sug, it = s && s.items[k]; if (!it) return;
        const n = this.note(this.ui.note), b = n.b[s.i];
        if (it.k === 'new' && !this.noteByTitle(it.ins)) this.noteNew(it.ins);
        const after = b.x.slice(s.end).replace(/^\]\]/, '');
        this.nbPush();
        b.x = b.x.slice(0, s.start) + it.ins + ']]' + after;
        const row = this.nbEl(s.i), t = $('.nb-t', row), caret = s.start + it.ins.length + 2;
        t.textContent = b.x; this.nbSetCaret(t, caret); this.nbSuggestClose(); this.nbChanged(); t.focus();
    },

    /* ---------- the floating bar (always above the phone keyboard) ---------- */
    nbPlaceBar() {
        const bar = $('#nb-bar'); if (!bar) return;
        const vv = window.visualViewport, y = vv ? vv.offsetTop + vv.height : innerHeight;
        bar.style.setProperty('--nb-y', `${Math.max(0, y - bar.offsetHeight)}px`);
        const sg = $('.nb-suggest'); if (sg) { sg.style.left = '8px'; sg.style.right = '8px'; sg.style.bottom = `${Math.max(0, innerHeight - (y - bar.offsetHeight)) + 6}px`; }
        const mn = $('.nb-menu'); if (mn) mn.style.bottom = `${Math.max(0, innerHeight - (y - bar.offsetHeight)) + 6}px`;
    },
    nbMenuClose() { const m = $('.nb-menu'); if (m) m.remove(); },
    nbMenu(items, anchor) {
        this.nbMenuClose();
        const m = document.createElement('div'); m.className = 'nb-menu';
        m.innerHTML = items.map((x, k) => `<button data-mn="${k}" ${x.on ? 'class="on"' : ''}>${x.ico ? ic(x.ico) : ''}<span>${x.label}</span></button>`).join('');
        m.addEventListener('pointerdown', e => e.preventDefault());
        m.addEventListener('click', e => { const b = e.target.closest('[data-mn]'); if (!b) return; this.nbMenuClose(); items[Number(b.dataset.mn)].fn(); });
        document.body.appendChild(m); this.nbPlaceBar();
    },
    nbCurrent() { const n = this.note(this.ui.note); if (!n) return null; let i = this.nb.active; if (i < 0 || !n.b[i]) i = this.nb.last != null && n.b[this.nb.last] ? this.nb.last : this.nbLastText(n); return { n, i, b: n.b[i] }; },
    nbBar(act) {
        const c = this.nbCurrent(); if (!c) return;
        const { n, i, b } = c;
        if (act === 'out') this.nbIndent(i, -1);
        else if (act === 'in') this.nbIndent(i, 1);
        else if (act === 'undo') this.nbUndo();
        else if (act === 'todo') this.nbOp(() => { if (b.t === 'todo') { b.t = 'p'; delete b.done; } else if (b.t !== 'hr' && b.t !== 'img') b.t = 'todo'; }, i, 'end');
        else if (act === 'head') this.nbMenu([['p', 'Texte'], ['h1', 'Titre 1'], ['h2', 'Titre 2'], ['h3', 'Titre 3']].map(([t, label]) => ({ label, on: b.t === t, fn: () => this.nbOp(() => { b.t = t; delete b.done; }, i, 'end') })));
        else if (act === 'plus') this.nbMenu([
            { ico: 'link', label: 'Lien [[ ]] vers une note ou une carte', fn: () => { this.nbActivate(i, 'end'); document.execCommand('insertText', false, '[['); const t = $('.nb-t', this.nbEl(i)); this.nbSuggestCheck(t); this.nbPlaceBar(); } },
            { ico: 'file', label: b.t === 'quote' ? 'Retirer la citation' : 'Citation', fn: () => this.nbOp(() => { b.t = b.t === 'quote' ? 'p' : 'quote'; }, i, 'end') },
            { ico: 'list', label: 'Séparateur', fn: () => this.nbInsertAfter(i, [{ t: 'hr' }, { t: 'p', x: '' }]) }
        ]);
        else if (act === 'img') this.nbPickImage(i);
    },
    nbPickImage(i) {
        const input = $('#hidden-file'); input.accept = 'image/*'; input.value = '';
        input.onchange = async () => {
            const f = input.files[0]; if (!f) return;
            if (!f.type.startsWith('image/')) { this.toast('Ce fichier n\'est pas une image.', 'warning'); return; }
            try { const ref = this.addMedia(await this.compressImage(f)); this.nbInsertAfter(Math.min(i, this.note(this.ui.note).b.length - 1), [{ t: 'img', src: ref }, { t: 'p', x: '' }]); this.toast('Image ajoutée', 'success', ic('image')); }
            catch { this.toast('Impossible de lire cette image.', 'error'); }
        };
        input.click();
    },

    /* ---------- events ---------- */
    nbBind() {
        const root = $('#view-notes');
        if (root._nb) return; root._nb = true;
        const blocks = () => $('#nb-blocks');
        const idx = el => { const r = el.closest('.nb'); return r ? Number(r.dataset.i) : -1; };
        root.addEventListener('click', e => {
            const n = this.note(this.ui.note); if (!n) return;
            const k = e.target.closest('[data-nbk]'), row = e.target.closest('.nb'), sug = e.target.closest('[data-sug]');
            const link = e.target.closest('.nb-link');
            if (link && !link.closest('.nb-t')) {
                e.preventDefault();
                if (link.dataset.nbc) { if (this.card(link.dataset.nbc)) this.openCardModal(link.dataset.nbc); else this.toast('Cette carte n\'existe plus.', 'warning'); }
                else { const hit = this.noteByTitle(link.dataset.nbt); this.noteOpen((hit || this.noteNew(link.dataset.nbt)).id, { focus: hit ? '' : 'end' }); }
                return;
            }
            if (!k && !row) return;
            const i = row ? Number(row.dataset.i) : n.b.length - 1, b = n.b[i], kind = k ? k.dataset.nbk : 'row';
            if (kind === 'chk') { this.nbPush(); b.done = !b.done; this.nbChanged(); row.classList.toggle('done', b.done); k.classList.toggle('on', b.done); k.innerHTML = b.done ? ic('check') : ''; k.setAttribute('aria-pressed', String(b.done)); }
            else if (kind === 'bul') { if (this.nbHasKids(n.b, i)) { this.nbPush(); b.c = !b.c; this.nbChanged(); this.nbRender(); } else this.nbActivate(i, 'end'); }
            else if (kind === 'imgx') { this.nbOp(nn => { nn.b.splice(i, 1); if (!nn.b.length) nn.b.push(nbEmpty()); }, null); }
            else if (kind === 'tail') { const last = n.b[n.b.length - 1]; if (last.t === 'p' && !last.x) this.nbActivate(n.b.length - 1, 'end'); else if (last.t === 'hr' || last.t === 'img' || last.x) this.nbOp(nn => { nn.b.push({ t: 'p', x: '', d: 0 }); }, n.b.length); else this.nbActivate(n.b.length - 1, 'end'); }
            else if (b && b.t !== 'hr' && b.t !== 'img' && !e.target.closest('.nb-t')) this.nbActivate(i, 'end');
        });
        root.addEventListener('beforeinput', e => {
            const t = e.target.closest && e.target.closest('.nb-t'); if (!t) return;
            const i = idx(t);
            if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') { e.preventDefault(); this.nbSuggestClose(); this.nbSplit(i); }
            else if (e.inputType === 'historyUndo') { e.preventDefault(); this.nbUndo(); }
            else if (e.inputType === 'historyRedo') { e.preventDefault(); this.nbUndo(true); }
            else if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop') { e.preventDefault(); const dt = e.dataTransfer; this.nbPaste(i, dt ? dt.getData('text/plain') : ''); }
            else if (!this.nb.burst || Date.now() - this.nb.burst > 1200) { this.nbPush(); this.nb.burst = Date.now(); } else this.nb.burst = Date.now();
        });
        root.addEventListener('input', e => {
            const t = e.target.closest && e.target.closest('.nb-t'); if (!t) return;
            const n = this.note(this.ui.note), i = idx(t); if (!n || !n.b[i]) return;
            n.b[i].x = t.textContent.replace(/\n+/g, ' ');
            this.nbChanged();
            if (this.nbShortcut(i, t)) return;
            this.nbSuggestCheck(t);
        });
        root.addEventListener('keydown', e => {
            if (e.target.id === 'nb-title') { if (e.key === 'Enter') { e.preventDefault(); const n = this.note(this.ui.note); if (n) this.nbActivate(0, 'start'); } return; }
            const t = e.target.closest && e.target.closest('.nb-t'); if (!t) return;
            const n = this.note(this.ui.note), i = idx(t), mod = e.ctrlKey || e.metaKey;
            if (this.nb.sug && ['ArrowDown', 'ArrowUp'].includes(e.key)) { /* the suggestions are tapped or clicked */ }
            if (e.key === 'Escape') { if (this.nb.sug) { this.nbSuggestClose(); e.preventDefault(); } return; }
            if (e.key === 'Enter' && this.nb.sug && !e.shiftKey) { e.preventDefault(); this.nbSuggestPick(0); return; }
            if (e.key === 'Tab') { e.preventDefault(); this.nbIndent(i, e.shiftKey ? -1 : 1); return; }
            if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); this.nbUndo(e.shiftKey); return; }
            if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.nbUndo(true); return; }
            if (e.key === 'Backspace') { const c = this.nbCaret(t); if (c.s === 0 && c.e === 0 && this.nbBackspace(i)) e.preventDefault(); return; }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                const c = this.nbCaret(t), vis = this.nbVisible(n), at = vis.indexOf(i);
                if (e.key === 'ArrowUp' && c.s === 0 && at > 0) { e.preventDefault(); this.nbActivate(vis[at - 1], 'end'); }
                else if (e.key === 'ArrowDown' && c.e === t.textContent.length && at >= 0 && at < vis.length - 1) { e.preventDefault(); this.nbActivate(vis[at + 1], 'start'); }
            }
        });
        root.addEventListener('focusin', e => { const t = e.target.closest && e.target.closest('.nb-t'); if (t) { this.nb.last = idx(t); document.body.classList.add('nb-editing'); this.nbPlaceBar(); } });
        root.addEventListener('focusout', () => setTimeout(() => this.nbIdle(), 80));
        root.addEventListener('change', e => { if (e.target.id === 'nb-title') { const n = this.note(this.ui.note); if (n) { this.nbPush(); this.noteRename(n, e.target.value); e.target.value = n.title; this.nbRefreshList(); } } });
        root.addEventListener('input', e => {
            if (e.target.id === 'nb-search') { this.ui.noteQ = e.target.value; this.nbRefreshList(); }
        });
        document.addEventListener('pointerdown', e => { if (e.target.closest('.nb-bar, .nb-suggest, .nb-menu')) e.preventDefault(); });
        document.addEventListener('click', e => {
            const b = e.target.closest('.nb-bar [data-nb]'); if (b) { this.nbBar(b.dataset.nb); return; }
            const s = e.target.closest('.nb-suggest [data-sug]'); if (s) { this.nbSuggestPick(Number(s.dataset.sug)); return; }
            if (!e.target.closest('.nb-menu, [data-action=nb-more]')) this.nbMenuClose();
        });
        const place = () => this.nbPlaceBar();
        if (window.visualViewport) { visualViewport.addEventListener('resize', place); visualViewport.addEventListener('scroll', place); }
        window.addEventListener('resize', place);
    },
    noteAction(action, el) {
        const ds = el.dataset || {};
        if (action === 'nb-new') { const n = this.noteNew(''); this.noteOpen(n.id, { focus: 'title' }); }
        else if (action === 'nb-daily') this.noteDaily();
        else if (action === 'nb-open') this.noteOpen(ds.id);
        else if (action === 'nb-close') {
            this.nbIdle(true); const back = this.nb && this.nb.back.pop();
            if (back && this.note(back)) { this.ui.note = back; this.nb.hist = []; this.nb.redo = []; } else this.ui.note = null;
            this.renderNotes();
        }
        else if (action === 'nb-fav') { const n = this.note(this.ui.note); if (n) { n.fav = !n.fav; this.save(); this.renderNotes(); } }
        else if (action === 'nb-fav-filter') { this.ui.noteFav = ds.on === '1'; this.renderNotes(); }
        else if (action === 'nb-more') {
            const n = this.note(this.ui.note); if (!n) return;
            this.nbMenu([
                { ico: 'copy', label: 'Copier le texte', fn: () => { navigator.clipboard && navigator.clipboard.writeText(this.noteAsText(n)).then(() => this.toast('Texte copié', 'success', ic('copy'))).catch(() => this.toast('Copie impossible ici.', 'warning')); } },
                { ico: 'trash', label: 'Supprimer la note', fn: () => this.noteDelete(n.id) }
            ]);
        }
    }
});
