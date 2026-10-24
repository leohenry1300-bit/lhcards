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
