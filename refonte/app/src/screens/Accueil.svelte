<script lang="ts">
    import { app, fns } from '../state.svelte.ts';
    import Icon from '../ui/Icon.svelte';
    import Leo from '../ui/Leo.svelte';
    type Tab = 'accueil' | 'paquets' | 'toeic' | 'progres' | 'reglages';
    let { onReview, onGo }: { onReview: (scope?: string | null, five?: boolean) => void; onGo: (t: Tab) => void } = $props();

    const h = new Date().getHours();
    const hello = h < 5 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
    const plan = $derived(app.plan);
    const stats = $derived(app.stats);
    const todo = $derived(plan.learning.length + plan.reviews.length + plan.news.length);
    const exams = $derived(app.exams().slice(0, 2).map(e => ({ ...e, ready: app.readiness(e.deckIds) })));
    const week = $derived.by(() => {
        const names = ['D', 'L', 'M', 'M', 'J', 'V', 'S'], t = fns.dayOf(Date.now());
        const fc = stats.forecast.slice(0, 7); fc[0] = todo;
        const max = Math.max(1, ...fc);
        return fc.map((n, i) => ({ n, h: n / max, label: i === 0 ? 'Auj.' : names[new Date(fns.dayStart(t + i) + 43_200_000).getDay()] }));
    });
    const firstVisit = (() => { try { const k = 'lh-hello-' + fns.dayOf(Date.now()); const seen = sessionStorage.getItem(k) || localStorage.getItem(k); localStorage.setItem(k, '1'); return !seen; } catch { return false; } })();
    const fr = (n: number) => n.toLocaleString('fr-FR');
</script>

<header class="top">
    <div>
        <p class="eyebrow">{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1>{hello}</h1>
    </div>
    <span class="streak" class:on={stats.streak > 0} aria-label="Série : {stats.streak} jours"><Icon name="flamme" size={18} /> <b class="tnum">{stats.streak}</b> j</span>
</header>

<article class="today panel" aria-labelledby="t-today">
    {#if todo > 0}
        <div class="today-main">
            <p class="eyebrow" id="t-today">Aujourd'hui</p>
            <p class="big tnum"><b>{todo}</b> cartes</p>
            <p class="detail">
                ≈ {Math.max(1, plan.minutes)} min · {plan.reviews.length + plan.learning.length} à revoir{plan.news.length ? `, ${plan.news.length} nouvelles` : ''}
            </p>
            {#if plan.backlog > 0}<p class="note">{plan.backlog} cartes en retard attendront demain : ta séance reste à {app.settings.budgetMin} min.</p>{/if}
            <div class="actions">
                <button class="btn btn-primary go" data-action="reviser" onclick={() => onReview(null)}><Icon name="jouer" size={20} /> Réviser</button>
                <button class="btn btn-soft" onclick={() => onReview(null, true)}><Icon name="eclair" size={18} /> 5 min</button>
            </div>
        </div>
        <div class="leo"><Leo pose={firstVisit ? 'salut' : 'repos'} size={104} /></div>
    {:else}
        <div class="today-main">
            <p class="eyebrow" id="t-today">Aujourd'hui</p>
            <p class="big">C'est fait.</p>
            <p class="detail">Demain : {stats.forecast[1] ?? 0} cartes. Ta mémoire travaille pendant que tu te reposes.</p>
            <div class="actions"><button class="btn btn-soft" data-action="reviser" onclick={() => onGo('paquets')}>Apprendre autre chose</button></div>
        </div>
        <div class="leo"><Leo pose="fier" size={104} /></div>
    {/if}
</article>

{#if exams.length}
<section aria-labelledby="t-exams" class="block">
    <h2 id="t-exams" class="h2">Examens</h2>
    <ul class="exams">
        {#each exams as e}
            <li class="exam panel">
                <div class="exam-head"><b>{e.name}</b><span class="days tnum" class:soon={e.days <= 14}>J-{e.days}</span></div>
                <div class="bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(e.ready * 100)} aria-label="Préparation {e.name}">
                    <span style="transform: scaleX({e.ready})"></span>
                </div>
                <p class="small muted">Tu te souviens de <b class="tnum">{Math.round(e.ready * 100)} %</b> du programme aujourd'hui{e.days <= 21 ? ' · révisions renforcées jusqu\'au jour J' : ''}.</p>
            </li>
        {/each}
    </ul>
</section>
{/if}

<section class="block" aria-labelledby="t-week">
    <h2 id="t-week" class="h2">Les 7 prochains jours</h2>
    <div class="week panel">
        {#each week as d, i}
            <div class="day" class:is-today={i === 0}>
                <span class="n tnum">{d.n}</span>
                <span class="col"><span style="transform: scaleY({Math.max(.04, d.h)})"></span></span>
                <span class="lbl">{d.label}</span>
            </div>
        {/each}
    </div>
</section>

<button class="known panel" onclick={() => onGo('progres')}>
    <span><span class="eyebrow">Ce que tu sais</span><span class="kn"><b class="tnum">{fr(stats.known)}</b> cartes sur {fr(stats.total)}</span></span>
    <Icon name="chevron" />
</button>

<style>
    .top { display: flex; align-items: end; justify-content: space-between; gap: var(--s4); }
    h1 { font-size: var(--t-2xl); }
    .streak { display: inline-flex; align-items: center; gap: 4px; padding: 8px 12px; border-radius: var(--r-pill); background: var(--surface-2); color: var(--muted); font-weight: 600; }
    .streak.on { color: var(--accent); background: var(--accent-soft); }
    .today { position: relative; display: grid; grid-template-columns: 1fr auto; gap: var(--s4); padding: var(--s5); overflow: hidden; }
    .today-main { display: grid; gap: var(--s2); min-width: 0; }
    .big { font: 500 var(--t-xl)/1.1 var(--font-display); }
    .big b { font-size: 3.4rem; font-weight: 800; letter-spacing: -.03em; margin-right: 6px; }
    .detail { color: var(--muted); }
    .note { font-size: var(--t-s); color: var(--muted); border-left: 3px solid var(--accent); padding-left: 10px; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--s2); margin-top: var(--s3); }
    .go { min-width: 148px; }
    .leo { align-self: end; margin: 0 -8px -12px 0; }
    .h2 { font-size: var(--t-l); margin-bottom: var(--s3); }
    .exams { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--s3); }
    .exam { padding: var(--s4); display: grid; gap: var(--s2); }
    .exam-head { display: flex; justify-content: space-between; gap: var(--s3); align-items: baseline; }
    .days { font: 700 var(--t-m)/1 var(--font-display); color: var(--muted); }
    .days.soon { color: var(--accent); }
    .bar { height: 8px; border-radius: var(--r-pill); background: var(--surface-2); overflow: hidden; }
    .bar span { display: block; height: 100%; background: var(--g3); transform-origin: left; animation: grow-x var(--d-emphase) var(--e-sortie) both; border-radius: inherit; }
    .small { font-size: var(--t-s); }
    .week { display: grid; grid-template-columns: repeat(7, 1fr); gap: var(--s2); padding: var(--s4) var(--s3); }
    .day { display: grid; justify-items: center; gap: 6px; font-size: var(--t-xs); color: var(--muted); }
    .day .n { font-weight: 700; color: var(--fg); }
    .col { width: 100%; max-width: 28px; height: 72px; display: flex; align-items: end; border-radius: 8px; background: var(--surface-2); overflow: hidden; }
    .col span { width: 100%; height: 100%; background: color-mix(in srgb, var(--accent) 55%, var(--surface-2)); transform-origin: bottom; animation: grow-y var(--d-emphase) var(--e-sortie) both; }
    .day.is-today .col span { background: var(--accent); }
    .day.is-today .lbl { color: var(--accent); font-weight: 700; }
    .day:nth-child(2) span { animation-delay: 30ms; } .day:nth-child(3) span { animation-delay: 60ms; } .day:nth-child(4) span { animation-delay: 90ms; }
    .day:nth-child(5) span { animation-delay: 120ms; } .day:nth-child(6) span { animation-delay: 150ms; } .day:nth-child(7) span { animation-delay: 180ms; }
    .known { display: flex; align-items: center; justify-content: space-between; padding: var(--s4) var(--s5); text-align: left; color: var(--fg); min-height: var(--tap); }
    .known > span { display: grid; gap: 4px; }
    .kn { font: 500 var(--t-l)/1.2 var(--font-display); }
    .known :global(svg) { color: var(--muted); }
    .block { display: block; }
    @keyframes grow-x { from { transform: scaleX(0); } }
    @keyframes grow-y { from { transform: scaleY(0); } }
    @media (max-width: 380px) { .leo { display: none; } .today { grid-template-columns: 1fr; } }
</style>
