/* ============================================================
   IA avancée (Vague 4, lot 5) — ce que RemNote ne fait pas, sans serveur :
   • Assistant sur TOUS mes cours : recherche BM25 locale (gratuite, hors ligne) dans notes, PDF, cartes → réponses en direct (streaming),
     sources cliquables ; modes Répondre / Tuteur socratique / Expliquer simplement ; recherche web au choix.
   • Examen blanc sur mesure (cartes ratées d'abord) : QCM + questions ouvertes corrigées par l'IA, puis cartes avec mes erreurs.
   • Correction de ma réponse écrite pendant la révision (verdict + note conseillée pour Raté/Difficile/Bien/Facile).
   • Sur une sélection de note : reformuler, simplifier, résumer, développer, corriger, traduire, exemple, expliquer ; « Écrire avec l'IA ».
   • Améliorer une carte, mnémotechnique ; image à masquer automatique depuis une page de PDF (vision).
   Tout reste soumis à l'aperçu avant envoi (une fois par séance pour les gestes très courts).
   ============================================================ */
const AI_STOP = new Set('le la les un une des de du et en au aux que qui est sont dans pour par sur avec ce ces cette son sa ses leur leurs ou où mais donc or ni car se ne pas plus il elle ils elles on nous vous je tu me te lui y a the of and to in is are for on with as by an be this that it at or from'.split(' '));
const AiText = {
    _p: null,
    open() { return this._p || (this._p = new Promise(res => { try { const r = indexedDB.open('lh_aitext', 1); r.onupgradeneeded = () => r.result.createObjectStore('pdf', { keyPath: 'hash' }); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch { res(null); } })); },
    async get(hash) { const db = await this.open(); if (!db) return null; return new Promise(res => { try { const q = db.transaction('pdf').objectStore('pdf').get(hash); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch { res(null); } }); },
    async put(hash, pages) { const db = await this.open(); if (!db) return; try { db.transaction('pdf', 'readwrite').objectStore('pdf').put({ hash, pages, at: Date.now() }); } catch { /* ignore */ } },
    async all() { const db = await this.open(); if (!db) return []; return new Promise(res => { try { const q = db.transaction('pdf').objectStore('pdf').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); } catch { res([]); } }); }
};
const aiToks = t => fold(String(t || '')).split(/[^a-z0-9]+/).filter(w => w.length > 1 && !AI_STOP.has(w)).map(w => (w.length > 4 ? w.replace(/(s|x)$/, '') : w));
const cardPlain = c => c.kind === 'cloze' && c.nf ? stripHtml(c.nf.text).replace(CLOZE_RE, '$2') : stripHtml(c.front) + ' → ' + stripHtml(c.back);

Object.assign(SuperAnki.prototype, {
    /* once per session: show what a very short exchange sends, then stop asking */
    aiConsentOnce(key, title, what) {
        this._aiOk = this._aiOk || {}; if (this._aiOk[key]) return Promise.resolve(true);
        return new Promise(res => {
            let fin = false; const c = this.aiCfg();
            const m = this.openModal({ title: `${ic('sparkle')} ${esc(title)}`, size: 'narrow', body: `<p style="margin:0 0 8px">Pour cette fonction, <b>${esc(what)}</b> est envoyé à <b>${esc(c.name)}</b> (modèle ${esc(c.model)}) chaque fois que tu l'utilises.</p><p class="help">Je te le demande une seule fois par séance. Rien d'autre ne part.</p>`, foot: `<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="aic-ok">${ic('check')}D'accord</button>`, onClose: () => { if (!fin) { fin = true; res(false); } } });
            $('#aic-ok', m).addEventListener('click', () => { this._aiOk[key] = true; fin = true; this.closeModal(m); res(true); });
        });
    },
    /* ---------- the knowledge base (my notes, PDFs, cards) searched with BM25 ---------- */
    aiTextNote(hash, n, text) {   // called by the PDF reader each time a page's text is read : kept for the assistant
        const acc = (this._aiAcc = this._aiAcc || {})[hash] = (this._aiAcc || {})[hash] || { pages: [] };
        if (text && !acc.pages[n - 1]) { acc.pages[n - 1] = text; clearTimeout(acc.t); acc.t = setTimeout(async () => { const old = await AiText.get(hash), merged = (old && old.pages) || []; acc.pages.forEach((t, k) => { if (t) merged[k] = t; }); await AiText.put(hash, merged); this._kb = null; }, 2500); }
    },
    async aiKbBuild() {
        const sig = [this.data.updatedAt, this.data.notes.length, this.data.cards.length, this.data.pdfs.length, (this._aiTextVer || 0)].join('|');
        if (this._kb && this._kb.sig === sig) return this._kb;
        const chunks = [], push = (kind, ref, label, text, page) => { text = String(text || '').trim(); if (text.length < 15) return; while (text.length > 900) { let cut = text.lastIndexOf(' ', 900); if (cut < 400) cut = 900; chunks.push({ kind, ref, label, page, text: text.slice(0, cut) }); text = text.slice(cut).trim(); } if (text.length >= 15) chunks.push({ kind, ref, label, page, text }); };
        this.data.notes.forEach(n => { if (this.pdfOfNote(n.id) && n.b.every(b => !b.x || /^PDF :/.test(b.x))) return; let buf = ''; n.b.forEach(b => { if (nbSolid(b.t)) { if (b.t === 'table') b.rows.forEach(r => { buf += ' ' + r.join(' | '); }); return; } const t = this.nbPlain(b.x); if (!t) return; buf += (b.t.startsWith('h') ? '\n# ' : '\n') + t; if (buf.length > 700) { push('note', n.id, this.noteName(n), buf); buf = ''; } }); push('note', n.id, this.noteName(n), buf); });
        const pdfRows = await AiText.all(), byHash = new Map(pdfRows.map(r => [r.hash, r.pages]));
        this.data.pdfs.forEach(p => { const pages = byHash.get(p.hash) || []; for (let k = 0; k < pages.length; k++) { const t = pages[k] || (p.ocr && p.ocr[k + 1]); if (t) push('pdf', p.id, `${p.name} · p.${k + 1}`, t, k + 1); } Object.entries(p.ocr || {}).forEach(([k, t]) => { if (!(pages[Number(k) - 1])) push('pdf', p.id, `${p.name} · p.${k}`, t, Number(k)); }); });
        this.data.cards.slice(0, 4000).forEach(c => push('card', c.id, 'Carte', cardPlain(c)));
        const df = new Map(); let total = 0;
        chunks.forEach(ch => { ch.tf = new Map(); aiToks(ch.label + ' ' + ch.text).forEach(w => ch.tf.set(w, (ch.tf.get(w) || 0) + 1)); ch.len = [...ch.tf.values()].reduce((a, b) => a + b, 0); total += ch.len; ch.tf.forEach((_, w) => df.set(w, (df.get(w) || 0) + 1)); });
        return (this._kb = { sig, chunks, df, avg: total / Math.max(1, chunks.length), pdfDocs: pdfRows.length, notes: this.data.notes.length, cards: this.data.cards.length });
    },
    async aiKbSearch(q, k = 8) {
        const kb = await this.aiKbBuild(), terms = [...new Set(aiToks(q))], N = kb.chunks.length; if (!terms.length || !N) return [];
        const scored = kb.chunks.map(ch => { let s = 0; terms.forEach(w => { const f = ch.tf.get(w); if (!f) return; const idf = Math.log(1 + (N - (kb.df.get(w) || 0) + 0.5) / ((kb.df.get(w) || 0) + 0.5)); s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * ch.len / kb.avg)); }); if (ch.kind === 'note') s *= 1.1; return [s, ch]; }).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]);
        const out = [], per = new Map(); for (const [, ch] of scored) { const key = ch.kind + ch.ref, n = per.get(key) || 0; if (n >= 3) continue; per.set(key, n + 1); out.push(ch); if (out.length >= k) break; } return out;
    },
    /* read the text of every PDF once (slow ones are skipped on iPhone only if the app is busy) so the assistant can search them */
    async aiIndexPdfs(onProgress) {
        let done = 0, added = 0; const list = this.data.pdfs.slice();
        if (!(await loadLazy('pdfjs')) || !window.pdfjsLib) throw new AiError('Le lecteur PDF n\'a pas pu se charger (hors ligne ?).');
        for (const p of list) {
            onProgress && onProgress(done, list.length, p.name); done++;
            const have = await AiText.get(p.hash); if (have && have.pages && have.pages.filter(Boolean).length >= Math.min(p.pages, 3) && have.pages.length >= p.pages - 1) continue;
            const buf = await PdfStore.get(p.hash); if (!buf) continue;
            try {
                const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise, pages = [];
                for (let n = 1; n <= Math.min(doc.numPages, 400); n++) { const pg = await doc.getPage(n), tc = await pg.getTextContent(); pages[n - 1] = tc.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim(); if (n % 25 === 0) await new Promise(r => setTimeout(r, 0)); }
                await AiText.put(p.hash, pages); added++; try { doc.destroy(); } catch { /* ignore */ }
            } catch { /* unreadable PDF */ }
        }
        this._aiTextVer = (this._aiTextVer || 0) + 1; this._kb = null; onProgress && onProgress(list.length, list.length, ''); return added;
    },
    /* ---------- the assistant ---------- */
    async aiAssistant(preset = '') {
        if (!this.aiReady()) { this.aiNeedKey(); return; }
        const cfg = this.aiCfg(), canWeb = cfg.provider !== 'openai' && cfg.provider !== 'custom';
        let mode = 'ans', busy = false, ctl = null, fin = false; const hist = [];
        const m = this.openModal({ title: `${ic('sparkle')} Assistant de mes cours`, size: 'wide',
            body: `<div class="chip-row ast-modes" id="ast-modes"><button class="chip active" data-md="ans">Répondre</button><button class="chip" data-md="soc">Tuteur socratique</button><button class="chip" data-md="eli">Expliquer simplement</button></div>
                <div id="ast-log" class="ai-chat"><p class="help" style="margin:0">Pose une question sur <b>tous tes cours</b> : l'assistant cherche dans tes notes, tes PDF et tes cartes, puis répond en citant ses sources. <span id="ast-kb"></span></p></div>
                <p class="help" id="ast-st" style="margin:6px 0"></p>
                ${canWeb ? '<label class="check" style="margin:4px 0"><input type="checkbox" id="ast-web"> 🌐 Compléter avec internet (cette question)</label>' : ''}
                <div class="row-gap"><input class="input" id="ast-in" style="flex:1" placeholder="Ta question…" autocomplete="off" enterkeyhint="send"><button class="btn btn-primary" id="ast-go">${ic('sparkle')}Envoyer</button></div>
                <div class="row-gap" style="margin-top:8px"><button class="btn btn-soft btn-sm hidden" id="ast-giveup">Je donne ma langue au chat</button><button class="btn btn-soft btn-sm" id="ast-idx">${ic('search')}Indexer mes PDF</button><span class="help" id="ast-idxst"></span></div>`,
            foot: `<button class="btn btn-soft" data-close>Fermer</button>`, onClose: () => { fin = true; if (ctl) ctl.abort(); } });
        const log = $('#ast-log', m), st = $('#ast-st', m);
        const kbInfo = async () => { const kb = await this.aiKbBuild(); $('#ast-kb', m).textContent = `${plural(kb.notes, 'note')} · ${plural(kb.pdfDocs, 'PDF lu', 'PDF lus')} · ${plural(kb.cards, 'carte')} · ${plural(kb.chunks.length, 'passage')}.`; }; kbInfo();
        const fmt = (t, srcs) => esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[S(\d+)\]/g, (x, n) => srcs[n - 1] ? `<button class="ai-src" data-s="${n}">${n}</button>` : '').replace(/\[web\]/gi, '<span class="ai-webtag">🌐 web</span>').replace(/\n/g, '<br>');
        const paint = () => { log.innerHTML = hist.map(h => `<div class="ai-q">${esc(h.q)}</div><div class="ai-a" data-h="${hist.indexOf(h)}">${h.err ? `<span style="color:var(--due)">${esc(h.err)}</span>` : fmt(h.a || '…', h.srcs)}</div>${h.srcs.length && h.a ? `<div class="ai-links">📚 ${h.srcs.map((s, k) => `<button class="ai-srcl" data-h="${hist.indexOf(h)}" data-s="${k + 1}">${k + 1}. ${esc(truncate(s.label, 42))}</button>`).join(' ')}</div>` : ''}${h.links && h.links.length ? `<div class="ai-links">🌐 <b>Vient du web :</b> ${h.links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.title)}</a>`).join(' · ')}</div>` : ''}${h.a ? '<div class="ai-tag">✨ Généré par IA, à vérifier</div>' : ''}`).join(''); log.scrollTop = log.scrollHeight; };
        const SYS = { ans: 'Tu es l\'assistant d\'étude personnel de l\'étudiant. Réponds en français, clairement et brièvement, d\'après les EXTRAITS fournis (ses notes, ses PDF, ses cartes). Après chaque affirmation tirée d\'un extrait, cite sa source avec [S1], [S2]… Si les extraits ne contiennent pas la réponse, écris « Je ne trouve pas ça dans tes cours. » sans rien inventer', soc: 'Tu es un tuteur socratique. Ne donne JAMAIS la réponse d\'emblée : pose UNE question guidée à la fois pour amener l\'étudiant à raisonner, en t\'appuyant sur les EXTRAITS (cite [S1]…). Félicite les bonnes étapes, donne un indice si l\'étudiant bloque. Quand il dit qu\'il donne sa langue au chat ou demande la réponse, donne-la clairement avec les sources. Réponds en français', eli: 'Explique comme à un élève de 15 ans : une analogie simple, puis un récapitulatif en 3 puces. Base-toi sur les EXTRAITS fournis et cite [S1]… Si les extraits ne suffisent pas, dis-le. Réponds en français' };
        const ask = async text => {
            const q = (text || '').trim(); if (!q || busy) return;
            const web = canWeb && $('#ast-web', m) && $('#ast-web', m).checked, srcs = mode === 'soc' && hist.length ? (hist[hist.length - 1].srcs || []) : await this.aiKbSearch(q, 8);
            if (!(await this.aiConsentOnce('assistant', 'Assistant de mes cours', 'ta question avec les passages de tes cours qui correspondent (un extrait de tes notes, PDF et cartes)'))) return;
            const turn = { q, a: '', srcs, links: [], web }; hist.push(turn); busy = true; ctl = new AbortController(); st.textContent = srcs.length ? '' : 'Aucun passage trouvé dans tes cours pour cette question.'; paint();
            const ctx = srcs.map((s, k) => `[S${k + 1}] (${s.label})\n${s.text}`).join('\n\n');
            const messages = [...hist.slice(-7, -1).filter(h => h.a).flatMap(h => [{ role: 'user', content: h.q }, { role: 'assistant', content: h.a }]), { role: 'user', content: `EXTRAITS DE MES COURS :\n${ctx || '(aucun extrait trouvé)'}\n\n${web ? 'Tu peux compléter avec internet : ce qui vient du web doit être dans un paragraphe qui commence par « [web] ».' : 'Pas de recherche internet.'}\n\nMA DEMANDE : ${q}` }];
            try { turn.a = (await this.aiCall({ system: SYS[mode], messages, maxTokens: 1400, signal: ctl.signal, web, onDelta: (_, full) => { turn.a = full; const el = log.querySelector(`.ai-a[data-h="${hist.indexOf(turn)}"]`); if (el) { el.innerHTML = fmt(full, srcs); log.scrollTop = log.scrollHeight; } } })).trim(); turn.links = this.aiLinks || []; }
            catch (e) { if (fin) return; turn.err = e && e.ai ? e.message : 'Erreur inattendue.'; }
            busy = false; paint(); $('#ast-giveup', m).classList.toggle('hidden', mode !== 'soc');
        };
        const go = () => { const i = $('#ast-in', m), v = i.value; i.value = ''; ask(v); };
        $('#ast-go', m).addEventListener('click', go); $('#ast-in', m).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
        $('#ast-giveup', m).addEventListener('click', () => ask('Je donne ma langue au chat : donne-moi la réponse complète.'));
        $('#ast-modes', m).addEventListener('click', e => { const b = e.target.closest('[data-md]'); if (!b) return; mode = b.dataset.md; $$('#ast-modes .chip', m).forEach(c => c.classList.toggle('active', c === b)); $('#ast-giveup', m).classList.toggle('hidden', mode !== 'soc' || !hist.length); });
        $('#ast-idx', m).addEventListener('click', async () => { const b = $('#ast-idx', m), s2 = $('#ast-idxst', m); b.disabled = true; try { const added = await this.aiIndexPdfs((d, t, name) => { s2.textContent = name ? `Lecture des PDF… ${d}/${t} (${truncate(name, 24)})` : ''; }); s2.textContent = added ? `${plural(added, 'PDF lu', 'PDF lus')}. L'assistant peut maintenant les consulter.` : 'Tous tes PDF sont déjà lus.'; kbInfo(); } catch (e) { s2.textContent = e && e.message || 'Impossible.'; } b.disabled = false; });
        log.addEventListener('click', e => {
            const b = e.target.closest('[data-s]'); if (!b) return; const h = hist[Number(b.dataset.h != null ? b.dataset.h : b.closest('.ai-a') && b.closest('.ai-a').dataset.h)]; if (!h) return; const s = h.srcs[Number(b.dataset.s) - 1]; if (!s) return;
            this.closeModal(m);
            if (s.kind === 'note') { this.go('notes'); this.noteOpen(s.ref); } else if (s.kind === 'pdf') this.pdfOpen(s.ref, { page: s.page || 1, from: 'notes' }); else { const c = this.card(s.ref); if (c) { this.ui.deck = c.deckId; this.ui.search = stripHtml(c.front).slice(0, 40); this.go('decks'); } }
        });
        setTimeout(() => { const i = $('#ast-in', m); i.focus(); if (preset) { i.value = preset; go(); } }, 60);
    },
    /* ---------- mock exam made from my weak spots ---------- */
    async aiMockExam() {
        if (!this.aiReady()) { this.aiNeedKey(); return; }
        const decks = this.sortedDecks();
        const m = this.openModal({ title: `${ic('quiz')} Examen blanc sur mesure`, size: 'narrow', body: `<p style="margin:0 0 10px">L'IA prépare un examen à partir de <b>tes points faibles</b> (cartes souvent ratées, QCM manqués) puis le corrige.</p>
            <div class="field"><label class="label" for="mx-d">Sujet</label><select class="select" id="mx-d"><option value="">Tous mes paquets</option>${decks.map(d => `<option value="${esc(d.id)}">${esc(d.emoji)} ${esc(this.deckPath(d.id))}</option>`).join('')}</select></div>
            <div class="row-gap"><label class="field" style="flex:1"><span class="label">Questions ouvertes</span><select class="select" id="mx-o"><option value="3">3</option><option value="5" selected>5</option><option value="8">8</option></select></label><label class="field" style="flex:1"><span class="label">QCM</span><select class="select" id="mx-q"><option value="0">0</option><option value="5" selected>5</option><option value="10">10</option></select></label></div>`, foot: `<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="mx-go">${ic('sparkle')}Préparer</button>` });
        $('#mx-go', m).addEventListener('click', async () => {
            const did = $('#mx-d', m).value, no = Number($('#mx-o', m).value), nq = Number($('#mx-q', m).value); this.closeModal(m);
            const ids = did ? new Set(this.descendantIds(did)) : null, cards = this.data.cards.filter(c => (!ids || ids.has(c.deckId)) && !c.suspended);
            const weak = cards.slice().sort((a, b) => (b.lapses * 3 + (b.wrong || 0)) - (a.lapses * 3 + (a.wrong || 0))).slice(0, 25), rest = cards.filter(c => !weak.includes(c)).sort(() => Math.random() - 0.5).slice(0, 15);
            const qw = this.data.qcms.filter(q => (!ids || ids.has(q.deckId)) && q.wrong > q.right).slice(0, 6).map(q => `QCM raté : ${q.q}`);
            const ctx = [`POINTS FAIBLES (à tester en priorité) :`, ...weak.map(c => `- ${truncate(cardPlain(c), 260)}`), ...qw, `AUTRES SUJETS :`, ...rest.map(c => `- ${truncate(cardPlain(c), 200)}`)].join('\n');
            if (cards.length < 3) { this.toast('Il faut au moins quelques cartes pour préparer un examen.', 'warning'); return; }
            const system = `Tu prépares un examen blanc pour un étudiant, en français, à partir de SES cartes (points faibles d'abord). Format strict :\n1) ${no} questions ouvertes, une par ligne : "OUVERTE | question | réponse attendue courte".\n2) ${nq ? `puis une ligne "### QCM" suivie de ${nq} QCM : question, 4 réponses "a) texte" (la bonne finit par " *"), ligne "=> explication", blocs séparés par une ligne vide.` : 'pas de QCM.'}\nBase-toi uniquement sur le contenu fourni. Questions précises, niveau examen. Aucun autre texte.`;
            const out = await this.aiRun({ title: 'Examen blanc', what: 'Tes cartes (points faibles et échantillon)', chars: ctx.length, preview: ctx, jobs: [{ system, prompt: ctx, maxTokens: 3500 }] }); if (!out) return;
            const [openPart, qcmPart] = out[0].split(/^\s*###\s*QCM.*$/im), qs = openPart.split('\n').map(l => /^\s*(?:\d+[.)]\s*)?OUVERTE\s*\|\s*(.+?)\s*\|\s*(.+)$/i.exec(l)).filter(Boolean).map(r => ({ q: r[1].trim(), a: r[2].trim() }));
            if (!qs.length && !(qcmPart || '').trim()) { this.toast('L\'IA n\'a pas pu préparer d\'examen avec ces cartes.', 'warning'); return; }
            this.aiExamSheet(qs, (qcmPart || '').trim());
        });
    },
    aiExamSheet(qs, qcmText) {
        const m = this.openModal({ title: `${ic('quiz')} Examen blanc`, size: 'wide', body: `<p class="small" style="margin:0 0 10px">✨ Généré par IA. Réponds sans regarder tes cours, puis fais corriger.</p>${qs.map((x, i) => `<div class="mx-q"><b>${i + 1}. ${esc(x.q)}</b><textarea class="textarea" data-mx="${i}" rows="2" placeholder="Ta réponse…"></textarea></div>`).join('')}<div id="mx-res"></div>${qcmText ? `<div class="row-gap" style="margin-top:10px"><button class="btn btn-soft btn-sm" id="mx-qcm">${ic('quiz')}Ajouter les QCM à mon quiz</button></div>` : ''}`, foot: `<button class="btn btn-soft" data-close>Fermer</button>${qs.length ? `<button class="btn btn-primary" id="mx-corr">${ic('sparkle')}Corriger avec l'IA</button>` : ''}` });
        const q2 = $('#mx-qcm', m); if (q2) q2.addEventListener('click', () => this.openQcmBulk('', { text: qcmText, ai: true }));
        const corr = $('#mx-corr', m); if (!corr) return;
        corr.addEventListener('click', async () => {
            const ans = qs.map((x, i) => ({ ...x, r: ($(`[data-mx="${i}"]`, m).value || '').trim() })), body = ans.map((x, i) => `${i + 1}. Question : ${x.q}\n   Réponse attendue : ${x.a}\n   Réponse de l'étudiant : ${x.r || '(vide)'}`).join('\n');
            const system = 'Tu corriges un examen. Pour chaque question réponds par UNE ligne "n | note sur 10 | commentaire court et utile (ce qui manque, la bonne idée)". Sois juste et bienveillant : une réponse vide = 0. Aucun autre texte.';
            const out = await this.aiRun({ title: 'Correction de l\'examen', what: 'Tes réponses et les corrigés attendus', chars: body.length, preview: body, jobs: [{ system, prompt: body, maxTokens: 1800 }] }); if (!out) return;
            const rows = out[0].split('\n').map(l => /^\s*(\d+)\s*\|\s*(\d+(?:[.,]\d+)?)\s*\|\s*(.*)$/.exec(l)).filter(Boolean).map(r => ({ n: Number(r[1]), s: clamp(Number(r[2].replace(',', '.')), 0, 10), c: r[3].trim() }));
            const total = rows.reduce((a, r) => a + r.s, 0), max = qs.length * 10, bad = rows.filter(r => r.s < 6 && qs[r.n - 1]);
            $('#mx-res', m).innerHTML = `<div class="mx-score"><b>${Math.round(total * 10) / 10} / ${max}</b> <span class="faint">(${Math.round(total / Math.max(1, max) * 100)} %)</span></div>${rows.map(r => `<div class="mx-fb ${r.s >= 6 ? 'ok' : 'ko'}"><b>${r.n}. ${r.s}/10</b> ${esc(r.c)}</div>`).join('')}${bad.length ? `<div class="row-gap" style="margin-top:8px"><button class="btn btn-primary btn-sm" id="mx-cards">${ic('copy')}Créer des cartes avec mes erreurs (${bad.length})</button></div>` : ''}<div class="ai-tag">✨ Correction générée par IA, à vérifier</div>`;
            const cb = $('#mx-cards', m); if (cb) cb.addEventListener('click', () => { this.closeModal(m); this.openImportModal({ text: bad.map(r => `${qs[r.n - 1].q} >> ${qs[r.n - 1].a}`).join('\n'), ai: true }); });
        });
    },
    /* ---------- my typed answer, corrected during a review ---------- */
    async aiGradeAnswer() {
        const s = this.session, card = s && s.current && this.card(s.current); if (!card || !s.typed || s.typed.aiBusy) return;
        if (!this.aiReady()) { this.aiNeedKey(); return; }
        if (!(await this.aiConsentOnce('grade', 'Correction par l\'IA', 'la question, la réponse attendue et ta réponse'))) return;
        s.typed.aiBusy = true; this.renderSession();
        const q = cardPlain(card).split(' → ')[0], exp = stripHtml(this.cardAnswer(card));
        try {
            const out = await this.aiCall({ system: 'Tu corriges la réponse d\'un étudiant à une carte de révision. Réponds en UNE ligne : "verdict | explication courte". verdict = exactement un de : raté, difficile, bien, facile (raté = faux ou vide ; difficile = idée partielle ; bien = juste ; facile = parfait et précis). L\'explication (une phrase, en français) dit ce qui est juste ou manque. Accepte les synonymes et reformulations justes.', prompt: `Question : ${q}\nRéponse attendue : ${exp}\nRéponse de l'étudiant : ${s.typed.text || '(vide)'}`, maxTokens: 200 });
            const m = /^\s*(raté|rate|difficile|bien|facile)\s*\|\s*(.*)$/i.exec(out.trim().split('\n')[0]); const g = m ? { 'raté': 1, rate: 1, difficile: 2, bien: 3, facile: 4 }[m[1].toLowerCase()] : 0;
            if (this.session === s && s.typed) { s.typed.ai = (m ? m[2] : out.trim()).slice(0, 300); if (g) s.typed.suggest = g; s.typed.aiBusy = false; this.renderSession(); }
        } catch (e) { if (s.typed) { s.typed.aiBusy = false; s.typed.ai = e && e.ai ? e.message : 'Erreur inattendue.'; this.renderSession(); } }
    },
    /* ---------- selection tools in a note + write with AI ---------- */
    async aiTransformSel(kind, info) {
        const n = this.note(this.ui.note), i = this.nb.active, b = n && n.b[i]; if (!b || !info) return;
        if (!this.aiReady()) { this.aiNeedKey(); return; }
        const text = b.x.slice(info.s, info.e), plain = this.nbPlain(text); if (plain.length < 2) return;
        const P = { rewrite: 'Reformule ce texte, plus clair et mieux écrit, même sens, même langue.', simple: 'Réécris ce texte en termes plus simples, pour un débutant, même langue.', short: 'Résume ce texte en une phrase courte.', expand: 'Développe ce texte avec plus de détails utiles : 3 à 5 courtes phrases ou puces (une par ligne).', fix: 'Corrige l\'orthographe, la grammaire et la ponctuation sans changer le sens ni le style.', en: 'Traduis ce texte en anglais.', fr: 'Traduis ce texte en français.', example: 'Donne un exemple concret qui illustre ce texte, en une ou deux phrases.', explain: 'Explique ce texte simplement en 2 ou 3 phrases (une par ligne).' }[kind];
        if (!P || !(await this.aiConsentOnce('sel', 'IA dans les notes', 'le texte que tu sélectionnes'))) return;
        const bar = $('#nb-sel'); if (bar) bar.classList.add('busy');
        try {
            const out = (await this.aiCall({ system: `${P} Réponds UNIQUEMENT par le résultat, sans commentaire ni guillemets, sans Markdown (pas de **, pas de #). Si plusieurs lignes, une idée par ligne.`, prompt: plain, maxTokens: 700 })).trim();
            const lines = out.split('\n').map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean); if (!lines.length) return;
            const rep = kind === 'example' || kind === 'expand' || kind === 'explain' ? text : null;
            this.nbOp(nn => {
                const bb = nn.b[i]; if (rep !== null) { bb.x = bb.x.slice(0, info.e) + bb.x.slice(info.e); nn.b.splice(i + 1, 0, ...lines.map(l => ({ t: 'p', x: l.slice(0, 1000), d: bb.d + 1 }))); }
                else { bb.x = bb.x.slice(0, info.s) + lines[0].slice(0, 1000) + bb.x.slice(info.e); if (lines.length > 1) nn.b.splice(i + 1, 0, ...lines.slice(1).map(l => ({ t: 'p', x: l.slice(0, 1000), d: bb.d }))); }
            }, i, 'end');
        } catch (e) { this.toast(e && e.ai ? e.message : 'Erreur inattendue.', 'warning'); }
        const b2 = $('#nb-sel'); if (b2) b2.classList.remove('busy');
    },
    aiWriteBlocks(i) {
        if (!this.aiReady()) { this.aiNeedKey(); return; }
        const n = this.note(this.ui.note); if (!n) return;
        const m = this.openModal({ title: `${ic('sparkle')} Écrire avec l'IA`, size: 'narrow', body: `<div class="field"><label class="label" for="aw-p">Que veux-tu que l'IA écrive ?</label><textarea class="textarea" id="aw-p" rows="3" placeholder="Ex : Les 5 forces de Porter en puces, avec un exemple chacune"></textarea></div><label class="check"><input type="checkbox" id="aw-ctx" checked> Tenir compte du début de cette note (contexte)</label>`, foot: `<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="aw-go">${ic('sparkle')}Écrire</button>` });
        $('#aw-go', m).addEventListener('click', async () => {
            const ask = $('#aw-p', m).value.trim(); if (!ask) return; const ctx = $('#aw-ctx', m).checked ? n.b.slice(0, 40).map(b => this.nbPlain(b.x)).filter(Boolean).join('\n').slice(0, 2500) : ''; this.closeModal(m);
            const system = 'Tu écris des notes de cours pour un étudiant, en français. Format : titres de section en lignes commençant par "## ", puis des puces courtes en lignes commençant par "- " (une idée par ligne, sous-puces avec deux espaces d\'indentation). Pas d\'introduction, pas de conclusion. Contenu exact et utile.';
            const prompt = `${ctx ? `Contexte (début de ma note) :\n${ctx}\n\n` : ''}Écris : ${ask}`;
            const out = await this.aiRun({ title: 'Écrire avec l\'IA', what: 'Ta consigne' + (ctx ? ' et le début de la note' : ''), chars: prompt.length, preview: prompt, jobs: [{ system, prompt, maxTokens: 1800 }] }); if (!out) return;
            const blocks = []; out[0].replace(/```[a-z]*/gi, '').split('\n').forEach(l => { if (!l.trim()) return; const h = /^#{1,4}\s+(.*)$/.exec(l.trim()); if (h) { blocks.push({ t: 'h3', x: h[1].trim(), d: 0 }); return; } const ind = (/^(\s*)/.exec(l)[1].length >> 1), x = l.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, '').replace(/\*\*/g, ''); if (x) blocks.push({ t: 'p', x: x.slice(0, 1500), d: Math.min(3, ind) }); });
            if (!blocks.length) { this.toast('L\'IA n\'a rien renvoyé d\'exploitable.', 'warning'); return; }
            blocks.unshift({ t: 'quote', x: `✨ Généré par IA le ${new Date().toLocaleDateString('fr-FR')} : à relire.`, d: 0 }); this.nbInsertAfter(Math.min(i, n.b.length - 1), blocks);
        });
        setTimeout(() => $('#aw-p', m).focus(), 60);
    },
    /* ---------- one card, made better ---------- */
    async aiImproveCard(cardId, modal) {
        const c = this.card(cardId); if (!c || !(c.kind === 'basic' || c.kind === 'custom')) { this.toast('Seules les cartes simples (question → réponse) peuvent être réécrites.', 'warning'); return; }
        const q = stripHtml(c.front), a = stripHtml(c.back);
        const out = await this.aiRun({ title: 'Améliorer la carte', what: 'Cette carte (recto et verso)', chars: q.length + a.length, preview: `${q}\n→ ${a}`, jobs: [{ system: 'Tu améliores une carte de révision : une seule idée, question précise et non ambiguë, réponse courte et complète, même langue. Réponds en deux lignes exactement : "Q: …" puis "R: …". Ne change pas le sens.', prompt: `Q: ${q}\nR: ${a}`, maxTokens: 300 }] }); if (!out) return;
        const qm = /Q:\s*(.+)/.exec(out[0]), rm = /R:\s*([\s\S]+)/.exec(out[0]); if (!qm || !rm) { this.toast('L\'IA n\'a pas proposé de version exploitable.', 'warning'); return; }
        const nq = qm[1].trim(), na = rm[1].trim().split('\n')[0].trim();
        const m = this.openModal({ title: `${ic('sparkle')} Carte améliorée`, size: 'narrow', body: `<p class="small faint" style="margin:0 0 4px">Avant</p><div class="ai-a">${esc(q)} → ${esc(a)}</div><p class="small faint" style="margin:10px 0 4px">Après ✨</p><div class="ai-a"><b>${esc(nq)}</b> → ${esc(na)}</div>`, foot: `<button class="btn btn-soft" data-close>Garder l'ancienne</button><button class="btn btn-primary" id="im-use">${ic('check')}Utiliser la nouvelle</button>` });
        $('#im-use', m).addEventListener('click', () => { this.change('carte améliorée par IA', [c.id], () => { const x = this.card(c.id); x.front = sanitizeHtml(esc(nq)); x.back = sanitizeHtml(esc(na)); x.mod = Date.now(); materializeCard && materializeCard(x); }); this.closeModal(m); if (modal) this.closeModal(modal); if (this.session && this.session.current === c.id) this.renderSession(); });
    },
    /* ---------- image occlusion made by the AI from a PDF page (vision) ---------- */
    async aiOcclude() {
        const pv = this.pv; if (!pv) return; if (!this.aiReady()) { this.aiNeedKey(); return; }
        const i = this.pdfCurrent(), g = pv.p.pg[i], pg = pv.pages[i], cvs = pg && pg.el && pg.el.querySelector('canvas');
        if (!g || g.k !== 'p' || !cvs) { this.toast('Affiche d\'abord une page du PDF (schéma, tableau, carte…).', 'warning'); return; }
        const w = Math.min(1400, cvs.width), tmp = document.createElement('canvas'); tmp.width = w; tmp.height = Math.round(cvs.height * w / cvs.width); tmp.getContext('2d').drawImage(cvs, 0, 0, tmp.width, tmp.height);
        const data = tmp.toDataURL('image/jpeg', 0.85), system = 'Tu prépares des cartes "image à masquer". Repère sur l\'image les ÉTIQUETTES, légendes ou mots-clés importants à retenir (noms de parties d\'un schéma, valeurs d\'un tableau, termes clés). Réponds en JSON seulement : un tableau [{"t":"texte masqué","x":gauche,"y":haut,"w":largeur,"h":hauteur}, ...] avec x,y,w,h en POURCENTAGES (0-100) de la largeur/hauteur de l\'image. 4 à 12 éléments maximum, boîtes serrées autour du texte. Si rien d\'utile, réponds [].';
        const out = await this.aiRun({ title: 'Image à masquer par IA', what: `Page ${g.n} du PDF « ${pv.p.name} » (image)`, chars: 0, pages: 1, asImages: true, jobs: [{ system, prompt: 'Voici la page. Donne le JSON.', maxTokens: 1500, images: [data] }], note: 'Les boîtes sont proposées par l\'IA : tu les vérifies avant de créer les cartes.' }); if (!out) return;
        let boxes = []; try { const jt = out[0].replace(/```[a-z]*/gi, '').trim(), arr = JSON.parse(jt.slice(jt.indexOf('['), jt.lastIndexOf(']') + 1)); boxes = arr.map(b => ({ t: String(b.t || '').slice(0, 60), x: clamp(num(b.x), 0, 100), y: clamp(num(b.y), 0, 100), w: clamp(num(b.w), 1, 100), h: clamp(num(b.h), 1, 100), on: true })).filter(b => b.w > 1 && b.h > 1 && b.x + b.w <= 101 && b.y + b.h <= 101).slice(0, 14); } catch { /* bad json */ }
        if (!boxes.length) { this.toast('L\'IA n\'a pas trouvé d\'éléments à masquer sur cette page.', 'warning'); return; }
        const m = this.openModal({ title: `${ic('image')} Éléments à masquer`, size: 'wide', body: `<p class="small" style="margin:0 0 8px">✨ Proposé par l'IA : décoche ce qui ne va pas, puis crée les cartes (une par cadre).</p><div class="aio-wrap"><img src="${data}" alt=""><div id="aio-boxes"></div></div><div class="field" style="margin-top:10px"><label class="label" for="aio-d">Paquet</label><select class="select" id="aio-d">${this.sortedDecks().map(d => `<option value="${esc(d.id)}" ${d.id === pv.p.pdeck ? 'selected' : ''}>${esc(d.emoji)} ${esc(this.deckPath(d.id))}</option>`).join('')}</select></div><div id="aio-list" class="aio-list"></div>`, foot: `<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="aio-go">${ic('check')}Créer les cartes</button>` });
        const paint = () => { $('#aio-boxes', m).innerHTML = boxes.map((b, k) => `<span class="aio-b ${b.on ? '' : 'off'}" style="left:${b.x}%;top:${b.y}%;width:${b.w}%;height:${b.h}%"><i>${k + 1}</i></span>`).join(''); $('#aio-list', m).innerHTML = boxes.map((b, k) => `<label class="check"><input type="checkbox" data-k="${k}" ${b.on ? 'checked' : ''}> ${k + 1}. ${esc(b.t || 'élément')}</label>`).join(''); $('#aio-go', m).disabled = !boxes.some(b => b.on); };
        m.addEventListener('change', e => { const c = e.target.closest('[data-k]'); if (c) { boxes[Number(c.dataset.k)].on = c.checked; paint(); } }); paint();
        $('#aio-go', m).addEventListener('click', () => {
            const masks = boxes.filter(b => b.on).map(b => [Math.round(b.x * 100) / 100, Math.round(b.y * 100) / 100, Math.round(b.w * 100) / 100, Math.round(b.h * 100) / 100]), dId = $('#aio-d', m).value, ref = this.addMedia(data), nf = { front: ref, back: JSON.stringify({ m: masks, mode: 'all' }), text: '', extra: sanitizeHtml(esc(`${pv.p.name} · page ${g.n}`)) }, now = Date.now(), nid = uid('n'), tags = [AI_TAG];
            this.change('image à masquer par IA', [], () => { const created = []; masks.forEach((r, k) => { const c = { id: uid('c'), ...freshCard(), deckId: dId, hint: '', detail: '', tags: [...tags], created: now + k, nid, kind: 'occl', ord: k + 1, nf: { ...nf }, front: '', back: '', mod: now, src: { pdf: pv.p.id, pid: g.id, t: 'image' } }; materializeCard(c); this.data.cards.push(c); created.push(c.id); }); return created; });
            this.closeModal(m);
        });
    }
});
