// AJ 04–06 — tarifs datés, suivi des renouvellements et rappels dans l’application.
// Les paiements restent gérés par le moteur de récurrence ; les rappels ne créent
// ni transaction ni notification système.

const subscriptionDateValid = value => !value || (typeof isValidISODate === 'function' && isValidISODate(value));
const subscriptionCurrencyOptions = ['EUR', 'USD', 'GBP', 'CHF', 'CAD'];

function recurringRateVersions(rule) {
  return (Array.isArray(rule?.rateVersions) ? rule.rateVersions : [])
    .filter(version => version && subscriptionDateValid(version.effectiveFrom) && version.effectiveFrom)
    .slice()
    .sort((left, right) => String(left.effectiveFrom).localeCompare(String(right.effectiveFrom)));
}

// « Toutes les suivantes » remplace aussi un tarif déjà planifié plus tard.
// Les versions antérieures restent dans l'historique de la règle.
function recurringTariffReplacementPlan(rule, effectiveFrom) {
  const versions = recurringRateVersions(rule);
  return {
    retained: versions.filter(item => item.effectiveFrom < effectiveFrom),
    replacedCount: versions.filter(item => item.effectiveFrom >= effectiveFrom).length
  };
}

function recurringRateAtWithVersion(rule, date, candidate = null) {
  const baseline = {
    amountBase: Number(rule?.amountBase ?? rule?.amount) || 0,
    originalAmount: Number(rule?.originalAmount ?? rule?.amountBase ?? rule?.amount) || 0,
    currency: String(rule?.currency || settings.baseCurrency || 'EUR').toUpperCase(),
    fxRate: rule?.fxRate || null
  };
  const versions = [...recurringRateVersions(rule), ...(candidate ? [candidate] : [])]
    .filter(version => version.effectiveFrom <= date)
    .sort((left, right) => String(left.effectiveFrom).localeCompare(String(right.effectiveFrom)));
  return versions.length ? { ...baseline, ...versions.at(-1) } : baseline;
}

function recurringTariffDates(rule, fromDate, limit = 12) {
  const dates = [];
  const start = String(fromDate || '');
  if (!subscriptionDateValid(start) || !start) return dates;
  const first = new Date(`${start.slice(0, 7)}-01T12:00:00`);
  for (let offset = 0; offset < 36 && dates.length < limit; offset += 1) {
    const monthDate = new Date(first);
    monthDate.setMonth(monthDate.getMonth() + offset);
    const month = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
    for (const date of recurringDatesForMonth(rule, month)) {
      if (date < start || isRecurringPeriodSkipped(rule, periodKey(date, rule.frequency))) continue;
      if (!dates.includes(date)) dates.push(date);
      if (dates.length >= limit) break;
    }
  }
  return dates.sort().slice(0, limit);
}

function recurringTariffOccurrenceChoices(rule, fromDate) {
  const today = isoDate(getToday());
  return recurringTariffDates(rule, fromDate, 12).map(scheduledDate => {
    const key = periodKey(scheduledDate, rule.frequency);
    const matches = transactions.filter(tx => String(tx.parentId || '') === String(rule.id) &&
      String(tx.periodKey || periodKey(tx.date, rule.frequency)) === key);
    const saved = matches.length === 1 ? matches[0] : null;
    const date = saved?.date || scheduledDate;
    return { key, date, scheduledDate, saved, duplicate: matches.length > 1 };
  }).filter(choice => choice.date >= today);
}

function renderRecurringTariffOccurrenceChoices(rule, preferredDate = '') {
  const select = document.getElementById('recurringTariffSingleDate');
  if (!select) return;
  const choices = recurringTariffOccurrenceChoices(rule, isoDate(getToday()));
  select.innerHTML = choices.length ? choices.map(choice => {
    const current = choice.saved
      ? {
          originalAmount: choice.saved.originalAmount ?? choice.saved.amountBase ?? choice.saved.amount,
          currency: choice.saved.originalAmount != null ? choice.saved.currency || settings.baseCurrency : settings.baseCurrency
        }
      : getRecurringRateForDate(rule, choice.date);
    const dateLabel = new Date(`${choice.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const amountLabel = formatCurrency(Number(current.originalAmount ?? current.amountBase) || 0, current.currency || settings.baseCurrency);
    return `<option value="${escapeHTML(choice.key)}" data-date="${escapeHTML(choice.date)}" data-scheduled-date="${escapeHTML(choice.scheduledDate)}" data-duplicate="${choice.duplicate ? 'true' : 'false'}" ${choice.date === preferredDate || choice.scheduledDate === preferredDate ? 'selected' : ''} ${choice.duplicate ? 'disabled' : ''}>${escapeHTML(dateLabel)} · actuel ${escapeHTML(amountLabel)}${choice.duplicate ? ' · doublon à vérifier' : ''}</option>`;
  }).join('') : '<option value="" selected disabled>Aucune échéance future disponible</option>';
}

function getTariffCandidateFromForm() {
  const currency = String(document.getElementById('recurringTariffCurrency')?.value || settings.baseCurrency || 'EUR').toUpperCase();
  const amount = globalThis.FREEVMoney?.parseAmount(document.getElementById('recurringTariffAmount')?.value || '', currency, 'amount');
  const scope = document.querySelector('input[name="recurringTariffScope"]:checked')?.value || 'future';
  const selectedSingle = document.getElementById('recurringTariffSingleDate')?.selectedOptions?.[0];
  const effectiveFrom = scope === 'single'
    ? selectedSingle?.dataset.date || ''
    : document.getElementById('recurringTariffEffectiveDate')?.value || '';
  const fxRate = document.getElementById('recurringTariffFxRate')?.value || '';
  if (!amount?.ok || amount.minor <= 0 || !Number.isSafeInteger(amount.minor))
    return { error: 'Saisissez un montant valide dans la devise choisie.' };
  if (!subscriptionDateValid(effectiveFrom) || !effectiveFrom)
    return { error: 'Choisissez une date d’effet valide.' };
  const baseCurrency = String(settings.baseCurrency || 'EUR').toUpperCase();
  const converted = currency === baseCurrency
    ? { ok: true, minor: amount.minor }
    : globalThis.FREEVMoney?.convertMinor(amount.minor, fxRate, currency, baseCurrency);
  if (!converted?.ok || !Number.isSafeInteger(converted.minor) || converted.minor <= 0)
    return { error: `Indiquez un taux de change valable vers ${baseCurrency}.` };
  if (converted.minor / (10 ** globalThis.FREEVMoney.minorDigits(baseCurrency)) > 1e12)
    return { error: 'Le montant converti dépasse la limite autorisée.' };
  return {
    version: {
      effectiveFrom,
      amountBase: converted.minor / (10 ** globalThis.FREEVMoney.minorDigits(baseCurrency)),
      originalAmount: amount.minor / (10 ** globalThis.FREEVMoney.minorDigits(currency)),
      currency,
      fxRate: currency === baseCurrency ? null : Number(fxRate),
      createdAt: new Date().toISOString()
    }
  };
}

function previewRecurringTariff() {
  const preview = document.getElementById('recurringTariffPreview');
  const id = document.getElementById('recurringTariffRuleId')?.value || '';
  const rule = recurringTransactions.find(item => String(item.id) === String(id));
  if (!preview || !rule) return;
  const parsed = getTariffCandidateFromForm();
  if (parsed.error) { preview.textContent = parsed.error; return; }
  const version = parsed.version;
  const scope = document.querySelector('input[name="recurringTariffScope"]:checked')?.value || 'future';
  const baseCurrency = String(settings.baseCurrency || 'EUR').toUpperCase();
  if (scope === 'single') {
    const selected = document.getElementById('recurringTariffSingleDate')?.selectedOptions?.[0];
    if (!selected?.value) { preview.textContent = 'Choisissez une échéance à modifier.'; return; }
    if (selected.dataset.duplicate === 'true') { preview.textContent = 'Plusieurs opérations existent à cette date. Vérifiez les doublons avant de changer le montant.'; return; }
    const key = selected.value;
    const matches = transactions.filter(tx => String(tx.parentId || '') === String(rule.id) &&
      String(tx.periodKey || periodKey(tx.date, rule.frequency)) === key);
    if (matches.length > 1) { preview.textContent = 'Plusieurs opérations existent à cette date. Vérifiez les doublons avant de changer le montant.'; return; }
    const saved = matches[0] || null;
    const date = saved?.date || selected.dataset.scheduledDate || selected.dataset.date;
    if (!date || date < isoDate(getToday()) || isRecurringPeriodSkipped(rule, key)) {
      preview.textContent = 'Cette échéance n’est plus modifiable ici. Choisissez une autre date à venir.';
      return;
    }
    const before = Number(saved?.amountBase ?? saved?.amount ?? getRecurringRateForDate(rule, date).amountBase) || 0;
    const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    preview.innerHTML = `<strong>Une seule échéance sera modifiée</strong><p>${escapeHTML(dateLabel)} : ${escapeHTML(formatCurrency(before, baseCurrency))} → ${escapeHTML(formatCurrency(version.amountBase, baseCurrency))}.</p><p>Les autres échéances, y compris toutes les suivantes, garderont leur montant actuel.</p>`;
    return;
  }

  const replacement = recurringTariffReplacementPlan(rule, version.effectiveFrom);
  const updatedRule = { ...rule, rateVersions: replacement.retained };
  const dates = recurringTariffDates(rule, version.effectiveFrom, 12);
  const previewRows = dates.map(date => {
    const key = periodKey(date, rule.frequency);
    const stored = transactions.find(tx => String(tx.parentId || '') === String(rule.id) &&
      String(tx.periodKey || periodKey(tx.date, rule.frequency)) === key);
    const protectedOccurrence = stored && isUserProtectedOccurrence(stored);
    const before = protectedOccurrence ? Number(stored.amountBase ?? stored.amount) || 0 : Number(recurringRateAtWithVersion(rule, date).amountBase) || 0;
    const afterRate = recurringRateAtWithVersion(updatedRule, date, version);
    const after = protectedOccurrence ? before : Number(afterRate.amountBase) || 0;
    return { date, before, after, protectedOccurrence, currency: protectedOccurrence ? stored.currency : afterRate.currency };
  });
  const toMinor = value => globalThis.FREEVMoney.parseAmount(String(value), baseCurrency, 'amount');
  const beforeTotal = previewRows.reduce((sum, row) => {
    const amount = toMinor(row.before);
    return amount?.ok && Number.isSafeInteger(sum + amount.minor) ? sum + amount.minor : sum;
  }, 0);
  const afterTotal = previewRows.reduce((sum, row) => {
    const amount = toMinor(row.after);
    return amount?.ok && Number.isSafeInteger(sum + amount.minor) ? sum + amount.minor : sum;
  }, 0);
  const preserved = previewRows.filter(row => row.protectedOccurrence).length;
  const lines = previewRows.slice(0, 6).map(row => `${new Date(`${row.date}T12:00:00`).toLocaleDateString('fr-FR')} : ${formatCurrency(row.before, baseCurrency)} → ${formatCurrency(row.after, baseCurrency)}${row.protectedOccurrence ? ' · exception conservée' : ''}`);
  const effectiveLabel = new Date(`${version.effectiveFrom}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  preview.innerHTML = `<strong>Nouveau tarif à partir du ${escapeHTML(effectiveLabel)}, puis pour toutes les échéances suivantes</strong><p>${lines.length ? lines.map(escapeHTML).join('<br>') : 'Aucune échéance après cette date dans la série.'}</p><p>Total des ${previewRows.length} prochaines échéances affichées : ${escapeHTML(globalThis.FREEVMoney.formatMinor(beforeTotal, baseCurrency))} → ${escapeHTML(globalThis.FREEVMoney.formatMinor(afterTotal, baseCurrency))}. ${replacement.replacedCount ? `${replacement.replacedCount} tarif(s) déjà programmés à partir de cette date seront remplacés. ` : ''}${preserved} date(s) personnalisée(s) restent inchangées. Le tarif est enregistré dans sa devise d’origine ; les conversions utilisent le taux indiqué.</p>`;
}

let lastRecurringTariffTrigger = null;

function openRecurringTariff(ruleId) {
  const rule = recurringTransactions.find(item => String(item.id) === String(ruleId));
  if (!rule) return;
  lastRecurringTariffTrigger = document.activeElement;
  const modal = document.getElementById('recurringTariffModal');
  const nextDay = new Date(getToday());
  nextDay.setDate(nextDay.getDate() + 1);
  const firstFutureDate = getNextRecurringDate(rule, isoDate(nextDay));
  const baseline = getRecurringRateForDate(rule, firstFutureDate || isoDate(nextDay));
  document.getElementById('recurringTariffRuleId').value = String(rule.id);
  document.getElementById('recurringTariffSubtitle').textContent = `${rule.desc || rule.category || 'Récurrence'} · tarif de référence actuel ${formatCurrency(baseline.originalAmount, baseline.currency)} (${baseline.currency})`;
  document.getElementById('recurringTariffAmount').value = '';
  const currency = document.getElementById('recurringTariffCurrency');
  currency.value = subscriptionCurrencyOptions.includes(baseline.currency) ? baseline.currency : String(settings.baseCurrency || 'EUR');
  currency.dataset.userSelected = '';
  document.getElementById('recurringTariffFxRate').value = '';
  document.getElementById('recurringTariffFxRate').dataset.userEdited = '';
  document.getElementById('recurringTariffEffectiveDate').value = firstFutureDate || isoDate(nextDay);
  document.querySelector('input[name="recurringTariffScope"][value="future"]').checked = true;
  document.getElementById('recurringTariffSingleDate').value = '';
  renderRecurringTariffOccurrenceChoices(rule, firstFutureDate);
  updateTariffFxVisibility();
  updateRecurringTariffScope();
  modal?.classList.remove('hidden');
  previewRecurringTariff();
  requestAnimationFrame(() => document.getElementById('recurringTariffAmount')?.focus());
}

function updateRecurringTariffScope() {
  const scope = document.querySelector('input[name="recurringTariffScope"]:checked')?.value || 'future';
  const isSingle = scope === 'single';
  const futurePanel = document.getElementById('recurringTariffFuturePanel');
  const singlePanel = document.getElementById('recurringTariffSinglePanel');
  const futureDate = document.getElementById('recurringTariffEffectiveDate');
  const singleDate = document.getElementById('recurringTariffSingleDate');
  const singleAvailable = [...(singleDate?.options || [])].some(option => option.value && !option.disabled);
  const singleRadio = document.querySelector('input[name="recurringTariffScope"][value="single"]');
  const singleChoice = document.getElementById('recurringTariffSingleChoice');
  const submit = document.getElementById('recurringTariffSubmit');
  const hint = document.getElementById('recurringTariffScopeHint');

  if (singleRadio) singleRadio.disabled = !singleAvailable;
  singleChoice?.classList.toggle('is-disabled', !singleAvailable);
  if (isSingle && !singleAvailable) {
    const futureRadio = document.querySelector('input[name="recurringTariffScope"][value="future"]');
    if (futureRadio) futureRadio.checked = true;
  }
  const currentScope = document.querySelector('input[name="recurringTariffScope"]:checked')?.value || 'future';
  const showSingle = currentScope === 'single';
  if (futurePanel) futurePanel.hidden = showSingle;
  if (singlePanel) singlePanel.hidden = !showSingle;
  if (futureDate) { futureDate.disabled = showSingle; futureDate.required = !showSingle; }
  if (singleDate) { singleDate.disabled = !showSingle || !singleAvailable; singleDate.required = showSingle && singleAvailable; }
  updateRecurringTariffCurrencyContext();
  document.getElementById('recurringTariffFutureChoice')?.classList.toggle('is-selected', !showSingle);
  singleChoice?.classList.toggle('is-selected', showSingle);
  if (submit) submit.textContent = showSingle ? 'Modifier cette échéance uniquement' : 'Modifier cette échéance et les suivantes';
  if (hint) hint.textContent = showSingle
    ? 'Le changement concernera uniquement le paiement indiqué dans ce choix.'
    : 'Le changement concernera le paiement indiqué, puis tous les paiements suivants.';
  updateRecurringTariffScopeCopy();
  previewRecurringTariff();
}

function updateRecurringTariffScopeCopy() {
  const id = document.getElementById('recurringTariffRuleId')?.value || '';
  const rule = recurringTransactions.find(item => String(item.id) === String(id));
  if (!rule) return;
  const singleOption = document.getElementById('recurringTariffSingleDate')?.selectedOptions?.[0];
  const effectiveFrom = document.getElementById('recurringTariffEffectiveDate')?.value || '';
  const firstFutureDate = effectiveFrom ? recurringTariffDates(rule, effectiveFrom, 1)[0] || effectiveFrom : '';
  const singleDate = singleOption?.dataset.date || '';
  const formatDate = date => date ? new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }) : 'la date choisie';
  const futureDateLabel = formatDate(firstFutureDate);
  const singleDateLabel = formatDate(singleDate);
  const futureLabel = document.getElementById('recurringTariffFutureLabel');
  const futureHelp = document.getElementById('recurringTariffFutureHelp');
  const singleLabel = document.getElementById('recurringTariffSingleLabel');
  const singleHelp = document.getElementById('recurringTariffSingleHelp');
  if (futureLabel) futureLabel.textContent = `Dès le paiement prévu le ${futureDateLabel}`;
  if (futureHelp) futureHelp.textContent = 'Ce paiement et tous les suivants auront le nouveau montant.';
  if (singleLabel) singleLabel.textContent = `Seulement le paiement prévu le ${singleDateLabel}`;
  if (singleHelp) singleHelp.textContent = rule.frequency === 'monthly'
    ? 'Le paiement du mois suivant gardera son montant actuel.'
    : 'Le paiement suivant gardera son montant actuel.';
}

function updateRecurringTariffCurrencyContext() {
  const amount = document.getElementById('recurringTariffAmount');
  const currency = document.getElementById('recurringTariffCurrency');
  const fxRate = document.getElementById('recurringTariffFxRate');
  if (!amount || amount.value.trim() || currency?.dataset.userSelected === '1' || fxRate?.dataset.userEdited === '1') return;
  const id = document.getElementById('recurringTariffRuleId')?.value || '';
  const rule = recurringTransactions.find(item => String(item.id) === String(id));
  if (!rule) return;
  const scope = document.querySelector('input[name="recurringTariffScope"]:checked')?.value || 'future';
  const selected = document.getElementById('recurringTariffSingleDate')?.selectedOptions?.[0];
  const date = scope === 'single' ? selected?.dataset.date : document.getElementById('recurringTariffEffectiveDate')?.value;
  if (!date) return;
  let rate = getRecurringRateForDate(rule, date);
  if (scope === 'single' && selected?.value) {
    const matches = transactions.filter(tx => String(tx.parentId || '') === String(rule.id) &&
      String(tx.periodKey || periodKey(tx.date, rule.frequency)) === selected.value);
    if (matches.length === 1) {
      const saved = matches[0];
      rate = {
        currency: saved.currency || settings.baseCurrency,
        fxRate: saved.fxRate || null
      };
    }
  }
  const baseCurrency = String(settings.baseCurrency || 'EUR').toUpperCase();
  const selectedCurrency = subscriptionCurrencyOptions.includes(String(rate.currency || '').toUpperCase())
    ? String(rate.currency).toUpperCase() : baseCurrency;
  if (currency) currency.value = selectedCurrency;
  if (fxRate) fxRate.value = selectedCurrency !== baseCurrency && rate.fxRate ? String(rate.fxRate) : '';
  updateTariffFxVisibility();
}

function updateTariffFxVisibility() {
  const different = String(document.getElementById('recurringTariffCurrency')?.value || settings.baseCurrency) !== String(settings.baseCurrency || 'EUR');
  document.getElementById('recurringTariffFxGroup')?.classList.toggle('hidden', !different);
}

function closeRecurringTariffModal() {
  document.getElementById('recurringTariffModal')?.classList.add('hidden');
  const ruleId = document.getElementById('recurringTariffRuleId')?.value || '';
  const replacement = [...document.querySelectorAll('.js-aj-tariff')].find(button => String(button.dataset.id) === String(ruleId));
  const target = lastRecurringTariffTrigger?.isConnected ? lastRecurringTariffTrigger : replacement;
  target?.focus?.();
  lastRecurringTariffTrigger = null;
}

function saveRecurringTariff(event) {
  event.preventDefault();
  const id = document.getElementById('recurringTariffRuleId')?.value || '';
  const rule = recurringTransactions.find(item => String(item.id) === String(id));
  if (!rule) return showToast('Cette récurrence n’existe plus dans le compte courant.', 'error');
  const parsed = getTariffCandidateFromForm();
  if (parsed.error) return showToast(parsed.error, 'error');
  const version = parsed.version;
  const scope = document.querySelector('input[name="recurringTariffScope"]:checked')?.value || 'future';
  if (scope === 'single') {
    const selected = document.getElementById('recurringTariffSingleDate')?.selectedOptions?.[0];
    if (!selected?.value || selected.disabled || selected.dataset.duplicate === 'true')
      return showToast('Choisissez une échéance disponible à modifier.', 'error');
    const key = selected.value;
    const matches = transactions.filter(tx => String(tx.parentId || '') === String(rule.id) &&
      String(tx.periodKey || periodKey(tx.date, rule.frequency)) === key);
    if (matches.length > 1) return showToast('Plusieurs opérations existent à cette date. Vérifiez les doublons avant de modifier le montant.', 'error');
    const stored = matches[0] || null;
    const scheduledDate = selected.dataset.scheduledDate || selected.dataset.date;
    const occurrenceDate = stored?.date || scheduledDate;
    if (!occurrenceDate || occurrenceDate < isoDate(getToday()) || isRecurringPeriodSkipped(rule, key) ||
        isArchivedRecurringMonth(rule, key, occurrenceDate))
      return showToast('Cette échéance ne peut plus être modifiée depuis ce formulaire. Aucune donnée n’a changé.', 'error');
    const useStored = Boolean(stored);
    const changed = applySingleRecurringOccurrenceChange(rule,
      stored?.id || `__projected_tariff_${rule.id}_${key}`, key, occurrenceDate, {
        date: occurrenceDate,
        type: useStored ? (stored.fromSavings ? 'savings_withdrawal' : stored.type || rule.type || 'expense') : (rule.fromSavings ? 'savings_withdrawal' : rule.type || 'expense'),
        category: useStored ? stored.category || rule.category || 'Autre' : rule.category || 'Autre',
        amountBase: version.amountBase,
        originalAmount: version.originalAmount,
        currency: version.currency,
        fxRate: version.fxRate,
        desc: useStored ? stored.desc : rule.desc || '',
        tags: useStored ? (Array.isArray(stored.tags) ? [...stored.tags] : []) : (Array.isArray(rule.tags) ? [...rule.tags] : []),
        mode: useStored ? stored.mode || rule.mode || settings.defaultMode || 'personal' : rule.mode || settings.defaultMode || 'personal',
        transferTarget: useStored ? stored.transferTarget || rule.transferTarget || '' : rule.transferTarget || '',
        linkedDebtId: useStored ? stored.linkedDebtId || null : rule.linkedDebtId || null,
        reconcileColor: useStored ? stored.reconcileColor || '' : rule.reconcileColor || '',
        incomeClass: useStored ? stored.incomeClass || '' : rule.incomeClass || ''
      });
    if (!changed) return showToast('Modification impossible : vérifiez cette échéance. La série n’a pas été modifiée.', 'error');
    saveData();
    syncAllUI();
    closeRecurringTariffModal();
    showToast('Montant modifié pour cette échéance uniquement. Les suivantes gardent leur montant.', 'success');
    return;
  }
  if (version.effectiveFrom < isoDate(getToday())) return showToast('La date d’effet doit être aujourd’hui ou dans le futur. Les tarifs passés restent dans l’historique des échéances.', 'error');
  const replacement = recurringTariffReplacementPlan(rule, version.effectiveFrom);
  if (replacement.retained.length >= 100) return showToast('Cette série contient déjà 100 tarifs datés avant la date choisie. La limite protège la taille de sauvegarde.', 'error');
  const previewRows = recurringTariffDates(rule, version.effectiveFrom, 12);
  if (!previewRows.length) return showToast('Aucune échéance de cette série ne suit la date choisie.', 'error');
  const beforeRule = recurringSnapshot(rule);
  rule.rateVersions = [...replacement.retained, version];
  rule.updatedAt = new Date().toISOString();
  recordRecurringRevision(rule, 'future', '', beforeRule, recurringSnapshot(rule), {
    beforeRule,
    afterRule: recurringSnapshot(rule),
    changeLabel: `Tarif à partir du ${version.effectiveFrom}`
  });
  logAction('change_rate', 'recurring', beforeRule, { ...rule, amountBase: version.amountBase, currency: version.currency, effectiveFrom: version.effectiveFrom });
  rebuildOccurrencesForRuleFutureOnly(rule.id);
  saveData();
  syncAllUI();
  closeRecurringTariffModal();
  showToast(`Nouveau tarif actif à partir du ${new Date(`${version.effectiveFrom}T12:00:00`).toLocaleDateString('fr-FR')}, puis pour toutes les échéances suivantes. ${replacement.replacedCount ? `${replacement.replacedCount} tarif(s) programmés plus tard remplacés. ` : ''}Les paiements passés et les dates personnalisées restent inchangés.`, 'success');
}

function subscriptionFor(rule) {
  const value = rule?.subscription && typeof rule.subscription === 'object' ? rule.subscription : {};
  return {
    trialEndDate: value.trialEndDate || '',
    nextPaymentDate: value.nextPaymentDate || '',
    expectedAmount: value.expectedAmount != null && Number.isFinite(Number(value.expectedAmount)) ? Number(value.expectedAmount) : null,
    expectedCurrency: String(value.expectedCurrency || rule?.currency || settings.baseCurrency || 'EUR').toUpperCase(),
    expectedFxRate: Number.isFinite(Number(value.expectedFxRate)) ? Number(value.expectedFxRate) : null,
    automaticRenewal: ['yes', 'no'].includes(value.automaticRenewal) ? value.automaticRenewal : 'unknown',
    noticeDays: Math.max(0, Math.min(365, Math.round(Number(value.noticeDays ?? 7)))),
    managementUrl: String(value.managementUrl || ''),
    cancellationRequested: Boolean(value.cancellationRequested),
    effectiveEndDate: value.effectiveEndDate || '',
    remainingDue: value.remainingDue != null && Number.isFinite(Number(value.remainingDue)) ? Number(value.remainingDue) : null,
    reminders: { sevenDays: value.reminders?.sevenDays !== false, oneDay: value.reminders?.oneDay !== false },
    remindersEmitted: Array.isArray(value.remindersEmitted) ? value.remindersEmitted : []
  };
}

function reminderStatusText(subscription) {
  const date = subscription.trialEndDate || subscription.nextPaymentDate;
  if (!date) return 'Date inconnue — aucun rappel planifiable.';
  const reminderKeys = [
    ...(subscription.reminders.sevenDays ? [`trial:${subscription.trialEndDate}:7`, `payment:${subscription.nextPaymentDate}:7`] : []),
    ...(subscription.reminders.oneDay ? [`trial:${subscription.trialEndDate}:1`, `payment:${subscription.nextPaymentDate}:1`] : [])
  ].filter(key => !key.includes(':undefined:') && !key.includes('::'));
  const emitted = subscription.remindersEmitted.some(item => reminderKeys.includes(item.key));
  return emitted ? 'Rappel émis dans l’application.' : reminderKeys.length ? 'Rappel prévu à l’ouverture de FREEV.' : 'Rappels désactivés.';
}

function openSubscriptionDetails(ruleId) {
  const rule = recurringTransactions.find(item => String(item.id) === String(ruleId));
  if (!rule) return;
  const subscription = subscriptionFor(rule);
  document.getElementById('subscriptionRuleId').value = String(rule.id);
  document.getElementById('subscriptionDetailsSubtitle').textContent = `${rule.desc || rule.category || 'Récurrence'} · montant attendu exprimé en ${subscription.expectedCurrency}`;
  document.getElementById('subscriptionTrialEnd').value = subscription.trialEndDate;
  document.getElementById('subscriptionNextPayment').value = subscription.nextPaymentDate;
  document.getElementById('subscriptionExpectedAmount').value = subscription.expectedAmount === null ? '' : String(subscription.expectedAmount).replace('.', ',');
  document.getElementById('subscriptionRenewal').value = subscription.automaticRenewal;
  document.getElementById('subscriptionNoticeDays').value = String(subscription.noticeDays);
  document.getElementById('subscriptionEffectiveEnd').value = subscription.effectiveEndDate;
  document.getElementById('subscriptionRemainingDue').value = subscription.remainingDue === null ? '' : String(subscription.remainingDue).replace('.', ',');
  document.getElementById('subscriptionManagementUrl').value = subscription.managementUrl;
  document.getElementById('subscriptionCancellationRequested').checked = subscription.cancellationRequested;
  document.getElementById('subscriptionReminder7').checked = subscription.reminders.sevenDays;
  document.getElementById('subscriptionReminder1').checked = subscription.reminders.oneDay;
  document.getElementById('subscriptionReminderStatus').textContent = reminderStatusText(subscription);
  document.getElementById('subscriptionDetailsModal')?.classList.remove('hidden');
}

function closeSubscriptionDetails() {
  document.getElementById('subscriptionDetailsModal')?.classList.add('hidden');
}

function parseOptionalSubscriptionAmount(input, code, label) {
  const raw = String(input || '').trim();
  if (!raw) return { ok: true, value: null };
  const parsed = globalThis.FREEVMoney?.parseAmount(raw, code, 'amount');
  if (!parsed?.ok || parsed.minor < 0) return { ok: false, message: `${label} invalide.` };
  return { ok: true, value: parsed.minor / (10 ** globalThis.FREEVMoney.minorDigits(code)) };
}

function saveSubscriptionDetails(event) {
  event.preventDefault();
  const id = document.getElementById('subscriptionRuleId')?.value || '';
  const rule = recurringTransactions.find(item => String(item.id) === String(id));
  if (!rule) return showToast('Cette récurrence n’existe plus dans le compte courant.', 'error');
  const trialEndDate = document.getElementById('subscriptionTrialEnd')?.value || '';
  const nextPaymentDate = document.getElementById('subscriptionNextPayment')?.value || '';
  const effectiveEndDate = document.getElementById('subscriptionEffectiveEnd')?.value || '';
  if (![trialEndDate, nextPaymentDate, effectiveEndDate].every(subscriptionDateValid))
    return showToast('Une date de renouvellement est invalide.', 'error');
  const code = String(rule.currency || settings.baseCurrency || 'EUR').toUpperCase();
  const expected = parseOptionalSubscriptionAmount(document.getElementById('subscriptionExpectedAmount')?.value, code, 'Montant attendu');
  const remaining = parseOptionalSubscriptionAmount(document.getElementById('subscriptionRemainingDue')?.value, code, 'Somme restant due');
  if (!expected.ok) return showToast(expected.message, 'error');
  if (!remaining.ok) return showToast(remaining.message, 'error');
  const noticeDays = Number(document.getElementById('subscriptionNoticeDays')?.value);
  if (!Number.isInteger(noticeDays) || noticeDays < 0 || noticeDays > 365) return showToast('Le préavis doit être compris entre 0 et 365 jours.', 'error');
  const rawUrl = String(document.getElementById('subscriptionManagementUrl')?.value || '').trim();
  let managementUrl = '';
  if (rawUrl) {
    try {
      const parsedUrl = new URL(rawUrl);
      if (!['https:', 'http:'].includes(parsedUrl.protocol)) throw new Error('protocol');
      managementUrl = parsedUrl.href;
    } catch { return showToast('Le lien de gestion doit être une URL HTTP ou HTTPS valide.', 'error'); }
  }
  const previous = subscriptionFor(rule);
  const futureAfterEnd = effectiveEndDate ? transactions.filter(tx => String(tx.parentId || '') === String(rule.id) &&
    tx.date > isoDate(getToday()) && tx.date > effectiveEndDate && !isUserProtectedOccurrence(tx)) : [];
  if (effectiveEndDate && effectiveEndDate !== previous.effectiveEndDate && futureAfterEnd.length &&
      !confirm(`${futureAfterEnd.length} échéance(s) automatique(s) après le ${effectiveEndDate} seront retirées des prochaines prévisions. Les échéances personnalisées resteront visibles. Confirmer la fin effective ?`)) return;
  const emitted = previous.remindersEmitted;
  const next = {
    trialEndDate,
    nextPaymentDate,
    expectedAmount: expected.value,
    expectedCurrency: code,
    expectedFxRate: rule.fxRate || null,
    automaticRenewal: document.getElementById('subscriptionRenewal')?.value || 'unknown',
    noticeDays,
    managementUrl,
    cancellationRequested: Boolean(document.getElementById('subscriptionCancellationRequested')?.checked),
    effectiveEndDate,
    remainingDue: remaining.value,
    reminders: {
      sevenDays: Boolean(document.getElementById('subscriptionReminder7')?.checked),
      oneDay: Boolean(document.getElementById('subscriptionReminder1')?.checked)
    },
    remindersEmitted: emitted,
    updatedAt: new Date().toISOString()
  };
  rule.subscription = next;
  rule.updatedAt = new Date().toISOString();
  if (effectiveEndDate !== previous.effectiveEndDate) rebuildOccurrencesForRuleFutureOnly(rule.id);
  logAction('update_subscription', 'recurring', previous, next);
  saveData();
  syncAllUI();
  closeSubscriptionDetails();
  showToast('Suivi du renouvellement enregistré. La résiliation reste à effectuer auprès du commerçant.', 'success');
}

function checkSubscriptionReminders() {
  const account = getCurrentAccount?.();
  if (!account || !Array.isArray(recurringTransactions)) return;
  const today = isoDate(getToday());
  const messages = [];
  recurringTransactions.forEach(rule => {
    const subscription = subscriptionFor(rule);
    const candidates = [
      { kind: 'trial', label: 'Fin d’essai', date: subscription.trialEndDate },
      { kind: 'payment', label: 'Prochain paiement', date: subscription.nextPaymentDate }
    ].filter(item => subscriptionDateValid(item.date) && item.date && item.date >= today);
    candidates.forEach(item => {
      const offsets = [
        ...(subscription.reminders.sevenDays ? [7] : []),
        ...(subscription.reminders.oneDay ? [1] : [])
      ].sort((a, b) => a - b);
      const emittedKeys = new Set(subscription.remindersEmitted.map(entry => entry?.key));
      const dueOffset = offsets.find(days => {
        const key = `${item.kind}:${item.date}:${days}`;
        const reminderDate = new Date(`${item.date}T12:00:00`);
        reminderDate.setDate(reminderDate.getDate() - days);
        return today >= isoDate(reminderDate) && today <= item.date && !emittedKeys.has(key);
      });
      if (dueOffset === undefined) return;
      const key = `${item.kind}:${item.date}:${dueOffset}`;
      subscription.remindersEmitted.push({ key, emittedAt: new Date().toISOString() });
      subscription.remindersEmitted = subscription.remindersEmitted.slice(-100);
      messages.push(`${item.label} de « ${rule.desc || rule.category || 'Abonnement'} » le ${new Date(`${item.date}T12:00:00`).toLocaleDateString('fr-FR')}`);
    });
    rule.subscription = subscription;
  });
  if (!messages.length) return;
  saveData();
  const text = messages.slice(0, 3).join(' · ') + (messages.length > 3 ? ` · +${messages.length - 3} autre(s)` : '');
  showToast(text, 'info');
}

window.openRecurringTariff = openRecurringTariff;
window.closeRecurringTariffModal = closeRecurringTariffModal;
window.saveRecurringTariff = saveRecurringTariff;
window.openSubscriptionDetails = openSubscriptionDetails;
window.closeSubscriptionDetails = closeSubscriptionDetails;
window.saveSubscriptionDetails = saveSubscriptionDetails;
window.checkSubscriptionReminders = checkSubscriptionReminders;

document.addEventListener('input', event => {
  if (['recurringTariffAmount', 'recurringTariffCurrency', 'recurringTariffFxRate', 'recurringTariffEffectiveDate'].includes(event.target?.id)) previewRecurringTariff();
});
document.addEventListener('change', event => {
  if (event.target?.id === 'recurringTariffCurrency') {
    event.target.dataset.userSelected = '1';
    updateTariffFxVisibility();
    previewRecurringTariff();
  }
  if (event.target?.id === 'recurringTariffFxRate') {
    event.target.dataset.userEdited = '1';
    previewRecurringTariff();
  }
  if (event.target?.id === 'recurringTariffEffectiveDate' || event.target?.id === 'recurringTariffSingleDate') {
    updateRecurringTariffCurrencyContext();
    updateRecurringTariffScopeCopy();
    previewRecurringTariff();
  }
  if (event.target?.name === 'recurringTariffScope') updateRecurringTariffScope();
});
document.addEventListener('DOMContentLoaded', () => {
  checkSubscriptionReminders();
  document.getElementById('recurringTariffModal')?.addEventListener('click', event => { if (event.target === event.currentTarget) closeRecurringTariffModal(); });
  document.getElementById('subscriptionDetailsModal')?.addEventListener('click', event => { if (event.target === event.currentTarget) closeSubscriptionDetails(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !document.getElementById('recurringTariffModal')?.classList.contains('hidden')) closeRecurringTariffModal();
  });
}, { once: true });
window.addEventListener('freev:ready', checkSubscriptionReminders);
