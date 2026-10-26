// FREEV — pont entre le noyau de calcul et l'évaluateur walk-forward (forecast-evaluation.mjs).
// Un « prévisionniste » est une fonction ({ history, asOf, horizonDays, targetDates }) => ({ points }).
// L'évaluateur ne lui montre que l'historique <= asOf : le futur reste privé pour la notation.

import { calculateLedger } from './freev-algorithm.mjs';
import { walkForwardBacktest, calibrateForecastMargin } from './forecast-evaluation.mjs';

const DAY = 86400000;
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const resolve = (source, asOf) => (typeof source === 'function' ? source(asOf) : source ?? []);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** Soldes quotidiens [from, to] d'un résultat de calculateLedger (le solde d'un jour inclut ses opérations). */
export function dailyBalances(ledger, from, to) {
  if (!ledger || !validDate(from) || !validDate(to) || from > to ||
      from < ledger.openingDate || to > ledger.throughDate ||
      !Number.isSafeInteger(ledger.openingBalanceMinor) || !Array.isArray(ledger.entries))
    throw new RangeError('Période de soldes quotidiens invalide');
  const points = [];
  let balanceMinor = ledger.openingBalanceMinor, next = 0;
  for (let date = from; date <= to; date = addDays(date, 1)) {
    while (next < ledger.entries.length && ledger.entries[next].date <= date) balanceMinor += ledger.entries[next++].signedMinor;
    if (!Number.isSafeInteger(balanceMinor)) throw new RangeError('Solde hors limites');
    points.push({ date, balanceMinor });
  }
  return points;
}

/**
 * Prévisionniste fondé sur le noyau : part du solde constaté à `asOf` et projette règles et opérations connues.
 * `rules` et `transactions` peuvent être des tableaux, ou des fonctions (asOf) => tableau pour ne donner
 * que ce qui était connu à cette date (ex. un nouveau tarif annoncé après asOf ne doit pas servir).
 * Le jour `asOf` est déjà dans l'historique : la projection commence le lendemain.
 */
export function ledgerForecaster({ accountId, rules, transactions }) {
  return ({ history, asOf, targetDates }) => {
    const last = history[history.length - 1];
    if (!last || last.date !== asOf) throw new RangeError(`Historique incomplet pour ${asOf}`);
    if (!Array.isArray(targetDates) || !targetDates.length || !targetDates.every(validDate) ||
        targetDates[0] <= asOf) throw new RangeError('Dates de prévision invalides');
    const throughDate = targetDates[targetDates.length - 1];
    const ledger = calculateLedger({
      accountId, openingBalanceMinor: last.balanceMinor, openingDate: addDays(asOf, 1), throughDate,
      rules: resolve(rules, asOf), transactions: resolve(transactions, asOf)
    });
    return { points: dailyBalances(ledger, targetDates[0], throughDate) };
  };
}

/**
 * Diagnostic déterministe des risques de trésorerie : aucune probabilité n'est
 * inventée. Le seuil et les dépenses observées permettent d'expliquer le scénario.
 * Coût O(nombre d'écritures) et mémoire O(maxOutflows), même sur plusieurs années.
 * Un solde clôturé par jour est différent du point bas intra-journalier pessimiste.
 */
export function cashflowRiskInsights(ledger, { warningThresholdMinor = 0, maxOutflows = 3 } = {}) {
  if (!ledger || !Array.isArray(ledger.entries) ||
      !Number.isSafeInteger(ledger.openingBalanceMinor) ||
      !Number.isSafeInteger(ledger.lowestMinor) ||
      !Number.isSafeInteger(warningThresholdMinor) ||
      !Number.isInteger(maxOutflows) || maxOutflows < 0 || maxOutflows > 20) {
    throw new RangeError('Paramètres de risque invalides');
  }
  let balance = ledger.openingBalanceMinor;
  let activeDay = null;
  let worstCloseMinor = null, worstCloseDate = null, firstBelowThresholdDate = null;
  const largestOutflows = [];
  const closeDay = date => {
    if (worstCloseMinor === null || balance < worstCloseMinor) {
      worstCloseMinor = balance;
      worstCloseDate = date;
    }
    if (firstBelowThresholdDate === null && balance < warningThresholdMinor)
      firstBelowThresholdDate = date;
  };
  for (const entry of ledger.entries) {
    if (activeDay !== entry.date) {
      if (activeDay !== null) closeDay(activeDay);
      else if (entry.date > ledger.openingDate) closeDay(ledger.openingDate);
      activeDay = entry.date;
    }
    balance += entry.signedMinor;
    if (!Number.isSafeInteger(balance)) throw new RangeError('Solde hors limites');
    if (entry.signedMinor < 0 && maxOutflows > 0) {
      const expense = { id: entry.id, date: entry.date, amountMinor: -entry.signedMinor,
        source: entry.source, type: entry.type };
      const insertAt = largestOutflows.findIndex(item => item.amountMinor < expense.amountMinor);
      if (insertAt >= 0) largestOutflows.splice(insertAt, 0, expense);
      else if (largestOutflows.length < maxOutflows) largestOutflows.push(expense);
      if (largestOutflows.length > maxOutflows) largestOutflows.pop();
    }
  }
  if (activeDay !== null) closeDay(activeDay);
  else closeDay(ledger.openingDate);
  return {
    status: firstBelowThresholdDate ? 'deficit' : ledger.lowestMinor < warningThresholdMinor ? 'intraday-watch' : 'clear',
    warningThresholdMinor, firstBelowThresholdDate,
    lowestDailyCloseMinor: worstCloseMinor, lowestDailyCloseDate: worstCloseDate,
    peakShortfallMinor: Math.max(0, warningThresholdMinor - worstCloseMinor),
    intradayOnlyRisk: firstBelowThresholdDate === null && ledger.lowestMinor < warningThresholdMinor,
    largestOutflows,
    model: 'deterministic-scheduled-flows'
  };
}

/** Référence 1 : le solde ne bouge plus. */
export const naiveForecaster = () => ({ history, targetDates }) => {
  const { balanceMinor } = history[history.length - 1];
  return { points: targetDates.map(date => ({ date, balanceMinor })) };
};

/** Référence 2 : prolonge la pente moyenne des `windowDays` derniers jours (solde constant si l'historique est trop court). */
export const driftForecaster = ({ windowDays = 30 } = {}) => ({ history, asOf, targetDates }) => {
  const last = history[history.length - 1];
  const wanted = addDays(asOf, -windowDays);
  let base = null;
  for (let low = 0, high = history.length - 1; low <= high;) {
    const mid = (low + high) >> 1;
    if (history[mid].date <= wanted) { base = history[mid]; low = mid + 1; } else high = mid - 1;
  }
  const span = base ? daysBetween(base.date, asOf) : 0;
  const perDay = span > 0 ? (last.balanceMinor - base.balanceMinor) / span : 0;
  return { points: targetDates.map(date => ({ date, balanceMinor: last.balanceMinor + Math.round(perDay * daysBetween(asOf, date)) })) };
};

/**
 * Erreurs absolues au dernier jour de l'horizon, une par origine évaluée, dans l'ordre chronologique.
 * Réutilise walkForwardBacktest pour les exclusions et le contrôle des points : aucune règle dupliquée.
 */
export function finalDayErrors({ observations, origins, horizonDays, forecast }) {
  const finals = new Map();
  const [result] = walkForwardBacktest({
    observations, origins, horizons: [horizonDays], method: 'final-day-errors', version: '1',
    forecast: request => {
      const output = forecast(request);
      const date = request.targetDates[request.targetDates.length - 1];
      finals.set(request.asOf, { date, predictedMinor: output.points.find(point => point.date === date)?.balanceMinor });
      return output;
    }
  });
  const actual = new Map(observations.map(row => [row.date, row.balanceMinor]));
  return result.originDates.map(asOf => {
    const { date, predictedMinor } = finals.get(asOf);
    const error = BigInt(predictedMinor) - BigInt(actual.get(date));
    const absolute = error < 0n ? -error : error;
    if (absolute > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Erreur hors limites');
    return Number(absolute);
  });
}

/**
 * Marge de prévision à un horizon donné : les erreurs sont coupées en deux dans l'ordre du temps
 * (calibration d'abord, validation ensuite, jamais mélangées), puis passées à calibrateForecastMargin.
 * Sans assez d'historique ou si la validation n'est pas au niveau annoncé, le résultat est 'uncalibrated'
 * et predictionInterval ne produit aucune fourchette.
 * Attention : des origines quotidiennes se recouvrent, l'échantillon utile est plus petit que le nombre
 * d'origines. Espacer les origines (ex. une par semaine) donne une validation moins optimiste.
 */
export function calibrateHorizon({ observations, origins, horizonDays, forecast, calibrationPercent = 60, ...options }) {
  if (!Number.isSafeInteger(calibrationPercent) || calibrationPercent < 1 || calibrationPercent > 99) {
    throw new RangeError('La part de calibration doit être un entier de 1 à 99 pour cent');
  }
  const errors = finalDayErrors({ observations, origins, horizonDays, forecast });
  const cut = Math.floor((errors.length * calibrationPercent) / 100);
  return calibrateForecastMargin({
    calibrationErrorsMinor: errors.slice(0, cut),
    validationErrorsMinor: errors.slice(cut),
    ...options
  });
}
