// Stress test synthétique du cockpit financier sur un grand historique local.
// Exécution : node --max-old-space-size=8192 --expose-gc scripts/stress-finance-10m.mjs
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { financeOverview } from '../assets/js/finance-priority2-engine.mjs';

const countArgument = process.argv.find(value => value.startsWith('--count='))?.slice('--count='.length);
const count = countArgument === undefined ? 10_000_000 : Number(countArgument);
if (!Number.isSafeInteger(count) || count < 1 || count > 10_000_000) {
  throw new RangeError('Le nombre de transactions doit être compris entre 1 et 10 000 000.');
}

const initialCapital = 200_000;
const amountMinor = 1;
const before = process.memoryUsage();
const buildStart = performance.now();
const transactions = Array.from({ length: count }, (_, id) => ({
  id,
  date: '2026-10-01',
  type: 'expense',
  amountBase: amountMinor / 100,
  category: 'Stress',
  desc: 'Transaction stress',
  paymentStatus: 'paid'
}));
const buildMs = performance.now() - buildStart;
const accounts = [{
  id: 'stress',
  name: 'Stress 10M',
  initialCapital,
  budgetsByCategory: { Stress: initialCapital },
  transactions,
  recurringTransactions: []
}];
const afterBuild = process.memoryUsage();

const calculationStart = performance.now();
const result = financeOverview(accounts, {
  month: '2026-10', today: '2026-10-22', months: 1
});
const calculationMs = performance.now() - calculationStart;
const expectedExpenseMinor = count * amountMinor;
const expectedBalanceMinor = Math.round(initialCapital * 100) - expectedExpenseMinor;

assert.equal(result.current.paidCount, count, 'le compte des opérations payées doit être exact');
assert.equal(result.current.expensesMinor, expectedExpenseMinor, 'le total des dépenses doit rester exact au centime');
assert.equal(result.startingBalance, expectedBalanceMinor / 100, 'le solde comptabilisé doit être exact');
assert.equal(result.forecasts.length, 1, 'un mois de prévision doit être renvoyé');
assert.equal(result.forecasts[0].balanceMinor, expectedBalanceMinor, 'le solde prévisionnel doit rester exact');
assert.ok(result.alerts.some(alert => alert.text.toLowerCase().includes('doublons potentiels')),
  'les doublons synthétiques doivent être détectés');

const beforeGc = process.memoryUsage();
globalThis.gc?.();
const afterGc = process.memoryUsage();
const mib = bytes => +(bytes / 1024 ** 2).toFixed(1);
console.log(JSON.stringify({
  status: 'PASS',
  transactions: count,
  buildMs: Math.round(buildMs),
  calculationMs: Math.round(calculationMs),
  expectedExpenseMinor,
  expectedBalanceMinor,
  heapBeforeBuildMiB: mib(before.heapUsed),
  heapAfterBuildMiB: mib(afterBuild.heapUsed),
  heapBeforeGcMiB: mib(beforeGc.heapUsed),
  heapAfterGcMiB: mib(afterGc.heapUsed),
  rssAfterGcMiB: mib(afterGc.rss),
  checks: ['paid-count', 'expense-total', 'booked-balance', 'forecast-balance', 'duplicate-alert']
}, null, 2));
