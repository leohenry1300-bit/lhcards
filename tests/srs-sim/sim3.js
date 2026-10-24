const run = require('./student');
const V = { 'FSRS 90 % (réglage actuel, avec plafond)': { scheduler: 'fsrs' }, 'FSRS 90 % sans plafond': { scheduler: 'fsrs', gradIvl: 365, easyIvl: 365 }, 'SM-2 (défaut de l\'appli, lapseMult 0,5)': { scheduler: 'sm2' }, 'SM-2 façon Anki (nouvel intervalle 0)': { scheduler: 'sm2', lapseMult: 0 } };
const spark = a => { const s = ' ▁▂▃▄▅▆▇█', m = Math.max(...a); const w = []; for (let i = 0; i < a.length; i += 7) { const v = a.slice(i, i + 7).reduce((x, y) => x + y, 0) / 7; w.push(s[Math.round(v / m * 8)]); } return w.join(''); };
console.log('Variante | rétention observée (révisions) | réponses totales/an | charge/jour (moy ± écart-type, max) j60-365 | mémoire moyenne au jour 365');
for (const [k, o] of Object.entries(V)) {
    const rs = [1, 2, 3].map(seed => run({ opts: o, seed }));
    const avg = f => rs.reduce((a, r) => a + f(r), 0) / rs.length;
    console.log(`${k} | ${(avg(r => r.retention) * 100).toFixed(1)} % | ${Math.round(avg(r => r.total))} | ${avg(r => r.mean).toFixed(1)} ± ${avg(r => r.sd).toFixed(1)}, max ${Math.round(avg(r => r.max))} | ${(avg(r => r.trueRetentionNow) * 100).toFixed(1)} %`);
    console.log('   charge par semaine :', spark(rs[0].daily));
}
