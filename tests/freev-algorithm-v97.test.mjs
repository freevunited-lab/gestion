import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLedger, recurringAmountAt } from '../assets/js/freev-algorithm.mjs';

const rule = {
  id: 'subscription', accountId: 'main', startDate: '2026-01-31', frequency: 'monthly',
  type: 'expense', amountMinor: 1000,
  rateVersions: [{ effectiveFrom: '2026-04-01', amountMinor: 1200 }],
  overrides: [{ date: '2026-03-31', amountMinor: 1500 }]
};

test('tarif futur et exception ponctuelle préservent les mois passés et suivants', () => {
  const result = calculateLedger({ openingDate: '2026-01-01', throughDate: '2026-05-31', accountId: 'main', rules: [rule] });
  assert.deepEqual(result.entries.map(row => [row.date, row.amountMinor]), [
    ['2026-01-31', 1000], ['2026-02-28', 1000], ['2026-03-31', 1500],
    ['2026-04-30', 1200], ['2026-05-31', 1200]
  ]);
  assert.equal(result.closingBalanceMinor, -5900);
  assert.equal(recurringAmountAt(rule, '2026-03-31'), 1000);
});

test('opération réelle remplace sa projection sans être comptée deux fois', () => {
  const result = calculateLedger({ openingDate: '2026-01-01', throughDate: '2026-02-28', accountId: 'main', rules: [rule],
    transactions: [{ id: 'paid', accountId: 'main', parentId: 'subscription', date: '2026-01-31', type: 'expense', amountMinor: 900 }] });
  assert.equal(result.actualCount, 1);
  assert.equal(result.projectedCount, 1);
  assert.equal(result.closingBalanceMinor, -1900);
});

test('comptes distincts, opérations prévues et échéance sautée sont isolés', () => {
  const result = calculateLedger({ openingBalanceMinor: 5000, openingDate: '2026-01-01', throughDate: '2026-02-28', accountId: 'main',
    rules: [{ ...rule, skippedDates: ['2026-02-28'] }, { ...rule, id: 'other', accountId: 'secondary' }],
    transactions: [
      { id: 'planned', accountId: 'main', date: '2026-01-10', type: 'expense', amountMinor: 700, paymentStatus: 'planned' },
      { id: 'elsewhere', accountId: 'secondary', date: '2026-01-10', type: 'income', amountMinor: 9000 }
    ] });
  assert.equal(result.closingBalanceMinor, 3300); // la projection inclut l'opération prévue de 700
  assert.equal(result.entries.length, 2);
  assert.equal(result.plannedCount, 1);
  assert.equal(result.projectedCount, 2);
  // Sans projections, ni opération prévue ni récurrence n'affectent le solde.
  const withoutProjection = calculateLedger({ openingBalanceMinor: 5000, openingDate: '2026-01-01', throughDate: '2026-02-28', accountId: 'main', includeProjections: false,
    rules: [{ ...rule, skippedDates: ['2026-02-28'] }],
    transactions: [{ id: 'planned', accountId: 'main', date: '2026-01-10', type: 'expense', amountMinor: 700, paymentStatus: 'planned' }] });
  assert.equal(withoutProjection.closingBalanceMinor, 5000);
  assert.equal(withoutProjection.entries.length, 0);
});

test('année bissextile : une récurrence du 29 février revient au 29 en 2028', () => {
  const result = calculateLedger({ openingDate: '2024-01-01', throughDate: '2028-03-01', accountId: 'main',
    rules: [{ id: 'leap', accountId: 'main', startDate: '2024-02-29', frequency: 'yearly', type: 'income', amountMinor: 100 }] });
  assert.deepEqual(result.entries.map(row => row.date), ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
});

test('les sorties du même jour passent avant les entrées pour le point bas', () => {
  const result = calculateLedger({ openingBalanceMinor: 200, openingDate: '2026-01-01', throughDate: '2026-01-01', accountId: 'main',
    transactions: [
      { id: 'income', accountId: 'main', date: '2026-01-01', type: 'income', amountMinor: 300 },
      { id: 'expense', accountId: 'main', date: '2026-01-01', type: 'expense', amountMinor: 400 }
    ] });
  assert.equal(result.closingBalanceMinor, 100);
  assert.equal(result.lowestMinor, -200);
});

test('montants invalides et doublons sont rejetés avant tout calcul', () => {
  const base = { openingDate: '2026-01-01', throughDate: '2026-01-31', accountId: 'main' };
  assert.throws(() => calculateLedger({ ...base, rules: [{ ...rule, amountMinor: 10.5 }] }), /Montant/);
  const tx = { id: 'x', accountId: 'main', date: '2026-01-01', type: 'expense', amountMinor: 1 };
  assert.throws(() => calculateLedger({ ...base, transactions: [tx, tx] }), /dupliqué/);
});

test('minimum mensuel : conserve le solde initial même si la première opération est un revenu', () => {
  const ledger = calculateLedger({ openingDate: '2026-01-01', throughDate: '2026-01-31',
    accountId: 'A', openingBalanceMinor: 200,
    transactions: [{ id: 'i', accountId: 'A', date: '2026-01-10', type: 'income', amountMinor: 500 }] });
  assert.equal(ledger.lowestMinor, 200);
  assert.equal(ledger.months[0].lowestBalanceMinor, 200);
});

test('récurrences hebdomadaires anciennes : seules les semaines dans la fenêtre comptent', () => {
  const ledger = calculateLedger({ openingDate: '2026-10-01', throughDate: '2026-10-31', accountId: 'A',
    rules: [{ id: 'weekly', accountId: 'A', startDate: '2000-01-01', type: 'expense', frequency: 'weekly', amountMinor: 100 }] });
  assert.deepEqual(ledger.entries.map(item => item.date), ['2026-10-03','2026-10-10','2026-10-17','2026-10-24','2026-10-31']);
});

test('tarifs nombreux : versions hors ordre, mêmes dates et premières exceptions préservées', () => {
  const baseline = { ...rule, startDate: '2026-01-10', amountMinor: 500,
    rateVersions: [
      { effectiveFrom: '2026-04-01', amountMinor: 1300 },
      { effectiveFrom: '2026-02-01', amountMinor: 700 },
      { effectiveFrom: '2026-04-01', amountMinor: 1500 },
      { effectiveFrom: '2026-03-01', amountMinor: 1000 }
    ],
    overrides: [{ date: '2026-03-10', amountMinor: 0 }, { date: '2026-03-10', amountMinor: 999 }],
    skippedDates: ['2026-02-10'] };
  const ledger = calculateLedger({ accountId: 'main', openingDate: '2026-01-01', throughDate: '2026-05-31', rules: [baseline] });
  assert.deepEqual(ledger.entries.map(item => [item.date, item.amountMinor]), [
    ['2026-01-10', 500], ['2026-03-10', 0], ['2026-04-10', 1500], ['2026-05-10', 1500]
  ]);
  assert.equal(ledger.closingBalanceMinor, -3500);
  assert.equal(recurringAmountAt(baseline, '2026-04-10'), 1500);
});

test('récurrence annuelle ancienne : recherche seulement dans la fenêtre demandée', () => {
  const ledger = calculateLedger({ openingDate: '2026-10-01', throughDate: '2029-12-31', accountId: 'main',
    rules: [{ id: 'old', startDate: '1900-02-28', frequency: 'yearly', type: 'expense', accountId: 'main', amountMinor: 250 }] });
  assert.deepEqual(ledger.entries.map(item => item.date), ['2027-02-28','2028-02-28','2029-02-28']);
});
