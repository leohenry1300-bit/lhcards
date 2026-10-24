/**
 * Stockage local : IndexedDB, une table par type d'objet, écritures unitaires et transactionnelles.
 * Une notation = 1 carte + 1 ligne d'historique dans UNE transaction (≈ 1 Ko), au lieu de re-sérialiser
 * tout l'état (≈ 4 Mo dans l'application actuelle). Si la transaction échoue, rien n'est écrit à moitié.
 * Migrations versionnées : chaque version ajoute ses tables/index dans `upgrade`, jamais de suppression de données.
 */
import type { Card, Deck, Goal } from './migrate.ts';
import type { ReviewLog } from '../engine/scheduler.ts';

const NAME = 'lhcards-v2';
const VERSION = 1;
type Store = 'cards' | 'decks' | 'revlog' | 'meta' | 'media' | 'goals';

let dbp: Promise<IDBDatabase> | null = null;

function upgrade(db: IDBDatabase, from: number) {
    if (from < 1) {
        db.createObjectStore('cards', { keyPath: 'id' }).createIndex('deck', 'deckId');
        db.createObjectStore('decks', { keyPath: 'id' });
        db.createObjectStore('revlog', { autoIncrement: true }).createIndex('card', 'card');
        db.createObjectStore('meta');
        db.createObjectStore('media');
        db.createObjectStore('goals', { keyPath: 'id' });
    }
    // if (from < 2) { … } : les versions suivantes s'ajoutent ici, testées par une migration rejouée en CI
}

export function open(): Promise<IDBDatabase> {
    return (dbp ??= new Promise((resolve, reject) => {
        // navigation privée, page intégrée ou stockage bloqué : on échoue vite pour basculer en mémoire
        const timer = setTimeout(() => reject(new Error('Stockage indisponible')), 2500);
        let req: IDBOpenDBRequest;
        try { req = indexedDB.open(NAME, VERSION); } catch (e) { clearTimeout(timer); reject(e); return; }
        req.onupgradeneeded = e => upgrade(req.result, e.oldVersion);
        req.onsuccess = () => { clearTimeout(timer); resolve(req.result); };
        req.onerror = () => { clearTimeout(timer); reject(req.error); };
        req.onblocked = () => { clearTimeout(timer); reject(new Error('Base bloquée par un autre onglet')); };
    }));
}

/** Repli en mémoire : l'appli reste utilisable, mais rien n'est gardé après fermeture (signalé à l'écran). */
export let memoryOnly = false;
const mem: Record<Store, Map<IDBValidKey, unknown>> = { cards: new Map(), decks: new Map(), revlog: new Map(), meta: new Map(), media: new Map(), goals: new Map() };
let memSeq = 1;
async function idb(): Promise<IDBDatabase | null> {
    if (memoryOnly) return null;
    try { return await open(); } catch { memoryOnly = true; return null; }
}

function done(tx: IDBTransaction): Promise<void> {
    return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}

export async function getAll<T>(store: Store): Promise<T[]> {
    const db = await idb(); if (!db) return [...mem[store].values()] as T[];
    return new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result as T[]); r.onerror = () => rej(r.error); });
}
export async function getMeta<T>(key: string): Promise<T | undefined> {
    const db = await idb(); if (!db) return mem.meta.get(key) as T;
    return new Promise((res, rej) => { const r = db.transaction('meta').objectStore('meta').get(key); r.onsuccess = () => res(r.result as T); r.onerror = () => rej(r.error); });
}
export async function setMeta(key: string, value: unknown): Promise<void> {
    const db = await idb(); if (!db) { mem.meta.set(key, value); return; }
    const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put(value, key); return done(tx);
}

/** Écriture d'une notation : atomique. Renvoie la clé de la ligne d'historique (pour « Annuler »). */
export async function saveReview(card: Card, log: ReviewLog): Promise<IDBValidKey> {
    const db = await idb(); if (!db) { const k = memSeq++; mem.cards.set(card.id, $snapshot(card)); mem.revlog.set(k, log); return k; }
    const tx = db.transaction(['cards', 'revlog'], 'readwrite');
    tx.objectStore('cards').put($snapshot(card));
    const r = tx.objectStore('revlog').add(log);
    await done(tx);
    return r.result;
}
export async function undoReview(card: Card, logKey: IDBValidKey): Promise<void> {
    const db = await idb(); if (!db) { mem.cards.set(card.id, $snapshot(card)); mem.revlog.delete(logKey); return; }
    const tx = db.transaction(['cards', 'revlog'], 'readwrite');
    tx.objectStore('cards').put($snapshot(card));
    tx.objectStore('revlog').delete(logKey);
    return done(tx);
}

export async function bulkPut(data: { cards?: Card[]; decks?: Deck[]; goals?: Goal[]; revlog?: ReviewLog[] }): Promise<void> {
    const db = await idb();
    if (!db) { data.cards?.forEach(c => mem.cards.set(c.id, c)); data.decks?.forEach(d => mem.decks.set(d.id, d)); data.goals?.forEach(g => mem.goals.set(g.id, g)); data.revlog?.forEach(l => mem.revlog.set(memSeq++, l)); return; }
    const tx = db.transaction(['cards', 'decks', 'goals', 'revlog'], 'readwrite');
    data.cards?.forEach(c => tx.objectStore('cards').put(c));
    data.decks?.forEach(d => tx.objectStore('decks').put(d));
    data.goals?.forEach(g => tx.objectStore('goals').put(g));
    data.revlog?.forEach(l => tx.objectStore('revlog').add(l));
    return done(tx);
}

export async function wipe(): Promise<void> {
    const db = await idb(); if (!db) { Object.values(mem).forEach(m => m.clear()); return; }
    const stores: Store[] = ['cards', 'decks', 'revlog', 'meta', 'media', 'goals'];
    const tx = db.transaction(stores, 'readwrite');
    stores.forEach(s => tx.objectStore(s).clear());
    return done(tx);
}

/** Demande au navigateur de ne jamais purger nos données (Safari peut sinon effacer après 7 jours sans visite d'un site non installé). */
export async function askPersistence(): Promise<boolean> {
    try { return (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.()) || false; } catch { return false; }
}

/** Les objets réactifs de Svelte sont des proxys : on enregistre une copie simple. */
function $snapshot<T>(o: T): T { return JSON.parse(JSON.stringify(o)); }
