import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Charge les vrais scripts de l'application. Le DOM et le temps sont simulés
// pour tester les chemins de production, y compris saveTransaction().
const recurringCode = fs.readFileSync(new URL('../assets/js/recurring.js', import.meta.url), 'utf8');
const transactionsCode = fs.readFileSync(new URL('../assets/js/transactions.js', import.meta.url), 'utf8');
const moneyCode = fs.readFileSync(new URL('../assets/js/finance-money.js', import.meta.url), 'utf8');
const coreCode = fs.readFileSync(new URL('../assets/js/core.js', import.meta.url), 'utf8');
const recurrenceUXCode = fs.readFileSync(new URL('../assets/js/recurrence-priority1.js', import.meta.url), 'utf8');
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
    safeNumber: (v, fallback) => {
      const value = String(v ?? '').replace(',', '.').trim();
      const number = value ? Number(value) : NaN;
      return Number.isFinite(number) ? number : fallback;
    },
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
    escapeHTML: value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\"','&quot;'),
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
  vm.runInContext(`function getDisplayRecurringRules(){return recurringTransactions;}\n${recurringCode}\n${transactionsCode}\n${projectionsCode}\n${recurrenceUXCode}`, ctx);
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


test('une exception du mois courant conserve la règle et journalise des snapshots réversibles', () => {
  const {ctx,save} = env({ transactions: [tx('sept','2026-09-10'),tx('oct','2026-10-10'),tx('nov','2026-11-10')] });
  assert.equal(save({id:'oct',date:'2026-10-15',month:'2026-10',amount:90}).type,'success');
  const rev = ctx.recurringTransactions[0].recurrenceHistory[0];
  assert.equal(rev.kind,'single'); assert.equal(rev.before.amountBase,50);
  assert.equal(rev.after.amountBase,90);
  assert.equal(ctx.recurringTransactions[0].amountBase,50);
  assert.equal(ctx.transactions.find(t=>t.id==='sept').amountBase,50);
  assert.equal(ctx.transactions.find(t=>t.id==='nov').amountBase,50);
  assert.equal(ctx.restoreRecurringRevision('r1',rev.id),true);
  assert.equal(ctx.transactions.find(t=>t.id==='oct').amountBase,50);
  assert.equal(ctx.transactions.find(t=>t.id==='oct').date,'2026-10-10');
  assert.equal(ctx.restoreRecurringRevision('r1',rev.id),false);
});

test('un taux décimal saisi avec virgule convertit une seule fois, au centime près', () => {
  const { ctx, elements, save } = env({ transactions: [] });
  elements.get('transCurrency').value = 'USD';
  elements.get('transFxRate').value = '0,9';
  assert.equal(save({ amount: '100,05', scope: 'series' }).type, 'success');
  const rule = ctx.recurringTransactions[0];
  assert.equal(rule.originalAmount, 100.05);
  assert.equal(rule.amountBase, 90.05);
  assert.equal(rule.fxRate, 0.9);
});

test('le retour en arrière d’une exception projetée supprime seulement cette projection personnalisée', () => {
  const {ctx,save} = env({transactions:[tx('oct','2026-10-10')]});
  assert.equal(save({month:'2026-12',date:'2026-12-20',projected:true,amount:75}).type,'success');
  const rev=ctx.recurringTransactions[0].recurrenceHistory[0];
  assert.equal(rev.before,null);
  assert.equal(ctx.transactions.find(t=>t.periodKey==='2026-12').amountBase,75);
  assert.equal(ctx.restoreRecurringRevision('r1',rev.id),true);
  assert.equal(ctx.transactions.some(t=>t.periodKey==='2026-12'),false);
  assert.equal(ctx.getProjectedRecurringTransactions('2026-12')[0].amountBase,50);
});

test('une restauration ne remplace pas une révision plus récente sur la même échéance', () => {
  const {ctx,save,notifications} = env({transactions:[tx('oct','2026-10-10')]});
  save({id:'oct',month:'2026-10',date:'2026-10-12',amount:80});
  const earlier=ctx.recurringTransactions[0].recurrenceHistory[0].id;
  save({id:'oct',month:'2026-10',date:'2026-10-13',amount:95});
  assert.equal(ctx.restoreRecurringRevision('r1',earlier),false);
  assert.equal(ctx.transactions[0].amountBase,95);
  assert.ok(notifications.some(n=>n.type==='error'));
});

test('la restauration d’un mois passé réclame les deux confirmations', () => {
  const {ctx,save,confirms} = env({transactions:[tx('sept','2026-09-10')], confirmAnswers:[true,true,true,false]});
  assert.equal(save({date:'2026-09-12',amount:85}).type,'success');
  const rev=ctx.recurringTransactions[0].recurrenceHistory[0].id;
  assert.equal(ctx.restoreRecurringRevision('r1',rev),false);
  assert.equal(ctx.transactions[0].amountBase,85);
  assert.equal(confirms.length,4);
});

test('modifier uniquement les futurs garde les mois historiques et les exceptions',()=>{
 const {ctx,save}=env({transactions:[tx('sept','2026-09-10'),tx('oct','2026-10-10'),tx('nov','2026-11-10',65,{_manuallyEdited:true})]});
 assert.equal(save({date:'2026-11-10',month:'2026-11',amount:110,scope:'all',projected:true}).type,'success');
 assert.equal(ctx.recurringTransactions[0].amountBase,110);
 assert.equal(ctx.transactions.find(t=>t.id==='sept').amountBase,50);
 assert.equal(ctx.transactions.find(t=>t.id==='oct').amountBase,50);
 assert.equal(ctx.transactions.find(t=>t.id==='nov').amountBase,65);
 assert.equal(ctx.getProjectedRecurringTransactions('2026-12')[0].amountBase,110);
});

test('annuler la modification future restaure la règle mais conserve une exception ponctuelle',()=>{
 const {ctx,save}=env({transactions:[tx('oct','2026-10-10'),tx('nov','2026-11-10',75,{_manuallyEdited:true})]});
 save({date:'2026-11-10',month:'2026-11',projected:true,scope:'all',amount:110});
 const rev=ctx.recurringTransactions[0].recurrenceHistory[0];
 assert.equal(rev.kind,'future');
 assert.equal(ctx.restoreRecurringRevision('r1',rev.id),true);
 assert.equal(ctx.recurringTransactions[0].amountBase,50);
 assert.equal(ctx.transactions.find(t=>t.id==='nov').amountBase,75);
 assert.equal(ctx.getProjectedRecurringTransactions('2026-12')[0].amountBase,50);
});

test('l’édition complète de la série est refusée sans double confirmation',()=>{
 const {ctx,save,confirms}=env({transactions:[tx('sept','2026-09-10'),tx('oct','2026-10-10')],confirmAnswers:[true,false]});
 save({scope:'history',date:'2026-10-10',month:'2026-10',id:'oct',amount:130});
 assert.equal(confirms.length,2);
 assert.equal(ctx.transactions[0].amountBase,50);
 assert.equal(ctx.recurringTransactions[0].amountBase,50);
});

test('l’édition complète doublement confirmée conserve les périodes et modifie les écritures existantes',()=>{
 const {ctx,save,confirms}=env({transactions:[tx('sept','2026-09-10'),tx('oct','2026-10-10'),tx('nov','2026-11-10',99,{_manuallyEdited:true})], confirmAnswers:[true,true,true]});
 assert.equal(save({scope:'history',date:'2026-10-10',month:'2026-10',id:'oct',amount:130}).type,'success');
 assert.equal(confirms.length,2);
 assert.equal(ctx.recurringTransactions[0].amountBase,130);
 assert.deepEqual(Array.from(ctx.transactions.map(t=>t.periodKey)),['2026-09','2026-10','2026-11']);
 assert.deepEqual(Array.from(ctx.transactions.map(t=>t.amountBase)),[130,130,130]);
 const rev=ctx.recurringTransactions[0].recurrenceHistory[0];
 assert.equal(rev.kind,'historical');
 assert.equal(rev.changes.length,3);
 assert.equal(ctx.restoreRecurringRevision('r1',rev.id),true);
 assert.equal(ctx.recurringTransactions[0].amountBase,50);
 assert.deepEqual(Array.from(ctx.transactions.map(t=>t.amountBase)),[50,50,99]);
});

test('la restauration globale est refusée si une échéance a changé après',()=>{
 const {ctx,save}=env({transactions:[tx('sept','2026-09-10'),tx('oct','2026-10-10')]});
 save({scope:'history',date:'2026-10-10',month:'2026-10',id:'oct',amount:90});
 const rev=ctx.recurringTransactions[0].recurrenceHistory[0];
 ctx.transactions[0].amountBase=91;
 assert.equal(ctx.restoreRecurringRevision('r1',rev.id),false);
 assert.equal(ctx.recurringTransactions[0].amountBase,90);
});

test('le calendrier distingue mois passé incomplet, exception et projection',()=>{
 const {ctx}=env({transactions:[tx('sept','2026-09-10',65,{_manuallyEdited:true}),tx('oct','2026-10-10')]});
 const rule=ctx.recurringTransactions[0];
 assert.equal(ctx.recurringPeriodEntries(rule,'2026-09')[0].status,'Personnalisée');
 assert.equal(ctx.recurringPeriodEntries(rule,'2026-08')[0].status,'Historique absent');
 assert.equal(ctx.recurringPeriodEntries(rule,'2026-12')[0].status,'Prévue');
 assert.equal(ctx.recurringPeriodEntries(rule,'2026-12')[0].amount,50);
});

test('l’index du calendrier conserve les montants et détecte les doublons',()=>{
 const {ctx}=env({transactions:[tx('sept','2026-09-10',65,{_manuallyEdited:true}),tx('oct','2026-10-10'),tx('oct2','2026-10-10')]});
 const rule=ctx.recurringTransactions[0];
 const indexed=ctx.recurringStoredPeriods(rule);
 for(const month of ['2026-08','2026-09','2026-10','2026-12']) {
  const historical=ctx.recurringPeriodEntries(rule,month);
  const current=ctx.recurringPeriodEntries(rule,month,indexed);
  assert.deepEqual(JSON.parse(JSON.stringify(current)),JSON.parse(JSON.stringify(historical)));
 }
 assert.equal(ctx.recurringPeriodEntries(rule,'2026-10',indexed)[0].status,'Doublon à vérifier');
});

test('le simulateur sait isoler un mois sans impacter les autres',()=>{
 const {ctx}=env({transactions:[tx('sept','2026-09-10'),tx('oct','2026-10-10')]});
 const rule=ctx.recurringTransactions[0];
 const view=ctx.recurringImpactModel(rule,'single','2026-10',85,'2026-10-12');
 assert.equal(view.affected.length,1);
 assert.equal(view.affected[0].month,'2026-10');
 assert.equal(view.affected[0].before,50);
 assert.equal(view.affected[0].after,85);
 const future=ctx.recurringImpactModel(rule,'all','','100','2026-10-12');
 assert.ok(future.affected.every(item=>item.month>='2026-10'));
});

test('le calendrier accepte les semaines et les années sans additionner des mois inexistants',()=>{
 const {ctx}=env({rule:{id:'r1',frequency:'weekly',startDate:'2026-10-07',amountBase:25,category:'Courses',type:'expense'}});
 assert.ok(ctx.recurringPeriodEntries(ctx.recurringTransactions[0],'2026-11').length>=4);
 const {ctx:annual}=env({rule:{id:'r1',frequency:'yearly',startDate:'2024-02-29',amountBase:100}});
 assert.equal(annual.recurringPeriodEntries(annual.recurringTransactions[0],'2026-02').length,1);
 assert.equal(annual.recurringPeriodEntries(annual.recurringTransactions[0],'2026-03').length,0);
});

test('le calendrier est rendu sur douze mois avec historique, sans modifier les données',()=>{
 const {ctx,elements}=env({transactions:[tx('oct','2026-10-10')]});
 const panel={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[],replaceChildren(){this.innerHTML='';}};
 elements.set('recurringCalendarPanel',panel);
 ctx.renderRecurringCalendar();
 assert.equal((panel.innerHTML.match(/class="rec-month /g)||[]).length,12);
 assert.match(panel.innerHTML,/Historique des changements/);
 assert.equal(ctx.transactions.length,1);
});

test('la modification historique refuse un doublon et conserve tous les montants', () => {
  const {ctx,save,notifications}=env({ transactions:[tx('sept-a','2026-09-10'),tx('sept-b','2026-09-11',{amountBase:55}, {periodKey:'2026-09'})] });
  save({scope:'history',date:'2026-10-10',month:'2026-10',id:'oct',amount:130});
  assert.equal(ctx.recurringTransactions[0].amountBase,50);
  assert.equal(ctx.transactions.length,2);
  assert.ok(notifications.some(n=>n.type==='error'));
});

test('l’édition historique refuse les anciens effets d’épargne non confirmés',()=>{
  const {ctx,save,notifications}=env({
    rule:{id:'r1',frequency:'monthly',dayOfMonth:10,startDate:'2026-01-10',type:'transfer',amountBase:30,amount:30,category:'Épargne'},
    transactions:[tx('sept','2026-09-10',30,{type:'transfer',transferTarget:'Livret A',_effectsApplied:false})]
  });
  save({scope:'history',date:'2026-10-10',month:'2026-10',amount:50});
  assert.equal(ctx.recurringTransactions[0].amountBase,30);
  assert.ok(notifications.some(n=>n.type==='error'));
});

test('l’édition historique d’un virement enregistré ajuste l’épargne une seule fois, et l’annulation inverse l’écart',()=>{
  const {ctx,save,input}=env({
    rule:{id:'r1',frequency:'monthly',dayOfMonth:10,startDate:'2026-01-10',type:'transfer',amountBase:30,amount:30,category:'Épargne'},
    transactions:[tx('sept','2026-09-10',30,{type:'transfer',transferTarget:'Livret A',_effectsApplied:true}),
      tx('oct','2026-10-10',30,{type:'transfer',transferTarget:'Livret A',_effectsApplied:true})]
  });
  ctx.savingsAccounts['Livret A']=60;
  input('transType','transfer'); input('transferSavingsTarget','Livret A');
  assert.equal(save({scope:'history',date:'2026-10-10',month:'2026-10',id:'oct',amount:45}).type,'success');
  assert.equal(ctx.savingsAccounts['Livret A'],90);
  const rev=ctx.recurringTransactions[0].recurrenceHistory[0];
  assert.equal(ctx.restoreRecurringRevision('r1',rev.id),true);
  assert.equal(ctx.savingsAccounts['Livret A'],60);
  assert.equal(ctx.transactions.find(t=>t.id==='sept').amountBase,30);
});

test('une série historique de plus de 120 occurrences ne peut être modifiée de façon destructrice',()=>{
  const old = Array.from({length:121},(_,index) => {
    const year=2016+Math.floor(index/12);
    const month=String(index%12+1).padStart(2,'0');
    return tx(`old-${index}`,`${year}-${month}-10`);
  });
  const {ctx,save,notifications}=env({transactions:old});
  save({scope:'history',date:'2026-10-10',month:'2026-10',amount:160});
  assert.equal(ctx.transactions.length,121);
  assert.equal(ctx.recurringTransactions[0].amountBase,50);
  assert.ok(notifications.some(n=>n.type==='error'));
});

test('l’historique conserve seulement les révisions récentes pour borner la taille de sauvegarde',()=>{
  const {ctx}=env();
  const rule=ctx.recurringTransactions[0];
  for(let i=0;i<60;i++)ctx.recordRecurringRevision(rule,'future','',{amountBase:i},{amountBase:i+1});
  assert.ok(rule.recurrenceHistory.length<=35);
  assert.equal(rule.recurrenceHistory[0].before.amountBase,59);
});

test('l’aperçu ponctuel inclut une ancienne échéance datant de plusieurs années',()=>{
  const {ctx}=env({rule:{id:'r1',frequency:'monthly',dayOfMonth:10,startDate:'2022-01-10',amountBase:50,type:'expense'}, transactions:[tx('past','2023-02-10',55)]});
  const view=ctx.recurringImpactModel(ctx.recurringTransactions[0],'single','2023-02',90,'2023-02-10');
  assert.equal(view.affected.length,1);
  assert.equal(view.affected[0].month,'2023-02');
  assert.equal(view.affected[0].after,90);
});
