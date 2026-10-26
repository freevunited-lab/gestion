# FREEV Gestion — Signature 2.0

Date : 21 octobre 2026  
Base : `FREEV_Gestion_Edition_Signature_Apple_267_Tests.zip`  
Résultat : **279/279 tests automatisés réussis**, contrôles de cohérence des sources validés.

## Modifications effectuées

1. **Transitions de vues** — passage à la Web Animations API lorsque disponible, animation limitée à l'opacité et à la translation (240 ms), sans recalcul forcé de la mise en page. Repli CSS pour les navigateurs anciens ; aucune animation lorsque « Réduire les animations » est activé.
2. **Tableau de bord et cartes** — nouvelle hiérarchie typographique, bordures fines, surfaces cohérentes, effets au survol uniquement sur les appareils disposant d'une souris, ombres plus discrètes, montants tabulaires.
3. **Graphiques** — couleurs coordonnées au thème clair/sombre, dégradé du solde mis en cache par graphique et dimensions, légendes et résumés accessibles conservés, animation du graphique circulaire abrégée et désactivée en cas de préférence système.
4. **Navigation mobile** — onglet « Menu » sélectionné pour les pages secondaires, prévention du défilement derrière le panneau latéral, prise en charge des zones de sécurité iPhone et boutons plus confortables sur petit écran.
5. **Formulaires et tableaux** — défilement horizontal maîtrisé des tableaux, hauteur maximale des modales adaptée à l'écran, présentation des commandes et états de focus harmonisée.
6. **Accessibilité** — règles pour contraste élevé, transparence réduite, animations réduites, zones tactiles et suivi du focus visuel.
7. **PWA** — nouveau nom de cache (`freev-v5.1.0-signature-20261021-v2`) et ajout des ressources `signature2.css` et `signature2.js` pour éviter d'utiliser un ancien style après déploiement.

## Fichiers modifiés

- Ajout : `assets/css/signature2.css`
- Ajout : `assets/js/signature2.js`
- Ajout : `tests/signature2.test.mjs`
- Modifiés : `index.html`, `assets/js/core.js`, `assets/js/dashboard.js`, `assets/js/ui.js`, `sw.js`

Les algorithmes d'échéances, de montants, de budgets, de sauvegarde et les règles Firebase n'ont pas été modifiés par cette édition. L'optimisation concerne uniquement la couche de présentation et les styles des graphiques.

## Validation

- 267 tests hérités : réussis.
- 12 tests supplémentaires : réussis (mouvement réduit, repli animation, transitions rapides, thème, dégradé, mobile, cache PWA, séparation données/présentation).
- **279 tests réussis sur 279.**
- Validation statique des fichiers HTML/JS et dépendances locales : réussie.
- Parsing CSS : aucune erreur de niveau feuille de style détectée.

### Limites importantes

- **Essai navigateur réel non conclu** : Chromium a refusé le chargement de l'application locale (`net::ERR_BLOCKED_BY_ADMINISTRATOR`). Aucun résultat sur les chevauchements réels, la fluidité perçue ou les captures d'écran ne peut donc être certifié ici.
- Aucune mesure de FPS, de consommation mémoire sur appareil, ni de synchronisation Firebase réelle n'a été effectuée lors de cette édition.
- Les tests automatisés ne constituent pas une garantie d'absence totale de défauts.

## Contrôles conseillés avant déploiement

1. Sauvegarder les données financières en JSON et tester sur une instance de développement.
2. Ouvrir le tableau de bord en mode clair/sombre, avec une souris, puis sur iPhone et Android (360, 390 et 430 pixels).
3. Vérifier les sélecteurs de graphique, les info-bulles, le mode « Réduire les animations », les onglets et les fenêtres de modification.
4. Vérifier qu'aucun bouton ne recouvre un autre dans les récurrences et dans le menu mobile.
5. Tester une déconnexion/reconnexion et vérifier les anciennes échéances et les modifications ponctuelles avant de publier.

**Déploiement** : mettre en ligne le contenu du ZIP en conservant le chemin des fichiers, puis actualiser la PWA ou la recharger pour obtenir les ressources de la nouvelle version.
