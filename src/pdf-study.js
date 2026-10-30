/* ============================================================
   Panneau « Étude du PDF » (Vague 4) : niveau → matériel d'apprentissage (résumé, cartes, quiz) → plan d'étude
   par chapitres avec progression CALCULÉE (cartes maîtrisées, QCM réussis, jamais inventée) → sujets à revoir.
   Chapitres : sommaire du PDF, sinon proposés par l'IA (aperçu avant envoi), ou définis à la main.
   Les cartes d'un chapitre portent l'étiquette `ch-<id>` (ou viennent d'une sélection dans ses pages) ; ses QCM ont `ch`.
   ============================================================ */
const ST_LEVELS = [['new', 'Pas encore appris', 'Je découvre : résumé détaillé, plus de cartes, quiz simple.'], ['basic', 'Compréhension de base', 'Je connais les grandes lignes : résumé court, cartes normales.'], ['review', 'Je veux juste réviser', 'Je connais déjà : résumé court, peu de cartes, quiz exigeant.']];
Object.assign(SuperAnki.prototype, {
    stLevelInfo(p) {
        const l = (p && p.study && p.study.level) || 'basic';
        return { new: { summary: 'full', cards: 40, cardsHint: 'Étudiant débutant : fiches simples sur les définitions et notions de base.', quizHint: 'Questions de compréhension de base, mauvaises réponses clairement différentes.' },
            basic: { summary: 'short', cards: 20, cardsHint: '', quizHint: '' },
            review: { summary: 'short', cards: 10, cardsHint: 'Étudiant qui révise : ne garde que les points essentiels et les pièges.', quizHint: 'Questions exigeantes, mauvaises réponses très plausibles.' } }[l];
    },
    /* the real figures of one chapter */
    stStats(p, ch) {
        const ids = new Set(p.pdeck ? this.descendantIds(p.pdeck) : []), pageN = pid => { const g = p.pg.find(x => x.id === pid); return g && g.k === 'p' ? g.n : 0; };
        const cards = this.data.cards.filter(c => ids.has(c.deckId) && ((c.tags || []).includes(`ch-${ch.id}`) || (c.src && c.src.pdf === p.id && (n => n >= ch.a && n <= ch.b)(pageN(c.src.pid)))));
        const mature = cards.filter(c => c.state === 'review' && c.interval >= MATURE_IVL).length, due = this.nbDueIn(cards), weak = cards.filter(c => c.lapses >= 2 || (c.lapses > 0 && c.state !== 'review'));
        const qcms = this.data.qcms.filter(q => q.ch === ch.id), qok = qcms.filter(q => q.right > q.wrong).length, qweak = qcms.filter(q => q.wrong > q.right);
        const parts = []; if (cards.length) parts.push(mature / cards.length); if (qcms.length) parts.push(qok / qcms.length);
        const pct = parts.length ? Math.round(parts.reduce((s, v) => s + v, 0) / parts.length * 100) : 0;
        const step = !cards.length && !qcms.length ? { k: 'gen', l: 'Générer du matériel' } : due.length ? { k: 'train', l: `Réviser ${plural(due.length, 'carte')}` } : !qcms.length ? { k: 'quiz', l: 'Faire un quiz' } : qok < qcms.length ? { k: 'quiz', l: 'Plus de questions de quiz' } : pct >= 100 ? { k: 'done', l: 'Chapitre maîtrisé' } : { k: 'read', l: 'Relire le chapitre' };
        return { cards, mature, due, weak, qcms, qok, qweak, pct, step };
    },
    stSave() { const p = this.pv.p; p.mod = Date.now(); this.save(false); },
    stPanel() {
        const pv = this.pv; if (!pv) return; const p = pv.p; this.closePopover();
        const m = this.openModal({ title: `${ic('brain')} Étude du PDF`, size: 'wide', body: '<div id="st-root"></div>' });
        const root = $('#st-root', m);
        const paint = () => { root.innerHTML = this.stHtml(p); };
        const run = async fn => { this.closeModal(m); await fn(); };
        const setCh = (ch, a, b, t) => { ch.t = t; ch.a = clamp(a, 1, p.pages); ch.b = clamp(b, ch.a, p.pages); };
        root.addEventListener('click', async e => {
            const b = e.target.closest('[data-st]'); if (!b) return; const [k, id] = b.dataset.st.split(':'), ch = p.study.ch.find(c => c.id === id), all = ch ? { range: [ch.a, ch.b], ch: ch.id } : {};
            if (k === 'lvl') { p.study.level = id; this.stSave(); paint(); }
            else if (k === 'sum') run(() => this.aiSummary(null, { ...all, k: id === 'full' ? 'full' : 'short', ...(ch ? {} : {}) }));
            else if (k === 'sumc') run(() => this.aiSummary(null, { range: [ch.a, ch.b], k: 'short' }));
            else if (k === 'cards') run(() => this.aiPdfCards(all));
            else if (k === 'quiz') run(() => this.aiPdfQuiz(ch ? { range: [ch.a, ch.b], ch: ch.id, n: 10 } : {}));
            else if (k === 'genmenu') this.showMenu(b, [{ icon: 'sparkle', label: 'Résumé en 2 minutes', fn: () => run(() => this.aiSummary(null, { ...all, k: 'short' })) }, { icon: 'sparkle', label: 'Résumé détaillé', fn: () => run(() => this.aiSummary(null, { ...all, k: 'full' })) }, { icon: 'copy', label: 'Cartes', fn: () => run(() => this.aiPdfCards(all)) }, { icon: 'quiz', label: 'Quiz (QCM)', fn: () => run(() => this.aiPdfQuiz(ch ? { range: [ch.a, ch.b], ch: ch.id } : {})) }]);
            else if (k === 'read') { this.closeModal(m); this.pdfGoto(ch.a); }
            else if (k === 'train') { const s = this.stStats(p, ch); this.closeModal(m); this.pdfLeaveTo(() => this.startSrsIds(`${p.name} · ${ch.t}`, s.due.map(c => c.id), false)); }
            else if (k === 'cardsedit') { const s = this.stStats(p, ch); s.cards.forEach(c => { if (!(c.tags || []).includes(`ch-${ch.id}`)) { c.tags = [...(c.tags || []), `ch-${ch.id}`]; c.mod = Date.now(); } }); this.save(); this.ui.deck = p.pdeck; this.ui.search = `tag:ch-${ch.id}`; this.closeModal(m); this.pdfLeaveTo(() => this.go('decks')); }
            else if (k === 'toc') { if (this.stFromToc(p)) paint(); else this.toast('Ce PDF n\'a pas de sommaire exploitable.', 'warning'); }
            else if (k === 'aiplan') { this.closeModal(m); await this.stAiPlan(); this.stPanel(); }
            else if (k === 'add') this.stEdit(null, paint);
            else if (k === 'edit') this.stEdit(ch, paint);
            else if (k === 'reset') { const ok = await this.confirm({ title: 'Refaire le plan ?', message: 'Les chapitres actuels sont supprimés. Tes cartes et QCM restent, mais ne sont plus rangés par chapitre.', ok: 'Supprimer le plan', danger: true }); if (ok) { p.study.ch = []; p.study.src = ''; this.stSave(); paint(); } }
        });
        paint();
    },
    stHtml(p) {
        const s = p.study, lv = s.level, bar = v => `<div class="st-bar"><i style="width:${v}%"></i></div>`;
        const head = lv ? `<div class="chip-row st-lv">${ST_LEVELS.map(([k, l]) => `<button class="chip ${k === lv ? 'active' : ''}" data-st="lvl:${k}">${l}</button>`).join('')}</div>`
            : `<div class="st-ask"><h4>À quel point connais-tu ce contenu ?</h4><p class="small muted">Ta réponse règle la profondeur du résumé, le nombre de cartes et la difficulté du quiz.</p>${ST_LEVELS.map(([k, l, d]) => `<button class="st-opt" data-st="lvl:${k}"><b>${l}</b><span>${d}</span></button>`).join('')}</div>`;
        if (!lv) return `<p style="margin:0 0 12px"><b>${esc(p.name)}</b></p>${head}`;
        const stats = s.ch.map(c => ({ c, s: this.stStats(p, c) }));
        const chap = stats.length ? stats.map(({ c, s: x }) => `<div class="st-ch">
            <div class="st-ch-h"><div><b>${esc(c.t)}</b><small>pages ${c.a}${c.b > c.a ? '–' + c.b : ''}</small></div><span class="st-pct">${x.pct}%</span><button class="icon-btn" data-st="edit:${c.id}" aria-label="Modifier le chapitre">${ic('pencil')}</button></div>
            ${bar(x.pct)}
            <p class="small muted" style="margin:6px 0">${x.cards.length || x.qcms.length ? [x.cards.length ? `${x.mature} carte${x.mature > 1 ? 's' : ''} maîtrisée${x.mature > 1 ? 's' : ''} sur ${x.cards.length}` : '', x.cards.length ? `${x.due.length} à réviser sur ${x.cards.length}` : '', x.qcms.length ? `${x.qok} QCM réussi${x.qok > 1 ? 's' : ''} sur ${x.qcms.length}` : ''].filter(Boolean).join(' · ') : 'Pas encore de cartes ni de quiz pour ce chapitre.'}</p>
            <div class="row-gap"><button class="btn ${x.step.k === 'done' ? 'btn-soft' : 'btn-primary'} btn-sm" data-st="${x.step.k === 'gen' ? 'genmenu' : x.step.k === 'done' ? 'read' : x.step.k}:${c.id}">${ic(x.step.k === 'train' ? 'play' : x.step.k === 'done' ? 'check' : 'sparkle')}${x.step.l}</button>
            <button class="btn btn-soft btn-sm" data-st="read:${c.id}">${ic('file')}Lire</button>
            ${x.cards.length ? `<button class="btn btn-soft btn-sm" data-st="cardsedit:${c.id}">${ic('layers')}Modifier les cartes</button>` : ''}
            ${x.due.length && x.step.k !== 'train' ? `<button class="btn btn-soft btn-sm" data-st="train:${c.id}">${ic('play')}Continuer l'entraînement</button>` : ''}
            ${x.step.k !== 'gen' ? `<button class="btn btn-soft btn-sm" data-st="genmenu:${c.id}">${ic('sparkle')}Générer</button>` : ''}</div></div>`).join('')
            : `<p class="small muted">Découpe ton PDF en chapitres pour suivre ta progression.</p>
               <div class="row-gap">${p.toc && p.toc.length > 1 ? `<button class="btn btn-primary btn-sm" data-st="toc">${ic('toc')}Utiliser le sommaire du PDF</button>` : ''}<button class="btn ${p.toc && p.toc.length > 1 ? 'btn-soft' : 'btn-primary'} btn-sm" data-st="aiplan">${ic('sparkle')}Proposer avec l'IA</button><button class="btn btn-soft btn-sm" data-st="add">${ic('plus')}Ajouter un chapitre</button></div>`;
        const weakList = stats.map(({ c, s: x }) => ({ c, n: x.weak.length, q: x.qweak.length })).filter(x => x.n || x.q).sort((a, b) => b.n + b.q - (a.n + a.q)).slice(0, 5);
        const weak = weakList.length ? weakList.map(({ c, n, q }) => `<div class="st-weak"><div><b>${esc(c.t)}</b><small>${[n ? plural(n, 'carte difficile', 'cartes difficiles') : '', q ? plural(q, 'QCM raté', 'QCM ratés') : ''].filter(Boolean).join(' · ')}</small></div><div class="row-gap"><button class="btn btn-soft btn-sm" data-st="sumc:${c.id}">${ic('sparkle')}Résumé de 2 minutes</button><button class="btn btn-soft btn-sm" data-st="quiz:${c.id}">${ic('quiz')}Plus de questions</button></div></div>`).join('') : '<p class="small muted" style="margin:0">Rien de particulier pour l\'instant : ça apparaîtra quand tu rateras des cartes ou des QCM.</p>';
        return `${head}
            <h4 class="st-h">Matériel d'apprentissage</h4>
            <p class="small muted" style="margin:0 0 8px">Généré par l'IA à partir de ton PDF (tu relis avant d'ajouter).</p>
            <div class="row-gap"><button class="btn btn-primary btn-sm" data-st="genmenu:">${ic('sparkle')}Générer du matériel d'apprentissage</button></div>
            <h4 class="st-h">Plan d'étude ${s.src === 'ai' ? '<small class="faint">proposé par l\'IA, à corriger</small>' : ''}</h4>
            ${chap}
            ${stats.length ? `<div class="row-gap" style="margin-top:10px"><button class="btn btn-soft btn-sm" data-st="add">${ic('plus')}Ajouter un chapitre</button><button class="btn btn-soft btn-sm" data-st="reset">${ic('refresh')}Refaire le plan</button></div>` : ''}
            <h4 class="st-h">Sujets qui demandent ton attention</h4>${weak}`;
    },
    /* chapters from the PDF's own table of contents */
    stFromToc(p) {
        const toc = (p.toc || []).filter(t => t.t && t.n >= 1 && (t.d || 0) <= 1).sort((a, b) => a.n - b.n), seen = new Set(), items = toc.filter(t => !seen.has(t.n) && seen.add(t.n));
        if (items.length < 2) return false;
        p.study.ch = items.map((t, i) => ({ id: uid('h'), t: t.t.slice(0, 120), a: clamp(t.n, 1, p.pages), b: clamp((items[i + 1] ? items[i + 1].n - 1 : p.pages), t.n, p.pages) }));
        p.study.src = 'toc'; this.stSave(); return true;
    },
    /* no table of contents: the AI proposes chapters from the first words of each page */
    async stAiPlan() {
        const pv = this.pv, p = pv.p; if (!this.aiReady()) { this.aiNeedKey(); return; }
        const tot = p.pages; let txt = '';
        const st = this.toast ? null : null;
        for (let n = 1; n <= Math.min(tot, 300); n++) { const t = await this.pdfPageText(n); txt += `[page ${n}] ${(t || '').replace(/\s+/g, ' ').slice(0, 160)}\n`; }
        if (txt.replace(/\[page \d+\]/g, '').trim().length < 80) { this.toast('Ce PDF n\'a presque pas de texte : lance d\'abord « Lire ce PDF avec l\'IA ».', 'warning'); return; }
        const system = `Tu découpes un cours en chapitres pour un étudiant. Réponds UNIQUEMENT par des lignes au format "Titre du chapitre | page de début | page de fin", dans l'ordre, sans trou ni chevauchement, de 3 à 12 chapitres, pages entre 1 et ${tot}. Titres courts en français. Base-toi seulement sur le texte fourni.`;
        const out = await this.aiRun({ title: 'Plan du PDF avec l\'IA', what: `PDF « ${p.name} » (début de chaque page)`, chars: txt.length, pages: Math.min(tot, 300), preview: txt, jobs: [{ system, prompt: `Voici le début de chaque page :\n\n${txt}`, maxTokens: 1500 }] });
        if (!out) return;
        let rows = out[0].split('\n').map(l => /^\s*(?:[-*\d.)]+\s*)?(.+?)\s*\|\s*(\d+)\s*\|\s*(\d+)/.exec(l)).filter(Boolean).map(m => ({ t: m[1].replace(/\*\*/g, '').trim(), a: Number(m[2]), b: Number(m[3]) })).filter(r => r.t && r.a >= 1 && r.a <= tot).sort((x, y) => x.a - y.a);
        rows.forEach((r, i) => { r.b = clamp(r.b, r.a, tot); if (i > 0 && r.a <= rows[i - 1].b) rows[i - 1].b = Math.max(rows[i - 1].a, r.a - 1); });
        if (rows.length < 2) { this.toast('L\'IA n\'a pas proposé de plan exploitable. Tu peux ajouter tes chapitres à la main.', 'warning'); return; }
        p.study.ch = rows.slice(0, 40).map(r => ({ id: uid('h'), t: r.t.slice(0, 120), a: r.a, b: r.b })); p.study.src = 'ai'; this.stSave();
    },
    stEdit(ch, done) {
        const p = this.pv.p, isNew = !ch, last = p.study.ch[p.study.ch.length - 1];
        const m = this.openModal({ title: isNew ? 'Nouveau chapitre' : 'Modifier le chapitre', size: 'narrow',
            body: `<div class="field"><label class="label" for="ste-t">Titre</label><input class="input" id="ste-t" maxlength="120" value="${esc(ch ? ch.t : '')}" placeholder="Ex : Les marchés financiers"></div>
                <div class="row-gap"><label class="field" style="flex:1"><span class="label">De la page</span><input class="input" id="ste-a" type="number" min="1" max="${p.pages}" value="${ch ? ch.a : last ? Math.min(p.pages, last.b + 1) : 1}"></label><label class="field" style="flex:1"><span class="label">à la page</span><input class="input" id="ste-b" type="number" min="1" max="${p.pages}" value="${ch ? ch.b : Math.min(p.pages, (last ? last.b + 1 : 1) + 4)}"></label></div>`,
            foot: `${ch ? `<button class="btn btn-soft" style="color:var(--due)" id="ste-del">${ic('trash')}Supprimer</button>` : ''}<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="ste-ok">${ic('check')}Enregistrer</button>` });
        $('#ste-ok', m).addEventListener('click', () => {
            const t = $('#ste-t', m).value.trim() || 'Chapitre', a = clamp(parseInt($('#ste-a', m).value, 10) || 1, 1, p.pages), b = clamp(parseInt($('#ste-b', m).value, 10) || a, 1, p.pages);
            if (isNew) p.study.ch.push({ id: uid('h'), t: t.slice(0, 120), a: Math.min(a, b), b: Math.max(a, b) }); else { ch.t = t.slice(0, 120); ch.a = Math.min(a, b); ch.b = Math.max(a, b); }
            p.study.ch.sort((x, y) => x.a - y.a); if (!p.study.src) p.study.src = 'hand'; this.stSave(); this.closeModal(m); done();
        });
        const del = $('#ste-del', m); if (del) del.addEventListener('click', () => { p.study.ch = p.study.ch.filter(c => c !== ch); this.stSave(); this.closeModal(m); done(); });
        setTimeout(() => $('#ste-t', m).focus(), 60);
    }
});
