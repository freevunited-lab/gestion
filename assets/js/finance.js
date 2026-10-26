// ---------- Savings ----------
function renderSavingsList() {
  const container = document.getElementById('savingsList');
  const totalDisplay = document.getElementById('totalSavingsDisplay');
  const total = computeSavingsTotal();
  if (totalDisplay) {
    // Animate count-up
    const start = Date.now();
    const dur = 700;
    const tick = () => {
      const p = Math.min((Date.now()-start)/dur, 1);
      const ease = 1 - Math.pow(1-p, 3);
      totalDisplay.textContent = formatCurrency(total * ease);
      if (p < 1) requestAnimationFrame(tick);
      else totalDisplay.textContent = formatCurrency(total);
    };
    requestAnimationFrame(tick);
  }

  if (!container) return;

  const entries = Object.entries(savingsAccounts || {});
  if (!entries.length) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-piggy-bank"></i><p>Aucun livret d'épargne</p></div>`;
    return;
  }

  container.innerHTML = entries.map(([type, amount], idx) => {
    const isNegative = Number(amount) < 0;
    const meta = savingsMeta[type] || {};
    const storedColor = String(meta.color || '');
    const baseColor = isNegative ? '#dc2626' : (/^#[0-9a-f]{6}$/i.test(storedColor) ? storedColor : '#059669');
    const bgStyle = `background:${baseColor}11;border:1px solid ${baseColor}33;`;
    const amtColor = isNegative ? 'color:#dc2626;' : `color:${baseColor};`;
    const iconStyle = `background:${baseColor};`;
    const warningBadge = isNegative
      ? `<span style="font-size:0.7rem;background:#fee2e2;color:#dc2626;border-radius:9999px;padding:0.15rem 0.6rem;font-weight:700;margin-left:0.5rem;">
           <i class="fa-solid fa-triangle-exclamation"></i> Solde négatif
         </span>`
      : '';
    return `
    <div class="flex items-center justify-between p-4 rounded-lg mb-3"
         style="${bgStyle}opacity:0;transform:translateY(10px);transition:opacity 0.35s ease ${idx*80}ms,transform 0.35s ease ${idx*80}ms;">
      <div class="flex items-center gap-3" style="flex:1;min-width:0;">
        <div class="stat-icon" style="width:48px;height:48px;font-size:1.25rem;${iconStyle}border-radius:0.75rem;flex-shrink:0;">
          <i class="fa-solid fa-piggy-bank text-white"></i>
        </div>
        <div style="flex:1;min-width:0;">
          <div class="font-semibold text-slate-800">${escapeHTML(type)}${warningBadge}</div>
          <div class="text-2xl font-bold" style="${amtColor}">${formatCurrency(amount)}</div>
          <button type="button" class="btn btn-secondary btn-sm js-savings-correct-excess" data-type="${escapeHTML(type)}" style="margin-top:0.5rem;">Enlever le trop-perçu</button>
          ${isNegative ? '<div class="text-xs" style="color:#dc2626;">Correction recommandée — ajustez le solde via "Gérer"</div>' : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:0.4rem;flex-shrink:0;margin-left:0.75rem;">
        <!-- Couleur du livret -->
        <label class="freev-color-choice freev-color-choice-compact freev-color-choice-icon-only" title="Choisir la couleur du livret ${escapeHTML(type)}">
          <input type="color" value="${baseColor}" aria-label="Choisir la couleur du livret ${escapeHTML(type)}"
            class="js-savings-color" data-savingtype="${escapeHTML(type)}">
          <span class="freev-color-choice-ui"><i class="fa-solid fa-palette" aria-hidden="true"></i><i class="freev-color-choice-dot" style="background:${baseColor}" aria-hidden="true"></i></span>
        </label>
        <!-- Renommer -->
        <button class="btn-icon js-rename-savings" data-type="${escapeHTML(type)}" title="Renommer" style="padding:0.4rem;">
          <i class="fa-solid fa-pencil" style="font-size:0.8rem;"></i>
        </button>
        <!-- Supprimer -->
        <button class="btn-icon js-remove-savings" data-type="${escapeHTML(type)}" aria-label="Supprimer" style="padding:0.4rem;">
          <i class="fa-solid fa-trash" style="font-size:0.8rem;"></i>
        </button>
      </div>
    </div>
  `}).join('');

  // Trigger animation
  requestAnimationFrame(() => requestAnimationFrame(() => {
    container.querySelectorAll(':scope > div').forEach(el => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });
  }));

  // Bind events
  container.querySelectorAll('.js-remove-savings').forEach(btn => {
    btn.addEventListener('click', () => removeSavingsAccount(btn.dataset.type));
  });
  container.querySelectorAll('.js-savings-correct-excess').forEach(btn => {
    btn.addEventListener('click', () => openSavingsBalanceCorrection(btn.dataset.type, 'remove_excess'));
  });
  container.querySelectorAll('.js-rename-savings').forEach(btn => {
    btn.addEventListener('click', () => renameSavingsAccount(btn.dataset.type));
  });
  container.querySelectorAll('.js-savings-color').forEach(input => {
    input.addEventListener('input', () => {
      const dot = input.parentElement?.querySelector('.freev-color-choice-dot');
      if (dot) dot.style.background = input.value;
    });
    input.addEventListener('change', () => {
      const t = input.dataset.savingtype;
      savingsMeta[t] = { ...(savingsMeta[t] || {}), color: input.value };
      saveData();
      renderSavingsList();
    });
  });
}

function saveSavingsMeta() {
  saveData();
  renderSavingsList();
}

function renameSavingsAccount(oldName) {
  const newName = prompt('Nouveau nom du livret :', oldName);
  if (!newName || !newName.trim() || newName.trim() === oldName) return;
  const name = newName.trim();
  if (savingsAccounts[name] !== undefined) { showToast('Ce nom existe déjà', 'error'); return; }
  savingsAccounts[name] = savingsAccounts[oldName];
  delete savingsAccounts[oldName];
  // Migrer la meta
  if (savingsMeta[oldName]) { savingsMeta[name] = savingsMeta[oldName]; delete savingsMeta[oldName]; }
  // Migrer toutes les transactions liées (le bon champ est transferTarget)
  accounts.forEach(acc => {
    (acc.transactions || []).forEach(t => {
      if (t.transferTarget === oldName) t.transferTarget = name;
    });
    (acc.recurringTransactions || []).forEach(r => {
      if (r.transferTarget === oldName) r.transferTarget = name;
    });
  });
  transactions.forEach(t => {
    if (t.transferTarget === oldName) t.transferTarget = name;
  });
  recurringTransactions.forEach(r => {
    if (r.transferTarget === oldName) r.transferTarget = name;
  });
  saveData();
  refreshSavingsSelect();
  renderSavingsList();
  showToast(`Livret renommé en "${name}"`, 'success');
}

function calculateSavingsCorrection(type, action, value) {
  if (!Object.prototype.hasOwnProperty.call(savingsAccounts, type)) return { error: 'Livret introuvable' };
  const current = Number(savingsAccounts[type]);
  const amount = safeNumber(value, NaN);
  if (!Number.isFinite(current) || !Number.isFinite(amount) || amount < 0) return { error: 'Montant invalide' };
  const currentCents = Math.round(current * 100);
  const amountCents = Math.round(amount * 100);
  if (!Number.isSafeInteger(currentCents) || !Number.isSafeInteger(amountCents) ||
      Math.abs(amount * 100 - amountCents) > 0.000001) return { error: 'Utilise deux décimales au maximum' };
  if (action === 'remove_excess' && (amountCents <= 0 || amountCents > currentCents)) {
    return { error: 'Le trop-perçu doit être supérieur à 0 et ne pas dépasser le solde du livret' };
  }
  const nextCents = action === 'set' ? amountCents : currentCents - amountCents;
  if (nextCents === currentCents) return { error: 'Le solde est déjà correct' };
  return { previous: currentCents / 100, amount: amountCents / 100, next: nextCents / 100 };
}

function updateSavingsCorrectionPreview() {
  const action = document.getElementById('savingsAction')?.value;
  const preview = document.getElementById('savingsCorrectionPreview');
  const label = document.getElementById('savingsAmountLabel');
  const submit = document.getElementById('savingsSubmitButton');
  if (!preview || !label || !submit) return;
  const isCorrection = action === 'set' || action === 'remove_excess';
  preview.hidden = !isCorrection;
  label.textContent = action === 'remove_excess' ? 'Montant en trop à enlever (€)' :
    action === 'set' ? 'Solde correct à afficher (€)' : 'Montant (€)';
  if (!isCorrection) { submit.disabled = false; return; }
  const result = calculateSavingsCorrection(
    document.getElementById('savingsType')?.value || '', action,
    document.getElementById('savingsAmount')?.value || ''
  );
  submit.disabled = !!result.error;
  preview.textContent = result.error || (action === 'remove_excess'
    ? `Solde actuel ${formatCurrency(result.previous)} − trop-perçu ${formatCurrency(result.amount)} = nouveau solde ${formatCurrency(result.next)}. Le solde du compte courant ne change pas.`
    : `Solde actuel ${formatCurrency(result.previous)} → solde corrigé ${formatCurrency(result.next)}. Le solde du compte courant ne change pas.`);
}

function saveSavings() {
  const type = document.getElementById('savingsType').value;
  const action = document.getElementById('savingsAction').value;
  const amount = safeNumber(document.getElementById('savingsAmount').value, NaN);
  if (!Number.isFinite(amount) || amount < 0 || (action !== 'set' && amount === 0)) return showToast('Montant invalide', 'error');

  if (action === 'set' || action === 'remove_excess') {
    const correction = calculateSavingsCorrection(type, action, document.getElementById('savingsAmount').value);
    if (correction.error) return showToast(correction.error, 'error');
    const canBackupLocally = isTrustedDeviceCacheEnabled();
    const backupMessage = canBackupLocally
      ? 'Une sauvegarde locale sera créée avant la correction.'
      : 'Le cache local est désactivé : aucune sauvegarde locale ne sera créée.';
    const explanation = action === 'remove_excess'
      ? `Enlever ${formatCurrency(correction.amount)} en trop du livret « ${type} » ?`
      : `Définir le solde du livret « ${type} » à ${formatCurrency(correction.next)} ?`;
    if (!confirm(`${explanation}\n${formatCurrency(correction.previous)} → ${formatCurrency(correction.next)}.\nLe solde du compte courant ne change pas.\n\n${backupMessage}`)) return;
    if (canBackupLocally && !manualAutoBackup()) return;
    const before = { ...savingsAccounts };
    savingsAccounts[type] = correction.next;
    logAction(action === 'remove_excess' ? 'remove_savings_overcount' : 'reconcile_exact_balance', 'savings', before, { ...savingsAccounts });
    saveData();
    toggleSavingsModal();
    syncAllUI();
    showToast('Solde d’épargne rectifié', 'success');
    return;
  }

  const before = { ...savingsAccounts };
  if (!savingsAccounts[type]) savingsAccounts[type] = 0;

  if (action === 'add') {
    savingsAccounts[type] += amount;
  } else {
    if (savingsAccounts[type] < amount) return showToast('Solde insuffisant', 'error');
    savingsAccounts[type] -= amount;
    if (savingsAccounts[type] === 0) delete savingsAccounts[type];
  }

  logAction('update', 'savings', before, { ...savingsAccounts });
  saveData();
  updateDashboard();
  toggleSavingsModal();
  renderSavingsList();
  refreshSavingsSelect();
  showToast('Épargne mise à jour', 'success');
}

function removeSavingsAccount(type) {
  const backup = savingsAccounts[type];
  if (backup === undefined) return;
  const before = { ...savingsAccounts };
  delete savingsAccounts[type];
  logAction('delete', 'savings_account', before, { ...savingsAccounts });
  saveData();
  syncAllUI();
  const undoContext = captureFinancialUndoContext();
  showToast(`Livret "${type}" supprimé`, 'neutral', true, () => {
    if (!isFinancialUndoContextCurrent(undoContext) || savingsAccounts[type] !== undefined) return;
    savingsAccounts[type] = backup;
    saveData();
    syncAllUI();
    showToast('Suppression annulée', 'success');
  });
}

// ---------- Budget/Capital modals (existing) ----------
function toggleBudgetModal() {
  const modal = document.getElementById('budgetModal');
  modal.classList.toggle('hidden');
  if (!modal.classList.contains('hidden')) {
    document.getElementById('budgetAmount').value = monthlyBudget || '';
  }
}

function toggleCapitalModal() {
  const modal = document.getElementById('capitalModal');
  modal.classList.toggle('hidden');
  if (!modal.classList.contains('hidden')) {
    document.getElementById('capitalAmount').value = initialCapital || '';
    // Afficher le solde actuel dans la modale (utiliser le mois sélectionné dans le picker)
    const selectedMonth = document.getElementById('globalMonthPicker')?.value || isoMonth(getToday());
    const currentBalance = computeBalance(selectedMonth);
    const balanceDisplay = document.getElementById('currentBalanceInModal');
    if (balanceDisplay) {
      balanceDisplay.textContent = formatCurrency(currentBalance);
    }
  }
}

function saveBudget() {
  const amount = safeNumber(document.getElementById('budgetAmount').value, 0);
  const before = monthlyBudget;
  monthlyBudget = amount;
  logAction('update', 'budget', before, monthlyBudget);
  saveData();
  toggleBudgetModal();
  syncDashboard(); // ✅ FIX Perf : mise à jour légère, pas besoin de tout rerender
  showToast('Budget enregistré', 'success');
}

function saveCapital() {
  const amount = safeNumber(document.getElementById('capitalAmount').value, 0);
  const before = initialCapital;
  initialCapital = amount;
  logAction('update', 'capital', before, initialCapital);
  saveData();
  toggleCapitalModal();
  syncDashboard(); // ✅ FIX Perf : mise à jour légère
  showToast('Capital enregistré', 'success');
}

function toggleSavingsModal() {
  const modal = document.getElementById('savingsModal');
  if (modal?.classList.contains('hidden')) {
    const select = document.getElementById('savingsType');
    if (select) {
      const selected = select.value;
      const names = [...new Set([...Object.keys(savingsAccounts || {}), 'Livret A', 'LDD', 'PEL', 'Assurance-vie', 'Autre'])];
      select.innerHTML = names.map(name => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join('');
      if (names.includes(selected)) select.value = selected;
    }
    const action = document.getElementById('savingsAction');
    action.value = 'add';
    action.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('savingsAmount').value = '';
  }
  modal.classList.toggle('hidden');
  if (!modal.classList.contains('hidden')) updateSavingsCorrectionPreview();
}

function openSavingsBalanceCorrection(type = '', mode = 'set') {
  const modal = document.getElementById('savingsModal');
  if (modal?.classList.contains('hidden')) toggleSavingsModal();
  const select = document.getElementById('savingsType');
  const target = type || Object.keys(savingsAccounts || {})[0] || '';
  if (select && target) {
    select.value = target;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const action = document.getElementById('savingsAction');
  if (action) {
    action.value = mode === 'remove_excess' ? 'remove_excess' : 'set';
    action.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const amount = document.getElementById('savingsAmount');
  if (amount) {
    amount.value = mode === 'remove_excess' ? '' :
      target && savingsAccounts[target] !== undefined ? String(savingsAccounts[target]) : '';
    amount.focus();
    if (mode !== 'remove_excess') amount.select();
  }
  updateSavingsCorrectionPreview();
}

// ---------- Settings view ----------
function loadSettingsUI() {
  const base = document.getElementById('baseCurrency');
  const def = document.getElementById('defaultMode');
  const txt = document.getElementById('budgetsByCategoryText');

  if (base) base.value = settings.baseCurrency || 'EUR';
  if (def) def.value = settings.defaultMode || 'personal';
  if (txt) {
    const lines = Object.entries(budgetsByCategory||{}).map(([k,v])=>`${k}=${v}`).join('\n');
    txt.value = lines;
  }

  // ✅ Nouveau : charger les taux, catégories perso, status backup
  loadRatesUI();
  renderCustomCategoriesList();
  updateAutoBackupStatus();
  loadFabColor();
  loadReconcileColor();
  renderFavTagsSettings();
}

function saveSettings() {
  const base = document.getElementById('baseCurrency')?.value || 'EUR';
  const def = document.getElementById('defaultMode')?.value || 'personal';
  const prevBase = settings.baseCurrency || 'EUR';
  if (base !== prevBase && (transactions || []).length > 0) {
    showToast('Devise de base: changement bloqué (transactions existantes). Exportez/effacez ou ajoutez une conversion globale.', 'error');
    const baseSel = document.getElementById('baseCurrency');
    if (baseSel) baseSel.value = prevBase;
    return;
  }
  settings.baseCurrency = base;
  settings.defaultMode = def;

  const raw = document.getElementById('budgetsByCategoryText')?.value || '';
  const obj = {};
  raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).forEach(line => {
    const parts = line.split('=');
    if (parts.length < 2) return;
    const key = normalizeCategory(parts[0]);
    const val = safeNumber(parts.slice(1).join('='), NaN);
    if (Number.isFinite(val)) obj[key] = val;
  });
  budgetsByCategory = obj;

  logAction('update', 'settings', null, { settings, budgetsByCategory });
  saveData();
  populateCategorySelects(); // ✅ Mettre à jour tous les selects de catégories
  syncAllUI();
  showToast('Réglages enregistrés', 'success');
}

// ---------- Debts ----------
function findDebtContext(debtId, accountId = '') {
  if (!debtId) return null;
  if (accountId) {
    const account = accounts.find(item => String(item.id) === String(accountId));
    const debt = (account?.debts || []).find(item => String(item.id) === String(debtId));
    return debt ? { debt, account } : null;
  }
  const localDebt = debts.find(item => String(item.id) === String(debtId));
  if (localDebt) return { debt: localDebt, account: getCurrentAccount() };
  for (const account of accounts) {
    const debt = (account.debts || []).find(item => String(item.id) === String(debtId));
    if (debt) return { debt, account };
  }
  return null;
}

function logDebtChange(context, before, after) {
  if (!context?.account || String(context.account.id) === String(currentAccountId)) {
    logAction('update', 'debt', before, after);
    return;
  }
  context.account.historyLog = context.account.historyLog || [];
  context.account.historyLog.unshift({
    ts: new Date().toISOString(), action: 'update', entity: 'debt',
    before: `${before.person || 'Dette'} · ${formatCurrencySimple(before.remainingAmount ?? before.amount, context.account.settings?.baseCurrency || 'EUR')}`,
    after: `${after.person || 'Dette'} · ${formatCurrencySimple(after.remainingAmount ?? after.amount, context.account.settings?.baseCurrency || 'EUR')}`
  });
  context.account.historyLog = context.account.historyLog.slice(0, 500);
}

// accountId permet d'annuler proprement un remboursement payé depuis un autre compte.
function decreaseDebt(debtId, amount, accountId = '', persist = true) {
  const context = findDebtContext(debtId, accountId);
  if (!context) return false;
  const before = { ...context.debt };
  const currentRemaining = Number(context.debt.remainingAmount ?? context.debt.amount) || 0;
  context.debt.remainingAmount = roundMoney(Math.max(0, currentRemaining - (Number(amount) || 0)));
  logDebtChange(context, before, { ...context.debt });
  if (persist) saveData();
  return true;
}

function increaseDebt(debtId, amount, accountId = '', persist = true) {
  const context = findDebtContext(debtId, accountId);
  if (!context) return false;
  const before = { ...context.debt };
  const initialAmount = Number(context.debt.initialAmount ?? context.debt.amount) || 0;
  const currentRemaining = Number(context.debt.remainingAmount ?? context.debt.amount) || 0;
  context.debt.remainingAmount = roundMoney(Math.min(initialAmount, currentRemaining + (Number(amount) || 0)));
  logDebtChange(context, before, { ...context.debt });
  if (persist) saveData();
  return true;
}

function openDebtModal(editId = null) {
  // Bug 6 fix : toujours réinitialiser le formulaire avant d'ouvrir
  document.getElementById('debtForm')?.reset();
  document.getElementById('debtEditId').value = editId || '';

  const titleEl = document.querySelector('#debtModal .modal-header h3');

  if (editId) {
    // Bug 3 : mode édition — pré-remplir avec les données existantes
    const d = debts.find(x => String(x.id) === String(editId));
    if (!d) return;
    if (titleEl) titleEl.textContent = 'Modifier la dette';
    document.getElementById('debtPerson').value = d.person || '';
    document.getElementById('debtDirection').value = d.direction || 'they_owe_me';
    document.getElementById('debtAmount').value = d.initialAmount ?? d.amount ?? '';
    document.getElementById('debtDate').value = d.date || '';
    document.getElementById('debtStartDate').value = d.startDate || '';
    document.getElementById('debtEndDate').value = d.endDate || '';
    document.getElementById('debtNote').value = d.note || '';
  } else {
    if (titleEl) titleEl.textContent = 'Nouvelle dette';
    document.getElementById('debtDate').value = isoDate(today);
  }

  document.getElementById('debtModal')?.classList.remove('hidden');
  setTimeout(() => document.getElementById('debtPerson')?.focus(), 0);
}

function closeDebtModal() {
  document.getElementById('debtModal')?.classList.add('hidden');
  document.getElementById('debtForm')?.reset();
}

function saveDebt(e) {
  e.preventDefault();
  const editId = document.getElementById('debtEditId')?.value || '';
  const person = (document.getElementById('debtPerson').value || '').trim();
  const direction = document.getElementById('debtDirection').value;
  const amount = safeNumber(document.getElementById('debtAmount').value, NaN);
  const date = document.getElementById('debtDate').value;
  const note = document.getElementById('debtNote').value || '';
  const startDate = document.getElementById('debtStartDate').value || date;
  const endDate = document.getElementById('debtEndDate').value || '';

  if (!person) return showToast('Personne requise', 'error');
  if (!Number.isFinite(amount) || amount <= 0) return showToast('Montant invalide', 'error');
  if (!date) return showToast('Date invalide', 'error');

  if (editId) {
    const idx = debts.findIndex(x => String(x.id) === String(editId));
    if (idx === -1) return showToast('Dette introuvable', 'error');
    const old = debts[idx];
    const amountChanged = (Number(old.initialAmount ?? old.amount) || 0) !== amount;

    let newRemaining;
    if (!amountChanged) {
      newRemaining = Number(old.remainingAmount ?? old.amount) || 0;
    } else {
      // Recalcul proportionnel automatique (pas de confirm bloquant)
      const oldInitial = Number(old.initialAmount ?? old.amount) || 0;
      const oldRemaining = Number(old.remainingAmount ?? old.amount) || 0;
      newRemaining = oldInitial > 0
        ? Math.min(amount, roundMoney(oldRemaining * (amount / oldInitial)))
        : amount;
    }

    debts[idx] = { ...old, person, direction, amount, initialAmount: amount, date, note, startDate, endDate, remainingAmount: newRemaining };
    logAction('update', 'debt', old, debts[idx]);
  } else {
    // Mode création
    const d = {
      id: genId(),
      person,
      direction,
      amount,
      date,
      note,
      startDate,
      endDate,
      initialAmount: amount,
      remainingAmount: amount
    };
    debts.push(d);
    logAction('create', 'debt', null, d);
  }

  saveData();
  closeDebtModal();
  renderDebts();
  showToast(editId ? 'Dette modifiée' : 'Dette enregistrée', 'success');
}

function renderDebts() {
  const container = document.getElementById('debtsSummary');
  if (!container) return;

  if (!debts.length) {
    container.innerHTML = `<div class="empty-state" data-freev-layout-scope="debts" data-freev-layout-group="debtSections" data-freev-layout-key="summary" data-freev-layout-label="Résumé des dettes" data-freev-layout-required="true"><i class="fa-solid fa-handshake"></i><p>Aucune dette enregistrée</p></div>`;
    window.applyFreevLayoutPreferences?.();
    return;
  }

  const byPerson = {};
  debts.forEach(d => {
    const sign = d.direction === 'they_owe_me' ? 1 : -1;
    const remaining = Number(d.remainingAmount ?? d.amount) || 0;
    if (!byPerson[d.person]) {
      byPerson[d.person] = { total: 0, remaining: 0 };
    }
    byPerson[d.person].total += sign * (Number(d.amount)||0);
    byPerson[d.person].remaining += sign * remaining;
  });

  const rows = Object.entries(byPerson).sort((a,b)=>Math.abs(b[1].remaining)-Math.abs(a[1].remaining)).map(([p, data]) => {
    const label = data.remaining >= 0 ? 'me doit' : 'je dois';
    const cls = data.remaining >= 0 ? 'text-emerald-600' : 'text-rose-600';
    return `<tr>
      <td>${escapeHTML(p)}</td>
      <td class="${cls}" style="font-weight:800;">${escapeHTML(label)} ${formatCurrency(Math.abs(data.remaining))}</td>
    </tr>`;
  }).join('');

  const details = debts.slice().sort((a,b)=> (b.date||'').localeCompare(a.date||'')).map(d => {
    const label = d.direction==='they_owe_me' ? 'Il/Elle me doit' : 'Je lui dois';
    const remaining = Number(d.remainingAmount ?? d.amount) || 0;
    const initial = Number(d.initialAmount ?? d.amount) || 0;
    const progress = initial > 0 ? Math.max(0, Math.min(100, Math.round((1 - remaining / initial) * 100))) : 0;
    const progressBar = remaining > 0 ? `
      <div style="font-size: 0.75rem; color: #64748b;">
        Restant: ${formatCurrency(remaining)} / ${formatCurrency(initial)}
        <div style="background: #e5e7eb; border-radius: 4px; height: 6px; margin-top: 4px; overflow: hidden;">
          <div class="debt-progress-bar" data-target="${progress}" style="background: linear-gradient(90deg,#10b981,#059669); height: 100%; width: 0%; transition: width 0.9s cubic-bezier(0.22,1,0.36,1);"></div>
        </div>
      </div>
    ` : `<span style="font-size: 0.75rem; color: #10b981; font-weight: 600;">✓ Payée</span>`;
    
    const dates = d.startDate || d.endDate ? `
      <div style="font-size: 0.75rem; color: #64748b; margin-top: 4px;">
        ${d.startDate ? `Début: ${new Date(d.startDate + 'T12:00:00').toLocaleDateString('fr-FR')}` : ''}
        ${d.startDate && d.endDate ? ' • ' : ''}
        ${d.endDate ? `Fin: ${new Date(d.endDate + 'T12:00:00').toLocaleDateString('fr-FR')}` : ''}
      </div>
    ` : '';
    
    return `<tr>
      <td>${escapeHTML(new Date(d.date + 'T12:00:00').toLocaleDateString('fr-FR'))}</td>
      <td>${escapeHTML(d.person)}</td>
      <td>${escapeHTML(label)}</td>
      <td class="text-right">
        ${formatCurrency(initial)}
        ${progressBar}
      </td>
      <td class="text-slate-600">${escapeHTML(d.note||'')}${dates}</td>
      <td class="text-center">
        <button class="btn-icon js-edit-debt" data-id="${d.id}" title="Modifier"><i class="fa-solid fa-edit"></i></button>
        <button class="btn-icon js-del-debt" data-id="${d.id}" title="Supprimer"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="card mb-6" data-freev-layout-scope="debts" data-freev-layout-group="debtSections" data-freev-layout-key="summary" data-freev-layout-label="Résumé des dettes" data-freev-layout-required="true">
      <h3 class="font-semibold text-slate-800 mb-4">Résumé par personne</h3>
      <div class="table-container">
        <table class="table"><thead><tr><th>Personne</th><th>Solde restant</th></tr></thead><tbody>${rows}</tbody></table>
      </div>
    </div>
    <div class="card" data-freev-layout-scope="debts" data-freev-layout-group="debtSections" data-freev-layout-key="details" data-freev-layout-label="Détails des dettes">
      <h3 class="font-semibold text-slate-800 mb-4">Détails</h3>
      <div class="table-container">
        <table class="table"><thead><tr><th>Date</th><th>Personne</th><th>Type</th><th class="text-right">Montant</th><th>Note</th><th class="text-center">Action</th></tr></thead><tbody>${details}</tbody></table>
      </div>
    </div>
  `;
  window.applyFreevLayoutPreferences?.();

  // Bind delete buttons (avoid inline onclick)
  container.querySelectorAll('.js-del-debt').forEach(btn => {
    btn.addEventListener('click', () => deleteDebt(btn.dataset.id));
  });
  container.querySelectorAll('.js-edit-debt').forEach(btn => {
    btn.addEventListener('click', () => openDebtModal(btn.dataset.id));
  });

  // Animate table rows staggered
  container.querySelectorAll('tbody tr').forEach((row, i) => {
    row.style.opacity = '0';
    row.style.transform = 'translateY(8px)';
    row.style.transition = `opacity 0.3s ease ${i * 50}ms, transform 0.3s ease ${i * 50}ms`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      row.style.opacity = '1';
      row.style.transform = 'translateY(0)';
    }));
  });

  // Animate debt progress bars
  requestAnimationFrame(() => requestAnimationFrame(() => {
    container.querySelectorAll('.debt-progress-bar').forEach(bar => {
      bar.style.width = (bar.dataset.target || '0') + '%';
    });
  }));
}

function deleteDebt(id) {
  const before = debts.find(d => String(d.id) === String(id));
  if (!before) return;

  // Un ID de dette peut être identique dans deux comptes. Déconnecter uniquement
  // les transactions du compte de la dette, ou les remboursements externes qui
  // référencent explicitement ce compte via linkedDebtAccountId.
  const links = [];
  const unlink = (t, accountId) => {
    if (String(t.linkedDebtId || '') !== String(id)) return;
    const targetAccount = String(t.linkedDebtAccountId || '');
    if (targetAccount && targetAccount !== String(currentAccountId)) return;
    if (String(accountId) !== String(currentAccountId) && !targetAccount) return;
    links.push({ accountId: String(accountId), txId: String(t.id), targetAccount });
    t.linkedDebtId = null;
    t.linkedDebtAccountId = '';
  };
  transactions.forEach(t => unlink(t, currentAccountId));
  accounts.filter(acc => String(acc.id) !== String(currentAccountId))
    .forEach(acc => (acc.transactions || []).forEach(t => unlink(t, acc.id)));

  const backup = JSON.parse(JSON.stringify(before));
  const undoContext = captureFinancialUndoContext();
  debts = debts.filter(d => String(d.id) !== String(id));
  logAction('delete', 'debt', before, null);
  saveData();
  renderDebts();

  const msg = links.length > 0
    ? `Dette supprimée (${links.length} transaction(s) déliée(s))`
    : 'Dette supprimée';
  showToast(msg, 'neutral', true, () => {
    if (!isFinancialUndoContextCurrent(undoContext) || debts.some(d => String(d.id) === String(id))) return;
    debts.push(backup);
    for (const link of links) {
      const source = link.accountId === String(currentAccountId)
        ? transactions : accounts.find(acc => String(acc.id) === link.accountId)?.transactions || [];
      const tx = source.find(item => String(item.id) === link.txId);
      if (tx && !tx.linkedDebtId) {
        tx.linkedDebtId = id;
        tx.linkedDebtAccountId = link.targetAccount;
      }
    }
    saveData();
    renderDebts();
    showToast('Suppression annulée', 'success');
  });
}

// ---------- History ----------
function renderHistory() {
  const container = document.getElementById('historyList');
  if (!container) return;
  if (!historyLog.length) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-clock-rotate-left"></i><p>Aucun événement</p></div>`;
    return;
  }

  // ✅ FIX XSS : h.entity peut être un objet → le formater en texte lisible
  function formatEntity(entity) {
    if (!entity) return '—';
    if (typeof entity === 'string') return entity;
    if (typeof entity === 'object') {
      // Afficher les champs utiles de la transaction/compte
      const parts = [];
      if (entity.category) parts.push(entity.category);
      if (entity.type)     parts.push(entity.type);
      if (entity.amount !== undefined || entity.amountBase !== undefined) {
        parts.push(formatCurrencySimple(entity.amountBase ?? entity.amount));
      }
      if (entity.date)     parts.push(entity.date);
      if (entity.desc)     parts.push(entity.desc);
      if (entity.person)   parts.push(entity.person); // dettes
      if (entity.name)     parts.push(entity.name);   // comptes
      return parts.length ? parts.join(' · ') : JSON.stringify(entity).slice(0, 80);
    }
    return String(entity);
  }

  container.innerHTML = `
    <div class="table-container">
      <table class="table">
        <thead><tr><th>Date</th><th>Action</th><th>Objet</th><th>Détail</th></tr></thead>
        <tbody>
          ${historyLog.slice(0, 200).map(h => {
            const d = new Date(h.ts);
            const beforeStr = h.before ? formatEntity(h.before) : '';
            const afterStr  = h.after  ? formatEntity(h.after)  : '';
            const detail = beforeStr && afterStr
              ? `${escapeHTML(beforeStr)} → ${escapeHTML(afterStr)}`
              : escapeHTML(beforeStr || afterStr || '—');
            return `<tr>
              <td style="white-space:nowrap;">${escapeHTML(d.toLocaleString('fr-FR'))}</td>
              <td><span class="badge" style="background:#e2e8f0;color:#334155;">${escapeHTML(h.action || '?')}</span></td>
              <td>${escapeHTML(String(h.entity || '—'))}</td>
              <td class="text-slate-500 text-xs" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;">${detail}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function clearHistory() {
  const backup = [...historyLog];
  historyLog = [];
  saveData();
  renderHistory();
  const undoContext = captureFinancialUndoContext();
  showToast('Historique vidé', 'neutral', true, () => {
    if (!isFinancialUndoContextCurrent(undoContext) || historyLog.length) return;
    historyLog = backup;
    saveData();
    renderHistory();
    showToast('Historique restauré', 'success');
  });
}
