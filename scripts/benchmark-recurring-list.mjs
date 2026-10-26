// Mesure ciblée de la recherche de prochaine échéance utilisée par la liste.
// Usage : node scripts/benchmark-recurring-list.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const rules = Array.from({ length: 100 }, (_, index) => ({
  id: `rule-${index}`, startDate: '2026-01-28', dayOfMonth: 28,
  frequency: 'monthly', amountBase: 12, type: 'expense', skippedPeriods: []
}));
const transactions = Array.from({ length: 50000 }, (_, index) => ({
  id: `tx-${index}`, parentId: rules[index % rules.length].id,
  periodKey: `2025-${String(index % 12 + 1).padStart(2, '0')}`,
  date: `2025-${String(index % 12 + 1).padStart(2, '0')}-28`,
  amountBase: 12, type: 'expense'
}));
const context = vm.createContext({
  Date, Map, Set, transactions, recurringTransactions: rules,
  getToday: () => new Date('2026-10-22T12:00:00'),
  isoDate: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
  isoMonth: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
});
vm.runInContext(fs.readFileSync(new URL('../assets/js/recurring.js', import.meta.url), 'utf8'), context);

const oldRun = () => rules.map(rule => context.getNextRecurringDate(rule, '2026-10-23'));
const newRun = () => {
  const byRule = new Map();
  for (const transaction of transactions) {
    let periods = byRule.get(transaction.parentId);
    if (!periods) { periods = new Map(); byRule.set(transaction.parentId, periods); }
    if (!periods.has(transaction.periodKey)) periods.set(transaction.periodKey, transaction);
  }
  return rules.map(rule => context.getNextRecurringDate(rule, '2026-10-23', 36, byRule.get(rule.id)));
};
assert.deepEqual(newRun(), oldRun());
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function measure(run) {
  run(); run();
  return median(Array.from({ length: 7 }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  }));
}
const beforeMs = measure(oldRun), afterMs = measure(newRun);
console.log(JSON.stringify({ rules: rules.length, transactions: transactions.length,
  beforeMs: +beforeMs.toFixed(2), afterMs: +afterMs.toFixed(2),
  gain: +(beforeMs / afterMs).toFixed(2), identicalDates: true,
  note: 'Mesure ciblée de la liste des récurrences, pas de tous les calculs financiers.' }, null, 2));
