const run = require('./student');
for (const [k, o] of [['FSRS 90 % (avec plafond 1er intervalle)', { scheduler: 'fsrs' }], ['SM-2 défaut', { scheduler: 'sm2' }]]) {
    const rs = [1, 2, 3].map(seed => run({ opts: o, seed })); const a = f => rs.reduce((x, r) => x + f(r), 0) / 3;
    console.log(`${k} | rétention ${(a(r => r.retention) * 100).toFixed(1)} % | réponses/an ${Math.round(a(r => r.total))} | charge ${a(r => r.mean).toFixed(1)} ± ${a(r => r.sd).toFixed(1)}`);
}
for (const gap of [30, 90, 365]) {
    const back = 120 + gap, r = run({ opts: { scheduler: 'fsrs' }, nCards: 1000, days: back + 30, seed: 3, skip: d => d >= 120 && d < back, maxReviews: 200 });
    const d = r.daily.slice(back, back + 14), late = r.daily.slice(back + 14, back + 30);
    console.log(`Absence ${gap} j, plafond 200 : 14 jours du retour = ${d.join(' ')} · rétention ${(r.retention * 100).toFixed(1)} %`);
}
