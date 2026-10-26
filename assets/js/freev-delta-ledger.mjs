// FREEV V6 — recalcul incrémental par différences d'opérations.
// Chemin sûr uniquement pour les transactions sans parentId : les projections
// récurrentes restent inchangées. Le store choisit le calcul complet sinon.
// Aucun état global, aucun stockage, aucune modification des anciennes entrées.
const isSafe = Number.isSafeInteger;
const addSafe = (a, b) => {
  const sum = a + b;
  if (!isSafe(sum)) throw new RangeError('Solde hors limites');
  return sum;
};
const priority = { actual: 0, planned: 1, projected: 2 };
const sortEntries = (a, b) => a.date.localeCompare(b.date) || a.signedMinor - b.signedMinor ||
  String(a.id).localeCompare(String(b.id)) || priority[a.source] - priority[b.source];
const applies = (tx, account) => tx && (tx.type === 'transfer'
  ? String(tx.fromAccountId ?? '') === account || String(tx.toAccountId ?? '') === account
  : String(tx.accountId ?? '') === account);

function asEntry(tx, ledger) {
  if (!applies(tx, ledger.accountId) || tx.date < ledger.openingDate || tx.date > ledger.throughDate) return null;
  if (tx.paymentStatus === 'planned' && !ledger.includeProjections) return null;
  const signedMinor = tx.type === 'transfer'
    ? (String(tx.toAccountId) === ledger.accountId ? tx.amountMinor : -tx.amountMinor)
    : tx.type === 'expense' ? -tx.amountMinor : tx.amountMinor;
  return { ...tx, source: tx.paymentStatus === 'planned' ? 'planned' : 'actual', signedMinor };
}

function mergeSorted(left, right) {
  const result = [];
  let i = 0, j = 0;
  while (i < left.length && j < right.length) {
    if (sortEntries(left[i], right[j]) <= 0) result.push(left[i++]);
    else result.push(right[j++]);
  }
  while (i < left.length) result.push(left[i++]);
  while (j < right.length) result.push(right[j++]);
  return result;
}

/**
 * Applique un lot de mutations depuis le dernier instantané du store.
 * `changes`: [{before: tx|null, after: tx|null}]. Pour toute opération avec
 * parentId, le store doit utiliser le chemin de référence afin de recalculer
 * les échéances supprimées / réapparues.
 */
export function recalculateTransactionChanges(previous, changes, sealNewEntry = null) {
  if (!previous || !Array.isArray(changes) || !changes.length) throw new TypeError('Différences invalides');
  let changedDate = null;
  const removed = new Set();
  const added = [];
  for (const change of changes) {
    if (!change || (!change.before && !change.after) || change.before?.parentId || change.after?.parentId) {
      throw new RangeError('Différence de récurrence non prise en charge');
    }
    for (const tx of [change.before, change.after]) {
      if (!tx) continue;
      // Les paiements externes hors du compte ne modifient pas l'agrégat.
      if (!applies(tx, previous.accountId) || tx.date > previous.throughDate) continue;
      if (changedDate === null || tx.date < changedDate) changedDate = tx.date;
    }
    if (change.before) removed.add(String(change.before.id));
    if (change.after) {
      const entry = asEntry(change.after, previous);
      if (entry) added.push(sealNewEntry ? sealNewEntry(entry) : entry);
    }
  }
  if (changedDate === null) return previous;
  if (changedDate < previous.openingDate) changedDate = previous.openingDate;
  const month = changedDate.slice(0, 7);
  const boundary = `${month}-01`;
  const kept = previous.months.filter(row => row.month < month);
  const base = kept.length ? kept[kept.length - 1].closingBalanceMinor : previous.openingBalanceMinor;
  // Rechercher la première écriture du mois, en temps logarithmique.
  let lo = 0, hi = previous.entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (previous.entries[mid].date < boundary) lo = mid + 1;
    else hi = mid;
  }
  const prefixEnd = lo;
  const oldTail = previous.entries.slice(prefixEnd);
  // Ne jamais supprimer une projection qui aurait le même ID qu'une transaction.
  const reused = oldTail.filter(entry => entry.source === 'projected' || !removed.has(String(entry.id)));
  added.sort(sortEntries);
  const tail = mergeSorted(reused, added);
  const months = [], byMonth = new Map();
  let balanceMinor = base, lowestTail = base;
  let oldActual = 0, oldPlanned = 0, oldProjected = 0;
  for (const entry of oldTail) {
    if (entry.source === 'actual') oldActual++;
    else { oldProjected++; if (entry.source === 'planned') oldPlanned++; }
  }
  let actual = 0, planned = 0, projected = 0;
  for (const entry of tail) {
    const before = balanceMinor;
    balanceMinor = addSafe(balanceMinor, entry.signedMinor);
    lowestTail = Math.min(lowestTail, balanceMinor);
    const key = entry.date.slice(0, 7);
    let row = byMonth.get(key);
    if (!row) {
      row = { month: key, incomeMinor: 0, expenseMinor: 0, refundMinor: 0,
        transferInMinor: 0, transferOutMinor: 0, projectedCount: 0,
        closingBalanceMinor: 0, lowestBalanceMinor: Math.min(before, balanceMinor) };
      byMonth.set(key, row);
      months.push(row);
    }
    row.lowestBalanceMinor = Math.min(row.lowestBalanceMinor, before, balanceMinor);
    const field = entry.type === 'income' ? 'incomeMinor'
      : entry.type === 'expense' ? 'expenseMinor'
      : entry.type === 'refund' ? 'refundMinor'
      : entry.signedMinor > 0 ? 'transferInMinor' : 'transferOutMinor';
    row[field] = addSafe(row[field], entry.amountMinor);
    row.closingBalanceMinor = balanceMinor;
    if (entry.source === 'actual') actual++;
    else { projected++; row.projectedCount++; if (entry.source === 'planned') planned++; }
  }
  const previousLowest = kept.reduce((min, row) => Math.min(min, row.lowestBalanceMinor), previous.openingBalanceMinor);
  const actualCount = previous.actualCount - oldActual + actual;
  const plannedCount = previous.plannedCount - oldPlanned + planned;
  const projectedCount = previous.projectedCount - oldProjected + projected;
  if (![actualCount, plannedCount, projectedCount].every(n => isSafe(n) && n >= 0)) throw new RangeError('Compteurs incohérents');
  return {
    ...previous, entries: previous.entries.slice(0, prefixEnd).concat(tail),
    months: kept.concat(months.map(row => ({ ...row, netExpenseMinor: addSafe(row.expenseMinor, -row.refundMinor) }))),
    closingBalanceMinor: balanceMinor, lowestMinor: Math.min(previousLowest, lowestTail),
    actualCount, plannedCount, projectedCount
  };
}
