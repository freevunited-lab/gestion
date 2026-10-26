// Mesures non bloquantes : exécuter avec npm run benchmark:projection.
import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
const source = fs.readFileSync(new URL('../assets/js/core.js', import.meta.url), 'utf8');
const projection = source.slice(source.indexOf('function getProjectedRecurringTransactions(month, txList = null) {'), source.indexOf('function getProjectedLookupMonths()'));
const metrics=[];
for (const transactionsCount of [3000,10000,25000]) {
  const rules=Array.from({length:120},(_,i)=>({id:`r${i}`,frequency:'monthly'}));
  const transactions=Array.from({length:transactionsCount},(_,i)=>({id:`tx${i}`,parentId:`r${i%120}`,periodKey:`2026-${String(1+(Math.floor(i/120)%12)).padStart(2,'0')}`,date:'2026-01-15'}));
  const context=vm.createContext({
    multiViewMode:'individual',currentAccountId:'main',transactions,recurringTransactions:rules,
    getToday:()=>new Date('2026-10-21'),isoMonth:()=> '2026-10',isoDate:()=> '2026-10-21',
    getDisplayRecurringRules:()=>rules, getDisplayTransactions:()=>transactions,
    recurringDatesForMonth:()=>['2026-11-15'], periodKey:date=>date.slice(0,7),
    isRecurringPeriodSkipped:()=>false, buildRecurringOccurrence:(r,date)=>({parentId:r.id,date})
  });
  vm.runInContext(projection,context);
  const durations=[];
  for (let i=0;i<9;i++) {
    const start=performance.now();
    context.getProjectedRecurringTransactions('2026-11');
    durations.push(performance.now()-start);
  }
  durations.shift();durations.sort((a,b)=>a-b);
  metrics.push({transactions:transactionsCount,rules:rules.length,medianMs:Math.round((durations[3]+durations[4])/2*100)/100,
    maxMs:Math.round(durations.at(-1)*100)/100});
}
console.table(metrics);
console.log('Résultats indicatifs sur ce processeur ; pas de navigateur ni de Firebase.');
