<script lang="ts">
    /**
     * Léo en vectoriel : ≈ 2 Ko au lieu de ≈ 1 Mo par animation vidéo. Les mouvements sont de simples
     * transformations CSS (composées par le GPU), donc nets à toute taille et sans saccade.
     * Ce composant illustre le pipeline « léger » ; la version finale serait un fichier Rive (voir rapport §3.4).
     * Poses : repos (respire, cligne), salut (incline la tête), fier (petit bond, yeux rieurs).
     */
    let { pose = 'repos', size = 96 }: { pose?: 'repos' | 'salut' | 'fier'; size?: number } = $props();
    const petals = Array.from({ length: 14 }, (_, i) => i * (360 / 14));
</script>

<svg class="leo {pose}" width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="Léo, le lionceau">
    <g class="body">
        <g class="mane">
            {#each petals as a}<ellipse cx="60" cy="25" rx="15" ry="21" transform="rotate({a} 60 62)" fill="var(--leo-mane)" />{/each}
            <circle cx="60" cy="62" r="38" fill="var(--leo-mane-2)" />
        </g>
        <g class="head">
            <circle cx="35" cy="37" r="10" fill="var(--leo-face)" /><circle cx="35" cy="37" r="5" fill="var(--leo-blush)" />
            <circle cx="85" cy="37" r="10" fill="var(--leo-face)" /><circle cx="85" cy="37" r="5" fill="var(--leo-blush)" />
            <circle cx="60" cy="64" r="32" fill="var(--leo-face)" />
            <circle cx="41" cy="76" r="5" fill="var(--leo-blush)" opacity=".55" /><circle cx="79" cy="76" r="5" fill="var(--leo-blush)" opacity=".55" />
            <ellipse cx="60" cy="79" rx="16" ry="11.5" fill="var(--leo-muzzle)" />
            {#if pose === 'fier'}
                <path d="M43 61q5-6 10 0M67 61q5-6 10 0" stroke="var(--leo-ink)" stroke-width="3.2" stroke-linecap="round" fill="none" />
            {:else}
                <g class="eyes"><ellipse cx="48" cy="60" rx="3.8" ry="4.8" fill="var(--leo-ink)" /><ellipse cx="72" cy="60" rx="3.8" ry="4.8" fill="var(--leo-ink)" />
                    <circle cx="49.3" cy="58.4" r="1.3" fill="#fff" /><circle cx="73.3" cy="58.4" r="1.3" fill="#fff" /></g>
            {/if}
            <path d="M54.5 72.5h11a2 2 0 0 1 1.5 3.2l-5.5 5.2a2 2 0 0 1-3 0l-5.5-5.2a2 2 0 0 1 1.5-3.2z" fill="var(--leo-nose)" />
            <path d={pose === 'fier' ? 'M51 84q9 10 18 0' : 'M54 85q6 5 12 0'} stroke="var(--leo-nose)" stroke-width="2.6" stroke-linecap="round" fill={pose === 'fier' ? 'var(--leo-nose)' : 'none'} />
        </g>
    </g>
</svg>

<style>
    .leo { display: block; overflow: visible; }
    .body, .head, .mane, .eyes { transform-box: fill-box; }
    .body { transform-origin: 50% 90%; }
    .head { transform-origin: 50% 70%; }
    .mane { transform-origin: 50% 50%; }
    .eyes { transform-origin: 50% 50%; }
    /* repos : respiration lente (4 s) + clignement toutes les 5 s — transform uniquement */
    .repos .body { animation: breathe 4s ease-in-out infinite; }
    .repos .eyes, .salut .eyes { animation: blink 5s infinite; }
    .salut .head { animation: tilt 1.6s var(--e-ressort) 1 both; }
    .fier .body { animation: hop var(--d-emphase) var(--e-ressort) 2 both; }
    .fier .mane { animation: fluff 1.2s ease-out 1 both; }
    @keyframes breathe { 50% { transform: translateY(1.5px) scale(1.012, .99); } }
    @keyframes blink { 0%, 94%, 100% { transform: scaleY(1); } 96% { transform: scaleY(.1); } }
    @keyframes tilt { 0% { transform: rotate(0); } 30% { transform: rotate(-9deg); } 60% { transform: rotate(4deg); } 100% { transform: rotate(0); } }
    @keyframes hop { 0% { transform: translateY(0) scale(1); } 40% { transform: translateY(-10px) scale(1.03, .97); } 100% { transform: translateY(0) scale(1); } }
    @keyframes fluff { 0% { transform: scale(.94); } 60% { transform: scale(1.04); } 100% { transform: scale(1); } }
    @media (prefers-reduced-motion: reduce) { .leo * { animation: none !important; } }
</style>
