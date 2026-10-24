<script lang="ts">
    /**
     * Réglages : quatre réglages en tout. Tout le reste (intervalles, étapes, nouvelles cartes par jour,
     * rétention, paramètres FSRS, équilibrage) se règle seul à partir du temps quotidien et de l'historique.
     */
    import { app, type Ambiance } from '../state.svelte.ts';
    import { migrateLegacy, type MigrationReport } from '../data/migrate.ts';
    import * as db from '../data/db.ts';
    import Icon from '../ui/Icon.svelte';

    const ambiances: [Ambiance, string, string, string][] = [
        ['auto', 'Auto', '#f3f4f7', '#0f1116'], ['clair', 'Clair', '#f3f4f7', '#b85a0e'], ['sombre', 'Sombre', '#0f1116', '#f0954a'],
        ['oled', 'OLED', '#000000', '#f0954a'], ['savane', 'Savane', '#19130e', '#f2b33d'], ['encre', 'Encre', '#edf0f7', '#2c43c4']
    ];
    function setAmbiance(a: Ambiance) {
        const apply = () => { app.settings.ambiance = a; app.saveSettings(); };
        const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
        if (d.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) d.startViewTransition(apply); else apply();
    }
    let budgetLabel = $derived(app.settings.budgetMin);

    let report = $state<MigrationReport | null>(null), busy = $state(false), message = $state('');
    async function importLegacy(e: Event) {
        const f = (e.currentTarget as HTMLInputElement).files?.[0]; if (!f) return;
        busy = true; message = '';
        try {
            const m = migrateLegacy(JSON.parse(await f.text()));
            report = m.report;
            if (!m.report.ok) { message = 'Import arrêté : la vérification a trouvé un problème (détails ci-dessous). Tes données actuelles sont intactes.'; return; }
            await db.wipe();
            await db.bulkPut({ cards: m.cards, decks: m.decks, goals: m.goals, revlog: m.revlog });
            await db.setMeta('legacy', f.name);
            await app.load(); app.touch();
            message = `Import réussi : ${m.cards.length} cartes et ${m.revlog.length} révisions, vérifiées une par une.`;
        } catch (err) { message = 'Ce fichier n\'est pas une sauvegarde LH Cards lisible.'; }
        finally { busy = false; }
    }
    function exportAll() {
        const blob = new Blob([JSON.stringify({ format: 'lhcards', schema: 1, exportedAt: new Date().toISOString(), decks: app.decks, cards: app.cards, revlog: app.revlog, goals: app.goals, settings: app.settings })], { type: 'application/json' });
        const file = new File([blob], `lhcards-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
        // iPhone : feuille de partage → « Enregistrer dans Fichiers » (iCloud Drive). Ailleurs : téléchargement.
        const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
        if (nav.canShare?.({ files: [file] })) nav.share({ files: [file], title: 'Sauvegarde LH Cards' }).catch(() => {});
        else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
    }
</script>

<h1>Réglages</h1>

<section class="panel group">
    <div class="row col">
        <label for="budget"><b>Temps de révision par jour</b><span class="muted small">Le nombre de nouvelles cartes et la taille des séances s'adaptent à ce temps.</span></label>
        <div class="slider"><input id="budget" type="range" min="5" max="60" step="5" bind:value={app.settings.budgetMin} onchange={() => { app.saveSettings(); app.touch(); }} /><output class="tnum">{budgetLabel} min</output></div>
    </div>
    <div class="row col">
        <span><b>Apparence</b></span>
        <div class="swatches" role="radiogroup" aria-label="Apparence">
            {#each ambiances as [id, label, bg, ac]}
                <button role="radio" aria-checked={app.settings.ambiance === id} class="sw" onclick={() => setAmbiance(id)}>
                    <span class="chip" style="background:{bg}"><span style="background:{ac}"></span></span>{label}
                </button>
            {/each}
        </div>
    </div>
    <label class="row" for="sons"><span><b>Sons</b><span class="muted small">Petits sons doux en révision.</span></span>
        <input id="sons" type="checkbox" class="switch" bind:checked={app.settings.sons} onchange={() => app.saveSettings()} /></label>
</section>

<section class="panel group">
    <h2>Examens</h2>
    {#each app.exams() as e}<div class="row"><span><b>{e.name}</b><span class="muted small">{new Date(e.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</span></span><span class="tnum muted">J-{e.days}</span></div>{/each}
    <p class="muted small">Dans les 3 semaines avant un examen, ses cartes sont revues plus souvent, au bon moment, sans rien régler.</p>
</section>

<section class="panel group">
    <h2>Sauvegarde</h2>
    <button class="row act" onclick={exportAll}><span><b>Exporter mes données</b><span class="muted small">Sur iPhone : « Enregistrer dans Fichiers » (iCloud Drive).</span></span><Icon name="export" /></button>
    <label class="row act" for="legacy"><span><b>Importer depuis l'ancienne application</b><span class="muted small">Fichier « superanki-sauvegarde-….json ». Vérifié avant d'écrire quoi que ce soit.</span></span><Icon name="import" /></label>
    <input id="legacy" type="file" accept=".json,application/json" class="visually-hidden" onchange={importLegacy} disabled={busy} />
    {#if message}<p class="msg" role="status">{message}</p>{/if}
    {#if report}
        <table class="rep"><thead><tr><th></th><th>Ancienne</th><th>Nouvelle</th></tr></thead><tbody>
            {#each Object.keys(report.in) as k}<tr><th>{k}</th><td class="tnum">{report.in[k as keyof typeof report.in]}</td><td class="tnum">{report.out[k as keyof typeof report.out]}</td></tr>{/each}
        </tbody></table>
        {#if report.errors.length}<ul class="errs">{#each report.errors as e}<li>{e}</li>{/each}</ul>{/if}
    {/if}
</section>

<p class="muted small foot">Mémoire : FSRS-6, ajusté chaque mois sur ton historique ({app.revlog.length} révisions). Rétention visée : 90 %, 95 % la veille d'un examen.</p>

<style>
    h1 { font-size: var(--t-2xl); } h2 { font-size: var(--t-l); padding: var(--s4) var(--s5) 0; }
    .small { font-size: var(--t-s); }
    .group { display: grid; overflow: hidden; }
    .group > p { padding: 0 var(--s5) var(--s4); }
    .row { display: flex; align-items: center; justify-content: space-between; gap: var(--s4); padding: var(--s4) var(--s5); min-height: 64px; border-bottom: 1px solid var(--line); text-align: left; color: var(--fg); width: 100%; }
    .row:last-child { border-bottom: 0; }
    .row > span, .row > label { display: grid; gap: 2px; min-width: 0; }
    .row.col { flex-direction: column; align-items: stretch; }
    .act { cursor: pointer; }
    .act :global(svg) { color: var(--accent); flex: none; }
    .slider { display: flex; align-items: center; gap: var(--s3); }
    .slider input { flex: 1; accent-color: var(--accent); min-height: var(--tap); }
    output { min-width: 64px; text-align: right; font-weight: 700; }
    .swatches { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s2); }
    .sw { display: flex; align-items: center; gap: var(--s2); min-height: var(--tap); padding: 0 var(--s3); border-radius: var(--r-m); background: var(--surface-2); font-size: var(--t-s); font-weight: 600; }
    .sw[aria-checked='true'] { box-shadow: inset 0 0 0 2px var(--accent); }
    .chip { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; box-shadow: inset 0 0 0 1px var(--line); flex: none; }
    .chip span { width: 9px; height: 9px; border-radius: 50%; }
    .switch { appearance: none; width: 52px; height: 32px; border-radius: 99px; background: var(--surface-2); position: relative; flex: none; cursor: pointer; box-shadow: inset 0 0 0 1px var(--line); }
    .switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 26px; height: 26px; border-radius: 50%; background: var(--surface); box-shadow: var(--shadow); transition: transform var(--d-rapide) var(--e-ressort); }
    .switch:checked { background: var(--g3); }
    .switch:checked::after { transform: translateX(20px); }
    .msg { padding: var(--s3) var(--s5) !important; font-weight: 600; }
    .rep { margin: 0 var(--s5) var(--s4); border-collapse: collapse; font-size: var(--t-s); }
    .rep th, .rep td { padding: 4px 12px 4px 0; text-align: left; }
    .errs { color: var(--g1); font-size: var(--t-s); margin: 0 var(--s5) var(--s4); }
    .foot { text-align: center; padding: 0 var(--s4); }
    @media (max-width: 380px) { .swatches { grid-template-columns: repeat(2, 1fr); } }
</style>
