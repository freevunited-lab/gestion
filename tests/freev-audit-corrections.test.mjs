// Régressions dédiées aux constats A01-A04 du rapport d'audit V9.7.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedgerStore } from '../assets/js/freev-store.mjs';
import { calculateLedger } from '../assets/js/freev-algorithm.mjs';
import { createStreamingLedger } from '../assets/js/streaming-ledger.mjs';

const config = { accountId: 'A', openingDate: '2026-01-01', throughDate: '2026-12-31', openingBalanceMinor: 10000 };
const tx = (id, date, amountMinor = 100) => ({ id, accountId: 'A', currency: 'EUR', date, type: 'expense', amountMinor });

test('A01 : le cache et ses objets imbriqués sont immuables, sans recalcul inutile', () => {
  const store = createLedgerStore(config);
  store.addTransaction({ ...tx('a','2026-03-01',200), metadata: { merchant: { name: 'Facture' }, tags: ['foyer'] } });
  const first = store.getLedger();
  assert.equal(first.closingBalanceMinor, 9800);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.entries));
  assert.ok(Object.isFrozen(first.entries[0].metadata.merchant));
  assert.ok(Object.isFrozen(first.months[0]));
  assert.throws(() => { first.entries[0].amountMinor = 9999999; }, TypeError);
  assert.throws(() => { first.entries[0].metadata.merchant.name = 'Pirate'; }, TypeError);
  assert.throws(() => { first.months[0].expenseMinor = 0; }, TypeError);
  assert.throws(() => first.entries.push(tx('b','2026-03-05')), TypeError);
  assert.equal(store.getLedger(), first);
  assert.equal(store.getLedger().entries[0].amountMinor, 200);
  store.updateTransaction({ ...tx('a','2026-03-01',250), metadata: { merchant: { name: 'Autre' } } });
  const updated = store.getLedger();
  assert.notEqual(updated, first);
  assert.equal(updated.closingBalanceMinor, 9750);
  assert.equal(first.closingBalanceMinor, 9800);
});

test('A02 : métadonnées, tableaux imbriqués et règles d’entrée ne partagent aucune référence', () => {
  const store = createLedgerStore(config);
  const source = { ...tx('deep','2026-03-01',200), metadata: { group: { labels: ['A'] } } };
  const rule = { id: 'rent', accountId: 'A', startDate: '2026-01-05', frequency: 'monthly',
    type: 'expense', amountMinor: 900, extra: { meta: { kind: 'rent' } } };
  store.addTransaction(source);
  store.upsertRule(rule);
  const first = store.getLedger();
  source.metadata.group.labels.push('CORRUPTED');
  rule.extra.meta.kind = 'CORRUPTED';
  const view = store.getTransaction('deep');
  view.metadata.group.labels.push('OTHER');
  assert.deepEqual(store.getLedger(), first);
  assert.deepEqual(store.getTransaction('deep').metadata.group.labels, ['A']);
  assert.equal(store.getLedger().entries.find(x => x.source === 'projected').amountMinor, 900);
  const circular = { ...tx('bad','2026-03-01') }; circular.metadata = { back: circular };
  assert.throws(() => store.addTransaction(circular), /cycliques/);
  assert.equal(store.transactionCount, 1);
  assert.throws(() => store.updateTransaction({ ...tx('deep','2026-03-01'), metadata: new Date() }), /objets JSON/);
  assert.equal(store.getLedger(), first);
});

test('A03 : lot rejeté = aucun compteur, mois, solde ou identifiant ajouté', () => {
  const ledger = createStreamingLedger({ accountId: 'A', currency: 'EUR', openingBalanceMinor: 10000, verifyUniqueIds: true });
  ledger.append(tx('initial','2026-01-02',100));
  const before = ledger.summary();
  const invalid = [tx('ok','2026-01-03',200), tx('bad','2026-02-30',300)];
  assert.throws(() => ledger.appendBatch(invalid), /Date invalide/);
  assert.deepEqual(ledger.summary(), before);
  assert.equal(ledger.transactionCount, 1);
  assert.throws(() => ledger.appendBatch([tx('dup','2026-01-03'), tx('dup','2026-01-04')]), /dupliqué/);
  assert.deepEqual(ledger.summary(), before);
  assert.throws(() => ledger.appendBatch([tx('good','2026-01-03'), tx('initial','2026-01-04')]), /dupliqué/);
  assert.deepEqual(ledger.summary(), before);
  assert.throws(() => ledger.appendBatch([tx('a','2026-01-03'), tx('b','2026-01-01')]), /non trié/);
  assert.deepEqual(ledger.summary(), before);
  assert.throws(() => ledger.appendBatch([tx('okay','2026-01-03'), tx('overflow','2026-01-04',Number.MAX_SAFE_INTEGER)]), /Dépassement/);
  assert.deepEqual(ledger.summary(), before);
  function* brokenIterator() { yield tx('iter1','2026-01-03'); throw new Error('Réseau interrompu'); }
  assert.throws(() => ledger.appendBatch(brokenIterator()), /Réseau interrompu/);
  assert.deepEqual(ledger.summary(), before);
  ledger.appendBatch([tx('ok','2026-01-03',200), tx('good','2026-01-04',300)]);
  assert.equal(ledger.transactionCount, 3);
  assert.equal(ledger.finish().closingBalanceMinor, 9400);
});

test('A03 : le lot atomique donne les mêmes totaux que les écritures individuelles', () => {
  const options = { accountId: 'A', currency: 'EUR', openingBalanceMinor: 5000, verifyUniqueIds: true };
  const batch = [tx('a','2026-01-01',500), tx('b','2026-01-01',100),
    { ...tx('c','2026-02-01',250), type: 'income' }, tx('d','2026-02-05',600),
    { ...tx('e','2026-03-01',80), type: 'refund' }];
  const inBatch = createStreamingLedger(options);
  const sequential = createStreamingLedger(options);
  inBatch.appendBatch(batch);
  batch.forEach(item => sequential.append(item));
  assert.deepEqual(inBatch.finish(), sequential.finish());
});

test('A04 : identifiants de règles dupliqués refusés avant projection', () => {
  const base = { openingDate: '2026-01-01', throughDate: '2026-12-31', accountId: 'A' };
  const recurring = { id: 'rent', accountId: 'A', startDate: '2026-01-05',
    type: 'expense', amountMinor: 900 };
  assert.throws(() => calculateLedger({ ...base, rules: [recurring, { ...recurring }] }), /règle dupliqué/);
  assert.throws(() => calculateLedger({ ...base, rules: [recurring, { ...recurring, id: 'rent' }] }), /règle dupliqué/);
  const differentAccount = calculateLedger({ ...base, rules: [recurring, { ...recurring, accountId: 'B' }] });
  assert.equal(differentAccount.projectedCount, 12);
});
