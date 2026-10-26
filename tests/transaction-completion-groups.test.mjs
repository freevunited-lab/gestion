import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/transactions.js', import.meta.url), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function harness() {
  const account = { id: 'a', name: 'Compte A', recurringTransactions: [
    { id: 'stream', category: 'Loisirs', desc: '' },
    { id: 'internet', category: 'Factures', desc: '' }
  ] };
  const transactions = [
    { id: 'aug', parentId: 'stream', date: '2026-08-10', type: 'expense', category: 'Loisirs', amount: 2.99, desc: '' },
    { id: 'sep', parentId: 'stream', date: '2026-09-10', type: 'expense', category: 'Loisirs', amount: 3.49, desc: '' },
    { id: 'oct', parentId: 'stream', date: '2026-10-10', type: 'expense', category: 'Loisirs', amount: 3.49, desc: 'Paiement personnalisé' },
    { id: 'internet', parentId: 'internet', date: '2026-09-15', type: 'expense', category: 'Factures', amount: 20, desc: '' },
    { id: 'single', date: '2026-09-16', type: 'expense', category: 'Courses', amount: 15, desc: '' }
  ];
  const nodes = new Map([
    ['transactionCompletionPanel', { hidden: false }],
    ['transactionCompletionCount', { textContent: '' }],
    ['transactionCompletionList', { innerHTML: '', querySelectorAll: () => [] }]
  ]);
  const toasts = [];
  let saves = 0;
  const context = vm.createContext({
    transactions, recurringTransactions: account.recurringTransactions,
    currentAccountId: account.id, multiViewMode: 'individual', settings: { baseCurrency: 'EUR' },
    document: { getElementById: id => nodes.get(id) || null },
    getCurrentAccount: () => account, getViewAccounts: () => [account],
    getDisplayTransactions: () => transactions,
    escapeHTML: value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;'),
    formatCurrency: value => `${value} €`, getTransactionTypeLabel: type => type,
    logAction() {}, saveData: () => { saves++; }, syncAllUI() {},
    showToast: (message, type) => toasts.push({ message, type }),
    switchAccount() {}, openModalById() {}
  });
  vm.runInContext(between('function isTransactionIncomplete(transaction) {', 'function getTransactionTemplateStore()'), context);
  vm.runInContext(between('function renderIncompleteTransactions() {', 'function renderTransactionDrafts()'), context);
  return { context, transactions, account, nodes, toasts, getSaves: () => saves };
}

test('les opérations liées à une série restent groupées malgré un changement de prix', () => {
  const h = harness();
  const incomplete = h.transactions.filter(h.context.isTransactionIncomplete);
  const result = h.context.groupIncompleteRecurringTransactions(incomplete, 'a');
  assert.equal(result.groups.length, 2);
  assert.equal(result.groups.find(group => group.ruleId === 'stream').transactions.length, 2);
  assert.equal(result.separate.length, 1);
  h.context.renderIncompleteTransactions();
  assert.match(h.nodes.get('transactionCompletionCount').textContent, /2 séries · 4 opérations/);
  assert.match(h.nodes.get('transactionCompletionList').innerHTML, /tarif variable/);
  assert.match(h.nodes.get('transactionCompletionList').innerHTML, /1 autre opération à compléter/);
});

test('une description saisie une fois remplit les lignes vides et la règle sans changer les chiffres', () => {
  const h = harness();
  const before = h.transactions.map(item => ({ id: item.id, date: item.date, amount: item.amount, category: item.category }));
  h.context.completeRecurringDescription('stream', 'a', 'Abonnement vidéo');
  assert.equal(h.transactions.find(item => item.id === 'aug').desc, 'Abonnement vidéo');
  assert.equal(h.transactions.find(item => item.id === 'sep').desc, 'Abonnement vidéo');
  assert.equal(h.transactions.find(item => item.id === 'oct').desc, 'Paiement personnalisé');
  assert.equal(h.transactions.find(item => item.id === 'internet').desc, '');
  assert.equal(h.transactions.find(item => item.id === 'single').desc, '');
  assert.equal(h.account.recurringTransactions[0].desc, 'Abonnement vidéo');
  assert.deepEqual(h.transactions.map(item => ({ id: item.id, date: item.date, amount: item.amount, category: item.category })), before);
  assert.equal(h.getSaves(), 1);
});

test('deux comptes avec le même identifiant de règle ne sont jamais fusionnés', () => {
  const h = harness();
  const items = [
    { parentId: 'stream', _accountId: 'a', desc: '', category: 'Loisirs' },
    { parentId: 'stream', _accountId: 'b', desc: '', category: 'Loisirs' }
  ];
  assert.equal(h.context.groupIncompleteRecurringTransactions(items, 'a').groups.length, 2);
  h.context.completeRecurringDescription('stream', 'b', 'Mauvais compte');
  assert.equal(h.getSaves(), 0);
  assert.equal(h.transactions.find(item => item.id === 'aug').desc, '');
  assert.equal(h.toasts.at(-1).type, 'info');
});

test('un retrait d’épargne est nommé comme tel dans la liste à compléter', () => {
  const h = harness();
  h.transactions.push({ id: 'withdrawal', date: '2026-10-07', type: 'income', fromSavings: true,
    category: 'Épargne', amount: 200, desc: '' });
  h.context.renderIncompleteTransactions();
  assert.match(h.nodes.get('transactionCompletionList').innerHTML, /savings_withdrawal · 200 €/);
});
