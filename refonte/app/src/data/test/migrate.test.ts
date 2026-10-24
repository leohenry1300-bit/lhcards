import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { migrateLegacy } from '../migrate.ts';

const sample = JSON.parse(readFileSync(new URL('./legacy-sample.json', import.meta.url), 'utf8'));

test('vraie sauvegarde de l\'appli actuelle (SM-2 + FSRS, 10 jours de révisions) : rien ne se perd', () => {
    const m = migrateLegacy(sample);
    assert.deepEqual(m.report.errors, []);
    assert.ok(m.report.ok);
    assert.equal(m.cards.length, sample.cards.length);
    assert.equal(m.revlog.length, sample.revlog.length);
    assert.ok(m.report.origins.historique > 0, 'les cartes avec historique complet sont recalculées par FSRS-6');
    // l'échéance de chaque carte est conservée à la milliseconde : la migration ne change pas le planning du jour
    for (const old of sample.cards) {
        const c = m.cards.find(x => x.id === old.id)!;
        if (old.state !== 'new') assert.equal(c.sched.due, old.due);
        assert.equal(c.suspended, !!old.suspended);
        assert.equal(c.front, old.front);
    }
});

test('migration idempotente et déterministe', () => {
    assert.deepEqual(migrateLegacy(sample, 1), migrateLegacy(sample, 1));
});

test('fichier abîmé : pas de plantage, rapport explicite', () => {
    const m = migrateLegacy({ cards: [{ id: 'a', deckId: 'x', front: 'q', back: 'r', state: 'review', due: 5, reps: 2, interval: 3, ease: 2.5 }], decks: [], revlog: [['oups']] });
    assert.equal(m.report.ok, false);
    assert.ok(m.report.errors.some(e => e.includes('sans paquet')));
    assert.equal(m.cards[0].origin, 'sm2');
});

test('sauvegarde complète réelle (si fournie par LEGACY_EXPORT)', { skip: !process.env.LEGACY_EXPORT || !existsSync(process.env.LEGACY_EXPORT) }, () => {
    const raw = JSON.parse(readFileSync(process.env.LEGACY_EXPORT!, 'utf8'));
    const m = migrateLegacy(raw);
    assert.deepEqual(m.report.errors, []);
    console.log(m.report);
});
