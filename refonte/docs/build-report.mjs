/* Assemble le rapport : docs/*.md + tableau de mesures (bench/medianes.json) →
   refonte/RAPPORT.md (GitHub) et refonte/rapport.html (page autonome) + refonte/rapport-artefact.html (fragment publiable).
   Usage : node refonte/docs/build-report.mjs */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../app/package.json', import.meta.url));
const { marked } = require('marked');
const R = new URL('../', import.meta.url);
const m = JSON.parse(readFileSync(new URL('bench/medianes.json', R), 'utf8'));
const A = m.actuelle, P = m.prototype, P3 = m['prototype-3700'];
const ms = v => `${v} ms`;
const rows = [
    ['Poids transféré au 1er démarrage', `${A.poidsKo} Ko`, `${P.poidsKo} Ko (dont 193 Ko de démo, une seule fois)`, `${P3.poidsKo} Ko`],
    ['Poids d\'une relance (fichiers de l\'appli)', `${A.poidsKo} Ko`, '≈ 105 Ko', '≈ 105 Ko'],
    ['1er démarrage → accueil utilisable', ms(A.premierDemarrage), ms(P.premierDemarrage) + ' (création de la démo comprise)', ms(P3.premierDemarrage)],
    ['**Relance → accueil utilisable**', ms(A.relance), '**' + ms(P.relance) + '**', '**' + ms(P3.relance) + '**'],
    ['Éléments DOM à l\'accueil (page entière)', A.domAccueil, P.domAccueil, P3.domAccueil],
    ...[['decks', 'paquets', 'Paquets'], ['stats', 'progres', 'Statistiques / Progrès'], ['settings', 'reglages', 'Réglages'], ['toeic', 'toeic', 'TOEIC'], ['dashboard', 'accueil', 'Accueil']].map(([a, p, n]) => [
        `Onglet ${n} : 1er affichage · retour · tâche max · DOM de l'écran`,
        `${A.onglets[a].premier} · ${A.onglets[a].retour} · ${A.onglets[a].tacheMax} ms · ${A.onglets[a].dom}`,
        `${P.onglets[p].premier} · ${P.onglets[p].retour} · ${P.onglets[p].tacheMax} ms · ${P.onglets[p].dom}`,
        `${P3.onglets[p].premier} · ${P3.onglets[p].retour} · ${P3.onglets[p].tacheMax} ms · ${P3.onglets[p].dom}`]),
    ['Révision : retourner · noter (médiane, toucher → 2ᵉ image)', `${A.flip} · ${A.note} ms`, `${P.flip} · ${P.note} ms`, `${P3.flip} · ${P3.note} ms`],
    ['Révision : tâche la plus longue (médiane · max sur 15 notes)', `${A.tacheRevMed} · ${A.tacheRevMax} ms`, `${P.tacheRevMed} · ${P.tacheRevMax} ms`, `${P3.tacheRevMed} · ${P3.tacheRevMax} ms`],
    ['Éléments DOM pendant la révision', A.domRevision, P.domRevision, P3.domRevision]
];
const ser = A.save.map(x => x.serialisation).sort((a, b) => a - b), idb = A.save.map(x => x.ecritureIDB).sort((a, b) => a - b);
const table = `| Mesure | Actuelle (1 427 cartes) | Prototype (2 089 cartes) | Prototype (3 700 cartes) |\n|---|---|---|---|\n` + rows.map(r => `| ${r.join(' | ')} |`).join('\n') +
    `\n\n**Coût d'un enregistrement dans l'appli actuelle à volume réel** (3 700 cartes, 40 000 lignes d'historique, CPU ×4, 15 mesures) : état de ${A.save[0].Ko} Ko re-sérialisé en ${ser[0]}-${ser[14]} ms (médiane ${ser[7]} ms) sur le fil principal, puis écrit en ${idb[0]}-${idb[14]} ms (médiane ${idb[7]} ms). Dans le prototype, une note écrit 1 carte + 1 ligne d'historique (≈ 1 Ko) dans une transaction.\n\n` +
    `Résultats bruts : \`refonte/bench/resultats-passage-{1,2,3}.json\`, médianes : \`refonte/bench/medianes.json\`. Les temps absolus dépendent de la machine ; ce sont les **rapports** entre les deux applis, mesurées dans les mêmes conditions, qui comptent.`;
const md = readdirSync(new URL('docs/', R)).filter(f => /^\d\d-.*\.md$/.test(f)).sort().map(f => readFileSync(new URL('docs/' + f, R), 'utf8')).join('\n\n---\n\n').replace('{{MESURES}}', table);
writeFileSync(new URL('RAPPORT.md', R), md);

const shots = [['Accueil (prototype, clair)', 'prototype-accueil-390.png'], ['Accueil (prototype, sombre)', 'prototype-accueil-390-sombre.png'], ['Révision : réponse', 'prototype-revision-reponse-390.png'], ['Fin de séance', 'prototype-fin-de-seance-390.png'],
    ['Paquets', 'prototype-paquets-390.png'], ['Réglages', 'prototype-reglages-390.png'], ['Accueil actuel', 'actuelle-accueil-390.png'], ['Révision actuelle', 'actuelle-revision-390.png']];
const gallery = `<section class="gallery" aria-label="Captures"><h2 id="captures">Captures (390 × 800)</h2><div class="shots">${shots.map(([t, f]) => `<figure><img src="captures/${f}" alt="${t}" loading="lazy" width="390" height="800"><figcaption>${t}</figcaption></figure>`).join('')}</div></section>`;
const body = marked.parse(md).replace('<h2>3.1 Vision et principes</h2>', gallery + '<h2>3.1 Vision et principes</h2>').replace(/<table>/g, '<div class="tw"><table>').replace(/<\/table>/g, '</table></div>');
const css = readFileSync(new URL('docs/report.css', R), 'utf8');
const head = `<title>Refonte LH Cards</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:ital,wght@0,400;0,700;1,400&family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&display=swap">\n<style>${css}</style>`;
const nav = `<nav class="links" aria-label="Prototypes"><a class="cta" href="https://claude.ai/artifact/MbYcxQVkexzSk7mbeFP7xJ" target="_blank" rel="noopener">Ouvrir le prototype jouable</a><a href="sim/index.html">Ouvrir le simulateur</a></nav>`;
const page = `${head}\n<main class="doc">${nav}${body}</main>`;
writeFileSync(new URL('rapport-artefact.html', R), page);
writeFileSync(new URL('rapport.html', R), `<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n</head>\n<body>\n<main class="doc">${nav}${body}</main>\n</body>\n</html>\n`);
console.log('rapport écrit :', Math.round(md.length / 1024), 'Ko de texte');
