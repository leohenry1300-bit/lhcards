/* Médianes des 3 passages du banc → bench/medianes.json. Usage : node refonte/bench/medianes.js */
const fs = require('fs'), path = require('path');
const P = [1, 2, 3].map(i => JSON.parse(fs.readFileSync(path.join(__dirname, `resultats-passage-${i}.json`), 'utf8')));
const med = a => { a = [...a].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
const out = {};
for (const k of ['actuelle', 'prototype', 'prototype-3700']) {
    const xs = P.map(p => p[k]), o = {};
    o.poidsKo = xs[0].poidsDemarrageKo; o.premierDemarrage = med(xs.map(x => x.accueilInteractifMs_cpu4)); o.relance = med(xs.map(x => x.relanceMs_cpu4)); o.domAccueil = xs[0].domAccueil;
    o.onglets = {};
    for (const t of Object.keys(xs[0].onglets)) o.onglets[t] = { premier: med(xs.map(x => x.onglets[t].premier.ms)), retour: med(xs.map(x => x.onglets[t].retour.ms)), tacheMax: med(xs.map(x => x.onglets[t].premier.tacheLaPlusLongueMs)), dom: xs[0].onglets[t].premier.domEcran };
    const rv = xs.flatMap(x => (Array.isArray(x.revision) ? x.revision : []));
    o.flip = med(rv.map(r => r.flip)); o.note = med(rv.map(r => r.note)); o.tacheRevMed = med(rv.map(r => r.tacheLaPlusLongue)); o.tacheRevMax = Math.max(...rv.map(r => r.tacheLaPlusLongue)); o.domRevision = xs[0].domRevision;
    if (xs[0].enregistrementVolumeReel_cpu4) o.save = xs.flatMap(x => x.enregistrementVolumeReel_cpu4);
    out[k] = o;
}
fs.writeFileSync(path.join(__dirname, 'medianes.json'), JSON.stringify(out, null, 1));
for (const k of Object.keys(out)) { const o = out[k]; console.log(k, 'relance', o.relance, '1er', o.premierDemarrage, 'onglets', Object.values(o.onglets).map(v => v.premier + '/' + v.retour + '/' + v.tacheMax).join(' '), 'rev', o.flip, o.note, o.tacheRevMed, o.tacheRevMax); }
