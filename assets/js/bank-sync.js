import { applyAutomationRules } from './v5-engine.js';
import { bankStatusCopy, buildBankMappingRows, isSafeBankRedirect, normalizeBankConnectionStatus, normalizeBankMappings, prepareBankImport } from './bank-sync-engine.js';
import { createLatestRequestCoordinator } from './calculation-coordination.mjs';

const endpoint = String(window.FREEV_BANK_SYNC_ENDPOINT || '').replace(/\/$/, '');
let currentStatus = normalizeBankConnectionStatus();
let currentMappingPayload = { bankAccounts: [], mappings: [] };
let currentImportPayload = null;
const requests = createLatestRequestCoordinator();

function element(id) { return document.getElementById(id); }

function configuredEndpoint() {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' ? url.toString().replace(/\/$/, '') : '';
  } catch {
    return '';
  }
}

function setBusy(busy) {
  const connect = element('bankSyncConnectButton');
  const refresh = element('bankSyncRefreshButton');
  const saveMappings = element('bankSyncSaveMappingsButton');
  const fetchCandidates = element('bankSyncFetchButton');
  const confirmCandidates = element('bankSyncConfirmCandidatesButton');
  if (connect) connect.disabled = busy;
  if (refresh) refresh.disabled = busy;
  if (saveMappings) saveMappings.disabled = busy;
  if (fetchCandidates) fetchCandidates.disabled = busy;
  if (confirmCandidates) confirmCandidates.disabled = busy;
}

function render(status = currentStatus) {
  currentStatus = normalizeBankConnectionStatus(status);
  const copy = bankStatusCopy(currentStatus);
  const statusNode = element('bankSyncStatus');
  const detailNode = element('bankSyncDetail');
  const connect = element('bankSyncConnectButton');
  const refresh = element('bankSyncRefreshButton');
  const fetchCandidates = element('bankSyncFetchButton');
  const hasEndpoint = Boolean(configuredEndpoint());

  if (statusNode) {
    statusNode.dataset.state = hasEndpoint ? currentStatus.state : 'unavailable';
    statusNode.textContent = hasEndpoint ? copy.label : 'Service bancaire à configurer';
  }
  if (detailNode) detailNode.textContent = hasEndpoint ? copy.detail : 'Freev est prêt, mais le serveur Open Banking sécurisé doit encore être relié.';
  if (connect) {
    connect.hidden = currentStatus.state === 'ready' && hasEndpoint;
    connect.textContent = hasEndpoint ? 'Connecter ma banque' : 'Service bientôt disponible';
  }
  if (refresh) refresh.hidden = !(currentStatus.state === 'ready' && hasEndpoint);
  if (fetchCandidates) fetchCandidates.hidden = !(currentStatus.state === 'ready' && hasEndpoint);
}

function freevAccounts() {
  return Array.isArray(window._getAppState?.().accounts) ? window._getAppState().accounts : [];
}

function renderAccountMappings(payload = currentMappingPayload) {
  currentMappingPayload = {
    bankAccounts: Array.isArray(payload?.bankAccounts) ? payload.bankAccounts : [],
    mappings: Array.isArray(payload?.mappings) ? payload.mappings : []
  };
  const section = element('bankSyncAccountMapping');
  const rowsContainer = element('bankSyncMappingRows');
  const hasEndpoint = Boolean(configuredEndpoint());
  const rows = buildBankMappingRows(currentMappingPayload.bankAccounts, freevAccounts(), currentMappingPayload.mappings);
  if (!section || !rowsContainer) return;
  section.hidden = !hasEndpoint || !rows.length;
  if (section.hidden) return;

  rowsContainer.replaceChildren(...rows.map(({ bankAccount, freevAccountId }) => {
    const row = document.createElement('div');
    row.className = 'v5-bank-map-row';
    const source = document.createElement('div');
    source.className = 'v5-bank-map-source';
    const icon = document.createElement('i');
    icon.className = `fa-solid fa-${bankAccount.type === 'savings' ? 'piggy-bank' : bankAccount.type === 'credit' ? 'credit-card' : 'building-columns'}`;
    icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = bankAccount.name;
    const details = document.createElement('small');
    details.textContent = [bankAccount.maskedIban, bankAccount.currency].filter(Boolean).join(' · ') || 'Compte bancaire';
    copy.append(name, details);
    source.append(icon, copy);

    const arrow = document.createElement('i');
    arrow.className = 'fa-solid fa-arrow-right v5-bank-map-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    const select = document.createElement('select');
    select.className = 'form-select v5-bank-map-select';
    select.dataset.bankAccountId = bankAccount.id;
    select.setAttribute('aria-label', `Associer ${bankAccount.name} à un compte Freev`);
    const none = new Option('Ne pas synchroniser ce compte', '');
    select.add(none);
    freevAccounts().forEach(account => select.add(new Option(account.name || 'Compte Freev', account.id)));
    select.value = freevAccountId;
    row.append(source, arrow, select);
    return row;
  }));
}

function money(value, currency = 'EUR') {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function renderCandidateRow(candidate) {
  const row = document.createElement('label');
  row.className = `v5-bank-candidate ${candidate.type === 'income' ? 'income' : 'expense'}`;
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = !candidate.needsReview;
  checkbox.dataset.bankTransactionId = candidate.bankTransactionId;
  checkbox.setAttribute('aria-label', `Importer ${candidate.desc}`);
  const main = document.createElement('span');
  main.className = 'v5-bank-candidate-main';
  const title = document.createElement('strong');
  title.textContent = candidate.desc;
  const detail = document.createElement('small');
  const account = freevAccounts().find(item => String(item?.id) === candidate.freevAccountId);
  detail.textContent = `${new Date(`${candidate.date}T12:00:00`).toLocaleDateString('fr-FR')} · ${account?.name || 'Compte Freev'}${candidate.needsReview ? ' · Ressemblance à vérifier avant import' : ''}`;
  main.append(title, detail);
  const amount = document.createElement('b');
  amount.textContent = `${candidate.type === 'income' ? '+' : '−'}${money(candidate.amount, candidate.currency)}`;
  row.append(checkbox, main, amount);
  return row;
}

function updateCandidateConfirmButton() {
  const confirm = element('bankSyncConfirmCandidatesButton');
  if (!confirm || confirm.hidden) return;
  const count = document.querySelectorAll('#bankSyncCandidatesList input[data-bank-transaction-id]:checked').length;
  confirm.disabled = count === 0;
  confirm.textContent = `Importer la sélection (${count})`;
}

function renderCandidates(payload = currentImportPayload) {
  currentImportPayload = payload;
  const section = element('bankSyncCandidates');
  const summary = element('bankSyncCandidatesSummary');
  const list = element('bankSyncCandidatesList');
  const confirm = element('bankSyncConfirmCandidatesButton');
  if (!section || !summary || !list || !confirm) return;
  section.hidden = !payload;
  if (!payload) return;

  const { importable = [], duplicates = [], possibleDuplicates = [], currencyMismatch = [], unmapped = [], invalid = [] } = payload;
  summary.replaceChildren();
  [
    [importable.length, 'à vérifier'],
    [duplicates.length, 'identité confirmée'],
    [possibleDuplicates.length, 'ressemblance à vérifier'],
    [unmapped.length, 'sans association']
  ].forEach(([count, label]) => {
    const item = document.createElement('span');
    const value = document.createElement('strong');
    value.textContent = String(count);
    item.append(value, document.createTextNode(` ${label}${count > 1 ? 's' : ''}`));
    summary.append(item);
  });
  if (invalid.length) {
    const note = document.createElement('small');
    note.textContent = `${invalid.length} opération(s) invalide(s) ignorée(s).`;
    summary.append(note);
  }
  if (currencyMismatch.length) {
    const note = document.createElement('small');
    note.textContent = `${currencyMismatch.length} opération(s) exclue(s) : devise bancaire différente de celle du compte Freev.`;
    summary.append(note);
  }
  list.replaceChildren(...importable.map(renderCandidateRow));
  if (!importable.length) {
    const empty = document.createElement('p');
    empty.className = 'v5-empty';
    empty.textContent = unmapped.length
      ? 'Associez d’abord les comptes bancaires ci-dessus, puis recherchez à nouveau les opérations.'
      : 'Aucune nouvelle opération à importer : les doublons ont été écartés.';
    list.append(empty);
  }
  confirm.hidden = !importable.length;
  updateCandidateConfirmButton();
}

async function authenticatedRequest(path, options = {}) {
  const base = configuredEndpoint();
  const user = window._fbGetCurrentUser?.();
  if (!base || !user) throw new Error('not-ready');
  const idToken = await user.getIdToken();
  const response = await fetch(`${base}${path}`, {
    ...options,
    credentials: 'omit',
    headers: { Authorization: `Bearer ${idToken}`, Accept: 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(`request-${response.status}`);
  return response.json();
}

async function refresh() {
  if (!configuredEndpoint() || !window._fbGetCurrentUser?.()) {
    render();
    renderAccountMappings();
    return;
  }
  const request = requests.begin('bank-connection-state');
  setBusy(true);
  try {
    render({ ...currentStatus, state: 'syncing' });
    const payload = await authenticatedRequest('/v1/bank-connections/status', { signal: request.signal });
    if (!request.isCurrent()) return;
    render(payload);
    renderAccountMappings(payload);
  } catch (error) {
    if (!request.isCurrent()) return;
    console.warn('[Freev] État bancaire indisponible :', error?.name || 'erreur');
    render({ state: 'error' });
    renderAccountMappings();
  } finally {
    if (request.isCurrent()) setBusy(false);
  }
}

async function fetchCandidates() {
  if (!configuredEndpoint() || !window._fbGetCurrentUser?.()) return;
  const request = requests.begin('bank-connection-state');
  setBusy(true);
  try {
    const payload = await authenticatedRequest('/v1/bank-connections/sync', { method: 'POST', signal: request.signal });
    if (!request.isCurrent()) return;
    render(payload);
    renderAccountMappings(payload);
    currentImportPayload = prepareBankImport(payload?.candidates, payload?.mappings, freevAccounts());
    renderCandidates(currentImportPayload);
    if (currentImportPayload.unmapped.length) {
      window.showToast?.(`${currentImportPayload.unmapped.length} opération(s) attendent l’association de leur compte bancaire.`, 'info');
    } else if (currentImportPayload.importable.length) {
      window.showToast?.(`${currentImportPayload.importable.length} opération(s) sont prêtes à être vérifiées. Rien n’a été importé.`, 'success');
    } else {
      window.showToast?.('Aucune nouvelle opération à importer.', 'info');
    }
  } catch (error) {
    if (!request.isCurrent()) return;
    console.warn('[Freev] Synchronisation bancaire indisponible :', error?.name || 'erreur');
    window.showToast?.('Les opérations bancaires ne peuvent pas être récupérées pour le moment. Aucune donnée n’a été modifiée.', 'error');
  } finally {
    if (request.isCurrent()) setBusy(false);
  }
}

function selectedCandidates() {
  const selected = new Set([...document.querySelectorAll('#bankSyncCandidatesList input[data-bank-transaction-id]:checked')]
    .map(input => input.dataset.bankTransactionId));
  return (currentImportPayload?.importable || []).filter(candidate => selected.has(candidate.bankTransactionId));
}

function confirmCandidates() {
  const selected = selectedCandidates();
  if (!selected.length) {
    window.showToast?.('Sélectionnez au moins une opération à importer.', 'info');
    return;
  }
  const accountsById = new Map(freevAccounts().map(account => [String(account?.id), account]));
  const byAccount = new Map();
  selected.forEach(candidate => {
    const values = byAccount.get(candidate.freevAccountId) || [];
    values.push(candidate);
    byAccount.set(candidate.freevAccountId, values);
  });
  let imported = 0;
  let duplicates = 0;
  const confirmedDuplicates = [];
  byAccount.forEach((candidates, accountId) => {
    const account = accountsById.get(String(accountId));
    if (!account) return;
    window._mutateAccountData?.(account.id, target => {
      const knownProviderIds = new Set((target.transactions || [])
        .filter(transaction => transaction?.bankTransactionId && transaction?.bankAccountId)
        .map(transaction => `${transaction.bankAccountId}|${transaction.bankTransactionId}`));
      const unique = candidates.filter(candidate => {
        const identity = `${candidate.bankAccountId}|${candidate.bankTransactionId}`;
        if (knownProviderIds.has(identity)) {
          duplicates += 1;
          confirmedDuplicates.push(candidate);
          return false;
        }
        knownProviderIds.add(identity);
        return true;
      });
      const classified = applyAutomationRules(unique, target.automationRules || []);
      target.transactions = [...(target.transactions || []), ...classified.transactions];
      imported += classified.transactions.length;
    });
  });
  if (!imported) {
    window.showToast?.('Aucune opération ajoutée : elles sont déjà présentes dans Freev.', 'info');
    return;
  }
  const importedIds = new Set(selected.map(candidate => candidate.bankTransactionId));
  currentImportPayload = {
    ...currentImportPayload,
    importable: currentImportPayload.importable.filter(candidate => !importedIds.has(candidate.bankTransactionId)),
    duplicates: [...currentImportPayload.duplicates, ...confirmedDuplicates]
  };
  renderCandidates(currentImportPayload);
  window.syncAllUI?.(true);
  window.FreevV5?.render?.();
  window.showToast?.(`${imported} opération(s) importée(s) après votre validation${duplicates ? ` · ${duplicates} doublon(s) évité(s)` : ''}.`, 'success');
}

async function completeBankCallback() {
  const currentUrl = new URL(window.location.href);
  const state = currentUrl.searchParams.get('state');
  const connectionId = currentUrl.searchParams.get('connection_id');
  const code = currentUrl.searchParams.get('code');
  const error = currentUrl.searchParams.get('error');
  if (!state || (!connectionId && !code && !error) || !configuredEndpoint() || !window._fbGetCurrentUser?.()) return;

  try {
    await authenticatedRequest('/v1/bank-connections/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state })
    });
    if (error) window.showToast?.('La connexion bancaire a été annulée ou doit être vérifiée.', 'info');
    else window.showToast?.('Retour bancaire reçu. Freev vérifie les comptes disponibles.', 'success');
  } catch (callbackError) {
    console.warn('[Freev] Retour bancaire invalide :', callbackError?.name || 'erreur');
    window.showToast?.('Le retour bancaire n’a pas pu être validé. Aucun compte n’a été ajouté.', 'error');
  } finally {
    currentUrl.search = '';
    window.history.replaceState({}, '', `${currentUrl.pathname}${currentUrl.hash}`);
  }
}

async function saveMappings(event) {
  event?.preventDefault();
  const rows = [...document.querySelectorAll('#bankSyncMappingRows select[data-bank-account-id]')];
  const requested = rows.filter(select => select.value).map(select => ({ bankAccountId: select.dataset.bankAccountId, freevAccountId: select.value }));
  const mappings = normalizeBankMappings(requested, currentMappingPayload.bankAccounts, freevAccounts());
  if (requested.length !== mappings.length) {
    window.showToast?.('Un compte Freev ne peut être relié qu’à un seul compte bancaire.', 'error');
    return;
  }
  setBusy(true);
  try {
    const payload = await authenticatedRequest('/v1/bank-connections/mappings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mappings })
    });
    render(payload.status || payload);
    renderAccountMappings(payload);
    window.showToast?.('Associations bancaires enregistrées.', 'success');
  } catch (error) {
    console.warn('[Freev] Associations bancaires refusées :', error?.name || 'erreur');
    window.showToast?.('Les associations n’ont pas été enregistrées. Aucune opération n’a été modifiée.', 'error');
  } finally {
    setBusy(false);
  }
}

async function begin() {
  if (!configuredEndpoint()) {
    window.showToast?.('La connexion bancaire sera activée après la configuration du service sécurisé.', 'info');
    return;
  }
  if (!window._fbGetCurrentUser?.()) {
    window.showToast?.('Connectez-vous à Freev avant de relier votre banque.', 'info');
    window.showAuthModal?.();
    return;
  }
  setBusy(true);
  try {
    const result = await authenticatedRequest('/v1/bank-connections/start', { method: 'POST' });
    if (!isSafeBankRedirect(result?.redirectUrl)) throw new Error('unsafe-redirect');
    window.location.assign(result.redirectUrl);
  } catch (error) {
    console.warn('[Freev] Démarrage bancaire refusé :', error?.name || 'erreur');
    window.showToast?.('La connexion bancaire n’a pas pu démarrer. Aucune donnée n’a été modifiée.', 'error');
  } finally {
    setBusy(false);
  }
}

function init() {
  element('bankSyncConnectButton')?.addEventListener('click', begin);
  element('bankSyncRefreshButton')?.addEventListener('click', refresh);
  element('bankSyncFetchButton')?.addEventListener('click', fetchCandidates);
  element('bankSyncMappingForm')?.addEventListener('submit', saveMappings);
  element('bankSyncConfirmCandidatesButton')?.addEventListener('click', confirmCandidates);
  element('bankSyncCandidatesList')?.addEventListener('change', updateCandidateConfirmButton);
  element('bankSyncManageAccountsButton')?.addEventListener('click', () => window.openAccountsModal?.());
  element('bankSyncRefreshFreevAccountsButton')?.addEventListener('click', () => renderAccountMappings());
  render();
  renderAccountMappings();
  window.addEventListener('freev:ready', async () => {
    await completeBankCallback();
    await refresh();
  }, { once: true });
}

window.FreevBankSync = Object.freeze({ refresh, begin, saveMappings, fetchCandidates, confirmCandidates });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
