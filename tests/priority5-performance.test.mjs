import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { financeOverview, financeAlerts, forecastMonths } from '../assets/js/finance-priority2-engine.mjs';
import { legacyFinanceProjection } from '../scripts/benchmarks/finance-priority2-parity.mjs';

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const money = read('assets/js/finance-money.js');
const cut = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function formatterFixture() {
  const src = cut(read('assets/js/core.js'), 'const freevCurrencyFormatters = new Map();', 'function isoDate(');
  let instances = 0;
  class CountedFormatter extends Intl.NumberFormat {
    constructor(...args) { super(...args); instances++; }
  }
  const ctx = vm.createContext({ Intl: { NumberFormat: CountedFormatter }, settings: { baseCurrency: 'EUR' } });
  vm.runInContext(money, ctx);
  vm.runInContext(src, ctx);
  return { ctx, getInstances: () => instances };
}
test('mise en cache de Intl.NumberFormat : même présentation, un seul formateur par devise', () => {
  const {ctx, getInstances} = formatterFixture();
  for (let i=0; i<100; i++) assert.equal(ctx.formatCurrency(19.95),new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR', maximumFractionDigits:2}).format(19.95));
  assert.equal(getInstances(), 1);
  ctx.settings.baseCurrency = 'USD';
  assert.equal(ctx.formatCurrency(23.5),new Intl.NumberFormat('fr-FR',{style:'currency',currency:'USD', maximumFractionDigits:2}).format(23.5));
  assert.equal(ctx.formatCurrency(23.5, 'EUR', 0),new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR', maximumFractionDigits:0}).format(23.5));
  assert.equal(getInstances(),3);
});
test('cache de formateurs borné, valeur incorrecte gérée sans exception', () => {
  const {ctx} = formatterFixture();
  for (let i=0; i<80; i++) ctx.formatCurrency(i, 'EUR', i % 21);
  assert.ok(vm.runInContext('freevCurrencyFormatters.size',ctx) <= 24);
  assert.equal(ctx.formatCurrency(12.5,'INVALID'), '12.50 INVALID');
});

test('empreinte des opérations : détecte contenu et ordre sans trier ni tronquer les données', () => {
  const source = cut(read('assets/js/v5.js'), 'function ruleTransactionRevision(account) {', 'window.freevTransactionRevision = ruleTransactionRevision;');
  const revision = new Function(`${source}\nreturn ruleTransactionRevision;`)();
  const account = { transactions: [
    { id: 'a', date: '2026-10-01', amountBase: 12 },
    { id: 'b', date: '2026-10-02', amountBase: 18 }
  ] };
  const original = revision(account);
  assert.equal(revision(account), original);
  account.transactions[0].amountBase = 13;
  assert.notEqual(revision(account), original);
  account.transactions[0].amountBase = 12;
  account.transactions.reverse();
  assert.notEqual(revision(account), original);
});

function filterHarness() {
  const script = cut(read('assets/js/transactions.js'), 'let transactionRenderLimit = 100;', 'function getFilteredTransactions()');
  const scheduled = new Map();
  const fields = Object.fromEntries(['txSearch','txTypeFilter','txModeFilter','txCategoryFilter','txMin','txMax','txFrom','txTo'].map(id=>[id,{value:'abc'}]));
  let lastId = 0, renders = 0;
  const ctx = vm.createContext({
    document: { getElementById: id => fields[id] || null }, currentView: 'transactions',
    setTimeout(fn) {const id = ++lastId; scheduled.set(id, fn); return id;},
    clearTimeout(id) { scheduled.delete(id);},
    renderAllTransactions() { renders++; },
  });
  vm.runInContext(script,ctx);
  return {ctx, fields, scheduled, renders:()=>renders, flush:()=> { const jobs=[...scheduled.values()]; scheduled.clear(); jobs.forEach(job=>job()); }};
}
test('recherche : 30 caractères tapés déclenchent un seul rendu après temporisation', () => {
  const h = filterHarness();
  for(let i=0;i<30;i++) h.ctx.applyTxFilters(true);
  assert.equal(h.renders(),0);
  assert.equal(h.scheduled.size,1);
  h.flush();
  assert.equal(h.renders(),1);
});
test('filtre immédiat et réinitialisation annulent les rendus en attente', () => {
  const h = filterHarness();
  h.ctx.applyTxFilters(true);
  h.ctx.applyTxFilters();
  assert.equal(h.renders(),1);
  h.flush();
  assert.equal(h.renders(),1);
  h.ctx.applyTxFilters(true);
  h.ctx.clearTxFilters();
  h.flush();
  assert.equal(h.renders(),2);
  assert.deepEqual(Object.values(h.fields).map(field=>field.value),Array(8).fill(''));
});
test('aucun rendu en arrière-plan lorsque la vue a été quittée', () => {
  const h=filterHarness();
  h.ctx.applyTxFilters(true);
  h.ctx.currentView='dashboard';
  h.flush();
  assert.equal(h.renders(),0);
});

test('agrégation prévisionnelle : montants, ordre des échéances et flux inchangés', () => {
  const account = {id:'a',name:'Compte A', initialCapital:700, budgetsByCategory:{Courses:200},
    transactions:[
      {id:'salary',date:'2026-10-19', type:'income',amountBase:1500,category:'Salaire'},
      {id:'one',date:'2026-10-20', type:'expense',amountBase:19.99,category:'Courses'},
      {id:'future',date:'2026-11-02', type:'expense',amountBase:29.95,category:'Courses',paymentStatus:'planned'},
      {id:'override',date:'2026-11-15', type:'expense',amountBase:80, category:'Abonnements',parentId:'r1',periodKey:'2026-11'},
      {id:'futurePay',date:'2026-12-20', type:'income',amountBase:22,category:'Divers'},
    ],recurringTransactions:[{id:'r1',startDate:'2026-01-15',frequency:'monthly',dayOfMonth:15,type:'expense',amountBase:30, category:'Abonnements'}]};
  const snapshot=JSON.stringify(account);
  const forecast=forecastMonths([account], {today:'2026-10-21',months:3});
  const overview=financeOverview([account], {month:'2026-10',today:'2026-10-21',months:3});
  assert.deepEqual(forecast,overview.forecasts);
  assert.equal(forecast[0].income,0);
  assert.equal(forecast[1].expenses,109.95);
  assert.ok(forecast[1].items.find(item=>item.id==='override'));
  assert.ok(!forecast[1].items.some(item=>item.source==='recurring' && item.id ==='r1|2026-11'));
  assert.equal(forecast[2].income,22);
  assert.equal(JSON.stringify(account),snapshot);
  assert.deepEqual(overview.alerts,financeAlerts([account],{month:'2026-10',today:'2026-10-21',forecast}));
});
test('alertes de hausse : plusieurs séries et doublons sans altérer les autres mois', () => {
  const account = {id:'a',initialCapital:1000,transactions:[],recurringTransactions:[]};
  for(let i=0;i<50;i++) {
    const id=`r${i}`;
    account.recurringTransactions.push({id, startDate:'2026-01-12', frequency:'monthly',dayOfMonth:12,type:'expense',amountBase:10,desc:`Règle ${i}`});
    account.transactions.push({id:`p${i}`,parentId:id,date:'2026-09-12',amountBase:10,type:'expense'});
    account.transactions.push({id:`c${i}`,parentId:id,date:'2026-10-12',amountBase:i===12?20:10,type:'expense'});
  }
  const model=financeOverview([account],{month:'2026-10',today:'2026-10-21',months:3});
  assert.ok(model.alerts.some(alert=>alert.text.includes('Règle 12')));
  assert.ok(!model.alerts.some(alert=>alert.text.includes('Règle 13')));
  assert.equal(account.transactions.length,100);
});

test('comparaison différentielle : 18 cas de comptes, récurrences et statuts produisent exactement les mêmes finances', async () => {
  const {financeOverview: baseline} = await import('../scripts/benchmarks/finance-priority2-engine-baseline.mjs');
  let seed=123456;
  const random = () => ((seed=(Math.imul(1664525,seed)+1013904223)>>>0) / 2**32);
  const frequencies=['monthly','weekly','yearly'];
  const types=['expense','income','transfer'];
  for(let caseId=0;caseId<18;caseId++) {
    const accounts=[];
    for(let a=0;a<1+(caseId%3);a++) {
      const rules=Array.from({length:4},(_,j)=>({id:`r${j}`,startDate:'2026-01-12',dayOfMonth:12,
        frequency:frequencies[(j+caseId)%3],type:types[j%3],category:'Abonnements',amountBase:2+j}));
      const transactions=Array.from({length:60+caseId*2},(_,j)=>{
        const month=1+Math.floor(random()*12),day=1+Math.floor(random()*28);
        return {id:`t${j}`,date:`2026-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,
          type:types[Math.floor(random()*3)],amountBase:Math.round(random()*20000)/100,
          category:j%4 ? 'Courses':'Abonnements',desc:'Dépense',
          ...(j%9===0?{parentId:rules[j%4].id}:{}),
          ...(j%8===0?{paymentStatus:'planned'}:{})};
      });
      accounts.push({id:`a${a}`,name:`Compte ${a}`,transactions,recurringTransactions:rules,
        initialCapital:Math.round(random()*1000),budgetsByCategory:{Courses:200,Abonnements:100}});
    }
    const config={today:'2026-10-21',month:['2026-09','2026-10','2026-11'][caseId%3],months:1+(caseId%6)};
    const original=baseline(accounts,config);
    const optimized=financeOverview(accounts,config);
    assert.deepEqual(legacyFinanceProjection(optimized), legacyFinanceProjection(original), `cas différentiel ${caseId}`);
  }
});

test('version de cache PWA actualisée pour ne pas réutiliser les anciens scripts', () => {
  assert.match(read('sw.js'), /freev-v5\.2\.0-everyday-\d{8}-v\d+/);
  assert.match(read('index.html'), /oninput="applyTxFilters\(true\)"/);
});
