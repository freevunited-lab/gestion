// Durable, account-scoped evidence from corrections explicitly confirmed by a user.
// This module only builds suggestions; it never changes transactions or applies rules.

const SCHEMA_VERSION = 1;
const MAX_EVIDENCE_ENTRIES = 500;
const MAX_ID_LENGTH = 200;
const MAX_CATEGORY_LENGTH = 120;
const MAX_MERCHANT_LENGTH = 120;
const MIN_SAMPLE_SIZE = 3;
const MIN_CONFIDENCE = 80;
const ALLOWED_ORIGINS = new Set([
  'transaction-editor',
  'transaction-detail-editor',
  'transaction-quick-edit',
  'transaction-bulk-confirmation'
]);
const GENERIC_MERCHANT_WORDS = new Set(['market', 'store', 'shop', 'france', 'sas', 'sarl', 'sa', 'eu']);

function cleanText(value, limit) {
  return String(value ?? '').trim().slice(0, limit);
}

function isValidAccountId(value) {
  return typeof value === 'string' && Boolean(value.trim()) && value.trim().length <= MAX_ID_LENGTH && value === value.trim();
}

function isValidTimestamp(value) {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function normalizedText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/\b(cb|carte|paiement|prelevement|prlv|virement|vir|sepa)\b/g, ' ')
    .replace(/\d{2,}/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function correctionMerchantKey(transaction) {
  const normalized = normalizedText(transaction?.merchant || transaction?.desc || transaction?.label);
  return normalized.split(' ')
    .filter(word => word.length > 1 && !GENERIC_MERCHANT_WORDS.has(word))
    .slice(0, 4)
    .join(' ')
    .slice(0, MAX_MERCHANT_LENGTH);
}

function isEligibleTransaction(transaction, accountId) {
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) return false;
  if (transaction.accountId != null && String(transaction.accountId) !== accountId) return false;
  if (transaction._accountId != null && String(transaction._accountId) !== accountId) return false;
  if (!cleanText(transaction.id, MAX_ID_LENGTH) || !['income', 'expense'].includes(transaction.type)) return false;
  if (!correctionMerchantKey(transaction)) return false;
  if (transaction.type === 'transfer' || transaction.parentId || transaction.isRecurring || transaction.projected ||
      transaction.paymentStatus === 'planned' || transaction.linkedTransferId || transaction.linkedAccountId ||
      transaction.linkedDebtId || transaction.fromSavings || transaction.toSavings || transaction.importPreview ||
      transaction.isImportPreview || transaction.previewOnly || transaction.recurringRuleId) return false;
  return true;
}

function validLearningState(state) {
  return Boolean(state && typeof state === 'object' && !Array.isArray(state) &&
    state.schemaVersion === SCHEMA_VERSION && isValidAccountId(state.accountId) && Array.isArray(state.entries));
}

function copyState(state, entries = state.entries) {
  return { schemaVersion: SCHEMA_VERSION, accountId: state.accountId, entries };
}

function makeEvidenceId() {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return `cl-${uuid}`;
  } catch (_) {}
  return `cl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function isValidEvidenceForAccount(entry, accountId) {
  return Boolean(entry && typeof entry === 'object' && !Array.isArray(entry) &&
    entry.accountId === accountId && cleanText(entry.id, MAX_ID_LENGTH) &&
    cleanText(entry.transactionId, MAX_ID_LENGTH) && cleanText(entry.merchant, MAX_MERCHANT_LENGTH) &&
    ['income', 'expense'].includes(entry.sourceType) && ['income', 'expense'].includes(entry.type) &&
    ['active', 'superseded', 'undone'].includes(entry.status) &&
    typeof entry.category === 'string' && entry.category.length <= MAX_CATEGORY_LENGTH && entry.category.trim() &&
    typeof entry.sourceCategory === 'string' && entry.sourceCategory.length <= MAX_CATEGORY_LENGTH &&
    typeof entry.origin === 'string' && ALLOWED_ORIGINS.has(entry.origin) && isValidTimestamp(entry.confirmedAt));
}

function activeEntriesFor(state, accountId) {
  if (!validLearningState(state) || state.accountId !== accountId) return [];
  return state.entries.filter(entry => isValidEvidenceForAccount(entry, accountId) && entry.status === 'active');
}

function resultRejected(state, reasonCode, reason) {
  return { accepted: false, state, evidence: null, reasonCode, reason };
}

export function createCorrectionLearningState(accountId) {
  if (!isValidAccountId(accountId)) throw new TypeError('Un identifiant de compte valide est requis.');
  return { schemaVersion: SCHEMA_VERSION, accountId, entries: [] };
}

/**
 * Adds evidence only when a human explicitly saved a real transaction correction.
 * One transaction contributes at most one active evidence event at a time.
 */
export function recordConfirmedCorrection(state, input = {}) {
  const accountId = typeof input.accountId === 'string' ? input.accountId.trim() : '';
  if (!validLearningState(state) || !isValidAccountId(input.accountId) || state.accountId !== accountId) {
    return resultRejected(state, 'account-scope-mismatch', 'Cette correction ne correspond pas au compte actif.');
  }
  if (input.confirmedByUser !== true || !ALLOWED_ORIGINS.has(input.origin)) {
    return resultRejected(state, 'not-user-confirmed', 'Seule une correction enregistrée et confirmée par vous peut alimenter une suggestion.');
  }

  const transaction = input.transaction;
  const corrected = input.corrected;
  const category = cleanText(corrected?.category, MAX_CATEGORY_LENGTH);
  const type = corrected?.type;
  if (!isEligibleTransaction(transaction, accountId)) {
    return resultRejected(state, 'ineligible-transaction', 'Les transferts, échéances, projections et aperçus d’import ne sont pas utilisés pour apprendre.');
  }
  if (!category || !['income', 'expense'].includes(type)) {
    return resultRejected(state, 'invalid-correction', 'Choisissez une catégorie et un type valides avant d’enregistrer la correction.');
  }
  const sourceCategory = cleanText(transaction.category, MAX_CATEGORY_LENGTH);
  if (sourceCategory === category && transaction.type === type) {
    return resultRejected(state, 'no-change', 'Cette correction ne change ni la catégorie ni le type de l’opération.');
  }

  const transactionId = cleanText(transaction.id, MAX_ID_LENGTH);
  const merchant = correctionMerchantKey(transaction);
  const existing = activeEntriesFor(state, accountId).find(entry => entry.transactionId === transactionId);
  if (existing && existing.sourceCategory === sourceCategory && existing.sourceType === transaction.type &&
      existing.category === category && existing.type === type) {
    return { accepted: false, state, evidence: existing, reasonCode: 'already-recorded', reason: 'Cette correction est déjà prise en compte dans les suggestions.' };
  }

  const confirmedAt = input.confirmedAt || new Date().toISOString();
  if (!isValidTimestamp(confirmedAt)) {
    return resultRejected(state, 'invalid-timestamp', 'La date de confirmation est invalide.');
  }
  const evidenceId = input.evidenceId;
  const id = evidenceId
    ? (typeof evidenceId === 'string' && evidenceId.trim().length <= MAX_ID_LENGTH ? evidenceId.trim() : '')
    : makeEvidenceId();
  if (!id || state.entries.some(entry => entry?.id === id)) {
    return resultRejected(state, 'duplicate-evidence-id', 'Cette référence de correction existe déjà.');
  }

  const entries = state.entries.map(entry => ({ ...entry }));
  const prior = existing ? entries.find(entry => entry?.id === existing.id) : null;
  if (prior) {
    prior.status = 'superseded';
    prior.supersededBy = id;
  }
  const evidence = {
    id,
    accountId,
    transactionId,
    merchant,
    sourceCategory,
    sourceType: transaction.type,
    category,
    type,
    origin: input.origin,
    confirmedAt,
    status: 'active'
  };

  // Keep the durable account payload bounded. Prefer pruning old, inactive audit
  // records; never silently discard an active correction that informs a suggestion.
  entries.push(evidence);
  while (entries.length > MAX_EVIDENCE_ENTRIES) {
    const pruneIndex = entries.findIndex(entry => entry?.status !== 'active');
    if (pruneIndex < 0) {
      return resultRejected(state, 'learning-capacity', 'La mémoire des corrections est pleine. Annulez une ancienne preuve avant d’en ajouter une autre.');
    }
    entries.splice(pruneIndex, 1);
  }
  return {
    accepted: true,
    state: copyState(state, entries),
    evidence,
    reasonCode: 'recorded',
    reason: 'Correction enregistrée. Elle servira uniquement à proposer une règle à vérifier.'
  };
}

function outcomeKey(category, type) {
  return `${category}\u0000${type}`;
}

function buildSuggestionReason({ count, sampleSize, confidence, eligibleForRule, minimumSampleSize, minimumConfidence }) {
  const correctionCount = value => `${value} correction${value > 1 ? 's' : ''} confirmée${value > 1 ? 's' : ''}`;
  if (eligibleForRule) {
    return `${correctionCount(count)} sur ${sampleSize} indiquent « ${confidence} % » de cohérence. Suggestion à vérifier avant de créer une règle ; aucune opération ne sera modifiée automatiquement.`;
  }
  if (sampleSize < minimumSampleSize) {
    const remaining = minimumSampleSize - sampleSize;
    return `${correctionCount(sampleSize)} : encore ${remaining} correction${remaining > 1 ? 's' : ''} cohérente${remaining > 1 ? 's' : ''} requise${remaining > 1 ? 's' : ''} avant une règle. Cela reste une suggestion ; aucune opération ne sera modifiée automatiquement.`;
  }
  return `Les corrections sont partagées, avec une cohérence de ${confidence} % (seuil ${minimumConfidence} %). Vérifiez le classement ; aucune opération ne sera modifiée automatiquement.`;
}

/** Returns recommendations only; creating a rule or changing transactions is a separate explicit action. */
export function buildCorrectionSuggestions(accountId, state, options = {}) {
  const cleanAccountId = typeof accountId === 'string' ? accountId.trim() : '';
  if (!isValidAccountId(accountId) || !validLearningState(state) || state.accountId !== cleanAccountId) return [];
  const requestedSample = Number(options.minSampleSize);
  const minimumSampleSize = Number.isInteger(requestedSample) ? Math.max(1, Math.min(100, requestedSample)) : MIN_SAMPLE_SIZE;
  const requestedConfidence = Number(options.minConfidence);
  const minimumConfidence = Number.isFinite(requestedConfidence) ? Math.max(50, Math.min(100, requestedConfidence)) : MIN_CONFIDENCE;
  const requestedMaximum = Number(options.maxSuggestions);
  const maxSuggestions = Number.isInteger(requestedMaximum) ? Math.max(1, Math.min(100, requestedMaximum)) : 20;

  const groups = new Map();
  activeEntriesFor(state, cleanAccountId).forEach(entry => {
    const key = `${entry.sourceType}\u0000${entry.merchant}`;
    const group = groups.get(key) || {
      merchant: entry.merchant,
      matchType: entry.sourceType,
      outcomes: new Map(),
      evidence: []
    };
    const keyForOutcome = outcomeKey(entry.category, entry.type);
    const outcome = group.outcomes.get(keyForOutcome) || { category: entry.category, type: entry.type, count: 0, evidenceIds: [] };
    outcome.count += 1;
    outcome.evidenceIds.push(entry.id);
    group.outcomes.set(keyForOutcome, outcome);
    group.evidence.push(entry);
    groups.set(key, group);
  });

  const suggestions = [...groups.values()].map(group => {
    const outcomes = [...group.outcomes.values()].sort((left, right) =>
      right.count - left.count || left.category.localeCompare(right.category, 'fr') || left.type.localeCompare(right.type));
    const best = outcomes[0];
    const sampleSize = group.evidence.length;
    const confidence = Math.round((best.count / sampleSize) * 100);
    const eligibleForRule = sampleSize >= minimumSampleSize && confidence >= minimumConfidence;
    return {
      accountId: cleanAccountId,
      contains: group.merchant,
      merchant: group.merchant,
      matchType: group.matchType,
      category: best.category,
      type: best.type,
      count: best.count,
      sampleSize,
      confidence,
      evidenceIds: [...best.evidenceIds],
      minimumSampleSize,
      minimumConfidence,
      status: eligibleForRule ? 'ready-for-review' : 'suggestion',
      eligibleForRule,
      autoApply: false,
      reason: buildSuggestionReason({
        count: best.count,
        sampleSize,
        confidence,
        eligibleForRule,
        minimumSampleSize,
        minimumConfidence
      })
    };
  });

  return suggestions
    .sort((left, right) => Number(right.eligibleForRule) - Number(left.eligibleForRule) ||
      right.sampleSize - left.sampleSize || right.confidence - left.confidence ||
      left.merchant.localeCompare(right.merchant, 'fr') || left.matchType.localeCompare(right.matchType))
    .slice(0, maxSuggestions);
}

/** Undoes one active evidence event and restores its immediately superseded predecessor, if any. */
export function undoCorrectionEvidence(state, evidenceId, options = {}) {
  const accountId = typeof options.accountId === 'string' ? options.accountId.trim() : '';
  if (!validLearningState(state) || !isValidAccountId(options.accountId) || state.accountId !== accountId) {
    return { undone: false, state, evidence: null, reasonCode: 'account-scope-mismatch', reason: 'Cette correction ne correspond pas au compte actif.' };
  }
  const id = typeof evidenceId === 'string' && evidenceId.trim().length <= MAX_ID_LENGTH ? evidenceId.trim() : '';
  const current = state.entries.find(entry => entry?.id === id && isValidEvidenceForAccount(entry, accountId));
  if (!current || current.status !== 'active') {
    return { undone: false, state, evidence: null, reasonCode: 'evidence-not-active', reason: 'Cette preuve n’est plus active ou n’existe pas.' };
  }
  const undoneAt = options.undoneAt || new Date().toISOString();
  if (!isValidTimestamp(undoneAt)) {
    return { undone: false, state, evidence: null, reasonCode: 'invalid-timestamp', reason: 'La date d’annulation est invalide.' };
  }

  const entries = state.entries.map(entry => ({ ...entry }));
  const target = entries.find(entry => entry.id === id);
  target.status = 'undone';
  target.undoneAt = undoneAt;
  const predecessor = entries.find(entry => entry.status === 'superseded' && entry.supersededBy === id &&
    entry.transactionId === target.transactionId && entry.accountId === accountId);
  if (predecessor) {
    predecessor.status = 'active';
    delete predecessor.supersededBy;
  }

  return {
    undone: true,
    state: copyState(state, entries),
    evidence: {
      ...target,
      reason: 'Correction annulée : cette opération ne contribue plus à la suggestion.'
    },
    reasonCode: 'undone',
    reason: 'Correction annulée. La suggestion a été recalculée sans cette opération.'
  };
}
