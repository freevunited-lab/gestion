import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedgerStore } from '../assets/js/freev-store.mjs';
import { calculateLedger } from '../assets/js/freev-algorithm.mjs';
import { recalculateTransactionChanges } from '../assets/js/freev-delta-ledger.mjs';

const config = { accountId: 'A', openingDate: '2022-01-01', throughDate: '2028-12-31', openingBalanceMinor: 100000 };
const rules = [
  { id: 'monthly', accountId: 'A', startDate: '2022-01-15', type: 'expense', amountMinor: 999, frequency: 'monthly' },
  { id: 'salary', accountId: 'A', startDate: '2022-01-28', type: 'income', amountMinor: 200000, frequency: 'monthly' },
];
const tx = (id, date, amountMinor, type = 'expense', overrides = {}) =>
  ({ id, accountId: 'A', date, type, amountMinor, ...overrides });

const isoDay = day => new Date(Date.UTC(2022, 0, 1 + day)).toISOString().slice(0, 10);

test('modifications par lots : delta strictement identique au recalcul de référence sur 1 300 mouvements', () => {
  let state = 0xabcdef;
  const rand = () => ((state = (Math.imul(state, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  const choice = items => items[Math.floor(rand() * items.length)];
  const store = createLedgerStore(config);
  const mirror = new Map();
  let counter = 0;
  for (const rule of rules) store.upsertRule(rule);
  const check = label => {
    const fromFull = calculateLedger({ ...config, transactions: [...mirror.values()], rules });
    assert.deepEqual(store.getLedger(), fromFull, label);
  };
  check('initial');
  for (let step = 0; step < 1300; step++) {
    const action = choice(['add', 'add', 'update', 'update', 'delete']);
    if (action === 'add' || !mirror.size) {
      const date = isoDay(Math.floor(rand() * 2450) - 10);
      const type = choice(['expense', 'income', 'refund', 'transfer']);
      const transaction = tx(`tx${counter++}`, date, Math.ceil(rand() * 100000), type);
      if (rand() < 0.12) transaction.paymentStatus = 'planned';
      if (rand() < 0.08) transaction.accountId = 'B';
      if (type === 'transfer') {
        transaction.fromAccountId = rand() < 0.5 ? 'A' : 'B';
        transaction.toAccountId = transaction.fromAccountId === 'A' ? 'B' : 'A';
        delete transaction.accountId;
      }
      mirror.set(transaction.id, transaction);
      store.addTransaction(transaction);
    } else {
      const previous = choice([...mirror.values()]);
      if (action === 'delete') {
        store.removeTransaction(previous.id);
        mirror.delete(previous.id);
      } else {
        const next = { ...previous, amountMinor: Math.ceil(rand() * 100000),
          date: isoDay(Math.floor(rand() * 2450) - 10) };
        if (rand() < 0.08 && next.type !== 'transfer') next.accountId = next.accountId === 'A' ? 'B' : 'A';
        store.updateTransaction(next);
        mirror.set(next.id, next);
      }
    }
    if (step % 7 === 0) check(`step ${step}`);
  }
  check('final');
});

test('échéance avec parentId : recalcule la suppression ou réapparition de la projection', () => {
  const store = createLedgerStore(config);
  for (const rule of rules) store.upsertRule(rule);
  const paid = tx('actual', '2025-06-16', 1500, 'expense', { parentId: 'monthly', dueDate: '2025-06-15' });
  store.addTransaction(paid);
  store.getLedger();
  store.removeTransaction('actual');
  assert.deepEqual(store.getLedger(), calculateLedger({ ...config, rules, transactions: [] }));
  store.addTransaction(paid);
  assert.deepEqual(store.getLedger(), calculateLedger({ ...config, rules, transactions: [paid] }));
});

test('mises à jour sans effet sur le compte suivi et collisions ID de projection', () => {
  const store = createLedgerStore(config);
  store.upsertRule(rules[0]);
  const cross = tx('external', '2024-06-01', 200, 'expense', { accountId: 'B' });
  store.addTransaction(cross);
  const snapshot = store.getLedger();
  store.updateTransaction({ ...cross, amountMinor: 500 });
  assert.equal(store.getLedger(), snapshot);
  const overlap = tx('monthly|2024-07-15', '2024-07-15', 999, 'expense');
  store.addTransaction(overlap);
  assert.deepEqual(store.getLedger(), calculateLedger({ ...config, rules: [rules[0]], transactions: [cross, overlap] }));
  store.updateTransaction({ ...overlap, amountMinor: 1000 });
  assert.deepEqual(store.getLedger(), calculateLedger({ ...config, rules: [rules[0]], transactions: [cross, { ...overlap, amountMinor: 1000 }] }));
});

test('refus explicite de l’optimisation quand une différence touche une échéance', () => {
  const base = calculateLedger({ ...config, rules, transactions: [] });
  assert.throws(() => recalculateTransactionChanges(base, [{ before: tx('p', '2025-01-15', 25, 'expense', { parentId: 'monthly' }), after: null }]), /récurrence/);
});


test('plusieurs mutations d’une même transaction avant lecture n’appliquent qu’un seul delta', () => {
  const store = createLedgerStore({ ...config, includeProjections: false });
  store.addTransaction(tx('same', '2024-02-15', 1500));
  store.getLedger();
  store.updateTransaction(tx('same', '2024-03-15', 2000));
  store.updateTransaction(tx('same', '2024-05-15', 3000, 'income'));
  store.updateTransaction(tx('same', '2024-06-15', 4000, 'expense', { paymentStatus: 'planned' }));
  assert.deepEqual(store.getLedger(), calculateLedger({ ...config, includeProjections: false,
    transactions: [tx('same', '2024-06-15', 4000, 'expense', { paymentStatus: 'planned' })] }));
  store.removeTransaction('same');
  assert.equal(store.getLedger().entries.length, 0);
});

test('les nouveaux scripts du moteur sont disponibles hors connexion', async () => {
  const { readFile } = await import('node:fs/promises');
  const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /'\.\/assets\/js\/freev-delta-ledger\.mjs'/);
  assert.match(sw, /'\.\/assets\/js\/freev-ledger-audit\.mjs'/);
});
