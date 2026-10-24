<script lang="ts">
    /** Progrès : quatre réponses, pas plus. Est-ce que je retiens ? Combien je travaille ? Qu'est-ce qui arrive ? Où j'en suis par matière ? */
    import { app, fns } from '../state.svelte.ts';
    const s = $derived(app.stats);
    const target = 0.9;
    const maxR = $derived(Math.max(10, ...s.last30.map(d => d.n)));
    const maxF = $derived(Math.max(10, ...s.forecast));
    const minutes30 = $derived(Math.round(s.last30.reduce((a, d) => a + d.ms, 0) / 60_000));
    const active = $derived(s.last30.filter(d => d.n > 0).length);
    const subjects = $derived.by(() => app.decks.filter(d => !d.parent).map(d => ({ name: d.name, emoji: d.emoji, r: app.readiness([d.id]) })).sort((a, b) => b.r - a.r));
    const wd = (d: number) => new Date(fns.dayStart(d) + 43_200_000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
</script>

<h1>Progrès</h1>

<section class="panel kpi" aria-labelledby="t-ret">
    <div>
        <p class="eyebrow" id="t-ret">Tu te souviens</p>
        <p class="kpi-n tnum">{s.retention30 === null ? '—' : Math.round(s.retention30 * 100) + ' %'}</p>
        <p class="muted small">des cartes revues ces 30 jours ({s.reviews30} révisions). Objectif réglé automatiquement : {Math.round(target * 100)} %.</p>
    </div>
    <svg class="gauge" viewBox="0 0 120 70" aria-hidden="true">
        <path d="M10 64a50 50 0 0 1 100 0" pathLength="100" class="track" />
        <path d="M10 64a50 50 0 0 1 100 0" pathLength="100" class="val" style="stroke-dashoffset:{100 - (s.retention30 ?? 0) * 100}" />
        <line x1="60" y1="4" x2="60" y2="24" class="mark" transform="rotate({(target - 0.5) * 180} 60 64)" />
    </svg>
</section>

<section class="panel chart-box" aria-labelledby="t-work">
    <div class="chart-head"><h2 id="t-work">Ton travail</h2><span class="muted small tnum">{minutes30} min sur 30 jours · {active} jours actifs</span></div>
    <svg viewBox="0 0 300 110" class="chart" role="img" aria-label="Révisions par jour sur 30 jours">
        <line x1="0" x2="300" y1="96" y2="96" class="axis" />
        {#each s.last30 as d, i}
            <rect x={i * 10 + 1.5} y={96 - (d.n / maxR) * 86} width="7" height={(d.n / maxR) * 86} rx="2" class="bar" class:now={i === 29} style="animation-delay:{i * 12}ms" />
        {/each}
        <text x="0" y="108" class="tick">{wd(s.last30[0].d)}</text><text x="300" y="108" class="tick" text-anchor="end">aujourd'hui</text>
        <text x="0" y="8" class="tick">{maxR}</text>
    </svg>
</section>

<section class="panel chart-box" aria-labelledby="t-next">
    <div class="chart-head"><h2 id="t-next">Ce qui arrive</h2><span class="muted small">cartes prévues, 14 jours</span></div>
    <svg viewBox="0 0 300 110" class="chart" role="img" aria-label="Cartes prévues sur 14 jours">
        <line x1="0" x2="300" y1="96" y2="96" class="axis" />
        {#each s.forecast as n, i}
            <rect x={i * (300 / 14) + 3} y={96 - (n / maxF) * 80} width={300 / 14 - 6} height={(n / maxF) * 80} rx="3" class="bar soft" style="animation-delay:{i * 18}ms" />
            <text x={i * (300 / 14) + 300 / 28} y={92 - (n / maxF) * 80} class="val-lbl" text-anchor="middle">{n}</text>
        {/each}
        <text x="0" y="108" class="tick">auj.</text><text x="300" y="108" class="tick" text-anchor="end">J+13</text>
    </svg>
</section>

<section class="panel subjects" aria-labelledby="t-sub">
    <h2 id="t-sub">Par matière</h2>
    <ul>
        {#each subjects as m}
            <li><span class="nm"><span aria-hidden="true">{m.emoji}</span> {m.name}</span><span class="pc tnum">{Math.round(m.r * 100)} %</span>
                <span class="track-h"><span style="transform:scaleX({m.r})"></span></span></li>
        {/each}
    </ul>
    <p class="muted small">Part du paquet dont tu te souviens aujourd'hui (une carte jamais vue compte 0).</p>
</section>

<style>
    h1 { font-size: var(--t-2xl); }
    h2 { font-size: var(--t-l); }
    .small { font-size: var(--t-s); }
    .kpi { display: grid; grid-template-columns: 1fr 120px; gap: var(--s4); align-items: center; padding: var(--s5); }
    .kpi-n { font: 800 3rem/1 var(--font-display); letter-spacing: -.02em; margin: 4px 0; }
    .gauge { width: 120px; overflow: visible; }
    .gauge path { fill: none; stroke-width: 12; stroke-linecap: round; }
    .track { stroke: var(--surface-2); }
    .val { stroke: var(--g3); stroke-dasharray: 100; animation: draw var(--d-emphase) var(--e-sortie) both; }
    .mark { stroke: var(--fg); stroke-width: 2.5; stroke-linecap: round; }
    .chart-box { padding: var(--s4) var(--s5) var(--s5); display: grid; gap: var(--s3); }
    .chart-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--s2); }
    .chart { width: 100%; height: auto; overflow: visible; }
    .axis { stroke: var(--line); }
    .bar { fill: color-mix(in srgb, var(--accent) 60%, var(--surface-2)); transform-box: fill-box; transform-origin: bottom; animation: rise var(--d-emphase) var(--e-sortie) both; }
    .bar.now { fill: var(--accent); }
    .bar.soft { fill: color-mix(in srgb, var(--g4) 55%, var(--surface-2)); }
    .tick, .val-lbl { fill: var(--muted); font-size: 8px; font-family: var(--font-body); }
    .subjects { padding: var(--s5); display: grid; gap: var(--s3); }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s3); }
    li { display: grid; grid-template-columns: 1fr auto; gap: 6px var(--s3); }
    .nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--t-s); }
    .pc { font-weight: 700; font-size: var(--t-s); }
    .track-h { grid-column: 1 / -1; height: 6px; border-radius: var(--r-pill); background: var(--surface-2); overflow: hidden; }
    .track-h span { display: block; height: 100%; background: var(--g3); transform-origin: left; animation: grow var(--d-emphase) var(--e-sortie) both; }
    @keyframes rise { from { transform: scaleY(0); } }
    @keyframes grow { from { transform: scaleX(0); } }
    @keyframes draw { from { stroke-dashoffset: 100; } }
</style>
