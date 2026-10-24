/* loads the app's real scheduling code (fsrs.js + the top of app.js up to the class + optimizer functions) into a Node VM */
const fs = require('fs'), vm = require('vm');
const SRC = process.env.SRC || require('path').join(__dirname, '../../src/');
module.exports = () => {
    const app = fs.readFileSync(SRC + 'app.js', 'utf8'), opt = fs.readFileSync(SRC + 'fsrs-opt.js', 'utf8');
    const code = fs.readFileSync(SRC + 'fsrs.js', 'utf8') + '\n' + app.slice(0, app.indexOf('class SuperAnki')) + '\n'
        + 'function toeicHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }\n'
        + opt.slice(0, opt.indexOf('Object.assign(SuperAnki.prototype'))
        + '\n;globalThis.X = { schedule, buildCfg, OPT_DEFAULTS, fsrsR, fsrsIvl, fsrsInitS, fsrsInitD, fsrsNextD, fsrsRecallS, fsrsForgetS, fsrsShortS, fsrsFromCard, FSRS_W0, FSRS_W, ...(typeof fuzzIvl !== "undefined" ? { fuzzIvl, pickEasyDay } : { fuzzBounds, spreadIvl }), addDays, startOfDay, endOfDay, dayKey, setRollover, cardStatus, previewLabel, normalizeCard, fsrsSequences, fsrsLoss, fsrsTrain, fsrsReplay, FSRS_BOUNDS, DAY, MIN, setLoad: m => { SCHED_LOAD = m; } };';
    const ctx = { console, Intl, Math, Date, setTimeout, Promise, globalThis: null };
    ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(code, ctx);
    return ctx.X;
};
