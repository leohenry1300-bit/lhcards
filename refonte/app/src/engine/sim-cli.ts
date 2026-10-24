/* Lance les scénarios du banc de simulation et écrit refonte/sim/resultats-simulation.json.
   Usage : npm run sim   (ou node --experimental-strip-types src/engine/sim-cli.ts) */
import { writeFileSync } from 'node:fs';
import { simulate, STUDENT_FAST_FORGETTER, type SimOptions } from './simulate.ts';
import { DEFAULT_W } from './fsrs.ts';

const scenarios: Record<string, SimOptions> = {
    'A. Refonte : élève « oublie vite », optimiseur, absence J150-163, examen J330': { wTrue: STUDENT_FAST_FORGETTER, optimizeEvery: 30, absence: [150, 163], examDay: 330 },
    'B. Même élève, sans optimiseur ni calibration': { wTrue: STUDENT_FAST_FORGETTER, optimizeEvery: 0, calibrate: false, absence: [150, 163], examDay: 330 },
    'C. File actuelle (20 nouvelles/jour, pas de plafond), même élève, sans optimiseur': { wTrue: STUDENT_FAST_FORGETTER, optimizeEvery: 0, absence: [150, 163], examDay: 330, policy: 'fixe' },
    'D. Refonte : élève « moyen » (paramètres exacts), sans absence ni examen': { wTrue: DEFAULT_W, optimizeEvery: 30 }
};
const out: Record<string, unknown> = {};
for (const [name, o] of Object.entries(scenarios)) {
    const t = Date.now();
    const r = simulate({ cards: 1000, days: 365, budgetMin: 20, seed: 7, ...o });
    console.log(`\n${name}  (${((Date.now() - t) / 1000).toFixed(1)} s)`);
    console.log(r.summary);
    if (r.optimizations.length) console.log('optimisations adoptées :', r.optimizations.filter(x => x.adopted).map(x => 'J' + x.day).join(' '), '| durée moyenne', Math.round(r.optimizations.reduce((a, x) => a + x.ms, 0) / r.optimizations.length), 'ms');
    out[name] = { summary: r.summary, optimizations: r.optimizations, days: r.days.map(d => [d.day, d.reviews, d.news, +d.minutes.toFixed(1), d.ltReviews, d.ltSuccess, +d.target.toFixed(3), d.backlog, Math.round(d.known)]) };
}
writeFileSync(new URL('../../../sim/resultats-simulation.json', import.meta.url), JSON.stringify({ colonnes: ['jour', 'revisions', 'nouvelles', 'minutes', 'revisionsLongTerme', 'reussites', 'retentionVisee', 'retard', 'cartesSues'], scenarios: out }));
