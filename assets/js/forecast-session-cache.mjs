// V6.1 — réutilisation des stores de projection dans une session locale uniquement.
// Chaque scénario est isolé par propriétaire, comptes, devise et période.
// Aucune écriture de données utilisateur, aucun stockage persistant.
import { createLedgerStore } from './freev-store.mjs';

const TYPES = new Set(['income', 'expense', 'transfer', 'savings_withdrawal', 'inter_account']);
const dateValid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function prepare(entries, { openingDate, throughDate, openingBalanceMinor }) {
  if (!dateValid(openingDate) || !dateValid(throughDate) || openingDate > throughDate || !Number.isSafeInteger(openingBalanceMinor))
    throw new RangeError('Période ou solde initial invalide');
  if (!Array.isArray(entries)) throw new TypeError('Liste des flux invalide');
  return entries.map((entry, index) => {
    if (!entry || !dateValid(entry.date) || entry.date < openingDate || entry.date > throughDate ||
        !Number.isSafeInteger(entry.amountMinor) || entry.amountMinor < 0 || !TYPES.has(entry.type)) {
      throw new RangeError(`Flux de prévision invalide : ${entry?.id ?? index}`);
    }
    // Identifiant d'index historique conservé pour préserver le résultat du pont V6.
    return { id: `future-${index}`, accountId: '__freev_future_cashflow__', date: entry.date,
      type: entry.type === 'income' ? 'income' : 'expense', amountMinor: entry.amountMinor, paymentStatus: 'planned' };
  });
}

const same = (a, b) => a.id === b.id && a.date === b.date && a.amountMinor === b.amountMinor && a.type === b.type;

export function createForecastSessionCache({ maxSessions = 6, maxEntries = 30000 } = {}) {
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1 || maxSessions > 64) throw new RangeError('Capacité invalide');
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError('Capacité des opérations invalide');
  const sessions = new Map();
  const stats = { initializations: 0, reused: 0, updates: 0, removals: 0, additions: 0, evictions: 0 };
  let activeOwner = null;
  const clear = () => { const removed = sessions.size; sessions.clear(); activeOwner = null; return removed; };
  const calculate = (entries, options, { ownerUid, accountIds, currency } = {}) => {
    // Aucun partage implicite. Si le contexte d'authentification est absent, calcul isolé.
    const normalized = prepare(entries, options);
    if (normalized.length > maxEntries || typeof ownerUid !== 'string' || !Array.isArray(accountIds) || !accountIds.length ||
        accountIds.some(id => id === null || id === undefined || String(id) === '') ||
        typeof currency !== 'string' || !currency) {
      const store = createLedgerStore({ accountId: '__freev_future_cashflow__', ...options, includeProjections: true });
      for (const tx of normalized) store.addTransaction(tx);
      return store.getLedger();
    }
    if (activeOwner !== null && activeOwner !== ownerUid) { sessions.clear(); }
    activeOwner = ownerUid;
    // Identifiants ordonnés : le modèle de résultat peut refléter l'ordre source.
    const key = JSON.stringify([ownerUid, accountIds.map(String), currency, options.openingDate,
      options.throughDate, options.openingBalanceMinor]);
    let session = sessions.get(key);
    if (!session) {
      const store = createLedgerStore({ accountId: '__freev_future_cashflow__', ...options, includeProjections: true });
      for (const tx of normalized) store.addTransaction(tx);
      session = { store, old: normalized };
      stats.initializations++;
    } else {
      stats.reused++;
      // Conserver les anciennes transactions jusqu'à la validation complète de prepare().
      const before = session.old;
      const length = Math.min(before.length, normalized.length);
      for (let i = 0; i < length; i++) {
        if (!same(before[i], normalized[i])) { session.store.updateTransaction(normalized[i]); stats.updates++; }
      }
      for (let i = normalized.length; i < before.length; i++) { session.store.removeTransaction(before[i].id); stats.removals++; }
      for (let i = before.length; i < normalized.length; i++) { session.store.addTransaction(normalized[i]); stats.additions++; }
      session.old = normalized;
    }
    // LRU borné ; la mémoire des sessions de compte non visitées est libérée.
    sessions.delete(key); sessions.set(key, session);
    while (sessions.size > maxSessions) { sessions.delete(sessions.keys().next().value); stats.evictions++; }
    return session.store.getLedger();
  };
  return Object.freeze({ calculate, clear, get size() { return sessions.size; }, get statistics() { return { ...stats }; } });
}
