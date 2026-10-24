const X = require('./load')(), T = require('ts-fsrs');
const now = new Date(2026, 5, 1, 9).getTime(); let seed = 7; Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const loadRand = () => { const m = new Map(); for (let d = 0; d < 400; d++) m.set(X.startOfDay(X.addDays(now, d)), Math.floor(Math.random() * 40)); return m; };
console.log('Intervalle | plage Anki | LH flou seul | LH flou + équilibrage (hors plage)');
for (const base of [3, 4, 5, 7, 10, 30, 100, 365]) {
    const { min_ivl, max_ivl } = T.get_fuzz_range(base, 0, 36500), a = [], b = [];
    for (let i = 0; i < 3000; i++) a.push(X.spreadIvl(base, now, '0000000', 36500));
    for (let i = 0; i < 3000; i++) { X.setLoad(loadRand()); b.push(X.spreadIvl(base, now, '0000000', 36500)); } X.setLoad(null);
    const out = [...a, ...b].filter(v => v < min_ivl || v > max_ivl).length;
    console.log(`${base} j | ${min_ivl}–${max_ivl} | ${Math.min(...a)}–${Math.max(...a)} | ${Math.min(...b)}–${Math.max(...b)} (${out} hors plage)`);
}
