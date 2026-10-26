// Vérification différentielle déterministe des soldes et récurrences.
// Exécution : node scripts/stress-finance-randomized.mjs [--cases=2000]
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { financeOverview } from '../assets/js/finance-priority2-engine.mjs';

const argument = process.argv.find(value => value.startsWith('--cases='))?.slice(8);
const cases = argument === undefined ? 2000 : Number(argument);
if (!Number.isSafeInteger(cases) || cases < 1 || cases > 100000) throw Error('Nombre de scénarios invalide');
let state = 0x5eed1234;
function random() { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; }
function pick(values) { return values[Math.floor(random() * values.length)]; }
function integer(min, max) { return min + Math.floor(random() * (max - min + 1)); }
const money = cents => cents / 100;
const today = '2026-10-22';
const months = ['2026-10', '2026-11', '2026-12'];
const lastDay = month => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
const occurrenceDate = (month, day) => `${month}-${String(Math.min(day, lastDay(month))).padStart(2, '0')}`;
const transactionSign = type => type === 'income' ? 1 : -1;

function makeScenario(index) {
  return Array.from({ length: integer(1, 3) }, (_, accountIndex) => {
    const id = `account-${index}-${accountIndex}`;
    const transactions = Array.from({ length: integer(5, 45) }, (_, txIndex) => {
      const month = pick(['2026-09', ...months]);
      return {
        id: `${id}-tx-${txIndex}`,
        date: occurrenceDate(month, integer(1, 31)),
        type: pick(['income', 'expense', 'expense', 'transfer', 'savings_withdrawal', 'inter_account']),
        amountBase: money(integer(0, 100000)),
        category: pick(['Courses', 'Loisirs', 'Épargne']),
        paymentStatus: random() < 0.2 ? 'planned' : 'paid'
      };
    });
    const recurringTransactions = Array.from({ length: integer(0, 4) }, (_, ruleIndex) => {
      const startDate = occurrenceDate(pick(['2026-01', '2026-06', '2026-10']), integer(1, 28));
      const rule = {
        id: `${id}-rule-${ruleIndex}`, startDate,
        dayOfMonth: integer(1, 31), frequency: 'monthly',
        type: pick(['income', 'expense', 'transfer', 'savings_withdrawal']),
        amountBase: money(integer(1, 100000)), category: 'Abonnements',
        skippedPeriods: random() < 0.15 ? [pick(months)] : [],
        rateVersions: random() < 0.35 ? [{ effectiveFrom: `${pick(['2026-10', '2026-11', '2026-12'])}-01`, amountBase: money(integer(1, 100000)) }] : []
      };
      if (random() < 0.4) {
        const month = pick(months);
        const date = occurrenceDate(month, rule.dayOfMonth);
        transactions.push({ id: `${rule.id}-exception`, date, type: rule.type,
          amountBase: money(integer(1, 100000)), parentId: rule.id, periodKey: month,
          paymentStatus: random() < 0.3 ? 'planned' : 'paid', category: rule.category });
      }
      return rule;
    });
    return { id, name: id, initialCapital: money(integer(0, 1000000)),
      settings: { baseCurrency: 'EUR' }, transactions, recurringTransactions,
      budgetsByCategory: { Courses: money(integer(1000, 200000)) } };
  });
}

// Oracle séparé : sommes entières, boucle sur chaque mois et chaque règle.
// Aucune fonction de calcul du moteur n'est réutilisée ici.
function expected(accounts) {
  const current = { income: 0, expenses: 0, transfers: 0, paidCount: 0, plannedCount: 0 };
  let balance = 0;
  const forecasts = months.map(month => ({ month, income: 0, expenses: 0, change: 0, balance: 0, count: 0 }));
  for (const account of accounts) {
    balance += Math.round(account.initialCapital * 100);
    for (const tx of account.transactions) {
      const amount = Math.round(tx.amountBase * 100);
      const paid = tx.paymentStatus !== 'planned' && tx.date <= today;
      if (paid) balance += transactionSign(tx.type) * amount;
      if (tx.date.slice(0, 7) === '2026-10') {
        if (paid) {
          current.paidCount++;
          if (tx.type === 'income') current.income += amount;
          else if (tx.type === 'expense' || tx.type === 'savings_withdrawal') current.expenses += amount;
          else current.transfers += amount;
        } else current.plannedCount++;
      }
      if (paid) continue;
      const effectiveDate = tx.date < today ? today : tx.date;
      const bucket = forecasts.find(item => item.month === effectiveDate.slice(0, 7));
      if (!bucket) continue;
      bucket.change += transactionSign(tx.type) * amount;
      if (tx.type === 'income') bucket.income += amount;
      else if (tx.type === 'expense' || tx.type === 'savings_withdrawal') bucket.expenses += amount;
      bucket.count++;
    }
    for (const rule of account.recurringTransactions) for (const bucket of forecasts) {
      const date = occurrenceDate(bucket.month, rule.dayOfMonth);
      if (date <= today || date < rule.startDate || rule.skippedPeriods.includes(bucket.month)) continue;
      if (account.transactions.some(tx => tx.parentId === rule.id && (tx.periodKey || tx.date.slice(0, 7)) === bucket.month)) continue;
      const activeRate = rule.rateVersions.filter(version => version.effectiveFrom <= date)
        .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).at(-1);
      const amount = Math.round((activeRate?.amountBase ?? rule.amountBase) * 100);
      bucket.change += transactionSign(rule.type) * amount;
      if (rule.type === 'income') bucket.income += amount;
      else if (rule.type === 'expense' || rule.type === 'savings_withdrawal') bucket.expenses += amount;
      bucket.count++;
    }
  }
  for (const bucket of forecasts) { balance += bucket.change; bucket.balance = balance; }
  return { current, startingBalance: balance - forecasts.reduce((sum, bucket) => sum + bucket.change, 0), forecasts };
}

const start = performance.now();
let transactions = 0, rules = 0;
for (let index = 0; index < cases; index++) {
  const accounts = makeScenario(index);
  transactions += accounts.reduce((count, account) => count + account.transactions.length, 0);
  rules += accounts.reduce((count, account) => count + account.recurringTransactions.length, 0);
  const oracle = expected(accounts);
  const actual = financeOverview(accounts, { today, month: '2026-10', months: 3 });
  try {
    for (const field of ['income', 'expenses', 'transfers'])
      assert.equal(actual.current[`${field}Minor`], oracle.current[field], `current.${field}`);
    for (const field of ['paidCount', 'plannedCount'])
      assert.equal(actual.current[field], oracle.current[field], `current.${field}`);
    assert.equal(Math.round(actual.startingBalance * 100), oracle.startingBalance, 'startingBalance');
    for (let month = 0; month < 3; month++) {
      const found = actual.forecasts[month], wanted = oracle.forecasts[month];
      for (const field of ['income', 'expenses', 'change', 'balance'])
        assert.equal(found[`${field}Minor`], wanted[field], `${wanted.month}.${field}`);
      assert.equal(found.items.length, wanted.count, `${wanted.month}.items`);
    }
  } catch (error) {
    console.error(JSON.stringify({ seed: '0x5eed1234', scenario: index, accounts, oracle, actual }, null, 2));
    throw error;
  }
}
console.log(JSON.stringify({ status: 'PASS', seed: '0x5eed1234', scenarios: cases,
  transactions, recurringRules: rules, checksPerScenario: 21,
  durationMs: Math.round(performance.now() - start) }, null, 2));
