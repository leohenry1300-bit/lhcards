<script lang="ts">
    /**
     * Révision : plein écran, rien d'autre que la carte. Pas de Léo, pas de navigation.
     * Gestes : toucher la carte (ou Espace) = retourner ; 1-4 ou les boutons = noter ;
     * glisser la carte retournée à gauche = Raté, à droite = Bien. Ctrl/⌘+Z ou « Annuler » = revenir en arrière.
     * Chorégraphie : retournement 3D (260 ms) → la carte part dans la direction de la note (200 ms)
     * → la suivante monte de la pile (260 ms, ressort). Tout en transform/opacity.
     */
    import { onMount, tick } from 'svelte';
    import { app, fns } from '../state.svelte.ts';
    import { feel } from '../lib/feel.ts';
    import Icon from '../ui/Icon.svelte';
    import Leo from '../ui/Leo.svelte';
    import type { Card } from '../data/migrate.ts';
    import type { Grade } from '../engine/fsrs.ts';

    let { scope = null, five = false, onClose }: { scope?: string | null; five?: boolean; onClose: () => void } = $props();

    // file figée au début de la séance (les cartes « Raté » reviennent après 3 à 5 autres)
    const plan = app.plan;
    const inScope = (id: string) => { if (!scope) return true; const c = app.card(id); return !!c && app.rootOf(c.deckId)?.id === scope; };
    let queue = $state<string[]>((scope ? scopedQueue() : plan.order.map(q => q.id)).filter(inScope).slice(0, five ? 30 : 400));
    function scopedQueue() {
        const now = Date.now();
        const mine = app.cards.filter(c => !c.suspended && app.rootOf(c.deckId)?.id === scope);
        const due = mine.filter(c => c.sched.phase !== 'new' && c.sched.due <= now + 86_400_000).sort((a, b) => a.sched.due - b.sched.due);
        return [...due, ...mine.filter(c => c.sched.phase === 'new').slice(0, 15)].map(c => c.id);
    }
    const total = queue.length;
    const t0 = Date.now(), budgetMs = five ? 5 * 60_000 : Infinity;
    let pos = $state(0);
    let flipped = $state(false);
    let leaving = $state<0 | Grade>(0);
    let done = $state(total === 0);
    let shownAt = Date.now();
    let undoStack: Awaited<ReturnType<typeof app.answer>>[] = [];
    let canUndo = $state(false);
    let tally = $state({ 1: 0, 2: 0, 3: 0, 4: 0 } as Record<Grade, number>);
    let drag = $state(0), dragging = false, x0 = 0;

    const current = $derived<Card | undefined>(queue[pos] ? app.card(queue[pos]) : undefined);
    const nextCard = $derived<Card | undefined>(queue[pos + 1] ? app.card(queue[pos + 1]) : undefined);
    const ivls = $derived(current ? app.previewFor(current) : null);
    const progress = $derived(total ? Math.min(1, pos / Math.max(total, queue.length)) : 1);

    const fmt = (ms: number) => {
        const days = fns.dayOf(Date.now() + ms) - fns.dayOf(Date.now());
        if (days >= 1) return days < 31 ? `${days} j` : days < 365 ? `${Math.round(days / 30)} mois` : `${(days / 365).toFixed(1).replace('.', ',')} an`; const m = Math.round(ms / 60_000); if (m < 60) return `${Math.max(1, m)} min`; const d = Math.round(ms / 86_400_000); if (d < 1) return `${Math.round(m / 60)} h`; if (d < 31) return `${d} j`; if (d < 365) return `${Math.round(d / 30)} mois`; return `${(d / 365).toFixed(1).replace('.', ',')} an`; };

    function flip() { if (!current || leaving) return; flipped = !flipped; if (flipped) feel.flip(); }
    async function grade(g: Grade) {
        if (!current || !flipped || leaving) return;
        feel.grade(g);
        leaving = g;
        const card = current, ms = Date.now() - shownAt;
        const u = await app.answer(card, g, ms);
        undoStack.push(u); if (undoStack.length > 20) undoStack.shift(); canUndo = true;
        tally[g]++;
        // carte encore en apprentissage aujourd'hui : elle revient plus loin dans la séance
        if (u.card.sched.phase === 'learning' || u.card.sched.phase === 'relearning') queue.splice(Math.min(queue.length, pos + 4), 0, card.id);
        await new Promise(r => setTimeout(r, 190));
        pos++; flipped = false; leaving = 0; drag = 0; shownAt = Date.now();
        if (pos >= queue.length || Date.now() - t0 > budgetMs) finish();
    }
    async function undo() {
        const u = undoStack.pop(); if (!u) return;
        await app.undo(u);
        const k = queue.lastIndexOf(u.card.id); if (k > pos) queue.splice(k, 1);
        tally[u.log.g]--;
        pos = Math.max(0, pos - 1); queue[pos] = u.card.id; flipped = true; done = false; canUndo = undoStack.length > 0;
    }
    function finish() { done = true; feel.done(); }

    // glisser : la carte suit le doigt (transform seul), lâchée au-delà de 90 px elle est notée
    function down(e: PointerEvent) { if (!flipped || leaving) return; dragging = true; x0 = e.clientX; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }
    function move(e: PointerEvent) { if (dragging) drag = e.clientX - x0; }
    function up() { if (!dragging) return; dragging = false; if (drag > 90) grade(3); else if (drag < -90) grade(1); else drag = 0; }

    function key(e: KeyboardEvent) {
        if (e.key === 'Escape') return onClose();
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); return undo(); }
        if (done) return;
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
        else if (['1', '2', '3', '4'].includes(e.key)) grade(Number(e.key) as Grade);
    }
    let dialog: HTMLDivElement;
    onMount(() => { document.body.style.overflow = 'hidden'; tick().then(() => dialog?.focus()); return () => { document.body.style.overflow = ''; }; });

    const minutes = () => Math.max(1, Math.round((Date.now() - t0) / 60_000));
    const success = $derived(tally[2] + tally[3] + tally[4]);
    const answered = $derived(tally[1] + success);
    const grades: [Grade, string][] = [[1, 'Raté'], [2, 'Difficile'], [3, 'Bien'], [4, 'Facile']];
</script>

<svelte:window onkeydown={key} />

<div class="review" data-open bind:this={dialog} tabindex="-1" role="dialog" aria-modal="true" aria-label="Révision">
    <header class="bar">
        <button class="icon" onclick={onClose} aria-label="Fermer la révision"><Icon name="fermer" /></button>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax={total} aria-valuenow={pos}><span style="transform:scaleX({done ? 1 : progress})"></span></div>
        <button class="icon" onclick={undo} disabled={!canUndo} aria-label="Annuler la dernière note"><Icon name="annuler" /></button>
    </header>

    {#if !done && current}
        <div class="stage">
            {#if nextCard}<div class="under" aria-hidden="true"></div>{/if}
            {#key current.id + ':' + pos}
                <div class="card-wrap" role="group" aria-roledescription="carte" class:leave-left={leaving === 1} class:leave-right={leaving === 3 || leaving === 4} class:leave-down={leaving === 2}
                    style="--dx:{drag}px" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
                    <button class="card" class:flipped onclick={flip} aria-label={flipped ? 'Réponse affichée' : 'Afficher la réponse'} data-action="retourner">
                        <span class="face front"><span class="deck-name">{app.rootOf(current.deckId)?.name}</span><span class="content">{@html current.front}</span><span class="hint-tap">Touche pour retourner</span></span>
                        <span class="face back"><span class="q-small">{@html current.front}</span><span class="content">{@html current.back}</span></span>
                    </button>
                    {#if drag !== 0}<span class="drag-label" class:ok={drag > 0} style="opacity:{Math.min(1, Math.abs(drag) / 90)}">{drag > 0 ? 'Bien' : 'Raté'}</span>{/if}
                </div>
            {/key}
        </div>
        <footer class="grades" class:show={flipped}>
            {#each grades as [g, label]}
                <button class="grade g{g}" data-note={g} onclick={() => grade(g)} disabled={!flipped} aria-keyshortcuts={String(g)}>
                    <b>{label}</b><span class="tnum">{ivls ? fmt(ivls[g]) : ''}</span>
                </button>
            {/each}
        </footer>
    {:else}
        <section class="end" aria-live="polite">
            <Leo pose="fier" size={132} />
            <h2>{answered ? 'Séance terminée' : 'Rien à réviser ici'}</h2>
            {#if answered}
                <p class="summary"><b class="tnum">{answered}</b> cartes en {minutes()} min · <b class="tnum">{Math.round(success / answered * 100)} %</b> de réussite</p>
                <div class="dist" aria-label="Répartition des notes">
                    {#each grades as [g, label]}<span class="seg g{g}" style="flex:{tally[g] || 0}" title="{label} : {tally[g]}"></span>{/each}
                </div>
                <p class="muted">Demain : {app.stats.forecast[1] ?? 0} cartes. {tally[1] ? `Les ${tally[1]} cartes ratées reviendront au bon moment.` : 'Aucune erreur, bravo.'}</p>
            {/if}
            <button class="btn btn-primary" onclick={onClose}>Terminer</button>
        </section>
    {/if}
</div>

<style>
    .review {
        position: fixed; inset: 0; z-index: 50; background: var(--bg); display: grid; grid-template-rows: auto 1fr auto; outline: none;
        padding: calc(env(safe-area-inset-top, 0px) + 8px) max(16px, env(safe-area-inset-right, 0px)) calc(env(safe-area-inset-bottom, 0px) + 12px) max(16px, env(safe-area-inset-left, 0px));
        animation: rise var(--d-standard) var(--e-sortie) both;
    }
    .bar { display: grid; grid-template-columns: var(--tap) 1fr var(--tap); align-items: center; gap: var(--s3); max-width: 640px; width: 100%; margin: 0 auto; }
    .icon { width: var(--tap); height: var(--tap); display: grid; place-items: center; border-radius: var(--r-pill); color: var(--muted); }
    .icon:disabled { opacity: .35; cursor: default; }
    .progress { height: 6px; border-radius: var(--r-pill); background: var(--surface-2); overflow: hidden; }
    .progress span { display: block; height: 100%; background: var(--accent); transform-origin: left; transition: transform var(--d-standard) var(--e-sortie); }

    .stage { position: relative; display: grid; place-items: center; perspective: 1400px; padding: var(--s4) 0; max-width: 640px; width: 100%; margin: 0 auto; min-height: 0; }
    .card-wrap, .under { grid-area: 1 / 1; width: 100%; height: min(62vh, 480px); }
    .card-wrap { position: relative; transform: translateX(var(--dx)) rotate(calc(var(--dx) / 40 * 1deg)); touch-action: pan-y; animation: arrive var(--d-standard) var(--e-ressort) both; }
    .under { border-radius: var(--r-l); background: var(--surface); box-shadow: var(--card-shadow); transform: translateY(14px) scale(.95); opacity: .6; }
    .card { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; transition: transform var(--d-standard) var(--e-sortie); text-align: center; color: var(--fg); border-radius: var(--r-l); }
    .card.flipped { transform: rotateY(180deg); }
    .face {
        position: absolute; inset: 0; display: grid; grid-template-rows: auto 1fr auto; align-items: center; justify-items: center; gap: var(--s3);
        padding: var(--s5); border-radius: var(--r-l); background: var(--surface); box-shadow: var(--card-shadow); backface-visibility: hidden; -webkit-backface-visibility: hidden; overflow: auto;
    }
    .back { transform: rotateY(180deg); grid-template-rows: auto 1fr; }
    .content { font: 500 var(--t-card)/1.35 var(--font-body); max-width: 32ch; overflow-wrap: anywhere; }
    .content :global(.hint) { font-size: var(--t-m); color: var(--muted); font-style: italic; margin-top: var(--s4); }
    .deck-name, .hint-tap { font-size: var(--t-xs); color: var(--muted); letter-spacing: .04em; }
    .q-small { font-size: var(--t-s); color: var(--muted); max-width: 40ch; }
    .drag-label { position: absolute; top: 18px; left: 18px; padding: 6px 12px; border-radius: var(--r-pill); font-weight: 800; background: var(--g1); color: #fff; pointer-events: none; }
    .drag-label.ok { left: auto; right: 18px; background: var(--g3); }

    .leave-left { animation: leave-l 190ms var(--e-entree) forwards; }
    .leave-right { animation: leave-r 190ms var(--e-entree) forwards; }
    .leave-down { animation: leave-d 190ms var(--e-entree) forwards; }

    .grades { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--s2); max-width: 640px; width: 100%; margin: 0 auto; opacity: .0; transform: translateY(10px); transition: opacity var(--d-rapide) var(--e-sortie), transform var(--d-rapide) var(--e-sortie); pointer-events: none; }
    .grades.show { opacity: 1; transform: none; pointer-events: auto; }
    .grade { min-height: 64px; display: grid; align-content: center; gap: 2px; border-radius: var(--r-m); background: var(--surface); box-shadow: var(--shadow); transition: transform var(--d-instant) var(--e-sortie); }
    .grade:active { transform: scale(.95); }
    .grade b { font-size: .95rem; }
    .grade span { font-size: var(--t-xs); color: var(--muted); }
    .g1 b { color: var(--g1); } .g2 b { color: var(--g2); } .g3 b { color: var(--g3); } .g4 b { color: var(--g4); }

    .end { display: grid; place-items: center; align-content: center; gap: var(--s4); text-align: center; max-width: 420px; margin: 0 auto; animation: arrive var(--d-emphase) var(--e-ressort) both; }
    .end h2 { font-size: var(--t-xl); }
    .summary { font-size: var(--t-l); }
    .dist { display: flex; width: 100%; height: 10px; border-radius: var(--r-pill); overflow: hidden; gap: 2px; background: var(--surface-2); }
    .seg { transform-origin: left; animation: grow var(--d-emphase) var(--e-sortie) both 120ms; }
    .seg.g1 { background: var(--g1); } .seg.g2 { background: var(--g2); } .seg.g3 { background: var(--g3); } .seg.g4 { background: var(--g4); }

    @keyframes rise { from { transform: translateY(24px); opacity: 0; } }
    @keyframes arrive { from { transform: translateY(18px) scale(.96); opacity: 0; } }
    @keyframes leave-l { to { transform: translateX(-120%) rotate(-8deg); opacity: 0; } }
    @keyframes leave-r { to { transform: translateX(120%) rotate(8deg); opacity: 0; } }
    @keyframes leave-d { to { transform: translateY(40px) scale(.94); opacity: 0; } }
    @keyframes grow { from { transform: scaleX(0); } }
    @media (prefers-reduced-motion: reduce) {
        .card { transition: none; } .card.flipped { transform: none; }
        .card.flipped .front { visibility: hidden; } .back { transform: none; } .card:not(.flipped) .back { visibility: hidden; }
        .leave-left, .leave-right, .leave-down { animation: fade 120ms linear forwards; }
        @keyframes fade { to { opacity: 0; } }
    }
</style>
