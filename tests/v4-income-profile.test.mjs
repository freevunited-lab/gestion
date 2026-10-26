import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/v4.js', import.meta.url), 'utf8');
const start = source.indexOf('function medianInteger(values) {');
const end = source.indexOf('function renderIncomeProfile(', start);
const modelSource = source.slice(start, end);

function profileFor(account) {
  const context = vm.createContext({
    incomeProfileMonths: () => ['2026-09'],
    parseAmount: value => ({ ok: true, minor: Math.round(Number(value) * 100) })
  });
  vm.runInContext(modelSource, context);
  return context.incomeProfileFor(account);
}

test('la limite de cumul des revenus est transmise au rendu du profil', () => {
  const model = profileFor({
    settings: { baseCurrency: 'EUR' },
    plannerSettings: { incomeProfile: { coverageByMonth: { '2026-09': true } } },
    transactions: [
      { date: '2026-09-03', type: 'expense', amountBase: Number.MAX_SAFE_INTEGER },
      { date: '2026-09-04', type: 'expense', amountBase: Number.MAX_SAFE_INTEGER }
    ]
  });

  assert.equal(model.invalidCovered, true);
  assert.equal(model.suggested, null);
});

test('un mois couvert valide expose explicitement l’absence de dépassement', () => {
  const model = profileFor({
    settings: { baseCurrency: 'EUR' },
    plannerSettings: { incomeProfile: { coverageByMonth: { '2026-09': true } } },
    transactions: [{ date: '2026-09-03', type: 'income', incomeClass: 'regular', amountBase: 1200 }]
  });

  assert.equal(model.invalidCovered, false);
  assert.equal(model.suggested, 96000);
});
