# LH Cards — règles de travail (à lire avant toute modification)

L'utilisateur est un étudiant (pas un développeur). Il veut une appli fluide, sans bug, qui marche toute seule. **Ne défais jamais une décision ci-dessous sans qu'il le demande clairement.** Avant de pousser : `python3 build.py && cd tests && npm install && npm test` (tout doit passer).

## Façon de répondre
- Français, réponses courtes et concrètes. Ne jamais écrire « c'est fait et poussé » : dire ce qui a changé et ce qu'il faut tester.
- Pas de pull request sauf demande. Travailler et pousser sur la branche `claude/ecstatic-edison-4i6b1u`.
- Pas de nouveaux réglages inutiles : préférer l'automatique. Ne rien retirer de ce qu'il utilise sans accord.
- Après une fusion avec une autre branche, relancer les tests ; `index.html`, `sw.js`, `version.json` sont générés (reprendre l'un des deux côtés puis `python3 build.py`).

## Décisions de l'utilisateur à conserver
- **Écran de chargement** : la barre va **jusqu'au bout (100 %)** et reste pleine environ 0,5 s avant l'ouverture de l'appli (≈ 1,4 s au total). Ne pas raccourcir (test : `tests/e2e.js`, section 0).
- **Mises à jour** : une nouvelle version s'applique **derrière l'écran de chargement** (un seul chargement visible). L'appli ne redémarre jamais toute seule une fois ouverte : seulement la bannière « nouvelle version » (test : section 0b).
- **Sauvegarde** : l'export à la main suffit. La synchronisation / sauvegarde cloud est **désactivée par défaut** et ne démarre qu'après un choix explicite de l'utilisateur.
- **Sons** : se mélangent avec sa musique (`navigator.audioSession.type = 'transient'`), volume réglable (il est intégré aux sons rendus, iOS ignore `audio.volume`).
- **Animations** : le compteur des cartes et les barres de progression s'animent quand on **change de page**, pas quand on déroule une section. Fluidité d'abord : transitions d'écran en fondu, mode allégé automatique sur appareil lent.
- **Onglets** : le haut de chaque page s'affiche tout de suite, le reste se construit par petits morceaux (`deferTail` / `flushTail`). Ne pas revenir à une construction complète d'un bloc.
- **Accueil** : tous les paquets sont affichés (le repli « Autres paquets » a été supprimé à sa demande). Déplier un paquet ne redessine que la liste des paquets et garde le bouton en place.
- **Mascotte Léo** (lionceau) : **à chaque ouverture de l'appli** (et au retour de l'arrière-plan après plus d'une minute) il te **salue avec la vidéo « salue assis » (`sitwave`)** (test e2e) ; jamais pendant la révision ; à l'accueil il est **à droite du texte dans le bandeau** (pas posé sur le bord) ; animations et voix de lionceau selon la phrase ; discrète, aucune fonction de jeu.
- **Thèmes** : retirés à sa demande (ne pas les remettre) : Nordique, Dracula, Forêt, Tableau noir, Game Boy, Terminal, Cahier, Solarisé, Café. Étoilé = version simple (étoiles, étoile filante, lune en disque), sans constellations. Savane = cartes translucides **sans flou** (le flou ralentit le défilement). La barre du haut/bas et la couleur du navigateur suivent le thème. **Sur iPhone, pas de grandes couches fixes animées, masquées ou floutées** (l'écran peut rester blanc en défilant) : décor immobile, seules petites animations rares.
- **Révision** : règles alignées sur Anki (écart de planification, révision en avance, plafond de 200 révisions/jour, plan d'examen automatique : le dernier tour ne contient que des cartes déjà vues).
- Barre du bas fixe sur téléphone ; pas de bouton « synchroniser » en haut.
