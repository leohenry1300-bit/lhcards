const X = require('./load')(), T = require('ts-fsrs');
const DAY = 864e5, t0 = new Date(2026, 2, 2, 9, 0).getTime();
const cfgOn = X.buildCfg({ ...X.OPT_DEFAULTS, scheduler: 'fsrs' }), cfgOff = X.buildCfg({ ...X.OPT_DEFAULTS, scheduler: 'fsrs', gradIvl: 365, easyIvl: 365 });
const at9 = t => { const d = new Date(t); d.setHours(9, 0, 0, 0); return d.getTime(); };
function app(cfg, delay, firstEasy = false) {
    let c = { state: 'new', step: 0, interval: 0, ease: 2.5, due: t0, lapses: 0, fs: null, lastReview: null }, now = t0, out = [];
    const ans = g => { Object.assign(c, X.schedule(c, g, now, false, cfg)); c.lastReview = now; };
    if (firstEasy) ans(4); else { ans(3); now += 10 * 6e4; ans(3); }
    out.push(c.interval);
    while (now - t0 < 730 * DAY) { now = at9(c.due) + delay * DAY; ans(3); out.push(c.interval); }
    return out;
}
function ref(delay, firstEasy = false) {
    const f = T.fsrs({ enable_fuzz: false, enable_short_term: true, maximum_interval: 3650 });
    let c = T.createEmptyCard(new Date(t0)), now = t0, out = [];
    if (firstEasy) c = f.next(c, new Date(now), T.Rating.Easy).card; else { c = f.next(c, new Date(now), T.Rating.Good).card; now += 10 * 6e4; c = f.next(c, new Date(now), T.Rating.Good).card; }
    out.push(c.scheduled_days);
    while (now - t0 < 730 * DAY) { now = at9(c.due.getTime()) + delay * DAY; c = f.next(c, new Date(now), T.Rating.Good).card; out.push(c.scheduled_days); }
    return out;
}
for (const d of [0, 1, 7, 30]) {
    console.log(`\nRetard ${d} j — intervalles successifs (jours)`);
    console.log('ts-fsrs (réf.)   :', ref(d).join(' '));
    console.log('LH Cards plafond :', app(cfgOn, d).join(' '));
    console.log('LH Cards sans pl.:', app(cfgOff, d).join(' '));
}
console.log('\nPremière réponse « Facile » : réf', ref(0, true).slice(0, 6).join(' '), '| LH', app(cfgOn, 0, true).slice(0, 6).join(' '), '| LH sans plafond', app(cfgOff, 0, true).slice(0, 6).join(' '));
