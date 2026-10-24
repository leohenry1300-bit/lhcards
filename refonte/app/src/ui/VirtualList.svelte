<script lang="ts" generics="T">
    /**
     * Liste virtualisée à hauteur de ligne fixe, défilement de la page (pas de conteneur à défilement interne,
     * meilleur sur iOS). Seules les lignes visibles + une marge existent dans le DOM : 3 700 cartes → ~25 lignes.
     */
    import { onMount, type Snippet } from 'svelte';
    let { items, rowHeight = 64, overscan = 6, row }: { items: T[]; rowHeight?: number; overscan?: number; row: Snippet<[T, number]> } = $props();
    let host: HTMLDivElement;
    let start = $state(0), end = $state(30);
    function update() {
        if (!host) return;
        const top = host.getBoundingClientRect().top, vh = window.innerHeight;
        start = Math.max(0, Math.floor(-top / rowHeight) - overscan);
        end = Math.min(items.length, Math.ceil((vh - top) / rowHeight) + overscan);
    }
    onMount(() => {
        update();
        let raf = 0;
        const on = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); }); };
        addEventListener('scroll', on, { passive: true }); addEventListener('resize', on);
        return () => { removeEventListener('scroll', on); removeEventListener('resize', on); cancelAnimationFrame(raf); };
    });
    $effect(() => { void items.length; update(); });
</script>

<div bind:this={host} class="vl" style="height:{items.length * rowHeight}px" role="list">
    {#each items.slice(start, end) as item, i (start + i)}
        <div class="row" role="listitem" style="transform:translateY({(start + i) * rowHeight}px);height:{rowHeight}px">{@render row(item, start + i)}</div>
    {/each}
</div>

<style>
    .vl { position: relative; contain: strict; width: 100%; }
    .row { position: absolute; inset: 0 0 auto 0; contain: layout paint; }
</style>
