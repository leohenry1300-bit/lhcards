const run = require('./student');
const o = { scheduler: 'fsrs', gradIvl: 365, easyIvl: 365 };
for (const [k, p] of [['flou + équilibrage (défaut)', {}], ['flou seul', { loadBalance: false }], ['ni flou ni équilibrage', { loadBalance: false, fuzz: false }]]) {
    const rs = [1, 2, 3].map(seed => run({ opts: o, seed, ...p }));
    console.log(k.padEnd(28), 'rétention', (rs.reduce((a, r) => a + r.retention, 0) / 3 * 100).toFixed(2), '%  écart-type charge', (rs.reduce((a, r) => a + r.sd, 0) / 3).toFixed(1));
}
for (const ret of [0.8, 0.85, 0.95]) { const rs = [1, 2].map(seed => run({ opts: { ...o, retention: ret }, seed, loadBalance: false, fuzz: false })); console.log('cible', ret, '→ observée', (rs.reduce((a, r) => a + r.retention, 0) / 2 * 100).toFixed(1), '%'); }
