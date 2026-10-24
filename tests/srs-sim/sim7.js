const X = require('./load')(), run = require('./student');
const truth = [...X.FSRS_W0]; truth[0] = 0.2; truth[1] = 0.7; truth[2] = 1.8; truth[3] = 8; truth[8] = 1.8; truth[11] = 1.4; truth[16] = 2.2;
(async () => {
    const log = [], cards = [];
    run({ opts: { scheduler: 'fsrs' }, nCards: 800, days: 300, seed: 5, truthW: truth, log, cardsOut: cards });
    const seqs = X.fsrsSequences(log); const r = await X.fsrsTrain(seqs, null);
    const end = new Date(2026, 0, 5, 9).getTime() + 300 * 864e5, today = X.startOfDay(end);
    const hist = (key) => { const m = new Map(); cards.filter(c => c.state === 'review').forEach(c => { const d = Math.round((X.startOfDay(key(c)) - today) / 864e5); m.set(d, (m.get(d) || 0) + 1); }); return m; };
    const before = hist(c => c.due);
    const rows = new Map(seqs.map(s => [s.id, s.rows]));
    const after = hist(c => { const st = X.fsrsReplay(rows.get(c.id), r.w); const ivl = Math.max(1, Math.round(X.fsrsIvl(st.s, 0.9))); return X.addDays(c.lastReview, ivl); });
    const sum = (m, f) => [...m].filter(([d]) => f(d)).reduce((a, [, n]) => a + n, 0), peak = m => Math.max(...[...m].filter(([d]) => d >= 0 && d < 30).map(([, n]) => n));
    console.log('Avant replanification : en retard', sum(before, d => d < 0), '· aujourd\'hui', before.get(0) || 0, '· pic sur 30 j', peak(before));
    console.log('Après replanification : en retard', sum(after, d => d < 0), '· aujourd\'hui', after.get(0) || 0, '· pic sur 30 j', peak(after), ' (cartes en révision :', cards.filter(c => c.state === 'review').length + ')');
})();
