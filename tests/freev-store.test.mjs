// Le store doit toujours rendre le même résultat que calculateLedger sur la liste complète. Lancer : node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLedger } from '../assets/js/freev-algorithm.mjs';
import { createLedgerStore } from '../assets/js/freev-store.mjs';

const mulberry32 = seed => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const CONFIG = { accountId: 'A', openingDate: '2023-01-01', throughDate: '2025-12-31', openingBalanceMinor: 100000 };

test('store identique au calcul complet après 600 opérations aléatoires', () => {
  const random = mulberry32(424242);
  const int = (min, max) => min + Math.floor(random() * (max - min + 1));
  const pick = list => list[int(0, list.length - 1)];
  const day = (from, to) => addDays('2022-10-01', int(from, to));
  const store = createLedgerStore(CONFIG);
  const mirror = new Map();
  let rules = [], counter = 0;

  const makeTx = () => {
    const type = pick(['income', 'expense', 'expense', 'refund', 'transfer']);
    const date = day(60, 1450);
    const tx = { id: `t${counter++}`, date, type, amountMinor: int(1, 20000) };
    if (type === 'transfer') { const out = random() < 0.5; Object.assign(tx, { fromAccountId: out ? 'A' : 'B', toAccountId: out ? 'B' : 'A' }); }
    else Object.assign(tx, { accountId: pick(['A', 'A', 'A', 'B']) });
    if (type !== 'transfer' && rules.length && random() < 0.3) Object.assign(tx, { parentId: pick(rules).id, dueDate: addDays(date, -int(0, 5)) });
    if (type !== 'transfer' && random() < 0.15) tx.paymentStatus = 'planned';
    return tx;
  };
  const check = label => {
    const expected = calculateLedger({ ...CONFIG, rules, transactions: [...mirror.values()] });
    assert.deepEqual(store.getLedger(), expected, label);
  };

  for (let i = 0; i < 4; i++) {
    const rule = { id: `r${i}`, accountId: 'A', startDate: day(0, 700), frequency: pick(['monthly', 'weekly', 'yearly', 'monthly']),
      type: pick(['expense', 'income']), amountMinor: int(100, 9000) };
    rules.push(rule); store.upsertRule(rule);
  }
  check('état initial');
  for (let step = 0; step < 600; step++) {
    const action = pick(['add', 'add', 'remove', 'update', 'rate', 'dropRule']);
    if (action === 'add' || mirror.size === 0) { const tx = makeTx(); store.addTransaction(tx); mirror.set(tx.id, tx); }
    else if (action === 'remove') { const id = pick([...mirror.keys()]); assert.equal(store.removeTransaction(id), true); mirror.delete(id); }
    else if (action === 'update') {
      const old = mirror.get(pick([...mirror.keys()]));
      const next = { ...old, amountMinor: old.amountMinor + 17, date: addDays(old.date, int(-40, 40)) };
      if (next.dueDate) next.dueDate = addDays(next.dueDate, int(-40, 40));
      store.updateTransaction(next); mirror.set(next.id, next);
    } else if (action === 'rate') {
      const target = pick(rules), effectiveFrom = day(200, 1300);
      const next = { ...target, rateVersions: [...(target.rateVersions || []), { effectiveFrom, amountMinor: int(100, 9000) }] };
      rules = rules.map(r => (r.id === next.id ? next : r));
      store.upsertRule(next, effectiveFrom);
    } else if (rules.length > 1) {
      const target = pick(rules);
      rules = rules.filter(r => r.id !== target.id); store.removeRule(target.id);
    }
    if (step % 3 === 0) check(`étape ${step} (${action})`); // sinon plusieurs modifications cumulées avant le calcul
  }
  check('état final');
});

test('sans modification, le même résultat est renvoyé sans recalcul', () => {
  const store = createLedgerStore(CONFIG);
  store.addTransaction({ id: 'a', accountId: 'A', date: '2024-03-01', type: 'income', amountMinor: 500 });
  const first = store.getLedger();
  assert.equal(store.getLedger(), first);
  store.addTransaction({ id: 'b', accountId: 'A', date: '2024-04-01', type: 'expense', amountMinor: 200 });
  assert.notEqual(store.getLedger(), first);
  assert.equal(store.getLedger().closingBalanceMinor, 100300);
});

test('une opération invalide ou dupliquée est refusée et le store reste intact', () => {
  const store = createLedgerStore(CONFIG);
  const ok = { id: 'a', accountId: 'A', date: '2024-03-01', type: 'expense', amountMinor: 500 };
  store.addTransaction(ok);
  const before = store.getLedger();
  assert.throws(() => store.addTransaction({ ...ok }), /dupliqué/);
  assert.throws(() => store.addTransaction({ ...ok, id: 'b', date: '2024-02-30' }), RangeError);
  assert.throws(() => store.addTransaction({ ...ok, id: 'c', amountMinor: 1.5 }), RangeError);
  assert.throws(() => store.addTransaction({ ...ok, id: undefined }), RangeError);
  assert.throws(() => store.updateTransaction({ ...ok, id: 'inconnu' }), RangeError);
  assert.throws(() => store.updateTransaction({ ...ok, type: 'bonus' }), RangeError);
  assert.equal(store.transactionCount, 1);
  assert.equal(store.getLedger(), before);
});

test('une règle invalide est refusée', () => {
  const store = createLedgerStore(CONFIG);
  const base = { id: 'r', accountId: 'A', startDate: '2024-01-15', type: 'expense', amountMinor: 100 };
  assert.throws(() => store.upsertRule({ ...base, startDate: '2024-13-01' }), RangeError);
  assert.throws(() => store.upsertRule({ ...base, type: 'refund' }), RangeError);
  assert.throws(() => store.upsertRule({ ...base, frequency: 'daily' }), RangeError);
  assert.throws(() => store.upsertRule({ ...base, id: '' }), RangeError);
});

test('déplacer une opération d\'un mois à l\'autre met à jour les deux mois', () => {
  const store = createLedgerStore(CONFIG);
  const tx = { id: 'a', accountId: 'A', date: '2024-03-10', type: 'expense', amountMinor: 700 };
  store.addTransaction(tx);
  store.getLedger();
  store.updateTransaction({ ...tx, date: '2024-06-10' });
  const months = store.getLedger().months;
  assert.deepEqual(months.map(m => [m.month, m.expenseMinor]), [['2024-06', 700]]);
  store.removeTransaction('a');
  assert.equal(store.getLedger().entries.length, 0);
});

test('instantanés du store : les objets externes ne modifient pas les calculs à son insu', () => {
  const store = createLedgerStore(CONFIG);
  const tx = { id: 'immutable', accountId: 'A', date: '2024-03-01', type: 'expense', amountMinor: 200 };
  store.addTransaction(tx);
  const rule = { id: 'immutable-rule', accountId: 'A', startDate: '2024-03-15',
    type: 'expense', amountMinor: 100, rateVersions: [{ effectiveFrom: '2024-04-15', amountMinor: 150 }] };
  store.upsertRule(rule);
  const expected = store.getLedger();
  tx.amountMinor = 999;
  rule.amountMinor = 999;
  rule.rateVersions[0].amountMinor = 999;
  store.getTransaction('immutable').amountMinor = 555;
  assert.equal(store.getLedger(), expected);
  assert.equal(store.getTransaction('immutable').amountMinor, 200);
});

test('une mauvaise date de recalcul fournie par l’appelant ne masque pas un changement de tarif plus ancien', () => {
  const store = createLedgerStore(CONFIG);
  const rule = { id: 'rate', accountId: 'A', startDate: '2024-01-15', type: 'expense',
    frequency: 'monthly', amountMinor: 100 };
  store.upsertRule(rule);
  store.getLedger();
  const next = { ...rule, rateVersions: [{ effectiveFrom: '2024-03-01', amountMinor: 200 }] };
  store.upsertRule(next, '2025-05-01');
  assert.deepEqual(store.getLedger(), calculateLedger({ ...CONFIG, transactions: [], rules: [next] }));
});

test('le store refuse les dates erronées dans les exceptions et les périodes ignorées', () => {
  const store = createLedgerStore(CONFIG);
  const rule = { id: 'rule', accountId: 'A', startDate: '2024-01-15', type: 'expense', amountMinor: 100 };
  assert.throws(() => store.upsertRule({ ...rule, endDate: '2024-02-30' }), RangeError);
  assert.throws(() => store.upsertRule({ ...rule, skippedDates: ['2024-13-01'] }), RangeError);
  assert.throws(() => store.upsertRule({ ...rule, overrides: [{ date: '2024-03-15', amountMinor: -5 }] }), RangeError);
});
