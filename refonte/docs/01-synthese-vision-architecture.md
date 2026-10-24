# LH Cards — refonte complète

*Rapport de conception, prototypes et mesures. Octobre 2026.*

> **Ce que j'ai vu et ce que je n'ai pas vu.** J'ai lu le dépôt (branche `claude/ecstatic-edison-4i6b1u`, 12 476 lignes de code source), construit l'application, ouvert la version en ligne (identique octet pour octet au fichier `index.html` du dépôt) et je l'ai fait tourner dans Chromium (Playwright) en 390 × 800 et 1280 × 800, avec processeur ralenti ×4. Je n'ai **pas** d'iPhone : tout ce qui touche à Safari iOS est marqué « à vérifier sur iPhone » et la section 3.9 dit comment le vérifier. Tout ce qui est chiffré ici a été mesuré, sauf mention « estimé ».

---

## 1. Synthèse

**Vision.** *Ouvre, révise, c'est fait : LH Cards décide quoi, quand et combien, et ne perd jamais rien.* Un seul réglage (le temps par jour), tout le reste se règle seul à partir de l'historique de l'élève.

**Les 5 décisions structurantes**
1. **Svelte 5 + TypeScript + Vite**, découpé par écran (32 Ko gzip de JavaScript au démarrage, mesuré, contre 2,9 Mo aujourd'hui).
2. **Un moteur de révision pur et testé** : FSRS-6 identique à la référence officielle py-fsrs 6.3.2 (écart < 10⁻⁹ sur 1 052 révisions), file du jour automatique à partir d'un budget de temps, optimiseur avec garde-fous, calibration en boucle fermée, mode examen.
3. **Stockage par enregistrement** dans IndexedDB : une notation écrit 1 carte + 1 ligne d'historique (≈ 1 Ko) dans une transaction, au lieu de re-sérialiser tout l'état (4 Mo à volume réel). L'historique devient la source de vérité et n'est plus jamais tronqué.
4. **Mises à jour sans surprise** : la nouvelle version s'installe en arrière-plan et s'applique au lancement suivant. Plus aucun rechargement automatique pendant l'utilisation.
5. **Animation au compositeur uniquement** (`transform`/`opacity`), 4 durées et 3 courbes en jetons, View Transitions pour les changements d'onglet ; Léo en image fixe animée par transformations, et de courtes vidéos alpha seulement pour les moments rares.

**Les 3 plus gros gains attendus (mesurés sur prototype vs application actuelle, Chromium, CPU ×4)**
- **Relance de l'appli : ≈ 0,4 s au lieu de ≈ 2,3 s** jusqu'à l'accueil utilisable (×5,5, médiane de 3 passages). Poids d'une relance : ≈ 105 Ko au lieu de 2,9 Mo.
- **Écrans 8 à 10 fois plus légers** : 175 éléments DOM à l'accueil au lieu de 1 784 ; **aucune** tâche longue sur 45 notes en révision (l'application actuelle bloque 151 à 231 ms après chaque note pour re-sérialiser 4 Mo à volume réel).
- **Révision mieux réglée sans rien toucher** : en simulation sur un an, rétention obtenue 90,6 % pour 90,3 % visée et pic de charge à 33 min après 2 semaines d'absence, contre 88,0 % et un pic à 57 min avec la logique actuelle (20 nouvelles/jour fixes).

**Ambitieux vs raisonnable.** Version ambitieuse : tout réécrire en ≈ 43 jours de développement (≈ 9 semaines). Version raisonnable (4 semaines, un développeur) : correctifs immédiats dans l'appli actuelle (2 jours) puis nouvelle appli pour le chemin quotidien (accueil, révision, paquets, progrès, réglages, migration) ; le TOEIC reste dans l'ancienne version, accessible par un lien, jusqu'au jalon 4.

**Refonte ou améliorations ?** Les causes des deux bugs les plus visibles se corrigent en quelques heures dans le code actuel (je les donne en 3.8, « Phase 0 »), **faites-le d'abord, quoi qu'on décide**. Mais la fluidité « parfaite » ne s'obtient pas par retouches : le rendu par chaînes HTML de 1 200 à 1 700 éléments, la classe de 4 142 lignes et 2 098 lignes de CSS en couches sont la cause structurelle des saccades et du risque à chaque ajout. Mon avis : **correctifs immédiats + réécriture parallèle et progressive**, pas un remplacement en un seul coup.

---

## 2. Diagnostic de l'application actuelle (preuves)

Avant de proposer, j'ai cherché les causes des problèmes ressentis. Chacune est vérifiable dans le code ou par la mesure.

| Problème ressenti | Cause trouvée | Preuve |
|---|---|---|
| « Se relance deux fois » | Le service worker sert l'ancien `index.html` depuis le cache (instantané) et télécharge le nouveau en arrière-plan ; **4 s après le démarrage**, `boot.js` lit `version.json`, voit une version plus récente, vide le cache et fait `location.reload()`. Après chaque déploiement, le premier lancement est donc toujours suivi d'un rechargement. | `src/boot.js` lignes 9-25 ; `sw.template.js` (stratégie « cache puis réseau » sur `index.html`) ; `src/extras.js:418` (deuxième chemin de rechargement) |
| Saccades à l'ouverture des onglets | Chaque onglet est reconstruit d'un bloc par `innerHTML` : 1 155 à 1 500 éléments par écran. Premier affichage mesuré entre 111 et 261 ms (médianes) avec CPU ×4, avec des tâches bloquantes de 82 à 245 ms ; lors de la toute première mesure (onglet Paquets juste après le démarrage), 1 023 ms dont une tâche de 973 ms. Un pré-rendu « à l'inactivité » (`warmViews`) peut tomber pendant un toucher. | `src/app.js:1254` (`go`), `:802-821` ; mesures §Annexe D |
| Micro-gels en révision | Chaque note appelle `save()` : 250 ms plus tard, **tout l'état est re-sérialisé** (cartes, historique, médias en base64) et réécrit en un seul bloc. Avec 3 700 cartes et 40 000 lignes d'historique : 4 055 Ko, 151-231 ms de sérialisation + 71-675 ms d'écriture, CPU ×4 (15 mesures). Cela tombe pendant l'animation de la carte suivante. | `src/app.js:943-964`, `:901-904` ; `refonte/bench/save-cost.js` |
| Risque de perte de données | L'historique de révision est **tronqué à 40 000 lignes** (`REVLOG_MAX`) : à ≈ 110 révisions/jour, l'historique d'il y a plus d'un an disparaît sans prévenir, et avec lui la matière de l'optimiseur FSRS. | `src/app.js:329`, `:1200-1201` |
| Délais pas toujours « justes » | Le planificateur par défaut est encore **SM-2** (FSRS-5 seulement si on l'active par préréglage) ; nouvelles cartes à nombre fixe (20/jour), sans tenir compte de la charge future. | `src/app.js:288` (`scheduler: 'sm2'` par défaut) |
| Poids | Un seul fichier de 2,9 Mo (1,9 Mo de données dont 1,1 Mo de photos TOEIC et 251 Ko de banque TOEIC chargés à chaque démarrage) + 21 Mo d'animations de Léo en WebP animé (≈ 1 Mo par geste, 1,7 Mo pour l'attente). | `ls -la src/ mascot/` |

---

## 3.1 Vision et principes

**Promesse :** *Ouvre, révise, c'est fait : LH Cards décide quoi, quand et combien, et ne perd jamais rien.*

**7 principes non négociables**, chacun avec sa mesure :

| # | Principe | Ce que ça veut dire | Mesure qui le contredirait |
|---|---|---|---|
| 1 | **Zéro attente perçue** | L'accueil est utilisable avant que l'œil ait fini de se poser. | Relance > 1 s sur iPhone ; changement d'onglet > 100 ms |
| 2 | **La révision est sacrée** | Plein écran, rien d'autre que la carte : ni Léo, ni bannière, ni enregistrement visible, ni tâche longue. | Une tâche > 50 ms pendant une séance |
| 3 | **Les réglages par défaut sont les bons** | Un seul réglage d'étude : le temps par jour. Délais, nouvelles cartes, rétention, paramètres FSRS : automatiques. | Rétention simulée hors de ± 2 points de la cible ; un utilisateur qui doit ouvrir les réglages pour réviser |
| 4 | **Jamais de perte de données** | L'historique est la source de vérité, en ajout seul ; chaque écriture est atomique ; migration vérifiée ligne à ligne. | 1 seul échec sur les scénarios de test de perte |
| 5 | **Tout mouvement a un sens** | Une animation montre d'où vient ou où va quelque chose, ou confirme une action. Seulement `transform` et `opacity`. | Une animation sans rôle listé au catalogue ; une image perdue à 60 i/s |
| 6 | **Un geste, une action** | Les actions fréquentes sont à 1 ou 2 touchers du lancement. | Parcours clés au-delà des comptes du §3.3 |
| 7 | **Accessible par défaut** | Contraste AA vérifié par calcul, cibles ≥ 44 px, mouvement réduit, VoiceOver, clavier. | `npm run contrast` en échec ; une cible < 44 px |

### Inventaire : garder, fusionner, retirer, automatiser

| Fonction actuelle | Décision | Raison |
|---|---|---|
| FSRS-5 + optimiseur | **Garder, mettre à jour** en FSRS-6 | Meilleur modèle (décroissance de l'oubli apprise, w20), optimiseur automatique mensuel |
| SM-2 en alternative | **Retirer** | Deux planificateurs = deux comportements à tester. Les cartes SM-2 sont converties à la migration |
| Options par paquet, préréglages | **Retirer** | Remplacées par l'adaptation automatique ; la seule différence légitime entre paquets (un examen) passe par les objectifs d'examen |
| Étapes d'apprentissage | **Automatiser** | Raté → revoir dans la séance après 3-5 cartes ; Bien → jours (court terme FSRS-6). Pas de réglage |
| Sangsues | **Garder, adoucir** | Détectées à 6 oublis ; plus de suspension silencieuse : liste « à reformuler » proposée |
| Enfouissement des cartes sœurs | **Automatiser** | Toujours actif : une carte par note et par jour |
| Équilibrage de charge, « jours faciles » | **Fusionner, automatiser** | Toujours actif dans le choix du jour ; les jours légers deviennent une préférence de semaine facultative |
| Annuler / rétablir | **Garder** (annuler seulement) | Annuler la dernière note (bouton + ⌘Z). « Rétablir » sert peu en révision |
| Modes quiz, écriture, chrono | **Fusionner** | Deviennent des **types de réponse** d'une carte (QCM, saisie) dans la séance normale ; le chrono disparaît (pression sans valeur d'apprentissage) |
| Révisions personnalisées, paquets filtrés | **Fusionner** | « Réviser ce paquet », « Réviser pour cet examen », « Refaire mes erreurs » : trois boutons couvrent 95 % des usages |
| Objectifs d'examen J-x | **Garder, renforcer** | Pilotent la rétention visée et la préparation affichée |
| Paquets et sous-paquets | **Garder** | Deux niveaux maximum (matière › chapitre) |
| Bibliothèque de paquets | **Garder** | Chargée à la demande (pas au démarrage) |
| Trous, inversées, occlusion d'image | **Garder** | Types de note standard |
| Types de notes personnalisés | **Retirer de l'interface** | Usage marginal ; conservés à la migration sous forme rendue (recto/verso figés) |
| Édition riche | **Garder, simplifier** | Gras, italique, liste, image, son. Pas de couleurs libres |
| Recherche à la Anki | **Simplifier** | Recherche plein texte instantanée + filtres en puces (paquet, état, drapeau). Syntaxe avancée retirée |
| Édition en masse | **Garder** (déplacer, suspendre, supprimer) | Sélection dans la liste virtualisée |
| Import/export JSON, CSV, `.apkg` | **Garder** JSON + CSV ; `.apkg` **reporter** (import seul au jalon 3) | L'export `.apkg` (300 lignes) sert surtout à quitter l'appli ; à reprendre si demandé |
| Corbeille 30 jours | **Garder** | Filet de sécurité gratuit |
| Sauvegardes automatiques (14 copies en base) | **Remplacer** | 7 instantanés quotidiens légers + rappel d'export hebdomadaire vers Fichiers/iCloud (un toucher) |
| Banque TOEIC, mini-test, test complet, erreurs, photos | **Garder** | Chargée à la demande ; les erreurs deviennent des cartes |
| Statistiques façon Anki | **Réduire** à 4 réponses | Est-ce que je retiens ? Combien je travaille ? Qu'est-ce qui arrive ? Où j'en suis par matière ? |
| Série + gel de série | **Garder la série, automatiser le gel** | 1 jour manqué par semaine ne casse pas la série ; plus de stock de « gels » à gérer |
| Bilan du jour | **Fusionner** dans l'écran de fin de séance | |
| Sons de l'appli | **Garder** (4 sons) | Retourner, noter, fin ; synthétisés, 0 octet à charger |
| Mixeur d'ambiance (16 sons, 4 Mo) | **Reporter** (module facultatif chargé à la demande) | Hors du cœur de l'apprentissage ; 4 Mo |
| Minuteur de concentration | **Fusionner** | Le mode « 5 min » et le budget quotidien le remplacent |
| 16 thèmes | **Réduire à 5 + Auto** | Clair, Sombre, OLED, Savane, Encre : chacun vérifié en contraste |
| Logo adaptatif | **Garder** | Une couleur d'accent par thème |
| Synchro Supabase (désactivée) | **Retirer** | Non utilisée ; voir §3.2 pour une synchro future |
| Mode voix | **Reporter** | Voir §3.6 |
| Léo (21 vidéos, 180 phrases, voix) | **Garder, refaire le pipeline** | Voir §3.4 : ≈ 1,5 Mo au total au lieu de 21 Mo |

---

## 3.2 Architecture technique cible

### Choix de la pile

| Critère | Vanilla + Web Components (Lit) | Preact + Signals | **Svelte 5 (choisi)** | React 19 |
|---|---|---|---|---|
| Poids du moteur de rendu (gzip) | ≈ 6 Ko | ≈ 6 Ko | ≈ 10-15 Ko selon les fonctions utilisées | ≈ 60 Ko (react + react-dom) |
| Poids mesuré du prototype complet au démarrage | — | — | **32 Ko JS + 4,8 Ko CSS gzip** (moteur FSRS, état, 3 écrans compris) | — |
| Démarrage sur iPhone milieu de gamme (estimé) | très bon | très bon | très bon (compilé, pas de DOM virtuel) | moyen (hydratation + DOM virtuel) |
| Mises à jour fines (une carte change → un nœud change) | à la main | oui (signaux) | **oui, natif** (runes `$state`/`$derived`) | non (re-rendu du composant) |
| CSS isolé par composant | Shadow DOM (contraignant pour les thèmes) | non (outil en plus) | **oui, natif** | non (outil en plus) |
| Transitions/animations intégrées | non | non | **oui** (`transition:`, `animate:`) | non |
| Maintenance par un étudiant aidé d'une IA | moyenne (beaucoup de code « plomberie ») | bonne | **bonne** (fichiers lisibles, peu de code) | bonne mais lourde |
| Risque | faible | faible | faible (v5 stable depuis 2024) | faible |

**Décision : Svelte 5 + TypeScript + Vite.** Trois raisons mesurables : (1) le poids — tout le prototype démarre avec 32 Ko gzip ; (2) le **CSS isolé par composant** supprime à la racine le problème des « couches de CSS » (2 098 lignes globales aujourd'hui) ; (3) la réactivité fine supprime la reconstruction d'écrans par `innerHTML`. TypeScript attrape les erreurs de forme de données, ce qui compte pour la migration. Le moteur de révision reste en TypeScript pur, sans dépendance à Svelte.

### Modèle de données (schéma v1)

L'historique est **la source de vérité** ; l'état de chaque carte n'est qu'un cache recalculable en rejouant l'historique (`replay`, testé).

```text
decks    { id, name, emoji, parent|null, created, mod }
notes    { id, type: basique|inversee|trous|image|perso, fields{…}, tags[], created, mod }
cards    { id, noteId, deckId, ord, front, back,           ← rendu figé (fidélité de migration)
           flag, marked, suspended, buriedUntil,
           sched { phase: new|learning|review|relearning, s, d, due, last, reps, lapses },
           origin: historique|fsrs|sm2|nouvelle, created, mod }
revlog   (ajout seul) { card, t, g(1-4), phase, elapsed(j), ivl(j), s, d, ms }   index: card
goals    { id, name, date, deckIds[] }
media    { hash → Blob }                                    ← plus de base64 dans l'état
meta     { schema, settings{ ambiance, budgetMin, sons, w[21] }, legacy, snapshots }
```

**Stockage : IndexedDB, une table par type, écritures unitaires.** Comparaison :

| Option | Pour | Contre | Décision |
|---|---|---|---|
| IndexedDB par enregistrement | Natif, 0 Ko, transactions, index ; Safari 16.4+ stable | API verbeuse (une couche de 90 lignes suffit : `src/data/db.ts`) | **Choisi** |
| SQLite WASM sur OPFS | Requêtes SQL, très robuste | ≈ 900 Ko de WASM, accès OPFS synchrone seulement en Worker, gain nul à 4 000 cartes | Refusé |
| Un seul JSON (actuel) | Simple | 4 Mo réécrits à chaque note, risque de corruption totale | Abandonné |

**Migrations versionnées** : `db.ts` contient `upgrade(db, from)` ; chaque version ajoute ses tables/index, n'en supprime jamais. Les migrations de *contenu* (ex. format v6 → v1) sont des fonctions pures testées (`src/data/migrate.ts`).

**Sauvegarde hors appareil** : bouton « Exporter » → feuille de partage iOS (`navigator.share` avec un fichier) → « Enregistrer dans Fichiers » (iCloud Drive). Rappel discret une fois par semaine sur l'accueil. Le fichier exporté est relu et vérifié avant d'afficher « Exporté ».

**Synchronisation** : **non au jalon 1-6** (l'utilisateur a choisi l'export manuel). Si elle vient : chiffrement de bout en bout (clé dérivée d'une phrase secrète, AES-GCM), historique fusionné par union (il est en ajout seul, donc sans conflit), état des cartes recalculé par rejeu, contenu des notes en « dernier modifié gagne » par champ.

**Stratégie « zéro perte »** : (1) historique en ajout seul, jamais tronqué ; (2) une transaction par action ; (3) `navigator.storage.persist()` demandé dès la première révision (sur iPhone, une PWA installée est protégée de l'effacement après 7 jours) ; (4) l'ancien état reste stocké tel quel 30 jours après la migration ; (5) export vérifié par relecture ; (6) 7 instantanés quotidiens en base (≈ 300 Ko chacun sans médias).

### Moteur de révision séparé et testable

Livré et testé dans `refonte/app/src/engine/` (détail au §3.5) :

| Fichier | Rôle | Tests |
|---|---|---|
| `fsrs.ts` | Modèle FSRS-6 pur (21 paramètres) | Identique à py-fsrs 6.3.2 sur 1 052 révisions (écart < 10⁻⁹) |
| `scheduler.ts` | Note → nouvel état : étapes, flou reproductible, équilibrage, examen, aperçu des boutons, rejeu | 8 tests |
| `queue.ts` | File du jour, nouvelles cartes adaptatives, retard sans avalanche, rétention visée, calibration | 7 tests |
| `optimizer.ts` | Ajustement des 21 paramètres sur l'historique, validation croisée | 1 test (retrouve les paramètres d'un élève simulé) |
| `simulate.ts` | Élève virtuel, 1 000 cartes, 365 jours | 1 test (rétention ± 2 points, budget tenu) |

### Rendu : des changements d'écran instantanés

- **Pas de reconstruction massive** : Svelte met à jour les nœuds concernés ; un écran fait 65 à 167 éléments (mesuré) au lieu de 1 155 à 1 500.
- **Virtualisation** : toute liste longue (cartes, résultats de recherche) n'a que les lignes visibles + 6 de marge dans le DOM (`VirtualList.svelte`) : 3 700 cartes → ≈ 25 lignes.
- **Découpage par écran** : Progrès, TOEIC, Révision sont des morceaux séparés, **préchargés à l'inactivité** après le démarrage ; la bibliothèque et la banque TOEIC ne sont chargées qu'à leur première ouverture.
- **Transitions sur le compositeur** : `transform`/`opacity` seulement ; View Transitions API (Safari 18+, Chrome) pour les onglets, avec repli CSS.
- **Calculs dérivés mémorisés** : la file du jour et les statistiques sont des `$derived` recalculés une fois par modification, pas à chaque affichage.
- **Optimiseur en Web Worker** une fois par mois, jamais pendant une séance.

### Performance : budget chiffré

| Mesure | Budget | Prototype (mesuré, Chromium CPU ×4) | Actuel |
|---|---|---|---|
| JavaScript initial (gzip) | ≤ 60 Ko | 32 Ko | 1,4 Mo (fichier unique : 2,9 Mo brut, 1,39 Mo gzip, données comprises) |
| CSS initial (gzip) | ≤ 10 Ko | 4,8 Ko | inclus dans le fichier unique |
| Relance → accueil utilisable | ≤ 600 ms (iPhone : ≤ 1,2 s) | 377 ms (2 089 cartes), 411 ms (3 700) | 2 275 ms |
| Changement d'onglet (toucher → 2ᵉ image) | ≤ 100 ms | 1er affichage 60-122 ms, retour 45-83 ms | 1er affichage 87-261 ms, retour 53-189 ms |
| Tâche la plus longue en séance | ≤ 50 ms | 0 ms (45 notes) | médiane 82 ms, max 145 ms |
| Éléments DOM par écran | ≤ 400 | ≤ 222 au total | 1 155 à 1 670 par écran |
| Mémoire sous iOS | ≤ 150 Mo | à mesurer sur iPhone | à mesurer |

**Chargement par paliers** : (1) coquille HTML + couleur de fond du thème dès le premier octet ; (2) cœur (32 Ko) + données de l'élève depuis IndexedDB ; (3) à l'inactivité : écrans Révision, Progrès, TOEIC ; (4) à la demande : bibliothèque, banque TOEIC et photos, vidéos de Léo.

**Service worker sans surprise** : pré-cache de la liste exacte des fichiers de la version (générée au build), **sans `skipWaiting`** : une nouvelle version attend que l'appli soit fermée et s'applique au lancement suivant. Plus de `version.json` ni de `location.reload()`. Un petit point sur l'icône Réglages signale « mise à jour prête ». Manifeste complet (`id`, icônes `any` et `maskable` séparées, couleurs, orientation).

### Qualité

- **Arborescence** : Annexe C. Un composant = un fichier `.svelte` avec son CSS ; le moteur ne dépend de rien.
- **Conventions** : TypeScript strict ; jetons de design obligatoires (aucune couleur ou durée en dur dans un composant, vérifiable par recherche) ; textes en français dans les composants ; commentaires en français.
- **Tests** : unitaires du moteur et de la migration (`npm test`, 20 tests + 1 facultatif, 4 s) ; e2e Playwright (parcours clés, aucun message d'erreur) ; tests visuels (captures 390/1280 × clair/sombre comparées à des références) ; contrastes (`npm run contrast`).
- **CI à chaque envoi** : tests + build + **banc de performance** (`refonte/bench/measure.js`) qui échoue si un budget est dépassé de plus de 20 %.
