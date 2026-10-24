const X = require('./load')(), run = require('./student');
const W0 = [...X.FSRS_W0];
// a "real" student who is not the average one: remembers new cards less well at first, forgets faster after a lapse, gains stability faster
const truth = W0.slice(); truth[0] = 0.2; truth[1] = 0.7; truth[2] = 1.8; truth[3] = 8; truth[8] = 1.8; truth[11] = 1.4; truth[16] = 2.2;
const fmt = w => [0, 1, 2, 3, 8, 11, 16].map(i => `w${i}=${w[i].toFixed(2)}`).join(' ');
(async () => {
    for (const [label, nCards, days] of [['historique court', 60, 40], ['historique moyen', 300, 120], ['historique long', 800, 300]]) {
        const log = [];
        run({ opts: { scheduler: 'fsrs', gradIvl: 365, easyIvl: 365 }, nCards, days, newPerDay: 20, seed: 5, truthW: truth, log });
        const seqs = X.fsrsSequences(log), n = X.fsrsLoss(seqs, W0).n;
        const t = Date.now(); const r = await X.fsrsTrain(seqs, null); const ms = Date.now() - t;
        const L = w => { const l = X.fsrsLoss(seqs, w); return (l.sum / l.n).toFixed(4); };
        console.log(`\n${label} : ${log.length} réponses, ${n} révisions utilisables (minimum de l'appli : 150) · calcul ${ms} ms (Node, PC)`);
        console.log(`  perte validation : défaut ${r.before.toFixed(4)} → optimisé ${r.after.toFixed(4)} (n=${r.nVal}) · perte de TOUS les avis : défaut ${L(W0)}, optimisé ${L(r.w)}, vrais paramètres ${L(truth)}`);
        console.log(`  vrais  : ${fmt(truth)}\n  défaut : ${fmt(W0)}\n  trouvé : ${fmt(r.w)}`);
    }
})();
