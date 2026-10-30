/* ============================================================
   Notes : un plan en puces (chaque ligne est un bloc avec une profondeur), des titres, des cases « à faire »,
   des images, des liens [[ ]] vers d'autres notes ou des cartes avec rétroliens, et la note du jour.
   Une note est un document comme un QCM : rangée dans data.notes, sauvegardée, synchronisée (fusion par note),
   mise à la corbeille 30 jours quand on la supprime.
   Bloc : { t: 'p'|'h1'|'h2'|'h3'|'todo'|'quote'|'hr'|'img', x: texte, d: profondeur, done?, src?, c?: replié }
   ============================================================ */
Object.assign(ICONS, {
    grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
    notebook: '<path d="M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6z"/><path d="M9 3v18M12.5 8h3.5M12.5 12h3.5"/>'
});
const NB_TYPES = ['p', 'h1', 'h2', 'h3', 'todo', 'quote', 'hr', 'img', 'table', 'callout', 'code', 'math', 'num', 'toggle', 'toc'], NB_CARD_KINDS = ['basic', 'multi', 'list', 'mcq', 'cloze'], NB_MAX_DEPTH = 6, NB_MAX_BLOCKS = 4000;
const NB_CE = (() => { try { const d = document.createElement('div'); d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true'; } catch { return 'true'; } })();
const NB_LINK = /\[\[([^\[\]\n]{1,160})\]\]/g;

function normalizeNoteBlock(x) {
    if (!x || typeof x !== 'object') return null;
    const t = NB_TYPES.includes(x.t) ? x.t : 'p', b = { t, x: t === 'hr' || t === 'img' || t === 'table' || t === 'toc' ? '' : String(x.x == null ? '' : x.x).replace(/\n+/g, ' ').slice(0, 4000), d: clamp(Math.round(num(x.d, 0)), 0, NB_MAX_DEPTH) };
    if (t === 'callout') b.k = ['info', 'tip', 'warn', 'def'].includes(x.k) ? x.k : 'info';
    if (t === 'table') { b.rows = toArray(x.rows).slice(0, 40).map(r => toArray(r).slice(0, 8).map(c => String(c == null ? '' : c).replace(/\n+/g, ' ').slice(0, 300))).filter(r => r.length); if (!b.rows.length) b.rows = [['', ''], ['', '']]; const w = Math.max(...b.rows.map(r => r.length)); b.rows.forEach(r => { while (r.length < w) r.push(''); }); b.hdr = x.hdr !== false; b.id = String(x.id || uid('b')); b.tc = nbColOk(x.tc) ? x.tc : ''; b.zebra = !!x.zebra; b.fill = {}; b.cf = {}; if (x.fill && typeof x.fill === 'object') Object.entries(x.fill).slice(0, 400).forEach(([k, v]) => { if (/^\d+,(\d+|\*)$/.test(k) && nbColOk(v)) b.fill[k] = v; }); if (x.cf && typeof x.cf === 'object') Object.entries(x.cf).slice(0, 400).forEach(([k, v]) => { if (!/^\d+,\d+$/.test(k) || !v || typeof v !== 'object') return; const o = {}; ['b', 'i', 'u', 's'].forEach(z => { if (v[z]) o[z] = true; }); if (['l', 'c', 'r'].includes(v.a)) o.a = v.a; if (/^#[0-9a-f]{6}$/i.test(v.c || '')) o.c = v.c.toLowerCase(); if (Object.keys(o).length) b.cf[k] = o; }); }
    if (x.ok) b.ok = true;
    if (t === 'p' && x.cd && typeof x.cd === 'object') {   // this line is a memory card (see notes-cards.js)
        const c = x.cd;
        b.cd = { k: NB_CARD_KINDS.includes(c.k) ? c.k : 'basic', a: String(c.a || '').replace(/\n+/g, ' ').slice(0, 4000), dir: ['fwd', 'back', 'both'].includes(c.dir) ? c.dir : 'fwd', on: c.on !== false, ta: !!c.ta, ord: !!c.ord, mx: !!c.mx,
            id: String(c.id || uid('b')), cid: toArray(c.cid).map(String).slice(0, 12), qid: c.qid ? String(c.qid) : '', hm: toArray(c.hm).slice(0, 40).map(h => ({ t: String(h && h.t || '').slice(0, 200), n: Math.max(1, Math.round(num(h && h.n, 1))) })), sg: String(c.sg || '').slice(0, 2000), so: c.so !== false, dead: !!c.dead, vd: c.vd !== false };
    }
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
    const tags = [], seen = new Set();
    toArray(x.tags).forEach(t => { t = String(t).replace(/^#+/, '').replace(/[\s#\[\]]+/g, '-').slice(0, 30); if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); tags.push(t); } });
    return {
        id: String(x.id || uid('n')), title: String(x.title || '').replace(/[\n\[\]]+/g, ' ').trim().slice(0, 120), deckId: x.deckId ? String(x.deckId) : '',
        b, daily: /^\d{4}-\d{2}-\d{2}$/.test(String(x.daily || '')) ? String(x.daily) : '', fav: !!x.fav, created: num(x.created, 0), mod: num(x.mod, 0),
        emoji: String(x.emoji || '').slice(0, 8), pin: !!x.pin, parent: x.parent ? String(x.parent) : '', tags: tags.slice(0, 12), order: num(x.order, 0)
    };
}
const noteSig = n => JSON.stringify([n.title, n.deckId, n.b, n.daily, n.fav, n.emoji, n.pin, n.parent, n.tags, n.order]);
const noteText = n => n.b.map(b => b.x + (b.cd ? ' ' + b.cd.a : '') + (b.rows ? ' ' + b.rows.map(r => r.join(' ')).join(' ') : '')).join('\n') + ' ' + n.tags.join(' ');
const nbEmpty = () => ({ t: 'p', x: '', d: 0 });
const NB_COLORS = [['blue', 'Bleu', '#3b82f6'], ['green', 'Vert', '#22c55e'], ['yellow', 'Jaune', '#eab308'], ['orange', 'Orange', '#f97316'], ['pink', 'Rose', '#ec4899'], ['violet', 'Violet', '#8b5cf6'], ['grey', 'Gris', '#64748b']];
const nbColOk = v => NB_COLORS.some(c => c[0] === v) || /^#[0-9a-f]{6}$/i.test(String(v || ''));
const nbSolid = t => t === 'hr' || t === 'img' || t === 'table' || t === 'toc';   // blocks that have no text to type in

Object.assign(SuperAnki.prototype, {
    /* ---------- finding things ---------- */
    note(id) { return id && this.data.notes.find(n => n.id === id) || null; },
    noteName(n) { return n.title || 'Sans titre'; },
    noteByTitle(t) { const k = fold(String(t).trim()); return k ? this.data.notes.find(n => n.title && fold(n.title) === k) || null : null; },
    /* what a note points to: [[Titre]] → { k:'note', t }, [[c:ID|texte]] → { k:'card', id } */
    noteLinks(n) {
        const out = [];
        n.b.forEach(b => { String(b.x).replace(NB_LINK, (m, inner) => { const c = /^c:([^|]+)\|/.exec(inner); if (/^pdf:/.test(inner)) { out.push({ k: 'pdf' }); return m; } out.push(c ? { k: 'card', id: c[1] } : { k: 'note', t: inner.trim() }); return m; }); });
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
    /* a little formatting kept as plain text: **gras**, *italique*, ==surligné==, `code` ; q = word to highlight while searching in the note */
    fmtHtml(h, q) {
        h = h.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<i>$2</i>').replace(/==(?:\{([ygbp]|#[0-9a-f]{6})\})?([^=]+)==/gi, (m, c, t) => c && c[0] === '#' ? `<mark class="nb-hl" style="background:color-mix(in srgb,${c} 55%,transparent)">${t}</mark>` : `<mark class="nb-hl${c ? ' nb-hl-' + c : ''}">${t}</mark>`).replace(/(^|[^\w])__([^_]+)__(?!\w)/g, '$1<u>$2</u>').replace(/~~([^~]+)~~/g, '<s>$1</s>').replace(/(^|[^\w$])\$([^$\s](?:[^$]*[^$\s])?)\$(?![\w$])/g, (m, a, f) => `${a}<span class="nb-mth">${nbMathHtml(f)}</span>`).replace(/\{c:(#[0-9a-f]{6})\|([^{}|]*)\}/gi, '<span style="color:$1">$2</span>');
        if (q) { const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); h = h.split(/(<[^>]*>)/).map(t => (t.startsWith('<') ? t : t.replace(re, m => `<mark class="nb-find">${m}</mark>`))).join(''); }
        return h;
    },
    inlineHtml(x, q) {
        return this.fmtHtml(esc(x), q).replace(/\[\[([^\[\]\n]{1,160})\]\]/g, (m, inner) => {
            const pl = /^pdf:([^:|]*):([^|]*)\|(.*)$/.exec(inner);
            if (pl) { const doc = this.pdf(pl[1]); return `<a class="nb-link pdf ${doc ? '' : 'miss'}" data-pdf="${pl[1]}" data-pid="${pl[2]}">${ic('pdf')}${pl[3] || (doc ? esc(truncate(doc.name, 30)) : 'PDF')}</a>`; }
            const c = /^c:([^|]+)\|(.*)$/.exec(inner);
            if (c) { const card = this.card(c[1]); return `<a class="nb-link card ${card ? '' : 'miss'}" data-nbc="${c[1]}">${ic('card')}${c[2] || (card ? esc(truncate(stripHtml(card.front), 40)) : 'carte supprimée')}</a>`; }
            const hit = this.noteByTitle(inner);
            return `<a class="nb-link ${hit ? '' : 'miss'}" data-nbt="${inner}">${inner}</a>`;
        });
    },

    /* ---------- creating, opening, deleting ---------- */
    noteNew(title = '', opts = {}) {
        const par = opts.parent ? this.note(opts.parent) : null;
        const n = normalizeNote({ id: uid('n'), title, b: opts.b || [nbEmpty()], created: Date.now(), deckId: par ? par.deckId : (opts.deckId || ''), daily: opts.daily || '', parent: par ? par.id : '', emoji: opts.emoji || '', tags: opts.tags || [], order: Date.now() / 1000 });
        this.data.notes.push(n); this.save();
        return n;
    },
    noteOpen(id, { push = true, focus = '' } = {}) {
        const n = this.note(id); if (!n) return;
        if (push && this.ui.note && this.ui.note !== id) (this.nb ? this.nb.back : (this.nb = { back: [] }).back).push(this.ui.note);
        this.nbIdle(true);
        this.ui.note = id; this.ui.nbMem = false; this.nb = Object.assign(this.nb || { back: [] }, { hist: [], redo: [], active: -1, burst: 0, find: null, hits: [] });
        if (n.b.some(b => b.cd) && this.nbCardSyncAll(n)) this.save();
        if (this.view !== 'notes') this.go('notes'); else this.renderNotes();
        if (focus === 'title') setTimeout(() => { const t = $('#nb-title'); if (t) t.focus(); }, 80);
        else if (focus === 'end') setTimeout(() => { const nn = this.note(id); if (nn) this.nbActivate(this.nbLastText(nn), 'end'); }, 80);
    },
    nbLastText(n) { for (let i = n.b.length - 1; i >= 0; i--) if (!nbSolid(n.b[i].t)) return i; return 0; },
    noteDaily() {
        const key = dayKey();
        let n = this.data.notes.find(x => x.daily === key);
        if (!n) n = this.noteNew(this.dailyTitle(key), { daily: key });
        this.noteOpen(n.id, { focus: 'end' });
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
            return b.t === 'h1' ? `${pad}# ${x}` : b.t === 'h2' ? `${pad}## ${x}` : b.t === 'h3' ? `${pad}### ${x}` : b.t === 'todo' ? `${pad}- [${b.done ? 'x' : ' '}] ${x}` : b.t === 'quote' ? `${pad}> ${x}` : b.t === 'hr' ? `${pad}---` : b.t === 'img' ? `${pad}[image]` : b.t === 'num' ? `${pad}1. ${x}` : b.t === 'code' ? `${pad}\`${x}\`` : b.t === 'math' ? `${pad}$$ ${x} $$` : b.t === 'callout' ? `${pad}> ${{ info: 'ℹ️', tip: '💡', warn: '⚠️', def: '📘' }[b.k] || ''} ${x}` : b.t === 'toggle' ? `${pad}- ▸ ${x}` : b.t === 'toc' ? `${pad}[sommaire]` : `${pad}- ${x}`;
        })].join('\n');
    },

    /* ---------- screen ---------- */
    /* the bar lives on the page itself (never inside an animated or blurred panel) so it can follow the keyboard */
    nbBarEnsure(open) {
        let bar = $('#nb-bar');
        if (!open) { if (bar) bar.remove(); document.body.classList.remove('nb-open', 'nb-editing'); return; }
        if (!bar) document.body.insertAdjacentHTML('beforeend', `<div class="nb-bar" id="nb-bar" role="toolbar" aria-label="Mise en forme">
    <button data-nb="out" title="Remonter d'un niveau" aria-label="Remonter d'un niveau">${ic('chevronLeft')}<span>Niveau</span></button>
    <button data-nb="in" title="Descendre d'un niveau" aria-label="Descendre d'un niveau">${ic('chevronRight')}<span>Niveau</span></button>
    <span class="nb-sep"></span>
    <button data-nb="card" title="Carte mémoire" aria-label="Carte mémoire">${ic('copy')}<span>Carte ▾</span></button>
    <button data-nb="head" title="Titre" aria-label="Titre">${ic('heading')}<span>Titre ▾</span></button>
    <button data-nb="todo" title="À faire (case à cocher)" aria-label="À faire">${ic('checkSq')}<span>À faire</span></button>
    <button data-nb="img" title="Image" aria-label="Image">${ic('image')}<span>Image</span></button>
    <button data-nb="table" title="Tableau" aria-label="Tableau">${ic('table')}<span>Tableau ▾</span></button>
    <button data-nb="fmt" title="Gras, italique, surligné, code" aria-label="Mise en forme"><b class="nb-aa">Aa</b><span>Texte ▾</span></button>
    <button data-nb="plus" title="Plus : lien, citation, séparateur, déplacer…" aria-label="Plus">${ic('plus')}<span>Plus</span></button>
    <button data-nb="undo" title="Annuler" aria-label="Annuler">${ic('undo')}<span>Annuler</span></button>
    <span class="nb-sep"></span>
    <button data-nb="kbd" class="nb-kbd" title="Fermer le clavier" aria-label="Fermer le clavier">${ic('kbdoff')}<span>Clavier</span></button>
    <button data-nb="min" class="nb-min" title="Réduire la barre d'outils flottante" aria-label="Réduire la barre d'outils flottante">${ic('chevronDown')}<span>Réduire</span></button>
</div>`);
        { const bb = $('#nb-bar'); if (bb) bb.classList.toggle('min', !!this.nbPrefs().barMin); }
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
    nbBlockHtml(n, i, hide, own) {
        const b = n.b[i], kids = this.nbHasKids(n.b, i), cd = b.cd, q = this.nb && this.nb.find ? this.nb.find.q : '';
        const owner = own ? own[i] : -1, om = owner >= 0 ? n.b[owner].cd.k : '';
        const gut = b.t === 'todo' ? `<button class="nb-chk ${b.done ? 'on' : ''}" data-nbk="chk" aria-label="${b.done ? 'Décocher' : 'Cocher'}" aria-pressed="${!!b.done}">${b.done ? ic('check') : ''}</button>`
            : om === 'mcq' && n.b[i].d === n.b[owner].d + 1 ? `<button class="nb-okb ${b.ok ? 'on' : ''}" data-nbk="ok" aria-label="${b.ok ? 'Bonne réponse' : 'Marquer comme bonne réponse'}" aria-pressed="${!!b.ok}" title="Bonne réponse">${b.ok ? ic('check') : ''}</button>`
            : b.t === 'num' ? `<span class="nb-numg">${this.nbNumOf(n.b, i)}.</span>`
            : b.t === 'toggle' ? `<button class="nb-tog ${kids ? 'kids' : ''} ${b.c ? 'fold' : ''}" data-nbk="bul" aria-label="${b.c ? 'Déplier' : 'Replier'}">${ic('chevronRight')}</button>`
            : b.t === 'callout' ? `<button class="nb-cico k-${b.k}" data-nbk="calk" aria-label="Type d'encadré" title="Changer le type d'encadré">${ic({ info: 'info', tip: 'sparkle', warn: 'alert', def: 'book' }[b.k] || 'info')}</button>`
            : b.t === 'p' || b.t === 'quote' ? `<button class="nb-bul ${kids ? 'kids' : ''} ${b.c ? 'fold' : ''}" data-nbk="bul" aria-label="${kids ? (b.c ? 'Déplier' : 'Replier') : 'Puce'}"><i></i></button>` : '<span class="nb-nogut"></span>';
        let body;
        if (b.t === 'hr') body = '<hr class="nb-hr">';
        else if (b.t === 'img') body = `<figure class="nb-img"><img src="${esc(b.src)}" alt=""><button class="icon-btn icon-btn-sm nb-img-x" data-nbk="imgx" aria-label="Retirer l'image">${ic('x')}</button></figure>`;
        else if (b.t === 'table') body = this.nbTableHtml(b);
        else if (b.t === 'toc') body = this.nbTocHtml(n);
        else if (cd) body = this.nbCardLineHtml(n, i, q);
        else body = `<div class="nb-view">${b.t === 'math' ? `<span class="nb-mth">${nbMathHtml(esc(b.x)) || '<span class="faint">Formule : x^2 + \\frac{a}{b}</span>'}</span>` : this.inlineHtml(b.x, q)}</div><div class="nb-t" contenteditable="${NB_CE}" role="textbox" aria-multiline="false" spellcheck="true" autocapitalize="sentences"></div>`;
        const cls = `nb nb-${b.t} ${b.done ? 'done' : ''} ${hide[i] ? 'hid' : ''} ${cd ? 'has-card' : ''} ${owner >= 0 ? 'in-card in-' + om : ''}`;
        return `<div class="${cls}" data-i="${i}" ${cd ? `data-bid="${esc(cd.id)}"` : ''} style="--d:${b.d}">${gut}<div class="nb-body">${body}</div></div>`;
    },
    nbNumOf(b, i) { let k = 1; for (let j = i - 1; j >= 0; j--) { if (b[j].d > b[i].d) continue; if (b[j].d === b[i].d && b[j].t === 'num') k++; else break; } return k; },
    nbTocHtml(n) {
        const hs = n.b.map((b, i) => [b, i]).filter(([b]) => /^h[123]$/.test(b.t) && b.x.trim());
        return `<nav class="nb-toc" aria-label="Sommaire"><b>Sommaire</b>${hs.length ? hs.map(([b, i]) => `<button data-nbk="toc" data-to="${i}" style="padding-left:${(Number(b.t[1]) - 1) * 14}px">${esc(this.nbPlain(b.x))}</button>`).join('') : '<span class="faint">Ajoute des titres : ils apparaîtront ici.</span>'}</nav>`;
    },
    nbSetBlockType(i, t) { const n = this.note(this.ui.note), b = n.b[i]; if (!b) return; if (nbSolid(b.t)) { this.nbInsertAfter(i, [{ t, x: '' }]); return; } this.nbOp(() => { delete b.cd; delete b.done; b.t = b.t === t ? 'p' : t; if (t === 'callout') b.k = b.k || 'info'; }, i, 'end'); },
    nbInsertText(i, text) { const n = this.note(this.ui.note), b = n.b[i]; if (!b || nbSolid(b.t)) return; const t = this.nb.active === i ? $('.nb-t', this.nbEl(i)) : null, s = t ? this.nbCaret(t).s : b.x.length; this.nbOp(() => { b.x = b.x.slice(0, s) + text + b.x.slice(s); }, i, s + text.length); },
    nbBlocksHtml(n) { const hide = this.nbHidden(n.b), own = this.nbCardOwners(n); return n.b.map((_, i) => this.nbBlockHtml(n, i, hide, own)).join('') + `<div class="nb-tail" data-nbk="tail"></div>`; },
    /* redraws the blocks (after a structure change), then puts the cursor back */
    nbRender(focusI, pos) {
        const n = this.note(this.ui.note), box = $('#nb-blocks'); if (!n || !box) return;
        this.nb.active = -1;
        box.innerHTML = this.nbBlocksHtml(n); this.resolveMedia(box);
        if (focusI != null && focusI >= 0) this.nbActivate(focusI, pos == null ? 'end' : pos);
    },
    nbVisible(n) { const hide = this.nbHidden(n.b); return n.b.map((_, i) => i).filter(i => !hide[i] && !nbSolid(n.b[i].t)); },

    /* ---------- one block being typed in ---------- */
    nbEl(i) { return $(`#nb-blocks .nb[data-i="${i}"]`); },
    nbActivate(i, pos = 'end') {
        const n = this.note(this.ui.note); if (!n || !n.b[i] || nbSolid(n.b[i].t)) return;
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
        if (row && n && n.b[i]) { row.classList.remove('on'); const v = $('.nb-view', row); if (v) v.innerHTML = this.inlineHtml(n.b[i].x, this.nb.find ? this.nb.find.q : ''); }
        this.nb.active = -1; this.nbSuggestClose();
    },
    /* leave the editor: used when the focus really goes away */
    nbIdle(force = false) {
        if (!this.nb) return;
        if (!force) { const a = document.activeElement; if (a && a.closest && a.closest('.nb-t, .nbc-ain, .nb-table, .nb-bar, .nb-suggest, .nb-menu, .nbcm, .nbprev, #nb-title')) return; }
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
        const e = from.pop(); if (!e) return;
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
        if (this.nb.dirty !== false) { this.nbCardSyncAll(n); this.save(); this.nb.dirty = false; this.nbRefreshBadges(); }
        this.nbRefreshList();
        const bl = $('#nb-backlinks'); if (bl) bl.innerHTML = this.nbBacklinksHtml(n, this.noteBacklinks(n));
    },
    nbChanged() { this.nb.dirty = true; this.nbSaveSoon(); clearTimeout(this._nbSt); this._nbSt = setTimeout(() => { const n = this.note(this.ui.note), e = $('#nb-stats'); if (n && e) e.textContent = this.noteStats(n); }, 700); },
    /* a structure change: save a step for « Annuler », do it, redraw */
    nbOp(fn, focusI, pos) {
        const n = this.note(this.ui.note); if (!n) return;
        this.nbPush(); const cardsBefore = this.nbCardIdsOf(n); fn(n);
        this.nbCardsGone(cardsBefore, n);
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
        if (b.cd && b.x.trim() && pos >= b.x.length && (b.cd.k === 'cloze' || b.cd.k === 'basic')) {   // chain cards: recto → verso, then a fresh card line of the same kind
            const ain = $('.nbc-ain', this.nbEl(i));
            if (b.cd.k === 'basic' && ain && !ain.value.trim()) { ain.focus(); return; }
            this.nbOp(nn => { nn.b.splice(i + 1, 0, { t: 'p', x: '', d: b.d, cd: this.nbCdNew(b.cd.k) }); }, i + 1, 0); return;
        }
        if (b.cd && NB_KIDS.includes(b.cd.k) && pos >= b.x.length) { const first = i + 1; const hasKid = n.b[first] && n.b[first].d > b.d; if (hasKid) { this.nbActivate(first, 'end'); return; } this.nbOp(nn => { nn.b.splice(i + 1, 0, { t: 'p', x: '', d: b.d + 1 }); }, i + 1, 0); return; }
        const ow = this.nbCardOwners(n)[i];
        if (ow >= 0 && b.x && pos >= b.x.length) { const nx = n.b[i + 1]; if (nx && !nx.x && nx.t === 'p' && nx.d === b.d && !nx.cd) { this.nbActivate(i + 1, 'start'); return; } }   // the next empty answer line is reused
        if (!b.x && ow >= 0 && n.b[ow].cd && n.b[ow].d + 1 === b.d) { this.nbOp(nn => { nn.b[i].d = n.b[ow].d; delete nn.b[i].ok; }, i, 0); return; }   // an empty answer line + Enter = leave the card
        if (!b.x && b.d > 0) { this.nbIndent(i, -1); return; }
        const left = b.x.slice(0, pos), right = b.x.slice(pos);
        this.nbOp(nn => {
            b.x = left;
            const at = b.c ? this.nbSubEnd(nn.b, i) : i + 1;
            nn.b.splice(at, 0, { t: ['todo', 'num', 'code'].includes(b.t) ? b.t : 'p', x: right, d: b.d });
        }, (b.c ? this.nbSubEnd(n.b, i) : i + 1), 0);
    },
    nbBackspace(i) {
        const n = this.note(this.ui.note), b = n.b[i];
        if (b.cd) { if (!b.x && !b.cd.a && !b.cd.cid.length && !b.cd.qid) { this.nbOp(() => { delete b.cd; }, i, 0); return true; } return true; }
        if (b.t !== 'p') { this.nbOp(() => { b.t = 'p'; delete b.done; }, i, 0); return true; }
        if (b.d > 0) { this.nbIndent(i, -1); return true; }
        if (i === 0) return false;
        const prev = n.b[i - 1];
        if (nbSolid(prev.t)) { this.nbOp(nn => { nn.b.splice(i - 1, 1); }, i - 1, 0); return true; }
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
        const m = /^(#{1,3}|\[\s?\]|>>>|>|[-*•]|\d+[.)]|```|\$\$)\s/.exec(b.x); if (!m) return false;
        const k = m[1], rest = b.x.slice(m[0].length);
        const type = /^#/.test(k) ? 'h' + k.length : /^\[/.test(k) ? 'todo' : k === '>' ? 'quote' : k === '>>>' ? 'callout' : /^\d/.test(k) ? 'num' : k === '```' ? 'code' : k === '$$' ? 'math' : 'p';
        this.nbOp(() => { b.t = type; b.x = rest; }, i, 0); return true;
    },

    /* ---------- [[ autocomplete ---------- */
    /* « / » at the start of a line (or after a space): a menu of every block and tool */
    nbSlashItems(i) {
        const set = t => () => this.nbSetBlockType(i, t), card = k => () => { this.nbActivate(i, 'end'); this.nbCardInsert(k); };
        return [['Texte simple', 'file', () => this.nbSetType(i, 'p')], ['Titre 1', 'heading', () => this.nbSetType(i, 'h1')], ['Titre 2', 'heading', () => this.nbSetType(i, 'h2')], ['Titre 3', 'heading', () => this.nbSetType(i, 'h3')],
            ['À faire (case à cocher)', 'checkSq', () => this.nbSetType(i, 'todo')], ['Liste numérotée', 'listOrdered', set('num')], ['Bascule (replie)', 'chevronRight', set('toggle')], ['Citation', 'quote', () => this.nbSetType(i, 'quote')],
            ['Encadré', 'info', set('callout')], ['Bloc de code', 'code', set('code')], ['Formule maths', 'sigma', set('math')], ['Séparateur', 'list', () => this.nbInsertAfter(i, [{ t: 'hr' }, { t: 'p', x: '' }])], ['Sommaire de la note', 'toc', () => this.nbInsertAfter(i, [{ t: 'toc' }, { t: 'p', x: '' }])],
            ['Tableau 3×3', 'table', () => this.nbInsertAfter(i, [{ t: 'table', id: uid('b'), hdr: true, rows: [['', '', ''], ['', '', ''], ['', '', '']] }])], ['Image', 'image', () => this.nbBar('img', $('#nb-bar'))],
            ['Carte : ligne unique', 'copy', card('basic')], ['Carte à trous', 'brackets', card('cloze')], ['Carte : liste', 'listOrdered', card('list')],
            ['Date du jour', 'calendar', () => this.nbInsertText(i, new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))], ['Heure', 'clock', () => this.nbInsertText(i, new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))],
            ['Lien vers une note, un PDF, une carte', 'link', () => this.nbLinkPicker()]].map(([label, ico, fn]) => ({ k: 'slash', label, ico, fn, ins: '' }));
    },
    nbSuggestCheck(t) {
        const pos = this.nbCaret(t).s, before = t.textContent.slice(0, pos), sl = /(?:^|\s)\/([^\s/]*)$/.exec(before);
        if (sl && this.nb.active >= 0) {
            const q = fold(sl[1]), items = this.nbSlashItems(this.nb.active).filter(x => !q || fold(x.label).includes(q)).slice(0, 8);
            if (!items.length) { this.nbSuggestClose(); return; }
            this.nb.sug = { items, start: pos - sl[1].length - 1, end: pos, i: this.nb.active };
            let box = $('.nb-suggest'); if (!box) { box = document.createElement('div'); box.className = 'nb-suggest'; document.body.appendChild(box); }
            box.innerHTML = items.map((x, k) => `<button data-sug="${k}">${ic(x.ico)}<span>${esc(x.label)}</span><small>/</small></button>`).join('');
            this.nbPlaceBar(); return;
        }
        const m = /\[\[([^\[\]\n]*)$/.exec(before);
        if (!m) { this.nbSuggestClose(); return; }
        const q = fold(m[1].trim()), items = [];
        this.data.notes.filter(x => x.id !== this.ui.note && x.title && (!q || fold(x.title).includes(q))).sort((a, b) => b.mod - a.mod).slice(0, 4).forEach(x => items.push({ k: 'note', label: x.title, ins: x.title, ico: x.daily ? 'calendar' : 'notebook' }));
        if (q) this.data.cards.filter(c => fold(stripHtml(c.front)).includes(q)).slice(0, 3).forEach(c => items.push({ k: 'card', label: truncate(stripHtml(c.front), 50), ins: `c:${c.id}|${truncate(stripHtml(c.front), 40).replace(/[\[\]|]/g, ' ')}`, ico: 'card' }));
        const typed = m[1].trim();
        if (typed && !this.noteByTitle(typed)) items.push({ k: 'new', label: `Créer « ${typed} »`, ins: typed, ico: 'plus' });
        if (!items.length) { this.nbSuggestClose(); return; }
        items.push({ k: 'pick', label: 'Choisir dans une liste (notes, PDF, cartes)…', ins: '', ico: 'search' });
        this.nb.sug = { items, start: pos - m[1].length, end: pos, i: this.nb.active };
        let box = $('.nb-suggest'); if (!box) { box = document.createElement('div'); box.className = 'nb-suggest'; document.body.appendChild(box); }
        box.innerHTML = items.map((x, k) => `<button data-sug="${k}">${ic(x.ico)}<span>${esc(x.label)}</span><small>${x.k === 'note' ? 'note' : x.k === 'card' ? 'carte' : x.k === 'pick' ? '' : 'nouvelle'}</small></button>`).join('');
        this.nbPlaceBar();
    },
    nbSuggestClose() { const b = $('.nb-suggest'); if (b) b.remove(); if (this.nb) this.nb.sug = null; },
    nbSuggestPick(k) {
        const s = this.nb.sug, it = s && s.items[k]; if (!it) return;
        if (it.k === 'slash') { const nn = this.note(this.ui.note), bb = nn.b[s.i]; const keep = bb.x.slice(0, s.start).replace(/\s+$/, '') + bb.x.slice(s.end); this.nbSuggestClose(); this.nbPush(); bb.x = keep; this.nbChanged(); this.nbRender(s.i, Math.min(keep.length, s.start)); it.fn(); return; }
        if (it.k === 'pick') { this.nbLinkPicker(); return; }
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
        const pane = innerWidth >= 900 && document.body.classList.contains('pdf-open') && !bar.classList.contains('min') ? $('#pdf-notes') : null, pr = pane && pane.getBoundingClientRect();
        if (pr && pr.width > 120) { bar.style.left = `${Math.round(pr.left + 8)}px`; bar.style.width = `${Math.round(pr.width - 16)}px`; bar.style.transform = 'none'; bar.classList.add('in-pane'); }
        else { ['left', 'width', 'transform'].forEach(k => bar.style.removeProperty(k)); bar.classList.remove('in-pane'); }
        const sg = $('.nb-suggest'); if (sg) { sg.style.left = '8px'; sg.style.right = '8px'; sg.style.bottom = `${Math.max(0, innerHeight - (y - bar.offsetHeight)) + 6}px`; }
        const mn = $('.nb-menu'); if (mn) mn.style.bottom = `${Math.max(0, innerHeight - (y - bar.offsetHeight)) + 6}px`;
    },
    nbMenuClose() { const m = $('.nb-menu'); if (m) m.remove(); },
    nbMenu(items, anchor) {
        this.nbMenuClose();
        const m = document.createElement('div'); m.className = 'nb-menu';
        m.innerHTML = items.map((x, k) => x.head ? `<div class="nb-menu-h">${x.head}</div>` : x.sep ? '<div class="menu-sep"></div>' : `<button data-mn="${k}" class="${x.on ? 'on' : ''} ${x.danger ? 'danger' : ''}">${x.ico ? ic(x.ico) : '<span class="i"></span>'}<span>${x.label}</span></button>`).join('');
        m.addEventListener('pointerdown', e => e.preventDefault());
        m.addEventListener('click', e => { const b = e.target.closest('[data-mn]'); if (!b) return; this.nbMenuClose(); items[Number(b.dataset.mn)].fn(); });
        document.body.appendChild(m); this.nbPlaceBar();
        if (anchor && anchor.getBoundingClientRect) {   // above (or under) the button that opened it
            const r = anchor.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight, left = clamp(r.left, 8, innerWidth - w - 8);
            m.style.left = `${left}px`; m.style.right = 'auto'; m.style.transform = 'none';
            if (r.top - h - 8 > 8) { m.style.bottom = `${innerHeight - r.top + 8}px`; m.style.top = 'auto'; } else { m.style.top = `${r.bottom + 8}px`; m.style.bottom = 'auto'; }
        }
    },
    nbCurrent() { const n = this.note(this.ui.note); if (!n) return null; let i = this.nb.active; if (i < 0 || !n.b[i]) i = this.nb.last != null && n.b[this.nb.last] ? this.nb.last : this.nbLastText(n); return { n, i, b: n.b[i] }; },
    nbBar(act, btn) {
        if (act === 'min') { const pr = this.nbPrefs(); pr.barMin = !pr.barMin; this.nbPrefSave(); const bb = $('#nb-bar'); if (bb) { bb.classList.toggle('min', pr.barMin); const m = $('.nb-min', bb); m.title = pr.barMin ? 'Agrandir la barre d\'outils' : 'Réduire la barre d\'outils flottante'; m.innerHTML = ic(pr.barMin ? 'chevronUp' : 'chevronDown') + `<span>${pr.barMin ? 'Outils' : 'Réduire'}</span>`; } this.nbPlaceBar(); return; }
        if (act === 'kbd') { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); this.nbIdle(true); return; }
        const c = this.nbCurrent(); if (!c) return;
        const { n, i, b } = c;
        const sel = this.nb.active === i ? this.nbCaret($('.nb-t', this.nbEl(i))) : { s: 0, e: 0 }, hasSel = sel.s !== sel.e;
        if (act === 'out') this.nbIndent(i, -1);
        else if (act === 'in') this.nbIndent(i, 1);
        else if (act === 'undo') this.nbUndo();
        else if (act === 'todo') this.nbOp(() => { if (b.t === 'todo') { b.t = 'p'; delete b.done; } else if (!nbSolid(b.t)) { b.t = 'todo'; delete b.cd; } }, i, 'end');
        else if (act === 'card') this.nbMenu([{ head: 'CARTES MÉMOIRE' },
            ...Object.entries(NB_KIND).map(([k, [label, ico]]) => ({ ico, label, on: b.cd && b.cd.k === k, fn: () => this.nbCardInsert(k) })),
            ...(hasSel ? [{ sep: true }, { ico: 'brackets', label: 'Mettre la sélection en trou', fn: () => this.nbSelToCloze() }] : []),
            ...(b.cd ? [{ sep: true }, { ico: 'trash', label: 'Retirer la carte de cette ligne', danger: true, fn: () => this.nbCardDelete(i) }] : []),
            { sep: true }, { ico: 'sparkle', label: 'Plan → cartes (toute la note)…', fn: () => this.nbPlanToCards() }], btn);
        else if (act === 'head') this.nbMenu([['p', 'Texte', 'file'], ['h1', 'Titre 1', 'heading'], ['h2', 'Titre 2', 'heading'], ['h3', 'Titre 3', 'heading']].map(([t, label, ico]) => ({ ico, label, on: b.t === t, fn: () => this.nbOp(() => { if (!nbSolid(b.t)) { b.t = t; delete b.done; delete b.cd; } }, i, 'end') })), btn);
        else if (act === 'fmt') this.nbMenu([{ ico: 'bold', label: '<b>Gras</b> · Ctrl+B', fn: () => this.nbWrap('**') }, { ico: 'italic', label: '<i>Italique</i> · Ctrl+I', fn: () => this.nbWrap('*') }, { ico: 'underline', label: '<u>Souligné</u> · Ctrl+U', fn: () => this.nbWrap('__') }, { sep: true }, { ico: 'pencil', label: '<mark class="nb-hl">Surligné jaune</mark>', fn: () => this.nbWrap('==') }, { ico: 'pencil', label: '<mark class="nb-hl nb-hl-g">Surligné vert</mark>', fn: () => this.nbWrap('=={g}', '==') }, { ico: 'pencil', label: '<mark class="nb-hl nb-hl-b">Surligné bleu</mark>', fn: () => this.nbWrap('=={b}', '==') }, { ico: 'pencil', label: '<mark class="nb-hl nb-hl-p">Surligné rose</mark>', fn: () => this.nbWrap('=={p}', '==') }, { sep: true }, { ico: 'file', label: '<code>Code</code>', fn: () => this.nbWrap('`') }, { ico: 'eraser', label: 'Effacer la mise en forme', fn: () => { if (b.x) this.nbOp(() => { b.x = b.x.replace(/==(?:\{(?:[ygbp]|#[0-9a-f]{6})\})?/gi, '').replace(/\{c:#[0-9a-f]{6}\|([^{}|]*)\}/gi, '$1').replace(/\*\*|~~|`/g, '').replace(/(^|[^\w])__([^_]+)__(?!\w)/g, '$1$2').replace(/(^|\s)\*([^*]+)\*/g, '$1$2'); }, i, 'end'); } }], btn);
        else if (act === 'table') this.nbTableMenu(btn, i);
        else if (act === 'plus') this.nbMenu([
            { ico: 'link', label: 'Lien vers une note, un PDF ou une carte…', fn: () => this.nbLinkPicker() },
            { ico: 'file', label: b.t === 'quote' ? 'Retirer la citation' : 'Citation', fn: () => this.nbOp(() => { if (!nbSolid(b.t)) { b.t = b.t === 'quote' ? 'p' : 'quote'; delete b.cd; } }, i, 'end') },
            { ico: 'list', label: 'Séparateur', fn: () => this.nbInsertAfter(i, [{ t: 'hr' }, { t: 'p', x: '' }]) },
            { ico: 'info', label: 'Encadré (info, astuce, attention…)', fn: () => this.nbSetBlockType(i, 'callout') },
            { ico: 'code', label: 'Bloc de code', fn: () => this.nbSetBlockType(i, 'code') },
            { ico: 'sigma', label: 'Formule maths', fn: () => this.nbSetBlockType(i, 'math') },
            { ico: 'listOrdered', label: 'Liste numérotée', fn: () => this.nbSetBlockType(i, 'num') },
            { ico: 'chevronRight', label: 'Bascule (replie ses sous-lignes)', fn: () => this.nbSetBlockType(i, 'toggle') },
            { ico: 'toc', label: 'Sommaire de la note', fn: () => this.nbInsertAfter(i, [{ t: 'toc' }, { t: 'p', x: '' }]) },
            { sep: true },
            { ico: 'calendar', label: 'Insérer la date du jour', fn: () => this.nbInsertText(i, new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) },
            { ico: 'clock', label: 'Insérer l\'heure', fn: () => this.nbInsertText(i, new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })) },
            { ico: 'search', label: 'Rechercher / remplacer dans la note', fn: () => this.nbFindToggle() },
            { sep: true },
            { ico: 'chevronUp', label: 'Monter la ligne · Alt+↑', fn: () => this.nbMoveStep(i, -1) },
            { ico: 'chevronDown', label: 'Descendre la ligne · Alt+↓', fn: () => this.nbMoveStep(i, 1) }], btn);
        else if (act === 'img') this.nbPickImage(i);
    },
    /* add an image : from the device, from a link, or found on Wikimedia Commons (free licences) */
    async nbImageFromFile(i, f) {
        if (!f || !/^image\//.test(f.type)) { this.toast('Ce fichier n\'est pas une image.', 'warning'); return false; }
        try { const ref = this.addMedia(await this.compressImage(f)); this.nbInsertAfter(Math.min(i, this.note(this.ui.note).b.length - 1), [{ t: 'img', src: ref }, { t: 'p', x: '' }]); return true; }
        catch { this.toast('Impossible de lire cette image.', 'error'); return false; }
    },
    async nbImageFromUrl(i, url) {
        try { const r = await fetch(url); if (!r.ok) throw new Error('http'); const blob = await r.blob(); return await this.nbImageFromFile(i, new File([blob], 'image', { type: blob.type || 'image/jpeg' })); }
        catch { this.toast('Ce site ne permet pas de copier l\'image. Enregistre-la puis utilise « Télécharger ».', 'warning'); return false; }
    },
    nbPickImage(i) {
        let tab = 'up';
        const m = this.openModal({ title: `${ic('image')} Ajouter une image`, size: 'narrow',
            body: `<div class="imgp-zone" id="imgp-zone">${ic('image')}<span>Insérer une URL d'image, ou glisser-déposer une image</span></div>
                <div class="chip-row imgp-tabs" id="imgp-tabs"><button class="chip active" data-t="up">${ic('export')}Télécharger</button><button class="chip" data-t="url">${ic('link')}Intégrer un lien</button><button class="chip" data-t="web">${ic('search')}Recherche d'images</button></div>
                <div id="imgp-body"></div>`, foot: `<button class="btn btn-soft" data-close>Fermer</button>` });
        const body = $('#imgp-body', m), done = ok => { if (ok) this.closeModal(m); };
        const paint = () => {
            if (tab === 'up') body.innerHTML = `<button class="btn btn-primary btn-block" id="imgp-file">${ic('image')}Choisir une image sur cet appareil</button><p class="help">Tu peux aussi glisser une image ici, ou la coller (Ctrl+V) dans la note.</p>`;
            else if (tab === 'url') body.innerHTML = `<div class="row-gap"><input class="input" id="imgp-url" placeholder="https://…/image.jpg" autocomplete="off" inputmode="url" style="flex:1"><button class="btn btn-primary" id="imgp-urlgo">Insérer</button></div><p class="help">L'image est copiée dans ta note (elle reste disponible hors ligne).</p>`;
            else body.innerHTML = `<div class="row-gap"><input class="input" id="imgp-q" placeholder="Rechercher des images…" autocomplete="off" enterkeyhint="search" style="flex:1"><button class="btn btn-primary" id="imgp-qgo">${ic('search')}</button></div><div class="imgp-grid" id="imgp-grid"></div><p class="help">Images libres de Wikimedia Commons. Vérifie la licence si tu publies ta note.</p>`;
        };
        const search = async () => {
            const q = $('#imgp-q', m).value.trim(), grid = $('#imgp-grid', m); if (!q) return;
            if (!navigator.onLine) { grid.innerHTML = '<p class="help">Pas de connexion.</p>'; return; }
            grid.innerHTML = '<p class="help">Recherche…</p>';
            try {
                const r = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q + ' filetype:bitmap')}&gsrnamespace=6&gsrlimit=24&prop=imageinfo&iiprop=url&iiurlwidth=480&format=json&origin=*`), j = await r.json();
                const pages = Object.values((j.query && j.query.pages) || {}).filter(p => p.imageinfo && p.imageinfo[0] && p.imageinfo[0].thumburl);
                grid.innerHTML = pages.length ? pages.map(p => `<button class="imgp-th" data-u="${esc(p.imageinfo[0].thumburl)}" title="${esc(String(p.title).replace(/^File:/, ''))}"><img src="${esc(p.imageinfo[0].thumburl)}" alt="" loading="lazy"></button>`).join('') : '<p class="help">Aucune image trouvée.</p>';
            } catch { grid.innerHTML = '<p class="help">La recherche d\'images n\'a pas répondu. Réessaie plus tard.</p>'; }
        };
        $('#imgp-tabs', m).addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; tab = b.dataset.t; $$('#imgp-tabs .chip', m).forEach(c => c.classList.toggle('active', c === b)); paint(); const f = $('#imgp-url, #imgp-q', m); if (f) f.focus(); });
        m.addEventListener('click', async e => {
            if (e.target.closest('#imgp-file')) { const input = $('#hidden-file'); input.accept = 'image/*'; input.value = ''; input.onchange = async () => done(await this.nbImageFromFile(i, input.files[0])); input.click(); }
            else if (e.target.closest('#imgp-urlgo')) { const u = $('#imgp-url', m).value.trim(); if (/^https?:\/\//i.test(u)) done(await this.nbImageFromUrl(i, u)); else this.toast('Colle une adresse qui commence par https://', 'warning'); }
            else if (e.target.closest('#imgp-qgo')) search();
            else { const th = e.target.closest('.imgp-th'); if (th) done(await this.nbImageFromUrl(i, th.dataset.u)); }
        });
        m.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'imgp-q') { e.preventDefault(); search(); } else if (e.key === 'Enter' && e.target.id === 'imgp-url') { e.preventDefault(); $('#imgp-urlgo', m).click(); } });
        const zone = $('#imgp-zone', m); ['dragover', 'dragenter'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('over'); })); zone.addEventListener('dragleave', () => zone.classList.remove('over'));
        zone.addEventListener('drop', async e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) done(await this.nbImageFromFile(i, f)); else { const u = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'); if (/^https?:\/\//i.test(u)) done(await this.nbImageFromUrl(i, u.trim())); } });
        zone.addEventListener('click', () => { tab = 'url'; $$('#imgp-tabs .chip', m).forEach(c => c.classList.toggle('active', c.dataset.t === 'url')); paint(); const f = $('#imgp-url', m); if (f) f.focus(); });
        paint();
    },

    /* ---------- events ---------- */
    nbBind(root = $('#view-notes')) {
        if (root._nb) return; root._nb = true;
        const blocks = () => $('#nb-blocks');
        const idx = el => { const r = el.closest('.nb'); return r ? Number(r.dataset.i) : -1; };
        root.addEventListener('click', e => {
            const n = this.note(this.ui.note); if (!n) return;
            const k = e.target.closest('[data-nbk]'), row = e.target.closest('.nb'), sug = e.target.closest('[data-sug]');
            const link = e.target.closest('.nb-link');
            if (link && !link.closest('.nb-t')) {
                e.preventDefault();
                if (link.dataset.pdf) { this.pdfOpen(link.dataset.pdf, { pid: link.dataset.pid || '', from: this.view === 'pdf' ? 'keep' : 'notes' }); return; }
                if (link.dataset.nbc) { if (this.card(link.dataset.nbc)) this.openCardModal(link.dataset.nbc); else this.toast('Cette carte n\'existe plus.', 'warning'); }
                else { const hit = this.noteByTitle(link.dataset.nbt); this.noteOpen((hit || this.noteNew(link.dataset.nbt)).id, { focus: hit ? '' : 'end' }); }
                return;
            }
            if (!k && !row) return;
            const i = row ? Number(row.dataset.i) : n.b.length - 1, b = n.b[i], kind = k ? k.dataset.nbk : 'row';
            if (kind === 'chk') { this.nbPush(); b.done = !b.done; this.nbChanged(); row.classList.toggle('done', b.done); k.classList.toggle('on', b.done); k.innerHTML = b.done ? ic('check') : ''; k.setAttribute('aria-pressed', String(b.done)); }
            else if (kind === 'bul') { if (Date.now() - (this._nbDragEnd || 0) < 450) return; if (this.nbHasKids(n.b, i)) { this.nbPush(); b.c = !b.c; this.nbChanged(); this.nbRender(); } else this.nbActivate(i, 'end'); }
            else if (kind === 'cmenu') this.nbCardMenu(k, i);
            else if (kind === 'cprev') this.nbCardPreview(k, i);
            else if (kind === 'cvalid') this.nbCardValidate(i);
            else if (kind === 'cdel') this.nbCardDelete(i);
            else if (kind === 'tmenu') this.nbTableMenu(k, i);
            else if (kind === 'trow') this.nbOp(() => { b.rows.push(b.rows[0].map(() => '')); }, null);
            else if (kind === 'tcol') { if (b.rows[0].length >= 8) this.toast('8 colonnes au maximum.', 'warning'); else this.nbOp(() => { b.rows.forEach(r => r.push('')); }, null); }
            else if (kind === 'tcards') this.nbTableCards(i);
            else if (kind === 'calk') this.nbMenu([['info', 'Information', 'info'], ['tip', 'Astuce', 'sparkle'], ['warn', 'Attention', 'alert'], ['def', 'Définition', 'book']].map(([k2, label, ico]) => ({ ico, label, on: b.k === k2, fn: () => this.nbOp(() => { b.k = k2; }, i, 'end') })), k);
            else if (kind === 'toc') { const el = this.nbEl(Number(k.dataset.to)); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
            else if (kind === 'ok') { this.nbPush(); const ow = this.nbCardOwners(n)[i], mx = ow >= 0 && n.b[ow].cd.mx; if (!b.ok && !mx) { for (let j = ow + 1; j < this.nbSubEnd(n.b, ow); j++) delete n.b[j].ok; } b.ok = !b.ok; if (ow >= 0) n.b[ow].cd.sg = ''; this.nbChanged(); if (ow >= 0) for (let j = ow + 1; j < this.nbSubEnd(n.b, ow); j++) { const bt = $('.nb-okb', this.nbEl(j)); if (bt) { bt.classList.toggle('on', !!n.b[j].ok); bt.innerHTML = n.b[j].ok ? ic('check') : ''; bt.setAttribute('aria-pressed', String(!!n.b[j].ok)); } } this.nbCardFlushLater(); }
            else if (kind === 'imgx') { this.nbOp(nn => { nn.b.splice(i, 1); if (!nn.b.length) nn.b.push(nbEmpty()); }, null); }
            else if (kind === 'tail') { const last = n.b[n.b.length - 1]; if (last.t === 'p' && !last.x) this.nbActivate(n.b.length - 1, 'end'); else if (nbSolid(last.t) || last.x) this.nbOp(nn => { nn.b.push({ t: 'p', x: '', d: 0 }); }, n.b.length); else this.nbActivate(n.b.length - 1, 'end'); }
            else if (b && !nbSolid(b.t) && !e.target.closest('.nb-t, .nbc-ain, button')) this.nbActivate(i, 'end');
        });
        root.addEventListener('beforeinput', e => {
            const t = e.target.closest && e.target.closest('.nb-t'); if (!t) return;
            const i = idx(t);
            if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') { e.preventDefault(); this.nbSuggestClose(); const bb = this.note(this.ui.note).b[i]; if (bb.cd && bb.cd.k === 'basic') { const v = $('.nbc-ain', this.nbEl(i)); if (v) { v.focus(); return; } } if (!this.nbAutoCard(i)) this.nbSplit(i); }
            else if (e.inputType === 'historyUndo') { e.preventDefault(); this.nbUndo(); }
            else if (e.inputType === 'historyRedo') { e.preventDefault(); this.nbUndo(true); }
            else if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop') { e.preventDefault(); const dt = e.dataTransfer, imgf = dt && [...(dt.files || [])].find(f => /^image\//.test(f.type)); if (imgf) this.nbImageFromFile(i, imgf); else this.nbPaste(i, dt ? dt.getData('text/plain') : ''); }
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
        root.addEventListener('input', e => {
            const a = e.target.closest && e.target.closest('.nbc-ain'), c = e.target.closest && e.target.closest('[data-nbt]');
            if (!a && !c) return; const n = this.note(this.ui.note), i = idx(e.target); if (!n || !n.b[i]) return;
            if (a) { if (!this.nb.burst || Date.now() - this.nb.burst > 1200) this.nbPush(); this.nb.burst = Date.now(); n.b[i].cd.a = a.value; this.nbChanged(); }
            else { const [r, cc] = c.dataset.nbt.split(',').map(Number); if (!this.nb.burst || Date.now() - this.nb.burst > 1200) this.nbPush(); this.nb.burst = Date.now(); n.b[i].rows[r][cc] = c.value; this.nbChanged(); }
        });
        root.addEventListener('keydown', e => {
            const va = e.target.closest && e.target.closest('.nbc-ain');
            if (va) {
                const i = idx(va), n = this.note(this.ui.note);
                if (e.key === 'Enter') { e.preventDefault(); const cb = n.b[i], again = cb && cb.cd && cb.cd.k === 'basic' && (cb.x.trim() || va.value.trim()); this.nbInsertAfter(i, [again ? { t: 'p', x: '', cd: this.nbCdNew('basic') } : { t: 'p', x: '' }]); }
                else if (e.key === 'Backspace' && !va.value) { e.preventDefault(); this.nbActivate(i, 'end'); }
                else if (e.key === 'ArrowUp' || (e.key === 'ArrowLeft' && va.selectionStart === 0 && va.selectionEnd === 0)) { e.preventDefault(); this.nbActivate(i, 'end'); }
                return;
            }
            const tc = e.target.closest && e.target.closest('[data-nbt]');
            if (tc) {
                const i = idx(tc), n = this.note(this.ui.note), [r, cc] = tc.dataset.nbt.split(',').map(Number), rows = n.b[i].rows;
                if (e.key === 'Tab') { e.preventDefault(); const W = rows[0].length; let nr = r, nc = cc + (e.shiftKey ? -1 : 1); if (nc >= W) { nc = 0; nr++; } else if (nc < 0) { nc = W - 1; nr--; } if (nr < 0) return; if (nr >= rows.length) this.nbOp(nn => { nn.b[i].rows.push(rows[0].map(() => '')); }, null); const nx = $(`.nb[data-i="${i}"] [data-nbt="${nr},${nc}"]`); if (nx) nx.focus(); }
                else if (e.key === 'Enter') { e.preventDefault(); if (r + 1 >= rows.length) { this.nbOp(nn => { nn.b[i].rows.push(rows[0].map(() => '')); }, null); } const nx = $(`.nb[data-i="${i}"] [data-nbt="${Math.min(r + 1, n.b[i].rows.length - 1)},${cc}"]`); if (nx) nx.focus(); }
                else if (e.key === 'Backspace' && !tc.value && rows.length === 1 && rows[0].length === 1) { e.preventDefault(); this.nbOp(nn => { nn.b.splice(i, 1); if (!nn.b.length) nn.b.push(nbEmpty()); }, null); }
                return;
            }
            if (e.target.id === 'nb-title') { if (e.key === 'Enter') { e.preventDefault(); const n = this.note(this.ui.note); if (n) this.nbActivate(0, 'start'); } return; }
            const t = e.target.closest && e.target.closest('.nb-t'); if (!t) return;
            const n = this.note(this.ui.note), i = idx(t), mod = e.ctrlKey || e.metaKey;
            if (this.nb.sug && ['ArrowDown', 'ArrowUp'].includes(e.key)) { /* the suggestions are tapped or clicked */ }
            if (e.key === 'Escape') { if (this.nb.sug) { this.nbSuggestClose(); e.preventDefault(); } return; }
            if (e.key === 'Enter' && this.nb.sug && !e.shiftKey) { e.preventDefault(); this.nbSuggestPick(0); return; }
            if (e.key === 'Tab') { e.preventDefault(); this.nbIndent(i, e.shiftKey ? -1 : 1); return; }
            if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); this.nbMoveStep(i, e.key === 'ArrowUp' ? -1 : 1); return; }
            if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); this.nbWrap('**'); return; }
            if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); this.nbWrap('*'); return; }
            if (mod && e.key.toLowerCase() === 'u') { e.preventDefault(); this.nbWrap('__'); return; }
            if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); this.nbFindToggle(); return; }
            if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); this.nbUndo(e.shiftKey); return; }
            if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.nbUndo(true); return; }
            if (e.key === 'Backspace') { const c = this.nbCaret(t); if (c.s === 0 && c.e === 0 && this.nbBackspace(i)) e.preventDefault(); return; }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                const c = this.nbCaret(t), vis = this.nbVisible(n), at = vis.indexOf(i);
                if (e.key === 'ArrowUp' && c.s === 0 && at > 0) { e.preventDefault(); this.nbActivate(vis[at - 1], 'end'); }
                else if (e.key === 'ArrowDown' && c.e === t.textContent.length && at >= 0 && at < vis.length - 1) { e.preventDefault(); this.nbActivate(vis[at + 1], 'start'); }
            }
        });
        root.addEventListener('beforeinput', e => {   // phone keyboards: Backspace at the very start of an empty card line
            const t = e.target.closest && e.target.closest('.nb-t'); if (!t || e.inputType !== 'deleteContentBackward') return;
            const c = this.nbCaret(t); if (c.s === 0 && c.e === 0 && this.nbBackspace(idx(t))) e.preventDefault();
        });
        root.addEventListener('focusin', e => {
            const t = e.target.closest && e.target.closest('.nb-t, .nbc-ain, .nb-table input'); if (!t) return;
            this.nb.last = idx(t); if (!t.classList.contains('nb-t')) { this.nbDeactivate(); this.nb.active = -1; }
            if (t.dataset && t.dataset.nbt) { const [r, c] = t.dataset.nbt.split(',').map(Number); this.nb.cell = { i: idx(t), r, c }; }
            document.body.classList.add('nb-editing'); this.nbPlaceBar();
        });
        root.addEventListener('focusout', () => setTimeout(() => this.nbIdle(), 80));
        root.addEventListener('change', e => { if (e.target.id === 'nb-title') { const n = this.note(this.ui.note); if (n) { this.nbPush(); this.noteRename(n, e.target.value); e.target.value = n.title; this.nbRefreshList(); } } });
        root.addEventListener('input', e => {
            if (e.target.id === 'nb-search') { this.ui.noteQ = e.target.value; this.nbRefreshList(); }
        });
        if (!this._nbDocBound) {   // once for the whole page (the PDF's note binds its own editor too : the bar must not react twice)
            this._nbDocBound = true;
        document.addEventListener('pointerdown', e => { if (e.target.closest('.nb-bar, .nb-suggest, .nb-menu')) e.preventDefault(); });
        document.addEventListener('click', e => {
            const b = e.target.closest('.nb-bar [data-nb]'); if (b) { this.nbBar(b.dataset.nb, b); return; }
            const s = e.target.closest('.nb-suggest [data-sug]'); if (s) { this.nbSuggestPick(Number(s.dataset.sug)); return; }
            if (!e.target.closest('.nb-menu, .nb-sel, [data-action=nb-more]')) this.nbMenuClose();
        });
        }
        /* title: double-click (or double-tap) to rename */
        const editTitle = on => { const t = $('#nb-title'); if (!t) return; t.readOnly = !on; if (on) { t.focus(); t.select(); } };
        root.addEventListener('dblclick', e => { if (e.target.id === 'nb-title') editTitle(true); });
        root.addEventListener('pointerup', e => { if (e.target.id === 'nb-title' && e.pointerType === 'touch') { const now = Date.now(); if (now - (this._tt || 0) < 380) editTitle(true); this._tt = now; } });
        root.addEventListener('focusout', e => { if (e.target.id === 'nb-title' && e.target.value.trim()) e.target.readOnly = true; });
        /* tags and search inside the note */
        root.addEventListener('keydown', e => {
            if (e.target.id === 'nb-tag-in' && (e.key === 'Enter' || e.key === ',' || e.key === ' ')) { e.preventDefault(); const v = e.target.value; e.target.value = ''; this.nbTagAdd(v); }
            else if (e.target.id === 'nb-findin') { if (e.key === 'Enter') { e.preventDefault(); this.nbFindStep(e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') this.nbFindToggle(); }
        });
        root.addEventListener('change', e => { if (e.target.id === 'nb-tag-in' && e.target.value.trim()) { const v = e.target.value; e.target.value = ''; this.nbTagAdd(v); } });
        root.addEventListener('input', e => { if (e.target.id === 'nb-findin') this.nbFindUpdate(); });
        /* drag and drop (grip of a note, bullet of a line) and a long press to select several notes */
        root.addEventListener('pointerdown', e => {
            if (e.button) return;
            if (e.target.closest('.nb-okb, .nb-chk, .nbc-arrow, .nbc-prev') && document.body.classList.contains('nb-editing')) e.preventDefault();   // keep the keyboard open
            const g = e.target.closest('.nb-grip');
            if (g) { const w = g.closest('.nb-wrap'); if (w) { e.preventDefault(); this.nbListDrag(e, w); } return; }
            const bul = e.target.closest('.nb-bul');
            if (bul && this.note(this.ui.note)) { const row = bul.closest('.nb'); if (row) this.nbBlockDrag(e, Number(row.dataset.i)); return; }
        });
        if (!this._nbDocBound2) {
            this._nbDocBound2 = true;
            document.addEventListener('touchmove', e => { if (this._dragging) e.preventDefault(); }, { passive: false });
            const place = () => this.nbPlaceBar();
            if (window.visualViewport) { visualViewport.addEventListener('resize', place); visualViewport.addEventListener('scroll', place); }
            window.addEventListener('resize', place);
        }
    },
});