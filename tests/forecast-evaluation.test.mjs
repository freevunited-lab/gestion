import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrateForecastMargin, predictionInterval, walkForwardBacktest } from '../assets/js/forecast-evaluation.mjs';

const day = iso => new Date(`${iso}T00:00:00Z`);
const iso = date => date.toISOString().slice(0, 10);
const shift = (date, offset) => {
  const value = day(date);
  value.setUTCDate(value.getUTCDate() + offset);
  return iso(value);
};
const series = (from, through, balance = () => 10_000) => {
  const result = [];
  for (let date = from; date <= through; date = shift(date, 1)) result.push({ date, balanceMinor: balance(date) });
  return result;
};

test('ALX 08 : chaque prévision reçoit seulement les observations connues à sa date', () => {
  const rows = series('2026-01-01', '2026-04-15');
  const result = walkForwardBacktest({
    observations: rows,
    origins: ['2026-01-01'],
    horizons: [7, 30, 90],
    method: 'constant',
    version: '1',
    forecast: ({ history, asOf, targetDates }) => {
      assert.ok(history.every(row => row.date <= asOf));
      assert.deepEqual(history.at(-1), rows.find(row => row.date === asOf));
      assert.ok(targetDates.every(date => date > asOf));
      return { points: targetDates.map(date => ({ date, balanceMinor: 10_000 })) };
    }
  });
  assert.deepEqual(result.map(item => item.horizonDays), [7, 30, 90]);
  assert.ok(result.every(item => item.sampleCount === 1));
  assert.ok(result.every(item => item.absoluteErrorMinor === 0));
  assert.ok(result.every(item => item.method === 'constant' && item.version === '1'));
});

test('ALX 08 : MAE reste en unités monétaires entières et les manques de trésorerie sont mesurés', () => {
  const rows = series('2026-01-01', '2026-01-08', date => date === '2026-01-03' ? -5_000 : date === '2026-01-04' ? -2_000 : 10_000);
  const [result] = walkForwardBacktest({
    observations: rows,
    origins: ['2026-01-01'],
    horizons: [7],
    method: 'test',
    version: 'v1',
    forecast: ({ targetDates }) => ({ points: targetDates.map(date => ({ date, balanceMinor: 1_000 })) })
  });
  assert.equal(result.absoluteErrorMinor, 54_000);
  assert.deepEqual(result.maeMinor, { numerator: 54_000, denominator: 7 });
  assert.equal(result.missedShortfallOrigins, 1);
  assert.equal(result.missedShortfallDays, 2);
  assert.equal(result.missedShortfallAmountMinor, 7_000);
  assert.equal(result.unjustifiedAlertOrigins, 0);
});

test('ALX 08 : une alerte prédite sans manque réel est comptée comme injustifiée', () => {
  const rows = series('2026-01-01', '2026-01-08');
  const [result] = walkForwardBacktest({
    observations: rows,
    origins: ['2026-01-01'],
    horizons: [7],
    method: 'positive',
    version: 'v1',
    forecast: ({ targetDates }) => ({ points: targetDates.map((date, index) => ({ date, balanceMinor: index === 2 ? -1 : 10_000 })) })
  });
  assert.equal(result.unjustifiedAlertOrigins, 1);
  assert.equal(result.missedShortfallOrigins, 0);
});

test('ALX 08 : une fenêtre future incomplète est exclue et explicitement comptée', () => {
  const rows = series('2026-01-01', '2026-01-05');
  const [result] = walkForwardBacktest({
    observations: rows,
    origins: ['2026-01-01'],
    horizons: [7],
    method: 'positive',
    version: 'v1',
    forecast: () => assert.fail('une fenêtre sans historique futur complet ne doit pas être simulée')
  });
  assert.equal(result.sampleCount, 0);
  assert.deepEqual(result.excludedOrigins, [{ date: '2026-01-01', reason: 'incomplete-actual-window' }]);
  assert.equal(result.maeMinor, null);
});

test('ALX 08 : dates, doublons de dates et soldes hors limites sont refusés', () => {
  const options = { horizons: [7], method: 'test', version: 'v1', forecast: () => ({ points: [] }) };
  assert.throws(() => walkForwardBacktest({ ...options, observations: [{ date: '2026-02-30', balanceMinor: 0 }], origins: [] }), /date/i);
  assert.throws(() => walkForwardBacktest({ ...options, observations: [{ date: '2026-01-01', balanceMinor: 0 }, { date: '2026-01-01', balanceMinor: 1 }], origins: [] }), /unique/i);
  assert.throws(() => walkForwardBacktest({ ...options, observations: [{ date: '2026-01-01', balanceMinor: Number.MAX_SAFE_INTEGER + 1 }], origins: [] }), /invalide/i);
});

test('ALX 08 : une prévision invalide ne devient pas un résultat financier', () => {
  assert.throws(() => walkForwardBacktest({
    observations: series('2026-01-01', '2026-01-08'),
    origins: ['2026-01-01'],
    horizons: [7],
    method: 'invalid',
    version: 'v1',
    forecast: ({ targetDates }) => ({ points: targetDates.map(date => ({ date, balanceMinor: 'inconnu' })) })
  }), /prévision invalide/i);
});

test('ALX 09 : marge split-conformal et couverture mesurée sur un échantillon distinct', () => {
  const result = calibrateForecastMargin({
    calibrationErrorsMinor: Array.from({ length: 30 }, (_, index) => index),
    validationErrorsMinor: Array.from({ length: 30 }, (_, index) => index % 30),
    targetCoveragePercent: 80
  });
  assert.equal(result.status, 'calibrated');
  assert.equal(result.marginMinor, 24);
  assert.equal(result.claimedCoveragePercent, 80);
  assert.deepEqual(result.validationCoverage, { covered: 25, total: 30 });
  assert.equal(result.calibrationSampleCount, 30);
  assert.equal(result.validationSampleCount, 30);
});

test('ALX 09 : marge non calibrée et aucune promesse si les échantillons sont trop faibles', () => {
  const result = calibrateForecastMargin({ calibrationErrorsMinor: [1, 2], validationErrorsMinor: [1, 2] });
  assert.equal(result.status, 'uncalibrated');
  assert.equal(result.reason, 'insufficient-samples');
  assert.equal(result.marginMinor, null);
  assert.equal(result.claimedCoveragePercent, null);
});

test('ALX 09 : une couverture de validation insuffisante retire la marge annoncée', () => {
  const result = calibrateForecastMargin({
    calibrationErrorsMinor: Array.from({ length: 40 }, (_, index) => index),
    validationErrorsMinor: Array(40).fill(10_000),
    targetCoveragePercent: 80
  });
  assert.equal(result.status, 'uncalibrated');
  assert.equal(result.reason, 'holdout-coverage-outside-tolerance');
  assert.equal(result.marginMinor, null);
  assert.equal(result.claimedCoveragePercent, null);
  assert.deepEqual(result.validationCoverage, { covered: 0, total: 40 });
});

test('ALX 09 : une fourchette est fournie seulement avec une marge validée', () => {
  const calibration = calibrateForecastMargin({
    calibrationErrorsMinor: Array.from({ length: 30 }, (_, index) => index),
    validationErrorsMinor: Array.from({ length: 30 }, (_, index) => index)
  });
  assert.deepEqual(predictionInterval(10_000, calibration), {
    status: 'calibrated', lowerMinor: 9_976, upperMinor: 10_024, claimedCoveragePercent: 80,
    validationCoverage: { covered: 25, total: 30 }, calibrationSampleCount: 30, validationSampleCount: 30
  });
  assert.deepEqual(predictionInterval(10_000, { status: 'uncalibrated', marginMinor: null }), {
    status: 'uncalibrated', lowerMinor: null, upperMinor: null, claimedCoveragePercent: null
  });
});

test('ALX 09 : montants d’erreur invalides et paramètres de calibration incohérents sont refusés', () => {
  assert.throws(() => calibrateForecastMargin({ calibrationErrorsMinor: [-1], validationErrorsMinor: [] }), /erreur/i);
  assert.throws(() => calibrateForecastMargin({ calibrationErrorsMinor: [], validationErrorsMinor: [], targetCoveragePercent: 100 }), /couverture/i);
});
