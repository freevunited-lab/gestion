import {
  buildReconciliationCandidates,
  reviewDuplicates,
  validateReconciliationAllocations
} from './financial-matching-engine.mjs';

const DEFAULT_TOLERANCES = Object.freeze({
  expense: Object.freeze({ dateDays: 5, amountMinor: 200, allowPartial: true, minLabelSimilarity: 0.25 }),
  income: Object.freeze({ dateDays: 5, amountMinor: 200, allowPartial: true, minLabelSimilarity: 0.25 })
});
const MAX_VISIBLE_CANDIDATES = 60;
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));
const appState = () => window._getAppState?.() || { accounts: [], currentAccountId: null, multiViewMode: 'individual' };
const currentAccount = state => state.accounts.find(account => String(account.id) === String(state.currentAccountId)) || state.accounts[0] || null;
const transactionsOf = account => Array.isArray(account?.transactions) ? account.transactions : [];
const allocationsOf = account => Array.isArray(account?.reconciliationAllocations) ? account.reconciliationAllocations : [];
const randomId = () => globalThis.crypto?.randomUUID?.() || `rc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const localTodayISO = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

let panel;
let dialog;
let statusRegion;
let candidateRows = [];
let pendingCommit = null;
let restoreFocusTo = null;
let bound = false;
let renderQueued = false;
let duplicateReview = null;

function tolerancesFor(account, currency) {
  const money = window.FREEVMoney;
  const stored = account?.reconciliationSettings || {};
  const result = {};
  for (const type of ['expense', 'income']) {
    const current = stored[type] || {};
    const days = Number(current.dateDays);
    const amount = current.amountMinor;
    const allowPartial = current.allowPartial;
    result[type] = {
      dateDays: Number.isInteger(days) && days >= 0 && days <= 30 ? days : DEFAULT_TOLERANCES[type].dateDays,
      amountMinor: Number.isSafeInteger(amount) && amount >= 0 ? amount : DEFAULT_TOLERANCES[type].amountMinor,
      allowPartial: typeof allowPartial === 'boolean' ? allowPartial : DEFAULT_TOLERANCES[type].allowPartial,
      minLabelSimilarity: DEFAULT_TOLERANCES[type].minLabelSimilarity
    };
  }
  return { currency: String(currency || 'EUR').toUpperCase(), values: result, money };
}

function buildLocalRows(account, currency) {
  const money = window.FREEVMoney;
  const actuals = [], obligations = [], transactionById = new Map();
  let excludedInvalidAmount = 0;
  for (const transaction of transactionsOf(account)) {
    if (!transaction || transaction.projected || !['income', 'expense'].includes(transaction.type)) continue;
    const id = String(transaction.id ?? '');
    if (!id || !money?.parseTransactionBaseMinor) { excludedInvalidAmount += 1; continue; }
    const parsed = money.parseTransactionBaseMinor(transaction, currency);
    if (!parsed.ok || !Number.isSafeInteger(parsed.minor) || parsed.minor <= 0) {
      excludedInvalidAmount += 1;
      continue;
    }
    const row = {
      id,
      accountId: String(account.id || ''),
      currency,
      direction: transaction.type,
      amountMinor: parsed.minor,
      date: String(transaction.date || ''),
      label: String(transaction.desc || transaction.category || transaction.description || 'Opération').trim(),
      reference: String(transaction.reference || transaction.externalRef || '').trim(),
      sourceId: String(transaction.sourceId || transaction.providerSourceId || '').trim(),
      providerTransactionId: String(transaction.providerTransactionId || transaction.externalId || transaction.providerId || '').trim(),
      merchantId: String(transaction.merchantId || '').trim(),
      counterpartyId: String(transaction.counterpartyId || '').trim()
    };
    transactionById.set(id, transaction);
    if (transaction.paymentStatus === 'planned') obligations.push(row);
    else actuals.push(row);
  }
  return { actuals, obligations, transactionById, excludedInvalidAmount };
}

function minorInputValue(minor, currency) {
  const digits = window.FREEVMoney?.minorDigits?.(currency) ?? 2;
  return (minor / (10 ** digits)).toFixed(digits);
}

function formatMoney(minor, currency) {
  return window.FREEVMoney?.formatMinor?.(minor, currency) || 'Montant indisponible';
}

function formatBigIntMoney(minor, currency) {
  if (minor <= BigInt(Number.MAX_SAFE_INTEGER)) return formatMoney(Number(minor), currency);
  const code = String(currency || 'EUR').toUpperCase();
  const digits = window.FREEVMoney?.minorDigits?.(code) ?? 2;
  const scale = 10n ** BigInt(digits);
  const whole = String(minor / scale).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const fraction = digits ? `,${String(minor % scale).padStart(digits, '0')}` : '';
  const symbol = { EUR: '€', USD: '$', GBP: '£' }[code] || code;
  return `${whole}${fraction} ${symbol}`;
}

function snapshot(account) {
  return JSON.stringify({
    id: account?.id,
    transactions: transactionsOf(account),
    allocations: allocationsOf(account),
    settings: account?.reconciliationSettings || {}
  });
}

function createPanel() {
  const parent = document.querySelector('#v5PanelMonthCheck .v5-card');
  if (!parent) return null;
  panel = document.createElement('section');
  panel.id = 'freevReconciliationPanel';
  panel.className = 'rc-panel v5-card';
  panel.setAttribute('aria-labelledby', 'rcTitle');
  parent.insertAdjacentElement('afterend', panel);
  return panel;
}

function createDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'freevReconciliationDialog';
  dialog.className = 'rc-dialog';
  dialog.setAttribute('aria-labelledby', 'rcDialogTitle');
  dialog.innerHTML = `
    <div class="rc-dialog-head">
      <span class="v5-eyebrow">AVANT ENREGISTREMENT</span>
      <button type="button" class="btn-icon" data-rc-close aria-label="Fermer l’aperçu"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    </div>
    <h2 id="rcDialogTitle">Vérifier les rapprochements</h2>
    <p id="rcDialogDescription" class="rc-muted"></p>
    <div id="rcDialogRows" class="rc-dialog-rows"></div>
    <p id="rcDialogWarning" class="rc-dialog-warning" role="status" aria-live="polite" hidden></p>
    <div class="rc-dialog-actions">
      <button type="button" class="btn btn-secondary" data-rc-close>Annuler</button>
      <button type="button" class="btn btn-primary" id="rcDialogConfirm">Confirmer les rapprochements</button>
    </div>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => {
    pendingCommit = null;
    restoreFocusTo?.focus?.();
    restoreFocusTo = null;
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target.closest('[data-rc-close]')) dialog.close();
  });
  dialog.querySelector('#rcDialogConfirm').addEventListener('click', confirmPendingCommit);
  return dialog;
}

function setStatus(message, error = false) {
  if (!statusRegion) return;
  statusRegion.textContent = message;
  statusRegion.classList.toggle('is-error', error);
}

function allocationErrorMessage(errors) {
  const codes = new Set((errors || []).map(item => item.code));
  if (codes.has('over-allocation')) return 'Un montant dépasse le paiement ou l’échéance encore disponible.';
  if (codes.has('duplicate-link')) return 'Ce paiement et cette échéance sont déjà reliés ensemble.';
  if (codes.has('scope-mismatch')) return 'Les rapprochements doivent rester dans le même compte, la même devise et le même sens.';
  if (codes.has('missing-entity')) return 'Une opération reliée n’existe plus. Annulez les liens concernés avant de continuer.';
  return 'Les liens enregistrés sont incohérents. Vérifiez les opérations avant de continuer.';
}

function renderSettings(account, currency) {
  const { values } = tolerancesFor(account, currency);
  const fields = ['expense', 'income'].map(type => `
    <div class="rc-settings-row">
      <strong>${type === 'expense' ? 'Dépenses' : 'Revenus'}</strong>
      <label><span>Écart de date</span><span class="rc-setting-input"><input type="number" min="0" max="30" step="1" value="${values[type].dateDays}" data-rc-days="${type}" aria-label="Tolérance de date pour les ${type === 'expense' ? 'dépenses' : 'revenus'}"><small>jours</small></span></label>
      <label><span>Écart de montant</span><span class="rc-setting-input"><input type="number" min="0" step="${window.FREEVMoney?.minorDigits?.(currency) === 0 ? '1' : window.FREEVMoney?.minorDigits?.(currency) === 3 ? '0.001' : '0.01'}" value="${minorInputValue(values[type].amountMinor, currency)}" data-rc-amount-tolerance="${type}" aria-label="Tolérance de montant pour les ${type === 'expense' ? 'dépenses' : 'revenus'}"><small>${escapeHTML(currency)}</small></span></label>
      <label class="rc-setting-check"><input type="checkbox" data-rc-partial="${type}" ${values[type].allowPartial ? 'checked' : ''}><span>Proposer les paiements partiels</span></label>
    </div>`).join('');
  return `<details class="rc-settings"><summary>Critères de recherche</summary><p>Ces critères servent à proposer des candidats. Aucun lien n’est enregistré sans votre confirmation.</p><div class="rc-settings-grid">${fields}</div><button type="button" class="btn btn-secondary btn-sm" data-rc-save-settings>Enregistrer les critères</button></details>`;
}

function renderLinked(account, currency, rows) {
  const allocations = allocationsOf(account);
  if (!allocations.length) return '';
  const labels = new Map(rows.actuals.concat(rows.obligations).map(row => [row.id, row.label]));
  const items = allocations.slice().reverse().slice(0, 20).map(item => {
    const actual = labels.get(String(item.actualId)) || 'Opération introuvable';
    const due = labels.get(String(item.obligationId)) || 'Échéance introuvable';
    return `<li><span>${escapeHTML(actual)} <i class="fa-solid fa-arrow-right" aria-hidden="true"></i> ${escapeHTML(due)}</span><strong>${escapeHTML(formatMoney(item.amountMinor, currency))}</strong></li>`;
  }).join('');
  const more = allocations.length > 20 ? `<p class="rc-muted">${allocations.length - 20} autre(s) lien(s) enregistré(s).</p>` : '';
  return `<details class="rc-linked"><summary>${allocations.length} rapprochement${allocations.length > 1 ? 's' : ''} enregistré${allocations.length > 1 ? 's' : ''}</summary><ul>${items}</ul>${more}</details>`;
}

function renderDuplicateReview(account, rows) {
  const currentSnapshot = snapshot(account);
  if (duplicateReview && (duplicateReview.accountId !== String(account.id) || duplicateReview.snapshot !== currentSnapshot)) duplicateReview = null;
  if (!duplicateReview) {
    return `<section class="rc-duplicate-review" aria-labelledby="rcDuplicatesTitle"><div class="rc-candidates-head"><div><h3 id="rcDuplicatesTitle">Doublons possibles</h3><p>Freev compare les opérations saisies ou importées sur les 90 derniers jours. Une ressemblance ne prouve pas un doublon.</p></div><button type="button" class="btn btn-secondary btn-sm" data-rc-scan-duplicates><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i> Analyser</button></div><div class="rc-duplicates-list"><p class="rc-muted">L’analyse ne modifie et ne supprime aucune opération.</p></div></section>`;
  }
  const pairs = duplicateReview.pairs;
  const list = pairs.length
    ? pairs.slice(0, 30).map((pair, index) => {
      const left = rows.transactionById.get(pair.leftId);
      const right = rows.transactionById.get(pair.rightId);
      if (!left || !right) return '';
      const exact = pair.kind === 'certain';
      const badge = exact
        ? '<span class="rc-badge"><i class="fa-solid fa-fingerprint" aria-hidden="true"></i> Même identifiant d’import</span>'
        : '<span class="rc-badge rc-badge-warning"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Ressemblance à vérifier</span>';
      const reason = exact
        ? 'Même compte et même source d’import. Vérifiez les deux lignes avant toute suppression.'
        : `${pair.dateDifferenceDays} jour(s) d’écart · écart ${formatMoney(pair.amountDifferenceMinor, duplicateReview.currency)} · libellés proches`;
      return `<article class="rc-duplicate-card">${badge}<div class="rc-duplicate-pair"><span><strong>${escapeHTML(pair.leftLabel)}</strong><small>${escapeHTML(pair.leftDate)} · ${escapeHTML(formatMoney(pair.leftAmountMinor, duplicateReview.currency))}</small></span><i class="fa-solid fa-arrows-left-right" aria-hidden="true"></i><span><strong>${escapeHTML(pair.rightLabel)}</strong><small>${escapeHTML(pair.rightDate)} · ${escapeHTML(formatMoney(pair.rightAmountMinor, duplicateReview.currency))}</small></span></div><p>${escapeHTML(reason)}</p><div class="rc-duplicate-actions"><button type="button" class="btn btn-secondary btn-sm" data-rc-duplicate-open="${index}" data-rc-transaction-id="${escapeHTML(pair.leftId)}">Examiner la première</button><button type="button" class="btn btn-secondary btn-sm" data-rc-duplicate-open="${index}" data-rc-transaction-id="${escapeHTML(pair.rightId)}">Examiner la seconde</button></div></article>`;
    }).join('')
    : '<div class="rc-empty"><span class="rc-empty-icon"><i class="fa-solid fa-circle-check" aria-hidden="true"></i></span><strong>Aucun candidat trouvé</strong><p>Aucune opération semblable selon les critères prudents de cette analyse. Vos données n’ont pas été modifiées.</p></div>';
  const more = pairs.length > 30 ? `<p class="rc-muted">${pairs.length - 30} autre(s) paire(s) non affichée(s).</p>` : '';
  const bounded = duplicateReview.scanned === duplicateReview.total
    ? `${duplicateReview.scanned} opération(s) analysée(s).`
    : `${duplicateReview.scanned} opération(s) les plus récentes analysées sur ${duplicateReview.total}.`;
  return `<section class="rc-duplicate-review" aria-labelledby="rcDuplicatesTitle"><div class="rc-candidates-head"><div><h3 id="rcDuplicatesTitle">Doublons possibles</h3><p>${escapeHTML(bounded)} Aucune opération n’est supprimée automatiquement.</p></div><button type="button" class="btn btn-secondary btn-sm" data-rc-scan-duplicates><i class="fa-solid fa-rotate" aria-hidden="true"></i> Réanalyser</button></div><div class="rc-duplicates-list">${list}${more}</div></section>`;
}

function scanLocalDuplicates() {
  const state = appState();
  const account = currentAccount(state);
  if (!account || state.multiViewMode !== 'individual') return setStatus('Choisissez un compte individuel avant de rechercher des doublons.', true);
  const currency = String(account.settings?.baseCurrency || 'EUR').toUpperCase();
  const rows = buildLocalRows(account, currency);
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 90, 12);
  const cutoffISO = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
  const recent = rows.actuals.filter(row => row.date >= cutoffISO && row.date <= localTodayISO())
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const boundedRows = recent.slice(0, 500);
  const existing = boundedRows;
  const incomingWithIdentity = boundedRows.map((row, index) => ({
    ...row, id: `duplicate-review-${index}`, sourceTransactionId: row.id
  }));
  const stable = reviewDuplicates({ existing, incoming: incomingWithIdentity });
  const incomingFuzzy = boundedRows.map((row, index) => ({
    ...row, id: `fuzzy-review-${index}`, sourceTransactionId: row.id,
    sourceId: '', providerTransactionId: '', externalId: '', providerId: ''
  }));
  const fuzzy = reviewDuplicates({ existing, incoming: incomingFuzzy });
  const pairs = new Map();
  const byId = new Map(boundedRows.map(row => [row.id, row]));
  const addPair = (leftId, rightId, kind, metadata = {}) => {
    if (!leftId || !rightId || leftId === rightId) return;
    const key = [leftId, rightId].sort().join('\u0000');
    const left = byId.get(leftId < rightId ? leftId : rightId);
    const right = byId.get(leftId < rightId ? rightId : leftId);
    if (!left || !right) return;
    const current = pairs.get(key);
    if (current?.kind === 'certain') return;
    pairs.set(key, {
      leftId: left.id, rightId: right.id,
      leftLabel: left.label, rightLabel: right.label,
      leftDate: left.date, rightDate: right.date,
      leftAmountMinor: left.amountMinor, rightAmountMinor: right.amountMinor,
      kind, ...metadata
    });
  };
  stable.decisions.forEach(decision => {
    if (decision.status !== 'certain-duplicate') return;
    const origin = String(decision.incoming?.sourceTransactionId || '');
    if (decision.match) addPair(origin, String(decision.match.id || ''), 'certain');
    (decision.candidates || []).forEach(item => addPair(origin, String(item.id || ''), 'certain'));
  });
  fuzzy.decisions.forEach(decision => {
    if (decision.status !== 'needs-review') return;
    const origin = String(decision.incoming?.sourceTransactionId || '');
    (decision.candidates || []).forEach(candidate => addPair(origin, String(candidate.id || ''), 'possible', {
      amountDifferenceMinor: candidate.amountDifferenceMinor,
      dateDifferenceDays: candidate.dateDifferenceDays,
      score: candidate.score
    }));
  });
  duplicateReview = {
    accountId: String(account.id),
    snapshot: snapshot(account),
    currency,
    scanned: boundedRows.length,
    total: recent.length,
    pairs: [...pairs.values()].sort((a, b) => (a.kind === 'certain' ? -1 : 1) - (b.kind === 'certain' ? -1 : 1) || (b.score || 0) - (a.score || 0) || a.leftDate.localeCompare(b.leftDate))
  };
  render();
  setStatus(duplicateReview.pairs.length
    ? `${duplicateReview.pairs.length} paire(s) à vérifier. Aucune opération n’a été modifiée.`
    : 'Aucun candidat trouvé. Aucune opération n’a été modifiée.');
}

function candidateCard(candidate, index, rows, currency) {
  const actual = rows.actuals.find(item => item.id === candidate.actualId);
  const due = rows.obligations.find(item => item.id === candidate.obligationId);
  if (!actual || !due) return '';
  const max = Math.min(candidate.actualRemainingMinor, candidate.obligationRemainingMinor);
  const evidence = [];
  evidence.push(candidate.dateDifferenceDays === 0 ? 'Même date' : `${candidate.dateDifferenceDays} jour(s) d’écart`);
  evidence.push(candidate.amountDifferenceMinor === 0 ? 'Montants correspondants' : `Écart de ${formatMoney(candidate.amountDifferenceMinor, currency)}`);
  if (candidate.evidence.some(item => item.field === 'reference')) evidence.push('Référence commune');
  if (candidate.kind === 'partial') evidence.push('Paiement partiel possible');
  const ambiguity = candidate.ambiguous
    ? '<span class="rc-badge rc-badge-warning"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Plusieurs correspondances proches</span>'
    : '<span class="rc-badge"><i class="fa-solid fa-sparkles" aria-hidden="true"></i> À vérifier</span>';
  return `<fieldset class="rc-option" data-rc-option="${index}">
    <legend class="sr-only">Rapprochement proposé</legend>
    <label class="rc-option-select"><input type="checkbox" data-rc-select="${index}" aria-label="Sélectionner le rapprochement entre ${escapeHTML(actual.label)} et ${escapeHTML(due.label)}"><span></span></label>
    <div class="rc-option-main">
      <div class="rc-option-operations"><div><small>Opération enregistrée</small><strong>${escapeHTML(actual.label)}</strong><span>${escapeHTML(actual.date)} · ${escapeHTML(formatMoney(actual.amountMinor, currency))}</span></div><i class="fa-solid fa-arrow-right" aria-hidden="true"></i><div><small>À payer</small><strong>${escapeHTML(due.label)}</strong><span>${escapeHTML(due.date)} · ${escapeHTML(formatMoney(due.amountMinor, currency))}</span></div></div>
      <div class="rc-evidence">${ambiguity}<span>${evidence.map(escapeHTML).join(' · ')}</span></div>
      <label class="rc-allocation-amount"><span>Montant à rapprocher</span><span class="rc-setting-input"><input type="number" min="${minorInputValue(1, currency)}" max="${minorInputValue(max, currency)}" step="${window.FREEVMoney?.minorDigits?.(currency) === 0 ? '1' : window.FREEVMoney?.minorDigits?.(currency) === 3 ? '0.001' : '0.01'}" value="${minorInputValue(max, currency)}" data-rc-amount="${index}" aria-label="Montant à rapprocher pour ${escapeHTML(actual.label)} et ${escapeHTML(due.label)}"><small>${escapeHTML(currency)}</small></span></label>
    </div>
  </fieldset>`;
}

function render() {
  if (!panel) createPanel();
  if (!panel) return;
  const state = appState();
  const account = currentAccount(state);
  if (!account) {
    panel.innerHTML = '<div class="rc-head"><div><span class="v5-eyebrow">RAPPROCHEMENT</span><h2 id="rcTitle">Relier paiements et échéances</h2></div></div><p class="rc-muted">Créez ou sélectionnez un compte pour commencer.</p>';
    return;
  }
  const currency = String(account.settings?.baseCurrency || 'EUR').toUpperCase();
  const rows = buildLocalRows(account, currency);
  const existingValidation = validateReconciliationAllocations({
    actuals: rows.actuals,
    obligations: rows.obligations,
    allocations: [],
    existingAllocations: allocationsOf(account)
  });
  const { values: tolerances } = tolerancesFor(account, currency);
  let candidates = [];
  if (state.multiViewMode === 'individual' && existingValidation.ok) {
    candidates = buildReconciliationCandidates({
      actuals: rows.actuals,
      obligations: rows.obligations,
      existingAllocations: allocationsOf(account),
      tolerances
    });
  }
  candidateRows = candidates;
  statusRegion = document.createElement('p');
  statusRegion.id = 'rcStatus';
  statusRegion.className = 'rc-status';
  statusRegion.setAttribute('role', 'status');
  statusRegion.setAttribute('aria-live', 'polite');

  const warning = !existingValidation.ok
    ? `<div class="rc-alert" role="alert"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>${escapeHTML(allocationErrorMessage(existingValidation.errors))}</span></div>`
    : '';
  const modeWarning = state.multiViewMode !== 'individual'
    ? '<div class="rc-alert"><i class="fa-solid fa-layer-group" aria-hidden="true"></i><span>Choisissez un compte individuel. Un rapprochement ne traverse jamais plusieurs comptes.</span></div>'
    : '';
  const empty = state.multiViewMode !== 'individual' ? '' : candidates.length
    ? ''
    : '<div class="rc-empty"><span class="rc-empty-icon"><i class="fa-solid fa-link" aria-hidden="true"></i></span><strong>Aucune proposition pour le moment</strong><p>Ajoutez une opération enregistrée et une échéance marquée « À payer ». Les deux doivent appartenir à ce compte et à la même devise.</p></div>';
  const visible = candidates.slice(0, MAX_VISIBLE_CANDIDATES);
  const candidateMarkup = visible.map((candidate, index) => candidateCard(candidate, index, rows, currency)).join('');
  const excluded = rows.excludedInvalidAmount
    ? `<p class="rc-muted">${rows.excludedInvalidAmount} opération(s) ignorée(s), car leur montant est invalide ou incomplet.</p>`
    : '';
  const overflow = candidates.length > MAX_VISIBLE_CANDIDATES
    ? `<p class="rc-muted">${candidates.length - MAX_VISIBLE_CANDIDATES} autre(s) proposition(s) non affichée(s). Réduisez les critères pour les parcourir plus facilement.</p>`
    : '';
  const undo = account.reconciliationUndo?.batchId
    ? `<button type="button" class="btn btn-secondary rc-undo" data-rc-undo><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Annuler le dernier rapprochement</button>`
    : '';

  panel.innerHTML = `
    <div class="rc-head"><div><span class="v5-eyebrow">RAPPROCHEMENT LOCAL</span><h2 id="rcTitle">Relier paiements et échéances</h2><p>Comparez vos opérations enregistrées aux montants « À payer ». Vous gardez la décision finale et pouvez annuler le dernier lot.</p></div><span class="rc-account"><i class="fa-solid fa-wallet" aria-hidden="true"></i>${escapeHTML(account.name || 'Compte')}</span></div>
    <div class="rc-summary"><div><small>Opérations comparables</small><strong>${rows.actuals.length}</strong></div><div><small>Échéances à payer</small><strong>${rows.obligations.length}</strong></div><div><small>Propositions à vérifier</small><strong>${candidates.length}</strong></div></div>
    ${modeWarning}${warning}
    ${state.multiViewMode === 'individual' && existingValidation.ok ? renderSettings(account, currency) : ''}
    ${excluded}
    <div class="rc-candidates-head"><div><h3>Correspondances possibles</h3><p>Les propositions sont des repères de tri, jamais une certitude.</p></div><span class="rc-candidate-count">${candidates.length}</span></div>
    <div class="rc-candidate-list">${candidateMarkup || empty}</div>
    ${overflow}
    <div class="rc-footer"><span class="rc-selected-count" id="rcSelectedCount">Aucun rapprochement sélectionné</span><div>${undo}<button type="button" class="btn btn-primary" data-rc-review ${candidates.length ? '' : 'disabled'}><i class="fa-solid fa-eye" aria-hidden="true"></i> Examiner la sélection</button></div></div>
    ${renderLinked(account, currency, rows)}
    ${state.multiViewMode === 'individual' ? renderDuplicateReview(account, rows) : ''}
  `;
  panel.querySelector('.rc-footer')?.insertAdjacentElement('afterend', statusRegion);
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function collectSelected() {
  const state = appState();
  const account = currentAccount(state);
  if (!account || state.multiViewMode !== 'individual') return { error: 'Choisissez un compte individuel avant de rapprocher des opérations.' };
  const currency = String(account.settings?.baseCurrency || 'EUR').toUpperCase();
  const rows = buildLocalRows(account, currency);
  const selected = [];
  panel.querySelectorAll('[data-rc-select]:checked').forEach(check => {
    const index = Number(check.dataset.rcSelect);
    const candidate = candidateRows[index];
    const input = panel.querySelector(`[data-rc-amount="${index}"]`);
    const parsed = window.FREEVMoney?.parseAmount?.(input?.value || '', currency);
    if (!candidate || !parsed?.ok || parsed.minor <= 0) return;
    selected.push({
      actualId: candidate.actualId,
      obligationId: candidate.obligationId,
      amountMinor: parsed.minor,
      reviewKind: candidate.kind,
      reviewAmbiguous: Boolean(candidate.ambiguous),
      reviewEvidence: candidate.evidence.map(item => ({ ...item }))
    });
  });
  if (!selected.length) return { error: 'Sélectionnez au moins une proposition et vérifiez son montant.' };
  const validation = validateReconciliationAllocations({
    actuals: rows.actuals,
    obligations: rows.obligations,
    allocations: selected,
    existingAllocations: allocationsOf(account)
  });
  return { account, state, currency, rows, selected, validation };
}

function selectedSummary() {
  const count = panel?.querySelectorAll('[data-rc-select]:checked').length || 0;
  const label = panel?.querySelector('#rcSelectedCount');
  const button = panel?.querySelector('[data-rc-review]');
  if (label) label.textContent = count ? `${count} proposition${count > 1 ? 's' : ''} sélectionnée${count > 1 ? 's' : ''}` : 'Aucun rapprochement sélectionné';
  if (button) button.disabled = count === 0;
}

function openReviewDialog() {
  const selection = collectSelected();
  if (selection.error) return setStatus(selection.error, true);
  if (!selection.validation.ok) return setStatus(allocationErrorMessage(selection.validation.errors), true);
  const { account, currency, selected, rows } = selection;
  const labels = new Map(rows.actuals.concat(rows.obligations).map(item => [item.id, item.label]));
  const total = selected.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n);
  const d = createDialog();
  const confirmButton = d.querySelector('#rcDialogConfirm');
  confirmButton.removeEventListener('click', confirmPendingCommit);
  if (confirmButton.__rcUndoHandler) {
    confirmButton.removeEventListener('click', confirmButton.__rcUndoHandler);
    confirmButton.__rcUndoHandler = null;
  }
  confirmButton.textContent = 'Confirmer les rapprochements';
  confirmButton.addEventListener('click', confirmPendingCommit);
  d.querySelector('#rcDialogDescription').textContent = `${selected.length} lien(s) seront enregistrés dans « ${account.name || 'ce compte'} ». Le montant et le statut des opérations d’origine resteront inchangés. Les échéances réduiront leur effet prévu du montant rapproché.`;
  d.querySelector('#rcDialogRows').innerHTML = selected.map(item => `<div><span>${item.reviewAmbiguous ? '<small>Plusieurs correspondances proches — vérifiez cette ligne</small><br>' : ''}${escapeHTML(labels.get(item.actualId) || 'Opération')} <i class="fa-solid fa-arrow-right" aria-hidden="true"></i> ${escapeHTML(labels.get(item.obligationId) || 'Échéance')}</span><strong>${escapeHTML(formatMoney(item.amountMinor, currency))}</strong></div>`).join('');
  d.querySelector('#rcDialogWarning').hidden = false;
  d.querySelector('#rcDialogWarning').textContent = `Total alloué : ${formatBigIntMoney(total, currency)}. Vérifiez les rapprochements ambigus avant de confirmer.`;
  pendingCommit = {
    accountId: String(account.id),
    snapshot: snapshot(account),
    allocations: selected,
    currency,
    expectedValidation: selection.validation
  };
  restoreFocusTo = panel.querySelector('[data-rc-review]');
  d.showModal();
  d.querySelector('#rcDialogConfirm').focus();
}

function confirmPendingCommit() {
  if (!pendingCommit) return;
  const state = appState();
  const account = currentAccount(state);
  if (!account || String(account.id) !== pendingCommit.accountId || state.multiViewMode !== 'individual' || snapshot(account) !== pendingCommit.snapshot) {
    $('rcDialogWarning').textContent = 'Les données ou le compte ont changé. Fermez cet aperçu, actualisez les propositions, puis recommencez.';
    $('rcDialogWarning').hidden = false;
    return;
  }
  const currency = String(account.settings?.baseCurrency || 'EUR').toUpperCase();
  const rows = buildLocalRows(account, currency);
  const validation = validateReconciliationAllocations({
    actuals: rows.actuals,
    obligations: rows.obligations,
    allocations: pendingCommit.allocations,
    existingAllocations: allocationsOf(account)
  });
  if (!validation.ok) {
    $('rcDialogWarning').textContent = allocationErrorMessage(validation.errors);
    $('rcDialogWarning').hidden = false;
    return;
  }
  const batchId = randomId();
  const createdAt = new Date().toISOString();
  const inserted = pendingCommit.allocations.map(item => ({
    ...item,
    batchId,
    createdAt,
    source: 'user-reviewed'
  }));
  const saved = window._mutateAccountData?.(account.id, target => {
    target.reconciliationAllocations = [...allocationsOf(target), ...inserted];
    target.reconciliationUndo = { batchId, createdAt, count: inserted.length };
  });
  if (!saved) {
    $('rcDialogWarning').textContent = 'Freev n’a pas pu enregistrer le lot. Aucune opération n’a été modifiée.';
    $('rcDialogWarning').hidden = false;
    return;
  }
  dialog.close();
  window.updateDashboard?.();
  window.FreevV4?.render?.();
  window.FreevV5?.render?.();
  render();
  setStatus(`${inserted.length} rapprochement(s) enregistré(s). Les opérations d’origine sont restées inchangées.`);
  panel.querySelector('[data-rc-undo]')?.focus();
}

function openUndoDialog() {
  const state = appState();
  const account = currentAccount(state);
  const batch = account?.reconciliationUndo;
  if (!account || !batch?.batchId || state.multiViewMode !== 'individual') return;
  const batchRows = allocationsOf(account).filter(item => item.batchId === batch.batchId);
  if (!batchRows.length || batchRows.length !== batch.count) return setStatus('Le lot à annuler a changé ou est incomplet. Aucun lien n’a été retiré.', true);
  const currency = String(account.settings?.baseCurrency || 'EUR').toUpperCase();
  const rows = buildLocalRows(account, currency);
  const labels = new Map(rows.actuals.concat(rows.obligations).map(item => [item.id, item.label]));
  const d = createDialog();
  d.querySelector('#rcDialogTitle').textContent = 'Annuler le dernier rapprochement';
  d.querySelector('#rcDialogDescription').textContent = `Les ${batchRows.length} lien(s) sélectionnés seront retirés. Les échéances retrouveront leur effet prévu complet. Les opérations et montants d’origine resteront inchangés.`;
  d.querySelector('#rcDialogRows').innerHTML = batchRows.map(item => `<div><span>${escapeHTML(labels.get(item.actualId) || 'Opération')} <i class="fa-solid fa-arrow-right" aria-hidden="true"></i> ${escapeHTML(labels.get(item.obligationId) || 'Échéance')}</span><strong>${escapeHTML(formatMoney(item.amountMinor, currency))}</strong></div>`).join('');
  const warning = d.querySelector('#rcDialogWarning');
  warning.hidden = true;
  warning.textContent = '';
  const confirmButton = d.querySelector('#rcDialogConfirm');
  confirmButton.textContent = 'Retirer ces rapprochements';
  const previousHandler = confirmButton.__rcUndoHandler;
  if (previousHandler) confirmButton.removeEventListener('click', previousHandler);
  confirmButton.removeEventListener('click', confirmPendingCommit);
  const undoSnapshot = snapshot(account);
  const undoHandler = () => {
    const freshState = appState();
    const fresh = currentAccount(freshState);
    if (!fresh || String(fresh.id) !== String(account.id) || snapshot(fresh) !== undoSnapshot || freshState.multiViewMode !== 'individual') {
      warning.textContent = 'Les données ont changé. Fermez cet aperçu puis réessayez.';
      warning.hidden = false;
      return;
    }
    const currentBatch = allocationsOf(fresh).filter(item => item.batchId === batch.batchId);
    if (currentBatch.length !== batch.count) {
      warning.textContent = 'Le lot est incomplet. Aucun lien n’a été retiré.';
      warning.hidden = false;
      return;
    }
    const saved = window._mutateAccountData?.(fresh.id, target => {
      target.reconciliationAllocations = allocationsOf(target).filter(item => item.batchId !== batch.batchId);
      target.reconciliationUndo = null;
    });
    if (!saved) {
      warning.textContent = 'Freev n’a pas pu annuler le lot.';
      warning.hidden = false;
      return;
    }
    dialog.close();
    window.updateDashboard?.();
    window.FreevV4?.render?.();
    window.FreevV5?.render?.();
    render();
    setStatus('Le dernier lot a été annulé. Les échéances sont de nouveau prévues en totalité.');
  };
  confirmButton.__rcUndoHandler = undoHandler;
  confirmButton.addEventListener('click', undoHandler);
  restoreFocusTo = panel.querySelector('[data-rc-undo]');
  d.showModal();
  confirmButton.focus();
}

function saveCriteria() {
  const state = appState();
  const account = currentAccount(state);
  if (!account || state.multiViewMode !== 'individual') return setStatus('Choisissez un compte individuel pour enregistrer les critères.', true);
  const currency = String(account.settings?.baseCurrency || 'EUR').toUpperCase();
  const settings = {};
  for (const type of ['expense', 'income']) {
    const days = Number(panel.querySelector(`[data-rc-days="${type}"]`)?.value);
    const amountValue = panel.querySelector(`[data-rc-amount-tolerance="${type}"]`)?.value || '';
    const parsed = window.FREEVMoney?.parseAmount?.(amountValue, currency);
    if (!Number.isInteger(days) || days < 0 || days > 30 || !parsed?.ok || parsed.minor < 0) {
      return setStatus('Saisissez un écart de date de 0 à 30 jours et un montant valide.', true);
    }
    settings[type] = {
      dateDays: days,
      amountMinor: parsed.minor,
      allowPartial: Boolean(panel.querySelector(`[data-rc-partial="${type}"]`)?.checked)
    };
  }
  const saved = window._mutateAccountData?.(account.id, target => { target.reconciliationSettings = settings; });
  if (!saved) return setStatus('Freev n’a pas pu enregistrer les critères.', true);
  render();
  setStatus('Critères mis à jour pour ce compte.');
}

function bind() {
  if (bound) return;
  bound = true;
  document.addEventListener('click', event => {
    const target = event.target.closest?.('[data-rc-review], [data-rc-undo], [data-rc-save-settings], [data-rc-scan-duplicates], [data-rc-duplicate-open]');
    if (!target || !panel?.contains(target)) return;
    if (target.matches('[data-rc-review]')) openReviewDialog();
    if (target.matches('[data-rc-undo]')) openUndoDialog();
    if (target.matches('[data-rc-save-settings]')) saveCriteria();
    if (target.matches('[data-rc-scan-duplicates]')) scanLocalDuplicates();
    if (target.matches('[data-rc-duplicate-open]')) {
      const transactionId = target.dataset.rcTransactionId;
      if (!transactionId) return;
      window.switchView?.('transactions');
      window.setTimeout(() => window.openModalById?.(transactionId), 0);
    }
  });
  panel?.addEventListener('change', event => {
    if (event.target.matches('[data-rc-select]')) { setStatus(''); selectedSummary(); }
  });
  panel?.addEventListener('input', event => {
    if (event.target.matches('[data-rc-amount]')) setStatus('');
  });
  document.addEventListener('click', event => {
    const tab = event.target.closest?.('[data-v5-tab]');
    if (tab?.dataset.v5Tab === 'monthcheck') scheduleRender();
    if (event.target.closest?.('[data-accid], #viewMode-individual, #viewMode-group, #viewMode-global')) window.setTimeout(scheduleRender, 0);
  });
  window.addEventListener('freev:ready', render);
  window.addEventListener('freev:account-changed', render);
  window.addEventListener('freev:mode-changed', render);
  const monthRoot = $('mcRoot');
  if (monthRoot && typeof MutationObserver === 'function') {
    new MutationObserver(scheduleRender).observe(monthRoot, { childList: true, subtree: true });
  }
}

createPanel();
bind();
window.FreevReconciliation = Object.freeze({ render });
if (document.readyState !== 'loading') render();
else document.addEventListener('DOMContentLoaded', render, { once: true });
