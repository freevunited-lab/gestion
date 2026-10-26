# FREEV — Audit et corrections des transactions récurrentes

**Date :** 21 octobre 2026  
**Archive étudiée :** `Freev1-gestion--main.zip` (application FREEV 5.1.0)  
**Périmètre :** création, modification, projection, matérialisation et suppression d'occurrences récurrentes (mensuelles, hebdomadaires, annuelles), effet sur les autres périodes et sur les soldes associés.

## 1. Règle fonctionnelle à garantir

Lorsque l'utilisateur modifie une occurrence avec **« Cette échéance uniquement »**, la modification doit rester attachée à sa période d'origine. La règle de récurrence ne change pas et les autres périodes conservent leur montant, leur date et leurs caractéristiques habituelles. Le mode **« Toute la série »** modifie la règle et ses échéances futures non protégées, sans réécrire les périodes déjà arrivées ni les exceptions personnalisées.

**Exemple :** prélèvement Internet fixé à 50 € le 10 de chaque mois.

| Mois | Montant après une modification exceptionnelle en septembre |
|---|---:|
| Août 2026 | 50 € |
| Septembre 2026 | 80 € (exception) |
| Octobre 2026 | 50 € |
| Novembre 2026 | 50 € |
| Décembre 2026 | 50 € |

L'exception reste reliée à l'identifiant de la série (`parentId`) et à la période d'origine (`periodKey`) ; elle est marquée `_manuallyEdited` pour éviter une régénération ultérieure.

## 2. Résultats de l'audit et corrections

| Priorité | Constat | Correction |
|---|---|---|
| Haute | Modifier la date d'une occurrence en choisissant toute la série pouvait remplacer la date de début de la règle par la date de ce mois, décalant artificiellement son historique. | Conserver la date de début initiale lors d'une modification lancée depuis une occurrence. Pour la mensualité, faire varier `dayOfMonth` sans changer le mois d'origine. |
| Haute | Une modification générale lançait une génération remontant jusqu'à 18 mois en arrière ; des mois sans écriture pouvaient être remplis rétroactivement au nouveau tarif. | La reconstruction après une mise à jour de série se limite au mois courant, sans créer d'écritures dans les mois antérieurs. Les opérations déjà arrivées, y compris dans le mois courant, restent conservées. |
| Moyenne | Les échéances futures déjà personnalisées sortaient de la liste et des totaux « 30 prochains jours », car seules les projections étaient prises en compte. | Inclure également les occurrences stockées à venir, sans double comptage avec les projections. |
| Moyenne | « Prochaine échéance » pouvait afficher la date théorique plutôt que la date personnalisée. | Tenir compte de la date effectivement enregistrée pour cette période. |
| Moyenne | Pour les données héritées dépourvues de `periodKey`, la recherche pouvait ne pas détecter une occurrence existante. | Retrouver la clé à partir de la date de la transaction et de la fréquence de sa règle. |
| Moyenne | La couleur attribuée lors d'une modification de toute la série pouvait créer une personnalisation injustifiée d'une seule occurrence, la protégeant ensuite de la régénération. | En mode « Toute la série », enregistrer la couleur par défaut sur la règle et ne pas modifier séparément l'occurrence ouverte. |
| Moyenne | Une conversion de transaction manuelle en série pouvait annuler des effets d'épargne avant les vérifications de validation. | Reporter l'annulation des effets au moment de retirer réellement la transaction d'origine. |
| Faible | Le libellé « Seulement ce mois » prêtait à confusion pour les règles hebdomadaires ou annuelles. | Le libellé devient « Cette échéance uniquement », avec une explication de l'isolation des périodes. |
| Préventive | L'ancienne version PWA risquait de conserver l'ancien code en mode hors ligne. | Nouveau nom de cache du service worker afin que la mise à jour recharge les scripts. |

## 3. Comportement de l'interface

Depuis la liste des transactions, cliquer sur le crayon d'une opération récurrente, puis choisir :

- **Cette échéance uniquement :** modifier le montant, la date (dans la même période) ou les détails d'une occurrence, sans modifier les autres. Il n'est pas possible de changer la fréquence depuis cette option.
- **Toute la série :** modifier la règle pour les échéances futures non protégées. Les opérations déjà arrivées et les exceptions personnelles restent inchangées.

Une modification ponctuelle mensuelle ne peut pas déplacer l'échéance dans un autre mois ; le système refuse l'opération pour éviter les doublons ou les écrasements de périodes. Pour les règles hebdomadaires, la période d'isolation est une semaine ISO ; pour les règles annuelles, une année.

## 4. Validation effectuée

Exécution de `npm run validate` comprenant la vérification de syntaxe JS, des fichiers locaux, des identifiants HTML et des tests Node.

**Résultat : 71 tests réussis / 71 ; 0 échec.** Le projet initial en possédait 60 ; 11 scénarios de non-régression ont été ajoutés dans `tests/recurring-month-isolation.test.mjs`, couvrant :

1. Exception isolée en septembre avec août/octobre/novembre inchangés.
2. Exception future matérialisée et visible dans les échéances à venir.
3. Rejet d'un déplacement hors de la période d'origine.
4. Changement de série initié depuis un mois futur sans déplacer la date de création.
5. Absence de création rétroactive de mois historiques au nouveau montant.
6. Ancienne occurrence sans `periodKey` non dupliquée.
7. Ajustement unique d'un transfert vers l'épargne.
8. Exception hebdomadaire isolée dans la semaine concernée.
9. Récurrence annuelle au 29 février avec exception d'une année.
10. Période ignorée sans affecter les autres mois.
11. Prélèvement du 31 adapté à février sans décaler mars.

**Non vérifié dans cet environnement :** campagne de tests Playwright dans un vrai navigateur et synchronisation avec un compte Firebase réel (absence d'environnement navigateur/d'identifiants connectés ici). Il est recommandé d'essayer le scénario sur un environnement de test avant la mise en production et de conserver une sauvegarde préalable des données utilisateur.

## 5. Fichiers modifiés

- `assets/js/recurring.js` — recherche d'occurrences, prochaine échéance, exceptions futures visibles.
- `assets/js/transactions.js` — portée des modifications et reconstruction non destructive.
- `index.html` — libellés et aide de la portée d'édition.
- `sw.js` — invalidation du cache PWA.
- `tests/recurring-month-isolation.test.mjs` — 11 tests de non-régression supplémentaires.
- `AUDIT_RECURRENCES_FREEV.md` — présent rapport.

## 6. Recommandations avant déploiement

Effectuer une sauvegarde des comptes, tester une récurrence mensuelle de démonstration sur au moins trois mois, vérifier « Cette échéance uniquement » puis « Toute la série », recharger l'application PWA après déploiement et vérifier la cohérence des soldes d'épargne/dettes lors d'une modification de transaction déjà passée. Les corrections ne modifient pas directement les données de production tant que cette version n'est pas déployée.
