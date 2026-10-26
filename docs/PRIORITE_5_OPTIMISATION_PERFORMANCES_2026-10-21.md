# FREEV Gestion — Priorité 5 : optimisation des performances

Date : 21 octobre 2026. Point de départ : archive Priorité 4, 243 tests.

## Changements livrés

1. **Formats monétaires** (`assets/js/core.js`) : réutilisation de `Intl.NumberFormat` par couple devise/décimales avec un cache borné à 24 formateurs. Aucun solde, transaction ou résultat financier n'est mis en cache : pas de risque de données périmées.
2. **Calcul des prévisions** (`assets/js/finance-priority2-engine.mjs`) : groupement par mois en une seule passe ; un seul parcours des transactions pour les échéances et les occurrences déjà comptabilisées ; validation des dates non répétée pour les mêmes entrées. Le solde de départ est calculé une fois par `financeOverview`.
3. **Alertes des récurrences** (`assets/js/finance-priority2-engine.mjs`) : index `(parentId, mois)` local au calcul, au lieu de parcourir toutes les transactions pour chaque règle de récurrence. L'index respecte le premier enregistrement historique, comme l'ancien comportement. Les budgets et totaux pré-calculés sont partagés uniquement à l'intérieur du même appel de `financeOverview`.
4. **Recherche transactions** (`assets/js/transactions.js` et `index.html`) : 140 ms de temporisation pour la saisie dans Recherche, Minimum et Maximum. Les autres filtres restent immédiats. Les temporisations sont annulées si un filtre est changé ou réinitialisé, et aucun rendu différé ne se fait si l'utilisateur a quitté la page.
5. **Cache PWA** (`sw.js`) : nom de version augmenté pour diffuser les nouvelles ressources statiques, sans changement de politique de cache des données privées.

## Vérifications

- `npm run validate` : **252/252 tests réussis**, sans échec. **9 tests ajoutés** pour cette optimisation.
- Comparaison différentielle avec le moteur **intégral antérieur** (`scripts/benchmarks/finance-priority2-engine-baseline.mjs`) sur 18 jeux de données à plusieurs comptes, avec récurrences mensuelles/hebdomadaires/annuelles et paiements planifiés : résultats strictement identiques.
- Benchmark de la même sortie `financeOverview` avant/après, avec **120 récurrences**, dans un environnement local Node.js 22.16, médianes de 9 passes après préchauffage :

| Transactions | Avant | Après | Facteur |
|---:|---:|---:|---:|
| 3 000 | 16,61 ms | 6,51 ms | 2,55× |
| 10 000 | 38,62 ms | 16,79 ms | 2,30× |
| 25 000 | 95,36 ms | 35,53 ms | 2,68× |

- Microbenchmark du **formatage de 15 000 montants** (hors DOM, réseau et calculs financiers) : **372,81 ms avant, 5,65 ms après**, soit environ **66×** pour cet appel isolé. Ce facteur ne s'applique pas à l'application complète.

Les chiffres dépendent du matériel et de l'état de la machine, et ne sont ni des garanties de temps de réponse, ni des mesures navigateur. Exécuter `npm run benchmark:performance` pour refaire ces mesures. Les performances réseau Firebase ne sont pas évaluées.

## Compatibilité, sécurité et limites

- Aucun schéma de données ni règle Firestore modifié.
- Les protections des échéances historiques et des exceptions mensuelles restent en place. Aucun raccourci d'écriture cloud, ni fusion automatique supplémentaire, n'a été ajouté.
- Les tests automatisés ne couvrent pas les temps de peinture du DOM, la consommation mémoire du navigateur, ni la connexion Firebase réelle. `npm run test:browser` n'a pas démarré ici : dépendance `axe-core` indisponible. Vérifier le rendu avec Chrome/Edge et un téléphone sur un environnement de test avant déploiement.
- Sauvegarder les données financières JSON avant mise à jour. Sur une PWA installée, rafraîchir pour recevoir le nouveau service worker.

## Commandes

```bash
npm run validate
npm run benchmark:performance
# Facultatif, nécessite les dépendances de développement et Chromium :
npm ci
npx playwright install chromium
npm run test:browser
```
