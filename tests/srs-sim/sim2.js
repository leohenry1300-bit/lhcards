const X = require('./load')(), T = require('ts-fsrs');
const DAY = 864e5, t0 = new Date(2026, 4, 4, 9, 0).getTime();
const cfg = X.buildCfg({ ...X.OPT_DEFAULTS, scheduler: 'fsrs', gradIvl: 365, easyIvl: 365 });
const f = T.fsrs({ enable_fuzz: false, enable_short_term: true, maximum_interval: 3650 });
// 1) lapse from a review card with stability S and difficulty D, reviewed exactly at its due
console.log('Oubli (Raté) en révision : stabilité après oubli, puis intervalle après réapprentissage (Bien 10 min plus tard)');
console.log('S avant | D | réf. S après | LH S après | réf. ivl | LH ivl');
for (const [S, D] of [[1, 5], [3, 5], [10, 5], [30, 5], [100, 8], [400, 3]]) {
    const ivl = Math.round(X.fsrsIvl(S, 0.9)), last = t0 - ivl * DAY;
    const rc = { ...T.createEmptyCard(new Date(last)), state: T.State.Review, stability: S, difficulty: D, last_review: new Date(last), due: new Date(t0), scheduled_days: ivl, reps: 5 };
    const r1 = f.next(rc, new Date(t0), T.Rating.Again).card, r2 = f.next(r1, new Date(t0 + 6e5), T.Rating.Good).card;
    let c = { state: 'review', step: 0, interval: ivl, ease: 2.5, due: t0, lapses: 0, lastReview: last, fs: { s: S, d: D, t: last } };
    Object.assign(c, X.schedule(c, 1, t0, false, cfg)); c.lastReview = t0; const a1 = c.fs.s;
    Object.assign(c, X.schedule(c, 3, t0 + 6e5, false, cfg));
    console.log([S, D, r1.stability.toFixed(3), a1.toFixed(3), r2.scheduled_days, c.interval].join(' | '));
}
// 2) Hard/Good/Easy from the same review state: ordering and values
console.log('\nDepuis une carte en révision (D=5), revue à l\'heure : intervalles Difficile / Bien / Facile');
for (const S of [0.5, 1, 2, 5, 20, 100]) {
    const ivl = Math.max(1, Math.round(X.fsrsIvl(S, 0.9))), last = t0 - ivl * DAY;
    const rc = { ...T.createEmptyCard(new Date(last)), state: T.State.Review, stability: S, difficulty: 5, last_review: new Date(last), due: new Date(t0), scheduled_days: ivl, reps: 5 };
    const p = f.repeat(rc, new Date(t0));
    const c = { state: 'review', step: 0, interval: ivl, ease: 2.5, due: t0, lapses: 0, lastReview: last, fs: { s: S, d: 5, t: last } };
    const a = [2, 3, 4].map(g => X.schedule(c, g, t0, false, cfg).interval);
    console.log(`S=${S}: réf ${[2, 3, 4].map(g => p[g].card.scheduled_days).join('/')}  LH ${a.join('/')}`);
}
// 3) chains
const chain = gs => { let c = { state: 'new', step: 0, interval: 0, ease: 2.5, due: t0, lapses: 0, fs: null, lastReview: null }, rc = T.createEmptyCard(new Date(t0)), now = t0, A = [], R = [];
    for (const g of gs) { Object.assign(c, X.schedule(c, g, now, false, cfg)); c.lastReview = now; rc = f.next(rc, new Date(now), g).card; A.push(c.state === 'review' ? c.interval + 'j' : Math.round((c.due - now) / 6e4) + 'm'); R.push(rc.scheduled_days ? rc.scheduled_days + 'j' : Math.round((rc.due - now) / 6e4) + 'm'); now = Math.max(c.due, rc.due.getTime()); }
    return `réf ${R.join(' ')}  |  LH ${A.join(' ')}`; };
console.log('\nEnchaînement Nouvelle: Bien, Bien, puis Difficile ×5 :', chain([3, 3, 2, 2, 2, 2, 2]));
console.log('Enchaînement Nouvelle: Facile ×5           :', chain([4, 4, 4, 4, 4]));
console.log('Nouvelle: Raté, Raté, Bien, Bien, Bien      :', chain([1, 1, 3, 3, 3, 3]));
