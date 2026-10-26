import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateForecastLedger, forecastMonthBalances, firstNegativeDailyClose } from '../assets/js/freev-ledger-bridge.mjs';
import { financeOverview, forecastMonths } from '../assets/js/finance-priority2-engine.mjs';

const options = { openingDate: '2026-10-21', throughDate: '2026-12-31', openingBalanceMinor: 10000 };
const future = (date, amountMinor, type = 'expense', id = 'f') => ({ date, amountMinor, type, id });

// Point d'intégration : les prévisions de l'application passent par le noyau,
// tout en gardant leurs calendriers, exceptions et devises historiques.
test('pont : garde le compte en centimes et distingue transferts, revenus et dépenses', () => {
  const ledger = calculateForecastLedger([
    future('2026-10-22', 12000, 'expense', 'a'),
    future('2026-10-23', 1000, 'transfer', 'b'),
    future('2026-10-25', 15000, 'income', 'c')
  ], options);
  assert.equal(ledger.openingBalanceMinor, 10000);
  assert.equal(ledger.closingBalanceMinor, 12000);
  assert.equal(ledger.lowestMinor, -3000);
  assert.equal(ledger.plannedCount, 3);
  assert.equal(firstNegativeDailyClose(ledger), '2026-10-22');
  assert.deepEqual(forecastMonthBalances(ledger, '2026-10', 3).map(row =>
    [row.month, row.closingBalanceMinor, row.lowestBalanceMinor]), [
    ['2026-10', 12000, -3000], ['2026-11', 12000, 12000], ['2026-12', 12000, 12000]
  ]);
});

test('pont : ordre intra-journalier prudent sans faux déficit à la clôture du jour', () => {
  const ledger = calculateForecastLedger([
    future('2026-10-22', 20000, 'income', 'in'),
    future('2026-10-22', 12000, 'expense', 'out')
  ], options);
  assert.equal(ledger.lowestMinor, -2000);
  assert.equal(ledger.closingBalanceMinor, 18000);
  assert.equal(firstNegativeDailyClose(ledger), null);
});

test('pont : rejette données floues et dates impossibles', () => {
  assert.throws(() => calculateForecastLedger([future('2026-02-30', 100)], options), RangeError);
  assert.throws(() => calculateForecastLedger([future('2026-11-01', 0.5)], options), RangeError);
  assert.throws(() => calculateForecastLedger([future('2026-10-19', 100)], options), RangeError);
  assert.throws(() => calculateForecastLedger([future('2026-11-01', 100, 'withdrawal')], options), RangeError);
});

test('cockpit branché : solde final positif mais alerte sur creux intermédiaire', () => {
  const account = { id: 'A', initialCapital: 100, transactions: [
    { id: '1', date: '2026-10-22', type: 'expense', amountBase: 120 },
    { id: '2', date: '2026-10-25', type: 'income', amountBase: 150 }
  ], recurringTransactions: [] };
  const forecast = forecastMonths([account], { today: '2026-10-21', months: 3 });
  assert.equal(forecast[0].balance, 130);
  assert.equal(forecast[0].lowestBalance, -20);
  assert.equal(forecast[0].negativeDailyCloseDate, '2026-10-22');
  assert.ok(financeOverview([account], { month: '2026-10', today: '2026-10-21' }).alerts
    .some(item => item.text.includes('2026-10-22')));
});

test('cockpit branché : flux groupés sans doublon et solde exact par mois', () => {
  const account = {
    id: 'A', initialCapital: 100, transactions: [
      { id: 'paid', date: '2026-10-01', type: 'expense', amountBase: 20 },
      { id: 'future', date: '2026-11-06', type: 'expense', amountBase: 5 },
      { id: 'planned', date: '2026-10-14', type: 'income', amountBase: 30, paymentStatus: 'planned' }
    ], recurringTransactions: [{ id: 'rule', startDate: '2026-01-27', dayOfMonth: 27,
      frequency: 'monthly', amountBase: 10, type: 'expense', skippedPeriods: ['2026-11'] }]
  };
  const overview = financeOverview([account], { month: '2026-10', today: '2026-10-21' });
  assert.deepEqual(overview.forecasts.map(item => item.balance), [100, 95, 85]);
  let balanceMinor = Math.round(overview.startingBalance * 100);
  for (const month of overview.forecasts) {
    balanceMinor += month.items.reduce((sum, item) => sum + (item.type === 'income' ? 1 : -1) * item.amountMinor, 0);
    assert.equal(month.balanceMinor, balanceMinor);
  }
});

test('une baisse négative dans un mois futur déclenche une alerte même si ce mois-ci est positif', () => {
  const account = { id: 'A', initialCapital: 100, transactions: [
    { id: 'nov', type: 'expense', amountBase: 150, date: '2026-11-12' }
  ], recurringTransactions: [] };
  const result = financeOverview([account], { month: '2026-10', today: '2026-10-21', months: 3 });
  assert.equal(result.forecasts[0].balance, 100);
  assert.equal(result.forecasts[1].balance, -50);
  assert.ok(result.alerts.some(item => item.text.includes('2026-11-12')));
});
