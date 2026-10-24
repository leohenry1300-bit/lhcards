<script lang="ts">
    import { app, fns } from '../state.svelte.ts';
    import Icon from '../ui/Icon.svelte';
    import VirtualList from '../ui/VirtualList.svelte';
    import type { Card } from '../data/migrate.ts';
    let { onReview }: { onReview: (scope?: string | null) => void } = $props();

    let query = $state('');
    let open = $state<string | null>(null);
    const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

    /** une seule passe sur les cartes : compteurs par paquet racine */
    const roots = $derived.by(() => {
        void app.version;
        const now = Date.now(), end = fns.dayStart(fns.dayOf(now) + 1);
        const m = new Map<string, { id: string; name: string; emoji: string; total: number; due: number; fresh: number; seen: number }>();
        for (const d of app.decks) if (!d.parent) m.set(d.id, { id: d.id, name: d.name, emoji: d.emoji, total: 0, due: 0, fresh: 0, seen: 0 });
        for (const c of app.cards) {
            const r = app.rootOf(c.deckId); if (!r) continue;
            const e = m.get(r.id)!; e.total++;
            if (c.sched.phase === 'new') e.fresh++; else { e.seen++; if (c.sched.due < end) e.due++; }
        }
        return [...m.values()].sort((a, b) => b.due - a.due || b.seen - a.seen || a.name.localeCompare(b.name, 'fr'));
    });
    const subdecks = (root: string) => app.decks.filter(d => d.parent === root);

    // recherche : insensible aux accents, sur le recto et le verso ; résultats virtualisés
    const results = $derived.by((): Card[] => {
        const q = fold(query.trim()); if (q.length < 2) return [];
        return app.cards.filter(c => fold(c.front).includes(q) || fold(c.back).includes(q));
    });
    const status = (c: Card) => c.sched.phase === 'new' ? 'nouvelle' : c.sched.phase === 'review' ? `dans ${Math.max(0, fns.dayOf(c.sched.due) - fns.dayOf(Date.now()))} j` : 'en cours';
</script>

<header class="head">
    <h1>Paquets</h1>
    <label class="search">
        <Icon name="chercher" size={20} />
        <input id="recherche" type="search" placeholder="Chercher une carte" bind:value={query} autocomplete="off" enterkeyhint="search" />
    </label>
</header>

{#if query.trim().length >= 2}
    <p class="muted count">{results.length} carte{results.length > 1 ? 's' : ''}</p>
    <VirtualList items={results} rowHeight={72}>
        {#snippet row(c: Card)}
            <div class="card-row"><span class="q">{strip(c.front)}</span><span class="a muted">{strip(c.back)}</span><span class="st">{status(c)}</span></div>
        {/snippet}
    </VirtualList>
{:else}
    <ul class="decks">
        {#each roots as d (d.id)}
            <li class="deck panel" class:open={open === d.id}>
                <button class="deck-main" aria-expanded={open === d.id} onclick={() => (open = open === d.id ? null : d.id)}>
                    <span class="emoji" aria-hidden="true">{d.emoji}</span>
                    <span class="txt"><b>{d.name}</b><span class="muted small tnum">{d.total} cartes · {d.seen ? Math.round(d.seen / d.total * 100) + ' % commencé' : 'pas encore commencé'}</span></span>
                    {#if d.due}<span class="due tnum">{d.due}</span>{/if}
                </button>
                {#if open === d.id}
                    <div class="more">
                        <ul class="subs">{#each subdecks(d.id) as s}<li><span aria-hidden="true">{s.emoji}</span> {s.name}</li>{/each}</ul>
                        <button class="btn btn-primary" onclick={() => onReview(d.id)}><Icon name="jouer" size={18} /> {d.due ? `Réviser ce paquet (${d.due})` : d.fresh ? 'Apprendre ce paquet' : 'Réviser quand même'}</button>
                    </div>
                {/if}
            </li>
        {/each}
    </ul>
{/if}

<style>
    .head { display: grid; gap: var(--s4); }
    h1 { font-size: var(--t-2xl); }
    .search { display: flex; align-items: center; gap: var(--s2); padding: 0 var(--s4); min-height: var(--tap); border-radius: var(--r-pill); background: var(--surface); box-shadow: var(--shadow); color: var(--muted); }
    .search input { flex: 1; min-width: 0; border: 0; background: none; outline: none; color: var(--fg); font-size: 1rem; min-height: var(--tap); }
    .count { font-size: var(--t-s); }
    .decks { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--s3); }
    .deck { overflow: hidden; }
    .deck-main { width: 100%; display: flex; align-items: center; gap: var(--s3); padding: var(--s3) var(--s4); min-height: 68px; text-align: left; }
    .emoji { font-size: 1.6rem; width: 44px; height: 44px; display: grid; place-items: center; border-radius: var(--r-m); background: var(--surface-2); flex: none; }
    .txt { display: grid; gap: 2px; flex: 1; min-width: 0; }
    .txt b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .small { font-size: var(--t-s); }
    .due { min-width: 36px; padding: 4px 10px; border-radius: var(--r-pill); background: var(--accent-soft); color: var(--accent); font-weight: 700; text-align: center; }
    .more { display: grid; gap: var(--s3); padding: 0 var(--s4) var(--s4); animation: reveal var(--d-standard) var(--e-sortie) both; }
    .subs { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .subs li { font-size: var(--t-s); padding: 6px 10px; border-radius: var(--r-pill); background: var(--surface-2); }
    .card-row { height: 100%; display: grid; grid-template-columns: 1fr auto; grid-template-rows: auto auto; column-gap: var(--s3); align-content: center; border-bottom: 1px solid var(--line); padding: 0 var(--s2); }
    .q { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .a { grid-row: 2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--t-s); min-width: 0; }
    .st { grid-row: 1 / 3; grid-column: 2; align-self: center; font-size: var(--t-xs); color: var(--muted); }
    @keyframes reveal { from { opacity: 0; transform: translateY(-6px); } }
</style>
