# FREEV Gestion — Priorité 4 : fiabilité, navigation, performance, Firebase

Date : 21 octobre 2026. Base : version « Priorité 3 Premium » (231 tests).

## Correctifs intégrés

1. **Navigation invalide :** `switchView` refuse les noms inconnus et les objets, avant toute mutation. La navigation vers une page déjà active n'entraîne pas de rendu coûteux. Les utilisateurs avec `prefers-reduced-motion` n'ont plus d'animation d'entrée forcée ni de défilement animé. Les graphiques Chart.js désactivent leurs animations initiales dans ce mode.
2. **Mutation sur mauvais compte :** `_mutateAccountData(accountId, ...)` ne se rabat plus sur le compte actif lorsque l'identifiant cible a disparu (protection lors d'une action asynchrone).
3. **Sauvegarde Firebase entre sessions :** la file de sauvegarde est recréée à chaque changement d'identité Firebase. Une promesse appartenant au compte A ne peut plus être retournée comme résultat d'une sauvegarde du compte B. Les anciennes erreurs asynchrones ne remplacent plus l'état visuel d'une nouvelle session.
4. **Suppression du document financier :** `firestore.rules` refuse désormais toute suppression directe du document `/users/{userId}` par un client. Une suppression volontaire du compte et des données doit suivre un parcours administratif contrôlé ; aucun parcours de suppression utilisateur n'est ajouté par ce correctif.
5. **Cache PWA :** seuls les chemins statiques explicitement référencés sont pris en charge. Les endpoints inconnus et les fichiers de données ne sont pas mis en cache par le service worker ; les réponses non OK ou opaques ne sont pas enregistrées. Les navigations avec différentes chaînes de paramètres partagent une clé de cache canonique. Les scripts/styles utilisent le réseau puis le cache de la version courante. Les URLs de notifications sont limitées aux pages internes autorisées.
6. **Projection de récurrences :** la détection d'échéances déjà existantes utilise un index temporaire des périodes et comptes plutôt qu'un parcours de toutes les opérations pour chaque règle récurrente. Le comportement multi-comptes avec des règles ayant le même identifiant est testé.

## Validation locale effectuée

- `node --test` : **243 réussis / 243**, 12 tests de plus que la base.
- `node scripts/validate.mjs` : réussi (syntaxe JS, identifiants HTML, références de ressources).
- Simulation de navigation, changement de compte pendant une transaction Firebase en attente et simulation des événements Service Worker : réussis.
- `npm run benchmark:projection` : 120 règles, 9 passes par jeu de données, médianes indicatives sur cette machine : **3 000 écritures 3,47 ms ; 10 000 7,36 ms ; 25 000 19,96 ms**. Ce n'est **pas** une mesure de rendu écran / réseau / Firebase, et les chiffres varient selon la machine.

## Restant à valider avant production

- **Chromium ou navigateur réel : non validé ici.** L'ouverture des pages a renvoyé `ERR_BLOCKED_BY_ADMINISTRATOR` dans cet environnement. Tester ordinateur, Android et iPhone si possible, notamment menu, navigation, PWA hors ligne et mouvement réduit.
- **Émulateur Firestore : non exécuté.** Dépendances Node et Firebase CLI absentes de l'environnement. Tester les règles depuis un projet Firebase isolé avant déploiement.
- **Concurrence réelle :** les tests de doubles comptes utilisent un serveur Firebase simulé, pas deux véritables sessions connectées. Le passage des règles et des fonctions côté Firebase doit être confirmé sur un environnement test, avec deux navigateurs distincts.
- **Suppression des données utilisateur :** la règle `allow delete: if false` impose un processus de suppression contrôlée côté administrateur (Admin SDK/console), qui doit être documenté avant mise en production.
- **Vieux service workers :** une mise à jour complète/rafraîchissement est nécessaire pour que les nouveaux clients adoptent le cache `priority4-stability-v1`. L'ancienne PWA peut continuer à contrôler un onglet avant la prise de contrôle du nouveau worker.

## Déploiement prudent

1. Exporter une **sauvegarde JSON** et vérifier qu'elle peut être relue.
2. Copier la version corrigée sur un environnement Firebase de test.
3. Déployer les règles Firestore correspondantes, puis l'application, sans mélanger des versions incompatibles.
4. Tester avec deux utilisateurs, deux appareils, des modifications concurrentes, une connexion coupée et une réinstallation PWA.
5. Effectuer le déploiement de production seulement une fois ces validations réussies.

Commandes utiles lorsque les dépendances sont installées : `npm ci`, `npm run validate`, `npm run test:browser`, `npm run test:rules`, `npm run benchmark:projection`.
