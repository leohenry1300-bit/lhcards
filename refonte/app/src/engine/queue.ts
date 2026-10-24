/**
 * File du jour : quelles cartes, dans quel ordre, combien de nouvelles.
 * Aucun réglage : tout se déduit d'un seul nombre, le temps que l'élève veut y passer (20 min par défaut),
 * et de son propre historique (durée moyenne d'une carte).
 */
import { type Sched, recallNow, type Ctx } from './scheduler.ts';
import { retrievability } from './fsrs.ts';

export interface QCard { id: string; note?: string; deck: string; sched: Sched; exam?: boolean }

export interface DayContext {
    now: number;
    ctx: Ctx;
    /** minutes par jour que l'élève accepte (seul « réglage », demandé une fois à l'accueil) */
    budgetMin: number;
    /** durées mesurées sur l'historique (secondes) ; valeurs de départ raisonnables */
    secPerReview?: number;
    secPerNew?: number;
    /** déjà fait aujourd'hui */
    doneMin?: number;
    newDone?: number;
    /** notes déjà vues aujourd'hui (pour ne pas montrer deux cartes sœurs le même jour) */
    notesSeenToday?: Set<string>;
    /** plafond de sécurité */
    maxNew?: number;
}

export interface Plan {
    learning: QCard[];    // en cours d'apprentissage, échues maintenant
    reviews: QCard[];     // révisions échues, triées
    news: QCard[];        // nouvelles admises aujourd'hui
    order: QCard[];       // ordre de présentation final (mélangé)
    minutes: number;      // estimation du temps
    backlog: number;      // échues mais repoussées (au-delà du budget)
    newAllowance: number;
}

/** Révisions qu'une nouvelle carte demande dans ses deux premières semaines (≈ 3, mesuré au simulateur) :
 *  on leur réserve de la place dès aujourd'hui, sinon la charge déborde 2 à 3 semaines plus tard. */
const REVIEWS_RESERVED_PER_NEW = 3.5;

/**
 * Nombre de nouvelles cartes admises : on garde de la place pour les révisions que ces cartes vont créer.
 * `forecastMin` = minutes de révisions déjà prévues en moyenne sur les 7 prochains jours.
 */
export function newAllowance(budgetMin: number, forecastMin: number, todayMin: number, secPerNew: number, secPerReview: number, maxNew: number): number {
    const free = Math.min(budgetMin - todayMin, budgetMin - forecastMin) * 60;
    if (free <= 0) return 0;
    const cost = secPerNew + REVIEWS_RESERVED_PER_NEW * secPerReview;   // coût du jour + révisions qu'elle créera dans les 2 semaines
    return Math.max(0, Math.min(maxNew, Math.floor(free / cost)));
}

/** Prévision : nombre de cartes échues chaque jour des `days` prochains jours. */
export function forecast(cards: QCard[], fromDay: number, days: number, ctx: Ctx): number[] {
    const out = new Array(days).fill(0);
    for (const c of cards) {
        if (c.sched.phase === 'new') continue;
        const k = ctx.dayOf(c.sched.due) - fromDay;
        if (k < days) out[Math.max(0, k)]++;
    }
    return out;
}

/** Mélange les nouvelles parmi les révisions (une nouvelle toutes les ~4 révisions) : rythme varié, pas de « mur » de nouveautés. */
function interleave(reviews: QCard[], news: QCard[]): QCard[] {
    if (!news.length) return reviews.slice();
    if (!reviews.length) return news.slice();
    const out: QCard[] = [], every = Math.max(1, Math.round(reviews.length / (news.length + 1)));
    let n = 0;
    reviews.forEach((r, i) => { out.push(r); if ((i + 1) % every === 0 && n < news.length) out.push(news[n++]); });
    while (n < news.length) out.push(news[n++]);
    return out;
}

export function planDay(cards: QCard[], dc: DayContext): Plan {
    const { now, ctx } = dc;
    const secR = dc.secPerReview ?? 9, secN = dc.secPerNew ?? 25, maxNew = dc.maxNew ?? 25;
    const today = ctx.dayOf(now), endOfToday = ctx.dayStart(today + 1);
    const seen = new Set(dc.notesSeenToday ?? []);
    const learning: QCard[] = [], due: QCard[] = [], fresh: QCard[] = [];
    for (const c of cards) {
        const p = c.sched.phase;
        if (p === 'learning' || p === 'relearning') { if (c.sched.due < endOfToday) learning.push(c); }
        else if (p === 'review') { if (c.sched.due < endOfToday) due.push(c); }
        else fresh.push(c);
    }
    learning.sort((a, b) => a.sched.due - b.sched.due);

    // révisions : la plus menacée d'oubli d'abord (R le plus bas), puis une seule carte par note
    const rOf = new Map<string, number>();
    for (const c of due) rOf.set(c.id, recallNow(c.sched, now, ctx) ?? 1);
    due.sort((a, b) => (rOf.get(a.id)! - rOf.get(b.id)!) || (a.id < b.id ? -1 : 1));
    const budgetSec = Math.max(0, (dc.budgetMin - (dc.doneMin ?? 0)) * 60) - learning.length * secR * 0.6;
    const reviews: QCard[] = [];
    let used = 0;
    for (const c of due) {
        if (c.note && seen.has(c.note)) continue;
        if (used + secR > budgetSec && reviews.length >= 10) break;   // au-delà du budget, le reste attend (jamais d'avalanche)
        reviews.push(c); used += secR;
        if (c.note) seen.add(c.note);
    }
    const backlog = due.length - reviews.length;

    // nouvelles : seulement s'il n'y a pas de retard, et dans la limite de ce que le budget pourra absorber
    const fc = forecast(cards, today + 1, 7, ctx);
    const forecastMin = fc.reduce((a, b) => a + b, 0) / 7 * secR / 60;
    const allow = backlog > 0 ? 0 : newAllowance(dc.budgetMin, forecastMin, (dc.doneMin ?? 0) + used / 60, secN, secR, maxNew - (dc.newDone ?? 0));
    const news: QCard[] = [];
    fresh.sort((a, b) => (Number(!!b.exam) - Number(!!a.exam)) || (a.id < b.id ? -1 : 1));   // cartes d'examen d'abord
    for (const c of fresh) {
        if (news.length >= allow) break;
        if (c.note && seen.has(c.note)) continue;
        news.push(c); if (c.note) seen.add(c.note);
    }
    const order = [...learning.filter(c => c.sched.due <= now), ...interleave(reviews, news)];
    const minutes = Math.round((learning.length * secR + reviews.length * secR + news.length * secN) / 60);
    return { learning, reviews, news, order, minutes, backlog, newAllowance: allow };
}

/**
 * Rétention visée : 0,90 toute l'année ; dans les 21 derniers jours avant un examen, elle monte
 * progressivement jusqu'à 0,95 pour les cartes de l'examen (plus de révisions, mais au bon moment).
 */
export function targetRetention(daysToExam: number | null, base = 0.9, peak = 0.95): number {
    if (daysToExam === null || daysToExam < 0 || daysToExam > 21) return base;
    return base + (peak - base) * (1 - daysToExam / 21);
}

/** Probabilité moyenne de se souvenir de l'ensemble des cartes vues : « ce que tu sais aujourd'hui ». */
export function knowledge(cards: QCard[], now: number, ctx: Ctx): { known: number; seen: number; avgR: number } {
    let sum = 0, seen = 0;
    for (const c of cards) {
        const r = recallNow(c.sched, now, ctx);
        if (r === null) continue;
        seen++; sum += r;
    }
    return { known: Math.round(sum), seen, avgR: seen ? sum / seen : 0 };
}

export { retrievability };

/**
 * Calibration en boucle fermée : si, sur les ~60 derniers jours, l'élève réussit moins souvent que le modèle
 * ne le prédit (modèle encore imparfait entre deux optimisations), on relève la cible d'autant, et inversement.
 * Correction bornée à ±3 points et seulement avec au moins 300 révisions : jamais d'emballement.
 */
export function calibrationOffset(predicted: number, observed: number, n: number): number {
    if (n < 300) return 0;
    return Math.max(-0.03, Math.min(0.03, (predicted - observed) / n));
}
