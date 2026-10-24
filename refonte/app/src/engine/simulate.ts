/**
 * Banc de simulation : un élève virtuel révise pendant N jours avec le moteur.
 * L'élève a sa « vraie » mémoire (paramètres wTrue, inconnus du moteur) ; le moteur part des paramètres
 * par défaut et s'optimise sur l'historique produit. On mesure la rétention obtenue face à la rétention
 * visée, et la charge quotidienne.
 *
 * Deux politiques de file sont comparables :
 *  - 'auto'   : la file de la refonte (budget de temps, nouvelles adaptatives, pas d'avalanche) ;
 *  - 'fixe'   : comme l'application actuelle (20 nouvelles/jour, toutes les échues, sans plafond).
 */
import { DEFAULT_W, nextMemory, retrievability, type Grade, type Memory } from './fsrs.ts';
import { review, newSched, type Ctx, type Sched } from './scheduler.ts';
import { planDay, targetRetention, calibrationOffset, type QCard } from './queue.ts';
import { optimize, type History } from './optimizer.ts';

export interface SimOptions {
    cards?: number; days?: number; budgetMin?: number; seed?: number;
    wTrue?: readonly number[]; wStart?: readonly number[];
    optimizeEvery?: number;               // 0 = jamais
    absence?: [number, number];           // jours sans réviser (inclus)
    examDay?: number | null;              // examen portant sur toutes les cartes
    policy?: 'auto' | 'fixe';
    calibrate?: boolean;                 // boucle de calibration (défaut : oui pour la politique auto)
    fixedNew?: number;
}

export interface DayStat {
    day: number; reviews: number; news: number; minutes: number;
    ltReviews: number; ltSuccess: number; predicted: number;   // révisions à long terme, réussites, R prédite cumulée
    onTime: number; onTimeSuccess: number;                     // dont révisions faites le jour prévu (sans retard)
    target: number; backlog: number; seen: number; known: number;
}
export interface SimResult {
    days: DayStat[];
    optimizations: { day: number; adopted: boolean; reason: string; ms: number }[];
    summary: Record<string, number | string>;
    wFinal: number[];
    history: History[];
}

const DAY = 86_400_000;
const ctxBase: Pick<Ctx, 'dayOf' | 'dayStart'> = { dayOf: ms => Math.floor(ms / DAY), dayStart: d => d * DAY };

/** Générateur pseudo-aléatoire reproductible (mulberry32). */
function rng(seed: number) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Un élève qui oublie plus vite que l'utilisateur moyen d'Anki : le moteur doit s'en rendre compte seul. */
export const STUDENT_FAST_FORGETTER: readonly number[] = DEFAULT_W.map((v, i) => (i <= 3 ? v * 0.55 : i === 8 ? v - 0.3 : i === 20 ? 0.2 : v));

export function simulate(o: SimOptions = {}): SimResult {
    const N = o.cards ?? 1000, D = o.days ?? 365, budget = o.budgetMin ?? 20, policy = o.policy ?? 'auto';
    const wTrue = o.wTrue ?? DEFAULT_W;
    let wEng = [...(o.wStart ?? DEFAULT_W)];
    const rand = rng(o.seed ?? 1);
    const cards: QCard[] = Array.from({ length: N }, (_, i) => ({ id: 'k' + String(i).padStart(5, '0'), deck: 'd', sched: newSched(0) }));
    const truth = new Map<string, { m: Memory | null; last: number }>();
    const hist = new Map<string, History>();
    const load = new Map<number, number>();
    const days: DayStat[] = [];
    const optimizations: SimResult['optimizations'] = [];
    let secR = 9, secN = 25, nR = 0, nN = 0;   // durées moyennes mesurées (moyennes glissantes), étapes du jour comprises

    const moveLoad = (from: Sched | null, to: Sched) => {
        if (from && from.phase === 'review') { const k = ctxBase.dayOf(from.due); load.set(k, (load.get(k) ?? 1) - 1); }
        if (to.phase === 'review') { const k = ctxBase.dayOf(to.due); load.set(k, (load.get(k) ?? 0) + 1); }
    };

    for (let day = 0; day < D; day++) {
        const stat: DayStat = { day, reviews: 0, news: 0, minutes: 0, ltReviews: 0, ltSuccess: 0, predicted: 0, onTime: 0, onTimeSuccess: 0, target: 0.9, backlog: 0, seen: 0, known: 0 };
        const daysToExam = o.examDay != null ? o.examDay - day : null;
        const recent = days.slice(-60);
        const offset = (o.calibrate ?? policy === 'auto') ? calibrationOffset(recent.reduce((a, d) => a + d.predicted, 0), recent.reduce((a, d) => a + d.ltSuccess, 0), recent.reduce((a, d) => a + d.ltReviews, 0)) : 0;
        const target = Math.min(0.97, targetRetention(daysToExam) + offset);
        stat.target = targetRetention(daysToExam);   // la cible affichée reste la cible « officielle »
        const ctx: Ctx = {
            ...ctxBase, w: wEng, targetR: target, fuzz: true,
            load: policy === 'auto' ? (d => load.get(d) ?? 0) : undefined,
            exam: o.examDay != null && daysToExam! > 0 ? { day: o.examDay, target: 0.95 } : undefined
        };
        const absent = o.absence && day >= o.absence[0] && day <= o.absence[1];
        let t = day * DAY + 18 * 3_600_000;   // séance à 18 h
        const start = t;

        if (!absent) {
            let order: QCard[];
            if (policy === 'auto') {
                const plan = planDay(cards, { now: t, ctx, budgetMin: budget, secPerReview: secR, secPerNew: secN });
                order = plan.order; stat.backlog = plan.backlog;
            } else {
                const end = ctxBase.dayStart(day + 1);
                const due = cards.filter(c => c.sched.phase !== 'new' && c.sched.due < end).sort((a, b) => a.sched.due - b.sched.due);
                const fresh = cards.filter(c => c.sched.phase === 'new').slice(0, o.fixedNew ?? 20);
                order = [...due, ...fresh];
            }
            const pending: QCard[] = [];
            const spent = new Map<string, { sec: number; isNew: boolean }>();   // temps total passé sur chaque carte aujourd'hui
            const answer = (c: QCard) => {
                const tr = truth.get(c.id) ?? { m: null, last: day };
                const first = c.sched.phase === 'new';
                let g: Grade;
                if (first) {
                    const u = rand(); g = u < 0.35 ? 1 : u < 0.5 ? 2 : u < 0.9 ? 3 : 4;
                } else {
                    const elapsed = day - tr.last;
                    const lastMs = c.sched.last ?? t;
                    const p = elapsed >= 1 ? retrievability(elapsed, tr.m!.s, wTrue) : retrievability((t - lastMs) / DAY, tr.m!.s, wTrue);
                    const ok = rand() < p, u = rand();
                    g = !ok ? 1 : u < 0.12 ? 2 : u < 0.9 ? 3 : 4;
                    if (elapsed >= 1 && (c.sched.phase === 'review' || c.sched.phase === 'relearning')) {
                        stat.ltReviews++; if (ok) stat.ltSuccess++;
                        stat.predicted += retrievability(day - ctxBase.dayOf(lastMs), c.sched.s, wEng);
                        if (day <= ctxBase.dayOf(c.sched.due)) { stat.onTime++; if (ok) stat.onTimeSuccess++; }
                    }
                }
                tr.m = nextMemory(tr.m, first ? 0 : day - tr.last, g, wTrue); tr.last = day; truth.set(c.id, tr);
                const sec = first ? 18 + rand() * 14 : c.sched.phase === 'review' ? (g === 1 ? 12 : 7) + rand() * 4 : 6 + rand() * 3;
                const before = c.sched;
                const r = review(c.id, c.sched, g, t, ctx, sec * 1000);
                moveLoad(before, r.next); c.sched = r.next;
                const h = hist.get(c.id) ?? { id: c.id, days: [], grades: [] };
                h.days.push(day); h.grades.push(g); hist.set(c.id, h);
                if (first) stat.news++; else stat.reviews++;
                const sp = spent.get(c.id) ?? { sec: 0, isNew: first }; sp.sec += sec; spent.set(c.id, sp);
                t += sec * 1000;
                if (c.sched.phase === 'learning' || c.sched.phase === 'relearning') pending.push(c);
            };
            let guard = 0;
            for (const c of order) {
                for (let i = 0; i < pending.length; i++) if (pending[i].sched.due <= t) { answer(pending.splice(i, 1)[0]); i--; }
                answer(c);
            }
            while (pending.length && guard++ < 20000) {
                pending.sort((a, b) => a.sched.due - b.sched.due);
                const c = pending.shift()!; t = Math.max(t, c.sched.due); answer(c);
            }
            for (const sp of spent.values()) {
                if (sp.isNew) secN += (sp.sec - secN) / Math.min(++nN, 200);
                else secR += (sp.sec - secR) / Math.min(++nR, 400);
            }
        }
        stat.minutes = (t - start) / 60_000;
        for (const c of cards) {
            const tr = truth.get(c.id);
            if (tr && tr.m) { stat.seen++; stat.known += retrievability(day + 1 - tr.last, tr.m.s, wTrue); }
        }
        days.push(stat);

        if (o.optimizeEvery && day > 0 && day % o.optimizeEvery === 0) {
            const r = optimize([...hist.values()], wEng, { iterations: 40, sample: 600 });
            if (r.adopted) wEng = r.w;
            optimizations.push({ day, adopted: r.adopted, reason: r.reason, ms: r.ms });
        }
    }

    // synthèse : rétention observée (révisions à long terme) contre rétention visée, après les 60 premiers jours
    const after = days.filter(d => d.day >= 60);
    const sum = (k: keyof DayStat, arr = after) => arr.reduce((a, d) => a + (d[k] as number), 0);
    const studied = days.filter(d => d.minutes > 0);
    const mins = studied.map(d => d.minutes).sort((a, b) => a - b);
    const tgt = after.reduce((a, d) => a + d.target * d.ltReviews, 0) / Math.max(1, sum('ltReviews'));
    const firstMonths = days.filter(d => d.day < 60);
    return {
        days, optimizations, wFinal: wEng, history: [...hist.values()],
        summary: {
            politique: policy,
            retentionVisee: +tgt.toFixed(3),
            retentionObservee: +(sum('ltSuccess') / Math.max(1, sum('ltReviews'))).toFixed(3),
            retentionPredite: +(sum('predicted') / Math.max(1, sum('ltReviews'))).toFixed(3),
            retentionObservee60PremiersJours: +(sum('ltSuccess', firstMonths) / Math.max(1, sum('ltReviews', firstMonths))).toFixed(3),
            minutesMoyennes: +(mins.reduce((a, b) => a + b, 0) / Math.max(1, mins.length)).toFixed(1),
            minutesP95: +(mins[Math.floor(mins.length * 0.95)] ?? 0).toFixed(1),
            minutesMax: +(mins[mins.length - 1] ?? 0).toFixed(1),
            retentionALHeure: +(sum('onTimeSuccess') / Math.max(1, sum('onTime'))).toFixed(3),
            partALHeure: +(sum('onTime') / Math.max(1, sum('ltReviews'))).toFixed(3),
            joursAvecRetard: days.filter(d => d.backlog > 0).length,
            joursAuDessusBudget: studied.filter(d => d.minutes > budget * 1.25).length,
            cartesVues: days[days.length - 1].seen,
            cartesSuesFin: Math.round(days[days.length - 1].known),
            revisionsTotales: days.reduce((a, d) => a + d.reviews, 0)
        }
    };
}
