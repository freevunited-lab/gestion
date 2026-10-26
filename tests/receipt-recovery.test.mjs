import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceiptRecoveryBudget, shouldTryAlternateReceiptLayout } from '../assets/js/receipt-recovery.mjs';

test('le scan évite une seconde mise en page avant de redresser une photo largement illisible', () => {
  const missing = { amount: '', date: null, merchant: '' };
  assert.equal(shouldTryAlternateReceiptLayout(missing, 25, 1800, 900), false);
  assert.equal(shouldTryAlternateReceiptLayout(missing, 25, 900, 1800), false);
  assert.equal(shouldTryAlternateReceiptLayout({ amount: '12,40', date: '2026-10-25', merchant: '' }, 25, 900, 1800), true);
});

test('les lectures de secours sont plafonnées même en cas d’échec OCR', async () => {
  const calls = [];
  const worker = { recognize: async (image, options) => { calls.push({ image, options }); if (image === 'échec') throw new Error('OCR'); return { data: { text: image } }; } };
  const budget = createReceiptRecoveryBudget(2);
  assert.deepEqual((await budget.recognize(worker, 'premier')).data.text, 'premier');
  await assert.rejects(budget.recognize(worker, 'échec'), /OCR/);
  assert.equal(await budget.recognize(worker, 'troisième'), null);
  assert.equal(calls.length, 2);
  assert.equal(budget.remaining, 0);
});
