// ======================
// Freev Valeur - ULTRA (Audit Fixes + PRO Features)
// ======================

const APP_VERSION = '5.1.0-intelligent-planning';
const SCHEMA_VERSION = '2026-08-02-v5';

// ============================================================
// ===== SYSTÈME MULTI-COMPTES =================================
// ============================================================

const ACCOUNTS_STORAGE_KEY = 'freevMultiAccounts_v2';
const TRUSTED_DEVICE_STORAGE_KEY = 'freevTrustedDevice';

// State multi-comptes
let accounts = [];
let currentAccountId = null;
let multiViewMode = 'individual'; // 'individual' | 'group' | 'global'
let selectedGroupIds = new Set();

// ── Bridge Firebase→variables locales ──────────────────────────
// Le module Firebase (type="module") ne peut pas accéder aux `let`
// ci-dessus. Cette fonction est exposée sur window pour combler ce gap.
window._applyCloudData = function(parsed) {
  window.__freevAccountEpoch = Number(window.__freevAccountEpoch || 0) + 1;
  accounts         = (parsed.accounts || []).map(a => ({...createAccountObj(a.name, a.id), ...a}));
  currentAccountId = parsed.currentAccountId;
  multiViewMode    = parsed.multiViewMode || 'individual';
  selectedGroupIds = new Set(parsed.selectedGroupIds || []);
  customCategories = parsed.customCategories || [];
  uiSettings       = { fabColor: '#10b981', reconcileColor: DEFAULT_RECONCILE_COLOR, ...(parsed.uiSettings || {}) };
  savingsMeta      = parsed.savingsMeta || {};
  if (!accounts.find(a => a.id === currentAccountId))
    currentAccountId = accounts[0]?.id || null;
  accounts.forEach(acc => {
    (acc.debts || []).forEach(d => {
      if (d.remainingAmount === undefined) d.remainingAmount = d.amount;
      if (d.initialAmount   === undefined) d.initialAmount   = d.amount;
    });
  });
  loadCurrentAccountIntoGlobals();
};

// Expose les variables en lecture pour le module Firebase
window._getAppState = function() {
  saveCurrentGlobalsToAccount?.();
  return { accounts, currentAccountId, multiViewMode,
           selectedGroupIds, customCategories, uiSettings, savingsMeta };
};

// Expose les fonctions critiques pour le module Firebase
window.loadCurrentAccountIntoGlobals = loadCurrentAccountIntoGlobals;
window.loadAccountSystem = loadAccountSystem;
window.saveAccountSystem = saveAccountSystem;
window.saveCurrentGlobalsToAccount = saveCurrentGlobalsToAccount;
window.createAccountObj = createAccountObj;

// Expose toutes les fonctions d'init UI pour le module Firebase
window._runPostAuthInit = function() {
  if (window.__freevBooted) return;
  window.__freevBooted = true;
  setChartDefaults?.();
  if (window.Chart) { try { Chart.register(donutCenterTextPlugin); } catch(_) {} }
  const mp = document.getElementById('globalMonthPicker');
  if (mp) mp.value = isoMonth(today);
  const di = document.getElementById('transDate');
  if (di) di.value = isoDate(today);
  const ts = document.getElementById('transType');
  if (ts) ts.addEventListener('change', handleTypeChange);
  generateRecurringOccurrences?.();
  setupShortcuts?.(); setupSidebarToggle?.();
  refreshSavingsSelect?.(); refreshCategoryFilter?.();
  loadSettingsUI?.(); renderAccountsSidebar?.(); updateViewModeUI?.();
  initDarkMode?.(); populateCategorySelects?.();
  loadFabColor?.(); loadReconcileColor?.();
  checkAutoBackup?.();
  if (!window.__freevAutoBackupTimer) {
    window.__freevAutoBackupTimer = setInterval(() => autoBackupSilent?.(), 5 * 60 * 1000);
  }
  if (!settings?.ratesUpdatedAt || (Date.now() - new Date(settings.ratesUpdatedAt)) > 3600000)
    fetchExchangeRates?.().catch(() => {});
  updateDashboard?.();
  window.dispatchEvent(new CustomEvent('freev:ready'));
};

// Palettes de couleurs pour les avatars de comptes
const ACCOUNT_COLORS = [
  'linear-gradient(135deg,#1e3a8a,#3b82f6)',
  'linear-gradient(135deg,#064e3b,#059669)',
  'linear-gradient(135deg,#7c2d12,#ea580c)',
  'linear-gradient(135deg,#4c1d95,#7c3aed)',
  'linear-gradient(135deg,#701a75,#c026d3)',
  'linear-gradient(135deg,#831843,#db2777)',
  'linear-gradient(135deg,#1e3a5f,#06b6d4)',
  'linear-gradient(135deg,#365314,#65a30d)',
];

function getAccountColor(idx) {
  // Si le compte a une couleur personnalisée, l'utiliser
  const acc = accounts[idx];
  if (acc?.color) return acc.color;
  return ACCOUNT_COLORS[idx % ACCOUNT_COLORS.length];
}

function getAccountIndex(id) {
  return accounts.findIndex(a => a.id === id);
}

const ACCOUNT_COLOR_PRESETS = [
  { name: 'Bleu', value: '#2563eb' },
  { name: 'Vert', value: '#059669' },
  { name: 'Orange', value: '#ea580c' },
  { name: 'Violet', value: '#7c3aed' },
  { name: 'Magenta', value: '#c026d3' },
  { name: 'Rose', value: '#db2777' },
  { name: 'Turquoise', value: '#0891b2' },
  { name: 'Citron', value: '#65a30d' }
];

function renderAccountColorSetting() {
  const container = document.getElementById('accountColorSetting');
  if (!container) return;
  const account = getCurrentAccount();
  const accountName = document.getElementById('accountColorActiveName');
  const presets = document.getElementById('accountColorPresets');
  const picker = document.getElementById('accountColorPicker');
  const customDot = document.getElementById('accountColorPickerDot');
  const preview = document.getElementById('accountColorPreview');
  const reset = document.getElementById('accountColorReset');
  if (!account || !presets || !picker) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  const index = getAccountIndex(account.id);
  const currentColor = getAccountColor(index);
  if (accountName) accountName.textContent = account.name || 'Compte actif';
  if (preview) preview.style.background = currentColor;
  presets.replaceChildren();
  ACCOUNT_COLOR_PRESETS.forEach(preset => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'freev-account-color-preset';
    button.style.setProperty('--account-color-choice', preset.value);
    button.setAttribute('aria-label', `Utiliser la couleur ${preset.name}`);
    button.setAttribute('aria-pressed', String(String(account.color || '').toLowerCase() === preset.value));
    button.title = preset.name;
    if (String(account.color || '').toLowerCase() === preset.value) {
      const check = document.createElement('i');
      check.className = 'fa-solid fa-check';
      check.setAttribute('aria-hidden', 'true');
      button.append(check);
    }
    button.addEventListener('click', () => setCurrentAccountColor(preset.value));
    presets.append(button);
  });
  const currentHex = /^#[0-9a-f]{6}$/i.test(String(account.color || ''))
    ? account.color
    : '#2563eb';
  picker.value = currentHex;
  picker.setAttribute('aria-label', `Personnaliser la couleur du compte ${account.name || ''}`.trim());
  if (customDot) customDot.style.background = currentColor;
  if (reset) reset.disabled = !account.color;
}

function setCurrentAccountColor(color) {
  const account = getCurrentAccount();
  if (!account || !/^#[0-9a-f]{6}$/i.test(String(color || ''))) return;
  account.color = String(color).toLowerCase();
  saveData();
  updateViewModeUI();
  syncAllUI?.(true);
  showToast('Couleur du compte mise à jour', 'success');
}

function resetCurrentAccountColor() {
  const account = getCurrentAccount();
  if (!account) return;
  delete account.color;
  saveData();
  updateViewModeUI();
  syncAllUI?.(true);
  showToast('Couleur par défaut rétablie', 'success');
}

// Crée un objet compte vide avec toutes les données par défaut
function createAccountObj(name, id = null) {
  const newId = id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  return {
    id: newId,
    name: name || 'Compte',
    createdAt: new Date().toISOString(),
    transactions: [],
    recurringTransactions: [],
    transactionTemplates: [],
    transactionDrafts: [],
    monthlyBudget: 0,
    budgetsByCategory: {},
    initialCapital: 0,
    savingsAccounts: {},
    goals: [],
    envelopes: {},
    automationRules: [],
    importHistory: [],
    plannerScenarios: [],
    presentationSettings: { layout: { hidden: {}, order: {} } },
    wealthAssets: [],
    documentIndex: [],
    plannerSettings: {
      forecastMonths: 6,
      projectionScope: 'complete',
      monthlyAdjustment: 0,
      incomeAdjustment: 0,
      expenseAdjustment: 0,
      oneTimeExpense: 0,
      oneTimeMonth: 1
    },
    debts: [],
    historyLog: [],
    settings: { baseCurrency: 'EUR', defaultMode: 'personal' }
  };
}

// Retourne le compte courant
function getCurrentAccount() {
  return accounts.find(a => a.id === currentAccountId) || accounts[0] || null;
}

// Retourne les comptes à afficher selon le mode vue
function getViewAccounts() {
  if (multiViewMode === 'global') return accounts;
  if (multiViewMode === 'group') {
    const selected = accounts.filter(a => selectedGroupIds.has(a.id));
    return selected.length ? selected : [getCurrentAccount()].filter(Boolean);
  }
  const ca = getCurrentAccount();
  return ca ? [ca] : [];
}

// ===== COUCHE D'ACCÈS AUX DONNÉES (DATA ACCESS LAYER) =====

// Transactions à afficher selon le mode vue
function getDisplayTransactions() {
  if (multiViewMode === 'individual') return transactions;
  return getViewAccounts().flatMap((a, idx) =>
    (a.transactions || []).map(t => ({
      ...t,
      _accountId: a.id,
      _accountName: a.name,
      _accountIdx: getAccountIndex(a.id)
    }))
  );
}

// Capital initial combiné selon le mode vue
function getDisplayCapital() {
  if (multiViewMode === 'individual') return initialCapital;
  return getViewAccounts().reduce((s, a) => s + (Number(a.initialCapital) || 0), 0);
}

// Comptes d'épargne combinés selon le mode vue
function getDisplaySavingsAccounts() {
  if (multiViewMode === 'individual') return savingsAccounts;
  const merged = {};
  getViewAccounts().forEach(a => {
    Object.entries(a.savingsAccounts || {}).forEach(([k, v]) => {
      merged[k] = (merged[k] || 0) + (Number(v) || 0);
    });
  });
  return merged;
}

// ===== CHARGEMENT / SAUVEGARDE MULTI-COMPTES =====

function getLocalAccountCacheOwnerUid() {
  try {
    const raw = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return String(parsed?.ownerUid || '').trim();
  } catch (_) {
    return '';
  }
}

function loadAccountSystem(expectedOwnerUid = '') {
  try {
    const raw = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Un cache étiqueté pour un autre compte Firebase ne doit jamais devenir
      // l'état actif. Les anciens caches sans propriétaire sont traités dans
      // firebase-auth.js avec le dernier UID connu, pour conserver la migration.
      if (expectedOwnerUid && parsed.ownerUid && parsed.ownerUid !== expectedOwnerUid) return false;
      accounts = (parsed.accounts || []).map(a => ({
        ...createAccountObj(a.name, a.id),
        ...a
      }));
      currentAccountId = parsed.currentAccountId;
      multiViewMode = parsed.multiViewMode || 'individual';
      selectedGroupIds = new Set(parsed.selectedGroupIds || []);
      // FIX : charger les categories globales
      customCategories = parsed.customCategories || [];
      uiSettings = { fabColor: '#10b981', reconcileColor: DEFAULT_RECONCILE_COLOR, ...(parsed.uiSettings || {}) };
      savingsMeta = parsed.savingsMeta || {};
    }

    // FIX : Migration depuis l'ancien format par-compte
    if (!customCategories.length) {
      accounts.forEach(acc => {
        const cats = acc.settings?.customCategories || [];
        cats.forEach(c => {
          if (!customCategories.find(x => x.name.toLowerCase() === c.name.toLowerCase())) {
            customCategories.push(c);
          }
        });
      });
    }

    // Migration : si pas de comptes, migrer l'ancien freevData
    if (!accounts.length) {
      const legacyRaw = localStorage.getItem('freevData') ||
                        localStorage.getItem('freevData_' + (localStorage.getItem('freevCurrentProfile') || 'default'));
      const defaultAcc = createAccountObj('Compte principal');
      if (legacyRaw) {
        try {
          const parsed = JSON.parse(legacyRaw);
          defaultAcc.transactions = parsed.transactions || [];
          defaultAcc.recurringTransactions = parsed.recurringTransactions || [];
          defaultAcc.monthlyBudget = parsed.monthlyBudget || 0;
          defaultAcc.budgetsByCategory = parsed.budgetsByCategory || {};
          defaultAcc.initialCapital = parsed.initialCapital || 0;
          defaultAcc.savingsAccounts = parsed.savingsAccounts || {};
          defaultAcc.debts = parsed.debts || [];
          defaultAcc.historyLog = parsed.historyLog || [];
          defaultAcc.settings = parsed.settings || { baseCurrency: 'EUR', defaultMode: 'personal' };
          // FIX : migration legacy customCategories
          if (!customCategories.length && parsed.settings?.customCategories) {
            customCategories = parsed.settings.customCategories;
          }
        } catch(e) { console.warn('Migration legacy data failed', e); }
      }
      accounts = [defaultAcc];
      currentAccountId = defaultAcc.id;
    }

    // Vérifier que currentAccountId est valide
    if (!accounts.find(a => a.id === currentAccountId)) {
      currentAccountId = accounts[0]?.id || null;
    }

    // Migrer les dettes dans chaque compte
    accounts.forEach(acc => {
      (acc.debts || []).forEach(debt => {
        if (debt.remainingAmount === undefined) debt.remainingAmount = debt.amount;
        if (debt.initialAmount === undefined) debt.initialAmount = debt.amount;
      });
    });

    // Charger les données du compte courant dans les variables globales
    loadCurrentAccountIntoGlobals();

    return true;
  } catch(e) {
    console.error('loadAccountSystem error', e);
    return false;
  }
}

function saveAccountSystem() {
  // Sauvegarder les globales dans le compte courant
  saveCurrentGlobalsToAccount();
  // Sauvegarder tout
  try {
    if (!isTrustedDeviceCacheEnabled()) return;
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify({
      schemaVersion: '2026-multi-v3',
      // Lie le cache sensible au compte Firebase actuellement connecté.
      // Cet UID n'est pas un secret, mais interdit de réutiliser le cache pour
      // un autre utilisateur sur le même navigateur.
      ownerUid: String(window.__freevUserId || '').trim(),
      accounts,
      currentAccountId,
      multiViewMode,
      selectedGroupIds: [...selectedGroupIds],
      customCategories: customCategories || [], // ✅ FIX : sauvegarde globale
      uiSettings: uiSettings || { fabColor: '#10b981', reconcileColor: DEFAULT_RECONCILE_COLOR },
      savingsMeta: savingsMeta || {},
      lastSaved: new Date().toISOString()
    }));
  } catch(e) {
    console.error('saveAccountSystem error', e);
    if (typeof showToast === 'function') showToast('Erreur lors de la sauvegarde', 'error');
  }
}

function isTrustedDeviceCacheEnabled() {
  const explicit = localStorage.getItem(TRUSTED_DEVICE_STORAGE_KEY);
  if (explicit !== null) return explicit === '1';
  // Migration sûre : un appareil qui possède déjà un cache reste actif jusqu’à
  // ce que l’utilisateur choisisse explicitement dans le centre de sécurité.
  return Boolean(localStorage.getItem(ACCOUNTS_STORAGE_KEY));
}

function setTrustedDeviceCache(enabled) {
  localStorage.setItem(TRUSTED_DEVICE_STORAGE_KEY, enabled ? '1' : '0');
  if (enabled) saveAccountSystem();
  else clearSensitiveLocalCache();
}

function clearSensitiveLocalCache() {
  [ACCOUNTS_STORAGE_KEY, 'freevAutoBackup_v1', 'freevData', 'freevCloudSyncState_v1'].forEach(key => localStorage.removeItem(key));
  Object.keys(localStorage).filter(key => key.startsWith('freevData_') || key.startsWith('freevAutoBackup_')).forEach(key => localStorage.removeItem(key));
  Object.keys(localStorage).filter(key => key.startsWith('freevReceiptMerchantLearning_v1:')).forEach(key => localStorage.removeItem(key));
}

window.isTrustedDeviceCacheEnabled = isTrustedDeviceCacheEnabled;
window.setTrustedDeviceCache = setTrustedDeviceCache;
window.clearSensitiveLocalCache = clearSensitiveLocalCache;
window.getLocalAccountCacheOwnerUid = getLocalAccountCacheOwnerUid;
window._mutateAccountData = function(accountId, mutator) {
  if (typeof mutator !== 'function') return null;
  saveCurrentGlobalsToAccount();
  // Ne jamais appliquer une mutation à un autre compte lorsqu'un ID périmé
  // ou inconnu a été transmis par une tâche asynchrone.
  const account = accounts.find(item => String(item.id) === String(accountId));
  if (!account) return null;
  mutator(account);
  if (account.id === currentAccountId) loadCurrentAccountIntoGlobals();
  saveAccountSystem();
  return account;
};

function loadCurrentAccountIntoGlobals() {
  const acc = getCurrentAccount();
  if (!acc) return;
  transactions = acc.transactions ? [...acc.transactions] : [];
  recurringTransactions = acc.recurringTransactions ? [...acc.recurringTransactions] : [];
  transactionTemplates = Array.isArray(acc.transactionTemplates) ? [...acc.transactionTemplates] : [];
  transactionDrafts = Array.isArray(acc.transactionDrafts) ? [...acc.transactionDrafts] : [];
  monthlyBudget = acc.monthlyBudget || 0;
  budgetsByCategory = acc.budgetsByCategory || {};
  initialCapital = acc.initialCapital || 0;
  savingsAccounts = acc.savingsAccounts || {};
  debts = acc.debts || [];
  historyLog = acc.historyLog || [];
  settings = acc.settings || { baseCurrency: 'EUR', defaultMode: 'personal' };

  // Nettoyage défensif des doublons au chargement du compte.
  dedupeRecurringRules();
  dedupeRecurringOccurrences();
}

function saveCurrentGlobalsToAccount() {
  const acc = getCurrentAccount();
  if (!acc) return;
  acc.transactions = transactions;
  acc.recurringTransactions = recurringTransactions;
  acc.transactionTemplates = transactionTemplates;
  acc.transactionDrafts = transactionDrafts;
  acc.monthlyBudget = monthlyBudget;
  acc.budgetsByCategory = budgetsByCategory;
  acc.initialCapital = initialCapital;
  acc.savingsAccounts = savingsAccounts;
  acc.debts = debts;
  acc.historyLog = historyLog;
  acc.settings = settings;
}

// ===== CRUD COMPTES =====

function switchAccount(id) {
  if (!accounts.some(acc => String(acc.id) === String(id))) return;
  if (id === currentAccountId && multiViewMode === 'individual') return;
  window.__freevAccountEpoch = Number(window.__freevAccountEpoch || 0) + 1;
  saveCurrentGlobalsToAccount();
  saveAccountSystem();
  currentAccountId = id;
  multiViewMode = 'individual';
  selectedGroupIds.clear();
  loadCurrentAccountIntoGlobals();
  try { generateRecurringOccurrences(); } catch(e) {}
  syncAllUI();
  renderAccountsSidebar();
  updateViewModeUI();
  const acc = getCurrentAccount();
  showToast(`Compte "${acc?.name}" activé`, 'success');
}

function createAccount(name) {
  saveCurrentGlobalsToAccount();
  const acc = createAccountObj(name);
  accounts.push(acc);
  saveAccountSystem();
  renderAccountsSidebar();
  return acc;
}

function deleteAccount(id) {
  if (accounts.length <= 1) {
    showToast('Impossible de supprimer le seul compte', 'error');
    return;
  }
  const acc = accounts.find(a => a.id === id);
  if (!acc) return;
  const txCount = (acc.transactions || []).filter(t => !t.isRecurring && !t.parentId).length;

  // Custom confirm modal instead of browser confirm
  if (!confirm(`Supprimer le compte "${acc.name}" ?\n\n${txCount} transaction(s) seront perdues.\nUn bouton ANNULER apparaîtra pendant 8 secondes.`)) return;

  // Snapshot complet pour undo
  saveCurrentGlobalsToAccount();
  const backup = JSON.parse(JSON.stringify(acc));
  window.__freevAccountEpoch = Number(window.__freevAccountEpoch || 0) + 1;
  const previousUid = String(window.__freevUserId || '');
  const previousAuthEpoch = Number(window.__freevAuthEpoch || 0);

  accounts = accounts.filter(a => a.id !== id);
  Object.keys(localStorage).filter(key => key.startsWith('freevReceiptMerchantLearning_v1:') && key.endsWith(`:${encodeURIComponent(String(id))}`)).forEach(key => localStorage.removeItem(key));
  selectedGroupIds.delete(id);

  if (currentAccountId === id) {
    currentAccountId = accounts[0].id;
    multiViewMode = 'individual';
    loadCurrentAccountIntoGlobals();
    try { generateRecurringOccurrences(); } catch(e) {}
    syncAllUI();
  }
  saveAccountSystem();
  renderAccountsSidebar();
  renderAccountsModalList();

  const undoAccountId = currentAccountId;
  const undoEpoch = Number(window.__freevAccountEpoch || 0);
  showToast(`Compte "${acc.name}" supprimé`, 'neutral', true, () => {
    if (currentAccountId !== undoAccountId || Number(window.__freevAccountEpoch || 0) !== undoEpoch ||
        String(window.__freevUserId || '') !== previousUid ||
        Number(window.__freevAuthEpoch || 0) !== previousAuthEpoch ||
        accounts.some(account => String(account.id) === String(id))) return;
    // Restaurer le compte
    window.__freevAccountEpoch = undoEpoch + 1;
    accounts.push(backup);
    selectedGroupIds.add(id);
    currentAccountId = id;
    multiViewMode = 'individual';
    loadCurrentAccountIntoGlobals();
    try { generateRecurringOccurrences(); } catch(e) {}
    saveAccountSystem();
    syncAllUI();
    renderAccountsSidebar();
    renderAccountsModalList();
    showToast(`Compte "${acc.name}" restauré`, 'success');
  });
}

function renameAccount(id, newName) {
  const acc = accounts.find(a => a.id === id);
  if (!acc) return;
  acc.name = newName.trim();
  saveAccountSystem();
  renderAccountsSidebar();
  renderAccountsModalList();
  updateViewModeUI();
  showToast(`Compte renommé en "${newName}"`, 'success');
}

function setViewMode(mode) {
  saveCurrentGlobalsToAccount();
  multiViewMode = mode;
  if (mode === 'group' && selectedGroupIds.size === 0) {
    // Auto-sélectionner le compte courant en mode groupe
    selectedGroupIds.add(currentAccountId);
  }
  updateViewModeUI();
  syncAllUI();
  saveAccountSystem();
}

function toggleGroupAccount(id) {
  if (selectedGroupIds.has(id)) {
    selectedGroupIds.delete(id);
    if (selectedGroupIds.size === 0) selectedGroupIds.add(currentAccountId);
  } else {
    selectedGroupIds.add(id);
  }
  updateViewModeUI();
  syncAllUI();
  saveAccountSystem();
  renderAccountsSidebar();
}

// ===== RENDU UI COMPTES =====

function renderAccountsSidebar() {
  const container = document.getElementById('accountsSidebarList');
  if (!container) return;

  container.innerHTML = accounts.map((acc, idx) => {
    const isActive = acc.id === currentAccountId;
    const isGroupSelected = selectedGroupIds.has(acc.id);
    const isGroupMode = multiViewMode === 'group';
    const isGlobal = multiViewMode === 'global';
    const color = getAccountColor(idx);

    let itemClass = 'account-sidebar-item';
    if (isActive && multiViewMode === 'individual') itemClass += ' active';
    if (isGroupSelected && isGroupMode) itemClass += ' group-selected';
    if (isGlobal) itemClass += ' group-selected';

    let checkIcon = '';
    if (isActive && multiViewMode === 'individual') {
      checkIcon = '<i class="fa-solid fa-check account-sidebar-check"></i>';
    } else if ((isGroupSelected && isGroupMode) || isGlobal) {
      checkIcon = '<i class="fa-solid fa-check account-sidebar-check" style="color:#10b981;"></i>';
    }

    // ✅ FIX XSS : data-accid + event delegation
    const clickFn = multiViewMode === 'group' ? 'js-acc-toggle' : 'js-acc-switch';

    return `
      <div class="${itemClass} ${clickFn}" data-accid="${acc.id}" role="button" tabindex="0" aria-label="Compte ${escapeHTML(acc.name)}" aria-pressed="${(isActive && multiViewMode === 'individual') || isGroupSelected || isGlobal}" title="${escapeHTML(acc.name)}">
        <div class="account-avatar" style="background:${color};font-size:0.65rem;">
          ${escapeHTML(acc.name.charAt(0).toUpperCase())}
        </div>
        <span class="account-sidebar-name">${escapeHTML(acc.name)}</span>
        ${checkIcon}
      </div>
    `;
  }).join('');

  // Bind events via delegation (pas d'inline onclick = pas de XSS)
  container.querySelectorAll('.js-acc-switch, .js-acc-toggle').forEach(el => {
    const activate = () => el.classList.contains('js-acc-toggle')
      ? toggleGroupAccount(el.dataset.accid)
      : switchAccount(el.dataset.accid);
    el.addEventListener('click', activate);
    el.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      activate();
    });
  });
  renderAccountColorSetting();
}
function updateViewModeUI() {
  // Mettre à jour les tabs
  ['individual', 'group', 'global'].forEach(mode => {
    const btn = document.getElementById(`viewMode-${mode}`);
    if (btn) btn.classList.toggle('active-mode', multiViewMode === mode);
  });

  // Bannière groupe/global
  const banner = document.getElementById('groupViewBanner');
  const label = document.getElementById('groupViewLabel');
  const chips = document.getElementById('groupViewChips');

  if (!banner) return;

  if (multiViewMode === 'individual') {
    banner.style.display = 'none';
  } else {
    banner.style.display = 'flex';
    const viewAccs = getViewAccounts();

    if (multiViewMode === 'global') {
      banner.className = 'group-view-banner global';
      if (label) label.textContent = `Vue globale — ${accounts.length} compte(s)`;
    } else {
      banner.className = 'group-view-banner';
      if (label) label.textContent = `Vue groupée — ${viewAccs.length} compte(s) :`;
    }

    if (chips) {
      chips.innerHTML = viewAccs.map((a, idx) => {
        const color = getAccountColor(getAccountIndex(a.id));
        return `<span class="group-account-chip">
          <span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block;"></span>
          ${escapeHTML(a.name)}
        </span>`;
      }).join('');
    }
  }

  // Mettre à jour la sidebar
  renderAccountsSidebar();
}

// ===== MODAL COMPTES =====

function openAccountsModal() {
  const modal = document.getElementById('accountsModal');
  if (modal) modal.classList.remove('hidden');
  renderAccountsModalList();
  updateAccountsModalInfo();
}

function closeAccountsModal() {
  const modal = document.getElementById('accountsModal');
  if (modal) modal.classList.add('hidden');
}

function updateAccountsModalInfo() {
  const el = document.getElementById('accountsModalSubtitle');
  if (el) el.textContent = `${accounts.length} compte(s) • Cliquer sur un compte pour le sélectionner`;
  const info = document.getElementById('accountsModalInfo');
  if (info) {
    const total = accounts.reduce((s, a) => s + (a.transactions || []).filter(t => !t.isRecurring && !t.parentId).length, 0);
    info.textContent = `Total : ${total} transaction(s) sur tous les comptes`;
  }
}

function renderAccountsModalList() {
  const container = document.getElementById('accountsModalList');
  if (!container) return;

  container.innerHTML = accounts.map((acc, idx) => {
    const isActive = acc.id === currentAccountId;
    const color = getAccountColor(idx);
    const txCount = (acc.transactions || []).filter(t => !t.isRecurring && !t.parentId).length;
    const balance = computeAccountBalance(acc);
    const cur = (acc.settings?.baseCurrency || 'EUR');

    return `
      <div class="account-card-modal ${isActive ? 'active-account' : ''}">
        <div class="account-avatar-lg" style="background:${color};">
          ${escapeHTML(acc.name.charAt(0).toUpperCase())}
        </div>
        <div class="account-info">
          <div class="account-info-name">
            ${escapeHTML(acc.name)}
            ${isActive ? '<span class="account-active-pill">Actif</span>' : ''}
          </div>
          <div class="account-info-stats">
            ${txCount} transaction(s) &bull; Solde actuel : ${formatCurrencySimple(balance, cur)}
          </div>
        </div>
        <div class="account-card-actions">
          <button class="btn-icon js-modal-rename" data-accid="${acc.id}" title="Renommer">
            <i class="fa-solid fa-pencil"></i>
          </button>
          ${!isActive ? `<button class="btn-icon js-modal-switch" data-accid="${acc.id}" title="Activer ce compte">
            <i class="fa-solid fa-right-to-bracket"></i>
          </button>` : ''}
          ${accounts.length > 1 ? `<button class="btn-icon js-modal-delete" data-accid="${acc.id}" style="color:#ef4444;" title="Supprimer">
            <i class="fa-solid fa-trash"></i>
          </button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // ✅ FIX XSS : bind les events via JS, pas d'inline onclick avec IDs
  container.querySelectorAll('.js-modal-rename').forEach(btn =>
    btn.addEventListener('click', () => promptRenameAccount(btn.dataset.accid))
  );
  container.querySelectorAll('.js-modal-switch').forEach(btn =>
    btn.addEventListener('click', () => { switchAccount(btn.dataset.accid); closeAccountsModal(); })
  );
  container.querySelectorAll('.js-modal-delete').forEach(btn =>
    btn.addEventListener('click', () => deleteAccount(btn.dataset.accid))
  );
}

function computeAccountBalance(acc) {
  if (!acc) return 0;
  const todayISO = isoDate(new Date());
  const currency = String(acc.settings?.baseCurrency || 'EUR').toUpperCase();
  const result = globalThis.FREEVMoney?.computeBalanceMinor({
    initialCapital: acc.initialCapital ?? 0,
    transactions: acc.transactions || [],
    cutoffDate: todayISO,
    currency
  });
  if (!result?.ok) return NaN;
  return result.minor / (10 ** globalThis.FREEVMoney.minorDigits(currency));
}

function formatCurrencySimple(n, currency = 'EUR') {
  const value = n == null || n === '' ? 0 : Number(n);
  if (!Number.isFinite(value)) return 'À vérifier';
  try {
    const digits = globalThis.FREEVMoney?.minorDigits(currency) ?? 2;
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: digits }).format(value);
  } catch { return `${value.toFixed(globalThis.FREEVMoney?.minorDigits(currency) ?? 2)} ${currency}`; }
}

function promptRenameAccount(id) {
  const acc = accounts.find(a => a.id === id);
  if (!acc) return;
  const newName = prompt('Nouveau nom du compte :', acc.name);
  if (newName && newName.trim() && newName.trim() !== acc.name) {
    renameAccount(id, newName.trim());
    updateAccountsModalInfo();
  }
}

function promptCreateAccount() {
  const name = prompt('Nom du nouveau compte :', 'Nouveau compte');
  if (name && name.trim()) {
    const acc = createAccount(name.trim());
    showToast(`Compte "${name.trim()}" créé`, 'success');
    renderAccountsModalList();
    updateAccountsModalInfo();
  }
}

function createAccountFromModal() {
  const input = document.getElementById('newAccountNameInput');
  const name = input?.value?.trim();
  if (!name) { showToast('Entrez un nom de compte', 'error'); return; }
  createAccount(name);
  showToast(`Compte "${name}" créé`, 'success');
  if (input) input.value = '';
  renderAccountsModalList();
  updateAccountsModalInfo();
}

// ============================================================
// ===== FIN SYSTÈME MULTI-COMPTES ============================
// ============================================================
