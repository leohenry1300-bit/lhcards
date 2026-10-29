/* ============================================================
   Cartes mémoire dans une note (comme dans RemNote) : une LIGNE de la note devient une carte.
     Ligne unique   : [Recto] → [Verso] sur la même ligne (« question >> réponse » se transforme tout seul)
     Multi-lignes   : [Recto] ↓ et les sous-lignes sont la réponse (tout s'affiche d'un coup)
     Liste          : comme multi-lignes, la réponse est une liste ; « ordre important » = éléments révélés un par un
     Choix multiples: les sous-lignes sont les choix, on marque la ou les bonnes (un QCM hors planning)
     À trous        : un texte avec {{mots cachés}} (une carte par trou)
   Le bouton rond (→ / ↓) ouvre les réglages : type, direction, activer les cartes, saisir la réponse, supprimer.
   Modifier la ligne met la carte à jour sans perdre sa progression ; supprimer la ligne ne supprime jamais la carte en silence.
   ============================================================ */
Object.assign(ICONS, {
    brackets: '<path d="M8 4H5v16h3M16 4h3v16h-3"/><path d="M10 12h.01M12 12h.01M14 12h.01"/>',
    arrowDown: '<path d="M12 5v14M5 12l7 7 7-7"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    swap: '<path d="M7 7h13M16 3l4 4-4 4M17 17H4M8 21l-4-4 4-4"/>',
    cardstack: '<rect x="3" y="3" width="14" height="14" rx="2"/><path d="M7 21h12a2 2 0 0 0 2-2V8"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>',
    heading: '<path d="M5 5v14M13 5v14M5 12h8"/><path d="M17 11l2-1v8"/>',
    kbdoff: '<rect x="2" y="5" width="20" height="11" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M7 12.5h10M9 20l3-3 3 3"/>'
});
const NB_KIDS = ['multi', 'list', 'mcq'];
const NB_KIND = { basic: ['Ligne unique', 'copy'], multi: ['Multi-lignes', 'cardstack'], list: ['Liste', 'list'], mcq: ['Choix multiples', 'quiz'], cloze: ['À trous', 'brackets'] };
const NB_DIR = { fwd: 'Avant', back: 'Arrière', both: 'Les deux' };
const CLOZE_HOLE = /\{\{(?:c(\d+)::)?([^{}]+?)\}\}/g;

Object.assign(SuperAnki.prototype, {
    nbCdNew(k = 'basic') { return { k, a: '', dir: 'fwd', on: true, ta: false, ord: false, mx: false, id: uid('b'), cid: [], qid: '', hm: [], sg: '', so: true, dead: false, vd: false }; },
    /* plain text typed in a note → html for a card (links unwrapped, **bold** etc. kept) */
    nbH(x) { return sanitizeHtml(this.fmtHtml(esc(String(x || '').replace(NB_LINK, (m, i) => i.replace(/^c:[^|]+\|/, '')))).replace(/\n/g, '<br>')); },
    nbPlain(x) { return String(x || '').replace(NB_LINK, (m, i) => i.replace(/^c:[^|]+\|/, '')).replace(/\*\*|==|`/g, '').trim(); },

    /* for every line: the card line (multi-lines / list / choices) whose answer it belongs to, or -1 */
    nbCardOwners(n) {
        const own = new Array(n.b.length).fill(-1), st = [];
        n.b.forEach((b, j) => {
            while (st.length && b.d <= n.b[st[st.length - 1]].d) st.pop();
            if (st.length) own[j] = st[st.length - 1];
            if (b.cd && NB_KIDS.includes(b.cd.k)) st.push(j);
        });
        return own;
    },
    /* what the card says now, read from the line and its sub-lines */
    nbCardFields(n, i) {
        const b = n.b[i], cd = b.cd, end = this.nbSubEnd(n.b, i), items = [];
        for (let j = i + 1; j < end; j++) {
            if (n.b[j].d !== b.d + 1 || nbSolid(n.b[j].t)) continue;
            const e2 = this.nbSubEnd(n.b, j);
            items.push({ x: n.b[j].x.trim(), ok: !!n.b[j].ok, rest: n.b.slice(j + 1, e2).filter(z => !nbSolid(z.t) && z.x.trim()).map(z => z.x.trim()) });
        }
        const q = b.x.trim(), a = cd.a.trim(), full = items.filter(x => x.x || x.rest.length);
        const holes = cd.k === 'cloze' ? this.nbCloze(b) : null;
        let valid = true, why = '', missing = '';
        if (!q) { valid = false; missing = 'question'; why = 'Ajoute une question en cliquant sur « Recto de la carte » et en saisissant une question.'; }
        else if (cd.k === 'basic' && !a) { valid = false; missing = 'réponse'; why = 'Ajoute une réponse en cliquant sur « Verso de la carte » et en saisissant une réponse.'; }
        else if ((cd.k === 'multi' || cd.k === 'list') && !full.length) { valid = false; missing = 'réponse'; why = 'Ajoute une réponse : écris-la sur la ligne en dessous (en retrait).'; }
        else if (cd.k === 'mcq' && (full.length < 2 || !full.some(x => x.ok))) { valid = false; missing = 'choix'; why = 'Ajoute au moins deux choix en dessous (en retrait), puis touche le rond de la bonne réponse.'; }
        else if (cd.k === 'cloze' && !holes.list.length) { valid = false; missing = 'trou'; why = 'Entoure au moins un mot avec {{ et }} pour le cacher (ou sélectionne-le et choisis « Mettre en trou »).'; }
        return { q, a, items: full, valid, why, missing, holes };
    },
    /* numbers the holes of a cloze line; a hole keeps its number (and so its card and progress) when the text around it changes */
    nbCloze(b) {
        const cd = b.cd, holes = [];
        String(b.x).replace(CLOZE_HOLE, (m, n, t) => { holes.push({ t: t.trim(), n: n ? Number(n) : 0 }); return m; });
        const used = new Set(holes.filter(h => h.n).map(h => h.n)), prev = (cd.hm || []).map(h => ({ ...h, u: false }));
        holes.filter(h => !h.n).forEach(h => { const p = prev.find(x => !x.u && x.t === h.t && !used.has(x.n)); if (p) { p.u = true; h.n = p.n; used.add(p.n); } });
        const rest = holes.filter(h => !h.n), left = prev.filter(x => !x.u && !used.has(x.n));
        if (rest.length && rest.length === left.length) rest.forEach((h, k) => { h.n = left[k].n; used.add(h.n); });
        let next = Math.max(0, ...used, ...prev.map(x => x.n)) + 1;
        holes.forEach(h => { if (!h.n) { h.n = next++; used.add(h.n); } });
        let k = 0; const text = String(b.x).replace(CLOZE_HOLE, () => { const h = holes[k++]; return `{{c${h.n}::${h.t}}}`; });
        return { list: holes, text };
    },
    nbClozeView(x, q) { return this.inlineHtml(x, q).replace(/\{\{(?:c\d+::)?([^{}]+?)\}\}/g, '<span class="nbc-hole">$1</span>'); },
    nbCardsOf(n, cd) { return cd.cid.map(id => this.card(id)).filter(Boolean); },
    nbCardStatus(n, i) {
        const b = n.b[i], cd = b.cd, f = this.nbCardFields(n, i), now = Date.now();
        if (!cd.on) return { cls: 'off', label: 'Cartes désactivées' };
        if (!f.valid) return { cls: 'inc', label: 'Carte incomplète' };
        if (cd.vd === false && !cd.cid.length && !cd.qid) return { cls: 'draft', label: 'Brouillon : touche « Créer la carte »' };
        if (cd.dead) return { cls: 'dead', label: 'Carte supprimée du paquet' };
        if (cd.k === 'mcq') { const q = this.qcm(cd.qid); return q ? { cls: 'ok', label: q.right + q.wrong ? `QCM · ${q.right}/${q.right + q.wrong} réussi` : 'QCM · jamais posé' } : { cls: 'inc', label: 'QCM à enregistrer' }; }
        const cs = this.nbCardsOf(n, cd); if (!cs.length) return { cls: 'inc', label: 'Pas encore créée' };
        const due = cs.filter(c => c.state !== 'new' && c.due <= now).length, nw = cs.filter(c => c.state === 'new').length, mature = cs.every(c => c.state === 'review' && c.interval >= MATURE_IVL);
        if (due) return { cls: 'due', label: `${plural(due, 'carte')} à revoir` };
        if (nw === cs.length) return { cls: 'new', label: cs.length > 1 ? `${cs.length} cartes nouvelles` : 'Nouvelle carte' };
        return mature ? { cls: 'ok', label: 'Maîtrisée' } : { cls: 'learn', label: 'En cours d\'apprentissage' };
    },
    nbCardLineHtml(n, i, q) {
        const b = n.b[i], cd = b.cd, k = cd.k, st = this.nbCardStatus(n, i);
        const ph = k === 'cloze' ? 'Texte à trous : {{mot caché}}' : 'Recto de la carte';
        const view = k === 'cloze' ? this.nbClozeView(b.x, q) : this.inlineHtml(b.x, q);
        const arrow = ico => `<button class="nbc-arrow" data-nbk="cmenu" aria-label="Réglages de la carte" title="Réglages de la carte (type, direction…)">${ico}</button>`;
        const mid = k === 'basic' ? arrow(ic(cd.dir === 'both' ? 'swap' : 'arrowRight', cd.dir === 'back' ? 'nb-flip-h' : '')) + `<div class="nbc-a"><input class="nbc-ain" data-nbf="a" value="${esc(cd.a)}" placeholder="Verso de la carte" autocomplete="off" spellcheck="true" enterkeyhint="done"></div>`
            : k === 'cloze' ? arrow(ic('brackets')) : arrow(ic('arrowDown'));
        return `<div class="nbc nbc-${k} st-${st.cls}"><div class="nbc-line"><div class="nbc-q"><div class="nb-view" data-ph="${ph}">${view}</div><div class="nb-t" data-ph="${ph}" contenteditable="${NB_CE}" role="textbox" aria-multiline="false" spellcheck="true" autocapitalize="sentences"></div></div>${mid}<button class="nbc-prev" data-nbk="cprev" title="${esc(st.label)} · Aperçu de la carte mémoire">${ic('eye')}<span>Aperçu</span><i class="nbc-dot st-${st.cls}"></i></button></div>${st.cls === 'draft' ? `<div class="nbc-draft"><span>Pas encore une carte</span><button class="nbc-ok" data-nbk="cvalid">${ic('check')}Créer la carte</button></div>` : ''}</div>`;
    },

    /* ---------- keeping the real cards in step with the line ---------- */
    nbDeckFor(n) {
        if (n.deckId && this.deck(n.deckId)) return n.deckId;
        let d = this.deck('notes_auto');
        if (!d) { d = { id: 'notes_auto', name: 'Notes', emoji: '📓', description: 'Les cartes créées depuis tes notes.', created: Date.now(), parent: null, opts: null, mod: 0, preset: null, limits: null }; this.data.decks.push(d); }
        return d.id;
    },
    nbCardsRemove(ids, msg) {
        const set = new Set(ids); if (!set.size) return;
        this.change('carte retirée', [...set], () => { this.data.cards = this.data.cards.filter(c => !set.has(c.id)); });
        if (msg) this.undoToast(msg, ic('trash'));
    },
    nbCardSyncAll(n) {
        let did = false;
        n.b.forEach((b, i) => { if (b.cd) { b.cd.cid.forEach(id => { const c = this.card(id); if (c && (!c.src || c.src.n !== n.id || c.src.b !== b.cd.id)) c.src = { n: n.id, b: b.cd.id }; }); did = this.nbCardSync(n, i) || did; } });   // (a line brought back by « Annuler » takes its cards back too)
        return did;
    },
    nbCardSync(n, i, force = false) {
        const b = n.b[i], cd = b.cd; if (!cd) return false;
        const f = this.nbCardFields(n, i), deckId = this.nbDeckFor(n);
        const sig = JSON.stringify([cd.k, cd.dir, cd.on, cd.ta, cd.ord, cd.mx, f.q, f.a, f.items, f.holes ? f.holes.text : '', deckId]);
        if (!force && sig === cd.sg) return false;
        if (!f.valid) { cd.sg = ''; return false; }
        if (cd.vd === false && !cd.cid.length && !cd.qid && !force) return false;   // a draft: the card is only made when you validate it
        const hadCards = cd.cid.length > 0, exist = this.nbCardsOf(n, cd);
        if (cd.k !== 'mcq') {
            if (hadCards && !exist.length && !force) { cd.dead = true; cd.sg = sig; return true; }   // the card was deleted from the deck: not brought back by itself
            if (cd.qid) { this.data.qcms = this.data.qcms.filter(q => q.id !== cd.qid); cd.qid = ''; }
        }
        const src = { n: n.id, b: cd.id }, H = x => this.nbH(x);
        const itemHtml = x => H(x.x) + (x.rest.length ? '<br>' + x.rest.map(r => '– ' + H(r)).join('<br>') : '');
        const fam = cd.k === 'mcq' ? 'mcq' : cd.k === 'cloze' ? 'cloze' : (cd.k === 'basic' && cd.dir === 'both' ? 'rev' : 'single');
        const haveFam = exist.length ? (exist[0].kind === 'cloze' ? 'cloze' : exist[0].kind === 'rev' ? 'rev' : 'single') : '';
        let cards = exist;
        if (haveFam && haveFam !== fam) { this.nbCardsRemove(exist.map(c => c.id), 'Type de carte changé : les anciennes cartes sont retirées'); cards = []; cd.cid = []; }
        cd.dead = false;
        if (fam === 'mcq') {
            if (cards.length) { this.nbCardsRemove(cards.map(c => c.id)); cd.cid = []; }
            const opts = f.items.filter(x => x.x).map(x => ({ t: this.nbPlain(x.x + (x.rest.length ? ' ' + x.rest.join(' ') : '')), ok: x.ok }));
            const old = this.qcm(cd.qid), rec = normalizeQcm({ id: cd.qid || uid('q'), deckId, q: this.nbPlain(f.q), o: opts, multi: cd.mx || opts.filter(o => o.ok).length > 1, expl: old ? old.expl : '', created: old ? old.created : Date.now(), mod: old ? old.mod : 0, right: old ? old.right : 0, wrong: old ? old.wrong : 0, off: !cd.on });
            if (rec) { if (old) Object.assign(old, rec); else { this.data.qcms.push(rec); cd.qid = rec.id; } }
        } else if (fam === 'cloze') {
            const text = f.holes.text, nums = f.holes.list.map(h => h.n);
            if (cards.length) {
                cards.forEach(c => { c.nf = { ...c.nf, text, extra: '' }; c.deckId = deckId; });
                const have = new Set(cards.map(c => c.ord)), nid = cards[0].nid, now = Date.now();
                nums.filter(x => !have.has(x)).forEach((x, k) => { const c = { id: uid('c'), ...freshCard(), deckId, hint: '', detail: '', tags: [], created: now + k, nid, kind: 'cloze', ord: x, nf: { front: '', back: '', text, extra: '' }, front: '', back: '', src }; this.data.cards.push(c); cards.push(c); });
                const gone = cards.filter(c => !nums.includes(c.ord)); cards.forEach(materializeCard);
                cards = cards.filter(c => nums.includes(c.ord));
                if (gone.length) this.nbCardsRemove(gone.map(c => c.id), `${plural(gone.length, 'carte de trou retirée', 'cartes de trous retirées')}`);
            } else cards = (this.createNote({ type: 'cloze', deckId, front: text, back: '', hint: '', detail: '', tags: [] }) || []).map(id => this.card(id));
            cd.hm = f.holes.list.map(h => ({ t: h.t, n: h.n }));
        } else {
            const front = H(f.q), back = cd.k === 'basic' ? H(f.a) : cd.k === 'multi' ? f.items.map(itemHtml).join('<br>') : `<${cd.ord ? 'ol' : 'ul'}>${f.items.map(x => `<li>${itemHtml(x)}</li>`).join('')}</${cd.ord ? 'ol' : 'ul'}>`;
            if (fam === 'rev') {
                if (cards.length) { this.updateNote(cards[0], { deckId, front, back, hint: cards[0].hint, detail: cards[0].detail, tags: cards[0].tags }); cards = this.noteSiblings(cards[0]); }
                else cards = (this.createNote({ type: 'rev', deckId, front, back, hint: '', detail: '', tags: [] }) || []).map(id => this.card(id));
            } else if (cards.length) {
                const c = cards[0]; c.deckId = deckId;
                if (cd.dir === 'back' && cd.k === 'basic') { c.front = H(f.a); c.back = front; } else { c.front = front; c.back = back; }
            } else {
                const made = this.createNote({ type: 'basic', deckId, front: cd.dir === 'back' && cd.k === 'basic' ? H(f.a) : front, back: cd.dir === 'back' && cd.k === 'basic' ? front : back, hint: '', detail: '', tags: [] }) || [];
                cards = made.map(id => this.card(id));
            }
            cards.forEach(c => { c.ls = cd.k === 'list' && cd.ord ? f.items.map(x => this.nbPlain(x.x)).slice(0, 30) : null; });
        }
        cards.forEach(c => { c.src = src; c.ta = !!cd.ta && cd.k !== 'mcq'; });
        if (cd.on !== cd.so || !hadCards) cards.forEach(c => { if (cd.on !== cd.so || !cd.on) c.suspended = !cd.on; });
        cd.so = cd.on; cd.cid = cards.map(c => c.id); cd.sg = sig;
        this.searchCache.clear();
        return true;
    },
    /* a line (and its card) vanished from the note: the card stays in the deck, with a way to remove it */
    nbCardIdsOf(n) { const m = new Map(); n.b.forEach(b => { if (b.cd) m.set(b.cd.id, { cid: b.cd.cid.slice(), qid: b.cd.qid }); }); return m; },
    nbCardsGone(before, n) {
        const now = this.nbCardIdsOf(n), ids = [], qids = [];
        before.forEach((v, id) => { if (!now.has(id)) { v.cid.forEach(c => { if (this.card(c)) ids.push(c); }); if (v.qid && this.qcm(v.qid)) qids.push(v.qid); } });
        if (!ids.length && !qids.length) return;
        ids.forEach(id => { const c = this.card(id); if (c && c.src) c.src = { n: c.src.n, b: '' }; });
        const many = ids.length + qids.length > 1;
        this.confirm({ title: many ? 'Supprimer aussi les cartes ?' : 'Supprimer aussi la carte ?', message: many ? 'Tu as effacé des lignes qui avaient des cartes mémoire. Les cartes sont encore dans ton paquet.' : 'Tu as effacé une ligne qui avait une carte mémoire. La carte est encore dans ton paquet.', ok: many ? 'Supprimer les cartes' : 'Supprimer la carte', cancel: 'Garder', danger: true }).then(yes => {
            if (!yes) return;
            this.nbCardsRemove(ids); if (qids.length) { this.data.qcms = this.data.qcms.filter(q => !qids.includes(q.id)); this.save(); }
        });
    },
    /* a note changes folder: its cards follow */
    nbCardsFollow(n) {
        const deckId = this.nbDeckFor(n); let k = 0;
        this.data.cards.forEach(c => { if (c.src && c.src.n === n.id && c.deckId !== deckId) { c.deckId = deckId; k++; } });
        this.data.qcms.forEach(q => { if (n.b.some(b => b.cd && b.cd.qid === q.id) && q.deckId !== deckId) q.deckId = deckId; });
        n.b.forEach(b => { if (b.cd) b.cd.sg = ''; });
        return k;
    },

    /* ---------- turning lines into cards ---------- */
    nbCardInsert(kind, opts = {}) {
        const c = this.nbCurrent(); if (!c) return;
        const { n, i, b } = c;
        if (nbSolid(b.t) || b.t !== 'p') { this.nbInsertAfter(i, [{ t: 'p', x: '', cd: this.nbCdNew(kind) }]); this.nbCardKindFix(this.nb.last == null ? i + 1 : i + 1, kind); return; }
        if (b.cd) { this.nbCardSetKind(i, kind); return; }
        this.nbOp(() => { b.cd = this.nbCdNew(kind); }, i, 'end');
        this.nbCardSetKind(i, kind, true);
    },
    nbCardKindFix(i, kind) { this.nbCardSetKind(i, kind, true); },
    /* change the type of a card line; the verso text and the sub-lines follow */
    nbCardSetKind(i, k, fresh = false) {
        const n = this.note(this.ui.note), b = n.b[i], cd = b.cd; if (!cd) return;
        const was = cd.k, wasKids = NB_KIDS.includes(was), toKids = NB_KIDS.includes(k), end = this.nbSubEnd(n.b, i), nk = end - i - 1;
        if (!fresh && was === k) return;
        const onlyEmpty = nk > 0 && n.b.slice(i + 1, end).every(z => !z.x.trim() && !z.cd && !nbSolid(z.t));   // empty answer lines can simply go
        if (!toKids && wasKids && nk > 1 && !onlyEmpty) { this.toast('La réponse a plusieurs lignes : garde « Multi-lignes » ou « Liste », ou supprime d\'abord les sous-lignes.', 'warning'); return; }
        if (k === 'cloze' && nk > 0 && !onlyEmpty) { this.toast('Une carte à trous n\'a pas de sous-lignes : déplace-les d\'abord.', 'warning'); return; }
        this.nbOp(nn => {
            if (!toKids && onlyEmpty) nn.b.splice(i + 1, nk);
            else if (!toKids && wasKids && nk === 1) { cd.a = nn.b[i + 1].x; nn.b.splice(i + 1, 1); }
            if (toKids && !wasKids && nk === 0) {
                const kids = []; if (cd.a) { kids.push({ t: 'p', x: cd.a, d: b.d + 1 }); cd.a = ''; }
                const want = k === 'mcq' ? 2 : 1; while (kids.length < want) kids.push({ t: 'p', x: '', d: b.d + 1 });
                nn.b.splice(i + 1, 0, ...kids);
            }
            if (toKids && wasKids && k === 'mcq') { for (let j = i + 1; j < this.nbSubEnd(nn.b, i); j++) delete nn.b[j].ok; const kk = this.nbSubEnd(nn.b, i) - i - 1; if (kk < 2) nn.b.splice(this.nbSubEnd(nn.b, i), 0, ...Array.from({ length: 2 - kk }, () => ({ t: 'p', x: '', d: b.d + 1 }))); }
            if (k !== 'mcq') { for (let j = i + 1; j < this.nbSubEnd(nn.b, i); j++) delete nn.b[j].ok; }
            cd.k = k; if (k !== 'basic') cd.dir = 'fwd'; if (k !== 'list') cd.ord = false; if (k !== 'mcq') cd.mx = false; if (k === 'mcq' || k === 'cloze') cd.ta = false; cd.sg = '';
        }, i, 'end');
    },
    nbCardSetDir(i, dir) { const n = this.note(this.ui.note), cd = n.b[i].cd; if (!cd || cd.dir === dir) return; this.nbOp(() => { cd.dir = dir; cd.sg = ''; }, i, 'end'); },
    nbCardToggle(i, key) { const n = this.note(this.ui.note), cd = n.b[i].cd; if (!cd) return; this.nbPush(); cd[key] = !cd[key]; cd.sg = ''; this.nbChanged(); this.nbCardFlushLater(); },
    nbCardFlushLater() { clearTimeout(this.nb.cardT); this.nb.cardT = setTimeout(() => { const n = this.note(this.ui.note); if (n) { this.nbCardSyncAll(n); this.nbFlush(); this.nbRefreshBadges(); } }, 250); },
    nbRefreshBadges() {
        const n = this.note(this.ui.note); if (!n) return;
        n.b.forEach((b, i) => { if (!b.cd) return; const row = this.nbEl(i); if (!row) return; const st = this.nbCardStatus(n, i), d = $('.nbc-dot', row), box = $('.nbc', row); if (d) d.className = `nbc-dot st-${st.cls}`; if (box) box.className = box.className.replace(/st-\w+/, 'st-' + st.cls); const pv = $('.nbc-prev', row); if (pv) pv.title = `${st.label} · Aperçu de la carte mémoire`; });
    },
    nbCardDelete(i) {
        const n = this.note(this.ui.note), b = n.b[i], cd = b.cd; if (!cd) return;
        const ids = cd.cid.filter(id => this.card(id)), qid = cd.qid;
        this.nbOp(() => { delete b.cd; for (let j = i + 1; j < this.nbSubEnd(n.b, i); j++) delete n.b[j].ok; }, i, 'end');
        if (ids.length) this.nbCardsRemove(ids, plural(ids.length, 'carte supprimée', 'cartes supprimées'));
        if (qid && this.qcm(qid)) { this.data.qcms = this.data.qcms.filter(q => q.id !== qid); this.save(); this.toast('Carte supprimée', 'success', ic('trash')); }
    },
    nbCardValidate(i) {
        const n = this.note(this.ui.note), b = n && n.b[i], cd = b && b.cd; if (!cd) return;
        const f = this.nbCardFields(n, i); if (!f.valid) { this.toast(f.why, 'warning'); return; }
        this.nbOp(() => { cd.vd = true; cd.sg = ''; }, i, 'end');
        this.nbCardSyncAll(n); this.nbFlush(); this.nbRefreshBadges();
    },
    nbCardRecreate(i) { const n = this.note(this.ui.note), cd = n.b[i].cd; if (!cd) return; cd.cid = []; cd.sg = ''; this.nbCardSync(n, i, true); this.nbFlush(); this.nbRefreshBadges(); this.toast('Carte recréée', 'success', ic('card')); },

    /* « question >> réponse » (and « <> » for both ways) becomes a card line when you press Enter */
    nbAutoCard(i) {
        const n = this.note(this.ui.note), b = n.b[i]; if (b.t !== 'p' || b.cd) return false;
        const m = /^(.+?)\s*(<>|>>)\s*(.+)$/.exec(b.x); if (!m) return false;
        this.nbOp(nn => { b.cd = this.nbCdNew('basic'); b.cd.a = m[3].trim(); b.x = m[1].trim(); if (m[2] === '<>') b.cd.dir = 'both'; nn.b.splice(i + 1, 0, { t: 'p', x: '', d: b.d }); }, i + 1, 0);
        this.nbCardSyncAll(n); this.nbFlush(); this.nbRefreshBadges();
        return true;
    },
    /* the selected words become a hole of a « À trous » line */
    nbSelToCloze() {
        const c = this.nbCurrent(); if (!c) return; const { n, i, b } = c;
        if (this.nb.active !== i) { this.toast('Sélectionne d\'abord des mots dans une ligne.', 'warning'); return; }
        const t = $('.nb-t', this.nbEl(i)), { s, e } = this.nbCaret(t);
        if (s === e) { this.toast('Sélectionne d\'abord les mots à cacher.', 'warning'); return; }
        const x = b.x; this.nbOp(() => { b.x = x.slice(0, s) + '{{' + x.slice(s, e).trim() + '}}' + x.slice(e); if (!b.cd) b.cd = this.nbCdNew('cloze'); else if (b.cd.k !== 'cloze') { b.cd.k = 'cloze'; b.cd.dir = 'fwd'; } b.cd.sg = ''; }, i, 'end');
        this.nbCardFlushLater();
    },
    /* a whole outline → cards: every line with sub-lines becomes a card (answer = its sub-lines) */
    nbPlanToCards() {
        const n = this.note(this.ui.note); if (!n) return;
        const cand = []; n.b.forEach((b, i) => { if (b.t !== 'p' || b.cd || !b.x.trim()) return; const own = this.nbCardOwners(n); if (own[i] >= 0) return; const e = this.nbSubEnd(n.b, i); const kids = n.b.slice(i + 1, e).filter(z => z.d === b.d + 1 && !nbSolid(z.t) && z.x.trim()); if (kids.length) cand.push({ i, q: b.x, kids: kids.map(z => z.x) }); });
        if (!cand.length) { this.toast('Aucune ligne avec des sous-lignes : écris une question avec sa réponse en retrait.', 'warning'); return; }
        const m = this.openModal({
            title: 'Plan → cartes', size: 'wide',
            body: `<p class="small muted" style="margin-bottom:10px">Chaque ligne qui a des sous-lignes devient une carte : la ligne est la question, ses sous-lignes sont la réponse. Rien n'est supprimé de ta note.</p><div class="im-list">${cand.map((c, k) => `<label class="im-row"><input type="checkbox" data-k="${k}" checked><span class="im-t"><b>${esc(truncate(c.q, 80))}</b><br><span class="faint">${esc(truncate(c.kids.join(' · '), 90))}</span></span><span class="im-badge ok">${c.kids.length > 1 ? 'liste' : 'multi-lignes'}</span></label>`).join('')}</div>`,
            foot: `<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="p2c-go">${ic('check')}Créer les cartes</button>`
        });
        $('#p2c-go', m).addEventListener('click', () => {
            const keep = new Set($$('input[data-k]', m).filter(x => x.checked).map(x => Number(x.dataset.k)));
            this.closeModal(m); if (!keep.size) return;
            this.nbOp(nn => { cand.forEach((c, k) => { if (keep.has(k)) { nn.b[c.i].cd = this.nbCdNew(c.kids.length > 1 ? 'list' : 'multi'); nn.b[c.i].cd.vd = true; } }); }, null);
            this.nbCardSyncAll(n); this.nbFlush(); this.nbRefreshBadges();
            this.toast(`${plural(keep.size, 'carte créée', 'cartes créées')}`, 'success', ic('card'), { label: 'Annuler', fn: () => { const ids = []; n.b.forEach(x => { if (x.cd) x.cd.cid.forEach(c => ids.push(c)); }); this.nbUndo(); this.nbCardsRemove(ids); } });
        });
    },

    /* ---------- menus and preview ---------- */
    nbCardMenu(anchor, i) {
        const n = this.note(this.ui.note), cd = n && n.b[i] && n.b[i].cd; if (!cd) return;
        this.closePopover();
        const pop = document.createElement('div'); pop.className = 'popover menu nbcm'; pop.dataset.kind = 'menu';
        document.body.appendChild(pop); this.popover = pop; this.popoverAnchor = anchor; this.popoverY = scrollY;
        let view = 'main';
        const sw = (key, label, ico, on) => `<button class="menu-item nbcm-sw" data-t="${key}">${ic(ico)}<span>${label}</span><span class="switch-mini ${on ? 'on' : ''}"><i></i></span></button>`;
        const paint = () => {
            const c = n.b[i].cd; if (!c) return this.closePopover();
            if (view === 'type') pop.innerHTML = `<button class="menu-item nbcm-back" data-v="main">${ic('chevronLeft')}<span>Type de carte</span></button><div class="menu-sep"></div>${Object.entries(NB_KIND).map(([k, [l, ico]]) => `<button class="menu-item" data-k="${k}">${ic(ico)}<span>${l}</span>${c.k === k ? ic('check', 'nbcm-ck') : ''}</button>`).join('')}`;
            else if (view === 'dir') pop.innerHTML = `<button class="menu-item nbcm-back" data-v="main">${ic('chevronLeft')}<span>Direction de la carte</span></button><div class="menu-sep"></div>${[['fwd', 'Avant', 'Question → réponse', 'arrowRight'], ['back', 'Arrière', 'Réponse → question', 'arrowRight'], ['both', 'Les deux', 'Deux cartes : dans chaque sens', 'swap']].map(([d, l, sub, ico]) => `<button class="menu-item" data-d="${d}">${ic(ico, d === 'back' ? 'nb-flip-h' : '')}<span>${l}<small class="faint"> · ${sub}</small></span>${c.dir === d ? ic('check', 'nbcm-ck') : ''}</button>`).join('')}`;
            else pop.innerHTML = `<button class="menu-item" data-v="type">${ic(NB_KIND[c.k][1])}<span>Type de carte</span><span class="nbcm-val">${NB_KIND[c.k][0]} ${ic('chevronRight')}</span></button>
                ${c.k === 'basic' ? `<button class="menu-item" data-v="dir">${ic('arrowRight')}<span>Direction de la carte</span><span class="nbcm-val">${NB_DIR[c.dir]} ${ic('chevronRight')}</span></button>` : ''}
                <div class="menu-sep"></div>
                ${sw('on', 'Activer les cartes', 'copy', c.on)}
                ${c.k !== 'mcq' ? sw('ta', 'Saisir la réponse', 'keyboard', c.ta) : sw('mx', 'Plusieurs bonnes réponses', 'checkSq', c.mx)}
                ${c.k === 'list' ? sw('ord', 'Ordre important (un élément à la fois)', 'listOrdered', c.ord) : ''}
                <div class="menu-sep"></div>
                ${c.dead ? `<button class="menu-item" data-act="recreate">${ic('refresh')}<span>Recréer la carte (supprimée du paquet)</span></button>` : ''}
                <button class="menu-item" data-act="goto">${ic('layers')}<span>Voir dans le paquet</span></button>
                <button class="menu-item danger" data-act="del">${ic('trash')}<span>Supprimer la carte</span></button>`;
            const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
            pop.style.left = `${clamp(r.left, 10, innerWidth - w - 10)}px`; pop.style.top = `${r.bottom + 8 + h > innerHeight - 10 ? Math.max(10, r.top - h - 8) : r.bottom + 8}px`;
        };
        pop.addEventListener('pointerdown', e => e.preventDefault());
        pop.addEventListener('click', e => {
            e.stopPropagation();
            const b = e.target.closest('button'); if (!b) return;
            if (b.dataset.v) { view = b.dataset.v; paint(); return; }
            if (b.dataset.k) { this.closePopover(); this.nbCardSetKind(i, b.dataset.k); return; }
            if (b.dataset.d) { this.closePopover(); this.nbCardSetDir(i, b.dataset.d); return; }
            if (b.dataset.t) { this.nbCardToggle(i, b.dataset.t); paint(); return; }
            if (b.dataset.act === 'del') { this.closePopover(); this.nbCardDelete(i); }
            else if (b.dataset.act === 'recreate') { this.closePopover(); this.nbCardRecreate(i); }
            else if (b.dataset.act === 'goto') { const c = this.nbCardsOf(n, n.b[i].cd)[0]; this.closePopover(); if (c) { this.nbIdle(true); this.ui.deck = c.deckId; this.go('decks', { deck: c.deckId }); } else this.toast('Cette carte n\'est pas encore créée.', 'warning'); }
        });
        paint();
    },
    nbCardPreview(anchor, i) {
        const n = this.note(this.ui.note), b = n && n.b[i]; if (!b || !b.cd) return;
        const cd = b.cd, f = this.nbCardFields(n, i), H = x => this.nbH(x);
        this.closePopover();
        const pop = document.createElement('div'); pop.className = 'popover nbprev'; pop.dataset.kind = 'menu';
        document.body.appendChild(pop); this.popover = pop; this.popoverAnchor = anchor; this.popoverY = scrollY;
        let shown = 0, hole = 0, picked = new Set(), done = false;
        const holes = f.holes ? f.holes.list : [];
        const paint = () => {
            let body;
            if (!f.valid) body = `<p><b>Cette ligne n'a pas encore ${f.missing === 'question' ? 'de question' : f.missing === 'trou' ? 'de trou' : f.missing === 'choix' ? 'de choix' : 'de réponse'}.</b></p><p class="small muted">${esc(f.why)}</p>`;
            else if (cd.k === 'cloze') {
                const text = f.holes.text, num = holes[hole].n, front = renderCloze(text, num, 'front'), back = renderCloze(text, num, 'back');
                body = `<div class="rich nbprev-f">${sanitizeHtml(done ? back : front)}</div>${holes.length > 1 ? `<p class="tiny faint">Trou ${hole + 1} sur ${holes.length}</p>` : ''}<div class="row-gap">${done ? '' : `<button class="btn btn-primary btn-sm" data-p="show">Afficher la réponse</button>`}${holes.length > 1 ? `<button class="btn btn-soft btn-sm" data-p="next">Trou suivant</button>` : ''}</div>`;
            } else if (cd.k === 'mcq') {
                body = `<div class="rich nbprev-f">${H(f.q)}</div><div class="nbprev-opts">${f.items.map((x, k) => `<button class="nbprev-opt ${done ? (x.ok ? 'good' : picked.has(k) ? 'bad' : 'dim') : picked.has(k) ? 'sel' : ''}" data-p="opt" data-k="${k}">${H(x.x)}</button>`).join('')}</div><div class="row-gap">${done ? '' : `<button class="btn btn-primary btn-sm" data-p="check" ${picked.size ? '' : 'disabled'}>Valider</button>`}</div>`;
            } else {
                const ordered = cd.k === 'list' && cd.ord, back = cd.k === 'basic' ? H(f.a) : cd.k === 'multi' ? f.items.map(x => H(x.x)).join('<br>') : null;
                let answer = '';
                if (done || ordered) {
                    if (cd.k === 'list') { const cnt = ordered && !done ? shown : f.items.length; answer = `<${ordered ? 'ol' : 'ul'}>${f.items.map((x, k) => `<li>${k < cnt ? H(x.x) : '<span class="faint">▢</span>'}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`; }
                    else answer = back;
                }
                const left = ordered && shown < f.items.length;
                body = `<div class="rich nbprev-f">${H(cd.dir === 'back' && cd.k === 'basic' ? f.a : f.q)}</div>${(done || (ordered && shown)) ? `<hr class="fc-divider"><div class="rich nbprev-b">${answer}</div>` : ''}<div class="row-gap">${!done && !ordered ? `<button class="btn btn-primary btn-sm" data-p="show">Afficher la réponse</button>` : ''}${ordered && left ? `<button class="btn btn-primary btn-sm" data-p="step">${shown ? 'Élément suivant' : 'Afficher le premier élément'}</button><button class="btn btn-soft btn-sm" data-p="show">Tout afficher</button>` : ''}</div>`;
            }
            pop.innerHTML = `<div class="nbprev-h"><b>Aperçu de la carte mémoire</b><button class="icon-btn icon-btn-sm" data-p="x" aria-label="Fermer">${ic('x')}</button></div><div class="nbprev-b">${body}</div>`;
            const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
            pop.style.left = `${clamp(r.right - w, 10, innerWidth - w - 10)}px`; pop.style.top = `${r.bottom + 8 + h > innerHeight - 10 ? Math.max(10, r.top - h - 8) : r.bottom + 8}px`;
        };
        pop.addEventListener('pointerdown', e => { if (!e.target.closest('input, textarea')) e.preventDefault(); });
        pop.addEventListener('click', e => {
            e.stopPropagation(); const b2 = e.target.closest('[data-p]'); if (!b2) return;
            const p = b2.dataset.p;
            if (p === 'x') this.closePopover();
            else if (p === 'show') { done = true; shown = 999; paint(); }
            else if (p === 'step') { shown++; if (shown >= f.items.length) done = true; paint(); }
            else if (p === 'next') { hole = (hole + 1) % holes.length; done = false; paint(); }
            else if (p === 'opt') { if (done) return; const k = Number(b2.dataset.k); if (!cd.mx && f.items.filter(x => x.ok).length < 2) picked = new Set([k]); else if (picked.has(k)) picked.delete(k); else picked.add(k); paint(); }
            else if (p === 'check') { done = true; paint(); }
        });
        paint();
    },

    /* ---------- "Voir dans le cours" ---------- */
    noteOfCard(c) { return c && c.src && c.src.n ? this.note(c.src.n) : null; },
    /* a small window with the line of the course the card comes from (the review is not interrupted) */
    openCardSource(cardId) {
        const c0 = this.card(cardId);
        if (c0 && c0.src && c0.src.pdf) { if (!this.pdf(c0.src.pdf)) { this.toast('Le PDF de cette carte n\'existe plus.', 'warning'); return; } this.pdfOpen(c0.src.pdf, { pid: c0.src.pid, flash: c0.src.t, from: this.view === 'session' ? 'notes' : undefined }); return; }
        const c = this.card(cardId), n = this.noteOfCard(c); if (!n) { this.toast('La note de cette carte n\'existe plus.', 'warning'); return; }
        const i = n.b.findIndex(b => b.cd && b.cd.id === c.src.b), ctx = i >= 0 ? n.b.slice(Math.max(0, i - 2), Math.min(n.b.length, this.nbSubEnd(n.b, i) + 2)) : n.b.slice(0, 6);
        const line = b => `<div class="vc-line ${b.cd && b.cd.id === c.src.b ? 'on' : ''}" style="padding-left:${b.d * 16}px">• ${b.cd ? `<b>${this.inlineHtml(b.x)}</b>${b.cd.k === 'basic' ? ' → ' + this.inlineHtml(b.cd.a) : ''}` : this.inlineHtml(b.x)}</div>`;
        const m = this.openModal({ title: `${n.emoji || '📓'} ${esc(this.noteName(n))}`, size: 'narrow', body: `<p class="small faint" style="margin:0 0 8px">${esc(this.notePathLabel(n))}</p><div class="vc-box">${ctx.filter(b => !nbSolid(b.t)).map(line).join('')}</div>`, foot: `<button class="btn btn-soft" data-close>Fermer</button><button class="btn btn-primary" id="vc-open">${ic('notebook')}Ouvrir la note</button>` });
        $('#vc-open', m).addEventListener('click', () => { this.closeModal(m); this.openNoteAt(n.id, c.src.b); });
    },
    openNoteAt(noteId, bid) {
        this.noteOpen(noteId, { push: false });
        setTimeout(() => { const row = bid ? $(`#nb-blocks .nb[data-bid="${bid}"]`) : null; if (row) { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1800); } }, 200);
    },

    /* ---------- tables ---------- */
    nbTableHtml(b) {
        return `<div class="nb-tablewrap"><table class="nb-table">${b.rows.map((r, ri) => `<tr>${r.map((cell, ci) => `<${ri === 0 && b.hdr ? 'th' : 'td'}><input data-nbt="${ri},${ci}" value="${esc(cell)}" autocomplete="off" aria-label="Ligne ${ri + 1}, colonne ${ci + 1}"></${ri === 0 && b.hdr ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</table></div>`;
    },
    nbTableMenu(anchor, i) {
        const n = this.note(this.ui.note), b = n.b[i], cell = this.nb.cell && this.nb.cell.i === i ? this.nb.cell : { i, r: 0, c: 0 };
        if (b && b.t === 'table') {
            this.nbMenu([{ head: 'TABLEAU' },
                { ico: 'plus', label: 'Ajouter une ligne dessous', fn: () => this.nbOp(() => { b.rows.splice(cell.r + 1, 0, b.rows[0].map(() => '')); }, null) },
                { ico: 'plus', label: 'Ajouter une colonne à droite', fn: () => { if (b.rows[0].length >= 8) { this.toast('8 colonnes au maximum.', 'warning'); return; } this.nbOp(() => { b.rows.forEach(r => r.splice(cell.c + 1, 0, '')); }, null); } },
                { ico: 'trash', label: 'Supprimer cette ligne', fn: () => { if (b.rows.length > 1) this.nbOp(() => { b.rows.splice(cell.r, 1); }, null); else this.toast('Il faut au moins une ligne.', 'warning'); } },
                { ico: 'trash', label: 'Supprimer cette colonne', fn: () => { if (b.rows[0].length > 1) this.nbOp(() => { b.rows.forEach(r => r.splice(cell.c, 1)); }, null); else this.toast('Il faut au moins une colonne.', 'warning'); } },
                { ico: 'file', label: b.hdr ? 'Sans ligne d\'en-tête' : 'Avec ligne d\'en-tête', fn: () => this.nbOp(() => { b.hdr = !b.hdr; }, null) },
                { sep: true },
                { ico: 'copy', label: 'Cartes depuis des colonnes…', fn: () => this.nbTableCards(i) },
                { sep: true },
                { ico: 'trash', label: 'Supprimer le tableau', danger: true, fn: () => this.nbOp(nn => { nn.b.splice(i, 1); if (!nn.b.length) nn.b.push(nbEmpty()); }, null) }], anchor);
            return;
        }
        this.nbMenu([{ head: 'INSÉRER UN TABLEAU' }, ...[[2, 2], [3, 2], [3, 3], [4, 3], [5, 4]].map(([r, c]) => ({ ico: 'table', label: `${r} lignes × ${c} colonnes`, fn: () => this.nbInsertAfter(i, [{ t: 'table', id: uid('b'), hdr: true, rows: Array.from({ length: r }, () => Array(c).fill('')) }, { t: 'p', x: '' }]) }))], anchor);
    },
    /* a column of a table = the questions, another column = the answers: one card per row */
    nbTableCards(i) {
        const n = this.note(this.ui.note), b = n.b[i], w = b.rows[0].length;
        if (w < 2) { this.toast('Il faut au moins deux colonnes : une pour les questions, une pour les réponses.', 'warning'); return; }
        const name = c => (b.hdr && b.rows[0][c].trim()) || `Colonne ${c + 1}`;
        const m = this.openModal({
            title: 'Cartes depuis un tableau', size: 'narrow',
            body: `<div class="field"><label class="label" for="tc-q">Colonne des questions (recto)</label><select class="select" id="tc-q">${b.rows[0].map((_, c) => `<option value="${c}">${esc(name(c))}</option>`).join('')}</select></div>
                <div class="field"><label class="label" for="tc-a">Colonne des réponses (verso)</label><select class="select" id="tc-a">${b.rows[0].map((_, c) => `<option value="${c}" ${c === 1 ? 'selected' : ''}>${esc(name(c))}</option>`).join('')}</select></div>
                <label class="check" style="margin-bottom:8px"><input type="checkbox" id="tc-both"> Aussi dans l'autre sens (deux cartes par ligne)</label><p class="small muted" id="tc-n"></p>`,
            foot: `<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="tc-go">${ic('check')}Créer les cartes</button>`
        });
        const rows = () => b.rows.slice(b.hdr ? 1 : 0), pairs = () => { const q = Number($('#tc-q', m).value), a = Number($('#tc-a', m).value); return rows().map(r => [r[q].trim(), r[a].trim()]).filter(([x, y]) => x && y && q !== a); };
        const upd = () => { $('#tc-n', m).textContent = `${plural(pairs().length, 'ligne complète', 'lignes complètes')} → ${plural(pairs().length * ($('#tc-both', m).checked ? 2 : 1), 'carte')}.`; };
        ['#tc-q', '#tc-a', '#tc-both'].forEach(s2 => $(s2, m).addEventListener('change', upd)); upd();
        $('#tc-go', m).addEventListener('click', () => {
            const ps = pairs(); if (!ps.length) { this.toast('Rien à créer : remplis des lignes dans les deux colonnes.', 'warning'); return; }
            const deckId = this.nbDeckFor(n), both = $('#tc-both', m).checked, ids = [];
            this.change('cartes depuis un tableau', [], () => { ps.forEach(([q, a]) => { (this.createNote({ type: both ? 'rev' : 'basic', deckId, front: this.nbH(q), back: this.nbH(a), hint: '', detail: '', tags: [] }) || []).forEach(id => { const c = this.card(id); c.src = { n: n.id, b: b.id }; ids.push(id); }); }); return ids; });
            this.closeModal(m); this.undoToast(`${plural(ids.length, 'carte créée', 'cartes créées')} depuis le tableau`, ic('card'));
        });
    }
});
