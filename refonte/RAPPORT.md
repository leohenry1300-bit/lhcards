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


---

## 3.3 Design system et interface

### Direction artistique

**Une identité « carnet d'étude, crinière safran ».** Un gris très légèrement bleuté (papier de cahier, jamais crème), une seule couleur d'accent — le **safran de la crinière de Léo** — réservée à l'action principale (« Réviser ») et à l'onglet actif. Les quatre couleurs de notation (rouge, ocre, vert, bleu) n'apparaissent que sur les boutons de note et les barres de réussite : elles portent un sens, jamais une décoration.

- **Typographie** : *Bricolage Grotesque* pour les titres et les chiffres (personnalité, chiffres larges pour « 65 cartes », « J-12 ») ; *Atkinson Hyperlegible Next* pour la lecture, dessinée par le Braille Institute pour distinguer les lettres ambiguës (I/l/1, O/0) : choix utile pour 3 700 cartes de vocabulaire. Échelle fixe à 7 tailles (Annexe A). En production : polices auto-hébergées et réduites aux caractères latins (≈ 2 × 25 Ko woff2).
- **Formes** : rayons 10 / 16 / 24 px ; une seule ombre douce pour les panneaux, une ombre plus profonde réservée à la carte de révision (c'est l'objet qu'on manipule).
- **Iconographie** : un jeu unique au trait (24 px, trait 2 px, extrémités arrondies), en SVG dans le code ; pas d'emoji dans l'interface (les emoji restent comme « couverture » de paquet, choisis par l'élève).
- **Textures** : aucune. La matière vient de Léo.

**Thèmes : 5 + Auto** (au lieu de 16), uniquement des redéfinitions de jetons de couleur :

| Thème | Usage | Plus faible contraste texte (calculé) |
|---|---|---|
| Auto | suit le réglage clair/sombre de l'iPhone | — |
| Clair | par défaut | 4,66:1 (accent sur blanc) |
| Sombre | soir | 6,07:1 |
| OLED | noir pur, économise la batterie des iPhone OLED | 6,70:1 |
| Savane (signature) | crépuscule chaud, or de la crinière | 6,83:1 |
| Encre (signature) | papier bleuté, encre bleu nuit | 5,20:1 |

Les 55 paires texte/fond (5 thèmes × 11) sont vérifiées par `npm run contrast` : **toutes ≥ 4,5:1 (WCAG AA)**. Si l'élève veut encore retirer des thèmes : supprimer un bloc de jetons, rien d'autre.

### Maquettes écran par écran

Les écrans marqués ▶ sont **jouables dans le prototype** (`refonte/proto/`) ; les autres sont spécifiés ci-dessous. Captures : `refonte/captures/`.

**▶ Accueil** (téléphone : une colonne ; ordinateur : rail de navigation à gauche + colonne de 760 px)
1. Date + salutation ; pastille de série (flamme + jours).
2. **Carte « Aujourd'hui »** : le nombre de cartes en très grand, la durée estimée (« ≈ 13 min · 53 à revoir, 12 nouvelles »), bouton **Réviser** (48 px de haut, accent plein) et bouton secondaire **5 min**. Léo à droite (salue une fois par jour, sinon respire). Si du retard existe : « 18 cartes en retard attendront demain : ta séance reste à 20 min. »
3. **Examens** : nom, J-x, barre « tu te souviens de 56 % du programme », mention des révisions renforcées dans les 21 derniers jours.
4. **Les 7 prochains jours** : petites colonnes de charge prévue.
5. **Ce que tu sais** : « ≈ 1 240 cartes sur 3 700 » (somme des probabilités de rappel), lien vers Progrès.
États : tout fait (Léo fier, « Demain : 41 cartes ») ; premier lancement (onboarding) ; retard.

**▶ Révision** — plein écran, sans navigation. Barre du haut : Fermer (48 px), barre de progression fine, Annuler. Carte centrale (62 % de la hauteur, max 480 px) ; toucher = retourner. Après retournement, les 4 boutons montent (160 ms) avec le délai sous chacun (« 10 min · 2 j · 4 j · 9 j »). Gestes : glisser la carte retournée à droite = Bien, à gauche = Raté (seuil 90 px, étiquette qui apparaît progressivement). Clavier : Espace/Entrée, 1-4, ⌘Z, Échap. Sur ordinateur, même mise en page centrée à 640 px.

**▶ Fin de séance** — Léo fier (petit bond), « 38 cartes en 11 min · 89 % de réussite », barre de répartition des notes qui se dessine, « Demain : 41 cartes. Les 4 cartes ratées reviendront au bon moment. », bouton Terminer.

**▶ Paquets** — champ de recherche toujours visible (résultats instantanés, liste virtualisée) ; liste des matières avec nombre de cartes, % commencé, pastille des cartes dues ; toucher → chapitres + « Réviser ce paquet ». *Non prototypé :* bouton « + » (nouvelle carte), mode sélection (appui long) pour l'édition en masse, bibliothèque à ajouter.

**Éditeur de carte** (spécifié) — feuille qui monte du bas (téléphone) ou panneau latéral (ordinateur). Champs Recto / Verso / Indice, barre d'outils minimale (gras, italique, liste, image, son, trou `[…]`). Aperçu de la carte en direct. Bouton « Enregistrer » ou « Enregistrer et suivante » (garde le paquet). Validation : recto vide = bouton grisé avec explication.

**▶ Progrès** — 4 blocs : jauge « Tu te souviens : 88 % » (repère de l'objectif à 90 %), « Ton travail » (30 jours), « Ce qui arrive » (14 jours), « Par matière ». Rien d'autre.

**▶ TOEIC (entrée)** — score estimé, 3 choix (mini-test 20 min, test complet 2 h, refaire mes erreurs), parties 1 à 7. *Examen en conditions réelles (spécifié)* : plein écran, minuteur discret en haut, audio joué une fois (bouton désactivé ensuite), navigation question par question, aucun son d'interface, aucune animation sauf le passage de question (fondu 120 ms).

**Objectifs / examens** — dans Réglages › Examens : nom, date, matières concernées. Effet automatique décrit en une phrase.

**▶ Réglages** — 4 réglages : temps par jour (5 à 60 min), apparence (6 pastilles), sons, examens ; puis Sauvegarde (Exporter, Importer depuis l'ancienne appli avec rapport de vérification). Tout le reste se règle seul ; la ligne du bas dit ce que fait le moteur.

**Onboarding** (spécifié, 3 écrans maximum) — (1) Léo salue : « Je m'occupe de quand réviser. Toi, tu révises. » ; (2) « Combien de temps par jour ? » (10 / 20 / 30 min, 20 présélectionné) ; (3) « Tu as un examen ? » (facultatif) ou « Importer mes cartes de l'ancienne appli ». Ensuite, l'accueil avec une première séance prête.

**États vides et erreurs** — Paquet vide : « Ce paquet n'a pas encore de carte » + « Ajouter une carte » / « Choisir dans la bibliothèque ». Recherche sans résultat : « Aucune carte ne contient “xyz” ». Stockage refusé (navigation privée) : bandeau persistant « Tes révisions ne seront pas gardées dans ce mode. Ouvre LH Cards depuis l'écran d'accueil. » Import invalide : rapport ligne par ligne, rien n'est écrit (prototypé).

### Parcours clés mesurés en gestes

| Parcours | Actuel (compté à la lecture du code, à confirmer sur iPhone) | Refonte (prototype ou spécification) |
|---|---|---|
| Ouvrir et réviser 10 cartes | 1 (icône) + attente écran de chargement + 1 (Réviser) + 10 × 2 = **22** | 1 + 1 + 10 × 2 = **22**, sans écran de chargement ; ou 1 + 1 + 10 × 2 en gestes (retourner + glisser) à une main |
| Ajouter une carte | Paquets › paquet › Ajouter › 2 champs › Enregistrer ≈ **6** + saisie | Paquets › « + » › 2 champs › Enregistrer = **4** + saisie (le dernier paquet est présélectionné) |
| Réviser avant un examen | Paramètres d'objectif ou révision personnalisée ≈ **5-7** | Accueil › ligne de l'examen › Réviser = **2** |
| Retrouver une carte | Paquets › recherche › saisie ≈ **3** | Paquets › saisie (champ déjà visible) = **2** |
| Voir sa progression | **1** | **1** |

### Accessibilité

Mouvement réduit (jetons de durée ramenés à ≤ 160 ms, retournement remplacé par un fondu, Léo immobile) ; texte agrandi (tailles en `rem`, mises en page qui passent à la ligne, testées à 200 %) ; VoiceOver (rôles `dialog`, `progressbar`, `meter`, `radiogroup`, libellés en français sur chaque bouton-icône, annonces `aria-live` en fin de séance) ; clavier complet en révision (Espace, 1-4, ⌘Z, Échap) et focus visible de 3 px ; contrastes AA calculés ; cibles ≥ 48 px (barre d'onglets 56 px, boutons de note 64 px).

---

## 3.4 Animation et « sensation »

### Principes

1. **Ce qui bouge a une raison** : montrer d'où vient un élément, où il va, ou confirmer une action. Rien ne bouge « pour faire joli ».
2. **60 i/s ou rien** : seulement `transform` et `opacity` (composés par le GPU) ; si une animation ne tient pas 60 i/s sur iPhone, elle est retirée, pas ralentie.
3. **Hiérarchie** : une seule chose bouge à la fois au premier plan ; les mouvements secondaires (barres qui se remplissent) arrivent ensuite, décalés de 12 à 30 ms par élément.
4. **Entrer en douceur, sortir vite** : ce qui arrive décélère (courbe *sortie*), ce qui part accélère et dure moins longtemps.
5. **Mouvement réduit respecté**, batterie préservée : aucune animation en boucle hors de l'accueil ; Léo s'arrête quand l'onglet est caché.

### Jetons de mouvement

| Jeton | Durée | Courbe | Usage |
|---|---|---|---|
| `instant` | 90 ms | sortie `cubic-bezier(.2,.8,.2,1)` | retour d'appui (bouton enfoncé à 97 %) |
| `rapide` | 160 ms | sortie | changements d'état locaux : onglet actif, apparition des boutons de note, interrupteurs |
| `standard` | 260 ms | sortie / *ressort* | changement d'écran, retournement de carte, arrivée de la carte suivante |
| `emphatique` | 480 ms | sortie / *ressort* | moments rares : fin de séance, palier de série, barres qui se dessinent |
| *entrée* | — | `cubic-bezier(.4,0,1,1)` | ce qui quitte l'écran (carte notée : 190 ms) |
| *ressort* | — | `linear(…)` 9 points, dépassement 7 % | arrivées « vivantes » sans librairie |

### Catalogue des animations

| Animation | Déclencheur | Durée / courbe | Propriétés | Rôle UX | Technique | Coût |
|---|---|---|---|---|---|---|
| Changement d'onglet | toucher un onglet | 160 ms sortie de l'ancien, 260 ms entrée (6 px) | opacity, transform | situer le nouvel écran sans « saut » | View Transitions (Safari 18+), repli animation CSS | 2 couches compositeur, ≈ 0 ms de script |
| Pastille de l'onglet actif | idem | 260 ms ressort | transform | montrer où l'on va | CSS | négligeable |
| Ouverture d'un paquet | toucher la ligne | 260 ms | opacity, translateY | relier le contenu à sa ligne | CSS | négligeable |
| Retournement de carte | toucher / Espace | 260 ms sortie | rotateY 3D | la réponse est « derrière » la question | CSS 3D, `backface-visibility` | 1 couche ; repli fondu en mouvement réduit |
| Notation : départ de la carte | note | 190 ms entrée | translateX ±120 % + rotation ±8° (Raté à gauche, Bien/Facile à droite, Difficile vers le bas) | la direction *dit* la note | CSS | négligeable |
| Glisser pour noter | doigt sur la carte retournée | suit le doigt, seuil 90 px | transform | geste à une main, réversible jusqu'au lâcher | Pointer Events | 1 écriture de style par image |
| Carte suivante | après départ | 260 ms ressort | translateY 18 px, scale .96→1, opacity | rythme, sensation de pile | CSS | négligeable |
| Correction d'une réponse tapée (mode saisie) | validation | 160 ms | opacity des lettres, fond vert/rouge des écarts | voir *où* est la faute | CSS | négligeable |
| Barre de progression de séance | chaque note | 260 ms | scaleX | sentir l'avancée | CSS | négligeable |
| Série qui augmente | première note du jour | 480 ms ressort | scale de la flamme 1→1,25→1 + chiffre qui monte de 8 px | célébrer la régularité, une fois par jour | WAAPI | négligeable |
| Fin de séance | dernière carte | 480 ms ressort, barres décalées de 120 ms | transform, scaleX | récompense mesurée, lisible | CSS | négligeable |
| Graphiques qui se dessinent | arrivée sur Progrès | 480 ms, 12-18 ms d'écart par barre | scaleY, stroke-dashoffset | lire le sens de l'évolution | CSS sur SVG | ≈ 50 éléments animés |
| Listes qui apparaissent | arrivée d'écran | aucune cascade (sauf graphiques) | — | la cascade retarde la lecture : retirée | — | 0 |
| Tirer pour actualiser | — | **retiré** | — | les données sont locales : rien à actualiser | — | 0 |
| Bascule de thème | choix d'une ambiance | 160-260 ms fondu croisé de toute la page | opacity | éviter le flash brutal | View Transitions | 1 capture d'écran par le navigateur |
| Retour haptique | retourner, noter, fin | 4-12 ms | — | confirmation tactile | `navigator.vibrate` (Android) ; **iOS n'a pas d'API de vibration web** : retour sonore + visuel seulement | 0 |
| Sons | idem | 70-220 ms | — | rythme, confirmation | Web Audio synthétisé (0 octet), coupé par le réglage « Sons » | négligeable |

### La révision comme expérience

Le **rythme** est la récompense : toucher → la carte pivote (260 ms) → les boutons montent (160 ms) → note → la carte part dans la direction de la note avec un son doux (une note pour Difficile, deux notes ascendantes pour Bien/Facile, une note grave et courte pour Raté) → la suivante monte de la pile. Pas de compteur de points, pas de confettis, pas de Léo : rien qui détourne l'attention de la carte. La barre de progression et le nombre de cartes restantes suffisent. Les cartes ratées reviennent 3 à 5 cartes plus loin (jamais immédiatement, ce qui serait de la mémoire de travail, pas de la mémoire).

### Léo repensé

**Où et quand.** Accueil (une salutation par jour, puis il respire), fin de séance (fier, ou encourageant si la séance a été difficile), jalons (série de 7/30/100 jours, J-7 et J-1 d'un examen), retour après une absence (il « se réveille »). **Jamais** pendant une révision ni un test TOEIC, jamais dans Réglages. Au plus **une** apparition animée par écran et par visite.

**Rôles** : accueil (chaleur), encouragement (après une séance difficile : « Les cartes ratées sont celles qui progressent le plus »), rythme (« 3 jours de suite »), jalons, examens (« J-7 : on resserre les révisions de marketing »). Les ≈ 180 phrases actuelles sont gardées et triées par rôle ; une phrase n'est pas répétée avant 20 autres.

**Pipeline (décision).** Le style « pâte à modeler 3D » ne se redessine pas en vectoriel sans perdre son identité. Donc :

| Couche | Technique | Poids | Usage |
|---|---|---|---|
| Pose fixe | AVIF/WebP, 512 × 512, fond transparent | ≈ 15-25 Ko par pose, 3 poses | Affichage par défaut, économie de données |
| Mouvement d'attente | **transformations CSS** sur l'image fixe (respiration 4 s, clignement par superposition de 2 images de paupières) | 0 Ko de plus | remplace la boucle d'attente actuelle (1,7 Mo) |
| Gestes (salut, fierté, rugissement, réveil…) | **vidéo courte à fond transparent** : HEVC avec alpha (Safari/iOS) + VP9 alpha WebM (Chrome/Android), 360 × 360, 24 i/s, 1,5-2,5 s | ≈ 120-250 Ko chacune | moments rares, chargés à la demande, gardés en cache |

Total visé : **≈ 1,5 Mo pour 8 gestes au lieu de 21 Mo**. Toutes les vidéos **commencent et finissent sur la même image neutre** que la pose fixe : l'enchaînement pose → geste → pose est donc invisible (fin de l'effet « collé »). La vidéo n'est lancée qu'une fois prête (`canplaythrough`), sinon on reste sur la pose fixe animée. Le prototype montre la couche « pose + transformations » avec un Léo vectoriel provisoire (`Leo.svelte`, ≈ 2 Ko).

Voix : courts sons de lionceau synthétisés gardés, joués seulement quand l'élève touche Léo (jamais automatiquement). Mode économie de données (`navigator.connection.saveData`) ou mouvement réduit : poses fixes uniquement.

**Cahier des charges des assets**

- **Liste** : poses fixes `neutre`, `content`, `pense` ; gestes `salut`, `fier` (petit bond, yeux rieurs), `encourage` (pouce levé), `rugit` (paliers de série), `reveil` (bâille, s'étire : retour après absence), `montre` (désigne le bouton Réviser, premier lancement), `examen` (cartable, lunettes), `console` (tapote l'épaule : séance difficile).
- **Cadrage constant** : toile carrée 1024 × 1024 ; Léo centré horizontalement, ligne des pattes à 92 % de la hauteur, sommet de la crinière à 8 % au maximum ; caméra fixe, focale identique, lumière principale en haut à gauche, ombre portée **absente** (ajoutée en CSS).
- **Animation** : 24 i/s, 36 à 60 images ; première et dernière image **identiques à la pose `neutre`** (tolérance 0 px) ; aucun flou de mouvement sur les contours (sinon halo sur fond transparent).
- **Fond** : alpha natif (ProRes 4444) ou fond vert uni `#00B140` pour détourage.
- **Livraison** : ProRes 4444 maîtres → `ffmpeg -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 34` (WebM) et HEVC alpha via `avconvert` / Compressor sur Mac ; posters AVIF de la première image.
- **Exemple de consigne pour un outil d'animation par IA** (image de départ = pose neutre actuelle) : *« Le lionceau en pâte à modeler de l'image lève la patte droite et fait un petit signe de la main, sourit, puis revient exactement à la pose de départ. Caméra fixe, cadrage inchangé, fond vert uni #00B140, éclairage doux venant du haut à gauche, 2 secondes, mouvement fluide, aucun autre élément dans l'image. »* Même structure pour chaque geste ; refuser tout résultat dont la dernière image diffère de la première.

---

## 3.5 Le système de révision « parfait »

### Algorithme cible (implémenté et testé)

- **Modèle** : FSRS-6, 21 paramètres, valeurs par défaut officielles, **identique à py-fsrs 6.3.2** (test automatique sur 1 052 révisions). Effet court terme (révisions du même jour) inclus.
- **Étapes** : sans réglage. Nouvelle carte : Raté → revient dans la séance (après 3-5 cartes) ; Difficile → 6 min ; Bien/Facile → jours selon la stabilité initiale (Bien ≈ 2 jours). Carte oubliée : 10 min puis jours.
- **Flou** : plages officielles FSRS, mais tiré d'un hachage de l'identifiant (reproductible, donc testable).
- **Équilibrage de charge** : toujours actif ; dans la plage de flou, le jour le moins chargé, avec une pénalité proportionnelle à l'allongement. *Cette pénalité vient d'un défaut trouvé au simulateur* : sans elle, l'équilibrage choisissait toujours les jours lointains (moins chargés), allongeait les intervalles et faisait perdre ≈ 1 point de rétention.
- **Optimisation automatique** : une fois par mois, en Web Worker, dès 400 révisions « à long terme ». Adam sur la perte logarithmique, bornes officielles, régularisation vers les paramètres actuels, **adoption seulement si les nouveaux paramètres prédisent mieux sur 20 % de cartes mises de côté**. Sur un élève simulé qui oublie plus vite que la moyenne, l'optimiseur retrouve ses paramètres (perte 0,4134 contre 0,4137 avec les vrais paramètres, 0,4180 avec ceux par défaut) en ≈ 3,5 s (Node).
- **Calibration en boucle fermée** : sur les 60 derniers jours, si l'élève réussit moins souvent que prévu, la cible est relevée d'autant (± 3 points maximum, dès 300 révisions). Garde-fou contre un modèle encore imparfait entre deux optimisations.
- **Rétention visée** : 90 % (meilleur compromis effort/rétention selon les données FSRS). **Mode examen** : pour les cartes d'un examen, montée linéaire jusqu'à 95 % sur les 21 derniers jours, et toute carte dont la mémoire ne tiendrait pas jusqu'au jour J (R prévue < 95 %) est revue avant, réparti sur les 6 derniers jours.

### File de révision

1. Cartes en apprentissage échues (minutes).
2. Révisions échues **de la plus menacée à la moins menacée** (R la plus basse d'abord), une seule carte par note.
3. Nouvelles cartes **intercalées** (une toutes les ~4 révisions), cartes d'examen d'abord.
4. **Limite automatique = le budget de temps** (20 min par défaut), estimé avec les durées réelles de l'élève (temps par carte, étapes comprises).
5. **Nouvelles cartes adaptatives** : seulement s'il n'y a pas de retard, en nombre tel que la place prise par leurs futures révisions (≈ 3,5 révisions dans les 2 semaines) tienne dans le budget de la semaine. Pas de « 20 nouvelles par jour » fixes.
6. **Retard sans avalanche** : au-delà du budget, les échues attendent le lendemain (les plus solides d'abord), jamais de séance de 60 min après une absence. Mesuré : après 14 jours d'absence, pic à 33 min puis retour sous 25 min en 4 jours, contre 57 min avec la logique actuelle.
7. **Mode 5 minutes** : même file, coupée à 5 min.

### Types de cartes

| Type | Statut |
|---|---|
| Basique, inversée (2 cartes sœurs), texte à trous, image masquée | gardés |
| Audio (prononciation, écoute TOEIC) | gardé ; enregistrement micro facultatif |
| **QCM généré** | nouveau, local : 3 distracteurs tirés des réponses du même chapitre (même longueur, même catégorie grammaticale si disponible). Utilisé pour les 2 premières révisions d'une carte nouvelle, puis rappel libre (plus efficace) |
| **Saisie** | sur demande par carte (orthographe anglaise) ; comparaison tolérante aux accents et fautes de frappe (distance de Levenshtein ≤ 1 pour 8 lettres) |

### Aide à la création de cartes

- **Import de cours PDF** (à la demande, pdf.js chargé seulement à ce moment) : extraction du texte, détection locale des définitions (« X : Y », « X est … », listes à puces) → cartes proposées, que l'élève coche.
- **Avec une IA, sans coût obligatoire** : bouton « Préparer pour ChatGPT/Claude » qui copie le texte du cours + une consigne de format (`question ;; réponse ;; indice`), puis « Coller le résultat » qui importe les cartes. Aucun service payant, aucune clé dans l'appli.
- **Photo d'un cours** : reporté (voir 3.6).

### Statistiques utiles et cohérence

Quatre réponses (Progrès) et deux chiffres à l'accueil. **Une seule fonction calcule la file du jour** (`planDay`) : l'accueil, le bouton Réviser, la prévision de la semaine et la séance utilisent le même résultat, mémorisé. Il ne peut plus y avoir « 65 cartes » à l'accueil et 58 dans la séance.

### Valeurs par défaut et ce qui s'adapte seul

| Paramètre | Valeur par défaut | S'adapte |
|---|---|---|
| Temps par jour | 20 min | réglage unique de l'élève |
| Nouvelles cartes | calculées chaque jour (0 à 25) | budget, charge prévue, retard |
| Rétention visée | 90 % | examens (→ 95 %), calibration (± 3 points) |
| Paramètres FSRS | défauts FSRS-6 | optimisation mensuelle validée |
| Durée moyenne d'une carte | 9 s (révision), 25 s (nouvelle) | mesurée sur l'historique |
| Changement de jour | 4 h du matin | — |
| Intervalle maximal | 100 ans (illimité de fait) | — |
| Sangsue | 6 oublis | — |


---

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

| Mesure | Actuelle (1 427 cartes) | Prototype (2 089 cartes) | Prototype (3 700 cartes) |
|---|---|---|---|
| Poids transféré au 1er démarrage | 2913 Ko | 314 Ko (dont 193 Ko de démo, une seule fois) | 314 Ko |
| Poids d'une relance (fichiers de l'appli) | 2913 Ko | ≈ 105 Ko | ≈ 105 Ko |
| 1er démarrage → accueil utilisable | 2359 ms | 1228 ms (création de la démo comprise) | 1600 ms |
| **Relance → accueil utilisable** | 2275 ms | **377 ms** | **411 ms** |
| Éléments DOM à l'accueil (page entière) | 1784 | 175 | 175 |
| Onglet Paquets : 1er affichage · retour · tâche max · DOM de l'écran | 200 · 97 · 184 ms · 1218 | 107 · 61 · 0 ms · 89 | 97 · 62 · 0 ms · 88 |
| Onglet Statistiques / Progrès : 1er affichage · retour · tâche max · DOM de l'écran | 261 · 189 · 245 ms · 1500 | 104 · 76 · 0 ms · 167 | 122 · 83 · 0 ms · 167 |
| Onglet Réglages : 1er affichage · retour · tâche max · DOM de l'écran | 221 · 53 · 203 ms · 1155 | 68 · 58 · 0 ms · 65 | 73 · 45 · 0 ms · 65 |
| Onglet TOEIC : 1er affichage · retour · tâche max · DOM de l'écran | 87 · 81 · 61 ms · 179 | 80 · 63 · 0 ms · 63 | 60 · 62 · 0 ms · 63 |
| Onglet Accueil : 1er affichage · retour · tâche max · DOM de l'écran | 111 · 61 · 82 ms · 1382 | 73 · 63 · 0 ms · 120 | 90 · 76 · 0 ms · 120 |
| Révision : retourner · noter (médiane, toucher → 2ᵉ image) | 44 · 40 ms | 17 · 14 ms | 19 · 15 ms |
| Révision : tâche la plus longue (médiane · max sur 15 notes) | 82 · 145 ms | 0 · 0 ms | 0 · 0 ms |
| Éléments DOM pendant la révision | 949 | 89 | 89 |

**Coût d'un enregistrement dans l'appli actuelle à volume réel** (3 700 cartes, 40 000 lignes d'historique, CPU ×4, 15 mesures) : état de 4055 Ko re-sérialisé en 151-231 ms (médiane 176 ms) sur le fil principal, puis écrit en 71-675 ms (médiane 416 ms). Dans le prototype, une note écrit 1 carte + 1 ligne d'historique (≈ 1 Ko) dans une transaction.

Résultats bruts : `refonte/bench/resultats-passage-{1,2,3}.json`, médianes : `refonte/bench/medianes.json`. Les temps absolus dépendent de la machine ; ce sont les **rapports** entre les deux applis, mesurées dans les mêmes conditions, qui comptent.

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
