# Synchronisation simultanée des récurrences — FREEV Gestion

## Nouvelle règle

Lorsqu’un appareil charge une révision de Firebase, toute écriture est une transaction CAS (comparaison de révision et du contenu). Si un autre appareil a enregistré entre-temps, FREEV effectue une fusion **uniquement dans le cas prouvé sûr** :

- même compte Firebase, mêmes comptes financiers et mêmes règles ;
- uniquement des exceptions mensuelles **existantes**, chacune avec identifiant, `parentId` et `periodKey` intacts ;
- mois/périodes différentes (ou règles différentes) ;
- uniquement transactions ordinaires (`expense` / `income`) sans dette, transfert d’épargne, application d’effet financier ni rapprochement ;
- journaux des modifications de l’échéance complets, non falsifiés et compatibles avec les snapshots de départ ;
- aucune autre modification de transaction, compte, règle, catégorie globale ou préférence ;
- aucune nouvelle saisie locale pendant les deux écritures réseau.

La fusion est elle-même enregistrée via une **seconde transaction Firestore**. Si le serveur évolue pendant la fusion, elle est refusée et le mode conflit permet d’exporter les données locales. Les deux versions ne sont jamais réunies par addition de montants : chaque échéance reste la valeur voulue par son appareil.

## Cas bloqués (choix délibéré)

Les deux appareils modifient la **même période**, l’un modifie la règle, supprime/crée une échéance, utilise des dates avec des périodes ambiguës, travaille sur des dettes/épargnes, possède un journal insuffisant, ou toute modification non prouvée indépendante : FREEV bloque la synchronisation et propose l’export JSON local. Les semaines et les années ne sont pas fusionnées automatiquement.

Les historiques mensuels passés restent verrouillés par le système de double confirmation de la version précédente. L’algorithme de fusion ne contourne pas ce verrou et ne recrée pas des mois absents.

## Reproduire les tests

Depuis la racine du projet :

```bash
node --test
npm run test:concurrency
node scripts/validate.mjs
```

Pour les tests avec les vraies règles Firestore et le navigateur, installer les dépendances avec `npm ci`, puis utiliser :

```bash
npm run test:rules
npm run test:browser
```

## Recette manuelle sur projet Firebase de test

1. Exporter une sauvegarde JSON et déployer la version de l’application et les règles `firestore.rules` sur un projet Firebase **non productif**.
2. Ouvrir deux navigateurs ou appareils distincts, connectés au même compte. Créer une récurrence simple de 50 € par mois et vérifier que septembre, octobre, novembre sont des occurrences enregistrées.
3. Sur A et B, charger la même révision. Modifier sur A septembre à 70 € ; sur B novembre à 90 €. Enregistrer A puis B : attendre la confirmation de synchronisation et vérifier `70 €, 50 €, 90 €` sur les deux appareils **après rechargement**.
4. Recommencer depuis une base commune, cette fois en modifiant octobre à 70 € sur A et 90 € sur B. Le second doit afficher un conflit et ne doit pas écraser le premier.
5. Refaire l’essai avec un transfert d’épargne, une dette, la suppression d’une échéance et une période future nouvellement créée. Aucune fusion silencieuse n’est autorisée.
6. Couper le réseau pendant une modification sur B : la version non synchronisée doit rester exportable et ne pas être présentée comme enregistrée. Tester enfin une déconnexion et un rechargement sur les deux appareils.

**Limites** : dans l’environnement de génération, les tests simulateurs et les validations Node fonctionnent, mais les dépendances Playwright/axe-core et l’émulateur Firestore n’étaient pas installés. Cette recette manuelle, ainsi que le test de règles sur émulateur, restent donc à effectuer avant déploiement réel.
