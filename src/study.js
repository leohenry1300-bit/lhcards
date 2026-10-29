/* ============================================================
   Study helpers: trash (restore deleted cards and decks), session timer, voice study.
   ============================================================ */
const TRASH_DAYS = 30, TRASH_MAX = 1000;

function normalizeTrash(list) {
    const cut = Date.now() - TRASH_DAYS * DAY, seen = new Set(), out = [];
    toArray(list).forEach(t => {
        if (!t || !t.c || !['card', 'deck', 'qcm', 'note', 'pdf'].includes(t.k) || num(t.at) < cut) return;
        const c = t.k === 'card' ? normalizeCard(t.c) : t.k === 'qcm' ? normalizeQcm(t.c) : t.k === 'note' ? normalizeNote(t.c) : t.k === 'pdf' ? normalizePdf(t.c) : (t.c.id ? { id: String(t.c.id), name: String(t.c.name || 'Sans nom').slice(0, 80), emoji: String(t.c.emoji || '📁').slice(0, 8), description: String(t.c.description || '').slice(0, 300), created: num(t.c.created), parent: t.c.parent ? String(t.c.parent) : null, opts: null, mod: num(t.c.mod), preset: t.c.preset ? String(t.c.preset) : null, limits: t.c.limits && typeof t.c.limits === 'object' ? { ...t.c.limits } : null, pdf: t.c.pdf ? String(t.c.pdf) : '' } : null);
        if (!c || seen.has(`${t.k}${c.id}`)) return;
        seen.add(`${t.k}${c.id}`);
        out.push({ k: t.k, at: num(t.at), c });
    });
    return out.sort((a, b) => b.at - a.at).slice(0, TRASH_MAX);
}
function mergeTrash(a, b, cards, decks, qcms = [], notes = [], pdfs = []) {
    const live = new Set([...pdfs.map(p => `pdf${p.id}`), ...notes.map(n => `note${n.id}`), ...cards.map(c => `card${c.id}`), ...decks.map(d => `deck${d.id}`), ...qcms.map(q => `qcm${q.id}`)]);
    const seen = new Map();
    [...(a || []), ...(b || [])].forEach(t => { const k = `${t.k}${t.c.id}`; if (!live.has(k) && (!seen.has(k) || seen.get(k).at < t.at)) seen.set(k, t); });
    return normalizeTrash([...seen.values()]);
}
/* language of a card text, to read it aloud with the right voice */
function guessLang(text) {
    const w = fold(text).split(/[^a-z']+/).filter(Boolean);
    if (!w.length) return 'fr-FR';
    const EN = new Set('the of and to in is are was were you your it that this with for on be have has what which who how do does not can will would we they he she an at from by or as but if about'.split(' '));
    const FR = new Set('le la les un une des du de et est sont pour dans sur avec que qui quoi pas ce cette ces il elle nous vous ils je tu au aux en par ou mais comme plus'.split(' '));
    let en = 0, fr = 0;
    w.forEach(x => { if (EN.has(x)) en++; if (FR.has(x)) fr++; });
    if (/[éèêàùçôî]/i.test(text)) fr += 2;
    return en > fr ? 'en-US' : 'fr-FR';
}

/* ---------- voice commands (French; a few English words too) ----------
   Matching is tolerant: accents, plurals, small recognition mistakes (1-2 letters) and the usual mis-hearings are accepted. */
const VOICE_CMDS = [
    ['stop', ['stop', 'arrete', 'arreter', 'arretes', 'quitter', 'termine', 'terminer', 'fin du mode', 'pause']],
    ['repeat', ['repete', 'repeter', 'repetez', 'relis', 'relire', 'encore une fois', 'rejoue', 'rejouer']],
    ['hint', ['indice', 'indices', 'un indice', 'un indisse', 'indisse', 'hint', 'aide', 'aide moi', 'coup de pouce']],
    ['undo', ['annule', 'annuler', 'retour', 'precedent']],
    [1, ['rate', 'ratee', 'rater', 'rates', 'oublie', 'oublier', 'encore', 'non', 'faux', 'pas su', 'pas bien', 'pas correct', 'je ne savais pas', 'je savais pas', 'again', 'rate pas', 'ra te']],
    [4, ['facile', 'faciles', 'evident', 'evidente', 'trop facile', 'easy', 'parfait', 'fastile']],
    [2, ['difficile', 'difficiles', 'dur', 'dure', 'moyen', 'hesite', 'hard', 'difficil']],
    [3, ['bien', 'bienne', 'bian', 'ok', 'okay', 'correct', 'oui', 'juste', 'vrai', 'je savais', 'bonne reponse', 'good', 'bon', 'ouais']],
    ['next', ['suivant', 'suivante', 'suivants', 'next', 'passe', 'passer', 'continue', 'continuer', 'question suivante', 'on continue']],
    ['reveal', ['reponse', 'reponses', 'montre', 'montrer', 'voir', 'affiche', 'afficher', 'retourne', 'retourner', 'suite', 'je ne sais pas', 'aucune idee', 'show', 'la reponse', 'reponds']]
];
const VOICE_DIGITS = { 1: ['un', '1', 'une'], 2: ['deux', '2'], 3: ['trois', '3'], 4: ['quatre', '4'] };
function vEdit(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 9;
    const d = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) { let prev = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } }
    return d[b.length];
}
function parseVoice(heard) {
    const clean = fold(heard).replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    const t = ` ${clean} `, toks = clean.split(' ');
    for (const [cmd, words] of VOICE_CMDS) if (words.some(w => t.includes(` ${w} `))) return cmd;
    /* a single short word that is a digit: 1 raté · 2 difficile · 3 bien · 4 facile */
    if (toks.length <= 2) for (const [n, ws] of Object.entries(VOICE_DIGITS)) if (toks.some(x => ws.includes(x))) return Number(n);
    /* tolerant match: one-word commands of 5+ letters, up to 1 mistake (2 above 8 letters) */
    let best = null, bd = 9;
    for (const [cmd, words] of VOICE_CMDS) for (const w of words) {
        if (w.length < 5 || w.includes(' ')) continue;
        const lim = w.length >= 9 ? 2 : 1;
        for (const x of toks) { if (x.length < 4) continue; const e = vEdit(x, w); if (e <= lim && e < bd) { bd = e; best = cmd; } }
    }
    return best;
}

/* one handler for a finger and for a mouse button held down: the same slide gestures work on a phone and on a computer.
   h.start(x, y, event, byMouse) may answer false to ignore the gesture; move / end get the position; cancel is called when the system takes the touch away */
function dragBind(target, h) {
    target.addEventListener('touchstart', e => { if (e.touches.length === 1) h.start(e.touches[0].clientX, e.touches[0].clientY, e, false); else if (h.cancel) h.cancel(); }, { passive: true });
    target.addEventListener('touchmove', e => h.move(e.touches[0].clientX, e.touches[0].clientY, e, false), { passive: true });
    target.addEventListener('touchend', e => h.end(e.changedTouches[0].clientX, e.changedTouches[0].clientY, e, false), { passive: true });
    target.addEventListener('touchcancel', () => { if (h.cancel) h.cancel(); }, { passive: true });
    target.addEventListener('mousedown', e => {
        if (e.button !== 0 || e.target.closest('button, a, input, textarea, select, [contenteditable], audio, video')) return;
        if (h.start(e.clientX, e.clientY, e, true) === false) return;
        let moved = false;
        const mm = ev => {
            if (!moved && Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) > 6) { moved = true; document.body.classList.add('dragging'); }
            h.move(ev.clientX, ev.clientY, ev, true);
        };
        const mu = ev => {
            document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); document.body.classList.remove('dragging');
            h.end(ev.clientX, ev.clientY, ev, true);
            if (moved) { const stop = c => { c.stopPropagation(); c.preventDefault(); }; document.addEventListener('click', stop, { capture: true, once: true }); setTimeout(() => document.removeEventListener('click', stop, true), 120); }   // (the click that ends a drag is not a tap)
        };
        document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
    });
}
/* two fingers sliding sideways on a trackpad (or a mouse wheel tilted sideways): calls h.start / h.move(-sum) / h.end like a drag, the end being the moment the sliding stops */
function wheelDrag(target, h, { limit = 260 } = {}) {
    let sum = 0, t = 0;
    target.addEventListener('wheel', e => {
        if (e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY) || (h.accept && !h.accept(e))) return;
        e.preventDefault();
        if (!sum) h.start(0, 0, e, true);
        sum = Math.max(-limit, Math.min(limit, sum + e.deltaX)) || 0.01;
        h.move(-sum, 0, e, true);
        clearTimeout(t); t = setTimeout(() => { sum = 0; h.end(0, 0, e, true); }, 180);
    }, { passive: false });
}

Object.assign(SuperAnki.prototype, {
    /* ============ trash ============ */
    trashAdd(kind, obj, now) {
        const t = this.data.trash;
        t.unshift({ k: kind, at: now, c: obj });
        if (t.length > TRASH_MAX) t.length = TRASH_MAX;
    },
    trashDrop(kind, id) {
        const t = this.data.trash, i = t.findIndex(x => x.k === kind && x.c.id === id);
        if (i >= 0) t.splice(i, 1);
    },
    trashRestore(kind, id) {
        const d = this.data, item = d.trash.find(x => x.k === kind && x.c.id === id);
        if (!item) return 0;
        let n = 0;
        if (kind === 'pdf') {   // a PDF comes back with its deck and its cards
            const p = item.c, dk = p.pdeck && d.trash.find(x => x.k === 'deck' && x.c.id === p.pdeck);
            if (dk) this.trashRestore('deck', p.pdeck);
            if (p.noteId && d.trash.some(x => x.k === 'note' && x.c.id === p.noteId)) this.trashRestore('note', p.noteId);
            d.pdfs.push({ ...p, deckId: d.decks.some(x => x.id === p.deckId) ? p.deckId : '', pdeck: d.decks.some(x => x.id === p.pdeck) ? p.pdeck : '' }); this.trashDrop('pdf', id); this.searchCache.clear(); this.save(); return 1;
        }
        if (kind === 'note') { d.notes.push({ ...item.c, deckId: d.decks.some(x => x.id === item.c.deckId) ? item.c.deckId : '' }); this.trashDrop('note', id); this.save(); return 1; }
        const restoreDeck = deck => {
            if (!deck || d.decks.some(x => x.id === deck.id)) return;
            if (deck.parent && !d.decks.some(x => x.id === deck.parent)) { const p = d.trash.find(x => x.k === 'deck' && x.c.id === deck.parent); if (p) restoreDeck(p.c); else deck.parent = null; }
            d.decks.push({ ...deck }); this.trashDrop('deck', deck.id);
        };
        if (kind === 'deck') {
            restoreDeck(item.c);
            d.trash.filter(x => x.k === 'card' && x.c.deckId === id && Math.abs(x.at - item.at) < 5000).forEach(x => { d.cards.push({ ...x.c }); this.trashDrop('card', x.c.id); n++; });
            d.trash.filter(x => x.k === 'qcm' && x.c.deckId === id && Math.abs(x.at - item.at) < 5000).forEach(x => { d.qcms.push({ ...x.c }); this.trashDrop('qcm', x.c.id); n++; });
            d.trash.filter(x => x.k === 'deck' && x.c.parent === id).forEach(x => restoreDeck(x.c));
        } else {
            if (!d.decks.some(x => x.id === item.c.deckId)) {
                const dk = d.trash.find(x => x.k === 'deck' && x.c.id === item.c.deckId);
                if (dk) restoreDeck(dk.c);
                else { d.decks.push({ id: item.c.deckId, name: 'Récupérées', emoji: '♻️', description: '', created: Date.now(), parent: null, opts: null, mod: 0, preset: null, limits: null }); }
            }
            if (kind === 'qcm') d.qcms.push({ ...item.c }); else d.cards.push({ ...item.c });
            this.trashDrop(kind, id); n = 1;
        }
        this.searchCache.clear();
        this.save();
        return n;
    },
    openTrash() {
        const html = () => {
            const t = this.data.trash, decks = t.filter(x => x.k === 'deck');
            const inDeck = (x, dk) => (x.k === 'card' || x.k === 'qcm') && x.c.deckId === dk.c.id && Math.abs(x.at - dk.at) < 5000;
            const loose = t.filter(x => (x.k === 'card' || x.k === 'qcm' || x.k === 'note' || x.k === 'pdf') && !decks.some(dk => inDeck(x, dk) || x.k === 'note' || x.k === 'pdf') && !(x.k === 'note' && t.some(y => y.k === 'pdf' && y.c.noteId === x.c.id)));
            const ago = at => fmtAgo(at);
            const rows = [
                ...decks.map(x => `<div class="set-row"><div class="txt"><b>${esc(x.c.emoji)} ${esc(x.c.name)}</b><span>Paquet · ${plural(t.filter(y => inDeck(y, x) && y.k === 'card').length, 'carte')}${t.some(y => inDeck(y, x) && y.k === 'qcm') ? ` + ${plural(t.filter(y => inDeck(y, x) && y.k === 'qcm').length, 'QCM', 'QCM')}` : ''} · supprimé ${ago(x.at)}</span></div><div class="row-gap"><button class="btn btn-soft btn-sm" data-tr="restore" data-k="deck" data-id="${esc(x.c.id)}">${ic('undo')}Restaurer</button><button class="icon-btn" data-tr="purge" data-k="deck" data-id="${esc(x.c.id)}" title="Supprimer définitivement" aria-label="Supprimer définitivement">${ic('trash')}</button></div></div>`),
                ...loose.slice(0, 200).map(x => `<div class="set-row"><div class="txt"><b>${esc(truncate(x.k === 'qcm' ? x.c.q : x.k === 'note' ? x.c.title || 'Sans titre' : x.k === 'pdf' ? x.c.name : stripHtml(x.c.front) || '(image)', 70))}</b><span>${x.k === 'qcm' ? 'QCM' : x.k === 'note' ? 'Note' : x.k === 'pdf' ? 'PDF (avec son paquet et ses annotations)' : 'Carte'} · supprimé${x.k === 'qcm' || x.k === 'note' || x.k === 'pdf' ? '' : 'e'} ${ago(x.at)}</span></div><div class="row-gap"><button class="btn btn-soft btn-sm" data-tr="restore" data-k="${x.k}" data-id="${esc(x.c.id)}">${ic('undo')}Restaurer</button><button class="icon-btn" data-tr="purge" data-k="${x.k}" data-id="${esc(x.c.id)}" title="Supprimer définitivement" aria-label="Supprimer définitivement">${ic('trash')}</button></div></div>`)
            ];
            return rows.length ? `<p class="small muted">Les éléments supprimés restent ici ${TRASH_DAYS} jours, puis disparaissent. Restaurer une carte garde sa progression.</p>${rows.join('')}${loose.length > 200 ? `<p class="small muted">… et ${loose.length - 200} autres cartes.</p>` : ''}` : '<p class="muted">La corbeille est vide.</p>';
        };
        const m = this.openModal({ title: 'Corbeille', size: 'wide', body: `<div id="tr-body">${html()}</div>`, foot: `<button class="btn btn-soft" data-close>Fermer</button><button class="btn btn-danger-soft" id="tr-empty">${ic('trash')}Vider la corbeille</button>` });
        const refresh = () => { $('#tr-body', m).innerHTML = html(); };
        m.addEventListener('click', async e => {
            const b = e.target.closest('[data-tr]');
            if (!b) return;
            const { k, id } = b.dataset;
            if (b.dataset.tr === 'restore') { const n = this.trashRestore(k, id); this.render(); refresh(); this.toast(k === 'deck' ? `Paquet restauré (${plural(n, 'carte')})` : k === 'qcm' ? 'QCM restauré' : k === 'note' ? 'Note restaurée' : k === 'pdf' ? 'PDF restauré avec ses cartes' : 'Carte restaurée', 'success', ic('undo')); }
            else {
                const dk = k === 'deck' ? this.data.trash.find(x => x.k === 'deck' && x.c.id === id) : null;
                if (dk) this.data.trash = this.data.trash.filter(x => !((x.k === 'card' || x.k === 'qcm') && x.c.deckId === id && Math.abs(x.at - dk.at) < 5000));
                this.trashDrop(k, id); this.save(); refresh();
            }
        });
        $('#tr-empty', m).addEventListener('click', async () => {
            if (!this.data.trash.length) return;
            if (!(await this.confirm({ title: 'Vider la corbeille ?', message: `${plural(this.data.trash.length, 'élément')} seront supprimés pour toujours.`, ok: 'Vider', danger: true }))) return;
            this.data.trash = []; this.save(); refresh();
        });
    },

    /* ============ session decor: mic button, voice bar ============ */
    sessionDecor() {
        const s = this.session;
        if (!s || !s.current || !$('#view-session .session-top')) return;
        const usable = s.kind === 'srs' || s.kind === 'practice';
        if (!s.focusSeen) { s.focusSeen = true; if (this.focus && this.focus.open && !this.focus.collapsed) this.focusSet({ collapsed: true }); }
        this.audioBarSync(usable);
        if (usable && this.voice && this.voice.on && !this.voice.rec && !this.voice.starting) this.voiceRun();
        this.bindSwipe();
    },
    /* answer shown: drag the card to answer. Review: right = Bien, left = Raté, up = Facile, down = Difficile (up/down only when the page does not scroll);
       free revision: right = I knew it, left = missed. The buttons stay. */
    bindSwipe() {
        const s = this.session, card = $('#view-session .flashcard');
        if (!s || (s.kind !== 'practice' && s.kind !== 'srs') || !s.revealed || s.answer === 'type' || !card) return;
        /* up / down (Facile / Difficile): with a mouse always; with a finger only when the page does not scroll (otherwise the slide would scroll the page) */
        const srs = s.kind === 'srs', fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches, still = document.documentElement.scrollHeight <= innerHeight + 4;
        let vert = srs && still;
        card.style.touchAction = still && srs ? 'none' : 'pan-y';
        const txt = srs ? (vert || fine ? '<span>← Raté</span><span>↑ Facile · ↓ Difficile</span><span>Bien →</span>' : '<span>← Raté</span><span>Bien →</span>') : '<span>← Raté</span><span>Je savais →</span>';
        const hint = $('#swipe-hint'); if (hint) hint.innerHTML = txt; else card.insertAdjacentHTML('afterend', `<p class="swipe-hint" id="swipe-hint">${txt}</p>`);
        const COL = { 1: 'var(--again, #e11d48)', 2: 'var(--hard, #d97706)', 3: 'var(--good, #2563eb)', 4: 'var(--easy, #16a34a)' };   // the colour of the answer buttons
        const NAME = { 3: 'Bien', 1: 'Raté', 4: 'Facile', 2: 'Difficile' }, CLS = { 3: 'swipe-ok', 1: 'swipe-ko', 4: 'swipe-easy', 2: 'swipe-hard' };
        let x0 = 0, y0 = 0, dx = 0, dy = 0, active = false, id = s.current, raf = 0;
        /* once the card is moving it follows the finger in every direction: the answer is the side the card is on when the finger lifts, so a wrong choice is fixed by sliding to another side, without lifting */
        const axisOf = () => (vert && Math.abs(dy) > Math.abs(dx) ? 'y' : 'x');
        const gradeOf = () => (axisOf() === 'x' ? (dx > 0 ? 3 : 1) : (dy < 0 ? 4 : 2));
        const pull = () => (axisOf() === 'x' ? Math.abs(dx) : Math.abs(dy));
        const reset = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } lastStep = lastG = -1; card.style.willChange = ''; card.style.transition = 'transform .18s'; card.style.transform = ''; card.classList.remove('swiping'); card.style.removeProperty('--sw-a'); Object.values(CLS).forEach(c => card.classList.remove(c)); delete card.dataset.swipe; active = false; };
        /* the card is moved once per screen frame (not on every touch event) and only its position changes while the finger moves; the tint changes in a few steps */
        let lastStep = -1, lastG = -1;
        const paint = () => {
            raf = 0;
            try {
                card.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${dx / 28}deg)`;
                const p = pull(), g = p > 50 ? gradeOf() : 0, dir = gradeOf(), step = Math.min(4, Math.floor(p / 30));
                if (step !== lastStep || dir !== lastG) {
                    lastStep = step; lastG = dir;
                    card.classList.add('swiping'); card.style.setProperty('--sw-c', COL[srs ? dir : (dx > 0 ? 4 : 1)]); card.style.setProperty('--sw-a', (step * 0.1).toFixed(2));
                    Object.entries(CLS).forEach(([k, c]) => card.classList.toggle(c, Number(k) === g));
                    if (g && srs) card.dataset.swipe = NAME[g]; else delete card.dataset.swipe;
                    if (g && !srs) { card.classList.toggle('swipe-ok', dx > 0); card.classList.toggle('swipe-ko', dx < 0); }
                }
            } catch { /* a drawing problem must never stop the review */ }
        };
        const end = () => {
            if (!active) return;
            if (raf) { cancelAnimationFrame(raf); raf = 0; }
            const gr = gradeOf(), ax = axisOf(), dist = ax === 'x' ? dx : dy;
            if (pull() > 90 && this.session === s && s.current === id && s.revealed) {
                const fx = ax === 'x' ? (dist > 0 ? 520 : -520) : 0, fy = ax === 'y' ? (dist > 0 ? 520 : -520) : 0;
                card.style.transition = 'transform .16s, opacity .16s'; card.style.transform = `translate(${fx}px, ${fy}px) rotate(${fx ? (fx > 0 ? 16 : -16) : 0}deg)`; card.style.opacity = '0';
                setTimeout(() => { if (this.session === s && s.current === id) { if (srs) this.grade(gr); else this.practiceAnswer(gr >= 3); } }, 130);
                active = false;
            } else reset();
        };
        const h = {
            start: (x, y, e, mouse) => { x0 = x; y0 = y; dx = dy = 0; active = false; vert = srs && (mouse || still); card.style.transition = 'none'; },
            move: (x, y) => {
                const mx = x - x0, my = y - y0;
                if (!active) {
                    if (Math.abs(mx) > 12 && Math.abs(mx) > Math.abs(my) * 1.4) active = true;
                    else if (vert && Math.abs(my) > 12 && Math.abs(my) > Math.abs(mx) * 1.4) active = true;
                    else return;
                    card.style.willChange = 'transform';
                    if (window.getSelection) { try { window.getSelection().removeAllRanges(); } catch { /* ignore */ } }
                }
                dx = mx; dy = vert ? my : 0;
                if (!raf) raf = requestAnimationFrame(paint);
            },
            end, cancel: reset
        };
        dragBind(card, h); wheelDrag(card, h);
    },
    /* during a review: a swipe from the very left edge to the right goes back to the previous card (same as Z / ← on a keyboard) */
    initSwipeBack() {
        let x0 = -1, y0 = 0, t0 = 0;
        document.addEventListener('touchstart', e => { const t = e.touches[0]; x0 = e.touches.length === 1 && t.clientX < 26 && this.session && (this.session.kind === 'srs' || this.session.kind === 'practice') && !this.modals.length ? t.clientX : -1; y0 = t.clientY; t0 = Date.now(); }, { passive: true });
        document.addEventListener('touchend', e => {
            if (x0 < 0) return; const t = e.changedTouches[0], dx = t.clientX - x0, dy = Math.abs(t.clientY - y0); x0 = -1;
            if (dx > 80 && dy < 60 && Date.now() - t0 < 700 && this.session && this.session.history.length) this.undo();
        }, { passive: true });
    },
    /* a quick horizontal slide on a page goes to the next / previous tab: a finger (not from the very edge), a mouse drag on an empty part of the page, or two fingers on a trackpad.
       Not on a field, a chart, anything that scrolls sideways, or (to the left) a list row: there it shows the row's buttons. */
    initTabSwipe() {
        const ORDER = ['dashboard', 'decks', 'notes', 'stats', 'settings'];
        let x0 = -1, y0 = 0, t0 = 0, onRow = false, live = false, cur = null, nbEl = null, nbSide = 0, lastX = 0, ly = 0, hist = [];
        const nbDrop = () => { if (nbEl) { nbEl.classList.add('hidden'); nbEl.style.cssText = ''; document.body.classList.remove('tab-drag'); nbEl = null; } };
        const sideScroll = el => { for (let n = el; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); if (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 2) return true; } return false; };
        const allowed = el => !this.session && !this.modals.length && !this.popover && !this.ui.selMode && ORDER.includes(this.view) && !(this.view === 'notes' && this.ui.note) && el && el.closest
            && !el.closest('textarea, select, input[type=range], [contenteditable], .chart, .range, [data-chart-box], .leo-bubble') && !(el.closest('input') && el.closest('input') === document.activeElement) && !sideScroll(el);   // (a search field that is not being typed in does not stop a slide)
        const go = dx => { const i = ORDER.indexOf(this.view), j = i + (dx < 0 ? 1 : -1); if (j >= 0 && j < ORDER.length) this.tabGo(ORDER[j]); };
        dragBind(document, {
            start: (x, y, e, mouse) => {
                const el = e.target, ok = allowed(el) && (mouse ? !el.closest('[data-action], label, summary, .card-row, .nb-row, .panel-click') : x > 26 && x < innerWidth - 26);
                x0 = ok ? x : -1; y0 = y; t0 = Date.now(); onRow = ok && (!!el.closest('.card-row, .nb-row') || !!this._openRow);   // (on a row — or while a row is open — a slide only shows / hides its buttons, it never changes tab)
                return ok ? true : false;
            },
            /* the page follows the finger (like Instagram) and the next page is really there beside it (already drawn); on release it finishes the slide by itself, quickly if you flicked */
            move: (x, y, e, mouse) => {
                if (x0 < 0 || mouse) return; const dx = x - x0, dy = y - y0; lastX = x; ly = y; const tn = performance.now(); if (hist.length > 5) hist.shift(); hist.push([tn, x]);
                if (!live) {
                    if (!(Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.15 && !onRow)) return;
                    live = true; cur = $(`#view-${this.view}`); if (cur) { cur.style.transition = 'none'; cur.style.willChange = 'transform'; }
                }
                const side = dx < 0 ? 1 : -1, jj = ORDER.indexOf(this.view) + side, ok = jj >= 0 && jj < ORDER.length;
                if (nbSide !== side) {
                    nbDrop(); nbSide = side; const ne = ok ? $(`#view-${ORDER[jj]}`) : null;
                    if (ne) {
                        if (ne.innerHTML.length < 300) this.tabWarmOne(ORDER[jj]);   // (not drawn yet: drawn now, once)
                        const top = Math.max(0, $('.topbar').getBoundingClientRect().bottom); nbEl = ne; document.body.classList.add('tab-drag'); ne.classList.remove('hidden');
                        ne.style.cssText = `position:fixed;left:0;right:0;top:${top}px;bottom:0;overflow:hidden;padding:16px 16px 0;pointer-events:none;z-index:2;background:var(--bg);will-change:transform;transition:none;transform:translate3d(${side * innerWidth}px,0,0)`;
                    }
                }
                if (!cur) return; const d = ok ? dx : dx * 0.22;
                cur.style.transform = `translate3d(${d}px,0,0)`; if (nbEl) nbEl.style.transform = `translate3d(${d + side * innerWidth}px,0,0)`;
            },
            end: (x, y, e, mouse) => {
                if (x0 < 0) return; if (!mouse && live) { x = lastX; y = ly; } const dx = x - x0, dy = Math.abs(y - y0), dt = Math.max(1, Date.now() - t0); x0 = -1;
                const i = ORDER.indexOf(this.view), side = dx < 0 ? 1 : -1, j = i + side, ok = j >= 0 && j < ORDER.length;
                const h0 = hist[0] || [performance.now() - 80, x], vel = (x - h0[1]) / Math.max(16, performance.now() - h0[0]);   // px per ms over the last moments of the gesture
                if (live) {
                    live = false; const c = cur, n = nbEl, W = innerWidth; cur = null; nbSide = 0; hist = [];
                    const good = ok && dy * 1.2 < Math.abs(dx) + 40 && !this.session && (Math.abs(dx) > W * 0.25 || (Math.abs(vel) > 0.25 && Math.sign(vel) === Math.sign(dx) && Math.abs(dx) > 24));
                    const dur = good ? clamp(Math.round((W - Math.abs(dx)) / Math.max(0.9, Math.abs(vel) * 1.4) ), 140, 280) : 220, ease = 'cubic-bezier(.22,.75,.28,1)';
                    const fin = () => {
                        if (good) {
                            this._noAnim = true; go(dx); this._noAnim = false;   // the next page is already drawn: it is simply kept (see tab-warm.js)
                            requestAnimationFrame(() => { if (n) { n.style.cssText = ''; document.body.classList.remove('tab-drag'); if (nbEl === n) nbEl = null; } c.style.cssText = ''; });
                        } else { c.style.cssText = ''; if (nbEl === n) nbDrop(); }
                    };
                    c.style.transition = `transform ${dur}ms ${ease}`; if (n) n.style.transition = `transform ${dur}ms ${ease}`;
                    requestAnimationFrame(() => { c.style.transform = good ? `translate3d(${-side * W}px,0,0)` : 'translate3d(0,0,0)'; if (n) n.style.transform = good ? 'translate3d(0,0,0)' : `translate3d(${side * W}px,0,0)`; });
                    let done = false; const once = () => { if (done) return; done = true; fin(); }; c.addEventListener('transitionend', once, { once: true }); setTimeout(once, dur + 80);
                    return;
                }
                if (Math.abs(dx) < 90 || dy * 2.2 > Math.abs(dx) || Date.now() - t0 > 650 || this.session || onRow) return;
                go(dx);
            },
            cancel: () => { x0 = -1; if (live && cur) { cur.style.transition = 'transform .2s'; cur.style.transform = ''; } nbDrop(); nbSide = 0; live = false; cur = null; hist = []; }
        });
        /* trackpad: two fingers sliding sideways. One slide = one tab: the tail of the slide (its gliding) never counts as another one; a new slide can start while the previous one is still
           gliding only if it is a real new push (the speed fell, then clearly rises again) and some time has passed, so tabs can still be chained quickly */
        let sum = 0, lastT = 0, prev = 0, locked = false, fell = false, lockT = 0, low = 0;
        document.addEventListener('wheel', e => {
            if (e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.5 || !allowed(e.target) || e.target.closest('.card-row, .nb-row')) return;
            e.preventDefault();
            const now = e.timeStamp, v = Math.abs(e.deltaX);   // (the time the event was made, not the time it was handled: a tab that takes long to draw must not look like a pause)
            if (now - lastT > 110) { locked = false; fell = false; sum = 0; prev = 0; }   // a pause: a new slide
            else if (locked) {
                if (v < prev - 2) { fell = true; low = fell && low ? Math.min(low, v) : v; }
                else if (fell && now - lockT > 400 && v > 28 && v > low * 3 + 10 && v > prev + 6) { locked = false; fell = false; sum = 0; }   // a clear new push
            }
            lastT = now; prev = v;
            if (locked) return;
            sum += e.deltaX;
            if (Math.abs(sum) > 90) { const d = sum; sum = 0; locked = true; fell = false; low = 0; lockT = now; go(d > 0 ? -1 : 1); }   // (fingers to the left = next tab)
        }, { passive: false });
    },
    /* the card list: slide a row to the left to show two buttons (⭐ mark, 🙈 put away until tomorrow), like in iOS Messages; nothing happens until a button is tapped.
       Works with a finger, a mouse drag, or two fingers on a trackpad. */
    initRowSwipe() {
        const SEL = '#card-list .card-row, #nb-list .nb-row[data-kind=note]';
        const Wof = r => (r && r.classList.contains('nb-row') ? 216 : 168);
        let row = null, x0 = 0, y0 = 0, dx = 0, on = false, base = 0;
        const close = (r = this._openRow) => { if (!r) return; r.style.transition = 'transform .2s'; r.style.transform = ''; r.classList.remove('sw-open'); if (this._openRow === r) this._openRow = null; };
        this._closeRow = close;
        const actions = r => {
            if (r.querySelector('.row-actions')) return;
            const box = document.createElement('span'); box.className = 'row-actions';
            if (r.classList.contains('nb-row')) {
                const n = this.note(r.dataset.id), id = esc(r.dataset.id);
                box.style.width = `${Wof(r)}px`;
                box.innerHTML = `<button data-action="nb-swipe" data-act="pin" data-id="${id}" aria-label="Épingler">${ic('pin')}<small>${n && n.pin ? 'Désépingler' : 'Épingler'}</small></button><button data-action="nb-swipe" data-act="fav" data-id="${id}" aria-label="Favori">${ic('star')}<small>${n && n.fav ? 'Retirer' : 'Favori'}</small></button><button data-action="nb-swipe" data-act="del" data-id="${id}" class="danger" aria-label="Supprimer">${ic('trash')}<small>Supprimer</small></button>`;
                r.appendChild(box); return;
            }
            const c = this.card(r.dataset.card), buried = c && c.buriedUntil > Date.now();
            box.innerHTML = `<button data-action="row-act" data-act="mark" data-card="${esc(r.dataset.card)}" aria-label="Marquer">${ic('star')}<small>${c && c.marked ? 'Retirer' : 'Marquer'}</small></button><button data-action="row-act" data-act="bury" data-card="${esc(r.dataset.card)}" aria-label="Enfouir">${ic('eyeOff')}<small>${buried ? 'Déterrer' : 'Enfouir'}</small></button>`;
            r.appendChild(box);
        };
        const open = r => { actions(r); r.style.transition = 'transform .2s'; r.style.transform = `translateX(${-Wof(r)}px)`; r.classList.add('sw-open'); this._openRow = r; };
        dragBind(document, {
            start: (x, y, e) => {
                const t = e.target.closest ? e.target.closest(SEL) : null, r = t && !this._dragging && !e.target.closest('.nb-grip, .nb-fold') && (t.classList.contains('nb-row') ? !this.ui.noteSelMode : !this.ui.selMode) ? t : null;
                if (this._openRow && this._openRow !== r && !e.target.closest('.row-actions')) close();
                row = r && !e.target.closest('.row-actions') ? r : null;
                if (!row) return false;
                x0 = x; y0 = y; dx = 0; on = false; base = row.classList.contains('sw-open') ? -Wof(row) : 0; row.style.transition = 'none';
            },
            move: (x, y) => {
                if (!row) return;
                const mx = x - x0, my = y - y0;
                if (!on && Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { row = null; return; }   // (scrolling up / down always wins)
                if (!on && Math.abs(mx) > 24 && Math.abs(mx) > Math.abs(my) * 2.6) { on = true; actions(row); }
                if (!on) return;
                dx = Math.max(-Wof(row) - 24, Math.min(0, base + mx)); row.style.transform = `translateX(${dx}px)`;
            },
            end: () => {
                if (!row) return;
                const r = row, was = on, d = dx; row = null; on = false;
                if (!was) return;
                this._rowSwiped = Date.now();
                if (d < -Wof(r) * 0.6) open(r); else close(r);
            },
            cancel: () => { if (row) { close(row); row = null; on = false; } }
        });
        /* trackpad: two fingers to the left on a row shows its buttons, to the right hides them */
        let rest = 0;
        document.addEventListener('wheel', e => {
            const r0 = e.target.closest ? e.target.closest(SEL) : null, r = r0 && (r0.classList.contains('nb-row') ? !this.ui.noteSelMode : !this.ui.selMode) ? r0 : null;
            if (!r || e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.5) return;
            e.preventDefault();
            const now = Date.now(); if (now - rest < 500) { rest = now - 400; return; }
            if (e.deltaX > 20 && !r.classList.contains('sw-open')) { if (this._openRow) close(); open(r); rest = now; }
            else if (e.deltaX < -20 && r.classList.contains('sw-open')) { close(r); rest = now; }
        }, { passive: false });
    },
    /* two separate switches under the progress bar: reading aloud (speaker) and voice commands (microphone) */
    audioBarSync(usable) {
        let bar = $('#audio-bar');
        if (!usable) { if (bar) bar.remove(); return; }
        const set = this.data.settings, on = !!(this.voice && this.voice.on);
        const html = `<button class="chip ${set.autoSpeak ? 'active' : ''}" data-action="autospeak-toggle" aria-pressed="${!!set.autoSpeak}" title="Lit la question puis la réponse à voix haute">${ic('volume')}Lecture : ${set.autoSpeak ? 'oui' : 'non'}</button>
            <button class="chip ${on ? 'active' : ''}" data-action="voice-toggle" aria-pressed="${on}" title="Dire « réponse », « bien », « suivant »… pour avancer sans toucher l'écran">${ic('mic')}Voix : ${on ? 'oui' : 'non'}</button>`;
        if (!bar) { const pb = $('#view-session .pbar'); if (!pb) return; pb.insertAdjacentHTML('afterend', `<div class="audio-bar" id="audio-bar">${html}</div>`); }
        else if (bar.dataset.h !== html) bar.innerHTML = html;
        const cur = $('#audio-bar'); if (cur) cur.dataset.h = html;
        if (on && !$('#voice-bar')) cur.insertAdjacentHTML('afterend', `<div class="voice-bar" id="voice-bar"><span class="rec-dot"></span><span id="voice-msg">🎤 Dis : « réponse » (ou « indice »), puis « bien », « difficile », « raté », « facile » ou « suivant »</span></div>`);
        if (!on) { const vb = $('#voice-bar'); if (vb) vb.remove(); }
    },
    sessionCleanup() {
        this.voiceStop(true);
    },

    /* ============ voice commands (the microphone only: reading aloud is a separate switch) ============
       One recognition runs for the whole time the mode is on (no restart between cards, so no repeated beep and nothing
       missed), reacts as soon as a command is recognized even before the end of the sentence, shows what it hears live,
       and checks every alternative the recogniser proposes. */
    voiceSupported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); },
    voiceToggle() {
        if (!this.voice) this.voice = { on: false, rec: null, starting: false, fails: 0, last: 0 };
        if (!this.voiceSupported()) { this.toast('La reconnaissance vocale n\'est pas disponible ici (essaie Chrome, Edge ou Safari récent, en https).', 'warning', ic('mic')); return; }
        const v = this.voice;
        if (v.on) { this.voiceStop(true); this.toast('Commande vocale désactivée', 'success', ic('mic')); this.syncVoiceUi(); return; }
        v.on = true; v.fails = 0;
        this.syncVoiceUi();
        this.voiceRun();
    },
    syncVoiceUi() { const s = this.session; this.audioBarSync(!!(s && s.current && (s.kind === 'srs' || s.kind === 'practice'))); },
    voiceStop(off) {
        const v = this.voice;
        if (!v) return;
        if (off) v.on = false;
        v.starting = false;
        clearTimeout(v.timer);
        try { if (v.rec) { v.rec.onresult = v.rec.onerror = v.rec.onend = null; v.rec.abort(); } } catch { /* ignore */ }
        v.rec = null;
    },
    voiceMsg(t) { const el = $('#voice-msg'); if (el) el.textContent = t; },
    voiceRun() {
        const v = this.voice, SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!v || !v.on || !SR || v.rec) return;
        let rec;
        try { rec = new SR(); } catch { return; }
        v.rec = rec; v.starting = true;
        rec.lang = 'fr-FR'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 5;
        try { const G = window.SpeechGrammarList || window.webkitSpeechGrammarList; if (G) { const g = new G(); g.addFromString('#JSGF V1.0; grammar c; public <c> = réponse | bien | difficile | raté | facile | suivant | répète | annule | stop ;', 1); rec.grammars = g; } } catch { /* optional */ }
        let handled = -1;
        rec.onstart = () => { v.starting = false; v.fails = 0; };
        rec.onresult = e => {
            const s = this.session;
            if (!s || !s.current || (s.kind !== 'srs' && s.kind !== 'practice')) return;
            for (let i = e.resultIndex; i < e.results.length; i++) {
                if (i <= handled) continue;
                const res = e.results[i], alts = [];
                for (let k = 0; k < res.length; k++) alts.push(res[k].transcript);
                if (alts[0]) this.voiceMsg(`🎤 ${alts[0].trim()}${res.isFinal ? '' : '…'}`);
                if (Date.now() - v.last < 800) continue;
                const cmd = alts.map(parseVoice).find(c => c !== null && c !== undefined);
                if (cmd !== undefined && cmd !== null) { handled = i; v.last = Date.now(); this.voiceAct(cmd, alts[0]); try { rec.abort(); } catch { /* restart clears the buffer */ } return; }
                if (res.isFinal) { handled = i; this.voiceMsg(`« ${alts[0].trim()} » : pas compris. Dis « réponse », « indice », « bien », « suivant »…`); }
            }
        };
        rec.onerror = e => {
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.voiceStop(true); this.syncVoiceUi(); this.toast('Micro refusé : autorise-le dans ton navigateur.', 'error', ic('mic')); }
            else if (e.error !== 'no-speech' && e.error !== 'aborted') v.fails++;
        };
        rec.onend = () => {
            v.rec = null; v.starting = false;
            if (!v.on) return;
            if (v.fails >= 4) { this.voiceStop(true); this.syncVoiceUi(); this.toast('La reconnaissance vocale s\'est arrêtée (micro indisponible). Touche « Commande vocale » pour relancer.', 'warning', ic('mic')); return; }
            v.timer = setTimeout(() => this.voiceRun(), 200 + v.fails * 400);
        };
        try { rec.start(); } catch { v.rec = null; v.starting = false; v.fails++; v.timer = setTimeout(() => this.voiceRun(), 600); }
    },
    /* what a recognized command does, depending on the card state */
    voiceAct(cmd, heard) {
        const s = this.session;
        if (!s || !s.current) return;
        const grades = ['', 'Raté', 'Difficile', 'Bien', 'Facile'];
        if (cmd === 'stop') { this.voiceStop(true); this.syncVoiceUi(); this.toast('Commande vocale désactivée', 'success', ic('mic')); return; }
        if (cmd === 'repeat') { this.voiceMsg('🔊 Je relis'); this.speak(); return; }
        if (cmd === 'hint') {
            const c = this.card(s.current), slot = $('#hint-slot');
            if (s.revealed) { this.voiceMsg('💡 La réponse est déjà affichée'); return; }
            if (!c.hint) { this.voiceMsg('💡 Pas d\'indice pour cette carte'); return; }
            this.voiceMsg('💡 Indice');
            if (slot && !slot.innerHTML) this.handleAction('hint');
            return;
        }
        if (cmd === 'undo') { this.voiceMsg('↩ Annulé'); this.undo(); return; }
        if (cmd === 'reveal' || (!s.revealed && (typeof cmd === 'number' || cmd === 'next'))) { if (!s.revealed) { this.voiceMsg('✔ Réponse'); this.reveal(); } return; }
        if (s.revealed && (typeof cmd === 'number' || cmd === 'next')) {
            const g = cmd === 'next' ? 3 : cmd;
            this.voiceMsg(`✔ ${grades[g]}${cmd === 'next' ? ' · suivante' : ''}`);
            if (s.kind === 'srs') this.grade(g); else this.practiceAnswer(g >= 3);
        }
    }
});
/* the session decorations (timer, mic, voice bar) are added after every render of a card */
(() => { const base = SuperAnki.prototype.renderSession; SuperAnki.prototype.renderSession = function (...a) { const r = base.apply(this, a); this.sessionDecor(); return r; }; })();
(() => { const base = SuperAnki.prototype.showSummary; SuperAnki.prototype.showSummary = function (...a) { this.sessionCleanup(); return base.apply(this, a); }; })();

/* ============================================================
   Quiz: plausible wrong answers.
   Distractors are chosen among cards whose answer LOOKS like the right one (same sub-deck, shared words,
   similar length and shape, similar question) so the right answer can't be guessed from its length or format.
   Numeric answers get close numeric alternatives.
   ============================================================ */
const quizTokens = t => new Set(fold(t).split(/[^a-z0-9]+/).filter(w => w.length > 2));
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let i = 0; a.forEach(x => { if (b.has(x)) i++; }); return i / (a.size + b.size - i); };
const quizShape = t => ({ num: /^[\s\d.,%€$£+\-–/:x×()]+$/.test(t) && /\d/.test(t), digits: /\d/.test(t), upper: /^[A-ZÀ-ÖØ-Þ]/.test(t), words: t.split(/\s+/).length, pct: /%/.test(t), money: /[€$£]/.test(t), sentence: /[.!?]$/.test(t) });
function numericAlternatives(text, n) {
    const m = text.match(/-?\d[\d\s]*(?:[.,]\d+)?/);
    if (!m) return [];
    const raw = m[0], val = Number(raw.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(val)) return [];
    const dec = (raw.split(/[.,]/)[1] || '').length, fmt = v => { let s = v.toFixed(dec); if (dec) s = s.replace('.', raw.includes(',') ? ',' : '.'); return text.replace(raw, s); };
    const steps = val === 0 ? [1, 2, 5] : [val * 0.5, val * 2, val * 1.2, val * 0.8, val + Math.max(1, Math.abs(val) * 0.1), val - Math.max(1, Math.abs(val) * 0.1), val * 10, val / 10];
    const out = [];
    for (const v of shuffle(steps)) {
        const w = Number.isInteger(val) ? Math.round(v) : Math.round(v * 10 ** Math.max(dec, 1)) / 10 ** Math.max(dec, 1);
        const t = fmt(w);
        if (w !== val && w > 0 === val > 0 && !out.includes(t)) out.push(t);
        if (out.length >= n) break;
    }
    return out;
}
Object.assign(SuperAnki.prototype, {
    buildOptions(card) {
        const ans = c => stripHtml(this.cardAnswer(c)).trim();
        const correct = ans(card), cNorm = normAnswer(correct) || card.id, cTok = quizTokens(correct), fTok = quizTokens(stripHtml(card.front));
        const cShape = quizShape(correct), cLang = guessLang(correct), cLen = correct.length || 1;
        const deck = this.deck(card.deckId), parent = deck && deck.parent;
        const seen = new Set([cNorm]);
        const usable = this.data.cards.filter(c => c.id !== card.id && (!c.nid || c.nid !== card.nid) && c.kind !== 'cloze' && c.kind !== 'occl' && !c.suspended);
        const scored = [];
        usable.forEach(c => {
            const t = ans(c);
            if (!t) return;
            const n = normAnswer(t) || c.id;
            if (n === cNorm || (n.length > 3 && (cNorm.includes(n) || n.includes(cNorm)) && cNorm.length > 3)) return;   // same answer, or contains it
            const sh = quizShape(t), tok = quizTokens(t);
            let sc = 0;
            if (c.deckId === card.deckId) sc += 3; else { const d2 = this.deck(c.deckId); if (parent && d2 && d2.parent === parent) sc += 1.5; }
            sc += jaccard(cTok, tok) * 4 + jaccard(fTok, quizTokens(stripHtml(c.front))) * 2;
            sc += (1 - Math.abs(t.length - cLen) / Math.max(t.length, cLen)) * 2.5;
            if (sh.num === cShape.num) sc += 1.5; else sc -= 2;
            if (sh.upper === cShape.upper) sc += 0.6;
            if (sh.pct === cShape.pct) sc += 0.6;
            if (sh.money === cShape.money) sc += 0.6;
            if (sh.sentence === cShape.sentence) sc += 0.6;
            if (Math.abs(sh.words - cShape.words) <= 1) sc += 0.8;
            if (card.tags.length && c.tags.some(x => card.tags.includes(x))) sc += 0.8;
            sc += guessLang(t) === cLang ? 1.5 : -2.5;
            scored.push({ c, t, n, tok, sc: sc + Math.random() * 0.9 });
        });
        scored.sort((a, b) => b.sc - a.sc);
        const picks = [];
        for (const x of scored) {
            if (picks.length >= 3) break;
            if (seen.has(x.n) || picks.some(p => jaccard(p.tok, x.tok) > 0.85 && x.tok.size > 1)) continue;
            seen.add(x.n); picks.push(x);
        }
        const options = [{ id: card.id, ok: true }, ...picks.map(x => ({ id: x.c.id, ok: false }))];
        if (cShape.num && picks.length < 3) {       // numbers: close alternatives instead of random cards
            numericAlternatives(correct, 3 - picks.length).forEach(t => options.push({ id: card.id, ok: false, text: t }));
        }
        return shuffle(options);
    }
});
