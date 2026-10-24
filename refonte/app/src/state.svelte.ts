/**
 * État de l'application. Une seule source : les tables d'IndexedDB, chargées en mémoire au démarrage.
 * Les grandes listes sont en `$state.raw` (pas de proxy par carte : 3 700 objets restent légers) ;
 * toute modification passe par une méthode qui écrit en base PUIS incrémente `version`, ce qui
 * recalcule les vues dérivées (file du jour, statistiques) une seule fois.
 */
import * as db from './data/db.ts';
import { dayFns, type Card, type Deck, type Goal } from './data/migrate.ts';
import { DEFAULT_W, retrievability } from './engine/fsrs.ts';
import { review, preview, type Ctx, type ReviewLog } from './engine/scheduler.ts';
import { planDay, targetRetention, knowledge, forecast, calibrationOffset, type QCard, type Plan } from './engine/queue.ts';
import type { Grade } from './engine/fsrs.ts';

export type Ambiance = 'auto' | 'clair' | 'sombre' | 'oled' | 'savane' | 'encre';
export interface Settings { ambiance: Ambiance; budgetMin: number; sons: boolean; w: number[] }

const DAY = 86_400_000;
const fns = dayFns(4);

class App {
    ready = $state(false);
    version = $state(0);
    cards = $state.raw<Card[]>([]);
    decks = $state.raw<Deck[]>([]);
    goals = $state.raw<Goal[]>([]);
    revlog = $state.raw<ReviewLog[]>([]);
    settings = $state<Settings>({ ambiance: 'auto', budgetMin: 20, sons: true, w: [...DEFAULT_W] });
    deckById = new Map<string, Deck>();

    async load() {
        const t0 = performance.now();
        const charge = Number(new URLSearchParams(location.search).get('charge')) || 0;
        let [cards, decks, goals, revlog, settings] = await Promise.all([
            db.getAll<Card>('cards'), db.getAll<Deck>('decks'), db.getAll<Goal>('goals'), db.getAll<ReviewLog>('revlog'), db.getMeta<Settings>('settings')
        ]);
        if (!cards.length || (charge && cards.length < charge)) {
            const { buildSeed } = await import('./data/seed.ts');   // morceau séparé, chargé une seule fois
            const seed = buildSeed(Date.now(), charge);
            await db.wipe();
            await db.bulkPut(seed);
            ({ cards, decks, goals, revlog } = seed);
        }
        if (settings) Object.assign(this.settings, settings);
        this.cards = cards; this.decks = decks; this.goals = goals; this.revlog = revlog;
        this.deckById = new Map(decks.map(d => [d.id, d]));
        this.ready = true;
        return performance.now() - t0;
    }

    touch() { this.version++; }
    async saveSettings() { await db.setMeta('settings', $state.snapshot(this.settings)); try { localStorage.setItem('lh-ambiance', this.settings.ambiance); } catch { /* navigation privée */ } }

    rootOf(deckId: string): Deck | undefined {
        let d = this.deckById.get(deckId), n = 0;
        while (d && d.parent && n++ < 10) d = this.deckById.get(d.parent);
        return d;
    }
    get today() { return fns.dayOf(Date.now()); }

    /** examens à venir (jours restants), du plus proche au plus lointain */
    exams(now = Date.now()) {
        return this.goals.map(g => ({ ...g, days: fns.dayOf(Date.parse(g.date + 'T12:00:00')) - fns.dayOf(now) }))
            .filter(g => g.days >= 0).sort((a, b) => a.days - b.days);
    }
    examFor(card: Card, now = Date.now()) {
        const root = this.rootOf(card.deckId)?.id;
        return this.exams(now).find(e => root && e.deckIds.includes(root));
    }

    /** rétention : cible + correction de calibration mesurée sur les 60 derniers jours */
    private _cal: { v: number; off: number } | null = null;
    calibration(now = Date.now()) {
        if (this._cal && this._cal.v === this.version) return this._cal.off;
        this._cal = { v: this.version, off: this.computeCalibration(now) };
        return this._cal.off;
    }
    private computeCalibration(now: number) {
        const from = now - 60 * DAY; let pred = 0, ok = 0, n = 0;
        for (const l of this.revlog) if (l.t >= from && l.elapsed >= 1 && l.phase !== 'new' && l.phase !== 'learning') { n++; if (l.g > 1) ok++; pred += 0.9; }
        return calibrationOffset(pred, ok, n);
    }
    ctxFor(card: Card | null, now = Date.now()): Ctx {
        const exam = card ? this.examFor(card, now) : undefined;
        return {
            ...fns, w: this.settings.w, fuzz: true,
            targetR: Math.min(0.97, targetRetention(exam ? exam.days : null) + this.calibration(now)),
            exam: exam ? { day: fns.dayOf(now) + exam.days, target: 0.95 } : undefined,
            load: d => this.loadMap().get(d) ?? 0
        };
    }
    private _load: { v: number; m: Map<number, number> } | null = null;
    loadMap() {
        if (this._load && this._load.v === this.version) return this._load.m;
        const m = new Map<number, number>();
        for (const c of this.cards) if (c.sched.phase === 'review') { const k = fns.dayOf(c.sched.due); m.set(k, (m.get(k) ?? 0) + 1); }
        this._load = { v: this.version, m };
        return m;
    }

    /** révisions faites aujourd'hui (le jour change à 4 h) */
    todayLog(now = Date.now()) { const t = fns.dayOf(now); return this.revlog.filter(l => fns.dayOf(l.t) === t); }

    /** file du jour (recalculée seulement quand `version` change) */
    plan = $derived.by((): Plan => {
        void this.version;
        const now = Date.now();
        const exams = this.exams(now);
        const qs: QCard[] = [];
        for (const c of this.cards) {
            if (c.suspended) continue;
            const root = this.rootOf(c.deckId)?.id;
            qs.push({ id: c.id, note: c.noteId, deck: c.deckId, sched: c.sched, exam: exams.some(e => e.days <= 21 && root && e.deckIds.includes(root)) });
        }
        const done = this.todayLog(now);
        const byId = new Map(this.cards.map(c => [c.id, c.noteId]));
        return planDay(qs, {
            now, ctx: this.ctxFor(null, now), budgetMin: this.settings.budgetMin,
            doneMin: done.reduce((a, l) => a + l.ms, 0) / 60_000, newDone: done.filter(l => l.phase === 'new').length,
            notesSeenToday: new Set(done.map(l => l.card).filter(id => byId.has(id)).map(id => byId.get(id)!))
        });
    });

    stats = $derived.by(() => {
        void this.version;
        const now = Date.now(), ctx = this.ctxFor(null, now);
        const qs = this.cards.map(c => ({ id: c.id, deck: c.deckId, sched: c.sched }));
        const k = knowledge(qs, now, ctx);
        const fc = forecast(qs, fns.dayOf(now), 14, ctx);
        // série : jours consécutifs avec au moins une révision (aujourd'hui compte s'il est commencé)
        const days = new Set(this.revlog.map(l => fns.dayOf(l.t)));
        let streak = 0; for (let d = fns.dayOf(now) - (days.has(fns.dayOf(now)) ? 0 : 1); days.has(d); d--) streak++;
        // rétention des 30 derniers jours, sur les révisions « à long terme »
        const from = now - 30 * DAY; let lt = 0, ok = 0;
        const perDay = new Map<number, { n: number; ms: number }>();
        for (const l of this.revlog) {
            if (l.t >= from && l.elapsed >= 1 && (l.phase === 'review' || l.phase === 'relearning')) { lt++; if (l.g > 1) ok++; }
            const dd = fns.dayOf(l.t), e = perDay.get(dd) ?? { n: 0, ms: 0 }; e.n++; e.ms += l.ms; perDay.set(dd, e);
        }
        const last30 = Array.from({ length: 30 }, (_, i) => { const d = fns.dayOf(now) - 29 + i; return { d, ...(perDay.get(d) ?? { n: 0, ms: 0 }) }; });
        return { ...k, forecast: fc, streak, retention30: lt ? ok / lt : null, reviews30: lt, last30, total: this.cards.length };
    });

    /** maîtrise d'un ensemble de paquets : probabilité moyenne de rappel sur toutes ses cartes (non vues = 0) */
    readiness(deckIds: string[], now = Date.now()) {
        const ctx = this.ctxFor(null, now); let sum = 0, n = 0;
        for (const c of this.cards) {
            const root = this.rootOf(c.deckId)?.id;
            if (!root || !deckIds.includes(root)) continue;
            n++;
            if (c.sched.phase !== 'new' && c.sched.last) sum += retrievability(fns.dayOf(now) - fns.dayOf(c.sched.last), c.sched.s, ctx.w);
        }
        return n ? sum / n : 0;
    }

    previewFor(card: Card, now = Date.now()) { return preview(card.id, card.sched, now, this.ctxFor(card, now)); }

    /** Noter une carte : calcul pur → écriture atomique → mise à jour de l'écran. Renvoie de quoi annuler. */
    async answer(card: Card, g: Grade, ms: number) {
        const now = Date.now();
        const prev = card.sched;
        const r = review(card.id, card.sched, g, now, this.ctxFor(card, now), Math.min(ms, 120_000));
        const updated: Card = { ...card, sched: r.next, mod: now };
        this.cards = this.cards.map(c => (c.id === card.id ? updated : c));
        this.revlog = [...this.revlog, r.log];
        this.touch();
        const key = await db.saveReview(updated, r.log);
        if (this.revlog.length === 1 || this.revlog.length % 50 === 0) db.askPersistence();
        return { card: updated, prev, key, log: r.log };
    }
    async undo(u: { card: Card; prev: Card['sched']; key: IDBValidKey; log: ReviewLog }) {
        const restored = { ...u.card, sched: u.prev };
        this.cards = this.cards.map(c => (c.id === u.card.id ? restored : c));
        this.revlog = this.revlog.filter(l => l !== u.log);
        this.touch();
        await db.undoReview(restored, u.key);
        return restored;
    }
    card(id: string) { return this.cards.find(c => c.id === id); }
}

export const app = new App();
export { fns };
