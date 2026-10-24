/* Compile la bibliothèque de l'application actuelle (content/*.txt) en JSON pour le prototype.
   Même format que build.py : « question ;; réponse ;; indice » ou « C: texte {{c1::trou}} ;; infos ». */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const dir = new URL('../../../content/', import.meta.url);
const packs = [];
for (const f of readdirSync(dir).filter(f => f.endsWith('.txt')).sort()) {
    const pack = { id: f.replace('.txt', ''), title: '', emoji: '📁', decks: [] };
    let deck = null;
    for (const line of readFileSync(new URL(f, dir), 'utf8').split('\n')) {
        const l = line.trim();
        if (l.startsWith('@pack')) { const p = l.slice(5).split('|').map(s => s.trim()); pack.title = p[1]; pack.emoji = p[2] || '📁'; }
        else if (l.startsWith('## ')) { const p = l.slice(3).split('|').map(s => s.trim()); deck = { name: p[0], emoji: p[1] || pack.emoji, cards: [] }; pack.decks.push(deck); }
        else if (l.includes(';;')) {
            if (!deck) { deck = { name: pack.title, emoji: pack.emoji, cards: [] }; pack.decks.push(deck); }
            const p = l.split(';;').map(s => s.trim());
            if (p[0].startsWith('C:')) { const text = p[0].slice(2).trim(); deck.cards.push([text.replace(/\{\{c\d+::(.*?)(::.*?)?\}\}/g, '[…]'), text.replace(/\{\{c\d+::(.*?)(::.*?)?\}\}/g, '$1'), p[1] || '', 1]); }
            else deck.cards.push([p[0], p[1] || '', p[2] || '']);
        }
    }
    packs.push(pack);
}
writeFileSync(new URL('../src/data/content.json', import.meta.url), JSON.stringify(packs));
console.log(packs.length, 'paquets,', packs.reduce((n, p) => n + p.decks.reduce((m, d) => m + d.cards.length, 0), 0), 'cartes');
