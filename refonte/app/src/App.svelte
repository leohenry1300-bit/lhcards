<script lang="ts">
    import { flushSync, onMount } from 'svelte';
    import { app } from './state.svelte.ts';
    import { setSound } from './lib/feel.ts';
    import TabBar from './ui/TabBar.svelte';
    import Accueil from './screens/Accueil.svelte';
    import Paquets from './screens/Paquets.svelte';
    import Reglages from './screens/Reglages.svelte';
    import type { Component } from 'svelte';

    type Tab = 'accueil' | 'paquets' | 'toeic' | 'progres' | 'reglages';
    const TABS: Tab[] = ['accueil', 'paquets', 'toeic', 'progres', 'reglages'];
    // écrans lourds (graphiques, banque TOEIC) : morceaux séparés, préchargés quand le téléphone est inactif
    const lazy: Record<string, () => Promise<{ default: Component<any> }>> = {
        progres: () => import('./screens/Progres.svelte'),
        toeic: () => import('./screens/Toeic.svelte'),
        revision: () => import('./screens/Revision.svelte')
    };
    const loaded = $state<Record<string, Component<any>>>({});
    const load = async (k: string) => { if (!loaded[k]) loaded[k] = (await lazy[k]()).default; return loaded[k]; };

    let tab = $state<Tab>((TABS as string[]).includes(location.hash.slice(1)) ? (location.hash.slice(1) as Tab) : 'accueil');
    let reviewing = $state(false);
    let reviewScope = $state<string | null>(null);
    let mode5 = $state(false);
    // pendant une séance, les écrans d'en dessous sont démontés (après l'animation d'entrée) :
    // ils ne recalculent plus la file et les statistiques à chaque note
    let covered = $state(false);

    $effect(() => { setSound(app.settings.sons); });
    $effect(() => {
        const a = app.settings.ambiance, root = document.documentElement;
        if (a === 'auto') delete root.dataset.ambiance; else root.dataset.ambiance = a;
    });

    const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    /** changement d'onglet : View Transitions quand le navigateur l'a (Safari ≥ 18, Chrome), sinon animation CSS d'entrée */
    async function go(t: Tab) {
        if (t === tab) { window.scrollTo({ top: 0, behavior: reduce() ? 'auto' : 'smooth' }); return; }
        if (lazy[t] && !loaded[t]) await load(t);
        const apply = () => { flushSync(() => { tab = t; }); window.scrollTo(0, 0); history.replaceState(null, '', '#' + t); };
        const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
        if (d.startViewTransition && !reduce()) d.startViewTransition(apply); else apply();
    }
    async function startReview(scope: string | null = null, five = false) {
        await load('revision');
        reviewScope = scope; mode5 = five; reviewing = true;
        setTimeout(() => { if (reviewing) covered = true; }, 320);
    }
    function endReview() { covered = false; reviewing = false; }

    onMount(() => {
        // préchargement à l'inactivité : l'onglet est prêt avant qu'on le touche, sans gêner le démarrage
        const idle = (window as any).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1200));
        idle(() => { load('revision'); load('progres'); load('toeic'); });
        (window as any).__lh = { invalidate: () => app.touch(), app };
    });
</script>

<div class="shell" data-ready={app.ready ? '' : undefined}>
    <TabBar {tab} onGo={go} />
    <main class="main" id="main">
        {#if app.ready && !covered}
            {#key tab}
                <section class="screen" class:screen-in={!('startViewTransition' in document)} data-screen={tab} aria-label={tab}>
                    {#if tab === 'accueil'}<Accueil onReview={startReview} onGo={go} />
                    {:else if tab === 'paquets'}<Paquets onReview={startReview} />
                    {:else if tab === 'reglages'}<Reglages />
                    {:else if loaded[tab]}{@const Screen = loaded[tab]}<Screen onReview={startReview} />
                    {/if}
                </section>
            {/key}
        {/if}
    </main>
</div>
{#if reviewing && loaded.revision}
    {@const Revision = loaded.revision}
    <Revision scope={reviewScope} five={mode5} onClose={endReview} />
{/if}

<style>
    .shell { min-height: 100%; }
    .main {
        max-width: 680px; margin: 0 auto;
        padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
        padding-block: calc(env(safe-area-inset-top, 0px) + 20px) calc(env(safe-area-inset-bottom, 0px) + 96px);
    }
    .screen { display: grid; gap: var(--s5); }
    @media (min-width: 900px) {
        .shell { display: grid; grid-template-columns: 232px 1fr; }
        .main { padding-block: 40px 64px; max-width: 760px; width: 100%; }
    }
</style>
