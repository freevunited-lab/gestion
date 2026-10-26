// FREEV V6 — audit indépendant d'écritures canoniques du noyau (montants mineurs).
// Pas un importeur du format historique de l'interface, et ne modifie jamais les données.
import { assertTransaction } from './freev-algorithm.mjs';

const sum = (a, b) => {
  const n = a + b;
  if (!Number.isSafeInteger(n)) throw new RangeError('Somme hors limites');
  return n;
};

/**
 * Contrôle des identifiants, comptes, devises et de la compensation des virements.
 * Les opérations planifiées sont exclues par défaut du solde RÉEL.
 * `accounts` : [{ id, currency: 'EUR' }], aucune conversion implicite.
 * Les données incorrectes sont signalées, jamais réparées silencieusement.
 */
export function auditCanonicalLedger({ accounts, transactions, includePlanned = false } = {}) {
  if (!Array.isArray(accounts) || !Array.isArray(transactions)) throw new TypeError('Listes invalides');
  const currencies = new Map();
  for (const account of accounts) {
    const id = String(account?.id ?? ''), currency = String(account?.currency ?? '').toUpperCase();
    if (!id || !/^[A-Z]{3}$/.test(currency) || currencies.has(id)) throw new RangeError('Compte ou devise invalide');
    currencies.set(id, currency);
  }
  const issues = [], ids = new Set();
  const balances = new Map(accounts.map(({ id }) => [String(id), 0]));
  const postings = [];
  const record = (id, transactionId, amountMinor) => {
    if (!balances.has(id)) { issues.push({ code: 'unknown-account', transactionId, accountId: id }); return; }
    balances.set(id, sum(balances.get(id), amountMinor));
    postings.push({ transactionId, accountId: id, signedMinor: amountMinor });
  };
  for (const tx of transactions) {
    const id = String(tx?.id ?? '');
    if (!id || ids.has(id)) {
      issues.push({ code: id ? 'duplicate-id' : 'missing-id', transactionId: id });
      continue;
    }
    ids.add(id);
    try { assertTransaction(tx); } catch (_) {
      issues.push({ code: 'invalid-transaction', transactionId: id });
      continue;
    }
    if (tx.paymentStatus === 'planned' && !includePlanned) continue;
    if (tx.type === 'transfer') {
      const from = String(tx.fromAccountId), to = String(tx.toAccountId);
      if (!balances.has(from) || !balances.has(to)) {
        issues.push({ code: 'unknown-transfer-account', transactionId: id });
        continue;
      }
      if (currencies.get(from) !== currencies.get(to)) {
        issues.push({ code: 'currency-mismatch', transactionId: id });
        continue;
      }
      // Virement atomique en deux jambes. Aucun revenu ni dépense généré.
      record(from, id, -tx.amountMinor);
      record(to, id, tx.amountMinor);
    } else {
      if (tx.accountId == null || String(tx.accountId) === '') {
        issues.push({ code: 'missing-account', transactionId: id });
        continue;
      }
      record(String(tx.accountId), id, tx.type === 'expense' ? -tx.amountMinor : tx.amountMinor);
    }
  }
  return {
    ok: issues.length === 0, issues, postings,
    balancesMinor: Object.fromEntries(balances),
    // Vérifiable seulement si toutes les écritures sont admissibles.
    netMovementMinor: [...balances.values()].reduce(sum, 0)
  };
}
