import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root,'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root,'assets/css/premium-v4.css'), 'utf8');
const js = fs.readFileSync(path.join(root,'assets/js/premium-v4.js'), 'utf8');
const sw = fs.readFileSync(path.join(root,'sw.js'), 'utf8');

function mock() {
  const events = {};
  const bodyClasses = new Set();
  const attrs = {};
  const iconClasses = new Set(['fa-toggle-off']);
  const status={textContent:''};
  const label={textContent:''};
  const month={value:'2026-10',addEventListener:(event,handler)=> {events[`month-${event}`]=handler;}};
  const toggle={
    addEventListener:(event,handler)=>{events[event]=handler;},
    setAttribute:(key,value)=>{attrs[key]=value;},
    querySelector:()=>({classList:{toggle:(cls,active)=>{if(active)iconClasses.add(cls);else iconClasses.delete(cls);}}})
  };
  const nodes={freevDensityToggle:toggle,freevDensityStatus:status,globalMonthPicker:month,premiumV4Period:label};
  const doc={readyState:'complete',body:{classList:{toggle:(cls,active)=>{if(active)bodyClasses.add(cls);else bodyClasses.delete(cls);}}},getElementById:id=>nodes[id]||null,querySelectorAll:()=>[],addEventListener:()=>{}};
  const store=new Map();
  const win={localStorage:{getItem:key=>store.get(key)??null,setItem:(k,v)=>store.set(k,v)}};
  vm.runInNewContext(js,{document:doc,window:win,Intl,Date,MutationObserver:undefined,Object});
  return {win,attrs,bodyClasses,status,label,month,events,store,iconClasses};
}

test('le style premium V4 est chargé après les autres couches',()=>{
  assert.ok(html.indexOf('premium-v4.css')>html.indexOf('premium-priority3.css'));
  assert.ok(html.indexOf('premium-v4.js')>html.indexOf('premium-priority3.js'));
});
test('le mode compact ne change jamais de données financières',()=>{
  assert.doesNotMatch(js,/saveData|Firebase|transaction\s*=|amountBase|account\.transactions|fetch\(/i);
  assert.match(css,/\.freev-v4-compact \.table td/);
});
test('le mode confortable est actif par défaut',()=>{
  const m=mock(); assert.equal(m.attrs['aria-pressed'],'false');
  assert.equal(m.status.textContent,'Désactivé');assert.equal(m.bodyClasses.has('freev-v4-compact'),false);
});
test('la commande compacte met à jour ARIA, état et stockage',()=>{
  const m=mock();m.events.click();
  assert.equal(m.attrs['aria-pressed'],'true');assert.equal(m.attrs['aria-label'],'Désactiver l’affichage compact');
  assert.equal(m.status.textContent,'Activé');assert.equal(m.store.get('freev.ui.density.v4'),'compact');
  assert.ok(m.bodyClasses.has('freev-v4-compact'));
  assert.ok(m.iconClasses.has('fa-toggle-on'));
  m.events.click();assert.equal(m.attrs['aria-pressed'],'false');
  assert.equal(m.store.get('freev.ui.density.v4'),'comfortable');
});
test('le mois affiché est formaté en français et les dates impossibles sont rejetées',()=>{
  const m=mock();assert.equal(m.label.textContent,'octobre 2026');
  m.month.value='2027-01';m.events['month-change']();
  assert.equal(m.label.textContent,'janvier 2027');
  for(const invalid of ['2026-00','2026-13','a','2026-2','']) assert.equal(m.win.FreevPremiumV4.periodLabel(invalid),'—');
});
test('le stockage désactivé n’empêche pas la consultation ni le changement de densité',()=>{
  const m=mock();
  assert.equal(m.win.FreevPremiumV4.readDensity({getItem(){throw Error('denied');}}),false);
  assert.doesNotThrow(()=>m.win.FreevPremiumV4.writeDensity({setItem(){throw Error('denied');}},true));
});
test('les filtres sont étiquetés et la recherche reste fonctionnelle',()=>{
  for(const id of ['txSearch','txTypeFilter','txModeFilter','txCategoryFilter','txMin','txMax'])
    assert.match(html,new RegExp(`id="${id}"[^>]+aria-label=|aria-label="[^"]+"[^>]+id="${id}"`));
  assert.match(html,/id="txSearch"[^>]*oninput="applyTxFilters\(true\)"/);
  assert.match(html,/id="premiumV4Period"/);
});
test('la lisibilité mobile, le mode sombre et le mouvement réduit sont prévus',()=>{
  for(const token of ['max-width:768px','max-width:430px','\.dark-mode','prefers-reduced-motion:reduce',':focus-visible'])
    assert.match(css,new RegExp(token));
});
test('le cache PWA contient exactement la nouvelle feuille et le nouveau script',()=>{
  assert.match(sw,/freev-v5\.2\.0-everyday-\d{8}-v\d+/);
  assert.match(sw,/\.\/assets\/css\/premium-v4\.css/);
  assert.match(sw,/\.\/assets\/js\/premium-v4\.js/);
});
test('les 4 indicateurs gardent leurs identifiants et restent calculés par le moteur historique',()=>{
  for(const id of ['cardBalance','totalIncome','totalExpenses','totalSavings']) assert.match(html,new RegExp(`id="${id}"`));
  for(const cls of ['balance','income','expense','savings']) assert.match(html,new RegExp(`premium-v4-stat-${cls}`));
});
