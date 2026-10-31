/* ============================================================
   Weekly recap ("Ta semaine"): computed from the review log only (nothing invented).
   A card on the home page on Sunday (and Monday if missed, closable), a full panel in Stats, a window with all the details.
   ============================================================ */
Object.assign(SuperAnki.prototype, {
    recapData() {
        const day = 86400000, t0 = startOfDay(), from = t0 - 6 * day, prevFrom = from - 7 * day;
        const cur = { n: 0, ok: 0, sec: 0, days: new Set(), per: [0, 0, 0, 0, 0, 0, 0], decks: {}, err: {} }, prev = { n: 0, ok: 0 };
        for (const r of this.data.revlog) {
            const t = r[0]; if (t < prevFrom || !r[2]) continue;
            if (t < from) { prev.n++; if (r[2] >= 2) prev.ok++; continue; }
            cur.n++; if (r[2] >= 2) cur.ok++; cur.sec += (r[6] || 0) / 1000; cur.days.add(dayKey(t));
            const k = Math.min(6, Math.max(0, Math.floor((startOfDay(t) - from) / day + .5))); cur.per[k]++;
            const c = this.card(r[1]); if (!c) continue;
            let d = this.deck(c.deckId); while (d && d.parent && this.deck(d.parent)) d = this.deck(d.parent);
            if (d) cur.decks[d.id] = (cur.decks[d.id] || 0) + 1;
            if (r[2] === 1) cur.err[c.id] = (cur.err[c.id] || 0) + 1;
        }
        if (!cur.n) return null;
        const top = Object.entries(cur.decks).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => ({ d: this.deck(id), n }));
        const weak = Object.entries(cur.err).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => ({ c: this.card(id), n })).filter(x => x.c);
        const labels = [0, 1, 2, 3, 4, 5, 6].map(i => 'DLMMJVS'[new Date(from + i * day + 12 * 3600000).getDay()]);
        return { ...cur, days: cur.days.size, pct: Math.round(cur.ok / cur.n * 100), prev, prevPct: prev.n ? Math.round(prev.ok / prev.n * 100) : null, top, weak, labels, from, to: t0 };
    },
    recapRange(r) { const f = d => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); return `${f(r.from)} – ${f(r.to)}`; },
    recapDelta(now, before, unit = '') {
        if (before == null || !before) return '';
        const d = now - before; if (!d) return '<em>comme la semaine d\'avant</em>';
        return `<em class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲ +' : '▼ −'}${Math.abs(d)}${unit} <small>sem. passée</small></em>`;
    },
    recapHtml(r, mode = 'full') {   // 'full' (Sunday window) has the cards to review, 'stats' does not, 'tiles' = the home card
        const max = Math.max(1, ...r.per);
        const tiles = `<div class="recap-tiles">
            <div><b>${r.n}</b><span>révisions</span>${this.recapDelta(r.n, r.prev.n)}</div>
            <div><b>${r.pct}%</b><span>réussite</span>${this.recapDelta(r.pct, r.prevPct, ' pts')}</div>
            <div><b>${r.days}/7</b><span>jours actifs</span></div>
            <div><b>${fmtDuration(r.sec)}</b><span>d'étude</span></div></div>`;
        if (mode === 'tiles') return tiles;
        const bars = `<div class="recap-bars" role="img" aria-label="Révisions par jour">${r.per.map((n, i) => `<div class="${i === 6 ? 'now' : ''}"><b>${n || ''}</b><i style="height:${Math.max(4, Math.round(n / max * 100))}%"></i><span>${r.labels[i]}</span></div>`).join('')}</div>`;
        const top = r.top.length ? `<div class="recap-sec"><h4>Paquets les plus travaillés</h4>${r.top.map(x => `<div class="recap-row"><span>${esc(x.d.emoji || '')} ${esc(x.d.name)}</span><b>${x.n}</b><i style="width:${Math.round(x.n / r.top[0].n * 100)}%"></i></div>`).join('')}</div>` : '';
        const weak = r.weak.length ? `<div class="recap-sec"><h4>À revoir</h4>${r.weak.map(x => `<p>${esc(stripHtml(x.c.front).slice(0, 80) || 'Carte')} <b>${x.n} raté${x.n > 1 ? 's' : ''}</b></p>`).join('')}<button class="btn btn-soft btn-sm" data-action="practice-errors">${ic('play')}Retravailler mes erreurs</button></div>` : '<div class="recap-sec"><h4>À revoir</h4><p class="muted">Aucune carte ratée cette semaine, bravo.</p></div>';
        return `${tiles}${bars}${top}${mode === 'full' ? weak : ''}`;
    },
    statRecap() {
        if (this.statsUi.deck !== 'all') return '';
        const r = this.recapData(); if (!r) return '';
        return `<section class="panel panel-pad stat-card wide recap"><div class="section-head" style="margin-bottom:6px"><h4 class="stat-title">${ic('chart')} Ta semaine <span class="faint">· ${this.recapRange(r)}</span></h4></div>${this.recapHtml(r, 'stats')}</section>`;
    },
    /* home card: Sunday (and Monday if it was missed), once per week */
    recapWeekKey() { const t0 = startOfDay(), dow = dayStart(Date.now()).getDay(); if (dow !== 0 && dow !== 1) return ''; return dayKey(t0 - (dow === 1 ? 86400000 : 0)); },
    recapCardHtml() {
        const key = this.recapWeekKey(); if (!key) return '';
        try { if (localStorage.getItem('lh_recap') === key) return ''; } catch { /* ignore */ }
        const r = this.recapData(); if (!r) return '';
        return `<section class="panel panel-pad recap-card"><div class="section-head" style="margin-bottom:8px"><h3 class="section-title">${ic('chart')} Ta semaine</h3><button class="icon-btn icon-btn-sm" data-action="recap-dismiss" aria-label="Fermer">${ic('x')}</button></div>${this.recapHtml(r, 'tiles')}<button class="btn btn-soft btn-sm" data-action="recap-open">Voir le détail</button></section>`;
    },
    recapOpen() {
        const r = this.recapData();
        this.openModal({ title: `Ta semaine <span class="faint">· ${r ? this.recapRange(r) : ''}</span>`, size: 'narrow', body: r ? `<div class="recap">${this.recapHtml(r)}</div>` : '<p class="muted">Pas encore de révision cette semaine.</p>' });
    },
    recapAction(a) {
        if (a === 'recap-open') this.recapOpen();
        else if (a === 'recap-dismiss') { try { localStorage.setItem('lh_recap', this.recapWeekKey()); } catch { /* ignore */ } this.renderDashboard(); }
    }
});
