// Stress test du vrai moteur financier sur un compte virtuel de très grande taille.
// Les lignes sont générées à la demande : le test mesure les parcours de calcul
// sans tenter de matérialiser un milliard d'objets en mémoire.
// Usage : node scripts/stress-finance-1b-stream.mjs [--count=1000000000]
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { financeOverview } from '../assets/js/finance-priority2-engine.mjs';

const CYCLE = 1_000_000;
const countArg = process.argv.find(value => value.startsWith('--count='))?.slice('--count='.length);
const count = countArg === undefined ? 1_000_000_000 : Number(countArg);
if (!Number.isSafeInteger(count) || count < CYCLE || count > 1_000_000_000 || count % CYCLE !== 0) {
  throw new RangeError(`Le nombre doit être un multiple de ${CYCLE}, entre ${CYCLE} et 1 000 000 000.`);
}

const today = '2026-10-22';
const month = '2026-10';
const initialCapital = 1_000_000_000;
const cycles = count / CYCLE;
const common = [
  { id:'common-expense-010', date:'2026-10-20', type:'expense', amountBase:0.10, category:'Courses', desc:'Achat courant' },
  { id:'common-expense-125', date:'2026-10-20', type:'expense', amountBase:1.25, category:'Courses', desc:'Achat courant' },
  { id:'common-income-050', date:'2026-10-20', type:'income', amountBase:0.50, category:'Salaire', desc:'Revenu courant' },
  { id:'common-income-225', date:'2026-10-20', type:'income', amountBase:2.25, category:'Salaire', desc:'Revenu courant' },
  { id:'common-withdrawal-025', date:'2026-10-20', type:'savings_withdrawal', amountBase:0.25, category:'Épargne', desc:'Retrait courant' },
  { id:'common-transfer-050', date:'2026-10-20', type:'transfer', amountBase:0.50, category:'Épargne', desc:'Virement courant', transferTarget:'Livret A' },
  { id:'common-expense-375', date:'2026-09-20', type:'expense', amountBase:3.75, category:'Maison', desc:'Achat antérieur' },
  { id:'common-income-150', date:'2026-09-20', type:'income', amountBase:1.50, category:'Salaire', desc:'Revenu antérieur' }
];
const special = [
  { id:'rent-september', date:'2026-09-10', type:'expense', amountBase:50, category:'Logement', desc:'Loyer', parentId:'rent-rule', periodKey:'2026-09' },
  { id:'rent-october', date:'2026-10-10', type:'expense', amountBase:80, category:'Logement', desc:'Loyer', parentId:'rent-rule', periodKey:'2026-10' },
  { id:'planned-october', date:'2026-10-27', type:'expense', amountBase:12.50, category:'Courses', desc:'Dépense prévue', paymentStatus:'planned' },
  { id:'future-income-october', date:'2026-10-28', type:'income', amountBase:23.45, category:'Salaire', desc:'Revenu futur' },
  { id:'duplicate-a', date:'2026-10-18', type:'expense', amountBase:4.56, category:'Courses', desc:'Doublon contrôle A' },
  { id:'duplicate-b', date:'2026-10-18', type:'expense', amountBase:4.56, category:'Courses', desc:'Doublon contrôle A' },
  { id:'transfer-october', date:'2026-10-18', type:'transfer', amountBase:10, category:'Épargne', desc:'Virement vers livret', transferTarget:'Livret A' },
  { id:'withdrawal-october', date:'2026-10-18', type:'savings_withdrawal', amountBase:2.51, category:'Épargne', desc:'Retrait livret' },
  { id:'inter-account-october', date:'2026-10-18', type:'inter_account', amountBase:7.25, category:'Transfert', desc:'Mouvement entre comptes' },
  { id:'ordinary-september', date:'2026-09-15', type:'expense', amountBase:8.20, category:'Maison', desc:'Dépense antérieure' }
];
const transactionAt = index => {
  const slot = index % CYCLE;
  if (slot < special.length) return special[slot];
  return common[(slot - special.length) % common.length];
};
const transactions = new Proxy([], {
  get(target, property, receiver) {
    if (property === 'length') return count;
    if (property === Symbol.iterator) return function* () {
      for (let index = 0; index < count; index += 1) yield transactionAt(index);
    };
    if (typeof property === 'string' && /^(0|[1-9]\d*)$/.test(property)) {
      const index = Number(property);
      return index < count ? transactionAt(index) : undefined;
    }
    return Reflect.get(target, property, receiver);
  }
});

const recurringTransactions = [
  { id:'rent-rule', startDate:'2026-01-10', dayOfMonth:10, frequency:'monthly', type:'expense', amountBase:30,
    category:'Logement', desc:'Loyer', rateVersions:[{ effectiveFrom:'2026-12-01', amountBase:35 }] },
  { id:'savings-rule', startDate:'2026-01-26', dayOfMonth:26, frequency:'monthly', type:'transfer', amountBase:10,
    category:'Épargne', desc:'Virement automatique vers Livret A', transferTarget:'Livret A' }
];
const account = { id:'stress-one-account', name:'Compte unique — stress 1 milliard', settings:{baseCurrency:'EUR'},
  initialCapital, budgetsByCategory:{Courses:100_000 * cycles}, transactions, recurringTransactions };

// Oracle indépendant, calculé sur une seule période répétée puis multiplié.
const expected = {
  bookedDeltaMinor:0,
  currentIncomeMinor:0, currentExpensesMinor:0, currentTransfersMinor:0,
  currentPaidCount:0, currentPlannedCount:0,
  previousIncomeMinor:0, previousExpensesMinor:0, previousTransfersMinor:0,
  previousPaidCount:0, futureChangesMinor:{'2026-10':0,'2026-11':0,'2026-12':0},
  futureItemCount:0
};
const minor = tx => Math.round(tx.amountBase * 100);
for (let index = 0; index < CYCLE; index += 1) {
  const tx = transactionAt(index);
  const value = minor(tx);
  const paid = tx.paymentStatus !== 'planned';
  const isFuture = tx.date > today || !paid;
  if (paid && tx.date <= today) expected.bookedDeltaMinor += tx.type === 'income' ? value : -value;
  if (tx.date.slice(0, 7) === month) {
    if (!paid || tx.date > today) expected.currentPlannedCount += 1;
    else {
      expected.currentPaidCount += 1;
      if (tx.type === 'income') expected.currentIncomeMinor += value;
      else if (tx.type === 'expense' || tx.type === 'savings_withdrawal') expected.currentExpensesMinor += value;
      else expected.currentTransfersMinor += value;
    }
  }
  if (tx.date.slice(0, 7) === '2026-09' && paid && tx.date <= today) {
    expected.previousPaidCount += 1;
    if (tx.type === 'income') expected.previousIncomeMinor += value;
    else if (tx.type === 'expense' || tx.type === 'savings_withdrawal') expected.previousExpensesMinor += value;
    else expected.previousTransfersMinor += value;
  }
  if (isFuture && tx.date <= '2026-12-31') {
    const key = tx.date.slice(0, 7);
    if (key in expected.futureChangesMinor) {
      expected.futureChangesMinor[key] += tx.type === 'income' ? value : -value;
      expected.futureItemCount += 1;
    }
  }
}
for (const key of Object.keys(expected.futureChangesMinor)) {
  expected.futureChangesMinor[key] = expected.futureChangesMinor[key] * cycles;
}
// Échéances des règles récurrentes : elles n’augmentent pas avec le nombre de lignes testées.
expected.futureChangesMinor['2026-10'] -= 1_000; // transfert unique vers le livret
expected.futureChangesMinor['2026-11'] -= 4_000; // loyer révisé + transfert épargne
expected.futureChangesMinor['2026-12'] -= 4_500; // nouveau tarif du loyer + transfert épargne
expected.bookedBalanceMinor = initialCapital * 100 + expected.bookedDeltaMinor * cycles;
for (const key of ['currentIncomeMinor','currentExpensesMinor','currentTransfersMinor','currentPaidCount','currentPlannedCount',
  'previousIncomeMinor','previousExpensesMinor','previousTransfersMinor','previousPaidCount']) expected[key] *= cycles;

const before = process.memoryUsage();
const start = performance.now();
const result = financeOverview([account], { month, today, months:3 });
const calculationMs = performance.now() - start;

assert.equal(result.current.incomeMinor, expected.currentIncomeMinor, 'revenus du mois exacts au centime');
assert.equal(result.current.expensesMinor, expected.currentExpensesMinor, 'dépenses et retraits exacts au centime');
assert.equal(result.current.transfersMinor, expected.currentTransfersMinor, 'transferts exacts au centime');
assert.equal(result.current.paidCount, expected.currentPaidCount, 'nombre d’opérations payées du mois exact');
assert.equal(result.current.plannedCount, expected.currentPlannedCount, 'nombre d’opérations prévues exact');
assert.equal(result.previous.incomeMinor, expected.previousIncomeMinor, 'revenus du mois précédent exacts');
assert.equal(result.previous.expensesMinor, expected.previousExpensesMinor, 'dépenses du mois précédent exactes');
assert.equal(result.previous.transfersMinor, expected.previousTransfersMinor, 'transferts du mois précédent exacts');
assert.equal(result.previous.paidCount, expected.previousPaidCount, 'nombre d’opérations précédentes exact');
assert.equal(Math.round(result.startingBalance * 100), expected.bookedBalanceMinor, 'solde comptabilisé exact au centime');
assert.equal(result.forecasts.length, 3, 'les trois mois prévisionnels sont présents');
assert.equal(result.forecasts[0].items.length, expected.futureItemCount * cycles + 1, 'les échéances futures du mois et le virement épargne sont présents');
let forecastBalance = expected.bookedBalanceMinor;
for (let index = 0; index < result.forecasts.length; index += 1) {
  const forecast = result.forecasts[index];
  const period = forecast.month;
  forecastBalance += expected.futureChangesMinor[period] || 0;
  assert.equal(forecast.balanceMinor, forecastBalance, `solde prévisionnel exact pour ${period}`);
}
assert.ok(result.alerts.some(alert => alert.text.includes('Doublons potentiels')), 'les doublons restent signalés');
assert.ok(result.alerts.some(alert => alert.text.includes('Hausse d’une récurrence')), 'la hausse du tarif récurrent reste signalée');
assert.ok(result.alerts.some(alert => alert.text.includes('Courses')), 'le budget dépassé reste signalé');

const after = process.memoryUsage();
const mib = bytes => +(bytes / 1024 ** 2).toFixed(1);
console.log(JSON.stringify({
  status:'PASS', logicalTransactions:count, accountCount:1,
  materializedTransactions:0, cycleSize:CYCLE, calculationMs:Math.round(calculationMs),
  startingBalanceMinor:expected.bookedBalanceMinor,
  current:{incomeMinor:expected.currentIncomeMinor,expensesMinor:expected.currentExpensesMinor,
    transfersMinor:expected.currentTransfersMinor,paidCount:expected.currentPaidCount,plannedCount:expected.currentPlannedCount},
  forecasts:result.forecasts.map(({month:forecastMonth,balanceMinor,items})=>({month:forecastMonth,balanceMinor,items:items.length})),
  alerts:result.alerts.map(alert=>alert.text),
  heapBeforeMiB:mib(before.heapUsed),heapAfterMiB:mib(after.heapUsed),rssAfterMiB:mib(after.rss),
  checks:['month-totals','previous-month-totals','paid-vs-planned','booked-balance','future-dated-operations',
    'monthly-recurrence-rate-change','savings-transfer-forecast','budget-alert','duplicate-alert','recurring-price-alert']
}, null, 2));
