# Freev Valeur 5.1

Cette version transforme les deux anciennes pages monolithiques en une application modulaire. Une connexion Firebase et une authentification utilisateur sont obligatoires pour ouvrir l'application.

## Démarrage

Ouvrir `index.html` directement fonctionne. Pour bénéficier du cache hors-ligne et du comportement d'application installable, servir ce dossier avec un petit serveur local, puis ouvrir l'adresse affichée dans le navigateur.

Lors de la première connexion, les données locales existantes peuvent être envoyées vers Firebase. Ensuite, les données Firebase du compte authentifié sont chargées avant l'ouverture de l'interface. En cas d'indisponibilité de Firebase, l'application affiche un écran bloquant avec un bouton permettant de réessayer.

Le rapport mensuel vérifie lui aussi la session Firebase. Il ne révèle aucune donnée tant que l'utilisateur n'est pas authentifié. Sur un nouvel appareil, le cache financier local est désactivé par défaut ; il peut être activé depuis le Centre intelligent sur un appareil personnel fiable.

## Correctif de synchronisation — octobre 2026

- **Protection contre les écrasements multi-appareils :** chaque enregistrement du document
  `/users/{uid}` utilise désormais une transaction Firestore et une révision croissante.
- **Mise à niveau nécessaire :** publier `firestore.rules` **en même temps que cette version**.
  Les anciennes versions qui ne transmettent pas la révision seront volontairement refusées :
  il faut actualiser chaque onglet/appareil FREEV après le déploiement.
- **Plus de reprise aveugle du cache :** quand la lecture serveur échoue, l'interface financière
  reste verrouillée. Un cache local divergent produit un écran de conflit, avec **export JSON**
  avant le choix éventuel de recharger la version cloud.
- **Confidentialité :** le cache du SDK Firestore fonctionne en mémoire seulement. Le
  nettoyage des anciens caches IndexedDB est tenté au démarrage, mais peut échouer si d'autres
  onglets sont ouverts. Le cache local explicite reste réservé aux appareils fiables.
- **Déploiement des règles** (dans un projet de test d'abord) :

  ```bash
  firebase deploy --only firestore:rules
  ```

- **Vérifications après déploiement :** deux appareils connectés au même compte, modification
  simultanée, reconnexion après coupure réseau, export puis résolution de conflit, et test de
  restauration JSON. Aucun de ces scénarios réels Firebase n'est validé par les seules
  simulations Node.js.

## Installation sur téléphone

- Sur iPhone ou iPad : ouvrir le site GitHub Pages dans Safari, toucher **Partager**, puis **Sur l’écran d’accueil** et **Ajouter**.
- Sur Android et les navigateurs compatibles : utiliser le bouton **Installer l’application** dans le menu Freev. Le navigateur affiche ensuite sa confirmation native.
- L’application utilise ses propres icônes 180, 192 et 512 pixels et s’ouvre en mode autonome. Une connexion reste nécessaire pour authentifier le compte Firebase et charger ses données protégées.

## Guide de prise en main et centre d’aide

Le bouton **Guide** reste disponible depuis l’en-tête de chaque écran. La rubrique **Bien démarrer** explique le solde de départ, les opérations, les paiements réguliers, le budget et le rôle de chaque espace. Les guides du Planificateur et des outils intelligents détaillent ensuite leurs fonctions. Le centre d’aide est utilisable à la souris, au clavier et sur mobile. Il comprend :

- une recherche instantanée par sujet ;
- deux parcours de démarrage dont les étapes cochées restent mémorisées sur l’appareil ;
- des accès directs au simulateur, aux objectifs, enveloppes, règles, abonnements, relevés et scénarios ;
- des exemples chiffrés repliables, une FAQ de dépannage et un glossaire ;
- un retour automatique du focus vers le bouton d’origine à la fermeture.

La touche `Échap` efface d’abord une recherche en cours, puis ferme la fenêtre si la recherche est vide.

### Exemple avec le Planificateur 4.3

1. Ouvrir **Planificateur 4.3** et choisir une prévision sur 6 mois.
2. Saisir 150 € dans **Dépenses supplémentaires**.
3. Ajouter un **Imprévu ponctuel** de 500 € au mois 2.
4. Comparer la trajectoire, le solde minimum et la fourchette de risque.
5. Cliquer sur **Réinitialiser** : la simulation n’a créé aucune transaction réelle.

### Exemple avec le Centre intelligent 5.1

1. Ouvrir **Centre intelligent 5.1**, puis l’onglet **Règles**.
2. Créer une règle dont le libellé contient `Netflix` et choisir la catégorie `Abonnements`.
3. Conserver **Appliquer immédiatement** pour classer aussi les anciennes opérations correspondantes.
4. Vérifier le résultat dans **Transactions** et **Abonnements**.

L’onglet **Relevés** accepte notamment un CSV de cette forme :

```csv
Date;Description;Montant;Catégorie
2026-08-02;Salaire;2100;Revenus
2026-08-03;Supermarché;-82,40;Alimentation
```

Freev affiche un aperçu, les erreurs et les doublons avant toute confirmation d’import. Les boutons présents dans l’aide ouvrent directement le bon onglet et placent le focus sur l’outil concerné.

## Nouveautés 5.1

- Centre financier enrichi d’un score local, d’un indice de confiance et d’une comparaison des deux derniers mois complets.
- Recommandations classées par priorité avec raison et impact estimé, sans envoyer les données financières à une IA distante.
- Détection robuste des dépenses inhabituelles et des faux abonnements grâce à la médiane et à la stabilité des montants.
- Planificateur 4.3 avec récurrences comptées à leurs vraies dates et respect des échéances ignorées.
- Fourchette de risque, marge de sécurité, autonomie financière et effort mensuel conseillé.
- Objectifs échus clairement signalés et export CSV détaillant historique, récurrences et opérations planifiées.
- Centre mobile accéléré : seul l’onglet visible est recalculé et le simulateur utilise une mise à jour temporisée.
- Contrôles renforcés sur les doublons de règles/scénarios et les fichiers d’import invalides.
- 33 tests unitaires et de structure, complétés par un parcours Chromium ordinateur/iPhone.

## Socle 5.0 conservé

- Nouveau **Centre financier intelligent** optimisé pour ordinateur, iPhone et Android.
- Règles automatiques de classement par commerçant, activation individuelle et suggestions à confiance élevée.
- Détection locale des abonnements, coût mensuel/annuel, hausses de prix et conversion contrôlée en récurrence.
- Import de relevés CSV et QIF avec prévisualisation, validation des dates, limite de taille et élimination des doublons.
- Plusieurs scénarios du Planificateur peuvent être nommés, enregistrés et rechargés.
- Calcul du patrimoine net avec trésorerie, épargne, actifs personnalisés et dettes restantes.
- Mode « appareil fiable » : le cache financier hors connexion devient facultatif et peut être effacé sans toucher au cloud.
- Rappels locaux privés à l’ouverture pour les budgets proches de la limite, dettes arrivant à échéance et abonnements en hausse.
- Règles Firestore propriétaire uniquement, Storage fermé par défaut et protection des exports Excel contre l’injection de formules.
- Cache PWA versionné et raccourci direct vers le Centre intelligent depuis l’application installée.

## Nouveautés 4.2

- Graphiques du tableau de bord corrigés : barres pour les flux, ligne distincte pour le solde, choix 6/12 mois et prévisions clairement identifiées.
- État vide utile pour les catégories, résumés accessibles et téléchargement PNG des graphiques.
- Alerte Firebase corrigée : le message « données locales » ne s’affiche plus lorsque le compte est synchronisé.
- Simulateur avancé séparant revenus, dépenses, ajustement net et imprévu ponctuel.
- Courbe de trésorerie native, solde minimum, risque de découvert et export CSV de la projection.
- Installation PWA guidée sur iPhone, Android et ordinateur avec icône d’écran d’accueil.
- 14 tests automatiques complétés par des contrôles navigateur des graphiques, de l’export et du guide iPhone.

## Nouveautés 4.1

- Nouveau score de santé financière sur 100, expliqué par cinq critères : solde, épargne, réserve, budgets et endettement.
- Trois scénarios comparables : prudent, tendance actuelle et imprévu, applicables directement au simulateur.
- Plan d’actions automatique classé par priorité à partir des vraies données du compte.
- Chart.js est désormais chargé à la demande après connexion, uniquement dans les vues qui affichent des graphiques.
- 11 tests métier et contrôles navigateur étendus aux nouveaux modules d’aide à la décision.

## Nouveautés 4.0

- Nouveau **Planificateur financier** avec prévisions à 3, 6 ou 12 mois.
- Simulateur « et si » pour mesurer l’effet d’une économie ou d’une dépense mensuelle différente.
- Objectifs d’épargne avec montant cible, échéance, progression et effort mensuel conseillé.
- Enveloppes de budget par catégorie avec alertes à 80 % et en cas de dépassement.
- Calendrier financier des opérations et échéances récurrentes sur les 90 prochains jours.
- Recherche globale dans tous les comptes, accessible avec `Ctrl + K` ou `Cmd + K`.
- Alertes intelligentes pour les soldes faibles, budgets dépassés et dépenses inhabituelles.
- Fenêtre des nouveautés affichée une fois par compte Firebase lors de sa première connexion à chaque version majeure.
- Optimisations mobiles : les graphiques cachés ne sont plus recalculés, les longues listes sont chargées par lots et les animations sont limitées.
- Sauvegarde Firebase compatible avec les futurs champs du document utilisateur grâce aux écritures fusionnées.
- Nouveau moteur financier isolé et couvert par des tests automatiques.

## Corrections 3.3 conservées

- Nouveau centre « Santé des données » avec détection et réparation assistée des doublons, liens cassés et effets financiers décalés.
- Transferts entre comptes atomiques : les deux écritures sont créées, supprimées et restaurées ensemble.
- Correction d’un double comptage qui pouvait diminuer à la fois le solde bancaire et l’épargne lors d’un transfert entre comptes.
- Conversion automatique entre comptes utilisant des devises différentes, avec taux et montant reçu affichés avant validation.
- Remboursements de dettes entre comptes convertis dans la bonne devise et appliqués uniquement à leur date effective.
- Historique d’épargne corrigé pour inclure les retraits ainsi que les versements.
- Sauvegardes JSON et automatiques désormais complètes : catégories, couleurs, tags favoris et apparence des livrets sont conservés.
- Synchronisation Firebase mise en file pour empêcher une ancienne écriture d’écraser une sauvegarde récente.
- Protection du cache local par utilisateur Firebase et reprise d’une sauvegarde locale plus récente après une coupure.

## Améliorations 3.2 conservées

- Nouveau moteur commun pour les récurrences mensuelles, hebdomadaires et annuelles.
- Les opérations futures restent des prévisions et ne modifient plus l’épargne ou les dettes trop tôt.
- Une échéance peut être ignorée sans supprimer toute la série, avec annulation et rétablissement.
- Le 31 du mois et le 29 février sont ajustés automatiquement sans décalage de période.
- Deux abonnements identiques restent distincts et les occurrences générées en double sont éliminées.
- Les modifications protègent l’historique passé et les transactions validées manuellement.
- La page Récurrentes affiche les prochaines échéances, les montants prévus et les exceptions.
- Les graphiques et alertes utilisent désormais les mêmes prévisions, y compris les fréquences annuelles et hebdomadaires.
- Les exports Excel conservent les devises, retraits d’épargne, dettes liées, couleurs et échéances ignorées.

## Améliorations 3.1 conservées

- Analyses sur 6, 12 ou 24 mois.
- Résultat net superposé aux revenus et dépenses.
- Synthèse automatique avec premier poste de dépense, comparaison et projection de fin de mois.
- Calcul corrigé de la dépense moyenne selon le jour de la semaine.
- Rapport mensuel enrichi : pont de trésorerie, tendance sur 12 mois et résumé décisionnel.
- Mise en page PDF A4 contrôlée, graphiques redimensionnés avant impression et tableau sur plusieurs pages.
- Préférences du rapport mémorisées (thème, densité, précision, sections et type de graphique).
- Couleur du symbole de validation réglable depuis « Modifier », individuellement pour chaque transaction, sans carré séparé dans la colonne Actions.

## Organisation

- `index.html` : interface principale.
- `rapport-mensuel.html` : rapport et impression PDF.
- `assets/css/` : styles principal, mobile et rapport.
- `assets/js/` : état, calculs, transactions, récurrences, finances, imports/exports, authentification et interface séparés par responsabilité.
- `assets/js/v4-engine.js` : calculs testables du planificateur, des objectifs, enveloppes, alertes, recherches et échéances.
- `assets/js/v4.js` et `assets/css/v4.css` : interface et comportement des versions 4.x.
- `assets/js/v5-engine.js` : moteur testable des imports, doublons, automatisations, abonnements, patrimoine et alertes locales.
- `assets/js/v5.js` et `assets/css/v5.css` : Centre intelligent 5.1 et interface responsive.
- `firestore.rules` et `storage.rules` : restrictions Firebase versionnées.
- `manifest.webmanifest` et `sw.js` : installation et cache hors-ligne.
- `scripts/validate.mjs` : contrôle de syntaxe et de structure (`npm run validate`).
- `scripts/browser-smoke.mjs` : contrôle navigateur ordinateur/mobile (`npm run test:browser`, Playwright requis).
- `tests/firestore-emulator.mjs` : test réel des autorisations Firestore (`npm run test:rules`, Emulator Suite et Java requis).
- `scripts/generate-icons.mjs` : génération reproductible des icônes PNG (`npm run icons`, Playwright requis).
- `tests/` : tests métier exécutés avec `npm test`.

La bibliothèque Excel est désormais chargée uniquement au moment d'un import ou d'un export. Firebase reste obligatoire pour accéder aux fonctionnalités et aux données.

## Calendrier des récurrences — priorité 1 (21 octobre 2026)

Dans **Récurrentes**, utilisez le bouton **calendrier** d'une règle pour examiner les 12 mois, modifier une échéance précise, consulter son historique et restaurer une ancienne version. Trois portées sont disponibles dans le formulaire : **une échéance**, **les futures**, ou **toute la série avec historique** (double confirmation). Le formulaire affiche une simulation des périodes concernées avant la sauvegarde. Voir [docs/PRIORITE_1_RECURRENCES_2026-10-21.md](docs/PRIORITE_1_RECURRENCES_2026-10-21.md).


## Priorité 4 — Stabilité, navigation et cache PWA (21/10/2026)

Les corrections de stabilité et les instructions de validation se trouvent dans
[`docs/PRIORITE_4_STABILITE_2026-10-21.md`](docs/PRIORITE_4_STABILITE_2026-10-21.md).
La validation automatisée comprend 243 tests. Les essais réels du navigateur et
de l'émulateur Firebase sont toujours nécessaires avant publication.

Pour lancer la mesure indicative des projections : `npm run benchmark:projection`.

## Interface Premium V4 — 21 octobre 2026

La V4 ajoute une feuille de styles et un contrôleur de présentation sans changer la logique des finances :
`assets/css/premium-v4.css` et `assets/js/premium-v4.js`.

- Les cartes, formulaires, listes et calendriers de récurrences sont harmonisés.
- Le bouton « Affichage compact » dans le panneau latéral réduit les espacements, sans cacher les données.
- Le thème prend en charge l'affichage mobile, le mode sombre et les préférences de mouvement réduit.
- La PWA a un nouveau nom de cache pour actualiser les ressources après installation.

Voir `docs/RAPPORT_DESIGN_PREMIUM_V4.md` pour les validations et les limites.
