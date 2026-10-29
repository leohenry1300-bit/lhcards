/* ============================================================
   Appui long sur une carte (Paquets) ou une note : le fond s'assombrit, la ligne se soulève et un menu propose quoi faire
   (comme dans Messages d'Instagram). Plus de glissement sur les lignes : rien ne se déclenche par erreur.
   Clic droit sur ordinateur = même menu.
   ============================================================ */
Object.assign(SuperAnki.prototype, {
    initPressMenu() {
        const SEL = '#card-list .card-row, #nb-list .nb-row[data-kind=note]';
        const rowOf = e => { const r = e.target.closest ? e.target.closest(SEL) : null; if (!r || e.target.closest('.nb-grip, .nb-fold, button, a, input, .row-check')) return null; return (r.classList.contains('nb-row') ? this.ui.noteSelMode : this.ui.selMode) ? null : r; };
        document.addEventListener('pointerdown', e => {
            if (e.button || e.pointerType === 'mouse' || this.modals.length) return;
            const row = rowOf(e); if (!row) return;
            const x0 = e.clientX, y0 = e.clientY; let t = setTimeout(() => { cancel(); this.pressOpen(row, true); }, 420);
            const mv = ev => { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) cancel(); };
            const cancel = () => { clearTimeout(t); window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', cancel); window.removeEventListener('pointercancel', cancel); document.removeEventListener('scroll', cancel, true); };
            window.addEventListener('pointermove', mv); window.addEventListener('pointerup', cancel); window.addEventListener('pointercancel', cancel); document.addEventListener('scroll', cancel, true);
        }, { passive: true });
        document.addEventListener('contextmenu', e => { const row = rowOf(e) || (e.target.closest && e.target.closest(SEL)); if (!row) return; e.preventDefault(); if (Date.now() - (this._pressAt || 0) > 700) this.pressOpen(row); });
    },
    pressOpen(row, touch = false) {
        if (this._pressAt && Date.now() - this._pressAt < 300) return; this._pressAt = Date.now(); this.closePopover();
        const isNote = row.classList.contains('nb-row'), id = isNote ? row.dataset.id : row.dataset.card;
        if (navigator.vibrate) navigator.vibrate(12);
        if (touch) { const stop = c => { c.stopPropagation(); c.preventDefault(); }, off = () => { document.removeEventListener('click', stop, true); document.removeEventListener('pointerdown', off, true); }; document.addEventListener('click', stop, { capture: true, once: true }); document.addEventListener('pointerdown', off, true); setTimeout(off, 1500); }   // (the click that follows the release of the long press must not open the row)
        this._rowSwiped = Date.now(); this._nbDragEnd = Date.now();
        const dim = document.createElement('div'); dim.className = 'press-dim'; document.body.appendChild(dim); row.classList.add('press-lift');
        const end = () => { dim.classList.add('out'); setTimeout(() => dim.remove(), 180); row.classList.remove('press-lift'); clearInterval(iv); };
        dim.addEventListener('click', () => this.closePopover());
        const sel = { icon: 'checkSq', label: 'Sélectionner', fn: () => { if (isNote) { this.ui.noteSelMode = true; this.ui.noteSel = new Set([id]); this.nbRefreshList(); const b = $('[data-action=nb-sel-toggle]'); if (b) { b.classList.add('btn-primary'); b.classList.remove('btn-soft'); } } else { this.ui.selMode = true; this.ui.sel = new Set([id]); this.renderDeckPanel(); } } };
        if (isNote) this.nbNoteMenu(row, id, [sel, { sep: true }]); else this.showMenu(row, [sel, { sep: true }, ...this.cardMenuItems([id])]);
        let n = 0; const iv = setInterval(() => { if (!this.popover || ++n > 6000) end(); }, 80);
    }
});
