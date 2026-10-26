# FREEV Gestion 5.1 — Campagne multi-audits et correctifs

**Date :** 21 octobre 2026  
**Base utilisée :** `FREEV_Gestion_Audit_Recurrences_Corrige.zip` (version corrigée après le précédent audit)  
**Méthode :** revue statique des fichiers source JS/HTML/règles de sécurité/Worker, tests de non-régression Node sur le code applicatif, vérification des contrôles de validation et compilation syntaxique. Aucune donnée bancaire ou compte utilisateur n'a été utilisé.

## Résumé

- **14 volets examinés**, dont 9 comportent des corrections ou des durcissements supplémentaires.
- **89 tests Node réussis sur 89**, **0 échec** après corrections ; **71/71** sur l'archive de départ.
- **18 nouveaux tests** ajoutés : 5 dans `tests/recurring-month-isolation.test.mjs` et 13 dans `tests/multi-audit-data-integrity.test.mjs`.
- `npm run validate` passe : syntaxe des scripts, références de ressources locales, identifiants HTML et suite de tests Node.
- **Limite importante :** les tests E2E navigateur n'ont pas pu être exécutés : Chromium bloque l'accès à `localhost` et `file://` avec `ERR_BLOCKED_BY_ADMINISTRATOR`. Les tests de connexion Firebase réelle, émulateur Firestore et banque Powens réelle n'ont pas été effectués ; ils restent nécessaires avant la production.

## Audits thématiques

| N° | Domaine | Résultat | Correction ou observation |
|---|---|---|---|
| 1 | Modification ponctuelle d'une récurrence | Tests confirmés | Une seule occurrence peut changer de montant/date au sein de sa période ; les autres mois ne changent pas. La protection précédente est conservée. |
| 2 | Modification de toute la série et historiques | **Corrigé — priorité haute** | Lors des connexions ultérieures, la génération pouvait combler des anciens mois absents avec le nouveau tarif. Chaque règle modifiée reçoit maintenant `historicalBackfillThrough` ; la création rétroactive avant cette date est bloquée. |
| 3 | Récurrences hebdomadaires, annuelles et fins de mois | Tests confirmés | Couverture des périodes ISO, 29 février et échéances au 31 ; projection cohérente avec les exceptions et échéances ignorées. |
| 4 | Doublons de récurrences et effets d'épargne/dette | **Durci — priorité haute** | La déduplication n'efface plus silencieusement deux opérations distinctes avec effets financiers déjà appliqués : elle préserve les écritures pour rapprochement manuel. Aucune contre-écriture financière risquée n'est inventée. |
| 5 | Duplication d'un mois sur un autre | **Corrigé — priorité moyenne** | La recherche de doublons tenait compte du libellé d'origine mais pas du suffixe de la copie. Copier deux fois le même mois est maintenant idempotent et dupliquer un mois sur lui-même est refusé. |
| 6 | Dates et montants lors des saisies | **Corrigé — priorité moyenne** | Rejet des dates inexistantes (ex. 31 février), des produits de conversion monétaire infinis, des montants à zéro après arrondi et des montants excessifs. |
| 7 | Import JSON multi-comptes | **Durci — priorité haute** | Contrôle préalable des dates, types, montants, fréquences, IDs répétés des comptes/transactions/règles, avant toute mutation de l'état financier. |
| 8 | Import Excel | **Durci — priorité moyenne** | Les dates calendaires invalides sont écartées avant leur intégration dans les opérations financières. |
| 9 | Soldes et transferts d'épargne/dette | Audité partiellement | Les tests de changement ponctuel de transfert préservent l'impact unique sur l'épargne. Les doublons aux effets financiers appliqués sont désormais conservés pour examen. Les cas historiques ambigus nécessitent contrôle de leurs soldes réels. |
| 10 | Confidentialité des sauvegardes locales | **Corrigé — priorité haute** | `autoBackupSilent` et `manualAutoBackup` ne stockent plus de données si « appareil fiable » est désactivé. Désactiver l'option supprime les sauvegardes sensibles dans `localStorage`. L'import avertit si aucun backup local n'est possible. |
| 11 | Synchronisation Firebase et changements de session | **Durci — priorité haute** | Ajout d'une garde UID + génération de session autour des sauvegardes cloud. Une déconnexion avertit si le dernier envoi n'a pas pu être confirmé, au lieu d'affirmer que tout est synchronisé. |
| 12 | Firestore / Storage / Worker bancaire | Revues statiques + tests existants | Règles Firestore limitées au propriétaire du document, Storage refusé, origine et authentification validées côté Worker, protections anti-abus testées par les suites existantes. Aucun test contre le service bancaire réel. |
| 13 | PWA et ressources hors ligne | **Corrigé — priorité moyenne** | Invalidation du cache et ajout des feuilles CSS et modules JS essentiels manquant dans le pré-cache. Vérification automatisée de la couverture des ressources locales chargées depuis HTML. |
| 14 | Interface, mobile, accessibilité, performance | Revue statique seulement | Identifiants HTML uniques, fichiers locaux existants et structure cohérente. Aucune garantie sur le parcours réel mobile, l'accessibilité WCAG ou les performances, faute de lancement navigateur possible. |

## Reproductions clés

### A. Nouveau tarif sans réécriture de l'historique

Série Internet à **50 €/mois**, modification de série au **21/10/2026** vers **99 €/mois**. Les opérations d'août/septembre déjà enregistrées gardent 50 €, celle d'octobre déjà passée garde 50 € et la projection de novembre affiche 99 €. Un redémarrage simulé n'ajoute plus d'anciens mois absents au prix de 99 €.

**Important :** le correctif interdit la recréation des trous historiques après une édition ; il n'invente pas les anciens montants d'une série déjà modifiée dans une version antérieure. Ces données doivent être restaurées depuis un historique ou une sauvegarde fiable si nécessaire.

### B. Duplication mensuelle

Transaction du 31 janvier reproduite au 28 février : premier appel crée une seule copie, le second en crée zéro. Les copies sont déconnectées des séries récurrentes.

### C. Imports défectueux

Un JSON comportant une transaction datée `2026-02-31`, un montant non numérique, un type inconnu ou deux opérations ayant le même ID dans un compte est maintenant rejeté avant le remplacement des données.

### D. Double écriture avec effets d'épargne

Deux occurrences récurrentes distinctes et déjà imputées au même mois ne sont plus fusionnées automatiquement ; les deux restent dans les données et doivent être examinées. Le contrôle de santé des données signale aussi les clés de période incohérentes par rapport à la date des opérations.

## Fichiers modifiés dans cette campagne

- `assets/js/recurring.js` — plancher historique de génération et protection des doublons financiers.
- `assets/js/transactions.js` — sérialisation du plancher historique et validations des dates/montants.
- `assets/js/core.js` — date ISO réutilisable et sécurité des backups locaux.
- `assets/js/health.js` — diagnostic des périodes récurrentes, réutilisation du validateur ISO commun.
- `assets/js/data-io.js` — import JSON/Excel robuste, duplication mensuelle idempotente, avertissement backup.
- `assets/js/state.js` — purge du cache sensible lors de la désactivation de l'appareil fiable.
- `assets/js/firebase-auth.js` — sauvegardes limitées à la session et confirmation explicite lors de la déconnexion.
- `sw.js` — nouveau pré-cache PWA.
- `tests/recurring-month-isolation.test.mjs` — scénarios supplémentaires.
- `tests/multi-audit-data-integrity.test.mjs` — 13 scénarios supplémentaires.

## Risques résiduels et limites avant publication

1. **Critique à vérifier :** le cache persistant **IndexedDB** utilisé par le SDK Firestore si l'option « appareil fiable » était activée au lancement. La désactivation purge les données sensibles du `localStorage`, mais le cache du SDK peut nécessiter une procédure de suppression/relance supplémentaire. **Ne pas présenter l'option comme une garantie de purge totale du navigateur tant que ce cas n'a pas été testé.**
2. **Important :** certaines bibliothèques JavaScript sont chargées depuis des CDN externes sans attribut SRI (`vendor-loader.js`), notamment XLSX et Chart.js. Ajouter une politique CSP compatible et envisager l'auto-hébergement ainsi qu'une revue des dépendances.
3. **Important :** sans vraie session Firebase/Firestore, les comportements multi-appareils, déconnexion pendant un envoi, reconnexion réseau, limites de taille des documents et conflits d'écriture restent à tester.
4. **Important :** deux écritures historiques ayant toutes deux des effets d'épargne/dette appliqués ne peuvent pas être rapprochées correctement sans journal financier de référence. Le logiciel les conserve pour éviter une correction silencieuse risquée.
5. **À vérifier :** tester le flux entier de l'interface en Chromium/Safari mobile, l'import/export de vrais fichiers, les droits Firestore avec émulateur et la banque dans un bac à sable.
6. **Dépendances :** aucune analyse de vulnérabilités de dépendances `npm audit` à jour n'a été réalisée ; les tests Node couvrent la logique, pas l'inventaire des CVE.

## Consignes de livraison

1. Exporter une sauvegarde JSON depuis la version actuellement en production.
2. Déployer d'abord cette archive sur un environnement de **test** avec un compte fictif.
3. Créer une récurrence mensuelle, modifier uniquement septembre, puis modifier toute la série. Vérifier août, septembre, octobre, novembre et décembre après reconnexion.
4. Vérifier les soldes d'épargne et les dettes avec un transfert récurrent puis son annulation.
5. Tester la déconnexion hors ligne, le basculement entre deux comptes Firebase, les imports JSON/Excel et la PWA.
6. Déployer en production seulement après validation des points bloquants.

**Bilan :** les 89 tests automatisés disponibles réussissent, mais cela ne constitue pas une certification de sécurité ni une preuve de bon fonctionnement en environnement de production.
