import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const source = fs.readFileSync(new URL('assets/js/data-io.js', root), 'utf8');
const moneySource = fs.readFileSync(new URL('assets/js/finance-money.js', root), 'utf8');
const validators = source.slice(0, source.indexOf('function spreadsheetSafeRows(')) + '\n' +
  source.slice(source.indexOf('function validateImportData('), source.indexOf('function setupShortcuts('));
function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const date = new Date(s + 'T12:00:00');
  return !Number.isNaN(date.getTime()) && String(date.getFullYear()).padStart(4, '0') === s.slice(0, 4) &&
    String(date.getMonth() + 1).padStart(2, '0') === s.slice(5, 7) &&
    String(date.getDate()).padStart(2, '0') === s.slice(8, 10);
}
function validImport() {
  return { accounts: [{ id: 'a1', name: 'Compte', transactions: [{ id: 't1', date: '2026-09-10',
    type: 'expense', category: 'Abonnements', amountBase: 50 }], recurringTransactions: [
    { id: 'r1', startDate: '2026-01-10', frequency: 'monthly', amountBase: 50,
      type: 'expense', category: 'Abonnements' } ] }] };
}
const ctx = vm.createContext({ isValidISODate: validDate, console });
vm.runInContext(moneySource, ctx);
vm.runInContext(validators, ctx);
const validate = value => ctx.validateImportData(value);

test('la sauvegarde JSON nominale reste importable', () => assert.equal(validate(validImport()), true));
test('date impossible dans une transaction JSON interdite', () => {
  const data = validImport(); data.accounts[0].transactions[0].date = '2026-02-31';
  assert.throws(() => validate(data), /date invalide/);
});
test('montant négatif, infini ou texte JSON refusés', () => {
  for (const value of [-1, 'Infinity', 'gratis', null, 0, 1e20]) {
    const data = validImport(); data.accounts[0].transactions[0].amountBase = value;
    assert.throws(() => validate(data), /montant invalide/, String(value));
  }
});
test('montants trop précis, montant source incohérent ou dépassement de devise refusés', () => {
  const tooPrecise = validImport(); tooPrecise.accounts[0].transactions[0].amountBase = 12.345;
  assert.throws(() => validate(tooPrecise), /montant invalide/);
  const badOriginal = validImport(); badOriginal.accounts[0].transactions[0].originalAmount = 12.345;
  assert.throws(() => validate(badOriginal), /montant d’origine/);
  const yen = validImport(); yen.accounts[0].settings = { baseCurrency: 'JPY' }; yen.accounts[0].transactions[0].amountBase = 12.5;
  assert.throws(() => validate(yen), /montant invalide/);
});
test('type de transaction non pris en charge refusé', () => {
  const data = validImport(); data.accounts[0].transactions[0].type = 'chargeback-malformed';
  assert.throws(() => validate(data), /type invalide/);
});
test('règle récurrente avec date et fréquence invalides refusée', () => {
  const data = validImport(); data.accounts[0].recurringTransactions[0].startDate = '2025-02-29';
  assert.throws(() => validate(data), /date de début invalide/);
  data.accounts[0].recurringTransactions[0].startDate = '2026-01-10';
  data.accounts[0].recurringTransactions[0].frequency = 'hourly';
  assert.throws(() => validate(data), /fréquence invalide/);
});
test('IDs dupliqués de comptes, opérations, règles refusés', () => {
  const data = validImport(); data.accounts.push(structuredClone(data.accounts[0]));
  assert.throws(() => validate(data), /compte en double/);
  const txData = validImport(); txData.accounts[0].transactions.push(structuredClone(txData.accounts[0].transactions[0]));
  assert.throws(() => validate(txData), /identifiant en double/);
  const ruleData = validImport(); ruleData.accounts[0].recurringTransactions.push(structuredClone(ruleData.accounts[0].recurringTransactions[0]));
  assert.throws(() => validate(ruleData), /identifiant en double/);
});

function copyContext(transactions) {
  const start = source.indexOf('function isValidDuplicateMonth(value) {');
  const end = source.indexOf('function escapeDuplicateMonthHTML(', start);
  const copy = vm.createContext({ isValidISODate: validDate, DUPLICATE_MONTH_TRANSACTION_LIMIT: 4000 });
  vm.runInContext(source.slice(start, end), copy);
  return copy;
}
test('copier le mois deux fois est idempotent, sans doubler les opérations', () => {
  const account = { transactions: [{ id: 'orig', date: '2026-01-31', type: 'expense', category: 'Abonnements',
    desc: 'Internet', amountBase: 50, isRecurring: false }] };
  const copy = copyContext(account.transactions);
  const first = copy.buildDuplicateMonthPlan(account, '2026-01', '2026-02');
  assert.equal(first.changes.length, 1);
  assert.equal(first.changes[0].date, '2026-02-28');
  first.changes.forEach((change, index) => account.transactions.push({
    ...change.transaction, id: `new-${index + 1}`, date: change.date, desc: change.desc
  }));
  const second = copy.buildDuplicateMonthPlan(account, '2026-01', '2026-02');
  assert.equal(second.changes.length, 0);
  assert.equal(second.duplicates, 1);
  assert.equal(account.transactions.length, 2);
});
test('copie refuse un mois de destination inexistant', () => {
  const copy = copyContext([]);
  assert.equal(copy.isValidDuplicateMonth('2026-13'), false);
  assert.equal(copy.isValidDuplicateMonth('2026-02'), true);
});

test('le backup automatique ne laisse aucun fichier local sur un appareil non fiable', () => {
  const core = fs.readFileSync(new URL('assets/js/core.js', root), 'utf8');
  const code = core.slice(core.indexOf('function manualAutoBackup()'), core.indexOf('function restoreFromAutoBackup()'));
  const stored = new Map();
  const context = vm.createContext({
    isTrustedDeviceCacheEnabled: () => false,
    buildCompleteBackupSnapshot: () => ({ accounts: [{ transactions: [{ desc: 'Privé' }] }] }),
    localStorage: { setItem: (k, v) => stored.set(k, v) },
    AUTO_BACKUP_KEY: 'freevAutoBackup_v2', updateAutoBackupStatus() {}, showToast() {}, console
  });
  vm.runInContext(code, context);
  assert.equal(context.manualAutoBackup(), false);
  context.autoBackupSilent();
  assert.equal(stored.size, 0);
});

test('désactiver le cache local nettoie les sauvegardes financières déjà enregistrées', () => {
  const state = fs.readFileSync(new URL('assets/js/state.js', root), 'utf8');
  const code = state.slice(state.indexOf('function setTrustedDeviceCache(enabled)'), state.indexOf('window.isTrustedDeviceCacheEnabled'));
  const stored = new Map([
    ['freevAutoBackup_v2', '{"sensitive":true}'],
    ['freevMultiAccounts_v2', '{"sensitive":true}'],
    ['freevData_previous', '{"sensitive":true}']
  ]);
  const context = vm.createContext({
    ACCOUNTS_STORAGE_KEY: 'freevMultiAccounts_v2', TRUSTED_DEVICE_STORAGE_KEY: 'freevTrustedDevice',
    localStorage: {
      setItem: (key, value) => stored.set(key, value),
      removeItem: key => stored.delete(key),
      keys: () => [...stored.keys()],
      getItem: key => stored.get(key),
      [Symbol.iterator]: function * () { yield * stored.keys(); }
    },
    saveAccountSystem() {}, Object
  });
  // Object.keys(localStorage) est utilisé dans la fonction : un stockage simulé doit exposer ses clés.
  const storage = context.localStorage;
  for (const k of stored.keys()) storage[k] = true;
  storage.removeItem = key => { stored.delete(key); delete storage[key]; };
  vm.runInContext(code, context);
  context.setTrustedDeviceCache(false);
  assert.equal(stored.get('freevTrustedDevice'), '0');
  assert.equal(stored.has('freevAutoBackup_v2'), false);
  assert.equal(stored.has('freevMultiAccounts_v2'), false);
  assert.equal(stored.has('freevData_previous'), false);
});

test('la sauvegarde cloud est interdite sans session de données chargée pour le même UID', () => {
  const firebase = fs.readFileSync(new URL('assets/js/firebase-auth.js', root), 'utf8');
  assert.match(firebase, /let activeDataUid = '';/);
  assert.match(firebase, /activeDataUid !== sessionUid/);
  assert.match(firebase, /cloudVerified/);
  assert.match(firebase, /runTransaction\(/);
  assert.match(firebase, /isCurrentAuthSession\(sessionUid, sessionGeneration\)/);
  assert.match(firebase, /activeDataUid = uid;/);
});

test('la liste PWA contient tous les CSS et scripts essentiels de l’interface', () => {
  const html = fs.readFileSync(new URL('index.html', root), 'utf8');
  const sw = fs.readFileSync(new URL('sw.js', root), 'utf8');
  const assets = [...html.matchAll(/(?:href|src)="(assets\/(?:css|js)\/[^"?]+)(?:\?[^\"]*)?"/g)]
    .map(match => match[1]);
  for (const asset of assets) assert.ok(sw.includes(`'./${asset}`), `PWA manque : ${asset}`);
});

test('la déconnexion signale un échec de sauvegarde cloud plutôt que de prétendre que tout est enregistré', () => {
  const firebase = fs.readFileSync(new URL('assets/js/firebase-auth.js', root), 'utf8');
  assert.match(firebase, /return cloudHealthy;/);
  assert.match(firebase, /saved = \(await window\._fbSaveCloud\?\.\(\)\) === true/);
  assert.match(firebase, /if \(!saved && !confirm\(/);
});
