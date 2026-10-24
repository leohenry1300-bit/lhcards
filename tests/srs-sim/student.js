/* virtual student: true memory = FSRS-5 (ts-fsrs, default weights); the app's real schedule() decides when cards come back */
const X = require('./load')(), T = require('ts-fsrs');
const DAY = 864e5, MIN = 6e4;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
module.exports = function run({ opts = {}, days = 365, nCards = 1000, newPerDay = 20, seed = 1, loadBalance = true, skip = () => false, maxReviews = Infinity, fuzz = true, truthW = null, log = null, grades = null, cardsOut = null }) {
    const algo = new T.FSRSAlgorithm({ enable_short_term: true, ...(truthW ? { w: truthW } : {}) });
    const R = rng(seed); Math.random = rng(seed + 99);
    const cfg = X.buildCfg({ ...X.OPT_DEFAULTS, ...opts });
    const start = new Date(2026, 0, 5, 9, 0).getTime();
    const cards = Array.from({ length: nCards }, (_, i) => ({ id: i, state: 'new', step: 0, interval: 0, ease: cfg.startEase, due: start, lapses: 0, fs: null, lastReview: null, truth: null, tLast: null }));
    let nextNew = 0; const daily = [], revOk = [], revAll = [], byMonth = {};
    const answer = (c, now) => {
        let g;
        if (!c.truth) { const u = R(); g = u < .25 ? 1 : u < .35 ? 2 : u < .95 ? 3 : 4; }
        else {
            const el = (now - c.tLast) / DAY, r = algo.forgetting_curve(el, c.truth.stability);
            if (c.state === 'review') { revAll.push(1); }
            if (R() < r) { const u = R(); g = u < .1 ? 2 : u < .92 ? 3 : 4; if (c.state === 'review') { revOk.push(1); const m = Math.floor((now - start) / DAY / 30); (byMonth[m] = byMonth[m] || [0, 0])[0]++; } } else g = 1;
            if (c.state === 'review') { const m = Math.floor((now - start) / DAY / 30); (byMonth[m] = byMonth[m] || [0, 0])[1]++; }
        }
        if (log) log.push([now, c.id, g, c.state === 'review' ? 1 : c.state === 'relearning' ? 2 : 0]);
        const elInt = c.truth ? Math.floor((now - c.tLast) / DAY) : 0;
        c.truth = algo.next_state(c.truth, elInt, g); c.tLast = now;
        if (loadBalance) { const m = new Map(); cards.forEach(x => { if (x.state === 'review' && x !== c) { const k = X.startOfDay(x.due); m.set(k, (m.get(k) || 0) + 1); } }); X.setLoad(m); }
        Object.assign(c, X.schedule(c, g, now, fuzz, cfg)); X.setLoad(null); c.lastReview = now;
        if (c.state === 'new') c.state = 'learning';
    };
    for (let d = 0; d < days; d++) {
        const dayT = new Date(start); dayT.setDate(dayT.getDate() + d); let now = dayT.getTime();
        if (skip(d)) { daily.push(0); continue; }
        const eod = X.endOfDay(now);
        let reviews = cards.filter(c => c.state === 'review' && c.due <= eod).sort((a, b) => a.due - b.due).slice(0, maxReviews);
        const room = maxReviews === Infinity ? newPerDay : Math.max(0, Math.min(newPerDay, maxReviews - reviews.length));
        const news = []; for (let k = 0; k < room && nextNew < nCards; k++) news.push(cards[nextNew++]);
        const queue = [...reviews, ...news]; let learning = cards.filter(c => c.state === 'learning' || c.state === 'relearning');
        let n = 0;
        for (let guard = 0; guard < 20000; guard++) {
            learning.sort((a, b) => a.due - b.due);
            let c = null;
            if (learning.length && learning[0].due <= now) c = learning.shift();
            else if (queue.length) c = queue.shift();
            else if (learning.length && learning[0].due - now <= 20 * MIN) c = learning.shift();
            else break;
            answer(c, now); n++; now += 8000;
            if ((c.state === 'learning' || c.state === 'relearning') && !learning.includes(c)) learning.push(c);
        }
        daily.push(n);
    }
    if (cardsOut) cardsOut.push(...cards);
    const rev = cards.filter(c => c.state === 'review');
    const tail = daily.slice(60);
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length, sd = Math.sqrt(tail.reduce((a, b) => a + (b - mean) ** 2, 0) / tail.length);
    return { retention: revOk.length / Math.max(1, revAll.length), reviewsState: revAll.length, total: daily.reduce((a, b) => a + b, 0), mean, sd, max: Math.max(...tail), daily, byMonth,
        trueRetentionNow: rev.reduce((a, c) => a + algo.forgetting_curve((start + days * DAY - c.tLast) / DAY, c.truth.stability), 0) / Math.max(1, rev.length) };
};
