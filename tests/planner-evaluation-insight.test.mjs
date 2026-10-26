import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlannerEvaluationInsight } from '../assets/js/planner-evaluation-insight.mjs';

test('reports transaction coverage without presenting transactions as historical balance snapshots', () => {
  const accounts = [{
    id: 'checking',
    settings: { baseCurrency: 'EUR' },
    transactions: [
      { id: '1', date: '2025-09-01', type: 'income', amount: 1200 },
      { id: '2', date: '2025-10-12', type: 'expense', amount: 125.4 },
      { id: '3', date: '2025-11-05', type: 'expense', amount: 20, paymentStatus: 'planned' },
      { id: '4', date: '2025-11-06', type: 'expense', amount: 20, projected: true },
      { id: '5', date: 'bad-date', type: 'expense', amount: 20 }
    ]
  }];

  const insight = buildPlannerEvaluationInsight(accounts);

  assert.equal(insight.status, 'unavailable');
  assert.equal(insight.observedTransactionCount, 2);
  assert.equal(insight.invalidDatedTransactionCount, 1);
  assert.equal(insight.activeMonthCount, 2);
  assert.equal(insight.firstTransactionDate, '2025-09-01');
  assert.equal(insight.lastTransactionDate, '2025-10-12');
  assert.equal(insight.observationKind, 'transactions-only');
  assert.match(insight.detail, /soldes passés/i);
  assert.doesNotMatch(insight.detail, /\d+\s*%|confiance de \d+/i);
});

test('connects ALX 08 and 09 but explicitly returns no sample and no probability claim', () => {
  const insight = buildPlannerEvaluationInsight([{ id: 'empty', transactions: [] }]);

  assert.deepEqual(insight.evaluation.map(row => row.horizonDays), [7, 30, 90]);
  assert.ok(insight.evaluation.every(row => row.sampleCount === 0 && row.pointCount === 0 && row.maeMinor === null));
  assert.equal(insight.calibration.status, 'uncalibrated');
  assert.equal(insight.calibration.reason, 'insufficient-samples');
  assert.equal(insight.calibration.claimedCoveragePercent, null);
  assert.equal(insight.probabilityClaim, null);
});

test('does not mutate account data and handles malformed account collections safely', () => {
  const account = { id: 'a', transactions: [{ id: 'x', date: '2026-01-01', amount: 2, type: 'expense' }] };
  const before = structuredClone(account);

  const insight = buildPlannerEvaluationInsight([account, null, { transactions: 'invalid' }]);

  assert.deepEqual(account, before);
  assert.equal(insight.observedTransactionCount, 1);
  assert.equal(insight.activeMonthCount, 1);
});
