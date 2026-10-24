import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDay, targetRetention, calibrationOffset, newAllowance, type QCard } from '../queue.ts';
import { newSched, type Ctx } from '../scheduler.ts';
import { simulate, STUDENT_FAST_FORGETTER } from '../simulate.ts';
import { optimize, logLoss } from '../optimizer.ts';
import { DEFAULT_W } from '../fsrs.ts';

const DAY = 86_400_000;
const ctx: Ctx = { dayOf: ms => Math.floor(ms / DAY), dayStart: d => d * DAY };
const now = 100 * DAY + 18 * 3_600_000;
const due = (id: string, daysLate: number, s = 10, note?: string): QCard => ({ id, note, deck: 'd', sched: { phase: 'review', s, d: 5, due: (100 - daysLate) * DAY, last: (100 - daysLate - s) * DAY, reps: 3, lapses: 0 } });

test("pas d'avalanche : 600 cartes en retard → la séance reste dans le budget", () => {
    const cards = Array.from({ length: 600 }, (_, i) => due('c' + i, i % 20));
    const p = planDay(cards, { now, ctx, budgetMin: 20, secPerReview: 9 });
    assert.ok(p.minutes <= 21, `${p.minutes} min`);
    assert.equal(p.backlog, 600 - p.reviews.length);
    assert.equal(p.news.length, 0, 'pas de nouvelles cartes tant qu\'il reste du retard');
});

test('les cartes les plus menacées passent en premier', () => {
    const p = planDay([due('a', 0, 50), due('b', 30, 5), due('c', 2, 20)], { now, ctx, budgetMin: 20 });
    assert.equal(p.reviews[0].id, 'b');
});

test('une seule carte par note (cartes sœurs) le même jour', () => {
    const p = planDay([due('a', 1, 10, 'n1'), due('b', 1, 10, 'n1'), due('c', 1, 10, 'n2')], { now, ctx, budgetMin: 20 });
    assert.equal(p.reviews.length, 2);
});

test('nouvelles cartes : nombre adapté au temps libre', () => {
    assert.equal(newAllowance(20, 25, 0, 25, 9, 25), 0);           // déjà plus de 20 min prévues
    assert.ok(newAllowance(20, 0, 0, 25, 9, 25) >= 15);            // rien de prévu : on apprend
    assert.ok(newAllowance(10, 0, 0, 25, 9, 25) < newAllowance(30, 0, 0, 25, 9, 25));
    const fresh = Array.from({ length: 50 }, (_, i) => ({ id: 'n' + i, deck: 'd', sched: newSched(0) }));
    const p = planDay(fresh, { now, ctx, budgetMin: 20 });
    assert.ok(p.news.length > 0 && p.news.length <= 25);
});

test('rétention visée : 0,90, montant à 0,95 la veille de l\'examen', () => {
    assert.equal(targetRetention(null), 0.9);
    assert.equal(targetRetention(40), 0.9);
    assert.ok(Math.abs(targetRetention(0) - 0.95) < 1e-12);
    assert.ok(targetRetention(10) > 0.9 && targetRetention(10) < 0.95);
});

test('calibration bornée à ±3 points et inactive avec peu de données', () => {
    assert.equal(calibrationOffset(90, 80, 100), 0);
    assert.equal(calibrationOffset(900, 700, 1000), 0.03);
    assert.ok(Math.abs(calibrationOffset(900, 890, 1000) - 0.01) < 1e-12);
});

test("optimiseur : refuse un historique trop court, s'approche des vrais paramètres de l'élève", () => {
    assert.equal(optimize([{ id: 'x', days: [0, 1, 3], grades: [3, 3, 3] }]).adopted, false);
    const sim = simulate({ cards: 600, days: 120, seed: 3, wTrue: STUDENT_FAST_FORGETTER });
    const r = optimize(sim.history, DEFAULT_W, { iterations: 40, sample: 600 });
    const lossDefault = logLoss(sim.history, DEFAULT_W).loss, lossFit = logLoss(sim.history, r.w).loss, lossTrue = logLoss(sim.history, STUDENT_FAST_FORGETTER).loss;
    assert.ok(r.adopted, r.reason);
    assert.ok(lossFit < lossDefault, `${lossFit} < ${lossDefault}`);
    assert.ok(lossFit - lossTrue < (lossDefault - lossTrue) * 0.5, 'au moins la moitié de l\'écart rattrapé');
});

test('simulation (élève moyen, 1 an) : rétention à ± 2 points de la cible, budget tenu', () => {
    const r = simulate({ cards: 1000, days: 365, seed: 7, wTrue: DEFAULT_W }).summary;
    assert.ok(Math.abs((r.retentionObservee as number) - (r.retentionVisee as number)) <= 0.02, JSON.stringify(r));
    assert.ok((r.minutesP95 as number) <= 25);
});
