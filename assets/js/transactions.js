// ---------- Transactions rendering + filters ----------
let transactionRenderLimit = 100;
let transactionFilterTimer = null;

function refreshCategoryFilter() {
  const sel = document.getElementById('txCategoryFilter');
  if (!sel) return;
  const srcTx = (typeof multiViewMode !== 'undefined' && multiViewMode !== 'individual')
    ? getDisplayTransactions() : transactions;
  const usedCats = Array.from(new Set(srcTx.filter(t => !t.isRecurring).map(t => t.category || 'Autre')));
  const allDefinedCats = getAllCategories().map(c => c.name);
  const cats = Array.from(new Set([...usedCats, ...allDefinedCats])).sort();
  const current = sel.value;
  sel.innerHTML = '<option value="">Toutes catégories</option>' + cats.map(c=>`<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
  if (current) sel.value = current;
}

function applyTxFilters(debounce = false) {
  transactionRenderLimit = 100;
  // La recherche texte et les seuils de prix peuvent produire des dizaines
  // d'événements de saisie. Les sélecteurs et les dates restent immédiats.
  if (transactionFilterTimer !== null) clearTimeout(transactionFilterTimer);
  transactionFilterTimer = null;
  if (debounce === true) {
    transactionFilterTimer = setTimeout(() => {
      transactionFilterTimer = null;
      if (currentView === 'transactions') renderAllTransactions();
    }, 140);
    return;
  }
  renderAllTransactions();
}

function clearTxFilters() {
  if (transactionFilterTimer !== null) clearTimeout(transactionFilterTimer);
  transactionFilterTimer = null;
  transactionRenderLimit = 100;
  ['txSearch','txTypeFilter','txModeFilter','txCategoryFilter','txMin','txMax','txFrom','txTo'].forEach(id=>{
    const el=document.getElementById(id);
    if (!el) return;
    el.value = '';
  });
  const completionFilter = document.getElementById('txCompletionFilter');
  if (completionFilter) completionFilter.value = '';
  renderAllTransactions();
}

function getFilteredTransactions() {
  // En mode multi-compte, on utilise les transactions de tous les comptes visibles
  const baseList = (multiViewMode === 'individual' ? transactions : getDisplayTransactions())
    .filter(t => !t.isRecurring);
  let list = baseList.slice();

  const q = (document.getElementById('txSearch')?.value || '').toLowerCase().trim();
  const typeF = document.getElementById('txTypeFilter')?.value || '';
  const modeF = document.getElementById('txModeFilter')?.value || '';
  const catF = document.getElementById('txCategoryFilter')?.value || '';
  const completionF = document.getElementById('txCompletionFilter')?.value || '';
  const minV = safeNumber(document.getElementById('txMin')?.value, NaN);
  const maxV = safeNumber(document.getElementById('txMax')?.value, NaN);
  let from = document.getElementById('txFrom')?.value || '';
  let to = document.getElementById('txTo')?.value || '';

  if (!from && !to && completionF !== 'incomplete') {
    const selectedMonth = document.getElementById('globalMonthPicker')?.value || isoMonth();
    const [year, month] = selectedMonth.split('-').map(Number);
    from = `${selectedMonth}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    to = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;
  }

  monthsBetweenISO(from, to).forEach(m => {
    list.push(...getProjectedRecurringTransactions(m, baseList));
  });

  if (q) list = list.filter(t => {
    const hay = `${t.desc||''} ${t.category||''} ${(t.tags||[]).join(' ')} ${(t.mode||'')} ${t._accountName||''}`.toLowerCase();
    return hay.includes(q);
  });
  if (typeF) list = list.filter(t => t.type === typeF);
  if (modeF) list = list.filter(t => (t.mode||'personal') === modeF);
  if (catF) list = list.filter(t => (t.category||'') === catF);
  if (completionF === 'incomplete') list = list.filter(isTransactionIncomplete);
  else if (completionF === 'complete') list = list.filter(t => !isTransactionIncomplete(t));
  if (Number.isFinite(minV)) list = list.filter(t => (Number(t.amountBase ?? t.amount) || 0) >= minV);
  if (Number.isFinite(maxV)) list = list.filter(t => (Number(t.amountBase ?? t.amount) || 0) <= maxV);
  if (from) list = list.filter(t => (t.date||'') >= from);
  if (to) list = list.filter(t => (t.date||'') <= to);

  const info = document.getElementById('txFilterInfo');
  if (info) {
    let txt = `${list.length} transaction(s) affichée(s)`;
    if (multiViewMode !== 'individual') {
      const accNames = getViewAccounts().map(a => a.name).join(', ');
      txt += ` · ${multiViewMode === 'global' ? 'Tous les comptes' : accNames}`;
    }
    info.textContent = txt;
  }

  return list;
}

function isTransactionIncomplete(transaction) {
  return !!transaction && (!String(transaction.category || '').trim() || !String(transaction.desc || '').trim());
}

// Le lien à la règle est plus fiable que le montant : un abonnement peut
// augmenter ou diminuer sans devenir une nouvelle série.
function groupIncompleteRecurringTransactions(incomplete, accountId) {
  const groups = new Map();
  const separate = [];
  for (const transaction of incomplete) {
    const ruleId = String(transaction?.parentId || '');
    if (!ruleId || String(transaction.desc || '').trim()) {
      separate.push(transaction);
      continue;
    }
    const ownerId = String(transaction._accountId || accountId || '');
    const key = `${ownerId}\u0000${ruleId}`;
    if (!groups.has(key)) groups.set(key, { accountId: ownerId, ruleId, transactions: [] });
    groups.get(key).transactions.push(transaction);
  }
  return { groups: [...groups.values()], separate };
}

function getTransactionTemplateStore() {
  return typeof transactionTemplates !== 'undefined' && Array.isArray(transactionTemplates) ? transactionTemplates : [];
}

function setTransactionTemplateStore(value) {
  if (typeof transactionTemplates !== 'undefined') transactionTemplates = Array.isArray(value) ? value : [];
  return getTransactionTemplateStore();
}

function getTransactionDraftStore() {
  return typeof transactionDrafts !== 'undefined' && Array.isArray(transactionDrafts) ? transactionDrafts : [];
}

function setTransactionDraftStore(value) {
  if (typeof transactionDrafts !== 'undefined') transactionDrafts = Array.isArray(value) ? value : [];
  return getTransactionDraftStore();
}

function getTransactionTypeLabel(type) {
  return type === 'income' ? 'Revenu' : type === 'transfer' ? 'Transfert' : type === 'savings_withdrawal' ? 'Retrait épargne' : type === 'inter_account' ? 'Transfert entre comptes' : 'Dépense';
}

function renderTransactionTemplates() {
  const select = document.getElementById('transactionTemplateSelect');
  const list = document.getElementById('transactionTemplatesList');
  const templates = getTransactionTemplateStore()
    .slice().sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || String(a.name || '').localeCompare(String(b.name || ''), 'fr'));
  if (select) {
    const selected = select.value;
    select.innerHTML = '<option value="">Choisir un modèle…</option>' + templates.map(template =>
      `<option value="${escapeHTML(String(template.id))}">${template.favorite ? '★ ' : ''}${escapeHTML(template.name || 'Modèle sans nom')}</option>`
    ).join('');
    if (templates.some(template => String(template.id) === selected)) select.value = selected;
    const useButton = document.getElementById('useTransactionTemplateButton');
    if (useButton) useButton.disabled = templates.length === 0;
  }
  if (!list) return;
  if (!templates.length) {
    list.innerHTML = '<p class="text-sm text-slate-500">Aucun modèle enregistré pour ce compte.</p>';
    return;
  }
  list.innerHTML = templates.map(template => {
    const amount = String(template.amount || '').trim();
    const summary = [getTransactionTypeLabel(template.type), template.category || 'Sans catégorie', amount ? `${amount} ${template.currency || settings.baseCurrency || 'EUR'}` : 'Montant à saisir'].join(' · ');
    return `<div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;padding:.55rem .7rem;border:1px solid #e2e8f0;border-radius:.65rem;background:#fff;">
      <span style="flex:1;min-width:180px;"><strong>${escapeHTML(template.name || 'Modèle sans nom')}</strong><span class="text-sm text-slate-500" style="display:block;">${escapeHTML(summary)}</span></span>
      <button type="button" class="btn-icon js-template-favorite" data-id="${escapeHTML(String(template.id))}" aria-label="${template.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}" title="${template.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${template.favorite ? '★' : '☆'}</button>
      <button type="button" class="btn btn-secondary btn-sm js-template-rename" data-id="${escapeHTML(String(template.id))}">Renommer</button>
      <button type="button" class="btn btn-secondary btn-sm js-template-delete" data-id="${escapeHTML(String(template.id))}">Supprimer</button>
    </div>`;
  }).join('');
  list.querySelectorAll('.js-template-favorite').forEach(button => button.addEventListener('click', () => toggleTransactionTemplateFavorite(button.dataset.id)));
  list.querySelectorAll('.js-template-rename').forEach(button => button.addEventListener('click', () => renameTransactionTemplate(button.dataset.id)));
  list.querySelectorAll('.js-template-delete').forEach(button => button.addEventListener('click', () => deleteTransactionTemplate(button.dataset.id)));
}

function renderIncompleteTransactions() {
  const panel = document.getElementById('transactionCompletionPanel');
  const list = document.getElementById('transactionCompletionList');
  const count = document.getElementById('transactionCompletionCount');
  if (!panel || !list) return;
  const multi = multiViewMode !== 'individual';
  const incomplete = (multi ? getDisplayTransactions() : transactions).filter(t => !t.isRecurring && !t.projected && isTransactionIncomplete(t));
  panel.hidden = incomplete.length === 0;
  if (!incomplete.length) {
    list.innerHTML = '';
    return;
  }
  const sections = groupIncompleteRecurringTransactions(incomplete, currentAccountId);
  const accountLookup = new Map((multi ? getViewAccounts() : [getCurrentAccount()].filter(Boolean))
    .map(account => [String(account.id), account]));
  const latestDate = group => group.transactions.reduce((latest, item) => String(item.date || '') > latest ? String(item.date) : latest, '');
  sections.groups.sort((a, b) => latestDate(b).localeCompare(latestDate(a)));
  if (count) count.textContent = `${sections.groups.length} série${sections.groups.length > 1 ? 's' : ''} · ${incomplete.length} opération${incomplete.length > 1 ? 's' : ''}`;

  const seriesHTML = sections.groups.map((group, index) => {
    const account = accountLookup.get(group.accountId);
    const rule = (multi ? account?.recurringTransactions : recurringTransactions)?.find(item => String(item.id) === group.ruleId);
    const ordered = group.transactions.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const title = String(rule?.desc || rule?.category || ordered[0]?.category || 'Série récurrente').trim();
    const amounts = [...new Set(ordered.map(item => Number(item.amountBase ?? item.amount)).filter(Number.isFinite))].sort((a, b) => a - b);
    const currency = account?.settings?.baseCurrency || settings?.baseCurrency || 'EUR';
    const amountLabel = amounts.length > 1
      ? `${formatCurrency(amounts[0], currency)} → ${formatCurrency(amounts.at(-1), currency)}`
      : amounts.length ? formatCurrency(amounts[0], currency) : '';
    const dates = ordered.length > 1 ? `${ordered[0].date} → ${ordered.at(-1).date}` : ordered[0].date || 'Date inconnue';
    const accountLabel = multi ? ` · ${account?.name || 'Compte'}` : '';
    const meta = `${ordered.length} opération${ordered.length > 1 ? 's' : ''} sans description · ${dates}${amountLabel ? ` · ${amountLabel}` : ''}${amounts.length > 1 ? ' · tarif variable' : ''}${accountLabel}`;
    const action = multi
      ? `<button type="button" class="btn btn-secondary btn-sm js-incomplete-switch" data-account-id="${escapeHTML(group.accountId)}">Ouvrir ce compte</button>`
      : `<form class="completion-series-form" data-rule-id="${escapeHTML(group.ruleId)}" data-account-id="${escapeHTML(group.accountId)}"><label class="sr-only" for="completion-series-${index}">Description de ${escapeHTML(title)}</label><input id="completion-series-${index}" class="form-input" name="description" maxlength="120" autocomplete="off" placeholder="Ex. Internet, salaire…" value="${escapeHTML(String(rule?.desc || '').trim())}" required><button type="submit" class="btn btn-primary btn-sm">Appliquer à ${ordered.length}</button></form>`;
    return `<article class="completion-series"><span class="completion-series-icon" aria-hidden="true"><i class="fa-solid fa-repeat"></i></span><div class="completion-series-body"><strong>${escapeHTML(title)}</strong><span>${escapeHTML(meta)}</span><small>Une description pour cette série. Les montants, les dates et les descriptions déjà personnalisées ne changent pas.</small>${action}</div></article>`;
  }).join('');

  const separateHTML = sections.separate.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).map(t => {
    const missing = [!String(t.category || '').trim() ? 'catégorie' : '', !String(t.desc || '').trim() ? 'description' : ''].filter(Boolean).join(' et ');
    const action = multi
      ? `<button type="button" class="btn btn-secondary btn-sm js-incomplete-switch" data-account-id="${escapeHTML(String(t._accountId || currentAccountId || ''))}">Ouvrir le compte</button>`
      : `<button type="button" class="btn btn-secondary btn-sm js-incomplete-edit" data-id="${escapeHTML(String(t.id || ''))}">Compléter</button>`;
    return `<div class="completion-single">
      <span style="flex:1;min-width:200px;"><strong>${escapeHTML(getTransactionTypeLabel(t.fromSavings ? 'savings_withdrawal' : t.type))} · ${escapeHTML(formatCurrency(Number(t.amountBase ?? t.amount) || 0))}</strong><span class="text-sm text-slate-500" style="display:block;">${escapeHTML(t.date || 'Date inconnue')} · Champs à renseigner : ${escapeHTML(missing)}</span></span>${action}
    </div>`;
  }).join('');
  const otherCount = sections.separate.length;
  list.innerHTML = `${seriesHTML}${otherCount ? `<details class="completion-other" ${sections.groups.length ? '' : 'open'}><summary>${otherCount} autre${otherCount > 1 ? 's' : ''} opération${otherCount > 1 ? 's' : ''} à compléter</summary><div class="completion-other-list">${separateHTML}</div></details>` : ''}`;
  list.querySelectorAll('.completion-series-form').forEach(form => form.addEventListener('submit', event => {
    event.preventDefault();
    completeRecurringDescription(form.dataset.ruleId, form.dataset.accountId,
      form.elements.namedItem('description')?.value || '');
  }));
  list.querySelectorAll('.js-incomplete-edit').forEach(button => button.addEventListener('click', () => openModalById(button.dataset.id)));
  list.querySelectorAll('.js-incomplete-switch').forEach(button => button.addEventListener('click', () => switchAccount(button.dataset.accountId || '')));
}

function completeRecurringDescription(ruleId, accountId, rawDescription) {
  if (multiViewMode !== 'individual' || String(accountId) !== String(currentAccountId))
    return showToast('Ouvrez le compte de cet abonnement avant de le modifier.', 'info');
  const description = String(rawDescription || '').trim();
  if (!description || description.length > 120 || /[\u0000-\u001f\u007f]/.test(description))
    return showToast('Saisissez une description de 1 à 120 caractères.', 'error');
  const matches = transactions.filter(item => !item.isRecurring && !item.projected &&
    String(item.parentId || '') === String(ruleId) && !String(item.desc || '').trim());
  if (!matches.length) return showToast('Aucune opération à compléter dans cette série.', 'info');
  const rule = recurringTransactions.find(item => String(item.id) === String(ruleId));
  const previousDescription = String(rule?.desc || '');
  matches.forEach(item => { item.desc = description; });
  if (rule) rule.desc = description;
  logAction('complete_recurring_description', 'recurring',
    { ruleId, description: previousDescription, count: matches.length },
    { ruleId, description, count: matches.length });
  saveData();
  syncAllUI();
  showToast(`${matches.length} opération${matches.length > 1 ? 's' : ''} complétée${matches.length > 1 ? 's' : ''} pour cette série.`, 'success');
}

function renderTransactionDrafts() {
  const list = document.getElementById('transactionDraftsList');
  const count = document.getElementById('transactionDraftCount');
  if (!list) return;
  const drafts = getTransactionDraftStore();
  if (count) count.textContent = `${drafts.length} brouillon${drafts.length > 1 ? 's' : ''}`;
  if (!drafts.length) {
    list.innerHTML = '<p class="text-sm text-slate-500">Aucun brouillon en attente.</p>';
    return;
  }
  list.innerHTML = drafts.slice().sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))).map(draft => {
    const amount = String(draft.amount || '').trim();
    const summary = [getTransactionTypeLabel(draft.type), draft.date || 'Date à saisir', amount ? `${amount} ${draft.currency || settings.baseCurrency || 'EUR'}` : 'Montant à saisir', draft.category || 'Sans catégorie', draft.desc || 'Sans description'].join(' · ');
    return `<div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;padding:.55rem .7rem;border:1px solid #e2e8f0;border-radius:.65rem;background:#fff;">
      <span style="flex:1;min-width:220px;"><strong>${escapeHTML(summary)}</strong><span class="text-sm text-slate-500" style="display:block;">Enregistré le ${escapeHTML(new Date(draft.updatedAt || draft.createdAt || Date.now()).toLocaleDateString('fr-FR'))} · aucun effet comptable</span></span>
      <button type="button" class="btn btn-secondary btn-sm js-draft-continue" data-id="${escapeHTML(String(draft.id))}">Continuer</button>
      <button type="button" class="btn btn-secondary btn-sm js-draft-delete" data-id="${escapeHTML(String(draft.id))}">Supprimer</button>
    </div>`;
  }).join('');
  list.querySelectorAll('.js-draft-continue').forEach(button => button.addEventListener('click', () => continueTransactionDraft(button.dataset.id)));
  list.querySelectorAll('.js-draft-delete').forEach(button => button.addEventListener('click', () => deleteTransactionDraft(button.dataset.id)));
}

function applySelectedTransactionTemplate() {
  const id = document.getElementById('transactionTemplateSelect')?.value || '';
  if (!id) return showToast('Choisissez un modèle', 'info');
  const template = getTransactionTemplateStore().find(item => String(item.id) === String(id));
  if (!template) return showToast('Modèle introuvable', 'error');
  applyTransactionTemplate(template);
}

function applyTransactionTemplate(template) {
  if (template.accountId && String(template.accountId) !== String(currentAccountId)) {
    const account = accounts.find(item => String(item.id) === String(template.accountId));
    return showToast(account ? `Sélectionnez le compte « ${account.name} » pour utiliser ce modèle.` : 'Le compte de ce modèle n’existe plus. Choisissez un compte valide.', 'info');
  }
  const accountName = getCurrentAccount()?.name || 'compte courant';
  const amountSummary = String(template.amount || '').trim() ? `${template.amount} ${template.currency || settings.baseCurrency || 'EUR'}` : 'montant à saisir';
  const categorySummary = template.category || 'sans catégorie';
  const descriptionSummary = template.desc || 'sans description';
  if (!confirm(`Préremplir le formulaire avec « ${template.name || 'Modèle sans nom'} » (${getTransactionTypeLabel(template.type)}, ${amountSummary}, ${categorySummary}, ${descriptionSummary}, ${accountName}) ? Aucune opération ne sera créée avant votre enregistrement.`)) return;
  openModal();
  const typeEl = document.getElementById('transType');
  if (typeEl && [...typeEl.options].some(option => option.value === template.type)) typeEl.value = template.type;
  const incomeClassEl = document.getElementById('transIncomeClass');
  if (incomeClassEl) incomeClassEl.value = template.incomeClass || '';
  const categoryEl = document.getElementById('transCategory');
  const categoryExists = !template.category || [...(categoryEl?.options || [])].some(option => option.value === template.category);
  if (categoryEl) {
    categoryEl.value = categoryExists ? (template.category || '') : '';
    categoryEl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const amountEl = document.getElementById('transAmount');
  if (amountEl) amountEl.value = template.amount || '';
  const dateEl = document.getElementById('transDate');
  if (dateEl) dateEl.value = isoDate(getToday());
  const descEl = document.getElementById('transDesc');
  if (descEl) descEl.value = template.desc || '';
  const tagsEl = document.getElementById('transTags');
  if (tagsEl) tagsEl.value = (template.tags || []).join(', ');
  const modeEl = document.getElementById('transMode');
  if (modeEl) modeEl.value = template.mode || settings.defaultMode || 'personal';
  const currencyEl = document.getElementById('transCurrency');
  if (currencyEl && [...currencyEl.options].some(option => option.value === template.currency)) currencyEl.value = template.currency;
  const rateEl = document.getElementById('transFxRate');
  if (rateEl) rateEl.value = template.fxRate || '';
  const statusEl = document.getElementById('transPaymentStatus');
  if (statusEl) statusEl.value = 'paid';
  const recurringEl = document.getElementById('isRecurring');
  if (recurringEl) recurringEl.checked = false;
  document.getElementById('recurOptions')?.classList.add('hidden');
  document.getElementById('editId').value = '';
  document.getElementById('transactionDraftId').value = '';
  toggleFxRate();
  handleTypeChange(); updatePaymentStatusControl();
  if (!categoryExists) showToast('La catégorie de ce modèle n’existe plus. Choisissez une catégorie de remplacement.', 'info');
}

function saveTransactionAsTemplate() {
  const nameInput = document.getElementById('transTemplateName');
  const type = document.getElementById('transType')?.value || 'expense';
  const category = String(document.getElementById('transCategory')?.value || '').trim();
  const amountRaw = String(document.getElementById('transAmount')?.value || '').trim();
  const currency = String(document.getElementById('transCurrency')?.value || settings.baseCurrency || 'EUR').toUpperCase();
  if (amountRaw) {
    const parsed = globalThis.FREEVMoney?.parseAmount(amountRaw, currency, 'amount');
    if (!parsed?.ok || parsed.minor <= 0) return showToast('Le montant du modèle est invalide. Corrigez-le ou laissez-le vide.', 'error');
  }
  const name = String(nameInput?.value || '').trim() || `${getTransactionTypeLabel(type)}${category ? ` · ${category}` : ''}`;
  const template = {
    id: genId(), accountId: String(currentAccountId || ''), name, type,
    category, desc: String(document.getElementById('transDesc')?.value || '').trim(),
    incomeClass: type === 'income' ? String(document.getElementById('transIncomeClass')?.value || '') : '',
    amount: amountRaw, currency,
    fxRate: currency !== settings.baseCurrency ? String(document.getElementById('transFxRate')?.value || '') : '',
    mode: document.getElementById('transMode')?.value || settings.defaultMode || 'personal',
    tags: parseTags(document.getElementById('transTags')?.value || ''), favorite: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  getTransactionTemplateStore().push(template);
  saveData();
  if (nameInput) nameInput.value = '';
  renderTransactionTemplates();
  showToast(`Modèle « ${name} » enregistré. Aucune opération n’a été créée.`, 'success');
}

function toggleTransactionTemplateFavorite(id) {
  const template = getTransactionTemplateStore().find(item => String(item.id) === String(id));
  if (!template) return;
  template.favorite = !template.favorite;
  template.updatedAt = new Date().toISOString();
  saveData(); renderTransactionTemplates();
}

function renameTransactionTemplate(id) {
  const template = getTransactionTemplateStore().find(item => String(item.id) === String(id));
  if (!template) return;
  const name = prompt('Nom du modèle', template.name || '');
  if (name === null) return;
  const cleaned = String(name).trim();
  if (!cleaned) return showToast('Le nom du modèle ne peut pas être vide.', 'error');
  template.name = cleaned; template.updatedAt = new Date().toISOString();
  saveData(); renderTransactionTemplates();
}

function deleteTransactionTemplate(id) {
  const template = getTransactionTemplateStore().find(item => String(item.id) === String(id));
  if (!template || !confirm(`Supprimer le modèle « ${template.name || 'Modèle sans nom'} » ? Les opérations déjà créées restent intactes.`)) return;
  setTransactionTemplateStore(getTransactionTemplateStore().filter(item => String(item.id) !== String(id)));
  saveData(); renderTransactionTemplates();
  showToast('Modèle supprimé. Les opérations existantes n’ont pas changé.', 'success');
}

function createDraftTransactionId() {
  let id = genId();
  const reserved = new Set([...(transactions || []).map(tx => String(tx.id)), ...getTransactionDraftStore().map(draft => String(draft.transactionId))]);
  while (reserved.has(String(id))) id = genId();
  return id;
}

function saveDraftFromModal() {
  const draftId = document.getElementById('transactionDraftId')?.value || '';
  const editId = document.getElementById('editId')?.value || '';
  if (editId && !draftId) return showToast('Une opération comptabilisée ne peut pas être déplacée en brouillon depuis son édition.', 'info');
  const accountId = String(currentAccountId || '');
  if (!accountId) return showToast('Sélectionnez un compte avant de conserver ce brouillon.', 'error');
  let draft = draftId ? getTransactionDraftStore().find(item => String(item.id) === String(draftId)) : null;
  if (draftId && !draft) return showToast('Ce brouillon n’existe plus dans le compte courant.', 'error');
  const now = new Date().toISOString();
  if (!draft) draft = { id: genId(), transactionId: createDraftTransactionId(), accountId, createdAt: now };
  draft.accountId = accountId;
  draft.type = document.getElementById('transType')?.value || 'expense';
  draft.incomeClass = String(document.getElementById('transIncomeClass')?.value || '');
  draft.category = String(document.getElementById('transCategory')?.value || '').trim();
  draft.amount = String(document.getElementById('transAmount')?.value || '').trim();
  draft.currency = String(document.getElementById('transCurrency')?.value || settings.baseCurrency || 'EUR').toUpperCase();
  draft.fxRate = String(document.getElementById('transFxRate')?.value || '').trim();
  draft.date = document.getElementById('transDate')?.value || '';
  draft.time = document.getElementById('transTime')?.value || '';
  draft.desc = String(document.getElementById('transDesc')?.value || '').trim();
  draft.tags = parseTags(document.getElementById('transTags')?.value || '');
  draft.mode = document.getElementById('transMode')?.value || settings.defaultMode || 'personal';
  draft.paymentStatus = document.getElementById('transPaymentStatus')?.value === 'planned' ? 'planned' : 'paid';
  draft.updatedAt = now;
  if (!draftId) {
    getTransactionDraftStore().push(draft);
  }
  saveData(); closeModal(); syncAllUI();
  showToast('Brouillon conservé hors comptabilité. Aucun solde n’a changé.', 'success');
}

function continueTransactionDraft(id) {
  const draft = getTransactionDraftStore().find(item => String(item.id) === String(id));
  if (!draft) return showToast('Brouillon introuvable', 'error');
  if (String(draft.accountId || '') !== String(currentAccountId || '')) return showToast('Sélectionnez le compte associé à ce brouillon.', 'info');
  openModal();
  const setValue = (field, value) => { const el = document.getElementById(field); if (el) el.value = value ?? ''; };
  setValue('transType', draft.type || 'expense');
  setValue('transIncomeClass', draft.incomeClass || '');
  const categoryEl = document.getElementById('transCategory');
  const categoryExists = !draft.category || [...(categoryEl?.options || [])].some(option => option.value === draft.category);
  setValue('transCategory', categoryExists ? (draft.category || '') : '');
  setValue('transAmount', draft.amount || ''); setValue('transCurrency', draft.currency || settings.baseCurrency || 'EUR');
  setValue('transFxRate', draft.fxRate || ''); setValue('transDate', draft.date || isoDate(getToday())); setValue('transTime', draft.time || '');
  setValue('transDesc', draft.desc || ''); setValue('transTags', (draft.tags || []).join(', '));
  setValue('transMode', draft.mode || settings.defaultMode || 'personal');
  setValue('transPaymentStatus', draft.paymentStatus === 'planned' ? 'planned' : 'paid');
  setValue('transactionDraftId', draft.id);
  setValue('editId', '');
  handleTypeChange(); toggleFxRate(); updatePaymentStatusControl();
  syncTransactionModalSelects();
  if (!categoryExists) showToast('La catégorie de ce brouillon n’existe plus. Choisissez une catégorie de remplacement.', 'info');
}

function deleteTransactionDraft(id) {
  const drafts = getTransactionDraftStore();
  const index = drafts.findIndex(item => String(item.id) === String(id));
  if (index < 0 || !confirm('Supprimer ce brouillon hors comptabilité ?')) return;
  drafts.splice(index, 1);
  saveData(); renderTransactionDrafts();
  showToast('Brouillon supprimé', 'success');
}

// Calcule le solde cumulatif après chaque opération réelle ou prévue.
// Les prévisions ne sont jamais sauvegardées ici : elles servent uniquement à
// afficher la trajectoire correcte du solde dans les tableaux.
function computeBalanceMap(additionalTransactions = []) {
  const seen = new Set();
  const sorted = [...transactions, ...(additionalTransactions || [])]
    .filter(t => t && !t.isRecurring && t.paymentStatus !== 'planned')
    .filter(t => {
      const key = String(t.id || '');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
    const d = (a.date || '').localeCompare(b.date || '');
    return d !== 0 ? d : String(a.id).localeCompare(String(b.id));
  });
  let bal = Number(initialCapital) || 0;
  const map = {};
  sorted.forEach(t => {
    const amt = Number(t.amountBase ?? t.amount) || 0;
    if (t.type === 'income') bal = roundMoney(bal + amt);
    else bal = roundMoney(bal - amt);
    map[t.id] = bal;
  });
  return map;
}

function getProjectedBalanceTransactionsThrough(month) {
  const currentMonth = isoMonth(getToday());
  const lastMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || '')) ? String(month) : currentMonth;
  if (lastMonth < currentMonth) return [];
  // Même horizon que la carte de solde : une date lointaine ne lance pas une
  // projection sans limite et ne donne pas un solde de ligne trompeur.
  const [currentYear, currentMonthNumber] = currentMonth.split('-').map(Number);
  const [year, monthNumber] = lastMonth.split('-').map(Number);
  if ((year - currentYear) * 12 + monthNumber - currentMonthNumber >= 36) return [];
  const projectedMonths = monthsBetweenISO(`${currentMonth}-01`, `${lastMonth}-01`);
  const recurring = projectedMonths.flatMap(targetMonth => getProjectedRecurringTransactions(targetMonth));
  if (lastMonth === currentMonth) return recurring;
  const lastDate = isoDate(new Date(year, monthNumber, 0));
  const source = multiViewMode === 'individual' ? transactions : getDisplayTransactions();
  const planned = source.filter(t => t && !t.isRecurring && t.paymentStatus === 'planned' &&
    isValidISODate(t.date) && t.date <= lastDate)
    .map(t => ({ ...t, paymentStatus: 'paid', projected: true }));
  return recurring.concat(planned);
}

function renderTransactionBalance(t, balance) {
  if (balance === undefined) return '<span class="text-slate-400">—</span>';
  const title = t.projected ? ' title="Solde projeté après cette transaction"' : '';
  return `<span class="font-semibold ${balance >= 0 ? 'text-emerald-600' : 'text-rose-600'}"${title}>${formatCurrency(balance)}</span>`;
}

function renderRecentTransactions() {
  const container = document.getElementById('recentTransactions');
  if (!container) return;

  const month = document.getElementById('globalMonthPicker')?.value || isoMonth();
  const baseMonthTrans = getMonthTransactions(month);
  if (window.matchMedia('(max-width: 768px), (pointer: coarse) and (max-width: 1024px), (horizontal-viewport-segments: 2), (vertical-viewport-segments: 2)').matches) {
    const paid = baseMonthTrans.filter(t => t.paymentStatus !== 'planned' && !t.projected)
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || '') || String(b.id).localeCompare(String(a.id))).slice(0, 8);
    container.innerHTML = paid.length ? `<ul class="mobile-recent-list">${paid.map(t => {
      const sign = t.type === 'income' ? '+' : t.type === 'transfer' ? '↔' : '−';
      const label = t.desc || t.category || getTransactionTypeLabel(t.type);
      return `<li><span class="mobile-recent-icon ${t.type === 'income' ? 'is-income' : ''}" aria-hidden="true"><i class="fa-solid fa-${t.type === 'income' ? 'arrow-down' : 'arrow-up'}"></i></span><span class="mobile-recent-info"><strong>${escapeHTML(label)}</strong><small>${escapeHTML(new Date(t.date + 'T12:00:00').toLocaleDateString('fr-FR'))}${t.time ? ` · ${escapeHTML(t.time)}` : ''}</small></span><strong class="mobile-recent-amount ${t.type === 'income' ? 'is-income' : ''}">${sign} ${formatCurrency(Number(t.amountBase ?? t.amount) || 0)}</strong></li>`;
    }).join('')}</ul>` : '<div class="mobile-recent-empty">Aucune opération enregistrée ce mois-ci.</div>';
    return;
  }
  const monthTrans = baseMonthTrans.concat(getProjectedRecurringTransactions(month, baseMonthTrans)).sort((a,b)=> {
    const d = (b.date||'').localeCompare(a.date||'');
    // Même date : ordre inverse d'insertion (ID DESC) pour que le solde soit cohérent ligne par ligne
    return d !== 0 ? d : String(b.id).localeCompare(String(a.id));
  });

  if (!monthTrans.length) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-inbox"></i><p>Aucune transaction ce mois-ci</p></div>`;
    return;
  }

  const balMap = multiViewMode === 'individual'
    ? computeBalanceMap(getProjectedBalanceTransactionsThrough(month))
    : {};

  const rows = monthTrans.map(t => {
    const typeLabel = getTransactionTypeLabel(t.fromSavings ? 'savings_withdrawal' : t.type);
    const badge = t.type === 'income' ? 'badge-income' : (t.type === 'transfer' ? 'badge-transfer' : 'badge-expense');
    const cls = t.type === 'income' ? 'text-emerald-600' : (t.type === 'transfer' ? 'text-brand-600' : 'text-rose-600');
    const tags = (t.tags||[]).slice(0,3).map(x=>`<span class="badge" style="background:#e2e8f0;color:#334155;">${escapeHTML(x)}</span>`).join(' ');
    const autoBadge = t.parentId ? '<span class="badge" style="background:#60a5fa;color:white;font-size:0.65rem;"><i class="fa-solid fa-repeat"></i> Auto</span>' : '';
    const projectedBadge = t.projected ? '<span class="badge" style="background:#f59e0b;color:white;font-size:0.65rem;"><i class="fa-solid fa-clock"></i> Prévu</span>' : t.paymentStatus === 'planned' ? '<span class="badge" style="background:#f59e0b;color:white;font-size:0.65rem;"><i class="fa-solid fa-clock"></i> À payer</span>' : '';
    const reconcileStyle = getReconcileColorStyle(t);
    const reconcileData = `data-id="${escapeHTML(String(t.id || ''))}" data-account-id="${escapeHTML(String(t._accountId || currentAccountId || ''))}"`;
    const reconciledBadge = t.reconciled
      ? `<span class="badge badge-reconciled" style="background:${reconcileStyle};color:#fff;"><i class="fa-solid fa-check-double"></i> ✓</span>`
      : '';
    const bal = balMap[t.id];
    const balHtml = renderTransactionBalance(t, bal);
    const actionBtns = t.projected
      ? renderProjectedActionButtons(t)
      : `${t.paymentStatus === 'planned' && !t.parentId ? `<button class="btn btn-sm btn-primary js-pay" data-id="${escapeHTML(String(t.id || ''))}">Payée ✓</button>` : ''}<button class="btn-icon js-edit" data-id="${escapeHTML(String(t.id || ''))}" aria-label="Modifier"><i class="fa-solid fa-edit"></i></button>
          <button class="btn-icon js-del" data-id="${escapeHTML(String(t.id || ''))}" aria-label="Supprimer"><i class="fa-solid fa-trash"></i></button>
          <button class="btn-icon js-dup" data-id="${escapeHTML(String(t.id || ''))}" aria-label="Dupliquer"><i class="fa-solid fa-clone"></i></button>
          <button class="btn-icon js-rec" ${reconcileData} aria-label="${t.reconciled?'Annuler vérification':'Marquer vérifiée'}" title="${t.reconciled?'Annuler':'Marquer vérifiée'}" style="${t.reconciled?`background:${reconcileStyle};color:#fff;border-radius:0.5rem;`:`color:${reconcileStyle};`}"><i class="fa-solid fa-${t.reconciled?'check-double':'check'}"></i></button>`;
    return `
      <tr data-reconciled="${t.reconciled ? '1' : ''}" style="${t.projected ? 'background:#fffbeb;' : (t.reconciled ? 'opacity:0.7;' : '')}">
        <td>${escapeHTML(new Date(t.date + 'T12:00:00').toLocaleDateString('fr-FR'))}${t.time ? `<small class="transaction-time">${escapeHTML(t.time)}</small>` : ''}</td>
        <td><span class="badge ${badge}">${escapeHTML(t.category||'Autre')}</span> ${autoBadge} ${projectedBadge} ${reconciledBadge} ${tags}</td>
        <td class="text-slate-600">${escapeHTML(t.desc||'-')}</td>
        <td class="text-right font-semibold ${cls}">${t.type==='income'?'+':(t.type==='transfer'?'↔':'-')} ${formatCurrency(Number(t.amountBase ?? t.amount)||0)}</td>
        <td class="text-right col-solde">${balHtml}</td>
        <td>${actionBtns}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="table-container">
      <table class="table">
        <thead><tr><th>Date</th><th>Catégorie</th><th>Description</th><th class="text-right">Montant</th><th class="text-right col-solde">Solde</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  // Animation volontairement limitée : des centaines de transitions bloquaient les mobiles.
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  container.querySelectorAll('tbody tr').forEach((row, i) => {
    if (reduceMotion || i >= 12) return;
    row.style.opacity = '0';
    row.style.transform = 'translateX(-8px)';
    row.style.transition = `opacity 0.25s ease ${i * 24}ms, transform 0.25s ease ${i * 24}ms`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      row.style.opacity = row.dataset.reconciled ? '0.7' : '1';
      row.style.transform = 'translateX(0)';
    }));
  });

  container.querySelectorAll('.js-pay').forEach(btn => btn.addEventListener('click', () => markPlannedTransactionPaid(btn.dataset.id)));

  container.querySelectorAll('.js-edit').forEach(btn => btn.addEventListener('click', () => openModalById(btn.dataset.id)));
  container.querySelectorAll('.js-del').forEach(btn => btn.addEventListener('click', () => deleteTransaction(btn.dataset.id)));
  container.querySelectorAll('.js-dup').forEach(btn => btn.addEventListener('click', () => duplicateTransaction(btn.dataset.id)));
  container.querySelectorAll('.js-rec').forEach(btn => btn.addEventListener('click', () => toggleReconcile(btn.dataset.id, btn.dataset.accountId || '')));
  container.querySelectorAll('.js-edit-projected').forEach(btn => btn.addEventListener('click', () => editProjectedRecurring(btn.dataset.id)));
  container.querySelectorAll('.js-del-projected').forEach(btn => btn.addEventListener('click', () => deleteProjectedRecurring(btn.dataset.id)));
  container.querySelectorAll('.js-dup-projected').forEach(btn => btn.addEventListener('click', () => duplicateProjectedTransaction(btn.dataset.id)));
  container.querySelectorAll('.js-rec-projected').forEach(btn => btn.addEventListener('click', () => reconcileProjectedTransaction(btn.dataset.id)));
}

function renderAllTransactions() {
  const container = document.getElementById('allTransactions');
  renderTransactionTemplates();
  renderIncompleteTransactions();
  renderTransactionDrafts();
  if (!container) return;

  const completeList = getFilteredTransactions().slice().sort((a,b)=> {
    const d = (b.date||'').localeCompare(a.date||'');
    return d !== 0 ? d : String(b.id).localeCompare(String(a.id));
  });
  if (!completeList.length) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-inbox"></i><p>Aucune transaction</p></div>`;
    return;
  }

  const list = completeList.slice(0, transactionRenderLimit);
  const isMultiMode = multiViewMode !== 'individual';
  const latestVisibleMonth = list.reduce((latest, t) => {
    const month = String(t.date || '').slice(0, 7);
    return /^\d{4}-\d{2}$/.test(month) && month > latest ? month : latest;
  }, isoMonth(getToday()));
  const balMap = !isMultiMode
    ? computeBalanceMap(getProjectedBalanceTransactionsThrough(latestVisibleMonth))
    : {};

  const rows = list.map(t => {
    const typeLabel = getTransactionTypeLabel(t.fromSavings ? 'savings_withdrawal' : t.type);
    const badge = t.type === 'income' ? 'badge-income' : (t.type === 'transfer' ? 'badge-transfer' : 'badge-expense');
    const cls = t.type === 'income' ? 'text-emerald-600' : (t.type === 'transfer' ? 'text-brand-600' : 'text-rose-600');
    const sign = t.type === 'income' ? '+' : (t.type === 'transfer' ? '↔' : '-');
    const tags = (t.tags||[]).slice(0,4).map(x=>`<span class="badge" style="background:#e2e8f0;color:#334155;">${escapeHTML(x)}</span>`).join(' ');
    const autoBadge = t.parentId ? '<span class="badge" style="background:#60a5fa;color:white;font-size:0.65rem;"><i class="fa-solid fa-repeat"></i> Auto</span>' : '';
    const projectedBadge = t.projected ? '<span class="badge" style="background:#f59e0b;color:white;font-size:0.65rem;"><i class="fa-solid fa-clock"></i> Prévu</span>' : t.paymentStatus === 'planned' ? '<span class="badge" style="background:#f59e0b;color:white;font-size:0.65rem;"><i class="fa-solid fa-clock"></i> À payer</span>' : '';
    const completionBadge = isTransactionIncomplete(t) ? '<span class="badge" style="background:#fef3c7;color:#92400e;font-size:0.65rem;">À compléter</span>' : '';
    // Badge compte en mode multi
    let accBadge = '';
    if (isMultiMode && t._accountName) {
      const color = getAccountColor(t._accountIdx ?? 0);
      accBadge = `<span class="account-badge" style="background:${color};margin-left:0.25rem;">${escapeHTML(t._accountName.charAt(0))}</span>`;
    }
    // Badge rapprochement
    const reconcileStyle = getReconcileColorStyle(t);
    const reconcileData = `data-id="${escapeHTML(String(t.id || ''))}" data-account-id="${escapeHTML(String(t._accountId || currentAccountId || ''))}"`;
    const reconciledBadge = t.reconciled
      ? `<span class="badge badge-reconciled" title="Vérifiée" style="background:${reconcileStyle};color:#fff;"><i class="fa-solid fa-check-double"></i> ✓</span>`
      : '';
    // En mode multi, les boutons éditer/supprimer sont désactivés (chaque tx appartient à son compte)
    const editBtn = t.projected
      ? renderProjectedActionButtons(t)
      : isMultiMode
      ? `<button class="btn-icon js-switch-account" title="Basculer sur ce compte pour modifier" data-account-id="${escapeHTML(String(t._accountId || currentAccountId || ''))}"><i class="fa-solid fa-right-to-bracket"></i></button>`
      : `${t.paymentStatus === 'planned' && !t.parentId ? `<button class="btn btn-sm btn-primary js-pay" data-id="${escapeHTML(String(t.id || ''))}">Payée ✓</button>` : ''}<button class="btn-icon js-edit" data-id="${escapeHTML(String(t.id || ''))}" aria-label="Modifier"><i class="fa-solid fa-edit"></i></button>
         <button class="btn-icon js-del" data-id="${escapeHTML(String(t.id || ''))}" aria-label="Supprimer"><i class="fa-solid fa-trash"></i></button>
         <button class="btn-icon js-dup" data-id="${escapeHTML(String(t.id || ''))}" aria-label="Dupliquer"><i class="fa-solid fa-clone"></i></button>
         <button class="btn-icon js-rec" ${reconcileData} aria-label="${t.reconciled?'Annuler vérification':'Marquer vérifiée'}" title="${t.reconciled?'Annuler vérification':'Marquer vérifiée'}" style="${t.reconciled?`background:${reconcileStyle};color:#fff;border-radius:0.5rem;`:`color:${reconcileStyle};`}"><i class="fa-solid fa-${t.reconciled?'check-double':'check'}"></i></button>`;
    const bal = balMap[t.id];
    const balHtml = renderTransactionBalance(t, bal);
    return `
      <tr style="${t.projected ? 'background:#fffbeb;' : (t.reconciled ? 'opacity:0.75;' : '')}">
        <td>${escapeHTML(new Date(t.date + 'T12:00:00').toLocaleDateString('fr-FR'))}${t.time ? `<small class="transaction-time">${escapeHTML(t.time)}</small>` : ''}</td>
        <td><span class="badge ${badge}"><i class="fa-solid fa-${t.type==='income'?'arrow-up':(t.type==='transfer'?'right-left':'arrow-down')}"></i> ${escapeHTML(typeLabel)}</span></td>
        <td>${escapeHTML(t.category||'Sans catégorie')} ${completionBadge} ${autoBadge} ${projectedBadge} ${accBadge} ${reconciledBadge} ${tags}</td>
        <td class="text-slate-600">${escapeHTML(t.desc||'-')}</td>
        <td class="text-right font-semibold ${cls}">${sign} ${formatCurrency(Number(t.amountBase ?? t.amount)||0)}</td>
        <td class="text-right col-solde">${balHtml}</td>
        <td>${editBtn}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="table-container">
      <table class="table">
        <thead><tr><th>Date</th><th>Type</th><th>Catégorie</th><th>Description</th><th class="text-right">Montant</th><th class="text-right col-solde">Solde</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${completeList.length > list.length ? `<div class="transaction-load-more"><p>${list.length} sur ${completeList.length} opérations</p><button type="button" class="btn btn-secondary" onclick="showMoreTransactions()"><i class="fa-solid fa-chevron-down"></i> Afficher 100 de plus</button></div>` : ''}
  `;
  if (!isMultiMode) {
    container.querySelectorAll('.js-pay').forEach(btn => btn.addEventListener('click', () => markPlannedTransactionPaid(btn.dataset.id)));
    container.querySelectorAll('.js-edit').forEach(btn => btn.addEventListener('click', () => openModalById(btn.dataset.id)));
    container.querySelectorAll('.js-del').forEach(btn => btn.addEventListener('click', () => deleteTransaction(btn.dataset.id)));
    container.querySelectorAll('.js-dup').forEach(btn => btn.addEventListener('click', () => duplicateTransaction(btn.dataset.id)));
    container.querySelectorAll('.js-rec').forEach(btn => btn.addEventListener('click', () => toggleReconcile(btn.dataset.id, btn.dataset.accountId || '')));
  }
  container.querySelectorAll('.js-edit-projected').forEach(btn => btn.addEventListener('click', () => editProjectedRecurring(btn.dataset.id)));
  container.querySelectorAll('.js-del-projected').forEach(btn => btn.addEventListener('click', () => deleteProjectedRecurring(btn.dataset.id)));
  container.querySelectorAll('.js-dup-projected').forEach(btn => btn.addEventListener('click', () => duplicateProjectedTransaction(btn.dataset.id)));
  container.querySelectorAll('.js-rec-projected').forEach(btn => btn.addEventListener('click', () => reconcileProjectedTransaction(btn.dataset.id)));
  container.querySelectorAll('.js-switch-account').forEach(btn => btn.addEventListener('click', () => switchAccount(btn.dataset.accountId || '')));
}

function showMoreTransactions() {
  transactionRenderLimit += 100;
  renderAllTransactions();
}

function duplicateTransaction(id) {
  const t = transactions.find(x => String(x.id) === String(id));
  if (!t) return;
  const copy = {
    ...t,
    id: genId(),
    date: isoDate(new Date()),   // date du jour par défaut
    desc: (t.desc || '').replace(' (copie)', '') + ' (copie)',
    reconciled: false,           // remet à zéro la vérification
    parentId: '',                // n'est plus liée à une récurrente
    periodKey: '',
    linkedTransferId: '',
    linkedAccountId: '',
    linkedTransferRole: '',
    linkedTransferRate: null,
    source: 'manual',
    _effectsApplied: false
  };
  transactions.push(copy);
  applyOccurrenceSideEffects(copy);
  logAction('duplicate', 'transaction', t, copy);
  saveData();
  updateDashboard();
  if (currentView === 'transactions') renderAllTransactions();
  showToast('Transaction dupliquée — date mise à aujourd\'hui', 'success');
}

// ---------- Transaction modal / validation / currency ----------
let lastFocusedEl = null;

function toggleFxRate() {
  const curr = document.getElementById('transCurrency')?.value || settings.baseCurrency;
  const grp = document.getElementById('fxRateGroup');
  if (!grp) return;
  if (curr !== settings.baseCurrency) grp.classList.remove('hidden');
  else grp.classList.add('hidden');
}

function toggleDebtSelect() {
  const category = document.getElementById('transCategory')?.value || '';
  const grp = document.getElementById('debtSelectGroup');
  if (!grp) return;
  if (category === 'Remboursement dette') {
    grp.classList.remove('hidden');
    refreshDebtSelect();
  } else {
    grp.classList.add('hidden');
  }
}

function refreshDebtSelect() {
  const sel = document.getElementById('transLinkedDebt');
  if (!sel) return;
  
  // Filtrer les dettes qui ont un montant restant > 0
  const unpaidDebts = debts.filter(d => {
    const remaining = Number(d.remainingAmount ?? d.amount) || 0;
    return remaining > 0;
  });
  
  if (unpaidDebts.length === 0) {
    sel.innerHTML = '<option value="">Aucune dette à rembourser</option>';
    return;
  }
  
  const options = unpaidDebts.map(d => {
    const remaining = Number(d.remainingAmount ?? d.amount) || 0;
    const label = d.direction === 'they_owe_me' ? `${d.person} me doit` : `Je dois à ${d.person}`;
    return `<option value="${d.id}">${escapeHTML(label)} - ${formatCurrency(remaining)}</option>`;
  }).join('');
  
  sel.innerHTML = '<option value="">Sélectionner une dette...</option>' + options;
}

function refreshSavingsSelect() {
  const sel = document.getElementById('transferSavingsTarget');
  if (!sel) return;
  const keys = Object.keys(savingsAccounts || {});
  const base = keys.length ? keys : ['Livret A'];
  sel.innerHTML = base.map(k => `<option value="${escapeHTML(k)}">${escapeHTML(k)}</option>`).join('');
}

function resetRecurringDateScopeContext() {
  ['editRuleOriginalDate', 'editOccurrenceId', 'editOccurrencePeriodKey', 'editOccurrenceOriginalDate'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const group = document.getElementById('recurDateScopeGroup');
  if (group) group.classList.add('hidden');
  document.getElementById('recurRuleScopeNotice')?.classList.add('hidden');
  const all = document.getElementById('recurDateScopeAll');
  const history = document.getElementById('recurDateScopeHistory');
  if (history) history.checked = false;
  const single = document.getElementById('recurDateScopeSingle');
  if (all) all.checked = true;
  if (single) single.checked = false;
}

function setupRecurringDateScopeContext(occurrence) {
  resetRecurringDateScopeContext();
  if (!occurrence) return;

  const occurrenceDate = occurrence.date || '';
  const frequency = occurrence.frequency || recurringTransactions.find(r => String(r.id) === String(occurrence.parentId))?.frequency || 'monthly';
  const key = occurrence.periodKey || (occurrenceDate ? periodKey(occurrenceDate, frequency) : '');

  const idEl = document.getElementById('editOccurrenceId');
  const keyEl = document.getElementById('editOccurrencePeriodKey');
  const dateEl = document.getElementById('editOccurrenceOriginalDate');
  if (idEl) idEl.value = occurrence.id || '';
  if (keyEl) keyEl.value = key;
  if (dateEl) dateEl.value = occurrenceDate;

  const group = document.getElementById('recurDateScopeGroup');
  if (group) group.classList.remove('hidden');
  const all = document.getElementById('recurDateScopeAll');
  const single = document.getElementById('recurDateScopeSingle');
  // Depuis une échéance, le choix le plus sûr est de ne modifier qu'elle.
  if (all) all.checked = false;
  if (single) single.checked = true;
}

// Une période passée reste archivée : une modification exceptionnelle demande
// deux validations distinctes. La frontière est le MOIS, pas le jour du débit.
function isArchivedRecurringMonth(rule, key, originalDate = '') {
  const frequency = normalizeRecurringFrequency(rule?.frequency);
  let month = frequency === 'monthly' && /^\d{4}-\d{2}$/.test(String(key || ''))
    ? key : String(originalDate || '').slice(0, 7);
  // Pour une annuité, une échéance de février reste historique dès mars,
  // même si sa date a ensuite été déplacée dans l'année.
  if (frequency === 'yearly' && /^\d{4}$/.test(String(key || '')) &&
      /^\d{4}-\d{2}-\d{2}$/.test(rule?.startDate || '')) {
    const scheduledMonth = `${key}-${rule.startDate.slice(5, 7)}`;
    if (scheduledMonth < isoMonth(getToday())) return true;
  }
  // Semaines chevauchant deux mois : verrouiller dès que la semaine
  // commence dans un mois clos, même si le débit est daté du mois suivant.
  if (frequency === 'weekly' && /^\d{4}-W\d{2}$/.test(String(key || ''))) {
    const [year, week] = key.split('-W').map(Number);
    const monday = new Date(Date.UTC(year, 0, 4));
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() || 7) + 1 + (week - 1) * 7);
    if (monday.toISOString().slice(0, 7) < isoMonth(getToday())) return true;
  }
  return /^\d{4}-\d{2}$/.test(month) && month < isoMonth(getToday());
}

function confirmArchivedRecurringChange(dateISO, action = 'modifier') {
  const label = /^\d{4}-\d{2}/.test(String(dateISO || ''))
    ? new Date(`${dateISO.slice(0, 7)}-01T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : 'cette période';
  if (!confirm(`HISTORIQUE PROTÉGÉ — ${label}\n\nVous allez ${action} une échéance d’un mois déjà terminé. Cela peut modifier vos anciens soldes et bilans. Continuer ?`)) return false;
  return confirm(`DEUXIÈME CONFIRMATION — ${label}\n\nConfirmez-vous explicitement la modification de cet historique ? Les autres mois ne seront pas modifiés.`);
}

function getRecurringDateScope() {
  return document.querySelector('input[name="recurDateScope"]:checked')?.value || 'all';
}

function setTransactionColorScopeHint(message='') {
  const hint = document.getElementById('transReconcileScopeHint');
  if (hint) hint.textContent = message || 'Cette couleur s’applique uniquement à cette transaction. « D » utilise la couleur globale des paramètres.';
}

function applyRecurringOccurrenceColorOverride(ruleId, occurrenceId, occurrencePeriodKey, occurrenceDate, color) {
  const cleanColor = /^#[0-9a-f]{6}$/i.test(String(color || '').trim()) ? String(color).trim() : '';
  let target = transactions.find(t => String(t.id) === String(occurrenceId || ''));
  if (!target && occurrencePeriodKey) {
    target = transactions.find(t => String(t.parentId || '') === String(ruleId) && String(t.periodKey || '') === String(occurrencePeriodKey));
  }
  if (!target && occurrenceDate) {
    target = transactions.find(t => String(t.parentId || '') === String(ruleId) && String(t.date || '') === String(occurrenceDate));
  }
  if (!target) return false;

  const before = { ...target };
  target.reconcileColor = cleanColor;
  target._manuallyEdited = true;
  logAction('update_reconcile_color', 'transaction', before, target);
  return true;
}

function selectTransactionCategory(category) {
  const select = document.getElementById('transCategory');
  if (!select) return;
  const name = String(category || '').trim();
  if (!name) {
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  // Garder une ancienne catégorie éditable même si elle a disparu des réglages.
  if (![...select.options].some(option => option.value === name)) {
    select.add(new Option(name, name));
  }
  select.value = name;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function syncTransactionModalSelects() {
  const modal = document.getElementById('transactionModal');
  if (modal) window.FreevCustomSelects?.refresh?.(modal);
}

function openModal(transaction=null) {
  lastFocusedEl = document.activeElement;
  const modal = document.getElementById('transactionModal');
  const form = document.getElementById('transactionForm');
  if (!modal || !form) return;
  if (typeof window !== 'undefined') window.FreevReceiptScanner?.clearTransactionPreview?.();
  document.getElementById('receiptPrefillNotice')?.classList.add('hidden');
  const draftIdField = document.getElementById('transactionDraftId');
  if (draftIdField) draftIdField.value = '';

  // ✅ Toujours repeupler les catégories (incluant les perso)
  populateCategorySelects();
  refreshSavingsSelect();
  refreshDebtSelect();
  resetRecurringDateScopeContext();

  if (transaction) {
    document.getElementById('modalTitle').textContent = 'Modifier l’opération';
    document.getElementById('editId').value = transaction.id;
    document.getElementById('transType').value = transaction.fromSavings ? 'savings_withdrawal' : (transaction.type || 'expense');
    document.getElementById('transIncomeClass') && (document.getElementById('transIncomeClass').value = transaction.incomeClass || '');
    document.getElementById('transPaymentStatus').value = transaction.paymentStatus === 'planned' ? 'planned' : 'paid';
    selectTransactionCategory(transaction.category);
    document.getElementById('transAmount').value = transaction.originalAmount ?? transaction.amount;
    document.getElementById('transDate').value = transaction.date;
    document.getElementById('transTime').value = transaction.time || '';
    document.getElementById('transDesc').value = transaction.desc || '';
    document.getElementById('transTags') && (document.getElementById('transTags').value = (transaction.tags||[]).join(', '));
    document.getElementById('transMode') && (document.getElementById('transMode').value = transaction.mode || settings.defaultMode || 'personal');

    // linked debt
    if (document.getElementById('transLinkedDebt')) {
      document.getElementById('transLinkedDebt').value = transaction.linkedDebtId || '';
    }
    toggleDebtSelect();

    // recurring toggle
    document.getElementById('isRecurring').checked = !!transaction.isRecurring;
    if (transaction.isRecurring) {
      document.getElementById('recurFreq').value = transaction.frequency || 'monthly';
      document.getElementById('recurDay').value = transaction.dayOfMonth || 1;
      toggleRecurOptions();
    } else {
      document.getElementById('recurOptions').classList.add('hidden');
    }

    // ✅ Couleur de validation par transaction
    setTransReconcileColor(transaction.reconcileColor || '');
    setTransactionColorScopeHint('Cette couleur s’applique uniquement à cette transaction. « D » utilise la couleur globale des paramètres.');

    // currency
    const curr = transaction.currency || settings.baseCurrency;
    document.getElementById('transCurrency') && (document.getElementById('transCurrency').value = curr);
    document.getElementById('transFxRate') && (document.getElementById('transFxRate').value = transaction.fxRate || '');
    toggleFxRate();

    // transfer target
    const transferGrp = document.getElementById('transferSavingsGroup');
    if (transferGrp) {
      if ((transaction.type||'') === 'transfer') transferGrp.classList.remove('hidden');
      else transferGrp.classList.add('hidden');
    }
    if (document.getElementById('transferSavingsTarget')) {
      document.getElementById('transferSavingsTarget').value = transaction.transferTarget || defaultSavingsTarget();
    }

  } else {
    document.getElementById('modalTitle').textContent = 'Nouvelle opération';
    form.reset();
    document.getElementById('transDate').value = isoDate(today);
    document.getElementById('transTime').value = '';
    document.getElementById('transIncomeClass') && (document.getElementById('transIncomeClass').value = '');
    document.getElementById('transPaymentStatus').value = 'paid';
    document.getElementById('editId').value = '';
    document.getElementById('recurOptions').classList.add('hidden');
    document.getElementById('transMode') && (document.getElementById('transMode').value = settings.defaultMode || 'personal');
    document.getElementById('transCurrency') && (document.getElementById('transCurrency').value = settings.baseCurrency || 'EUR');
    toggleFxRate();
    toggleDebtSelect();
    const transferGrp = document.getElementById('transferSavingsGroup');
    if (transferGrp) transferGrp.classList.add('hidden');
    // ✅ Réinitialiser la couleur de validation sur "Défaut"
    setTransReconcileColor('');
    setTransactionColorScopeHint('Choisissez la couleur du symbole de validation de cette nouvelle transaction. « D » utilise la couleur globale.');
  }

  modal.classList.remove('hidden');
  updateIncomeClassificationUI();
  updatePaymentStatusControl();
  renderFavoriteTagsInModal();
  syncTransactionModalSelects();
  setTimeout(()=>document.getElementById('transType')?.focus(),0);
}

function openModalById(id) {
  const t = transactions.find(x => String(x.id) === String(id));
  if (!t) return;
  if (t.linkedTransferId) {
    showToast('Ce transfert est lié à un autre compte. Supprimez-le puis recréez-le via « Entre comptes » pour conserver les deux écritures cohérentes.', 'info');
    return;
  }
  if (t.linkedDebtAccountId && String(t.linkedDebtAccountId) !== String(currentAccountId)) {
    showToast('Ce remboursement agit sur une dette d’un autre compte. Supprimez-le puis recréez-le via « Entre comptes » pour conserver la dette cohérente.', 'info');
    return;
  }
  // Si c'est une occurrence auto d'une règle récurrente, ouvrir la règle parente
  if (t.parentId) {
    const rule = recurringTransactions.find(r => String(r.id) === String(t.parentId));
    if (rule) { openRecurringRuleModal(rule, t); return; }
  }
  openModal(t);
}

// Ouvre le modal pré-rempli pour modifier une RÈGLE récurrente (pas une occurrence)
function openRecurringRuleModal(rule, occurrence=null) {
  lastFocusedEl = document.activeElement;
  const modal = document.getElementById('transactionModal');
  const form  = document.getElementById('transactionForm');
  if (!modal || !form) return;

  populateCategorySelects();
  refreshSavingsSelect();
  refreshDebtSelect();

  document.getElementById('modalTitle').textContent = occurrence ? 'Modifier cette date' : 'Modifier les prochaines opérations';
  // On stocke l'id de la RÈGLE dans editId — préfixé pour le distinguer
  document.getElementById('editId').value = '__rule__' + String(rule.id);
  const editable = occurrence || rule;
  document.getElementById('transType').value = editable.fromSavings ? 'savings_withdrawal' : (editable.type || 'expense');
  selectTransactionCategory(editable.category);
  document.getElementById('transAmount').value = editable.originalAmount ?? editable.amount;
  document.getElementById('transDate').value = occurrence?.date || rule.startDate || isoDate(getToday());
  document.getElementById('transTime').value = editable.time || '';
  document.getElementById('transDesc').value = editable.desc || '';
  document.getElementById('transTags') && (document.getElementById('transTags').value = (editable.tags||[]).join(', '));
  document.getElementById('transMode') && (document.getElementById('transMode').value = editable.mode || settings.defaultMode || 'personal');
  document.getElementById('transIncomeClass') && (document.getElementById('transIncomeClass').value = editable.incomeClass || rule.incomeClass || '');
  setupRecurringDateScopeContext(occurrence);
  if (!occurrence) {
    document.getElementById('recurRuleScopeNotice')?.classList.remove('hidden');
    document.getElementById('recurDateScopeGroup')?.classList.remove('hidden');
    document.getElementById('recurDateScopeSingleOption')?.classList.add('hidden');
    document.getElementById('recurDateScopeAll').checked = true;
  } else document.getElementById('recurDateScopeSingleOption')?.classList.remove('hidden');
  if (typeof wireRecurringImpactPreview === 'function') wireRecurringImpactPreview();
  const ruleDateEl = document.getElementById('editRuleOriginalDate');
  if (ruleDateEl) ruleDateEl.value = rule.startDate || '';

  if (document.getElementById('transLinkedDebt')) {
    document.getElementById('transLinkedDebt').value = editable.linkedDebtId || '';
  }
  toggleDebtSelect();

  // Cocher isRecurring et pré-remplir les options
  document.getElementById('isRecurring').checked = true;
  document.getElementById('recurFreq').value = rule.frequency || 'monthly';
  document.getElementById('recurDay').value = rule.dayOfMonth || 1;
  toggleRecurOptions();

  const isStoredOccurrence = Boolean(occurrence && !occurrence.projected);
  setTransReconcileColor(isStoredOccurrence ? (occurrence.reconcileColor || '') : (rule.reconcileColor || ''));
  if (isStoredOccurrence) {
    const dateLabel = occurrence.date ? new Date(`${occurrence.date}T12:00:00`).toLocaleDateString('fr-FR') : '';
    setTransactionColorScopeHint(`Cette couleur s’applique uniquement à la transaction${dateLabel ? ` du ${dateLabel}` : ''}. « D » utilise la couleur globale.`);
  } else {
    setTransactionColorScopeHint('Cette couleur devient la couleur par défaut de cette transaction récurrente. « D » utilise la couleur globale.');
  }

  const curr = editable.currency || settings.baseCurrency;
  document.getElementById('transCurrency') && (document.getElementById('transCurrency').value = curr);
  document.getElementById('transFxRate') && (document.getElementById('transFxRate').value = editable.fxRate || '');
  toggleFxRate();

  const transferGrp = document.getElementById('transferSavingsGroup');
  if (transferGrp) {
    if (editable.type === 'transfer' || editable.fromSavings) transferGrp.classList.remove('hidden');
    else transferGrp.classList.add('hidden');
  }
  if (document.getElementById('transferSavingsTarget')) {
    document.getElementById('transferSavingsTarget').value = editable.transferTarget || defaultSavingsTarget();
  }

  modal.classList.remove('hidden');
  updateIncomeClassificationUI();
  updatePaymentStatusControl();
  renderFavoriteTagsInModal();
  syncTransactionModalSelects();
  setTimeout(()=>document.getElementById('transType')?.focus(), 0);
}

function closeModal() {
  if (typeof window !== 'undefined') window.FreevReceiptScanner?.clearTransactionPreview?.();
  document.getElementById('transactionModal')?.classList.add('hidden');
  document.getElementById('transactionForm')?.reset();
  document.getElementById('recurOptions')?.classList.add('hidden');
  resetRecurringDateScopeContext();
  if (lastFocusedEl?.focus) setTimeout(()=>lastFocusedEl.focus(), 0);
}

function toggleRecurOptions() {
  const el = document.getElementById('recurOptions');
  const chk = document.getElementById('isRecurring');
  if (!el || !chk) return;
  chk.checked ? el.classList.remove('hidden') : el.classList.add('hidden');
  updateRecurringFrequencyUI();
}

function updateRecurringFrequencyUI() {
  const frequency = document.getElementById('recurFreq')?.value || 'monthly';
  const dayGroup = document.getElementById('recurDayGroup');
  const hint = document.getElementById('recurFrequencyHint');
  if (dayGroup) dayGroup.classList.toggle('hidden', frequency !== 'monthly');
  if (!hint) return;
  if (frequency === 'weekly') hint.textContent = 'La transaction se répète le même jour de la semaine que la date de début.';
  else if (frequency === 'yearly') hint.textContent = 'La transaction se répète chaque année à la date de début (29 février ajusté si nécessaire).';
  else hint.textContent = 'Le dernier jour du mois est utilisé automatiquement si nécessaire.';
}

function handleTypeChange() {
  const type = document.getElementById('transType')?.value || 'expense';
  const transferGrp = document.getElementById('transferSavingsGroup');
  const hint = document.getElementById('transferSavingsHint');

  // Si inter-comptes sélectionné : fermer ce modal et ouvrir le bon
  if (type === 'inter_account') {
    closeModal();
    openInterAccountModal();
    return;
  }

  if (transferGrp) {
    if (type === 'transfer' || type === 'savings_withdrawal') {
      transferGrp.classList.remove('hidden');
      if (hint) {
        hint.textContent = type === 'transfer'
          ? 'Les transferts vers l\'épargne ne sont pas comptés comme des dépenses de consommation.'
          : 'Le montant sera retiré du livret sélectionné et ajouté à votre solde.';
      }
    } else {
      transferGrp.classList.add('hidden');
    }
  }
  updateIncomeClassificationUI();
}

function updateIncomeClassificationUI() {
  const group = document.getElementById('incomeClassificationGroup');
  if (group) group.classList.toggle('hidden', document.getElementById('transType')?.value !== 'income');
}

async function rememberConfirmedTransactionCorrection(accountId, before, after) {
  if (!before || !after || before.paymentStatus === 'planned' || after.paymentStatus === 'planned' ||
      before.parentId || before.isRecurring || after.parentId || after.isRecurring ||
      before.linkedTransferId || before.linkedAccountId || before.linkedDebtId || before.fromSavings || before.toSavings ||
      after.linkedTransferId || after.linkedAccountId || after.linkedDebtId || after.fromSavings || after.toSavings ||
      !['income', 'expense'].includes(before.type) || !['income', 'expense'].includes(after.type) ||
      (before.category === after.category && before.type === after.type)) return;
  try {
    const learning = await import('./assets/js/category-learning.mjs');
    let result = null;
    window._mutateAccountData?.(accountId, account => {
      const state = account.categoryLearning || learning.createCorrectionLearningState(String(account.id));
      result = learning.recordConfirmedCorrection(state, {
        accountId: String(account.id),
        transaction: before,
        corrected: { category: after.category, type: after.type },
        confirmedByUser: true,
        origin: 'transaction-editor',
        confirmedAt: new Date().toISOString()
      });
      if (result.accepted) account.categoryLearning = result.state;
    });
    if (result?.accepted) {
      window.showToast?.('Correction mémorisée : elle pourra suggérer une règle à vérifier.', 'success');
      window.FreevV5?.render?.();
    }
  } catch (error) {
    console.warn('[Freev] Correction non mémorisée :', error);
  }
}

async function saveTransaction(event) {
  event.preventDefault();

  const draftId = document.getElementById('transactionDraftId')?.value || '';
  const draftEntry = draftId ? getTransactionDraftStore().find(item => String(item.id) === String(draftId)) : null;
  if (draftId && !draftEntry) return showToast('Ce brouillon n’existe plus dans le compte courant.', 'error');
  const id = document.getElementById('editId').value || draftEntry?.transactionId || '';
  const type = document.getElementById('transType').value;
  const incomeClass = type === 'income' ? String(document.getElementById('transIncomeClass')?.value || '') : '';
  const categoryValue = String(document.getElementById('transCategory').value || '').trim();
  const category = categoryValue ? normalizeCategory(categoryValue) : '';
  const curr = String(document.getElementById('transCurrency')?.value || settings.baseCurrency || 'EUR').toUpperCase();
  const baseCurrency = String(settings.baseCurrency || 'EUR').toUpperCase();
  const amountResult = globalThis.FREEVMoney?.parseAmount(document.getElementById('transAmount').value, curr, 'amount');
  if (!amountResult?.ok || amountResult.minor <= 0) return showToast('Montant invalide', 'error');
  const amountInput = amountResult.minor / (10 ** globalThis.FREEVMoney.minorDigits(curr));
  const date = document.getElementById('transDate').value;
  const time = document.getElementById('transTime')?.value || '';
  const desc = document.getElementById('transDesc').value || '';
  const tags = parseTags(document.getElementById('transTags')?.value || '');
  const mode = document.getElementById('transMode')?.value || (settings.defaultMode || 'personal');
  let linkedDebtId = document.getElementById('transLinkedDebt')?.value || null;

  const rateInput = document.getElementById('transFxRate')?.value || '';
  const fxRate = curr !== baseCurrency ? safeNumber(rateInput, NaN) : NaN;

  const isRecurring = document.getElementById('isRecurring').checked;
  let savedManualTransaction = null;
  const paymentStatus = document.getElementById('transPaymentStatus')?.value === 'planned' ? 'planned' : 'paid';
  const isEditingOccurrence = transactions.some(tx => String(tx.id) === String(id) && Boolean(tx.parentId));
  if (paymentStatus === 'planned' && isEditingOccurrence)
    return showToast('Une échéance récurrente ne peut pas être convertie en opération prévue.', 'error');
  if (paymentStatus === 'planned' && (isRecurring || !['income','expense'].includes(type) || linkedDebtId || category === 'Remboursement dette'))
    return showToast('Une opération prévue doit être une dépense ou un revenu manuel sans dette.', 'error');
  // Une règle ouverte en édition ne peut pas être transformée implicitement
  // en transaction isolée (ce qui laisserait la règle d'origine active).
  if (String(id).startsWith('__rule__') && !isRecurring)
    return showToast('Pour arrêter une récurrence, utilisez « Supprimer la série ». Les échéances ne sont pas converties automatiquement.', 'error');

  if (amountInput > 1e12) return showToast('Montant invalide', 'error');
  if (!isValidISODate(date)) return showToast('Date invalide', 'error');
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return showToast('Heure invalide', 'error');
  if (draftEntry && transactions.some(tx => String(tx.id) === String(draftEntry.transactionId)))
    return showToast('Une opération porte déjà l’identifiant de ce brouillon. Vérifiez les opérations avant de continuer.', 'error');

  // Optional sanity: date too far in future
  const dt = new Date(date + 'T00:00:00');
  const maxFuture = new Date(); maxFuture.setFullYear(maxFuture.getFullYear() + 1);
  if (dt > maxFuture) {
    if (!confirm('Cette date est très dans le futur. Continuer ?')) return;
  }

  const baseAmountResult = curr === baseCurrency
    ? { ok: true, minor: amountResult.minor, currency: baseCurrency }
    : globalThis.FREEVMoney.convertMinor(amountResult.minor, rateInput, curr, baseCurrency);
  if (!baseAmountResult?.ok || baseAmountResult.minor <= 0)
    return showToast('Montant converti invalide', 'error');
  const amountBaseMinor = baseAmountResult.minor;
  const amountBase = amountBaseMinor / (10 ** globalThis.FREEVMoney.minorDigits(baseCurrency));
  if (!Number.isFinite(amountBase) || amountBase > 1e12)
    return showToast('Montant converti invalide', 'error');

  // Si aucun remboursement n'est explicitement lié, mémoriser la première dette
  // encore ouverte afin que modification, suppression et annulation restent réversibles.
  if (category === 'Remboursement dette' && !linkedDebtId) {
    linkedDebtId = debts.find(d => (Number(d.remainingAmount ?? d.amount) || 0) > 0)?.id || null;
  }
  
  // Un ticket scanné reste identifiable même si la catégorie a été modifiée après lecture.
  const receiptNotice = document.getElementById('receiptPrefillNotice');
  const scannedMerchant = !receiptNotice?.classList.contains('hidden') ? receiptNotice?.dataset.merchant : '';
  const receiptDuplicates = !id && !isRecurring && ['expense', 'income'].includes(type) && scannedMerchant
    ? window.FreevReceiptScanner?.findLikelyReceiptDuplicates?.(transactions, {
      date, time, type, merchant: scannedMerchant, amountMinor: amountResult.minor, currency: curr
    }, baseCurrency) || [] : [];
  if (receiptDuplicates.length) {
    const previous = receiptDuplicates[0];
    const previousTime = previous.time ? ` à ${previous.time}` : '';
    if (!confirm(`Ce ticket ressemble à une dépense déjà enregistrée le ${date}${previousTime} : ${previous.desc || scannedMerchant}, ${document.getElementById('transAmount').value} ${curr}.\n\nVoulez-vous quand même ajouter cette dépense ?`)) return;
  }

  // ✅ DÉTECTION DE DOUBLONS : vérifier si une transaction similaire existe déjà
  if (!id && !isRecurring && !receiptDuplicates.length) { // Seulement pour les nouvelles transactions manuelles
    const duplicates = transactions.filter(t => 
      t.date === date &&
      t.type === type &&
      t.category === category &&
      globalThis.FREEVMoney.parseAmount(Number(t.amountBase ?? t.amount), baseCurrency).minor === amountBaseMinor
    );
    
    if (duplicates.length > 0) {
      const duplicate = duplicates[0];
      const isFromRecurring = duplicate.parentId ? ' (générée automatiquement)' : '';
      const msg = `⚠️ Une transaction similaire existe déjà pour cette date :\n\n` +
        `Type: ${duplicate.type}\n` +
        `Catégorie: ${duplicate.category}\n` +
        `Montant: ${formatCurrency(Number(duplicate.amountBase ?? duplicate.amount) || 0)}\n` +
        `Description: ${duplicate.desc || '-'}${isFromRecurring}\n\n` +
        `Voulez-vous quand même créer cette transaction ?`;
      
      if (!confirm(msg)) {
        return;
      }
    }
  }
  
  // TRANSFERT : ne pas compter comme dépense, mais mettre à jour l'épargne proprement
  let transferTarget = '';

  // Si on modifie une transaction existante : annuler exactement son effet précédent.
  // La fonction tient compte de la date et évite les doubles applications.
  const isEdit = !!id;
  const existing = isEdit ? transactions.find(t => String(t.id) === String(id)) : null;
  const existingBefore = existing ? JSON.parse(JSON.stringify(existing)) : null;

  if (type === 'transfer' || type === 'savings_withdrawal') {
    transferTarget = document.getElementById('transferSavingsTarget')?.value || defaultSavingsTarget();
  }

  if (isRecurring) {
    const frequency = normalizeRecurringFrequency(document.getElementById('recurFreq').value);
    let dayOfMonth = parseInt(document.getElementById('recurDay').value, 10) || 1;

    // Déterminer si c'est une MISE À JOUR d'une règle existante ou une création
    // id peut être '__rule__<ruleId>' (édition via openRecurringRuleModal) ou un id classique
    let ruleId;
    let isRuleUpdate = false;
    if (id && id.startsWith('__rule__')) {
      ruleId = id.replace('__rule__', '');
      isRuleUpdate = true;
    } else if (id) {
      // Cas hérité : on vérif si l'id correspond à une règle existante
      const existingRule = recurringTransactions.find(r => String(r.id) === String(id));
      if (existingRule) { ruleId = id; isRuleUpdate = true; }
      else ruleId = id; // conversion manuelle → récurrente (cas rare)
    } else {
      ruleId = Date.now();
    }

    const before = recurringTransactions.find(r => String(r.id) === String(ruleId));
    const occurrenceId = document.getElementById('editOccurrenceId')?.value || '';
    const occurrencePeriodKey = document.getElementById('editOccurrencePeriodKey')?.value || '';
    const occurrenceOriginalDate = document.getElementById('editOccurrenceOriginalDate')?.value || '';
    const ruleOriginalDate = document.getElementById('editRuleOriginalDate')?.value || '';
    const selectedReconcileColor = (document.getElementById('transReconcileColor')?.dataset.customColor) || '';
    const occurrenceDateChanged = !!occurrenceOriginalDate && date !== occurrenceOriginalDate;
    const directRuleDateChanged = !occurrenceOriginalDate && !!ruleOriginalDate && date !== ruleOriginalDate;

    if (getRecurringDateScope() === 'single') {
      if (!isRuleUpdate || !before || !occurrencePeriodKey) {
        return showToast('Échéance à modifier introuvable : aucune série n’a été changée', 'error');
      }
      if (frequency !== normalizeRecurringFrequency(before.frequency)) {
        return showToast('Le rythme ne peut être modifié que pour toute la série', 'error');
      }
      if (periodKey(date, frequency) !== occurrencePeriodKey) {
        return showToast('Choisissez une date dans la même période pour modifier seulement cette échéance', 'error');
      }
      const archived = isArchivedRecurringMonth(before, occurrencePeriodKey, occurrenceOriginalDate);
      if (archived && !confirmArchivedRecurringChange(occurrenceOriginalDate || date, 'modifier')) return;
      const changed = applySingleRecurringOccurrenceChange(before, occurrenceId, occurrencePeriodKey, occurrenceOriginalDate, {
        date, type, category, amountBase, originalAmount: amountInput, currency: curr,
        fxRate: curr !== settings.baseCurrency ? fxRate : null, desc, tags, mode,
        transferTarget, linkedDebtId, reconcileColor: selectedReconcileColor, incomeClass
      }, { authorizeArchivedMonth: archived });
      if (!changed) return showToast('Modification refusée : échéance introuvable, ignorée ou historique protégé', 'error');
      saveData();
      closeModal();
      syncAllUI();
      showToast('Cette échéance uniquement a été modifiée', 'success');
      return;
    }

    const scope = getRecurringDateScope();
    if (scope === 'history' && isRuleUpdate) {
      const seriesCount = transactions.filter(tx => String(tx.parentId || '') === String(before.id)).length;
      if (seriesCount > 120) return showToast('Plus de 120 échéances enregistrées : modification globale bloquée pour protéger la sauvegarde Firebase.', 'error');
      if (normalizeRecurringFrequency(before.frequency) !== frequency)
        return showToast('Pour modifier l’historique, conservez le même rythme : les périodes ne doivent pas être déplacées.', 'error');
      const scheduled = transactions.filter(tx => String(tx.parentId || '') === String(before.id));
      const periodIds = new Set();
      for (const tx of scheduled) {
        const key = tx.periodKey || (tx.date ? periodKey(tx.date, before.frequency) : '');
        if (!key || periodIds.has(key))
          return showToast('Doublon ou période invalide : vérifiez les échéances avant de modifier l’historique.', 'error');
        periodIds.add(key);
        if (occurrenceHasSideEffects(tx) && tx.date <= isoDate(getToday()) &&
            tx._effectsApplied !== true)
          return showToast('Ancien effet financier non confirmé : historique protégé contre un recalcul incertain.', 'error');
      }
      if (!confirmArchivedRecurringChange(occurrenceOriginalDate || date, 'modifier toute la série, historique compris')) return;
    }
    if (isRuleUpdate && (occurrenceDateChanged || directRuleDateChanged) && frequency === 'monthly') {
      const dateDay = parseInt(String(date).slice(8, 10), 10);
      if (Number.isFinite(dateDay) && dateDay >= 1 && dateDay <= 31) dayOfMonth = dateDay;
    }

    // Modifier une occurrence pour « Toute la série » change le jour du prélèvement,
    // pas le mois/année de création de l'abonnement. Ne jamais recaler la série
    // entière sur le mois de l'occurrence sélectionnée.
    const ruleStartDate = occurrenceOriginalDate && before
      ? (before.startDate || occurrenceOriginalDate)
      : date;

    const isSavingsWithdrawal = type === 'savings_withdrawal';
    const rule = {
      id: ruleId,
      type: isSavingsWithdrawal ? 'income' : type,
      fromSavings: isSavingsWithdrawal || undefined,
      category,
      amount: amountBase,
      amountBase,
      originalAmount: amountInput,
      currency: curr,
      fxRate: curr !== settings.baseCurrency ? fxRate : null,
      desc,
      tags,
      mode,
      incomeClass,
      transferTarget,
      frequency,
      dayOfMonth,
      startDate: ruleStartDate,
      isRecurring: true,
      linkedDebtId,
      reconcileColor: selectedReconcileColor,
      rateVersions: before?.rateVersions || [],
      subscription: before?.subscription || null,
      skippedPeriods: before?.skippedPeriods || [],
      skippedOccurrenceBackups: before?.skippedOccurrenceBackups || {},
      recurrenceHistory: before?.recurrenceHistory || [],
      // Une modification de série ne doit pas remplir ultérieurement des trous
      // historiques avec le nouveau tarif lors de la prochaine connexion.
      historicalBackfillThrough: isRuleUpdate ? isoDate(getToday()) :
        (before?.historicalBackfillThrough || isoDate(new Date(getToday().getFullYear(), getToday().getMonth(), 0))),
      createdAt: before?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const beforeRule = isRuleUpdate ? recurringSnapshot(before) : null;
    const idx = recurringTransactions.findIndex(r => String(r.id) === String(rule.id));
    if (idx > -1) recurringTransactions[idx] = rule; else recurringTransactions.push(rule);
    if (isRuleUpdate && scope === 'history') {
      // Édition explicite de la série entière, y compris les exceptions futures.
      // On ne crée jamais de mois historique manquants.
      const changes = [];
      transactions.filter(t => String(t.parentId || '') === String(rule.id) &&
        !isRecurringPeriodSkipped(before, t.periodKey || periodKey(t.date, before.frequency)))
        .forEach(tx => {
          const previous = recurringSnapshot(tx);
          revertOccurrenceSideEffects(tx);
          Object.assign(tx, { amount: amountBase, amountBase, originalAmount: amountInput,
            type: type === 'savings_withdrawal' ? 'income' : type,
            fromSavings: type === 'savings_withdrawal' || undefined,
            incomeClass,
            category, currency: curr, fxRate: curr !== settings.baseCurrency ? fxRate : null,
            desc, tags: [...tags], mode, transferTarget, linkedDebtId,
            reconcileColor: selectedReconcileColor, _effectsApplied: false,
            _manuallyEdited: true });
          delete tx.linkedDebtAmount; // plus de montant de dette périmé après révision
          if (previous.linkedDebtId !== linkedDebtId) tx.linkedDebtAccountId = '';
          // Conserver date et periodKey dans les anciens mois, même si le jour par défaut change.
          applyOccurrenceSideEffects(tx);
          changes.push({ before: previous, after: recurringSnapshot(tx) });
        });
      recordRecurringRevision(rule, 'historical', '', null, null, {
        beforeRule, afterRule: recurringSnapshot(rule), changes
      });
    } else if (isRuleUpdate) {
      recordRecurringRevision(rule, 'future', '', beforeRule, rule);
    }
    logAction(idx > -1 ? 'update' : 'create', 'recurring', before, rule);

    if (isRuleUpdate) {
      // ✅ SÉCURITÉ : on ne reconstruit QUE les occurrences futures (mois courant inclus)
      // Les mois passés ne sont PAS touchés pour préserver les données historiques.
      rebuildOccurrencesForRuleFutureOnly(rule.id);
    } else {
      // Nouvelle règle ou conversion manuelle→récurrente : reconstruction complète
      if (id) {
        const origIdx = transactions.findIndex(t => String(t.id) === String(id) && !t.parentId);
        if (origIdx > -1) {
          revertOccurrenceSideEffects(transactions[origIdx]);
          transactions.splice(origIdx, 1);
        }
      }
      rebuildOccurrencesForRule(rule.id);
    }

    // Avec « Toute la série », la couleur appartient à la règle et non
    // à l'occurrence ouverte (qui doit rester libre d'être régénérée).

  } else {
    // ✅ FIX savings_withdrawal : convertir en revenu + soustraire de l'épargne
    const isSavingsWithdrawal = type === 'savings_withdrawal';
    const tx = {
      id: id || (genId()),
      type: isSavingsWithdrawal ? 'income' : type,
      fromSavings: isSavingsWithdrawal || undefined,
      incomeClass,
      category,
      amount: amountBase,
      amountBase: amountBase,
      originalAmount: amountInput,
      currency: curr,
      fxRate: curr !== settings.baseCurrency ? fxRate : null,
      date,
      time,
      desc,
      tags,
      mode,
      transferTarget,
      isRecurring: false,
      paymentStatus,
      // ✅ FIX : si l'utilisateur édite une occurrence récurrente (parentId présent),
      // on efface parentId et periodKey pour la rendre indépendante.
      parentId: '',
      periodKey: '',
      linkedDebtId,
      _effectsApplied: false,
      // ✅ Couleur de validation personnalisée par transaction
      reconcileColor: (document.getElementById('transReconcileColor')?.dataset.customColor) || ''
    };

    const idx = transactions.findIndex(t => String(t.id) === String(tx.id));
    // Appliquer l'effet sur l'objet réellement conservé, pour ne pas le rejouer au prochain rendu.
    const stored = idx > -1 ? (transactions[idx] = { ...transactions[idx], ...tx }) : tx;
    savedManualTransaction = stored;
    if (idx === -1) transactions.push(stored);
    const { savingsDelta } = replaceOccurrenceSideEffects(existingBefore, stored);
    logAction(idx > -1 ? 'update' : 'create', 'transaction', existingBefore, stored);
    if (savingsDelta) logAction('adjust_savings_transfer', 'savings', { target: transferTarget }, { delta: savingsDelta });
  }

  if (draftEntry) setTransactionDraftStore(getTransactionDraftStore().filter(item => String(item.id) !== String(draftEntry.id)));
  saveData();
  if (savedManualTransaction && !id && scannedMerchant && receiptNotice?.dataset.ocrMerchant) {
    window.FreevReceiptScanner?.learnConfirmedMerchant?.(currentAccountId, receiptNotice.dataset.ocrMerchant, scannedMerchant);
  }
  if (existingBefore && savedManualTransaction && !isRecurring) await rememberConfirmedTransactionCorrection(String(currentAccountId), existingBefore, savedManualTransaction);
  closeModal();
  syncAllUI();
  showToast(draftEntry ? 'Brouillon complété et ajouté à la comptabilité.' : 'Enregistré', 'success');
}

// Les boutons Annuler peuvent survivre à une bascule de compte ou de session.
// Ne jamais restaurer une opération sur un autre compte, même si son ID est identique.
function captureFinancialUndoContext() {
  return {
    accountId: String(currentAccountId || ''),
    uid: typeof window === 'undefined' ? '' : String(window.__freevUserId || ''),
    authEpoch: typeof window === 'undefined' ? 0 : Number(window.__freevAuthEpoch || 0),
    accountEpoch: typeof window === 'undefined' ? 0 : Number(window.__freevAccountEpoch || 0)
  };
}
function isFinancialUndoContextCurrent(context) {
  const current = captureFinancialUndoContext();
  return !!context && context.accountId === current.accountId &&
    context.uid === current.uid && context.authEpoch === current.authEpoch &&
    context.accountEpoch === current.accountEpoch;
}

let lastDeleted = null;
function deleteTransaction(id) {
  const idx = transactions.findIndex(t => String(t.id) === String(id));
  if (idx === -1) return;

  if (transactions[idx]?.linkedTransferId && deleteLinkedTransferPair(id)) return;

  // Une occurrence récurrente supprimée devient une exception de la série.
  // CRITIQUE : même si l'utilisateur ANNULE les deux confirmations, ne pas
  // poursuivre vers la suppression ordinaire (ce qui contournerait le verrou).
  if (transactions[idx]?.parentId) {
    const parent = recurringTransactions.find(r => String(r.id) === String(transactions[idx].parentId));
    if (parent) {
      skipRecurringOccurrenceById(id);
      return;
    }
    // Une vieille sauvegarde peut contenir une échéance sans règle parente.
    if ((transactions[idx].date || '').slice(0, 7) < isoMonth(getToday()) &&
        !confirmArchivedRecurringChange(transactions[idx].date, 'supprimer')) return;
  }

  const removed = transactions.splice(idx, 1)[0];
  revertOccurrenceSideEffects(removed);
  const undoEntry = { item: removed, index: idx, ts: Date.now(), context: captureFinancialUndoContext() };
  lastDeleted = undoEntry;
  logAction('delete', 'transaction', removed, null);
  saveData();
  syncAllUI();

  showToast('Transaction supprimée', 'neutral', true, () => {
    if (lastDeleted !== undoEntry || !isFinancialUndoContextCurrent(undoEntry.context)) return;
    if (transactions.some(tx => String(tx.id) === String(undoEntry.item.id))) return;
    transactions.splice(Math.min(undoEntry.index, transactions.length), 0, undoEntry.item);
    applyOccurrenceSideEffects(undoEntry.item);
    logAction('undo_delete', 'transaction', null, undoEntry.item);
    lastDeleted = null;
    saveData();
    syncAllUI();
    showToast('Suppression annulée', 'success');
  });
}

// Remove and regenerate occurrences for a given recurring rule (keeps savings consistent)
function rebuildOccurrencesForRule(ruleId) {
  const occ = transactions.filter(t => String(t.parentId || '') === String(ruleId));
  occ.forEach(revertOccurrenceSideEffects);
  transactions = transactions.filter(t => String(t.parentId || '') !== String(ruleId));
  generateRecurringOccurrences(null, 18, 0, ruleId);
  // saveData() est appelé par l'appelant (saveTransaction → saveData)
}

// ✅ SÉCURITÉ MOIS PASSÉS : reconstruit UNIQUEMENT les occurrences non verrouillées
// du mois courant et futur. Les occurrences passées ou validées par l'utilisateur
// sont conservées telles quelles (historique protégé).
function rebuildOccurrencesForRuleFutureOnly(ruleId) {
  const todayStr = isoDate(getToday());

  // Ne jamais retoucher une échéance déjà arrivée, même dans le mois courant.
  // Les exceptions modifiées/vérifiées restent telles quelles dans tous les mois.
  const toRemove = transactions.filter(t =>
    String(t.parentId || '') === String(ruleId) &&
    t.date > todayStr && !isUserProtectedOccurrence(t)
  );
  toRemove.forEach(revertOccurrenceSideEffects);
  // Filtrer les références exactes, pas seulement l'ID : une sauvegarde
  // ancienne peut contenir le même ID sur deux séries différentes.
  const removedOccurrences = new Set(toRemove);
  transactions = transactions.filter(t => !removedOccurrences.has(t));

  // Une mise à jour de la série ne doit jamais créer rétroactivement des
  // transactions absentes dans les anciens mois avec le NOUVEAU montant.
  generateRecurringOccurrences(isoMonth(getToday()), 0, 0, ruleId);
}

function applySingleRecurringOccurrenceChange(rule, occurrenceId, occurrencePeriodKey, originalDate, changes, options = {}) {
  if (!rule || !isValidISODate(changes?.date) || !Number.isFinite(changes?.amountBase) ||
      changes.amountBase < 0.01 || changes.amountBase > 1e12) return false;

  const frequency = normalizeRecurringFrequency(rule.frequency);
  const key = occurrencePeriodKey || (originalDate ? periodKey(originalDate, frequency) : '');
  // Une exception est limitée à la période demandée (mois/semaine/année).
  // Cette vérification protège aussi les appels qui ne passent pas par le modal.
  if (!key || periodKey(changes.date, frequency) !== key) return false;
  if (isRecurringPeriodSkipped(rule, key)) return false;
  // Verrou appliqué dans le moteur, pas uniquement dans le formulaire.
  if (isArchivedRecurringMonth(rule, key, originalDate || changes.date) && options.authorizeArchivedMonth !== true) return false;

  let tx = transactions.find(t => String(t.id) === String(occurrenceId || '') &&
    String(t.parentId || '') === String(rule.id) &&
    String(t.periodKey || (t.date ? periodKey(t.date, frequency) : '')) === key);
  // Ne jamais remplacer un ID stocké d'un autre mois par la première
  // échéance trouvée : cela masquerait un conflit de navigation ou de cache.
  if (!tx && occurrenceId && !String(occurrenceId).startsWith('__projected_')) return false;
  if (!tx) {
    tx = transactions.find(t => {
      if (String(t.parentId || '') !== String(rule.id)) return false;
      const txKey = t.periodKey || (t.date ? periodKey(t.date, frequency) : '');
      return txKey === key;
    });
  }

  const existedBeforeChange = !!tx;
  if (!tx) {
    // Ne jamais créer une échéance hors calendrier de la règle.
    const scheduled = recurringDatesForMonth(rule, String(originalDate || changes.date).slice(0, 7));
    if (!scheduled.some(candidate => periodKey(candidate, frequency) === key)) return false;
    tx = buildRecurringOccurrence(rule, originalDate || changes.date, { periodKey: key });
    transactions.push(tx);
  }

  const before = existedBeforeChange ? recurringSnapshot(tx) : null;
  revertOccurrenceSideEffects(tx);
  // Une exception reste attachée à sa période d'origine, même si sa date change.
  Object.assign(tx, {
    date: changes.date,
    type: changes.type === 'savings_withdrawal' ? 'income' : changes.type,
    fromSavings: changes.type === 'savings_withdrawal' || undefined,
    category: changes.category,
    amount: changes.amountBase,
    amountBase: changes.amountBase,
    originalAmount: changes.originalAmount,
    currency: changes.currency,
    fxRate: changes.fxRate,
    incomeClass: changes.incomeClass || '',
    desc: changes.desc,
    tags: changes.tags,
    mode: changes.mode,
    transferTarget: changes.transferTarget,
    linkedDebtId: changes.linkedDebtId,
    reconcileColor: /^#[0-9a-f]{6}$/i.test(changes.reconcileColor || '') ? changes.reconcileColor : '',
    projected: false
  });
  if (before?.linkedDebtId !== changes.linkedDebtId) tx.linkedDebtAccountId = '';
  if (before?.linkedDebtAmount !== undefined && before?.amountBase !== changes.amountBase)
    delete tx.linkedDebtAmount;
  tx.parentId = rule.id;
  tx.periodKey = key;
  tx.source = 'recurring';
  tx.isRecurring = false;
  tx._manuallyEdited = true;
  tx._dateOverride = changes.date !== originalDate;
  tx._effectsApplied = false;
  applyOccurrenceSideEffects(tx);

  recordRecurringRevision(rule, 'single', key, before, tx);
  logAction('update_single', 'transaction', before, tx);
  return true;
}

// PRIORITÉ 2 — séparation explicite des opérations prévues et payées.
function updatePaymentStatusControl() {
  const type = document.getElementById('transType')?.value;
  const isRecurring = document.getElementById('isRecurring')?.checked;
  const hasDebt = Boolean(document.getElementById('transLinkedDebt')?.value);
  const control = document.getElementById('transPaymentStatus');
  const group = document.getElementById('paymentStatusGroup');
  if (!control || !group) return;
  const edited = transactions.find(tx => String(tx.id) === String(document.getElementById('editId')?.value || ''));
  const category = document.getElementById('transCategory')?.value;
  const supported = ['income','expense'].includes(type) && !isRecurring && !hasDebt && !edited?.parentId && category !== 'Remboursement dette';
  group.hidden = !supported;
  control.disabled = !supported;
  if (!supported) control.value = 'paid';
  control._freevCustomSelect?.sync?.();
}
function markPlannedTransactionPaid(id) {
  if (multiViewMode !== 'individual') return showToast('Sélectionnez un compte pour valider son paiement.', 'error');
  const tx = transactions.find(t => String(t.id) === String(id));
  if (!tx || tx.paymentStatus !== 'planned' || tx.parentId || tx.linkedDebtId || tx.fromSavings || !['income','expense'].includes(tx.type))
    return showToast('Cette opération ne peut pas être validée automatiquement.', 'error');
  if (!confirm(`Confirmer le paiement de ${formatCurrency(Number(tx.amountBase ?? tx.amount) || 0)} pour « ${tx.desc || tx.category || 'opération'} » ?`)) return;
  const before = { ...tx };
  tx.paymentStatus = 'paid';
  logAction('mark_paid', 'transaction', before, { ...tx });
  saveData();
  syncAllUI();
  showToast('Paiement confirmé', 'success');
}
document.addEventListener?.('change', event => {
  if (['transType','isRecurring','transLinkedDebt'].includes(event.target?.id)) updatePaymentStatusControl();
});
