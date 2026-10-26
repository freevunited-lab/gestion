// Adaptateur unique des écritures FREEV vers le grand livre V9.7.
// Les chiffres comptabilisés excluent toujours les opérations prévues et futures.
import { calculateLedger } from './freev-algorithm.mjs';
import { minorDigits, parseStoredAmount, parseTransactionBaseMinor } from './finance-core.mjs';

const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const monthEnd = month => `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
const checkedAdd = (left, right) => {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new RangeError('Total monétaire hors limites');
  return result;
};

export function accountLedger(account, throughDate, { fromDate, excludeLinkedTransfers = false, excludeRecurringChildren = false } = {}) {
  if (!validDate(throughDate)) throw new RangeError('Date de calcul invalide');
  const currency = String(account?.settings?.baseCurrency || 'EUR').toUpperCase();
  const digits = minorDigits(currency);
  const initial = parseStoredAmount(account?.initialCapital ?? 0, currency, 'initialCapital');
  if (!initial.ok) throw new RangeError(initial.error.message);
  const accountId = String(account?.id ?? 'current');
  const source = Array.isArray(account?.transactions) ? account.transactions : [];
  const transactions = [];
  let earliest = fromDate || throughDate;
  for (let index = 0; index < source.length; index++) {
    const tx = source[index];
    if (!tx || tx.isRecurring || tx.projected || tx.paymentStatus === 'planned' ||
        (excludeLinkedTransfers && tx.linkedTransferId) || (excludeRecurringChildren && tx.parentId)) continue;
    if (!validDate(tx.date)) throw new RangeError(`Date d’opération invalide : ${tx.id ?? index}`);
    if (tx.date > throughDate || (fromDate && tx.date < fromDate)) continue;
    if (!['income', 'expense', 'transfer', 'savings_withdrawal', 'inter_account'].includes(tx.type))
      throw new RangeError(`Type d’opération invalide : ${tx.id ?? index}`);
    const amount = parseTransactionBaseMinor(tx, currency);
    if (!amount.ok || amount.minor < 0) throw new RangeError(`Montant d’opération invalide : ${tx.id ?? index}`);
    earliest = tx.date < earliest ? tx.date : earliest;
    transactions.push({ id: `row:${index}`, accountId, date: tx.date, type: tx.type === 'income' ? 'income' : 'expense',
      amountMinor: amount.minor, category: tx.category || '', originalType: tx.type, originalId: tx.id ?? null });
  }
  const openingDate = fromDate || earliest;
  if (!validDate(openingDate) || openingDate > throughDate) throw new RangeError('Début de calcul invalide');
  const openingBalanceMinor = fromDate ? 0 : initial.minor;
  const ledger = calculateLedger({ accountId, openingDate, throughDate, openingBalanceMinor,
    transactions: fromDate ? transactions.filter(tx => tx.date >= fromDate) : transactions, includeProjections: false });
  return { ...ledger, currency, digits };
}

export function bookedAccountBalance(account, throughDate) {
  const ledger = accountLedger(account, throughDate);
  return { minor: ledger.closingBalanceMinor, amount: ledger.closingBalanceMinor / (10 ** ledger.digits), currency: ledger.currency };
}

export function bookedAccountMonth(account, month, options = {}) {
  return bookedAccountMonths(account, [month], options)[0];
}

export function bookedAccountMonths(account, months, options = {}) {
  if (!Array.isArray(months) || !months.length || months.some(month => !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))))
    throw new RangeError('Mois invalide');
  const ordered = [...new Set(months)].sort();
  const ledger = accountLedger(account, monthEnd(ordered.at(-1)), { ...options, fromDate: `${ordered[0]}-01` });
  const scale = 10 ** ledger.digits;
  const buckets = new Map(ordered.map(month => [month, { month, incomeMinor: 0, expenseMinor: 0, count: 0,
    unclassified: 0, categoriesMinor: Object.create(null) }]));
  for (const entry of ledger.entries) {
    const row = buckets.get(entry.date.slice(0, 7));
    if (!row) continue;
    row.count++;
    if (!entry.category || entry.category === 'À classer') row.unclassified++;
    if (entry.type === 'income') row.incomeMinor = checkedAdd(row.incomeMinor, entry.amountMinor);
    else {
      row.expenseMinor = checkedAdd(row.expenseMinor, entry.amountMinor);
      const key = entry.category || 'À classer';
      row.categoriesMinor[key] = checkedAdd(row.categoriesMinor[key] || 0, entry.amountMinor);
    }
  }
  return months.map(month => {
    const row = buckets.get(month);
    return { month, currency: ledger.currency, incomeMinor: row.incomeMinor, expenseMinor: row.expenseMinor,
      income: row.incomeMinor / scale, expenses: row.expenseMinor / scale,
      net: checkedAdd(row.incomeMinor, -row.expenseMinor) / scale,
      transactions: row.count, unclassified: row.unclassified,
      categories: Object.fromEntries(Object.entries(row.categoriesMinor).map(([key, value]) => [key, value / scale])) };
  });
}
