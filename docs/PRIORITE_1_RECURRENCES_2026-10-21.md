# FREEV Gestion — Priorité 1 : calendrier, exceptions, aperçu, historique et portées

Date : 21 octobre 2026. Base : `FREEV_Gestion_Recurrences_Mois_Proteges_141_Tests.zip`.

## Fonctionnalités livrées

1. **Calendrier annuel interactif (12 mois)** dans « Récurrentes ». Bouton calendrier de chaque règle, navigation entre années, détail des échéances d'un mois. Les anciens mois affichent uniquement les écritures sauvegardées, jamais des sommes rétroactives inventées. Les mois futurs utilisent la règle actuelle ou leur exception enregistrée. Les fréquences hebdomadaire et annuelle sont prises en charge.
2. **Exceptions indépendantes** : chaque occurrence conserve `parentId` et `periodKey`. Modifier le montant ou la date dans la même période ne réécrit pas les autres échéances et n'altère pas la règle par défaut. Un mois précédent est verrouillé et nécessite deux confirmations.
3. **Simulation en direct** dans le formulaire : avant validation, aperçu textuel des mois potentiellement concernés, montants avant/après et mois préservés. La simulation ne modifie aucune transaction et montre une fenêtre de douze mois ; pour une ancienne exception, elle est centrée sur le mois choisi.
4. **Journal des modifications réversibles** : les modifications ponctuelles, de la règle future ou de toute la série sont enregistrées sous `recurrenceHistory` avec snapshots avant/après et date. La restauration vérifie qu'aucune échéance concernée n'a été modifiée depuis. Elle exige deux confirmations si elle touche un mois passé. Le journal comporte un maximum de 35 entrées récentes et une limite de taille.
5. **Trois portées clairement distinctes** : « cette échéance uniquement », « échéances futures non réglées », « toute la série, historique compris ». L'option la plus sûre (ponctuelle) est présélectionnée lors de l'édition d'une échéance. L'édition historique exige deux confirmations et vérifie les conflits de période.

## Invariants / protections

- Un mois passé manquant n'est pas recréé par une synchronisation ou un redémarrage.
- Une période ignorée n'est pas restaurée par une modification globale ; le mécanisme de rétablissement explicite reste séparé.
- Les modifications futures ordinaires préservent les écritures échues et les exceptions personnalisées, même futures.
- La modification historique complète ne crée pas de périodes absentes. Elle modifie uniquement les occurrences déjà stockées plus la règle qui sert aux futures projections.
- Un doublon de période bloque une modification historique globale.
- Pour éviter des recalculs financiers incertains, une modification historique globale est bloquée lorsqu'une écriture passée ayant des effets sur l'épargne ou les dettes possède un état d'application non confirmé.
- Pour maîtriser la taille des sauvegardes Firebase, les modifications historiques globales de plus de 120 occurrences déjà enregistrées sont volontairement bloquées.
- La restauration n'écrase pas une échéance modifiée depuis la version à restaurer.
- La logique reste compatible avec les anciennes occurrences dépourvues de `periodKey` : récupération à partir de leur date et de la fréquence.

## Fichiers modifiés

- `assets/js/recurring.js` : snapshots, restaurations, lancement du calendrier depuis la liste.
- `assets/js/transactions.js` : sélecteur de portée, modifications historiques contrôlées et journalisation.
- `assets/js/recurrence-priority1.js` : calendrier, détail et simulation.
- `assets/css/recurrence-priority1.css` : habillage responsif.
- `index.html` : panneau calendrier, aperçu, commandes de portée et ressources.
- `sw.js` : version de cache et nouvelles ressources.
- `tests/recurring-priority1.test.mjs` : scénarios automatisés supplémentaires.

## Tests et limites

- `node scripts/validate.mjs` : valide les scripts, les fichiers référencés et les identifiants HTML.
- `node --test` : **160/160 tests réussis** (19 tests supplémentaires par rapport à la base).
- Contrôle Chromium non concluant dans cet environnement ; pas de recette visuelle confirmée.
- Tests réels contre Firebase/Firestore non réalisés. Pour la production : export JSON de sauvegarde, test sur projet Firebase de démonstration avec les règles `firestore.rules`, recette sur deux appareils et contrôle du mode hors ligne.
- Les journaux antérieurs à cette mise à jour ne disposent pas des snapshots nécessaires pour une restauration automatique.
- La simulation affiche les effets attendus sur une fenêtre de douze mois, mais elle ne remplace pas la validation des conflits et des règles au moment de la sauvegarde.

## Exemple

Règle « Internet » : 50 € par mois. Octobre passe ponctuellement à 85 €. Septembre reste 50 €, novembre et décembre restent 50 €. « Historique » montre l'exception d'octobre et « Restaurer » peut rétablir 50 € tant qu'octobre n'a pas changé depuis. Si octobre est devenu un mois passé, deux confirmations sont exigées.
