/* ============================================================
   Notes (suite) : la liste en arbre (dossiers = paquets, sous-notes repliables, épinglées en haut),
   le tri, le glisser-déposer, la sélection multiple, le glisser sur une ligne pour agir, les menus,
   les tags, l'emoji, les modèles, l'export, les infos et la recherche dans une note.
   ============================================================ */
const NB_EMOJIS = ['📘', '📗', '📙', '📕', '📒', '📝', '🧠', '💡', '🎯', '⭐', '🔥', '✅', '📌', '📚', '🎓', '✏️', '🧪', '🔬', '💼', '📈', '💰', '⚖️', '🌍', '🗣️', '🇬🇧', '🎧', '🩺', '🏠', '🎨', '🎵', '🚀', '❤️'];
const NB_SORT_KEYS = ['manual', 'alpha', 'recent', 'created'];
const NB_TEMPLATES = [
    { name: 'Cours', emoji: '📘', title: 'Cours du ', blocks: [['h2', 'Objectifs'], ['p', ''], ['h2', 'Notions clés'], ['p', ''], ['h2', 'À retenir'], ['p', ''], ['h2', 'Questions'], ['todo', '']] },
    { name: 'Résumé de chapitre', emoji: '📝', title: 'Résumé : ', blocks: [['h2', 'Idée principale'], ['p', ''], ['h2', 'Plan du chapitre'], ['p', ''], ['p', '', 1], ['h2', 'Définitions'], ['p', ''], ['h2', 'Exemples'], ['p', '']] },
    { name: 'Fiche de révision', emoji: '🎯', title: 'Fiche : ', blocks: [['h2', 'À savoir par cœur'], ['p', ''], ['h2', 'Pièges à éviter'], ['p', ''], ['h2', 'Mes cartes'], ['p', 'Question >> Réponse']] },
    { name: 'To-do de la semaine', emoji: '✅', title: 'Semaine du ', blocks: [['h2', 'Cette semaine'], ['todo', ''], ['h2', 'Examens et rendus'], ['todo', ''], ['h2', 'Si j\'ai le temps'], ['todo', '']] }
];

Object.assign(SuperAnki.prototype, {
    /* ---------- device preferences (sort, folded branches) ---------- */
    nbPrefs() {
        if (!this._nbp) { try { this._nbp = JSON.parse(localStorage.getItem('lh_nbui') || '{}') || {}; } catch { this._nbp = {}; } this._nbp.sort = this._nbp.sort || 'recent'; this._nbp.closed = this._nbp.closed || {}; }
        return this._nbp;
    },
    nbPrefSave() { try { localStorage.setItem('lh_nbui', JSON.stringify(this._nbp)); } catch { /* ignore */ } },

    /* ---------- the tree ---------- */
    nbSortList(list) {
        const m = this.nbPrefs().sort, a = list.slice();
        if (m === 'manual') a.sort((x, y) => x.order - y.order || x.created - y.created);
        else if (m === 'created') a.sort((x, y) => y.created - x.created);
        else if (m === 'alpha') a.sort((x, y) => String(x.title || 'zzz').localeCompare(String(y.title || 'zzz'), 'fr', { sensitivity: 'base' }));
        else a.sort((x, y) => y.mod - x.mod || y.created - x.created);
        return a;
    },
    noteKids(id) { return this.nbSortList(this.data.notes.filter(n => n.parent === id)); },
    noteDescendants(id) { const out = []; const walk = p => this.data.notes.forEach(n => { if (n.parent === p && !out.includes(n.id)) { out.push(n.id); walk(n.id); } }); walk(id); return out; },
    notePathLabel(n) {
        const parts = []; let p = n.parent && this.note(n.parent), guard = 0;
        while (p && guard++ < 20) { parts.unshift(`${p.emoji || ''} ${this.noteName(p)}`.trim()); p = p.parent && this.note(p.parent); }
        const dk = n.deckId && this.deck(n.deckId);
        return [dk ? `${dk.emoji} ${this.deckPath(dk.id)}` : '', ...parts].filter(Boolean).join(' › ');
    },
    noteTagCounts() { const m = new Map(); this.data.notes.forEach(n => n.tags.forEach(t => m.set(t, (m.get(t) || 0) + 1))); return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); },
    nbRows() {
        const ui = this.ui, P = this.nbPrefs(), notes = this.data.notes, q = fold((ui.noteQ || '').trim()), rows = [];
        if (q || ui.noteFav || ui.noteTag || (ui.noteType && ui.noteType !== 'all')) {
            const tag = (ui.noteTag || '').toLowerCase();
            let list = notes.filter(n => (!ui.noteFav || n.fav) && (!ui.noteType || ui.noteType === 'all' || (ui.noteType === 'pdf') === !!this.pdfOfNote(n.id)) && (!tag || n.tags.some(t => t.toLowerCase() === tag)) && (!q || fold(n.title).includes(q) || fold(noteText(n)).includes(q)));
            this.nbSortList(list).forEach(n => rows.push({ kind: 'note', n, depth: 0, flat: true }));
            return rows;
        }
        const addNote = (n, depth) => {
            const kids = this.noteKids(n.id).filter(k => !k.pin);
            rows.push({ kind: 'note', n, depth, kids: kids.length, open: !P.closed[n.id] });
            if (!P.closed[n.id]) kids.forEach(k => addNote(k, depth + 1));
        };
        const pinned = this.nbSortList(notes.filter(n => n.pin));
        if (pinned.length) { rows.push({ kind: 'head', label: 'Épinglées' }); pinned.forEach(n => addNote(n, 0)); }
        const top = id => this.nbSortList(notes.filter(n => !n.parent && !n.pin && n.deckId === id));
        const hasNotes = id => this.descendantIds(id).some(d => notes.some(n => n.deckId === d && !n.pin));
        const addDeck = (d, depth) => {
            if (!hasNotes(d.id)) return;
            rows.push({ kind: 'folder', d, depth, open: !P.closed[d.id], count: notes.filter(n => n.deckId === d.id).length });
            if (P.closed[d.id]) return;
            top(d.id).forEach(n => addNote(n, depth + 1));
            this.childrenOf(d.id).filter(c => !c.pdf).sort((a, b) => a.name.localeCompare(b.name)).forEach(c => addDeck(c, depth + 1));
        };
        const before = rows.length;
        this.data.decks.filter(d => !d.parent && !d.pdf).sort((a, b) => a.name.localeCompare(b.name)).forEach(d => addDeck(d, 0));
        const loose = top('');
        if (loose.length) { if (rows.length > before || pinned.length) rows.push({ kind: 'head', label: rows.length > before ? 'Sans dossier' : 'Notes' }); loose.forEach(n => addNote(n, 0)); }
        return rows;
    },
    nbRowHtml(r) {
        const ui = this.ui, sel = ui.noteSelMode;
        if (r.kind === 'head') return `<div class="nb-headrow">${esc(r.label)}</div>`;
        if (r.kind === 'folder') {
            const d = r.d;
            return `<div class="nb-wrap" data-kind="folder" data-id="${esc(d.id)}"><div class="nb-row nb-folder" style="--d:${r.depth}"><button class="nb-fold" data-action="nb-fold" data-id="${esc(d.id)}" aria-label="${r.open ? 'Replier' : 'Déplier'}">${ic(r.open ? 'chevronDown' : 'chevronRight')}</button><span class="nb-row-ico">${esc(d.emoji)}</span><span class="nb-row-t" data-action="nb-folder" data-id="${esc(d.id)}" title="Ouvrir la page du dossier"><b>${esc(d.name)}</b><small>${plural(r.count, 'note')}</small></span><button class="icon-btn icon-btn-sm" data-action="nb-new-in" data-deck="${esc(d.id)}" title="Nouvelle note dans ce dossier" aria-label="Nouvelle note dans ce dossier">${ic('plus')}</button></div></div>`;
        }
        const n = r.n, first = n.b.find(b => b.x && b.t !== 'hr' && b.t !== 'img'), when = new Date(n.mod || n.created).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
        const sub = r.flat ? this.notePathLabel(n) || (first ? first.x : '') : (first ? first.x.replace(NB_LINK, (m, i) => i.replace(/^c:[^|]+\|/, '')) : 'Note vide');
        const checked = ui.noteSel && ui.noteSel.has(n.id), pf = this.pdfOfNote(n.id);
        return `<div class="nb-wrap" data-kind="note" data-id="${esc(n.id)}"><div class="nb-row ${n.id === ui.note ? 'on' : ''} ${checked ? 'selected' : ''}" data-action="nb-open" data-id="${esc(n.id)}" data-kind="note" style="--d:${r.depth}">
            ${sel ? `<span class="row-check ${checked ? 'on' : ''}">${checked ? ic('check') : ''}</span>` : ''}
            ${r.kids ? `<button class="nb-fold" data-action="nb-fold" data-id="${esc(n.id)}" aria-label="${r.open ? 'Replier' : 'Déplier'}">${ic(r.open ? 'chevronDown' : 'chevronRight')}</button>` : '<span class="nb-fold none"></span>'}
            <span class="nb-row-ico ${pf ? 'nb-row-pdf' : ''}">${pf ? ic('pdf') : n.emoji ? esc(n.emoji) : ic(n.daily ? 'calendar' : 'notebook')}</span>
            <span class="nb-row-t"><b>${esc(this.noteName(n))}</b><small>${pf ? esc(this.pdfSubline(pf)) : esc(truncate(sub, 80))}</small>${n.tags.length ? `<span class="nb-tagline">${n.tags.slice(0, 3).map(t => `<i>#${esc(t)}</i>`).join('')}${n.tags.length > 3 ? `<i>+${n.tags.length - 3}</i>` : ''}</span>` : ''}</span>
            <span class="nb-row-d">${n.pin ? ic('pin', 'nb-pin') : ''}${n.fav ? ic('star', 'i-fill') : ''}<small>${when}</small></span>
            <button class="icon-btn icon-btn-sm nb-more-row" data-action="nb-row-menu" data-id="${esc(n.id)}" aria-label="Plus d'actions">${ic('more')}</button>
            ${sel || r.flat ? '' : `<span class="nb-grip" data-action="nb-noop" title="Glisser pour déplacer" aria-label="Glisser pour déplacer">${ic('grip')}</span>`}
        </div></div>`;
    },
    noteListHtml() {
        const rows = this.nbRows(), ui = this.ui;
        if (!rows.length) return `<p class="small faint" style="padding:14px 4px">${ui.noteQ ? 'Aucune note ne correspond.' : ui.noteFav ? 'Aucune note favorite.' : ui.noteTag ? 'Aucune note avec ce tag.' : 'Aucune note pour l\'instant. Crée la première, ouvre la note du jour ou pars d\'un modèle.'}</p>`;
        return rows.map(r => this.nbRowHtml(r)).join('');
    },
    nbChipsHtml() {
        const ui = this.ui, tags = this.noteTagCounts().slice(0, 14);
        const nPdf = this.data.pdfs.length, ty = ui.noteType || 'all', none = !ui.noteFav && !ui.noteTag, tc = (k, label, n) => `<button class="chip ${none && ty === k ? 'active' : ''}" data-action="nb-filter" data-kind="type" data-t="${k}">${label} <span class="count">${n}</span></button>`;
        return `<button class="chip ${ui.noteFav ? 'active' : ''}" data-action="nb-filter" data-kind="fav">${ic('star', 'i-fill')} Favoris <span class="count">${this.data.notes.filter(x => x.fav).length}</span></button>${tc('all', 'Tout', this.data.notes.length)}${tc('note', ic('notebook') + ' Notes', this.data.notes.length - nPdf)}${tc('pdf', ic('pdf') + ' PDF', nPdf)}${tags.map(([t, c]) => `<button class="chip ${ui.noteTag && ui.noteTag.toLowerCase() === t.toLowerCase() ? 'active' : ''}" data-action="nb-filter" data-kind="tag" data-tag="${esc(t)}">#${esc(t)} <span class="count">${c}</span></button>`).join('')}`;
    },
    nbBulkHtml() {
        const ui = this.ui; if (!ui.noteSelMode) return '';
        const n = ui.noteSel ? ui.noteSel.size : 0, all = this.nbRows().filter(r => r.kind === 'note'), allOn = all.length && ui.noteSel && all.every(r => ui.noteSel.has(r.n.id));
        const b = (act, ico, label, cls = '') => `<button class="nbb ${cls}" data-action="nb-bulk" data-act="${act}" ${n ? '' : 'disabled'} title="${label}" aria-label="${label}">${ic(ico)}<span>${label}</span></button>`;
        return `<div class="nb-bulk"><div class="nbb-top"><button class="icon-btn icon-btn-sm" data-action="nb-sel-exit" title="Quitter la sélection" aria-label="Quitter la sélection">${ic('x')}</button><b>${n ? plural(n, 'sélectionnée', 'sélectionnées') : 'Rien de sélectionné'}</b><button class="btn btn-soft btn-sm" data-action="nb-sel-all">${allOn ? 'Aucune' : 'Tout'}</button></div>
            <div class="nbb-row">${b('move', 'folder', 'Déplacer')}${b('pin', 'pin', 'Épingler')}${b('del', 'trash', 'Supprimer', 'danger')}</div></div>`;
    },
    nbRefreshList() {
        const l = $('#nb-list'); if (l) l.innerHTML = this.noteListHtml();
        const c = $('#nb-chips'); if (c) c.innerHTML = this.nbChipsHtml();
        const b = $('#nb-bulk'); if (b) b.innerHTML = this.nbBulkHtml();
        const ht = $('#nb-headtools'); if (ht) ht.innerHTML = this.nbHeadToolsHtml();
        const lt = $('#nb-lp-title'); if (lt) lt.textContent = this.nbListTitle();
        const sb = $('#nb-sortbtn'); if (sb) sb.innerHTML = this.nbSortLabel();
    },
    nbSortLabel() { return this.sortLabel(this.nbPrefs().sort); },

    /* ---------- screen ---------- */
    renderNotes() {
        const ui = this.ui, n = this.note(ui.note);
        if (ui.note && !n) ui.note = null;
        const open = !!(n || ui.nbFolder || ui.nbMem);
        if (open && ui.noteSelMode) { ui.noteSelMode = false; ui.noteSel = new Set(); }
        const searchRow = `<div class="nb-searchrow"><label class="input-icon">${ic('search')}<input class="input" id="nb-search" type="search" placeholder="Rechercher une note, un PDF…" value="${esc(ui.noteQ || '')}" autocomplete="off" enterkeyhint="search"></label></div>`;
        const tools = `<span class="nb-tools"><button class="btn btn-soft sort-btn" data-action="nb-sort-menu" id="nb-sortbtn" aria-label="Trier" title="Trier">${this.nbSortLabel()}</button><button class="btn btn-soft ${ui.noteSelMode ? 'on' : ''}" data-action="nb-sel-toggle" aria-label="Sélectionner plusieurs" title="Sélectionner plusieurs">${ic('checkSq')}<span>Sélection</span></button></span>`;
        const side = open ? `
            <aside class="notes-side panel">
                <div class="notes-side-head"><h2 class="page-title" style="margin:0">Notes</h2>
                    <span class="row-gap"><button class="btn btn-soft" data-action="pdf-import-btn" title="Importer un PDF">${ic('pdf')}<span>PDF</span></button><button class="btn btn-primary nb-newbig" data-action="nb-new-menu" id="nb-newbtn">${ic('plus')}<span>Nouveau</span>${ic('chevronDown')}</button></span></div>
                <div class="nb-searchrow"><label class="input-icon">${ic('search')}<input class="input" id="nb-search" type="search" placeholder="Rechercher une note, un PDF…" value="${esc(ui.noteQ || '')}" autocomplete="off" enterkeyhint="search"></label>${tools}</div>
                <div class="chip-row nb-chips" id="nb-chips">${this.nbChipsHtml()}</div>
                <div id="nb-bulk">${this.nbBulkHtml()}</div>
                <div id="nb-list" class="nb-tree">${this.noteListHtml()}</div>
            </aside>` : `
            <aside class="notes-side nb-page">
                <div class="stats-head">
                    <div><h2 class="page-title">Notes</h2><p class="page-sub">Tes cours, tes PDF et tes cartes au même endroit.</p></div>
                    <div class="head-tools" id="nb-headtools">${this.nbHeadToolsHtml()}</div>
                </div>
                <div class="decks-toolbar" id="nb-home">${this.nbHomeHtml()}</div>
                <div class="panel search-bar nb-searchpanel">${searchRow}</div>
                <div class="panel nb-listpanel">
                    <div class="chip-row nb-chips nb-lp-chips" id="nb-chips">${this.nbChipsHtml()}</div>
                    <div class="nb-lp-head"><b id="nb-lp-title">${this.nbListTitle()}</b>${tools}</div>
                    <div id="nb-bulk">${this.nbBulkHtml()}</div>
                    <div id="nb-list" class="nb-tree">${this.noteListHtml()}</div>
                </div>
            </aside>`;
        $('#view-notes').innerHTML = `
        <div class="notes-shell ${open ? 'has-open' : ''} ${this.nbPrefs().sideOff ? 'side-off' : ''}">${side}
            <section class="notes-main">${this.nbMainHtml(n)}</section>
        </div>`;
        this.nbBind(); this.nbBarEnsure(!!n);
        if (n) { this.resolveMedia($('#nb-blocks')); this.nbFindUpdate(); }
    },
    nbListTitle() {
        const ui = this.ui, nn = this.data.notes.length, np = this.data.pdfs.length;
        if (ui.noteQ) return 'Résultats';
        if (ui.noteFav) return 'Favoris';
        if (ui.noteTag) return '#' + ui.noteTag;
        return ui.noteType === 'pdf' ? plural(np, 'PDF') : ui.noteType === 'note' ? plural(nn - np, 'note') : 'Mes documents';
    },
    noteEditorHtml(n) {
        const back = this.nb && this.nb.back.length ? this.note(this.nb.back[this.nb.back.length - 1]) : null, bl = this.noteBacklinks(n), kids = this.noteKids(n.id);
        const crumbs = this.notePathLabel(n), st = this.noteStats(n);
        return `<div class="panel nb-editor" data-id="${esc(n.id)}">
            <div class="nb-head">
                <button class="icon-btn" data-action="nb-close" title="${back ? `Retour à « ${esc(this.noteName(back))} »` : 'Retour à la liste'}" aria-label="Retour">${ic('arrowLeft')}</button>
                <button class="nb-emoji" data-action="nb-emoji" title="Choisir l'emoji de la note" aria-label="Emoji de la note">${n.emoji ? esc(n.emoji) : ic('notebook')}</button>
                <input class="nb-title" id="nb-title" maxlength="120" placeholder="Titre de la note" title="Double-clique (ou double-tape) pour renommer" value="${esc(n.title)}" ${n.title ? 'readonly' : ''} autocomplete="off" enterkeyhint="next">
                <button class="icon-btn nb-sidebtn ${this.nbPrefs().sideOff ? '' : 'on'}" data-action="nb-side" title="${this.nbPrefs().sideOff ? 'Afficher la liste des notes' : 'Masquer la liste des notes'}" aria-label="Liste des notes">${ic('sidebar')}</button>
                <button class="icon-btn" data-action="nb-find" title="Chercher dans la note (Ctrl+F)" aria-label="Chercher dans la note">${ic('search')}</button>
                <button class="icon-btn ${n.fav ? 'nb-fav on' : 'nb-fav'}" data-action="nb-fav" title="Favori" aria-label="Favori">${ic('star', n.fav ? 'i-fill' : '')}</button>
                <button class="icon-btn" data-action="nb-more" title="Plus d'actions" aria-label="Plus d'actions">${ic('more')}</button>
            </div>
            ${crumbs || n.daily ? `<p class="nb-crumbs">${n.daily ? ic('calendar') + ' Note du jour' : ''}${n.daily && crumbs ? ' · ' : ''}${esc(crumbs)}</p>` : ''}
            <div class="nb-findbar hidden" id="nb-findbar"><input class="input" id="nb-findin" placeholder="Rechercher dans la note…" autocomplete="off"><span class="small muted" id="nb-findcount"></span><button class="icon-btn icon-btn-sm" data-action="nb-find-step" data-d="-1" aria-label="Précédent">${ic('chevronLeft')}</button><button class="icon-btn icon-btn-sm" data-action="nb-find-step" data-d="1" aria-label="Suivant">${ic('chevronRight')}</button><button class="icon-btn icon-btn-sm" data-action="nb-find" aria-label="Fermer">${ic('x')}</button></div>
            <div class="nb-tags" id="nb-tags">${this.nbTagsHtml(n)}</div>
            <div class="nb-blocks" id="nb-blocks">${this.nbBlocksHtml(n)}</div>
            <p class="nb-stats small faint" id="nb-stats">${st}</p>
            <div class="nb-subs" id="nb-subs">${this.nbSubsHtml(n, kids)}</div>
            <div class="nb-back" id="nb-backlinks">${this.nbBacklinksHtml(n, bl)}</div>
        </div>`;
    },
    nbTagsHtml(n) {
        return `${n.tags.map(t => `<span class="nb-tag">#${esc(t)}<button data-action="nb-tag-del" data-tag="${esc(t)}" aria-label="Retirer le tag ${esc(t)}">${ic('x')}</button></span>`).join('')}<input class="nb-tag-in" id="nb-tag-in" list="nb-taglist" placeholder="${n.tags.length ? '+ tag' : '+ Ajouter un tag (#cours, #examen…)'}" maxlength="30" autocomplete="off" enterkeyhint="done"><datalist id="nb-taglist">${this.noteTagCounts().filter(([t]) => !n.tags.includes(t)).map(([t]) => `<option value="${esc(t)}">`).join('')}</datalist>`;
    },
    nbSubsHtml(n, kids = this.noteKids(n.id)) {
        return `<h4>Sous-notes${kids.length ? ` (${kids.length})` : ''}</h4>${kids.map(k => `<button class="nb-bl" data-action="nb-open" data-id="${esc(k.id)}"><span class="nb-row-ico">${k.emoji ? esc(k.emoji) : ic('notebook')}</span><span><b>${esc(this.noteName(k))}</b><small>${esc(truncate((k.b.find(b => b.x) || { x: 'Note vide' }).x, 80))}</small></span></button>`).join('')}<button class="btn btn-soft btn-sm" data-action="nb-new-sub" data-id="${esc(n.id)}" style="margin-top:6px">${ic('plus')}Ajouter une sous-note</button>`;
    },
    noteStats(n) { const words = noteText({ b: n.b, tags: [] }).split(/\s+/).filter(Boolean).length; return `${plural(words, 'mot')} · ${Math.max(1, Math.round(words / 200))} min de lecture`; },

    /* ---------- creating, moving, deleting ---------- */
    noteNewFrom(tpl, ctx = {}) {
        const dateTxt = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
        const title = tpl ? (/ $|: $/.test(tpl.title) ? tpl.title + (/du |de la /.test(tpl.title) ? dateTxt : '') : tpl.title).trim() : '';
        const b = tpl ? tpl.blocks.map(([t, x, d]) => ({ t, x, d: d || 0 })) : null;
        const n = this.noteNew(title, { b, emoji: tpl ? tpl.emoji : '', deckId: ctx.deckId || '', parent: ctx.parent || '' });
        if (ctx.parent) { const P = this.nbPrefs(); delete P.closed[ctx.parent]; this.nbPrefSave(); }
        this.noteOpen(n.id, { focus: title ? 'end' : 'title' });
        return n;
    },
    /* where does a dragged / moved note go: under a note, in a folder, before or after another note */
    noteMoveTo(ids, dest, ref = null, pos = 'into') {
        const moving = ids.filter(id => this.note(id) && !(dest.parent && (dest.parent === id || this.noteDescendants(id).includes(dest.parent))));
        if (!moving.length) return 0;
        const deckOf = dest.parent ? this.note(dest.parent).deckId : (dest.deckId || '');
        this.nbPrefs();
        moving.forEach(id => { const n = this.note(id); n.parent = dest.parent || ''; n.deckId = deckOf; this.noteDescendants(id).forEach(d => { this.note(d).deckId = deckOf; }); [id, ...this.noteDescendants(id)].forEach(x => { this.nbCardsFollow(this.note(x)); const pf = this.pdfOfNote(x); if (pf) this.pdfMove(pf, deckOf); }); });   // the cards of a moved note follow it to its new folder
        /* the order among the new neighbours */
        const list = this.nbSortList(this.data.notes.filter(x => (x.parent || '') === (dest.parent || '') && x.deckId === deckOf && !moving.includes(x.id)));
        let at = list.length;
        if (ref && pos !== 'into') { const k = list.findIndex(x => x.id === ref); if (k >= 0) at = pos === 'before' ? k : k + 1; }
        list.splice(at, 0, ...moving.map(id => this.note(id)));
        list.forEach((x, k) => { x.order = (k + 1) * 10; });
        return moving.length;
    },
    async noteDeleteMany(ids) {
        const pfs = ids.map(id => this.pdfOfNote(id)).filter(Boolean);
        if (pfs.length) { ids = ids.filter(id => !this.pdfOfNote(id)); for (const pf of pfs) await this.pdfDeleteAsk(pf); if (!ids.length) return; }
        const all = new Set(); ids.forEach(id => { if (this.note(id)) { all.add(id); this.noteDescendants(id).forEach(d => all.add(d)); } });
        if (!all.size) return;
        const extra = all.size - ids.length;
        if (extra > 0 && !(await this.confirm({ title: 'Supprimer aussi les sous-notes ?', message: `${ids.length > 1 ? 'Ces notes contiennent' : 'Cette note contient'} ${plural(extra, 'sous-note')} qui ${extra > 1 ? 'seront supprimées' : 'sera supprimée'} avec ${ids.length > 1 ? 'elles' : 'elle'}. Tu pourras annuler juste après.`, ok: 'Supprimer', danger: true }))) return;
        this.nbIdle(true);
        const order = [...all];
        this.data.notes = this.data.notes.filter(x => !all.has(x.id));
        this.save();
        if (all.has(this.ui.note)) { this.ui.note = null; if (this.nb) this.nb.back = []; }
        if (this.ui.noteSel) this.ui.noteSel.clear();
        if (this.view === 'notes') this.renderNotes();
        this.toast(all.size > 1 ? `${plural(all.size, 'note')} supprimées` : 'Note supprimée', 'success', ic('trash'), { label: 'Annuler', fn: () => { order.forEach(id => this.trashRestore('note', id)); if (this.view === 'notes') this.renderNotes(); } });
    },
    noteDelete(id) { return this.noteDeleteMany([id]); },
    noteDuplicate(id) {
        const n = this.note(id); if (!n) return;
        const copy = JSON.parse(JSON.stringify(n)); copy.b.forEach(b => { if (b.cd) { b.cd.id = uid('b'); b.cd.cid = []; b.cd.qid = ''; b.cd.sg = ''; b.cd.hm = []; b.cd.dead = false; } if (b.t === 'table') b.id = uid('b'); });   // the copy gets its own cards
        const c = normalizeNote({ ...copy, id: uid('n'), title: `${n.title || 'Sans titre'} (copie)`, daily: '', pin: false, created: Date.now(), mod: 0, order: n.order + 1 });
        this.data.notes.push(c); this.nbCardSyncAll(c); this.save(); this.noteOpen(c.id);
        this.toast('Note dupliquée', 'success', ic('copy'));
    },
    noteExport(n) {
        const text = this.noteAsText(n), blob = new Blob([text + '\n'], { type: 'text/markdown' }), a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = `${(n.title || 'note').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'note'}.md`;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        this.toast('Note exportée (.md)', 'success', ic('export'));
    },
    async noteShare(n) {
        const text = this.noteAsText(n);
        if (navigator.share) { try { await navigator.share({ title: this.noteName(n), text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
        try { await navigator.clipboard.writeText(text); this.toast('Texte copié (le partage n\'est pas disponible ici)', 'success', ic('copy')); } catch { this.toast('Partage impossible ici.', 'warning'); }
    },
    noteInfo(n) {
        const fmt = t => (t ? new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
        const links = this.noteLinks(n).length, bl = this.noteBacklinks(n).length, kids = this.noteDescendants(n.id).length, cards = this.noteLinks(n).filter(l => l.k === 'card').length;
        const rows = [['Dossier', esc(n.deckId ? this.deckPath(n.deckId) : 'Sans dossier')], ['Créée le', fmt(n.created)], ['Modifiée le', fmt(n.mod)], ['Contenu', this.noteStats(n)], ['Liens sortants', `${links}${cards ? ` (dont ${plural(cards, 'carte')})` : ''}`], ['Rétroliens', String(bl)], ['Sous-notes', String(kids)], ['Tags', n.tags.length ? esc(n.tags.map(t => '#' + t).join(' ')) : '-']];
        this.openModal({ title: 'Informations sur la note', size: 'narrow', body: rows.map(([k, v]) => `<div class="set-row"><div class="txt"><b>${k}</b></div><span>${v}</span></div>`).join('') });
    },
    openNoteMove(ids) {
        const first = this.note(ids[0]); if (!first) return;
        const blocked = new Set(); ids.forEach(id => { blocked.add(id); this.noteDescendants(id).forEach(d => blocked.add(d)); });
        const m = this.openModal({
            title: ids.length > 1 ? `Déplacer ${ids.length} notes` : 'Déplacer la note', size: 'narrow',
            body: `<label class="input-icon" style="display:block;margin-bottom:8px">${ic('search')}<input class="input" id="nm-q" placeholder="Rechercher un dossier ou une note…" autocomplete="off"></label><div class="pick-list" id="nm-list"></div>`
        });
        const paint = () => {
            const q = fold($('#nm-q', m).value.trim());
            const items = [{ k: 'deck', id: '', label: '🗂️ Sans dossier', depth: 0 }, ...this.sortedDecks().filter(d => !d.pdf).map(d => ({ k: 'deck', id: d.id, label: `${d.emoji} ${d.name}`, depth: this.deckChain(d.id).length - 1 })),
                ...this.nbSortList(this.data.notes.filter(x => !blocked.has(x.id))).map(x => ({ k: 'note', id: x.id, label: `${x.emoji || '📄'} ${this.noteName(x)}`, depth: 0, sub: this.notePathLabel(x) }))];
            $('#nm-list', m).innerHTML = items.filter(i => !q || fold(i.label + (i.sub || '')).includes(q)).slice(0, 80).map(i => `<button class="pick-item ${(i.k === 'deck' && !first.parent && i.id === first.deckId) || (i.k === 'note' && i.id === first.parent) ? 'active' : ''}" data-k="${i.k}" data-id="${esc(i.id)}" style="padding-left:${12 + i.depth * 14}px">${esc(i.label)}${i.k === 'note' ? ` <span class="faint small">· sous-note${i.sub ? ' · ' + esc(truncate(i.sub, 30)) : ''}</span>` : ''}</button>`).join('') || '<p class="small faint">Rien ne correspond.</p>';
        };
        paint(); $('#nm-q', m).addEventListener('input', paint);
        m.addEventListener('click', e => {
            const b = e.target.closest('[data-k]'); if (!b) return;
            const n = this.noteMoveTo(ids, b.dataset.k === 'note' ? { parent: b.dataset.id } : { deckId: b.dataset.id });
            this.closeModal(m); this.save();
            if (b.dataset.k === 'note') { const P = this.nbPrefs(); delete P.closed[b.dataset.id]; this.nbPrefSave(); }
            if (this.view === 'notes') this.renderNotes();
            this.toast(n ? `${n > 1 ? plural(n, 'note déplacée', 'notes déplacées') : 'Note déplacée'}` : 'Déplacement impossible', n ? 'success' : 'warning', ic('folder'));
        });
    },
    openNoteEmoji() {
        const n = this.note(this.ui.note); if (!n) return;
        const m = this.openModal({ title: 'Emoji de la note', size: 'narrow', body: `<div class="emoji-grid">${NB_EMOJIS.map(e => `<button type="button" class="${e === n.emoji ? 'active' : ''}" data-e="${e}" aria-label="${e}">${e}</button>`).join('')}</div><button class="btn btn-soft btn-block" data-e="" style="margin-top:12px">${ic('x')}Aucun emoji</button>` });
        m.addEventListener('click', e => { const b = e.target.closest('[data-e]'); if (!b) return; n.emoji = b.dataset.e; this.save(); this.closeModal(m); this.renderNotes(); });
    },

    /* ---------- menus ---------- */
    nbNoteMenu(anchor, id, extra = []) {
        const n = this.note(id); if (!n) return;
        const pf = this.pdfOfNote(n.id);
        this.showMenu(anchor, [
            ...extra,
            ...(pf ? [{ icon: 'pdf', label: 'Ouvrir le PDF', fn: () => this.pdfOpen(pf.id, { from: 'notes' }) }, { icon: 'export', label: 'Exporter le PDF annoté', fn: () => this.pdfExportAnnotated(pf) }, { icon: 'export', label: 'Exporter l\'original', fn: () => this.pdfExportOriginal(pf) }, { sep: true }] : []),
            { icon: 'pin', label: n.pin ? 'Désépingler' : 'Épingler en haut', fn: () => { n.pin = !n.pin; this.save(); this.renderNotes(); } },
            { icon: 'star', label: n.fav ? 'Retirer des favoris' : 'Ajouter aux favoris', fn: () => { n.fav = !n.fav; this.save(); this.renderNotes(); } },
            { sep: true },
            { icon: 'plus', label: 'Ajouter une sous-note', fn: () => this.noteNewFrom(null, { parent: n.id }) },
            ...(pf ? [] : [{ icon: 'sparkle', label: 'Cartes avec l\'IA…', fn: () => this.aiNoteCards(n.id) }, { icon: 'sparkle', label: 'Résumé avec l\'IA…', fn: () => this.aiSummary(n.id) }, { icon: 'sparkle', label: 'Discuter avec cette note (IA)…', fn: () => this.aiChat(n.id) }]),
            { icon: 'copy', label: 'Dupliquer', fn: () => this.noteDuplicate(n.id) },
            { icon: 'folder', label: 'Déplacer…', fn: () => this.openNoteMove([n.id]) },
            { sep: true },
            { icon: 'export', label: 'Exporter en Markdown (.md)', fn: () => this.noteExport(n) },
            { icon: 'cloud', label: 'Partager…', fn: () => this.noteShare(n) },
            { icon: 'file', label: 'Copier le texte', fn: () => { navigator.clipboard && navigator.clipboard.writeText(this.noteAsText(n)).then(() => this.toast('Texte copié', 'success', ic('copy'))).catch(() => this.toast('Copie impossible ici.', 'warning')); } },
            { icon: 'info', label: 'Informations', fn: () => this.noteInfo(n) },
            { sep: true },
            { icon: 'trash', label: 'Supprimer', danger: true, fn: () => this.noteDeleteMany([n.id]) }
        ]);
    },
    nbNewMenu(anchor, ctx = {}) {
        this.showMenu(anchor, [
            { icon: 'plus', label: 'Note vide', fn: () => this.noteNewFrom(null, ctx) },
            { icon: 'pdf', label: 'Importer un PDF…', fn: () => this.pdfPick(ctx.deckId || '') },
            { sep: true },
            ...NB_TEMPLATES.map(t => ({ icon: 'file', label: `${t.emoji} ${t.name}`, fn: () => this.noteNewFrom(t, ctx) })),
            { sep: true },
            { icon: 'folderPlus', label: 'Nouveau dossier (paquet)…', fn: () => this.openDeckModal() }
        ]);
    },
    nbSortMenu(anchor) { this.sortMenu(anchor, NB_SORT_KEYS, this.nbPrefs().sort, k => { this.nbPrefs().sort = k; this.nbPrefSave(); this.nbRefreshList(); }); },

    /* ---------- tags ---------- */
    nbTagAdd(raw) {
        const n = this.note(this.ui.note); if (!n) return;
        const add = String(raw).split(/[,\s]+/).filter(Boolean);
        if (!add.length) return;
        const norm = normalizeNote({ ...n, tags: [...n.tags, ...add] });
        if (norm.tags.length === n.tags.length) return;
        n.tags = norm.tags; this.save(); $('#nb-tags').innerHTML = this.nbTagsHtml(n); this.nbRefreshList();
        const i = $('#nb-tag-in'); if (i) i.focus();
    },

    /* ---------- search inside the note ---------- */
    nbFindToggle() {
        const bar = $('#nb-findbar'); if (!bar) return;
        const on = bar.classList.contains('hidden');
        bar.classList.toggle('hidden', !on);
        if (on) { const i = $('#nb-findin'); i.focus(); i.select(); } else { this.nb.find = null; this.nbRender(); }
    },
    nbFindUpdate() {
        const i = $('#nb-findin'), n = this.note(this.ui.note); if (!i || !n) return;
        const q = i.value.trim(); this.nb.find = q ? { q, at: this.nb.find && this.nb.find.q === q ? this.nb.find.at : 0 } : null;
        const hits = []; if (q) n.b.forEach((b, k) => { const m = b.x.toLowerCase().split(q.toLowerCase()).length - 1; for (let j = 0; j < m; j++) hits.push(k); });
        $('#nb-findcount').textContent = q ? (hits.length ? `${(this.nb.find.at % hits.length) + 1}/${hits.length}` : 'aucun') : '';
        this.nb.hits = hits;
        const box = $('#nb-blocks'); if (box && this.nb.active < 0) { box.innerHTML = this.nbBlocksHtml(n); this.resolveMedia(box); }
        if (hits.length) { const row = this.nbEl(hits[this.nb.find.at % hits.length]); if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    },
    nbFindStep(d) { if (!this.nb.find || !this.nb.hits.length) return; this.nb.find.at = (this.nb.find.at + d + this.nb.hits.length) % this.nb.hits.length; this.nbFindUpdate(); },

    /* ---------- drag and drop: notes in the list ---------- */
    nbListDrag(e, wrap) {
        const id = wrap.dataset.id, row = wrap.querySelector('.nb-row'), x0 = e.clientX, y0 = e.clientY, bad = new Set([id, ...this.noteDescendants(id)]);
        let ghost = null, moved = false, tgt = null, pos = '';
        const clear = () => $$('.dz-before, .dz-after, .dz-into').forEach(x => x.classList.remove('dz-before', 'dz-after', 'dz-into'));
        const mv = ev => {
            if (!moved) {
                if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
                moved = true; this._dragging = true; document.body.classList.add('nb-dragging'); wrap.classList.add('dragging');
                ghost = row.cloneNode(true); ghost.classList.add('nb-ghost'); ghost.style.width = row.offsetWidth + 'px'; ghost.style.left = row.getBoundingClientRect().left + 'px'; document.body.appendChild(ghost);
            }
            ev.preventDefault();
            ghost.style.top = `${ev.clientY - 22}px`;
            if (ev.clientY < 90) window.scrollBy(0, -14); else if (ev.clientY > innerHeight - 90) window.scrollBy(0, 14);
            clear(); tgt = null;
            const el = document.elementFromPoint(ev.clientX, ev.clientY), tw = el && el.closest ? el.closest('.nb-wrap') : null;
            if (!tw || bad.has(tw.dataset.id)) return;
            const r = tw.getBoundingClientRect(), k = (ev.clientY - r.top) / r.height;
            pos = tw.dataset.kind === 'folder' ? 'into' : k < .28 ? 'before' : k > .72 ? 'after' : 'into';
            tgt = tw; tw.classList.add(`dz-${pos}`);
        };
        const up = () => {
            window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
            clear(); if (ghost) ghost.remove(); wrap.classList.remove('dragging'); document.body.classList.remove('nb-dragging');
            this._dragging = false;
            if (!moved) return;
            this._nbDragEnd = Date.now();
            if (!tgt) return;
            const kind = tgt.dataset.kind, ref = tgt.dataset.id, t = kind === 'note' ? this.note(ref) : null;
            let dest;
            if (kind === 'folder') dest = { deckId: ref };
            else if (pos === 'into') dest = { parent: ref };
            else dest = { parent: t.parent, deckId: t.deckId };
            if (kind === 'note' && pos !== 'into' && this.nbPrefs().sort !== 'manual') { this.nbPrefs().sort = 'manual'; this.nbPrefSave(); this.toast('Tri : Mon ordre', 'success', ic('list')); }
            if (pos === 'into' && kind === 'note') { const P = this.nbPrefs(); delete P.closed[ref]; this.nbPrefSave(); }
            if (kind === 'folder') { const P = this.nbPrefs(); delete P.closed[ref]; this.nbPrefSave(); }
            const done = this.noteMoveTo([id], dest, kind === 'note' ? ref : null, pos);
            if (done) { this.save(); this.nbRefreshList(); } else this.toast('Déplacement impossible', 'warning');
        };
        window.addEventListener('pointermove', mv, { passive: false }); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    },

    /* ---------- drag and drop: lines of a note (by the bullet) ---------- */
    nbBlockDrag(e, i) {
        const touch = e.pointerType === 'touch', x0 = e.clientX, y0 = e.clientY;
        let armed = !touch, moved = false, ghost = null, tgt = -1, pos = '', hold = null;
        const n = this.note(this.ui.note), end = this.nbSubEnd(n.b, i);
        const clear = () => $$('#nb-blocks .dz-before, #nb-blocks .dz-after').forEach(x => x.classList.remove('dz-before', 'dz-after'));
        if (touch) hold = setTimeout(() => { armed = true; this._dragging = true; if (navigator.vibrate) navigator.vibrate(8); }, 280);
        const mv = ev => {
            if (!armed) { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) cleanup(); return; }
            if (!moved) {
                if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
                moved = true; this._dragging = true; this.nbDeactivate(); document.body.classList.add('nb-dragging');
                const row = this.nbEl(i); ghost = document.createElement('div'); ghost.className = 'nb-ghost nb-ghost-b'; ghost.textContent = n.b[i].x || '…'; ghost.style.left = row.getBoundingClientRect().left + 'px'; ghost.style.width = row.offsetWidth + 'px'; document.body.appendChild(ghost);
                for (let k = i; k < end; k++) { const r = this.nbEl(k); if (r) r.classList.add('dragging'); }
            }
            ev.preventDefault();
            ghost.style.top = `${ev.clientY - 18}px`;
            if (ev.clientY < 90) window.scrollBy(0, -14); else if (ev.clientY > innerHeight - 90) window.scrollBy(0, 14);
            clear(); tgt = -1;
            const el = document.elementFromPoint(ev.clientX, ev.clientY), r = el && el.closest ? el.closest('#nb-blocks .nb') : null;
            if (!r) return;
            const k = Number(r.dataset.i); if (k >= i && k < end) return;
            const bb = r.getBoundingClientRect(); pos = ev.clientY < bb.top + bb.height / 2 ? 'before' : 'after'; tgt = k; r.classList.add(`dz-${pos}`);
        };
        const cleanup = () => { clearTimeout(hold); window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
        const up = () => {
            cleanup(); clear(); if (ghost) ghost.remove(); document.body.classList.remove('nb-dragging'); this._dragging = false;
            $$('#nb-blocks .dragging').forEach(x => x.classList.remove('dragging'));
            if (!moved) return;
            this._nbDragEnd = Date.now();
            if (tgt >= 0) this.nbMoveRange(i, tgt, pos);
        };
        window.addEventListener('pointermove', mv, { passive: false }); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    },
    /* moves the line i (with its sub-lines) before / after the line `to`; it takes the level of the line it lands next to */
    nbMoveRange(i, to, pos) {
        const n = this.note(this.ui.note), end = this.nbSubEnd(n.b, i), len = end - i;
        let at = pos === 'before' ? to : this.nbSubEnd(n.b, to);
        if (at >= i && at <= end) return;
        const delta = n.b[to].d - n.b[i].d;
        this.nbOp(nn => {
            const seg = nn.b.splice(i, len); seg.forEach(b => { b.d = clamp(b.d + delta, 0, NB_MAX_DEPTH); });
            if (at > i) at -= len;
            nn.b.splice(at, 0, ...seg);
        }, at);
    },
    /* up / down: swap with the neighbour of the same level (Alt + ↑ ↓, or the ↑ ↓ buttons) */
    nbMoveStep(i, dir) {
        const n = this.note(this.ui.note), b = n.b, d = b[i].d, end = this.nbSubEnd(b, i);
        if (dir < 0) {
            let j = i - 1; while (j >= 0 && b[j].d > d) j--;
            if (j < 0 || b[j].d < d) { this.toast('C\'est déjà la première ligne de ce niveau.', 'warning'); return; }
            this.nbMoveRange(i, j, 'before');
        } else {
            if (!b[end] || b[end].d < d) { this.toast('C\'est déjà la dernière ligne de ce niveau.', 'warning'); return; }
            this.nbMoveRange(i, end, 'after');
        }
    },
    nbWrap(tok, tok2 = tok) {
        const c = this.nbCurrent(); if (!c || c.b.t === 'hr' || c.b.t === 'img') return;
        const { i, b } = c; if (this.nb.active !== i) this.nbActivate(i, 'end');
        const t = $('.nb-t', this.nbEl(i)), { s, e } = this.nbCaret(t);
        this.nbPush(); b.x = b.x.slice(0, s) + tok + b.x.slice(s, e) + tok2 + b.x.slice(e);
        t.textContent = b.x; this.nbSetCaret(t, s !== e ? e + tok.length + tok2.length : s + tok.length); this.nbChanged(); t.focus();
    },

    /* ---------- actions ---------- */
    noteAction(action, el) {
        const ds = el.dataset || {}, ui = this.ui;
        const recent = () => Date.now() - (this._rowSwiped || 0) < 450 || Date.now() - (this._nbDragEnd || 0) < 450;
        if (action === 'nb-noop') return;
        if (action === 'nb-new') this.noteNewFrom(null, {});
        else if (action === 'nb-new-menu') this.nbNewMenu(el, {});
        else if (action === 'nb-new-in') this.noteNewFrom(null, { deckId: ds.deck });
        else if (action === 'nb-new-sub') this.noteNewFrom(null, { parent: ds.id });
        else if (action === 'nb-daily') this.noteDaily();
        else if (action === 'nb-open') {
            if (recent()) return;
            if (ui.noteSelMode) { ui.noteSel = ui.noteSel || new Set(); if (ui.noteSel.has(ds.id)) ui.noteSel.delete(ds.id); else ui.noteSel.add(ds.id); this.nbRefreshList(); return; }
            const pf = this.pdfOfNote(ds.id); if (pf) { this.pdfOpen(pf.id, { from: 'notes' }); return; }
            this.noteOpen(ds.id);
        }
        else if (action === 'nb-fold') { const P = this.nbPrefs(); if (P.closed[ds.id]) delete P.closed[ds.id]; else P.closed[ds.id] = 1; this.nbPrefSave(); this.nbRefreshList(); }
        else if (action === 'nb-side') { const P = this.nbPrefs(); P.sideOff = !P.sideOff; this.nbPrefSave(); const sh = $('.notes-shell'); if (sh) sh.classList.toggle('side-off', !!P.sideOff); const b = $('.nb-sidebtn'); if (b) { b.classList.toggle('on', !P.sideOff); b.title = P.sideOff ? 'Afficher la liste des notes' : 'Masquer la liste des notes'; } }
        else if (action === 'nb-close') {
            this.nbIdle(true); const back = this.nb && this.nb.back.pop();
            if (back && this.note(back)) { ui.note = back; this.nb.hist = []; this.nb.redo = []; } else ui.note = null;
            this.renderNotes();
        }
        else if (action === 'nb-fav') { const n = this.note(ui.note); if (n) { n.fav = !n.fav; this.save(); this.renderNotes(); } }
        else if (action === 'nb-filter') { ui.noteType = ds.kind === 'type' ? ds.t : 'all'; ui.noteFav = ds.kind === 'fav'; ui.noteTag = ds.kind === 'tag' ? (ui.noteTag && ui.noteTag.toLowerCase() === ds.tag.toLowerCase() ? '' : ds.tag) : ''; this.nbRefreshList(); }
        else if (action === 'nb-sort-menu') this.nbSortMenu(el);
        else if (action === 'nb-sel-toggle') { ui.noteSelMode = !ui.noteSelMode; ui.noteSel = new Set(); this.nbRefreshList(); const b = $('[data-action=nb-sel-toggle]'); if (b) { b.classList.toggle('btn-primary', ui.noteSelMode); b.classList.toggle('btn-soft', !ui.noteSelMode); } }
        else if (action === 'nb-sel-exit') { ui.noteSelMode = false; ui.noteSel = new Set(); this.nbRefreshList(); const b = $('[data-action=nb-sel-toggle]'); if (b) { b.classList.remove('btn-primary'); b.classList.add('btn-soft'); } }
        else if (action === 'nb-sel-all') { const all = this.nbRows().filter(r => r.kind === 'note').map(r => r.n.id); ui.noteSel = ui.noteSel && all.length && all.every(i => ui.noteSel.has(i)) ? new Set() : new Set(all); this.nbRefreshList(); }
        else if (action === 'nb-bulk') {
            const ids = [...(ui.noteSel || [])]; if (!ids.length) return;
            if (ds.act === 'del') this.noteDeleteMany(ids).then(() => { ui.noteSelMode = false; this.nbRefreshList(); });
            else if (ds.act === 'move') this.openNoteMove(ids);
            else if (ds.act === 'pin') { const all = ids.every(id => this.note(id).pin); ids.forEach(id => { this.note(id).pin = !all; }); this.save(); this.nbRefreshList(); this.toast(all ? 'Notes désépinglées' : 'Notes épinglées', 'success', ic('pin')); }
        }
        else if (action === 'nb-row-menu') this.nbNoteMenu(el, ds.id);
        else if (action === 'nb-swipe') {
            const n = this.note(ds.id); if (!n) return; if (this._closeRow) this._closeRow();
            if (ds.act === 'pin') { n.pin = !n.pin; this.save(); this.nbRefreshList(); }
            else if (ds.act === 'fav') { n.fav = !n.fav; this.save(); this.nbRefreshList(); }
            else if (ds.act === 'del') this.noteDeleteMany([n.id]);
        }
        else if (action === 'nb-emoji') this.openNoteEmoji();
        else if (action === 'nb-find') this.nbFindToggle();
        else if (action === 'nb-find-step') this.nbFindStep(Number(ds.d));
        else if (action === 'nb-tag-del') { const n = this.note(ui.note); if (n) { n.tags = n.tags.filter(t => t !== ds.tag); this.save(); $('#nb-tags').innerHTML = this.nbTagsHtml(n); this.nbRefreshList(); } }
        else if (action === 'nb-more') { const n = this.note(ui.note); if (n) this.nbNoteMenu(el, n.id); }
        else this.folderAction(action, el);
    }
});
