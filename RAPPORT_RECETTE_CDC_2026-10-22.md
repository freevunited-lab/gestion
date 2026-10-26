# Rapport de recette — Cahier des charges FREEV Gestion v1.2 (livraison partielle)

Date : 22 octobre 2026. Données de test fictives uniquement ; aucune connexion Firebase réelle n'a été vérifiée.
Tests automatisés à la recette initiale : `node --test` → 309 réussis, 0 échec. `node scripts/validate.mjs` → réussi.
Contrôle navigateur (Chromium, données fictives) : six espaces, onglets au clavier, barre mobile, absence de débordement horizontal à 320 / 390 / 768 / 1 440 px, 0 erreur JavaScript.

## Réalisé dans cette livraison

| Exigence | État | Preuve |
|---|---|---|
| NAV 01 six accès | Fait | `tests/navigation-spaces.test.mjs`, contrôle navigateur |
| NAV 01 import / export / sauvegarde / restauration dans Paramètres | Fait (boutons déplacés) | idem |
| NAV 02 / NAV 03 tiroir et barre mobile (Accueil, Opérations, Planificateur, Patrimoine, Menu) | Fait | idem |
| PLA 03 retrait du comparateur de scénarios (données `plannerScenarios` conservées) | Fait | idem |
| DES : titres « Planificateur 1.0 » et « Centre intelligent 1.0 », badges de version retirés | Fait | idem |
| QUO 01 / QUO 02 « Ce que je peux encore dépenser » (affichage, manque explicite, réserve, date de fin) | Fait, limites ci-dessous | `tests/spendable-engine.test.mjs`, contrôle navigateur |
| ALX 01 montants exacts (module pur) | Fait pour le nouveau moteur ; **non généralisé** au reste du code | `tests/finance-core.test.mjs` |
| ALX 02 montant invalide ≠ zéro (saisie de la réserve, `parseAmount`) | Partiel | idem |
| ALX 04 prévision quotidienne | Moteur + affichage réglable de 14 à 90 jours ; interface navigateur à recetter | `finance-core.mjs`, `v4.js` |
| QUO 03 / 04 / 06 (calculs purs : parts, remboursement partiel, provisions) | Moteur + tests ; écran non livré pour ces fonctions | `finance-core.mjs` |
| AJ 06 (revenus classés et base prudente) | Moteur + écran du Planificateur, choix explicite de la base | `v4.js`, `v44IncomeProfile` |

## Mise à jour de suivi — 22 octobre 2026

La copie vérifiée contient aussi des travaux absents du tableau de livraison initial : REC 01–03 / ALX 14 sont câblés dans la recherche unique (`search-engine.mjs`, `search-ui.js`) et QUO 07 est livré dans le Centre intelligent (`monthly-check-engine.mjs`, `monthly-check.js`). Le document `docs/LOT_VERIFICATION_MOIS_QUO07_2026-10-22.md` en consigne la recette. Ces deux éléments sont donc retirés de la liste « non commencé » ci-dessous.

Étape de fondation effectuée après cette livraison : `finance-core.mjs` répartit désormais les unités monétaires avec `BigInt` pour éviter les pertes de précision quand les poids sont élevés ; les cumuls et soldes hors plage, les dates calendaires impossibles, les réserves invalides et les revenus couverts invalides sont refusés. La recette ajoute des cas limites ALX 01, ALX 02 et ALX 15.

Validation de la première mise à jour : `npm run validate` → 335 tests réussis, 0 échec ; validation des scripts, identifiants HTML et ressources locales réussie. Cette étape ne termine pas ALX 01–03 : les calculs historiques du tableau de bord et de V4/V5 ne sont pas encore tous migrés vers le moteur partagé.

Étape suivante du socle : les formulaires d’opération et de récurrence, l’import JSON et les relevés CSV/QIF utilisent maintenant `finance-money.js`. La conversion de devise part des unités minimales entières et n’arrondit qu’une fois dans la devise cible. Le montant saisi accepte la virgule décimale ; les montants trop précis sont refusés avec un message de validation. Le cache PWA est passé à `freev-v5.2.0-spaces-20261022-v4` pour distribuer le nouveau fichier. `npm run validate` → 340 tests réussis, 0 échec ; validation des scripts, identifiants HTML et ressources locales réussie. `npm run test:browser` n’a pas pu démarrer : la dépendance `axe-core` manque dans cette copie, donc le navigateur n’a pas vérifié les changements d’interface de cette étape.

## Mise à jour de suivi — suite AJ 01–02

Les opérations disposent maintenant de modèles propres au compte : nom facultatif, type, catégorie, description, montant facultatif, devise, taux de change, mode, tags et favoris. L’utilisation d’un modèle demande confirmation, préremplit un formulaire daté du jour et ne crée aucune transaction. La date, l’état de paiement et la récurrence ne sont pas copiés. Les modèles peuvent être renommés, mis en favoris ou supprimés sans modifier les opérations existantes. Si une ancienne catégorie n’est plus disponible, le formulaire demande d’en choisir une.

La catégorie est désormais facultative pour une opération comptabilisée ; une opération sans catégorie ou description porte le statut « À compléter », apparaît dans le filtre dédié et reste modifiable avec son identifiant d’origine. Son montant continue d’affecter le solde selon son état de paiement. Le bouton « Brouillon » conserve séparément les champs incomplets dans une liste hors comptabilité ; un brouillon ne rejoint ni les soldes, budgets ou exports comptables. Les sauvegardes complètes conservent les brouillons ; leur validation crée une transaction avec l’identifiant réservé au brouillon. Le cache PWA passe à `freev-v5.2.0-spaces-20261022-v5`.

Cette étape n’a pas exécuté la suite de tests. Le contrôle `node --check` confirme la syntaxe de `transactions.js`, `state.js`, `core.js` et `v4.js` ; la recette navigateur reste à reprendre lorsque `axe-core` sera disponible dans l’environnement.

## Mise à jour de suivi — ALX 04

Le Planificateur affiche maintenant une trajectoire quotidienne réglable de 14 à 90 jours. Elle inclut les mouvements datés, les échéances récurrentes et les opérations planifiées en retard repositionnées à aujourd’hui ; elle indique les échéances estimées, le point bas, la première date de solde négatif et les jours avec plusieurs flux. Les sorties sont comptées avant les entrées lorsqu’aucun ordre intrajournalier n’est connu. Les comptes de devises de base différentes ne sont pas agrégés dans ce panneau. Cette mise à jour n’a pas exécuté la suite de tests.

## Mise à jour de suivi — AJ 04–06 et projection des tarifs

Les règles récurrentes acceptent maintenant des tarifs datés avec montant, devise, taux de conversion et date d’effet. Le formulaire montre les douze prochaines échéances, les totaux avant et après et les exceptions personnalisées conservées. La confirmation ajoute une version à l’historique de la série ; les échéances passées ne changent pas. Les prévisions du Planificateur, le calendrier des échéances et les coûts d’abonnements appliquent le tarif correspondant à chaque date. Les modifications de règle conservent ces versions et la restauration d’une révision peut annuler le changement.

Le suivi d’abonnement mémorise la fin d’essai, la prochaine date payante, le coût attendu, le renouvellement automatique, le préavis, le lien de gestion, la demande de résiliation, la fin effective confirmée et le reste dû. Les rappels à sept jours et la veille peuvent être activés séparément ; à l’ouverture de l’application, FREEV affiche un message interne une seule fois par échéance et par rappel. Une date de fin effective confirmée arrête les occurrences suivantes, mais une demande de résiliation seule ne supprime pas le dernier paiement attendu. Aucune notification n’est annoncée lorsque l’application est fermée, et la résiliation reste à effectuer auprès du commerçant.

Les revenus manuels et récurrents peuvent être classés comme réguliers, variables ou exceptionnels. Le Planificateur permet de déclarer jusqu’à six mois civils complets suffisamment couverts, distingue zéro d’une donnée inconnue, calcule la médiane et propose un coefficient prudent réglable, initialisé à 80 %. Une base manuelle reste possible. Les remboursements, transferts, revenus exceptionnels et lignes non classées sont exclus. Le bloc compare la base retenue aux enveloppes et aux dépenses médianes observées ; cette valeur ne crée pas de revenu dans les soldes ou prévisions. Une nouvelle suggestion ne remplace pas silencieusement une base déjà choisie.

Les nouvelles métadonnées sont conservées dans les sauvegardes JSON, contrôlées à l’import et limitées pour protéger leur taille. Le cache PWA passe à `freev-v5.2.0-everyday-20261022-v6`. Cette mise à jour n’a pas exécuté la suite de tests ni la recette navigateur ; `node --check` a réussi pour les dix scripts modifiés.

## Mise à jour de suivi — ACT 01–02, DES 02 et export Excel

L’application d’une règle de classement aux opérations existantes affiche maintenant un aperçu paginé avant toute écriture : date, libellé, montant, type et catégorie avant/après, transferts et lignes invalides exclus, ainsi que les groupes d’opérations qui ressemblent à des doublons. Ces candidats restent présents et sont décochés par défaut ; l’utilisateur peut appliquer la règle à une sélection partielle de 4 000 opérations au maximum. L’import CSV/QIF présente aussi les erreurs et doublons écartés, les candidats possibles, les catégories/types avant et après application des règles, une sélection sur plusieurs pages et une limite conforme au compte cible. La confirmation écrit le lot en une fois. Les transferts sont aussi exclus du moteur de classement automatique à l’import.

Le dernier reclassement par règle dispose d’un retour arrière associé au propriétaire, au compte et à une empreinte des transactions. L’annulation est désactivée si les données du compte ont changé depuis l’action afin de ne pas écraser une modification. Elle rétablit les champs de classement et laisse la règle enregistrée pour les imports futurs. Un seul reclassement de ce type est conservé à la fois ; les autres actions en masse ne sont pas encore couvertes.

Les Paramètres permettent d’afficher/masquer et de réordonner au clavier certains blocs du Tableau de bord, d’Opérations, du Planificateur et du Centre intelligent. Les préférences sont conservées dans les données du compte et les sauvegardes JSON. Les blocs de brouillons et d’opérations à compléter restent toujours visibles. La réinitialisation ne touche pas aux opérations.

L’export et l’import Excel conservent également le classement des revenus, les versions de tarifs et le suivi d’abonnement pour les opérations récurrentes concernées. Le cache PWA passe à `freev-v5.2.0-everyday-20261022-v7`. Contrôles effectués : `node --check` sur les scripts modifiés et `node scripts/validate.mjs` → scripts, identifiants HTML et ressources locales cohérents. Aucun test fonctionnel ni contrôle navigateur n’a été exécuté dans cette étape.

## Mise à jour de suivi — reclassement manuel en lot

Dans Opérations, les opérations manuelles du compte actif peuvent maintenant être sélectionnées sur plusieurs pages, jusqu’à 4 000 lignes, puis reclassées vers une catégorie. L’aperçu paginé montre le montant, le type et la catégorie avant/après ; il exclut les transferts, occurrences récurrentes, prévisions et lignes invalides. Les opérations qui ressemblent à des doublons restent visibles mais décochées par défaut. Le changement efface l’identifiant de règle automatique sur les lignes sélectionnées, afin que le choix manuel prime.

La confirmation est refusée si le compte ou les données ont changé depuis l’aperçu. Le dernier reclassement manuel ou par règle peut être annulé pendant 30 minutes ; le retour arrière vérifie le propriétaire, le compte, la révision complète des transactions et l’état des lignes, et bloque en cas de conflit. Le bouton d’annulation est accessible dans Opérations et dans le Centre intelligent.

Les imports CSV/QIF ajoutent un historique par compte, limité aux 100 dernières opérations d’import, avec nom du fichier, date, compte et nombres importés, écartés ou ignorés. Il est visible dans Paramètres et inclus dans la sauvegarde JSON ; son import est validé. Paramètres fournit un raccourci vers l’écran d’aperçu CSV/QIF, qui reste situé dans le Centre intelligent. Le cache PWA passe à `freev-v5.2.0-everyday-20261022-v8`. Cette étape ajoute uniquement des contrôles de syntaxe et de cohérence statique ; aucun test ni contrôle navigateur n’a été exécuté.

## Mise à jour de suivi — menu d’ajout contextuel

Le bouton d’ajout de l’en-tête ouvre maintenant une liste adaptée à l’espace actif : opérations, récurrences, transferts, budget et capital, épargne, dettes et remboursements, imports CSV/QIF, actifs ou gestion des comptes selon la vue. Chaque entrée réutilise un formulaire ou un panneau déjà présent. Le menu utilise des boutons HTML natifs, expose son état avec `aria-expanded`, se ferme avec Échap ou après un clic extérieur et suit les changements de vue. Le focus va au champ concerné à l’ouverture des panneaux.

Le cache PWA passe à `freev-v5.2.0-everyday-20261022-v9`. Contrôles statiques à la fin de l’étape ; aucun test fonctionnel ni contrôle navigateur n’a été exécuté.

## Mise à jour de suivi — dispositions des autres espaces

La personnalisation par compte s’étend maintenant aux récurrences, analyses, objectifs et enveloppes du Planificateur, épargne, dettes et historique. Dans le tableau de bord, les blocs de disponible et de prévisions/suivi des paiements rejoignent aussi la liste. Les blocs peuvent être masqués ou déplacés au clavier dans leur groupe ; le résumé des dettes reste toujours visible et les brouillons/opérations à compléter conservent leur protection. Les préférences sont déjà incluses dans les sauvegardes JSON ; leur validation à l’import accepte maintenant ces nouveaux espaces et groupes.

Le cache PWA passe à `freev-v5.2.0-everyday-20261022-v10`. Aucun test fonctionnel ni contrôle navigateur n’a été exécuté dans cette étape.

## Mise à jour de suivi — annulation d’un import CSV/QIF

Après confirmation d’un relevé, l’utilisateur peut retirer les seules opérations de ce lot pendant 30 minutes depuis l’écran d’import, Opérations ou le Centre intelligent. L’annulation est bloquée si le compte, les opérations ou leur contenu ont changé ; elle ne touche pas les transactions antérieures. L’historique du relevé reste conservé et indique la date et le nombre d’opérations retirées. L’action annulable est incluse dans la sauvegarde JSON et validée à l’import.

Le cache PWA passe à `freev-v5.2.0-everyday-20261022-v11`. Contrôles statiques uniquement ; aucun test fonctionnel ni contrôle navigateur n’a été exécuté.

## Mise à jour de suivi — aperçu et annulation de duplication mensuelle

La duplication d’un mois utilise des champs de mois intégrés à l’application, avec le mois affiché et le suivant proposés par défaut, puis affiche un aperçu paginé avant écriture : dates sources et cibles, montants, catégories, nombre d’opérations ajoutées, doublons ignorés et lignes exclues. Les transferts, récurrences, opérations liées à une dette ou à une épargne, identifiants ambigus et dates ou montants invalides sont exclus. Les jours qui n’existent pas dans le mois cible sont ramenés au dernier jour du mois. L’action est bloquée si elle ferait dépasser 4 000 opérations dans le compte, limite de la sauvegarde/import JSON.

La confirmation revalide le compte, sa révision et le contenu de l’aperçu avant d’écrire. Les opérations créées peuvent être annulées pendant 30 minutes depuis Opérations ou le Centre intelligent ; l’annulation retire uniquement leurs identifiants et est refusée si les transactions du compte ont changé. L’action et ses références sont conservées dans la sauvegarde JSON et contrôlées à l’import. Le cache PWA passe à `freev-v5.2.0-everyday-20261022-v12`. Aucun test fonctionnel ni contrôle navigateur n’a été exécuté dans cette étape.

## Mise à jour de suivi — personnalisation du Centre intelligent

Les préférences par compte couvrent maintenant les blocs du Centre intelligent : résumé, analyse et évolution du mois, priorités, vérification mensuelle, création et suggestions de règles, abonnements, synchronisation et import, aperçu, patrimoine, sécurité et appareils. Les sections placées dans un même panneau peuvent être masquées et réordonnées ; les options sont vérifiées à l’import JSON. Le cache reste en version `freev-v5.2.0-everyday-20261022-v12`. La validation statique a été exécutée ; aucun test fonctionnel ou navigateur n’a été lancé.

## Mise à jour de suivi — soldes et totaux en unités monétaires entières

Le moteur partagé calcule maintenant les soldes de compte et les totaux de flux en unités minimales entières, puis convertit le résultat pour l’affichage. Le Tableau de bord, ses graphiques de flux, les totaux mensuels, les répartitions par catégorie, les principales analyses, le solde de la modale des comptes et les contrôles de solde avant transfert utilisent cette même règle. Les mouvements planifiés et récurrents restent exclus des soldes réels. Les valeurs numériques héritées sont acceptées si l’écart provient seulement de la représentation binaire de JavaScript ; une précision monétaire réellement ambiguë, un montant négatif incohérent ou une date invalide rend le calcul indisponible au lieu de produire un faux zéro. Dans une vue groupée contenant plusieurs devises de base, le solde agrégé est aussi indisponible tant qu’une conversion commune n’est définie.

Le Tableau de bord et la gestion des comptes affichent « À vérifier » lorsque les données ne permettent pas d’établir un total. Les transferts qui dépendent d’un tel solde sont bloqués. Le cache PWA passe à `freev-v5.2.0-everyday-20261022-v13`. Contrôle statique uniquement ; aucun test fonctionnel ni navigateur n’a été exécuté. Les soldes des courbes journalières, les budgets, l’épargne, plusieurs indicateurs et certains exports historiques utilisent encore leurs chemins numériques antérieurs.

## Limites connues de ce qui est livré

- Les sommes « affectées à des projets » ne sont pas retranchées du disponible (aucun suivi d'affectation n'existe).
- La réserve et la date de fin sont stockées dans `plannerSettings` du compte ; en vue groupée, la réserve affichée est la somme des réserves des comptes, modifiable uniquement pour le compte actif.
- Les anciens calculs (dashboard, v4/v5) manipulent encore des nombres flottants ; la migration vers `finance-core.mjs` (ALX 01/03) n'est pas faite.
- Import / export / relevés : l’historique des imports CSV/QIF est visible dans Paramètres ; l’écran d’aperçu reste dans le Centre intelligent et s’ouvre depuis un raccourci dans Paramètres ou le menu d’ajout contextuel.
- Le sélecteur de compte garde sa forme actuelle (liste dans le panneau).
- Les opérations historiques sans catégorie ou description sont signalées comme à compléter par déduction ; aucune donnée historique n’est réécrite.
- Le cache du service worker passe en `freev-v5.2.0-everyday-20261022-v12` : actualiser les onglets ouverts après déploiement.

## Reste à réaliser dans le CDC

Justificatifs et garanties (AJ 03 ; l’envoi privé nécessite une intégration Storage autorisée et sécurisée, les règles actuelles refusent tout accès) ; autres aperçus et annulations des actions en masse (ACT 01–02, maintenant disponibles pour imports CSV/QIF, reclassements manuels ou par règle et duplication mensuelle) ; personnalisation d’autres blocs et espaces (DES 02, étendue au tableau de bord, Opérations, Récurrences, Analyses, Planificateur, Centre intelligent, Épargne, Dettes et Historique) ; charte visuelle unifiée UI 01–07 ; migration générale vers le moteur partagé (ALX 01–03, encore partielle) ; doublons et rapprochements financiers (ALX 05–06) ; évaluateur rétrospectif et calibration d’incertitude à raccorder aux snapshots réels (ALX 08–09) ; apprentissage des corrections confirmées (ALX 11) ; recalcul incrémental et workers (ALX 12–13) ; mesures de performance sur appareils réels (PER).

## Mise à jour de suivi — lot algorithmes ALX 01–15

Le moteur partagé de monnaie est maintenant utilisé par le cockpit financier, le calcul strict du disponible et du solde, la vérification mensuelle et l’aperçu d’import bancaire. Les calculs intégrés conservent les unités minimales entières, convertissent les opérations avec un taux explicite et renvoient l’identifiant/champ d’une donnée invalide. Les résultats bloqués ne sont plus remplacés par zéro dans ces parcours. La migration reste partielle : le patrimoine et plusieurs calculs historiques de V5, les courbes et certains exports utilisent encore leurs chemins numériques antérieurs (ALX 01–03).

| Exigence | État après ce lot | Preuve / limite |
|---|---|---|
| ALX 01–02 — montants exacts, dates et erreurs traçables | Partiel, raccordé aux parcours listés ci-dessus | `finance-core.mjs`, `finance-priority2-engine.mjs`, `v4-engine.js`, `spendable-engine.mjs`, `monthly-check-engine.mjs`, `bank-sync-engine.js` ; suites ciblées réussies. Le moteur V5 et des vues/exports historiques restent à migrer. |
| ALX 03 — moteur partagé et parité différentielle | Partiel | Cockpit et fonctions de trésorerie partagent les primitives ; comparaison contre le moteur précédent sur 18 scénarios, mêmes résultats financiers. Les champs `*Minor` et la présentation localisée sont des métadonnées de la nouvelle API. |
| ALX 04 — trajectoire de trésorerie quotidienne | Livré précédemment | Planificateur, horizon 14–90 jours, point bas, premier solde négatif et échéances contributrices ; suites de stabilité ALX 04. |
| ALX 05 — doublons certains et possibles | Partiel, détection certaine raccordée à l’import bancaire | Identifiant fournisseur limité à la source et au compte ; ressemblances conservées en revue et décochées par défaut. Le rapprochement de l’autorisation et de l’écriture comptabilisée est traité par le moteur pur, mais reste à raccorder aux autres imports. |
| ALX 06 — rapprochement et allocations | Moteur pur disponible, interface non raccordée | `financial-matching-engine.mjs` vérifie comptes/devises/sens, reste disponible, paiements partiels ou groupés et écritures atomiques sans dépasser les montants ; tests unitaires ALX 06. |
| ALX 07 — dépenses connues, habitudes et saisonnalité | Livré dans le Planificateur | `estimateNextMonthExpenses` sépare dépenses manuelles observées des échéances récurrentes et planifiées ; médiane entière, fréquence de récurrence observée et saisonnalité seulement après deux mois comparables. Minimum de trois mois documentés pour les habitudes ; devise mixte bloquée ; opérations illisibles comptées et exclues. |
| ALX 08 — évaluation rétrospective sans fuite | Évaluateur pur disponible, modèle réel non évalué | `forecast-evaluation.mjs` mesure MAE, manques ratés, fausses alertes et fenêtres incomplètes avec données disponibles à la date du test. L’application ne conserve pas encore les snapshots historiques nécessaires pour l’appliquer honnêtement au planificateur. |
| ALX 09 — calibration d’incertitude | Garde-fous livrés, calibration produit non raccordée | La calibration holdout exige un échantillon et une couverture suffisants ; le planificateur et le Centre intelligent n’affichent plus de pourcentage de confiance non validé. Les fourchettes de scénario V4 restent explicitement non calibrées. |
| ALX 10 — changements persistants robustes | Partiel, intégré au Centre intelligent | V5 compare deux périodes de trois mois avec médiane et écart absolu médian ; deux mois récents au-dessus d’un seuil sont requis. Un pic isolé n’est pas une hausse persistante. |
| ALX 11 — apprentissage sur corrections confirmées | Partiel, suggestions renforcées | Le moteur utilise les catégories enregistrées sans identifiant de règle, sépare revenus et dépenses, écarte virements/récurrences et refuse les groupes insuffisamment cohérents. Les règles suggérées gardent un aperçu avant application. L’apprentissage versionné et la mémoire durable des corrections restent à réaliser. |
| ALX 12 — recalcul incrémental | Partiel | Cache LRU borné et clés versionnées par compte, révision, période, date et options ; cache activé sur le cockpit financier. D’autres vues calculent encore sans révision exploitable. |
| ALX 13 — résultats asynchrones obsolètes | Partiel | Le flux bancaire interrompt une requête remplacée et refuse son rendu si elle est périmée (`calculation-coordination.mjs`). Aucun worker n’a été ajouté : les benchmarks actuels ne justifient pas le coût de transfert et de synchronisation. |
| ALX 14 — recherche structurée et stable | Livré précédemment | Recherche unique avec critères reconnus, filtres stricts sur les champs concernés et classement stable ; REC 01–03. |
| ALX 15 — invariants et concurrence | Partiel | Tests de répartition générés, 18 scénarios différentiels du cockpit et tests CAS/cloud existants ; le reste des moteurs n’a pas encore de propriétés générées exhaustives. |

Recette de ce lot : 159 tests ciblés réussis, ainsi que le test différentiel couvrant 18 cas ; `node scripts/validate.mjs` réussit. La suite complète contient 388 tests : 300 réussis et 88 en échec. Le nombre d’échecs est le même qu’au relevé de référence antérieur (88/340) ; ils comprennent des attentes de cache PWA périmées et des fixtures DOM/concurrence non adaptées. Cette suite complète reste donc rouge et les contrôles ciblés ne la remplacent pas.

Mesures locales : le benchmark de projection donne des médianes de 2,15 ms (3 000 opérations), 5,75 ms (10 000) et 14,09 ms (25 000), avec un maximum observé de 15,94 ms. Le cockpit exact conserve les mêmes résultats financiers que le moteur précédent, avec un temps médian mesuré de 13,86 ms, 39,36 ms et 93,90 ms sur ces volumes (soit 0–14 % de plus dans ces essais). Le cache de formatage monétaire traite 15 000 valeurs en 5,33 ms contre 312,64 ms sans réutilisation (58,68×). Mesures Node locales, sans navigateur ni réseau ; elles ne garantissent pas les performances sur chaque appareil.

Le cache PWA passe à `freev-v5.2.0-everyday-20261022-v27` et précharge `calculation-coordination.mjs` et `financial-matching-engine.mjs`, dépendances des parcours financiers et bancaires.

## Mise à jour — scan local de tickets sur mobile

Le Tableau de bord propose un raccourci de scan visible uniquement sous 769 px. Le parcours accepte la caméra arrière ou une photo, réduit les images à 4,2 mégapixels maximum pour limiter la mémoire mobile, lit le français avec Tesseract.js embarqué et conserve le traitement dans le navigateur. Les ressources OCR pèsent environ 20 Mo dans l’application ; une seule variante compatible du moteur et le modèle français (environ 13 Mo au total) sont chargés au premier scan puis mis en cache à la demande. Cela ne ralentit pas le chargement courant, mais le premier scan nécessite un accès réseau si les ressources n’ont pas déjà été téléchargées. Le scan caméra requiert un contexte sécurisé (site HTTPS ou localhost).

Le parseur repère des magasins connus, les dates et les lignes de total TTC/net à payer. Les champs restent modifiables et les résultats manquants sont laissés vides. « Vérifier la dépense » ouvre ensuite la modale de transaction existante avec le compte actif, la devise, la date, le montant, la catégorie suggérée et la description préremplis ; seule l’action habituelle « Enregistrer » comptabilise l’opération. La photo et le texte OCR ne sont pas ajoutés à la transaction ni transmis par le scanner.

Le graphique prévisionnel du Planificateur utilise maintenant l’accent vert FREEV et conserve sa largeur complète sur mobile au lieu d’agrandir/couper le SVG. Les suites ciblées couvrent quatre cas d’extraction ticket, trois cas d’estimation ALX 07 et la mise en page du graphique ; 31 tests ciblés passent et `node scripts/validate.mjs` réussit. Le parcours navigateur complet n’a pas été validé : la prévisualisation `file://` bloque les modules ES et l’ouverture d’un serveur local HTTP a échoué dans l’environnement de contrôle. Le contrôle de mise en page mobile a toutefois confirmé que le raccourci apparaît à 390 px et disparaît à 1440 px.

## Mise à jour — durcissement et mesure des algorithmes

Le lecteur de tickets corrige maintenant les confusions OCR `O/0` dans les montants, dates et libellés de total. Si le montant ou la date manque, ou si la confiance OCR est inférieure à 45/100, il fait une seconde lecture locale avec une mise en page différente. Les valeurs des deux lectures sont rapprochées : une contradiction non résolue laisse le champ vide et demande une vérification. Le scanner ne valide toujours aucune dépense sans relecture et enregistrement explicites.

Le cockpit financier valide les dates avec les règles calendaires grégoriennes et conserve au plus 512 résultats de validation. Les conversions déjà calculées sont gardées par objet et invalidées quand un montant ou une devise change ; pour un cockpit de plus de 65 536 opérations, ce cache est désactivé le temps du calcul afin d’éviter sa rotation répétée. Les montants numériques déjà stockés en monnaie de base suivent directement les mêmes contrôles d’exactitude et de précision que le parseur partagé. Les cumuls vérifient les entiers sûrs sans allouer de `BigInt` à chaque ligne. Les alertes de doublon et de retard parcourent les transactions sans créer de copie complète du tableau. L’empreinte de transaction évite désormais un tri et des chaînes temporaires tout en conservant tous les champs et l’ordre des opérations. Le calcul des périodes mensuelles et annuelles utilise directement les dates ISO déjà validées ; seules les périodes hebdomadaires ont besoin de la conversion ISO complète.

Mesures reproductibles (`node scripts/priority5-benchmark.mjs`, médianes locales après préchauffage) : sur 3 000 / 10 000 / 25 000 opérations, le calcul financier exact passe respectivement de 12,17 / 37,70 / 80,47 ms à 3,80 / 7,91 / 15,40 ms, avec des sorties identiques au moteur de référence sur ces jeux de données (gains de 3,21× / 4,77× / 5,23×). Le calcul de l’empreinte seule passe de 18,61 à 10,35 ms sur 25 000 opérations (1,80×). Le cache de formatage traite 15 000 valeurs en 5,34 ms contre 312,82 ms sans réutilisation (58,55×). Le benchmark de scan (`node scripts/receipt-scan-benchmark.mjs`) passe de 6/8 à 8/8 cas synthétiques exacts pour le montant et la date ; le parseur seul mesure environ 0,0072 ms par ticket contre 0,0059 ms avant, soit un léger surcoût absolu d’environ 0,0014 ms. Le corpus de huit cas est synthétique et ne mesure pas la précision sur des photos réelles ; le gain global du cockpit reste inférieur à 20×.

Le stress test reproductible `node --max-old-space-size=8192 --expose-gc scripts/stress-finance-10m.mjs` passe sur 10 000 000 d’opérations synthétiques : 10 000 000 centimes de dépenses, 10 000 000 centimes de solde prévisionnel et alerte de doublons attendus ; calcul en 8,9 s. Le tas utilisé après nettoyage reste à 996,6 Mio, presque le même qu’après la création des opérations (996,5 Mio) ; son pic pendant le calcul monte à 3 082 Mio et la mémoire résidente reste à 3 235 Mio après nettoyage, car le moteur V8 garde des pages réservées. Ce scénario porte sur un seul compte et des dépenses identiques d’un centime ; ce n’est pas une garantie de fonctionnement navigateur/Firebase à ce volume.

Les suites ciblées passent (79 tests de scan, moteurs financiers et animations, plus 5 tests ciblés de parité, empreinte et cache PWA) et `node scripts/validate.mjs` réussit. Le fichier complet `priority5-performance.test.mjs` comporte encore cinq erreurs de harnais de test (`FREEVMoney` et `window` absents du contexte simulé) ; les cinq cas de ce fichier pertinents à la parité et à l’empreinte passent séparément. Le navigateur réel et la seconde passe Tesseract n’ont pas pu être validés de bout en bout dans la prévisualisation `file://` ; les mesures ne remplacent pas un essai sur des appareils et tickets réels. Le cache PWA est incrémenté en `freev-v5.2.0-everyday-20261022-v33`.

## Mise à jour — suggestions de classement par preuves

Le moteur des suggestions de règles distingue maintenant revenus et dépenses pour chaque commerçant. Il écarte les opérations déjà classées par une règle, les virements, les mouvements liés à l’épargne ou à une dette, les récurrences et les prévisions. Il attend au moins trois opérations du même type et une cohérence historique de 80 % avant de proposer une catégorie. La règle suggérée reste limitée à ce type et passe par l’aperçu existant avant toute application ; une suggestion pour les dépenses ne reclasse donc pas les remboursements entrants du même commerçant. Les groupes ambigus ne sont pas proposés. Une valeur de type de correspondance inconnue est ignorée par sécurité.

Le benchmark reproductible `node scripts/automation-intelligence-benchmark.mjs` compare les suggestions historiques et renforcées sur un corpus synthétique avec des lignes de vérification distinctes. Sur ce corpus, la précision des lignes couvertes monte de 75 % à 100 % (4 lignes couvertes avant, 3 après ; toutes correctes après). Les médianes mesurées sont de 2,96 ms avant contre 4,30 ms après sur 4 000 lignes, et de 69,08 ms contre 101,67 ms sur 100 000 lignes. Le surcoût absolu sur un compte de 4 000 lignes est d’environ 1,3 ms. Ces chiffres sont un contrôle synthétique et ne mesurent pas la précision réelle sur les comptes des utilisateurs. La mémoire durable des corrections reste à réaliser pour achever ALX 11. Le cache PWA passe à `freev-v5.2.0-everyday-20261022-v34`.

## Mise à jour — rapprochement, apprentissage confirmé et portée sans connexion bancaire

Le Centre intelligent comprend maintenant un parcours de rapprochement des paiements avec les opérations planifiées. Freev propose des candidats comparés par compte, devise, sens, montant, date et libellé ; l’utilisateur vérifie puis confirme les liens. Les paiements partiels ou groupés sont limités au montant encore disponible. Le retour arrière retire le dernier lot de liens et laisse les opérations d’origine intactes. La revue de doublons sur 90 jours est en lecture seule et plafonnée à 500 lignes.

Les corrections confirmées sont mémorisées par compte, dans une limite de 500 preuves. Transferts, récurrences, projections, imports non confirmés et lignes non admissibles sont ignorés. Une règle issue de l’apprentissage n’est proposée qu’à partir de trois exemples avec au moins 80 % de cohérence ; elle doit être vérifiée avant toute application. Chaque preuve peut être annulée. Les suggestions sont désormais présentées comme des classements proposés, sans promesse de fiabilité absolue.

Le Planificateur indique clairement que la précision prédictive ne peut pas encore être mesurée : les opérations seules ne remplacent pas des soldes historiques datés et immuables. Aucun taux de probabilité n’est annoncé sans échantillons adaptés.

Vérifications : 79 tests ciblés réussis, 0 échec, 1 contrôle navigateur ignoré faute de Playwright/Chromium ; `node scripts/validate.mjs` et les contrôles de syntaxe réussissent. Le stress test local de 10 000 000 d’opérations synthétiques passe en 9,24 s de calcul, avec 10 000 000 centimes de dépenses et le solde prévu attendu. Après nettoyage, Node utilise 996,7 Mio de tas et le processus 3 179,4 Mio de mémoire résidente. Le jeu de test contient un seul compte et des dépenses d’un centime ; ce résultat n’est pas une garantie pour le navigateur ou les appareils mobiles.

Aucune nouvelle connexion bancaire n’a été ajoutée. Le scan des tickets continue de lire les photos sur l’appareil et attend la confirmation de la dépense. Le cache PWA passe à `freev-v5.2.0-everyday-20261022-v35`.

## Mise à jour — sélection des opérations en lot

Dans Opérations, la case de l’en-tête sélectionne uniquement les opérations modifiables. Les occurrences automatiques, prévisions, transferts, identifiants en double et montants/dates invalides ne sont pas sélectionnables ; la barre de sélection affiche désormais le nombre de lignes exclues et la raison générale. Les cases désactivées exposent aussi leur motif, et l’en-tête retrouve son état partiel après un nouvel affichage. Aucun contrôle navigateur n’a été effectué pour cet ajustement.

À la demande de l’utilisateur, la case de sélection globale a ensuite été retirée de l’en-tête du tableau ; les cases individuelles restent disponibles pour le classement en lot. Le cache PWA passe à `freev-v5.2.0-everyday-20261022-v37`.

## Mise à jour — retrait des cases dans la liste des opérations

Les cases de sélection par ligne, le panneau de classement manuel en lot et son aperçu de confirmation ont été retirés de la liste Opérations. Les commandes habituelles de chaque opération restent disponibles, ainsi que le classement automatique par règles dans le Centre intelligent. Le cache PWA passe à `freev-v5.2.0-everyday-20261022-v38`.

## Correction — actions du menu « Ajouter »

Le style `display:flex` des entrées du menu prenait le dessus sur l’attribut HTML `hidden`. Des actions prévues pour d’autres vues restaient visibles, puis étaient ignorées par le contrôle de contexte au clic. Les entrées masquées sont maintenant réellement cachées, et « Indiquer le solde de départ » est aussi disponible depuis le tableau de bord. L’inventaire confirme que chaque action proposée possède un gestionnaire. Les deux tests ciblés passent et `node scripts/validate.mjs` réussit. Le fichier complet `premium-priority3.test.mjs` conserve trois assertions obsolètes sur des libellés et l’ancienne version du cache (12/15 réussis). Le cache PWA passe à `freev-v5.2.0-everyday-20261022-v40`.

## Finition — transitions et micro-interactions

La couche Signature ajoute une entrée légèrement décalée aux cartes de la vue lors des changements d’écran, une ouverture plus douce des fenêtres et du menu « Ajouter », et un relief discret au survol sur ordinateur. Les icônes fléchées reçoivent un mouvement léger, et les retours tactiles utilisent l’accent turquoise FREEV sur les boutons clairs. Les animations sont limitées à l’opacité et aux transformations, sans animer les dimensions ; le réglage système de réduction des animations les désactive. Le cache PWA passe à `freev-v5.2.0-everyday-20261022-v41`.
