/**
 * Planification d'une carte : transforme (état, note, maintenant) en nouvel état + ligne de journal.
 * Module pur : aucune horloge, aucun stockage, aucun hasard non reproductible (le « flou » est tiré
 * d'un hachage de l'identifiant de la carte), donc chaque cas est rejouable dans un test.
 */
import { type Grade, type Memory, DEFAULT_W, intervalFor, nextMemory, retrievability } from './fsrs.ts';

export type Phase = 'new' | 'learning' | 'review' | 'relearning';

export interface Sched {
    phase: Phase;
    s: number;           // stabilité (0 si nouvelle)
    d: number;           // difficulté (0 si nouvelle)
    due: number;         // échéance (ms)
    last: number | null; // dernière révision (ms)
    reps: number;
    lapses: number;
}

/** Une ligne du journal de révision : l'historique est la source de vérité (l'état se recalcule à partir de lui). */
export interface ReviewLog {
    card: string; t: number; g: Grade; phase: Phase;   // phase AVANT la révision
    elapsed: number; ivl: number; s: number; d: number; ms: number;
}

export interface Ctx {
    w?: readonly number[];
    /** rétention visée pour cette carte aujourd'hui (0,90 par défaut ; plus haute à l'approche d'un examen) */
    targetR?: number;
    maxIvl?: number;
    /** numéro du jour d'étude (changement de jour à 4 h du matin dans l'application) */
    dayOf: (ms: number) => number;
    /** début (ms) d'un jour d'étude */
    dayStart: (day: number) => number;
    /** jours écoulés entre deux instants, au sens du modèle (par défaut : différence de jours d'étude) */
    daysBetween?: (a: number, b: number) => number;
    fuzz?: boolean;
    /** charge déjà prévue un jour donné (nombre de cartes) : sert à lisser la charge */
    load?: (day: number) => number;
    /** poids par jour de semaine (0 = dimanche) : 1 = normal, 0,5 = jour léger. Jamais 0 : un jour n'est jamais interdit. */
    weekWeight?: (day: number) => number;
    /** examen : la carte doit être révisée avant ce jour si sa mémoire ne tient pas jusque-là */
    exam?: { day: number; target: number };
}

export const STEP_AGAIN_MIN = 1;      // « Raté » sur une carte en apprentissage : revoir dans la séance
export const STEP_HARD_MIN = 6;
export const RELEARN_MIN = 10;
export const MIN = 60_000;

export const newSched = (now: number): Sched => ({ phase: 'new', s: 0, d: 0, due: now, last: null, reps: 0, lapses: 0 });

/** Hachage FNV-1a → [0, 1) : « hasard » reproductible. */
export function hash01(str: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0) / 4294967296;
}

/** Plage de flou (identique à FSRS) : évite que des cartes apprises ensemble reviennent toujours ensemble. */
export function fuzzRange(ivl: number, maxIvl: number): [number, number] {
    if (ivl < 2.5) return [ivl, ivl];
    let delta = 1;
    for (const [start, end, f] of [[2.5, 7, 0.15], [7, 20, 0.1], [20, Infinity, 0.05]]) delta += f * Math.max(Math.min(ivl, end) - start, 0);
    const lo = Math.max(2, Math.round(ivl - delta)), hi = Math.min(Math.round(ivl + delta), maxIvl);
    return [Math.min(lo, hi), hi];
}

/**
 * Choisit le jour dans la plage de flou : jour le moins chargé (pondéré par le poids du jour de semaine),
 * départage par un tirage reproductible. C'est l'équilibrage de charge + « jours légers », toujours actif, sans réglage.
 */
function pickDay(ivl: number, today: number, seed: string, ctx: Ctx, maxIvl: number): number {
    if (ctx.fuzz === false) return ivl;
    const [lo, hi] = fuzzRange(ivl, maxIvl);
    if (lo === hi) return lo;
    if (!ctx.load && !ctx.weekWeight) return lo + Math.floor(hash01(seed) * (hi - lo + 1));
    let best = ivl, bestScore = Infinity;
    for (let k = lo; k <= hi; k++) {
        const load = ctx.load ? ctx.load(today + k) : 0;
        const ww = ctx.weekWeight ? ctx.weekWeight(today + k) : 1;
        // × k/ivl : à charge égale on préfère le jour le plus proche (sinon les jours lointains, toujours moins
        // chargés, allongeraient tous les intervalles et feraient baisser la rétention : mesuré au simulateur)
        const score = (load + 1) / ww * (k / ivl) + hash01(seed + k) * 0.5;   // le bruit départage les égalités
        if (score < bestScore) { bestScore = score; best = k; }
    }
    return best;
}

/** Intervalle en jours pour une mémoire donnée, avec les garde-fous d'examen. */
function intervalDays(m: Memory, today: number, seed: string, ctx: Ctx): number {
    const w = ctx.w ?? DEFAULT_W, maxIvl = ctx.maxIvl ?? 36500;
    const raw = intervalFor(m.s, ctx.targetR ?? 0.9, w);
    let ivl = Math.min(maxIvl, Math.max(1, Math.round(raw)));
    ivl = pickDay(ivl, today, seed, ctx, maxIvl);
    if (ctx.exam && ctx.exam.day > today && today + ivl >= ctx.exam.day) {
        const left = ctx.exam.day - today;
        // la mémoire tiendra-t-elle jusqu'à l'examen ? sinon on revoit la carte avant, réparti sur les derniers jours
        if (retrievability(left, m.s, w) < ctx.exam.target) {
            const spread = Math.max(1, Math.min(6, Math.floor(left / 3)));
            ivl = Math.max(1, left - 1 - Math.floor(hash01(seed + 'x') * spread));
        }
    }
    return ivl;
}

export function review(card: string, st: Sched, g: Grade, now: number, ctx: Ctx, ms = 0): { next: Sched; log: ReviewLog } {
    const w = ctx.w ?? DEFAULT_W;
    const today = ctx.dayOf(now);
    const elapsed = st.last === null ? 0 : (ctx.daysBetween ? ctx.daysBetween(st.last, now) : today - ctx.dayOf(st.last));
    const mem = st.phase === 'new' ? null : { s: st.s, d: st.d };
    const m = nextMemory(mem, elapsed, g, w);
    const next: Sched = { ...st, s: m.s, d: m.d, last: now, reps: st.reps + 1 };
    const seed = card + ':' + st.reps;
    let ivl = 0;

    const inSession = st.phase === 'new' || st.phase === 'learning';
    if (inSession && g === 1) { next.phase = 'learning'; next.due = now + STEP_AGAIN_MIN * MIN; }
    else if (inSession && g === 2 && st.phase === 'new') { next.phase = 'learning'; next.due = now + STEP_HARD_MIN * MIN; }
    else if (st.phase === 'review' && g === 1) { next.phase = 'relearning'; next.lapses++; next.due = now + RELEARN_MIN * MIN; }
    else if (st.phase === 'relearning' && g === 1) { next.due = now + RELEARN_MIN * MIN; }
    else {
        ivl = intervalDays(m, today, seed, ctx);
        next.phase = 'review';
        next.due = ctx.dayStart(today + ivl);
    }
    return { next, log: { card, t: now, g, phase: st.phase, elapsed, ivl, s: m.s, d: m.d, ms } };
}

/**
 * Aperçu des 4 boutons (texte affiché sous chaque bouton). Garantit Difficile ≤ Bien < Facile
 * pour que l'élève ne voie jamais une incohérence.
 */
export function preview(card: string, st: Sched, now: number, ctx: Ctx): Record<Grade, number> {
    const out = {} as Record<Grade, number>;
    for (const g of [1, 2, 3, 4] as Grade[]) out[g] = review(card, st, g, now, { ...ctx, load: undefined, weekWeight: undefined }).next.due - now;
    const day = 86_400_000;
    if (out[3] >= day && out[2] > out[3]) out[2] = out[3];
    if (out[4] >= day && out[4] <= out[3]) out[4] = out[3] + day;
    return out;
}

/** Probabilité de se souvenir maintenant (null pour une carte jamais vue). */
export function recallNow(st: Sched, now: number, ctx: Ctx): number | null {
    if (st.phase === 'new' || st.last === null) return null;
    const t = ctx.daysBetween ? ctx.daysBetween(st.last, now) : ctx.dayOf(now) - ctx.dayOf(st.last);
    return retrievability(t, st.s, ctx.w ?? DEFAULT_W);
}

/** Sangsue : carte oubliée trop souvent. Elle n'est pas suspendue en silence : on propose de la reformuler. */
export const isLeech = (st: Sched) => st.lapses >= 6;

/**
 * Recalcule l'état d'une carte à partir de son journal (migration, changement de paramètres) :
 * l'historique fait foi, l'état n'est qu'un cache.
 */
export function replay(card: string, logs: Pick<ReviewLog, 't' | 'g'>[], ctx: Ctx): Sched {
    let st = newSched(logs.length ? logs[0].t : 0);
    for (const l of logs) st = review(card, st, l.g, l.t, { ...ctx, fuzz: false, load: undefined, exam: undefined }).next;
    return st;
}
