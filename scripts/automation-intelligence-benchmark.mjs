// Évalue la qualité et le coût des suggestions de règles sur un corpus synthétique reproductible.
// Les étiquettes sont connues pour comparer les résultats; ce n'est pas une mesure de données réelles.
import { performance } from 'node:perf_hooks';
import { applyAutomationRules, merchantKey, normalizeText, suggestAutomationRules } from '../assets/js/v5-engine.js';

function legacySuggestAutomationRules(transactions) {
  const groups = new Map();
  (transactions || []).forEach(transaction => {
    if (!transaction?.desc || !transaction?.category || transaction.category === 'À classer') return;
    const key = merchantKey(transaction);
    if (key.length < 3) return;
    const group = groups.get(key) || { merchant: key, total: 0, categories: {} };
    group.total += 1;
    group.categories[transaction.category] = (group.categories[transaction.category] || 0) + 1;
    groups.set(key, group);
  });
  return [...groups.values()].map(group => {
    const [category, count] = Object.entries(group.categories).sort((a, b) => b[1] - a[1])[0] || [];
    return { contains: group.merchant, category, count, confidence: group.total ? Math.round((count / group.total) * 100) : 0 };
  }).filter(suggestion => suggestion.count >= 2 && suggestion.confidence >= 70).sort((a, b) => b.count - a.count).slice(0, 12);
}

const training = [
  ...Array.from({ length: 5 }, (_, index) => ({ desc: `CB CARREFOUR ${index + 10}`, merchant: 'Carrefour', type: 'expense', category: 'Alimentation' })),
  { desc: 'REMBOURSEMENT CARREFOUR', merchant: 'Carrefour', type: 'income', category: 'Remboursements' },
  ...Array.from({ length: 4 }, (_, index) => ({ desc: `CB LIDL ${index + 20}`, merchant: 'Lidl', type: 'expense', category: 'Alimentation' })),
  { desc: 'CB LIDL 99', merchant: 'Lidl', type: 'expense', category: 'Autre', automationRuleId: 'existing-rule' },
  { desc: 'AMAZON ACHAT A', merchant: 'Amazon', type: 'expense', category: 'Maison' },
  { desc: 'AMAZON ACHAT B', merchant: 'Amazon', type: 'expense', category: 'Maison' },
  { desc: 'AMAZON PRIME A', merchant: 'Amazon', type: 'expense', category: 'Abonnements' },
  { desc: 'AMAZON PRIME B', merchant: 'Amazon', type: 'expense', category: 'Abonnements' },
  ...Array.from({ length: 3 }, (_, index) => ({ desc: `VIREMENT ${index}`, merchant: 'Transit', type: 'transfer', category: 'Transport' })),
  { desc: 'ACHAT DECA 1', merchant: 'Decathlon', type: 'expense', category: 'Sport' },
  { desc: 'CB PAIEMENT 123', type: 'expense', category: 'Autre' }
];
const holdout = [
  { id: 'cf-expense-1', desc: 'CB CARREFOUR 400', merchant: 'Carrefour', type: 'expense', category: 'Alimentation' },
  { id: 'cf-expense-2', desc: 'CB CARREFOUR 401', merchant: 'Carrefour', type: 'expense', category: 'Alimentation' },
  { id: 'cf-income', desc: 'REMBOURSEMENT CARREFOUR', merchant: 'Carrefour', type: 'income', category: 'Remboursements' },
  { id: 'lidl-expense', desc: 'CB LIDL 402', merchant: 'Lidl', type: 'expense', category: 'Alimentation' },
  { id: 'amazon-ambiguous', desc: 'AMAZON ACHAT C', merchant: 'Amazon', type: 'expense', category: 'Maison' }
];

function matchedRules(transactions, suggestions) {
  return transactions.map(transaction => {
    const suggestion = suggestions.find(rule =>
      (!rule.matchType || rule.matchType === transaction.type) &&
      normalizeText([transaction.desc, transaction.merchant, transaction.category].join(' ')).includes(normalizeText(rule.contains))
    );
    return { transaction, predicted: suggestion?.category || null };
  }).filter(row => row.predicted !== null);
}

const oldSuggestions = legacySuggestAutomationRules(training);
const newSuggestions = suggestAutomationRules(training);
const score = suggestions => {
  const rows = matchedRules(holdout, suggestions);
  return { suggestions: suggestions.length, covered: rows.length, correct: rows.filter(row => row.predicted === row.transaction.category).length,
    precisionPercent: rows.length ? Math.round(rows.filter(row => row.predicted === row.transaction.category).length / rows.length * 100) : 0 };
};
const oldQuality = score(oldSuggestions);
const newQuality = score(newSuggestions);
if (JSON.stringify(newSuggestions.map(({ contains, category, matchType }) => ({ contains, category, matchType }))) !== JSON.stringify([
  { contains: 'carrefour', category: 'Alimentation', matchType: 'expense' },
  { contains: 'lidl', category: 'Alimentation', matchType: 'expense' }
])) throw new Error(`Résultat de suggestion inattendu : ${JSON.stringify(newSuggestions)}`);
if (newQuality.precisionPercent <= oldQuality.precisionPercent) throw new Error('La précision hors échantillon ne s’améliore pas sur le corpus synthétique.');
const safeApplication = applyAutomationRules(holdout, newSuggestions.map(rule => ({ id: 'suggested', ...rule })));
if (safeApplication.transactions.find(transaction => transaction.id === 'cf-income')?.category !== 'Remboursements')
  throw new Error('Une suggestion dépense a modifié un revenu.');

function workloadOf(size) {
  return Array.from({ length: size }, (_, index) => {
    const vendor = index % 50;
    return {
      desc: `CB MARCHAND ${vendor} OPERATION ${index}`,
      merchant: `Marchand ${vendor}`,
      type: index % 8 === 0 ? 'income' : 'expense',
      category: index % 17 === 0 ? 'Autre' : 'Courses',
      ...(index % 11 === 0 ? { automationRuleId: 'r-existing' } : {})
    };
  });
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
function measure(fn, workload) {
  fn(workload);
  return median(Array.from({ length: 7 }, () => {
    const start = performance.now();
    fn(workload);
    return performance.now() - start;
  }));
}
console.table([
  { version: 'Avant', ...oldQuality },
  { version: 'Actuelle', ...newQuality }
]);
const performanceRows = [];
for (const size of [4_000, 100_000]) {
  const workload = workloadOf(size);
  const legacyMs = measure(legacySuggestAutomationRules, workload);
  const currentMs = measure(suggestAutomationRules, workload);
  performanceRows.push({ lignes: size, avantMs: +legacyMs.toFixed(2), actuelMs: +currentMs.toFixed(2), ratio: +(currentMs / legacyMs).toFixed(2) });
}
console.table(performanceRows);
console.log('Médianes de 7 passes après préchauffage; corpus de qualité et volume de performance synthétiques, fixés dans le script.');
