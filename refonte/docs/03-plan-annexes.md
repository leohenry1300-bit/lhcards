## 3.6 Fonctions nouvelles à considérer

| Fonction | Valeur pour l'étudiant | Coût | Risque | Décision |
|---|---|---|---|---|
| **Rappels (Web Push)** | Haute : la régularité est le premier facteur de rétention | 3 j + un petit service d'envoi (gratuit : Cloudflare Workers) | iOS : seulement si l'appli est **installée** sur l'écran d'accueil (iOS 16.4+), autorisation demandée après un geste ; pas de garantie d'heure exacte | **Garder (jalon 6)**, un seul rappel/jour à l'heure habituelle de révision, désactivable |
| Widget d'écran d'accueil | Moyenne | — | **Impossible en PWA** sur iOS (les widgets exigent une app native) | **Refuser** ; le badge d'icône (`setAppBadge`, iOS 16.4+ installé) affiche le nombre de cartes du jour : **garder**, 0,5 j |
| Hors-ligne complet | Haute | Inclus dans l'architecture | — | **Garder** (cœur) |
| Bilan hebdomadaire | Moyenne : donne du sens à la régularité | 1 j | Faible | **Garder** : une carte le lundi sur l'accueil (minutes, rétention, matières qui progressent) |
| Plan de révision vers un examen | Haute | Inclus (mode examen du moteur) | — | **Garder** (fait) |
| Import de cours PDF → cartes | Haute pour le BUT TC | 4 j (pdf.js à la demande + détection) | Qualité variable des cartes proposées | **Garder (jalon 3)**, avec validation par l'élève et la passerelle « copier pour ChatGPT/Claude » |
| Photo d'un cours → cartes | Moyenne | OCR local lourd (Tesseract ≈ 10 Mo) ou service payant | Poids ou coût | **Reporter** ; en attendant : photo → app Notes d'iOS (texte en direct) → coller |
| Mode « 5 minutes » | Haute (transports, pauses) | 0,5 j | — | **Garder** (prototypé) |
| Révision audio mains libres | Faible à moyenne | 5 j | Reconnaissance vocale inégale sous iOS en PWA | **Reporter** |
| Partage de paquets | Moyenne (entre étudiants de BUT TC) | 2 j (export d'un paquet en fichier, sans serveur) | Faible | **Garder en version fichier** au jalon 3 ; pas de catalogue en ligne |
| Apprentissage social léger (classements, amis) | Faible ; risque de pression | Serveur + comptes | Données personnelles, coût | **Refuser** |

---

## 3.7 Preuves : prototypes livrés

Tout est dans le dépôt, branche `claude/refonte-lhcards`, dossier `refonte/` (l'application actuelle n'est pas modifiée).

| # | Demandé | Livré | Où |
|---|---|---|---|
| 1 | Accueil + changement d'onglets animé | Application Svelte 5 jouable : 5 onglets, View Transitions, pastille d'onglet à ressort, Léo vectoriel animé, données réelles de la bibliothèque (2 089 cartes) avec 45 jours d'historique simulé | `refonte/proto/` (construit), sources `refonte/app/` |
| 2 | Écran de révision complet | Retournement 3D, glisser pour noter, 4 boutons avec délais réels, départ dans la direction de la note, pile, annuler, clavier, fin de séance animée, sons, écriture atomique en IndexedDB | idem, `src/screens/Revision.svelte` |
| 3 | Moteur pur + banc de simulation | Moteur FSRS-6 + file + optimiseur + calibration, 17 tests (20 avec la migration) ; simulateur 1 000 cartes × 365 jours, 4 scénarios, page de graphiques et simulation lançable dans le navigateur | `refonte/app/src/engine/`, `refonte/sim/` |
| 4 | Mesure de performance comparée | Banc Playwright (CPU ×4) : poids, démarrage, relance, onglets, DOM, révision, coût d'enregistrement ; 3 passages, médianes | `refonte/bench/`, Annexe D |
| + | Migration sans perte | Migration de l'ancien format testée sur une vraie sauvegarde produite par l'appli actuelle ; import dans le prototype (Réglages › Importer) avec rapport de vérification | `src/data/migrate.ts` |

**Pour le lancer** : `cd refonte/app && npm install && npm run dev` (ou ouvrir `refonte/proto/` avec `python3 -m http.server`). Tests : `npm test`. Simulation : `npm run sim`. Mesures : `node refonte/bench/measure.js`.

Ce que le prototype **ne fait pas** (volontairement) : éditeur de cartes, bibliothèque, tests TOEIC jouables, vidéos de Léo, onboarding. Le score TOEIC affiché est un exemple marqué comme tel.

### Résultats du banc de simulation (1 000 cartes, 365 jours, 20 min/jour, rétention mesurée des jours 60 à 365)

| Scénario | Visée | Obtenue | Écart | Min/jour moy. | P95 | Max | Jours > 25 min |
|---|---|---|---|---|---|---|---|
| A. Refonte complète, élève « oublie vite », absence J150-163, examen J330 | 90,3 % | **90,6 %** | +0,3 | 16,4 | 24,8 | 33,2 | 14 |
| B. Même élève, sans optimiseur ni calibration | 90,3 % | 88,7 % | −1,6 | 15,3 | 23,9 | 30,2 | 7 |
| C. File actuelle (20 nouvelles/jour, pas de plafond), même élève | 90,4 % | 88,0 % | −2,4 | 15,2 | 30,9 | **56,5** | 35 |
| D. Refonte, élève « moyen » (paramètres exacts), sans absence | 90,0 % | **90,4 %** | +0,4 | 12,7 | 22,0 | 23,4 | **0** |

Lecture : avec la refonte, la rétention obtenue reste à ± 0,5 point de la cible dans les deux cas, et la charge ne déborde qu'au retour d'absence et à l'approche de l'examen (voulu). Sans l'optimiseur et la calibration (B), un élève qui oublie plus vite que la moyenne perd 1,6 point sans que rien ne le signale. La logique actuelle (C) produit une séance de 57 minutes au retour d'une absence de deux semaines.

---

## 3.8 Plan de transition

### Phase 0 — correctifs immédiats dans l'application actuelle (≈ 2 jours, à faire quoi qu'on décide)

| Correctif | Effort | Effet |
|---|---|---|
| Supprimer le rechargement automatique de `boot.js` (lignes 9-25) ; afficher « Mise à jour prête au prochain lancement » | 1 h | Fin du « se relance deux fois » |
| Supprimer la limite `REVLOG_MAX` (plus aucune troncature d'historique) | 15 min | Fin de la perte silencieuse d'historique |
| Enregistrer l'historique à part (une clé IndexedDB par mois, ajout seul) et l'état seulement à la fermeture de séance ou en arrière-plan (`visibilitychange`) | 1-2 j | Supprime les 150-230 ms de blocage après chaque note |
| FSRS par défaut pour les cartes en SM-2 (la conversion `fsrsFromCard` existe déjà) | 1 h | Délais mieux réglés |

### Stratégie de réécriture

| Stratégie | Risque | Coût | Valeur livrée en cours de route | Décision |
|---|---|---|---|---|
| Tout réécrire puis basculer d'un coup | Élevé (bascule unique, régressions cachées) | ≈ 43 j | Rien avant la fin | Non |
| « Étrangler » écran par écran dans le même fichier | Élevé : deux styles de rendu, deux stockages, deux CSS à faire cohabiter dans la même page | > 50 j | Progressive mais fragile | Non |
| **Nouvelle appli en parallèle, bascule par fonctionnalité** | Faible : l'ancienne reste disponible et ses données intactes | ≈ 43 j (ambitieux) / 20 j (raisonnable) | Le chemin quotidien dès la semaine 2-3 | **Oui** |

Concrètement : la nouvelle appli vit à côté (même adresse `…/lhcards/`, l'ancienne déplacée à `…/lhcards/v1/`). Même origine, donc la nouvelle **lit directement l'ancienne base** (`superanki_pro` › `state`) au premier lancement, sans export manuel. Tant que le TOEIC n'est pas porté, l'onglet TOEIC ouvre la version 1.

### Migration des données sans perte

1. **Lecture seule** de l'ancienne base ; elle n'est ni modifiée ni supprimée pendant 30 jours.
2. **Transformation pure** `migrateLegacy` (testée) : decks, notes regroupées par `nid`, cartes avec rendu figé, historique conservé ligne à ligne, objectifs, réglages utiles.
3. **État de mémoire** : carte avec historique complet → recalculée par FSRS-6 en rejouant ses notes ; carte FSRS sans historique complet → `s`, `d` repris ; carte SM-2 → stabilité ≈ intervalle, difficulté tirée de la facilité ; **l'échéance de chaque carte est conservée à la milliseconde** (le planning du jour ne change pas le jour de la bascule).
4. **Vérifications d'intégrité** avant toute écriture : mêmes nombres de paquets, cartes, lignes d'historique, médias et répétitions en entrée et en sortie ; identifiants uniques ; chaque carte a son paquet ; échéances identiques. En cas d'écart : rien n'est écrit, rapport affiché.
5. **Écriture** dans la nouvelle base en une transaction ; instantané conservé.
6. **Retour arrière** : l'ancienne appli reste à `/v1/` sur sa base intacte ; un bouton « Revenir à l'ancienne version » exporte les révisions faites dans la nouvelle au format de l'ancienne (`revlog` + état des cartes), pour ne rien perdre non plus dans ce sens.

Testé : sauvegarde réelle de l'appli actuelle (1 427 cartes, 473 révisions sur 10 jours, SM-2 et FSRS mélangés) → 0 écart ; fichier abîmé → rapport explicite, aucune écriture.

### Feuille de route

| Jalon | Livrables | Critères d'acceptation mesurables | Effort | Risques |
|---|---|---|---|---|
| 0. Correctifs (appli actuelle) | 4 correctifs ci-dessus | 0 rechargement automatique en 20 lancements après déploiement ; tâche max après une note < 50 ms (CPU ×4) | 2 j | Faible |
| 1. Socle + moteur + migration | Projet Vite/Svelte/TS, IndexedDB versionnée, moteur (fait à ≈ 70 %), migration depuis la base v1, export/import, service worker, CI | 20+ tests verts ; migration de 3 sauvegardes réelles sans écart ; build < 60 Ko JS gzip | 8 j | Cas particuliers des anciennes données (types perso, médias) |
| 2. Accueil + révision | Écrans prototypés, finis : tous les types de carte, saisie, QCM, annuler, mode 5 min, onboarding | Parcours « 10 cartes » sans tâche > 50 ms ; changement d'onglet ≤ 100 ms ; VoiceOver complet sur la séance | 6 j | Rendu des cartes riches (images, sons, LaTeX) |
| 3. Paquets, cartes, progrès | Liste virtualisée, recherche, éditeur, édition en masse, bibliothèque, import PDF, corbeille, statistiques | 3 700 cartes : défilement à 60 i/s, ≤ 400 éléments DOM, recherche < 50 ms | 10 j | Éditeur riche sur iOS (clavier, sélection) |
| 4. TOEIC | Banque chargée à la demande, mini-test, test complet, erreurs → cartes, audio | 0 octet TOEIC au démarrage ; test complet sans fuite mémoire sur 2 h | 8 j | Synthèse vocale iOS (voix disponibles) |
| 5. Animations signature + Léo | Catalogue d'animations, pipeline vidéo alpha, 8 gestes, phrases par rôle | 60 i/s sur iPhone (Instruments / Safari) ; Léo ≤ 1,5 Mo au total ; jamais en révision | 5 j (+ production des vidéos) | Qualité/cohérence des vidéos générées |
| 6. Finitions | Accessibilité, rappels, badge d'icône, performance, tests visuels | Tous les critères « parfait » ci-dessous | 6 j | Différences Safari réelles |
| **Total** | | | **≈ 45 j** (jalon 0 compris) | |

### Définition de « parfait » (critères d'acceptation)

| Critère | Cible | Prototype aujourd'hui |
|---|---|---|
| Relance → accueil utilisable | < 1,2 s sur iPhone milieu de gamme ; < 600 ms Chromium CPU ×4 | 377-411 ms ✓ (iPhone à vérifier) |
| Changement d'onglet (toucher → 2ᵉ image) | < 100 ms | retours 45-83 ms ✓ ; 1ers affichages 60-107 ms, sauf Progrès à 3 700 cartes : 122 ms ✗ (calcul des statistiques à déplacer en Worker) |
| Animations | 60 i/s, aucune image perdue en séance | 0 tâche longue sur 45 notes ✓ ; 60 i/s à vérifier sur iPhone |
| Erreurs console | 0 | 0 (hors polices bloquées volontairement par le banc) |
| Lighthouse (Performance, Accessibilité, Bonnes pratiques) | ≥ 95 | à mesurer dans la CI |
| Contrastes | WCAG AA partout | 55/55 paires AA (min 4,66:1) |
| Perte de données | 0 sur 1 000 scénarios (coupures en pleine écriture, quota plein, fichiers abîmés, double onglet) | transactions atomiques et migration testées ; le banc de 1 000 scénarios est à écrire (jalon 1) |
| Rétention simulée | ± 2 points de la cible | +0,3 et +0,4 point |
| Poids initial | ≤ 60 Ko JS gzip | 32 Ko |
| Éléments DOM par écran | ≤ 400 | ≤ 222 |

---

## 3.9 Alternatives et honnêteté

**Version ambitieuse (≈ 45 jours)** : tout ce document, dont l'import PDF, les rappels, Léo en vidéo alpha avec 8 gestes, les tests visuels et le banc de 1 000 scénarios de perte de données.

**Version raisonnable (4 semaines, un développeur)** : Phase 0 (2 j) ; jalons 1 et 2 complets (14 j) ; jalon 3 réduit (liste, recherche, éditeur simple, progrès : 4 j). Le TOEIC, la bibliothèque et l'ancien Léo restent dans la v1, accessibles par lien. Léo : poses fixes animées par transformations seulement.

**Ce que je ne ferais pas** : réécrire en natif (Swift) — coût ×3 et compte développeur payant, pour des gains marginaux face à une PWA bien faite ; ajouter des comptes, un serveur ou un classement ; garder deux planificateurs ; générer des cartes par IA sans relecture de l'élève ; animer des listes en cascade (cela retarde la lecture) ; garder 16 thèmes.

**Risques et parades**

| Risque | Parade |
|---|---|
| Perte de données à la migration | Lecture seule de l'ancienne base, vérifications avant écriture, ancienne appli intacte 30 jours, export retour |
| Régression fonctionnelle (une fonction oubliée) | Inventaire du §3.1 transformé en liste de tests e2e ; la v1 reste accessible |
| Effort sous-estimé | La version raisonnable livre le chemin quotidien d'abord ; tout le reste est reportable |
| Safari iOS différent de Chromium | Tests sur iPhone à chaque jalon (voir ci-dessous) ; repli CSS pour View Transitions |
| Dépendances | 2 dépendances d'exécution (Svelte, rien d'autre) ; versions figées |
| Quota de stockage iOS | `persist()` + appli installée ; export hebdomadaire rappelé |

**Ce qui reste invérifiable sans iPhone réel, et comment le tester**

| Point | Comment le vérifier |
|---|---|
| Temps réels de démarrage et d'onglets sur iPhone | Le prototype enregistre ses temps (`performance.mark`) ; une page « Diagnostic » cachée (touche longue sur la version) les affichera pour que tu me les envoies. Sinon : Safari sur Mac › Développement › ton iPhone › Chronologies |
| 60 i/s du retournement et des glissements | Safari Web Inspector › Rendu des images, sur iPhone branché à un Mac |
| View Transitions | Safari 18+ seulement ; sur iOS plus ancien le repli CSS s'applique (à regarder) |
| HEVC alpha pour Léo | Lecture sur iPhone ; le WebM alpha ne marche pas sur iOS |
| Persistance du stockage et rappels Web Push | Seulement une fois l'appli installée sur l'écran d'accueil |
| Vibrations | Indisponibles en web sur iOS : rien à tester, c'est assumé |
| Mémoire | Safari Web Inspector › Mémoire pendant une séance de 200 cartes |

**Faut-il vraiment refaire ?** La Phase 0 corrige les deux défauts les plus visibles pour 2 jours de travail, et je recommande de la faire tout de suite. Elle ne corrige pas : 1 155 à 1 500 éléments par écran reconstruits par chaînes HTML (premier affichage d'onglet jusqu'à 261 ms avec CPU ×4, contre 60-122 ms dans le prototype), un fichier de 2,9 Mo chargé à chaque démarrage, 2 098 lignes de CSS globales où chaque ajout peut casser un autre écran. Ce sont des propriétés de l'architecture, pas des bugs. Les mesures donnent donc raison à la refonte **pour l'objectif « parfait »**, à condition qu'elle soit progressive et que l'ancienne version reste un filet de sécurité.

---

## Annexes

### A. Jetons de design

Source unique : `refonte/app/src/styles/tokens.css`.

| Famille | Jetons |
|---|---|
| Couleur (Clair) | `--bg #f3f4f7` · `--surface #fff` · `--surface-2 #e9ebf0` · `--fg #14161c` · `--muted #596070` · `--line #d8dbe3` · `--accent #b85a0e` · `--accent-soft #fbe7d4` · notes `--g1 #c8343a` `--g2 #9a6a12` `--g3 #23804f` `--g4 #2a62c4` |
| Couleur (Sombre) | `--bg #0f1116` · `--surface #171a21` · `--fg #eceef3` · `--muted #9ba2b3` · `--accent #f0954a` · notes `#ff7a7f #e6b24f #4cc98a #7aa7ff` |
| Léo (tous thèmes) | crinière `#d9822b`/`#b5611a`, visage `#f3c077`, museau `#fbe3bd`, nez `#6b3a1e` |
| Typographie | titres *Bricolage Grotesque* 500-800 ; texte *Atkinson Hyperlegible Next* 400-700 ; tailles `.78 / .875 / 1 / 1.2 / 1.6 / 2.4 rem` + carte `clamp(1.25rem, 4.6vw, 1.7rem)` |
| Espacement | 4 · 8 · 12 · 16 · 24 · 32 · 48 px |
| Rayons | 10 · 16 · 24 px · pilule |
| Cible tactile | 48 px |
| Mouvement | `--d-instant 90ms` · `--d-rapide 160ms` · `--d-standard 260ms` · `--d-emphase 480ms` · `--e-sortie` · `--e-entree` · `--e-ressort` |

### B. Schéma de données

Voir §3.2 ; types TypeScript dans `refonte/app/src/data/migrate.ts` (`Deck`, `Note`, `Card`, `Goal`) et `src/engine/scheduler.ts` (`Sched`, `ReviewLog`).

### C. Arborescence

```text
refonte/
├── app/                      sources de la nouvelle appli
│   ├── index.html            coquille (thème appliqué avant le 1er affichage)
│   ├── vite.config.ts        build + génération du service worker
│   ├── scripts/              build-content.mjs (bibliothèque), contrast.mjs (WCAG)
│   └── src/
│       ├── engine/           moteur pur : fsrs, scheduler, queue, optimizer, simulate (+ test/)
│       ├── data/             db (IndexedDB), migrate (v6 → v1), seed (démo) (+ test/)
│       ├── lib/feel.ts       sons et vibrations
│       ├── styles/           tokens.css, base.css
│       ├── ui/               TabBar, Icon, Leo, VirtualList
│       ├── screens/          Accueil, Paquets, Revision, Progres, Toeic, Reglages
│       ├── state.svelte.ts   état de l'appli
│       └── App.svelte
├── proto/                    prototype construit (ouvrable tel quel)
├── sim/                      page du simulateur + moteur compilé + résultats
├── bench/                    mesures (Playwright), résultats bruts et médianes
├── captures/                 captures d'écran (actuelle et prototype)
└── docs/                     ce rapport
```

### D. Mesures : application actuelle contre prototype

Voir le tableau détaillé ci-dessous (Chromium sans GPU dans un conteneur Linux, CPU ralenti ×4, viewport 390 × 800, polices externes bloquées pour les deux, service worker désactivé ; médiane de 3 passages ; « onglet » = temps entre le toucher et la 2ᵉ image peinte).

{{MESURES}}

### E. Plan de tests

| Niveau | Contenu | Outil | Quand |
|---|---|---|---|
| Unitaires moteur | Concordance py-fsrs, étapes, flou, équilibrage, examen, rejeu, file, nouvelles, calibration, optimiseur, simulation | `node --test` (20 tests + 1 facultatif, 4 s) | chaque envoi |
| Unitaires données | Migration sur sauvegarde réelle, idempotence, fichier abîmé | idem | chaque envoi |
| Perte de données | 1 000 scénarios : coupure pendant une transaction, quota plein, deux onglets, import interrompu, retour arrière | Playwright + IndexedDB simulée | chaque envoi (jalon 1) |
| e2e | Parcours clés (§3.3), séance complète, annuler, rechargement, import | Playwright | chaque envoi |
| Visuels | 6 écrans × 2 tailles × 2 thèmes comparés aux références (tolérance 0,1 %) | Playwright `toHaveScreenshot` | chaque envoi |
| Accessibilité | Contrastes, axe-core, navigation clavier | `npm run contrast`, axe | chaque envoi |
| Performance | Banc comparatif, budgets du §3.2 | `refonte/bench/measure.js` | chaque envoi |
| iPhone réel | Démarrage, 60 i/s, VoiceOver, installation, persistance | Safari Web Inspector | à chaque jalon |

---

## Questions pour toi

1. **Temps disponible** : la version raisonnable (4 semaines) ou l'ambitieuse (≈ 9 semaines) ?
2. **Quel iPhone** (modèle, version d'iOS) ? Cela fixe les seuils réels et la présence des View Transitions (iOS 18+).
3. **Léo** : acceptes-tu des poses fixes animées par mouvement léger au quotidien, et des vidéos seulement pour 8 moments rares ? Peux-tu produire (ou faire produire) les vidéos selon le cahier des charges du §3.4 ?
4. **Thèmes** : les 5 proposés (Clair, Sombre, OLED, Savane, Encre) te conviennent-ils, ou faut-il en retirer encore ?
5. **Sauvegarde** : un rappel d'export une fois par semaine te convient-il ?
6. **TOEIC** : quelle date d'examen ? Elle décide si le jalon 4 passe avant le 3.
7. **Mixeur d'ambiance et minuteur** : d'accord pour les sortir du cœur de l'appli ?

**Ce que je n'ai pas pu vérifier** : tout comportement propre à Safari iOS (vitesse réelle, 60 i/s, View Transitions, HEVC alpha, persistance du stockage, Web Push) ; la mémoire sur iPhone ; le score Lighthouse (non lancé) ; l'import `.apkg` (non porté) ; ton historique réel (la migration a été testée sur une sauvegarde produite par l'appli actuelle, pas sur la tienne : tu peux tester toi-même dans le prototype, Réglages › Importer, sans risque pour l'appli actuelle).
