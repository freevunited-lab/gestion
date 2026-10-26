export const RECEIPT_LEARNING_PREFIX = 'freevReceiptMerchantLearning_v1:';

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').replace(/[^a-z0-9]+/g, ' ').trim();
const validName = value => typeof value === 'string' && value.trim().length >= 3 && value.trim().length <= 80 && /\p{L}/u.test(value);
const generic = /^(?:ticket|magasin|commerce|supermarche|recu|facture|caisse|client)$/;

export function receiptLearningKey(userId, accountId) {
  return `${RECEIPT_LEARNING_PREFIX}${encodeURIComponent(String(userId || 'local'))}:${encodeURIComponent(String(accountId || ''))}`;
}

function read(storage, key) {
  try {
    const value = JSON.parse(storage?.getItem(key) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (_) { return {}; }
}

// Deux corrections confirmées sont nécessaires avant toute suggestion.
export function learnMerchantCorrection(storage, key, observed, corrected) {
  const source = normalize(observed);
  const target = normalize(corrected);
  if (!validName(observed) || !validName(corrected) || !source || !target || source === target || generic.test(source)) return false;
  const entries = read(storage, key);
  const previous = entries[source];
  entries[source] = { name: corrected.trim().slice(0, 80), count: previous && normalize(previous.name) === target ? Math.min(20, (Number(previous.count) || 0) + 1) : 1 };
  const limited = Object.fromEntries(Object.entries(entries).slice(-40));
  try { storage?.setItem(key, JSON.stringify(limited)); return true; }
  catch (_) { return false; }
}

export function suggestMerchantCorrection(storage, key, observed) {
  const source = normalize(observed);
  if (!validName(observed) || generic.test(source)) return null;
  const record = read(storage, key)[source];
  return record && Number(record.count) >= 2 && validName(record.name) ? record.name : null;
}
