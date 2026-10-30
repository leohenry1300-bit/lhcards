/* ============================================================
   QCM sur mesure : des questions à choix multiples écrites à la main, rangées dans un paquet.
   Ils sont mélangés aux questions du Quiz, mais ne sont jamais des cartes : pas de planning, pas de « à réviser »,
   pas d'historique de révision, pas d'optimiseur. Leur score (réussis / ratés) reste sur chaque QCM.
   Sauvegarde, synchronisation, corbeille et annulation les suivent comme les cartes.
   ============================================================ */
const QCM_MAX_OPTIONS = 6;
function normalizeQcm(x) {
    if (!x || typeof x !== 'object') return null;
    const o = toArray(x.o).map(a => ({ t: String(a && a.t != null ? a.t : '').trim().slice(0, 300), ok: !!(a && a.ok) })).filter(a => a.t).slice(0, QCM_MAX_OPTIONS);
    const q = String(x.q || '').trim().slice(0, 600);
    if (!q || o.length < 2 || !o.some(a => a.ok)) return null;
    return {
        id: String(x.id || uid('q')), deckId: String(x.deckId || ''), q, o, multi: o.filter(a => a.ok).length > 1 || !!x.multi,
        expl: String(x.expl || '').trim().slice(0, 600), created: num(x.created, 0), mod: num(x.mod, 0), right: num(x.right, 0), wrong: num(x.wrong, 0), off: !!x.off, ch: x.ch ? String(x.ch).slice(0, 40) : ''
    };
}
const qcmSig = q => JSON.stringify([q.deckId, q.q, q.o, q.multi, q.expl, q.right, q.wrong, q.off]);
const qcmKey = q => fold(q).replace(/[^a-z0-9]+/g, ' ').trim();

/* « Plusieurs QCM d'un coup » : des blocs séparés par une ligne vide.
     Quelle est la capitale de la France ?
     a) Paris *            (la bonne réponse se marque par « * » à la fin, « [x] » devant, ou une ligne « Réponse : A »)
     b) Rome
     => explication facultative                                                                                     */
function parseQcmBlocks(text) {
    const items = [], skipped = [];
    const blocks = []; let cur = null;
    String(text || '').split(/\r?\n/).forEach((raw, i) => {
        if (!raw.trim()) { cur = null; return; }
        if (!cur) { cur = { n: i + 1, lines: [] }; blocks.push(cur); }
        cur.lines.push(raw.trim());
    });
    const optRe = /^(?:\[( |x|X)\]\s*|([A-Fa-f1-6])\s*[).:]\s+|[-•–]\s+|\*\s+|[✓✔]\s*)(.+)$/;
    const explRe = /^(?:=>|→|expl(?:ication)?\.?\s*:|explication\s*:)\s*(.*)$/i;
    const keyRe = /^(?:bonnes?\s+r[ée]ponses?|r[ée]ponses?|answers?)\s*:\s*([A-Fa-f1-6][A-Fa-f1-6\s,;et&+]*)$/i;
    blocks.forEach(b => {
        const q = [b.lines[0]], o = [], expl = []; let key = null;
        for (const ln of b.lines.slice(1)) {
            let m;
            if ((m = explRe.exec(ln))) { expl.push(m[1]); continue; }
            if ((m = keyRe.exec(ln))) { key = m[1].toUpperCase().replace(/[^A-F1-6]/g, '').split(''); continue; }
            if ((m = optRe.exec(ln))) {
                let t = m[3].trim(), ok = (m[1] || '').toLowerCase() === 'x' || /^[✓✔]/.test(ln);
                if (/\s\*$|\s*[✓✔]$/.test(t)) { ok = true; t = t.replace(/\s*(\*|[✓✔])$/, '').trim(); }
                o.push({ t, ok, letter: (m[2] || '').toUpperCase() }); continue;
            }
            if (expl.length) expl.push(ln); else if (o.length) o[o.length - 1].t += ' ' + ln; else q.push(ln);
        }
        if (key) o.forEach((a, idx) => { if (key.includes(a.letter || String.fromCharCode(65 + idx)) || key.includes(String(idx + 1))) a.ok = true; });
        const text = q.join('\n').replace(/^\s*(?:q(?:uestion)?\s*\d*\s*[:.)]|\d+\s*[.)])\s*/i, '').trim();
        const raw = b.lines[0];
        if (!text) skipped.push({ n: b.n, raw, why: 'question vide' });
        else if (o.length < 2) skipped.push({ n: b.n, raw, why: 'il faut au moins 2 réponses' });
        else if (o.length > QCM_MAX_OPTIONS) skipped.push({ n: b.n, raw, why: `${QCM_MAX_OPTIONS} réponses au maximum` });
        else if (!o.some(a => a.ok)) skipped.push({ n: b.n, raw, why: 'aucune bonne réponse marquée (ajoute « * » à la fin de la bonne)' });
        else items.push({ n: b.n, q: text, o: o.map(a => ({ t: a.t, ok: a.ok })), expl: expl.join(' ').trim(), multi: o.filter(a => a.ok).length > 1 });
    });
    return { items, skipped };
}

Object.assign(SuperAnki.prototype, {
    qcm(id) { return id && this.data.qcms.find(q => q.id === id) || null; },
    /* QCM of a deck and of all its sub-decks */
    qcmsOf(deckId) { const set = new Set(this.descendantIds(deckId)); return this.data.qcms.filter(q => set.has(q.deckId)); },
    /* those mixed into a Quiz started on these decks (everything, one deck + sub-decks; never « Mes erreurs ») */
    qcmPool(deckIds) {
        if (deckIds === 'errors') return [];
        if (!deckIds) return this.data.qcms.filter(q => !q.off);
        const set = new Set(deckIds.flatMap(id => this.descendantIds(id)));
        return this.data.qcms.filter(q => !q.off && set.has(q.deckId));
    },
    qcmRefresh() { this.searchCache.clear(); if (this.view === 'decks') this.renderDeckPanel(); else if (this.view === 'dashboard') this.render(); },

    /* ---------- the block shown on a deck's page ---------- */
    qcmBlockHtml(deckId) {
        const list = this.qcmsOf(deckId).sort((a, b) => a.created - b.created);
        const rows = list.map(q => {
            const tot = q.right + q.wrong, dk = q.deckId !== deckId ? this.deck(q.deckId) : null;
            return `<button class="qcm-row" data-action="qcm-edit" data-id="${esc(q.id)}"><span class="qcm-q">${esc(truncate(q.q, 90))}</span><span class="qcm-meta">${dk ? `${esc(dk.emoji)} ${esc(dk.name)} · ` : ''}${q.multi ? 'plusieurs réponses · ' : ''}${tot ? `${q.right}/${tot} réussi${q.right > 1 ? 's' : ''}` : 'jamais posé'}</span></button>`;
        }).join('');
        return `<div class="qcm-box">
            <div class="qcm-head"><span class="qcm-title">${ic('quiz')}<b>QCM sur mesure</b>${list.length ? `<span class="tag">${list.length}</span>` : ''}</span>
                <span class="qcm-btns"><button class="btn btn-soft btn-sm" data-action="qcm-new" data-deck="${esc(deckId)}">${ic('plus')}Nouveau QCM</button>
                <button class="btn btn-soft btn-sm" data-action="qcm-bulk" data-deck="${esc(deckId)}" title="Écrire ou coller plusieurs QCM d'un coup">${ic('list')}Plusieurs d'un coup</button></span></div>
            ${list.length ? `<details class="qcm-list"><summary>Voir les ${plural(list.length, 'QCM', 'QCM')} <span class="faint">· ils arrivent dans le Quiz de ce paquet</span></summary>${rows}</details>` : `<p class="small faint" style="margin:6px 0 0">Écris tes propres questions à choix multiples : elles se mélangent aux questions du Quiz, sans toucher au planning.</p>`}
        </div>`;
    },
    qcmAction(action, el) {
        const ds = el.dataset || {};
        if (action === 'qcm-new') this.openQcmEditor(null, ds.deck);
        else if (action === 'qcm-edit') this.openQcmEditor(ds.id);
        else if (action === 'qcm-bulk') this.openQcmBulk(ds.deck);
        else if (action === 'qcm-pick') this.qcmPick(Number(ds.i));
        else if (action === 'qcm-check') this.qcmCheck();
    },

    /* ---------- add or edit one QCM ---------- */
    openQcmEditor(id, deckId) {
        if (!this.data.decks.length) { this.toast('Crée d\'abord un paquet.', 'warning'); this.openDeckModal(); return; }
        const q = id ? this.qcm(id) : null;
        if (id && !q) return;
        const deckSel = q ? q.deckId : (deckId && this.deck(deckId) ? deckId : this.sortedDecks()[0].id);
        const rowHtml = (o = { t: '', ok: false }) => `<div class="qe-row ${o.ok ? 'ok' : ''}"><button type="button" class="qe-ok" data-qe="ok" title="Bonne réponse" aria-label="Bonne réponse" aria-pressed="${o.ok}">${ic('check')}</button><input class="input" data-qe="t" maxlength="300" placeholder="Réponse" value="${esc(o.t)}"><button type="button" class="icon-btn icon-btn-sm" data-qe="del" title="Retirer cette réponse" aria-label="Retirer cette réponse">${ic('x')}</button></div>`;
        const start = q ? q.o : [{ t: '', ok: true }, { t: '', ok: false }, { t: '', ok: false }, { t: '', ok: false }];
        const m = this.openModal({
            title: q ? 'Modifier le QCM' : 'Nouveau QCM', size: 'wide',
            body: `<div class="field"><label class="label" for="qe-deck">Paquet</label><select class="select" id="qe-deck">${this.sortedDecks().map(d => `<option value="${esc(d.id)}" ${d.id === deckSel ? 'selected' : ''}>${esc(d.emoji)} ${esc(this.deckPath(d.id))}</option>`).join('')}</select></div>
                <div class="field"><label class="label" for="qe-q">Question</label><textarea class="textarea" id="qe-q" rows="3" maxlength="600" placeholder="Ex : Quelle est la capitale de l'Italie ?">${esc(q ? q.q : '')}</textarea></div>
                <div class="field"><span class="label">Réponses <span class="faint">(touche ✓ pour marquer la ou les bonnes)</span></span><div id="qe-rows">${start.map(rowHtml).join('')}</div>
                    <button type="button" class="btn btn-soft btn-sm" id="qe-add" style="margin-top:6px">${ic('plus')}Ajouter une réponse</button></div>
                <label class="check" style="margin-bottom:10px"><input type="checkbox" id="qe-multi" ${q && q.multi ? 'checked' : ''}> Plusieurs bonnes réponses possibles (il faut toutes les cocher)</label>
                <div class="field"><label class="label" for="qe-expl">Explication <span class="faint">(facultative, affichée après la réponse)</span></label><textarea class="textarea" id="qe-expl" rows="2" maxlength="600">${esc(q ? q.expl : '')}</textarea></div>`,
            foot: `<button class="btn btn-soft" data-close>Annuler</button>${q ? `<button class="btn btn-danger-soft" id="qe-del">${ic('trash')}Supprimer</button>` : ''}<button class="btn btn-primary" id="qe-save">${ic('check')}Enregistrer</button>`
        });
        const rows = $('#qe-rows', m), multi = $('#qe-multi', m);
        const oks = () => $$('.qe-row.ok', rows);
        rows.addEventListener('click', e => {
            const b = e.target.closest('[data-qe]'); if (!b) return;
            const row = b.closest('.qe-row');
            if (b.dataset.qe === 'ok') {
                const on = !row.classList.contains('ok');
                if (on && !multi.checked) $$('.qe-row.ok', rows).forEach(r => { r.classList.remove('ok'); $('[data-qe=ok]', r).setAttribute('aria-pressed', 'false'); });
                row.classList.toggle('ok', on); b.setAttribute('aria-pressed', String(on));
            } else if (b.dataset.qe === 'del') { if ($$('.qe-row', rows).length > 2) row.remove(); else this.toast('Il faut au moins 2 réponses.', 'warning'); }
        });
        multi.addEventListener('change', () => { if (!multi.checked) oks().slice(1).forEach(r => { r.classList.remove('ok'); $('[data-qe=ok]', r).setAttribute('aria-pressed', 'false'); }); });
        $('#qe-add', m).addEventListener('click', () => {
            if ($$('.qe-row', rows).length >= QCM_MAX_OPTIONS) { this.toast(`${QCM_MAX_OPTIONS} réponses au maximum.`, 'warning'); return; }
            rows.insertAdjacentHTML('beforeend', rowHtml()); $$('.qe-row input', rows).pop().focus();
        });
        if (q) $('#qe-del', m).addEventListener('click', () => {
            this.change('suppression de QCM', [], () => { this.data.qcms = this.data.qcms.filter(x => x.id !== q.id); }, { qcms: true });
            this.closeModal(m); this.qcmRefresh(); this.undoToast('QCM supprimé', ic('trash'));
        });
        $('#qe-save', m).addEventListener('click', () => {
            const o = $$('.qe-row', rows).map(r => ({ t: $('[data-qe=t]', r).value.trim(), ok: r.classList.contains('ok') })).filter(a => a.t);
            const text = $('#qe-q', m).value.trim();
            if (!text) { this.toast('Écris la question.', 'warning'); return; }
            if (o.length < 2) { this.toast('Il faut au moins 2 réponses.', 'warning'); return; }
            if (!o.some(a => a.ok)) { this.toast('Marque au moins une bonne réponse (touche ✓).', 'warning'); return; }
            const rec = normalizeQcm({ id: q ? q.id : uid('q'), deckId: $('#qe-deck', m).value, q: text, o, multi: multi.checked, expl: $('#qe-expl', m).value, created: q ? q.created : Date.now(), mod: q ? q.mod : 0, right: q ? q.right : 0, wrong: q ? q.wrong : 0 });
            this.change(q ? 'modification de QCM' : 'nouveau QCM', [], () => { if (q) Object.assign(q, rec); else this.data.qcms.push(rec); }, { qcms: true });
            this.closeModal(m); this.qcmRefresh();
            this.toast(q ? 'QCM modifié' : 'QCM ajouté', 'success', ic('check'));
        });
        setTimeout(() => { const f = $('#qe-q', m); if (f && !q) f.focus(); }, 60);
    },

    /* ---------- write several QCM at once (paste, preview, import) ---------- */
    openQcmBulk(deckId, opts = {}) {
        if (!this.data.decks.length) { this.toast('Crée d\'abord un paquet.', 'warning'); this.openDeckModal(); return; }
        const deckSel = deckId && this.deck(deckId) ? deckId : this.sortedDecks()[0].id;
        const m = this.openModal({
            title: 'Plusieurs QCM d\'un coup', size: 'wide',
            body: `<p class="small muted" style="margin-bottom:12px">Un QCM par bloc, séparés par une ligne vide. Première ligne = la question, puis une réponse par ligne. Marque la bonne avec <code>*</code> à la fin (plusieurs <code>*</code> = plusieurs bonnes réponses), ou ajoute une ligne <code>Réponse : B</code>. Une ligne <code>=&gt; …</code> donne l'explication.</p>
                <div class="field"><label class="label" for="qb-deck">Paquet de destination</label><select class="select" id="qb-deck">${this.sortedDecks().map(d => `<option value="${esc(d.id)}" ${d.id === deckSel ? 'selected' : ''}>${esc(d.emoji)} ${esc(this.deckPath(d.id))}</option>`).join('')}</select></div>
                ${opts.ai ? '<p class="small" style="margin:0 0 10px">✨ <b>Généré par IA</b> : relis, décoche ou corrige avant d\'ajouter.</p>' : ''}
                <div class="field"><label class="label" for="qb-text">Colle ou écris tes QCM</label><textarea class="textarea" id="qb-text" rows="9" placeholder="Capitale de l'Italie ?&#10;a) Rome *&#10;b) Milan&#10;c) Naples&#10;&#10;Quels sont des fruits ?&#10;a) Pomme *&#10;b) Carotte&#10;c) Fraise *&#10;=> La carotte est un légume."></textarea></div>
                <div id="qb-preview" class="help">Aucun QCM détecté pour l'instant.</div>`,
            foot: `<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="qb-go" disabled>${ic('check')}Ajouter</button>`
        });
        const ta = $('#qb-text', m), prev = $('#qb-preview', m), go = $('#qb-go', m), sel = $('#qb-deck', m), over = new Map();
        let shown = [];
        const refresh = () => {
            const { items, skipped } = parseQcmBlocks(ta.value);
            const exist = new Set(this.data.qcms.filter(x => x.deckId === sel.value).map(x => qcmKey(x.q))), seen = new Set();
            items.forEach(it => { it.key = qcmKey(it.q); it.dup = exist.has(it.key) ? 'existing' : seen.has(it.key) ? 'paste' : ''; seen.add(it.key); it.on = over.has(`${it.n}|${it.key}`) ? over.get(`${it.n}|${it.key}`) : !it.dup; });
            shown = items;
            const n = items.filter(it => it.on).length, dups = items.filter(it => it.dup).length;
            prev.innerHTML = items.length || skipped.length
                ? `<b>${plural(n, 'QCM', 'QCM')} à ajouter</b>${dups ? ` · ${plural(dups, 'doublon')} signalé${dups > 1 ? 's' : ''} et décoché${dups > 1 ? 's' : ''}` : ''}${skipped.length ? ` · <span style="color:var(--due)">${plural(skipped.length, 'bloc ignoré', 'blocs ignorés')}</span>` : ''}
                   ${items.length ? `<div class="im-list">${items.slice(0, 200).map(it => `<label class="im-row ${it.dup ? 'dup' : ''}"><input type="checkbox" data-qb="${it.n}|${esc(it.key)}" ${it.on ? 'checked' : ''}><span class="im-t"><b>${esc(truncate(it.q, 90))}</b><br><span class="faint">${it.o.map(a => `${a.ok ? '✓ ' : ''}${esc(truncate(a.t, 30))}`).join(' · ')}</span></span>${it.dup ? `<span class="im-badge">${it.dup === 'existing' ? 'déjà dans ce paquet' : 'répété ici'}</span>` : ''}${it.multi ? '<span class="im-badge ok">plusieurs</span>' : ''}</label>`).join('')}</div>` : ''}
                   ${skipped.length ? `<div class="small faint" style="margin-top:6px">${skipped.slice(0, 8).map(x => `<div>ligne ${x.n} (« ${esc(truncate(x.raw, 50))} ») : ${esc(x.why)}</div>`).join('')}${skipped.length > 8 ? `<div>… et ${skipped.length - 8} autres</div>` : ''}</div>` : ''}`
                : 'Aucun QCM détecté pour l\'instant.';
            go.disabled = !n; go.innerHTML = `${ic('check')}${n ? `Ajouter ${plural(n, 'QCM', 'QCM')}` : 'Ajouter'}`;
            return items.filter(it => it.on);
        };
        prev.addEventListener('change', e => { const b = e.target.closest('[data-qb]'); if (b) { over.set(b.dataset.qb, b.checked); refresh(); } });
        ta.addEventListener('input', refresh); sel.addEventListener('change', refresh);
        go.addEventListener('click', () => {
            const rows = refresh(); if (!rows.length) return;
            const now = Date.now(), did = sel.value;
            this.change('QCM ajoutés', [], () => { rows.forEach((it, i) => this.data.qcms.push(normalizeQcm({ id: uid('q'), deckId: did, q: it.q, o: it.o, multi: it.multi, expl: it.expl, created: now + i, ch: opts.ch || '' }))); }, { qcms: true });
            this.closeModal(m); this.qcmRefresh();
            this.toast(`${plural(rows.length, 'QCM ajouté', 'QCM ajoutés')}`, 'success', ic('check'));
        });
        if (opts.text) { ta.value = opts.text; refresh(); }
        setTimeout(() => ta.focus(), 60);
    },

    /* ---------- inside a Quiz ---------- */
    nextQcm(q) {
        const s = this.session;
        s.qcm = q; s.quizCard = q.id; s.options = shuffle(q.o.map(o => ({ text: o.t, ok: o.ok }))); s.picked = new Set(); s.answered = false; s.cardStart = Date.now();
        this.renderQuiz();
    },
    renderQcm() {
        const s = this.session, q = s.qcm, deck = this.deck(q.deckId);
        $('#view-session').innerHTML = `
        <div class="session">
            <div class="session-top">
                <button class="icon-btn" title="Quitter (Échap)" data-action="quit-session">${ic('x')}</button>
                <div class="session-title"><h3>${esc(s.title)}</h3><p>${q.multi ? 'Plusieurs bonnes réponses possibles' : 'Choisis la bonne réponse'} · sans impact sur le planning</p></div>
                <div class="session-counts"><span>${Math.min(s.done + 1, s.total)}<span class="faint">/${s.total}</span></span></div>
                <button class="icon-btn" title="Minuteur de concentration" aria-label="Minuteur" data-action="focus-toggle">${ic('timer')}</button>
            </div>
            <div class="pbar"><i style="width:${s.done / Math.max(1, s.total) * 100}%"></i></div>
            <div class="panel flashcard" style="min-height:0">
                <div class="fc-top"><span class="tag">${esc(deck ? deck.emoji + ' ' + this.deckPath(deck.id) : '')}</span><span class="tag">QCM${q.multi ? ' · plusieurs réponses' : ''}</span></div>
                <div class="fc-content fc-front" style="padding:10px 0 4px;white-space:pre-wrap">${esc(q.q)}</div>
            </div>
            <div class="quiz-options" id="quiz-options">
                ${s.options.map((o, i) => `<button class="quiz-opt" data-action="qcm-pick" data-i="${i}"><span class="k">${q.multi ? '' : i + 1}</span><span>${esc(o.text)}</span></button>`).join('')}
            </div>
            <div id="quiz-after">${q.multi ? `<div class="study-actions"><button class="btn btn-primary btn-lg btn-block" id="qcm-check" data-action="qcm-check" disabled>Valider ma réponse</button></div>` : ''}</div>
        </div>`;
    },
    qcmPick(i) {
        const s = this.session;
        if (!s || !s.qcm || s.answered || !s.options[i]) return;
        if (!s.qcm.multi) { this.qcmFinish(new Set([i])); return; }
        if (s.picked.has(i)) s.picked.delete(i); else s.picked.add(i);
        $$('.quiz-opt').forEach((b, j) => { b.classList.toggle('sel', s.picked.has(j)); const k = $('.k', b); if (k) k.innerHTML = s.picked.has(j) ? ic('check') : ''; });
        const b = $('#qcm-check'); if (b) b.disabled = !s.picked.size;
    },
    qcmCheck() {
        const s = this.session;
        if (!s || !s.qcm || s.answered) return;
        if (!s.picked.size) { this.toast('Choisis au moins une réponse.', 'warning'); return; }
        this.qcmFinish(s.picked);
    },
    qcmFinish(picks) {
        const s = this.session, q = s.qcm, rec = this.qcm(q.id);
        s.answered = true;
        const good = s.options.every((o, i) => !!o.ok === picks.has(i));
        $('#quiz-options').classList.add('locked');
        $$('.quiz-opt').forEach((b, j) => {
            b.classList.remove('sel');
            if (s.options[j].ok) b.classList.add('correct'); else if (picks.has(j)) b.classList.add('wrong'); else b.classList.add('dim');
            const k = $('.k', b); if (k) k.innerHTML = s.options[j].ok ? ic('check') : picks.has(j) ? ic('x') : (q.multi ? '' : j + 1);
        });
        s.done++; s.qcmN = (s.qcmN || 0) + 1;
        if (good) { s.score++; s.correct++; s.qcmOk = (s.qcmOk || 0) + 1; }
        if (rec) { if (good) rec.right++; else rec.wrong++; }
        this.save();
        if (typeof sfx === 'function') sfx(good ? 'right' : 'wrong');
        const missed = q.multi && !good ? s.options.filter((o, i) => o.ok && !picks.has(i)).length : 0, extra = q.multi && !good ? s.options.filter((o, i) => !o.ok && picks.has(i)).length : 0;
        const note = good ? '' : q.multi ? `${missed ? `Il en manquait ${missed}. ` : ''}${extra ? `${extra > 1 ? `${extra} réponses cochées sont fausses.` : 'Une réponse cochée est fausse.'}` : ''}` : '';
        $('#quiz-after').innerHTML = `
            ${note || q.expl ? `<div class="panel panel-pad" style="margin-top:12px;font-size:.95rem">${note ? `<div style="font-weight:700;margin-bottom:${q.expl ? 6 : 0}px">${esc(note.trim())}</div>` : ''}${q.expl ? `<div style="white-space:pre-wrap">${esc(q.expl)}</div>` : ''}</div>` : ''}
            <div class="study-actions"><button class="btn btn-primary btn-lg btn-block" data-action="quiz-next">${s.queue.length ? 'Question suivante' : 'Voir le résultat'} ${ic('chevronRight')}</button></div>`;
    }
});
