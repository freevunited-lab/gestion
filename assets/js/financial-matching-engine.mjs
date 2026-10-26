// Moteurs purs de revue des doublons et de rapprochement (CDC ALX 05–06).
// Les montants sont des unités minimales entières et aucun résultat ne modifie les entrées.

const safeMinor = value => Number.isSafeInteger(value) && value >= 0;
const textOf = item => String(item?.label ?? item?.description ?? item?.desc ?? item?.merchant ?? '').trim();
const currencyOf = item => String(item?.currency || '').trim().toUpperCase();
const accountOf = item => String(item?.accountId ?? item?.freevAccountId ?? '');
const sourceOf = item => String(item?.sourceId ?? item?.providerSourceId ?? '');
const providerIdOf = item => String(item?.providerTransactionId ?? item?.externalId ?? item?.providerId ?? '').trim();
const directionOf = item => String(item?.direction ?? item?.type ?? '').trim().toLowerCase();
const transactionIdOf = item => String(item?.id ?? '');

function validISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dayNumber(value) {
  if (!validISODate(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

const dateDifference = (first, second) => {
  const a = dayNumber(first), b = dayNumber(second);
  return a === null || b === null ? null : Math.abs(a - b);
};

function normalizeLabel(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function editDistance(left, right) {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function labelSimilarity(first, second) {
  const a = normalizeLabel(first), b = normalizeLabel(second);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const distanceScore = 1 - editDistance(a, b) / Math.max(a.length, b.length);
  const aTokens = new Set(a.split(' ')), bTokens = new Set(b.split(' '));
  const intersection = [...aTokens].filter(token => bTokens.has(token)).length;
  const tokenScore = (2 * intersection) / (aTokens.size + bTokens.size);
  return Math.max(distanceScore, tokenScore);
}

function identityKey(item) {
  const account = accountOf(item), source = sourceOf(item), providerId = providerIdOf(item);
  return account && source && providerId ? JSON.stringify([account, source, providerId]) : '';
}

function appendToMap(map, key, value) {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

function appendToDateIndex(index, scope, day, value) {
  let byDay = index.get(scope);
  if (!byDay) { byDay = new Map(); index.set(scope, byDay); }
  appendToMap(byDay, day, value);
}

function isAuthorization(item) {
  return ['authorization', 'authorized', 'authorised', 'preauthorization', 'pre-authorized'].includes(String(item?.status || item?.state || '').toLowerCase());
}

function isPosted(item) {
  return ['posted', 'booked', 'settled', 'completed', 'cleared'].includes(String(item?.status || item?.state || '').toLowerCase());
}

function authorizationReference(item) {
  return String(item?.authorizationId ?? item?.authorizedTransactionId ?? item?.originalAuthorizationId ?? '').trim();
}

function compareContext(existing, incoming) {
  const keys = ['merchantId', 'counterpartyId', 'bankAccountId', 'reference'];
  return keys.find(key => existing?.[key] != null && incoming?.[key] != null &&
    String(existing[key]).trim() && String(existing[key]).trim() === String(incoming[key]).trim()) || '';
}

function duplicateCandidate(existing, incoming, options) {
  if (!accountOf(existing) || accountOf(existing) !== accountOf(incoming)) return null;
  if (!currencyOf(existing) || currencyOf(existing) !== currencyOf(incoming)) return null;
  if (!directionOf(existing) || directionOf(existing) !== directionOf(incoming)) return null;
  const existingAmount = Number(existing?.amountMinor), incomingAmount = Number(incoming?.amountMinor);
  if (!safeMinor(existingAmount) || !safeMinor(incomingAmount)) return null;
  const amountDifferenceMinor = Math.abs(existingAmount - incomingAmount);
  if (!Number.isSafeInteger(amountDifferenceMinor) || amountDifferenceMinor > options.amountToleranceMinor) return null;
  const differenceDays = dateDifference(existing?.date, incoming?.date);
  if (differenceDays === null || differenceDays > options.dateToleranceDays) return null;
  const similarity = labelSimilarity(textOf(existing), textOf(incoming));
  if (similarity < options.minLabelSimilarity) return null;
  const sameContext = compareContext(existing, incoming);
  const amountScore = options.amountToleranceMinor === 0 ? 1 : 1 - amountDifferenceMinor / (options.amountToleranceMinor + 1);
  const dateScore = options.dateToleranceDays === 0 ? 1 : 1 - differenceDays / (options.dateToleranceDays + 1);
  const score = Math.round((amountScore * 0.3 + dateScore * 0.2 + similarity * 0.4 + (sameContext ? 0.1 : 0)) * 10000) / 10000;
  const evidence = [
    { field: 'amount', differenceMinor: amountDifferenceMinor, exact: amountDifferenceMinor === 0 },
    { field: 'date', differenceDays, exact: differenceDays === 0 },
    { field: 'label', similarity: Math.round(similarity * 10000) / 10000, existing: textOf(existing), incoming: textOf(incoming) }
  ];
  if (sameContext) evidence.push({ field: 'context', key: sameContext, value: String(existing[sameContext]) });
  return {
    id: transactionIdOf(existing),
    transaction: existing,
    score,
    amountDifferenceMinor,
    dateDifferenceDays: differenceDays,
    labelSimilarity: Math.round(similarity * 10000) / 10000,
    evidence
  };
}

/**
 * Reviews imported transactions against stored transactions without deleting or changing anything.
 * A stable provider ID is certain only in the same account and source. Similar rows are review candidates.
 */
export function reviewDuplicates({ existing = [], incoming = [], options = {} } = {}) {
  const settings = {
    dateToleranceDays: options.dateToleranceDays ?? 2,
    amountToleranceMinor: options.amountToleranceMinor ?? 0,
    minLabelSimilarity: options.minLabelSimilarity ?? 0.55,
    maxCandidates: options.maxCandidates ?? 5
  };
  if (!Number.isInteger(settings.dateToleranceDays) || settings.dateToleranceDays < 0 || settings.dateToleranceDays > 366 ||
      !safeMinor(settings.amountToleranceMinor) ||
      typeof settings.minLabelSimilarity !== 'number' || settings.minLabelSimilarity < 0 || settings.minLabelSimilarity > 1 ||
      !Number.isInteger(settings.maxCandidates) || settings.maxCandidates < 1 || settings.maxCandidates > 50) {
    throw new RangeError('Paramètres de détection des doublons invalides');
  }

  const stored = Array.isArray(existing) ? existing.filter(Boolean) : [];
  const rows = Array.isArray(incoming) ? incoming.filter(Boolean) : [];
  const storedByIdentity = new Map();
  const authorizationsByIdentity = new Map();
  const storedByScopeDate = new Map();
  for (const item of stored) {
    const key = identityKey(item);
    if (key) appendToMap(storedByIdentity, key, item);
    if (isAuthorization(item) && providerIdOf(item)) {
      const authKey = JSON.stringify([accountOf(item), sourceOf(item), providerIdOf(item)]);
      appendToMap(authorizationsByIdentity, authKey, item);
    }
    const scope = JSON.stringify([accountOf(item), currencyOf(item), directionOf(item)]);
    const day = dayNumber(item.date);
    if (!accountOf(item) || !currencyOf(item) || !directionOf(item) || day === null) continue;
    appendToDateIndex(storedByScopeDate, scope, day, item);
  }
  const postedByAuthorization = new Map();
  const incomingIdentities = new Map();
  for (const [index, row] of rows.entries()) {
    const reference = authorizationReference(row);
    const key = identityKey(row) || `row:${index}`;
    if (reference && isPosted(row)) {
      const identities = postedByAuthorization.get(reference) || new Set();
      identities.add(key);
      postedByAuthorization.set(reference, identities);
    }
    if (identityKey(row) && !incomingIdentities.has(identityKey(row))) incomingIdentities.set(identityKey(row), index);
  }
  const decisions = rows.map((row, rowIndex) => {
    const key = identityKey(row);
    if (key && incomingIdentities.get(key) < rowIndex) {
      const earlier = rows[incomingIdentities.get(key)];
      return {
        incoming: row, status: 'certain-duplicate', automaticAction: 'skip-import', match: earlier, candidates: [],
        evidence: [{ field: 'batch-provider-identity', accountId: accountOf(row), sourceId: sourceOf(row), providerTransactionId: providerIdOf(row) }]
      };
    }
    const identityMatches = key ? storedByIdentity.get(key) || [] : [];
    if (identityMatches.length) {
      const authMatches = identityMatches.filter(item => isAuthorization(item) && isPosted(row));
      if (authMatches.length === 1) {
        if (postedByAuthorization.get(authorizationReference(row))?.size > 1) {
          return {
            incoming: row, status: 'needs-review', automaticAction: 'keep', match: null,
            candidates: authMatches.map(transaction => ({ id: transactionIdOf(transaction), transaction })),
            evidence: [{ field: 'provider-identity', accountId: accountOf(row), sourceId: sourceOf(row), providerTransactionId: providerIdOf(row) }, { field: 'status-transition', from: 'authorization', to: 'posted' }, { field: 'ambiguity', reason: 'plusieurs opérations comptabilisées revendiquent la même autorisation' }]
          };
        }
        return {
          incoming: row, status: 'authorization-transition', automaticAction: 'replace-authorization',
          match: authMatches[0], candidates: [],
          evidence: [{ field: 'provider-identity', accountId: accountOf(row), sourceId: sourceOf(row), providerTransactionId: providerIdOf(row) }, { field: 'status-transition', from: 'authorization', to: 'posted' }]
        };
      }
      return {
        incoming: row, status: 'certain-duplicate', automaticAction: 'skip-import',
        match: identityMatches[0], candidates: identityMatches.slice(1).map(transaction => ({ id: transactionIdOf(transaction), transaction })),
        evidence: [{ field: 'provider-identity', accountId: accountOf(row), sourceId: sourceOf(row), providerTransactionId: providerIdOf(row) }]
      };
    }

    const authRef = authorizationReference(row);
    const authKey = JSON.stringify([accountOf(row), sourceOf(row), authRef]);
    const authorizationMatches = authRef && isPosted(row) ? authorizationsByIdentity.get(authKey) || [] : [];
    if (authorizationMatches.length === 1 && postedByAuthorization.get(authRef)?.size === 1) {
      return {
        incoming: row, status: 'authorization-transition', automaticAction: 'replace-authorization',
        match: authorizationMatches[0], candidates: [],
        evidence: [{ field: 'authorization-reference', id: authRef }, { field: 'account-source-scope', accountId: accountOf(row), sourceId: sourceOf(row) }, { field: 'status-transition', from: 'authorization', to: 'posted' }]
      };
    }

    const fuzzyScope = JSON.stringify([accountOf(row), currencyOf(row), directionOf(row)]);
    const fuzzyByDay = storedByScopeDate.get(fuzzyScope);
    const rowDay = dayNumber(row.date);
    const nearby = [];
    if (fuzzyByDay && rowDay !== null) {
      for (let offset = -settings.dateToleranceDays; offset <= settings.dateToleranceDays; offset += 1) {
        for (const item of fuzzyByDay.get(rowDay + offset) || []) nearby.push(item);
      }
    }
    const candidates = nearby.map(item => duplicateCandidate(item, row, settings)).filter(Boolean)
      .sort((a, b) => b.score - a.score || a.dateDifferenceDays - b.dateDifferenceDays ||
        a.amountDifferenceMinor - b.amountDifferenceMinor || a.id.localeCompare(b.id))
      .slice(0, settings.maxCandidates);
    if (authorizationMatches.length || candidates.length) {
      const evidence = authorizationMatches.length
        ? [{ field: 'authorization-reference', id: authRef, ambiguousMatches: authorizationMatches.length }]
        : candidates[0].evidence;
      return { incoming: row, status: 'needs-review', automaticAction: 'keep', match: null, candidates, evidence };
    }
    return { incoming: row, status: 'new', automaticAction: 'import', match: null, candidates: [], evidence: [] };
  });
  return { decisions };
}

function toleranceFor(obligationItem, tolerances) {
  const key = String(obligationItem?.paymentType ?? obligationItem?.kind ?? directionOf(obligationItem) ?? 'default').toLowerCase();
  const value = tolerances?.[key] ?? tolerances?.default;
  if (!value || !Number.isInteger(value.dateDays) || value.dateDays < 0 || value.dateDays > 366 ||
      !safeMinor(value.amountMinor) || (value.minLabelSimilarity != null &&
      (typeof value.minLabelSimilarity !== 'number' || value.minLabelSimilarity < 0 || value.minLabelSimilarity > 1))) return null;
  return { ...value, minLabelSimilarity: value.minLabelSimilarity ?? 0.2 };
}

function remainingAmounts(items, allocations, idField) {
  const totals = new Map();
  for (const allocation of allocations) {
    const id = String(allocation[idField]);
    const current = totals.get(id) || 0n;
    totals.set(id, current + BigInt(allocation.amountMinor));
  }
  return new Map(items.map(item => {
    const remaining = BigInt(item.amountMinor) - (totals.get(transactionIdOf(item)) || 0n);
    return [transactionIdOf(item), Number(remaining)];
  }));
}

/**
 * Lists deterministic candidate pairs. Tolerances are explicit per payment type, e.g.
 * `{ expense: { dateDays: 3, amountMinor: 100, allowPartial: true } }`.
 * The result only proposes links; the caller must present ambiguity and ask the user to confirm.
 */
export function buildReconciliationCandidates({ actuals = [], obligations = [], existingAllocations = [], tolerances = {} } = {}) {
  const actualRows = Array.isArray(actuals) ? actuals.filter(Boolean) : [];
  const dueRows = Array.isArray(obligations) ? obligations.filter(Boolean) : [];
  const accepted = validateReconciliationAllocations({ actuals: actualRows, obligations: dueRows, allocations: [], existingAllocations });
  if (!accepted.ok) throw new RangeError('Les rapprochements déjà enregistrés sont invalides');
  const actualRemaining = remainingAmounts(actualRows, accepted.allocations, 'actualId');
  const dueRemaining = remainingAmounts(dueRows, accepted.allocations, 'obligationId');
  const candidates = [];

  const actualsByScopeDate = new Map();
  for (const transaction of actualRows) {
    const scope = JSON.stringify([accountOf(transaction), currencyOf(transaction), directionOf(transaction)]);
    const day = dayNumber(transaction.date);
    if (!accountOf(transaction) || !currencyOf(transaction) || !directionOf(transaction) || day === null) continue;
    appendToDateIndex(actualsByScopeDate, scope, day, transaction);
  }

  for (const due of dueRows) {
    const dueId = transactionIdOf(due);
    const dueOpen = dueRemaining.get(dueId);
    if (!dueId || !safeMinor(due.amountMinor) || dueOpen <= 0 || !validISODate(due.date)) continue;
    const tolerance = toleranceFor(due, tolerances);
    if (!tolerance) continue;
    const scope = JSON.stringify([accountOf(due), currencyOf(due), directionOf(due)]);
    if (!accountOf(due) || !currencyOf(due) || !directionOf(due)) continue;
    const byDay = actualsByScopeDate.get(scope);
    if (!byDay) continue;
    const dueDay = dayNumber(due.date);
    const nearbyActuals = [];
    for (let offset = -tolerance.dateDays; offset <= tolerance.dateDays; offset += 1) {
      for (const item of byDay.get(dueDay + offset) || []) nearbyActuals.push(item);
    }
    for (const transaction of nearbyActuals) {
      const transactionId = transactionIdOf(transaction);
      const transactionRemaining = actualRemaining.get(transactionId);
      if (!transactionId || !safeMinor(transaction.amountMinor) || transactionRemaining <= 0) continue;
      const differenceDays = dateDifference(transaction.date, due.date);
      if (differenceDays === null) continue;
      const amountDifferenceMinor = Math.abs(transactionRemaining - dueOpen);
      const exactOrClose = amountDifferenceMinor <= tolerance.amountMinor;
      const similarity = labelSimilarity(textOf(transaction), textOf(due));
      const sharedReference = Boolean(transaction?.reference && due?.reference && String(transaction.reference) === String(due.reference));
      const partialAllowed = tolerance.allowPartial === true && amountDifferenceMinor > tolerance.amountMinor &&
        Math.min(transactionRemaining, dueOpen) > 0 && (similarity >= tolerance.minLabelSimilarity || sharedReference);
      if (!exactOrClose && !partialAllowed) continue;
      const kind = partialAllowed ? 'partial' : amountDifferenceMinor === 0 ? 'exact' : 'within-tolerance';
      const amountScore = tolerance.amountMinor === 0
        ? (amountDifferenceMinor === 0 ? 1 : Math.min(transactionRemaining, dueOpen) / Math.max(transactionRemaining, dueOpen))
        : Math.max(0, 1 - amountDifferenceMinor / (tolerance.amountMinor + 1));
      const dateScore = tolerance.dateDays === 0 ? 1 : 1 - differenceDays / (tolerance.dateDays + 1);
      const score = Math.round((amountScore * 0.35 + dateScore * 0.2 + similarity * 0.35 + (sharedReference ? 0.1 : 0)) * 10000) / 10000;
      const evidence = [
        { field: 'account', id: accountOf(transaction) },
        { field: 'currency', code: currencyOf(transaction) },
        { field: 'direction', value: directionOf(transaction) },
        { field: 'date', differenceDays, toleranceDays: tolerance.dateDays },
        { field: 'amount', differenceMinor: amountDifferenceMinor, toleranceMinor: tolerance.amountMinor },
        { field: 'label', similarity: Math.round(similarity * 10000) / 10000 }
      ];
      if (sharedReference) evidence.push({ field: 'reference', value: String(transaction.reference) });
      if (kind === 'partial') evidence.push({ field: 'partial-amount', actualRemainingMinor: transactionRemaining, obligationRemainingMinor: dueOpen });
      candidates.push({
        actualId: transactionId,
        obligationId: dueId,
        kind,
        score,
        amountDifferenceMinor,
        dateDifferenceDays: differenceDays,
        actualRemainingMinor: transactionRemaining,
        obligationRemainingMinor: dueOpen,
        ambiguous: false,
        evidence
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.dateDifferenceDays - b.dateDifferenceDays ||
    a.amountDifferenceMinor - b.amountDifferenceMinor || a.actualId.localeCompare(b.actualId) || a.obligationId.localeCompare(b.obligationId));
  const margin = 0.05;
  const bestByActual = new Map(), bestByObligation = new Map();
  for (const candidate of candidates) {
    bestByActual.set(candidate.actualId, Math.max(bestByActual.get(candidate.actualId) ?? -Infinity, candidate.score));
    bestByObligation.set(candidate.obligationId, Math.max(bestByObligation.get(candidate.obligationId) ?? -Infinity, candidate.score));
  }
  const nearBestByActual = new Map(), nearBestByObligation = new Map();
  for (const candidate of candidates) {
    if (candidate.score >= bestByActual.get(candidate.actualId) - margin) {
      appendToMap(nearBestByActual, candidate.actualId, candidate);
    }
    if (candidate.score >= bestByObligation.get(candidate.obligationId) - margin) {
      appendToMap(nearBestByObligation, candidate.obligationId, candidate);
    }
  }
  for (const candidate of candidates) {
    const actualGroup = nearBestByActual.get(candidate.actualId) || [];
    const obligationGroup = nearBestByObligation.get(candidate.obligationId) || [];
    const competitors = [...new Map([...actualGroup, ...obligationGroup]
      .filter(peer => peer !== candidate)
      .map(peer => [`${peer.actualId}\u0000${peer.obligationId}`, peer])).values()].slice(0, 5);
    candidate.ambiguous = (actualGroup.length > 1 && actualGroup.includes(candidate)) || (obligationGroup.length > 1 && obligationGroup.includes(candidate));
    if (candidate.ambiguous) candidate.evidence.push({ field: 'ambiguity', competingPairs: competitors.map(peer => ({ actualId: peer.actualId, obligationId: peer.obligationId, score: peer.score })) });
  }
  return candidates;
}

function addSafe(total, amount) {
  const next = BigInt(total) + BigInt(amount);
  return next <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(next) : null;
}

/**
 * Validates a proposed allocation batch against stored allocations without writing it.
 * An actual payment may cover several obligations and an obligation may have several partial payments.
 */
export function validateReconciliationAllocations({ actuals = [], obligations = [], allocations = [], existingAllocations = [] } = {}) {
  const errors = [];
  if (!Array.isArray(actuals) || !Array.isArray(obligations) || !Array.isArray(allocations) || !Array.isArray(existingAllocations)) {
    return { ok: false, errors: [{ code: 'invalid-batch' }], allocations: [], remainingActualMinor: {}, remainingObligationMinor: {} };
  }
  const actualRows = actuals;
  const dueRows = obligations;
  const actualById = new Map(), dueById = new Map();
  for (const [rows, index, label] of [[actualRows, actualById, 'actual'], [dueRows, dueById, 'obligation']]) {
    for (const item of rows) {
      const id = transactionIdOf(item);
      if (!id || index.has(id) || !safeMinor(item?.amountMinor)) {
        errors.push({ code: 'invalid-entity', entity: label, id });
        continue;
      }
      index.set(id, item);
    }
  }

  const all = [...(Array.isArray(existingAllocations) ? existingAllocations : []), ...(Array.isArray(allocations) ? allocations : [])];
  const pairs = new Set(), actualTotals = new Map(), dueTotals = new Map();
  for (const allocation of all) {
    const actualId = String(allocation?.actualId ?? ''), obligationId = String(allocation?.obligationId ?? '');
    const amount = allocation?.amountMinor;
    if (!actualId || !obligationId || !Number.isSafeInteger(amount) || amount <= 0) {
      errors.push({ code: 'invalid-amount', actualId, obligationId });
      continue;
    }
    const actualItem = actualById.get(actualId), dueItem = dueById.get(obligationId);
    if (!actualItem || !dueItem) {
      errors.push({ code: 'missing-entity', actualId, obligationId });
      continue;
    }
    if (!accountOf(actualItem) || accountOf(actualItem) !== accountOf(dueItem) || currencyOf(actualItem) !== currencyOf(dueItem) ||
        directionOf(actualItem) !== directionOf(dueItem) || !currencyOf(actualItem) || !directionOf(actualItem)) {
      errors.push({ code: 'scope-mismatch', actualId, obligationId });
      continue;
    }
    const pair = JSON.stringify([actualId, obligationId]);
    if (pairs.has(pair)) {
      errors.push({ code: 'duplicate-link', actualId, obligationId });
      continue;
    }
    pairs.add(pair);
    const actualTotal = addSafe(actualTotals.get(actualId) || 0, amount);
    const dueTotal = addSafe(dueTotals.get(obligationId) || 0, amount);
    if (actualTotal === null || dueTotal === null) {
      errors.push({ code: 'out-of-range', actualId, obligationId });
      continue;
    }
    actualTotals.set(actualId, actualTotal);
    dueTotals.set(obligationId, dueTotal);
  }
  for (const [id, total] of actualTotals) {
    if (total > Number(actualById.get(id).amountMinor)) errors.push({ code: 'over-allocation', entity: 'actual', id, overByMinor: total - Number(actualById.get(id).amountMinor) });
  }
  for (const [id, total] of dueTotals) {
    if (total > Number(dueById.get(id).amountMinor)) errors.push({ code: 'over-allocation', entity: 'obligation', id, overByMinor: total - Number(dueById.get(id).amountMinor) });
  }
  if (errors.length) return { ok: false, errors, allocations: [], remainingActualMinor: {}, remainingObligationMinor: {} };

  const committed = all.map(item => ({ actualId: String(item.actualId), obligationId: String(item.obligationId), amountMinor: item.amountMinor }));
  const remainingActualMinor = Object.fromEntries(actualRows.map(item => [transactionIdOf(item), Number(item.amountMinor) - (actualTotals.get(transactionIdOf(item)) || 0)]));
  const remainingObligationMinor = Object.fromEntries(dueRows.map(item => [transactionIdOf(item), Number(item.amountMinor) - (dueTotals.get(transactionIdOf(item)) || 0)]));
  return { ok: true, errors: [], allocations: committed, remainingActualMinor, remainingObligationMinor };
}
