/* ============================================================
   Notes (dossiers) : « Documents et dossiers » — un dossier EST un paquet (avec ses sous-paquets) ;
   la page d'un dossier montre ses documents (notes), un gros bouton « S'entraîner · N à réviser »,
   le menu « + » (sous-dossier, examen…), l'avancement et les examens qui le concernent.
   La colonne latérale (en tête de l'onglet sur téléphone) : note du jour, cartes mémoire, documents, favoris, dossiers épinglés.
   ============================================================ */
const NB_ROOT = '__root';

Object.assign(SuperAnki.prototype, {
    /* the cards born in notes: of a note (and its sub-notes) */
    nbNoteCards(id) { const ids = new Set([id, ...this.noteDescendants(id)]); return this.data.cards.filter(c => c.src && ids.has(c.src.n)); },
    nbDueIn(cards) { const now = Date.now(), eod = endOfDay(now); return cards.filter(c => !c.suspended && !(c.buriedUntil > now) && ((c.state === 'review' && c.due <= eod) || ((c.state === 'learning' || c.state === 'relearning') && c.due <= now + LEARN_AHEAD))); },
    nbDueDeck(id) { const st = this.deckStats().get(id); return st ? st.due : 0; },
    nbDueAll() { return this.nbDueIn(this.data.cards).length; },
    notesInDeck(id, deep = false) { const set = new Set(deep ? this.descendantIds(id) : [id]); return this.data.notes.filter(n => set.has(n.deckId)); },

    /* ---------- « S'entraîner » ---------- */
    nbTrainBtn(scope, size = '') {
        const due = scope.note ? this.nbDueIn(this.nbNoteCards(scope.note)).length : this.nbDueDeck(scope.deck);
        const total = scope.note ? this.nbNoteCards(scope.note).length : this.cardsOf(scope.deck).length + this.descendantIds(scope.deck).slice(1).reduce((s, d) => s + this.cardsOf(d).length, 0);
        return `<span class="nb-train ${size}"><button class="btn btn-primary ${size}" data-action="nb-train" data-k="${scope.note ? 'note' : 'deck'}" data-id="${esc(scope.note || scope.deck)}" ${total ? '' : 'disabled'} title="${total ? '' : 'Aucune carte ici pour l\'instant'}">${ic('play')}S'entraîner${due ? ` · <b>${due}</b> à réviser` : total ? ' · à jour' : ''}</button><button class="btn btn-primary ${size} nb-train-more" data-action="nb-train-menu" data-k="${scope.note ? 'note' : 'deck'}" data-id="${esc(scope.note || scope.deck)}" aria-label="Autres façons de s'entraîner" ${total ? '' : 'disabled'}>${ic('chevronDown')}</button></span>`;
    },
    nbTrain(kind, id, mode = 'srs') {
        if (kind === 'deck') {
            const t = this.deck(id); if (!t) return;
            if (mode === 'srs') this.startStudy(id);
            else if (mode === 'free') this.handleAction('free-deck', { dataset: { deck: id } });
            else if (mode === 'ordered') this.handleAction('ordered-deck', { dataset: { deck: id } });
            else this.openModeLauncher(mode, id);
            return;
        }
        const n = this.note(id); if (!n) return;
        const cards = this.nbNoteCards(id), ids = cards.filter(c => !c.suspended).map(c => c.id), title = `${n.emoji || '📓'} ${this.noteName(n)}`;
        if (!ids.length) { this.toast('Cette note n\'a pas encore de carte : crée-en avec le bouton « Carte ».', 'warning'); return; }
        if (mode === 'srs') {
            const due = this.nbDueIn(cards).map(c => c.id);
            if (!due.length) { this.confirm({ title: 'Tout est à jour 🎉', message: 'Aucune carte de cette note n\'est à revoir maintenant. Veux-tu t\'entraîner quand même (sans impact sur le planning) ?', ok: 'Révision libre' }).then(y => { if (y) this.startPractice(null, 'flip', 9999, title, ids); }); return; }
            this.startSrsIds(title, due, false);
        } else if (mode === 'free') this.startPractice(null, 'flip', 9999, title, ids);
        else if (mode === 'ordered') this.startPractice(null, 'flip', 9999, title, [...ids].sort((a, b) => this.card(a).created - this.card(b).created), true);
        else if (mode === 'write') this.startPractice(null, 'type', 9999, title, ids);
        else if (mode === 'quiz') this.startQuizFromIds(ids, Math.min(ids.length, 20), 0, `Quiz · ${this.noteName(n)}`);
    },
    nbTrainMenu(anchor, kind, id) {
        const due = kind === 'note' ? this.nbDueIn(this.nbNoteCards(id)).length : this.nbDueDeck(id);
        const items = [
            { icon: 'play', label: `Réviser les cartes dues${due ? ` (${due})` : ''}`, fn: () => this.nbTrain(kind, id, 'srs') },
            { icon: 'repeat', label: 'Toutes les cartes (révision libre)', fn: () => this.nbTrain(kind, id, 'free') },
            { icon: 'list', label: 'Dans l\'ordre du cours', fn: () => this.nbTrain(kind, id, 'ordered') },
            { icon: 'quiz', label: 'Quiz (QCM)', fn: () => this.nbTrain(kind, id, kind === 'deck' ? 'quiz' : 'quiz') },
            { icon: 'keyboard', label: 'Écrire les réponses', fn: () => this.nbTrain(kind, id, kind === 'deck' ? 'write' : 'write') }
        ];
        if (kind === 'deck') items.push({ icon: 'link', label: 'Association', fn: () => this.nbTrain(kind, id, 'match') });
        this.showMenu(anchor, items);
    },

    /* ---------- the exam of a folder ---------- */
    nbExamModal(deckId) {
        const d = this.deck(deckId); if (!d) return;
        const m = this.openModal({
            title: 'Examen de ce dossier', size: 'narrow',
            body: `<p class="small muted" style="margin-bottom:12px">Une date d'examen pour « ${esc(d.name)} » : l'accueil affiche le compte à rebours et le <b>plan d'examen</b> te dit quoi réviser chaque jour pour arriver prêt.</p>
                <div class="field"><label class="label" for="ex-n">Nom</label><input class="input" id="ex-n" maxlength="60" value="${esc(d.name)}"></div>
                <div class="field"><label class="label" for="ex-d">Date de l'examen</label><input class="input" id="ex-d" type="date" min="${dayKey()}" value="${dayKey(addDays(Date.now(), 21))}"></div>`,
            foot: `<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="ex-go">${ic('check')}Créer l'examen</button>`
        });
        $('#ex-go', m).addEventListener('click', () => {
            const name = $('#ex-n', m).value.trim() || d.name, date = $('#ex-d', m).value;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { this.toast('Choisis la date de l\'examen.', 'warning'); return; }
            const cur = this.goalsRaw().map(g => { const { deck, ...rest } = g; return rest; });
            this.data.settings.goals = [...cur, { id: uid('g'), name, date, decks: [deckId] }]; this.data.settings.settingsMod = Date.now(); this.save();
            this.closeModal(m); this.renderNotes(); this.toast('Examen ajouté (visible sur l\'accueil)', 'success', ic('calendar'));
        });
    },
    nbExamsHtml(deckId) {
        const set = new Set(this.descendantIds(deckId)), list = this.goalsAll().filter(g => g.days >= 0 && g.decks.some(x => set.has(x)));
        if (!list.length) return '';
        return list.map(g => { const P = this.examPlan(g); return `<div class="nbf-exam ${g.days <= 7 ? 'soon' : ''}">${ic('calendar')}<div class="nbf-exam-t"><b>${esc(g.name)}</b><small>${g.days === 0 ? 'C\'est aujourd\'hui' : `Dans ${plural(g.days, 'jour')}`}${P && P.total ? ` · maîtrise prévue ${Math.round(P.mastery * 100)} %` : ''}</small></div>${P && P.todo && P.todo.length && !P.examDay ? `<button class="btn btn-primary btn-sm" data-action="exam-plan" data-mode="${P.lastRound ? 'last' : 'plan'}" data-id="${esc(g.id)}">${ic('target')}Plan du jour (${P.lastRound ? P.last.length : P.todo.length})</button>` : ''}<button class="link" data-action="goals-manage">Gérer</button></div>`; }).join('');
    },

    /* ---------- the page of a folder ---------- */
    nbFolderHtml(deckId) {
        const root = deckId === NB_ROOT, d = root ? null : this.deck(deckId);
        if (!root && !d) return '';
        const fs = this.ui.nbFSort === 'az' ? 'alpha' : this.ui.nbFSort === 'manual' ? 'manual' : 'recent';
        const direct = root ? this.data.notes.filter(n => !n.deckId) : this.notesInDeck(deckId, false);
        const subs = (root ? this.data.decks.filter(x => !x.parent) : this.childrenOf(deckId)).filter(x => !x.pdf).filter(x => this.notesInDeck(x.id, true).length || !root).sort((a, b) => a.name.localeCompare(b.name));
        const filter = this.ui.nbFType || 'all';
        const docs = direct.filter(n => filter === 'all' || (filter === 'pdf') === !!this.pdfOfNote(n.id)).sort(fs === 'alpha' ? (a, b) => this.noteName(a).localeCompare(this.noteName(b), 'fr', { sensitivity: 'base' }) : fs === 'manual' ? (a, b) => a.order - b.order || a.created - b.created : (a, b) => b.mod - a.mod || b.created - a.created);
        const st = d ? this.deckStats().get(d.id) : null, nNotes = root ? this.data.notes.length : this.notesInDeck(deckId, true).length;
        const folderCard = x => `<button class="nbf-fold" data-action="nb-folder" data-id="${esc(x.id)}"><span class="nbf-emoji">${esc(x.emoji)}</span><span class="nbf-ft"><b>${esc(x.name)}</b><small>${plural(this.notesInDeck(x.id, true).length, 'note')}${this.nbDueDeck(x.id) ? ` · <span style="color:var(--due)">${this.nbDueDeck(x.id)} à revoir</span>` : ''}</small></span>${ic('chevronRight', 'chev')}</button>`;
        const docRow = n => { const pf = this.pdfOfNote(n.id); return `<button class="nbf-doc" data-action="nb-open" data-id="${esc(n.id)}"><span class="nbf-dico">${pf ? ic('pdf') : n.emoji ? esc(n.emoji) : ic(n.daily ? 'calendar' : 'notebook')}</span><span class="nbf-dt"><b>${esc(this.noteName(n))}</b><small>${pf ? esc(this.pdfSubline(pf)) : ''}${pf ? '' : esc(truncate(n.parent ? this.notePathLabel(n).split(' › ').slice(-1)[0] + ' · ' : '', 40))}${esc(truncate(((n.b.find(b => b.x && b.t !== 'hr') || { x: 'Note vide' }).x), 70))}</small></span><span class="nbf-dd"><small>${this.nbNoteCards(n.id).length ? `${ic('card')} ${this.nbNoteCards(n.id).length}` : ''}</small><small>${new Date(n.mod || n.created).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</small></span></button>`; };
        const back = `<button class="icon-btn nbf-back" data-action="nb-folder-close" aria-label="Retour" title="Retour">${ic('arrowLeft')}</button>`;
        return `<div class="panel nb-folderpage" data-deck="${esc(root ? '' : deckId)}">
            <div class="nbf-head">${back}<span class="nbf-big">${root ? '🗂️' : esc(d.emoji)}</span><div class="nbf-title"><h2>${root ? 'Documents et dossiers' : esc(d.name)}</h2><p class="small faint">${root ? 'Tous tes dossiers (= tes paquets) et tes notes' : esc(this.deckPath(d.id))} · ${plural(nNotes, 'note')}${st ? ` · ${plural(st.total, 'carte')}` : ''}</p></div>
                ${d ? `<button class="icon-btn" data-action="deck-admin" data-deck="${esc(d.id)}" title="Options du dossier (paquet)" aria-label="Options du dossier">${ic('more')}</button>` : ''}</div>
            ${st && st.total ? `<div class="nbf-prog">${this.progressHtml(st, 'lg')}<small class="muted"><b>${this.pctSeen(st)} %</b> vu · <b>${this.pctMature(st)} %</b> maîtrisé${st.due ? ` · <b style="color:var(--due)">${st.due}</b> à revoir` : ''}</small></div>` : ''}
            <div class="nbf-actions">${d ? this.nbTrainBtn({ deck: d.id }) : `<button class="btn btn-primary" data-action="nb-mem">${ic('play')}Cartes mémoire${this.nbDueAll() ? ` · <b>${this.nbDueAll()}</b> à réviser` : ''}</button>`}
                <button class="btn btn-soft" data-action="nb-new-in" data-deck="${root ? '' : esc(deckId)}">${ic('plus')}Créer des notes</button>
                <button class="btn btn-soft nbf-plus" data-action="nb-folder-plus" data-deck="${root ? '' : esc(deckId)}" aria-label="Plus d'actions" title="Sous-dossier, examen, importer…">${ic('plus')}<span>Plus</span>${ic('chevronDown')}</button></div>
            ${d ? this.nbExamsHtml(deckId) : ''}
            ${subs.length ? `<div class="nbf-sub">${subs.map(folderCard).join('')}</div>` : ''}
            <div class="nbf-listhead"><h4>Documents${docs.length ? ` (${docs.length})` : ''}</h4>
                <span class="chip-row"><button class="chip ${filter === 'all' ? 'active' : ''}" data-action="nb-ftype" data-t="all">Tout</button><button class="chip ${filter === 'note' ? 'active' : ''}" data-action="nb-ftype" data-t="note">${ic('notebook')}Notes</button><button class="chip ${filter === 'pdf' ? 'active' : ''}" data-action="nb-ftype" data-t="pdf">${ic('pdf')}PDF</button></span>
                ${this.sortBtn('nb-fsort', fs)}</div>
            <div class="nbf-docs">${docs.length ? docs.map(docRow).join('') : `<p class="small faint" style="padding:12px 4px">Aucune note ${root ? 'sans dossier' : 'dans ce dossier'} pour l'instant. Touche « Créer des notes » pour commencer.</p>`}</div>
        </div>`;
    },
    nbFolderPlusMenu(anchor, deckId) {
        const d = deckId ? this.deck(deckId) : null;
        this.showMenu(anchor, [
            { icon: 'folderPlus', label: 'Sous-dossier (sous-paquet)', fn: () => this.handleAction('new-subdeck', { dataset: { deck: deckId } }) },
            { icon: 'pdf', label: 'Importer un PDF…', fn: () => this.pdfPick(deckId || '') },
            ...(d ? [{ icon: 'calendar', label: 'Examen…', fn: () => this.nbExamModal(deckId) }] : []),
            { icon: 'file', label: 'Note depuis un modèle', fn: e => this.nbNewMenu(anchor, { deckId }) },
            { icon: 'plus', label: 'Nouvelle carte (formulaire)', fn: () => this.openCardModal(null, deckId || undefined) },
            { icon: 'import', label: 'Importer des fiches…', fn: () => { this.ui.deck = deckId || 'all'; this.openImportModal(); } },
            ...(d ? [{ icon: 'layers', label: 'Voir les cartes du paquet', fn: () => { this.ui.deck = deckId; this.go('decks', { deck: deckId }); } }] : [])
        ]);
    },

    /* ---------- « Cartes mémoire » : everything to review ---------- */
    nbMemHtml() {
        const due = this.nbDueAll(), rows = this.sortedDecks().map(d => ({ d, due: this.nbDueDeck(d.id), n: this.notesInDeck(d.id, false).length })).filter(r => r.due || r.n).slice(0, 40);
        const fromNotes = this.data.cards.filter(c => c.src && this.note(c.src.n)).length;
        return `<div class="panel nb-folderpage">
            <div class="nbf-head"><button class="icon-btn nbf-back" data-action="nb-folder-close" aria-label="Retour">${ic('arrowLeft')}</button><span class="nbf-big">🃏</span><div class="nbf-title"><h2>Cartes mémoire</h2><p class="small faint">${plural(this.data.cards.length, 'carte')} · ${plural(fromNotes, 'carte')} viennent de tes notes</p></div></div>
            <div class="nbf-mem"><div class="nbf-memn"><b>${due}</b><span>à réviser maintenant</span></div><button class="btn btn-primary btn-lg" data-action="study" data-deck="" ${due ? '' : 'disabled'}>${ic('play')}Réviser maintenant</button></div>
            <div class="nbf-listhead"><h4>Par dossier</h4></div>
            <div class="nbf-docs">${rows.map(r => `<div class="nbf-doc nbf-memrow"><span class="nbf-dico">${esc(r.d.emoji)}</span><span class="nbf-dt"><b>${esc(this.deckPath(r.d.id))}</b><small>${plural(r.n, 'note')}</small></span>${r.due ? `<button class="btn btn-primary btn-sm" data-action="study" data-deck="${esc(r.d.id)}">${r.due} à revoir</button>` : '<small class="faint">À jour</small>'}<button class="icon-btn icon-btn-sm" data-action="nb-folder" data-id="${esc(r.d.id)}" aria-label="Ouvrir le dossier">${ic('chevronRight')}</button></div>`).join('') || '<p class="small faint">Aucun dossier pour l\'instant.</p>'}</div>
            <div class="nbf-actions" style="margin-top:12px"><button class="btn btn-soft" data-action="new-card">${ic('plus')}Nouvelle carte</button><button class="btn btn-soft" data-action="import">${ic('import')}Importer</button><button class="btn btn-soft" data-nav="decks">${ic('layers')}Toutes mes cartes</button></div>
        </div>`;
    },

    /* ---------- the side column ---------- */
    nbHomeHtml() {
        const ui = this.ui;
        return `<button class="btn btn-primary" data-action="nb-new-menu" id="nb-newbtn">${ic('plus')}<span>Nouvelle note</span></button>
            <button class="btn btn-soft" data-action="nb-daily">${ic('calendar')}<span>Note du jour</span></button>
            <button class="btn btn-soft" data-action="pdf-import-btn">${ic('pdf')}<span>Importer un PDF</span></button>`;
    },
    nbHeadToolsHtml() {
        const ui = this.ui, due = this.nbDueAll();
        return `<button class="icon-btn nb-hbtn ${ui.nbMem ? 'on' : ''}" data-action="nb-mem" title="Cartes mémoire${due ? ` (${due} à revoir)` : ''}" aria-label="Cartes mémoire">${ic('copy')}${due ? `<i class="nb-pill-badge">${due > 99 ? '99+' : due}</i>` : ''}</button>
            <button class="icon-btn nb-hbtn ${ui.nbFolder === NB_ROOT ? 'on' : ''}" data-action="nb-docs" title="Dossiers" aria-label="Dossiers">${ic('folder')}</button>
            <button class="icon-btn nb-hbtn" data-action="ai-assist" title="Assistant IA de mes cours" aria-label="Assistant IA">${ic('sparkle')}</button>
            <button class="icon-btn nb-hbtn" data-action="tool-trash" title="Corbeille (gardée 30 jours)" aria-label="Corbeille">${ic('trash')}</button>`;
    },
    nbMainHtml(n) {
        const ui = this.ui;
        if (n) return this.noteEditorHtml(n);
        if (ui.nbMem) return this.nbMemHtml();
        if (ui.nbFolder) return this.nbFolderHtml(ui.nbFolder) || this.nbEmptyHtml();
        return this.nbEmptyHtml();
    },
    nbEmptyHtml() {
        return `<div class="panel panel-pad nb-empty">${ic('notebook')}<h3>Tes notes</h3><p class="muted">Un plan en puces pour tes cours. Tape <code>[[</code> pour lier une note ou une carte, <code>question &gt;&gt; réponse</code> puis Entrée pour créer une carte, ou touche « Carte » dans la barre d'outils.</p><div class="row-gap" style="justify-content:center"><button class="btn btn-primary" data-action="nb-new">${ic('plus')}Nouvelle note</button><button class="btn btn-soft" data-action="nb-daily">${ic('calendar')}Note du jour</button><button class="btn btn-soft" data-action="nb-docs">${ic('layers')}Documents et dossiers</button></div></div>`;
    },
    folderAction(action, el) {
        const ds = el.dataset || {}, ui = this.ui;
        if (action === 'nb-train') this.nbTrain(ds.k, ds.id, 'srs');
        else if (action === 'nb-train-menu') this.nbTrainMenu(el, ds.k, ds.id);
        else if (action === 'nb-folder') { ui.note = null; ui.nbMem = false; ui.nbFolder = ds.id; this.tabsAdd('folder', ds.id); this.renderNotes(); window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' }); }
        else if (action === 'nb-docs') { ui.note = null; ui.nbMem = false; ui.nbFolder = NB_ROOT; this.tabsAdd('folder', NB_ROOT); this.renderNotes(); window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' }); }
        else if (action === 'nb-mem') { ui.note = null; ui.nbFolder = null; ui.nbMem = true; this.tabsAdd('mem'); this.renderNotes(); window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' }); }
        else if (action === 'nb-folder-close') { ui.nbFolder = null; ui.nbMem = false; this.renderNotes(); }
        else if (action === 'nb-folder-plus') this.nbFolderPlusMenu(el, ds.deck);
        else if (action === 'nb-favs') { ui.noteFav = !ui.noteFav; ui.noteTag = ''; this.nbRefreshList(); const t = $('[data-action=nb-favs]'); if (t) t.classList.toggle('on', ui.noteFav); }
        else if (action === 'nb-ftype') { ui.nbFType = ds.t; this.renderNotes(); }
        else if (action === 'nb-fsort') { const cur = ui.nbFSort === 'az' ? 'alpha' : ui.nbFSort === 'manual' ? 'manual' : 'recent'; this.sortMenu(el, ['manual', 'alpha', 'recent'], cur, k => { ui.nbFSort = k === 'alpha' ? 'az' : k; this.renderNotes(); }); }
    }
});
