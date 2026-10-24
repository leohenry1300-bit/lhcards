/**
 * Migration : sauvegarde JSON de l'application actuelle (format « version 6 ») → schéma de la refonte (v1).
 * Fonction pure : on lui donne le fichier exporté, elle rend les tables + un rapport d'intégrité.
 * Elle ne supprime jamais rien : l'ancien état reste stocké tel quel (clé `legacy`) jusqu'à ce que l'élève
 * ait utilisé la nouvelle version 30 jours sans retour arrière.
 */
import { type Sched, type Phase, type ReviewLog, replay, type Ctx } from '../engine/scheduler.ts';
import { type Grade, DEFAULT_W } from '../engine/fsrs.ts';

export const SCHEMA_VERSION = 1;

export interface Deck { id: string; name: string; emoji: string; parent: string | null; created: number; mod: number; examDate?: string }
export interface Note { id: string; type: 'basique' | 'inversee' | 'trous' | 'image' | 'perso'; fields: Record<string, string>; tags: string[]; created: number; mod: number }
export interface Card {
    id: string; noteId: string; deckId: string; ord: number;
    front: string; back: string;          // rendu figé (identique à l'ancienne appli)
    flag: number; marked: boolean; suspended: boolean; buriedUntil: number;
    sched: Sched; created: number; mod: number;
    origin: 'historique' | 'fsrs' | 'sm2' | 'nouvelle';   // d'où vient l'état de mémoire (traçabilité)
}
export interface Goal { id: string; name: string; date: string; deckIds: string[] }
export interface Migrated {
    schema: number; decks: Deck[]; notes: Note[]; cards: Card[]; revlog: ReviewLog[];
    media: Record<string, string>; goals: Goal[]; toeic: unknown; settings: { theme: string; budgetMin: number; rolloverHour: number };
    report: MigrationReport;
}
export interface MigrationReport {
    ok: boolean; errors: string[];
    in: { decks: number; cards: number; revlog: number; media: number; reps: number };
    out: { decks: number; cards: number; revlog: number; media: number; reps: number };
    origins: Record<Card['origin'], number>;
}

const DAY = 86_400_000;
const PHASE_OF_TYPE: Record<number, Phase> = { 0: 'learning', 1: 'review', 2: 'relearning' };
const THEMES_KEPT = new Set(['clair', 'sombre', 'oled', 'savane', 'ocean']);
const THEME_MAP: Record<string, string> = { auto: 'auto', clair: 'clair', light: 'clair', nuit: 'sombre', dark: 'sombre', oled: 'oled', ocean: 'ocean', sakura: 'savane', luxe: 'savane' };

function kindToType(k: string): Note['type'] {
    return ({ basic: 'basique', rev: 'inversee', cloze: 'trous', occl: 'image', custom: 'perso' } as const)[k as 'basic'] ?? 'basique';
}

/** Jours d'étude avec changement de jour à `rollover` h, dans le fuseau de l'appareil. */
export function dayFns(rolloverHour = 4, tzOffsetMin = new Date().getTimezoneOffset()): Pick<Ctx, 'dayOf' | 'dayStart'> {
    const shift = rolloverHour * 3_600_000 + tzOffsetMin * 60_000;   // heure locale = UTC − décalage
    return { dayOf: ms => Math.floor((ms - shift) / DAY), dayStart: d => d * DAY + shift };
}

export function migrateLegacy(raw: any, now = Date.now()): Migrated {
    const errors: string[] = [];
    const days = dayFns(raw?.settings?.rolloverHour ?? 4);
    const oldCards: any[] = Array.isArray(raw?.cards) ? raw.cards : [];
    const oldDecks: any[] = Array.isArray(raw?.decks) ? raw.decks : [];
    const oldLog: any[] = Array.isArray(raw?.revlog) ? raw.revlog : [];
    const media: Record<string, string> = raw?.media && typeof raw.media === 'object' ? { ...raw.media } : {};

    const decks: Deck[] = oldDecks.map(d => ({ id: String(d.id), name: String(d.name ?? 'Sans nom'), emoji: String(d.emoji ?? '📁'), parent: d.parent ? String(d.parent) : null, created: Number(d.created) || 0, mod: Number(d.mod) || 0 }));
    const goals: Goal[] = (Array.isArray(raw?.settings?.goals) ? raw.settings.goals : []).map((g: any) => ({ id: String(g.id), name: String(g.name ?? ''), date: String(g.date ?? ''), deckIds: Array.isArray(g.decks) ? g.decks.map(String) : [] }));
    if (raw?.settings?.goalName && raw?.settings?.goalDate && !goals.length) goals.push({ id: 'g_ancien', name: raw.settings.goalName, date: raw.settings.goalDate, deckIds: [] });

    // journal : chaque ligne est conservée ; on retrouve l'écart en jours avec la ligne précédente de la même carte
    const byCard = new Map<string, any[]>();
    for (const r of oldLog) { if (!Array.isArray(r) || !Number.isFinite(r[0])) { errors.push('ligne de journal illisible ignorée'); continue; } const k = String(r[1]); (byCard.get(k) ?? byCard.set(k, []).get(k)!).push(r); }
    const revlog: ReviewLog[] = [];
    for (const [card, rows] of byCard) {
        rows.sort((a, b) => a[0] - b[0]);
        rows.forEach((r, i) => {
            const prev = rows[i - 1];
            const elapsed = prev ? days.dayOf(r[0]) - days.dayOf(prev[0]) : Math.max(0, Math.round(Number(r[5]) || 0));
            revlog.push({ card, t: r[0], g: Math.min(4, Math.max(1, Number(r[2]) || 1)) as Grade, phase: PHASE_OF_TYPE[Number(r[3])] ?? 'review', elapsed, ivl: Number(r[4]) || 0, s: 0, d: 0, ms: Number(r[6]) || 0 });
        });
    }
    revlog.sort((a, b) => a.t - b.t);

    const notes = new Map<string, Note>();
    const origins: MigrationReport['origins'] = { historique: 0, fsrs: 0, sm2: 0, nouvelle: 0 };
    const cards: Card[] = oldCards.map(c => {
        const id = String(c.id), noteId = c.nid ? String(c.nid) : 'n_' + id;
        if (!notes.has(noteId)) {
            const nf = c.nf ?? {};
            const fields: Record<string, string> = c.kind === 'custom' && nf.f ? { ...nf.f } : c.kind === 'cloze' ? { texte: nf.text ?? c.front, extra: nf.extra ?? '' } : { recto: nf.front ?? c.front ?? '', verso: nf.back ?? c.back ?? '', indice: c.hint ?? '', detail: c.detail ?? '' };
            notes.set(noteId, { id: noteId, type: kindToType(c.kind), fields, tags: Array.isArray(c.tags) ? c.tags.map(String) : [], created: Number(c.created) || 0, mod: Number(c.mod) || 0 });
        }
        const phase: Phase = ['new', 'learning', 'review', 'relearning'].includes(c.state) ? c.state : 'new';
        const reps = Number(c.reps) || 0, lapses = Number(c.lapses) || 0;
        const last = c.lastReview ? Number(c.lastReview) : null;
        let sched: Sched, origin: Card['origin'];
        const logs = byCard.get(id) ?? [];
        if (phase === 'new') { sched = { phase, s: 0, d: 0, due: Number(c.due) || now, last: null, reps: 0, lapses: 0 }; origin = 'nouvelle'; }
        else if (logs.length && logs.length >= reps) {
            // historique complet : on recalcule la mémoire avec FSRS-6 en rejouant les notes ; l'échéance actuelle est gardée
            const st = replay(id, logs.map(r => ({ t: r[0], g: Math.min(4, Math.max(1, Number(r[2]) || 1)) as Grade })), { ...days, w: DEFAULT_W });
            sched = { ...st, phase, due: Number(c.due) || st.due, reps, lapses };
            origin = 'historique';
        } else if (c.fs && Number(c.fs.s) > 0) {
            sched = { phase, s: Number(c.fs.s), d: Math.min(10, Math.max(1, Number(c.fs.d) || 5)), due: Number(c.due) || now, last, reps, lapses };
            origin = 'fsrs';
        } else {
            // carte suivie en SM-2 sans historique complet : stabilité ≈ intervalle actuel, difficulté déduite de la facilité
            const ease = Number(c.ease) || 2.5;
            sched = { phase, s: Math.max(0.5, Number(c.interval) || 1), d: Math.min(10, Math.max(1, 10 - (ease - 1.3) * (5.5 / 1.2))), due: Number(c.due) || now, last, reps, lapses };
            origin = 'sm2';
        }
        origins[origin]++;
        return {
            id, noteId, deckId: String(c.deckId), ord: Number(c.ord) || 0, front: String(c.front ?? ''), back: String(c.back ?? ''),
            flag: Number(c.flag) || 0, marked: !!c.marked, suspended: !!c.suspended, buriedUntil: Number(c.buriedUntil) || 0,
            sched, created: Number(c.created) || 0, mod: Number(c.mod) || 0, origin
        };
    });

    const s = raw?.settings ?? {};
    const theme = THEME_MAP[s.theme] ?? 'auto';
    const settings = { theme: THEMES_KEPT.has(theme) || theme === 'auto' ? theme : 'auto', budgetMin: 20, rolloverHour: Number(s.rolloverHour ?? 4) };

    // ---- vérifications d'intégrité : tout ce qui entre doit ressortir ----
    const sumReps = (arr: any[], f: (x: any) => number) => arr.reduce((a, x) => a + f(x), 0);
    const report: MigrationReport = {
        ok: true, errors,
        in: { decks: oldDecks.length, cards: oldCards.length, revlog: oldLog.length, media: Object.keys(raw?.media ?? {}).length, reps: sumReps(oldCards, c => Number(c.reps) || 0) },
        out: { decks: decks.length, cards: cards.length, revlog: revlog.length, media: Object.keys(media).length, reps: sumReps(cards, c => c.sched.reps) },
        origins
    };
    for (const k of Object.keys(report.in) as (keyof MigrationReport['in'])[]) if (report.in[k] !== report.out[k]) errors.push(`${k} : ${report.in[k]} en entrée, ${report.out[k]} en sortie`);
    const ids = new Set(cards.map(c => c.id));
    if (ids.size !== cards.length) errors.push('identifiants de cartes en double');
    const deckIds = new Set(decks.map(d => d.id));
    for (const c of cards) if (!deckIds.has(c.deckId)) { errors.push(`carte ${c.id} sans paquet`); break; }
    for (const c of oldCards) {
        const n = cards.find(x => x.id === String(c.id));
        if (n && c.state !== 'new' && Number(c.due) && n.sched.due !== Number(c.due)) { errors.push(`échéance modifiée pour ${c.id}`); break; }
    }
    report.ok = errors.length === 0 || errors.every(e => e.startsWith('ligne de journal'));
    return { schema: SCHEMA_VERSION, decks, notes: [...notes.values()], cards, revlog, media, goals, toeic: raw?.toeic ?? null, settings, report };
}
