/* Exam plan: true recall on the exam morning with normal reviews only, + the daily plan, + the last round the day before.
   Same rule as examPlan() in src/features.js (chance to remember on the exam day < 90 % = at risk, spread over the days left). */
const X = require('./load')(), T = require('ts-fsrs');
const algo = new T.FSRSAlgorithm({ enable_short_term: true }), DAY = 864e5;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function run(sched, mode, seed, { EXAM = 40, PLAN = 12, skip = 0 } = {}) {
    const R = rng(seed); Math.random = rng(seed + 7);
    const cfg = X.buildCfg({ ...X.OPT_DEFAULTS, scheduler: sched }), start = new Date(2026, 0, 5, 18).getTime(), N = 300, SK = rng(seed + 99);
    const examT = new Date(start); examT.setDate(examT.getDate() + EXAM); examT.setHours(8);
    const cards = Array.from({ length: N }, (_, i) => ({ id: i, state: 'new', step: 0, interval: 0, ease: 2.5, due: start, lapses: 0, fs: null, lastReview: null, truth: null, tLast: null }));
    let next = 0, extra = 0;
    const study = (c, now, sch = true) => {
        let g;
        if (!c.truth) { const u = R(); g = u < .25 ? 1 : u < .35 ? 2 : u < .95 ? 3 : 4; }
        else { const r = algo.forgetting_curve((now - c.tLast) / DAY, c.truth.stability); g = R() < r ? (R() < .1 ? 2 : R() < .92 ? 3 : 4) : 1; }
        c.truth = algo.next_state(c.truth, c.truth ? Math.max(0, Math.floor((now - c.tLast) / DAY)) : 0, g); c.tLast = Math.max(now, c.tLast || 0);
        if (sch) { Object.assign(c, X.schedule(c, g, now, true, cfg)); c.lastReview = now; if (c.state === 'new') c.state = 'learning'; }
        return g;
    };
    const examR = c => { if (c.state === 'new') return 0; const fs = X.fsrsFromCard(c); return X.fsrsR((examT - (c.lastReview || fs.t)) / DAY, fs.s); };
    for (let d = 0; d < EXAM; d++) {
        const day = new Date(start); day.setDate(day.getDate() + d); let now = day.getTime();
        const eod = X.endOfDay(now), daysLeft = EXAM - d;
        if (skip && daysLeft > 1 && SK() < skip) continue;
        const q = cards.filter(c => c.state === 'review' && c.due <= eod);
        for (let k = 0; k < 20 && next < N; k++) q.push(cards[next++]);
        const learn = [];
        const drain = () => { for (let g = 0; g < 5000; g++) { learn.sort((a, b) => a.due - b.due); let c = null; if (learn.length && learn[0].due <= now) c = learn.shift(); else if (q.length) c = q.shift(); else if (learn.length && learn[0].due < eod) { now = Math.max(now, learn[0].due); c = learn.shift(); } else break; study(c, now); now += 8000; if (c.state === 'learning' || c.state === 'relearning') learn.push(c); } };
        drain();
        if (mode !== 'none' && daysLeft <= PLAN && daysLeft >= 2) {
            const today = X.startOfDay(now), rows = cards.map(c => ({ c, r: examR(c) })), risk = rows.filter(x => x.r < .9).sort((a, b) => a.r - b.r);
            const quota = Math.ceil(risk.length / Math.max(1, daysLeft - 1)), done = rows.filter(x => x.c.lastReview >= today).length;
            risk.filter(x => !(x.c.lastReview >= today)).slice(0, Math.max(0, quota - done)).forEach(x => { q.push(x.c); extra++; });
            drain();
        }
        if (mode === 'full' && daysLeft === 1) cards.slice().sort((a, b) => examR(a) - examR(b)).slice(0, 40).forEach(c => { study(c, now, false); now += 8000; extra++; });
    }
    const truthR = cards.reduce((a, c) => a + (c.truth ? algo.forgetting_curve((examT - c.tLast) / DAY, c.truth.stability) : 0), 0) / N;
    return { truthR, extra };
}
const SC = [['Révisions régulières 6 semaines avant', {}], ['Début tardif (cours commencé à J-12)', { EXAM: 12 }], ['Irrégulier (1 jour sur 2 sauté, 6 semaines)', { skip: .5 }]];
for (const [title, o] of SC) { console.log('\n' + title);
for (const s of ['sm2', 'fsrs']) for (const [m, l] of [['none', 'révisions normales seules'], ['plan', '+ plan du jour'], ['full', '+ plan + dernier tour J-1']]) {
    const rs = [1, 2, 3].map(seed => run(s, m, seed, o));
    console.log(`  ${s.toUpperCase().padEnd(4)} ${l.padEnd(28)} souvenir réel le jour J : ${(rs.reduce((a, r) => a + r.truthR, 0) / 3 * 100).toFixed(1)} %   cartes en plus : ${Math.round(rs.reduce((a, r) => a + r.extra, 0) / 3)}`);
} }
