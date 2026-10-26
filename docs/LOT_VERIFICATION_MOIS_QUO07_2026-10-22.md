# Lot « Vérification du mois » — QUO 07 (22 octobre 2026)

## Réalisé
- Onglet « Vérification » dans le Centre intelligent (aucun nouvel accès latéral).
- Cinq types de propositions : doublons possibles, catégories manquantes (groupées), paiements en attente, montants inhabituels (médiane des 6 mois précédents, ≥ 4 dépenses de référence), écart de pointage (seulement si le mois est terminé et que l'utilisateur pointe déjà).
- Chaque proposition affiche sa cause chiffrée et son degré d'incertitude. Les opérations saines ne sont pas listées (seulement comptées).
- Actions : Corriger (ouvre l'opération), C'est normal, Ignorer ce mois, Reporter 7 jours. Une proposition traitée ne revient que si une opération concernée change (empreinte) ou à l'échéance du report.
- Validation d'un mois = « vérifié par vous, pas une certification comptable ». Toute modification d'une opération du mois rouvre le mois, avec une trace unique dans l'historique.
- Données : `account.monthlyChecks[AAAA-MM]` (facultatif, aucune migration).
- Preuves : `tests/monthly-check-engine.test.mjs` (8 tests), contrôle navigateur (ignorer, valider, rouvrir), 333 tests au total.

## Limites
- Seuils (3 jours pour les doublons, 7 jours de report, médiane ×3) = propositions de cadrage à ajuster à l'usage.
- La trace de réouverture est écrite à l'ouverture de l'onglet, pas au moment exact de la modification.
- Pas encore de rappel ou de notification mensuelle ; pas de vérification en vue groupée (compte actif uniquement).
- ACT 01 (aperçu des changements en masse) et ACT 02 (annulation) restent à faire.
- Cache du service worker après intégration du parseur monétaire partagé : `freev-v5.2.0-spaces-20261022-v4`.
