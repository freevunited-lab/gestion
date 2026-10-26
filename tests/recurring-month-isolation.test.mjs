import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { financeOverview } from '../assets/js/finance-priority2-engine.mjs';

// Charge les vrais scripts de l'application. Le DOM et le temps sont simulés
// pour tester les chemins de production, y compris saveTransaction().
const recurringCode = fs.readFileSync(new URL('../assets/js/recurring.js', import.meta.url), 'utf8');
const transactionsCode = fs.readFileSync(new URL('../assets/js/transactions.js', import.meta.url), 'utf8');
const everydayCode = fs.readFileSync(new URL('../assets/js/everyday-features.js', import.meta.url), 'utf8');
const recurringTariffCode = everydayCode.slice(0, everydayCode.indexOf('function subscriptionFor('));
const moneyCode = fs.readFileSync(new URL('../assets/js/finance-money.js', import.meta.url), 'utf8');
const coreCode = fs.readFileSync(new URL('../assets/js/core.js', import.meta.url), 'utf8');
const projectionsCode = coreCode.slice(
  coreCode.indexOf('function getProjectedRecurringTransactions('),
  coreCode.indexOf('function getProjectedLookupMonths(')
);

function env(overrides = {}) {
  const elements = new Map();
  const input = (id, value = '') => {
    const el = { value, checked: false, dataset: {}, classList: { add() {}, remove() {} } };
    elements.set(id, el);
    return el;
  };
  const fields = {
    editId: '', transType: 'expense', transCategory: 'Abonnements', transAmount: '50',
    transDate: '2026-09-10', transDesc: 'Internet', transTags: '', transMode: 'personal',
    transLinkedDebt: '', transCurrency: 'EUR', transFxRate: '',
    recurFreq: 'monthly', recurDay: '10', editOccurrenceId: '',
    editOccurrencePeriodKey: '', editOccurrenceOriginalDate: '', editRuleOriginalDate: ''
  };
  for (const [k, v] of Object.entries(fields)) input(k, v);
  input('isRecurring').checked = true;
  input('transReconcileColor').dataset.customColor = '';
  input('globalMonthPicker').value = '2026-10';

  const notifications = [];
  const confirms = [];
  const confirmAnswers = [...(overrides.confirmAnswers || [])];
  const rule = {
    id: 'r1', frequency: 'monthly', dayOfMonth: 10, startDate: '2026-01-10',
    amount: 50, amountBase: 50, originalAmount: 50, desc: 'Internet', type: 'expense',
    category: 'Abonnements', currency: 'EUR', skippedPeriods: []
  };
  const initialTx = overrides.transactions || [];
  const ctx = vm.createContext({
    console,
    Date,
    transactions: structuredClone(initialTx),
    recurringTransactions: structuredClone(overrides.rules ?? [overrides.rule || rule]),
    currentAccountId: 'acc1',
    multiViewMode: 'individual',
    settings: { baseCurrency: 'EUR', defaultMode: 'personal' },
    savingsAccounts: { 'Livret A': 0 },
    debts: [],
    getToday: () => new Date('2026-10-21T12:00:00'),
    isoDate: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    isoMonth: d => {
      const date = d || new Date('2026-10-21T12:00:00');
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    },
    genId: (() => { let id = 0; return () => `generated-${++id}`; })(),
    roundMoney: v => Math.round(v * 100) / 100,
    defaultSavingsTarget: () => 'Livret A',
    applyTransferToSavings: (account, delta) => { ctx.savingsAccounts[account] += delta; },
    decreaseDebt: () => {}, increaseDebt: () => {},
    safeNumber: (v, fallback) => v === '' || !Number.isFinite(Number(v)) ? fallback : Number(v),
    isValidISODate: value => /^\d{4}-\d{2}-\d{2}$/.test(value) && (() => {
      const d = new Date(value + 'T12:00:00');
      return !Number.isNaN(d.valueOf()) && d.getFullYear() === Number(value.slice(0,4)) &&
        d.getMonth() + 1 === Number(value.slice(5,7)) && d.getDate() === Number(value.slice(8,10));
    })(),
    normalizeCategory: value => value,
    parseTags: value => value.split(',').map(x => x.trim()).filter(Boolean),
    logAction: () => {}, saveData: () => {}, closeModal: () => {}, syncAllUI: () => {},
    showToast: (msg, type) => { notifications.push({ msg, type }); },
    formatCurrency: value => String(value),
    document: {
      getElementById: id => elements.get(id) || null,
      querySelector: () => ({ value: ctx.__scope })
    },
    confirm: message => {
      confirms.push(message);
      return confirmAnswers.length ? confirmAnswers.shift() : true;
    },
    monthsBetweenISO: (a, b) => {
      const results = [];
      for (let m = a.slice(0, 7); m <= b.slice(0, 7);) {
        results.push(m);
        const [y, mon] = m.split('-').map(Number);
        m = `${y + (mon === 12 ? 1 : 0)}-${String(mon === 12 ? 1 : mon + 1).padStart(2, '0')}`;
      }
      return results;
    }
  });
  vm.runInContext(moneyCode, ctx);
  vm.runInContext(`function getDisplayRecurringRules(){return recurringTransactions;}\n${recurringCode}\n${transactionsCode}\n${projectionsCode}`, ctx);
  ctx.__scope = 'single';
  function save({ date = '2026-09-10', month = '2026-09', amount = 80, scope = 'single',
                  projected = false, id = 'sept', desc = 'Internet – tarif exceptionnel', freq = 'monthly' } = {}) {
    input('editId', '__rule__r1');
    input('editOccurrenceId', projected ? `__projected_current_r1_${month}` : id);
    input('editOccurrencePeriodKey', month);
    input('editOccurrenceOriginalDate', `${month}-10`);
    input('editRuleOriginalDate', '2026-01-10');
    input('transAmount', String(amount));
    input('transDate', date);
    input('transDesc', desc);
    input('recurFreq', freq);
    input('recurDay', '10');
    ctx.__scope = scope;
    ctx.saveTransaction({ preventDefault() {} });
    return notifications.at(-1);
  }
  return { ctx, elements, input, notifications, confirms, save };
}

function tx(id, date, amount = 50, extra = {}) {
  return { id, parentId: 'r1', periodKey: date.slice(0, 7), date, type: 'expense',
    amount, amountBase: amount, originalAmount: amount, desc: 'Internet',
    category: 'Abonnements', source: 'recurring', _effectsApplied: false, ...extra };
}

function auditOverview(ctx, month = '2026-09') {
  return financeOverview([{
    id: 'acc1', name: 'Compte test', initialCapital: 1000,
    settings: { baseCurrency: 'EUR' }, budgetsByCategory: {},
    transactions: ctx.transactions, recurringTransactions: ctx.recurringTransactions
  }], { month, today: '2026-10-21', months: 3 });
}

function setupTariffForm(harness) {
  vm.runInContext(recurringTariffCode, harness.ctx);
  harness.ctx.document.querySelectorAll = () => [];
}

function submitTariff(harness, { scope, amount, effectiveDate = '2026-11-01',
  singleDate = '2026-11-10', frequency = 'monthly' }) {
  const { ctx, input } = harness;
  input('recurringTariffRuleId', 'r1');
  input('recurringTariffAmount', String(amount));
  input('recurringTariffCurrency', 'EUR');
  input('recurringTariffEffectiveDate', effectiveDate);
  input('recurringTariffFxRate', '');
  const single = input('recurringTariffSingleDate');
  single.selectedOptions = [{
    value: ctx.periodKey(singleDate, frequency), disabled: false,
    dataset: { date: singleDate, scheduledDate: singleDate, duplicate: 'false' }
  }];
  ctx.__scope = scope;
  ctx.saveRecurringTariff({ preventDefault() {} });
  return harness.notifications.at(-1);
}

test('formulaire tarif : hausse ou baisse sur une échéance seulement, avec mois passé et futur inchangés', () => {
  for (const amount of [85, 35]) {
    const h = env({ transactions: [tx('sept', '2026-09-10', 50), tx('oct', '2026-10-10', 50)] });
    setupTariffForm(h);
    const before = JSON.stringify(h.ctx.transactions);
    assert.equal(submitTariff(h, { scope: 'single', amount }).type, 'success');
    assert.equal(h.ctx.recurringTransactions[0].amountBase, 50);
    assert.equal(h.ctx.recurringTransactions[0].rateVersions?.length || 0, 0);
    assert.equal(h.ctx.transactions.find(item => item.periodKey === '2026-11')?.amountBase, amount);
    assert.equal(h.ctx.getProjectedRecurringTransactions('2026-11').length, 0);
    assert.equal(h.ctx.getProjectedRecurringTransactions('2026-12')[0].amountBase, 50);
    assert.equal(JSON.stringify(h.ctx.transactions.filter(item => item.date < '2026-11-01')),
      JSON.stringify(JSON.parse(before).filter(item => item.date < '2026-11-01')));
    h.ctx.generateRecurringOccurrences();
    assert.equal(h.ctx.transactions.filter(item => item.periodKey === '2026-11').length, 1);
    assert.equal(h.ctx.transactions.find(item => item.periodKey === '2026-11')?.amountBase, amount);
    assert.equal(h.ctx.getProjectedRecurringTransactions('2026-12')[0].amountBase, 50);
  }
});

test('formulaire tarif : changer dès ce mois ne réécrit pas le mois passé et continue après janvier', () => {
  const h = env({
    rule: { id: 'r1', frequency: 'monthly', dayOfMonth: 28, startDate: '2026-01-28',
      amount: 50, amountBase: 50, originalAmount: 50, type: 'expense',
      desc: 'Internet', category: 'Abonnements', currency: 'EUR', skippedPeriods: [] },
    transactions: [tx('sept', '2026-09-28', 50)]
  });
  setupTariffForm(h);
  const pastBefore = JSON.stringify(h.ctx.transactions);
  assert.equal(submitTariff(h, { scope: 'future', amount: 85, effectiveDate: '2026-10-21' }).type, 'success');
  assert.equal(JSON.stringify(h.ctx.transactions), pastBefore);
  assert.equal(h.ctx.getRecurringRateForDate(h.ctx.recurringTransactions[0], '2026-09-28').amountBase, 50);
  for (const month of ['2026-10', '2026-11', '2026-12', '2027-01'])
    assert.equal(h.ctx.getProjectedRecurringTransactions(month)[0].amountBase, 85, month);
  h.ctx.generateRecurringOccurrences();
  assert.equal(JSON.stringify(h.ctx.transactions.filter(item => item.date < '2026-10-01')), pastBefore);
});

test('formulaire tarif : baisse future conserve une exception et laisse chaque mois antérieur intact', () => {
  const h = env({ transactions: [tx('sept', '2026-09-10', 50), tx('oct', '2026-10-10', 50)] });
  setupTariffForm(h);
  assert.equal(submitTariff(h, { scope: 'single', amount: 85, singleDate: '2026-11-10' }).type, 'success');
  const snapshot = JSON.stringify(h.ctx.transactions);
  assert.equal(submitTariff(h, { scope: 'future', amount: 35, effectiveDate: '2026-11-01' }).type, 'success');
  assert.equal(JSON.stringify(h.ctx.transactions), snapshot);
  assert.equal(h.ctx.transactions.find(item => item.periodKey === '2026-11')?.amountBase, 85);
  assert.equal(h.ctx.getProjectedRecurringTransactions('2026-12')[0].amountBase, 35);
  assert.equal(h.ctx.getProjectedRecurringTransactions('2027-01')[0].amountBase, 35);
  assert.equal(h.ctx.getRecurringRateForDate(h.ctx.recurringTransactions[0], '2026-10-10').amountBase, 50);
});

test('formulaire tarif : toutes les suivantes remplace aussi les tarifs déjà programmés plus loin', () => {
  const h = env({
    rule: { id: 'r1', frequency: 'monthly', dayOfMonth: 10, startDate: '2026-01-10',
      amount: 50, amountBase: 50, originalAmount: 50, type: 'expense',
      desc: 'Internet', category: 'Abonnements', currency: 'EUR', skippedPeriods: [],
      rateVersions: [
        { effectiveFrom: '2026-12-01', amountBase: 70, originalAmount: 70, currency: 'EUR' },
        { effectiveFrom: '2027-01-01', amountBase: 75, originalAmount: 75, currency: 'EUR' }
      ] },
    transactions: [tx('sept', '2026-09-10', 50), tx('oct', '2026-10-10', 50)]
  });
  setupTariffForm(h);
  const pastBefore = JSON.stringify(h.ctx.transactions);
  assert.equal(submitTariff(h, { scope: 'future', amount: 85, effectiveDate: '2026-11-01' }).type, 'success');
  assert.equal(JSON.stringify(h.ctx.transactions), pastBefore);
  for (const month of ['2026-11', '2026-12', '2027-01', '2027-02'])
    assert.equal(h.ctx.getProjectedRecurringTransactions(month)[0].amountBase, 85, month);
  assert.equal(h.ctx.recurringTransactions[0].rateVersions.length, 1);
  assert.equal(h.ctx.getRecurringRateForDate(h.ctx.recurringTransactions[0], '2026-10-10').amountBase, 50);
});

test('formulaire tarif : un tarif déjà prévu à la même date est remplacé sans doublon', () => {
  const h = env({
    rule: { id: 'r1', frequency: 'monthly', dayOfMonth: 10, startDate: '2026-01-10',
      amount: 50, amountBase: 50, originalAmount: 50, type: 'expense',
      desc: 'Internet', category: 'Abonnements', currency: 'EUR', skippedPeriods: [],
      rateVersions: [{ effectiveFrom: '2026-11-01', amountBase: 70, originalAmount: 70, currency: 'EUR' }] },
    transactions: [tx('sept', '2026-09-10', 50), tx('oct', '2026-10-10', 50)]
  });
  setupTariffForm(h);
  assert.equal(submitTariff(h, { scope: 'future', amount: 85, effectiveDate: '2026-11-01' }).type, 'success');
  assert.equal(h.ctx.recurringTransactions[0].rateVersions.length, 1);
  assert.equal(h.ctx.getProjectedRecurringTransactions('2026-11')[0].amountBase, 85);
  assert.equal(h.ctx.getProjectedRecurringTransactions('2026-12')[0].amountBase, 85);
  assert.equal(h.ctx.transactions.find(item => item.id === 'oct').amountBase, 50);
});

test('l’aperçu annonce le remplacement des tarifs ultérieurs et affiche les bons montants', () => {
  const h = env({
    rule: { id: 'r1', frequency: 'monthly', dayOfMonth: 10, startDate: '2026-01-10',
      amount: 50, amountBase: 50, originalAmount: 50, type: 'expense',
      desc: 'Internet', category: 'Abonnements', currency: 'EUR', skippedPeriods: [],
      rateVersions: [{ effectiveFrom: '2026-12-01', amountBase: 70, originalAmount: 70, currency: 'EUR' }] }
  });
  setupTariffForm(h);
  h.ctx.escapeHTML = value => String(value);
  h.input('recurringTariffRuleId', 'r1');
  h.input('recurringTariffAmount', '85');
  h.input('recurringTariffCurrency', 'EUR');
  h.input('recurringTariffEffectiveDate', '2026-11-01');
  h.input('recurringTariffFxRate', '');
  const preview = h.input('recurringTariffPreview');
  h.ctx.__scope = 'future';
  h.ctx.previewRecurringTariff();
  assert.match(preview.innerHTML, /70.*→.*85/);
  assert.match(preview.innerHTML, /1 tarif\(s\) déjà programmés/);
  assert.equal(h.ctx.recurringTransactions[0].rateVersions.length, 1, 'l’aperçu ne doit rien écrire');
});

test('formulaire tarif hebdomadaire : une seule semaine puis nouveau tarif ne touchent pas la semaine passée', () => {
  const h = env({
    rule: { id: 'r1', frequency: 'weekly', startDate: '2026-10-07',
      amount: 25, amountBase: 25, originalAmount: 25, type: 'expense',
      desc: 'Courses', category: 'Courses', currency: 'EUR', skippedPeriods: [] },
    transactions: [tx('oct14', '2026-10-14', 25, { periodKey: '2026-W42' })]
  });
  setupTariffForm(h);
  assert.equal(submitTariff(h, { scope: 'single', amount: 40,
    singleDate: '2026-10-28', frequency: 'weekly' }).type, 'success');
  assert.equal(h.ctx.transactions.find(item => item.id === 'oct14')?.amountBase, 25);
  assert.equal(h.ctx.transactions.find(item => item.date === '2026-10-28')?.amountBase, 40);
  assert.equal(submitTariff(h, { scope: 'future', amount: 30,
    effectiveDate: '2026-11-04' }).type, 'success');
  assert.equal(h.ctx.transactions.find(item => item.id === 'oct14')?.amountBase, 25);
  assert.equal(h.ctx.transactions.find(item => item.date === '2026-10-28')?.amountBase, 40);
  assert.equal(h.ctx.getProjectedRecurringTransactions('2026-11').find(item => item.date === '2026-11-04')?.amountBase, 30);
  assert.equal(h.ctx.getProjectedRecurringTransactions('2026-11').find(item => item.date === '2026-11-11')?.amountBase, 30);
});

test('audit : changer le tarif dès novembre préserve les opérations et soldes de septembre et octobre', () => {
  const { ctx, save } = env({ transactions: [
    tx('sept', '2026-09-10', 50), tx('oct', '2026-10-10', 50)
  ] });
  const pastBefore = JSON.stringify(ctx.transactions.filter(item => item.date < '2026-11-01'));
  const septemberBefore = auditOverview(ctx, '2026-09');
  const octoberBefore = auditOverview(ctx, '2026-10');
  assert.equal(save({ date: '2026-11-15', month: '2026-11', projected: true,
    scope: 'all', amount: 85 }).type, 'success');
  ctx.generateRecurringOccurrences();
  const septemberAfter = auditOverview(ctx, '2026-09');
  const octoberAfter = auditOverview(ctx, '2026-10');
  assert.equal(JSON.stringify(ctx.transactions.filter(item => item.date < '2026-11-01')), pastBefore);
  assert.deepEqual(septemberAfter.current, septemberBefore.current);
  assert.deepEqual(octoberAfter.current, octoberBefore.current);
  assert.equal(septemberAfter.startingBalance, septemberBefore.startingBalance);
  assert.equal(octoberAfter.startingBalance, octoberBefore.startingBalance);
  assert.equal(octoberAfter.forecasts[1].expensesMinor, 8500);
  assert.equal(octoberAfter.forecasts[2].expensesMinor, 8500);
});

test('audit : modifier seulement novembre ne change ni septembre, ni octobre, ni décembre', () => {
  const { ctx, save } = env({ transactions: [
    tx('sept', '2026-09-10', 50), tx('oct', '2026-10-10', 50)
  ] });
  const pastBefore = auditOverview(ctx, '2026-09');
  const octoberBefore = auditOverview(ctx, '2026-10');
  assert.equal(save({ date: '2026-11-15', month: '2026-11', projected: true,
    scope: 'single', amount: 85 }).type, 'success');
  ctx.generateRecurringOccurrences();
  assert.deepEqual(auditOverview(ctx, '2026-09').current, pastBefore.current);
  const octoberAfter = auditOverview(ctx, '2026-10');
  assert.deepEqual(octoberAfter.current, octoberBefore.current);
  assert.equal(octoberAfter.startingBalance, octoberBefore.startingBalance);
  assert.equal(octoberAfter.forecasts[1].expensesMinor, 8500);
  assert.equal(octoberAfter.forecasts[2].expensesMinor, 5000);
});

test('audit : modifier un virement récurrent futur ne réapplique pas l’épargne déjà transférée', () => {
  const { ctx, save, input } = env({
    rule: { id: 'r1', frequency: 'monthly', startDate: '2026-01-10', dayOfMonth: 10,
      type: 'transfer', amount: 30, amountBase: 30, desc: 'Épargne', category: 'Épargne',
      transferTarget: 'Livret A' },
    transactions: [
      tx('sept', '2026-09-10', 30, { type: 'transfer', transferTarget: 'Livret A', _effectsApplied: true }),
      tx('oct', '2026-10-10', 30, { type: 'transfer', transferTarget: 'Livret A', _effectsApplied: true })
    ]
  });
  ctx.savingsAccounts['Livret A'] = 60;
  input('transType', 'transfer');
  input('transferSavingsTarget', 'Livret A');
  const oldTransactions = JSON.stringify(ctx.transactions);
  const pastBefore = auditOverview(ctx, '2026-09');
  assert.equal(save({ date: '2026-11-10', month: '2026-11', projected: true,
    scope: 'all', amount: 45 }).type, 'success');
  ctx.generateRecurringOccurrences();
  assert.equal(ctx.savingsAccounts['Livret A'], 60);
  assert.equal(JSON.stringify(ctx.transactions), oldTransactions);
  assert.deepEqual(auditOverview(ctx, '2026-09').current, pastBefore.current);
  assert.equal(auditOverview(ctx, '2026-10').forecasts[1].changeMinor, -4500);
});

test('audit : Changer le tarif à partir de novembre ne réécrit pas les paiements passés', () => {
  const { ctx, input } = env({ transactions: [
    tx('sept', '2026-09-10', 50), tx('oct', '2026-10-10', 50)
  ] });
  vm.runInContext(recurringTariffCode, ctx);
  ctx.document.querySelectorAll = () => [];
  input('recurringTariffRuleId', 'r1');
  input('recurringTariffAmount', '85');
  input('recurringTariffCurrency', 'EUR');
  input('recurringTariffEffectiveDate', '2026-11-01');
  input('recurringTariffFxRate', '');
  ctx.__scope = 'future';
  const pastTransactions = JSON.stringify(ctx.transactions);
  const septemberBefore = auditOverview(ctx, '2026-09');
  const octoberBefore = auditOverview(ctx, '2026-10');
  ctx.saveRecurringTariff({ preventDefault() {} });
  ctx.generateRecurringOccurrences();
  assert.equal(JSON.stringify(ctx.transactions), pastTransactions);
  assert.deepEqual(auditOverview(ctx, '2026-09').current, septemberBefore.current);
  const octoberAfter = auditOverview(ctx, '2026-10');
  assert.deepEqual(octoberAfter.current, octoberBefore.current);
  assert.equal(octoberAfter.startingBalance, octoberBefore.startingBalance);
  assert.equal(octoberAfter.forecasts[1].expensesMinor, 8500);
  assert.equal(octoberAfter.forecasts[2].expensesMinor, 8500);
});

test('audit : modifier une transaction de novembre préserve les montants des mois passés', async () => {
  const { ctx, input } = env({ rules: [], transactions: [
    { id: 'sept', date: '2026-09-10', type: 'expense', amountBase: 40, category: 'Courses' },
    { id: 'oct', date: '2026-10-10', type: 'income', amountBase: 100, category: 'Salaire' },
    { id: 'nov', date: '2026-11-10', type: 'expense', amountBase: 20, category: 'Courses' }
  ] });
  const oldTransactions = JSON.stringify(ctx.transactions.filter(item => item.date < '2026-11-01'));
  const pastBefore = auditOverview(ctx, '2026-09');
  const octoberBefore = auditOverview(ctx, '2026-10');
  input('isRecurring').checked = false;
  input('editId', 'nov');
  input('transAmount', '80');
  input('transDate', '2026-11-15');
  // Le journal d'apprentissage charge un module navigateur ; il est hors du
  // périmètre de ce test VM consacré aux écritures et aux soldes.
  vm.runInContext('rememberConfirmedTransactionCorrection = async () => {};', ctx);
  await ctx.saveTransaction({ preventDefault() {} });
  assert.equal(JSON.stringify(ctx.transactions.filter(item => item.date < '2026-11-01')), oldTransactions);
  assert.deepEqual(auditOverview(ctx, '2026-09').current, pastBefore.current);
  const octoberAfter = auditOverview(ctx, '2026-10');
  assert.deepEqual(octoberAfter.current, octoberBefore.current);
  assert.equal(octoberAfter.startingBalance, octoberBefore.startingBalance);
  assert.equal(octoberAfter.forecasts[1].expensesMinor, 8000);
});

test('une modification sur septembre ne modifie ni août ni octobre ni novembre', () => {
  const { ctx, save } = env({ transactions: [tx('aout', '2026-08-10'), tx('sept', '2026-09-10'), tx('oct', '2026-10-10')] });
  assert.equal(save({ date: '2026-09-12' }).type, 'success');
  const sept = ctx.transactions.find(t => t.id === 'sept');
  assert.equal(sept.amountBase, 80);
  assert.equal(sept.date, '2026-09-12');
  assert.equal(sept._manuallyEdited, true);
  assert.equal(sept.periodKey, '2026-09');
  assert.equal(ctx.transactions.find(t => t.id === 'aout').amountBase, 50);
  assert.equal(ctx.transactions.find(t => t.id === 'oct').amountBase, 50);
  assert.equal(ctx.recurringTransactions[0].amountBase, 50);
  assert.equal(ctx.getProjectedRecurringTransactions('2026-11')[0].amountBase, 50);
  ctx.generateRecurringOccurrences();
  assert.equal(ctx.transactions.filter(t => t.periodKey === '2026-09').length, 1);
  assert.equal(ctx.transactions.find(t => t.id === 'sept').amountBase, 80);
});

test('une saisie avec virgule décimale est enregistrée au centime exact', () => {
  const { ctx, save } = env({ transactions: [tx('sept', '2026-09-10')] });
  assert.equal(save({ amount: '80,12' }).type, 'success');
  assert.equal(ctx.transactions.find(t => t.id === 'sept').amountBase, 80.12);
  assert.equal(ctx.recurringTransactions[0].amountBase, 50);
});

test('modifier un mois futur matérialise seulement cette exception, visible parmi les échéances', () => {
  const { ctx, save } = env({ transactions: [tx('oct', '2026-10-10')] });
  assert.equal(ctx.getProjectedRecurringTransactions('2026-11').length, 1);
  assert.equal(save({ date: '2026-11-15', month: '2026-11', projected: true }).type, 'success');
  // La date originale de l'occurrence est le 10 du mois, ce qui permet
  // de retrouver l'échéance projetée sans modifier la règle.
  const november = ctx.transactions.find(t => t.periodKey === '2026-11');
  assert.equal(november.amountBase, 80);
  assert.equal(november.date, '2026-11-15');
  assert.equal(ctx.getProjectedRecurringTransactions('2026-11').length, 0);
  assert.equal(ctx.getProjectedRecurringTransactions('2026-12')[0].amountBase, 50);
  assert.equal(ctx.getNextRecurringDate(ctx.recurringTransactions[0], '2026-11-01'), '2026-11-15');
  assert.ok(ctx.getUpcomingRecurringOccurrences(30).some(t => t.periodKey === '2026-11' && t.amountBase === 80));
  ctx.generateRecurringOccurrences();
  assert.equal(ctx.transactions.filter(t => t.periodKey === '2026-11').length, 1);
});

test('changer une occurrence de période est refusé sans toucher les comptes', () => {
  const { ctx, save } = env({ transactions: [tx('sept', '2026-09-10')] });
  assert.equal(save({ date: '2026-10-03' }).type, 'error');
  assert.equal(ctx.transactions[0].date, '2026-09-10');
  assert.equal(ctx.transactions[0].amountBase, 50);
  assert.equal(ctx.recurringTransactions[0].amountBase, 50);
});

test('modifier toute la série depuis novembre préserve janvier et les anciens mois', () => {
  const { ctx, save } = env({ transactions: [tx('sept', '2026-09-12', 80, { _manuallyEdited: true }), tx('oct', '2026-10-10')] });
  assert.equal(save({ date: '2026-11-15', month: '2026-11', projected: true, scope: 'all', amount: 70 }).type, 'success');
  assert.equal(ctx.recurringTransactions[0].startDate, '2026-01-10');
  assert.equal(ctx.recurringTransactions[0].dayOfMonth, 15);
  assert.equal(ctx.recurringTransactions[0].amountBase, 70);
  assert.equal(ctx.transactions.find(t => t.id === 'sept').amountBase, 80);
  assert.equal(ctx.transactions.find(t => t.id === 'oct').amountBase, 50);
  assert.equal(ctx.getProjectedRecurringTransactions('2026-12')[0].date, '2026-12-15');
});

test('éditer la série ne recrée pas les mois historiques absents au nouveau tarif', () => {
  const { ctx, save } = env({ transactions: [tx('oct', '2026-10-10')] });
  assert.equal(save({ date: '2026-10-10', month: '2026-10', id: 'oct', scope: 'all', amount: 99 }).type, 'success');
  assert.equal(ctx.transactions.filter(t => t.date < '2026-10-01').length, 0);
  assert.equal(ctx.transactions.find(t => t.id === 'oct').amountBase, 50);
  assert.equal(ctx.getProjectedRecurringTransactions('2026-11')[0].amountBase, 99);
});

test('une occurrence sans periodKey dans une ancienne sauvegarde ne se duplique pas', () => {
  const { ctx } = env({ transactions: [{ ...tx('oct', '2026-10-10'), periodKey: undefined }] });
  ctx.generateRecurringOccurrences('2026-10', 0, 0);
  assert.equal(ctx.transactions.filter(t => t.date === '2026-10-10').length, 1);
  assert.equal(ctx.transactions[0].periodKey, '2026-10');
});

test('modifier un transfert récurrent déjà payé ajuste une seule fois l’épargne', () => {
  const { ctx, save, input } = env({
    rule: { id: 'r1', frequency: 'monthly', startDate: '2026-01-10', dayOfMonth: 10,
      type: 'transfer', amount: 30, amountBase: 30, desc: 'Épargne', category: 'Épargne' },
    transactions: [tx('oct', '2026-10-10', 30, { type: 'transfer', transferTarget: 'Livret A', _effectsApplied: true })]
  });
  ctx.savingsAccounts['Livret A'] = 30;
  input('transType', 'transfer');
  input('transferSavingsTarget', 'Livret A');
  save({ date: '2026-10-10', month: '2026-10', id: 'oct', amount: 45 });
  assert.equal(ctx.savingsAccounts['Livret A'], 45);
  assert.equal(ctx.transactions.find(t => t.id === 'oct').amountBase, 45);
  ctx.generateRecurringOccurrences('2026-10', 0, 0);
  assert.equal(ctx.savingsAccounts['Livret A'], 45);
});

test('une exception hebdomadaire ne modifie pas les autres semaines du même mois', () => {
  const { ctx } = env({ rule: { id: 'r1', frequency: 'weekly', startDate: '2026-10-07',
    type: 'expense', amountBase: 25, desc: 'Courses' } });
  const dates = ctx.recurringDatesForMonth(ctx.recurringTransactions[0], '2026-10');
  assert.ok(dates.length >= 3);
  ctx.generateRecurringOccurrences('2026-10', 0, 0);
  const target = ctx.transactions.find(t => t.date === '2026-10-14');
  assert.ok(target);
  assert.equal(ctx.applySingleRecurringOccurrenceChange(ctx.recurringTransactions[0], target.id, target.periodKey,
    '2026-10-14', { date: '2026-10-15', type: 'expense', amountBase: 80, originalAmount: 80, category: 'Courses', desc: 'Exception' }), true);
  assert.equal(ctx.transactions.find(t => t.date === '2026-10-07').amountBase, 25);
  assert.equal(ctx.transactions.find(t => t.date === '2026-10-15').amountBase, 80);
  assert.equal(ctx.transactions.find(t => t.date === '2026-10-21').amountBase, 25);
});

test('le 29 février conserve sa règle annuelle quand une année reçoit une exception', () => {
  const { ctx } = env({ rule: { id: 'r1', frequency: 'yearly', startDate: '2024-02-29',
    type: 'expense', amountBase: 100, desc: 'Assurance' } });
  assert.deepEqual([...ctx.recurringDatesForMonth(ctx.recurringTransactions[0], '2025-02')], ['2025-02-28']);
  assert.deepEqual([...ctx.recurringDatesForMonth(ctx.recurringTransactions[0], '2026-02')], ['2026-02-28']);
  const key = ctx.periodKey('2025-02-28', 'yearly');
  assert.equal(ctx.applySingleRecurringOccurrenceChange(ctx.recurringTransactions[0], '', key, '2025-02-28', {
    date: '2025-02-27', type: 'expense', amountBase: 150, originalAmount: 150, category: 'Assurance', desc: 'Exception'
  }, { authorizeArchivedMonth: true }), true);
  assert.equal(ctx.transactions.length, 1);
  assert.equal(ctx.transactions[0].amountBase, 150);
  assert.equal(ctx.recurringDatesForMonth(ctx.recurringTransactions[0], '2026-02')[0], '2026-02-28');
});


test('ignorer septembre n’annule aucune échéance des autres mois', () => {
  const { ctx } = env({ transactions: [tx('oct', '2026-10-10')] });
  const rule = ctx.recurringTransactions[0];
  assert.equal(ctx.addRecurringSkippedPeriod(rule, '2026-11'), true);
  assert.equal(ctx.getProjectedRecurringTransactions('2026-11').length, 0);
  assert.equal(ctx.getProjectedRecurringTransactions('2026-12').length, 1);
  assert.equal(ctx.getProjectedRecurringTransactions('2027-01').length, 1);
  assert.equal(ctx.removeRecurringSkippedPeriod(rule, '2026-11'), true);
  assert.equal(ctx.getProjectedRecurringTransactions('2026-11').length, 1);
});

test('une échéance au 31 s’adapte à février sans modifier le rythme de mars', () => {
  const { ctx } = env({ rule: { id: 'r1', type: 'expense', frequency: 'monthly',
    startDate: '2026-01-31', dayOfMonth: 31, amountBase: 50 } });
  assert.deepEqual([...ctx.recurringDatesForMonth(ctx.recurringTransactions[0], '2027-02')], ['2027-02-28']);
  assert.deepEqual([...ctx.recurringDatesForMonth(ctx.recurringTransactions[0], '2027-03')], ['2027-03-31']);
  assert.equal(ctx.applySingleRecurringOccurrenceChange(ctx.recurringTransactions[0], '', '2027-02', '2027-02-28', {
    date: '2027-02-27', type: 'expense', amountBase: 42, originalAmount: 42, category: 'Abonnements', desc: 'Exception'
  }), true);
  assert.equal(ctx.recurringDatesForMonth(ctx.recurringTransactions[0], '2027-03')[0], '2027-03-31');
  assert.equal(ctx.getProjectedRecurringTransactions('2027-03')[0].amountBase, 50);
});

test('indexer les échéances garde la même prochaine date que la recherche historique', () => {
  const { ctx } = env({ transactions: [
    tx('oct', '2026-10-10', 50), tx('nov', '2026-11-15', 80, { _manuallyEdited: true }),
    tx('ancien', '2026-09-10', 50)
  ] });
  const rule = ctx.recurringTransactions[0];
  const periods = new Map(ctx.transactions.map(item => [item.periodKey, item]));
  for (const date of ['2026-10-22', '2026-11-01', '2026-11-16', '2026-12-01']) {
    assert.equal(ctx.getNextRecurringDate(rule, date, 36, periods), ctx.getNextRecurringDate(rule, date));
  }
});


test('une modification de série ne régénère pas les trous historiques au nouveau prix au redémarrage', () => {
  const { ctx, save } = env({ transactions: [tx('oct', '2026-10-10')] });
  assert.equal(save({ date: '2026-10-10', month: '2026-10', id: 'oct', scope: 'all', amount: 99 }).type, 'success');
  assert.equal(ctx.recurringTransactions[0].historicalBackfillThrough, '2026-10-21');
  ctx.generateRecurringOccurrences(); // simulation d'un redémarrage de l'application
  assert.equal(ctx.transactions.filter(t => t.date < '2026-10-01').length, 0);
  assert.equal(ctx.transactions.find(t => t.id === 'oct').amountBase, 50);
  assert.equal(ctx.getProjectedRecurringTransactions('2026-11')[0].amountBase, 99);
});

test('régénération au démarrage : les anciens mois vides restent gelés', () => {
  const { ctx } = env({ transactions: [] });
  ctx.generateRecurringOccurrences('2026-10', 12, 0);
  assert.equal(ctx.transactions.filter(t => t.date < '2026-10-01').length, 0);
  assert.equal(ctx.transactions.find(t => t.date === '2026-10-10').amountBase, 50);
});

test('les doublons récurrents aux effets financiers distincts ne sont pas supprimés silencieusement', () => {
  const { ctx } = env({ rule: { id: 'r1', type: 'transfer', frequency: 'monthly', startDate: '2026-01-10',
      dayOfMonth: 10, amountBase: 50 }, transactions: [
      tx('transferA', '2026-10-10', 50, { type: 'transfer', _effectsApplied: true }),
      tx('transferB', '2026-10-10', 50, { type: 'transfer', _effectsApplied: true })
    ] });
  ctx.dedupeRecurringOccurrences();
  assert.equal(ctx.transactions.length, 2);
});

test('une transaction saisie avec une date impossible est rejetée', () => {
  const { ctx, input, notifications } = env({ transactions: [] });
  input('isRecurring').checked = false;
  input('editId', '');
  input('transDate', '2026-02-31');
  ctx.saveTransaction({ preventDefault() {} });
  assert.equal(notifications.at(-1).type, 'error');
  assert.equal(ctx.transactions.length, 0);
});

test('une conversion monétaire non finie est rejetée avant écriture', () => {
  const { ctx, input, notifications } = env({ transactions: [] });
  input('isRecurring').checked = false;
  input('transCurrency', 'USD');
  input('transAmount', '1000000000000');
  input('transFxRate', '1000000000000');
  ctx.saveTransaction({ preventDefault() {} });
  assert.equal(notifications.at(-1).type, 'error');
  assert.equal(ctx.transactions.length, 0);
});

test('modifier octobre uniquement plusieurs fois garde septembre, novembre et décembre à leur tarif initial', () => {
  const { ctx, save, confirms } = env({ transactions: [
    tx('sept', '2026-09-10', 50), tx('oct', '2026-10-10', 50)] });
  assert.equal(save({ date: '2026-10-12', month: '2026-10', id: 'oct', amount: 80 }).type, 'success');
  assert.equal(save({ date: '2026-10-14', month: '2026-10', id: 'oct', amount: 92 }).type, 'success');
  assert.equal(ctx.transactions.filter(t => t.periodKey === '2026-10').length, 1);
  assert.equal(ctx.transactions.find(t => t.id === 'oct').amountBase, 92);
  assert.equal(ctx.transactions.find(t => t.id === 'sept').amountBase, 50);
  assert.equal(ctx.getProjectedRecurringTransactions('2026-11')[0].amountBase, 50);
  assert.equal(ctx.getProjectedRecurringTransactions('2026-12')[0].amountBase, 50);
  assert.equal(ctx.recurringTransactions[0].amountBase, 50);
  assert.equal(confirms.length, 0, 'Mois courant : aucune validation historique nécessaire');
  ctx.generateRecurringOccurrences('2026-10', 1, 2);
  assert.equal(ctx.transactions.find(t => t.id === 'oct').amountBase, 92);
});

test('première confirmation refusée : aucun changement sur un mois passé', () => {
  const { ctx, save, confirms } = env({ transactions: [tx('sept', '2026-09-10')], confirmAnswers: [false] });
  save({ date: '2026-09-12' });
  assert.equal(confirms.length, 1);
  assert.equal(ctx.transactions.find(t => t.id === 'sept').amountBase, 50);
  assert.equal(ctx.recurringTransactions[0].amountBase, 50);
});

test('deuxième confirmation refusée : ancien mois et autres mois intacts', () => {
  const { ctx, save, confirms } = env({ transactions: [tx('sept', '2026-09-10'), tx('oct','2026-10-10')],
    confirmAnswers: [true, false] });
  save({ date: '2026-09-12' });
  assert.equal(confirms.length, 2);
  assert.equal(ctx.transactions.find(t => t.id === 'sept').amountBase, 50);
  assert.equal(ctx.transactions.find(t => t.id === 'oct').amountBase, 50);
});

test('deux confirmations accordées : seul septembre est changé', () => {
  const { ctx, save, confirms } = env({ transactions: [tx('aout', '2026-08-10'), tx('sept', '2026-09-10'), tx('oct', '2026-10-10')],
    confirmAnswers: [true, true] });
  assert.equal(save({ date: '2026-09-12' }).type, 'success');
  assert.equal(confirms.length, 2);
  assert.equal(ctx.transactions.find(t => t.id === 'sept').amountBase, 80);
  assert.equal(ctx.transactions.find(t => t.id === 'aout').amountBase, 50);
  assert.equal(ctx.transactions.find(t => t.id === 'oct').amountBase, 50);
  assert.equal(ctx.getProjectedRecurringTransactions('2026-11')[0].amountBase, 50);
});

test('moteur : modification historique directe sans autorisation interdite', () => {
  const { ctx } = env({ transactions: [tx('sept', '2026-09-10')] });
  const rule = ctx.recurringTransactions[0];
  const change = { date: '2026-09-11', type: 'expense', category: 'Abonnements',
    amountBase: 100, originalAmount: 100, desc: 'Tarif exceptionnel' };
  assert.equal(ctx.applySingleRecurringOccurrenceChange(rule, 'sept', '2026-09', '2026-09-10', change), false);
  assert.equal(ctx.transactions.find(t => t.id === 'sept').amountBase, 50);
  assert.equal(ctx.applySingleRecurringOccurrenceChange(rule, 'sept', '2026-09', '2026-09-10', change,
    { authorizeArchivedMonth: true }), true);
  assert.equal(ctx.transactions.find(t => t.id === 'sept').amountBase, 100);
});

test('moteur : un ID périmé ne peut modifier une autre échéance du même abonnement', () => {
  const { ctx } = env({ transactions: [tx('sept', '2026-09-10'), tx('oct','2026-10-10')] });
  const before = JSON.stringify(ctx.transactions);
  assert.equal(ctx.applySingleRecurringOccurrenceChange(ctx.recurringTransactions[0], 'sept', '2026-10', '2026-10-10', {
    date: '2026-10-15', type: 'expense', amountBase: 80, originalAmount: 80, category: 'Abonnements'
  }), false);
  assert.equal(JSON.stringify(ctx.transactions), before);
});

test('liste récurrences : ouvrir ce mois sélectionne son occurrence (et non toute la série)', () => {
  const { ctx } = env({ transactions: [tx('sept', '2026-09-10'), tx('oct','2026-10-10')] });
  let selected = null;
  ctx.openRecurringRuleModal = (rule, occurrence) => { selected = { rule, occurrence }; };
  assert.equal(ctx.openRecurringCurrentMonthModal('r1'), true);
  assert.equal(selected.occurrence.id, 'oct');
  assert.equal(selected.occurrence.periodKey, '2026-10');
  assert.equal(selected.rule.amountBase, 50);
});

test('liste récurrences : échéance non matérialisée ciblée sur le mois, sans écriture avant validation', () => {
  const { ctx } = env({ transactions: [] });
  let selected = null;
  ctx.openRecurringRuleModal = (_, occurrence) => { selected = occurrence; };
  assert.equal(ctx.openRecurringCurrentMonthModal('r1'), true);
  assert.equal(selected.projected, true);
  assert.equal(selected.periodKey, '2026-10');
  assert.equal(ctx.transactions.length, 0);
});

test('liste récurrences : récurrence hebdomadaire demande de choisir sa semaine', () => {
  const { ctx, notifications } = env({ rule: { id: 'r1', frequency: 'weekly', type: 'expense',
    startDate: '2026-10-07', amountBase: 20 } });
  assert.equal(ctx.openRecurringCurrentMonthModal('r1'), false);
  assert.equal(notifications.at(-1).type, 'info');
});

test('échéance ignorée : ne peut pas être modifiée silencieusement', () => {
  const { ctx, save } = env({ transactions: [] });
  ctx.recurringTransactions[0].skippedPeriods = ['2026-10'];
  assert.equal(save({ date: '2026-10-12', month: '2026-10', projected: true }).type, 'error');
  assert.equal(ctx.transactions.length, 0);
});

test('ignorer une ancienne occurrence est soumis à une double confirmation', () => {
  const { ctx, confirms } = env({ transactions: [tx('sept', '2026-09-10')], confirmAnswers: [true, false] });
  assert.equal(ctx.skipRecurringOccurrenceById('sept'), false);
  assert.equal(confirms.length, 2);
  assert.equal(ctx.transactions.length, 1);
  assert.equal(ctx.recurringTransactions[0].skippedPeriods.length, 0);
});

test('nouvelle récurrence antidatée : aucun ancien mois rempli sans confirmation spécifique', () => {
  const { ctx, input } = env({ rules: [], transactions: [] });
  input('editId', '');
  input('transDate', '2026-01-10');
  input('recurFreq', 'monthly');
  ctx.__scope = 'all';
  ctx.saveTransaction({ preventDefault() {} });
  assert.equal(ctx.recurringTransactions.length, 1);
  assert.equal(ctx.recurringTransactions[0].startDate, '2026-01-10');
  assert.equal(ctx.recurringTransactions[0].historicalBackfillThrough, '2026-09-30');
  assert.equal(ctx.transactions.filter(t => t.date < '2026-10-01').length, 0);
  assert.equal(ctx.transactions.find(t => t.date === '2026-10-10')?.amountBase, 50);
});

test('modifier la règle ciblée ne régénère pas les opérations futures d’une autre règle', () => {
  const { ctx, save } = env({ transactions: [
    tx('oct', '2026-10-10'),
    { id: 'other-future', parentId: 'r2', periodKey: '2026-11', date: '2026-11-08',
      amountBase: 75, type: 'expense', source: 'recurring' }
  ] });
  ctx.recurringTransactions.push({ id: 'r2', frequency: 'monthly', type: 'expense',
    startDate: '2026-01-08', dayOfMonth: 8, amountBase: 75, desc: 'Autre abonnement' });
  assert.equal(save({ date: '2026-10-10', month: '2026-10', id: 'oct', scope: 'all', amount: 65 }).type, 'success');
  assert.equal(ctx.transactions.find(t => t.id === 'other-future')?.amountBase, 75);
});

test('passage décembre-janvier : exception de décembre sans modifier janvier', () => {
  const { ctx } = env({ transactions: [tx('dec', '2025-12-10', 50), tx('oct', '2026-10-10', 50)] });
  const rule = ctx.recurringTransactions[0];
  assert.equal(ctx.applySingleRecurringOccurrenceChange(rule, 'dec', '2025-12', '2025-12-10', {
    date: '2025-12-15', type: 'expense', category: 'Abonnements', amountBase: 70, originalAmount: 70
  }, { authorizeArchivedMonth: true }), true);
  assert.equal(ctx.transactions.find(t => t.id === 'dec').periodKey, '2025-12');
  assert.equal(ctx.transactions.find(t => t.id === 'dec').amountBase, 70);
  assert.equal(ctx.recurringDatesForMonth(rule, '2026-01')[0], '2026-01-10');
  assert.equal(ctx.recurringDatesForMonth(rule, '2027-01')[0], '2027-01-10');
  assert.equal(ctx.getProjectedRecurringTransactions('2027-01')[0].amountBase, 50);
});

test('transaction de sauvegarde héritée sans periodKey : édition conservée sans doublon', () => {
  const { ctx, save } = env({ transactions: [tx('oct', '2026-10-10', 50, { periodKey: undefined })] });
  assert.equal(save({ date: '2026-10-11', month: '2026-10', id: 'oct' }).type, 'success');
  assert.equal(ctx.transactions.length, 1);
  assert.equal(ctx.transactions[0].periodKey, '2026-10');
  assert.equal(ctx.transactions[0].amountBase, 80);
});

test('une exception future personnalisée survit à la modification du mois courant', () => {
  const { ctx, save } = env({ transactions: [
    tx('oct', '2026-10-10'),
    tx('nov-custom', '2026-11-15', 63, { periodKey: '2026-11', _manuallyEdited: true, desc: 'Prévision personnalisée' })
  ] });
  assert.equal(save({ month: '2026-10', date: '2026-10-12', id: 'oct', amount: 99 }).type, 'success');
  assert.equal(ctx.transactions.find(t => t.id === 'nov-custom')?.amountBase, 63);
  assert.equal(ctx.transactions.find(t => t.id === 'nov-custom')?.date, '2026-11-15');
  assert.equal(ctx.getProjectedRecurringTransactions('2026-12')[0].amountBase, 50);
});

test('rétablir une échéance ignorée d’un mois passé demande exactement deux confirmations', () => {
  const { ctx, confirms } = env({ transactions: [], confirmAnswers: [true, false] });
  ctx.recurringTransactions[0].skippedPeriods = ['2026-09'];
  ctx.restoreSkippedRecurringPeriods('r1');
  assert.equal(confirms.length, 2);
  assert.deepEqual([...ctx.recurringTransactions[0].skippedPeriods], ['2026-09']);
  assert.equal(ctx.transactions.length, 0);
});

test('supprimer une règle avec des occurrences historiques requiert deux validations', () => {
  const { ctx, confirms } = env({ transactions: [tx('sept', '2026-09-10')], confirmAnswers: [true, false] });
  ctx.deleteRecurring('r1');
  assert.equal(confirms.length, 2);
  assert.equal(ctx.recurringTransactions.length, 1);
  assert.equal(ctx.transactions.length, 1);
});

test('une annuité de février de l’année en cours est historique dès mars', () => {
  const { ctx, confirms } = env({ rule: { id: 'r1', frequency: 'yearly', type: 'expense',
    startDate: '2024-02-29', amountBase: 90, skippedPeriods: ['2026'] }, confirmAnswers: [true, false] });
  ctx.restoreSkippedRecurringPeriods('r1');
  assert.equal(confirms.length, 2);
  assert.deepEqual([...ctx.recurringTransactions[0].skippedPeriods], ['2026']);
});

test('ignorer puis restaurer un ancien mois conserve le montant original même si la règle change', () => {
  const { ctx } = env({ transactions: [tx('sept', '2026-09-10', 80, { _manuallyEdited: true })] });
  assert.equal(ctx.skipRecurringOccurrenceById('sept'), true);
  assert.equal(ctx.transactions.length, 0);
  assert.equal(ctx.recurringTransactions[0].skippedOccurrenceBackups['2026-09'].amountBase, 80);
  ctx.recurringTransactions[0].amountBase = 120;
  ctx.recurringTransactions[0].historicalBackfillThrough = '2026-10-21';
  ctx.restoreSkippedRecurringPeriods('r1');
  assert.equal(ctx.transactions.length, 1);
  assert.equal(ctx.transactions[0].id, 'sept');
  assert.equal(ctx.transactions[0].amountBase, 80);
  assert.deepEqual([...ctx.recurringTransactions[0].skippedPeriods], []);
  assert.equal(ctx.transactions.filter(t => t.date < '2026-09-01').length, 0);
});

test('une restauration historique sans montant fiable est refusée plutôt que reconstruite au mauvais tarif', () => {
  const { ctx, notifications } = env({ transactions: [] });
  ctx.recurringTransactions[0].skippedPeriods = ['2026-09'];
  ctx.recurringTransactions[0].historicalBackfillThrough = '2026-10-21';
  ctx.restoreSkippedRecurringPeriods('r1');
  assert.deepEqual([...ctx.recurringTransactions[0].skippedPeriods], ['2026-09']);
  assert.equal(ctx.transactions.length, 0);
  assert.equal(notifications.at(-1).type, 'error');
});

test('désactiver la case récurrente depuis une règle ne crée pas une fausse transaction', () => {
  const { ctx, save, input } = env({ transactions: [tx('oct', '2026-10-10')] });
  input('isRecurring').checked = false;
  assert.equal(save({ date: '2026-10-12', month: '2026-10', id: 'oct' }).type, 'error');
  assert.equal(ctx.transactions.length, 1);
  assert.equal(ctx.recurringTransactions.length, 1);
});

test('modifier une série ne supprime pas une autre transaction avec un ID identique', () => {
  const { ctx, save } = env({ transactions: [
    tx('oct', '2026-10-10'),
    { id: 'same-id', parentId: 'r1', periodKey: '2026-11', date: '2026-11-10',
      amountBase: 50, type: 'expense', source: 'recurring' },
    { id: 'same-id', parentId: 'r2', periodKey: '2026-11', date: '2026-11-11',
      amountBase: 33, type: 'expense', source: 'recurring' }
  ] });
  ctx.recurringTransactions.push({ id: 'r2', frequency: 'monthly', startDate: '2026-01-11',
    dayOfMonth: 11, type: 'expense', amountBase: 33 });
  assert.equal(save({ date: '2026-10-10', month: '2026-10', id: 'oct', scope: 'all', amount: 75 }).type, 'success');
  assert.equal(ctx.transactions.find(t => t.id === 'same-id' && t.parentId === 'r2')?.amountBase, 33);
});

test('deux occurrences stockées dans le même mois ne sont pas modifiées arbitrairement', () => {
  const { ctx, notifications } = env({ transactions: [
    tx('oct-a', '2026-10-10'), tx('oct-b', '2026-10-10')
  ] });
  assert.equal(ctx.openRecurringCurrentMonthModal('r1'), false);
  assert.equal(notifications.at(-1).type, 'error');
  assert.equal(ctx.transactions.length, 2);
});

test('supprimer une échéance passée après refus de la deuxième confirmation ne contourne pas le verrou', () => {
  const { ctx, confirms } = env({ transactions: [tx('sept', '2026-09-10')], confirmAnswers: [true, false] });
  ctx.deleteTransaction('sept');
  assert.equal(confirms.length, 2);
  assert.equal(ctx.transactions.length, 1);
  assert.equal(ctx.transactions[0].id, 'sept');
  assert.deepEqual([...ctx.recurringTransactions[0].skippedPeriods], []);
});
