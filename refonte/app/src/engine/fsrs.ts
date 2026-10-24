/**
 * FSRS-6 : modèle de mémoire (mathématiques pures, sans état, sans interface).
 * Formules identiques à l'implémentation officielle py-fsrs 6.3.2 (vérifié par test/fsrs.test.ts
 * sur 1 052 révisions de référence).
 *
 * Vocabulaire :
 *  - S (stabilité)   : nombre de jours pour que la probabilité de rappel tombe à 90 %.
 *  - D (difficulté)  : 1 (facile) … 10 (dure).
 *  - R (récupérabilité) : probabilité de se souvenir maintenant.
 *  - note : 1 = Raté, 2 = Difficile, 3 = Bien, 4 = Facile.
 */

export type Grade = 1 | 2 | 3 | 4;
export interface Memory { s: number; d: number }

/** Paramètres par défaut de FSRS-6 (21 valeurs, entraînées par les auteurs sur ≈ 10 000 utilisateurs d'Anki). */
export const DEFAULT_W: readonly number[] = Object.freeze([
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
    1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542
]);

/** Bornes de chaque paramètre (identiques à py-fsrs) : l'optimiseur ne sort jamais de cet intervalle. */
export const W_MIN: readonly number[] = [0.001, 0.001, 0.001, 0.001, 1, 0.001, 0.001, 0.001, 0, 0, 0.001, 0.001, 0.001, 0.001, 0, 0, 1, 0, 0, 0, 0.1];
export const W_MAX: readonly number[] = [100, 100, 100, 100, 10, 4, 4, 0.75, 4.5, 0.8, 3.5, 5, 0.25, 0.9, 4, 1, 6, 2, 2, 0.8, 0.8];

export const S_MIN = 0.001;
const D_MIN = 1, D_MAX = 10;

const clampD = (d: number) => Math.min(D_MAX, Math.max(D_MIN, d));
const clampS = (s: number) => Math.max(S_MIN, s);

/** Courbe d'oubli : R après `t` jours pour une stabilité `s` (forme puissance, décroissance w[20]). */
export function retrievability(t: number, s: number, w: readonly number[] = DEFAULT_W): number {
    const decay = -w[20], factor = Math.pow(0.9, 1 / decay) - 1;
    return Math.pow(1 + factor * Math.max(0, t) / s, decay);
}

/** Intervalle (en jours, non arrondi) qui fait tomber R à la rétention visée. */
export function intervalFor(s: number, targetR: number, w: readonly number[] = DEFAULT_W): number {
    const decay = -w[20], factor = Math.pow(0.9, 1 / decay) - 1;
    return (s / factor) * (Math.pow(targetR, 1 / decay) - 1);
}

export function initDifficulty(g: Grade, w: readonly number[] = DEFAULT_W, clamp = true): number {
    const d = w[4] - Math.exp(w[5] * (g - 1)) + 1;
    return clamp ? clampD(d) : d;
}

export function initMemory(g: Grade, w: readonly number[] = DEFAULT_W): Memory {
    return { s: clampS(w[g - 1]), d: initDifficulty(g, w) };
}

export function nextDifficulty(d: number, g: Grade, w: readonly number[] = DEFAULT_W): number {
    const delta = -w[6] * (g - 3);
    const damped = d + (10 - d) * delta / 9;
    return clampD(w[7] * initDifficulty(4, w, false) + (1 - w[7]) * damped);
}

function recallStability(s: number, d: number, r: number, g: Grade, w: readonly number[]): number {
    const hard = g === 2 ? w[15] : 1, easy = g === 4 ? w[16] : 1;
    return s * (1 + Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp((1 - r) * w[10]) - 1) * hard * easy);
}

function forgetStability(s: number, d: number, r: number, w: readonly number[]): number {
    const long = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]);
    return Math.min(long, s / Math.exp(w[17] * w[18]));
}

function shortTermStability(s: number, g: Grade, w: readonly number[]): number {
    let inc = Math.exp(w[17] * (g - 3 + w[18])) * Math.pow(s, -w[19]);
    if (g >= 2) inc = Math.max(inc, 1);
    return clampS(s * inc);
}

/**
 * Nouvel état de mémoire après une révision.
 * @param m   état avant la révision (null = carte jamais vue)
 * @param elapsedDays jours entiers écoulés depuis la révision précédente (0 = même jour → effet court terme)
 */
export function nextMemory(m: Memory | null, elapsedDays: number, g: Grade, w: readonly number[] = DEFAULT_W): Memory {
    if (!m) return initMemory(g, w);
    let s: number;
    if (elapsedDays < 1) s = shortTermStability(m.s, g, w);
    else {
        const r = retrievability(elapsedDays, m.s, w);
        s = clampS(g === 1 ? forgetStability(m.s, m.d, r, w) : recallStability(m.s, m.d, r, g, w));
    }
    return { s, d: nextDifficulty(m.d, g, w) };
}
