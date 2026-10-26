// FREEV Gestion — Planner's honest history/readiness insight for CDC ALX 08–09.
// The current account store contains transactions and a mutable opening balance,
// but no immutable dated balance snapshots or transaction-entry timestamps.
// Consequently, it cannot produce a leakage-safe retrospective balance sample.

import {
  calibrateForecastMargin,
  walkForwardBacktest
} from './forecast-evaluation.mjs';

const HORIZONS = Object.freeze([7, 30, 90]);
const METHOD = 'snapshot-backed-cash-balance';
const VERSION = 'freev-planner-evaluation-readiness-v1';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function collectTransactionCoverage(accounts) {
  const observations = [];
  let invalidDatedTransactionCount = 0;

  for (const account of Array.isArray(accounts) ? accounts : []) {
    for (const transaction of Array.isArray(account?.transactions) ? account.transactions : []) {
      if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) continue;
      if (transaction.paymentStatus === 'planned' || transaction.projected || transaction.isRecurring || transaction.parentId) continue;
      if (!isValidDate(transaction.date)) {
        invalidDatedTransactionCount += 1;
        continue;
      }
      observations.push(transaction.date);
    }
  }

  const dates = observations.sort();
  return {
    observedTransactionCount: dates.length,
    invalidDatedTransactionCount,
    firstTransactionDate: dates[0] || null,
    lastTransactionDate: dates.at(-1) || null,
    activeMonthCount: new Set(dates.map(date => date.slice(0, 7))).size
  };
}

/**
 * Build a user-facing evaluation status without converting transaction flows
 * into imaginary balances. The ALX evaluator is deliberately given no balance
 * observations until the application has immutable, dated actual balances.
 */
export function buildPlannerEvaluationInsight(accounts) {
  const coverage = collectTransactionCoverage(accounts);
  const evaluation = walkForwardBacktest({
    observations: [],
    horizons: HORIZONS,
    forecast: () => ({ points: [] }),
    method: METHOD,
    version: VERSION
  });
  const calibration = calibrateForecastMargin({
    calibrationErrorsMinor: [],
    validationErrorsMinor: []
  });

  const transactionLabel = `${coverage.observedTransactionCount.toLocaleString('fr-FR')} opération${coverage.observedTransactionCount > 1 ? 's' : ''} réglée${coverage.observedTransactionCount > 1 ? 's' : ''}`;
  const monthLabel = `${coverage.activeMonthCount.toLocaleString('fr-FR')} mois avec activité`;
  const qualityNote = coverage.invalidDatedTransactionCount
    ? ` ${coverage.invalidDatedTransactionCount.toLocaleString('fr-FR')} opération${coverage.invalidDatedTransactionCount > 1 ? 's' : ''} sans date valide a${coverage.invalidDatedTransactionCount > 1 ? 'ont' : ''} été écartée${coverage.invalidDatedTransactionCount > 1 ? 's' : ''}.`
    : '';
  const detail = coverage.observedTransactionCount
    ? `${transactionLabel} · ${monthLabel}. Pas de soldes passés datés : la précision des prévisions et les probabilités ne peuvent pas être vérifiées.${qualityNote}`
    : `Aucune opération réglée datée. Sans soldes passés datés, la précision des prévisions ne peut pas être vérifiée.${qualityNote}`;

  return Object.freeze({
    status: 'unavailable',
    reason: 'no-historical-balance-snapshots',
    headline: 'Précision non mesurable',
    detail,
    observationKind: 'transactions-only',
    ...coverage,
    method: METHOD,
    version: VERSION,
    evaluation,
    calibration,
    probabilityClaim: null
  });
}
