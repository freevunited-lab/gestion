# Synchronisation bancaire Freev

## Ce que Freev prépare

Freev peut démarrer une connexion Open Banking après la configuration d’un prestataire agréé. Apple Pay et Google Pay restent des moyens de paiement : la source fiable est l’opération remontée par la banque.

Le navigateur ne reçoit jamais de mot de passe bancaire, de jeton de consentement, de numéro de carte ou de relevé complet. Les opérations sont présentées à l’utilisateur avant tout ajout dans Freev.

## Contrat serveur attendu

Le serveur est responsable de l’échange OAuth/PSD2 avec le prestataire, du stockage chiffré des jetons, du renouvellement de consentement, de la limitation de débit et de la déduplication. Il vérifie le jeton Firebase dans l’en-tête `Authorization: Bearer <Firebase ID token>` et contrôle que chaque connexion appartient à cet utilisateur.

| Route | Rôle | Réponse minimale |
| --- | --- | --- |
| `POST /v1/bank-connections/start` | Crée une session de consentement | `{ "redirectUrl": "https://..." }` |
| `GET /v1/bank-connections/status` | Lit l’état, les comptes bancaires masqués et leurs associations | `{ "state", "institution", "lastSync", "pendingCount", "bankAccounts", "mappings" }` |
| `PUT /v1/bank-connections/mappings` | Enregistre les associations compte bancaire → compte Freev | `{ "mappings": [{ "bankAccountId", "freevAccountId" }] }` |
| `POST /v1/bank-connections/sync` | Demande une synchronisation limitée | mêmes métadonnées et des opérations candidates |
| `POST /v1/bank-connections/disconnect` | Révoque le consentement et les jetons | `204` |

Le serveur doit refuser toute URL de redirection non HTTPS, valider le paramètre OAuth `state` et PKCE, utiliser des jetons de session `HttpOnly; Secure; SameSite=Strict`, limiter les appels par utilisateur et ne jamais écrire les secrets dans Firestore.

## Association multi-comptes

Un profil Freev peut contenir plusieurs comptes internes : `Compte principal`, `Épargne`, `Vacances` ou des comptes manuels. Après le consentement bancaire, Freev présente chaque compte bancaire externe et demande explicitement son compte Freev cible.

- une association est `compte bancaire externe → compte Freev` ;
- un compte bancaire et un compte Freev ne peuvent apparaître qu’une seule fois dans les associations actives ;
- un compte Freev non associé reste manuel et n’est jamais modifié par la synchronisation ;
- la suppression d’une association arrête les nouveaux imports, sans supprimer les opérations déjà validées.

Le serveur doit vérifier à chaque écriture que le `freevAccountId` appartient au profil Firebase authentifié, que le `bankAccountId` appartient à sa connexion bancaire et que l’unicité est appliquée de manière transactionnelle. Les identifiants bancaires complets et les jetons restent côté serveur ; le navigateur ne reçoit qu’un identifiant opaque et un IBAN masqué.

## Déploiement gratuit : Cloudflare Workers

Le dossier `workers/freev-bank-sync` contient le serveur HTTPS compatible avec le plan gratuit Cloudflare Workers. Il utilise un namespace Workers KV pour stocker les jetons Powens côté serveur : le navigateur ne reçoit qu’un compte bancaire masqué et des identifiants opaques.

1. Créer un compte Cloudflare gratuit puis ouvrir un terminal dans `workers/freev-bank-sync`.
2. Exécuter `npx wrangler login`, puis `npx wrangler kv namespace create FREEV_BANK_DATA`.
3. Reporter l’identifiant renvoyé dans `wrangler.toml`, générer une clé de coffre avec `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`, puis exécuter `npx wrangler secret put` pour `BANK_DATA_ENCRYPTION_KEY`, `FIREBASE_WEB_API_KEY`, `POWENS_CLIENT_ID`, `POWENS_CLIENT_SECRET` et `POWENS_WEBHOOK_SECRET`.
4. Déployer avec `npx wrangler deploy`. L’outil donne une URL HTTPS `workers.dev`.
5. Renseigner uniquement cette URL dans `window.FREEV_BANK_SYNC_ENDPOINT` au moment du déploiement du site, jamais les secrets.
6. Dans Powens, créer un webhook vers `https://<worker>/v1/bank-webhooks/powens` et transmettre la même valeur secrète dans l’en-tête `x-freev-webhook-secret`.

Le plan Workers gratuit inclut un quota quotidien. Lorsque ce quota est atteint, les appels sont refusés plutôt que facturés. Les limites actuelles annoncées sont de 100 000 requêtes et 100 000 lectures KV par jour, ainsi que 1 000 écritures KV par jour. [Documentation Cloudflare Workers](https://developers.cloudflare.com/workers/platform/pricing/) et [Workers KV](https://developers.cloudflare.com/kv/platform/pricing/).

Avant une mise en production, vérifier les banques réellement utilisées et n’activer que leurs connecteurs. L’activation globale du catalogue Powens n’est pas nécessaire.
