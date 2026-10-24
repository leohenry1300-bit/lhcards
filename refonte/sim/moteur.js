// src/engine/fsrs.ts
var DEFAULT_W = Object.freeze([
  0.212,
  1.2931,
  2.3065,
  8.2956,
  6.4133,
  0.8334,
  3.0194,
  1e-3,
  1.8722,
  0.1666,
  0.796,
  1.4835,
  0.0614,
  0.2629,
  1.6483,
  0.6014,
  1.8729,
  0.5425,
  0.0912,
  0.0658,
  0.1542
]);
var W_MIN = [1e-3, 1e-3, 1e-3, 1e-3, 1, 1e-3, 1e-3, 1e-3, 0, 0, 1e-3, 1e-3, 1e-3, 1e-3, 0, 0, 1, 0, 0, 0, 0.1];
var W_MAX = [100, 100, 100, 100, 10, 4, 4, 0.75, 4.5, 0.8, 3.5, 5, 0.25, 0.9, 4, 1, 6, 2, 2, 0.8, 0.8];
var S_MIN = 1e-3;
var D_MIN = 1;
var D_MAX = 10;
var clampD = (d) => Math.min(D_MAX, Math.max(D_MIN, d));
var clampS = (s) => Math.max(S_MIN, s);
function retrievability(t, s, w = DEFAULT_W) {
  const decay = -w[20], factor = Math.pow(0.9, 1 / decay) - 1;
  return Math.pow(1 + factor * Math.max(0, t) / s, decay);
}
function intervalFor(s, targetR, w = DEFAULT_W) {
  const decay = -w[20], factor = Math.pow(0.9, 1 / decay) - 1;
  return s / factor * (Math.pow(targetR, 1 / decay) - 1);
}
function initDifficulty(g, w = DEFAULT_W, clamp = true) {
  const d = w[4] - Math.exp(w[5] * (g - 1)) + 1;
  return clamp ? clampD(d) : d;
}
function initMemory(g, w = DEFAULT_W) {
  return { s: clampS(w[g - 1]), d: initDifficulty(g, w) };
}
function nextDifficulty(d, g, w = DEFAULT_W) {
  const delta = -w[6] * (g - 3);
  const damped = d + (10 - d) * delta / 9;
  return clampD(w[7] * initDifficulty(4, w, false) + (1 - w[7]) * damped);
}
function recallStability(s, d, r, g, w) {
  const hard = g === 2 ? w[15] : 1, easy = g === 4 ? w[16] : 1;
  return s * (1 + Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp((1 - r) * w[10]) - 1) * hard * easy);
}
function forgetStability(s, d, r, w) {
  const long = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]);
  return Math.min(long, s / Math.exp(w[17] * w[18]));
}
function shortTermStability(s, g, w) {
  let inc = Math.exp(w[17] * (g - 3 + w[18])) * Math.pow(s, -w[19]);
  if (g >= 2) inc = Math.max(inc, 1);
  return clampS(s * inc);
}
function nextMemory(m, elapsedDays, g, w = DEFAULT_W) {
  if (!m) return initMemory(g, w);
  let s;
  if (elapsedDays < 1) s = shortTermStability(m.s, g, w);
  else {
    const r = retrievability(elapsedDays, m.s, w);
    s = clampS(g === 1 ? forgetStability(m.s, m.d, r, w) : recallStability(m.s, m.d, r, g, w));
  }
  return { s, d: nextDifficulty(m.d, g, w) };
}

// src/engine/scheduler.ts
var STEP_AGAIN_MIN = 1;
var STEP_HARD_MIN = 6;
var RELEARN_MIN = 10;
var MIN = 6e4;
var newSched = (now) => ({ phase: "new", s: 0, d: 0, due: now, last: null, reps: 0, lapses: 0 });
function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}
function fuzzRange(ivl, maxIvl) {
  if (ivl < 2.5) return [ivl, ivl];
  let delta = 1;
  for (const [start, end, f] of [[2.5, 7, 0.15], [7, 20, 0.1], [20, Infinity, 0.05]]) delta += f * Math.max(Math.min(ivl, end) - start, 0);
  const lo = Math.max(2, Math.round(ivl - delta)), hi = Math.min(Math.round(ivl + delta), maxIvl);
  return [Math.min(lo, hi), hi];
}
function pickDay(ivl, today, seed, ctx, maxIvl) {
  if (ctx.fuzz === false) return ivl;
  const [lo, hi] = fuzzRange(ivl, maxIvl);
  if (lo === hi) return lo;
  if (!ctx.load && !ctx.weekWeight) return lo + Math.floor(hash01(seed) * (hi - lo + 1));
  let best = ivl, bestScore = Infinity;
  for (let k = lo; k <= hi; k++) {
    const load = ctx.load ? ctx.load(today + k) : 0;
    const ww = ctx.weekWeight ? ctx.weekWeight(today + k) : 1;
    const score = (load + 1) / ww * (k / ivl) + hash01(seed + k) * 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = k;
    }
  }
  return best;
}
function intervalDays(m, today, seed, ctx) {
  const w = ctx.w ?? DEFAULT_W, maxIvl = ctx.maxIvl ?? 36500;
  const raw = intervalFor(m.s, ctx.targetR ?? 0.9, w);
  let ivl = Math.min(maxIvl, Math.max(1, Math.round(raw)));
  ivl = pickDay(ivl, today, seed, ctx, maxIvl);
  if (ctx.exam && ctx.exam.day > today && today + ivl >= ctx.exam.day) {
    const left = ctx.exam.day - today;
    if (retrievability(left, m.s, w) < ctx.exam.target) {
      const spread = Math.max(1, Math.min(6, Math.floor(left / 3)));
      ivl = Math.max(1, left - 1 - Math.floor(hash01(seed + "x") * spread));
    }
  }
  return ivl;
}
function review(card, st, g, now, ctx, ms = 0) {
  const w = ctx.w ?? DEFAULT_W;
  const today = ctx.dayOf(now);
  const elapsed = st.last === null ? 0 : ctx.daysBetween ? ctx.daysBetween(st.last, now) : today - ctx.dayOf(st.last);
  const mem = st.phase === "new" ? null : { s: st.s, d: st.d };
  const m = nextMemory(mem, elapsed, g, w);
  const next = { ...st, s: m.s, d: m.d, last: now, reps: st.reps + 1 };
  const seed = card + ":" + st.reps;
  let ivl = 0;
  const inSession = st.phase === "new" || st.phase === "learning";
  if (inSession && g === 1) {
    next.phase = "learning";
    next.due = now + STEP_AGAIN_MIN * MIN;
  } else if (inSession && g === 2 && st.phase === "new") {
    next.phase = "learning";
    next.due = now + STEP_HARD_MIN * MIN;
  } else if (st.phase === "review" && g === 1) {
    next.phase = "relearning";
    next.lapses++;
    next.due = now + RELEARN_MIN * MIN;
  } else if (st.phase === "relearning" && g === 1) {
    next.due = now + RELEARN_MIN * MIN;
  } else {
    ivl = intervalDays(m, today, seed, ctx);
    next.phase = "review";
    next.due = ctx.dayStart(today + ivl);
  }
  return { next, log: { card, t: now, g, phase: st.phase, elapsed, ivl, s: m.s, d: m.d, ms } };
}
function recallNow(st, now, ctx) {
  if (st.phase === "new" || st.last === null) return null;
  const t = ctx.daysBetween ? ctx.daysBetween(st.last, now) : ctx.dayOf(now) - ctx.dayOf(st.last);
  return retrievability(t, st.s, ctx.w ?? DEFAULT_W);
}

// src/engine/queue.ts
var REVIEWS_RESERVED_PER_NEW = 3.5;
function newAllowance(budgetMin, forecastMin, todayMin, secPerNew, secPerReview, maxNew) {
  const free = Math.min(budgetMin - todayMin, budgetMin - forecastMin) * 60;
  if (free <= 0) return 0;
  const cost = secPerNew + REVIEWS_RESERVED_PER_NEW * secPerReview;
  return Math.max(0, Math.min(maxNew, Math.floor(free / cost)));
}
function forecast(cards, fromDay, days, ctx) {
  const out = new Array(days).fill(0);
  for (const c of cards) {
    if (c.sched.phase === "new") continue;
    const k = ctx.dayOf(c.sched.due) - fromDay;
    if (k < days) out[Math.max(0, k)]++;
  }
  return out;
}
function interleave(reviews, news) {
  if (!news.length) return reviews.slice();
  if (!reviews.length) return news.slice();
  const out = [], every = Math.max(1, Math.round(reviews.length / (news.length + 1)));
  let n = 0;
  reviews.forEach((r, i) => {
    out.push(r);
    if ((i + 1) % every === 0 && n < news.length) out.push(news[n++]);
  });
  while (n < news.length) out.push(news[n++]);
  return out;
}
function planDay(cards, dc) {
  const { now, ctx } = dc;
  const secR = dc.secPerReview ?? 9, secN = dc.secPerNew ?? 25, maxNew = dc.maxNew ?? 25;
  const today = ctx.dayOf(now), endOfToday = ctx.dayStart(today + 1);
  const seen = new Set(dc.notesSeenToday ?? []);
  const learning = [], due = [], fresh = [];
  for (const c of cards) {
    const p = c.sched.phase;
    if (p === "learning" || p === "relearning") {
      if (c.sched.due < endOfToday) learning.push(c);
    } else if (p === "review") {
      if (c.sched.due < endOfToday) due.push(c);
    } else fresh.push(c);
  }
  learning.sort((a, b) => a.sched.due - b.sched.due);
  const rOf = /* @__PURE__ */ new Map();
  for (const c of due) rOf.set(c.id, recallNow(c.sched, now, ctx) ?? 1);
  due.sort((a, b) => rOf.get(a.id) - rOf.get(b.id) || (a.id < b.id ? -1 : 1));
  const budgetSec = Math.max(0, (dc.budgetMin - (dc.doneMin ?? 0)) * 60) - learning.length * secR * 0.6;
  const reviews = [];
  let used = 0;
  for (const c of due) {
    if (c.note && seen.has(c.note)) continue;
    if (used + secR > budgetSec && reviews.length >= 10) break;
    reviews.push(c);
    used += secR;
    if (c.note) seen.add(c.note);
  }
  const backlog = due.length - reviews.length;
  const fc = forecast(cards, today + 1, 7, ctx);
  const forecastMin = fc.reduce((a, b) => a + b, 0) / 7 * secR / 60;
  const allow = backlog > 0 ? 0 : newAllowance(dc.budgetMin, forecastMin, (dc.doneMin ?? 0) + used / 60, secN, secR, maxNew - (dc.newDone ?? 0));
  const news = [];
  fresh.sort((a, b) => Number(!!b.exam) - Number(!!a.exam) || (a.id < b.id ? -1 : 1));
  for (const c of fresh) {
    if (news.length >= allow) break;
    if (c.note && seen.has(c.note)) continue;
    news.push(c);
    if (c.note) seen.add(c.note);
  }
  const order = [...learning.filter((c) => c.sched.due <= now), ...interleave(reviews, news)];
  const minutes = Math.round((learning.length * secR + reviews.length * secR + news.length * secN) / 60);
  return { learning, reviews, news, order, minutes, backlog, newAllowance: allow };
}
function targetRetention(daysToExam, base = 0.9, peak = 0.95) {
  if (daysToExam === null || daysToExam < 0 || daysToExam > 21) return base;
  return base + (peak - base) * (1 - daysToExam / 21);
}
function calibrationOffset(predicted, observed, n) {
  if (n < 300) return 0;
  return Math.max(-0.03, Math.min(0.03, (predicted - observed) / n));
}

// src/engine/optimizer.ts
var EPS = 1e-6;
function logLoss(hist, w) {
  let sum = 0, n = 0;
  for (const h of hist) {
    let m = null;
    for (let i = 0; i < h.grades.length; i++) {
      const g = h.grades[i];
      const elapsed = i === 0 ? 0 : h.days[i] - h.days[i - 1];
      if (m && elapsed >= 1) {
        const p = Math.min(1 - EPS, Math.max(EPS, retrievability(elapsed, m.s, w)));
        sum -= g > 1 ? Math.log(p) : Math.log(1 - p);
        n++;
      }
      m = nextMemory(m, elapsed, g, w);
    }
  }
  return { loss: n ? sum / n : 0, n };
}
function countLongTerm(hist) {
  let n = 0;
  for (const h of hist) for (let i = 1; i < h.days.length; i++) if (h.days[i] - h.days[i - 1] >= 1) n++;
  return n;
}
var clampW = (w) => w.map((v, i) => Math.min(W_MAX[i], Math.max(W_MIN[i], v)));
function optimize(hist, current = DEFAULT_W, opts = {}) {
  const t0 = Date.now();
  const total = countLongTerm(hist);
  const base = { w: [...current], adopted: false, lossBefore: 0, lossAfter: 0, reviews: total };
  if (total < (opts.minReviews ?? 400)) return { ...base, reason: `historique trop court (${total} r\xE9visions sur plusieurs jours, 400 n\xE9cessaires)`, ms: Date.now() - t0 };
  const train = hist.filter((h) => hash01(h.id + "split") >= 0.2), valid = hist.filter((h) => hash01(h.id + "split") < 0.2);
  const cap = opts.sample ?? 4e3;
  const pick = train.length > cap ? train.filter((h) => hash01(h.id + "s") < cap / train.length) : train;
  const lambda = 3e-4;
  const scale = current.map((v) => Math.max(Math.abs(v), 0.05));
  const objective = (w2) => {
    let reg = 0;
    for (let i = 0; i < w2.length; i++) reg += ((w2[i] - current[i]) / scale[i]) ** 2;
    return logLoss(pick, w2).loss + lambda * reg;
  };
  let w = [...current];
  const m1 = new Array(w.length).fill(0), m2 = new Array(w.length).fill(0);
  const b1 = 0.9, b2 = 0.999, iters = opts.iterations ?? 60;
  for (let it = 1; it <= iters; it++) {
    const lr = 0.06 * (1 - 0.7 * it / iters);
    const grad = w.map((_, i) => {
      const h = scale[i] * 1e-3;
      const up = clampW(w.map((v, j) => j === i ? v + h : v)), dn = clampW(w.map((v, j) => j === i ? v - h : v));
      return (objective(up) - objective(dn)) / (up[i] - dn[i] || h);
    });
    w = clampW(w.map((v, i) => {
      m1[i] = b1 * m1[i] + (1 - b1) * grad[i];
      m2[i] = b2 * m2[i] + (1 - b2) * grad[i] ** 2;
      const mh = m1[i] / (1 - b1 ** it), vh = m2[i] / (1 - b2 ** it);
      return v - lr * scale[i] * mh / (Math.sqrt(vh) + 1e-8);
    }));
  }
  const before = logLoss(valid, current).loss, after = logLoss(valid, w).loss;
  const adopted = after < before * 0.999;
  return {
    w: adopted ? w : [...current],
    adopted,
    lossBefore: before,
    lossAfter: after,
    reviews: total,
    ms: Date.now() - t0,
    reason: adopted ? `meilleure pr\xE9diction sur les cartes de contr\xF4le (perte ${before.toFixed(4)} \u2192 ${after.toFixed(4)})` : `pas d'am\xE9lioration nette sur les cartes de contr\xF4le (${before.toFixed(4)} \u2192 ${after.toFixed(4)}) : param\xE8tres conserv\xE9s`
  };
}

// src/engine/simulate.ts
var DAY = 864e5;
var ctxBase = { dayOf: (ms) => Math.floor(ms / DAY), dayStart: (d) => d * DAY };
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var STUDENT_FAST_FORGETTER = DEFAULT_W.map((v, i) => i <= 3 ? v * 0.55 : i === 8 ? v - 0.3 : i === 20 ? 0.2 : v);
function simulate(o = {}) {
  const N = o.cards ?? 1e3, D = o.days ?? 365, budget = o.budgetMin ?? 20, policy = o.policy ?? "auto";
  const wTrue = o.wTrue ?? DEFAULT_W;
  let wEng = [...o.wStart ?? DEFAULT_W];
  const rand = rng(o.seed ?? 1);
  const cards = Array.from({ length: N }, (_, i) => ({ id: "k" + String(i).padStart(5, "0"), deck: "d", sched: newSched(0) }));
  const truth = /* @__PURE__ */ new Map();
  const hist = /* @__PURE__ */ new Map();
  const load = /* @__PURE__ */ new Map();
  const days = [];
  const optimizations = [];
  let secR = 9, secN = 25, nR = 0, nN = 0;
  const moveLoad = (from, to) => {
    if (from && from.phase === "review") {
      const k = ctxBase.dayOf(from.due);
      load.set(k, (load.get(k) ?? 1) - 1);
    }
    if (to.phase === "review") {
      const k = ctxBase.dayOf(to.due);
      load.set(k, (load.get(k) ?? 0) + 1);
    }
  };
  for (let day = 0; day < D; day++) {
    const stat = { day, reviews: 0, news: 0, minutes: 0, ltReviews: 0, ltSuccess: 0, predicted: 0, onTime: 0, onTimeSuccess: 0, target: 0.9, backlog: 0, seen: 0, known: 0 };
    const daysToExam = o.examDay != null ? o.examDay - day : null;
    const recent = days.slice(-60);
    const offset = o.calibrate ?? policy === "auto" ? calibrationOffset(recent.reduce((a, d) => a + d.predicted, 0), recent.reduce((a, d) => a + d.ltSuccess, 0), recent.reduce((a, d) => a + d.ltReviews, 0)) : 0;
    const target = Math.min(0.97, targetRetention(daysToExam) + offset);
    stat.target = targetRetention(daysToExam);
    const ctx = {
      ...ctxBase,
      w: wEng,
      targetR: target,
      fuzz: true,
      load: policy === "auto" ? ((d) => load.get(d) ?? 0) : void 0,
      exam: o.examDay != null && daysToExam > 0 ? { day: o.examDay, target: 0.95 } : void 0
    };
    const absent = o.absence && day >= o.absence[0] && day <= o.absence[1];
    let t = day * DAY + 18 * 36e5;
    const start = t;
    if (!absent) {
      let order;
      if (policy === "auto") {
        const plan = planDay(cards, { now: t, ctx, budgetMin: budget, secPerReview: secR, secPerNew: secN });
        order = plan.order;
        stat.backlog = plan.backlog;
      } else {
        const end = ctxBase.dayStart(day + 1);
        const due = cards.filter((c) => c.sched.phase !== "new" && c.sched.due < end).sort((a, b) => a.sched.due - b.sched.due);
        const fresh = cards.filter((c) => c.sched.phase === "new").slice(0, o.fixedNew ?? 20);
        order = [...due, ...fresh];
      }
      const pending = [];
      const spent = /* @__PURE__ */ new Map();
      const answer = (c) => {
        const tr = truth.get(c.id) ?? { m: null, last: day };
        const first = c.sched.phase === "new";
        let g;
        if (first) {
          const u = rand();
          g = u < 0.35 ? 1 : u < 0.5 ? 2 : u < 0.9 ? 3 : 4;
        } else {
          const elapsed = day - tr.last;
          const lastMs = c.sched.last ?? t;
          const p = elapsed >= 1 ? retrievability(elapsed, tr.m.s, wTrue) : retrievability((t - lastMs) / DAY, tr.m.s, wTrue);
          const ok = rand() < p, u = rand();
          g = !ok ? 1 : u < 0.12 ? 2 : u < 0.9 ? 3 : 4;
          if (elapsed >= 1 && (c.sched.phase === "review" || c.sched.phase === "relearning")) {
            stat.ltReviews++;
            if (ok) stat.ltSuccess++;
            stat.predicted += retrievability(day - ctxBase.dayOf(lastMs), c.sched.s, wEng);
            if (day <= ctxBase.dayOf(c.sched.due)) {
              stat.onTime++;
              if (ok) stat.onTimeSuccess++;
            }
          }
        }
        tr.m = nextMemory(tr.m, first ? 0 : day - tr.last, g, wTrue);
        tr.last = day;
        truth.set(c.id, tr);
        const sec = first ? 18 + rand() * 14 : c.sched.phase === "review" ? (g === 1 ? 12 : 7) + rand() * 4 : 6 + rand() * 3;
        const before = c.sched;
        const r = review(c.id, c.sched, g, t, ctx, sec * 1e3);
        moveLoad(before, r.next);
        c.sched = r.next;
        const h = hist.get(c.id) ?? { id: c.id, days: [], grades: [] };
        h.days.push(day);
        h.grades.push(g);
        hist.set(c.id, h);
        if (first) stat.news++;
        else stat.reviews++;
        const sp = spent.get(c.id) ?? { sec: 0, isNew: first };
        sp.sec += sec;
        spent.set(c.id, sp);
        t += sec * 1e3;
        if (c.sched.phase === "learning" || c.sched.phase === "relearning") pending.push(c);
      };
      let guard = 0;
      for (const c of order) {
        for (let i = 0; i < pending.length; i++) if (pending[i].sched.due <= t) {
          answer(pending.splice(i, 1)[0]);
          i--;
        }
        answer(c);
      }
      while (pending.length && guard++ < 2e4) {
        pending.sort((a, b) => a.sched.due - b.sched.due);
        const c = pending.shift();
        t = Math.max(t, c.sched.due);
        answer(c);
      }
      for (const sp of spent.values()) {
        if (sp.isNew) secN += (sp.sec - secN) / Math.min(++nN, 200);
        else secR += (sp.sec - secR) / Math.min(++nR, 400);
      }
    }
    stat.minutes = (t - start) / 6e4;
    for (const c of cards) {
      const tr = truth.get(c.id);
      if (tr && tr.m) {
        stat.seen++;
        stat.known += retrievability(day + 1 - tr.last, tr.m.s, wTrue);
      }
    }
    days.push(stat);
    if (o.optimizeEvery && day > 0 && day % o.optimizeEvery === 0) {
      const r = optimize([...hist.values()], wEng, { iterations: 40, sample: 600 });
      if (r.adopted) wEng = r.w;
      optimizations.push({ day, adopted: r.adopted, reason: r.reason, ms: r.ms });
    }
  }
  const after = days.filter((d) => d.day >= 60);
  const sum = (k, arr = after) => arr.reduce((a, d) => a + d[k], 0);
  const studied = days.filter((d) => d.minutes > 0);
  const mins = studied.map((d) => d.minutes).sort((a, b) => a - b);
  const tgt = after.reduce((a, d) => a + d.target * d.ltReviews, 0) / Math.max(1, sum("ltReviews"));
  const firstMonths = days.filter((d) => d.day < 60);
  return {
    days,
    optimizations,
    wFinal: wEng,
    history: [...hist.values()],
    summary: {
      politique: policy,
      retentionVisee: +tgt.toFixed(3),
      retentionObservee: +(sum("ltSuccess") / Math.max(1, sum("ltReviews"))).toFixed(3),
      retentionPredite: +(sum("predicted") / Math.max(1, sum("ltReviews"))).toFixed(3),
      retentionObservee60PremiersJours: +(sum("ltSuccess", firstMonths) / Math.max(1, sum("ltReviews", firstMonths))).toFixed(3),
      minutesMoyennes: +(mins.reduce((a, b) => a + b, 0) / Math.max(1, mins.length)).toFixed(1),
      minutesP95: +(mins[Math.floor(mins.length * 0.95)] ?? 0).toFixed(1),
      minutesMax: +(mins[mins.length - 1] ?? 0).toFixed(1),
      retentionALHeure: +(sum("onTimeSuccess") / Math.max(1, sum("onTime"))).toFixed(3),
      partALHeure: +(sum("onTime") / Math.max(1, sum("ltReviews"))).toFixed(3),
      joursAvecRetard: days.filter((d) => d.backlog > 0).length,
      joursAuDessusBudget: studied.filter((d) => d.minutes > budget * 1.25).length,
      cartesVues: days[days.length - 1].seen,
      cartesSuesFin: Math.round(days[days.length - 1].known),
      revisionsTotales: days.reduce((a, d) => a + d.reviews, 0)
    }
  };
}
export {
  STUDENT_FAST_FORGETTER,
  simulate
};
