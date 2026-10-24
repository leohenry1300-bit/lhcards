/* Version « un seul fichier » du prototype, publiable comme page Claude (aucun fichier annexe,
   aucun service worker) : tout le JavaScript et le CSS sont intégrés. Sortie : refonte/prototype-artefact.html */
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
const out = new URL('../../.artefact-build/', import.meta.url);
await build({
    root: new URL('..', import.meta.url).pathname, base: './', logLevel: 'warn', configFile: false, plugins: [svelte()],
    build: { outDir: out.pathname, emptyOutDir: true, target: 'safari16', modulePreload: false, rollupOptions: { output: { inlineDynamicImports: true } } }
});
const files = readdirSync(new URL('assets/', out));
const js = files.filter(f => f.endsWith('.js')).map(f => readFileSync(new URL('assets/' + f, out), 'utf8')).join('\n').replace(/<\/script/gi, '<\\/script');
const css = files.filter(f => f.endsWith('.css')).map(f => readFileSync(new URL('assets/' + f, out), 'utf8')).join('\n');
const html = readFileSync(new URL('index.html', out), 'utf8');
const headInline = html.match(/<script>try[\s\S]*?<\/script>/)[0];
const shell = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const page = `<title>Prototype LH Cards</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:wght@400;500;700&family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&display=swap">
${headInline}
<style>${shell}\n${css}</style>
<div id="app"></div>
<script type="module">${js}</script>
`;
writeFileSync(new URL('../../prototype-artefact.html', import.meta.url), page);
rmSync(out, { recursive: true, force: true });
console.log('prototype-artefact.html :', Math.round(page.length / 1024), 'Ko');
