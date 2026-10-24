/**
 * Données de démonstration du prototype : la vraie bibliothèque de l'application (2 089 cartes),
 * avec 45 jours d'historique produits par le moteur et un élève virtuel (statistiques cohérentes).
 * Chargé à la demande (morceau séparé) : il ne pèse rien sur les démarrages suivants.
 */
import content from './content.json';
import type { Card, Deck, Goal } from './migrate.ts';
import { dayFns } from './migrate.ts';
import { review, newSched, type ReviewLog, type Ctx } from '../engine/scheduler.ts';
import { planDay, type QCard } from '../engine/queue.ts';
import { retrievability, DEFAULT_W, type Grade } from '../engine/fsrs.ts';

type Pack = { id: string; title: string; emoji: string; decks: { name: string; emoji: string; cards: (string | number)[][] }[] };

function rng(seed: number) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function buildSeed(now = Date.now(), target = 0) {
    const decks: Deck[] = [], cards: Card[] = [];
    let i = 0;
    for (const p of content as Pack[]) {
        decks.push({ id: p.id, name: p.title, emoji: p.emoji, parent: null, created: 0, mod: 0 });
        p.decks.forEach((d, k) => {
            const id = `${p.id}--${k}`;
            decks.push({ id, name: d.name, emoji: d.emoji, parent: p.id, created: 0, mod: 0 });
            for (const c of d.cards) {
                const cid = 'c' + (i++).toString(36).padStart(4, '0');
                const back = String(c[1]) + (c[2] ? `<p class="hint">${String(c[2])}</p>` : '');
                cards.push({ id: cid, noteId: 'n' + cid, deckId: id, ord: 0, front: String(c[0]), back, flag: 0, marked: false, suspended: false, buriedUntil: 0, sched: newSched(now), created: 0, mod: 0, origin: 'nouvelle' });
            }
        });
    }
    // charge de test : on complète jusqu'au volume réel de l'élève (≈ 3 700 cartes) en dupliquant
    for (let k = 0; cards.length < target; k++) {
        const s = cards[k];
        cards.push({ ...s, id: s.id + 'x' + k, noteId: s.noteId + 'x' + k, sched: newSched(now) });
    }

    // 45 jours d'historique : le moteur planifie, un élève virtuel répond (≈ 85-90 % de réussite)
    const fns = dayFns(4);
    const rand = rng(11), revlog: ReviewLog[] = [];
    const studied = new Set(['toeic-vocab', 'toeic-grammaire', 'but-tc-marketing', 'but-tc-vente', 'toeic-verbes', 'anglais-bases']);
    const q: QCard[] = cards.filter(c => studied.has(c.deckId.split('--')[0])).map(c => ({ id: c.id, deck: c.deckId, sched: c.sched }));
    const byId = new Map(cards.map(c => [c.id, c]));
    const today = fns.dayOf(now);
    for (let d = today - 45; d < today; d++) {
        if (rand() < 0.12) continue;   // quelques jours sans révision
        let t = fns.dayStart(d) + 14 * 3_600_000 + rand() * 6 * 3_600_000;
        const ctx: Ctx = { ...fns, w: DEFAULT_W, fuzz: true };
        const plan = planDay(q, { now: t, ctx, budgetMin: 15 + rand() * 10 });
        const queue = [...plan.order];
        for (let n = 0; n < queue.length && n < 400; n++) {
            const c = queue[n];
            let g: Grade;
            if (c.sched.phase === 'new') { const u = rand(); g = u < 0.3 ? 1 : u < 0.45 ? 2 : u < 0.9 ? 3 : 4; }
            else {
                const p = c.sched.phase === 'review' ? retrievability(d - fns.dayOf(c.sched.last!), c.sched.s) : 0.93;
                g = rand() < p ? (rand() < 0.12 ? 2 : rand() < 0.9 ? 3 : 4) : 1;
            }
            const ms = 4000 + rand() * 9000;
            const r = review(c.id, c.sched, g, t, ctx, ms);
            c.sched = r.next; revlog.push(r.log); t += ms;
            if (r.next.phase === 'learning' || r.next.phase === 'relearning') queue.push(c);
        }
    }
    for (const c of q) byId.get(c.id)!.sched = c.sched;

    const day = (n: number) => new Date(now + n * 86_400_000).toISOString().slice(0, 10);
    const goals: Goal[] = [
        { id: 'g-partiel', name: 'Partiel BUT TC (S5)', date: day(12), deckIds: ['but-tc-marketing', 'but-tc-vente', 'but-tc-gestion-droit'] },
        { id: 'g-toeic', name: 'TOEIC', date: day(41), deckIds: ['toeic-vocab', 'toeic-grammaire', 'toeic-verbes', 'toeic-expressions', 'toeic-faux-amis', 'anglais-bases'] }
    ];
    return { decks, cards, revlog, goals };
}
