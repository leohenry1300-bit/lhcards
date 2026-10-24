/**
 * Optimiseur FSRS : ajuste les 21 paramètres à la mémoire de l'élève à partir de son historique.
 * Tourne en arrière-plan (Web Worker dans l'application), jamais pendant une révision.
 *
 * Méthode : minimisation de la perte logarithmique (entropie croisée entre R prédite et réussite observée)
 * par Adam avec gradient par différences finies, bornes de py-fsrs, régularisation vers les paramètres actuels.
 * Garde-fous :
 *  1. pas d'optimisation avant 400 révisions « à long terme » (au moins un jour d'écart) ;
 *  2. validation sur 20 % des cartes mises de côté : les nouveaux paramètres ne sont adoptés que s'ils
 *     prédisent mieux (perte au moins 0,1 % plus basse) ;
 *  3. les paramètres restent dans les bornes officielles.
 */
import { DEFAULT_W, W_MAX, W_MIN, nextMemory, retrievability, type Grade, type Memory } from './fsrs.ts';
import { hash01 } from './scheduler.ts';

/** Historique d'une carte : jours (entiers) et notes, dans l'ordre. */
export interface History { id: string; days: number[]; grades: Grade[] }

export interface OptResult {
    w: number[]; adopted: boolean; reason: string;
    lossBefore: number; lossAfter: number; reviews: number; ms: number;
}

const EPS = 1e-6;

/** Perte logarithmique moyenne d'un jeu de paramètres sur des historiques. */
export function logLoss(hist: History[], w: readonly number[]): { loss: number; n: number } {
    let sum = 0, n = 0;
    for (const h of hist) {
        let m: Memory | null = null;
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

export function countLongTerm(hist: History[]): number {
    let n = 0;
    for (const h of hist) for (let i = 1; i < h.days.length; i++) if (h.days[i] - h.days[i - 1] >= 1) n++;
    return n;
}

const clampW = (w: number[]) => w.map((v, i) => Math.min(W_MAX[i], Math.max(W_MIN[i], v)));

export function optimize(hist: History[], current: readonly number[] = DEFAULT_W, opts: { iterations?: number; minReviews?: number; sample?: number } = {}): OptResult {
    const t0 = Date.now();
    const total = countLongTerm(hist);
    const base = { w: [...current], adopted: false, lossBefore: 0, lossAfter: 0, reviews: total };
    if (total < (opts.minReviews ?? 400)) return { ...base, reason: `historique trop court (${total} révisions sur plusieurs jours, 400 nécessaires)`, ms: Date.now() - t0 };

    const train = hist.filter(h => hash01(h.id + 'split') >= 0.2), valid = hist.filter(h => hash01(h.id + 'split') < 0.2);
    // échantillon d'entraînement borné : l'optimisation reste sous ~2 s même avec 100 000 révisions
    const cap = opts.sample ?? 4000;
    const pick = train.length > cap ? train.filter(h => hash01(h.id + 's') < cap / train.length) : train;

    const lambda = 0.0003;   // régularisation : on ne s'éloigne des paramètres actuels que si les données le justifient
    const scale = current.map(v => Math.max(Math.abs(v), 0.05));
    const objective = (w: number[]) => {
        let reg = 0;
        for (let i = 0; i < w.length; i++) reg += ((w[i] - current[i]) / scale[i]) ** 2;
        return logLoss(pick, w).loss + lambda * reg;
    };

    let w = [...current];
    const m1 = new Array(w.length).fill(0), m2 = new Array(w.length).fill(0);
    const b1 = 0.9, b2 = 0.999, iters = opts.iterations ?? 60;
    for (let it = 1; it <= iters; it++) {
        const lr = 0.06 * (1 - 0.7 * it / iters);
        const grad = w.map((_, i) => {
            const h = scale[i] * 1e-3;
            const up = clampW(w.map((v, j) => (j === i ? v + h : v))), dn = clampW(w.map((v, j) => (j === i ? v - h : v)));
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
        w: adopted ? w : [...current], adopted, lossBefore: before, lossAfter: after, reviews: total, ms: Date.now() - t0,
        reason: adopted ? `meilleure prédiction sur les cartes de contrôle (perte ${before.toFixed(4)} → ${after.toFixed(4)})`
            : `pas d'amélioration nette sur les cartes de contrôle (${before.toFixed(4)} → ${after.toFixed(4)}) : paramètres conservés`
    };
}
