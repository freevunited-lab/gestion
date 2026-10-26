// ============================================================
// ===== TRANSFERTS INTER-COMPTES & REMBOURSEMENTS DETTES =====
// ============================================================

let _iatCurrentTab = 'transfer';

function openInterAccountModal() {
  if (accounts.length < 2) {
    showToast('Il faut au moins 2 comptes pour effectuer un transfert inter-comptes', 'info');
    return;
  }
  const modal = document.getElementById('interAccountModal');
  if (!modal) return;

  // Remplir les selects de comptes
  const opts = accounts.map((a, i) => `<option value="${a.id}">${escapeHTML(a.name)}</option>`).join('');
  ['iatFromAccount', 'iatToAccount', 'iatDebtFromAccount'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = opts;
  });

  // Défaut : compte courant comme source, deuxième comme destination
  const fromId = currentAccountId;
  const toId = accounts.find(a => a.id !== fromId)?.id || accounts[0].id;
  const fromEl = document.getElementById('iatFromAccount');
  const toEl   = document.getElementById('iatToAccount');
  const debtFromEl = document.getElementById('iatDebtFromAccount');
  if (fromEl) fromEl.value = fromId;
  if (toEl)   toEl.value   = toId;
  if (debtFromEl) debtFromEl.value = fromId;

  // Dates par défaut
  const today = isoDate(getToday());
  const dateEl = document.getElementById('iatDate');
  const debtDateEl = document.getElementById('iatDebtDate');
  if (dateEl) dateEl.value = today;
  if (debtDateEl) debtDateEl.value = today;

  // Onglet par défaut
  switchIATTab('transfer');
  updateIATBalance();
  updateIATDebtList();

  modal.classList.remove('hidden');
}

function closeInterAccountModal() {
  const modal = document.getElementById('interAccountModal');
  if (modal) modal.classList.add('hidden');
  // Reset
  ['iatAmount', 'iatDesc', 'iatDebtAmount', 'iatDebtNote'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function switchIATTab(tab) {
  _iatCurrentTab = tab;
  ['transfer', 'debt'].forEach(t => {
    document.getElementById(`iatTab-${t}`)?.classList.toggle('active-mode', t === tab);
    document.getElementById(`iatPanel-${t}`)?.classList.toggle('hidden', t !== tab);
  });
  const btn = document.getElementById('iatSubmitBtn');
  if (btn) btn.innerHTML = tab === 'transfer'
    ? '<i class="fa-solid fa-arrow-right-arrow-left"></i> Transférer'
    : '<i class="fa-solid fa-handshake"></i> Rembourser';
}

function getInterAccountConversion(fromAcc, toAcc, sourceAmount) {
  const fromCurrency = fromAcc?.settings?.baseCurrency || 'EUR';
  const toCurrency = toAcc?.settings?.baseCurrency || 'EUR';
  const amount = Number(sourceAmount) || 0;
  if (fromCurrency === toCurrency) return { fromCurrency, toCurrency, rate: 1, received: roundMoney(amount) };

  const sourceSettings = fromAcc?.settings || {};
  if ((sourceSettings.ratesBase || fromCurrency) === fromCurrency) {
    const rate = Number(sourceSettings.exchangeRates?.[toCurrency]);
    if (rate > 0) return { fromCurrency, toCurrency, rate, received: roundMoney(amount * rate) };
  }

  const targetSettings = toAcc?.settings || {};
  if ((targetSettings.ratesBase || toCurrency) === toCurrency) {
    const reverseRate = Number(targetSettings.exchangeRates?.[fromCurrency]);
    if (reverseRate > 0) return { fromCurrency, toCurrency, rate: 1 / reverseRate, received: roundMoney(amount / reverseRate) };
  }
  return null;
}

function updateIATBalance() {
  const fromId = document.getElementById('iatFromAccount')?.value;
  const toId   = document.getElementById('iatToAccount')?.value;
  const amount = safeNumber(document.getElementById('iatAmount')?.value, 0);

  const fromAcc = accounts.find(a => a.id === fromId);
  const toAcc   = accounts.find(a => a.id === toId);

  const fromBal = fromAcc ? computeAccountBalance(fromAcc) : 0;
  const toBal   = toAcc   ? computeAccountBalance(toAcc)   : 0;
  const fromCurrency = fromAcc?.settings?.baseCurrency || settings.baseCurrency || 'EUR';
  const toCurrency = toAcc?.settings?.baseCurrency || 'EUR';

  const fromEl = document.getElementById('iatFromBalance');
  const toEl   = document.getElementById('iatToBalance');
  if (fromEl) fromEl.textContent = `Solde actuel : ${formatCurrencySimple(fromBal, fromCurrency)}`;
  if (toEl)   toEl.textContent   = `Solde actuel : ${formatCurrencySimple(toBal, toCurrency)}`;

  // Aperçu
  const preview = document.getElementById('iatTransferPreview');
  if (preview && amount > 0 && fromAcc && toAcc && fromId !== toId) {
    preview.style.display = 'block';
    const conversion = getInterAccountConversion(fromAcc, toAcc, amount);
    if (!conversion) {
      preview.innerHTML = `<span style="color:#dc2626;"><i class="fa-solid fa-triangle-exclamation"></i> Taux ${escapeHTML(fromCurrency)} → ${escapeHTML(toCurrency)} indisponible. Mettez les taux à jour dans Réglages.</span>`;
      return;
    }
    const newFrom = formatCurrencySimple(fromBal - amount, fromCurrency);
    const newTo   = formatCurrencySimple(toBal + conversion.received, toCurrency);
    preview.innerHTML = `
      <strong>${escapeHTML(fromAcc.name)}</strong> : ${formatCurrencySimple(fromBal, fromCurrency)} → <span style="color:#ef4444;">${newFrom}</span>
      &nbsp;&nbsp;|&nbsp;&nbsp;
      <strong>${escapeHTML(toAcc.name)}</strong> : ${formatCurrencySimple(toBal, toCurrency)} → <span style="color:#10b981;">${newTo}</span>
      ${conversion.rate !== 1 ? `<div style="margin-top:.4rem;color:#64748b;">Taux appliqué : 1 ${escapeHTML(fromCurrency)} = ${conversion.rate.toFixed(4)} ${escapeHTML(toCurrency)}</div>` : ''}
    `;
  } else if (preview) {
    preview.style.display = 'none';
  }
}

function updateIATDebtList() {
  const fromId = document.getElementById('iatDebtFromAccount')?.value;
  const fromAcc = accounts.find(a => a.id === fromId);
  const sel = document.getElementById('iatDebtSelect');
  if (!sel) return;

  // Chercher toutes les dettes dans TOUS les comptes (les dettes appartiennent au compte
  // qui les a créées, mais n'importe quel compte peut les rembourser)
  const allDebts = accounts.flatMap(a =>
    (a.debts || []).map(d => ({ ...d, _accountId: a.id, _accountName: a.name }))
  ).filter(d => (Number(d.remainingAmount ?? d.amount) || 0) > 0);

  if (!allDebts.length) {
    sel.innerHTML = '<option value="">Aucune dette en cours</option>';
    document.getElementById('iatDebtInfo').textContent = '';
    return;
  }

  sel.innerHTML = '<option value="">Sélectionner une dette...</option>' + allDebts.map(d => {
    const remaining = Number(d.remainingAmount ?? d.amount) || 0;
    const dir = d.direction === 'they_owe_me' ? `${d.person} me doit` : `Je dois à ${d.person}`;
    const cur = accounts.find(a => a.id === d._accountId)?.settings?.baseCurrency || 'EUR';
    return `<option value="${d.id}|${d._accountId}">${escapeHTML(dir)} — ${formatCurrencySimple(remaining, cur)} (${escapeHTML(d._accountName)})</option>`;
  }).join('');

  updateIATDebtAmount();
}

function updateIATDebtAmount() {
  const val = document.getElementById('iatDebtSelect')?.value || '';
  const [debtId, accountId] = val.split('|');
  const acc = accounts.find(a => a.id === accountId);
  const debt = (acc?.debts || []).find(d => String(d.id) === String(debtId));

  const infoEl = document.getElementById('iatDebtInfo');
  const amountEl = document.getElementById('iatDebtAmount');
  const amountLabel = document.getElementById('iatDebtAmountLabel');
  const conversionInfo = document.getElementById('iatDebtConversionInfo');

  if (!debt) {
    if (infoEl) infoEl.textContent = '';
    if (conversionInfo) conversionInfo.textContent = '';
    if (amountLabel) amountLabel.textContent = 'Montant remboursé';
    return;
  }

  const remaining = Number(debt.remainingAmount ?? debt.amount) || 0;
  const cur = acc?.settings?.baseCurrency || 'EUR';
  if (infoEl) infoEl.textContent = `Restant : ${formatCurrencySimple(remaining, cur)} dans le compte "${acc.name}"`;
  if (amountLabel) amountLabel.textContent = `Montant remboursé (${cur})`;
  if (amountEl && !amountEl.value) amountEl.value = remaining.toFixed(2);
  const payer = accounts.find(item => String(item.id) === String(document.getElementById('iatDebtFromAccount')?.value));
  const conversion = getInterAccountConversion(acc, payer, safeNumber(amountEl?.value, 0));
  if (conversionInfo) {
    conversionInfo.textContent = conversion && conversion.rate !== 1
      ? `Débit estimé : ${formatCurrencySimple(conversion.received, conversion.toCurrency)}`
      : (conversion ? '' : 'Taux de conversion indisponible');
  }
}

function submitInterAccount() {
  if (_iatCurrentTab === 'transfer') {
    _executeInterAccountTransfer();
  } else {
    _executeInterAccountDebtPayment();
  }
}

function _executeInterAccountTransfer() {
  const fromId = document.getElementById('iatFromAccount')?.value;
  const toId   = document.getElementById('iatToAccount')?.value;
  const amount = safeNumber(document.getElementById('iatAmount')?.value, NaN);
  const date   = document.getElementById('iatDate')?.value;
  const desc   = document.getElementById('iatDesc')?.value || 'Transfert inter-comptes';

  if (fromId === toId) return showToast('Les comptes source et destination sont identiques', 'error');
  if (!Number.isFinite(amount) || amount <= 0) return showToast('Montant invalide', 'error');
  if (!date) return showToast('Date invalide', 'error');

  const fromAcc = accounts.find(a => a.id === fromId);
  const toAcc   = accounts.find(a => a.id === toId);
  if (!fromAcc || !toAcc) return showToast('Compte introuvable', 'error');
  const conversion = getInterAccountConversion(fromAcc, toAcc, amount);
  if (!conversion) return showToast(`Taux ${fromAcc.settings?.baseCurrency || 'EUR'} → ${toAcc.settings?.baseCurrency || 'EUR'} indisponible`, 'error');

  // Vérifier que le solde source est suffisant
  const fromBal = computeAccountBalance(fromAcc);
  if (!Number.isFinite(fromBal)) return showToast('Solde indisponible : vérifiez les montants et les dates du compte source', 'error');
  if (amount > fromBal) {
    if (!confirm(`⚠️ Solde insuffisant sur "${fromAcc.name}" (${formatCurrencySimple(fromBal)}).\n\nContinuer quand même ?`)) return;
  }

  const linkId = genId(); // lie les 2 transactions ensemble
  const cur = conversion.fromCurrency;

  // Transaction DÉPENSE dans le compte source
  const txOut = {
    id: genId(), date, type: 'expense',
    category: 'Transfert inter-comptes',
    amount, amountBase: amount, originalAmount: amount,
    currency: cur, fxRate: null,
    desc: `${desc} → ${toAcc.name}`,
    tags: ['#inter-comptes'], mode: 'personal',
    transferTarget: '', isRecurring: false,
    linkedTransferId: linkId, linkedAccountId: toId,
    linkedTransferRole: 'out', linkedTransferRate: conversion.rate,
    _effectsApplied: false
  };

  // Transaction REVENU dans le compte destination
  const txIn = {
    id: genId(), date, type: 'income',
    category: 'Transfert inter-comptes',
    amount: conversion.received, amountBase: conversion.received, originalAmount: conversion.received,
    currency: conversion.toCurrency, fxRate: conversion.rate,
    desc: `${desc} ← ${fromAcc.name}`,
    tags: ['#inter-comptes'], mode: 'personal',
    transferTarget: '', isRecurring: false,
    linkedTransferId: linkId, linkedAccountId: fromId,
    linkedTransferRole: 'in', linkedTransferRate: conversion.rate,
    _effectsApplied: false
  };

  // Sauvegarder les globales actuelles, puis injecter dans chaque compte
  saveCurrentGlobalsToAccount();
  fromAcc.transactions.push(txOut);
  toAcc.transactions.push(txIn);

  logAction('inter_transfer', 'account', { from: fromAcc.name, amount }, { to: toAcc.name });
  saveAccountSystem();

  // Si on est sur un des comptes impliqués, recharger les globales
  if (currentAccountId === fromId || currentAccountId === toId) {
    loadCurrentAccountIntoGlobals();
  }

  syncAllUI(true);
  closeInterAccountModal();
  const receivedLabel = conversion.rate === 1 ? '' : ` (${formatCurrencySimple(conversion.received, conversion.toCurrency)} reçus)`;
  showToast(`Transfert de ${formatCurrencySimple(amount, cur)}${receivedLabel} : ${fromAcc.name} → ${toAcc.name}`, 'success');
}

function _executeInterAccountDebtPayment() {
  const fromId = document.getElementById('iatDebtFromAccount')?.value;
  const val    = document.getElementById('iatDebtSelect')?.value || '';
  const amount = safeNumber(document.getElementById('iatDebtAmount')?.value, NaN);
  const date   = document.getElementById('iatDebtDate')?.value;
  const note   = document.getElementById('iatDebtNote')?.value || 'Remboursement dette';

  const [debtId, debtAccountId] = val.split('|');
  if (!debtId) return showToast('Sélectionne une dette', 'error');
  if (!Number.isFinite(amount) || amount <= 0) return showToast('Montant invalide', 'error');
  if (!date) return showToast('Date invalide', 'error');

  const fromAcc  = accounts.find(a => a.id === fromId);
  const debtAcc  = accounts.find(a => a.id === debtAccountId);
  if (!fromAcc || !debtAcc) return showToast('Compte introuvable', 'error');

  const debt = (debtAcc.debts || []).find(d => String(d.id) === String(debtId));
  if (!debt) return showToast('Dette introuvable', 'error');

  const remaining = Number(debt.remainingAmount ?? debt.amount) || 0;
  const payAmt = Math.min(amount, remaining); // montant exprimé dans la devise de la dette
  const conversion = getInterAccountConversion(debtAcc, fromAcc, payAmt);
  if (!conversion) return showToast(`Taux ${debtAcc.settings?.baseCurrency || 'EUR'} → ${fromAcc.settings?.baseCurrency || 'EUR'} indisponible`, 'error');
  const sourceDebit = conversion.received;
  const cur = conversion.toCurrency;

  // Vérifier solde suffisant
  const fromBal = computeAccountBalance(fromAcc);
  if (!Number.isFinite(fromBal)) return showToast('Solde indisponible : vérifiez les montants et les dates du compte source', 'error');
  if (sourceDebit > fromBal) {
    if (!confirm(`⚠️ Solde insuffisant sur "${fromAcc.name}" (${formatCurrencySimple(fromBal, cur)}).\n\nContinuer ?`)) return;
  }

  saveCurrentGlobalsToAccount();

  // Dépense dans le compte qui rembourse
  const txPay = {
    id: genId(), date, type: 'expense',
    category: 'Remboursement dette',
    amount: sourceDebit, amountBase: sourceDebit, originalAmount: sourceDebit,
    currency: cur, fxRate: conversion.rate,
    desc: `${note} — ${debt.direction === 'they_owe_me' ? debt.person + ' te rembourse' : 'Tu rembourses ' + debt.person}`,
    tags: ['#dette'], mode: 'personal',
    linkedDebtId: debtId, linkedDebtAccountId: debtAccountId, linkedDebtAmount: payAmt,
    isRecurring: false, source: 'inter_account_debt', _effectsApplied: false
  };
  fromAcc.transactions.push(txPay);

  // La dette n'est diminuée qu'à la date effective du remboursement.
  applyOccurrenceSideEffects(txPay);

  saveAccountSystem();

  if (currentAccountId === fromId || currentAccountId === debtAccountId) {
    loadCurrentAccountIntoGlobals();
  }

  syncAllUI(true);
  closeInterAccountModal();

  const isFuture = date > isoDate(getToday());
  const debtCurrency = debtAcc.settings?.baseCurrency || 'EUR';
  const leftStr = isFuture
    ? ` — planifié le ${new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR')}`
    : (debt.remainingAmount > 0
      ? ` (reste ${formatCurrencySimple(debt.remainingAmount, debtCurrency)})`
      : ' — Dette soldée ! ✅');
  const debitLabel = conversion.rate === 1 ? '' : ` (${formatCurrencySimple(sourceDebit, cur)} débités)`;
  showToast(`Remboursement de ${formatCurrencySimple(payAmt, debtCurrency)}${debitLabel}${leftStr}`, 'success');
}

function deleteLinkedTransferPair(transactionId) {
  saveCurrentGlobalsToAccount();
  let target = null;
  for (const account of accounts) {
    const index = (account.transactions || []).findIndex(tx => String(tx.id) === String(transactionId));
    if (index >= 0) {
      target = { account, index, transaction: account.transactions[index] };
      break;
    }
  }
  const linkId = target?.transaction?.linkedTransferId;
  if (!target || !linkId) return false;
  if (!confirm('Supprimer les deux écritures de ce transfert entre comptes ?')) return true;

  const backups = [];
  accounts.forEach(account => {
    for (let index = (account.transactions || []).length - 1; index >= 0; index--) {
      const tx = account.transactions[index];
      if (String(tx.linkedTransferId || '') !== String(linkId)) continue;
      backups.push({ accountId: account.id, index, transaction: JSON.parse(JSON.stringify(tx)) });
      account.transactions.splice(index, 1);
    }
  });

  if (currentAccountId) loadCurrentAccountIntoGlobals();
  logAction('delete', 'inter_account_transfer', target.transaction, null);
  saveAccountSystem();
  syncAllUI(true);
  const undoContext = captureFinancialUndoContext();
  showToast('Transfert supprimé dans les deux comptes', 'neutral', true, () => {
    if (!isFinancialUndoContextCurrent(undoContext)) return;
    if (accounts.some(account => (account.transactions || []).some(tx => String(tx.linkedTransferId || '') === String(linkId)))) return;
    backups.slice().reverse().forEach(item => {
      const account = accounts.find(acc => String(acc.id) === String(item.accountId));
      if (!account) return;
      account.transactions.splice(Math.min(item.index, account.transactions.length), 0, item.transaction);
    });
    loadCurrentAccountIntoGlobals();
    saveAccountSystem();
    syncAllUI(true);
    showToast('Transfert restauré dans les deux comptes', 'success');
  });
  return true;
}

// ============================================================
// ===== FIN TRANSFERTS INTER-COMPTES =========================
// ============================================================
