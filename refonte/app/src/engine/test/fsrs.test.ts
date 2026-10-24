/* Tests du moteur. Lancer : node --experimental-strip-types --test src/engine/test/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_W, intervalFor, nextMemory, retrievability, type Grade, type Memory } from '../fsrs.ts';
import { review, preview, newSched, replay, fuzzRange, type Ctx, type Sched } from '../scheduler.ts';

const DAY = 86_400_000;
const ref = JSON.parse(readFileSync(new URL('./reference.json', import.meta.url), 'utf8'));
const utcCtx: Ctx = { dayOf: ms => Math.floor(ms / DAY), dayStart: d => d * DAY, fuzz: false };

test('paramètres par défaut identiques à py-fsrs 6.3.2', () => {
    assert.deepEqual([...DEFAULT_W], ref.parameters);
});

test('stabilité, difficulté et intervalle identiques à la référence (1 052 révisions)', () => {
    let n = 0, worst = 0;
    for (const c of ref.cases) {
        let m: Memory | null = null, last: number | null = null;
        for (const step of c.steps) {
            const t = Date.parse(step.t);
            const elapsed = last === null ? 0 : Math.floor((t - last) / DAY);   // py-fsrs : timedelta.days
            m = nextMemory(m, elapsed, step.rating as Grade);
            worst = Math.max(worst, Math.abs(m.s - step.s) / step.s, Math.abs(m.d - step.d));
            assert.ok(Math.abs(m.s - step.s) <= 1e-9 * Math.max(1, step.s), `S ${m.s} ≠ ${step.s}`);
            assert.ok(Math.abs(m.d - step.d) <= 1e-9, `D ${m.d} ≠ ${step.d}`);
            assert.equal(Math.min(36500, Math.max(1, Math.round(intervalFor(m.s, c.retention)))), step.ivl);
            last = t; n++;
        }
    }
    assert.equal(n, 1052);
    assert.ok(worst < 1e-9);
});

test('R vaut 0,9 quand t = S (définition de la stabilité)', () => {
    for (const s of [0.5, 3, 40, 900]) assert.ok(Math.abs(retrievability(s, s) - 0.9) < 1e-12);
});

test('une carte nouvelle ratée revient dans la séance, réussie revient dans des jours', () => {
    const now = Date.UTC(2026, 9, 1, 10);
    const raté = review('a', newSched(now), 1, now, utcCtx).next;
    assert.equal(raté.phase, 'learning');
    assert.equal(raté.due - now, 60_000);
    const bien = review('a', newSched(now), 3, now, utcCtx).next;
    assert.equal(bien.phase, 'review');
    assert.ok(bien.due >= utcCtx.dayStart(utcCtx.dayOf(now) + 1));
});

test('les boutons affichent toujours Difficile ≤ Bien < Facile', () => {
    const now = Date.UTC(2026, 9, 1, 10);
    let st: Sched = newSched(now);
    for (let i = 0; i < 300; i++) {
        const t = now + i * DAY * 3 + (i % 7) * 3_600_000 * 3, d = (ms: number) => utcCtx.dayOf(t + ms) - utcCtx.dayOf(t);
        const p = preview('c' + i, st, t, utcCtx);
        if (d(p[3]) >= 1) { assert.ok(d(p[2]) <= d(p[3])); assert.ok(d(p[4]) > d(p[3]), `facile ${d(p[4])} j > bien ${d(p[3])} j`); }
        st = review('c', st, ([3, 3, 2, 4, 1, 3] as Grade[])[i % 6], now + i * DAY * 3, utcCtx).next;
    }
});

test('flou : plage FSRS et tirage reproductible', () => {
    assert.deepEqual(fuzzRange(2, 36500), [2, 2]);
    assert.deepEqual(fuzzRange(10, 36500), [8, 12]);
    const now = Date.UTC(2026, 0, 1, 9);
    const st: Sched = { phase: 'review', s: 30, d: 5, due: now, last: now - 30 * DAY, reps: 5, lapses: 0 };
    const a = review('x', st, 3, now, { ...utcCtx, fuzz: true }).next.due;
    const b = review('x', st, 3, now, { ...utcCtx, fuzz: true }).next.due;
    assert.equal(a, b);
});

test('équilibrage : la carte va sur le jour le moins chargé de sa plage', () => {
    const now = Date.UTC(2026, 0, 1, 9), today = utcCtx.dayOf(now);
    const st: Sched = { phase: 'review', s: 30, d: 5, due: now, last: now - 30 * DAY, reps: 5, lapses: 0 };
    const ideal = Math.round(intervalFor(review('y', st, 3, now, utcCtx).log.s, 0.9));
    const [lo, hi] = fuzzRange(ideal, 36500);
    const light = lo + 1;
    const r = review('y', st, 3, now, { ...utcCtx, fuzz: true, load: d => (d === today + light ? 0 : 50) });
    assert.equal(r.log.ivl, light);
    assert.ok(light <= hi);
});

test("examen : une carte qui ne tiendrait pas jusqu'à l'examen est revue avant", () => {
    const now = Date.UTC(2026, 0, 1, 9), today = utcCtx.dayOf(now);
    const st: Sched = { phase: 'review', s: 20, d: 5, due: now, last: now - 20 * DAY, reps: 4, lapses: 0 };
    const sans = review('z', st, 3, now, utcCtx).log.ivl;
    const exam = { day: today + Math.floor(sans * 0.8), target: 0.95 };
    const avec = review('z', st, 3, now, { ...utcCtx, exam }).log.ivl;
    assert.ok(avec < exam.day - today, `${avec} doit être avant J-${exam.day - today}`);
});

test("rejouer l'historique redonne exactement le même état (migration)", () => {
    const t0 = Date.UTC(2026, 0, 1, 9);
    let st = newSched(t0); const logs: { t: number; g: Grade }[] = [];
    let t = t0;
    for (const g of [3, 3, 1, 3, 4, 2, 3] as Grade[]) { logs.push({ t, g }); st = review('m', st, g, t, utcCtx).next; t = Math.max(t + 60_000, st.due); }
    const again = replay('m', logs, utcCtx);
    assert.deepEqual(again, st);
});
