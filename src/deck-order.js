/* ============================================================
   « Mon ordre » sur l'accueil : quand ce tri est choisi, chaque paquet a une poignée ⋮⋮ ; on la glisse pour placer le paquet avant ou après un autre.
   L'ordre est gardé dans les réglages (deckOrder) et suit les sauvegardes et la synchro.
   ============================================================ */
(() => {
    document.addEventListener('pointerdown', e => {
        const g = e.target.closest && e.target.closest('.deck-grip'); if (!g || e.button > 0) return;
        const grid = document.getElementById('dash-decks'), card = g.closest('.deck-card'); if (!grid || !card || !window.app) return;
        e.preventDefault();
        let target = null, after = false, moved = false;
        const clear = () => grid.querySelectorAll('.dz-before, .dz-after').forEach(x => x.classList.remove('dz-before', 'dz-after'));
        const move = ev => {
            moved = true; card.classList.add('dragging'); clear(); target = null;
            if (ev.clientY < 70) window.scrollBy(0, -14); else if (ev.clientY > innerHeight - 90) window.scrollBy(0, 14);
            const el = document.elementFromPoint(ev.clientX, ev.clientY), t = el && el.closest('.deck-card');
            if (!t || t === card || !grid.contains(t) || t.parentElement !== grid) return;
            const r = t.getBoundingClientRect(), oneCol = getComputedStyle(grid).gridTemplateColumns.split(' ').length < 2;
            after = oneCol ? ev.clientY > r.top + r.height / 2 : ev.clientX > r.left + r.width / 2;
            target = t; t.classList.add(after ? 'dz-after' : 'dz-before');
        };
        const up = () => {
            document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up);
            card.classList.remove('dragging'); const t = target; clear();
            if (!moved || !t) return;
            const ids = [...grid.children].filter(c => c.classList.contains('deck-card') && c !== card).map(c => c.dataset.deck);
            ids.splice(ids.indexOf(t.dataset.deck) + (after ? 1 : 0), 0, card.dataset.deck);
            app.setSetting('deckOrder', ids); app.refreshDeckList();
        };
        document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
    });
})();
