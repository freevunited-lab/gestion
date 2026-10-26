import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const source = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const core = source('assets/js/core.js');
const state = source('assets/js/state.js');
const worker = source('sw.js');
const slice = (code, start, end) => code.slice(code.indexOf(start), code.indexOf(end, code.indexOf(start)));

function navHarness({ reduced = false } = {}) {
  const views = ['dashboard','transactions','recurring','analytics','planner','smart','savings','debts','history','settings'];
  const classes = () => {
    const values = new Set();
    return { add: key => values.add(key), remove: key => values.delete(key), contains: key => values.has(key) };
  };
  const elements = new Map(views.map(view => [`${view}-view`, { classList: classes(), offsetWidth: 42 }]));
  elements.set('content-area', { scrollTo: ({ behavior }) => { scrollBehavior = behavior; } });
  let scrollBehavior;
  const calls = { saved: 0, render: 0, bottom: 0 };
  const navItem = { classList: classes(), getAttribute: () => "switchView('dashboard')" };
  const context = vm.createContext({
    currentView:'dashboard', window: { matchMedia: () => ({ matches: reduced }), FreevPremiumUI: { setView: () => {} } },
    document: { getElementById: id => elements.get(id) || null,
      querySelector: selector => selector === '.content-area' ? elements.get('content-area') : null,
      querySelectorAll: () => [navItem] },
    saveCurrentGlobalsToAccount: () => calls.saved++,
    setBottomNav: () => calls.bottom++,
    syncWorkspaceAddMenu() {},
    updateDashboard: () => calls.render++,
    renderAllTransactions: () => calls.render++, refreshCategoryFilter() {},
    renderRecurringList: () => calls.render++, renderAnalytics: () => calls.render++,
    renderSavingsList: () => calls.render++, refreshSavingsSelect() {},
    renderDebts: () => calls.render++, renderHistory: () => calls.render++,
    loadSettingsUI() {}, renderDataHealth() {},
    setTimeout: () => {},
  });
  vm.runInContext(slice(core, 'function switchView(view) {', '// ---------- Computations ----------'), context);
  return { context, calls, elements, getScroll: () => scrollBehavior };
}

test('une page inconnue ne peut ni modifier le contexte ni masquer l’écran', () => {
  const { context, calls, elements } = navHarness();
  elements.get('dashboard-view').classList.add('active');
  assert.equal(context.switchView('__invalid__'), false);
  assert.equal(context.switchView({ toString: () => 'dashboard' }), false);
  assert.equal(context.currentView, 'dashboard');
  assert.equal(calls.saved, 0);
  assert.equal(calls.bottom, 0);
  assert.equal(elements.get('dashboard-view').classList.contains('hidden'), false);
});

test('une vue valide est affichée, une seconde navigation identique n’efface rien', () => {
  const { context, calls, elements } = navHarness();
  assert.equal(context.switchView('transactions'), true);
  assert.equal(elements.get('transactions-view').classList.contains('hidden'), false);
  assert.equal(elements.get('dashboard-view').classList.contains('hidden'), true);
  assert.equal(calls.saved, 1);
  assert.equal(calls.render, 1);
  assert.equal(context.switchView('transactions'), true);
  assert.equal(calls.saved, 1);
  assert.equal(calls.render, 1);
});

test('navigation à mouvement réduit : pas d’animation ni de défilement imposé', () => {
  const { context, elements, getScroll } = navHarness({ reduced: true });
  assert.equal(context.switchView('settings'), true);
  assert.equal(getScroll(), 'instant');
  assert.equal(elements.get('settings-view').classList.contains('view-enter'), false);
});

test('une mutation visant un compte supprimé ne touche pas le compte ouvert', () => {
  const data = [{id:'a',transactions:[{id:'one'}]}, {id:'b',transactions:[{id:'two'}]}];
  let writes = 0;
  const context = vm.createContext({window:{}, accounts: data, currentAccountId:'a',
    saveCurrentGlobalsToAccount(){}, saveAccountSystem(){writes++;}, loadCurrentAccountIntoGlobals(){},
    getCurrentAccount: () => data[0]});
  vm.runInContext(slice(state, 'window._mutateAccountData = function(accountId, mutator) {', 'function loadCurrentAccountIntoGlobals()'), context);
  let invoked = 0;
  assert.equal(context.window._mutateAccountData('missing', () => invoked++), null);
  assert.equal(invoked,0);
  assert.equal(writes,0);
  assert.equal(data[0].transactions.length, 1);
  context.window._mutateAccountData('b', account => account.transactions.push({id:'three'}));
  assert.equal(data[1].transactions.length, 2);
  assert.equal(data[0].transactions.length, 1);
  assert.equal(writes,1);
});

function projectionHarness({ accountMode = 'individual', accountCount = 1, count = 3000 } = {}) {
  const rules = Array.from({length:60}, (_, i) => ({id:`r${i}`,frequency:'monthly',type:'expense', startDate:'2026-01-01'}));
  const transactions = Array.from({length:count}, (_, i) => ({id:`t${i}`, parentId:`r${i%60}`,periodKey:`2026-${String(1+Math.floor(i/60)%12).padStart(2,'0')}`,date:'2026-01-10'}));
  const currentAccountId = 'accA';
  let checks = 0;
  const context=vm.createContext({
    multiViewMode:accountMode, currentAccountId, transactions,
    isoMonth:()=> '2026-10',isoDate:()=> '2026-10-21',getToday:()=>new Date('2026-10-21'),
    getDisplayTransactions:()=>accountCount>1 ? transactions.map(t=>({...t,_accountId:t.id==='other'?'accB':'accA'})):transactions,
    getDisplayRecurringRules:()=>accountCount>1 ? [...rules.map(r=>({...r,_accountId:'accA'})),{...rules[0],_accountId:'accB'}]:rules,
    recurringTransactions:rules,
    recurringDatesForMonth:()=>['2026-11-15'], periodKey:date=> {checks++;return date.slice(0,7);},
    isRecurringPeriodSkipped:()=>false,
    buildRecurringOccurrence:(rule,date,options)=>({parentId:rule.id,date,...options})
  });
  vm.runInContext(slice(core, 'function getProjectedRecurringTransactions(month, txList = null) {','function getProjectedLookupMonths()'),context);
  return {context,transactions,rules,getChecks:()=>checks};
}

test('projection : index linéaire sur un grand historique, sans scanner par règle', () => {
  const h=projectionHarness();
  const start=performance.now();
  const projected=h.context.getProjectedRecurringTransactions('2026-11');
  const elapsed=performance.now()-start;
  assert.ok(Number.isFinite(elapsed));
  assert.equal(projected.length,0); // Tout novembre 2026 existe dans l’historique synthétique
  assert.ok(h.getChecks() < 5000, 'Calcul par période, pas un scan complet par règle');
});

test('projection : même identifiant de règle dans deux comptes ne supprime pas une prévision', () => {
  const h=projectionHarness({accountMode:'global',accountCount:2,count:1});
  h.transactions[0].periodKey='2026-11';
  const projected=h.context.getProjectedRecurringTransactions('2026-11');
  assert.equal(projected.some(x=>x._accountId==='accA' && x.parentId==='r0'),false);
  assert.equal(projected.some(x=>x._accountId==='accB' && x.parentId==='r0'),true);
});

function swHarness(fetcher) {
  const handlers={};
  const stored=new Map();
  const putKeys=[];
  const cache={
    async match(key) {return stored.get(String(key)) || null;},
    async put(key, value) {putKeys.push(String(key));stored.set(String(key),value);},
    async addAll(){},
  };
  const self={location:{origin:'https://freev.test'},registration:{scope:'https://freev.test/app/'},
    addEventListener:(event,handler)=>handlers[event]=handler,skipWaiting() {},clients:{claim() {}}};
  const Response={error:()=>({status:0,ok:false})};
  vm.runInNewContext(worker,{self,caches:{open:async()=>cache, keys:async()=>[]},fetch:fetcher,Response,
    URL,Promise,console,Set});
  async function request(path,{mode='cors',method='GET'}={}) {
    const e={request:{url:`https://freev.test${path}`,mode,method},respondWith(p){this.response=p;},waitUntil(p){this.background=p;}};
    handlers.fetch(e);
    return e.response ? await e.response : null;
  }
  return {request,stored,putKeys,handlers};
}

const webResponse = (status=200) => ({ status,ok:status>=200&&status<300,type:'basic',clone(){return webResponse(status);} });

test('PWA : ne met jamais en cache un endpoint financier ou un autre chemin inconnu', async () => {
  let calls=0;
  const h=swHarness(async()=>{calls++;return webResponse();});
  assert.equal(await h.request('/app/data/private.json'),null);
  assert.equal(await h.request('/app/api/transactions'),null);
  assert.equal(await h.request('/app/unexpected',{mode:'navigate'}),null);
  assert.equal(calls,0);
  assert.equal(h.putKeys.length,0);
});

test('PWA : ne stocke pas les erreurs réseau HTTP ni les réponses opaques', async () => {
  const h=swHarness(async()=>webResponse(503));
  const result=await h.request('/app/assets/js/core.js');
  assert.equal(result.status,503);
  assert.equal(h.putKeys.length,0);
});

test('PWA : la navigation avec paramètres réutilise une clé unique sans données privées', async () => {
  const h=swHarness(async()=>webResponse());
  await h.request('/app/index.html?view=dashboard',{mode:'navigate'});
  await h.request('/app/index.html?view=savings&source=push',{mode:'navigate'});
  assert.deepEqual(h.putKeys,['https://freev.test/app/index.html','https://freev.test/app/index.html']);
});

test('PWA : un script connu utilise le cache de sa version en cas de coupure', async () => {
  const h=swHarness(async()=>{throw new Error('offline');});
  h.stored.set('https://freev.test/app/assets/js/core.js',webResponse());
  const result=await h.request('/app/assets/js/core.js');
  assert.equal(result.status,200);
  assert.equal(h.putKeys.length,0);
});

test('Firestore interdit la suppression client d’un document financier', () => {
  const rules=source('firestore.rules');
  assert.match(rules,/allow delete: if false;/);
  assert.match(rules,/request\.resource\.data\.revision == resource\.data\.revision \+ 1/);
});
