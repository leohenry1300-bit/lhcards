/* ============================================================
   Recherche rapide (Ctrl/Cmd+K ou « / » ou la loupe) : notes, PDF, paquets, cartes et actions au même endroit, au clavier ou au doigt.
   ============================================================ */
Object.assign(SuperAnki.prototype, {
    quickItems(q) {
        const f = fold(q.trim()), out = [], d = this.data, snip = (t, n) => { const k = fold(t).indexOf(f); return k < 0 ? truncate(t, 70) : (k > 25 ? '…' : '') + t.slice(Math.max(0, k - 25), k + n + 45); };
        const act = [
            ['Nouvelle note', 'plus', () => this.noteNewFrom(null, {})], ['Note du jour', 'calendar', () => this.noteDaily()], ['Corbeille', 'trash', () => this.openTrash()], ['Importer un PDF', 'pdf', () => { this.go('notes'); this.pdfPick(''); }],
            ['Réviser maintenant', 'play', () => this.startStudy(null)], ['Mes paquets', 'layers', () => this.go('decks')], ['Statistiques', 'chart', () => this.go('stats')], ['Profil et réglages', 'settings', () => this.go('settings')]
        ];
        if (!f) {
            const rec = [...d.notes.filter(n => !this.pdfOfNote(n.id)).map(n => ({ k: 'note', id: n.id, mod: n.mod || n.created })), ...d.pdfs.map(p => ({ k: 'pdf', id: p.id, mod: p.mod || p.created }))].sort((a, b) => b.mod - a.mod).slice(0, 6);
            rec.forEach(r => out.push(r.k === 'pdf' ? { g: 'Récents', ico: 'pdf', t: this.pdf(r.id).name, s: this.pdfSubline(this.pdf(r.id)), fn: () => this.pdfOpen(r.id, { from: 'notes' }) } : { g: 'Récents', ico: 'notebook', t: this.noteName(this.note(r.id)), s: truncate(this.notePathLabel(this.note(r.id)), 60), fn: () => this.noteOpen(r.id) }));
            act.forEach(a => out.push({ g: 'Actions', ico: a[1], t: a[0], fn: a[2] }));
            return out;
        }
        d.pdfs.filter(p => fold(p.name).includes(f)).slice(0, 5).forEach(p => out.push({ g: 'PDF', ico: 'pdf', t: p.name, s: this.pdfSubline(p), fn: () => this.pdfOpen(p.id, { from: 'notes' }) }));
        d.notes.filter(n => !this.pdfOfNote(n.id)).map(n => ({ n, tt: fold(this.noteName(n)).includes(f), tx: fold(noteText(n)).includes(f) })).filter(r => r.tt || r.tx).sort((a, b) => b.tt - a.tt).slice(0, 8)
            .forEach(r => out.push({ g: 'Notes', ico: 'notebook', t: this.noteName(r.n), s: r.tt ? truncate(this.notePathLabel(r.n), 60) : snip(noteText(r.n).replace(/\s+/g, ' '), q.length), fn: () => this.noteOpen(r.n.id) }));
        d.decks.filter(x => !x.pdf && fold(x.name).includes(f)).slice(0, 5).forEach(x => out.push({ g: 'Paquets', ico: 'layers', t: `${x.emoji} ${x.name}`, s: this.deckPath(x.id), fn: () => { const p = this.pdfOfDeck(x.id); if (p) this.pdfOpen(p.id, { from: 'notes' }); else this.go('decks', { deck: x.id }); } }));
        let nc = 0; for (const c of d.cards) { if (nc >= 8) break; const t = stripHtml(c.front || (c.nf && (c.nf.text || c.nf.front)) || ''), b = stripHtml(c.back || ''); if (fold(t).includes(f) || fold(b).includes(f)) { nc++; out.push({ g: 'Cartes', ico: 'card', t: truncate(t || b, 80), s: truncate(b && t ? b : this.deckPath(c.deckId), 70), fn: () => this.openCardModal(c.id) }); } }
        act.filter(a => fold(a[0]).includes(f)).forEach(a => out.push({ g: 'Actions', ico: a[1], t: a[0], fn: a[2] }));
        return out;
    },
    quickOpen() {
        if (this.view === 'session' || this.view === 'exam') return;
        if ($('#quick-box')) { this.closeModal($('#quick-box').closest('.modal-back')); return; }
        const m = this.openModal({ title: '', size: 'wide quick', body: `<div class="quick" id="quick-box"><label class="input-icon">${ic('search')}<input class="input" id="quick-q" type="search" placeholder="Chercher une note, un PDF, une carte, un paquet…" autocomplete="off" enterkeyhint="go"></label><div class="quick-list" id="quick-list" role="listbox"></div></div>`, foot: '' });
        const q = $('#quick-q', m), list = $('#quick-list', m); let items = [], at = 0;
        const paint = () => {
            items = this.quickItems(q.value); at = clamp(at, 0, Math.max(0, items.length - 1)); let g = '';
            list.innerHTML = items.length ? items.map((it, i) => `${it.g !== g ? `<div class="quick-g">${esc(g = it.g)}</div>` : ''}<button class="quick-i ${i === at ? 'on' : ''}" role="option" data-i="${i}">${ic(it.ico)}<span><b>${esc(it.t)}</b>${it.s ? `<small>${esc(it.s)}</small>` : ''}</span></button>`).join('') : '<p class="small faint" style="padding:14px">Rien ne correspond. Essaie un autre mot.</p>';
            const on = $('.quick-i.on', list); if (on) on.scrollIntoView({ block: 'nearest' });
        };
        const run = i => { const it = items[i]; if (!it) return; this.closeModal(m); setTimeout(() => it.fn(), 30); };
        q.addEventListener('input', () => { at = 0; paint(); });
        q.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(at + 1, items.length - 1); paint(); } else if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(at - 1, 0); paint(); } else if (e.key === 'Enter') { e.preventDefault(); run(at); } });
        list.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) run(Number(b.dataset.i)); });
        paint(); setTimeout(() => q.focus(), 50);
    }
});
