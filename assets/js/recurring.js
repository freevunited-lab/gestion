// ---------- Moteur unifié des transactions récurrentes ----------
// Toutes les vues utilisent ces helpers afin d'éviter des calculs divergents.

function normalizeRecurringFrequency(value) {
  return ['monthly', 'weekly', 'yearly'].includes(value) ? value : 'monthly';
}

function periodKey(dateISO, frequency) {
  const d = new Date(`${dateISO}T00:00:00`);
  const freq = normalizeRecurringFrequency(frequency);
  if (freq === 'weekly') {
    const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
    return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }
  if (freq === 'yearly') return String(d.getFullYear());
  return dateISO.slice(0, 7);
}

function recurringDatesForMonth(rule, month) {
  if (!rule || !/^\d{4}-\d{2}$/.test(String(month || ''))) return [];
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  const startDate = rule.startDate || isoDate(getToday());
  const start = new Date(`${startDate}T00:00:00`);
  const frequency = normalizeRecurringFrequency(rule.frequency);
  const dates = [];

  if (frequency === 'monthly') {
    const requestedDay = Math.max(1, Math.min(31, Number(rule.dayOfMonth) || start.getDate() || 1));
    dates.push(`${month}-${String(Math.min(requestedDay, lastDay)).padStart(2, '0')}`);
  } else if (frequency === 'weekly') {
    const weekday = start.getDay();
    for (let day = 1; day <= lastDay; day++) {
      const target = new Date(year, mon - 1, day);
      if (target.getDay() === weekday) dates.push(`${month}-${String(day).padStart(2, '0')}`);
    }
  } else if (start.getMonth() === mon - 1) {
    // Le 29 février devient le dernier jour de février lors des années non bissextiles.
    dates.push(`${month}-${String(Math.min(start.getDate(), lastDay)).padStart(2, '0')}`);
  }

  const effectiveEndDate = String(rule?.subscription?.effectiveEndDate || '');
  return dates.filter(dateISO => new Date(`${dateISO}T00:00:00`) >= start &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveEndDate) || dateISO <= effectiveEndDate));
}

function normalizeSkippedPeriods(rule) {
  if (!rule) return [];
  const normalized = [...new Set((Array.isArray(rule.skippedPeriods) ? rule.skippedPeriods : [])
    .map(String).filter(Boolean))];
  rule.skippedPeriods = normalized;
  return normalized;
}

function isRecurringPeriodSkipped(rule, key) {
  return normalizeSkippedPeriods(rule).includes(String(key || ''));
}

function addRecurringSkippedPeriod(rule, key) {
  if (!rule || !key) return false;
  const skipped = normalizeSkippedPeriods(rule);
  if (skipped.includes(String(key))) return false;
  rule.skippedPeriods = [...skipped, String(key)];
  return true;
}

function removeRecurringSkippedPeriod(rule, key) {
  if (!rule || !key) return false;
  const before = normalizeSkippedPeriods(rule);
  const after = before.filter(item => item !== String(key));
  rule.skippedPeriods = after;
  return after.length !== before.length;
}

function occurrenceExists(parentId, key, accountId = '') {
  return transactions.some(t => {
    if (String(t.parentId || '') !== String(parentId || '')) return false;
    if (accountId && t._accountId && String(t._accountId) !== String(accountId)) return false;
    // Les sauvegardes anciennes n'ont pas toujours de periodKey.
    // Retrouver la période depuis la règle évite une deuxième écriture.
    const rule = recurringTransactions.find(r => String(r.id) === String(parentId));
    const txKey = t.periodKey || (t.date ? periodKey(t.date, rule?.frequency) : '');
    return String(txKey) === String(key || '');
  });
}

function isUserProtectedOccurrence(t) {
  return !!(t && (
    t.reconciled ||
    t._manuallyEdited ||
    (t.source && t.source !== 'recurring')
  ));
}


// Journal métier persisté avec la règle (donc lié au compte courant).
// Contrairement au journal global (résumés), il conserve les snapshots nécessaires à l'annulation.
function recurringSnapshot(value) {
  if (!value) return null;
  const copy = JSON.parse(JSON.stringify(value));
  delete copy.recurrenceHistory;
  return copy;
}
function recordRecurringRevision(rule, kind, period, before, after, extra = {}) {
  if (!rule) return null;
  if (!Array.isArray(rule.recurrenceHistory)) rule.recurrenceHistory = [];
  const revision = {
    id: genId(), at: new Date().toISOString(), kind, period: period || '',
    before: recurringSnapshot(before), after: recurringSnapshot(after), ...extra
  };
  rule.recurrenceHistory.unshift(revision);
  rule.recurrenceHistory = rule.recurrenceHistory.slice(0, 35);
  // Le document Firestore a une limite de taille : conserver les versions
  // récentes sans accumuler indéfiniment d'anciennes copies de transactions.
  while (rule.recurrenceHistory.length > 1 &&
    JSON.stringify(rule.recurrenceHistory).length > 125000) rule.recurrenceHistory.pop();
  return revision;
}
// Comparaison ciblée : ne pas annuler par-dessus une modification plus récente.
function recurringSnapshotMatches(current, snapshot) {
  if (!current || !snapshot) return current === snapshot;
  const fields = ['id','parentId','periodKey','date','amountBase','type','fromSavings','category',
    'currency','originalAmount','desc','mode','transferTarget','linkedDebtId','reconcileColor'];
  return fields.every(field => JSON.stringify(current[field] ?? null) === JSON.stringify(snapshot[field] ?? null));
}
function restoreRecurringRevision(ruleId, revisionId) {
  const rule = recurringTransactions.find(r => String(r.id) === String(ruleId));
  const entry = rule?.recurrenceHistory?.find(item => String(item.id) === String(revisionId));
  if (!entry || entry.restoredAt) return false;
  const isSingle = entry.kind === 'single';
  const isRule = entry.kind === 'future';
  const isHistorical = entry.kind === 'historical';
  if (!isSingle && !isRule && !isHistorical) return false;
  const targets = isSingle ? [{ before: entry.before, after: entry.after }] :
    isHistorical ? (entry.changes || []) : [];
  if (targets.some(change => {
    const current = transactions.filter(tx => String(tx.parentId || '') === String(ruleId) &&
      String(tx.periodKey || (tx.date ? periodKey(tx.date, rule.frequency) : '')) === String(change.after?.periodKey));
    return current.length !== 1 || !recurringSnapshotMatches(current[0], change.after);
  })) { showToast('Impossible de restaurer : cette date a changé depuis. Aucune donnée n’a été modifiée.', 'error'); return false; }
  if ((isRule || isHistorical) && !recurringSnapshotMatchesRule(rule, entry.afterRule || entry.after)) {
    showToast('La règle a été modifiée depuis : restauration bloquée.', 'error'); return false;
  }
  const affectsPast = targets.some(change => change.after &&
    isArchivedRecurringMonth(rule, change.after.periodKey, change.after.date));
  if (affectsPast && !confirmArchivedRecurringChange(targets[0]?.after?.date || '', 'restaurer')) return false;
  if (!affectsPast && !confirm('Restaurer cette version ? Les changements effectués depuis sur cette date seront conservés.')) return false;
  targets.forEach(change => {
    const current = transactions.find(tx => String(tx.parentId || '') === String(ruleId) &&
      String(tx.periodKey || (tx.date ? periodKey(tx.date, rule.frequency) : '')) === String(change.after.periodKey));
    if (!current) return;
    revertOccurrenceSideEffects(current);
    if (change.before) {
      Object.keys(current).forEach(key => delete current[key]);
      Object.assign(current, recurringSnapshot(change.before), { _effectsApplied: false });
      applyOccurrenceSideEffects(current);
    } else {
      transactions = transactions.filter(tx => tx !== current);
    }
  });
  if ((isRule || isHistorical) && entry.beforeRule || isRule && entry.before) {
    const previous = entry.beforeRule || entry.before;
    const log = rule.recurrenceHistory;
    const replacement = recurringSnapshot(previous);
    Object.keys(rule).forEach(key => { if (key !== 'recurrenceHistory') delete rule[key]; });
    Object.assign(rule, replacement, { recurrenceHistory: log });
    rebuildOccurrencesForRuleFutureOnly(rule.id);
  }
  entry.restoredAt = new Date().toISOString();
  logAction('restore_recurring_revision', 'recurring', entry.after, entry.before);
  saveData(); syncAllUI();
  showToast('Version précédente restaurée', 'success');
  return true;
}
function recurringSnapshotMatchesRule(rule, snapshot) {
  if (!rule || !snapshot) return false;
  return ['id','amountBase','startDate','dayOfMonth','frequency','type','category','desc', 'currency',
    'rateVersions','subscription','incomeClass']
    .every(k => JSON.stringify(rule[k] ?? null) === JSON.stringify(snapshot[k] ?? null));
}

function recurringRuleSignature(rule) {
  if (!rule) return '';
  return [String(rule.id || ''), normalizeRecurringFrequency(rule.frequency)].join('|');
}

// Seuls les doublons d'identifiant sont fusionnés. Deux abonnements identiques
// avec des identifiants différents sont légitimes et doivent rester distincts.
function dedupeRecurringRules() {
  if (!Array.isArray(recurringTransactions)) recurringTransactions = [];
  const seen = new Map();
  recurringTransactions.forEach(rule => {
    if (!rule) return;
    if (!rule.id) rule.id = genId();
    rule.frequency = normalizeRecurringFrequency(rule.frequency);
    normalizeSkippedPeriods(rule);
    const key = String(rule.id);
    if (!seen.has(key)) seen.set(key, rule);
    else Object.assign(seen.get(key), rule);
  });
  recurringTransactions = [...seen.values()];
}

function recurringOccurrenceKey(t) {
  if (!t?.parentId) return '';
  const rule = recurringTransactions.find(r => String(r.id) === String(t.parentId));
  const frequency = normalizeRecurringFrequency(rule?.frequency);
  if (!t.periodKey && t.date) t.periodKey = periodKey(t.date, frequency);
  const accountKey = t._accountId || currentAccountId || 'current';
  return `${String(accountKey)}|${String(t.parentId)}|${t.periodKey || t.date || ''}`;
}

function occurrenceProtectionScore(t) {
  if (!t) return 0;
  return (t.reconciled ? 8 : 0) + ((t._manuallyEdited && t.reconcileColor) ? 4 : 0) +
    (t._manuallyEdited ? 2 : 0) + ((t.source && t.source !== 'recurring') ? 1 : 0);
}

function dedupeRecurringOccurrences(onlyRuleId = null) {
  if (!Array.isArray(transactions)) transactions = [];
  const seen = new Map();
  const keep = [];
  transactions.forEach(t => {
    if (!t?.parentId || (onlyRuleId !== null && String(t.parentId) !== String(onlyRuleId))) {
      keep.push(t);
      return;
    }
    const key = recurringOccurrenceKey(t);
    if (!key || !seen.has(key)) {
      seen.set(key, keep.length);
      keep.push(t);
      return;
    }
    const index = seen.get(key);
    const current = keep[index];
    // Un historique clos ne doit jamais perdre une écriture au seul motif
    // qu'un autre ID porte la même période. Rapprochement manuel nécessaire.
    if ((t.date || '').slice(0, 7) < isoMonth(getToday()) ||
        (current.date || '').slice(0, 7) < isoMonth(getToday())) {
      keep.push(t);
      return;
    }
    // Deux écritures distinctes déjà imputées à l'épargne ou à une dette
    // requièrent un rapprochement manuel : supprimer l'une en silence rend
    // l'historique incohérent avec le solde réellement modifié.
    if (String(current.id) !== String(t.id) &&
        (occurrenceHasSideEffects(current) || occurrenceHasSideEffects(t)) &&
        (current._effectsApplied === true || t._effectsApplied === true)) {
      keep.push(t);
      return;
    }
    if (occurrenceProtectionScore(t) > occurrenceProtectionScore(current)) keep[index] = t;
  });
  transactions = keep;
}

function getRecurringRateForDate(rule, dateISO) {
  const baseline = {
    amountBase: Number(rule?.amountBase ?? rule?.amount) || 0,
    originalAmount: Number(rule?.originalAmount ?? rule?.amountBase ?? rule?.amount) || 0,
    currency: String(rule?.currency || settings.baseCurrency || 'EUR').toUpperCase(),
    fxRate: rule?.fxRate || null
  };
  const versions = (Array.isArray(rule?.rateVersions) ? rule.rateVersions : [])
    .filter(version => /^\d{4}-\d{2}-\d{2}$/.test(String(version?.effectiveFrom || '')) &&
      version.effectiveFrom <= String(dateISO || '') && Number.isFinite(Number(version?.amountBase)) && Number(version.amountBase) > 0)
    .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));
  return versions.length ? { ...baseline, ...versions.at(-1) } : baseline;
}

function buildRecurringOccurrence(rule, dateISO, extra = {}) {
  const rate = getRecurringRateForDate(rule, dateISO);
  const amountBase = roundMoney(Number(rate.amountBase) || 0);
  const fromSavings = !!rule.fromSavings;
  return {
    id: genId(),
    parentId: rule.id,
    periodKey: periodKey(dateISO, rule.frequency),
    type: fromSavings ? 'income' : (rule.type || 'expense'),
    fromSavings: fromSavings || undefined,
    category: rule.category || 'Autre',
    amount: amountBase,
    amountBase,
    originalAmount: Number(rate.originalAmount ?? amountBase) || amountBase,
    currency: rate.currency || rule.currency || settings.baseCurrency || 'EUR',
    fxRate: rate.fxRate || null,
    date: dateISO,
    desc: rule.desc || '',
    tags: Array.isArray(rule.tags) ? [...rule.tags] : [],
    mode: rule.mode || settings.defaultMode || 'personal',
    incomeClass: rule.incomeClass || '',
    transferTarget: rule.transferTarget || '',
    source: 'recurring',
    isRecurring: false,
    linkedDebtId: rule.linkedDebtId || null,
    linkedDebtAccountId: rule.linkedDebtAccountId || '',
    reconcileColor: rule.reconcileColor || '',
    _effectsApplied: false,
    ...extra
  };
}

function occurrenceHasSideEffects(tx) {
  return !!(tx && (tx.type === 'transfer' || tx.fromSavings || tx.linkedDebtId));
}

function applyOccurrenceSideEffects(tx) {
  if (!occurrenceHasSideEffects(tx)) return false;
  if (!tx.date || tx.date > isoDate(getToday())) {
    if (tx._effectsApplied === undefined) tx._effectsApplied = false;
    return false;
  }
  if (tx._effectsApplied === true) return false;
  const amount = Number(tx.amountBase ?? tx.amount) || 0;
  const debtAmount = Number(tx.linkedDebtAmount ?? amount) || 0;
  if (tx.type === 'transfer') applyTransferToSavings(tx.transferTarget || defaultSavingsTarget(), amount);
  if (tx.fromSavings) applyTransferToSavings(tx.transferTarget || defaultSavingsTarget(), -amount);
  if (tx.linkedDebtId && debtAmount > 0) decreaseDebt(tx.linkedDebtId, debtAmount, tx.linkedDebtAccountId || '', false);
  tx._effectsApplied = true;
  return true;
}

function revertOccurrenceSideEffects(tx) {
  if (!occurrenceHasSideEffects(tx)) return false;
  if (!tx.date || tx.date > isoDate(getToday()) || tx._effectsApplied === false) return false;
  const amount = Number(tx.amountBase ?? tx.amount) || 0;
  const debtAmount = Number(tx.linkedDebtAmount ?? amount) || 0;
  if (tx.type === 'transfer') applyTransferToSavings(tx.transferTarget || defaultSavingsTarget(), -amount);
  if (tx.fromSavings) applyTransferToSavings(tx.transferTarget || defaultSavingsTarget(), amount);
  if (tx.linkedDebtId && debtAmount > 0) increaseDebt(tx.linkedDebtId, debtAmount, tx.linkedDebtAccountId || '', false);
  tx._effectsApplied = false;
  return true;
}

// Une modification remplace l'effet financier de la transaction : seul l'écart
// entre l'ancienne et la nouvelle écriture touche l'épargne.
function replaceOccurrenceSideEffects(before, after) {
  const todayISO = isoDate(getToday());
  const oldDue = !!before?.date && before.date <= todayISO;
  const newDue = !!after?.date && after.date <= todayISO;
  // Anciennes versions : l'épargne était créditée, mais le drapeau restait faux.
  // On conserve le solde existant au lieu de rejouer silencieusement l'écriture.
  const oldApplied = oldDue && (before._effectsApplied !== false ||
    (!before._effectsLedgerVersion && !before.parentId && (before.type === 'transfer' || before.fromSavings)));
  const deltas = new Map();
  const addSavingsDelta = (tx, sign) => {
    if (!tx || (tx.type !== 'transfer' && !tx.fromSavings)) return;
    const target = tx.transferTarget || defaultSavingsTarget();
    const amount = Number(tx.amountBase ?? tx.amount) || 0;
    const effect = tx.type === 'transfer' ? amount : -amount;
    deltas.set(target, roundMoney((deltas.get(target) || 0) + sign * effect));
  };
  if (oldApplied) addSavingsDelta(before, -1);
  if (newDue) addSavingsDelta(after, 1);
  let savingsDelta = 0;
  deltas.forEach((delta, target) => {
    if (delta) applyTransferToSavings(target, delta);
    savingsDelta = roundMoney(savingsDelta + delta);
  });

  if (oldApplied && before.linkedDebtId) {
    increaseDebt(before.linkedDebtId, Number(before.linkedDebtAmount ?? before.amountBase ?? before.amount) || 0,
      before.linkedDebtAccountId || '', false);
  }
  if (newDue && after.linkedDebtId) {
    decreaseDebt(after.linkedDebtId, Number(after.linkedDebtAmount ?? after.amountBase ?? after.amount) || 0,
      after.linkedDebtAccountId || '', false);
  }
  after._effectsApplied = newDue && occurrenceHasSideEffects(after);
  after._effectsLedgerVersion = 1;
  return { applied: after._effectsApplied, savingsDelta };
}

function activateDueTransactionEffects() {
  transactions.forEach(tx => {
    if (tx?._effectsApplied === false && tx.date && tx.date <= isoDate(getToday()) &&
        tx.date.slice(0, 7) >= isoMonth(getToday())) {
      if (!tx.parentId && !tx._effectsLedgerVersion && (tx.type === 'transfer' || tx.fromSavings)) {
        // L'état hérité est ambigu : ne jamais ajouter une deuxième fois un
        // transfert déjà compris dans le solde sauvegardé.
        tx._effectsApplied = true;
        tx._effectsLedgerVersion = 1;
        tx._legacySavingsEffectAssumed = true;
        return;
      }
      applyOccurrenceSideEffects(tx);
    }
  });
}

function getNextRecurringDate(rule, fromDate = null, monthsAhead = 36, storedByPeriod = null) {
  if (!rule) return '';
  const startISO = fromDate || isoDate(getToday());
  const cursor = new Date(`${startISO.slice(0, 7)}-01T00:00:00`);
  for (let offset = 0; offset <= monthsAhead; offset++) {
    const monthDate = new Date(cursor);
    monthDate.setMonth(monthDate.getMonth() + offset);
    const month = isoMonth(monthDate);
    const dates = recurringDatesForMonth(rule, month);
    for (const dateISO of dates) {
      const key = periodKey(dateISO, rule.frequency);
      if (isRecurringPeriodSkipped(rule, key)) continue;
      const stored = storedByPeriod
        ? storedByPeriod.get(key)
        : transactions.find(tx => String(tx.parentId || '') === String(rule.id) &&
          String(tx.periodKey || (tx.date ? periodKey(tx.date, rule.frequency) : '')) === key);
      const effectiveDate = stored?.date || dateISO;
      if (effectiveDate >= startISO) return effectiveDate;
    }
  }
  return '';
}

// ── Garde contre les appels réentrants simultanés ──────────────
let _generatingOccurrences = false;

function generateRecurringOccurrences(baseMonth = null, monthsBack = 18, monthsForward = 0, onlyRuleId = null, options = {}) {
  if (_generatingOccurrences) return 0;
  _generatingOccurrences = true;
  let created = 0;
  try {
    const todayStr = isoDate(getToday());
    const referenceMonth = baseMonth || isoMonth(getToday());
    const base = new Date(`${referenceMonth}-01T00:00:00`);
    if (onlyRuleId === null) dedupeRecurringRules();
    dedupeRecurringOccurrences(onlyRuleId);

    // Les anciennes versions créaient des opérations futures réelles. Elles
    // redeviennent des prévisions, sauf si l'utilisateur les avait déjà modifiées.
    transactions = transactions.filter(tx => {
      const isFutureAuto = tx?.parentId &&
        (onlyRuleId === null || String(tx.parentId) === String(onlyRuleId)) &&
        tx.date > todayStr && !isUserProtectedOccurrence(tx);
      return !isFutureAuto;
    });

    activateDueTransactionEffects();

    const months = [];
    for (let offset = -Math.max(0, monthsBack); offset <= Math.max(0, monthsForward); offset++) {
      const date = new Date(base);
      date.setMonth(date.getMonth() + offset);
      months.push(isoMonth(date));
    }

    [...new Set(months)].forEach(month => {
      recurringTransactions.forEach(rule => {
        if (onlyRuleId !== null && String(rule.id) !== String(onlyRuleId)) return;
        recurringDatesForMonth(rule, month).forEach(dateISO => {
          if (dateISO > todayStr) return;
          const key = periodKey(dateISO, rule.frequency);
          // Par défaut, aucun redémarrage/rendu ne peut régénérer un mois
          // clos. Seule une restauration explicite et doublement confirmée
          // peut fournir la clé exacte d'une ancienne période.
          if (dateISO.slice(0, 7) < todayStr.slice(0, 7) &&
              !(options.allowedArchivedKeys instanceof Set && options.allowedArchivedKeys.has(key))) return;
          // Après mise à jour de la règle, les échéances passées absentes ne
          // peuvent plus être recréées rétroactivement au nouveau montant.
          // Les opérations déjà stockées restent intactes.
          if (rule.historicalBackfillThrough && dateISO <= rule.historicalBackfillThrough) return;
          if (isRecurringPeriodSkipped(rule, key) || occurrenceExists(rule.id, key)) return;
          const occurrence = buildRecurringOccurrence(rule, dateISO);
          transactions.push(occurrence);
          applyOccurrenceSideEffects(occurrence);
          created += 1;
        });
      });
    });

    dedupeRecurringOccurrences(onlyRuleId);
    return created;
  } finally {
    _generatingOccurrences = false;
  }
}

function getUpcomingRecurringOccurrences(daysAhead = 5) {
  const start = isoDate(getToday());
  const limitDate = new Date(getToday());
  limitDate.setDate(limitDate.getDate() + Math.max(0, Number(daysAhead) || 0));
  const end = isoDate(limitDate);
  const months = monthsBetweenISO(start, end);
  const results = [];
  months.forEach(month => {
    getProjectedRecurringTransactions(month).forEach(tx => {
      if (tx.date > start && tx.date <= end) results.push({ ...tx, nextDate: tx.date });
    });
  });
  // Les échéances futures personnalisées sont de vraies transactions stockées :
  // elles ne figurent plus dans les projections. Elles doivent néanmoins figurer
  // dans la liste des prochaines échéances et dans ses totaux.
  const stored = multiViewMode === 'individual' ? transactions : getDisplayTransactions();
  stored.forEach(tx => {
    if (tx?.parentId && !tx.isRecurring && tx.date > start && tx.date <= end &&
        !results.some(p => String(p.parentId) === String(tx.parentId) && p.periodKey === tx.periodKey &&
          String(p._accountId || '') === String(tx._accountId || ''))) {
      results.push({ ...tx, nextDate: tx.date });
    }
  });
  return results.sort((a, b) => a.date.localeCompare(b.date));
}

function openRecurringCreationModal() {
  openModal();
  document.getElementById('modalTitle').textContent = 'Ajouter une opération régulière';
  const checkbox = document.getElementById('isRecurring');
  if (checkbox) checkbox.checked = true;
  toggleRecurOptions();
}

// Depuis la liste de règles, un clic « ce mois » doit cibler une échéance,
// jamais la valeur par défaut de la série. Les fréquences hebdomadaires
// exigent de choisir une semaine dans la liste des transactions.
function openRecurringCurrentMonthModal(ruleId) {
  const rule = recurringTransactions.find(r => String(r.id) === String(ruleId));
  if (!rule) return false;
  const dates = recurringDatesForMonth(rule, isoMonth(getToday()));
  if (dates.length !== 1) {
    showToast('Sélectionnez la date exacte dans Toutes les opérations pour ce rythme.', 'info');
    return false;
  }
  const dateISO = dates[0];
  const key = periodKey(dateISO, rule.frequency);
  if (isRecurringPeriodSkipped(rule, key)) {
    showToast('Cette date est en pause. Rétablissez-la avant de la modifier.', 'info');
    return false;
  }
  const matches = transactions.filter(tx => String(tx.parentId || '') === String(rule.id) &&
    (tx.periodKey || (tx.date ? periodKey(tx.date, rule.frequency) : '')) === key);
  if (matches.length > 1) {
    showToast('Plusieurs écritures existent pour ce mois : vérifiez les doublons avant modification', 'error');
    return false;
  }
  const selected = matches[0] || buildRecurringOccurrence(rule, dateISO, {
    id: `__projected_current_${rule.id}_${key}`, projected: true
  });
  openRecurringRuleModal(rule, selected);
  return true;
}

function renderRecurringList() {
  const container = document.getElementById('recurringList');
  const summary = document.getElementById('recurringSummary');
  if (!container) return;
  window.checkSubscriptionReminders?.();

  const tomorrow = new Date(getToday());
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowISO = isoDate(tomorrow);
  const upcoming = getUpcomingRecurringOccurrences(30);
  let upcomingIncome = 0, upcomingOutflow = 0;
  for (const item of upcoming) {
    const amount = Number(item.amountBase ?? item.amount) || 0;
    if (item.type === 'income') upcomingIncome += amount;
    else upcomingOutflow += amount;
  }
  const skippedCount = recurringTransactions.reduce((sum, rule) => sum + normalizeSkippedPeriods(rule).length, 0);
  // Une seule indexation de l'historique pour toutes les lignes : sans elle,
  // chaque règle rescannait les transactions pour chacune de ses dates futures.
  const rulesById = new Map(recurringTransactions.map(rule => [String(rule.id), rule]));
  const storedByRule = new Map();
  for (const tx of transactions) {
    const id = String(tx?.parentId || '');
    const rule = rulesById.get(id);
    if (!rule) continue;
    const key = String(tx.periodKey || (tx.date ? periodKey(tx.date, rule.frequency) : ''));
    if (!key) continue;
    let periods = storedByRule.get(id);
    if (!periods) { periods = new Map(); storedByRule.set(id, periods); }
    if (!periods.has(key)) periods.set(key, tx);
  }

  if (summary) {
    summary.innerHTML = `
      <div class="recurring-stat"><span>Dans les 30 prochains jours</span><strong>${upcoming.length} échéance${upcoming.length > 1 ? 's' : ''}</strong><small>${recurringTransactions.length} opération${recurringTransactions.length > 1 ? 's' : ''} suivie${recurringTransactions.length > 1 ? 's' : ''}${skippedCount ? ` · ${skippedCount} en pause` : ''}</small></div>
      <div class="recurring-stat recurring-stat-income"><span>Revenus à venir</span><strong>+${formatCurrency(upcomingIncome)}</strong></div>
      <div class="recurring-stat recurring-stat-outflow"><span>Sorties à venir</span><strong>-${formatCurrency(upcomingOutflow)}</strong></div>
    `;
  }

  if (!recurringTransactions.length) {
    const calendar = document.getElementById('recurringCalendarPanel');
    if (calendar) { calendar.hidden = true; calendar.replaceChildren(); }
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-repeat"></i><p>Aucun paiement ou revenu régulier pour le moment</p><button class="btn btn-primary btn-sm" onclick="openRecurringCreationModal()"><i class="fa-solid fa-plus"></i> Ajouter une opération régulière</button></div>`;
    return;
  }

  container.innerHTML = `
    <div class="table-container">
      <table class="table recurring-table">
        <thead><tr><th>Opération</th><th>Prochaine échéance</th><th>Montant</th><th>Actions</th></tr></thead>
        <tbody>
          ${recurringTransactions.map(rule => {
            const typeLabel = rule.type === 'income' ? (rule.fromSavings ? 'Retrait épargne' : 'Revenu') : (rule.type === 'transfer' ? 'Transfert' : 'Dépense');
            const badge = rule.type === 'income' ? 'badge-income' : (rule.type === 'transfer' ? 'badge-transfer' : 'badge-expense');
            const frequency = normalizeRecurringFrequency(rule.frequency);
            const freqLabel = frequency === 'monthly' ? 'Chaque mois' : (frequency === 'weekly' ? 'Chaque semaine' : 'Chaque année');
            const storedPeriods = storedByRule.get(String(rule.id)) || new Map();
            const nextDate = getNextRecurringDate(rule, tomorrowISO, 36, storedPeriods);
            const nextRate = getRecurringRateForDate(rule, nextDate || isoDate(getToday()));
            const nextKey = nextDate ? periodKey(nextDate, rule.frequency) : '';
            const nextStored = nextKey ? storedPeriods.get(nextKey) : null;
            const nextAmount = Number(nextStored?.amountBase ?? nextStored?.amount ?? nextRate.amountBase) || 0;
            const currentOccurrences = recurringDatesForMonth(rule, isoMonth(getToday()));
            const hasSingleThisMonth = currentOccurrences.length === 1;
            const skipped = normalizeSkippedPeriods(rule).length;
            return `
              <tr>
                <td><div class="recurring-name"><span class="badge ${badge}">${escapeHTML(typeLabel)}</span><strong>${escapeHTML(rule.desc || rule.category || 'Sans description')}</strong><small>${escapeHTML(rule.category || 'Autre')}${skipped ? ` · ${skipped} date${skipped > 1 ? 's' : ''} en pause` : ''}${rule.subscription?.cancellationRequested ? ' · Résiliation demandée' : ''}</small></div></td>
                <td class="recurring-next-date">${nextDate ? `<strong>${escapeHTML(new Date(`${nextDate}T12:00:00`).toLocaleDateString('fr-FR'))}</strong>` : '<span class="text-slate-400">Aucune date</span>'}<small>${escapeHTML(freqLabel)}</small></td>
                <td class="recurring-next-amount"><strong>${formatCurrency(nextAmount, settings.baseCurrency || 'EUR')}</strong>${nextStored?._manuallyEdited ? '<small class="recurring-amount-note">Personnalisée</small>' : ''}</td>
                <td class="recurring-actions">
                  <button type="button" class="recurring-main-action js-aj-tariff" data-id="${escapeHTML(String(rule.id))}" aria-label="Changer le montant de ${escapeHTML(rule.desc || rule.category || 'cette opération')}">Changer le montant</button>
                  <details class="recurring-more"><summary aria-label="Autres actions pour ${escapeHTML(rule.desc || rule.category || 'cette opération')}">Plus <i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary>
                    <div class="recurring-more-actions">
                      ${hasSingleThisMonth ? `<button type="button" class="js-edit-current" data-id="${escapeHTML(String(rule.id))}"><i class="fa-solid fa-calendar-day" aria-hidden="true"></i> Cette échéance</button>` : ''}
                      <button type="button" class="js-calendar-rule" data-id="${escapeHTML(String(rule.id))}"><i class="fa-solid fa-calendar-days" aria-hidden="true"></i> Calendrier</button>
                      <button type="button" class="js-edit-rule" data-id="${escapeHTML(String(rule.id))}"><i class="fa-solid fa-gear" aria-hidden="true"></i> Modifier la série</button>
                      <button type="button" class="js-aj-subscription" data-id="${escapeHTML(String(rule.id))}"><i class="fa-regular fa-bell" aria-hidden="true"></i> Essai et renouvellement</button>
                      ${skipped ? `<button type="button" class="js-restore-skipped" data-id="${escapeHTML(String(rule.id))}"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> Rétablir les dates</button>` : ''}
                      <button type="button" class="js-del recurring-danger-action" data-id="${escapeHTML(String(rule.id))}"><i class="fa-solid fa-trash" aria-hidden="true"></i> Supprimer la série</button>
                    </div>
                  </details>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  const calendarPanel = document.getElementById('recurringCalendarPanel');
  if (calendarPanel && !calendarPanel.hidden && typeof renderRecurringCalendar === 'function') renderRecurringCalendar();
  container.querySelectorAll('.js-edit-current').forEach(button => button.addEventListener('click', () => openRecurringCurrentMonthModal(button.dataset.id)));
  container.querySelectorAll('.js-calendar-rule').forEach(button => button.addEventListener('click', () => {
    if (typeof showRecurringCalendarRule === 'function') showRecurringCalendarRule(button.dataset.id);
  }));
  container.querySelectorAll('.js-edit-rule').forEach(button => button.addEventListener('click', () => {
    const rule = recurringTransactions.find(item => String(item.id) === String(button.dataset.id));
    if (rule) openRecurringRuleModal(rule);
  }));
  container.querySelectorAll('.js-aj-tariff').forEach(button => button.addEventListener('click', () => window.openRecurringTariff?.(button.dataset.id)));
  container.querySelectorAll('.js-aj-subscription').forEach(button => button.addEventListener('click', () => window.openSubscriptionDetails?.(button.dataset.id)));
  container.querySelectorAll('.js-restore-skipped').forEach(button => button.addEventListener('click', () => restoreSkippedRecurringPeriods(button.dataset.id)));
  container.querySelectorAll('.js-del').forEach(button => button.addEventListener('click', () => deleteRecurring(button.dataset.id)));
}

function skipRecurringOccurrenceById(id) {
  const index = transactions.findIndex(t => String(t.id) === String(id));
  const occurrence = index >= 0 ? transactions[index] : null;
  if (!occurrence?.parentId) return false;
  const rule = recurringTransactions.find(r => String(r.id) === String(occurrence.parentId));
  if (!rule) return false;
  const key = occurrence.periodKey || periodKey(occurrence.date, rule.frequency);
  if (isArchivedRecurringMonth(rule, key, occurrence.date) &&
      !confirmArchivedRecurringChange(occurrence.date, 'ignorer')) return false;
  const backup = JSON.parse(JSON.stringify(occurrence));
  addRecurringSkippedPeriod(rule, key);
  // Conserver l'écriture exacte : une restauration ultérieure ne doit pas
  // utiliser par erreur un nouveau tarif de la règle générale.
  if (!rule.skippedOccurrenceBackups || typeof rule.skippedOccurrenceBackups !== 'object' ||
      Array.isArray(rule.skippedOccurrenceBackups)) rule.skippedOccurrenceBackups = {};
  rule.skippedOccurrenceBackups[key] = backup;
  revertOccurrenceSideEffects(occurrence);
  transactions.splice(index, 1);
  logAction('skip_occurrence', 'recurring', backup, { ruleId: rule.id, periodKey: key });
  saveData();
  syncAllUI();
  const undoContext = captureFinancialUndoContext();
  showToast('Cette date a été mise en pause', 'neutral', true, () => {
    if (!isFinancialUndoContextCurrent(undoContext) ||
        !recurringTransactions.includes(rule) ||
        transactions.some(t => String(t.id) === String(backup.id))) return;
    removeRecurringSkippedPeriod(rule, key);
    if (rule.skippedOccurrenceBackups) delete rule.skippedOccurrenceBackups[key];
    transactions.splice(Math.min(index, transactions.length), 0, backup);
    applyOccurrenceSideEffects(backup);
    logAction('undo_skip_occurrence', 'recurring', null, backup);
    saveData();
    syncAllUI();
    showToast('Date rétablie', 'success');
  });
  return true;
}

function skipProjectedRecurringOccurrence(projected) {
  const rule = getProjectedRule(projected);
  if (!rule) return false;
  const key = projected.periodKey || periodKey(projected.date, rule.frequency);
  if (!addRecurringSkippedPeriod(rule, key)) return false;
  logAction('skip_projected_occurrence', 'recurring', projected, { ruleId: rule.id, periodKey: key });
  saveData();
  syncAllUI();
  const undoContext = captureFinancialUndoContext();
  showToast(`Date du ${new Date(`${projected.date}T12:00:00`).toLocaleDateString('fr-FR')} mise en pause`, 'neutral', true, () => {
    if (!isFinancialUndoContextCurrent(undoContext) ||
        !recurringTransactions.includes(rule)) return;
    removeRecurringSkippedPeriod(rule, key);
    logAction('undo_skip_projected_occurrence', 'recurring', null, projected);
    saveData();
    syncAllUI();
    showToast('Date rétablie', 'success');
  });
  return true;
}

function isArchivedSkippedRecurringPeriod(rule, key) {
  const currentMonth = isoMonth(getToday());
  if (/^\d{4}-\d{2}$/.test(key)) return key < currentMonth;
  if (/^\d{4}$/.test(key)) {
    const annualMonth = /^\d{4}-\d{2}-\d{2}$/.test(rule?.startDate || '')
      ? rule.startDate.slice(5, 7) : '01';
    return `${key}-${annualMonth}` < currentMonth;
  }
  // Une semaine ISO peut chevaucher deux mois : sa date de début détermine
  // le verrou (approche conservative pour préserver les écritures anciennes).
  if (/^\d{4}-W\d{2}$/.test(key)) {
    const [year, week] = key.split('-W').map(Number);
    const monday = new Date(Date.UTC(year, 0, 4));
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() || 7) + 1 + (week - 1) * 7);
    return monday.toISOString().slice(0, 7) < currentMonth;
  }
  return true; // Clé ancienne/inconnue : exiger les deux validations.
}

function restoreSkippedRecurringPeriods(id) {
  const rule = recurringTransactions.find(r => String(r.id) === String(id));
  if (!rule) return;
  const skipped = [...normalizeSkippedPeriods(rule)];
  if (!skipped.length) return;
  // Une période historique restaurée peut relancer un ancien effet financier.
  const archived = skipped.some(key => isArchivedSkippedRecurringPeriod(rule, key));
  if (archived) {
    if (!confirmArchivedRecurringChange('', 'rétablir une ou plusieurs anciennes')) return;
  } else if (!confirm(`Rétablir les ${skipped.length} dates mises en pause ?`)) return;

  // Une règle modifiée n'a plus forcément le tarif d'origine d'une échéance
  // effacée : ne pas reconstruire cet historique avec un montant inventé.
  const backups = rule.skippedOccurrenceBackups || {};
  const unsafeArchived = skipped.filter(key => isArchivedSkippedRecurringPeriod(rule, key) &&
    !backups[key] && rule.historicalBackfillThrough &&
    key <= periodKey(rule.historicalBackfillThrough, rule.frequency));
  if (unsafeArchived.length) {
    showToast('Restauration impossible : FREEV ne retrouve pas le montant d’origine de certaines dates. Rien n’a été modifié.', 'error');
    return;
  }
  rule.skippedPeriods = [];
  skipped.forEach(key => {
    const saved = backups[key];
    if (!saved || transactions.some(t => String(t.parentId || '') === String(rule.id) &&
        String(t.periodKey || (t.date ? periodKey(t.date, rule.frequency) : '')) === key)) return;
    const restored = JSON.parse(JSON.stringify(saved));
    restored._effectsApplied = false;
    transactions.push(restored);
    applyOccurrenceSideEffects(restored);
  });
  generateRecurringOccurrences(isoMonth(getToday()), 18, 0, rule.id,
    { allowedArchivedKeys: new Set(skipped.filter(key => isArchivedSkippedRecurringPeriod(rule, key) && !backups[key])) });
  skipped.forEach(key => { if (rule.skippedOccurrenceBackups) delete rule.skippedOccurrenceBackups[key]; });
  logAction('restore_skipped_periods', 'recurring', skipped, rule);
  saveData();
  syncAllUI();
  showToast('Dates rétablies', 'success');
}

function deleteRecurring(id) {
  const rule = recurringTransactions.find(r => String(r.id) === String(id));
  if (!rule) return;
  if (!confirm(`Supprimer les opérations régulières « ${rule.desc || rule.category || 'Sans nom'} » ?\n\nLes dates déjà créées seront également supprimées.`)) return;
  if ((transactions.some(t => String(t.parentId || '') === String(id) && (t.date || '').slice(0, 7) < isoMonth(getToday())) ||
       normalizeSkippedPeriods(rule).some(key => isArchivedSkippedRecurringPeriod(rule, key))) &&
      !confirm('Deuxième confirmation — cette suppression efface aussi des paiements des mois passés. Voulez-vous continuer ?')) return;
  const backupRule = JSON.parse(JSON.stringify(rule));
  const backupOccurrences = transactions
    .filter(t => String(t.parentId || '') === String(id))
    .map(t => JSON.parse(JSON.stringify(t)));

  backupOccurrences.forEach(revertOccurrenceSideEffects);
  recurringTransactions = recurringTransactions.filter(r => String(r.id) !== String(id));
  transactions = transactions.filter(t => String(t.parentId || '') !== String(id));
  logAction('delete', 'recurring', rule, null);
  saveData();
  syncAllUI();

  const undoContext = captureFinancialUndoContext();
  showToast(`Série « ${backupRule.desc || backupRule.category} » supprimée`, 'neutral', true, () => {
    if (!isFinancialUndoContextCurrent(undoContext) ||
        recurringTransactions.some(r => String(r.id) === String(backupRule.id))) return;
    recurringTransactions.push(backupRule);
    backupOccurrences.forEach(t => {
      t._effectsApplied = false;
      transactions.push(t);
      applyOccurrenceSideEffects(t);
    });
    logAction('undo_delete', 'recurring', null, backupRule);
    saveData();
    syncAllUI();
    showToast('Suppression annulée', 'success');
  });
}
