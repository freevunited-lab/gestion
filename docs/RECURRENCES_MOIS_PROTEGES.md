# Transactions récurrentes : isolation des mois et verrou d'historique

**Version : 21 octobre 2026 — correctif de comportement.**

## Règle centrale

La récurrence est une règle de **prévision pour les échéances à venir**. Chaque occurrence possède un `parentId` et une identité stable `periodKey` (mois pour les mensualités, semaine ISO pour les hebdomadaires, année pour les annuelles). Les exceptions ne changent pas le montant de la règle, ni les autres occurrences.

- **Mois courant :** l'action « Modifier seulement ce mois » ouvre l'occurrence réelle, ou une projection non enregistrée. Valider la modification crée/édite exclusivement cette occurrence, `periodKey` inchangé, `_manuallyEdited = true`.
- **Mois suivants :** restent au prix de la règle, sauf exceptions déjà enregistrées par l'utilisateur. Une « règle générale » agit seulement sur les prochaines échéances automatiques ; les anciennes opérations et les exceptions sont préservées.
- **Mois passés :** l'action sur une occurrence n'est autorisée qu'après **deux boîtes de confirmation distinctes**. Sans les deux, rien n'est écrit. Le moteur refuse aussi les éditions directes non autorisées (`authorizeArchivedMonth`).
- **Changement de période :** interdit dans l'édition ponctuelle. Pour changer de mois une opération récurrente, il faut une démarche distincte afin d'éviter collisions et doublons.
- **Chargement/génération automatique :** ne regénère plus une occurrence d'un mois déjà clôturé qui n'existe pas. Une règle créée avec une date de début rétroactive ne remplit pas silencieusement les anciens mois.
- **Échéance ignorée :** si l'utilisateur l'avait déjà enregistrée, son montant et sa description sont sauvegardés avec la règle pour une restitution exacte. Sans données suffisantes après changement de tarif, la restauration historique est bloquée plutôt que d'inventer un montant.
- **Fréquence hebdomadaire :** une échéance précise se sélectionne dans « Transactions », car une même mensualité contient plusieurs semaines.

## Exemple

Pour une mensualité de 50 € : septembre 50 € / octobre **80 € (exception)** / novembre 50 € / décembre 50 €. Changer à nouveau octobre à 92 € ne crée pas un deuxième octobre. Modifier septembre nécessite deux confirmations explicites.

## Vérifications

Exécuter `node scripts/validate.mjs` et `node --test` à la racine du projet. Les tests incluent l'isolement des mois, une modification répétée, les annulations de confirmation, une restauration au montant original, les mois absents, les identifiants dupliqués, le changement d'année et les anciens fichiers sans `periodKey`.

## Limites et déploiement

Il s'agit de tests automatisés Node.js et d'une revue de code, **pas de tests navigateurs ni de tests réels sur Firebase/multi-appareils**. Ne pas remplacer une application de production sans sauvegarde JSON, recette en environnement de test et validation des règles Firestore actuelles. La politique de non-régénération rétroactive est intentionnelle : l'historique ancien ne se complète plus automatiquement.
