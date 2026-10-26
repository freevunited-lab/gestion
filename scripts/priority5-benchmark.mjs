// Comparaison reproductible du moteur complet de la version précédente
// avec le moteur optimisé. Benchmarks Node seulement, sans navigateur/Firebase.
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import { financeOverview as before } from './benchmarks/finance-priority2-engine-baseline.mjs';
import { financeOverview as after } from '../assets/js/finance-priority2-engine.mjs';
import { legacyFinanceProjection } from './benchmarks/finance-priority2-parity.mjs';

const reference = { today:'2026-10-21', month:'2026-10', months:6 };
const sizes = [3000, 10000, 25000];
function data(n) {
  const rules = Array.from({ length:120 }, (_, index)=> ({
    id:`r${index}`, startDate:'2026-01-12', dayOfMonth:12, frequency:'monthly',
    type:'expense', amountBase:10.20, category:'Abonnements', desc:`Abonnement ${index}`
  }));
  const transactions = Array.from({ length:n }, (_, i)=> ({
    id:`t${i}`, date:`2026-${String(i % 10 + 1).padStart(2,'0')}-${String(i % 28 + 1).padStart(2,'0')}`,
    type:i%5 === 0 ? 'income':'expense', amountBase:(i%90)+0.15,
    category:i%3 ? 'Courses':'Abonnements', desc:`Transaction ${i}`, paymentStatus:'paid',
    // Lien réel avec une série pour exercer les alertes de hausse
    ...(i%7===0 ? {parentId:`r${i%120}`} : {})
  }));
  return [{id:'main',name:'Principal', initialCapital:2500,
    budgetsByCategory:{Courses:650,Abonnements:850},transactions,recurringTransactions:rules}];
}
function median(values) {const s=values.slice().sort((a,b)=>a-b); return s[Math.floor(s.length/2)];}
function measure(fn,accounts) {
  for(let i=0;i<2;i++) fn(accounts,reference);
  const times=[];
  for(let i=0;i<9;i++) {const now=performance.now();fn(accounts,reference);times.push(performance.now()-now);}
  return median(times);
}
const table=[];
for(const size of sizes) {
  const accounts=data(size);
  const b=before(accounts,reference), a=after(accounts,reference);
  if(JSON.stringify(legacyFinanceProjection(b))!==JSON.stringify(legacyFinanceProjection(a))) {
    console.error(`Résultats différents pour ${size} transactions`);
    process.exitCode=1;
    break;
  }
  // Alternance pour réduire l'avantage lié aux fluctuations de fréquence CPU.
  const baselineMs=measure(before,accounts);
  const optimizedMs=measure(after,accounts);
  table.push({transactions:size,regles:120,avantMs:+baselineMs.toFixed(2),apresMs:+optimizedMs.toFixed(2),
    gain:+(baselineMs/optimizedMs).toFixed(2), identiques:true});
}
console.table(table);
console.log('Médianes de 9 passes après préchauffage, Node local, sans UI ni réseau.');

// Un second microbenchmark cible le formatage des lignes du tableau.
const amounts=Array.from({length:15000},(_,i)=>i/3+0.17);
const oldFormat = amount => new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:2}).format(amount);
const sharedFormatter = new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:2});
const newFormat = amount => sharedFormatter.format(amount);
function measureFormatting(fn) {
  const times=[];
  for(let i=0;i<7;i++) {
    const start=performance.now();
    const outputs=amounts.map(fn);
    if(outputs.length!==amounts.length) throw Error('Formatage incomplet');
    times.push(performance.now()-start);
  }
  return median(times);
}
const oldTime=measureFormatting(oldFormat), newTime=measureFormatting(newFormat);
console.table([{formatages:amounts.length,avantMs:+oldTime.toFixed(2),apresMs:+newTime.toFixed(2),gain:+(oldTime/newTime).toFixed(2)}]);

// Le rendu du cockpit calcule une empreinte à chaque affichage pour décider
// si son cache peut être réutilisé. Mesurer cette partie du vrai chemin UI aussi.
const v5Source = fs.readFileSync(new URL('../assets/js/v5.js', import.meta.url), 'utf8');
const revisionStart = v5Source.indexOf('function ruleTransactionRevision(account) {');
const revisionEnd = v5Source.indexOf('window.freevTransactionRevision = ruleTransactionRevision;', revisionStart);
const currentTransactionRevision = new Function(`${v5Source.slice(revisionStart, revisionEnd)}\nreturn ruleTransactionRevision;`)();
function oldTransactionRevision(account) {
  const rows = [...(account?.transactions || [])]
    .map(transaction => [String(transaction?.id || ''), JSON.stringify(transaction)])
    .sort((left, right) => left[0].localeCompare(right[0], 'fr'));
  const source = JSON.stringify(rows);
  let first = 0x811c9dc5, second = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${rows.length}:${first.toString(16)}:${second.toString(16)}`;
}
function measureRevision(fn, account) {
  for (let i = 0; i < 2; i += 1) fn(account);
  const times = [];
  for (let i = 0; i < 9; i += 1) {
    const start = performance.now();
    fn(account);
    times.push(performance.now() - start);
  }
  return median(times);
}
const revisionAccount = data(25000)[0];
const oldRevisionMs = measureRevision(oldTransactionRevision, revisionAccount);
const newRevisionMs = measureRevision(currentTransactionRevision, revisionAccount);
console.table([{operations:revisionAccount.transactions.length,
  avantMs:+oldRevisionMs.toFixed(2),apresMs:+newRevisionMs.toFixed(2),gain:+(oldRevisionMs/newRevisionMs).toFixed(2)}]);
