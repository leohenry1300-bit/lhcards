/**
 * Sensation : sons doux synthétisés (aucun fichier à charger) + vibration quand l'appareil la permet.
 * iOS Safari n'expose pas l'API Vibration : sur iPhone le retour est sonore et visuel uniquement.
 * Les sons respectent le réglage « sons » et ne jouent jamais en mouvement réduit + mode silencieux implicite.
 */
let ctx: AudioContext | null = null;
let enabled = true;
export const setSound = (on: boolean) => { enabled = on; };

function ac() {
    if (!ctx) { const C = window.AudioContext || (window as any).webkitAudioContext; if (!C) return null; ctx = new C(); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
}
/** une note courte avec enveloppe douce (attaque 8 ms, extinction exponentielle) */
function tone(freq: number, dur = 0.12, gain = 0.05, type: OscillatorType = 'sine', when = 0) {
    const a = ac(); if (!a) return;
    const t = a.currentTime + when, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
const vibrate = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* pas de vibration */ } };

export const feel = {
    flip() { if (enabled) tone(520, 0.07, 0.025, 'triangle'); vibrate(6); },
    grade(g: 1 | 2 | 3 | 4) {
        if (enabled) { if (g === 1) tone(220, 0.14, 0.04, 'sine'); else { tone([0, 392, 523, 587, 659][g], 0.1, 0.035); if (g >= 3) tone([0, 0, 0, 784, 880][g], 0.12, 0.025, 'sine', 0.06); } }
        vibrate(g === 1 ? [10, 40, 10] : 8);
    },
    done() { if (enabled) [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 0.03, 'sine', i * 0.09)); vibrate([12, 60, 12]); },
    tap() { vibrate(4); }
};
