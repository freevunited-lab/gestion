import test from 'node:test';
import assert from 'node:assert/strict';
import { findLikelyReceiptDuplicates } from '../assets/js/receipt-duplicate.mjs';

const receipt = { date: '2026-10-25', time: '12:42', merchant: 'E.Leclerc', amountMinor: 1249, currency: 'EUR' };

test('un ticket déjà saisi est signalé même si sa catégorie a changé', () => {
  const transactions = [
    { id: 'same', type: 'expense', date: '2026-10-25', time: '12:43', category: 'Loisirs', amountBase: 12.49, currency: 'EUR', desc: 'Courses · E.Leclerc' },
    { id: 'other-account-not-passed', type: 'expense', date: '2026-10-25', amountBase: 12.49, desc: 'Courses · E.Leclerc' }
  ];
  assert.deepEqual(findLikelyReceiptDuplicates(transactions, receipt, 'EUR', 1).map(item => item.id), ['same']);
});

test('deux achats distincts et les autres devises ne sont pas confondus', () => {
  const transactions = [
    { id: 'later', type: 'expense', date: '2026-10-25', time: '16:00', amountBase: 12.49, currency: 'EUR', desc: 'E.Leclerc' },
    { id: 'other-store', type: 'expense', date: '2026-10-25', time: '12:42', amountBase: 12.49, currency: 'EUR', desc: 'Auchan' },
    { id: 'other-day', type: 'expense', date: '2026-10-24', time: '12:42', amountBase: 12.49, currency: 'EUR', desc: 'E.Leclerc' },
    { id: 'income', type: 'income', date: '2026-10-25', time: '12:42', amountBase: 12.49, currency: 'EUR', desc: 'E.Leclerc' },
    { id: 'other-currency', type: 'expense', date: '2026-10-25', time: '12:42', originalAmount: 12.49, amountBase: 11.1, currency: 'USD', desc: 'E.Leclerc' }
  ];
  assert.deepEqual(findLikelyReceiptDuplicates(transactions, receipt, 'EUR'), []);
  const legacyForeign = [{ id: 'legacy', type: 'expense', date: receipt.date, time: receipt.time, amount: 12.49, currency: 'USD', desc: 'E.Leclerc' }];
  assert.deepEqual(findLikelyReceiptDuplicates(legacyForeign, { ...receipt, currency: 'USD' }, 'EUR'), []);
});

test('un ticket sans heure prévient sans bloquer et compare les unités d’origine', () => {
  const transactions = [
    { id: 'foreign', type: 'expense', date: '2026-10-25', originalAmount: 12.49, amountBase: 11.2, currency: 'USD', desc: 'Magasin Auchan' }
  ];
  const candidate = { date: '2026-10-25', merchant: 'Auchan', amountMinor: 1249, currency: 'USD' };
  assert.deepEqual(findLikelyReceiptDuplicates(transactions, candidate, 'EUR').map(item => item.id), ['foreign']);
  assert.deepEqual(findLikelyReceiptDuplicates(transactions, { ...candidate, amountMinor: 0 }, 'EUR'), []);
});

test('un remboursement est comparé aux revenus, jamais aux dépenses', () => {
  const entries = [
    { id: 'purchase', type: 'expense', date: receipt.date, amountBase: 12.49, currency: 'EUR', desc: 'E.Leclerc' },
    { id: 'refund', type: 'income', date: receipt.date, amountBase: 12.49, currency: 'EUR', desc: 'Remboursement · E.Leclerc' }
  ];
  assert.deepEqual(findLikelyReceiptDuplicates(entries, { ...receipt, type: 'income' }, 'EUR').map(item => item.id), ['refund']);
});
