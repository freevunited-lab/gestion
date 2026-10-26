const FREEV_LAYOUT_GROUP_KEYS = Object.freeze({
  dashboardMetrics: ['balance', 'income', 'expenses', 'savings'],
  dashboardSections: ['alerts', 'budget', 'spendable', 'financeTracking', 'charts', 'recent'],
  operationHelpers: ['templates', 'completion', 'drafts'],
  recurringSections: ['summary', 'occurrences', 'calendar'],
  analyticsSections: ['stats', 'insights', 'dailyBalance', 'balanceTrend', 'monthlyFlow', 'weekday', 'categories'],
  plannerOverview: ['summary', 'insights'],
  plannerInsights: ['health', 'actions'],
  plannerForecast: ['forecast'],
  plannerTools: ['goals', 'envelopes', 'calendar'],
  savingsSections: ['summary', 'accounts'],
  debtSections: ['summary', 'details'],
  historySections: ['events'],
  smartOverview: ['summary'],
  smartOverviewSections: ['intelligence', 'changes', 'priorityHeading', 'priorities'],
  smartMonthCheck: ['monthVerification'],
  smartRules: ['ruleBuilder', 'ruleSuggestions'],
  smartRuleHistory: ['ruleList'],
  smartSubscriptions: ['subscriptionsManager'],
  smartImportSections: ['statementTools', 'importUndo'],
  smartImportTools: ['statementImport', 'importPreview'],
  smartWealthSections: ['wealthSummary', 'assets'],
  smartWealthAssets: ['assetForm', 'assetList'],
  smartSecuritySections: ['securitySettings', 'securityNote'],
  smartSecurityCards: ['deviceSettings', 'recentSessions']
});

const FREEV_LAYOUT_SCOPES = Object.freeze({
  dashboard: 'Tableau de bord',
  operations: 'Opérations',
  recurring: 'Récurrences',
  analytics: 'Analyses',
  planner: 'Planificateur',
  smart: 'Centre intelligent',
  savings: 'Épargne',
  debts: 'Dettes',
  history: 'Historique'
});

const freevLayoutEscape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

function freevLayoutAccount() {
  const state = window._getAppState?.();
  return state?.accounts?.find(account => account.id === state.currentAccountId) || state?.accounts?.[0] || null;
}

function freevLayoutRecord(account = freevLayoutAccount()) {
  const layout = account?.presentationSettings?.layout;
  return {
    hidden: layout?.hidden && typeof layout.hidden === 'object' ? layout.hidden : {},
    order: layout?.order && typeof layout.order === 'object' ? layout.order : {}
  };
}

function freevLayoutItems(scope) {
  if (!Object.prototype.hasOwnProperty.call(FREEV_LAYOUT_SCOPES, scope)) return [];
  return [...document.querySelectorAll('[data-freev-layout-scope]')]
    .filter(element => element.dataset.freevLayoutScope === scope && FREEV_LAYOUT_GROUP_KEYS[element.dataset.freevLayoutGroup]?.includes(element.dataset.freevLayoutKey))
    .map(element => ({
      element,
      scope,
      group: element.dataset.freevLayoutGroup,
      key: element.dataset.freevLayoutKey,
      label: element.dataset.freevLayoutLabel || element.dataset.freevLayoutKey
    }));
}

function freevOrderedGroup(items, record) {
  const byGroup = new Map();
  items.forEach(item => byGroup.set(item.group, [...(byGroup.get(item.group) || []), item]));
  byGroup.forEach((groupItems, group) => {
    const keys = Array.isArray(record.order[group]) ? record.order[group] : [];
    const position = new Map(keys.map((key, index) => [key, index]));
    groupItems.sort((a, b) => {
      const aIndex = position.has(a.key) ? position.get(a.key) : Number.MAX_SAFE_INTEGER;
      const bIndex = position.has(b.key) ? position.get(b.key) : Number.MAX_SAFE_INTEGER;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  });
  return byGroup;
}

function applyFreevLayoutPreferences() {
  const account = freevLayoutAccount();
  const record = freevLayoutRecord(account);
  const allItems = [...document.querySelectorAll('[data-freev-layout-scope]')]
    .filter(element => Object.prototype.hasOwnProperty.call(FREEV_LAYOUT_SCOPES, element.dataset.freevLayoutScope));
  allItems.forEach(element => {
    const hiddenKeys = Array.isArray(record.hidden[element.dataset.freevLayoutScope]) ? record.hidden[element.dataset.freevLayoutScope] : [];
    const hidden = element.dataset.freevLayoutRequired !== 'true' && hiddenKeys.includes(element.dataset.freevLayoutKey);
    element.classList.toggle('freev-layout-hidden', hidden);
    element.setAttribute('aria-hidden', hidden ? 'true' : 'false');
  });

  const items = allItems
    .filter(element => FREEV_LAYOUT_GROUP_KEYS[element.dataset.freevLayoutGroup]?.includes(element.dataset.freevLayoutKey))
    .map(element => ({ element, group: element.dataset.freevLayoutGroup, key: element.dataset.freevLayoutKey }));
  const grouped = new Map();
  items.forEach(item => grouped.set(item.group, [...(grouped.get(item.group) || []), item]));
  grouped.forEach((groupItems, group) => {
    const parent = groupItems[0]?.element.parentElement;
    if (!parent || groupItems.some(item => item.element.parentElement !== parent)) return;
    const keys = Array.isArray(record.order[group]) ? record.order[group] : [];
    const positions = new Map(keys.map((key, index) => [key, index]));
    const current = [...parent.children];
    const selected = new Set(groupItems.map(item => item.element));
    const slots = current.map((element, index) => selected.has(element) ? index : -1).filter(index => index >= 0);
    const sorted = [...groupItems].sort((a, b) => {
      const ai = positions.has(a.key) ? positions.get(a.key) : Number.MAX_SAFE_INTEGER;
      const bi = positions.has(b.key) ? positions.get(b.key) : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    slots.forEach((slot, index) => { current[slot] = sorted[index].element; });
    if (slots.length > 1) parent.replaceChildren(...current);
  });
}

function saveFreevLayoutRecord(record, { scope, focusKey, focusAction = 'toggle', status = 'Disposition enregistrée pour le compte actif.' } = {}) {
  const account = freevLayoutAccount();
  if (!account) return;
  account.presentationSettings = {
    ...(account.presentationSettings && typeof account.presentationSettings === 'object' ? account.presentationSettings : {}),
    layout: record
  };
  window.saveData?.();
  applyFreevLayoutPreferences();
  renderFreevLayoutControls({ scope, focusKey, focusAction, status });
}

function renderFreevLayoutControls({ scope, focusKey, focusAction = 'toggle', status = '' } = {}) {
  const select = document.getElementById('freevLayoutScope');
  const list = document.getElementById('freevLayoutList');
  const accountName = document.getElementById('freevLayoutAccountName');
  const statusEl = document.getElementById('freevLayoutStatus');
  if (!select || !list) return;
  if (scope && [...select.options].some(option => option.value === scope)) select.value = scope;
  const activeScope = select.value;
  // Le panneau des dettes est généré à la première ouverture de cet espace.
  // Le construire ici permet de configurer sa disposition depuis Paramètres
  // même si l’utilisateur n’a pas encore visité la vue Dettes.
  if (activeScope === 'debts' && !document.querySelector('#debtsSummary [data-freev-layout-scope="debts"]')) window.renderDebts?.();
  const account = freevLayoutAccount();
  const record = freevLayoutRecord(account);
  const items = freevLayoutItems(activeScope);
  const grouped = freevOrderedGroup(items, record);
  const hiddenKeys = new Set(Array.isArray(record.hidden[activeScope]) ? record.hidden[activeScope] : []);
  if (accountName) accountName.textContent = account ? `Compte : ${account.name}` : 'Aucun compte actif';

  const sections = [...grouped.entries()].map(([group, groupItems]) => {
    const rows = groupItems.map((item, index) => {
      const inputId = `freev-layout-${activeScope}-${item.key}`;
      const upDisabled = index === 0 ? 'disabled' : '';
      const downDisabled = index === groupItems.length - 1 ? 'disabled' : '';
      const required = item.element.dataset.freevLayoutRequired === 'true';
      return `<li class="freev-layout-row"><label for="${freevLayoutEscape(inputId)}" class="freev-layout-visibility"><input id="${freevLayoutEscape(inputId)}" type="checkbox" data-freev-layout-toggle="${freevLayoutEscape(item.key)}" ${required || !hiddenKeys.has(item.key) ? 'checked' : ''} ${required ? 'disabled' : ''}><span class="freev-layout-check-mark" aria-hidden="true"></span><span>${required ? 'Toujours visible' : 'Afficher'}</span></label><div class="freev-layout-label"><strong>${freevLayoutEscape(item.label)}</strong><small>Groupe ${freevLayoutEscape(groupItems[0]?.element.parentElement?.getAttribute('aria-label') || FREEV_LAYOUT_SCOPES[activeScope])}</small></div><div class="freev-layout-move"><button type="button" class="btn btn-secondary btn-sm" data-freev-layout-move="up" data-freev-layout-key="${freevLayoutEscape(item.key)}" aria-label="Monter ${freevLayoutEscape(item.label)} dans l’ordre" ${upDisabled}>↑</button><button type="button" class="btn btn-secondary btn-sm" data-freev-layout-move="down" data-freev-layout-key="${freevLayoutEscape(item.key)}" aria-label="Descendre ${freevLayoutEscape(item.label)} dans l’ordre" ${downDisabled}>↓</button></div></li>`;
    }).join('');
    return `<li class="freev-layout-group"><h3>${freevLayoutEscape(groupItems[0]?.element.parentElement?.getAttribute('aria-label') || FREEV_LAYOUT_SCOPES[activeScope])}</h3><ol>${rows}</ol></li>`;
  }).join('');
  list.innerHTML = sections || '<li class="freev-layout-empty">Aucun bloc personnalisable dans cet espace pour le moment.</li>';
  if (statusEl) statusEl.textContent = status;
  if (focusKey) {
    const escaped = CSS.escape(focusKey);
    const focusTarget = list.querySelector(`[data-freev-layout-toggle="${escaped}"]`) || list.querySelector(`[data-freev-layout-key="${escaped}"][data-freev-layout-move="${focusAction}"]`);
    focusTarget?.focus();
  }
}

function updateFreevLayoutVisibility(key, isVisible) {
  const select = document.getElementById('freevLayoutScope');
  const scope = select?.value;
  if (!scope || !freevLayoutItems(scope).some(item => item.key === key)) return;
  if (freevLayoutItems(scope).find(item => item.key === key)?.element.dataset.freevLayoutRequired === 'true') return;
  const record = freevLayoutRecord();
  const hidden = new Set(Array.isArray(record.hidden[scope]) ? record.hidden[scope] : []);
  if (isVisible) hidden.delete(key);
  else hidden.add(key);
  const cleanHidden = Object.fromEntries(Object.entries(record.hidden).filter(([savedScope]) => Object.hasOwn(FREEV_LAYOUT_SCOPES, savedScope)));
  cleanHidden[scope] = [...hidden];
  saveFreevLayoutRecord({ hidden: cleanHidden, order: record.order }, { scope, focusKey: key, status: isVisible ? 'Bloc affiché.' : 'Bloc masqué. Vous pouvez le réafficher ici.' });
}

function moveFreevLayoutItem(key, direction) {
  const scope = document.getElementById('freevLayoutScope')?.value;
  if (!scope) return;
  const record = freevLayoutRecord();
  const grouped = freevOrderedGroup(freevLayoutItems(scope), record);
  const item = [...grouped.values()].flat().find(candidate => candidate.key === key);
  if (!item) return;
  const order = { ...record.order };
  const items = grouped.get(item.group) || [];
  const currentIndex = items.findIndex(candidate => candidate.key === key);
  const targetIndex = currentIndex + (direction === 'up' ? -1 : 1);
  if (targetIndex < 0 || targetIndex >= items.length) return;
  const nextKeys = items.map(candidate => candidate.key);
  [nextKeys[currentIndex], nextKeys[targetIndex]] = [nextKeys[targetIndex], nextKeys[currentIndex]];
  order[item.group] = nextKeys;
  saveFreevLayoutRecord({ hidden: record.hidden, order }, { scope, focusKey: key, focusAction: direction, status: 'Ordre des blocs enregistré. Vous pouvez aussi utiliser les boutons avec le clavier.' });
}

function resetFreevLayout() {
  const account = freevLayoutAccount();
  if (!account) return;
  if (account.presentationSettings && typeof account.presentationSettings === 'object') {
    delete account.presentationSettings.layout;
    if (!Object.keys(account.presentationSettings).length) delete account.presentationSettings;
  }
  window.saveData?.();
  applyFreevLayoutPreferences();
  renderFreevLayoutControls({ status: 'Disposition par défaut rétablie pour le compte actif. Aucune opération n’a été modifiée.' });
}

function initFreevLayoutPreferences() {
  document.getElementById('freevLayoutScope')?.addEventListener('change', () => renderFreevLayoutControls());
  document.getElementById('freevLayoutReset')?.addEventListener('click', resetFreevLayout);
  document.getElementById('freevLayoutList')?.addEventListener('change', event => {
    const input = event.target.closest('[data-freev-layout-toggle]');
    if (input) updateFreevLayoutVisibility(input.dataset.freevLayoutToggle, input.checked);
  });
  document.getElementById('freevLayoutList')?.addEventListener('click', event => {
    const button = event.target.closest('[data-freev-layout-move]');
    if (button) moveFreevLayoutItem(button.dataset.freevLayoutKey, button.dataset.freevLayoutMove);
  });
  renderFreevLayoutControls();
  applyFreevLayoutPreferences();
}

window.applyFreevLayoutPreferences = applyFreevLayoutPreferences;
window.renderFreevLayoutControls = renderFreevLayoutControls;
window.addEventListener('freev:ready', applyFreevLayoutPreferences);
document.addEventListener('DOMContentLoaded', initFreevLayoutPreferences, { once: true });
