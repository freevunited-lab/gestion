// FREEV Gestion — moteur monétaire et calculs de trésorerie purs (CDC ALX 01, 02, 04 ; QUO 01, 02, 04, 06 ; AJ 06).
// Aucune dépendance au DOM ni à l'horloge : les dates et les montants sont fournis par l'appelant.
// Tous les montants sont des ENTIERS en plus petite unité monétaire (centimes pour l'euro).

import './finance-money.js';

export const minorDigits = globalThis.FREEVMoney.minorDigits;
export const parseAmount = globalThis.FREEVMoney.parseAmount;
export const parseStoredAmount = globalThis.FREEVMoney.parseStoredAmount;
export const parseTransactionBaseMinor = globalThis.FREEVMoney.parseTransactionBaseMinor;
export const sumTransactionTotalsMinor = globalThis.FREEVMoney.sumTransactionTotalsMinor;
export const computeBalanceMinor = globalThis.FREEVMoney.computeBalanceMinor;
export const formatMinor = globalThis.FREEVMoney.formatMinor;
export const convertMinor = globalThis.FREEVMoney.convertMinor;

/**
 * ALX 01 — répartit un total en parts selon des poids entiers ; la somme des parts égale TOUJOURS le total.
 * Les restes sont distribués une unité à la fois, dans l'ordre des parts (100 € en 3 → 33,34 / 33,33 / 33,33).
 */
export function allocate(totalMinor, weights) {
  if (typeof weights === 'number' && (!Number.isSafeInteger(weights) || weights <= 0)) throw new RangeError('Répartition invalide');
  const list = typeof weights === 'number' ? Array.from({ length: weights }, () => 1) : [...weights];
  if (!Number.isSafeInteger(totalMinor) || !list.length || list.some(w => !Number.isSafeInteger(w) || w < 0)) throw new RangeError('Répartition invalide');
  const bigWeights = list.map(BigInt);
  const sum = bigWeights.reduce((a, b) => a + b, 0n);
  if (sum <= 0n) throw new RangeError('Poids nuls');
  const sign = totalMinor < 0 ? -1n : 1n, abs = BigInt(Math.abs(totalMinor));
  const shares = bigWeights.map(w => (abs * w) / sum);
  let rest = abs - shares.reduce((a, b) => a + b, 0n);
  for (let i = 0; rest > 0n; i = (i + 1) % list.length) if (bigWeights[i] > 0n) { shares[i] += 1n; rest -= 1n; }
  return shares.map(v => Number(sign * v));
}

// ---------------------------------------------------------------------------------------------
// QUO 01 / QUO 02 — « Ce que je peux encore dépenser »
// ---------------------------------------------------------------------------------------------

/**
 * @param {object} i
 * @param {number} i.cash            trésorerie réglée et disponible des comptes liquides retenus (minor)
 * @param {Array<{id:string,amount:number}>} [i.dueBeforeIncome] sorties restant dues avant le prochain revenu ; un id n'est compté qu'une fois
 * @param {number|null} [i.reserve]  réserve choisie ; null/undefined = non définie (signalé)
 * @param {number} [i.allocated]     sommes affectées à des projets ET comprises dans `cash`
 * @param {string|null} [i.periodEnd] date de fin (prochain revenu confirmé ou fin de période explicite)
 * @param {boolean} [i.periodEndIsExplicitFallback] vrai si la fin est une fin de période choisie faute de revenu
 */
export function computeSpendable(i) {
  const missing = [];
  const seen = new Set();
  let due = 0, duplicatesIgnored = 0;
  for (const item of i.dueBeforeIncome || []) {
    if (!Number.isSafeInteger(item.amount) || item.amount < 0) return { ok: false, error: { code: 'invalid-due', message: 'Échéance invalide', field: item.id } };
    if (item.id != null) { if (seen.has(item.id)) { duplicatesIgnored += 1; continue; } seen.add(item.id); }
    due += item.amount;
    if (!Number.isSafeInteger(due)) return { ok: false, error: { code: 'out-of-range', message: 'Total des échéances hors limites', field: 'dueBeforeIncome' } };
  }
  if (!Number.isSafeInteger(i.cash)) return { ok: false, error: { code: 'invalid-cash', message: 'Trésorerie de départ indisponible', field: 'cash' } };
  if (i.reserve != null && (!Number.isSafeInteger(i.reserve) || i.reserve < 0)) return { ok: false, error: { code: 'invalid-reserve', message: 'Réserve invalide', field: 'reserve' } };
  if (i.allocated != null && (!Number.isSafeInteger(i.allocated) || i.allocated < 0)) return { ok: false, error: { code: 'invalid-allocation', message: 'Sommes affectées invalides', field: 'allocated' } };
  if (i.reserve == null) missing.push('reserve');
  if (!i.periodEnd) missing.push('periodEnd');
  const reserve = i.reserve ?? 0, allocated = i.allocated ?? 0;
  const raw = i.cash - due - reserve - allocated;
  if (!Number.isSafeInteger(raw)) return { ok: false, error: { code: 'out-of-range', message: 'Résultat du calcul hors limites', field: 'cash' } };
  return {
    ok: true,
    raw,
    free: Math.max(0, raw),
    shortfall: raw < 0 ? -raw : 0,
    status: raw < 0 ? 'shortfall' : raw === 0 ? 'none-left' : 'available',
    breakdown: { cash: i.cash, due, reserve, allocated },
    periodEnd: i.periodEnd || null,
    periodEndIsExplicitFallback: Boolean(i.periodEndIsExplicitFallback),
    duplicatesIgnored,
    missing,
    complete: missing.length === 0
  };
}

// ---------------------------------------------------------------------------------------------
// ALX 04 — prévision de trésorerie par jour
// ---------------------------------------------------------------------------------------------

/**
 * @param {number} startBalance solde de départ (minor)
 * @param {Array<{date:string,amount:number,label?:string,certain?:boolean}>} flows flux datés (AAAA-MM-JJ), amount signé
 * @param {{from:string,to:string}} range
 * Sans ordre intrajournalier connu, les entrées du jour sont comptées après les sorties (lecture prudente).
 */
export function dailyProjection(startBalance, flows, range) {
  const validDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!Number.isSafeInteger(startBalance)) throw new RangeError('Solde de départ invalide');
  if (!validDate(range?.from) || !validDate(range?.to) || range.from > range.to) throw new RangeError('Période invalide');
  const days = [];
  const byDate = new Map();
  for (const flow of flows) {
    if (!validDate(flow.date) || !Number.isSafeInteger(flow.amount)) throw new RangeError(`Flux invalide : ${flow.label || flow.date}`);
    if (flow.date < range.from || flow.date > range.to) continue;
    if (!byDate.has(flow.date)) byDate.set(flow.date, []);
    byDate.get(flow.date).push(flow);
  }
  let balance = startBalance, minimum = null, firstShortfall = null;
  const cursor = new Date(`${range.from}T00:00:00Z`), end = new Date(`${range.to}T00:00:00Z`);
  for (; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    const dayFlows = (byDate.get(date) || []).slice().sort((a, b) => a.amount - b.amount);
    let intraDayLow = balance;
    for (const flow of dayFlows) {
      balance += flow.amount;
      if (!Number.isSafeInteger(balance)) throw new RangeError(`Solde hors limites : ${date}`);
      if (balance < intraDayLow) intraDayLow = balance;
    }
    const day = { date, balance, lowest: intraDayLow, flows: dayFlows, estimated: dayFlows.some(f => f.certain === false) };
    days.push(day);
    if (minimum === null || intraDayLow < minimum.balance) minimum = { date, balance: intraDayLow };
    if (!firstShortfall && intraDayLow < 0) {
      firstShortfall = { date, need: -intraDayLow, payments: dayFlows.filter(f => f.amount < 0) };
    }
  }
  return { days, minimum, firstShortfall, endBalance: balance, intradayOrderUnknown: days.some(d => d.flows.length > 1) };
}

// ---------------------------------------------------------------------------------------------
// QUO 06 — provisions pour factures non mensuelles
// ---------------------------------------------------------------------------------------------

export function provisionPlan({ amount, reserved = 0, remainingInstallments }) {
  if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(reserved) || reserved < 0) throw new RangeError('Montants invalides');
  const missing = Math.max(0, amount - reserved);
  if (!Number.isSafeInteger(remainingInstallments) || remainingInstallments <= 0) {
    // Date dépassée ou aucun versement possible : pas de division par zéro.
    return { missing, perInstallment: [], overdue: true, immediateShortfall: missing };
  }
  return { missing, perInstallment: missing === 0 ? Array(remainingInstallments).fill(0) : allocate(missing, remainingInstallments), overdue: false, immediateShortfall: 0 };
}

// ---------------------------------------------------------------------------------------------
// QUO 03 / QUO 04 — dépenses partagées et sommes à récupérer
// ---------------------------------------------------------------------------------------------

/** Trois lectures distinctes : débit bancaire, part personnelle, créance. */
export function splitExpense({ total, payerIndex = 0, shares }) {
  if (!Array.isArray(shares) && (!Number.isSafeInteger(shares) || shares <= 0)) throw new RangeError('Parts invalides');
  const parts = typeof shares === 'number' ? allocate(total, shares) : allocate(total, shares);
  if (!Number.isSafeInteger(payerIndex) || payerIndex < 0 || payerIndex >= parts.length) throw new RangeError('Indice du payeur invalide');
  const personal = parts[payerIndex];
  return { bankDebit: total, personalShare: personal, receivable: total - personal, shares: parts };
}

/** Un remboursement partiel réduit le reste attendu sans créer d'écriture supplémentaire ; le trop-perçu est signalé. */
export function applyReimbursement(expected, received) {
  if (![expected, received].every(Number.isSafeInteger) || expected < 0 || received < 0) throw new RangeError('Montants invalides');
  const applied = Math.min(expected, received);
  const remaining = expected - applied;
  return { remaining, overpaid: received - applied, state: remaining === 0 ? 'received' : applied > 0 ? 'partially-received' : 'expected', newTransactions: 0 };
}

// ---------------------------------------------------------------------------------------------
// AJ 06 — base de revenus prudente
// ---------------------------------------------------------------------------------------------

/**
 * @param {Array<{month:string,covered:boolean,income:number|null,excluded?:number}>} months jusqu'à six mois civils complets
 * Un mois couvert sans revenu vaut 0 ; un mois non couvert est inconnu et n'entre pas dans le calcul.
 */
export function prudentIncomeBase(months, coefficientPercent = 80, minimumMonths = 3) {
  if (!Number.isSafeInteger(coefficientPercent) || coefficientPercent < 0 || coefficientPercent > 100 ||
      !Number.isSafeInteger(minimumMonths) || minimumMonths < 1 || !Array.isArray(months)) {
    return { ok: false, reason: 'invalid-input' };
  }
  if (months.some(m => m?.covered && (!Number.isSafeInteger(m.income) || m.income < 0))) return { ok: false, reason: 'invalid-input' };
  const used = months.filter(m => m?.covered).slice(-6);
  const excluded = months.filter(m => !m.covered).map(m => m.month);
  if (used.length < minimumMonths) return { ok: false, reason: 'insufficient-history', usedMonths: used.map(m => m.month), excludedMonths: excluded, needed: minimumMonths };
  if (used.some(m => m.excluded != null && (!Number.isSafeInteger(m.excluded) || m.excluded < 0))) return { ok: false, reason: 'invalid-input' };
  const sorted = used.map(m => {
    const net = BigInt(m.income) - BigInt(m.excluded || 0);
    if (net > BigInt(Number.MAX_SAFE_INTEGER) || net < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError('Revenu net hors limites');
    return Number(net);
  }).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : Number((BigInt(sorted[mid - 1]) + BigInt(sorted[mid])) / 2n);
  const base = Number(BigInt(median) * BigInt(coefficientPercent) / 100n);
  return { ok: true, median, base, coefficientPercent, usedMonths: used.map(m => m.month), excludedMonths: excluded, method: 'médiane des revenus retenus × coefficient de prudence' };
}
