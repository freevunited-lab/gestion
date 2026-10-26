# FREEV Gestion — Priorité 2 : prévisions, paiements, budgets et alertes

Date : 21 octobre 2026. Base : `FREEV_Gestion_Recurrences_Synchronisation_182_Tests.zip`.

## Livraison

- **Dashboard financier** : nouveaux KPI (solde réalisé aujourd'hui, solde prévu fin de mois, dépenses comptabilisées, opérations prévues), projection glissante sur trois mois, comparaison mois sélectionné/mois précédent, prochaines opérations et alertes.
- **Transactions prévues/payées** : champ `paymentStatus` facultatif. Les transactions historiques sans statut conservent leur ancien sens (« payée »). Le statut `planned` est réservé aux revenus et dépenses manuels sans dette, virement, effet d'épargne ou rattachement à une récurrence. Il ne réduit pas le solde réalisé avant validation. Le bouton « Payée ✓ » demande confirmation et écrit dans l'historique.
- **Récurrences** : prévisions par occurrence, avec respect de `startDate`, du rythme (mensuel, hebdomadaire, annuel), des `skippedPeriods` et des occurrences existantes identifiées par `periodKey`. Une exception enregistrée pour octobre n'affecte pas novembre. Le moteur de prévision est **purement calculatoire**, ne crée aucune transaction ni échéance dans le stockage.
- **Budgets de catégories** : visualisation du consommé, restant et dépassement, modification de la limite sur le compte actif (0 pour retirer). Les vues multi-comptes affichent des budgets séparés et interdisent une édition ambiguë.
- **Alertes** : solde prévisionnel négatif, seuil budget 80 %, dépassement réalisé ou prévu, hausses de dépenses, changements réellement constatés sur une récurrence mensuelle, retards de paiement et doublons potentiels (aucune suppression automatique).
- **Comparaison mensuelle** : revenus, dépenses, résultat net et variation. L'interface précise que le mois courant est incomplet.
- **Sécurité/compatibilité** : contrôle à l'import des statuts, prévention des rapprochements sur paiements prévus, validation de montants et dates, calculs au centime, nouveau cache PWA incluant les fichiers du moteur financier, mise à jour du serveur local de smoke test pour les modules `.mjs`.

## Particularités et limites

1. Le statut `planned` n'est pas un prélèvement réel. L'utilisateur doit explicitement confirmer le paiement ou l'enregistrement.
2. Les récurrences futures sont des **estimations**, non des paiements bancaires effectivement observés.
3. Les seuils d'alerte s'appuient sur les montants présents : ils ne prédisent pas les dépenses non renseignées.
4. Les mois passés et règles de récurrence ne sont **pas modifiés** par le cockpit. Les protections à double confirmation de la priorité 1 restent inchangées.
5. La cohérence des vues est meilleure, mais des analyses annexes héritées peuvent avoir leurs propres conventions temporelles ; comparer les totaux avant déploiement.
6. Les nouvelles fonctions n'ont pas été vérifiées sur un **navigateur réel avec Firebase connecté** dans ce contexte : `axe-core` et l'exécutable `firebase` ne sont pas installés, et le smoke test ne démarre pas.
7. La synchronisation en production exige toujours des essais sur une instance Firebase de test, notamment le contrôle de versions et les conflits entre appareils.
8. Le prévisionnel multi-comptes suppose que les montants `amountBase` sont exprimés dans la même monnaie de base pour les comptes regroupés.

## Tests

- `npm run validate` : vérifie les scripts JS, identifiants HTML, chemins et exécute `node --test`.
- **218/218 tests réussis**, dont **36 nouveaux tests** (32 initialement et 4 cas limites supplémentaires).
- Les tests couvrent séparément la création de prévisions, la non-mutation de l'historique, les récurrences mensuelles/hebdomadaires/annuelles, les exceptions, la protection anti-doublon, les états de paiement, les budgets par compte, les anciens JSON et les alertes.
- `npm run test:browser` : **non exécuté**, dépendance `axe-core` manquante.
- `npm run test:rules` : **non exécuté**, exécutable `firebase` manquant.

## Scénario de recette à réaliser avant production

1. Exporter une sauvegarde JSON depuis la version existante.
2. Déployer sur un projet Firebase de **test** avec les règles Firestore de cette archive.
3. Créer une dépense manuelle de 90 € avec statut « Prévue » : vérifier solde actuel inchangé et coût visible dans les prévisions.
4. Cliquer « Payée ✓ » : vérifier le débit exact de 90 € et une seule écriture dans l'historique.
5. Créer une récurrence à 50 €/mois, changer uniquement octobre à 80 € et vérifier septembre, novembre et décembre.
6. Définir un budget nourriture de 100 €, puis enregistrer 85 € payés et 30 € prévus : vérifier l'alerte et la différence entre réalisé et projeté.
7. Répéter avec deux comptes et deux navigateurs, puis vérifier la synchronisation et la résolution de conflits.
8. Tester desktop, téléphone, navigation hors ligne, mode sombre et rechargement PWA.

**Ne pas utiliser directement sur une base financière de production sans ces vérifications.**
