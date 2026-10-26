// FREEV — noyau de calcul expérimental, indépendant de l'interface et du stockage.
// Contrat : dates ISO, montants entiers en centimes, devise unique par calcul.
// Les opérations réelles priment sur les échéances projetées de même règle et date.

// Validation ISO civile, sans allouer de Date à chaque écriture (les opérations
// bancaires d'un même mois peuvent être très nombreuses).
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const validDate = value => {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = month === 2 ? (leap ? 29 : 28) :
    (month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31);
  return day <= daysInMonth;
};
const minor = value => Number.isSafeInteger(value);
const add = (left, right) => {
  const value = left + right;
  if (!minor(value)) throw new RangeError('Solde hors limites');
  return value;
};
const assertDate = date => { if (!validDate(date)) throw new RangeError(`Date invalide : ${date}`); };
const monthEnd = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

export function recurringAmountAt(rule, date) {
  assertDate(date);
  if (!minor(rule.amountMinor) || rule.amountMinor < 0) throw new RangeError('Montant récurrent invalide');
  let amount = rule.amountMinor;
  for (const version of [...(rule.rateVersions || [])].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))) {
    assertDate(version.effectiveFrom);
    if (!minor(version.amountMinor) || version.amountMinor < 0) throw new RangeError('Tarif invalide');
    if (version.effectiveFrom <= date) amount = version.amountMinor;
  }
  return amount;
}

function recurringDates(rule, from, to) {
  const start = rule.startDate;
  assertDate(start);
  const frequency = rule.frequency || 'monthly';
  if (!['monthly', 'weekly', 'yearly'].includes(frequency)) throw new RangeError('Fréquence invalide');
  if (rule.endDate != null) assertDate(rule.endDate);
  const dates = [];
  const anchorDay = Number(start.slice(8));
  if (frequency === 'monthly') {
    let year = Number(from.slice(0, 4)), month = Number(from.slice(5, 7));
    while (`${year}-${String(month).padStart(2, '0')}` <= to.slice(0, 7)) {
      const key = `${year}-${String(month).padStart(2, '0')}`;
      const date = `${key}-${String(Math.min(anchorDay, monthEnd(key))).padStart(2, '0')}`;
      if (date >= from && date >= start && date <= to && (!rule.endDate || date <= rule.endDate)) dates.push(date);
      if (++month === 13) { month = 1; year++; }
    }
  } else {
    const end = new Date(`${to}T00:00:00Z`);
    if (frequency === 'weekly') {
      // Saut direct à la première semaine utile : pas d'itération sur un historique ancien.
      const first = Date.parse(`${start}T00:00:00Z`);
      const lower = Date.parse(`${from}T00:00:00Z`);
      const week = 7 * 86_400_000;
      const skipped = Math.max(0, Math.ceil((lower - first) / week));
      const cursor = new Date(first + skipped * week);
      while (cursor <= end) {
        const date = cursor.toISOString().slice(0, 10);
        if (date >= from && (!rule.endDate || date <= rule.endDate)) dates.push(date);
        cursor.setUTCDate(cursor.getUTCDate() + 7);
      }
    } else {
      for (let year = Math.max(Number(start.slice(0, 4)), Number(from.slice(0, 4))); year <= Number(to.slice(0, 4)); year++) {
        const day = Math.min(anchorDay, monthEnd(`${year}-${start.slice(5, 7)}`));
        const date = `${year}-${start.slice(5, 7)}-${String(day).padStart(2, '0')}`;
        if (date >= start && date >= from && date <= to && (!rule.endDate || date <= rule.endDate)) dates.push(date);
      }
    }
  }
  return dates;
}

const TX_TYPES = ['income', 'expense', 'refund', 'transfer'];
const sameAccount = (value, scope) => String(value ?? '') === scope;

// Compilée une fois par règle et par calcul (aucun cache global entre comptes ou versions).
// La recherche dichotomique remplace le tri de tous les tarifs à chaque échéance.
function compileRecurringRule(rule) {
  if (!Number.isSafeInteger(rule.amountMinor) || rule.amountMinor < 0) throw new RangeError('Montant récurrent invalide');
  const versions = [...(rule.rateVersions || [])].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  for (const version of versions) {
    assertDate(version.effectiveFrom);
    if (!minor(version.amountMinor) || version.amountMinor < 0) throw new RangeError('Tarif invalide');
  }
  const overrides = new Map();
  for (const entry of (rule.overrides || [])) {
    // Comme Array.find, la première exception de même date a priorité.
    if (!overrides.has(entry.date)) overrides.set(entry.date, entry.amountMinor);
  }
  const skipped = new Set(rule.skippedDates || []);
  return date => {
    if (skipped.has(date)) return null;
    if (overrides.has(date)) return overrides.get(date);
    let low = 0, high = versions.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (versions[mid].effectiveFrom <= date) low = mid + 1;
      else high = mid;
    }
    return low ? versions[low - 1].amountMinor : rule.amountMinor;
  };
}

/** Validation d'une opération, indépendante du compte consulté. */
export function assertTransaction(tx) {
  if (!tx || typeof tx !== 'object' || Array.isArray(tx)) throw new RangeError('Opération invalide');
  assertDate(tx.date);
  if (tx.dueDate != null) assertDate(tx.dueDate);
  if (!minor(tx.amountMinor) || tx.amountMinor < 0 || !TX_TYPES.includes(tx.type)) throw new RangeError(`Opération invalide : ${tx.id}`);
  if (tx.type === 'transfer' && (tx.fromAccountId == null || tx.toAccountId == null ||
      String(tx.fromAccountId) === String(tx.toAccountId))) throw new RangeError(`Virement invalide : ${tx.id}`);
}

/**
 * Opération : {id, accountId, date, type:'income'|'expense'|'refund', amountMinor, paymentStatus?, parentId?, dueDate?}.
 *  - refund : remboursement d'une dépense (+montant au solde, compté à part de income, déduit en net des dépenses).
 *  - transfer : {id, fromAccountId, toAccountId, date, amountMinor}; débite from, crédite to, n'est ni revenu ni dépense.
 *  - paymentStatus 'planned' : opération prévue, absente du solde réel, conservée dans la prévision (includeProjections).
 *  - dueDate : échéance de la règle (parentId) réglée par cette opération, si la date de paiement est décalée.
 * Règle : {id, accountId, startDate, frequency, type:'income'|'expense', amountMinor, rateVersions?, overrides?, skippedDates?}.
 * overrides contient des montants ponctuels : {date, amountMinor}; skippedDates contient des dates ISO.
 */
export function calculateLedger({ openingBalanceMinor = 0, openingDate, accountId, transactions = [], rules = [], throughDate, includeProjections = true }) {
  assertDate(openingDate); assertDate(throughDate);
  if (openingDate > throughDate || !minor(openingBalanceMinor)) throw new RangeError('Période ou solde initial invalide');
  const scope = String(accountId ?? '');
  const actual = [], planned = [], projected = [], occupied = new Set(), ids = new Set();
  for (const tx of transactions) {
    const isTransfer = tx.type === 'transfer';
    const concerned = isTransfer
      ? sameAccount(tx.fromAccountId, scope) || sameAccount(tx.toAccountId, scope)
      : sameAccount(tx.accountId, scope);
    if (!concerned) continue;
    assertTransaction(tx);
    if (tx.id != null) {
      if (ids.has(String(tx.id))) throw new RangeError(`Identifiant dupliqué : ${tx.id}`);
      ids.add(String(tx.id));
    }
    if (tx.parentId) occupied.add(`${tx.parentId}|${tx.dueDate ?? tx.date}`);
    if (tx.date < openingDate || tx.date > throughDate) continue;
    const signedMinor = isTransfer
      ? (sameAccount(tx.toAccountId, scope) ? tx.amountMinor : -tx.amountMinor)
      : (tx.type === 'expense' ? -tx.amountMinor : tx.amountMinor);
    if (tx.paymentStatus === 'planned') {
      if (includeProjections) planned.push({ ...tx, source: 'planned', signedMinor });
      continue;
    }
    actual.push({ ...tx, source: 'actual', signedMinor });
  }
  const ruleIds = new Set();
  if (includeProjections) for (const rule of rules) {
    if (String(rule.accountId ?? '') !== scope) continue;
    if (rule.id == null || String(rule.id) === '' || !['income', 'expense'].includes(rule.type)) throw new RangeError('Règle invalide');
    const id = String(rule.id);
    if (ruleIds.has(id)) throw new RangeError(`Identifiant de règle dupliqué : ${id}`);
    ruleIds.add(id);
    const amountAt = compileRecurringRule(rule);
    for (const date of recurringDates(rule, openingDate, throughDate)) {
      if (occupied.has(`${rule.id}|${date}`)) continue;
      const amountMinor = amountAt(date);
      if (amountMinor === null) continue;
      if (!minor(amountMinor) || amountMinor < 0) throw new RangeError('Exception de tarif invalide');
      projected.push({ id: `${rule.id}|${date}`, parentId: rule.id, accountId: scope, date, type: rule.type,
        amountMinor, source: 'projected', signedMinor: rule.type === 'income' ? amountMinor : -amountMinor });
    }
  }
  const entries = [...actual, ...planned, ...projected].sort((a, b) => a.date.localeCompare(b.date) || a.signedMinor - b.signedMinor || String(a.id).localeCompare(String(b.id)));
  const months = new Map();
  let balanceMinor = openingBalanceMinor, lowestMinor = openingBalanceMinor;
  for (const entry of entries) {
    const beforeMinor = balanceMinor;
    balanceMinor = add(balanceMinor, entry.signedMinor);
    lowestMinor = Math.min(lowestMinor, balanceMinor);
    const key = entry.date.slice(0, 7);
    if (!months.has(key)) months.set(key, { month: key, incomeMinor: 0, expenseMinor: 0, refundMinor: 0, transferInMinor: 0, transferOutMinor: 0, projectedCount: 0, closingBalanceMinor: 0, lowestBalanceMinor: Math.min(beforeMinor, balanceMinor) });
    const row = months.get(key);
    row.lowestBalanceMinor = Math.min(row.lowestBalanceMinor, beforeMinor, balanceMinor);
    const field = entry.type === 'income' ? 'incomeMinor'
      : entry.type === 'expense' ? 'expenseMinor'
      : entry.type === 'refund' ? 'refundMinor'
      : entry.signedMinor > 0 ? 'transferInMinor' : 'transferOutMinor';
    row[field] = add(row[field], entry.amountMinor);
    if (entry.source !== 'actual') row.projectedCount++;
    row.closingBalanceMinor = balanceMinor;
  }
  return { accountId: scope, openingDate, throughDate, includeProjections: Boolean(includeProjections),
    openingBalanceMinor, closingBalanceMinor: balanceMinor, lowestMinor, entries,
    months: [...months.values()].map(row => ({ ...row, netExpenseMinor: add(row.expenseMinor, -row.refundMinor) })),
    actualCount: actual.length, plannedCount: planned.length, projectedCount: projected.length + planned.length };
}

/**
 * Recalcul partiel : repart du solde de clôture du dernier mois antérieur au mois de `changedDate`
 * et ne recalcule que la suite. Le résultat est identique à calculateLedger(params).
 *
 * `previous` est le résultat d'un calcul précédent avec les mêmes accountId, openingDate, throughDate,
 * openingBalanceMinor et includeProjections ; sinon (ou si le mois touché est celui d'ouverture) on recalcule tout.
 * `changedDate` est la PLUS ANCIENNE date que la modification peut influencer, à fournir par l'appelant :
 *  - opération ajoutée/supprimée/modifiée : min(date, dueDate ?? date), avant et après modification ;
 *  - règle : la plus ancienne date d'effet touchée (nouveau tarif, date ignorée, exception, changement de début).
 * Une date postérieure à throughDate n'a aucun effet : `previous` est renvoyé tel quel.
 */
export function recalculateFrom(previous, changedDate, params) {
  assertDate(changedDate);
  const { openingBalanceMinor = 0, openingDate, throughDate, accountId, includeProjections = true } = params;
  assertDate(openingDate); assertDate(throughDate);
  const startMonth = changedDate.slice(0, 7);
  const from = `${startMonth}-01`;
  const compatible = previous && previous.openingDate === openingDate && previous.throughDate === throughDate
    && previous.accountId === String(accountId ?? '') && previous.openingBalanceMinor === openingBalanceMinor
    && previous.includeProjections === Boolean(includeProjections);
  if (!compatible || from <= openingDate) return calculateLedger(params);
  if (from > throughDate) return previous;
  const kept = previous.months.filter(row => row.month < startMonth);
  const baseMinor = kept.length ? kept[kept.length - 1].closingBalanceMinor : openingBalanceMinor;
  const tail = calculateLedger({ ...params, openingDate: from, openingBalanceMinor: baseMinor });
  // Les lignes sont triées par date : recherche dichotomique de la première ligne à recalculer.
  let low = 0, high = previous.entries.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (previous.entries[mid].date < from) low = mid + 1; else high = mid;
  }
  const entries = previous.entries.slice(0, low).concat(tail.entries);
  let lowestMinor = Math.min(openingBalanceMinor, tail.lowestMinor);
  for (const row of kept) lowestMinor = Math.min(lowestMinor, row.lowestBalanceMinor);
  // Compteurs : on retire ce qui a été jeté, on ajoute ce qui a été recalculé.
  let actualCount = previous.actualCount + tail.actualCount;
  let plannedCount = previous.plannedCount + tail.plannedCount;
  let projectedCount = previous.projectedCount + tail.projectedCount;
  for (let i = low; i < previous.entries.length; i++) {
    const { source } = previous.entries[i];
    if (source === 'actual') actualCount--;
    else { projectedCount--; if (source === 'planned') plannedCount--; }
  }
  return { ...tail, openingDate, openingBalanceMinor, lowestMinor, entries, months: kept.concat(tail.months),
    actualCount, plannedCount, projectedCount };
}
