// FREEV Gestion — walk-forward evaluation and uncertainty checks (CDC ALX 08–09).
// The evaluator exposes only the historical snapshot to a forecaster. Future
// observations remain private to the scoring step.

export const MINIMUM_CALIBRATION_SAMPLE = 30;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function isValidISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function requireDate(value, label) {
  if (!isValidISODate(value)) throw new RangeError(`${label} : date invalide`);
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  const result = value.toISOString().slice(0, 10);
  requireDate(result, 'Horizon');
  return result;
}

function assertSafeMinor(value, label) {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} : montant en unité minimale invalide`);
}

function safeNumber(value, label) {
  if (value > MAX_SAFE || value < -MAX_SAFE) throw new RangeError(`${label} hors limites`);
  return Number(value);
}

function normalizeObservations(observations) {
  if (!Array.isArray(observations)) throw new TypeError('Les observations doivent être un tableau');
  const rows = observations.map((row, index) => {
    requireDate(row?.date, `Observation ${index + 1}`);
    assertSafeMinor(row.balanceMinor, `Observation ${row.date}`);
    return Object.freeze({ date: row.date, balanceMinor: row.balanceMinor });
  }).sort((a, b) => a.date.localeCompare(b.date));
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index - 1].date === rows[index].date) throw new RangeError(`Les dates d’observation doivent être uniques : ${rows[index].date}`);
  }
  return rows;
}

function normalizeHorizons(horizons) {
  if (!Array.isArray(horizons) || !horizons.length) throw new RangeError('Au moins un horizon est requis');
  const result = [...horizons];
  if (result.some(value => !Number.isSafeInteger(value) || value < 1 || value > 366)) throw new RangeError('Horizon invalide (1 à 366 jours)');
  if (new Set(result).size !== result.length) throw new RangeError('Les horizons doivent être uniques');
  return result.sort((a, b) => a - b);
}

function normalizeOrigins(origins, observations, maxHorizon) {
  const source = origins === undefined
    ? observations.slice(0, Math.max(0, observations.length - maxHorizon)).map(row => row.date)
    : origins;
  if (!Array.isArray(source)) throw new TypeError('Les dates de prévision doivent être un tableau');
  const result = [...source];
  result.forEach(date => requireDate(date, 'Origine de prévision'));
  if (new Set(result).size !== result.length) throw new RangeError('Les dates de prévision doivent être uniques');
  return result.sort((a, b) => a.localeCompare(b));
}

function upperBoundByDate(rows, date) {
  let low = 0, high = rows.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (rows[mid].date <= date) low = mid + 1;
    else high = mid;
  }
  return low;
}

function normalizeForecastPoints(output, targetDates, originDate, horizonDays) {
  if (!output || !Array.isArray(output.points)) throw new TypeError(`Prévision invalide pour ${originDate} / ${horizonDays} jours`);
  const points = new Map();
  for (const point of output.points) {
    requireDate(point?.date, 'Point de prévision');
    try { assertSafeMinor(point.balanceMinor, `Prévision ${point.date}`); }
    catch { throw new RangeError(`Prévision invalide : montant en unité minimale incorrect (${point.date})`); }
    if (!targetDates.includes(point.date) || points.has(point.date)) throw new RangeError(`Prévision invalide : date inattendue ou répétée (${point.date})`);
    points.set(point.date, point.balanceMinor);
  }
  if (points.size !== targetDates.length || targetDates.some(date => !points.has(date))) {
    throw new RangeError(`Prévision invalide : chaque jour de l’horizon ${horizonDays} doit être présent`);
  }
  return points;
}

/**
 * ALX 08 — évalue un modèle sur des dates historiques en mode walk-forward.
 *
 * `forecast` reçoit `{ history, asOf, horizonDays, targetDates }`. `history`
 * contient des soldes quotidiens en unités minimales, strictement limités aux
 * dates <= `asOf`. Il renvoie `{ points: [{ date, balanceMinor }] }`.
 * Une alerte de manque est déduite des soldes prévus sous le seuil donné.
 *
 * @param {object} options
 * @param {{date:string,balanceMinor:number}[]} options.observations soldes réels datés
 * @param {string[]} [options.origins] dates d'émission des prévisions à rejouer
 * @param {number[]} [options.horizons=[7,30,90]] horizons en jours
 * @param {(input:object)=>{points:{date:string,balanceMinor:number}[]}} options.forecast modèle testé
 * @param {string} options.method nom stable de la méthode
 * @param {string} options.version version stable du moteur testé
 * @param {number} [options.shortfallThresholdMinor=0] seuil sous lequel un manque est constaté
 * @returns {Array<object>} une recette par horizon, triée par durée
 */
export function walkForwardBacktest({
  observations,
  origins,
  horizons = [7, 30, 90],
  forecast,
  method,
  version,
  shortfallThresholdMinor = 0
} = {}) {
  if (typeof forecast !== 'function') throw new TypeError('Une fonction de prévision est requise');
  if (typeof method !== 'string' || !method.trim()) throw new TypeError('Le nom de méthode est requis');
  if (typeof version !== 'string' || !version.trim()) throw new TypeError('La version du moteur est requise');
  assertSafeMinor(shortfallThresholdMinor, 'Seuil de manque');

  const rows = normalizeObservations(observations);
  const periods = normalizeHorizons(horizons);
  const dates = normalizeOrigins(origins, rows, periods.at(-1));
  const rowByDate = new Map(rows.map(row => [row.date, row]));

  return periods.map(horizonDays => {
    let pointCount = 0;
    let absoluteError = 0n;
    let actualShortfallOrigins = 0;
    let actualShortfallDays = 0;
    let actualShortfallAmount = 0n;
    let predictedShortfallOrigins = 0;
    let missedShortfallOrigins = 0;
    let missedShortfallDays = 0;
    let missedShortfallAmount = 0n;
    let unjustifiedAlertOrigins = 0;
    const evaluatedOrigins = [];
    const excludedOrigins = [];

    for (const asOf of dates) {
      if (!rowByDate.has(asOf)) {
        excludedOrigins.push({ date: asOf, reason: 'missing-origin-observation' });
        continue;
      }

      const targetDates = Array.from({ length: horizonDays }, (_, index) => addDays(asOf, index + 1));
      const actual = targetDates.map(date => rowByDate.get(date));
      if (actual.some(row => !row)) {
        excludedOrigins.push({ date: asOf, reason: 'incomplete-actual-window' });
        continue;
      }

      const history = Object.freeze(rows.slice(0, upperBoundByDate(rows, asOf)));
      const request = Object.freeze({
        history,
        asOf,
        horizonDays,
        targetDates: Object.freeze([...targetDates])
      });
      const predicted = normalizeForecastPoints(forecast(request), targetDates, asOf, horizonDays);
      let actualShortfall = false;
      let predictedShortfall = false;
      let shortfallDaysForOrigin = 0;
      let shortfallAmountForOrigin = 0n;

      for (const row of actual) {
        const predictedBalance = predicted.get(row.date);
        const error = BigInt(predictedBalance) - BigInt(row.balanceMinor);
        absoluteError += error < 0n ? -error : error;
        pointCount += 1;
        if (row.balanceMinor < shortfallThresholdMinor) {
          actualShortfall = true;
          shortfallDaysForOrigin += 1;
          shortfallAmountForOrigin += BigInt(shortfallThresholdMinor) - BigInt(row.balanceMinor);
        }
        if (predictedBalance < shortfallThresholdMinor) predictedShortfall = true;
      }

      if (actualShortfall) {
        actualShortfallOrigins += 1;
        actualShortfallDays += shortfallDaysForOrigin;
        actualShortfallAmount += shortfallAmountForOrigin;
      }
      if (predictedShortfall) predictedShortfallOrigins += 1;
      if (actualShortfall && !predictedShortfall) {
        missedShortfallOrigins += 1;
        missedShortfallDays += shortfallDaysForOrigin;
        missedShortfallAmount += shortfallAmountForOrigin;
      }
      if (predictedShortfall && !actualShortfall) unjustifiedAlertOrigins += 1;
      evaluatedOrigins.push(asOf);
    }

    return {
      method: method.trim(),
      version: version.trim(),
      horizonDays,
      shortfallThresholdMinor,
      originDates: evaluatedOrigins,
      sampleCount: evaluatedOrigins.length,
      pointCount,
      absoluteErrorMinor: safeNumber(absoluteError, 'Erreur absolue cumulée'),
      maeMinor: pointCount ? { numerator: safeNumber(absoluteError, 'Erreur absolue cumulée'), denominator: pointCount } : null,
      actualShortfallOrigins,
      actualShortfallDays,
      actualShortfallAmountMinor: safeNumber(actualShortfallAmount, 'Manques réels cumulés'),
      predictedShortfallOrigins,
      missedShortfallOrigins,
      missedShortfallDays,
      missedShortfallAmountMinor: safeNumber(missedShortfallAmount, 'Manques non détectés cumulés'),
      unjustifiedAlertOrigins,
      excludedOrigins
    };
  });
}

function validateErrors(errors, name) {
  if (!Array.isArray(errors)) throw new TypeError(`${name} doit être un tableau`);
  return errors.map((value, index) => {
    assertSafeMinor(value, `${name}[${index}]`);
    if (value < 0) throw new RangeError(`${name}[${index}] : une erreur absolue ne peut pas être négative`);
    return value;
  });
}

function ceilDiv(numerator, denominator) {
  return Math.floor((numerator + denominator - 1) / denominator);
}

/**
 * ALX 09 — calcule une marge split-conformal sur un échantillon de calibration,
 * puis vérifie sa couverture sur une partition de validation distincte.
 * Une marge annoncée est renvoyée seulement si les deux échantillons sont
 * suffisants et la couverture observée respecte la tolérance prédéfinie.
 */
export function calibrateForecastMargin({
  calibrationErrorsMinor,
  validationErrorsMinor,
  targetCoveragePercent = 80,
  minimumSamples = MINIMUM_CALIBRATION_SAMPLE,
  tolerancePercent = 10
} = {}) {
  if (!Number.isSafeInteger(targetCoveragePercent) || targetCoveragePercent < 50 || targetCoveragePercent > 99) {
    throw new RangeError('La couverture cible doit être un entier de 50 à 99 pour cent');
  }
  if (!Number.isSafeInteger(minimumSamples) || minimumSamples < 2) throw new RangeError('L’échantillon minimum doit être supérieur à 1');
  if (!Number.isSafeInteger(tolerancePercent) || tolerancePercent < 0 || tolerancePercent > 49) throw new RangeError('La tolérance de couverture est invalide');

  const calibration = validateErrors(calibrationErrorsMinor, 'Erreurs de calibration');
  const validation = validateErrors(validationErrorsMinor, 'Erreurs de validation');
  const base = {
    targetCoveragePercent,
    calibrationSampleCount: calibration.length,
    validationSampleCount: validation.length,
    validationCoverage: null,
    marginMinor: null,
    claimedCoveragePercent: null
  };
  if (calibration.length < minimumSamples || validation.length < minimumSamples) {
    return { ...base, status: 'uncalibrated', reason: 'insufficient-samples', minimumSamples };
  }

  const sorted = [...calibration].sort((a, b) => a - b);
  // Finite-sample conformal rank: ceil((n + 1) * targetCoverage).
  const rank = Math.min(sorted.length, ceilDiv((sorted.length + 1) * targetCoveragePercent, 100));
  const marginMinor = sorted[rank - 1];
  const covered = validation.reduce((count, error) => count + Number(error <= marginMinor), 0);
  const validationCoverage = { covered, total: validation.length };
  const withinTolerance = Math.abs(covered * 100 - targetCoveragePercent * validation.length) <= tolerancePercent * validation.length;
  if (!withinTolerance) {
    return { ...base, status: 'uncalibrated', reason: 'holdout-coverage-outside-tolerance', validationCoverage, marginMinor: null };
  }
  return {
    ...base,
    status: 'calibrated',
    reason: null,
    validationCoverage,
    marginMinor,
    claimedCoveragePercent: targetCoveragePercent,
    minimumSamples
  };
}

/** Creates a symmetric interval only from a validated calibration result. */
export function predictionInterval(centerMinor, calibration) {
  assertSafeMinor(centerMinor, 'Centre de prévision');
  if (calibration?.status !== 'calibrated' || !Number.isSafeInteger(calibration.marginMinor) || calibration.marginMinor < 0) {
    return { status: 'uncalibrated', lowerMinor: null, upperMinor: null, claimedCoveragePercent: null };
  }
  const margin = BigInt(calibration.marginMinor);
  const center = BigInt(centerMinor);
  const lower = center - margin, upper = center + margin;
  if (lower < -MAX_SAFE || upper > MAX_SAFE) return { status: 'uncalibrated', lowerMinor: null, upperMinor: null, claimedCoveragePercent: null, reason: 'out-of-range' };
  return {
    status: 'calibrated',
    lowerMinor: Number(lower),
    upperMinor: Number(upper),
    claimedCoveragePercent: calibration.claimedCoveragePercent,
    validationCoverage: calibration.validationCoverage,
    calibrationSampleCount: calibration.calibrationSampleCount,
    validationSampleCount: calibration.validationSampleCount
  };
}
