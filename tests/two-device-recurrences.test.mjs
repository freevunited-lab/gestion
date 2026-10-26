import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as guard from '../assets/js/cloud-sync-guard.mjs';

const copy = a => structuredClone(a);
const tx = (period, id = period) => ({
  id, parentId: 'internet', periodKey: period, date: period + '-10', source: 'recurring',
  type: 'expense', amount: 50, amountBase: 50, originalAmount: 50,
  desc: 'Internet', category: 'Abonnements', currency: 'EUR', _effectsApplied: false
});
const base = () => ({
  schemaVersion: '2026-08-02-v5', lastSaved: '2026-10-21T12:00:00.000Z',
  accounts: [{ id: 'main', name: 'Personnel', transactions: [tx('2026-09'), tx('2026-10'), tx('2026-11')],
    recurringTransactions: [{ id: 'internet', frequency: 'monthly', dayOfMonth: 10, amountBase: 50,
      startDate: '2026-01-10', recurrenceHistory: [] }], historyLog: [], savingsAccounts: {}, debts: [] }],
  currentAccountId: 'main', multiViewMode: 'individual', selectedGroupIds: [], customCategories: [],
  uiSettings: {}, savingsMeta: {}
});
let revId = 1;
function modify(state, period, amount) {
  const account = state.accounts[0];
  const target = account.transactions.find(t => t.periodKey === period);
  const before = copy(target);
  Object.assign(target, { amount, amountBase: amount, originalAmount: amount, _manuallyEdited: true,
    _effectsLedgerVersion: 1 });
  const history = account.recurringTransactions[0].recurrenceHistory;
  history.unshift({ id: `rev-${revId++}`, at: '2026-10-21T13:00:00Z', kind: 'single', period,
    before, after: copy(target) });
  account.historyLog.unshift({ ts: '2026-10-21T13:00:00Z', action: 'update_single', entity: 'transaction', before: '50', after: String(amount) });
  return state;
}
const fuse = (b, l, r) => guard.mergeDisjointRecurringMonths(JSON.stringify(b), JSON.stringify(l), JSON.stringify(r));

test('fusion de septembre et novembre sur deux appareils sans toucher octobre', () => {
  const b = base(); const l = modify(copy(b), '2026-09', 80); const r = modify(copy(b), '2026-11', 120);
  const result = fuse(b, l, r);
  assert.ok(result);
  assert.deepEqual(result.accounts[0].transactions.map(t => t.amountBase), [80, 50, 120]);
  assert.equal(result.accounts[0].recurringTransactions[0].amountBase, 50);
  assert.equal(result.accounts[0].recurringTransactions[0].recurrenceHistory.length, 2);
  assert.equal(result.accounts[0].historyLog.length, 2);
  assert.deepEqual(b.accounts[0].transactions.map(t => t.amountBase), [50, 50, 50]);
});

test('identifiants numériques anciens des règles : deux mois fusionnés sans conversion destructive', () => {
  const b = base();
  b.accounts[0].recurringTransactions[0].id = 1729000123123;
  b.accounts[0].transactions.forEach(t => { t.parentId = 1729000123123; });
  const result = fuse(b, modify(copy(b), '2026-09', 81), modify(copy(b), '2026-11', 79));
  assert.ok(result);
  assert.deepEqual(result.accounts[0].transactions.map(t => t.amountBase), [81, 50, 79]);
  assert.equal(result.accounts[0].recurringTransactions[0].id, 1729000123123);
});

test('même mois modifié simultanément : refus de fusion', () => {
  const b = base();
  assert.equal(fuse(b, modify(copy(b), '2026-10', 65), modify(copy(b), '2026-10', 95)), null);
});

test('mois différents mais règle de tarif modifiée sur appareil distant : refus', () => {
  const b = base(), l = modify(copy(b), '2026-09', 70), r = modify(copy(b), '2026-11', 90);
  r.accounts[0].recurringTransactions[0].amountBase = 150;
  assert.equal(fuse(b, l, r), null);
});

test('fusion interdite lorsqu’une dette est modifiée', () => {
  const b = base(), l = modify(copy(b), '2026-09', 70), r = modify(copy(b), '2026-11', 90);
  r.accounts[0].debts.push({ id: 'debt-1', amount: 90 });
  assert.equal(fuse(b, l, r), null);
});

test('échéance d’épargne ou remboursement : aucune fusion financière risquée', () => {
  const b = base(), l = modify(copy(b), '2026-09', 70), r = modify(copy(b), '2026-11', 90);
  l.accounts[0].transactions[0].fromSavings = true;
  assert.equal(fuse(b, l, r), null);
  delete l.accounts[0].transactions[0].fromSavings;
  r.accounts[0].transactions[2].linkedDebtId = 'debt1';
  assert.equal(fuse(b, l, r), null);
});

test('suppression ou création d’une occurrence : fusion bloquée', () => {
  const b = base(), l = modify(copy(b), '2026-09', 70), r = modify(copy(b), '2026-11', 90);
  r.accounts[0].transactions.pop();
  assert.equal(fuse(b, l, r), null);
  r.accounts[0].transactions.push(tx('2026-11'));
  r.accounts[0].transactions.push(tx('2026-12'));
  assert.equal(fuse(b, l, r), null);
});

test('un état global modifié sur un appareil ne peut pas être fusionné silencieusement', () => {
  const b = base(), l = modify(copy(b), '2026-09', 70), r = modify(copy(b), '2026-11', 90);
  l.customCategories.push({ name: 'Vacances' });
  assert.equal(fuse(b, l, r), null);
});

test('un compte supplémentaire ou un changement d’ordre provoque un refus', () => {
  const b = base(), l = modify(copy(b), '2026-09', 70), r = modify(copy(b), '2026-11', 90);
  r.accounts.push({ id: 'second', transactions: [], recurringTransactions: [] });
  assert.equal(fuse(b, l, r), null);
  r.accounts.pop();
  r.accounts[0].transactions.reverse();
  assert.equal(fuse(b, l, r), null);
});

test('historique supprimé, altéré ou type de restauration : fusion refusée', () => {
  const b = base(), l = modify(copy(b), '2026-09', 70), r = modify(copy(b), '2026-11', 90);
  l.accounts[0].recurringTransactions[0].recurrenceHistory = [];
  assert.equal(fuse(b, l, r), null);
  l.accounts[0].recurringTransactions[0].recurrenceHistory = [{ id: 'restore', kind: 'historical', period: '2026-09', at: 'now' }];
  assert.equal(fuse(b, l, r), null);
});

test('état cloud corrompu : aucune écriture automatique', () => {
  const b = base(), l = modify(copy(b), '2026-09', 70);
  assert.equal(guard.mergeDisjointRecurringMonths(JSON.stringify(b), JSON.stringify(l), '{corrupt'), null);
});

test('historique de révision existant conservé avec les deux nouvelles opérations', () => {
  const b = base();
  const previously = modify(b, '2026-10', 55);
  const l = modify(copy(previously), '2026-09', 60);
  const r = modify(copy(previously), '2026-11', 90);
  const merged = fuse(previously, l, r);
  assert.ok(merged);
  assert.equal(merged.accounts[0].recurringTransactions[0].recurrenceHistory.length, 3);
  assert.equal(merged.accounts[0].transactions[1].amountBase, 55);
});

test('historique distant changé sans modification de transaction : refus', () => {
  const b = base(), l = modify(copy(b), '2026-09', 70), r = modify(copy(b), '2026-11', 90);
  r.accounts[0].recurringTransactions[0].recurrenceHistory[0].after.amountBase = 999;
  assert.equal(fuse(b, l, r), null);
});

test('historique incomplet après deux changements successifs : fusion refusée', () => {
  const b = base(), l = modify(copy(b), '2026-09', 70), r = modify(copy(b), '2026-11', 90);
  modify(l, '2026-09', 75);
  l.accounts[0].recurringTransactions[0].recurrenceHistory[1].after.amountBase = 999;
  assert.equal(fuse(b, l, r), null);
});

test('une période récurrente en double dans la base empêche une fusion', () => {
  const b = base();
  b.accounts[0].transactions.push(tx('2026-10', 'duplicated-month'));
  assert.equal(fuse(b, modify(copy(b), '2026-09', 70), modify(copy(b), '2026-11', 90)), null);
});

test('deux écritures non récurrentes modifiées en parallèle ne sont jamais fusionnées', () => {
  const b = base();
  b.accounts[0].transactions.push({ id: 'once', amountBase: 30, date: '2026-10-02', type: 'expense' });
  const l = modify(copy(b), '2026-09', 75), r = modify(copy(b), '2026-11', 90);
  r.accounts[0].transactions.at(-1).amountBase = 40;
  assert.equal(fuse(b, l, r), null);
});

// Mise en situation de deux instances de l'application, avec les mêmes
// transactions/règles mais des états mémoire séparés et un serveur CAS partagé.
const source = fs.readFileSync(new URL('../assets/js/firebase-auth.js', import.meta.url), 'utf8')
  .replace(/import\('https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/([^']+)'\)/g,
    (_, name) => `Promise.resolve(fakeFirebase('${name}'))`)
  .replace('import(moduleUrl)', 'Promise.resolve(guardModuleMock)');
function el() { return {
  style: {}, children: [], textContent: '', className: '', classList: { toggle() {} },
  replaceChildren(...items) { this.children = items; }, append(...items) { this.children.push(...items); },
  attributes: {}, setAttribute(name, value) { this.attributes[name] = String(value); },
  addEventListener() {}, remove() {}, click() {}
}; }
async function browser(shared) {
  const storage = new Map(), sessionStorage = new Map(), nodes = new Map();
  const element = id => { if (!nodes.has(id)) nodes.set(id, el()); return nodes.get(id); };
  const doc = { readyState: 'loading', currentScript: { src: 'https://example.test/assets/js/firebase-auth.js' },
    baseURI: 'https://example.test/', body: el(), getElementById: element,
    createElement: el, addEventListener() {} };
  let authCallback, state = null;
  const auth = { currentUser: null };
  const snapshot = () => ({ exists: () => shared.value !== null, data: () => shared.value });
  const fakeFirebase = name => {
    if (name === 'firebase-app.js') return { initializeApp: () => ({}) };
    if (name === 'firebase-auth.js') return {
      getAuth: () => auth, onAuthStateChanged: (_auth, cb) => { authCallback = cb; },
      signOut: async () => {}, createUserWithEmailAndPassword: async () => {},
      signInWithEmailAndPassword: async () => {}, sendPasswordResetEmail: async () => {}
    };
    if (name === 'firebase-firestore.js') return {
      initializeFirestore: () => ({}), memoryLocalCache: () => ({}), clearIndexedDbPersistence: async () => {},
      doc: (_, __, uid) => `users/${uid}`,
      getDocFromServer: async () => { shared.beforeRead?.(); return snapshot(); },
      runTransaction: async (_db, fn) => {
        const old = copy(shared.value); let patch = null;
        const t = { get: async () => ({ exists: () => !!old, data: () => old }),
          set: (_ref, data) => { patch = data; } };
        const revision = await fn(t);
        if (patch) {
          shared.beforeCommit?.(patch);
          if (JSON.stringify(shared.value) !== JSON.stringify(old)) throw new guard.CloudConflictError();
          shared.value = { ...shared.value, ...patch };
          shared.writes++;
          shared.afterWrite?.();
        }
        return revision;
      }
    };
    throw new Error(`Unexpected ${name}`);
  };
  const win = { FIREBASE_CONFIGURED: true, FIREBASE_CONFIG: {},
    isTrustedDeviceCacheEnabled: () => true,
    _fbSetAuthState: () => {}, getLocalAccountCacheOwnerUid: () => '',
    _applyCloudData: data => { state = copy(data); },
    saveAccountSystem: () => {}, loadCurrentAccountIntoGlobals: () => {},
    createAccountObj: (name, id) => ({ id: id || 'new', name, transactions: [], recurringTransactions: [] }),
    _runPostAuthInit: () => {}, _getAppState: () => state,
    showToast: () => {}, syncAllUI: () => {}
  };
  const store = m => ({ getItem: k => m.get(k) || null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) });
  vm.runInNewContext(source, { window: win, document: doc, fakeFirebase, guardModuleMock: guard,
    localStorage: store(storage), sessionStorage: store(sessionStorage), console,
    Promise, JSON, Date, String, Blob, URL,
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; },
    clearTimeout, navigator: { platform: 'test', userAgent: 'test' }, screen: { width: 400, height: 400 },
    confirm: () => true, location: { reload() {} }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof authCallback, 'function');
  auth.currentUser = { uid: 'user-a', email: 'test@example.org' };
  await authCallback(auth.currentUser);
  return { win, doc, get state() { return state; }, get conflict() {
    return doc.body.children.some(node => node.id === 'freevCloudConflictOverlay');
  } };
}

test('DEUX SESSIONS : deux mois distincts sont conservés par fusion CAS', async () => {
  const b = base(); const shared = { value: { accountData: JSON.stringify(b), revision: 2, updatedAt: b.lastSaved }, writes: 0 };
  const first = await browser(shared), second = await browser(shared);
  modify(first.state, '2026-09', 80);
  modify(second.state, '2026-11', 120);
  assert.equal(await first.win._fbSaveCloud(), true);
  assert.equal(await second.win._fbSaveCloud(), true);
  assert.equal(shared.value.revision, 4);
  assert.equal(shared.writes, 2);
  assert.deepEqual(JSON.parse(shared.value.accountData).accounts[0].transactions.map(t => t.amountBase), [80,50,120]);
  assert.deepEqual(second.state.accounts[0].transactions.map(t => t.amountBase), [80,50,120]);
  assert.equal(second.conflict, false);
});

test('DEUX SESSIONS : même mois en concurrence bloque la seconde écriture', async () => {
  const b = base(); const shared = { value: { accountData: JSON.stringify(b), revision: 2, updatedAt: b.lastSaved }, writes: 0 };
  const first = await browser(shared), second = await browser(shared);
  modify(first.state, '2026-10', 80);
  modify(second.state, '2026-10', 120);
  assert.equal(await first.win._fbSaveCloud(), true);
  assert.equal(await second.win._fbSaveCloud(), false);
  assert.equal(shared.writes, 1);
  assert.equal(second.conflict, true);
  assert.equal(JSON.parse(shared.value.accountData).accounts[0].transactions[1].amountBase, 80);
  assert.equal(second.state.accounts[0].transactions[1].amountBase, 120);
});

test('DEUX SESSIONS : modification locale pendant la lecture de conflit => aucune fusion', async () => {
  const b = base(); const shared = { value: { accountData: JSON.stringify(b), revision: 2 }, writes: 0 };
  const first = await browser(shared), second = await browser(shared);
  modify(first.state, '2026-09', 80);
  modify(second.state, '2026-11', 120);
  await first.win._fbSaveCloud();
  shared.beforeRead = () => { second.state.accounts[0].transactions[1].desc = 'Nouvelle saisie'; };
  assert.equal(await second.win._fbSaveCloud(), false);
  assert.equal(shared.writes, 1);
  assert.equal(second.conflict, true);
  assert.equal(second.state.accounts[0].transactions[1].desc, 'Nouvelle saisie');
});

test('DEUX SESSIONS : nouvelle saisie pendant commit => conservée localement, conflit signalé', async () => {
  const b = base(); const shared = { value: { accountData: JSON.stringify(b), revision: 2 }, writes: 0 };
  const first = await browser(shared), second = await browser(shared);
  modify(first.state, '2026-09', 80);
  modify(second.state, '2026-11', 120);
  await first.win._fbSaveCloud();
  shared.afterWrite = () => {
    if (shared.writes === 2) second.state.accounts[0].transactions[1].desc = 'Saisie en cours';
  };
  assert.equal(await second.win._fbSaveCloud(), false);
  assert.equal(shared.writes, 2);
  assert.equal(second.conflict, true);
  assert.equal(second.state.accounts[0].transactions[1].desc, 'Saisie en cours');
  assert.deepEqual(JSON.parse(shared.value.accountData).accounts[0].transactions.map(t=>t.amountBase), [80,50,120]);
});

test('DEUX SESSIONS : évolution du serveur pendant le commit bloque un troisième écrasement', async () => {
  const b = base(); const shared = { value: { accountData: JSON.stringify(b), revision: 2 }, writes: 0 };
  const first = await browser(shared), second = await browser(shared);
  modify(first.state, '2026-09', 80);
  modify(second.state, '2026-11', 120);
  await first.win._fbSaveCloud();
  let injected = false;
  shared.beforeCommit = patch => {
    if (injected || patch.revision !== 4) return;
    injected = true;
    const newest = JSON.parse(shared.value.accountData);
    newest.accounts[0].transactions[1].desc = 'Tiers';
    shared.value = { ...shared.value, revision: 4, accountData: JSON.stringify(newest) };
  };
  assert.equal(await second.win._fbSaveCloud(), false);
  assert.equal(second.conflict, true);
  assert.equal(JSON.parse(shared.value.accountData).accounts[0].transactions[1].desc, 'Tiers');
  assert.equal(JSON.parse(shared.value.accountData).accounts[0].transactions[2].amountBase, 50);
  assert.equal(second.state.accounts[0].transactions[2].amountBase, 120);
});

test('DEUX SESSIONS : changement de sélection de comptes pendant la fusion détecté', async () => {
  const b = base(); const shared = { value: { accountData: JSON.stringify(b), revision: 2 }, writes: 0 };
  const first = await browser(shared), second = await browser(shared);
  modify(first.state, '2026-09', 80);
  modify(second.state, '2026-11', 120);
  second.state.selectedGroupIds = new Set();
  await first.win._fbSaveCloud();
  shared.beforeRead = () => { second.state.selectedGroupIds.add('main'); };
  assert.equal(await second.win._fbSaveCloud(), false);
  assert.equal(shared.writes, 1);
  assert.equal(second.conflict, true);
  assert.ok(second.state.selectedGroupIds.has('main'));
});
