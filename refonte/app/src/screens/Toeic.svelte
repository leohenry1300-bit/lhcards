<script lang="ts">
    /**
     * TOEIC (aperçu de structure) : la banque de 755 questions et ses 1,1 Mo de photos restent un morceau séparé,
     * téléchargé à la première ouverture d'un test, jamais au démarrage. Ici : l'écran d'entrée et le plan d'examen.
     */
    import { app } from '../state.svelte.ts';
    import Icon from '../ui/Icon.svelte';
    const exam = $derived(app.exams().find(e => /toeic/i.test(e.name)));
    const ready = $derived(exam ? app.readiness(exam.deckIds) : 0);
    const parts = [['1', 'Photos', 6], ['2', 'Questions-réponses', 25], ['3', 'Conversations', 39], ['4', 'Exposés', 30], ['5', 'Phrases à compléter', 30], ['6', 'Textes à compléter', 16], ['7', 'Lecture', 54]] as const;
</script>

<h1>TOEIC</h1>
<section class="panel hero">
    <div><p class="eyebrow">{exam ? `Examen dans ${exam.days} jours` : 'Pas de date d\'examen'}</p>
        <p class="score tnum">≈ 735 <span class="muted">/ 990</span></p>
        <p class="muted small">Exemple de démonstration : score estimé d'après un test blanc. Vocabulaire et grammaire : {Math.round(ready * 100)} % retenus.</p></div>
</section>
<div class="choices">
    <button class="panel choice"><Icon name="horloge" /><span><b>Mini-test · 20 min</b><span class="muted small">Un peu de chaque partie</span></span><Icon name="chevron" /></button>
    <button class="panel choice"><Icon name="cible" /><span><b>Test complet · 2 h</b><span class="muted small">Conditions d'examen, audio joué une fois</span></span><Icon name="chevron" /></button>
    <button class="panel choice"><Icon name="annuler" /><span><b>Refaire mes erreurs</b><span class="muted small">Les questions ratées, mélangées</span></span><Icon name="chevron" /></button>
</div>
<section class="panel parts" aria-labelledby="t-parts">
    <h2 id="t-parts">Par partie</h2>
    <ul>{#each parts as [n, name, q]}<li><span class="num">{n}</span><span>{name}</span><span class="muted small tnum">{q} q.</span></li>{/each}</ul>
</section>

<style>
    h1 { font-size: var(--t-2xl); } h2 { font-size: var(--t-l); margin-bottom: var(--s3); }
    .small { font-size: var(--t-s); }
    .hero { padding: var(--s5); }
    .score { font: 800 2.8rem/1.1 var(--font-display); margin: 4px 0; }
    .score span { font-size: 1.2rem; font-weight: 500; }
    .choices { display: grid; gap: var(--s3); }
    .choice { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--s3); padding: var(--s4); text-align: left; color: var(--fg); min-height: 68px; }
    .choice > :global(svg:first-child) { color: var(--accent); }
    .choice > span { display: grid; gap: 2px; }
    .parts { padding: var(--s5); }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
    li { display: grid; grid-template-columns: 32px 1fr auto; align-items: center; gap: var(--s3); min-height: 44px; border-bottom: 1px solid var(--line); }
    li:last-child { border-bottom: 0; }
    .num { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--surface-2); font-weight: 700; font-size: var(--t-s); }
</style>
