import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, executeSearch, findShortcuts, describeCriteria, setAmountRange, setMonth, removeFilter, editDistance } from '../assets/js/search-engine.mjs';

const TODAY = '2026-10-22';
const tx = (over) => ({ type: 'expense', category: 'Autre', desc: '', amount: 10, date: '2026-09-10', paymentStatus: 'paid', ...over });
const principal = {
  id: 'a', name: 'Principal',
  transactions: [
    tx({ id: '1', desc: 'Carrefour Market', category: 'Alimentation', amount: 62.4, date: '2026-09-12' }),
    tx({ id: '2', desc: 'Leclerc', category: 'Alimentation', amount: 50, date: '2026-09-14' }),
    tx({ id: '3', desc: 'Auchan', category: 'Alimentation', amount: 50.01, date: '2026-09-20' }),
    tx({ id: '4', desc: 'Carrefour', category: 'Alimentation', amount: 70, date: '2026-08-20' }),
    tx({ id: '5', desc: 'Carrefour City', category: 'Alimentation', amount: 29.9, date: '2026-09-05' }),
    tx({ id: '6', desc: 'Carrefour Drive', category: 'Alimentation', amount: 36, date: '2026-09-06' }),
    tx({ id: '7', desc: 'Pharmacie', category: 'Santé', amount: 12.5, date: '2026-10-02', reconciled: true }),
    tx({ id: '8', desc: 'Boulangerie', category: 'Alimentation', amount: 4.2, date: '2026-10-03' }),
    tx({ id: '9', desc: 'Salaire', type: 'income', category: 'Salaire', amount: 2100, date: '2026-09-30' }),
    tx({ id: '10', desc: 'Loyer à venir', category: 'Logement', amount: 650, date: '2026-10-25', paymentStatus: 'planned' }),
    tx({ id: 'n1', desc: 'Netflix', category: 'Abonnements', amount: 13.49, date: '2026-07-05' }),
    tx({ id: 'n2', desc: 'Netflix', category: 'Abonnements', amount: 13.49, date: '2026-08-05' }),
    tx({ id: 'n3', desc: 'Netflix', category: 'Abonnements', amount: 15.99, date: '2026-09-05' }),
    tx({ id: 's1', desc: 'Spotify', category: 'Abonnements', amount: 10.99, date: '2026-08-07' }),
    tx({ id: 's2', desc: 'Spotify', category: 'Abonnements', amount: 10.99, date: '2026-09-07' }),
    tx({ id: 'r1', desc: 'Modèle', isRecurring: true, amount: 999, date: '2026-09-12' }),
    tx({ id: 'bad', desc: 'Montant invalide', amount: 'abc', date: '2026-09-12' })
  ]
};
const secret = { id: 'b', name: 'Compte partagé', transactions: [tx({ id: 'x1', desc: 'Carrefour', category: 'Alimentation', amount: 31, date: '2026-09-15' })] };
const CATEGORIES = ['Alimentation', 'Santé', 'Salaire', 'Logement', 'Abonnements', 'Autre'];

const search = (query, opts = {}) => {
  const criteria = parseQuery(query, { today: TODAY, categories: CATEGORIES });
  if (opts.scope) criteria.scope = opts.scope;
  return { criteria, ...executeSearch({ currentAccounts: [principal], allAccounts: opts.all ?? [principal, secret], criteria, today: TODAY }) };
};
const ids = r => r.results.map(x => x.id);

test('REC 01 : « courses du mois dernier au-dessus de 50 € » exclut 50,00 € et les autres mois', () => {
  const r = search('Mes courses du mois dernier au-dessus de 50 €');
  assert.equal(r.criteria.dateRange.from, '2026-09-01');
  assert.equal(r.criteria.dateRange.to, '2026-09-30');
  assert.deepEqual(r.criteria.categories.names, ['Alimentation']);
  assert.equal(r.criteria.amount.mode, 'gt');
  assert.equal(r.criteria.amount.min, 5000);
  assert.deepEqual(ids(r).sort(), ['1', '3']); // ni 2 (50,00 €), ni 4 (août), ni 5/6 (< 50 €)
});

test('REC 01 : « environ 30 € chez Carrefour en septembre » → 25–35 €, intervalle visible', () => {
  const r = search('Environ 30 € chez Carrefour en septembre');
  assert.equal(r.criteria.amount.mode, 'approx');
  assert.equal(r.criteria.amount.min, 2500);
  assert.equal(r.criteria.amount.max, 3500);
  assert.equal(r.criteria.dateRange.label, 'Septembre 2026');
  assert.deepEqual(r.criteria.terms, ['carrefour']);
  assert.deepEqual(ids(r), ['5']); // 29,90 € ; 36 € et 62,40 € hors intervalle ; 31 € du compte partagé hors périmètre
  assert.ok(describeCriteria(r.criteria).some(c => c.label.includes('25') && c.label.includes('35')));
});

test('REC 02 : l’intervalle de montant est modifiable sans reformuler', () => {
  const r = search('Environ 30 € chez Carrefour en septembre');
  const widened = setAmountRange(r.criteria, 2500, 3700);
  const again = executeSearch({ currentAccounts: [principal], allAccounts: [principal, secret], criteria: widened, today: TODAY });
  assert.deepEqual(again.results.map(x => x.id).sort(), ['5', '6']);
});

test('REC 01 : « prélèvements qui ont augmenté » compare avec la période précédente', () => {
  const r = search('Mes prélèvements qui ont augmenté');
  assert.equal(r.criteria.trend, 'increased');
  assert.deepEqual(ids(r), ['n3']);
  assert.deepEqual(r.results[0].change, { previous: { date: '2026-08-05', cents: 1349 }, current: { date: '2026-09-05', cents: 1599 }, delta: 250 });
});

test('REC 01 : « dépenses pas encore pointées » distingue pointage et paiement', () => {
  const r = search('Les dépenses pas encore pointées');
  assert.equal(r.criteria.pointage, 'unreconciled');
  assert.equal(r.criteria.payment, null);
  assert.ok(!ids(r).includes('7')); // déjà pointée
  assert.ok(!ids(r).includes('10')); // paiement futur : non réglé, donc pas concerné par le pointage
  assert.ok(!ids(r).includes('9')); // revenu
  assert.ok(ids(r).includes('8'));
});

test('REC 01 : « où exporter mes opérations » → raccourci Paramètres, aucune opération listée', () => {
  const s = findShortcuts('Où exporter mes opérations');
  assert.equal(s.intent, 'navigation');
  assert.equal(s.shortcuts[0].id, 'export');
  assert.equal(s.shortcuts[0].view, 'settings');
  assert.equal(s.shortcuts[0].anchor, 'settingsData');
  assert.equal(typeof s.shortcuts[0].run, 'undefined'); // jamais d’action déclenchée
});

test('REC 02 : accents, majuscules et virgule décimale', () => {
  assert.equal(parseQuery('santé 12,50 €', { today: TODAY, categories: CATEGORIES }).amount.min, 1250);
  const r = search('SANTE');
  assert.deepEqual(ids(r), ['7']);
  const exact = search('pharmacie 12,50€');
  assert.deepEqual(ids(exact), ['7']);
});

test('REC 02 : dates relatives et mois sans année ambigu', () => {
  const sept = parseQuery('septembre', { today: TODAY });
  assert.equal(sept.dateRange.from, '2026-09-01');
  assert.equal(sept.dateRange.assumed, true);
  assert.ok(sept.notes.length > 0);
  const nov = parseQuery('novembre', { today: TODAY });
  assert.equal(nov.dateRange.from, '2025-11-01'); // novembre 2026 n’est pas encore arrivé
  assert.equal(parseQuery('septembre 2025', { today: TODAY }).dateRange.from, '2025-09-01');
  assert.equal(parseQuery('hier', { today: TODAY }).dateRange.from, '2026-10-21');
  assert.equal(parseQuery('cette année', { today: TODAY }).dateRange.to, '2026-12-31');
  assert.equal(setMonth(sept, '2025-09').dateRange.from, '2025-09-01');
});

test('REC 03 : faute de frappe expliquée, résultat jamais inventé', () => {
  const r = search('carrefur');
  assert.ok(ids(r).includes('1'));
  assert.ok(r.results.every(x => x.notes.length === 1 && x.notes[0].includes('orthographe proche')));
  assert.equal(search('zzzzqq').total, 0);
});

test('REC 03 : résultat vide → élargissements proposés uniquement s’ils donnent des résultats', () => {
  const r = search('carrefour décembre 2025');
  assert.equal(r.total, 0);
  const none = search('carrefour mars 2020');
  assert.equal(none.total, 0);
  // Les propositions ne sont jamais appliquées d’office : les critères d’origine sont intacts.
  assert.equal(r.criteria.dateRange.from, '2025-12-01');
  assert.ok(r.suggestions.every(s => s.count > 0));
  const spelling = search('carefour');
  assert.ok(spelling.total > 0); // la tolérance orthographique s’applique au texte
  const wrongAmount = search('carrefour 31 €');
  assert.equal(wrongAmount.total, 0);
  assert.ok(wrongAmount.suggestions.some(s => s.id === 'amount'));
  assert.ok(wrongAmount.suggestions.some(s => s.id === 'scope')); // 31 € existe sur l’autre compte autorisé
});

test('REC 01 : le périmètre courant est respecté, l’élargissement est explicite et limité aux comptes autorisés', () => {
  const current = search('carrefour septembre');
  assert.ok(!current.results.some(x => x.accountId === 'b'));
  const all = search('carrefour septembre', { scope: 'all' });
  assert.ok(all.results.some(x => x.accountId === 'b'));
  const restricted = search('carrefour septembre', { scope: 'all', all: [principal] });
  assert.ok(!restricted.results.some(x => x.accountId === 'b')); // compte non autorisé jamais lu
});

test('REC 03 : classement stable (pertinence, date, identifiant)', () => {
  const a = search('carrefour');
  const b = search('carrefour');
  assert.deepEqual(ids(a), ids(b));
  const scores = a.results.map(x => x.score);
  assert.deepEqual(scores, [...scores].sort((x, y) => y - x));
  const sameDay = { id: 'a', name: 'P', transactions: [tx({ id: 'b', desc: 'Test', date: '2026-09-01' }), tx({ id: 'a', desc: 'Test', date: '2026-09-01' })] };
  const out = executeSearch({ currentAccounts: [sameDay], criteria: parseQuery('test', { today: TODAY }), today: TODAY });
  assert.deepEqual(out.results.map(x => x.id), ['a', 'b']);
});

test('ALX 14 : montants invalides, modèles récurrents et revenus exclus à tort', () => {
  assert.ok(!search('modèle').results.length);
  const invalid = search('montant invalide');
  assert.deepEqual(ids(invalid), ['bad']); // retrouvable par le texte…
  assert.equal(search('supérieur à 1 €', {}).results.some(x => x.id === 'bad'), false); // …mais jamais par un montant
});

test('ALX 14 : bornes — au moins / au plus / entre', () => {
  assert.ok(ids(search('alimentation au moins 50 €')).includes('2'));
  assert.ok(!ids(search('alimentation moins de 50 €')).includes('2'));
  assert.ok(ids(search('alimentation au plus 50 €')).includes('2'));
  assert.deepEqual(ids(search('alimentation entre 29 et 37 euros septembre')).sort(), ['5', '6']);
});

test('critères : suppression d’un filtre et distance d’édition', () => {
  const c = parseQuery('courses septembre au-dessus de 50 €', { today: TODAY, categories: CATEGORIES });
  assert.equal(removeFilter(c, 'amount').amount, null);
  assert.equal(removeFilter(c, 'dateRange').dateRange, null);
  assert.equal(editDistance('carrefour', 'carrefur', 2), 1);
  assert.equal(editDistance('abcd', 'abdc', 2), 1);
});

test('Une catégorie absente des données reste un mot cherché dans les libellés', () => {
  const c = parseQuery('courses', { today: TODAY, categories: ['Santé'] });
  assert.equal(c.categories, null);
  assert.deepEqual(c.terms, ['courses']);
});
