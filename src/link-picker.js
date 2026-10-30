/* ============================================================
   « Lien vers… » : une fenêtre au centre avec recherche et onglets (Tout / Notes / PDF / Cartes),
   résultats rangés (récents d'abord, dossier en sous-titre). Pour un PDF on choisit la page.
   Insère [[Titre]], [[c:ID|texte]] ou [[pdf:ID:PAGE|Nom · p.N]] dans la ligne de la note.
   ============================================================ */
Object.assign(SuperAnki.prototype, {
    nbLinkPicker(selr) {
        const n = this.note(this.ui.note); if (!n) return;
        const i = this.nb.active >= 0 ? this.nb.active : (this.nb.last == null ? n.b.length - 1 : this.nb.last), b = n.b[i]; if (!b) return;
        let pos = b.x.length; try { const t = $('.nb-t', this.nbEl(i)); if (t && this.nb.active === i) pos = this.nbCaret(t).s; } catch { /* keep the end */ }
        const mm = /\[\[([^\[\]\n]*)$/.exec(b.x.slice(0, pos)); let cut = null; if (mm) { cut = pos - mm[0].length; } if (selr) { cut = selr.s; pos = selr.e; }   // « [[ » typed before: replaced by the link
        this.nbSuggestClose();
        let tab = 'all', step = null;
        const m = this.openModal({ title: `${ic('link')} Lien vers…`, size: 'wide',
            body: `<div class="lp"><input class="input" id="lp-q" placeholder="Rechercher une note, un PDF, une carte…" autocomplete="off" enterkeyhint="search">
                <div class="chip-row lp-tabs" id="lp-tabs">${[['all', 'Tout'], ['note', 'Notes'], ['pdf', 'PDF'], ['card', 'Cartes']].map(([k, l]) => `<button class="chip ${k === tab ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
                <div id="lp-list" class="lp-list"></div></div>`,
            foot: `<button class="btn btn-soft" data-close>Annuler</button>` });
        const q = $('#lp-q', m), list = $('#lp-list', m);
        const insert = (link, label) => {
            this.closeModal(m);
            const base = this.note(this.ui.note); if (!base || !base.b[i]) return; const blk = base.b[i], x = blk.x;
            const at = cut == null ? Math.min(pos, x.length) : cut, from = cut == null ? at : pos, tail = x.slice(from).replace(/^\]\]/, '');
            this.nbPush(); blk.x = x.slice(0, at) + link + tail;
            this.nbRender(); this.nbActivate(i, at + link.length); this.nbChanged();
        };
        const rows = () => {
            const k = fold(q.value.trim()), out = [];
            const has = s => !k || fold(s).includes(k);
            if (tab === 'all' || tab === 'note') this.data.notes.filter(x => x.id !== n.id && x.title && !this.pdfOfNote(x.id) && has(x.title)).sort((a, c) => c.mod - a.mod).slice(0, 30).forEach(x => out.push({ k: 'note', ico: x.daily ? 'calendar' : 'notebook', t: x.title, s: x.deckId && this.deck(x.deckId) ? this.deckPath(x.deckId) : (x.daily ? 'Note du jour' : 'Note'), link: `[[${x.title}]]` }));
            if (tab === 'all' || tab === 'pdf') this.data.pdfs.filter(p => has(p.name)).sort((a, c) => (c.mod || 0) - (a.mod || 0)).slice(0, 30).forEach(p => out.push({ k: 'pdf', ico: 'pdf', t: p.name, s: `PDF · ${plural(p.pg.length, 'page')}`, pdf: p }));
            if (tab === 'all' || tab === 'card') {
                const cards = k.length >= 2 ? this.data.cards.filter(c => has(stripHtml(c.front))) : this.data.cards.slice().sort((a, c) => (c.created || 0) - (a.created || 0));
                cards.slice(0, tab === 'card' ? 40 : 6).forEach(c => { const d = this.deck(c.deckId), tx = truncate(stripHtml(c.front), 70); out.push({ k: 'card', ico: 'card', t: tx, s: `Carte · ${d ? d.name : ''}`, link: `[[c:${c.id}|${tx.replace(/[\[\]|]/g, ' ')}]]` }); });
            }
            return out;
        };
        const paint = () => {
            if (step) {   // a PDF: choose the page
                const p = step, tot = p.pg.length;
                list.innerHTML = `<button class="btn btn-soft btn-sm" id="lp-back">${ic('chevronLeft')}Retour</button><div style="margin:12px 0 4px"><b>${esc(p.name)}</b> <span class="faint">· ${plural(tot, 'page')}</span></div>
                    <div class="row-gap"><label class="field" style="flex:1"><span class="label">Numéro de page</span><input class="input" id="lp-pg" type="number" min="1" max="${tot}" value="1"></label><button class="btn btn-primary" id="lp-pgok" style="align-self:end">${ic('link')}Lier cette page</button></div>
                    <p class="help">Le lien « ${esc(truncate(p.name, 30))} · p.N » ouvre le PDF à cette page.</p>`;
                return;
            }
            const r = rows();
            list.innerHTML = r.length ? r.map((x, k) => `<button class="lp-row" data-k="${k}"><span class="lp-ico">${ic(x.ico)}</span><span class="lp-t"><b>${esc(x.t)}</b><small>${esc(x.s)}</small></span>${x.k === 'pdf' ? ic('chevronRight') : ''}</button>`).join('') : '<p class="help" style="margin:14px 2px">Rien trouvé.</p>';
            list._rows = r;
        };
        q.addEventListener('input', () => { step = null; paint(); });
        $('#lp-tabs', m).addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return; tab = b.dataset.tab; step = null; $$('#lp-tabs .chip', m).forEach(c => c.classList.toggle('active', c === b)); paint(); });
        list.addEventListener('click', e => {
            if (e.target.closest('#lp-back')) { step = null; paint(); return; }
            if (e.target.closest('#lp-pgok')) { const p = step, no = clamp(parseInt($('#lp-pg', m).value, 10) || 1, 1, p.pg.length), g = p.pg[no - 1]; insert(`[[pdf:${p.id}:${g.id}|${p.name.replace(/[\[\]|]/g, ' ')} · p.${no}]]`); return; }
            const row = e.target.closest('.lp-row'); if (!row) return; const x = list._rows[Number(row.dataset.k)]; if (!x) return;
            if (x.k === 'pdf') { step = x.pdf; paint(); setTimeout(() => { const f = $('#lp-pg', m); if (f) f.select(); }, 30); } else insert(x.link);
        });
        paint(); setTimeout(() => q.focus(), 60);
    }
});
