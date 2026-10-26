import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewDuplicates, buildReconciliationCandidates, validateReconciliationAllocations } from '../assets/js/financial-matching-engine.mjs';

const tx = (overrides = {}) => ({
  id: 'row-1', accountId: 'cash-1', sourceId: 'bank-a', providerTransactionId: 'provider-1',
  date: '2026-10-05', amountMinor: 4590, currency: 'EUR', direction: 'expense',
  label: 'Boulangerie Martin', ...overrides
});

const actual = (overrides = {}) => ({
  id: 'actual-1', accountId: 'cash-1', currency: 'EUR', direction: 'expense',
  amountMinor: 4590, date: '2026-10-05', label: 'Boulangerie Martin', ...overrides
});

const obligation = (overrides = {}) => ({
  id: 'due-1', accountId: 'cash-1', currency: 'EUR', direction: 'expense',
  amountMinor: 4590, date: '2026-10-05', label: 'Boulangerie Martin', ...overrides
});

test('ALX 05 : une identité fournisseur identique est certaine seulement dans le même compte et la même source', () => {
  const original = tx();
  const result = reviewDuplicates({
    existing: [original],
    incoming: [
      tx({ id: 'same', providerTransactionId: 'provider-1' }),
      tx({ id: 'other-source', sourceId: 'bank-b', providerTransactionId: 'provider-1' }),
      tx({ id: 'other-account', accountId: 'cash-2', providerTransactionId: 'provider-1' })
    ]
  });
  assert.equal(result.decisions[0].status, 'certain-duplicate');
  assert.equal(result.decisions[0].match.id, original.id);
  assert.equal(result.decisions[1].status, 'needs-review'); // même ID hors de sa source : jamais certain
  assert.equal(result.decisions[2].status, 'new');
});

test('ALX 05 : un identifiant fournisseur répété dans le même import ne produit qu’une seule nouvelle ligne', () => {
  const result = reviewDuplicates({ incoming: [
    tx({ id: 'first', providerTransactionId: 'same-batch-id' }),
    tx({ id: 'second', providerTransactionId: 'same-batch-id' })
  ] });
  assert.equal(result.decisions[0].status, 'new');
  assert.equal(result.decisions[1].status, 'certain-duplicate');
  assert.equal(result.decisions[1].match.id, 'first');
});

test('ALX 05 : deux achats semblables de même jour restent à vérifier, jamais supprimés automatiquement', () => {
  const original = tx({ providerTransactionId: 'purchase-a' });
  const repeated = tx({ id: 'incoming', providerTransactionId: 'purchase-b' });
  const result = reviewDuplicates({ existing: [original], incoming: [repeated] });
  assert.equal(result.decisions[0].status, 'needs-review');
  assert.equal(result.decisions[0].automaticAction, 'keep');
  assert.ok(result.decisions[0].evidence.some(item => item.field === 'amount'));
  assert.ok(result.decisions[0].evidence.some(item => item.field === 'date'));
  assert.ok(result.decisions[0].evidence.some(item => item.field === 'label'));
  assert.equal(original.providerTransactionId, 'purchase-a');
  assert.equal(repeated.providerTransactionId, 'purchase-b');
});

test('ALX 05 : les libellés accentués et une petite variation de date sont comparés comme candidats', () => {
  const result = reviewDuplicates({
    existing: [tx({ providerTransactionId: 'old', label: 'Épicerie du Cœur' })],
    incoming: [tx({ id: 'new', providerTransactionId: 'new', date: '2026-10-06', label: 'Epicerie du Coeur' })],
    options: { dateToleranceDays: 1 }
  });
  assert.equal(result.decisions[0].status, 'needs-review');
  assert.equal(result.decisions[0].candidates[0].dateDifferenceDays, 1);
});

test('ALX 05 : montants, devises, directions ou dates hors tolérance ne deviennent pas des doublons possibles', () => {
  const originals = [
    tx({ id: 'amount', providerTransactionId: 'a', amountMinor: 6000 }),
    tx({ id: 'currency', providerTransactionId: 'b', currency: 'USD' }),
    tx({ id: 'direction', providerTransactionId: 'c', direction: 'income' }),
    tx({ id: 'date', providerTransactionId: 'd', date: '2026-10-12' })
  ];
  const incoming = [
    tx({ id: 'incoming-amount', providerTransactionId: 'different-0', amountMinor: 2000 }),
    tx({ id: 'incoming-currency', providerTransactionId: 'different-1', currency: 'EUR' }),
    tx({ id: 'incoming-direction', providerTransactionId: 'different-2', direction: 'expense' }),
    tx({ id: 'incoming-date', providerTransactionId: 'different-3', date: '2026-10-05' })
  ];
  const result = reviewDuplicates({ existing: originals, incoming });
  assert.ok(result.decisions.every(item => item.status === 'new'));
});

test('ALX 05 : un paiement comptabilisé remplace sans ambiguïté son autorisation', () => {
  const authorization = tx({ id: 'authorization', providerTransactionId: 'auth-1', status: 'authorized' });
  const posted = tx({ id: 'posted', providerTransactionId: 'posted-1', authorizationId: 'auth-1', status: 'posted' });
  const result = reviewDuplicates({ existing: [authorization], incoming: [posted] });
  assert.equal(result.decisions[0].status, 'authorization-transition');
  assert.equal(result.decisions[0].match.id, 'authorization');
  assert.ok(result.decisions[0].evidence.length > 0);
});

test('ALX 05 : une référence d’autorisation liée à plusieurs lignes exige une vérification', () => {
  const result = reviewDuplicates({
    existing: [
      tx({ id: 'authorization-1', providerTransactionId: 'auth-1', status: 'authorized' }),
      tx({ id: 'authorization-2', providerTransactionId: 'auth-1', status: 'authorized' })
    ],
    incoming: [tx({ id: 'posted', providerTransactionId: 'posted-1', authorizationId: 'auth-1', status: 'posted' })]
  });
  assert.equal(result.decisions[0].status, 'needs-review');
  assert.equal(result.decisions[0].automaticAction, 'keep');
});

test('ALX 05 : une autorisation revendiquée par plusieurs achats comptabilisés ne peut pas être remplacée automatiquement', () => {
  const result = reviewDuplicates({
    existing: [tx({ id: 'authorization', providerTransactionId: 'auth-1', status: 'authorized' })],
    incoming: [
      tx({ id: 'posted-1', providerTransactionId: 'posted-1', authorizationId: 'auth-1', status: 'posted' }),
      tx({ id: 'posted-2', providerTransactionId: 'posted-2', authorizationId: 'auth-1', status: 'posted' })
    ]
  });
  assert.ok(result.decisions.every(item => item.status === 'needs-review'));
  assert.ok(result.decisions.every(item => item.automaticAction === 'keep'));
});

test('ALX 06 : rapprochement applique les tolérances configurées et trie de façon stable', () => {
  const actuals = [
    actual({ id: 'b', date: '2026-10-06', amountMinor: 4590 }),
    actual({ id: 'a', date: '2026-10-06', amountMinor: 4590 })
  ];
  const obligations = [obligation({ id: 'due-b' }), obligation({ id: 'due-a' })];
  const candidates = buildReconciliationCandidates({
    actuals, obligations,
    tolerances: { expense: { dateDays: 2, amountMinor: 100 } }
  });
  assert.deepEqual(candidates.map(item => [item.actualId, item.obligationId]), [
    ['a', 'due-a'], ['a', 'due-b'], ['b', 'due-a'], ['b', 'due-b']
  ]);
  assert.ok(candidates.every(item => item.kind === 'exact'));
  assert.ok(candidates.some(item => item.ambiguous));
});

test('ALX 06 : tolérance de montant et de date produit une preuve consultable', () => {
  const candidates = buildReconciliationCandidates({
    actuals: [actual({ amountMinor: 4540, date: '2026-10-06' })],
    obligations: [obligation()],
    tolerances: { expense: { dateDays: 2, amountMinor: 100 } }
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'within-tolerance');
  assert.ok(candidates[0].evidence.some(item => item.field === 'amount' && item.differenceMinor === 50));
  assert.ok(candidates[0].evidence.some(item => item.field === 'date' && item.differenceDays === 1));
});

test('ALX 06 : paiement partiel proposé seulement quand le type le permet et les libellés concordent', () => {
  const candidates = buildReconciliationCandidates({
    actuals: [actual({ amountMinor: 2000 })],
    obligations: [obligation({ amountMinor: 6000 })],
    tolerances: { expense: { dateDays: 1, amountMinor: 0, allowPartial: true } }
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'partial');
  assert.ok(candidates[0].evidence.some(item => item.field === 'partial-amount'));
  assert.equal(buildReconciliationCandidates({
    actuals: [actual({ amountMinor: 2000 })], obligations: [obligation({ amountMinor: 6000 })],
    tolerances: { expense: { dateDays: 1, amountMinor: 0, allowPartial: false } }
  }).length, 0);
});

test('ALX 06 : le moteur refuse les rapprochements entre comptes, devises ou directions différentes', () => {
  const actuals = [actual(), actual({ id: 'b', accountId: 'other' }), actual({ id: 'c', currency: 'USD' }), actual({ id: 'd', direction: 'income' })];
  const obligations = [obligation(), obligation({ id: 'other-account', accountId: 'other' }), obligation({ id: 'other-currency', currency: 'USD' }), obligation({ id: 'other-direction', direction: 'income' })];
  const candidates = buildReconciliationCandidates({ actuals, obligations, tolerances: { expense: { dateDays: 0, amountMinor: 0 }, income: { dateDays: 0, amountMinor: 0 } } });
  assert.deepEqual(candidates.map(item => [item.actualId, item.obligationId]), [
    ['actual-1', 'due-1'], ['b', 'other-account'], ['c', 'other-currency'], ['d', 'other-direction']
  ]);
});

test('ALX 06 : allocations partielles et groupées conservent exactement les unités monétaires', () => {
  const actuals = [actual({ id: 'a1', amountMinor: 6000 }), actual({ id: 'a2', amountMinor: 4000 }), actual({ id: 'grouped', amountMinor: 12000 })];
  const obligations = [obligation({ id: 'o1', amountMinor: 10000 }), obligation({ id: 'o2', amountMinor: 7000 }), obligation({ id: 'o3', amountMinor: 5000 })];
  const result = validateReconciliationAllocations({
    actuals, obligations,
    allocations: [
      { actualId: 'a1', obligationId: 'o1', amountMinor: 6000 },
      { actualId: 'a2', obligationId: 'o1', amountMinor: 4000 },
      { actualId: 'grouped', obligationId: 'o2', amountMinor: 7000 },
      { actualId: 'grouped', obligationId: 'o3', amountMinor: 5000 }
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.remainingActualMinor.a1, 0);
  assert.equal(result.remainingObligationMinor.o1, 0);
  assert.equal(result.remainingActualMinor.grouped, 0);
});

test('ALX 06 : un dépassement invalide tout le lot sans modifier les données sources', () => {
  const source = [actual({ amountMinor: 5000 })];
  const before = JSON.stringify(source);
  const result = validateReconciliationAllocations({
    actuals: source, obligations: [obligation({ amountMinor: 4500 })],
    allocations: [{ actualId: 'actual-1', obligationId: 'due-1', amountMinor: 5000 }]
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.code === 'over-allocation'));
  assert.deepEqual(result.allocations, []);
  assert.equal(JSON.stringify(source), before);
});

test('ALX 06 : un même lien ne peut pas être répété et les valeurs invalides sont refusées', () => {
  const pair = { actualId: 'actual-1', obligationId: 'due-1', amountMinor: 1000 };
  const duplicate = validateReconciliationAllocations({ actuals: [actual()], obligations: [obligation()], allocations: [pair, pair] });
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.errors.some(error => error.code === 'duplicate-link'));

  const invalid = validateReconciliationAllocations({
    actuals: [actual()], obligations: [obligation()], allocations: [{ ...pair, amountMinor: 0 }]
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some(error => error.code === 'invalid-amount'));
});

test('ALX 06 : les allocations existantes réduisent le reste disponible avant une nouvelle proposition', () => {
  const candidates = buildReconciliationCandidates({
    actuals: [actual({ amountMinor: 6000 })],
    obligations: [obligation({ amountMinor: 6000 })],
    existingAllocations: [{ actualId: 'actual-1', obligationId: 'due-1', amountMinor: 2000 }],
    tolerances: { expense: { dateDays: 0, amountMinor: 0, allowPartial: true } }
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].actualRemainingMinor, 4000);
  assert.equal(candidates[0].obligationRemainingMinor, 4000);
});
