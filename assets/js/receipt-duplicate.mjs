const normalizeLabel = value => ` ${String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
const toMinor = value => {
  const number = Number(value);
  const minor = Math.round(number * 100);
  return Number.isFinite(number) && Number.isSafeInteger(minor) && minor > 0 ? minor : null;
};
const minuteOfDay = value => /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(value || ''))
  ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;

// Une ressemblance est un avertissement, jamais une suppression ou un rejet automatique.
export function findLikelyReceiptDuplicates(transactions, receipt, accountCurrency, limit = 3) {
  if (!Array.isArray(transactions) || !receipt?.date || !receipt?.merchant || !Number.isSafeInteger(receipt.amountMinor) || receipt.amountMinor <= 0) return [];
  const merchant = normalizeLabel(receipt.merchant);
  if (merchant.length < 6) return [];
  const currency = String(receipt.currency || '').toUpperCase();
  const base = String(accountCurrency || '').toUpperCase();
  const type = receipt.type === 'income' ? 'income' : 'expense';
  if (!currency || !base) return [];
  const receiptTime = minuteOfDay(receipt.time);
  const matches = [];
  for (const transaction of transactions) {
    if (transaction?.type !== type || transaction.date !== receipt.date) continue;
    const transactionCurrency = String(transaction.currency || base).toUpperCase();
    const amount = transactionCurrency === currency
      ? toMinor(transaction.originalAmount ?? (currency === base ? transaction.amountBase ?? transaction.amount : null))
      : currency === base ? toMinor(transaction.amountBase ?? transaction.amount) : null;
    if (amount !== receipt.amountMinor) continue;
    const description = normalizeLabel(transaction.desc || transaction.description || transaction.merchant);
    if (!description.includes(merchant)) continue;
    const existingTime = minuteOfDay(transaction.time);
    if (receiptTime !== null && existingTime !== null && Math.abs(receiptTime - existingTime) > 20) continue;
    matches.push(transaction);
    if (matches.length >= limit) break;
  }
  return matches;
}
