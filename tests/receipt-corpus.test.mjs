import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrenchReceipt } from '../assets/js/receipt-scan-engine.mjs';

// Transcriptions de référence synthétiques et anonymes. Remplacer/compléter
// avec des tickets réels consentis pour mesurer la précision en conditions réelles.
const cases = [
  { name: 'courses TVA', text: 'AUCHAN\nDATE 14/02/2026 12:42\nTVA 3,20\nTOTAL TTC 23,45 €\nCARTE 23,45 €', expected: { merchant: 'Auchan', amount: '23,45', date: '2026-02-14', time: '12:42' } },
  { name: 'net à payer', text: 'LIDL\n25/10/2026\nSOUS-TOTAL 8,20\nNET A PAYER 9,90 €', expected: { merchant: 'Lidl', amount: '9,90', date: '2026-10-25', time: null } },
  { name: 'date ISO', text: 'CARREFOUR\n2026-03-05 09h07\nTOTAL 5,80 EUR', expected: { merchant: 'Carrefour', amount: '5,80', date: '2026-03-05', time: '09:07' } },
  { name: 'pharmacie', text: 'PHARMACIE DU CENTRE\nDATE 07/05/2026\nTOTAL TTC 12,10 €', expected: { merchant: 'Pharmacie', amount: '12,10', date: '2026-05-07', time: null } },
  { name: 'carburant', text: 'SHELL\nDATE 03/06/2026\nMONTANT A PAYER 52,40 €', expected: { merchant: 'Shell', amount: '52,40', date: '2026-06-03', time: null } },
  { name: 'OCR zéro', text: 'AUCHAN\nDATE 14/02/2O26\nNET A PAYER 1O,9O €', expected: { merchant: 'Auchan', amount: '10,90', date: '2026-02-14', time: null } },
  { name: 'année courte', text: 'ALDI\nDATE 01/12/26\nTOTAL TTC 3,50 €', expected: { merchant: 'Aldi', amount: '3,50', date: '2026-12-01', time: null } },
  { name: 'heure séparée', text: 'FNAC\nDATE 08/09/2026\nHEURE 18:32\nTOTAL TTC 79,99 €', expected: { merchant: 'Fnac', amount: '79,99', date: '2026-09-08', time: '18:32' } },
  { name: 'ticket incomplet', text: 'LIDL\nDATE 25/10/2026\nMERCI DE VOTRE VISITE', expected: { merchant: 'Lidl', amount: '', date: '2026-10-25', time: null } },
  { name: 'date impossible', text: 'AUCHAN\nDATE 31/02/2026\nTOTAL TTC 19,20 €', expected: { merchant: 'Auchan', amount: '19,20', date: null, time: null } }
];

test('corpus OCR de référence : montant, date, heure et magasin restent mesurés séparément', () => {
  const counts = { merchant: 0, amount: 0, date: 0, time: 0 };
  for (const sample of cases) {
    const parsed = parseFrenchReceipt(sample.text);
    for (const field of Object.keys(counts)) {
      if (parsed[field] === sample.expected[field]) counts[field]++;
      else assert.fail(`${sample.name} : ${field} attendu ${sample.expected[field]}, obtenu ${parsed[field]}`);
    }
  }
  assert.deepEqual(counts, { merchant: cases.length, amount: cases.length, date: cases.length, time: cases.length });
});
