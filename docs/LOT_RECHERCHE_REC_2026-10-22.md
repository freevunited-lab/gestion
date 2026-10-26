# Lot « Recherche unique » — REC 01 à REC 03, ALX 14 (22 octobre 2026)

## Réalisé
| Exigence | État | Preuve |
|---|---|---|
| REC 01 cinq demandes du CDC (courses > 50 €, environ 30 € chez Carrefour, prélèvements en hausse, dépenses non pointées, où exporter) | Fait | `tests/search-engine.test.mjs`, contrôle navigateur |
| REC 01 périmètre courant visible, élargissement explicite aux comptes autorisés | Fait | idem |
| REC 01 résultats financiers distincts des raccourcis (« Aller à ») ; un raccourci ouvre l'écran sans lancer l'action | Fait | idem |
| REC 02 accents, synonymes de catégories, fautes de frappe, virgule décimale, dates relatives | Fait | idem |
| REC 02 filtres compris affichés, retirables, montant / mois / type modifiables ; « environ » = ±1/6 (30 € → 25–35 €) | Fait | idem |
| REC 03 classement stable (pertinence, date, identifiant) ; rapprochements approximatifs expliqués | Fait | idem |
| REC 03 résultat vide : élargissements proposés (période, montant, orthographe, comptes) uniquement s'ils donnent des résultats, jamais appliqués sans clic | Fait | idem |
| ALX 14 critères structurés exécutés sur un index ; montant invalide jamais retourné par un filtre de montant | Fait | idem |

## Limites
- L'interprétation par IA optionnelle n'est pas réalisée (le CDC la laisse facultative).
- L'index est reconstruit à chaque recherche (debounce 100 ms) ; pas de cache ni de mesure de performance sur gros volume (lot PER).
- « Prélèvements en hausse » compare les deux derniers paiements d'une même série (même règle récurrente, sinon même libellé) ; les périodes de référence sont affichées.
- Les dates « jeudi dernier », « la semaine dernière » ne sont pas comprises ; ce sont alors des mots de texte.
- Cache du service worker : `freev-v5.2.0-spaces-20261022-v2` (actualiser les onglets ouverts).

## Fichiers
`assets/js/search-engine.mjs` (moteur pur), `assets/js/search-ui.js` (affichage), `assets/js/v4.js`, `index.html`, `assets/css/v4.css`, `sw.js`, `tests/search-engine.test.mjs`.
