# FREEV Gestion 5.1 — Nouvelle campagne de corrections

**Date :** 21 octobre 2026  
**Base auditée :** `FREEV_Gestion_Reaudit_104_Tests_Corrige.zip`  
**Objectif :** traiter en priorité les bugs résiduels à risque de perte ou de mélange des données.

## Résultat contrôlé

- **116 tests Node.js validés sur 116** ; les 104 tests précédents sont conservés, avec 12 nouveaux tests unitaires/simulés de synchronisation.
- `node scripts/validate.mjs` : réussite (syntaxe, HTML et références locales).
- Règles Firestore renforcées dans `firestore.rules`, tests d'émulateur adaptés, **mais émulateur Firestore non exécuté dans cet environnement**.
- **Ni déploiement Firebase, ni test réel multi-appareils, ni validation Chrome/Safari mobile.**
- L'archive est une version de travail corrigée, **pas une garantie que plus aucun bug n'existe**.

## Bugs et risques traités

| Priorité | Dysfonctionnement | Correction | Vérification |
|---|---|---|---|
| Critique | Écrasement silencieux par une écriture d'un autre appareil | Chaque écriture utilise `runTransaction` + comparaison de révision **et** du JSON serveur, avant incrément | Simulations de concurrence et tests de révision |
| Critique | Chargement initial depuis un cache Firestore obsolète quand Firebase est indisponible | Utilisation de `getDocFromServer`; si la lecture échoue, aucun tableau financier éditable n'est initialisé | Test d'échec de lecture |
| Critique | Cache local récent automatiquement réenvoyé au cloud | Interdiction de l'upload automatique divergent : écran de conflit et export JSON avant choix explicite | Tests de cache divergent |
| Critique | Données cloud corrompues remplacées par un état vide | Validation minimale de la structure avant application, blocage en cas d'erreur | Test de JSON corrompu |
| Haute | Retour d'une vieille version de l'application qui réécrit sans compteur | Nouvelles règles Firestore : `revision` doit augmenter de 1 ; première migration à 1 | Revue du code ; tests d'émulateur écrits, non exécutés |
| Haute | Cache récurrentement considéré « plus récent » sans modifications réelles | Métadonnées locales (`ownerUid`, `revision`, `dirty`), et exclusion de `lastSaved` du comparatif financier | Tests de faux conflit et de modification locale non envoyée |
| Haute | Modification locale non envoyée mais plus ancienne que le cloud | Flag `dirty` oblige à demander une résolution même si la date du cloud est plus récente | Test dédié |
| Haute | Sauvegarde qui modifie `revision` au logout sans opération financière | Évite les écritures identiques en comparant les données de l'application | Test de non-écriture si inchangé |
| Haute | SDK Firestore garde des données sensibles de façon persistante | Mode Firestore en **mémoire uniquement** ; tentative de purge des anciens caches IndexedDB au démarrage | Revue statique ; purge réelle à vérifier |
| Haute | Désactivation du cache local pendant une sauvegarde Firebase incertaine | Avertissement supplémentaire avant effacement si l'envoi n'est pas confirmé | Revue de parcours ; navigateur à vérifier |
| Moyenne | Nouvelle modification arrivée juste après la dernière itération d'une file d'écriture | Redéclenchement conditionnel si un nouveau changement est encore en attente | Revue de boucle ; test d'intégration supplémentaire souhaitable |
| Moyenne | Erreurs de permission Firebase peu explicites | Affichage du conflit exportable si `permission-denied`, erreur visible pour autres pannes | Revue statique |

## Compatibilité et comportement attendu

- Les modifications d'une seule échéance récurrente restent isolées : modifier une mensualité à 80 € n'altère pas les autres mensualités de 50 € (anciens tests conservés).
- Les **anciennes applications** qui écrivent sans `revision` seront bloquées **dès le déploiement des nouvelles règles** ; actualiser chaque appareil après la mise à jour.
- En cas d'indisponibilité Firebase **au démarrage**, l'édition est volontairement bloquée plutôt que de risquer un écrasement à la reconnexion. Cela réduit la fonctionnalité hors ligne, de manière assumée, pour garantir l'intégrité.
- En cas de conflit, ne pas supprimer les données locales ou fermer la page avant l'export JSON de récupération.
- Le cache applicatif `localStorage` reste disponible seulement en mode « appareil fiable ». Le cache SDK IndexedDB n'est plus activé : une ancienne copie peut encore subsister si sa purge échoue, notamment avec plusieurs onglets ouverts.

## Fichiers modifiés

- `assets/js/firebase-auth.js` : chargement serveur, transactions et conflits.
- `assets/js/cloud-sync-guard.mjs` : validation versionnelle et comparaison testables.
- `assets/js/auth-bridge.js` : suivi de modifications locales.
- `assets/js/state.js` : effacement des métadonnées lors de la purge locale.
- `assets/js/v5.js` : avertissement avant effacement du cache.
- `firestore.rules` : interdiction des écritures sans incrément de révision.
- `sw.js` : mise à jour cache et inclusion de `cloud-sync-guard.mjs`.
- `README.md` : documentation de la migration.
- `tests/cloud-sync-safety.test.mjs` : 12 nouveaux scénarios.
- `tests/security-rules.test.mjs`, `tests/firestore-emulator.mjs`, `tests/multi-audit-data-integrity.test.mjs`, `tests/security-hardening.test.mjs` : adaptations aux nouvelles garanties.

## Tests à effectuer avant publication en production

1. Faire un **export JSON** de chaque compte et utiliser **un projet Firebase de test**.
2. Installer les dépendances puis `npm run validate`. Pour les règles : `npm run test:rules` (nécessite Java et l'émulateur Firestore).
3. Déployer **les fichiers applicatifs et `firestore.rules` ensemble**, et actualiser tous les onglets et les applications installées.
4. Faire deux éditions simultanées depuis deux navigateurs/appareils. Vérifier que le dernier envoi ne masque jamais celui de l'autre, puis exporter l'état local sur l'écran de conflit.
5. Couper Internet au chargement puis pendant l'édition : vérifier respectivement le blocage initial et le comportement du badge/du backup local lors de l'échec d'écriture.
6. Répéter le test « septembre 80 € / autres mois 50 € » avec changement de compte Firebase, mobile Safari/Chrome, PWA et restauration JSON.
7. Tester la purge du cache IndexedDB (y compris plusieurs onglets ouverts) et vérifier les paramètres de règles déployées.

## Risques non résolus ou non validés

- Les écrits de l'ancien client ne sont refusés **qu'après déploiement effectif des nouvelles règles Firestore**. Le projet Firebase réel n'a pas été modifié ici.
- Les transactions multi-appareils ont été simulées côté Node et revues statiquement, **pas exercées contre le vrai SDK avec réseau et Firestore Emulator**.
- La purge Firestore IndexedDB ancienne n'est pas attestée sur des navigateurs réels. Une purge peut échouer si plusieurs onglets sont ouverts.
- La validation visuelle iPhone/Android, les fonctionnalités bancaires externes, les fournisseurs CDN, le chargement PWA depuis le réseau et la dégradation avec de gros volumes de données nécessitent des tests supplémentaires.
- Aucun audit de dépendances CVE récent ni audit pentest externe n'a été réalisé.

**Bilan :** correctifs majeurs de protection des données et de synchronisation ajoutés, 116/116 tests exécutés avec succès. La publication réelle nécessite une recette et un déploiement coordonné des règles Firebase.
