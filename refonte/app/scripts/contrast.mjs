/* Vérifie les contrastes WCAG 2.2 de chaque ambiance à partir de tokens.css. Usage : node scripts/contrast.mjs */
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const block = sel => { const i = css.indexOf(sel); const s = css.indexOf('{', i), e = css.indexOf('}', s); return css.slice(s + 1, e); };
const vars = txt => Object.fromEntries([...txt.matchAll(/--([\w-]+):\s*(#[0-9a-f]{3,6})/gi)].map(m => [m[1], m[2]]));
const base = vars(block(':root {'));
const themes = { clair: base, sombre: { ...base, ...vars(block(':root[data-theme="dark"]:not([data-ambiance])')) }, oled: { ...base, ...vars(block(':root[data-ambiance="oled"]')) }, savane: { ...base, ...vars(block(':root[data-ambiance="savane"]')) }, encre: { ...base, ...vars(block(':root[data-ambiance="encre"]')) } };
const lum = h => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pairs = [['fg', 'bg', 4.5], ['fg', 'surface', 4.5], ['muted', 'bg', 4.5], ['muted', 'surface', 4.5], ['on-accent', 'accent', 4.5], ['accent', 'surface', 4.5], ['g1', 'surface', 4.5], ['g2', 'surface', 4.5], ['g3', 'surface', 4.5], ['g4', 'surface', 4.5], ['muted', 'surface-2', 4.5]];
let fails = 0; const rows = [];
for (const [t, v] of Object.entries(themes)) for (const [a, b, min] of pairs) { const r = ratio(v[a], v[b]); if (r < min) fails++; rows.push(`${t.padEnd(7)} ${(a + ' / ' + b).padEnd(22)} ${r.toFixed(2).padStart(5)}:1 ${r >= min ? 'OK' : 'ÉCHEC (min ' + min + ')'}`); }
console.log(rows.join('\n')); console.log(fails ? `${fails} échec(s)` : 'Tous les contrastes passent WCAG AA (4,5:1 pour le texte).');
process.exitCode = fails ? 1 : 0;
