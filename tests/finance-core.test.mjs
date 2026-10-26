import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, parseTransactionBaseMinor, formatMinor, convertMinor, sumTransactionTotalsMinor, allocate, computeSpendable, dailyProjection, provisionPlan, splitExpense, applyReimbursement, prudentIncomeBase } from '../assets/js/finance-core.mjs';

const minor = (text, cur) => { const r = parseAmount(text, cur); assert.ok(r.ok, text); return r.minor; };

test('ALX 01 : lecture décimale exacte sans flottant (virgule, point, espaces, signes)', () => {
  assert.equal(minor('12,34'), 1234);
  assert.equal(minor('12.34'), 1234);
  assert.equal(minor('1 234,56'), 123456);
  assert.equal(minor('1.234.567,89'), 123456789);
  assert.equal(minor('-0,10'), -10);
  assert.equal(minor('0.1') + minor('0.2'), minor('0.3'));
  assert.equal(minor('19.99') * 3, 5997);
  assert.equal(minor('1200', 'JPY'), 1200);
  assert.equal(minor('8,5'), 850);
  assert.equal(minor('(15,00)'), -1500);
});

test('ALX 02 : un montant invalide ne devient jamais zéro', () => {
  for (const bad of ['abc', '', '   ', '1,2,3,4x', '12,345', '--5', '1e5', null, undefined, NaN, Infinity, '9'.repeat(20)]) {
    const result = parseAmount(bad, 'EUR', 'amount');
    assert.equal(result.ok, false, String(bad));
    assert.equal(result.error.field, 'amount');
    assert.ok(result.error.code);
  }
  assert.equal(parseAmount('12,340').ok, true, 'les zéros de fin ne sont pas une perte de précision');
  assert.equal(parseAmount('10,5', 'JPY').ok, false);
});

test('ALX 01 : 100 € en trois parts = 33,34 / 33,33 / 33,33', () => {
  assert.deepEqual(allocate(10000, 3), [3334, 3333, 3333]);
  assert.deepEqual(allocate(-10000, 3), [-3334, -3333, -3333]);
  assert.deepEqual(allocate(1, 3), [1, 0, 0]);
  assert.deepEqual(allocate(0, 4), [0, 0, 0, 0]);
  assert.deepEqual(allocate(10000, [50, 30, 20]), [5000, 3000, 2000]);
  assert.throws(() => allocate(100, []));
  assert.throws(() => allocate(100, [0, 0]));
  assert.throws(() => allocate(1.5, 2));
});

test('ALX 01 : répartitions proches des limites restent exactes même avec des poids très élevés', () => {
  const total = Number.MAX_SAFE_INTEGER;
  const parts = allocate(total, [total, total]);
  assert.deepEqual(parts, [4503599627370496, 4503599627370495]);
  assert.equal(parts[0] + parts[1], total);
  assert.throws(() => allocate(100, 2.5));
});

test('ALX 15 : invariant — la somme des parts égale toujours le total (jeu généré)', () => {
  let seed = 12345;
  const rand = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let run = 0; run < 2000; run++) {
    const total = rand(2_000_001) - 1_000_000;
    const weights = Array.from({ length: 1 + rand(9) }, () => rand(100));
    if (weights.every(w => w === 0)) continue;
    const parts = allocate(total, weights);
    assert.equal(parts.reduce((a, b) => a + b, 0), total);
    assert.ok(parts.every((p, i) => weights[i] > 0 || p === 0));
  }
});

test('formatMinor affiche les unités exactes et le signe', () => {
  assert.equal(formatMinor(123456), '1 234,56 €');
  assert.equal(formatMinor(-12000), '−120,00 €');
  assert.equal(formatMinor(5, 'EUR'), '0,05 €');
  assert.equal(formatMinor(1200, 'JPY'), '1 200 JPY');
  assert.equal(formatMinor(1.5), '—');
});

test('ALX 01 : conversion de devise arrondie une seule fois dans les unités cibles', () => {
  assert.deepEqual(convertMinor(101, '1.5', 'EUR', 'EUR'), { ok: true, minor: 152, currency: 'EUR' });
  assert.deepEqual(convertMinor(1, '0.0067', 'JPY', 'EUR'), { ok: true, minor: 1, currency: 'EUR' });
  assert.equal(convertMinor(100, '0', 'EUR', 'USD').ok, false);
  assert.equal(convertMinor(100, '1,2,3', 'EUR', 'USD').ok, false);
});

test('ALX 01–02 : conversion transaction vers devise de base exacte, erreur structurée si invalide ou sans taux', () => {
  assert.deepEqual(parseTransactionBaseMinor({ amount: 0.1 + 0.2, currency: 'EUR' }, 'EUR'), {
    ok: true, minor: 30, currency: 'EUR'
  });
  assert.deepEqual(parseTransactionBaseMinor({ amount: '10,00', currency: 'USD', fxRate: '0,9' }, 'EUR'), {
    ok: true, minor: 900, currency: 'EUR'
  });
  const invalid = parseTransactionBaseMinor({ id: 'broken', amount: 'abc', currency: 'EUR' }, 'EUR');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.transactionId, 'broken');
  const missingRate = parseTransactionBaseMinor({ id: 'foreign', amount: '10,00', currency: 'USD' }, 'EUR');
  assert.equal(missingRate.ok, false);
  assert.equal(missingRate.error.code, 'invalid-rate');
});

test('ALX 01–02 : les totaux partagés convertissent chaque devise et préservent la cause d’une ligne invalide', () => {
  const total = sumTransactionTotalsMinor([
    { id: 'usd-income', type: 'income', amount: 10, currency: 'USD', fxRate: '0.9', date: '2026-10-01' },
    { id: 'euro-cost', type: 'expense', amountBase: 2.15, date: '2026-10-02' }
  ], { currency: 'EUR' });
  assert.deepEqual({ income: total.income, expense: total.expense }, { income: 900, expense: 215 });
  const invalid = sumTransactionTotalsMinor([
    { id: 'missing-rate', type: 'expense', amount: 10, currency: 'USD', date: '2026-10-02' }
  ], { currency: 'EUR' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'invalid-rate');
  assert.equal(invalid.transactionId, 'missing-rate');
});

test('QUO 01 : exemple du CDC — 1 500 − 650 − 200 − 100 = 550 €', () => {
  const r = computeSpendable({ cash: 150000, dueBeforeIncome: [{ id: 'a', amount: 65000 }], reserve: 20000, allocated: 10000, periodEnd: '2026-10-31' });
  assert.equal(r.raw, 55000);
  assert.equal(r.free, 55000);
  assert.equal(r.status, 'available');
  assert.equal(r.complete, true);
});

test('QUO 02 : −120 € affiche un manque explicite et un libre nul', () => {
  const r = computeSpendable({ cash: 100000, dueBeforeIncome: [{ id: 'a', amount: 80000 }, { id: 'b', amount: 30000 }], reserve: 2000, periodEnd: '2026-10-31' });
  assert.equal(r.raw, -12000);
  assert.equal(r.free, 0);
  assert.equal(r.shortfall, 12000);
  assert.equal(r.status, 'shortfall');
});

test('QUO 01 : une même obligation n’est jamais comptée deux fois ; informations manquantes signalées', () => {
  const r = computeSpendable({ cash: 100000, dueBeforeIncome: [{ id: 'loyer', amount: 50000 }, { id: 'loyer', amount: 50000 }] });
  assert.equal(r.breakdown.due, 50000);
  assert.equal(r.duplicatesIgnored, 1);
  assert.deepEqual(r.missing, ['reserve', 'periodEnd']);
  assert.equal(r.complete, false);
  assert.equal(computeSpendable({ cash: 1.5 }).ok, false);
  assert.equal(computeSpendable({ cash: 100, dueBeforeIncome: [{ id: 'x', amount: -5 }] }).ok, false);
});

test('ALX 02 : un cumul hors limites ou une réserve invalide bloque le calcul disponible', () => {
  const overflow = computeSpendable({
    cash: Number.MAX_SAFE_INTEGER,
    dueBeforeIncome: [{ id: 'a', amount: Number.MAX_SAFE_INTEGER }, { id: 'b', amount: 1 }],
    reserve: 0,
    periodEnd: '2026-10-31'
  });
  assert.equal(overflow.ok, false);
  assert.equal(overflow.error.code, 'out-of-range');
  assert.equal(computeSpendable({ cash: 100, reserve: -1 }).error.code, 'invalid-reserve');
  assert.equal(computeSpendable({ cash: 100, allocated: 1.5 }).error.code, 'invalid-allocation');
});

test('ALX 04 : un manque de 100 € le 5 est détecté malgré un solde final de 200 €', () => {
  const result = dailyProjection(10000, [
    { date: '2026-10-05', amount: -20000, label: 'Loyer' },
    { date: '2026-10-10', amount: 30000, label: 'Salaire' }
  ], { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(result.endBalance, 20000);
  assert.equal(result.minimum.balance, -10000);
  assert.equal(result.firstShortfall.date, '2026-10-05');
  assert.equal(result.firstShortfall.need, 10000);
  assert.equal(result.firstShortfall.payments[0].label, 'Loyer');
  assert.equal(result.days.length, 31);
});

test('ALX 04 : lecture prudente le même jour (sortie avant entrée), 29 février et changement d’année', () => {
  const sameDay = dailyProjection(0, [{ date: '2026-10-05', amount: 5000, label: 'Entrée' }, { date: '2026-10-05', amount: -3000, label: 'Sortie' }], { from: '2026-10-05', to: '2026-10-05' });
  assert.equal(sameDay.firstShortfall.need, 3000);
  assert.equal(sameDay.intradayOrderUnknown, true);
  const leap = dailyProjection(0, [{ date: '2028-02-29', amount: 100 }], { from: '2028-02-28', to: '2028-03-01' });
  assert.deepEqual(leap.days.map(d => d.date), ['2028-02-28', '2028-02-29', '2028-03-01']);
  const year = dailyProjection(0, [], { from: '2026-12-30', to: '2027-01-02' });
  assert.equal(year.days.length, 4);
  assert.throws(() => dailyProjection(0, [{ date: 'demain', amount: 1 }], { from: '2026-01-01', to: '2026-01-02' }));
  assert.throws(() => dailyProjection(0, [], { from: '2026-02-30', to: '2026-03-01' }));
  assert.throws(() => dailyProjection(Number.MAX_SAFE_INTEGER, [{ date: '2026-10-05', amount: 1 }], { from: '2026-10-05', to: '2026-10-05' }));
});

test('ALX 15 : solde initial + flux = solde final, et la projection ne modifie pas ses entrées', () => {
  const flows = [{ date: '2026-01-03', amount: -500 }, { date: '2026-01-04', amount: 1200 }, { date: '2026-01-04', amount: -50 }];
  const copy = JSON.parse(JSON.stringify(flows));
  const r = dailyProjection(1000, flows, { from: '2026-01-01', to: '2026-01-10' });
  assert.equal(r.endBalance, 1000 + flows.reduce((s, f) => s + f.amount, 0));
  assert.deepEqual(flows, copy);
});

test('QUO 06 : 600 € sur six versements = 100 € ; provision existante déduite ; date dépassée sans division par zéro', () => {
  assert.deepEqual(provisionPlan({ amount: 60000, remainingInstallments: 6 }).perInstallment, Array(6).fill(10000));
  assert.deepEqual(provisionPlan({ amount: 60000, reserved: 30000, remainingInstallments: 3 }).perInstallment, Array(3).fill(10000));
  const late = provisionPlan({ amount: 60000, reserved: 10000, remainingInstallments: 0 });
  assert.equal(late.overdue, true);
  assert.equal(late.immediateShortfall, 50000);
  assert.deepEqual(late.perInstallment, []);
  assert.deepEqual(provisionPlan({ amount: 10000, remainingInstallments: 3 }).perInstallment, [3334, 3333, 3333]);
  assert.equal(provisionPlan({ amount: 1000, reserved: 5000, remainingInstallments: 2 }).missing, 0);
});

test('QUO 04 : 90 € pour trois personnes — débit −90, part 30, créance 60', () => {
  const r = splitExpense({ total: 9000, payerIndex: 0, shares: 3 });
  assert.equal(r.bankDebit, 9000);
  assert.equal(r.personalShare, 3000);
  assert.equal(r.receivable, 6000);
  assert.equal(r.shares.reduce((a, b) => a + b, 0), 9000);
  const odd = splitExpense({ total: 10000, payerIndex: 1, shares: 3 });
  assert.equal(odd.personalShare + odd.receivable, 10000);
  assert.throws(() => splitExpense({ total: 100, payerIndex: 3, shares: 3 }));
});

test('QUO 03 : remboursement attendu 60 €, reçu 20 € → reste 40 € sans nouvelle écriture ; trop-perçu et solde complet', () => {
  const partial = applyReimbursement(6000, 2000);
  assert.equal(partial.remaining, 4000);
  assert.equal(partial.state, 'partially-received');
  assert.equal(partial.newTransactions, 0);
  const over = applyReimbursement(6000, 7000);
  assert.equal(over.remaining, 0);
  assert.equal(over.overpaid, 1000);
  assert.equal(over.state, 'received');
  assert.equal(applyReimbursement(6000, 0).state, 'expected');
});

test('AJ 06 : base prudente 800 € ; mois sans revenu ≠ mois inconnu ; exclusions ; historique insuffisant', () => {
  const months = [800, 1000, 1200, 900, 1100, 1000].map((v, i) => ({ month: `2026-0${i + 1}`, covered: true, income: v * 100 }));
  const r = prudentIncomeBase(months);
  assert.equal(r.median, 100000);
  assert.equal(r.base, 80000);
  assert.equal(r.usedMonths.length, 6);

  const withGift = months.map((m, i) => i === 2 ? { ...m, income: m.income + 50000, excluded: 50000 } : m);
  assert.equal(prudentIncomeBase(withGift).base, 80000, 'un cadeau exclu n’augmente pas la base');

  const zeroMonth = prudentIncomeBase([{ month: '1', covered: true, income: 0 }, { month: '2', covered: true, income: 100000 }, { month: '3', covered: true, income: 100000 }]);
  assert.equal(zeroMonth.median, 100000);
  assert.equal(zeroMonth.ok, true);

  const unknown = prudentIncomeBase([{ month: '1', covered: false, income: null }, { month: '2', covered: true, income: 100000 }, { month: '3', covered: true, income: 100000 }]);
  assert.equal(unknown.ok, false, 'un mois inconnu n’est pas rempli par un faux zéro');
  assert.deepEqual(unknown.excludedMonths, ['1']);
  assert.equal(prudentIncomeBase(months, 70).base, 70000);
  assert.deepEqual(prudentIncomeBase([{ month: '1', covered: true, income: NaN }]), { ok: false, reason: 'invalid-input' });
  assert.deepEqual(prudentIncomeBase(months, 101), { ok: false, reason: 'invalid-input' });
});
