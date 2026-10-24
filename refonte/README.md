# LH Cards — refonte

Proposition de refonte complète de LH Cards : rapport, prototypes jouables et mesures. L'application actuelle (racine du dépôt) n'est pas modifiée.

- **Rapport** : [`RAPPORT.md`](RAPPORT.md) (aussi en page mise en forme : `rapport.html`)
- **Prototype jouable** : `proto/` (déjà construit ; servir le dossier, par exemple `cd refonte/proto && python3 -m http.server`)
- **Simulateur** : `sim/index.html` (servir `refonte/sim/`)
- **Sources** : `app/` (Svelte 5 + TypeScript + Vite)

```sh
cd refonte/app
npm install
npm test            # moteur FSRS-6 (comparé à py-fsrs), file du jour, optimiseur, migration
npm run sim         # 4 scénarios × 1 000 cartes × 365 jours → ../sim/resultats-simulation.json
npm run contrast    # contrastes WCAG des 5 thèmes
npm run build       # → ../proto
node ../bench/measure.js   # mesures comparées (depuis la racine du dépôt)
```
