// FREEV cloud sync: pure defensive helpers, independently unit-testable.
// The full financial snapshot is intentionally compared, not only updatedAt.
export class CloudConflictError extends Error {
  constructor(message = 'Le document cloud a été modifié sur un autre appareil.') {
    super(message);
    this.name = 'CloudConflictError';
  }
}

export function cloudVersion(documentData) {
  const data = documentData && typeof documentData === 'object' ? documentData : {};
  const revision = data.revision;
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) {
    throw new Error('Révision cloud invalide');
  }
  if (data.accountData !== undefined && typeof data.accountData !== 'string') {
    throw new Error('Format de données cloud invalide');
  }
  return { revision: revision ?? 0, raw: data.accountData ?? null };
}

export function nextRevision(current, expected) {
  const seen = cloudVersion(current);
  if (!expected || seen.revision !== expected.revision || seen.raw !== expected.raw) {
    throw new CloudConflictError();
  }
  if (seen.revision >= Number.MAX_SAFE_INTEGER) throw new Error('Révision cloud saturée');
  return seen.revision + 1;
}

export function parseCloudState(raw) {
  if (typeof raw !== 'string') throw new Error('Contenu cloud non reconnu');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.accounts) ||
      parsed.accounts.length === 0 || parsed.accounts.length > 25 ||
      parsed.accounts.some(a => !a || typeof a !== 'object' || typeof a.id !== 'string' ||
        !Array.isArray(a.transactions) || !Array.isArray(a.recurringTransactions || []) ||
        !Array.isArray(a.debts || []))) {
    throw new Error('Sauvegarde cloud incomplète ou corrompue');
  }
  const ids = parsed.accounts.map(a => a.id);
  if (new Set(ids).size !== ids.length) throw new Error('Comptes cloud en double');
  return parsed;
}

export function needsLocalReconciliation(localState, remoteState, ownerMatches, lastUidMatches, knownDirty = false) {
  if (!ownerMatches || !lastUidMatches || !localState || !remoteState) return false;
  const localTimestamp = Date.parse(localState.lastSaved || '') || 0;
  const remoteTimestamp = Date.parse(remoteState.lastSaved || '') || 0;
  if (!knownDirty && localTimestamp <= remoteTimestamp) return false;
  // A timestamp alone cannot authorize overwriting server data: request a user decision.
  // Normalise harmless timestamp metadata to avoid false conflicts.
  const { lastSaved: _localTime, ...localContents } = localState;
  const { lastSaved: _remoteTime, ...remoteContents } = remoteState;
  const relevant = state => JSON.stringify({ accounts: state.accounts, currentAccountId: state.currentAccountId,
    multiViewMode: state.multiViewMode, selectedGroupIds: state.selectedGroupIds,
    customCategories: state.customCategories, uiSettings: state.uiSettings, savingsMeta: state.savingsMeta });
  return relevant(localContents) !== relevant(remoteContents);
}


export function equivalentCloudState(raw, state) {
  if (!raw) return false;
  try {
    const previous = parseCloudState(raw);
    const fields = data => JSON.stringify({ accounts: data.accounts, currentAccountId: data.currentAccountId,
      multiViewMode: data.multiViewMode, selectedGroupIds: data.selectedGroupIds,
      customCategories: data.customCategories, uiSettings: data.uiSettings, savingsMeta: data.savingsMeta });
    return fields(previous) === fields(state);
  } catch (_) { return false; }
}

// Fusion 3-voies volontairement restrictive pour deux appareils qui ont modifié
// des échéances mensuelles *déjà enregistrées* et distinctes. Toute opération
// touchant une dette, une épargne, une règle, un autre champ du compte ou une
// échéance identique reste un conflit à résoudre manuellement.
export function mergeDisjointRecurringMonths(baselineRaw, localRaw, remoteRaw) {
  let base, local, remote;
  try {
    base = parseCloudState(baselineRaw);
    local = parseCloudState(localRaw);
    remote = parseCloudState(remoteRaw);
  } catch (_) { return null; }
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const clone = value => JSON.parse(JSON.stringify(value));
  const otherState = s => {
    const { accounts, lastSaved, ...rest } = s;
    return rest;
  };
  if (!equal(otherState(base), otherState(local)) || !equal(otherState(base), otherState(remote)) ||
      base.accounts.length !== local.accounts.length || base.accounts.length !== remote.accounts.length) return null;

  const otherAccount = a => {
    const { transactions, recurringTransactions, historyLog, ...rest } = a;
    return rest;
  };
  const ruleContent = r => {
    const { recurrenceHistory, ...rest } = r;
    return rest;
  };
  const prefixAdded = (before, after) => {
    if (!Array.isArray(before) || !Array.isArray(after) || after.length < before.length) return null;
    const prefix = after.slice(0, after.length - before.length);
    return equal(after.slice(prefix.length), before) ? prefix : null;
  };
  const validIdMap = items => {
    if (!Array.isArray(items)) return null;
    const map = new Map();
    for (const item of items) {
      if (!item || !(['string', 'number'].includes(typeof item.id)) ||
          (typeof item.id === 'number' && (!Number.isSafeInteger(item.id) || item.id < 1)) ||
          !String(item.id).trim() || map.has(String(item.id))) return null;
      map.set(String(item.id), item);
    }
    return map;
  };
  const safeOccurrence = (oldTx, newTx, rule) => {
    if (!oldTx || !newTx || (rule?.frequency || 'monthly') !== 'monthly' ||
        oldTx.source !== 'recurring' || newTx.source !== 'recurring' ||
        String(oldTx.parentId) !== String(rule.id) || oldTx.parentId !== newTx.parentId ||
        oldTx.periodKey !== newTx.periodKey ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(oldTx.periodKey || '') ||
        ![oldTx, newTx].every(t =>
          ['income', 'expense'].includes(t.type) && !t.fromSavings && !t.linkedDebtId &&
          !t.linkedDebtAmount && !t.transferTarget && !t.reconciled &&
          t._effectsApplied !== true && t.date?.slice(0, 7) === t.periodKey)) return false;
    return true;
  };

  const result = clone(remote);
  let anyLocal = false, anyRemote = false;
  for (let i = 0; i < base.accounts.length; i++) {
    const b = base.accounts[i], l = local.accounts[i], r = remote.accounts[i];
    const out = result.accounts[i];
    if (!b.id || b.id !== l.id || b.id !== r.id ||
        !equal(otherAccount(b), otherAccount(l)) || !equal(otherAccount(b), otherAccount(r))) return null;

    const bt = validIdMap(b.transactions), lt = validIdMap(l.transactions), rt = validIdMap(r.transactions);
    const br = validIdMap(b.recurringTransactions || []);
    const lr = validIdMap(l.recurringTransactions || []);
    const rr = validIdMap(r.recurringTransactions || []);
    if (!bt || !lt || !rt || !br || !lr || !rr ||
        bt.size !== lt.size || bt.size !== rt.size || br.size !== lr.size || br.size !== rr.size) return null;
    if ([...bt.keys()].some(id => !lt.has(id) || !rt.has(id)) ||
        [...br.keys()].some(id => !lr.has(id) || !rr.has(id))) return null;
    // Interdire aussi les réordonnancements : ils peuvent être des modifications
    // d'interface ou de logique non représentées par un delta de montant.
    if (!equal(b.transactions.map(t => t.id), l.transactions.map(t => t.id)) ||
        !equal(b.transactions.map(t => t.id), r.transactions.map(t => t.id)) ||
        !equal(b.recurringTransactions.map(t => t.id), l.recurringTransactions.map(t => t.id)) ||
        !equal(b.recurringTransactions.map(t => t.id), r.recurringTransactions.map(t => t.id))) return null;
    const knownPeriods = new Set();
    for (const transaction of b.transactions) {
      if (!transaction.parentId) continue;
      const key = `${transaction.parentId}/${transaction.periodKey || ''}`;
      if (!transaction.periodKey || knownPeriods.has(key)) return null;
      knownPeriods.add(key);
    }

    const touched = [new Map(), new Map()];
    for (const [id, tx] of bt) {
      for (const [side, current] of [lt, rt].entries()) {
        const replacement = current.get(id);
        if (equal(tx, replacement)) continue;
        const rule = br.get(String(tx.parentId));
        if (!safeOccurrence(tx, replacement, rule)) return null;
        const key = `${tx.parentId}/${tx.periodKey}`;
        if (touched[side].has(key)) return null;
        touched[side].set(key, { id, before: tx, after: replacement });
      }
    }
    if ([...touched[0].keys()].some(key => touched[1].has(key))) return null;

    const newRevisions = [new Map(), new Map()];
    for (const [ruleId, oldRule] of br) {
      for (const [side, other] of [lr, rr].entries()) {
        const changedRule = other.get(ruleId);
        if (!equal(ruleContent(oldRule), ruleContent(changedRule))) return null;
        const newlyAdded = prefixAdded(oldRule.recurrenceHistory || [], changedRule.recurrenceHistory || []);
        if (newlyAdded === null) return null;
        for (const entry of newlyAdded) {
          const key = `${ruleId}/${entry?.period || ''}`;
          const change = touched[side].get(key);
          if (!entry || entry.kind !== 'single' || !entry.id || !change ||
              String(entry.after?.id) !== change.id || entry.after?.periodKey !== entry.period ||
              String(entry.before?.id) !== change.id || !entry.at) return null;
          if (!newRevisions[side].has(key)) newRevisions[side].set(key, []);
          newRevisions[side].get(key).push(entry);
        }
      }
      // Aucun changement simultané de l'historique existant ou restauration.
      const localAdded = prefixAdded(oldRule.recurrenceHistory || [], lr.get(ruleId).recurrenceHistory || []);
      const remoteAdded = prefixAdded(oldRule.recurrenceHistory || [], rr.get(ruleId).recurrenceHistory || []);
      if (localAdded?.some(a => remoteAdded?.some(z => z.id === a.id))) return null;
      if (localAdded.length) {
        const target = out.recurringTransactions.find(rule => String(rule.id) === ruleId);
        target.recurrenceHistory = [...clone(localAdded), ...(target.recurrenceHistory || [])].slice(0, 35);
        while (target.recurrenceHistory.length > 1 &&
               JSON.stringify(target.recurrenceHistory).length > 125000) target.recurrenceHistory.pop();
      }
    }
    for (let side = 0; side < 2; side++) {
      if ([...touched[side].keys()].some(key => !newRevisions[side].has(key))) return null;
      for (const [key, entries] of newRevisions[side]) {
        // Rejouer les snapshots de l'ancien au plus récent : aucune étape
        // manquante et aucun état « after » falsifié ne peuvent être fusionnés.
        let snapshot = touched[side].get(key).before;
        for (const entry of [...entries].reverse()) {
          if (!equal(entry.before, snapshot)) return null;
          snapshot = entry.after;
        }
        if (!equal(snapshot, touched[side].get(key).after)) return null;
      }
    }

    const localLog = prefixAdded(b.historyLog || [], l.historyLog || []);
    const remoteLog = prefixAdded(b.historyLog || [], r.historyLog || []);
    if (!localLog || !remoteLog) return null;
    for (const [side, logs] of [[0, localLog], [1, remoteLog]]) {
      const revisionCount = [...newRevisions[side].values()].reduce((sum, entries) => sum + entries.length, 0);
      if (logs.length !== revisionCount ||
          logs.some(entry => entry?.action !== 'update_single' || entry?.entity !== 'transaction')) return null;
    }
    out.historyLog = [...clone(localLog), ...clone(r.historyLog || [])].slice(0, 500);
    for (const change of touched[0].values()) {
      const idx = out.transactions.findIndex(tx => String(tx.id) === change.id);
      out.transactions[idx] = clone(change.after);
    }
    anyLocal ||= touched[0].size > 0;
    anyRemote ||= touched[1].size > 0;
  }
  return anyLocal && anyRemote ? result : null;
}
