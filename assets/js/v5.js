import {
  applyAutomationRules,
  buildFinancialIntelligence,
  buildLocalAlerts,
  calculateNetWorth,
  detectSubscriptions,
  merchantKey,
  normalizeText,
  parseCSVStatement,
  parseQIFStatement,
  partitionDuplicates,
  suggestAutomationRules
} from './v5-engine.js';
import { buildCorrectionSuggestions, createCorrectionLearningState, recordConfirmedCorrection, undoCorrectionEvidence } from './category-learning.mjs';

const RELEASE_KEY = 'freevValeurWhatsNew_5_1';
let initialized = false;
let activeTab = 'overview';
let pendingImport = null;
let pendingRulePreview = null;
const BULK_UNDO_WINDOW_MS = 30 * 60 * 1000;

const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));
const localISODate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function appState() {
  return window._getAppState?.() || { accounts: [], currentAccountId: null };
}

function currentAccount(state = appState()) {
  return state.accounts.find(account => account.id === state.currentAccountId) || state.accounts[0] || null;
}

function formatMoney(value, account = currentAccount()) {
  const currency = account?.settings?.baseCurrency || 'EUR';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function notify(message, type = 'success') {
  window.showToast?.(message, type);
}

function mutate(mutator) {
  const account = currentAccount();
  if (!account) return null;
  const result = window._mutateAccountData?.(account.id, mutator);
  render();
  window.updateDashboard?.();
  return result;
}

function accountCollections(account) {
  account.automationRules = Array.isArray(account.automationRules) ? account.automationRules : [];
  account.importHistory = Array.isArray(account.importHistory) ? account.importHistory : [];
  account.plannerScenarios = Array.isArray(account.plannerScenarios) ? account.plannerScenarios : [];
  account.wealthAssets = Array.isArray(account.wealthAssets) ? account.wealthAssets : [];
  account.ignoredSubscriptionKeys = Array.isArray(account.ignoredSubscriptionKeys) ? account.ignoredSubscriptionKeys : [];
  account.bulkUndo = account.bulkUndo && typeof account.bulkUndo === 'object' ? account.bulkUndo : null;
  return account;
}

function getSubscriptions(account) {
  const ignored = new Set(account.ignoredSubscriptionKeys || []);
  return detectSubscriptions(account.transactions, account.recurringTransactions).filter(subscription => !ignored.has(subscription.key));
}

function suggestionKey(suggestion) {
  return `${suggestion.contains}|${suggestion.category}|${suggestion.matchType || ''}|${suggestion.type || ''}`;
}

function recommendationCount(account, automationSuggestions) {
  return new Set([
    ...(automationSuggestions || []),
    ...buildCorrectionSuggestions(String(account.id), account.categoryLearning)
  ].map(suggestionKey)).size;
}

function assetHistory(asset) {
  const history = Array.isArray(asset?.valuations) ? asset.valuations.filter(item =>
    item && /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || '')) && Number.isFinite(Number(item.value)) && Number(item.value) >= 0
  ) : [];
  if (!history.length && Number.isFinite(Number(asset?.value)) && Number(asset.value) >= 0) {
    history.push({ id: 'initial', date: String(asset.updatedAt || asset.createdAt || new Date().toISOString()).slice(0, 10), value: Number(asset.value) });
  }
  return history.slice().sort((first, second) => String(first.date).localeCompare(String(second.date)) || String(first.id || '').localeCompare(String(second.id || ''))).slice(-100);
}

function assetSparkline(history, name) {
  if (history.length < 2) return '<p class="v5-asset-history-empty">Ajoutez une estimation à une autre date pour voir son évolution.</p>';
  const values = history.map(item => Number(item.value));
  const min = Math.min(...values), max = Math.max(...values), spread = max - min || 1;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 156 + 2},${32 - ((value - min) / spread) * 26}`).join(' ');
  const firstDate = new Date(`${history[0].date}T12:00:00`).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
  const lastDate = new Date(`${history.at(-1).date}T12:00:00`).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
  return `<svg class="v5-asset-sparkline" viewBox="0 0 160 38" role="img" aria-label="Évolution de la valeur estimée de ${escapeHTML(name)}"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></polyline></svg><div class="v5-asset-history-range"><span>${escapeHTML(firstDate)}</span><span>${escapeHTML(lastDate)}</span></div>`;
}

function renderSummary(account, subscriptions, suggestions) {
  const container = $('v5Summary');
  if (!container) return;
  const unclassified = account.transactions.filter(transaction => transaction.category === 'À classer' || !transaction.category).length;
  const yearlySubscriptions = subscriptions.reduce((sum, subscription) => sum + subscription.yearlyCost, 0);
  const suggestedRules = recommendationCount(account, suggestions);
  const worth = calculateNetWorth(account);
  container.innerHTML = [
    ['wand-magic-sparkles', 'Règles actives', account.automationRules.filter(rule => rule.enabled !== false).length, `${suggestedRules} suggestion(s) à vérifier`],
    ['repeat', 'Abonnements détectés', subscriptions.length, `${formatMoney(yearlySubscriptions, account)} par an`],
    ['inbox', 'À classer', unclassified, unclassified ? 'Des opérations demandent votre attention' : 'Tout est classé'],
    ['scale-balanced', 'Patrimoine net', formatMoney(worth.netWorth, account), `${formatMoney(worth.assets + worth.savings, account)} d’actifs suivis`]
  ].map(([icon, label, value, detail]) => `<article><i class="fa-solid fa-${icon}"></i><div><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong><small>${escapeHTML(detail)}</small></div></article>`).join('');
}

function renderOverview(account, subscriptions, suggestions) {
  const container = $('v5Overview');
  if (!container) return;
  const intelligence = buildFinancialIntelligence(account);
  const suggestedRules = recommendationCount(account, suggestions);
  const brief = $('v51IntelligenceBrief');
  const changes = $('v51ChangeGrid');
  if (brief) {
    const classified = Math.max(0, Math.min(100, Number(intelligence.dataCoverage.classificationRate) || 0));
    brief.innerHTML = `<div class="v51-score" style="--score:${intelligence.score}"><div><strong>${intelligence.score}</strong><span>/100</span></div></div><div><span>Lecture Freev</span><strong>${escapeHTML(intelligence.scoreLabel)}</strong><small>${escapeHTML(intelligence.cashCoverage.toLocaleString('fr-FR', { maximumFractionDigits: 1 }))} mois de trésorerie et d’épargne disponibles.</small></div><div class="v51-confidence"><span>Historique analysé</span><strong>${intelligence.dataCoverage.activeMonths}/6 mois</strong><small>${intelligence.dataCoverage.transactionCount} opérations · ${intelligence.dataCoverage.classificationRate.toLocaleString('fr-FR')} % classées. Fiabilité prédictive non évaluée.</small><div class="v51-coverage-meter" role="img" aria-label="${classified.toLocaleString('fr-FR')} % des opérations classées"><span style="--coverage:${classified}%"></span></div></div>`;
  }
  const percent = value => value === null ? 'Nouveau' : `${value >= 0 ? '+' : ''}${value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
  if (changes) changes.innerHTML = [
    ['arrow-up', 'Revenus', percent(intelligence.changes.income), formatMoney(intelligence.lastMonth.income, account), intelligence.changes.income !== null && intelligence.changes.income < 0 ? 'danger' : 'success'],
    ['arrow-down', 'Dépenses', percent(intelligence.changes.expenses), formatMoney(intelligence.lastMonth.expenses, account), intelligence.changes.expenses !== null && intelligence.changes.expenses > 0 ? 'danger' : 'success'],
    ['scale-balanced', 'Écart net', `${intelligence.changes.net >= 0 ? '+' : ''}${formatMoney(intelligence.changes.net, account)}`, 'Face au mois précédent', intelligence.changes.net < 0 ? 'danger' : 'success'],
    ['tags', 'Classement', `${intelligence.classificationRate.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} %`, `${suggestedRules} règle(s) à vérifier`, intelligence.classificationRate < 80 ? 'warning' : 'success']
  ].map(([icon, label, value, detail, tone]) => `<article class="${tone}"><i class="fa-solid fa-${icon}"></i><div><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong><small>${escapeHTML(detail)}</small></div></article>`).join('');
  container.innerHTML = intelligence.decisions.map(item => `<article class="${item.tone}"><i class="fa-solid fa-${item.icon}"></i><div><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(item.detail)}</span><small>${escapeHTML(item.impact)}</small></div><button type="button" data-v5-open-tab="${item.action}">${escapeHTML(item.label)}</button></article>`).join('');
}

function ruleHTML(rule) {
  const scope = rule.matchType === 'income' ? ' · revenus uniquement' : rule.matchType === 'expense' ? ' · dépenses uniquement' : '';
  return `<article class="v5-rule"><div><strong>Si le libellé contient « ${escapeHTML(rule.contains)} »</strong><span>Classer dans ${escapeHTML(rule.category)}${rule.type ? ` · changer le type en ${escapeHTML(rule.type === 'income' ? 'Revenu' : 'Dépense')}` : ''}${scope}</span></div><label class="v5-switch"><input type="checkbox" data-v5-toggle-rule="${escapeHTML(rule.id)}" ${rule.enabled !== false ? 'checked' : ''}><span></span></label><button type="button" class="btn-icon" data-v5-delete-rule="${escapeHTML(rule.id)}" aria-label="Supprimer la règle"><i class="fa-solid fa-trash"></i></button></article>`;
}

function renderRules(account, suggestions) {
  const rules = $('v5RulesList');
  const suggested = $('v5RuleSuggestions');
  if (rules) rules.innerHTML = account.automationRules.length ? account.automationRules.map(ruleHTML).join('') : '<p class="v5-empty">Aucune règle. Créez-en une ou utilisez une suggestion de Freev.</p>';
  if (suggested) {
    const existing = new Set(account.automationRules.map(rule => `${rule.contains}|${rule.category}|${rule.matchType || ''}|${rule.type || ''}`));
    const learned = buildCorrectionSuggestions(String(account.id), account.categoryLearning);
    const learnedSignatures = new Set(learned.map(suggestionKey));
    const remaining = suggestions.filter(suggestion => !existing.has(suggestionKey(suggestion)) && !learnedSignatures.has(suggestionKey(suggestion)));
    const learnedHTML = learned.map(suggestion => {
      const sourceTypeLabel = suggestion.matchType === 'income' ? 'revenus' : 'dépenses';
      const targetTypeLabel = suggestion.type === 'income' ? 'revenu' : 'dépense';
      const matchingRuleExists = existing.has(suggestionKey(suggestion));
      const evidence = (account.categoryLearning?.entries || []).filter(entry =>
        entry.status === 'active' && entry.merchant === suggestion.merchant && entry.sourceType === suggestion.matchType);
      const action = matchingRuleExists
        ? '<span class="v5-learning-pending">Règle déjà créée</span>'
        : suggestion.eligibleForRule
          ? `<button type="button" class="btn btn-secondary btn-sm" data-v5-add-suggestion="${escapeHTML(suggestion.contains)}" data-category="${escapeHTML(suggestion.category)}" data-match-type="${escapeHTML(suggestion.matchType)}" data-rule-type="${escapeHTML(suggestion.type)}">Vérifier la règle</button>`
          : '<span class="v5-learning-pending">Encore trop peu de corrections</span>';
      return `<article class="v5-learning-suggestion"><div><strong>${escapeHTML(suggestion.contains)} → ${escapeHTML(suggestion.category)}</strong><span>${escapeHTML(suggestion.reason)}</span><small>Signal fondé sur ${suggestion.sampleSize} correction(s) de ${sourceTypeLabel} · cible : ${targetTypeLabel}</small><details><summary>Corrections prises en compte (${evidence.length})</summary><div class="v5-learning-evidence">${evidence.map(entry => `<div><span>${escapeHTML(entry.sourceCategory || 'Sans catégorie')} → ${escapeHTML(entry.category)} · ${new Date(entry.confirmedAt).toLocaleDateString('fr-FR')}</span><button type="button" class="v5-learning-undo" data-v5-undo-learning="${escapeHTML(entry.id)}" aria-label="Annuler la correction du ${new Date(entry.confirmedAt).toLocaleDateString('fr-FR')}">Annuler</button></div>`).join('') || '<span>Aucune correction active.</span>'}</div></details></div>${action}</article>`;
    }).join('');
    const classicHTML = remaining.length ? remaining.map(suggestion => {
      const typeLabel = suggestion.matchType === 'income' ? 'revenus' : 'dépenses';
      return `<article><div><strong>${escapeHTML(suggestion.contains)}</strong><span>${escapeHTML(suggestion.category)} · ${typeLabel} uniquement · ${suggestion.confidence}% de cohérence (${suggestion.count}/${suggestion.sampleSize} opérations)</span></div><button type="button" class="btn btn-secondary btn-sm" data-v5-add-suggestion="${escapeHTML(suggestion.contains)}" data-category="${escapeHTML(suggestion.category)}" data-match-type="${escapeHTML(suggestion.matchType)}">Créer la règle</button></article>`;
    }).join('') : '';
    suggested.innerHTML = learnedHTML || classicHTML
      ? `${learnedHTML}${classicHTML}`
      : '<p class="v5-empty">Aucune nouvelle suggestion suffisamment cohérente pour le moment.</p>';
  }
  renderRuleUndo(account);
}

function renderSubscriptions(account, subscriptions) {
  const container = $('v5Subscriptions');
  const total = $('v5SubscriptionTotal');
  if (total) total.textContent = formatMoney(subscriptions.reduce((sum, item) => sum + item.yearlyCost, 0), account);
  if (!container) return;
  if (!subscriptions.length) {
    container.innerHTML = '<p class="v5-empty">Aucun abonnement repéré. Il faut au moins deux paiements pour en reconnaître un.</p>';
    return;
  }
  container.innerHTML = subscriptions.map(subscription => `<article class="v5-subscription"><span class="v5-subscription-icon"><i class="fa-solid fa-repeat"></i></span><div><strong>${escapeHTML(subscription.merchant)}</strong><span>${subscription.frequency === 'yearly' ? 'Chaque année' : subscription.frequency === 'weekly' ? 'Chaque semaine' : 'Chaque mois'} · ${subscription.source === 'recurring' ? 'Ajouté dans FREEV' : `${subscription.occurrences} paiements repérés · ${subscription.confidence}% de fiabilité`}</span></div><div class="v5-subscription-price"><strong>${escapeHTML(formatMoney(subscription.monthlyCost, account))}<small>/mois</small></strong><span>${escapeHTML(formatMoney(subscription.yearlyCost, account))}/an</span>${subscription.priceChange >= 5 ? `<b>+${subscription.priceChange}%</b>` : ''}</div><div class="v5-row-actions">${subscription.source === 'detected' ? `<button type="button" class="btn btn-secondary btn-sm" data-v5-convert-subscription="${escapeHTML(subscription.key)}">Ajouter aux paiements réguliers</button>` : ''}<button type="button" class="btn-icon" data-v5-ignore-subscription="${escapeHTML(subscription.key)}" aria-label="Ignorer"><i class="fa-solid fa-eye-slash"></i></button></div></article>`).join('');
}

function renderWealth(account) {
  const container = $('v5WealthAssets');
  const summary = $('v5WealthSummary');
  const worth = calculateNetWorth(account);
  if (summary) summary.innerHTML = `<article><span>Trésorerie</span><strong>${escapeHTML(formatMoney(worth.cash, account))}</strong></article><article><span>Épargne</span><strong>${escapeHTML(formatMoney(worth.savings, account))}</strong></article><article><span>Autres actifs</span><strong>${escapeHTML(formatMoney(worth.assets, account))}</strong></article><article class="danger"><span>Dettes</span><strong>−${escapeHTML(formatMoney(worth.liabilities, account))}</strong></article><article class="primary"><span>Patrimoine net</span><strong>${escapeHTML(formatMoney(worth.netWorth, account))}</strong></article>`;
  if (!container) return;
  container.innerHTML = account.wealthAssets.length ? account.wealthAssets.map(asset => {
    const history = assetHistory(asset);
    const latest = history.at(-1) || { value: asset.value, date: '' };
    const prior = history.at(-2);
    const change = prior ? Number(latest.value) - Number(prior.value) : null;
    const changeLabel = change === null ? 'Première estimation' : `${change > 0 ? '+' : change < 0 ? '−' : ''}${formatMoney(Math.abs(change), account)} depuis ${new Date(`${prior.date}T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`;
    const icon = asset.type === 'property' ? 'house' : asset.type === 'vehicle' ? 'car' : asset.type === 'investment' ? 'chart-line' : 'gem';
    const kind = { property: 'Immobilier', vehicle: 'Véhicule', investment: 'Investissement', other: 'Autre actif' }[asset.type] || 'Actif';
    const historyRows = history.slice().reverse().slice(0, 12).map(item => `<li><span>${escapeHTML(new Date(`${item.date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }))}</span><strong>${escapeHTML(formatMoney(item.value, account))}</strong></li>`).join('');
    return `<article class="v5-asset-card"><span class="v5-asset-icon"><i class="fa-solid fa-${icon}" aria-hidden="true"></i></span><div class="v5-asset-main"><strong>${escapeHTML(asset.name)}</strong><span>${escapeHTML(kind)} · ${latest.date ? `estimé le ${escapeHTML(new Date(`${latest.date}T12:00:00`).toLocaleDateString('fr-FR'))}` : 'estimation à préciser'}</span><small class="v5-asset-change${change > 0 ? ' is-positive' : change < 0 ? ' is-negative' : ''}">${escapeHTML(changeLabel)}</small>${assetSparkline(history, asset.name)}<details class="v5-asset-history"><summary>Historique (${history.length})</summary><ul>${historyRows}</ul></details></div><b class="v5-asset-value">${escapeHTML(formatMoney(latest.value, account))}</b><button type="button" class="btn btn-secondary btn-sm" data-v5-update-asset="${escapeHTML(asset.id)}">Actualiser</button><button type="button" class="btn-icon" data-v5-delete-asset="${escapeHTML(asset.id)}" aria-label="Supprimer ${escapeHTML(asset.name)}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button></article>`;
  }).join('') : '<p class="v5-empty">Ajoutez vos biens ou investissements pour calculer le patrimoine net.</p>';
}

function localCacheBytes() {
  return new Blob(Object.keys(localStorage).filter(key => key.startsWith('freev')).flatMap(key => [key, localStorage.getItem(key) || ''])).size;
}

function renderSecurity() {
  const trusted = window.isTrustedDeviceCacheEnabled?.() || false;
  const trustedInput = $('v5TrustedDevice');
  if (trustedInput) trustedInput.checked = trusted;
  const cache = $('v5CacheSize');
  if (cache) cache.textContent = `${(localCacheBytes() / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Ko`;
  const notification = $('v5NotificationStatus');
  if (notification) notification.textContent = !('Notification' in window) ? 'Non pris en charge' : Notification.permission === 'granted' ? 'Autorisées' : Notification.permission === 'denied' ? 'Refusées' : 'À activer';
  document.querySelectorAll('[data-v5-network]').forEach(network => {
    network.textContent = navigator.onLine ? 'En ligne' : 'Hors connexion';
    network.dataset.offline = navigator.onLine ? 'false' : 'true';
  });
  const sessions = $('v5Sessions');
  if (sessions) {
    let values = [];
    try { values = JSON.parse(localStorage.getItem('freevDeviceSessions') || '[]'); } catch (_) {}
    sessions.innerHTML = values.length ? values.map(session => `<article><i class="fa-solid fa-${session.label?.includes('Ordinateur') ? 'laptop' : 'mobile-screen'}"></i><div><strong>${escapeHTML(session.label || 'Appareil')}</strong><span>Vu le ${new Date(session.lastSeen).toLocaleString('fr-FR')}</span></div>${session.current ? '<b>Appareil actuel</b>' : ''}</article>`).join('') : '<p class="v5-empty">La liste locale des appareils apparaîtra après la prochaine connexion.</p>';
  }
}

function renderImportHistory(account = currentAccount()) {
  const container = $('v5ImportHistorySettings');
  if (!container) return;
  const history = Array.isArray(account?.importHistory) ? account.importHistory.filter(record => record?.accountId === account.id) : [];
  container.innerHTML = history.length ? history.slice(0, 10).map(record => {
    const date = Number.isFinite(Date.parse(record.createdAt)) ? new Date(record.createdAt).toLocaleString('fr-FR') : 'Date inconnue';
    const filename = String(record.filename || 'Relevé').slice(0, 120);
    const count = field => Number.isSafeInteger(Number(record[field])) && Number(record[field]) >= 0 ? Number(record[field]) : 0;
    const undo = record.undoneAt && Number.isFinite(Date.parse(record.undoneAt))
      ? ` · ${count('undoneCount')} opération(s) retirée(s) le ${new Date(record.undoneAt).toLocaleString('fr-FR')}`
      : '';
    return `<article class="v5-import-history-row"><div><strong>${escapeHTML(filename)}</strong><span>${escapeHTML(date)}</span></div><p>${count('importedCount')} importée(s) · ${count('duplicateCount')} doublon(s) certain(s) · ${count('skippedCount')} non sélectionnée(s) · ${count('errorCount')} ligne(s) ignorée(s)${escapeHTML(undo)}</p></article>`;
  }).join('') : '<p class="v5-empty">Aucun relevé CSV ou QIF n’a encore été importé dans ce compte.</p>';
}

function similarStatementMerchant(first, second) {
  const left = normalizeText(merchantKey(first));
  const right = normalizeText(merchantKey(second));
  if (left.length < 5 || right.length < 5 || left === 'operation' || right === 'operation' || left === right) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1));
    }
    previous = current;
  }
  const similarity = 1 - previous[right.length] / Math.max(left.length, right.length);
  return similarity >= 0.78;
}

function findPossibleStatementDuplicateIds(existing, incoming) {
  const groups = new Map();
  const add = (transaction, isIncoming) => {
    const key = [transaction.date, transaction.type, transaction.currency || '', Number(transaction.amountBase ?? transaction.amount).toFixed(2)].join('|');
    groups.set(key, [...(groups.get(key) || []), { transaction, isIncoming }]);
  };
  (existing || []).forEach(transaction => add(transaction, false));
  (incoming || []).forEach(transaction => add(transaction, true));
  const possible = new Set();
  groups.forEach(group => {
    const imported = group.filter(item => item.isIncoming);
    if (!imported.length) return;
    if (group.length > 200) {
      imported.forEach(item => possible.add(String(item.transaction.id)));
      return;
    }
    imported.forEach(item => {
      if (group.some(peer => peer.transaction.id !== item.transaction.id && similarStatementMerchant(item.transaction, peer.transaction))) {
        possible.add(String(item.transaction.id));
        group.filter(peer => peer.isIncoming && peer.transaction.id !== item.transaction.id && similarStatementMerchant(item.transaction, peer.transaction)).forEach(peer => possible.add(String(peer.transaction.id)));
      }
    });
  });
  return possible;
}

function statementImportPreviewStale(account = currentAccount()) {
  return !account || account.id !== pendingImport?.accountId ||
    ruleTransactionRevision(account) !== pendingImport?.revision ||
    JSON.stringify(account.automationRules || []) !== pendingImport?.rulesRevision;
}

function rebaseStatementImportPreview(account, notice) {
  if (!pendingImport || !account) return;
  const previousSelection = pendingImport.selectedIds || new Set();
  const allTransactions = pendingImport.allTransactions || pendingImport.accepted || [];
  const partition = partitionDuplicates(account.transactions || [], allTransactions);
  const possibleDuplicateIds = findPossibleStatementDuplicateIds(account.transactions || [], partition.accepted);
  pendingImport = {
    ...pendingImport,
    ...partition,
    accountId: account.id,
    revision: ruleTransactionRevision(account),
    rulesRevision: JSON.stringify(account.automationRules || []),
    possibleDuplicateIds,
    page: 0,
    selectedIds: new Set(partition.accepted.filter(transaction => previousSelection.has(String(transaction.id)) && !possibleDuplicateIds.has(String(transaction.id))).map(transaction => String(transaction.id))),
    conflictNotice: notice
  };
}

function renderImportPreview() {
  const container = $('v5ImportPreview');
  if (!container) return;
  if (!pendingImport) {
    container.innerHTML = '<p class="v5-empty">Choisissez un relevé CSV ou QIF. L’import ajoute les nouvelles opérations sans remplacer vos comptes.</p>';
    return;
  }
  const activeAccount = currentAccount();
  if (statementImportPreviewStale(activeAccount)) rebaseStatementImportPreview(activeAccount, 'Le compte, les opérations ou les règles ont changé depuis l’aperçu. Vérifiez les lignes mises à jour avant de confirmer.');
  const { accepted = [], duplicates = [], errors = [] } = pendingImport;
  const pageSize = 100;
  const pageCount = Math.max(1, Math.ceil(accepted.length / pageSize));
  pendingImport.page = Math.max(0, Math.min(pendingImport.page || 0, pageCount - 1));
  if (!(pendingImport.selectedIds instanceof Set)) pendingImport.selectedIds = new Set(accepted.filter(transaction => !pendingImport.possibleDuplicateIds?.has(String(transaction.id))).map(transaction => String(transaction.id)));
  const start = pendingImport.page * pageSize;
  const pageItems = accepted.slice(start, start + pageSize);
  const account = currentAccount();
  const rules = account?.automationRules || [];
  const rows = pageItems.map(transaction => {
    const id = String(transaction.id);
    const after = applyAutomationRules([transaction], rules).transactions[0];
    const possible = pendingImport.possibleDuplicateIds?.has(id);
    const beforeLabel = `${transaction.type === 'income' ? 'Revenu' : 'Dépense'} · ${transaction.category || 'Sans catégorie'}`;
    const afterLabel = `${after.type === 'income' ? 'Revenu' : 'Dépense'} · ${after.category || 'Sans catégorie'}`;
    return `<label class="v5-import-preview-row${possible ? ' is-possible-duplicate' : ''}"><input type="checkbox" data-v5-import-candidate="${escapeHTML(id)}" ${pendingImport.selectedIds.has(id) ? 'checked' : ''}><span><strong>${escapeHTML(transaction.date)} · ${escapeHTML(transaction.desc)}</strong><small>${escapeHTML(formatMoney(transaction.amount))} · ${escapeHTML(beforeLabel)} → ${escapeHTML(afterLabel)}</small>${possible ? '<em>Libellé proche d’une opération du même jour et du même montant. Vérifiez avant d’importer.</em>' : ''}</span></label>`;
  }).join('');
  const pageIds = pageItems.map(transaction => String(transaction.id));
  const selectedOnPage = pageIds.filter(id => pendingImport.selectedIds.has(id)).length;
  const importCapacity = Math.max(0, 4000 - (account?.transactions?.length || 0));
  const errorsMarkup = errors.length ? `<details class="v5-import-details"><summary>Voir ${errors.length} ligne(s) ignorée(s)</summary><ul>${errors.slice(0, 10).map(error => `<li>${escapeHTML(typeof error === 'string' ? error : JSON.stringify(error))}</li>`).join('')}</ul>${errors.length > 10 ? `<p>Et ${errors.length - 10} autre(s) erreur(s).</p>` : ''}</details>` : '';
  const duplicatesMarkup = duplicates.length ? `<details class="v5-import-details"><summary>Voir ${duplicates.length} doublon(s) écarté(s)</summary><ul>${duplicates.slice(0, 10).map(transaction => `<li>${escapeHTML(transaction.date)} · ${escapeHTML(transaction.desc || 'Opération')} · ${escapeHTML(formatMoney(transaction.amount))}</li>`).join('')}</ul>${duplicates.length > 10 ? `<p>Et ${duplicates.length - 10} autre(s) doublon(s).</p>` : ''}</details>` : '';
  const pagination = pageCount > 1 ? `<div class="v5-import-pagination"><button type="button" class="btn btn-secondary btn-sm" data-v5-import-page="previous" ${pendingImport.page === 0 ? 'disabled' : ''}>← Précédente</button><span>Page ${pendingImport.page + 1} sur ${pageCount} · ${accepted.length} lignes</span><button type="button" class="btn btn-secondary btn-sm" data-v5-import-page="next" ${pendingImport.page >= pageCount - 1 ? 'disabled' : ''}>Suivante →</button></div>` : '';
  container.innerHTML = `${pendingImport.conflictNotice ? `<p class="v5-preview-conflict" role="alert">${escapeHTML(pendingImport.conflictNotice)}</p>` : ''}<p class="v5-import-target">Fichier : <strong>${escapeHTML(pendingImport.filename || 'Relevé')}</strong> · Compte cible : <strong>${escapeHTML(account?.name || 'Compte actif')}</strong> · Capacité de l’import : ${importCapacity} opération(s)</p><div class="v5-import-stats"><span><strong>${accepted.length}</strong> nouvelles</span><span><strong>${duplicates.length}</strong> doublons certains écartés</span><span><strong>${errors.length}</strong> lignes ignorées</span><span><strong>${pendingImport.possibleDuplicateIds?.size || 0}</strong> doublons possibles à vérifier</span></div>${errorsMarkup}${duplicatesMarkup}${accepted.length ? `<label class="v5-import-select-all"><input id="v5SelectAllImport" type="checkbox" ${pageIds.length && selectedOnPage === pageIds.length ? 'checked' : ''} ${selectedOnPage > 0 && selectedOnPage < pageIds.length ? 'aria-checked="mixed"' : ''}><span>Sélectionner toute cette page</span><strong id="v5ImportSelectionCount">${pendingImport.selectedIds.size} sélectionnée(s)</strong></label><div class="v5-import-preview-rows">${rows}</div>${pagination}<button type="button" id="v5ConfirmImport" class="btn btn-primary" ${pendingImport.selectedIds.size && pendingImport.selectedIds.size <= importCapacity ? '' : 'disabled'}><i class="fa-solid fa-file-import"></i> ${pendingImport.selectedIds.size > importCapacity ? `Réduisez la sélection à ${importCapacity}` : `Importer la sélection (${pendingImport.selectedIds.size})`}</button>` : '<p class="v5-empty">Aucune nouvelle opération à importer.</p>'}`;
  syncStatementImportSelection();
}

function syncStatementImportSelection() {
  if (!pendingImport?.selectedIds) return;
  const visible = [...document.querySelectorAll('[data-v5-import-candidate]')];
  visible.forEach(input => {
    const id = input.dataset.v5ImportCandidate;
    if (input.checked) pendingImport.selectedIds.add(id);
    else pendingImport.selectedIds.delete(id);
  });
  const pageIds = (pendingImport.accepted || []).slice(pendingImport.page * 100, (pendingImport.page + 1) * 100).map(transaction => String(transaction.id));
  const selectedOnPage = pageIds.filter(id => pendingImport.selectedIds.has(id)).length;
  const selectAll = $('v5SelectAllImport');
  if (selectAll) {
    selectAll.checked = pageIds.length > 0 && selectedOnPage === pageIds.length;
    selectAll.indeterminate = selectedOnPage > 0 && selectedOnPage < pageIds.length;
    if (selectAll.indeterminate) selectAll.setAttribute('aria-checked', 'mixed');
    else selectAll.removeAttribute('aria-checked');
  }
  const count = pendingImport.selectedIds.size;
  if ($('v5ImportSelectionCount')) $('v5ImportSelectionCount').textContent = `${count} sélectionnée(s)`;
  const confirm = $('v5ConfirmImport');
  if (confirm) {
    const capacity = Math.max(0, 4000 - (currentAccount()?.transactions?.length || 0));
    confirm.disabled = count === 0 || count > capacity;
    confirm.innerHTML = count > capacity
      ? `<i class="fa-solid fa-triangle-exclamation"></i> Réduisez la sélection à ${capacity}`
      : `<i class="fa-solid fa-file-import"></i> Importer la sélection (${count})`;
  }
}

export function render() {
  const account = currentAccount();
  if (!account) return;
  accountCollections(account);
  renderRuleUndo(account);
  renderImportHistory(account);
  const subscriptions = getSubscriptions(account);
  const suggestions = suggestAutomationRules(account.transactions);
  renderSummary(account, subscriptions, suggestions);
  if (activeTab === 'overview') renderOverview(account, subscriptions, suggestions);
  if (activeTab === 'monthcheck') window.FreevMonthCheck?.render();
  if (activeTab === 'rules') renderRules(account, suggestions);
  if (activeTab === 'subscriptions') renderSubscriptions(account, subscriptions);
  if (activeTab === 'wealth') renderWealth(account);
  if (activeTab === 'security') renderSecurity();
  if (activeTab === 'imports') renderImportPreview();
  syncActiveTab();
}

function syncActiveTab() {
  document.querySelectorAll('[data-v5-tab]').forEach(button => {
    const active = button.dataset.v5Tab === activeTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('[data-v5-panel]').forEach(panel => panel.hidden = panel.dataset.v5Panel !== activeTab);
  const tabs = document.querySelector('.v5-tabs');
  const selected = tabs?.querySelector('[aria-selected="true"]');
  if (tabs && selected && tabs.clientWidth > 0 && tabs.scrollWidth > tabs.clientWidth) {
    const left = selected.getBoundingClientRect().left - tabs.getBoundingClientRect().left + tabs.scrollLeft;
    tabs.scrollTo?.({ left: left - (tabs.clientWidth - selected.clientWidth) / 2, behavior: 'instant' });
  }
}

function setActiveTab(tab) {
  activeTab = ['overview', 'monthcheck', 'rules', 'subscriptions', 'imports', 'wealth', 'security'].includes(tab) ? tab : 'overview';
  render();
}

function ruleTransactionRevision(account) {
  // L'ordre source peut modifier la première occurrence retenue par le cockpit.
  // Le tableau JSON garde tous les champs et évite les chaînes intermédiaires + le tri O(n log n).
  const transactions = Array.isArray(account?.transactions) ? account.transactions : [];
  const source = JSON.stringify(transactions);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${transactions.length}:${first.toString(16)}:${second.toString(16)}`;
}

window.freevTransactionRevision = ruleTransactionRevision;

function ruleMatch(transaction, rule) {
  if (!transaction || transaction.type === 'transfer' ||
      (rule?.matchType && (!['income', 'expense'].includes(rule.matchType) || transaction.type !== rule.matchType))) return false;
  const needle = normalizeText(rule.contains);
  if (!needle) return false;
  const haystack = normalizeText([transaction.desc, transaction.merchant, transaction.category].join(' '));
  return haystack.includes(needle);
}

function ruleState(transaction) {
  return {
    categoryPresent: Object.prototype.hasOwnProperty.call(transaction, 'category'),
    category: transaction.category ?? '',
    type: transaction.type,
    rulePresent: Object.prototype.hasOwnProperty.call(transaction, 'automationRuleId'),
    ruleId: transaction.automationRuleId ?? ''
  };
}

function sameRuleState(transaction, state) {
  const current = ruleState(transaction);
  return current.categoryPresent === state.categoryPresent && current.category === state.category &&
    current.type === state.type && current.rulePresent === state.rulePresent && current.ruleId === state.ruleId;
}

function setRuleState(transaction, state) {
  const next = { ...transaction, type: state.type };
  if (state.categoryPresent) next.category = state.category;
  else delete next.category;
  if (state.rulePresent) next.automationRuleId = state.ruleId;
  else delete next.automationRuleId;
  return next;
}

function findRulePreview(account, rule) {
  const transactions = Array.isArray(account?.transactions) ? account.transactions : [];
  const needle = normalizeText(rule.contains);
  const textMatches = transaction => normalizeText([transaction?.desc, transaction?.merchant, transaction?.category].join(' ')).includes(needle);
  const transfers = transactions.filter(transaction => transaction?.type === 'transfer' && needle && textMatches(transaction)).length;
  const idCounts = new Map();
  transactions.forEach(transaction => {
    const id = String(transaction?.id || '');
    if (id) idCounts.set(id, (idCounts.get(id) || 0) + 1);
  });
  const errors = [];
  const matches = [];
  transactions.forEach(transaction => {
    if (!ruleMatch(transaction, rule)) return;
    const id = String(transaction?.id || '');
    const date = String(transaction.date || '');
    const parsedDate = new Date(`${date}T12:00:00Z`);
    if (!id || idCounts.get(id) !== 1 || !['income', 'expense'].includes(transaction.type) || !Number.isFinite(Number(transaction.amountBase ?? transaction.amount)) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      errors.push(transaction);
      return;
    }
    const next = applyAutomationRules([transaction], [rule]).transactions[0];
    if (next.category === transaction.category && next.type === transaction.type) return;
    matches.push({ transaction, next, sourceState: ruleState(transaction), sourceRevision: ruleTransactionRevision({ transactions: [transaction] }) });
  });
  matches.sort((a, b) => String(a.transaction.date).localeCompare(String(b.transaction.date)) || String(a.transaction.id).localeCompare(String(b.transaction.id), 'fr'));
  const duplicateKeys = new Map();
  matches.forEach(item => {
    const transaction = item.transaction;
    const merchant = normalizeText([transaction.merchant, transaction.desc].filter(Boolean).join(' '));
    const amount = String(transaction.amountBase ?? transaction.amount ?? '');
    const key = `${transaction.date}|${transaction.type}|${transaction.currency || ''}|${amount}|${merchant}`;
    if (!merchant) return;
    duplicateKeys.set(key, [...(duplicateKeys.get(key) || []), String(transaction.id)]);
  });
  const possibleDuplicateIds = new Set([...duplicateKeys.values()].filter(ids => ids.length > 1).flat());
  return { matches, transfers, errors: errors.length, possibleDuplicateIds };
}

function renderRulePreview() {
  const overlay = $('v5RulePreview');
  const summary = $('v5RulePreviewSummary');
  const rows = $('v5RulePreviewRows');
  const pagination = $('v5RulePreviewPagination');
  const selectionCount = $('v5RulePreviewSelectionCount');
  const confirm = $('v5ConfirmRulePreview');
  if (!overlay || !pendingRulePreview) return;
  const { preview, rule, conflictNotice = '' } = pendingRulePreview;
  if (summary) {
    const duplicateCount = preview.possibleDuplicateIds.size;
    summary.innerHTML = `${conflictNotice ? `<p class="v5-preview-conflict" role="alert">${escapeHTML(conflictNotice)}</p>` : ''}<p><strong>${preview.matches.length}</strong> opération(s) concernée(s) par « ${escapeHTML(rule.contains)} ».</p><p>${preview.transfers} transfert(s) correspondant(s) au mot-clé exclus, ${preview.errors} ligne(s) invalide(s) ignorée(s), ${duplicateCount} opération(s) dans des groupes qui ressemblent à des doublons. Ces doublons possibles sont conservés et décochés par défaut.</p><p>Une confirmation peut reclasser jusqu’à 4 000 opérations, avec retour arrière conservé.</p>`;
  }
  const pageSize = 100;
  const pageCount = Math.max(1, Math.ceil(preview.matches.length / pageSize));
  pendingRulePreview.page = Math.max(0, Math.min(pendingRulePreview.page || 0, pageCount - 1));
  if (!(pendingRulePreview.selectedIds instanceof Set)) {
    pendingRulePreview.selectedIds = new Set(preview.matches.filter(item => !preview.possibleDuplicateIds.has(String(item.transaction.id))).map(item => String(item.transaction.id)));
  } else {
    const knownIds = new Set(preview.matches.map(item => String(item.transaction.id)));
    pendingRulePreview.selectedIds = new Set([...pendingRulePreview.selectedIds].filter(id => knownIds.has(id)));
  }
  const start = pendingRulePreview.page * pageSize;
  const pageMatches = preview.matches.slice(start, start + pageSize);
  if (rows) rows.innerHTML = pageMatches.length ? pageMatches.map(({ transaction, next }) => {
    const id = String(transaction.id);
    const duplicate = preview.possibleDuplicateIds.has(id);
    const amount = formatMoney(transaction.amountBase ?? transaction.amount, currentAccount());
    const beforeType = transaction.type === 'income' ? 'Revenu' : 'Dépense';
    const afterType = next.type === 'income' ? 'Revenu' : 'Dépense';
    return `<label class="v5-rule-preview-row${duplicate ? ' is-possible-duplicate' : ''}"><input type="checkbox" data-v5-rule-candidate="${escapeHTML(id)}" ${pendingRulePreview.selectedIds.has(id) ? 'checked' : ''}><span class="v5-rule-preview-main"><strong>${escapeHTML(transaction.date)} · ${escapeHTML(transaction.desc || transaction.merchant || 'Opération sans libellé')}</strong><small>${escapeHTML(amount)} · ${escapeHTML(beforeType)} « ${escapeHTML(transaction.category || 'Sans catégorie')} » → ${escapeHTML(afterType)} « ${escapeHTML(next.category || 'Sans catégorie')} »</small>${duplicate ? '<em>Semblable à une autre opération ; vérifier avant de sélectionner.</em>' : ''}</span></label>`;
  }).join('') : '<p class="v5-empty">Aucune opération valide ne correspond. Vous pouvez confirmer pour enregistrer la règle seule.</p>';
  if (pagination) pagination.innerHTML = pageCount > 1
    ? `<button type="button" class="btn btn-secondary btn-sm" data-v5-rule-page="previous" ${pendingRulePreview.page === 0 ? 'disabled' : ''}>← Précédente</button><span>Page ${pendingRulePreview.page + 1} sur ${pageCount} · ${preview.matches.length} opérations affichées par pages de 100</span><button type="button" class="btn btn-secondary btn-sm" data-v5-rule-page="next" ${pendingRulePreview.page >= pageCount - 1 ? 'disabled' : ''}>Suivante →</button>`
    : '';
  const selectAll = $('v5RulePreviewSelectAll');
  const pageIds = pageMatches.map(item => String(item.transaction.id));
  const selectedOnPage = pageIds.filter(id => pendingRulePreview.selectedIds.has(id)).length;
  if (selectAll) {
    selectAll.checked = pageIds.length > 0 && selectedOnPage === pageIds.length;
    selectAll.indeterminate = selectedOnPage > 0 && selectedOnPage < pageIds.length;
  }
  if (selectionCount) selectionCount.textContent = `${pendingRulePreview.selectedIds.size} sélectionnée(s)`;
  if (confirm) {
    confirm.disabled = pendingRulePreview.selectedIds.size > 4000;
    confirm.innerHTML = pendingRulePreview.selectedIds.size > 4000
      ? '<i class="fa-solid fa-triangle-exclamation"></i> Réduisez la sélection à 4 000 maximum'
      : preview.matches.length
      ? '<i class="fa-solid fa-check"></i> Créer la règle et appliquer la sélection'
      : '<i class="fa-solid fa-check"></i> Enregistrer la règle';
  }
  overlay.hidden = false;
  document.body.classList.add('v4-modal-open');
  requestAnimationFrame(() => (rows?.querySelector('input:not(:disabled)') || $('v5CancelRulePreview'))?.focus());
}

function closeRulePreview() {
  if ($('v5RulePreview')) $('v5RulePreview').hidden = true;
  document.body.classList.remove('v4-modal-open');
  const returnFocus = pendingRulePreview?.returnFocus;
  pendingRulePreview = null;
  returnFocus?.focus?.();
}

function syncRulePreviewSelection() {
  if (!pendingRulePreview) return;
  const visible = [...document.querySelectorAll('[data-v5-rule-candidate]')];
  visible.forEach(input => {
    const id = input.dataset.v5RuleCandidate;
    if (input.checked) pendingRulePreview.selectedIds.add(id);
    else pendingRulePreview.selectedIds.delete(id);
  });
  const pageIds = pendingRulePreview.preview.matches.slice(pendingRulePreview.page * 100, (pendingRulePreview.page + 1) * 100).map(item => String(item.transaction.id));
  const selectedOnPage = pageIds.filter(id => pendingRulePreview.selectedIds.has(id)).length;
  const selectAll = $('v5RulePreviewSelectAll');
  if (selectAll) {
    selectAll.checked = pageIds.length > 0 && selectedOnPage === pageIds.length;
    selectAll.indeterminate = selectedOnPage > 0 && selectedOnPage < pageIds.length;
  }
  if ($('v5RulePreviewSelectionCount')) $('v5RulePreviewSelectionCount').textContent = `${pendingRulePreview.selectedIds.size} sélectionnée(s)`;
}

function buildRule(contains, category, type = '', matchType = '') {
  const cleanContains = String(contains || '').trim().slice(0, 80);
  const cleanCategory = String(category || '').trim().slice(0, 60);
  if (cleanContains.length < 2 || !cleanCategory) return notify('Mot-clé et catégorie requis', 'error');
  const account = currentAccount();
  const duplicate = account?.automationRules?.some(rule =>
    String(rule.contains || '').trim().toLocaleLowerCase('fr') === cleanContains.toLocaleLowerCase('fr') &&
    String(rule.category || '').trim().toLocaleLowerCase('fr') === cleanCategory.toLocaleLowerCase('fr') &&
    String(rule.type || '') === String(type || '') &&
    String(rule.matchType || '') === String(matchType || '')
  );
  if (duplicate) {
    notify('Cette règle existe déjà', 'info');
    return false;
  }
  if (matchType && !['income', 'expense'].includes(matchType)) return notify('Type de correspondance invalide', 'error');
  return { id: crypto.randomUUID?.() || `rule-${Date.now()}`, contains: cleanContains, category: cleanCategory, type, ...(matchType ? { matchType } : {}), enabled: true, createdAt: new Date().toISOString() };
}

function addRule(contains, category, type = '', applyNow = false, matchType = '') {
  const rule = buildRule(contains, category, type, matchType);
  if (!rule) return false;
  if (applyNow) {
    const account = currentAccount();
    pendingRulePreview = { accountId: account?.id, rule, revision: ruleTransactionRevision(account), preview: findRulePreview(account, rule), page: 0, returnFocus: document.activeElement };
    renderRulePreview();
    return true;
  }
  mutate(account => {
    accountCollections(account);
    account.automationRules.push(rule);
  });
  notify('Règle créée');
  return true;
}

function commitRulePreview() {
  if (!pendingRulePreview) return;
  const state = appState();
  const account = currentAccount(state);
  if (!account || account.id !== pendingRulePreview.accountId) {
    closeRulePreview();
    notify('Le compte actif a changé. Aucun reclassement n’a été effectué.', 'error');
    return;
  }
  const revision = ruleTransactionRevision(account);
  if (revision !== pendingRulePreview.revision) {
    pendingRulePreview.revision = revision;
    pendingRulePreview.preview = findRulePreview(account, pendingRulePreview.rule);
    pendingRulePreview.conflictNotice = 'Les données ont changé depuis l’aperçu. Vérifiez la liste mise à jour avant de confirmer.';
    pendingRulePreview.page = 0;
    pendingRulePreview.selectedIds = new Set(pendingRulePreview.preview.matches.filter(item => !pendingRulePreview.preview.possibleDuplicateIds.has(String(item.transaction.id))).map(item => String(item.transaction.id)));
    renderRulePreview();
    return;
  }
  const selectedIds = pendingRulePreview.selectedIds || new Set();
  if (selectedIds.size > 4000) return notify('Sélectionnez au maximum 4 000 opérations pour conserver un retour arrière cohérent.', 'error');
  const selected = pendingRulePreview.preview.matches.filter(item => selectedIds.has(String(item.transaction.id)));
  const rule = pendingRulePreview.rule;
  const accountId = account.id;
  let applied = 0;
  let duplicateAtCommit = false;
  closeRulePreview();
  mutate(target => {
    if (target.id !== accountId) return;
    accountCollections(target);
    const existing = target.automationRules.some(candidate => candidate.id === rule.id || (
      normalizeText(candidate.contains) === normalizeText(rule.contains) && normalizeText(candidate.category) === normalizeText(rule.category) && candidate.type === rule.type && String(candidate.matchType || '') === String(rule.matchType || '')
    ));
    if (existing) { duplicateAtCommit = true; return; }
    target.automationRules.push(rule);
    const selectedById = new Map(selected.map(item => [String(item.transaction.id), item]));
    const changes = [];
    target.transactions = target.transactions.map(transaction => {
      const candidate = selectedById.get(String(transaction.id));
      if (!candidate || candidate.sourceRevision !== ruleTransactionRevision({ transactions: [transaction] })) return transaction;
      const before = ruleState(transaction);
      const updated = applyAutomationRules([transaction], [rule]).transactions[0];
      const after = ruleState(updated);
      if (before.category === after.category && before.type === after.type) return transaction;
      changes.push({ transactionId: String(transaction.id), before, after });
      applied += 1;
      return updated;
    });
    if (changes.length) {
      target.bulkUndo = {
        action: 'automation-rule-reclassification', ownerUid: String(window.__freevUserId || 'device'), accountId,
        ruleId: rule.id, createdAt: new Date().toISOString(), changes
      };
      target.bulkUndo.revision = ruleTransactionRevision(target);
    }
  });
  if (duplicateAtCommit) return notify('Cette règle a déjà été créée. Aucun changement supplémentaire n’a été effectué.', 'info');
  $('v5RuleForm')?.reset();
  notify(`Règle créée et ${applied} opération(s) reclassée(s).${applied ? ' Le reclassement peut être annulé depuis cette page.' : ''}`);
}

function canUndoRuleBulkAction(account) {
  const record = account?.bulkUndo;
  if (!record || !['automation-rule-reclassification', 'manual-bulk-category-reclassification', 'statement-import', 'monthly-transaction-duplication'].includes(record.action) || record.accountId !== account.id || record.ownerUid !== String(window.__freevUserId || 'device')) return false;
  const createdAt = Date.parse(record.createdAt);
  if (!Number.isFinite(createdAt) || Date.now() - createdAt < 0 || Date.now() - createdAt > BULK_UNDO_WINDOW_MS) return false;
  if (!Array.isArray(record.changes) || !record.changes.length || record.changes.length > 4000) return false;
  if (ruleTransactionRevision(account) !== record.revision) return false;
  const currentById = new Map((account.transactions || []).map(transaction => [String(transaction.id), transaction]));
  if (record.action === 'monthly-transaction-duplication') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(record.sourceMonth || '') || !/^\d{4}-(0[1-9]|1[0-2])$/.test(record.targetMonth || '') || record.sourceMonth === record.targetMonth) return false;
    const idCounts = new Map();
    (account.transactions || []).forEach(transaction => idCounts.set(String(transaction.id), (idCounts.get(String(transaction.id)) || 0) + 1));
    return record.changes.every(change => {
      const transaction = currentById.get(change.transactionId);
      return Boolean(transaction && idCounts.get(change.transactionId) === 1 && String(transaction.date || '').startsWith(record.targetMonth) &&
        String(transaction.desc || '').endsWith(' (mois dupliqué)') && transaction.source === 'manual' &&
        !transaction.isRecurring && !transaction.parentId && ['income', 'expense'].includes(transaction.type) &&
        !transaction.linkedTransferId && !transaction.linkedAccountId && !transaction.linkedDebtId && !transaction.fromSavings && !transaction.toSavings);
    });
  }
  if (record.action === 'statement-import') {
    const importRecord = (account.importHistory || []).find(item => item.id === record.importId && item.accountId === account.id);
    return Boolean(importRecord && !importRecord.undoneAt && importRecord.filename === record.filename && importRecord.importedCount === record.changes.length && record.changes.every(change => currentById.has(change.transactionId)));
  }
  return record.changes.every(change => currentById.has(change.transactionId) && sameRuleState(currentById.get(change.transactionId), change.after));
}

function renderRuleUndo(account) {
  const section = $('v5RuleUndo');
  const button = $('v5UndoRuleBulk');
  const importSection = $('v5ImportUndo');
  const importButton = $('v5UndoImportBulk');
  const importDetail = $('v5ImportUndoStatus');
  const detail = $('v5RuleUndoStatus');
  if (!section || !button || !detail) return;
  const record = account?.bulkUndo;
  const belongs = ['automation-rule-reclassification', 'manual-bulk-category-reclassification', 'statement-import', 'monthly-transaction-duplication'].includes(record?.action) && record.accountId === account?.id && record.ownerUid === String(window.__freevUserId || 'device');
  const available = belongs && canUndoRuleBulkAction(account);
  section.hidden = !belongs;
  const isImport = record?.action === 'statement-import';
  const isMonthDuplication = record?.action === 'monthly-transaction-duplication';
  if (importSection) importSection.hidden = !belongs || !isImport;
  if (importButton) importButton.disabled = belongs && !available;
  if (!belongs) return;
  button.disabled = !available;
  const title = $('v5RuleUndoTitle');
  const label = $('v5UndoBulkLabel');
  if (title) title.textContent = isImport ? 'Dernier import CSV/QIF' : isMonthDuplication ? 'Dernière duplication mensuelle' : 'Dernier reclassement en masse';
  if (label) label.textContent = isImport ? 'Annuler l’import' : isMonthDuplication ? 'Annuler la duplication' : record.action === 'manual-bulk-category-reclassification' ? 'Annuler le reclassement manuel' : 'Annuler le reclassement';
  const age = Date.now() - Date.parse(record.createdAt);
  detail.textContent = available
    ? `${record.changes.length} opération(s)${isImport ? ` du relevé « ${String(record.filename || 'Relevé').slice(0, 120)} »` : isMonthDuplication ? ` · ${record.sourceMonth} vers ${record.targetMonth}` : ` · ${record.action === 'automation-rule-reclassification' ? 'règle conservée' : 'catégorie restaurable'}`} · annulation disponible jusqu’à ${new Date(Date.parse(record.createdAt) + BULK_UNDO_WINDOW_MS).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`
    : age > BULK_UNDO_WINDOW_MS
      ? 'La fenêtre d’annulation de 30 minutes est terminée.'
      : 'Le compte ou des données liées ont changé. Cette action ne peut plus être annulée sans écraser une modification ultérieure.';
  if (importDetail) importDetail.textContent = detail.textContent;
  if (operationsButton) operationsButton.title = detail.textContent;
  if (importButton) importButton.title = detail.textContent;
}

function undoRuleBulkAction() {
  const account = currentAccount();
  if (!canUndoRuleBulkAction(account)) {
    renderRuleUndo(account);
    return notify('Cette action ne peut plus être annulée sans écraser des changements.', 'error');
  }
  const record = account.bulkUndo;
  let undone = false;
  mutate(target => {
    if (!canUndoRuleBulkAction(target)) return;
    if (record.action === 'statement-import') {
      const importedIds = new Set(record.changes.map(change => change.transactionId));
      target.transactions = target.transactions.filter(transaction => !importedIds.has(String(transaction.id)));
      const historyEntry = (target.importHistory || []).find(item => item.id === record.importId && item.accountId === target.id);
      if (historyEntry) {
        historyEntry.undoneAt = new Date().toISOString();
        historyEntry.undoneCount = importedIds.size;
      }
    } else if (record.action === 'monthly-transaction-duplication') {
      const duplicatedIds = new Set(record.changes.map(change => change.transactionId));
      target.transactions = (target.transactions || []).filter(transaction => !duplicatedIds.has(String(transaction.id)));
      const timestamp = new Date().toISOString();
      target.historyLog = [{ ts: timestamp, action: 'undo_duplicate_month', entity: 'transaction', before: `${record.changes.length} opération(s) · ${record.sourceMonth} → ${record.targetMonth}`, after: 'Duplication annulée' }, ...(target.historyLog || [])].slice(0, 500);
    } else {
      const priorById = new Map(record.changes.map(change => [change.transactionId, change.before]));
      target.transactions = target.transactions.map(transaction => {
        const prior = priorById.get(String(transaction.id));
        return prior ? setRuleState(transaction, prior) : transaction;
      });
    }
    target.bulkUndo = null;
    undone = true;
  });
  window.syncAllUI?.();
  const message = !undone
    ? 'Annulation refusée : les données ont changé ou la fenêtre de 30 minutes est terminée.'
    : record.action === 'statement-import'
      ? `${record.changes.length} opération(s) importée(s) retirée(s).`
      : record.action === 'monthly-transaction-duplication'
        ? `${record.changes.length} opération(s) dupliquée(s) retirée(s).`
      : `${record.changes.length} reclassement(s) annulé(s).`;
  notify(message, undone ? 'success' : 'error');
}

function handleRuleSubmit(event) {
  event.preventDefault();
  const applyNow = $('v5RuleApplyNow')?.checked;
  if (addRule($('v5RuleContains')?.value, $('v5RuleCategory')?.value, $('v5RuleType')?.value, applyNow) && !applyNow) event.currentTarget.reset();
}

async function loadStatement(input) {
  const file = input?.files?.[0];
  if (!file) return;
  if (!/\.(csv|qif)$/i.test(file.name)) {
    notify('Format non pris en charge : choisissez un fichier CSV ou QIF', 'error');
    input.value = '';
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    notify('Le relevé dépasse la limite de 5 Mo', 'error');
    input.value = '';
    return;
  }
  try {
    const text = await file.text();
    const parsed = file.name.toLocaleLowerCase('fr').endsWith('.qif') ? parseQIFStatement(text) : parseCSVStatement(text);
    const account = currentAccount();
    const currency = account?.settings?.baseCurrency || 'EUR';
    const imported = parsed.transactions.map(transaction => ({ ...transaction, currency }));
    const partition = partitionDuplicates(account?.transactions || [], imported);
    const possibleDuplicateIds = findPossibleStatementDuplicateIds(account?.transactions || [], partition.accepted);
    pendingImport = {
      ...partition,
      errors: parsed.errors,
      filename: file.name,
      allTransactions: imported,
      accountId: account?.id,
      revision: ruleTransactionRevision(account),
      rulesRevision: JSON.stringify(account?.automationRules || []),
      possibleDuplicateIds,
      page: 0,
      selectedIds: new Set(partition.accepted.filter(transaction => !possibleDuplicateIds.has(String(transaction.id))).map(transaction => String(transaction.id)))
    };
    renderImportPreview();
  } catch (_) {
    pendingImport = null;
    notify('Impossible de lire ce relevé. Vérifiez son encodage et son format.', 'error');
    renderImportPreview();
  } finally {
    input.value = '';
  }
}

function confirmImport() {
  if (!pendingImport?.accepted?.length || !pendingImport.selectedIds?.size) return;
  const account = currentAccount();
  if (statementImportPreviewStale(account)) {
    rebaseStatementImportPreview(account, 'Le compte, les opérations ou les règles ont changé depuis l’aperçu. Vérifiez les lignes mises à jour avant de confirmer.');
    renderImportPreview();
    return notify('Les données ont changé. L’aperçu a été actualisé ; confirmez à nouveau.', 'info');
  }
  const selected = pendingImport.accepted.filter(transaction => pendingImport.selectedIds.has(String(transaction.id)));
  if (!selected.length) return;
  const count = selected.length;
  const importCapacity = Math.max(0, 4000 - (account.transactions?.length || 0));
  if (count > importCapacity) return notify(`Sélectionnez au maximum ${importCapacity} opération(s) pour rester dans la limite par compte.`, 'error');
  const accountId = account.id;
  const importRecord = {
    id: crypto.randomUUID?.() || `import-${Date.now()}`,
    accountId,
    createdAt: new Date().toISOString(),
    filename: String(pendingImport.filename || 'Relevé').split(/[\\/]/).pop().slice(0, 120),
    importedCount: count,
    duplicateCount: pendingImport.duplicates.length,
    skippedCount: Math.max(0, pendingImport.accepted.length - count),
    errorCount: pendingImport.errors.length
  };
  const expectedRevision = pendingImport.revision;
  pendingImport = null;
  let importedCount = 0;
  mutate(account => {
    if (account.id !== accountId || ruleTransactionRevision(account) !== expectedRevision) return;
    accountCollections(account);
    const classified = applyAutomationRules(selected, account.automationRules || []);
    if (classified.transactions.length !== count) return;
    account.transactions = [...account.transactions, ...classified.transactions];
    account.importHistory = [importRecord, ...account.importHistory].slice(0, 100);
    account.bulkUndo = {
      action: 'statement-import', ownerUid: String(window.__freevUserId || 'device'), accountId,
      importId: importRecord.id, filename: importRecord.filename, createdAt: importRecord.createdAt,
      changes: classified.transactions.map(transaction => ({ transactionId: String(transaction.id) }))
    };
    account.bulkUndo.revision = ruleTransactionRevision(account);
    importedCount = classified.transactions.length;
  });
  renderImportPreview();
  notify(importedCount === count
    ? `${count} opération(s) sélectionnée(s) importée(s) sans doublon. Annulation disponible pendant 30 minutes.`
    : 'Les données ont changé pendant la confirmation. Aucun import n’a été effectué ; rechargez le relevé pour reprendre.', importedCount === count ? 'success' : 'info');
}

let assetValueDialog = null;

function openAssetValueDialog(assetId, returnFocus = document.activeElement) {
  const account = currentAccount();
  const asset = account?.wealthAssets?.find(item => String(item.id) === String(assetId));
  if (!account || !asset) return;
  if (!assetValueDialog) {
    assetValueDialog = document.createElement('dialog');
    assetValueDialog.id = 'v5AssetValueDialog';
    assetValueDialog.className = 'v5-asset-value-dialog';
    assetValueDialog.innerHTML = `<form id="v5AssetValueForm" method="dialog" class="v5-asset-value-sheet"><header><div><span>MISE À JOUR DU PATRIMOINE</span><h2 id="v5AssetValueTitle">Nouvelle estimation</h2></div><button type="button" class="btn-icon" data-v5-asset-dialog-close aria-label="Fermer"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></header><p>Ajoutez une estimation datée. Les valeurs précédentes resteront visibles dans l’historique.</p><label for="v5AssetValueInput">Valeur estimée</label><input id="v5AssetValueInput" class="form-input" type="text" inputmode="decimal" autocomplete="off" required><label for="v5AssetValueDate">Date de l’estimation</label><input id="v5AssetValueDate" class="form-input" type="date" required><p id="v5AssetValueError" class="v5-asset-value-error" role="alert" hidden></p><footer><button type="button" class="btn btn-secondary" data-v5-asset-dialog-close>Annuler</button><button type="submit" class="btn btn-primary">Enregistrer l’estimation</button></footer></form>`;
    document.body.append(assetValueDialog);
    assetValueDialog.addEventListener('click', event => {
      if (event.target === assetValueDialog || event.target.closest('[data-v5-asset-dialog-close]')) assetValueDialog.close();
    });
    $('v5AssetValueForm')?.addEventListener('submit', event => {
      event.preventDefault();
      const target = assetValueDialog.dataset.assetId;
      const current = currentAccount();
      const currentAsset = current?.wealthAssets?.find(item => String(item.id) === String(target));
      if (!current || !currentAsset || String(current.id) !== assetValueDialog.dataset.accountId) {
        $('v5AssetValueError').textContent = 'Le compte a changé. Fermez cette fenêtre et recommencez.';
        $('v5AssetValueError').hidden = false;
        return;
      }
      const currency = current.settings?.baseCurrency || 'EUR';
      const parsed = window.FREEVMoney?.parseAmount($('v5AssetValueInput').value, currency, 'value');
      const date = $('v5AssetValueDate').value;
      const parsedDate = new Date(`${date}T12:00:00`);
      const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === date;
      if (!parsed?.ok || parsed.minor < 0 || !dateValid || date > localISODate()) {
        $('v5AssetValueError').textContent = 'Saisissez une valeur valide et une date passée ou égale à aujourd’hui.';
        $('v5AssetValueError').hidden = false;
        return;
      }
      const value = parsed.minor / (10 ** window.FREEVMoney.minorDigits(currency));
      const timestamp = new Date().toISOString();
      mutate(account => {
        const item = account.wealthAssets.find(candidate => String(candidate.id) === String(target));
        if (!item) return;
        const history = assetHistory(item).filter(entry => entry.date !== date);
        history.push({ id: crypto.randomUUID?.() || `valuation-${Date.now()}`, date, value, recordedAt: timestamp });
        history.sort((first, second) => first.date.localeCompare(second.date));
        item.valuations = history.slice(-100);
        item.value = value;
        item.updatedAt = timestamp;
      });
      assetValueDialog.close();
      notify('Estimation enregistrée dans l’historique.');
    });
    assetValueDialog.addEventListener('close', () => {
      const focus = assetValueDialog.returnFocus;
      assetValueDialog.returnFocus = null;
      if (focus?.isConnected) focus.focus();
    });
  }
  const history = assetHistory(asset);
  $('v5AssetValueTitle').textContent = `Valeur de ${asset.name}`;
  $('v5AssetValueInput').value = String((history.at(-1)?.value ?? asset.value ?? 0)).replace('.', ',');
  $('v5AssetValueDate').value = localISODate();
  $('v5AssetValueError').hidden = true;
  assetValueDialog.dataset.assetId = String(asset.id);
  assetValueDialog.dataset.accountId = String(account.id);
  assetValueDialog.returnFocus = returnFocus;
  assetValueDialog.showModal();
  requestAnimationFrame(() => $('v5AssetValueInput')?.focus());
}

function addAsset(event) {
  event.preventDefault();
  const name = $('v5AssetName')?.value.trim().slice(0, 80);
  const value = Number($('v5AssetValue')?.value);
  const type = $('v5AssetType')?.value || 'other';
  if (!name || !Number.isFinite(value) || value <= 0) return notify('Nom et valeur positive requis', 'error');
  mutate(account => {
    accountCollections(account);
    const timestamp = new Date().toISOString();
    const normalized = Math.round(value * 100) / 100;
    account.wealthAssets.push({ id: crypto.randomUUID?.() || `asset-${Date.now()}`, name, value: normalized, type, createdAt: timestamp, updatedAt: timestamp, valuations: [{ id: crypto.randomUUID?.() || `valuation-${Date.now()}`, date: localISODate(), value: normalized, recordedAt: timestamp }] });
  });
  event.currentTarget.reset();
  notify('Actif ajouté au patrimoine');
}

async function requestNotifications() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return notify('Notifications indisponibles sur ce navigateur', 'error');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    renderSecurity();
    return notify('Notifications non autorisées', 'info');
  }
  try {
    await sendLocalReminders(true);
  } catch (_) {}
  renderSecurity();
  notify('Notifications activées');
}

async function sendLocalReminders(force = false) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return false;
  const today = new Date().toISOString().slice(0, 10);
  const reminderKey = `freevReminder:${window.__freevUserId || 'device'}`;
  if (!force && localStorage.getItem(reminderKey) === today) return false;
  const alerts = buildLocalAlerts(currentAccount(), today);
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification('Freev Valeur', {
    body: alerts.length ? `${alerts.length} point(s) financier(s) demandent votre attention. Ouvrez Freev pour les consulter.` : 'Les alertes financières locales sont activées sur cet appareil.',
    icon: './assets/icons/icon-192.png',
    badge: './assets/icons/icon-192.png',
    tag: `freev-local-alerts-${today}`,
    data: { url: './index.html?source=notification&view=smart' }
  });
  localStorage.setItem(reminderKey, today);
  return true;
}

async function handleTrustedDevice(input) {
  if (input.checked) {
    window.setTrustedDeviceCache?.(true);
    notify('Cache hors connexion activé sur cet appareil');
  } else {
    if (!confirm('Désactiver le cache sur cet appareil et effacer les copies financières locales ? Les données Firebase ne seront pas supprimées.')) {
      input.checked = true;
      return;
    }
    const saved = await window._fbSaveCloud?.();
    if (saved !== true && !confirm('La sauvegarde Firebase n’est pas confirmée. Effacer les données locales risque de perdre des modifications non synchronisées. Continuer ?')) {
      input.checked = true;
      return;
    }
    window.setTrustedDeviceCache?.(false);
    if (window.__freevLegacyFirestoreCachePurged === false) {
      notify('Cache local supprimé, mais la purge IndexedDB est incomplète. Fermez tous les onglets FREEV et rechargez.', 'info');
    } else {
      notify('Cache local supprimé ; Firestore utilise uniquement la mémoire', 'info');
    }
  }
  renderSecurity();
}

function showWhatsNew(force = false) {
  const key = `${RELEASE_KEY}:${window.__freevUserId || 'device'}`;
  if (!force && localStorage.getItem(key) === 'seen') return;
  const overlay = $('v5WhatsNew');
  if (overlay) {
    overlay.hidden = false;
    document.body.classList.add('v4-modal-open');
    requestAnimationFrame(() => overlay.querySelector('button')?.focus());
  }
}

function closeWhatsNew(openCenter = false) {
  localStorage.setItem(`${RELEASE_KEY}:${window.__freevUserId || 'device'}`, 'seen');
  const overlay = $('v5WhatsNew');
  if (overlay) overlay.hidden = true;
  document.body.classList.remove('v4-modal-open');
  if (openCenter) window.switchView?.('smart');
}

function bind() {
  if (initialized) return;
  initialized = true;
  $('v5RuleForm')?.addEventListener('submit', handleRuleSubmit);
  $('duplicateMonthForm')?.addEventListener('submit', event => {
    event.preventDefault();
    window.prepareDuplicateMonthPreview?.();
  });
  $('duplicateMonthForm')?.addEventListener('change', () => {
    if (window.__freevDuplicateMonthPreview) window.renderDuplicateMonthPreview?.();
  });
  $('v5AssetForm')?.addEventListener('submit', addAsset);
  $('v5StatementFile')?.addEventListener('change', event => loadStatement(event.currentTarget));
  $('v5TrustedDevice')?.addEventListener('change', event => handleTrustedDevice(event.currentTarget));
  $('v5NotificationButton')?.addEventListener('click', requestNotifications);
  document.querySelector('.v5-tabs')?.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...document.querySelectorAll('[data-v5-tab]')];
    const index = tabs.indexOf(event.target.closest('[data-v5-tab]'));
    if (index < 0) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    setActiveTab(next.dataset.v5Tab);
    next.focus();
  });
  $('v5WhatsNew')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeWhatsNew(false);
  });
  $('v5RulePreview')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeRulePreview();
  });
  $('duplicateMonthPreview')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) window.closeDuplicateMonthPreview?.();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('v5WhatsNew')?.hidden) closeWhatsNew(false);
    const preview = $('v5RulePreview');
    if (event.key === 'Escape' && preview && !preview.hidden) closeRulePreview();
    const duplicateMonthPreview = $('duplicateMonthPreview');
    if (event.key === 'Escape' && duplicateMonthPreview && !duplicateMonthPreview.hidden) window.closeDuplicateMonthPreview?.();
    const activePreview = duplicateMonthPreview && !duplicateMonthPreview.hidden ? duplicateMonthPreview : preview && !preview.hidden ? preview : null;
    if (event.key === 'Tab' && activePreview) {
      const focusable = [...activePreview.querySelectorAll('button:not(:disabled),input:not(:disabled)')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !activePreview.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !activePreview.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-v5-tab], [data-v5-open-tab], [data-v5-add-suggestion], [data-v5-undo-learning], [data-v5-delete-rule], [data-v5-toggle-rule], [data-v5-convert-subscription], [data-v5-ignore-subscription], [data-v5-update-asset], [data-v5-delete-asset], [data-v5-rule-page], [data-v5-import-page], [data-duplicate-month-page], #v5SelectAllImport, #v5ConfirmImport, #v5ConfirmRulePreview, #v5CancelRulePreview, #v5CancelRulePreviewFooter, #v5UndoRuleBulk, #v5UndoImportBulk, #v5RulePreviewSelectAll, #duplicateMonthConfirm, #duplicateMonthCancel, #duplicateMonthCancelFooter');
    if (!target) return;
    if (target.dataset.v5Tab) setActiveTab(target.dataset.v5Tab);
    if (target.dataset.v5OpenTab) setActiveTab(target.dataset.v5OpenTab);
    if (target.dataset.v5AddSuggestion) addRule(target.dataset.v5AddSuggestion, target.dataset.category, target.dataset.ruleType || '', true, target.dataset.matchType || '');
    if (target.dataset.v5UndoLearning) {
      const account = currentAccount();
      if (!account) return;
      const result = undoCorrectionEvidence(account.categoryLearning, target.dataset.v5UndoLearning, { accountId: String(account.id) });
      if (!result.undone) return notify(result.reason, 'error');
      mutate(item => { if (item.id === account.id) item.categoryLearning = result.state; });
      notify(result.reason, 'success');
    }
    if (target.dataset.v5ToggleRule) mutate(account => { const rule = account.automationRules.find(item => item.id === target.dataset.v5ToggleRule); if (rule) rule.enabled = target.checked; });
    if (target.dataset.v5DeleteRule && confirm('Supprimer cette règle automatique ?')) mutate(account => { account.automationRules = account.automationRules.filter(rule => rule.id !== target.dataset.v5DeleteRule); });
    if (target.id === 'v5ConfirmRulePreview') commitRulePreview();
    if (target.id === 'v5CancelRulePreview' || target.id === 'v5CancelRulePreviewFooter') closeRulePreview();
    if (target.id === 'v5UndoRuleBulk' || target.id === 'v5UndoImportBulk') undoRuleBulkAction();
    if (target.id === 'duplicateMonthConfirm') window.confirmDuplicateMonthPreview?.();
    if (target.id === 'duplicateMonthCancel' || target.id === 'duplicateMonthCancelFooter') window.closeDuplicateMonthPreview?.();
    if (target.dataset.duplicateMonthPage) {
      const pending = window.__freevDuplicateMonthPreview;
      if (pending) {
        const pageCount = Math.ceil(pending.changes.length / 40);
        pending.page = Math.max(0, Math.min(pageCount - 1, pending.page + (target.dataset.duplicateMonthPage === 'next' ? 1 : -1)));
        window.renderDuplicateMonthPreview?.();
        $('duplicateMonthPreviewRows')?.scrollTo({ top: 0 });
      }
    }
    if (target.id === 'v5RulePreviewSelectAll') {
      document.querySelectorAll('[data-v5-rule-candidate]').forEach(input => { input.checked = target.checked; });
      syncRulePreviewSelection();
    }
    if (target.id === 'v5SelectAllImport') {
      document.querySelectorAll('[data-v5-import-candidate]').forEach(input => { input.checked = target.checked; });
      syncStatementImportSelection();
    }
    if (target.dataset.v5RulePage && pendingRulePreview) {
      pendingRulePreview.page += target.dataset.v5RulePage === 'next' ? 1 : -1;
      renderRulePreview();
    }
    if (target.dataset.v5ImportPage && pendingImport) {
      pendingImport.page += target.dataset.v5ImportPage === 'next' ? 1 : -1;
      renderImportPreview();
      $('v5ImportPreview')?.querySelector('[data-v5-import-candidate]')?.focus();
    }
    if (target.id === 'v5ConfirmImport') confirmImport();
    if (target.dataset.v5IgnoreSubscription) mutate(account => { account.ignoredSubscriptionKeys = [...new Set([...(account.ignoredSubscriptionKeys || []), target.dataset.v5IgnoreSubscription])]; });
    if (target.dataset.v5UpdateAsset) openAssetValueDialog(target.dataset.v5UpdateAsset, target);
    if (target.dataset.v5ConvertSubscription) {
      const account = currentAccount();
      const subscription = getSubscriptions(account).find(item => item.key === target.dataset.v5ConvertSubscription);
      if (subscription && confirm(`Ajouter ${subscription.merchant} aux paiements réguliers (${subscription.frequency === 'yearly' ? 'chaque année' : subscription.frequency === 'weekly' ? 'chaque semaine' : 'chaque mois'}) ?`)) mutate(item => {
        const alreadyExists = item.recurringTransactions.some(rule => merchantKey(rule) === subscription.key && rule.type !== 'income');
        if (!alreadyExists) item.recurringTransactions.push({ id: crypto.randomUUID?.() || `rec-${Date.now()}`, desc: subscription.merchant, category: 'Abonnements', type: 'expense', amount: subscription.latestAmount, amountBase: subscription.latestAmount, frequency: subscription.frequency, startDate: subscription.lastDate || new Date().toISOString().slice(0, 10), dayOfMonth: Number(String(subscription.lastDate || '').slice(8, 10)) || 1, source: 'smart-detection' });
      });
    }
    if (target.dataset.v5DeleteAsset && confirm('Retirer cet actif du patrimoine ?')) mutate(account => { account.wealthAssets = account.wealthAssets.filter(asset => asset.id !== target.dataset.v5DeleteAsset); });
  });
  document.addEventListener('change', event => {
    if (!event.target.matches('[data-v5-rule-candidate]')) return;
    syncRulePreviewSelection();
  });
  document.addEventListener('change', event => {
    if (!event.target.matches('[data-v5-import-candidate]')) return;
    syncStatementImportSelection();
  });
  window.addEventListener('online', renderSecurity);
  window.addEventListener('offline', renderSecurity);
}

window.FreevV5 = { render, setActiveTab, showWhatsNew, closeWhatsNew, requestNotifications, sendLocalReminders, renderImportHistory };
document.addEventListener('DOMContentLoaded', bind, { once: true });
window.addEventListener('freev:ready', () => {
  bind();
  render();
  window.setTimeout(() => sendLocalReminders(false).catch(() => {}), 1500);
  window.setTimeout(() => showWhatsNew(false), 500);
});
