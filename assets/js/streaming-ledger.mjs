// FREEV V9 — agrégats financiers sur flux ordonné, sans conserver les écritures.
// Contrat : alimentation EXACTEMENT UNE FOIS, triée par date, un seul compte et une seule devise.
// Les écritures prévues/projetées ne sont jamais comptées comme de vrais paiements.
// Pour des millions de lignes, la déduplication et la pagination doivent être garanties
// par une source persistante en amont. L'option verifyUniqueIds utilise O(n) mémoire.
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isDate = date => typeof date === 'string' && ISO.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) &&
  new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
const safeAdd = (left, right) => {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw new RangeError('Dépassement des montants entiers');
  return sum;
};
const kind = Object.freeze({ income: 'incomeMinor', expense: 'expenseMinor', refund: 'refundMinor',
  'transfer-in': 'transferInMinor', 'transfer-out': 'transferOutMinor' });

/** 
 * Une source paginée fournit des tableaux de transactions normalisées.
 * {id, accountId, currency, date, type, amountMinor}; type = income / expense /
 * refund / transfer-in / transfer-out. Les soldes utilisent des centimes entiers.
 * Ne fournit volontairement NI recherche de ligne, NI réécriture historique :
 * les changements passent par une nouvelle reconstruction depuis la source.
 */
export function createStreamingLedger({ accountId, currency = 'EUR', openingBalanceMinor = 0,
  verifyUniqueIds = false } = {}) {
  if (accountId === undefined || String(accountId).trim() === '' || !/^[A-Z]{3}$/.test(currency) ||
      !Number.isSafeInteger(openingBalanceMinor) || typeof verifyUniqueIds !== 'boolean')
    throw new RangeError('Configuration du flux invalide');
  const scope = String(accountId);
  const ids = verifyUniqueIds ? new Set() : null;
  const rows = [];
  let lastDate = null;
  let current = null;
  let balance = openingBalanceMinor;
  let currentDayBalance = balance;
  let globalLowest = openingBalanceMinor;
  let count = 0;
  let completed = false;

  const flushDay = () => {
    if (lastDate === null) return;
    current.lowestDailyBalanceMinor = Math.min(current.lowestDailyBalanceMinor, balance);
    globalLowest = Math.min(globalLowest, balance);
    currentDayBalance = balance;
  };
  const prepare = (tx, previousDate = lastDate, batchIds = null) => {
    if (!tx || typeof tx !== 'object' || Array.isArray(tx) ||
        (typeof tx.id !== 'string' && !Number.isSafeInteger(tx.id)) || String(tx.id) === '' ||
        String(tx.accountId) !== scope || tx.currency !== currency || !Object.hasOwn(kind, tx.type) ||
        !Number.isSafeInteger(tx.amountMinor) || tx.amountMinor < 0 ||
        tx.paymentStatus === 'planned' || tx.projected || tx.isRecurring || tx.parentId)
      throw new RangeError('Écriture réelle du flux invalide');
    if (tx.date !== previousDate && !isDate(tx.date)) throw new RangeError('Date invalide');
    if (previousDate && tx.date < previousDate) throw new RangeError('Flux non trié chronologiquement');
    if (ids?.has(String(tx.id)) || batchIds?.has(String(tx.id))) throw new RangeError('Identifiant dupliqué');
    return tx.type === 'expense' || tx.type === 'transfer-out' ? -tx.amountMinor : tx.amountMinor;
  };
  const append = tx => {
    if (completed) throw new RangeError('Flux déjà finalisé');
    // Valider toutes les contraintes qui pourraient échouer avant de changer l'état.
    const signed = prepare(tx);
    const nextBalance = safeAdd(balance, signed);
    const month = tx.date.slice(0, 7);
    const needsMonth = !current || current.month !== month;
    const currentTotal = needsMonth ? 0 : current[kind[tx.type]];
    const newTotal = safeAdd(currentTotal, tx.amountMinor);
    if (count === Number.MAX_SAFE_INTEGER) throw new RangeError('Nombre de lignes hors limites');
    if (tx.date !== lastDate) flushDay();
    if (needsMonth) {
      current = { month, transactionCount: 0, incomeMinor: 0, expenseMinor: 0,
        refundMinor: 0, transferInMinor: 0, transferOutMinor: 0,
        openingBalanceMinor: balance, closingBalanceMinor: balance,
        lowestDailyBalanceMinor: balance };
      rows.push(current);
    }
    current[kind[tx.type]] = newTotal;
    current.transactionCount++;
    count++;
    balance = nextBalance;
    current.closingBalanceMinor = balance;
    lastDate = tx.date;
    ids?.add(String(tx.id));
  };
  // Prévalidation transactionnelle d'un lot : en cas de rejet, ni les compteurs,
  // ni les soldes, ni les identifiants déjà acceptés ne sont modifiés.
  // Mémoire supplémentaire bornée à la taille du LOT (pas à l'historique entier).
  const appendBatch = batch => {
    if (completed) throw new RangeError('Flux déjà finalisé');
    if (!batch || typeof batch[Symbol.iterator] !== 'function' || typeof batch === 'string')
      throw new TypeError('Lot non itérable');
    const staged = [];
    const batchIds = ids ? new Set() : null;
    let shadowDate = lastDate, shadowMonth = current?.month ?? null;
    let shadowBalance = balance, shadowCount = count;
    let totals = current ? {
      incomeMinor: current.incomeMinor, expenseMinor: current.expenseMinor,
      refundMinor: current.refundMinor, transferInMinor: current.transferInMinor,
      transferOutMinor: current.transferOutMinor
    } : null;
    for (const tx of batch) {
      if (!tx || typeof tx !== 'object') throw new RangeError('Écriture réelle du flux invalide');
      // Instantané des champs du contrat. Un itérateur/getter ne peut plus
      // modifier une ligne entre les deux phases de validation et d'ajout.
      const item = { id: tx.id, accountId: tx.accountId, currency: tx.currency,
        date: tx.date, type: tx.type, amountMinor: tx.amountMinor,
        paymentStatus: tx.paymentStatus, projected: tx.projected,
        isRecurring: tx.isRecurring, parentId: tx.parentId };
      const signed = prepare(item, shadowDate, batchIds);
      shadowBalance = safeAdd(shadowBalance, signed);
      if (shadowCount === Number.MAX_SAFE_INTEGER) throw new RangeError('Nombre de lignes hors limites');
      shadowCount++;
      const month = item.date.slice(0, 7);
      if (month !== shadowMonth) {
        shadowMonth = month;
        totals = { incomeMinor: 0, expenseMinor: 0, refundMinor: 0,
          transferInMinor: 0, transferOutMinor: 0 };
      }
      totals[kind[item.type]] = safeAdd(totals[kind[item.type]], item.amountMinor);
      batchIds?.add(String(item.id));
      shadowDate = item.date;
      staged.push(item);
    }
    // Les écritures ci-dessus ont déjà validé les limites de dates, montants,
    // doublons, solde et totaux. append() ne reçoit que des objets internes sûrs.
    for (const item of staged) append(item);
  };

  const summary = () => ({ accountId: scope, currency,
    openingBalanceMinor, closingBalanceMinor: balance,
    lowestDailyBalanceMinor: Math.min(globalLowest, balance),
    transactionCount: count, months: rows.map(row => ({ ...row,
      lowestDailyBalanceMinor: Math.min(row.lowestDailyBalanceMinor, row === current ? balance : row.lowestDailyBalanceMinor),
      netExpenseMinor: safeAdd(row.expenseMinor, -row.refundMinor) })),
    idUniqueness: ids ? 'verified-in-memory' : 'must-be-guaranteed-by-source',
    orderedSourceRequired: true });
  return Object.freeze({ append, appendBatch, summary,
    finish: () => { if (!completed) { flushDay(); completed = true; } return summary(); },
    get transactionCount() { return count; }, get completed() { return completed; } });
}

/** Consomme une source AsyncIterable de LOTS sans matérialiser la totalité des écritures. */
export async function summarizePagedTransactions(pages, options) {
  if (!pages || typeof pages[Symbol.asyncIterator] !== 'function')
    throw new TypeError('Source paginée asynchrone requise');
  const ledger = createStreamingLedger(options);
  for await (const page of pages) ledger.appendBatch(page);
  return ledger.finish();
}
