import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { calculateForecastLedger } from '../assets/js/freev-ledger-bridge.mjs';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const dashboard = read('assets/js/dashboard.js');
const transactionsSource = read('assets/js/transactions.js');
const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function moneyTotals(list, options = {}) {
  const result = { ok: true, income: 0, expenses: 0, transfers: 0, net: 0 };
  for (const transaction of list) {
    if (transaction.paymentStatus === 'planned' || transaction.isRecurring) continue;
    if (options.fromDate && transaction.date < options.fromDate) continue;
    if (options.toDate && transaction.date > options.toDate) continue;
    if (options.cutoffDate && transaction.date > options.cutoffDate) continue;
    if (transaction.type === 'income') result.income += transaction.amount;
    if (transaction.type === 'expense') result.expenses += transaction.amount;
    if (transaction.type === 'transfer') result.transfers += transaction.amount;
  }
  result.net = result.income - result.expenses - result.transfers;
  return result;
}

function harness() {
  const transactions = [
    { id: 'oct-income', date: '2026-10-05', type: 'income', amount: 100 },
    { id: 'oct-expense', date: '2026-10-20', type: 'expense', amount: 20 },
    { id: 'nov-booked', date: '2026-11-05', type: 'income', amount: 5 },
    { id: 'nov-planned', date: '2026-11-10', type: 'expense', amount: 30, paymentStatus: 'planned' }
  ];
  const projected = {
    '2026-10': [{ id: 'oct-recurring', date: '2026-10-28', type: 'expense', amount: 2, projected: true }],
    '2026-11': [{ id: 'nov-recurring', date: '2026-11-07', type: 'income', amount: 50, projected: true }],
    '2026-12': [{ id: 'dec-recurring', date: '2026-12-04', type: 'expense', amount: 10, projected: true }]
  };
  const today = new Date(2026, 9, 24);
  const context = vm.createContext({
    Date, Number, Math, console, WeakMap,
    FREEVMoney: { minorDigits: () => 2 },
    getActiveFinanceCurrency: () => ({ ok: true, currency: 'EUR' }),
    getToday: () => today,
    isoMonth: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
    isoDate: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    isValidISODate: date => /^\d{4}-\d{2}-\d{2}$/.test(String(date)),
    multiViewMode: 'individual', transactions, initialCapital: 0,
    roundMoney: value => Math.round(value * 100) / 100,
    getDisplayTransactions: () => transactions,
    getMonthTransactions: month => transactions.filter(t => t.date.startsWith(month)),
    getProjectedRecurringTransactions: month => projected[month] || [],
    financeTotalsAsAmounts: moneyTotals,
    getMonthCashNet: month => moneyTotals(transactions.filter(t => t.date.startsWith(month)), { cutoffDate: '2026-10-24' }),
    computeBalance: month => {
      const cutoff = month === '2026-10' ? '2026-10-24' : `${month}-31`;
      return moneyTotals(transactions, { cutoffDate: cutoff }).net;
    },
    monthsBetweenISO: (from, to) => {
      const result = [];
      const cursor = new Date(`${from}T12:00:00`);
      const end = new Date(`${to}T12:00:00`);
      while (cursor <= end) {
        result.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
        cursor.setMonth(cursor.getMonth() + 1);
      }
      return result;
    }
  });
  vm.runInContext(between(dashboard, 'const DASHBOARD_FORECAST_MAX_MONTHS = 36;', 'function updateDashboard()'), context);
  vm.runInContext(between(transactionsSource, 'function computeBalanceMap(additionalTransactions = []) {', 'function getProjectedBalanceTransactionsThrough('), context);
  vm.runInContext(between(transactionsSource, 'function getProjectedBalanceTransactionsThrough(month) {', 'function renderTransactionBalance('), context);
  return context;
}

test('changer de mois calcule le solde futur avec les opérations prévues cumulées sans modifier le mois courant', () => {
  const app = harness();
  const current = app.getDashboardMonthSummary('2026-10');
  const november = app.getDashboardMonthSummary('2026-11');
  const december = app.getDashboardMonthSummary('2026-12');
  assert.equal(current.balance, 80);
  assert.equal(current.isForecast, false);
  assert.equal(november.balance, 103);
  assert.equal(november.income, 55);
  assert.equal(november.expenses, 30);
  assert.equal(november.plannedCount, 2);
  assert.equal(december.balance, 93);
  assert.equal(december.expenses, 10);
  assert.equal(app.getDashboardMonthSummary('2026-10').balance, 80);
});

test('les soldes par ligne et la carte future utilisent les mêmes opérations prévues', () => {
  const app = harness();
  const projected = app.getProjectedBalanceTransactionsThrough('2026-11');
  assert.equal(projected.length, 3);
  assert.equal(projected.find(t => t.id === 'nov-planned').paymentStatus, 'paid');
  assert.equal(app.computeBalanceMap(projected)['nov-planned'], app.getDashboardMonthSummary('2026-11').balance);
  assert.equal(app.getProjectedBalanceTransactionsThrough('2026-10').some(t => t.id === 'nov-planned'), false);
  assert.equal(app.getProjectedBalanceTransactionsThrough('2030-01').length, 0);
});

test('le tableau de bord confie le solde futur au grand livre partagé', () => {
  const app = harness();
  let calls = 0;
  app.window = { FreevForecastBridge: { calculateForecastLedger(entries, options) {
    calls++;
    return calculateForecastLedger(entries, options);
  } } };
  app.FREEVMoney.parseStoredAmount = value => ({ ok: true, minor: Math.round(value * 100) });
  app.FREEVMoney.parseTransactionBaseMinor = transaction => ({ ok: true, minor: Math.round(transaction.amount * 100) });
  assert.equal(app.getDashboardMonthSummary('2026-11').balance, 103);
  assert.equal(app.getDashboardMonthSummary('2026-12').balance, 93);
  assert.equal(calls, 2);
});
