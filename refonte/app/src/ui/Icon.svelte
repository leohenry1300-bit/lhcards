<script lang="ts">
    // Icônes au trait (24 px, trait 2) : un seul jeu, cohérent, sans police d'icônes.
    const P: Record<string, string> = {
        accueil: 'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z',
        paquets: 'M4 7.5 12 4l8 3.5-8 3.5zM4 12l8 3.5 8-3.5M4 16.5 12 20l8-3.5',
        toeic: 'M4 13a8 8 0 0 1 16 0M4 13v3a2 2 0 0 0 2 2h1v-6H6a2 2 0 0 0-2 2m16 0v3a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2',
        progres: 'M4 19h16M7 16v-4M12 16V7M17 16v-6',
        reglages: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.3 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
        jouer: 'M8 5.5v13l10.5-6.5z',
        fermer: 'M6 6l12 12M18 6 6 18',
        annuler: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
        flamme: 'M12 21a6 6 0 0 0 6-6c0-3.5-2.5-5.5-3.5-8.5-.5 2-1.5 3-2.5 3.5C12 7 11 5 9.5 3 9.5 7 6 9.5 6 15a6 6 0 0 0 6 6z',
        chercher: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
        chevron: 'M9 6l6 6-6 6',
        retour: 'M15 6l-6 6 6 6',
        cible: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
        horloge: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
        export: 'M12 15V4M8 8l4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4',
        import: 'M12 4v11M8 11l4 4 4-4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4',
        plus: 'M12 5v14M5 12h14',
        coche: 'M5 12.5l4.5 4.5L19 7.5',
        eclair: 'M13 3 5 14h6l-1 7 8-11h-6z'
    };
    let { name, size = 24, label = '' }: { name: string; size?: number; label?: string } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : 'true'}><path d={P[name]} /></svg>
