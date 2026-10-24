<script lang="ts">
    import Icon from './Icon.svelte';
    import { feel } from '../lib/feel.ts';
    type Tab = 'accueil' | 'paquets' | 'toeic' | 'progres' | 'reglages';
    let { tab, onGo }: { tab: Tab; onGo: (t: Tab) => void } = $props();
    const items: [Tab, string][] = [['accueil', 'Accueil'], ['paquets', 'Paquets'], ['toeic', 'TOEIC'], ['progres', 'Progrès'], ['reglages', 'Réglages']];
    const index = $derived(items.findIndex(i => i[0] === tab));
</script>

<nav class="tabbar" aria-label="Navigation principale" style="--i:{index}">
    <div class="brand" aria-hidden="true"><span class="mark">LH</span><span>Cards</span></div>
    <span class="pill" aria-hidden="true"></span>
    {#each items as [id, label]}
        <button data-tab={id} aria-current={tab === id ? 'page' : undefined} onpointerdown={() => feel.tap()} onclick={() => onGo(id)}>
            <Icon name={id} size={24} /><span>{label}</span>
        </button>
    {/each}
</nav>

<style>
    /* Téléphone : barre du bas (5 cibles de 64 × 56 px), pastille qui glisse sous l'onglet actif */
    .tabbar {
        position: fixed; inset: auto 0 0 0; z-index: 20; view-transition-name: tabbar;
        display: grid; grid-template-columns: repeat(5, 1fr);
        padding: 6px max(8px, env(safe-area-inset-right, 0px)) calc(6px + env(safe-area-inset-bottom, 0px)) max(8px, env(safe-area-inset-left, 0px));
        background: color-mix(in srgb, var(--surface) 86%, transparent);
        -webkit-backdrop-filter: saturate(1.6) blur(18px); backdrop-filter: saturate(1.6) blur(18px);
        border-top: 1px solid var(--line);
    }
    .brand { display: none; }
    button {
        position: relative; z-index: 1; min-height: 56px; display: grid; justify-items: center; align-content: center; gap: 2px;
        font: 600 .7rem/1 var(--font-body); color: var(--muted); transition: color var(--d-rapide) var(--e-sortie);
    }
    button[aria-current] { color: var(--accent); }
    button:active :global(svg) { transform: scale(.88); }
    button :global(svg) { transition: transform var(--d-instant) var(--e-sortie); }
    .pill {
        position: absolute; top: 6px; left: max(8px, env(safe-area-inset-left, 0px)); height: 56px;
        width: calc((100% - max(8px, env(safe-area-inset-left, 0px)) - max(8px, env(safe-area-inset-right, 0px))) / 5);
        border-radius: var(--r-m); background: var(--accent-soft);
        transform: translateX(calc(var(--i) * 100%)); transition: transform var(--d-standard) var(--e-ressort);
    }
    /* Ordinateur : rail latéral fixe */
    @media (min-width: 900px) {
        .tabbar {
            position: sticky; top: 0; height: 100vh; inset: auto; display: flex; flex-direction: column; gap: 4px;
            padding: 28px 16px; border-top: 0; border-right: 1px solid var(--line); background: var(--surface);
            -webkit-backdrop-filter: none; backdrop-filter: none;
        }
        .brand { display: flex; align-items: center; gap: 10px; font: 700 1.15rem/1 var(--font-display); margin: 0 8px 22px; }
        .mark { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 11px; background: var(--accent); color: var(--on-accent); font-size: .9rem; }
        button { min-height: 48px; grid-auto-flow: column; justify-content: start; gap: 12px; padding: 0 14px; font-size: .95rem; border-radius: var(--r-m); }
        .pill { top: calc(28px + 58px); left: 16px; width: calc(100% - 32px); height: 48px; transform: translateY(calc(var(--i) * 52px)); }
    }
</style>
