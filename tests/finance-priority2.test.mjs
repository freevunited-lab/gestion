import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { financeOverview, forecastMonths, monthTotals, categoryBudgets, financeAlerts,
  bookedBalance, canPlanTransaction, validatePaymentStatus, normalizedPaymentStatus } from '../assets/js/finance-priority2-engine.mjs';

const TODAY = '2026-10-21';
const account = (transactions = [], recurringTransactions = [], options = {}) => ({
  id: options.id || 'a1', name: options.name || 'Compte A', initialCapital: options.initialCapital ?? 1000,
  budgetsByCategory: options.budgetsByCategory || {}, transactions, recurringTransactions
});
const tx = (date, amount, type = 'expense', extra = {}) => ({
  id: `${date}-${amount}-${type}`, date, amountBase: amount, type, category: 'Alimentation',
  desc: 'Courses', isRecurring: false, ...extra
});
const rule = (startDate, amount, extra = {}) => ({
  id: 'rule1', startDate, amountBase: amount, type: 'expense', category: 'Abonnements',
  desc: 'Abonnement', frequency: 'monthly', dayOfMonth: Number(startDate.slice(8,10)), ...extra
});
const run = (accounts, overrides = {}) => financeOverview(accounts, { today: TODAY, month: '2026-10', ...overrides });
const captureError = callback => {
  try { callback(); } catch (error) { return error; }
  assert.fail('Le calcul aurait dû refuser les données invalides.');
};

test('les anciennes transactions restent payées par défaut', () => {
  assert.equal(normalizedPaymentStatus(tx('2026-10-18',12)), 'paid');
  assert.equal(monthTotals([account([tx('2026-10-18',12)])], '2026-10', TODAY).expenses, 12);
});
test('un achat prévu ne diminue pas le solde comptabilisé', () => {
  const a = account([tx('2026-10-10', 80, 'expense', { paymentStatus:'planned' })]);
  assert.equal(bookedBalance([a], TODAY),1000);
  assert.equal(run([a]).current.expenses,0);
});
test('le revenu prévu ne gonfle pas le solde comptabilisé', () => {
  const a = account([tx('2026-10-10', 200, 'income', { paymentStatus:'planned' })]);
  assert.equal(bookedBalance([a], TODAY),1000);
  assert.equal(run([a]).current.income,0);
});
test('marquer un achat payé le comptabilise exactement une fois', () => {
  const t = tx('2026-10-10', 80, 'expense', { paymentStatus:'planned' });
  const a = account([t]);
  assert.equal(bookedBalance([a], TODAY),1000);
  t.paymentStatus = 'paid';
  assert.equal(bookedBalance([a], TODAY),920);
  assert.equal(monthTotals([a],'2026-10',TODAY).expenses,80);
});
test('une opération future datée ne diminue pas immédiatement le solde actuel', () => {
  const a = account([tx('2026-10-29',90)]);
  assert.equal(bookedBalance([a],TODAY),1000);
  assert.equal(forecastMonths([a],{today:TODAY})[0].balance,910);
});
test('une opération prévue ancienne reste dans le prévisionnel sans affecter le réalisé', () => {
  const a = account([tx('2026-10-12',65,'expense',{paymentStatus:'planned'})]);
  assert.equal(run([a]).current.expenses,0);
  assert.equal(run([a]).forecasts[0].balance,935);
});
test('une opération prévue ancienne produit une alerte de retard', () => {
  assert.ok(run([account([tx('2026-09-01',65,'expense',{paymentStatus:'planned'})])]).alerts
    .some(item=>item.text.includes('dépassé')));
});
test('une récurrence prévue est intégrée à fin de mois, sans être réellement débitée', () => {
  const a = account([], [rule('2026-01-25',50)]);
  assert.equal(bookedBalance([a],TODAY),1000);
  assert.equal(run([a]).forecasts[0].balance,950);
});
test('un mois récurrent déjà enregistré ne doit pas être prévu deux fois', () => {
  const r = rule('2026-01-25',50);
  const existing = tx('2026-10-25',80,'expense',{id:'octobre',parentId:'rule1',periodKey:'2026-10',category:'Abonnements'});
  const a = account([existing],[r]);
  assert.equal(run([a]).forecasts[0].balance,920);
  assert.equal(run([a]).forecasts[0].items.length,1);
});
test('une exception d’octobre ne change pas le coût de novembre', () => {
  const a = account([tx('2026-10-25',80,'expense',{parentId:'rule1',periodKey:'2026-10'})],[rule('2026-01-25',50)]);
  const forecast=run([a]).forecasts;
  assert.equal(forecast[0].balance,920);
  assert.equal(forecast[1].balance,870);
});
test('les échéances ignorées restent absentes du prévisionnel', () => {
  const a = account([], [rule('2026-01-25',50,{skippedPeriods:['2026-10']})]);
  const forecast=run([a]).forecasts;
  assert.equal(forecast[0].balance,1000);
  assert.equal(forecast[1].balance,950);
});
test('les dépenses déjà payées ce mois restent dans le solde de départ, sans doublon', () => {
  const a=account([tx('2026-10-12',30)], [rule('2026-01-25',50)]);
  assert.equal(run([a]).startingBalance,970);
  assert.equal(run([a]).forecasts[0].balance,920);
});
test('le changement d’année conserve les échéances mensuelles', () => {
  const a=account([], [rule('2026-01-25',50)]);
  const forecast=forecastMonths([a],{today:'2026-12-21',months:3});
  assert.deepEqual(forecast.map(x=>x.month),['2026-12','2027-01','2027-02']);
  assert.deepEqual(forecast.map(x=>x.balance),[950,900,850]);
});
test('une récurrence annuelle ne se répète pas chaque mois', () => {
  const a=account([], [rule('2025-12-28',250,{frequency:'yearly'})]);
  const f=forecastMonths([a],{today:'2026-10-21',months:4});
  assert.deepEqual(f.map(x=>x.balance),[1000,1000,750,750]);
});
test('les récurrences hebdomadaires ont des identifiants de période différents', () => {
  const a=account([], [rule('2026-10-05',20,{frequency:'weekly'})]);
  const f=run([a]).forecasts[0];
  assert.equal(f.items.length,1);
  assert.equal(f.balance,980);
});
test('les devises sont prises au montant déjà converti en monnaie de base', () => {
  const a=account([tx('2026-10-19',11,'expense',{originalAmount:10,amountBase:11,currency:'USD'})]);
  assert.equal(run([a]).current.expenses,11);
});
test('les arrondis au centime restent déterministes', () => {
  const a=account([tx('2026-10-19',0.1),tx('2026-10-20',0.2)]);
  assert.equal(run([a]).current.expenses,0.3);
  assert.equal(run([a]).startingBalance,999.7);
});
test('deux comptes apparaissent ensemble sans fusionner leurs budgets', () => {
  const a=account([tx('2026-10-10',90)],[],{id:'a',budgetsByCategory:{Alimentation:100}});
  const b=account([tx('2026-10-10',200)],[],{id:'b',budgetsByCategory:{Alimentation:150}});
  const model=run([a,b]);
  assert.equal(model.current.expenses,290);
  assert.equal(model.budgets.length,2);
  assert.deepEqual(model.budgets.map(x=>x.accountId),['b','a']);
});
test('80 % de budget déclenche une alerte prudente', () => {
  const a=account([tx('2026-10-10',80)],[],{budgetsByCategory:{Alimentation:100}});
  assert.equal(categoryBudgets([a],'2026-10',TODAY)[0].level,'warning');
  assert.ok(run([a]).alerts.some(x=>x.text.includes('Alimentation')));
});
test('budget dépassé : niveau danger et restant négatif', () => {
  const a=account([tx('2026-10-10',110)],[],{budgetsByCategory:{Alimentation:100}});
  const item=categoryBudgets([a],'2026-10',TODAY)[0];
  assert.equal(item.level,'danger');assert.equal(item.remaining,-10);
});
test('une dépense prévue ne déclenche pas de faux dépassement du budget réalisé', () => {
  const a=account([tx('2026-10-10',150,'expense',{paymentStatus:'planned'})],[],{budgetsByCategory:{Alimentation:100}});
  assert.equal(categoryBudgets([a],'2026-10',TODAY)[0].spent,0);
});
test('les mois passés sont des données lues, sans mutation lors de la simulation', () => {
  const a=account([tx('2026-09-10',60)], [rule('2026-01-25',50)]);
  const snapshot=JSON.stringify(a);
  run([a]);
  assert.equal(JSON.stringify(a),snapshot);
});
test('les doublons potentiels sont signalés sans suppression', () => {
  const t1=tx('2026-10-18',25);const t2={...t1,id:'different'};
  const a=account([t1,t2]);
  assert.ok(run([a]).alerts.some(x=>x.text.includes('Doublons potentiels')));
  assert.equal(a.transactions.length,2);
});
test('un paiement du même montant sur un autre compte ne déclenche pas de faux doublon', () => {
  const a=account([tx('2026-10-18',25)],[],{id:'a'});
  const b=account([tx('2026-10-18',25)],[],{id:'b'});
  assert.ok(!run([a,b]).alerts.some(x=>x.text.includes('Doublons potentiels')));
});
test('un solde prévu négatif produit une alerte', () => {
  const a=account([], [rule('2026-01-25',1500)]);
  assert.ok(run([a]).alerts.some(x=>x.text.includes('négatif')));
});
test('une hausse d’au moins 30 % d’un mois à l’autre est détectée', () => {
  const a=account([tx('2026-09-12',100),tx('2026-10-12',150)]);
  assert.ok(run([a]).alerts.some(x=>x.text.includes('30 %')));
});
test('un revenu seul ne déclenche pas une fausse hausse de dépenses', () => {
  const a=account([tx('2026-09-12',100),tx('2026-10-12',999,'income')]);
  assert.ok(!run([a]).alerts.some(x=>x.text.includes('30 %')));
});
test('seuls revenus et dépenses manuels peuvent être planifiés', () => {
  assert.equal(canPlanTransaction(tx('2026-10-19',40)),true);
  assert.equal(canPlanTransaction(tx('2026-10-19',40,'income')),true);
  assert.equal(canPlanTransaction(tx('2026-10-19',40,'transfer')),false);
  assert.equal(canPlanTransaction(tx('2026-10-19',40,'expense',{parentId:'r1'})),false);
  assert.equal(canPlanTransaction(tx('2026-10-19',40,'expense',{linkedDebtId:'d1'})),false);
});
test('statuts invalides et opérations à risque sont refusés', () => {
  assert.equal(validatePaymentStatus(tx('2026-10-19',40),'unexpected'),false);
  assert.equal(validatePaymentStatus(tx('2026-10-19',40,'transfer'),'planned'),false);
  assert.equal(validatePaymentStatus(tx('2026-10-19',40),'planned'),true);
});
test('horizon maximum limité à 12 mois et mois invalides refusés', () => {
  assert.equal(forecastMonths([account()],{today:TODAY,months:500}).length,12);
  assert.throws(()=>run([account()],{month:'2026-13'}),/Période invalide/);
  assert.throws(()=>forecastMonths([account()],{today:'2026-02-30'}),/Date de référence invalide/);
});
test('une ancienne sauvegarde sans budget ni récurrences reste compatible', () => {
  const result=run([{id:'a',initialCapital:50, transactions:[tx('2026-10-19',10)]}]);
  assert.equal(result.startingBalance,40);
  assert.equal(result.budgets.length,0);
});
test('le service worker prévoit les fichiers du nouveau tableau de bord', () => {
  const sw=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
  for(const path of ['finance-priority2.css','finance-priority2.js','finance-priority2-engine.mjs']) assert.ok(sw.includes(path));
});
test('une période hebdomadaire enregistrée sans periodKey ne repasse pas en prévision', () => {
  const a=account([tx('2026-10-26',40,'expense',{parentId:'rule1',category:'Abonnements'})],
    [rule('2026-10-05',40,{frequency:'weekly'})]);
  const result=run([a]).forecasts[0];
  assert.equal(result.items.length,1);
  assert.equal(result.balance,960);
});
test('une hausse réelle sur une récurrence mensuelle déclenche une alerte spécifique', () => {
  const a=account([tx('2026-09-12',50,'expense',{parentId:'rule1',periodKey:'2026-09'}),
    tx('2026-10-12',80,'expense',{parentId:'rule1',periodKey:'2026-10'})],
    [rule('2026-01-12',50)]);
  assert.ok(run([a]).alerts.some(alert=>alert.text.includes('Hausse d’une récurrence')));
});
test('un budget susceptible d’être dépassé produit une alerte prévisionnelle, non comptable', () => {
  const a=account([tx('2026-10-10',80)],[],{budgetsByCategory:{Alimentation:100}});
  a.transactions.push(tx('2026-10-29',50,'expense',{paymentStatus:'planned',id:'planned-50'}));
  assert.ok(run([a]).alerts.some(alert=>alert.text.includes('prochaines échéances')));
  assert.equal(run([a]).current.expenses,80);
});
test('planifier un remboursement de dette en simple dépense est interdit', () => {
  assert.equal(canPlanTransaction(tx('2026-10-19',25,'expense',{category:'Remboursement dette'})),false);
});

test('ALX 01–02 : un montant ou une date incertaine bloque le calcul avec une erreur liée à la ligne', () => {
  const badAmount = tx('2026-10-12', 'illisible');
  const amountError = captureError(() => bookedBalance([account([badAmount])], TODAY));
  assert.equal(amountError.code, 'not-numeric');
  assert.equal(amountError.transactionId, badAmount.id);

  const badDate = tx('2026-10-12', 12, 'expense', { date: '2026-02-30' });
  const dateError = captureError(() => monthTotals([account([badDate])], '2026-10', TODAY));
  assert.equal(dateError.code, 'invalid-date');
  assert.match(dateError.field, /date$/);
});

test('validation des dates : accepte le 29 février seulement pour une année bissextile', () => {
  const leap = account([tx('2024-02-29', 12)]);
  assert.equal(monthTotals([leap], '2024-02', '2024-02-29').expenses, 12);
  const invalid = tx('2025-02-28', 12, 'expense', { date: '2025-02-29' });
  assert.throws(() => monthTotals([account([invalid])], '2025-02', '2025-02-28'), error => error.code === 'invalid-date');
});

test('le cumul reste exact près de la limite des entiers sûrs et bloque le dépassement', () => {
  const nearLimit = { id: 'large-a', date: '2026-10-12', type: 'expense', amountBase: '45035996273704,95', category: 'Test' };
  const a = account([nearLimit, { ...nearLimit, id: 'large-b' }]);
  assert.equal(monthTotals([a], '2026-10', TODAY).expensesMinor, Number.MAX_SAFE_INTEGER - 1);
  const overflow = { ...nearLimit, amountBase: '45035996273704,96' };
  assert.throws(() => monthTotals([account([overflow, { ...overflow, id: 'large-c' }])], '2026-10', TODAY),
    error => error.code === 'out-of-range');
});

test('ALX 01 : le cockpit conserve les unités minimales hors des devises à deux décimales', () => {
  const yen = {
    ...account([tx('2026-10-12', 1)], [], { initialCapital: 1000 }),
    settings: { baseCurrency: 'JPY' }
  };
  assert.equal(bookedBalance([yen], TODAY), 999);
  assert.equal(monthTotals([yen], '2026-10', TODAY).expenses, 1);
});

test('ALX 03 / ALX 12 : le cache du cockpit suit la révision et rend une copie indépendante', () => {
  const row = tx('2026-10-12', 12);
  const a = account([row]);
  const options = { today: TODAY, month: '2026-10', months: 3, dataRevision: 'rev-1' };
  const first = financeOverview([a], options);
  first.current.expenses = 999;
  assert.equal(financeOverview([a], options).current.expenses, 12);
  row.amountBase = 30;
  assert.equal(financeOverview([a], { ...options, dataRevision: 'rev-2' }).current.expenses, 30);
});

test('ALX 01 : le cockpit refuse de sommer deux devises de base sans taux de conversion commun', () => {
  const euro = account([]);
  const usd = { ...account([], [], { id: 'usd' }), settings: { baseCurrency: 'USD' } };
  const error = captureError(() => financeOverview([euro, usd], { today: TODAY, month: '2026-10' }));
  assert.equal(error.code, 'mixed-currency');
});
