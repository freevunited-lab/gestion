import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../assets/js/', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');
const between = (s, start, end) => s.slice(s.indexOf(start), s.indexOf(end, s.indexOf(start)));
const txSource = between(read('transactions.js'), 'function captureFinancialUndoContext()', '// Remove and regenerate occurrences');
const financeSource = between(read('finance.js'), 'function deleteDebt(id) {', '// ---------- History ----------');
const recurringSource = between(read('recurring.js'), 'function skipRecurringOccurrenceById(id) {', 'function restoreSkippedRecurringPeriods(id) {');
const backupSource = between(read('core.js'), 'function isAutoBackupOwnedByCurrentUser(backup) {', 'function checkAutoBackup() {');

function environment() {
  const toasts = [];
  const context = vm.createContext({
    console, Date,
    window: { __freevUserId: 'uid-a', __freevAuthEpoch: 1, getLocalAccountCacheOwnerUid: () => 'uid-a' },
    currentAccountId: 'account-a',
    transactions: [], recurringTransactions: [], debts: [], accounts: [],
    savingsAccounts: {}, historyLog: [],
    showToast: (message, type, undoable, undo) => toasts.push({ message, type, undo }),
    logAction() {}, saveData() {}, saveAccountSystem() {}, saveCurrentGlobalsToAccount() {},
    renderDebts() {}, syncAllUI() {},
    applyOccurrenceSideEffects() {}, revertOccurrenceSideEffects() {},
    confirm: () => true,
    // Ce test isole la logique d'annulation, non la vérification des archives.
    isArchivedRecurringMonth: () => false,
    localStorage: { getItem: key => key === 'freevLastFirebaseUid' ? 'uid-a' : null },
    validateImportData: data => { if (!Array.isArray(data.accounts) || data.accounts.length === 0) throw new Error('Backup invalide'); },
    createAccountObj: (name, id) => ({ name, id }),
    generateRecurringOccurrences() {}, loadCurrentAccountIntoGlobals() {},
    saveAccountSystem() {}, renderAccountsSidebar() {}, updateViewModeUI() {},
    DEFAULT_RECONCILE_COLOR: '#059669',
    accounts: [{ id: 'account-a', transactions: [] }],
    uiSettings: {}, savingsMeta: {}, customCategories: [],
    currentAccountId: 'account-a', multiViewMode: 'individual', selectedGroupIds: new Set(),
    localStorage: { getItem: key => key === 'freevLastFirebaseUid' ? 'uid-a' : null },
    AUTO_BACKUP_KEY: 'freevAutoBackup_v2',
    recurringTransactions: []
  });
  vm.runInContext(txSource + '\n' + financeSource + '\n' + recurringSource + '\n' + backupSource, context);
  return { ctx: context, toasts, undo: () => toasts.at(-1)?.undo?.() };
}

test('une sauvegarde locale d’un autre UID est refusée', () => {
  const { ctx } = environment();
  assert.equal(ctx.isAutoBackupOwnedByCurrentUser({ ownerUid: 'uid-b' }), false);
  assert.equal(ctx.isAutoBackupOwnedByCurrentUser({ ownerUid: 'uid-a' }), true);
  ctx.window.__freevUserId = 'uid-b';
  assert.equal(ctx.isAutoBackupOwnedByCurrentUser({ ownerUid: 'uid-a' }), false);
});

test('un ancien backup sans propriétaire exige deux preuves identiques d’identité', () => {
  const { ctx } = environment();
  assert.equal(ctx.isAutoBackupOwnedByCurrentUser({}), true);
  ctx.window.getLocalAccountCacheOwnerUid = () => '';
  assert.equal(ctx.isAutoBackupOwnedByCurrentUser({}), false);
  ctx.window.getLocalAccountCacheOwnerUid = () => 'uid-a';
  ctx.localStorage.getItem = () => 'uid-b';
  assert.equal(ctx.isAutoBackupOwnedByCurrentUser({}), false);
});

test('restaurer un backup d’un autre compte ne demande pas confirmation ni ne remplace les données', () => {
  const { ctx, toasts } = environment();
  let confirmed = 0;
  ctx.confirm = () => { confirmed++; return true; };
  ctx.localStorage.getItem = key => key === 'freevAutoBackup_v2' ? JSON.stringify({ ownerUid: 'uid-b', ts: '2026-10-21T12:00:00Z', data: '{"accounts":[]}' }) : 'uid-a';
  ctx.restoreFromAutoBackup();
  assert.equal(confirmed, 0);
  assert.equal(ctx.accounts[0].id, 'account-a');
  assert.equal(toasts.at(-1).type, 'error');
});

test('un backup mal formé est rejeté avant toute mutation', () => {
  const { ctx, toasts } = environment();
  ctx.localStorage.getItem = key => key === 'freevAutoBackup_v2' ? JSON.stringify({ ownerUid: 'uid-a', ts: '2026-10-21T12:00:00Z', data: '{"accounts":[]}' }) : 'uid-a';
  ctx.restoreFromAutoBackup();
  assert.equal(ctx.accounts[0].id, 'account-a');
  assert.equal(toasts.at(-1).type, 'error');
});

test('le bouton Annuler ne restaure pas une transaction après un changement de compte', () => {
  const { ctx, undo } = environment();
  ctx.transactions = [{ id: 'tx-1', date: '2026-10-01', amountBase: 10 }];
  ctx.deleteTransaction('tx-1');
  ctx.currentAccountId = 'account-b';
  undo();
  assert.equal(ctx.transactions.length, 0);
});

test('un ancien bouton Annuler ne peut pas restaurer la mauvaise suppression', () => {
  const { ctx, toasts } = environment();
  ctx.transactions = [{ id: 'tx-1' }, { id: 'tx-2' }];
  ctx.deleteTransaction('tx-1');
  const oldUndo = toasts.at(-1).undo;
  ctx.deleteTransaction('tx-2');
  oldUndo();
  assert.equal(ctx.transactions.length, 0);
  toasts.at(-1).undo();
  assert.deepEqual([...ctx.transactions.map(t => t.id)], ['tx-2']);
});

test('une déconnexion rend caduc un bouton Annuler même sur le même compte', () => {
  const { ctx, undo } = environment();
  ctx.transactions = [{ id: 'tx-1' }];
  ctx.deleteTransaction('tx-1');
  ctx.window.__freevAuthEpoch = 2;
  undo();
  assert.equal(ctx.transactions.length, 0);
});

test('supprimer une dette ne touche pas un autre compte dont la dette a le même ID', () => {
  const { ctx } = environment();
  const current = { id: 't-a', linkedDebtId: 'debt-1' };
  const other = { id: 't-b', linkedDebtId: 'debt-1' };
  ctx.transactions = [current];
  ctx.accounts = [{ id: 'account-a', transactions: [current] }, { id: 'account-b', transactions: [other] }];
  ctx.debts = [{ id: 'debt-1', person: 'Alice', amount: 40 }];
  ctx.deleteDebt('debt-1');
  assert.equal(current.linkedDebtId, null);
  assert.equal(other.linkedDebtId, 'debt-1');
});

test('annuler la suppression d’une dette rétablit les liens de ses transactions', () => {
  const { ctx, undo } = environment();
  ctx.transactions = [{ id: 't-a', linkedDebtId: 'debt-1' }];
  ctx.debts = [{ id: 'debt-1', amount: 40 }];
  ctx.deleteDebt('debt-1');
  undo();
  assert.equal(ctx.debts[0].id, 'debt-1');
  assert.equal(ctx.transactions[0].linkedDebtId, 'debt-1');
});

test('annuler la suppression d’une dette après changement de compte ne restaure rien', () => {
  const { ctx, undo } = environment();
  ctx.transactions = [{ id: 't-a', linkedDebtId: 'debt-1' }];
  ctx.debts = [{ id: 'debt-1', amount: 40 }];
  ctx.deleteDebt('debt-1');
  ctx.currentAccountId = 'account-b';
  undo();
  assert.equal(ctx.debts.length, 0);
  assert.equal(ctx.transactions[0].linkedDebtId, null);
});

test('annuler une récurrence ignorée sur un autre compte ne touche pas la série', () => {
  const { ctx, undo } = environment();
  const rule = { id: 'rule-a', frequency: 'monthly', skippedPeriods: [] };
  ctx.recurringTransactions = [rule];
  ctx.transactions = [{ id: 'tx-a', parentId: 'rule-a', periodKey: '2026-10', date: '2026-10-10' }];
  ctx.periodKey = date => date.slice(0, 7);
  ctx.addRecurringSkippedPeriod = (r, p) => { r.skippedPeriods.push(p); return true; };
  ctx.removeRecurringSkippedPeriod = (r, p) => { r.skippedPeriods = r.skippedPeriods.filter(x => x !== p); };
  ctx.skipRecurringOccurrenceById('tx-a');
  ctx.currentAccountId = 'account-b';
  undo();
  assert.equal(ctx.transactions.length, 0);
  assert.deepEqual([...rule.skippedPeriods], ['2026-10']);
});

test('un retour sur le même compte après navigation invalide un ancien Annuler', () => {
  const { ctx, undo } = environment();
  ctx.transactions = [{ id: 'tx-1' }];
  ctx.deleteTransaction('tx-1');
  ctx.window.__freevAccountEpoch = 2; // navigation A → B → A
  undo();
  assert.equal(ctx.transactions.length, 0);
});

test('une dette supprimée délie aussi un remboursement externe qui cible explicitement le compte', () => {
  const { ctx, undo } = environment();
  const foreignTx = { id: 'repay', linkedDebtId: 'debt-1', linkedDebtAccountId: 'account-a' };
  const otherDebt = { id: 'unrelated', linkedDebtId: 'debt-1', linkedDebtAccountId: 'account-b' };
  ctx.accounts = [
    { id: 'account-a', transactions: [] },
    { id: 'account-b', transactions: [foreignTx, otherDebt] }
  ];
  ctx.debts = [{ id: 'debt-1', amount: 50 }];
  ctx.deleteDebt('debt-1');
  assert.equal(foreignTx.linkedDebtId, null);
  assert.equal(foreignTx.linkedDebtAccountId, '');
  assert.equal(otherDebt.linkedDebtId, 'debt-1');
  undo();
  assert.equal(foreignTx.linkedDebtId, 'debt-1');
  assert.equal(foreignTx.linkedDebtAccountId, 'account-a');
  assert.equal(otherDebt.linkedDebtId, 'debt-1');
});

test('une dette A ne doit pas délier une transaction A référant explicitement la dette B', () => {
  const { ctx } = environment();
  const tx = { id: 'repay', linkedDebtId: 'debt-1', linkedDebtAccountId: 'account-b' };
  ctx.transactions = [tx];
  ctx.debts = [{ id: 'debt-1', amount: 50 }];
  ctx.deleteDebt('debt-1');
  assert.equal(tx.linkedDebtId, 'debt-1');
  assert.equal(tx.linkedDebtAccountId, 'account-b');
});

// Vérifie que la source réelle de la navigation fait progresser le jeton
// d'invalidation, même si un utilisateur revient sur son compte initial.
test('la navigation entre comptes invalide les anciennes actions Annuler', () => {
  const state = read('state.js');
  const segment = between(state, 'function switchAccount(id) {', 'function createAccount(name) {');
  const ctx = vm.createContext({
    window: { __freevAccountEpoch: 2 }, accounts: [{ id: 'a' }, { id: 'b' }],
    currentAccountId: 'a', multiViewMode: 'individual', selectedGroupIds: new Set(),
    saveCurrentGlobalsToAccount() {}, saveAccountSystem() {}, loadCurrentAccountIntoGlobals() {},
    generateRecurringOccurrences() {}, syncAllUI() {}, renderAccountsSidebar() {},
    updateViewModeUI() {}, getCurrentAccount: () => ({ name: 'Compte B' }), showToast() {}
  });
  vm.runInContext(segment, ctx);
  ctx.switchAccount('b');
  assert.equal(ctx.currentAccountId, 'b');
  assert.equal(ctx.window.__freevAccountEpoch, 3);
  ctx.switchAccount('a');
  assert.equal(ctx.window.__freevAccountEpoch, 4);
  ctx.switchAccount('nonexistent');
  assert.equal(ctx.window.__freevAccountEpoch, 4);
});
