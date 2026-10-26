import { performance } from 'node:perf_hooks';
import { parseFrenchReceipt } from '../assets/js/receipt-scan-engine.mjs';

const ITERATIONS = 5_000;
const fixtures = [
  { name: 'ticket-net', text: 'AUCHAN\nDATE 14/02/2026\nTOTAL TTC 12,49 €', amountMinor: 1249, date: '2026-02-14' },
  { name: 'total-sur-ligne-suivante', text: 'LIDL\nDATE 14/02/2026\nNET A PAYER\n12,49 €', amountMinor: 1249, date: '2026-02-14' },
  { name: 'zero-lu-comme-O-dans-total', text: 'CARREFOUR\nDATE 14/02/2026\nT0TAL TTC 18,40 €', amountMinor: 1840, date: '2026-02-14' },
  { name: 'O-lu-comme-zero-dans-montant', text: 'AUCHAN\nDATE 14/02/2026\nNET A PAYER 1O,9O €', amountMinor: 1090, date: '2026-02-14' },
  { name: 'O-lu-comme-zero-dans-annee', text: 'LIDL\nDATE 14/02/2O26\nTOTAL TTC 5,80 €', amountMinor: 580, date: '2026-02-14' },
  { name: 'milliers-francais', text: 'AUCHAN\nDATE 14/02/2026\nTOTAL TTC 1 234,56 €', amountMinor: 123456, date: '2026-02-14' },
  { name: 'sous-total-ignore', text: 'AUCHAN\nDATE 14/02/2026\nSOUS-TOTAL 9,00 €\nNET A PAYER 11,00 €', amountMinor: 1100, date: '2026-02-14' },
  { name: 'date-impossible-rejetee', text: 'AUCHAN\nDATE 31/02/2026\nTOTAL TTC 12,49 €', amountMinor: 1249, date: null }
];

const start = performance.now();
const results = fixtures.map(fixture => {
  const parsed = parseFrenchReceipt(fixture.text);
  return {
    name: fixture.name,
    exact: parsed.amountMinor === fixture.amountMinor && parsed.date === fixture.date,
    amountExact: parsed.amountMinor === fixture.amountMinor,
    dateExact: parsed.date === fixture.date
  };
});
for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
  for (const fixture of fixtures) parseFrenchReceipt(fixture.text);
}
const elapsedMs = performance.now() - start;
const exactFixtures = results.filter(result => result.exact).length;

console.log(JSON.stringify({
  metric: 'exactitude montant + date sur corpus OCR synthétique; temps du parseur seul',
  fixtures: fixtures.length,
  exactFixtures,
  accuracy: `${exactFixtures}/${fixtures.length}`,
  baselineBeforeChange: { exactFixtures: 6, accuracy: '6/8', avgMsPerReceipt: 0.00587 },
  current: {
    iterations: ITERATIONS,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    avgMsPerReceipt: Number((elapsedMs / (fixtures.length * ITERATIONS)).toFixed(6)),
    results
  },
  note: 'Corpus déterministe de huit cas de contrôle, pas une mesure de précision sur des photos réelles.'
}, null, 2));
