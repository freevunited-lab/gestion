# Intégration du moteur V9.7 — 25 octobre 2026

## Calculs utilisés par l'application

- Le cockpit financier utilise le pont V9.7 `freev-ledger-bridge.mjs` pour les soldes et points bas prévisionnels.
- Le tableau de bord charge le même pont pour ses soldes futurs. Les soldes comptabilisés passent par `freev-account-core.mjs` dès que les modules sont prêts ; les primitives monétaires historiques restent le repli pendant le premier chargement ou si un module échoue.
- Le planificateur conserve ses règles de génération des flux (portée, scénarios et échéances) mais confie les soldes mensuels résultants au pont V9.7. Son solde de départ et les moyennes historiques utilisent `freev-account-core.mjs`.
- Le centre intelligent utilise `freev-account-core.mjs` pour les totaux mensuels, la trésorerie du patrimoine et les dépenses comptabilisées des alertes de budget. Ses algorithmes de classement, abonnements et score restent spécialisés.
- `freev-account-core.mjs` adapte les écritures existantes au grand livre V9.7, en unités minimales de devise. Les opérations prévues et les transactions datées après la date de calcul ne touchent pas au réalisé.

## Compatibilité et limites

- Aucun changement du format des comptes enregistrés ni écriture Firebase n'a été effectué.
- Les règles de génération des récurrences restent celles déjà utilisées dans chaque écran ; le grand livre unifie leur accumulation et leurs soldes, pas encore toutes les décisions de classement ou les hypothèses de simulation.
- Le chargement différé du tableau de bord conserve temporairement le calcul monétaire existant, puis rafraîchit l'interface lorsque les modules communs sont disponibles.
- Le test navigateur de la suite complète est ignoré dans cet environnement ; les tests Node et la validation structurelle ne remplacent pas une recette visuelle sur Chrome et Safari.
- Les modules de stockage massif et cloud expérimental de l'archive n'ont pas été activés. La connexion bancaire n'a pas été ajoutée.

## Vérifications

`node --test` : 511 réussis, 0 échec, 1 ignoré. `node scripts/validate.mjs` : réussi.
`node scripts/priority5-benchmark.mjs` : parité des montants sur les jeux synthétiques de 3 000, 10 000 et 25 000 opérations ; les temps locaux ne constituent pas un engagement de performance sur appareil mobile.

## Optimisation des historiques

`bookedAccountMonths()` calcule plusieurs mois en une lecture du grand livre au lieu de reparcourir et retrier les opérations pour chaque mois. Le planificateur l'utilise pour ses moyennes et séries historiques ; le centre intelligent pour ses six mois de référence et ses changements persistants. Aucun cache durable n'est conservé : une modification en place est relue au calcul suivant. Sur un jeu synthétique local de 25 000 opérations, une mesure isolée est passée d'environ 511 à 271 ms pour le planificateur et de 474 à 147 ms pour le centre intelligent. Ces chiffres sont indicatifs et ne représentent pas un test navigateur ou mobile.
