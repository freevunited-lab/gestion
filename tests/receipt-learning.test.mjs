import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptLearningKey, learnMerchantCorrection, suggestMerchantCorrection } from '../assets/js/receipt-learning.mjs';

test('une correction validée deux fois enseigne une enseigne par compte', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const key = receiptLearningKey('user-1', 'account-1');
  const other = receiptLearningKey('user-1', 'account-2');
  assert.equal(learnMerchantCorrection(storage, key, 'Auch4n', 'Auchan'), true);
  assert.equal(suggestMerchantCorrection(storage, key, 'AUCH4N'), null);
  assert.equal(learnMerchantCorrection(storage, key, 'Auch4n', 'Auchan'), true);
  assert.equal(suggestMerchantCorrection(storage, key, 'AUCH4N'), 'Auchan');
  assert.equal(suggestMerchantCorrection(storage, other, 'AUCH4N'), null);
  assert.equal(learnMerchantCorrection(storage, key, 'Auch4n', 'Autre magasin'), true);
  assert.equal(suggestMerchantCorrection(storage, key, 'AUCH4N'), null);
});

test('les libellés génériques et les noms identiques ne sont pas mémorisés', () => {
  const storage = { getItem: () => null, setItem: () => assert.fail('aucune écriture attendue') };
  assert.equal(learnMerchantCorrection(storage, 'key', 'Ticket', 'Auchan'), false);
  assert.equal(learnMerchantCorrection(storage, 'key', 'Auchan', 'AUCHAN'), false);
  assert.equal(suggestMerchantCorrection(storage, 'key', 'Ticket'), null);
});
