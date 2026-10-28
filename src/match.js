/* ============================================================
   Association : relier chaque question à sa réponse le plus vite possible.
   6 paires par manche (deux colonnes mélangées), chaque erreur ajoute 2 s au temps.
   Seules les cartes courtes sont utilisées. Le meilleur temps est gardé par paquet.
   Un jeu : il ne touche ni au planning, ni à l'historique de révision, ni aux compteurs d'erreurs des cartes.
   ============================================================ */
const MATCH_PAIRS = 6, MATCH_PENALTY = 2000, MATCH_MAXLEN = 40;
const fmtMatch = ms => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

Object.assign(SuperAnki.prototype, {
    /* the cards that fit on a button: short text on both sides, one pair per distinct question and per distinct answer */
    matchPool(deckIds) {
        const seenQ = new Set(), seenA = new Set(), out = [];
        this.poolFor(deckIds).forEach(c => {
            if (c.kind === 'cloze' || c.kind === 'occl' || c.kind === 'custom') return;
            const f = stripHtml(c.front).trim(), b = stripHtml(this.cardAnswer(c)).trim();
            if (!f || !b || f.length > MATCH_MAXLEN || b.length > MATCH_MAXLEN || hasImage(c.front) || hasImage(c.back)) return;
            const kf = fold(f), kb = fold(b);
            if (seenQ.has(kf) || seenA.has(kb) || kf === kb) return;
            seenQ.add(kf); seenA.add(kb); out.push({ id: c.id, f, b });
        });
        return out;
    },
    matchKey(deckIds) { return deckIds === 'errors' ? 'errors' : Array.isArray(deckIds) && deckIds.length === 1 ? deckIds[0] : 'all'; },
    startMatch(deckIds) {
        const pool = this.matchPool(deckIds);
        if (pool.length < MATCH_PAIRS) {
            this.toast(`Pas assez de cartes courtes dans cette sélection : il en faut ${MATCH_PAIRS}, il y en a ${pool.length}. (Question et réponse de ${MATCH_MAXLEN} caractères au plus.)`, 'warning');
            return;
        }
        const deck = Array.isArray(deckIds) && deckIds.length === 1 ? this.deck(deckIds[0]) : null;
        this.session = {
            kind: 'match', title: `Association · ${deckIds === 'errors' ? 'Mes erreurs' : deck ? deck.name : 'Tous les paquets'}`,
            deckIds, key: this.matchKey(deckIds), deck: [], round: 0, startedAt: Date.now(), done: 0, correct: 0, total: 0, missed: [], timer: null
        };
        this.go('session');
        this.matchRound();
    },
    /* a new round: 6 other pairs when possible (the pool is walked through before pairs come back) */
    matchRound() {
        const s = this.session;
        if (!s || s.kind !== 'match') return;
        clearInterval(s.timer);
        const pool = this.matchPool(s.deckIds);
        if (pool.length < MATCH_PAIRS) { this.toast('Plus assez de cartes courtes.', 'warning'); this.endSession(true); return; }
        s.deck = s.deck.filter(id => pool.some(p => p.id === id));
        if (s.deck.length < MATCH_PAIRS) s.deck = shuffle(pool.map(p => p.id));
        const ids = s.deck.splice(0, MATCH_PAIRS), by = new Map(pool.map(p => [p.id, p]));
        s.pairs = ids.map(id => by.get(id)); s.left = shuffle(s.pairs.map(p => p.id)); s.right = shuffle(s.pairs.map(p => p.id));
        s.matched = new Set(); s.selL = s.selR = null; s.errors = 0; s.round++; s.t0 = null; s.final = null; s.busy = false;
        this.renderMatch();
    },
    matchElapsed() { const s = this.session; return s.t0 ? Date.now() - s.t0 + s.errors * MATCH_PENALTY : s.errors * MATCH_PENALTY; },
    renderMatch() {
        const s = this.session, by = new Map(s.pairs.map(p => [p.id, p]));
        const tile = (id, side) => { const p = by.get(id), done = s.matched.has(id), sel = (side === 'l' ? s.selL : s.selR) === id; return `<button class="mg-tile ${done ? 'done' : ''} ${sel ? 'sel' : ''}" data-action="mg-pick" data-side="${side}" data-id="${esc(id)}" ${done ? 'disabled' : ''}>${esc(side === 'l' ? p.f : p.b)}</button>`; };
        const best = (this.data.stats.matchBest || {})[s.key];
        $('#view-session').innerHTML = `
        <div class="session">
            <div class="session-top">
                <button class="icon-btn" title="Quitter (Échap)" data-action="quit-session">${ic('x')}</button>
                <div class="session-title"><h3>${esc(s.title)}</h3><p>Manche ${s.round} · relie chaque question à sa réponse · erreur = +2 s</p></div>
                <div class="session-counts"><span id="mg-time">${fmtMatch(this.matchElapsed())}</span></div>
            </div>
            <div class="pbar"><i id="mg-bar" style="width:${s.matched.size / MATCH_PAIRS * 100}%"></i></div>
            <p class="small faint" style="text-align:center;margin:2px 0 0">${best ? `Record du paquet : <b>${fmtMatch(best)}</b>` : 'Pas encore de record ici'}${s.errors ? ` · <span style="color:var(--due)">${plural(s.errors, 'erreur')}</span>` : ''}</p>
            <div class="mg-board" id="mg-board">
                <div class="mg-col">${s.left.map(id => tile(id, 'l')).join('')}</div>
                <div class="mg-col">${s.right.map(id => tile(id, 'r')).join('')}</div>
            </div>
        </div>`;
        clearInterval(s.timer);
        s.timer = setInterval(() => { if (this.session !== s || s.final) { clearInterval(s.timer); return; } const t = $('#mg-time'); if (t) t.textContent = fmtMatch(this.matchElapsed()); }, 100);
    },
    matchAction(action, el) {
        const ds = el.dataset || {};
        if (action === 'mg-pick') this.matchPick(ds.side, ds.id);
        else if (action === 'mg-next') this.matchRound();
        else if (action === 'mg-end') this.endSession(true);
    },
    matchPick(side, id) {
        const s = this.session;
        if (!s || s.kind !== 'match' || s.final || s.busy || s.matched.has(id)) return;
        if (!s.t0) s.t0 = Date.now();   // the clock starts at the first tap
        if (side === 'l') s.selL = s.selL === id ? null : id; else s.selR = s.selR === id ? null : id;
        $$('.mg-tile').forEach(b => b.classList.toggle('sel', (b.dataset.side === 'l' ? s.selL : s.selR) === b.dataset.id && !b.disabled));
        if (!s.selL || !s.selR) return;
        const good = s.selL === s.selR, l = $(`.mg-tile[data-side=l][data-id="${CSS.escape(s.selL)}"]`), r = $(`.mg-tile[data-side=r][data-id="${CSS.escape(s.selR)}"]`);
        if (good) {
            s.matched.add(s.selL);
            [l, r].forEach(b => { if (b) { b.classList.remove('sel'); b.classList.add('done'); b.disabled = true; } });
            s.selL = s.selR = null;
            if (typeof sfx === 'function') sfx('right');
            const bar = $('#mg-bar'); if (bar) bar.style.width = `${s.matched.size / MATCH_PAIRS * 100}%`;
            if (s.matched.size === MATCH_PAIRS) this.matchFinish();
        } else {
            s.errors++; s.busy = true;
            [l, r].forEach(b => { if (b) { b.classList.remove('sel'); b.classList.add('bad'); } });
            if (typeof sfx === 'function') sfx('wrong');
            const t = $('#mg-time'); if (t) t.textContent = fmtMatch(this.matchElapsed());
            setTimeout(() => { if (this.session !== s) return; [l, r].forEach(b => b && b.classList.remove('bad')); s.selL = s.selR = null; s.busy = false; }, 450);
        }
    },
    matchFinish() {
        const s = this.session; clearInterval(s.timer);
        const time = Date.now() - s.t0, total = time + s.errors * MATCH_PENALTY, best = this.data.stats.matchBest || (this.data.stats.matchBest = {}), prev = best[s.key] || 0;
        const record = !prev || total < prev;
        if (record) { best[s.key] = total; this.save(); }
        s.final = { time, total, record, prev };
        s.done += MATCH_PAIRS;
        if (typeof sfx === 'function') sfx('done');
        if (record && s.round >= 1 && prev) setTimeout(() => this.confetti(), 250);
        setTimeout(() => {
            if (this.session !== s) return;
            const box = document.createElement('div');
            box.className = 'mg-result panel panel-pad';
            box.innerHTML = `<div class="summary-emoji" style="font-size:2.2rem">${record ? '🏆' : '🎯'}</div>
                <h3 style="margin:4px 0">${record ? (prev ? 'Nouveau record !' : 'Premier temps enregistré !') : 'Manche terminée !'}</h3>
                <p style="font-size:1.6rem;font-weight:800;margin:4px 0">${fmtMatch(total)}</p>
                <p class="small muted">${fmtMatch(time)} de jeu${s.errors ? ` + ${plural(s.errors, 'erreur')} × 2 s` : ' · sans erreur !'}${!record && prev ? ` · record ${fmtMatch(prev)}` : ''}</p>
                <div style="display:grid;gap:10px;margin-top:14px"><button class="btn btn-primary btn-lg" data-action="mg-next">${ic('play')}Manche suivante</button><button class="btn btn-soft btn-lg" data-action="mg-end">${ic('home')}Terminer</button></div>`;
            const sess = $('#view-session .session'); if (sess) { sess.appendChild(box); box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
        }, 450);
    }
});
