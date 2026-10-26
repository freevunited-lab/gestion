import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpendable } from '../assets/js/spendable-engine.mjs';

const account = (extra = {}) => ({ id: 'a', name: 'Principal', initialCapital: 1500, transactions: [], recurringTransactions: [], settings: { baseCurrency: 'EUR' }, plannerSettings: { spendReserve: 200, ...(extra.plannerSettings || {}) }, ...extra, ...(extra.plannerSettings ? { plannerSettings: { spendReserve: 200, ...extra.plannerSettings } } : {}) });
const TODAY = '2026-10-21';
const tx = (over) => ({ id: over.id, type: 'expense', amount: 0, date: TODAY, desc: over.id, category: 'Autre', ...over });

test('QUO 01 : exemple du CDC — 1 500 − 650 − 200 = 650 € jusqu’au prochain revenu', () => {
  const a = account({ transactions: [
    tx({ id: 'loyer', amount: 650, date: '2026-10-25', paymentStatus: 'planned' }),
    tx({ id: 'salaire', type: 'income', amount: 2100, date: '2026-10-31', paymentStatus: 'planned' })
  ] });
  const r = buildSpendable([a], { today: TODAY });
  assert.equal(r.ok, true);
  assert.equal(r.breakdown.cash, 150000);
  assert.equal(r.breakdown.due, 65000);
  assert.equal(r.free, 65000);
  assert.equal(r.periodEnd, '2026-10-31');
  assert.equal(r.periodSource, 'next-income');
  assert.equal(r.complete, true);
});

test('QUO 02 : disponible négatif → manque explicite et libre nul', () => {
  const a = account({ transactions: [tx({ id: 'gros', amount: 1420, date: '2026-10-24', paymentStatus: 'planned' }), tx({ id: 'paie', type: 'income', amount: 1000, date: '2026-10-30', paymentStatus: 'planned' })] });
  const r = buildSpendable([a], { today: TODAY });
  assert.equal(r.raw, 150000 - 142000 - 20000);
  assert.equal(r.free, 0);
  assert.equal(r.shortfall, 12000);
  assert.equal(r.status, 'shortfall');
});

test('un revenu futur n’est pas ajouté à la trésorerie, et une opération déjà réglée aujourd’hui n’est pas comptée deux fois', () => {
  const a = account({ transactions: [
    tx({ id: 'cafe', amount: 10, date: TODAY }),
    tx({ id: 'paie', type: 'income', amount: 3000, date: '2026-10-28', paymentStatus: 'planned' })
  ] });
  const r = buildSpendable([a], { today: TODAY });
  assert.equal(r.breakdown.cash, 149000);
  assert.equal(r.breakdown.due, 0);
  assert.equal(r.due.length, 0);
});

test('un paiement planifié en retard reste dû ; une sortie après le prochain revenu n’est pas retranchée', () => {
  const a = account({ transactions: [
    tx({ id: 'retard', amount: 80, date: '2026-10-10', paymentStatus: 'planned' }),
    tx({ id: 'apres', amount: 500, date: '2026-11-05', paymentStatus: 'planned' }),
    tx({ id: 'paie', type: 'income', amount: 1000, date: '2026-10-30', paymentStatus: 'planned' })
  ] });
  const r = buildSpendable([a], { today: TODAY });
  assert.deepEqual(r.due.map(d => d.id.split(':').pop()), ['retard']);
  assert.equal(r.due[0].kind, 'overdue');
  assert.equal(r.breakdown.due, 8000);
});

test('une récurrence attendue est comptée une fois, et plus une fois matérialisée', () => {
  const rule = { id: 'internet', type: 'expense', amount: 35, frequency: 'monthly', startDate: '2026-01-05', dayOfMonth: 25, desc: 'Internet', category: 'Abonnements' };
  const paie = tx({ id: 'paie', type: 'income', amount: 1000, date: '2026-10-30', paymentStatus: 'planned' });
  const before = buildSpendable([account({ recurringTransactions: [rule], transactions: [paie] })], { today: TODAY });
  assert.equal(before.breakdown.due, 3500);
  assert.equal(before.due.filter(d => d.kind === 'recurring').length, 1);
  const materialised = tx({ id: 'internet-oct', amount: 35, date: '2026-10-25', parentId: 'internet', periodKey: '2026-10', paymentStatus: 'planned' });
  const after = buildSpendable([account({ recurringTransactions: [rule], transactions: [paie, materialised] })], { today: TODAY });
  assert.equal(after.breakdown.due, 3500, 'même montant, pas de doublon');
  assert.equal(after.due.length, 1);
  const skipped = buildSpendable([account({ recurringTransactions: [{ ...rule, skippedPeriods: ['2026-10'] }], transactions: [paie] })], { today: TODAY });
  assert.equal(skipped.breakdown.due, 0, 'période ignorée : aucun second débit');
});

test('sans revenu à venir : fin de mois explicite signalée ; une date choisie prévaut', () => {
  const a = account({ transactions: [tx({ id: 'x', amount: 100, date: '2026-10-29', paymentStatus: 'planned' })] });
  const fallback = buildSpendable([a], { today: TODAY });
  assert.equal(fallback.periodEnd, '2026-10-31');
  assert.equal(fallback.periodSource, 'month-end');
  assert.equal(fallback.periodEndIsExplicitFallback, true);
  const chosen = buildSpendable([account({ transactions: a.transactions, plannerSettings: { spendPeriodEnd: '2026-10-27' } })], { today: TODAY });
  assert.equal(chosen.periodEnd, '2026-10-27');
  assert.equal(chosen.breakdown.due, 0);
  const past = buildSpendable([account({ plannerSettings: { spendPeriodEnd: '2026-01-01' } })], { today: TODAY });
  assert.equal(past.periodSource, 'month-end', 'une date passée est ignorée');
});

test('réserve non définie signalée ; périmètre groupé additionne les comptes ; devises différentes refusées', () => {
  const noReserve = buildSpendable([{ ...account(), plannerSettings: {} }], { today: TODAY });
  assert.deepEqual(noReserve.missing, ['reserve']);
  assert.equal(noReserve.complete, false);
  const two = buildSpendable([account(), { ...account(), id: 'b', name: 'Livret', initialCapital: 500 }], { today: TODAY });
  assert.equal(two.breakdown.cash, 200000);
  assert.equal(two.breakdown.reserve, 40000);
  assert.deepEqual(two.scopeNames, ['Principal', 'Livret']);
  const mixed = buildSpendable([account(), { ...account(), id: 'u', settings: { baseCurrency: 'USD' } }], { today: TODAY });
  assert.equal(mixed.ok, false);
  assert.equal(mixed.reason, 'mixed-currency');
  assert.equal(buildSpendable([], { today: TODAY }).reason, 'no-account');
});

test('le calcul est en lecture seule : les comptes ne sont pas modifiés', () => {
  const a = account({ transactions: [tx({ id: 'x', amount: 50, date: '2026-10-25', paymentStatus: 'planned' })] });
  const snapshot = JSON.stringify(a);
  buildSpendable([a], { today: TODAY });
  assert.equal(JSON.stringify(a), snapshot);
});

test('ALX 01–02 : les devises, erreurs de montant et dates invalides bloquent un disponible incertain', () => {
  const foreign = account({ transactions: [tx({ id: 'usd', amount: 10, currency: 'USD', fxRate: '0.9', date: TODAY })] });
  assert.equal(buildSpendable([foreign], { today: TODAY }).breakdown.cash, 149100);

  const badAmount = account({ transactions: [tx({ id: 'bad', amount: 'inconnu', date: TODAY })] });
  const amountResult = buildSpendable([badAmount], { today: TODAY });
  assert.equal(amountResult.ok, false);
  assert.equal(amountResult.error.code, 'not-numeric');
  assert.equal(amountResult.transactionId, 'bad');

  const badDate = account({ transactions: [tx({ id: 'date', date: '2026-02-30' })] });
  const dateResult = buildSpendable([badDate], { today: TODAY });
  assert.equal(dateResult.ok, false);
  assert.equal(dateResult.error.code, 'invalid-date');
});

test('ALX 01 : le disponible respecte les unités minimales des devises sans centimes inventés', () => {
  const yen = account({ settings: { baseCurrency: 'JPY' }, initialCapital: 1000, plannerSettings: { spendReserve: 100 }, transactions: [
    tx({ id: 'yen', amount: 1, date: '2026-10-25', paymentStatus: 'planned' })
  ] });
  const result = buildSpendable([yen], { today: TODAY });
  assert.equal(result.breakdown.cash, 1000);
  assert.equal(result.breakdown.due, 1);
  assert.equal(result.breakdown.reserve, 100);
  assert.equal(result.raw, 899);
});
