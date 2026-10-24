const run = require('./student');
for (const gap of [30, 90, 365]) {
    const back = 120 + gap, r = run({ opts: { scheduler: 'fsrs' }, nCards: 1000, days: back + 30, seed: 3, skip: d => d >= 120 && d < back });
    const d = r.daily.slice(back, back + 14);
    console.log(`Absence ${gap} j : réponses les 14 jours du retour = ${d.join(' ')}  (avant l'absence ≈ ${Math.round(r.daily.slice(100, 120).reduce((a, b) => a + b, 0) / 20)}/jour)`);
}
