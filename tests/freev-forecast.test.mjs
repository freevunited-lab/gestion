// Backtesting du noyau sur un monde synthétique. Lancer : node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLedger } from '../assets/js/freev-algorithm.mjs';
import { walkForwardBacktest, predictionInterval } from '../assets/js/forecast-evaluation.mjs';
import { dailyBalances, ledgerForecaster, naiveForecaster, driftForecaster, finalDayErrors, calibrateHorizon, cashflowRiskInsights } from '../assets/js/freev-forecast.mjs';

const OPENING = '2023-01-01', THROUGH = '2024-12-31';
const RATE_CHANGE = { effectiveFrom: '2024-06-15', amountMinor: 1900 };
const salary = { id: 'salary', accountId: 'A', startDate: '2023-01-28', frequency: 'monthly', type: 'income', amountMinor: 250000 };
const rent = { id: 'rent', accountId: 'A', startDate: '2023-01-05', frequency: 'monthly', type: 'expense', amountMinor: 80000 };
const subscription = { id: 'sub', accountId: 'A', startDate: '2023-01-15', frequency: 'monthly', type: 'expense', amountMinor: 1500, rateVersions: [RATE_CHANGE] };
const subscriptionKnownBefore = { ...subscription, rateVersions: [] }; // ce que l'on sait avant l'annonce du nouveau tarif
const TRUE_RULES = [salary, rent, subscription];

const mulberry32 = seed => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

function noise(seed) {
  const random = mulberry32(seed), out = [];
  for (let day = 0; day < 730; day++) {
    if (random() < 1 / 3) out.push({ id: `n${day}`, accountId: 'A', date: addDays(OPENING, day), type: 'expense', amountMinor: 500 + Math.floor(random() * 3500) });
  }
  return out;
}
function observationsFor(transactions) {
  const ledger = calculateLedger({ accountId: 'A', openingBalanceMinor: 100000, openingDate: OPENING, throughDate: THROUGH, rules: TRUE_RULES, transactions });
  return dailyBalances(ledger, OPENING, THROUGH);
}
const run = (observations, forecast, extra = {}) => walkForwardBacktest({ observations, forecast, method: 'test', version: '1', ...extra });
const byHorizon = results => Object.fromEntries(results.map(r => [r.horizonDays, r]));

test('oracle : sans bruit, le noyau reproduit les soldes à tous les horizons (erreur nulle)', () => {
  const observations = observationsFor([]);
  const forecast = ledgerForecaster({ accountId: 'A', rules: TRUE_RULES });
  for (const result of run(observations, forecast, { horizons: [7, 30, 90] })) {
    assert.ok(result.sampleCount > 300, `origines évaluées pour ${result.horizonDays} j : ${result.sampleCount}`);
    assert.equal(result.absoluteErrorMinor, 0);
    assert.equal(result.missedShortfallOrigins, 0);
    assert.equal(result.unjustifiedAlertOrigins, 0);
  }
});

test('tarif inconnu à la date de prévision : l\'erreur commence exactement à son entrée en vigueur', () => {
  const observations = observationsFor([]);
  const forecast = ledgerForecaster({ accountId: 'A', rules: [salary, rent, subscriptionKnownBefore] });
  // Fenêtre 2024-03-02 → 2024-03-31 : avant le changement, aucune erreur.
  const [before] = run(observations, forecast, { origins: ['2024-03-01'], horizons: [30] });
  assert.equal(before.absoluteErrorMinor, 0);
  // Fenêtre 2024-06-02 → 2024-07-01 : prévu 1500, réel 1900 le 15 juin, soit 400 d'écart du 15 juin au 1er juillet (17 jours).
  const [during] = run(observations, forecast, { origins: ['2024-06-01'], horizons: [30] });
  assert.equal(during.absoluteErrorMinor, 17 * 400);
  assert.deepEqual(during.maeMinor, { numerator: 6800, denominator: 30 });
});

test('avec un tarif annoncé à temps (règles fonction de la date), l\'erreur redevient nulle', () => {
  const observations = observationsFor([]);
  const rulesAt = asOf => [salary, rent, asOf >= '2024-05-20' ? subscription : subscriptionKnownBefore];
  const forecast = ledgerForecaster({ accountId: 'A', rules: rulesAt });
  const [late] = run(observations, forecast, { origins: ['2024-06-01'], horizons: [30] });
  assert.equal(late.absoluteErrorMinor, 0);
  const [early] = run(observations, forecast, { origins: ['2024-05-10'], horizons: [30] });
  assert.equal(early.absoluteErrorMinor, 0); // fenêtre jusqu'au 9 juin : le 15 juin n'est pas encore visible
});

test('avec du bruit, les règles connues battent le solde constant et la tendance, à tous les horizons', () => {
  const observations = observationsFor(noise(11));
  const rules = byHorizon(run(observations, ledgerForecaster({ accountId: 'A', rules: TRUE_RULES })));
  const naive = byHorizon(run(observations, naiveForecaster()));
  const drift = byHorizon(run(observations, driftForecaster({ windowDays: 30 })));
  for (const horizon of [7, 30, 90]) {
    assert.equal(rules[horizon].pointCount, naive[horizon].pointCount);
    assert.equal(rules[horizon].pointCount, drift[horizon].pointCount);
    assert.ok(rules[horizon].absoluteErrorMinor < naive[horizon].absoluteErrorMinor, `règles < constant à ${horizon} j`);
    assert.ok(rules[horizon].absoluteErrorMinor < drift[horizon].absoluteErrorMinor, `règles < tendance à ${horizon} j`);
  }
});

test('alerte de manque : le noyau voit les creux de trésorerie que le solde constant manque', () => {
  const observations = observationsFor([]);
  const options = { horizons: [30], shortfallThresholdMinor: 60000 };
  const [oracle] = run(observations, ledgerForecaster({ accountId: 'A', rules: TRUE_RULES }), options);
  const [naive] = run(observations, naiveForecaster(), options);
  assert.ok(oracle.actualShortfallOrigins > 0);
  assert.equal(oracle.missedShortfallOrigins, 0);
  assert.equal(oracle.unjustifiedAlertOrigins, 0);
  assert.ok(naive.missedShortfallOrigins > 0, 'le solde constant doit manquer au moins un creux');
});

test('le prévisionniste refuse un historique qui ne se termine pas à la date d\'émission', () => {
  const forecast = ledgerForecaster({ accountId: 'A', rules: TRUE_RULES });
  const history = [{ date: '2024-01-01', balanceMinor: 1 }];
  assert.throws(() => forecast({ history, asOf: '2024-01-02', horizonDays: 1, targetDates: ['2024-01-03'] }), RangeError);
});

test('dailyBalances : solde reporté les jours sans opération, jour de paie inclus', () => {
  const ledger = calculateLedger({ accountId: 'A', openingBalanceMinor: 1000, openingDate: '2024-01-01', throughDate: '2024-01-10',
    transactions: [{ id: 'a', accountId: 'A', date: '2024-01-03', type: 'income', amountMinor: 500 }, { id: 'b', accountId: 'A', date: '2024-01-05', type: 'expense', amountMinor: 200 }] });
  assert.deepEqual(dailyBalances(ledger, '2024-01-02', '2024-01-06').map(p => p.balanceMinor), [1000, 1500, 1500, 1300, 1300]);
});

test('erreurs au dernier jour : une par origine évaluée, nulles pour l\'oracle', () => {
  const observations = observationsFor([]);
  const errors = finalDayErrors({ observations, horizonDays: 30, forecast: ledgerForecaster({ accountId: 'A', rules: TRUE_RULES }) });
  assert.equal(errors.length, observations.length - 30); // origines par défaut : toutes sauf les 30 derniers jours
  assert.ok(errors.every(error => error === 0));
});

test('calibration : marge calibrée sur un monde bruité, intervalle symétrique autour du centre', () => {
  const observations = observationsFor(noise(21));
  const forecast = ledgerForecaster({ accountId: 'A', rules: TRUE_RULES });
  // Une origine par semaine pour limiter le recouvrement des fenêtres.
  const origins = observations.filter((_, index) => index % 7 === 0).map(row => row.date);
  const calibration = calibrateHorizon({ observations, origins, horizonDays: 7, forecast });
  assert.equal(calibration.status, 'calibrated', JSON.stringify(calibration));
  assert.ok(calibration.marginMinor > 0);
  assert.ok(calibration.validationCoverage.covered <= calibration.validationCoverage.total);
  const interval = predictionInterval(200000, calibration);
  assert.equal(interval.status, 'calibrated');
  assert.equal(interval.upperMinor - 200000, 200000 - interval.lowerMinor);
});

test('calibration : trop peu d\'historique, aucune fourchette n\'est annoncée', () => {
  const observations = observationsFor(noise(21));
  const forecast = ledgerForecaster({ accountId: 'A', rules: TRUE_RULES });
  const origins = observations.slice(0, 40).filter((_, index) => index % 7 === 0).map(row => row.date);
  const calibration = calibrateHorizon({ observations, origins, horizonDays: 7, forecast });
  assert.equal(calibration.status, 'uncalibrated');
  assert.equal(calibration.reason, 'insufficient-samples');
  assert.equal(predictionInterval(200000, calibration).lowerMinor, null);
});

test('diagnostic de risque : différencie découvert journalier et simple risque intrajournalier', () => {
  const scenario = calculateLedger({ openingDate: '2026-10-01', throughDate: '2026-10-31', accountId: 'A', openingBalanceMinor: 10_000,
    transactions: [
      { id: 'expense1', accountId: 'A', date: '2026-10-08', type: 'expense', amountMinor: 12_000 },
      { id: 'income1', accountId: 'A', date: '2026-10-11', type: 'income', amountMinor: 30_000 },
      { id: 'expense2', accountId: 'A', date: '2026-10-11', type: 'expense', amountMinor: 25_000 }
    ] });
  const result = cashflowRiskInsights(scenario);
  assert.equal(result.status, 'deficit');
  assert.equal(result.firstBelowThresholdDate, '2026-10-08');
  assert.equal(result.peakShortfallMinor, 2000);
  assert.equal(result.lowestDailyCloseDate, '2026-10-08');
  assert.deepEqual(result.largestOutflows.map(i => i.id), ['expense2', 'expense1']);
  assert.equal(result.model, 'deterministic-scheduled-flows');

  const sameDay = calculateLedger({ openingDate: '2026-10-01', throughDate: '2026-10-31', accountId: 'A', openingBalanceMinor: 200,
    transactions: [
      { id: 'expense', date: '2026-10-08', accountId: 'A', type: 'expense', amountMinor: 300 },
      { id: 'income', date: '2026-10-08', accountId: 'A', type: 'income', amountMinor: 700 }
    ] });
  const risk = cashflowRiskInsights(sameDay);
  assert.equal(risk.status, 'intraday-watch');
  assert.equal(risk.firstBelowThresholdDate, null);
  assert.equal(risk.intradayOnlyRisk, true);
});

test('risque : seuil configurable, déficit initial, contrôle des paramètres', () => {
  const empty = calculateLedger({ openingDate: '2026-10-01', throughDate: '2026-10-31', accountId: 'A', openingBalanceMinor: -100 });
  assert.equal(cashflowRiskInsights(empty).firstBelowThresholdDate, '2026-10-01');
  assert.equal(cashflowRiskInsights(empty, { warningThresholdMinor: -200 }).status, 'clear');
  assert.throws(() => cashflowRiskInsights(empty, { maxOutflows: 1.5 }), RangeError);
});
