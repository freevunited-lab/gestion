# FREEV Gestion 5.1 — Contre-audit approfondi

**Date :** 21 octobre 2026  
**Version source :** `FREEV_Gestion_Multi_Audits_Corrige_2026-10-21.zip`  
**Objet :** refaire les audits avec un focus sur les modifications ponctuelles des récurrences, la protection des données entre comptes, les opérations d'annulation, les dettes et la restauration des sauvegardes.

## Synthèse vérifiable

- **89 tests existants réussis avant modification**, à partir de l'archive de référence.
- **15 nouveaux tests** de reproduction/non-régression, dans `tests/reaudit-cross-account.test.mjs`.
- **104/104 tests réussis** après correctifs, avec `node --test`.
- `node scripts/validate.mjs` : **validation réussie** des scripts, identifiants HTML et références aux ressources locales.
- Tentative d'exécution navigateur (Python Playwright + Chromium système) : **non réalisable dans cet environnement**. Navigation vers l'application locale refusée par Chromium avec `net::ERR_BLOCKED_BY_ADMINISTRATOR`. Les tests E2E navigateur ne sont donc **pas déclarés réussis**.
- Aucun test réel Firebase, Firestore Emulator, Powens, navigateur mobile ou IndexedDB n'a été réalisé.

## Grille des audits

| N° | Thématique | Constats et résultat |
|---:|---|---|
| 1 | Modifier un seul mois récurrent | Les tests conservés couvrent l'exception d'un mois sans changer les autres montants. Aucun nouveau défaut reproduit dans ces scénarios. |
| 2 | Modifier toute une série | Les tests précédents du plancher historique passent toujours. Les échéances déjà payées ne sont pas réécrites. |
| 3 | Récurrences hebdomadaires et annuelles | Tests de semaine, fin d'année, 29 février et échéances au 31 conservés. |
| 4 | Annulation d'une suppression simple | **Corrigé :** une ancienne action « Annuler » ne restaure plus une autre suppression ; elle refuse les identifiants déjà présents. |
| 5 | Changement de compte après suppression | **Corrigé :** une action créée sur le compte A ne modifie pas B si l'utilisateur a changé de compte. |
| 6 | Déconnexion/reconnexion et boutons « Annuler » | **Corrigé :** chaque nouvelle session d'authentification invalide les actions d'annulation de l'ancienne session. |
| 7 | Navigation aller-retour A → B → A | **Corrigé :** jeton de navigation de compte qui invalide les anciennes actions, même après retour sur le compte d'origine. |
| 8 | Suppression de dette avec ID présent dans deux comptes | **Corrigé :** seules les écritures du compte propriétaire, ou les remboursements étrangers visant explicitement ce compte, sont déliées. |
| 9 | Suppression de dette puis « Annuler » | **Corrigé :** retour de la dette **et** de ses liens vers les transactions si ceux-ci n'ont pas été remplacés entre-temps. |
| 10 | Remboursement provenant d'un autre compte | **Corrigé :** `linkedDebtAccountId` détermine si le remboursement doit être délié lors de la suppression de la dette. |
| 11 | Annulation des exceptions récurrentes | **Durci :** la restauration n'utilise pas une règle obsolète après modification/remplacement de la série. |
| 12 | Suppression d'une série récurrente | **Durci :** restauration refusée après changement de contexte utilisateur ou si la règle existe déjà. |
| 13 | Sauvegarde locale et identité Firebase | **Corrigé :** le propriétaire `ownerUid` est enregistré ; la restauration refuse une autre identité Firebase. Pour les sauvegardes historiques sans UID, deux concordances sont requises (cache local et dernier UID). |
| 14 | Restauration de sauvegarde défectueuse | **Durci :** validation avec `validateImportData` **avant** remplacement de l'état de l'application ; l'appareil non fiable ne peut pas produire de sauvegarde automatique. |
| 15 | PWA et cache de code | **Corrigé :** version du cache Service Worker modifiée afin de déclencher une nouvelle mise à jour des ressources. |
| 16 | Interactions mobiles et accessibilité | Vérification statique seulement : pas de test visuel ou au clavier en navigateur réel, blocage d'environnement. |
| 17 | Firestore, authentification et multi-appareils | Revue statique de la sauvegarde en cours. Pas de preuve E2E de résolution des conflits ni des chargements hors ligne. |
| 18 | Compatibilité import/export, SDK et dépendances | Tests existants réussis ; aucune inspection de vulnérabilités de dépendances en ligne ni test contre données réelles. |

## Cas de régression nouvellement automatisés

1. Sauvegarde A refusée sous l'utilisateur Firebase B.
2. Sauvegarde A acceptée sous A.
3. Ancien backup anonyme refusé sans preuves concordantes.
4. Restauration d'un autre utilisateur interrompue **avant** confirmation et mutation.
5. Restauration d'un backup mal formé refusée.
6. Suppression A puis passage au compte B : aucune écriture ne réapparaît chez B.
7. Deux suppressions successives : le premier bouton « Annuler » ne restaure pas la deuxième écriture.
8. Déconnexion : bouton d'annulation de l'ancienne session inactif.
9. Dette ID X chez A et chez B : la suppression de A ne délie pas la dette de B.
10. Annulation : la dette et ses liens historiques sont restaurés.
11. Annulation d'une dette après changement de compte refusée.
12. Annulation d'une exception récurrente après changement de compte refusée.
13. Navigation A → B → A : anciens boutons invalidés.
14. Remboursement explicitement lié à la dette A depuis B : déliaison puis rétablissement corrects, sans toucher la dette B.
15. Transaction du compte A explicitement liée à une dette de B : aucune déliaison involontaire.

## Risques à traiter avant la production

**Priorité critique — Chargement cloud indisponible :** la revue statique montre que `loadCloudAndInit` peut, en cas d'échec initial de `getDoc`, charger un état local ou vierge puis terminer l'initialisation. Il faut vérifier avec des erreurs réseau simulées qu'un état local ancien ou vide ne peut pas écraser ultérieurement un cloud plus récent lors de la reconnexion. Une stratégie de résolution des conflits et un verrouillage des écritures tant que la version cloud n'a pas été vérifiée sont recommandés. Ce point **n'a pas été corrigé ici**, pour ne pas changer sans validation la politique de travail hors ligne.

**Priorité haute — Cache Firestore persistant :** désactiver « appareil fiable » supprime les données du `localStorage`, mais il faut vérifier en navigateur si le cache IndexedDB du SDK Firebase conserve des données déjà téléchargées. Ne pas annoncer une purge intégrale tant qu'un test réel n'existe pas.

**Priorité haute — Bibliothèques CDN :** vérifier l'intégrité, la CSP, les versions et la provenance des bibliothèques tierces chargées dynamiquement. Aucun audit CVE à jour n'a été effectué.

**Priorité haute — Modifications financières concurrentes :** plusieurs appareils modifiant simultanément `accountData` sous forme d'un document JSON risquent des écrasements de dernière écriture. Tester avec Firestore Emulator puis définir une stratégie de versionnage/transactions.

**Priorité haute — Historique comptable ambigu :** les doublons d'échéances anciennes déjà imputés à l'épargne ou aux dettes doivent être rapprochés à partir d'une sauvegarde/journal fiable, sans déduction automatisée.

**Priorité moyenne — Navigateur :** tests E2E réels (Chrome, Safari iPhone), navigation, exports, restaurations, PWA et fonctionnement hors ligne restent nécessaires.

## Fichiers modifiés par ce contre-audit

- `assets/js/core.js` : propriétaire du backup, validation de restauration, invalidation de contexte.
- `assets/js/firebase-auth.js` : génération de session exposée pour invalider les anciennes annulations.
- `assets/js/transactions.js` : garde d'identité/compte/session, restauration non ambiguë.
- `assets/js/recurring.js` : annulations de série/occurrence limitées au bon contexte et à la bonne règle.
- `assets/js/finance.js` : suppression et annulation de dettes, protection des livrets et de l'historique.
- `assets/js/transfers.js` : annulation d'un transfert entre comptes limitée au contexte d'origine.
- `assets/js/state.js` : compte valide, génération de navigation, annulation sécurisée de suppression de compte.
- `assets/js/data-io.js` : invalidation des anciennes annulations lors d'un import complet.
- `sw.js` : nouvelle identité de cache PWA.
- `tests/reaudit-cross-account.test.mjs` : 15 nouveaux tests.

## Vérification et déploiement

```bash
node scripts/validate.mjs
node --test
```

Avant publication : exporter une sauvegarde JSON valide, déployer dans un projet Firebase de **test**, faire des scénarios avec deux utilisateurs Firebase distincts et deux comptes financiers, vérifier août/septembre/octobre/novembre sur une récurrence de 50 € avec septembre modifié à 80 €, puis tester des déconnexions réseau et des éditions concurrentes sur deux appareils. Déployer en production seulement après validation des risques restants.

**Conclusion :** contre-audit de logique et d'intégrité des données avec 104 tests automatisés réussis. Cela ne constitue ni un test E2E complet ni une certification de sécurité de production.
