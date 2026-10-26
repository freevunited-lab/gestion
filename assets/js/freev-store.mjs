// FREEV — stockage en mémoire indexé par mois, au-dessus du noyau de calcul.
// Les opérations sont rangées par mois ; getLedger() ne relit que les mois touchés depuis le dernier calcul.
// Le résultat est identique à calculateLedger sur la liste complète (vérifié par freev-store.test.mjs).
// Ce module ne persiste rien : la sérialisation (IndexedDB, fichier, serveur) reste à la charge de l'application.

import { calculateLedger, recalculateFrom, recurringAmountAt, assertTransaction } from './freev-algorithm.mjs';
import { recalculateTransactionChanges } from './freev-delta-ledger.mjs';

const monthKey = date => date.slice(0, 7);
const earliest = tx => (tx.dueDate != null && tx.dueDate < tx.date ? tx.dueDate : tx.date);

const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const assertISODate = value => { if (!validDate(value)) throw new RangeError(`Date invalide : ${value}`); };
// Les frontières du store n'exposent jamais de références imbriquées appartenant à
// l'appelant. Contrat : objets/arrays JSON simples (pas de cycles ni d'instances).
// Le chemin des primitives reste léger pour les historiques importants.
function cloneFinancialData(value, stack = new WeakSet(), depth = 0) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' ||
        (typeof value === 'number' && !Number.isFinite(value)))
      throw new TypeError('Métadonnées financières non sérialisables');
    return value;
  }
  if (depth > 48 || stack.has(value)) throw new TypeError('Métadonnées financières cycliques ou trop profondes');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new TypeError('Seuls les objets JSON simples sont acceptés');
  stack.add(value);
  let result;
  if (Array.isArray(value)) result = Array.from(value, child => cloneFinancialData(child, stack, depth + 1));
  else {
    result = {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(result, key, { value: cloneFinancialData(value[key], stack, depth + 1),
        enumerable: true, writable: true, configurable: true });
    }
  }
  stack.delete(value);
  return result;
}
// Cas courant : une transaction à champs scalaires. Les propriétés imbriquées
// empruntent le clone profond ; aucune référence externe ne traverse l'API.
const copyTransaction = tx => {
  const candidate = { ...tx };
  for (const value of Object.values(candidate)) {
    if (value !== null && typeof value === 'object') return cloneFinancialData(tx);
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' ||
        (typeof value === 'number' && !Number.isFinite(value)))
      throw new TypeError('Métadonnées financières non sérialisables');
  }
  return candidate;
};
const copyRule = rule => cloneFinancialData(rule);

// L'objet résultat est identique tant que rien ne change, mais entièrement
// en lecture seule : aucune recopie de millions de lignes à chaque getLedger().
function freezeLedger(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) freezeLedger(value[key], seen);
  return Object.freeze(value);
}
// Le recalcul différentiel partage les anciennes lignes déjà figées : sceller
// uniquement ses NOUVELLES lignes puis les tableaux, pas les dizaines de milliers
// d'entrées inchangées à chaque transaction.
function freezeDeltaLedger(value) {
  if (Object.isFrozen(value)) return value;
  for (const month of value.months) if (!Object.isFrozen(month)) Object.freeze(month);
  Object.freeze(value.entries);
  Object.freeze(value.months);
  return Object.freeze(value);
}

function assertRule(rule) {
  if (!rule || rule.id == null || rule.id === '') throw new RangeError('Règle invalide : identifiant manquant');
  if (!['income', 'expense'].includes(rule.type)) throw new RangeError(`Règle invalide : ${rule.id}`);
  if (!['monthly', 'weekly', 'yearly'].includes(rule.frequency || 'monthly')) throw new RangeError('Fréquence invalide');
  recurringAmountAt(rule, rule.startDate); // valide date de début, montant et tarifs
  if (rule.endDate != null) assertISODate(rule.endDate);
  for (const date of (rule.skippedDates || [])) assertISODate(date);
  for (const item of (rule.overrides || [])) {
    assertISODate(item.date);
    if (!Number.isSafeInteger(item.amountMinor) || item.amountMinor < 0) throw new RangeError('Exception de tarif invalide');
  }
}

export function createLedgerStore({ accountId, openingDate, throughDate, openingBalanceMinor = 0, includeProjections = true }) {
  const byId = new Map();
  const buckets = new Map(); // mois -> Set d'opérations (date et échéance)
  let sortedBucketKeys = null; // invalidé seulement lors de l'ajout/suppression d'un mois
  let rules = [];
  let cached = null, dirtyFrom = null, rulesDirty = false;
  const pending = new Map(); // id -> première valeur connue, dernière valeur reçue
  const stage = (id, before, after) => {
    const existing = pending.get(id);
    const first = existing ? existing.before : before;
    if (!first && !after) pending.delete(id); // ajout puis suppression avant lecture
    else pending.set(id, { before: first, after });
  };

  const touch = date => { if (dirtyFrom === null || date < dirtyFrom) dirtyFrom = date; };
  const keysOf = tx => new Set([monthKey(tx.date), monthKey(tx.dueDate ?? tx.date)]);
  const index = tx => {
    for (const key of keysOf(tx)) {
      if (!buckets.has(key)) { buckets.set(key, new Set()); sortedBucketKeys = null; }
      buckets.get(key).add(tx);
    }
  };
  const unindex = tx => {
    for (const key of keysOf(tx)) {
      const bucket = buckets.get(key);
      bucket.delete(tx);
      if (!bucket.size) { buckets.delete(key); sortedBucketKeys = null; }
    }
  };
  const gather = fromDate => {
    const start = fromDate < openingDate ? openingDate : fromDate;
    const found = new Set();
    // Seuls les mois réellement indexés sont parcourus : un compte peut avoir
    // un historique très long avec de nombreuses périodes sans transaction.
    const keys = sortedBucketKeys ?? (sortedBucketKeys = [...buckets.keys()].sort());
    const from = monthKey(start), to = monthKey(throughDate);
    let low = 0, high = keys.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (keys[mid] < from) low = mid + 1; else high = mid;
    }
    for (let i = low; i < keys.length && keys[i] <= to; i++) {
      for (const tx of buckets.get(keys[i])) found.add(tx);
    }
    return [...found];
  };

  return {
    get transactionCount() { return byId.size; },
    // Retourner un instantané : modifier l'objet reçu ne corrompt pas les index.
    getTransaction: id => { const value = byId.get(String(id)); return value ? copyTransaction(value) : undefined; },

    addTransaction(tx) {
      assertTransaction(tx);
      if (tx.id == null || tx.id === '') throw new RangeError('Identifiant requis');
      const id = String(tx.id);
      if (byId.has(id)) throw new RangeError(`Identifiant dupliqué : ${tx.id}`);
      const snapshot = copyTransaction(tx);
      byId.set(id, snapshot); index(snapshot); touch(earliest(snapshot)); stage(id, null, snapshot);
    },
    updateTransaction(tx) {
      assertTransaction(tx);
      const id = String(tx.id);
      const old = byId.get(id);
      if (!old) throw new RangeError(`Opération inconnue : ${tx.id}`);
      const snapshot = copyTransaction(tx);
      unindex(old); index(snapshot); byId.set(id, snapshot);
      touch(earliest(old)); touch(earliest(snapshot)); stage(id, old, snapshot);
    },
    removeTransaction(id) {
      const old = byId.get(String(id));
      if (!old) return false;
      byId.delete(String(id)); unindex(old); touch(earliest(old)); stage(String(id), old, null);
      return true;
    },

    /** `from` : plus ancienne date d'effet de la modification ; à défaut, on repart du début de la règle. */
    upsertRule(rule, from) {
      assertRule(rule);
      if (from != null) assertISODate(from);
      const snapshot = copyRule(rule);
      const old = rules.find(item => String(item.id) === String(snapshot.id));
      rules = old ? rules.map(item => (String(item.id) === String(snapshot.id) ? snapshot : item)) : [...rules, snapshot];
      // Une modification structurelle peut toucher toute la série.
      // Pour les seuls changements de tarifs, identifier aussi les versions
      // supprimées : une date d'effet fournie trop tard ne doit rien masquer.
      const withoutRates = value => JSON.stringify({ ...value, rateVersions: [] });
      const structural = !old || withoutRates(old) !== withoutRates(snapshot);
      let changed = old ? (old.startDate < snapshot.startDate ? old.startDate : snapshot.startDate) : snapshot.startDate;
      if (old && !structural) {
        const oldRates = new Map((old.rateVersions || []).map(v => [v.effectiveFrom, v.amountMinor]));
        const nextRates = new Map((snapshot.rateVersions || []).map(v => [v.effectiveFrom, v.amountMinor]));
        const dates = [...new Set([...oldRates.keys(), ...nextRates.keys()])].filter(date => oldRates.get(date) !== nextRates.get(date));
        if (!dates.length) return;
        changed = dates.sort()[0];
      }
      rulesDirty = true;
      touch(from && from < changed ? from : changed);
    },
    removeRule(id, from) {
      const old = rules.find(item => item.id === id);
      if (!old) return false;
      rules = rules.filter(item => item.id !== id);
      rulesDirty = true;
      touch(from ?? old.startDate);
      return true;
    },

    getLedger() {
      if (cached && dirtyFrom === null) return cached;
      if (cached && !rulesDirty && pending.size === 0) { dirtyFrom = null; return cached; }
      const params = { openingBalanceMinor, openingDate, throughDate, accountId, includeProjections, rules };
      // Une modification d'une règle ou d'un paiement associé à une règle peut
      // faire réapparaître une échéance : utiliser alors la méthode de référence.
      const changes = [...pending.values()];
      const canDelta = cached && !rulesDirty && changes.length > 0 && changes.length <= 256 &&
        changes.every(({ before, after }) => !before?.parentId && !after?.parentId);
      const next = canDelta
        ? recalculateTransactionChanges(cached, changes, freezeLedger)
        : cached
          ? recalculateFrom(cached, dirtyFrom, { ...params, transactions: gather(dirtyFrom) })
          : calculateLedger({ ...params, transactions: gather(openingDate) });
      cached = canDelta ? freezeDeltaLedger(next) : freezeLedger(next);
      dirtyFrom = null; rulesDirty = false; pending.clear();
      return cached;
    },
  };
}
