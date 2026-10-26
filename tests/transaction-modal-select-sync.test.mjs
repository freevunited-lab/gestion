import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/transactions.js', import.meta.url), 'utf8');
const modalCode = source.slice(source.indexOf('function syncTransactionModalSelects() {'), source.indexOf('function closeModal() {'));

function harness() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      id, value: id === 'transType' ? 'expense' : '', checked: false, dataset: {},
      classList: { add() {}, remove() {} }, focus() {}, reset() {}
    });
    return nodes.get(id);
  };
  const transactions = [
    { id: 'revenue', type: 'income', category: 'Épargne', amount: 200, date: '2026-10-07' },
    { id: 'expense', type: 'expense', category: 'Courses', amount: 30, date: '2026-10-08' },
    { id: 'recurring-revenue', parentId: 'rule1', type: 'income', category: 'Salaire', amount: 45, date: '2026-10-09' },
    { id: 'withdrawal', type: 'income', fromSavings: true, category: 'Épargne', amount: 200, date: '2026-10-10' },
    { id: 'debt-payment', type: 'expense', category: 'Remboursement dette', linkedDebtId: 'debt1', amount: 25, date: '2026-10-11' }
  ];
  const visible = [];
  const context = vm.createContext({
    window: { FreevCustomSelects: { refresh: () => visible.push(node('transType').value) } },
    document: { activeElement: null, getElementById: node },
    transactions, recurringTransactions: [{ id: 'rule1', type: 'income', category: 'Salaire', frequency: 'monthly', dayOfMonth: 9 }],
    settings: { baseCurrency: 'EUR', defaultMode: 'personal' },
    currentAccountId: 'account1', lastFocusedEl: null,
    populateCategorySelects() {}, refreshSavingsSelect() {}, refreshDebtSelect() {},
    resetRecurringDateScopeContext() {}, setupRecurringDateScopeContext() {},
    selectTransactionCategory: value => { node('transCategory').value = value; },
    toggleDebtSelect() {}, toggleRecurOptions() {}, toggleFxRate() {},
    setTransReconcileColor() {}, setTransactionColorScopeHint() {},
    updateIncomeClassificationUI() {}, updatePaymentStatusControl() {},
    renderFavoriteTagsInModal() {},
    defaultSavingsTarget: () => '', getToday: () => new Date('2026-10-24'),
    isoDate: () => '2026-10-24', today: new Date('2026-10-24'),
    setTimeout() {}, showToast() {}
  });
  vm.runInContext(modalCode, context);
  return { context, node, visible };
}

test('ouvrir un revenu puis une dépense rafraîchit le type affiché par le menu personnalisé', () => {
  const app = harness();
  app.context.openModalById('revenue');
  assert.equal(app.node('transType').value, 'income');
  assert.equal(app.visible.at(-1), 'income');
  app.context.openModalById('expense');
  assert.equal(app.node('transType').value, 'expense');
  assert.equal(app.visible.at(-1), 'expense');
});

test('ouvrir un revenu récurrent rafraîchit aussi le type affiché', () => {
  const app = harness();
  app.context.openModalById('recurring-revenue');
  assert.equal(app.node('transType').value, 'income');
  assert.equal(app.visible.at(-1), 'income');
});

test('un retrait d’épargne affiche son type précis dans le formulaire', () => {
  const app = harness();
  app.context.openModalById('withdrawal');
  assert.equal(app.node('transType').value, 'savings_withdrawal');
  assert.equal(app.visible.at(-1), 'savings_withdrawal');
});

test('ouvrir une autre opération efface la dette liée à la précédente', () => {
  const app = harness();
  app.context.openModalById('debt-payment');
  assert.equal(app.node('transLinkedDebt').value, 'debt1');
  app.context.openModalById('revenue');
  assert.equal(app.node('transLinkedDebt').value, '');
});

test('ouvrir une récurrence efface la dette liée à une opération précédente', () => {
  const app = harness();
  app.context.openModalById('debt-payment');
  app.context.openModalById('recurring-revenue');
  assert.equal(app.node('transLinkedDebt').value, '');
});
