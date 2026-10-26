# FREEV Gestion · Édition Signature (design inspiré d’Apple)

## Objectif
Créer une interface épurée, cohérente, accessible et rapide, sans reproduire les marques, icônes ou contenus d’Apple et sans modifier les données financières.

## Changements livrés
- `assets/css/apple-premium.css` : nouvelle couche visuelle déclarée après les styles historiques pour éviter les changements fonctionnels.
- `index.html` : activation de la classe `freev-apple`, chargement du thème ; suppression du chargement distant de Google Fonts au profit de la police système.
- Menu latéral clair translucide, états actifs lisibles, comptes et préférences harmonisés.
- Bandeau d’accueil minimal, typographie et hiérarchie adaptées, cartes financières redessinées.
- Tableaux, modales, formulaires, récurrences, prévisions, boutons et navigation mobile harmonisés.
- Mode sombre pris en charge. Réduction des animations et de la transparence si l’OS le demande. Contours de focus visibles.
- `sw.js` : clé de cache mise à jour et inclusion du thème pour les PWA installées.
- `manifest.webmanifest` : couleurs de démarrage harmonisées.
- Tests dédiés au nouveau thème, adaptation des tests historiques aux nouvelles versions de cache.

## Assurance qualité
- Validation locale de la structure HTML et du JavaScript : OK.
- Vérification de la syntaxe de `apple-premium.css` : 0 erreur de syntaxe.
- 267 tests Node.js réussis sur 267.
- Contrastes estimés des couleurs principales : texte secondaire #6e6e73 sur #fafafc ≥ 4,8:1 ; lien #0069d3 sur #f2f6ff ≥ 4,8:1.
- La nouvelle couche ne contient aucune lecture/écriture de données financières.

## Limites
- Chromium local n’a pas retourné de capture utilisable. Les tests ne certifient donc pas le rendu visuel, les tailles d’écran réelles ni tous les parcours au clavier.
- Les scénarios Firebase / Firestore sur un vrai compte ne sont pas revalidés par ce lot, qui est uniquement visuel.
- Les anciennes feuilles CSS restent chargées par compatibilité : un audit visuel réel est recommandé avant une suppression progressive de ces couches.
- Faire une sauvegarde JSON et déployer sur un environnement de test avant la production.

## Pour vérifier
1. Lancer un serveur statique dans le dossier du projet : `python3 -m http.server 8080`.
2. Ouvrir `http://localhost:8080/` sur ordinateur, puis sur téléphone connecté au même réseau avec un serveur accessible.
3. Vérifier les pages Tableau de bord, Transactions, Récurrentes, Budgets, Réglages, les modales, les deux apparences et l’affichage compact.
4. Tester le déploiement PWA, l’actualisation du cache et les protections Firebase séparément.

## Évolution de composition — 22 octobre 2026

La nouvelle composition reprend la hiérarchie de la photo fournie (barre de commandes arrondie, navigation latérale par icônes, indicateurs puis graphique principal), tout en gardant l’identité FREEV cobalt et turquoise et les libellés français. Les quatre indicateurs financiers existants restent calculés par l’application ; aucune donnée de démonstration n’a été ajoutée.

- Rail de navigation compact sur ordinateur ; menu complet conservé sur téléphone. Les icônes du rail portent un nom accessible et les comptes du rail sont utilisables au clavier.
- Barre supérieure capsule qui conserve le mois, les modes de compte, la recherche, les budgets, le capital, les transferts et la nouvelle transaction.
- En-tête allégé, graphiques placés directement après les indicateurs, cartes et contrôles arrondis harmonisés.
- Transitions d’entrée courtes, sans nouvelle bibliothèque. Les animations des valeurs et des graphiques respectent aussi la préférence de mouvement réduit.
- Couleurs de démarrage PWA harmonisées et cache incrémenté en version v14.

### Contrôle visuel de cette évolution

Rendus observés dans Chromium à 1440×920, 1080×720, 768×900, 390×844 et 320×720. La page n’a pas de débordement horizontal à ces largeurs. Le navigateur a ouvert le projet en `file://` : il bloque les modules JavaScript locaux et Firebase pour des raisons de sécurité du protocole. L’inspection confirme donc la composition CSS, pas le chargement des comptes, des valeurs ou des graphiques réels. La vérification fonctionnelle doit être faite depuis un serveur local ou un environnement de test avec Firebase configuré.
