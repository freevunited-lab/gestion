import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { CloudConflictError, cloudVersion, nextRevision, parseCloudState,
  needsLocalReconciliation, equivalentCloudState } from '../assets/js/cloud-sync-guard.mjs';
import * as guard from '../assets/js/cloud-sync-guard.mjs';

const cloudData = (amount = 50) => JSON.stringify({
  lastSaved: '2026-10-20T10:00:00Z', accounts: [{ id: 'a', name: 'Compte',
    transactions: [{ id: 't', amountBase: amount, date: '2026-10-10' }], recurringTransactions: [] }],
  currentAccountId: 'a', multiViewMode: 'individual', selectedGroupIds: []
});

test('écriture CAS seulement à partir de la même révision et des mêmes données', () => {
  const older = { revision: 5, accountData: cloudData() };
  assert.equal(nextRevision(older, cloudVersion(older)), 6);
  assert.throws(() => nextRevision({ ...older, revision: 6 }, cloudVersion(older)), CloudConflictError);
  assert.throws(() => nextRevision({ ...older, accountData: cloudData(80) }, cloudVersion(older)), CloudConflictError);
});

test('migration de document historique sans révision détecte un changement du contenu', () => {
  const older = { accountData: cloudData(50) };
  assert.equal(nextRevision(older, cloudVersion(older)), 1);
  assert.throws(() => nextRevision({ accountData: cloudData(60) }, cloudVersion(older)), CloudConflictError);
  assert.throws(() => nextRevision(null, cloudVersion(older)), CloudConflictError);
});

test('révision non valide, données illisibles ou série corrompue sont refusées', () => {
  for (const revision of [-1, 0, 1.5, '9', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => cloudVersion({ revision, accountData: cloudData() }), /Révision cloud invalide/);
  }
  assert.throws(() => cloudVersion({ accountData: { accounts: [] } }), /Format de données/);
  for (const data of ['{"accounts":[]}', '{broken', '{"accounts":[{"id":"a"}]}']) {
    assert.throws(() => parseCloudState(data));
  }
});

test('absence de changement financier ne crée pas artificiellement une nouvelle version', () => {
  const previous = cloudData();
  const state = JSON.parse(previous);
  state.lastSaved = new Date().toISOString();
  assert.equal(equivalentCloudState(previous, state), true);
  state.accounts[0].transactions[0].amountBase = 70;
  assert.equal(equivalentCloudState(previous, state), false);
});

test('cache récent divergent nécessite la réconciliation et jamais un upload silencieux', () => {
  const remote = JSON.parse(cloudData(50));
  const local = JSON.parse(cloudData(80));
  local.lastSaved = '2026-10-21T10:00:00Z';
  assert.equal(needsLocalReconciliation(local, remote, true, true), true);
  assert.equal(needsLocalReconciliation(local, remote, false, true), false);
  assert.equal(needsLocalReconciliation(local, remote, true, false), false);
  assert.equal(needsLocalReconciliation(remote, local, true, true), false);
  assert.equal(needsLocalReconciliation(remote, local, true, true, true), true);
});

const source = fs.readFileSync(new URL('../assets/js/firebase-auth.js', import.meta.url), 'utf8');
const transformed = source
  .replace(/import\('https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/([^']+)'\)/g,
    (_, module) => `Promise.resolve(fakeFirebase('${module}'))`)
  .replace("import(moduleUrl)", "Promise.resolve(guardModuleMock)");

function element() {
  return {
    style: {}, classList: { toggle() {} }, children: [], textContent: '', disabled: false,
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    addEventListener() {}, remove() {}, click() {}, setAttribute() {}
  };
}

async function fakeApp({ original = cloudData(), offline = false, local = null, syncMeta = null, holdFirstWrite = false } = {}) {
  const saved = new Map();
  const sessions = new Map();
  if (local) {
    saved.set('freevMultiAccounts_v2', JSON.stringify(local));
    saved.set('freevLastFirebaseUid', 'user-a');
    saved.set('freevTrustedDevice', '1');
  }
  if (syncMeta) saved.set('freevCloudSyncState_v1', JSON.stringify(syncMeta));
  let remote = original === null ? null : { accountData: original, revision: 2, updatedAt: '2026-10-20T10:00:00Z' };
  const nodes = new Map();
  const docNodes = key => {
    if (!nodes.has(key)) nodes.set(key, element());
    return nodes.get(key);
  };
  const doc = {
    readyState: 'loading', currentScript: { src: 'https://example.test/assets/js/firebase-auth.js' },
    baseURI: 'https://example.test/index.html', body: element(),
    getElementById: docNodes, createElement: () => element(),
    addEventListener() {}
  };
  const auth = { currentUser: null };
  let callback;
  let writes = 0;
  let opened = 0;
  let firstWriteHeld = false;
  let releaseHeldWrite = null;
  let signalHeldWrite;
  const writeHeld = new Promise(resolve => { signalHeldWrite = resolve; });
  let state = null;
  const snap = () => ({ exists: () => remote !== null, data: () => remote });
  const storage = m => ({ getItem: key => m.get(key) ?? null, setItem: (key, value) => m.set(key, value), removeItem: key => m.delete(key) });
  const fakeFirebase = name => {
    if (name === 'firebase-app.js') return { initializeApp: () => ({}) };
    if (name === 'firebase-auth.js') return {
      getAuth: () => auth, onAuthStateChanged: (_, cb) => { callback = cb; },
      signOut: async () => { auth.currentUser = null; },
      createUserWithEmailAndPassword: async () => {}, signInWithEmailAndPassword: async () => {},
      sendPasswordResetEmail: async () => {}
    };
    if (name === 'firebase-firestore.js') return {
      initializeFirestore: () => ({}), memoryLocalCache: () => ({}),
      clearIndexedDbPersistence: async () => {},
      doc: (_, collection, uid) => `${collection}/${uid}`,
      getDocFromServer: async () => { if (offline) throw new Error('network'); return snap(); },
      runTransaction: async (_db, callback) => {
        let staged = null;
        const transaction = {
          get: async () => snap(),
          set: (_ref, patch) => { staged = patch; }
        };
        const result = await callback(transaction);
        if (holdFirstWrite && !firstWriteHeld) {
          firstWriteHeld = true;
          await new Promise(resolve => { releaseHeldWrite = resolve; signalHeldWrite(); });
        }
        if (staged) { remote = { ...remote, ...staged }; writes++; }
        return result;
      }
    };
    throw new Error('unexpected import ' + name);
  };
  const win = {
    FIREBASE_CONFIGURED: true, FIREBASE_CONFIG: {},
    isTrustedDeviceCacheEnabled: () => true,
    _fbSetAuthState: () => {},
    getLocalAccountCacheOwnerUid: () => local?.ownerUid || '',
    createAccountObj: (name, id) => ({ id: id || 'fresh-account', name, transactions: [], recurringTransactions: [] }),
    _applyCloudData: data => { state = structuredClone(data); },
    loadAccountSystem: () => false,
    saveAccountSystem: () => {},
    loadCurrentAccountIntoGlobals: () => {},
    _runPostAuthInit: () => { opened++; },
    _getAppState: () => state || { accounts: [{ id: 'fresh-account', name: 'Principal', transactions: [], recurringTransactions: [] }], currentAccountId: 'fresh-account', selectedGroupIds: [] }
  };
  const context = vm.createContext({
    window: win, document: doc, fakeFirebase, guardModuleMock: guard, console, Promise, JSON,
    Date, String, Blob, URL, setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; }, clearTimeout, navigator: { platform: 'test', userAgent: 'test' },
    screen: { width: 400, height: 400 }, location: { reload() {} },
    localStorage: storage(saved), sessionStorage: storage(sessions),
    confirm: () => true
  });
  vm.runInContext(transformed, context);
  // Four module dependencies are resolved through microtasks.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof callback, 'function', 'Firebase doit avoir démarré');
  const loginAs = async (uid = 'user-a') => {
    auth.currentUser = { uid, email: 'test@example.com' };
    await callback(auth.currentUser);
  };
  return { win, login: loginAs, doc, saved, nodes, get remote() { return remote; }, set remote(value) { remote = value; },
    get state() { return state; }, set state(value) { state = value; },
    get writes() { return writes; }, get opened() { return opened; },
    writeHeld, releaseHeldWrite: () => releaseHeldWrite?.() };
}

test('cloud hors ligne au chargement : interface bloquée et aucune sauvegarde', async () => {
  const app = await fakeApp({ offline: true });
  await app.login();
  assert.equal(app.opened, 0);
  assert.equal(await app.win._fbSaveCloud(), false);
  assert.equal(app.writes, 0);
});

test('données cloud corrompues : pas de restauration locale implicite ni effacement', async () => {
  const app = await fakeApp({ original: '{not-json' });
  await app.login();
  assert.equal(app.opened, 0);
  assert.equal(app.writes, 0);
  assert.equal(await app.win._fbSaveCloud(), false);
});

test('deux appareils : mise à jour concurrente bloque un écrasement', async () => {
  const app = await fakeApp();
  await app.login();
  assert.equal(app.opened, 1);
  app.state.accounts[0].transactions[0].amountBase = 60;
  assert.equal(await app.win._fbSaveCloud(), true);
  assert.equal(app.writes, 1);
  assert.equal(app.remote.revision, 3);
  app.remote = { ...app.remote, revision: 4, accountData: cloudData(99) };
  app.state.accounts[0].transactions[0].amountBase = 70;
  assert.equal(await app.win._fbSaveCloud(), false);
  assert.equal(app.writes, 1);
  assert.equal(app.remote.revision, 4);
  assert.equal(app.doc.body.children.some(el => el.id === 'freevCloudConflictOverlay'), true);
});

test('premier compte cloud vide : création en transaction révision 1', async () => {
  const app = await fakeApp({ original: null });
  await app.login();
  assert.equal(app.opened, 1);
  assert.equal(app.writes, 1);
  assert.equal(app.remote.revision, 1);
});

test('cache local plus récent : demande un choix et ne remplace pas Firebase', async () => {
  const cache = JSON.parse(cloudData(90));
  cache.ownerUid = 'user-a'; cache.lastSaved = '2026-10-21T12:00:00Z';
  const app = await fakeApp({ local: cache });
  await app.login();
  assert.equal(app.opened, 0);
  assert.equal(app.writes, 0);
  assert.equal(app.remote.revision, 2);
  assert.equal(app.doc.body.children.some(el => el.id === 'freevCloudConflictOverlay'), true);
});


test('modifications locales non synchronisées détectées même si un autre appareil a une date plus récente', async () => {
  const local = JSON.parse(cloudData(80));
  local.ownerUid = 'user-a'; local.lastSaved = '2026-10-19T12:00:00Z';
  const app = await fakeApp({ local, syncMeta: { ownerUid: 'user-a', revision: 2, dirty: true } });
  await app.login();
  assert.equal(app.opened, 0);
  assert.equal(app.writes, 0);
  assert.equal(app.doc.body.children.some(el => el.id === 'freevCloudConflictOverlay'), true);
});

test('cache cohérent déjà synchronisé ne produit pas un faux conflit au redémarrage', async () => {
  const local = JSON.parse(cloudData(50));
  local.ownerUid = 'user-a'; local.lastSaved = '2026-10-22T10:00:00Z';
  const app = await fakeApp({ local, syncMeta: { ownerUid: 'user-a', revision: 2, dirty: false } });
  await app.login();
  assert.equal(app.opened, 1);
  assert.equal(app.writes, 0);
  assert.equal(app.doc.body.children.some(el => el.id === 'freevCloudConflictOverlay'), false);
});

test('un enregistrement encore en cours sur A ne bloque jamais la file de B', async () => {
  const app = await fakeApp({ holdFirstWrite: true });
  await app.login('user-a');
  app.state.accounts[0].transactions[0].amountBase = 61;
  const oldSave = app.win._fbSaveCloud('user-a');
  await app.writeHeld; // Firebase simulé retient le premier commit.

  await app.login('user-b');
  assert.equal(app.opened, 2);
  app.state.accounts[0].transactions[0].amountBase = 79;
  const saveB = await Promise.race([
    app.win._fbSaveCloud('user-b'),
    new Promise(resolve => setTimeout(() => resolve('timeout'), 200))
  ]);
  assert.equal(saveB, true, 'B doit pouvoir enregistrer sans attendre le commit de A');
  app.releaseHeldWrite();
  assert.equal(await oldSave, false, 'L’ancien enregistrement doit être considéré comme périmé');
});
