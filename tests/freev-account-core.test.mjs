import test from 'node:test';
import assert from 'node:assert/strict';
import { bookedAccountBalance, bookedAccountMonth, bookedAccountMonths } from '../assets/js/freev-account-core.mjs';
import { accountBalance } from '../assets/js/v4-engine.js';
import { calculateNetWorth } from '../assets/js/v5-engine.js';
import { computeBalanceMinor } from '../assets/js/finance-core.mjs';

test('les trois vues partagent le solde comptabilisé et ignorent prévu et futur', () => {
  const account = { id: 'a', initialCapital: 100, settings: { baseCurrency: 'EUR' }, savingsAccounts: {}, debts: [],
    transactions: [
      { id: 'income', date: '2026-10-01', type: 'income', amountBase: 20 },
      { id: 'expense', date: '2026-10-02', type: 'expense', amountBase: 5 },
      { id: 'planned', date: '2026-10-03', type: 'expense', amountBase: 30, paymentStatus: 'planned' },
      { id: 'future', date: '2026-11-01', type: 'expense', amountBase: 10 }
    ] };
  const date = '2026-10-24';
  assert.equal(bookedAccountBalance(account, date).amount, 115);
  assert.equal(accountBalance(account, date), 115);
  assert.equal(calculateNetWorth(account, date).cash, 115);
  const month = bookedAccountMonth(account, '2026-10');
  assert.equal(month.income, 20);
  assert.equal(month.expenses, 5);
});

test('le total mensuel ignore un transfert lié et les arrondis restent exacts', () => {
  const account = { id: 'a', initialCapital: 0, settings: { baseCurrency: 'EUR' }, transactions: [
    { id: 'a', date: '2026-10-01', type: 'income', amountBase: 0.1 },
    { id: 'b', date: '2026-10-02', type: 'income', amountBase: 0.2 },
    { id: 'c', date: '2026-10-03', type: 'expense', amountBase: 0.05, category: 'Courses' },
    { id: 'linked', date: '2026-10-04', type: 'expense', amountBase: 100, linkedTransferId: 'pair' }
  ] };
  assert.equal(bookedAccountBalance(account, '2026-10-24').minor, -9975);
  assert.deepEqual(bookedAccountMonth(account, '2026-10', { excludeLinkedTransfers: true }).categories, { Courses: 0.05 });
});

test('les mois calculés ensemble correspondent aux mois calculés séparément après une édition', () => {
  const account = { id: 'a', initialCapital: 0, transactions: [
    { id: 'jan', date: '2026-01-31', type: 'expense', amountBase: 10, category: 'Loisirs' },
    { id: 'feb', date: '2026-02-28', type: 'expense', amountBase: 12, category: 'Loisirs' },
    { id: 'mar', date: '2026-03-31', type: 'expense', amountBase: 10, category: 'Loisirs' }
  ] };
  const months = ['2026-01', '2026-02', '2026-03'];
  assert.deepEqual(bookedAccountMonths(account, months), months.map(month => bookedAccountMonth(account, month)));
  account.transactions[1].amountBase = 15;
  assert.equal(bookedAccountMonths(account, months)[0].expenses, 10);
  assert.equal(bookedAccountMonths(account, months)[1].expenses, 15);
  assert.equal(bookedAccountMonths(account, months)[2].expenses, 10);
});

test('une écriture de type inconnu est signalée avant de modifier un solde', () => {
  const account = { id: 'a', initialCapital: 100, transactions: [
    { id: 'invalid', date: '2026-10-01', type: 'unknown', amountBase: 20 }
  ] };
  assert.throws(() => bookedAccountBalance(account, '2026-10-24'), /Type d’opération invalide/);
});

test('parité des soldes avec le calcul monétaire historique sur des historiques variés', () => {
  for (let caseId = 0; caseId < 40; caseId++) {
    const account = { id: `a${caseId}`, initialCapital: 100 + caseId / 10, settings: { baseCurrency: 'EUR' },
      transactions: Array.from({ length: 80 }, (_, index) => ({
        id: `${caseId}-${index}`,
        date: `2026-${String(index % 12 + 1).padStart(2, '0')}-${String(index % 28 + 1).padStart(2, '0')}`,
        type: ['income', 'expense', 'transfer'][(index + caseId) % 3],
        amountBase: ((index * 7 + caseId) % 500) / 100,
        ...(index % 11 === 0 ? { paymentStatus: 'planned' } : {})
      })) };
    for (const date of ['2026-03-15', '2026-07-31', '2026-12-31']) {
      const reference = computeBalanceMinor({ initialCapital: account.initialCapital, transactions: account.transactions,
        cutoffDate: date, currency: 'EUR' });
      assert.equal(reference.ok, true);
      assert.equal(bookedAccountBalance(account, date).minor, reference.minor, `${account.id} ${date}`);
    }
  }
});
