const X = require('./load')();
const DAY = 864e5, now = new Date(2026, 5, 10, 9).getTime();
const sm2 = X.buildCfg({ ...X.OPT_DEFAULTS }), fsrs = X.buildCfg({ ...X.OPT_DEFAULTS, scheduler: 'fsrs' });
console.log('Carte « mûre » (intervalle 30 j, facilité 250 %) revue en avance, réponse « Bien »');
console.log('revue après | SM-2 LH : nouvel intervalle (échéance d\'origine → nouvelle) | Anki v3 (formule early review, raisonnée) | FSRS LH');
for (const el of [1, 2, 7, 15, 29]) {
    const last = now - el * DAY, c = { state: 'review', step: 0, interval: 30, ease: 2.5, due: last + 30 * DAY, lapses: 0, lastReview: last, fs: { s: 30, d: 5, t: last } };
    const a = X.schedule(c, 3, now, false, sm2), f = X.schedule(c, 3, now, false, fsrs);
    const anki = Math.max(Math.round(el * 2.5), 30);
    console.log(`${el} j | ${a.interval} j (échéance J+${30 - el} → J+${a.interval}) | ${anki} j | ${f.interval} j`);
}
