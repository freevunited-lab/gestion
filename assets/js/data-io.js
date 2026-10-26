// ---------- Export/Import JSON (multi-comptes complet) ----------

const IMPORT_LIMITS = Object.freeze({
  jsonBytes: 5 * 1024 * 1024,
  excelBytes: 10 * 1024 * 1024,
  accounts: 25,
  transactions: 20000,
  transactionsPerAccount: 4000,
  recurrencesPerAccount: 1000,
  importHistoryPerAccount: 100,
  debtsPerAccount: 1000,
  wealthAssetsPerAccount: 500,
  wealthValuationsPerAsset: 100,
  categoryLearningEntries: 500,
  customCategories: 100,
  favoriteTags: 30,
  textLength: 500,
  idLength: 160
});

const IMPORT_LAYOUT_KEYS = Object.freeze({
  dashboard: ['balance', 'income', 'expenses', 'savings', 'alerts', 'budget', 'spendable', 'financeTracking', 'charts', 'recent'],
  operations: ['templates', 'completion', 'drafts'],
  recurring: ['summary', 'occurrences', 'calendar'],
  analytics: ['stats', 'insights', 'dailyBalance', 'balanceTrend', 'monthlyFlow', 'weekday', 'categories'],
  planner: ['summary', 'insights', 'health', 'actions', 'forecast', 'goals', 'envelopes', 'calendar'],
  smart: ['summary', 'intelligence', 'changes', 'priorityHeading', 'priorities', 'monthVerification', 'ruleBuilder', 'ruleSuggestions', 'ruleList', 'subscriptionsManager', 'statementTools', 'importUndo', 'statementImport', 'importPreview', 'wealthSummary', 'assets', 'assetForm', 'assetList', 'securitySettings', 'securityNote', 'deviceSettings', 'recentSessions'],
  savings: ['summary', 'accounts'],
  debts: ['summary', 'details'],
  history: ['events']
});
const IMPORT_LAYOUT_GROUP_KEYS = Object.freeze({
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
const IMPORT_LAYOUT_REQUIRED_KEYS = Object.freeze({ operations: ['completion', 'drafts'], debts: ['summary'] });

function importError(message) {
  return new Error(message);
}

function validateImportText(value, label, max = IMPORT_LIMITS.textLength) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw importError(`${label} invalide`);
  }
  return value;
}

function validateImportId(value, label) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(id)) throw importError(`${label} invalide`);
  return id;
}

function validateImportColor(value, label) {
  if (value !== undefined && value !== '' && !/^#[0-9a-f]{6}$/i.test(String(value))) throw importError(`${label} invalide`);
}

function validateImportedEntries(entries, label, max, validator) {
  if (entries === undefined) return;
  if (!Array.isArray(entries) || entries.length > max) throw importError(`${label} invalide ou trop volumineux`);
  entries.forEach((entry, index) => validator(entry, `${label} #${index + 1}`));
}

// Neutralise les cellules qu'Excel pourrait interpréter comme des formules.
function spreadsheetSafeRows(rows) {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (typeof value !== 'string' || !/^[=+\-@\t\r]/.test(value.trimStart())) return [key, value];
    return [key, `'${value}`];
  })));
}

function parseExcelJSON(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function importExcelRateVersions(value, baseCurrency, fallbackCurrency) {
  const rows = parseExcelJSON(value);
  if (!Array.isArray(rows)) return [];
  const dates = new Set();
  return rows.slice(0, 100).filter(row => {
    if (!row || typeof row !== 'object' || !isValidISODate(row.effectiveFrom) || dates.has(row.effectiveFrom)) return false;
    const currency = String(row.currency || fallbackCurrency || baseCurrency).toUpperCase();
    const amountBase = globalThis.FREEVMoney?.parseAmount(row.amountBase, baseCurrency, 'amount');
    const originalAmount = globalThis.FREEVMoney?.parseAmount(row.originalAmount, currency, 'amount');
    if (!/^[A-Z]{3}$/.test(currency) || !amountBase?.ok || amountBase.minor <= 0 || !originalAmount?.ok || originalAmount.minor <= 0) return false;
    const fxRate = Number(row.fxRate);
    if (currency !== baseCurrency && (!Number.isFinite(fxRate) || fxRate <= 0)) return false;
    dates.add(row.effectiveFrom);
    return true;
  }).map(row => ({
    effectiveFrom: row.effectiveFrom,
    amountBase: Number(row.amountBase),
    originalAmount: Number(row.originalAmount),
    currency: String(row.currency || fallbackCurrency || baseCurrency).toUpperCase(),
    fxRate: String(row.currency || fallbackCurrency || baseCurrency).toUpperCase() === baseCurrency ? null : Number(row.fxRate),
    ...(Number.isFinite(Date.parse(row.createdAt)) ? { createdAt: new Date(row.createdAt).toISOString() } : {})
  }));
}

function importExcelSubscription(value, currency) {
  const row = parseExcelJSON(value);
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const validDate = key => !row[key] || isValidISODate(row[key]);
  if (!['trialEndDate', 'nextPaymentDate', 'effectiveEndDate'].every(validDate)) return null;
  const expectedCurrency = String(row.expectedCurrency || currency || 'EUR').toUpperCase();
  if (!/^[A-Z]{3}$/.test(expectedCurrency)) return null;
  const optionalAmount = value => {
    if (value == null || value === '') return null;
    const parsed = globalThis.FREEVMoney?.parseAmount(value, expectedCurrency, 'amount');
    return parsed?.ok && parsed.minor >= 0 ? parsed.minor / (10 ** globalThis.FREEVMoney.minorDigits(expectedCurrency)) : null;
  };
  let managementUrl = '';
  if (row.managementUrl) {
    try {
      const parsed = new URL(String(row.managementUrl));
      if (['http:', 'https:'].includes(parsed.protocol) && parsed.href.length <= 500) managementUrl = parsed.href;
    } catch { /* ignore invalid imported URL */ }
  }
  const renewal = ['yes', 'no', 'unknown'].includes(row.automaticRenewal) ? row.automaticRenewal : 'unknown';
  const noticeDays = Number(row.noticeDays);
  const reminders = row.reminders && typeof row.reminders === 'object' && !Array.isArray(row.reminders) ? row.reminders : {};
  const emitted = Array.isArray(row.remindersEmitted) ? row.remindersEmitted.filter(item => item && typeof item.key === 'string' && item.key.length <= 160 && Number.isFinite(Date.parse(item.emittedAt))).slice(-100) : [];
  return {
    trialEndDate: row.trialEndDate || '',
    nextPaymentDate: row.nextPaymentDate || '',
    expectedAmount: optionalAmount(row.expectedAmount),
    expectedCurrency,
    expectedFxRate: Number.isFinite(Number(row.expectedFxRate)) && Number(row.expectedFxRate) > 0 ? Number(row.expectedFxRate) : null,
    automaticRenewal: renewal,
    noticeDays: Number.isInteger(noticeDays) && noticeDays >= 0 && noticeDays <= 365 ? noticeDays : 7,
    managementUrl,
    cancellationRequested: Boolean(row.cancellationRequested),
    effectiveEndDate: row.effectiveEndDate || '',
    remainingDue: optionalAmount(row.remainingDue),
    reminders: { sevenDays: reminders.sevenDays !== false, oneDay: reminders.oneDay !== false },
    remindersEmitted: emitted
  };
}

function exportAllAccountsJSON() {
  // ✅ FIX Multi-comptes : exporter TOUS les comptes + leur configuration
  saveCurrentGlobalsToAccount();
  const payload = {
    schemaVersion: '2026-multi-v2',
    exportedAt: new Date().toISOString(),
    accounts,
    currentAccountId,
    multiViewMode,
    selectedGroupIds: [...selectedGroupIds],
    customCategories: customCategories || [],
    uiSettings: uiSettings || {},
    savingsMeta: savingsMeta || {}
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const name = `freev-sauvegarde-${isoDate(getToday())}.json`;
  downloadBlob(name, blob);
  showToast(`Sauvegarde complète exportée (${accounts.length} compte(s))`, 'success');
}

function importAllAccountsJSON(input) {
  const file = input?.files?.[0];
  if (!file) return;
  if (file.size > IMPORT_LIMITS.jsonBytes) {
    showToast('Import sécurisé annulé : le fichier JSON dépasse 5 Mo.', 'error');
    input.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);

      // Validation stricte du fichier
      try {
        validateImportData(parsed);
      } catch(validErr) {
        showToast(`Import annulé : ${validErr.message}`, 'error');
        input.value = '';
        return;
      }

      const count = parsed.accounts.length;
      const totalTx = parsed.accounts.reduce((s, a) => s + (a.transactions || []).length, 0);

      const backupNotice = isTrustedDeviceCacheEnabled()
        ? 'Une sauvegarde locale sera créée avant l’import.'
        : 'Aucune sauvegarde locale ne peut être créée sur cet appareil non fiable : exportez votre JSON avant de continuer.';
      if (!confirm(`Importer ${count} compte(s) avec ${totalTx} transactions ?\n\n⚠️ Cela REMPLACE tous vos comptes actuels.\n${backupNotice}`)) {
        input.value = '';
        return;
      }

      // Backup automatique avant import
      autoBackupSilent();
      window.__freevAccountEpoch = Number(window.__freevAccountEpoch || 0) + 1;

      accounts = parsed.accounts.map(a => ({ ...createAccountObj(a.name, a.id), ...a }));
      currentAccountId = parsed.currentAccountId;
      multiViewMode = parsed.multiViewMode || 'individual';
      selectedGroupIds = new Set(parsed.selectedGroupIds || []);
      customCategories = parsed.customCategories || [];
      uiSettings = { fabColor: '#10b981', reconcileColor: DEFAULT_RECONCILE_COLOR, ...(parsed.uiSettings || {}) };
      savingsMeta = parsed.savingsMeta || {};

      // Vérifier validité du compte courant
      if (!accounts.find(a => a.id === currentAccountId)) currentAccountId = accounts[0]?.id;

      // Migrer les dettes
      accounts.forEach(acc => {
        (acc.debts || []).forEach(debt => {
          if (debt.remainingAmount === undefined) debt.remainingAmount = debt.amount;
          if (debt.initialAmount === undefined) debt.initialAmount = debt.amount;
        });
      });

      loadCurrentAccountIntoGlobals();
      generateRecurringOccurrences();
      saveAccountSystem();
      syncAllUI(true);
      renderAccountsSidebar();
      updateViewModeUI();
      showToast(`Import sécurisé terminé : ${count} compte(s) et ${totalTx} transaction(s) validés.`, 'success');
    } catch(err) {
      console.error(err);
      showToast('Erreur lors de l\'import JSON : fichier corrompu ou format invalide', 'error');
    }
    input.value = '';
  };
  reader.readAsText(file);
}


async function exportToExcel() {
  // ✅ Avertir l'utilisateur si plusieurs comptes existent
  if (accounts.length > 1) {
    const accName = getCurrentAccount()?.name || 'compte actif';
    if (!confirm(`⚠️ L'export Excel ne contient que les données du compte "${accName}".\n\nPour sauvegarder TOUS vos comptes, utilisez le bouton "Sauvegarder tout (JSON)".\n\nContinuer l'export Excel ?`)) return;
  }
  try {
    showToast('Chargement du module Excel…', 'info');
    await ensureXLSX();
    const wb = XLSX.utils.book_new();

    // Meta
    const wsMeta = XLSX.utils.aoa_to_sheet([
      ['app','Freev Valeur'],
      ['appVersion', APP_VERSION],
      ['schemaVersion', SCHEMA_VERSION],      ['exportedAt', new Date().toISOString()],
    ]);
    XLSX.utils.book_append_sheet(wb, wsMeta, 'Meta');

    // Settings
    const wsParams = XLSX.utils.aoa_to_sheet([
      ['Devise de base', settings.baseCurrency || 'EUR'],
      ['Mode par défaut', settings.defaultMode || 'personal'],
      ['Capital initial', initialCapital],
      ['Budget mensuel', monthlyBudget]
    ]);
    XLSX.utils.book_append_sheet(wb, wsParams, 'Paramètres');

    // Budgets by category
    const wsBud = XLSX.utils.aoa_to_sheet([['Catégorie','Budget']]);
    const budRows = Object.entries(budgetsByCategory||{}).map(([k,v])=>({ 'Catégorie':k, 'Budget':v }));
    if (budRows.length) XLSX.utils.sheet_add_json(wsBud, spreadsheetSafeRows(budRows), {origin:'A2', skipHeader:true});
    XLSX.utils.book_append_sheet(wb, wsBud, 'Budgets');

    // Savings
    const wsSav = XLSX.utils.aoa_to_sheet([['Livret','Montant']]);
    const savRows = Object.entries(savingsAccounts||{}).map(([k,v])=>({Livret:k, Montant:v}));
    if (savRows.length) XLSX.utils.sheet_add_json(wsSav, spreadsheetSafeRows(savRows), {origin:'A2', skipHeader:true});
    XLSX.utils.book_append_sheet(wb, wsSav, 'Épargne');

    // Recurring
    const wsRecur = XLSX.utils.aoa_to_sheet([['ID','Type','Catégorie','MontantBase','Devise','MontantOriginal','FxRate','Fréquence','Jour','Date début','Description','Mode','Tags','TransfertCible','RetraitEpargne','DetteLiee','CouleurValidation','OccurrencesIgnorees','ClassementRevenu','TarifsDatés','SuiviAbonnement']]);
    const recurRows = recurringTransactions.map(r=>({
      ID:r.id,
      Type:r.type,
      'Catégorie':r.category,
      MontantBase:Number(r.amountBase ?? r.amount ?? 0),
      Devise:r.currency||settings.baseCurrency,
      MontantOriginal:Number(r.originalAmount ?? r.amount ?? 0),
      FxRate:r.fxRate||'',
      'Fréquence':r.frequency,
      Jour:r.dayOfMonth,
      'Date début':r.startDate,
      Description:r.desc||'',
      Mode:r.mode||'personal',
      Tags:(r.tags||[]).join(', '),
      TransfertCible:r.transferTarget||'',
      RetraitEpargne:r.fromSavings?'oui':'',
      DetteLiee:r.linkedDebtId||'',
      CouleurValidation:r.reconcileColor||'',
      OccurrencesIgnorees:(r.skippedPeriods||[]).join(','),
      ClassementRevenu:r.incomeClass||'',
      TarifsDatés:JSON.stringify(r.rateVersions||[]),
      SuiviAbonnement:r.subscription ? JSON.stringify(r.subscription) : ''
    }));
    if (recurRows.length) XLSX.utils.sheet_add_json(wsRecur, spreadsheetSafeRows(recurRows), {origin:'A2', skipHeader:true});
    XLSX.utils.book_append_sheet(wb, wsRecur, 'Récurrentes');

    // Transactions
    const wsTx = XLSX.utils.aoa_to_sheet([['ID','Date','Heure','Type','Catégorie','MontantBase','Devise','MontantOriginal','FxRate','Mode','Tags','Note','ParentID','PeriodKey','TransfertCible','Verifie','CouleurValidation','Source','RetraitEpargne','DetteLiee','CompteDetteLiee','MontantDetteLiee','TransfertLie','CompteLie','RoleTransfert','TauxTransfert','EffetsAppliques','ModifieManuellement','ClassementRevenu']]);
    const txRows = transactions.filter(t=>!t.isRecurring).map(t=>({
      ID:t.id,
      Date:t.date,
      Heure:t.time || '',
      Type:t.type,
      'Catégorie':t.category,
      MontantBase:Number(t.amountBase ?? t.amount ?? 0),
      Devise:t.currency||settings.baseCurrency,
      MontantOriginal:Number(t.originalAmount ?? t.amount ?? 0),
      FxRate:t.fxRate||'',
      Mode:t.mode||'personal',
      Tags:(t.tags||[]).join(', '),
      Note:t.desc||'',
      ParentID:t.parentId||'',
      PeriodKey:t.periodKey||'',
      TransfertCible:t.transferTarget||'',
      Verifie:t.reconciled ? 'oui' : '',
      CouleurValidation:t.reconcileColor||'',
      Source:t.source||'manual',
      RetraitEpargne:t.fromSavings?'oui':'',
      DetteLiee:t.linkedDebtId||'',
      CompteDetteLiee:t.linkedDebtAccountId||'',
      MontantDetteLiee:t.linkedDebtAmount||'',
      TransfertLie:t.linkedTransferId||'',
      CompteLie:t.linkedAccountId||'',
      RoleTransfert:t.linkedTransferRole||'',
      TauxTransfert:t.linkedTransferRate||'',
      EffetsAppliques:t._effectsApplied===true?'oui':(t._effectsApplied===false?'non':''),
      ModifieManuellement:t._manuallyEdited?'oui':'',
      ClassementRevenu:t.incomeClass||''
    }));
    if (txRows.length) XLSX.utils.sheet_add_json(wsTx, spreadsheetSafeRows(txRows), {origin:'A2', skipHeader:true});
    XLSX.utils.book_append_sheet(wb, wsTx, 'Transactions');

    // Debts
    const wsDebt = XLSX.utils.aoa_to_sheet([['ID','Date','Personne','Direction','MontantInitial','MontantRestant','DateDebut','DateFin','Note']]);
    const dRows = debts.map(d=>({
      ID: d.id,
      Date: d.date,
      Personne: d.person,
      Direction: d.direction,
      MontantInitial: Number(d.initialAmount ?? d.amount) || 0,
      MontantRestant: Number(d.remainingAmount ?? d.amount) || 0,
      DateDebut: d.startDate || '',
      DateFin: d.endDate || '',
      Note: d.note || ''
    }));
    if (dRows.length) XLSX.utils.sheet_add_json(wsDebt, spreadsheetSafeRows(dRows), {origin:'A2', skipHeader:true});
    XLSX.utils.book_append_sheet(wb, wsDebt, 'Dettes');

    XLSX.writeFile(wb, `Freev_Export_ULTRA_${new Date().toISOString().slice(0,10)}.xlsx`);
    showToast('Export Excel réussi', 'success');

  } catch(e) {
    console.error(e);
    showToast('Erreur export Excel', 'error');
  }
}

async function importFromExcel(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > IMPORT_LIMITS.excelBytes) {
    showToast('Import sécurisé annulé : le fichier Excel dépasse 10 Mo.', 'error');
    input.value = '';
    return;
  }
  try {
    showToast('Chargement du module Excel…', 'info');
    await ensureXLSX();
  } catch (error) {
    console.error(error);
    showToast('Module Excel indisponible. Vérifiez votre connexion.', 'error');
    input.value = '';
    return;
  }
  const mode = prompt('Import Excel : 1=REMPLACER, 2=FUSIONNER', '1');
  const merge = String(mode||'1').trim()==='2';

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type:'array' });
      if (wb.SheetNames.length > 16) throw importError('Trop de feuilles dans le fichier Excel');
      const names = wb.SheetNames.map(n=>n.toLowerCase());
      const find = (k) => {
        const idx = names.findIndex(n=>n.includes(k));
        return idx>=0 ? wb.SheetNames[idx] : null;
      };

      const txSheet = find('transac');
        if (!txSheet) {
          showToast('Feuille Transactions introuvable dans le fichier Excel', 'error');
          return;
        }
      const wsTx = wb.Sheets[txSheet];
      const txJson = XLSX.utils.sheet_to_json(wsTx, { defval:'' });
      if (txJson.length > IMPORT_LIMITS.transactions) throw importError('Trop de transactions dans le fichier Excel');

      const excelDateToISO = (val) => {
        if (typeof val === 'number' && !isNaN(val)) {
          const d = XLSX.SSF.parse_date_code(val);
          if (d && d.y && d.m && d.d) {
            const iso = `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
            return isValidISODate(iso) ? iso : '';
          }
        }
        if (typeof val === 'string') {
          const s = val.trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return isValidISODate(s) ? s : '';
          const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (m) {
            const iso = `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
            return isValidISODate(iso) ? iso : '';
          }
        }
        return '';
      };

      const excelBoolean = value => ['1', 'oui', 'yes', 'true', 'vrai'].includes(String(value ?? '').trim().toLowerCase());

      const importedTx = txJson.map(r => {
        const date = excelDateToISO(r.Date || r.date);
        const currency = String(r.Devise || settings.baseCurrency || 'EUR');
        const fxRate = r.FxRate ? safeNumber(r.FxRate, null) : null;

        // ✅ FIX Cohérence amount/amountBase avec fxRate :
        // Priorité : MontantBase (déjà en devise de base)
        // Sinon : si fxRate présent ET devise ≠ base → Montant * fxRate
        // Sinon : Montant tel quel (déjà en devise de base)
        const rawAmount = safeNumber(r.MontantOriginal ?? r['Montant original'] ?? r.Montant ?? r.Amount ?? 0, 0);
        let amountBase;
        if (r.MontantBase !== undefined && r.MontantBase !== '') {
          amountBase = safeNumber(r.MontantBase, rawAmount);
        } else if (fxRate && Number.isFinite(fxRate) && fxRate > 0 && currency !== (settings.baseCurrency || 'EUR')) {
          amountBase = roundMoney(rawAmount * fxRate);
        } else {
          amountBase = rawAmount;
        }
        const originalAmount = rawAmount || amountBase;
        const type = normalizeType(r.Type || r.type);
        return {
          id: r.ID || (genId()),
          date,
          time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(r.Heure || r.time || '').trim()) ? String(r.Heure || r.time).trim() : '',
          type,
          incomeClass: ['regular', 'variable', 'exceptional'].includes(r.ClassementRevenu) ? r.ClassementRevenu : '',
          category: normalizeCategory(r.Catégorie || r.Categorie || r.Category || r.category),
          amount: amountBase,
          amountBase: amountBase,
          originalAmount,
          currency,
          fxRate: fxRate,
          mode: (String(r.Mode||'personal').toLowerCase().includes('bus') ? 'business' : (String(r.Mode||'personal').toLowerCase().includes('pro') ? 'business' : (r.Mode || settings.defaultMode || 'personal'))),
          tags: parseTags(r.Tags || ''),
          desc: r.Note || r.Description || r.desc || '',
          parentId: r.ParentID || '',
          periodKey: r.PeriodKey || '',
          transferTarget: r.TransfertCible || r.TransferTarget || '',
          reconciled: excelBoolean(r.Verifie),
          reconcileColor: r.CouleurValidation || '',
          source: r.Source || (r.ParentID ? 'recurring' : 'manual'),
          fromSavings: excelBoolean(r.RetraitEpargne) || undefined,
          linkedDebtId: r.DetteLiee || null,
          linkedDebtAccountId: r.CompteDetteLiee || '',
          linkedDebtAmount: r.MontantDetteLiee ? safeNumber(r.MontantDetteLiee, null) : null,
          linkedTransferId: r.TransfertLie || '',
          linkedAccountId: r.CompteLie || '',
          linkedTransferRole: r.RoleTransfert || '',
          linkedTransferRate: r.TauxTransfert ? safeNumber(r.TauxTransfert, null) : null,
          _effectsApplied: String(r.EffetsAppliques || '').trim() ? excelBoolean(r.EffetsAppliques) : undefined,
          _manuallyEdited: excelBoolean(r.ModifieManuellement) || undefined,
          isRecurring: false
        };
      }).filter(t => t.date && Number(t.amount) > 0);

      // other sheets
      const paramsSheet = find('param');
      let importedCapital=null, importedBudget=null, importedBaseCurrency=null, importedDefaultMode=null;
      if (paramsSheet) {
        const wsP = wb.Sheets[paramsSheet];
        const rows = XLSX.utils.sheet_to_json(wsP, { header:1, defval:'' });
        rows.forEach(r => {
          const k = String(r[0]||'').toLowerCase();
          if (k.includes('capital')) importedCapital = safeNumber(r[1], null);
          if (k.includes('budget')) importedBudget = safeNumber(r[1], null);
          if (k.includes('devise')) importedBaseCurrency = String(r[1]||'').trim();
          if (k.includes('mode')) importedDefaultMode = String(r[1]||'').trim();
        });
      }

      const savSheet = find('épargne') || find('epargne');
      let importedSavings=null;
      if (savSheet) {
        const wsS=wb.Sheets[savSheet];
        const jsonS=XLSX.utils.sheet_to_json(wsS, {defval:''});
        const obj={};
        jsonS.forEach(r=>{
          const key=String(r.Livret||r.Compte||r.Account||'').trim();
          const val=safeNumber(r.Montant||r.Amount||0, NaN);
          if (key && Number.isFinite(val)) obj[key]=val;
        });
        if (Object.keys(obj).length) importedSavings=obj;
      }

      const recurSheet = find('récurrent') || find('recurrent');
      let importedRecur=null;
      if (recurSheet) {
        const wsR=wb.Sheets[recurSheet];
        const jsonR=XLSX.utils.sheet_to_json(wsR, {defval:''});
        importedRecur = jsonR.map(r=>{
          const amountBase = safeNumber(r.MontantBase ?? r.Montant ?? 0, 0);
          const fromSavings = excelBoolean(r.RetraitEpargne);
          return {
            id: r.ID || (genId()),
            type: fromSavings ? 'income' : normalizeType(r.Type||r.type),
            fromSavings: fromSavings || undefined,
            incomeClass: ['regular', 'variable', 'exceptional'].includes(r.ClassementRevenu) ? r.ClassementRevenu : '',
            category: normalizeCategory(r['Catégorie']||r.Catégorie||r.category),
            amount: amountBase,
            amountBase,
            originalAmount: safeNumber(r.MontantOriginal ?? amountBase, amountBase),
            currency: r.Devise || settings.baseCurrency || 'EUR',
            fxRate: r.FxRate ? safeNumber(r.FxRate, null) : null,
            frequency: normalizeRecurringFrequency(String(r['Fréquence']||r.Frequence||r.frequency||'monthly')),
            dayOfMonth: Math.max(1, Math.min(31, parseInt(r.Jour||1,10)||1)),
            startDate: excelDateToISO(r['Date début']||r['Date debut']||r.startDate||r.Date),
            mode: (String(r.Mode||settings.defaultMode||'personal').toLowerCase().includes('bus')?'business':(r.Mode||settings.defaultMode||'personal')),
            tags: parseTags(r.Tags||''),
            desc: r.Description||r.Note||'',
            transferTarget: r.TransfertCible||'',
            linkedDebtId: r.DetteLiee||null,
            reconcileColor: r.CouleurValidation||'',
            skippedPeriods: String(r.OccurrencesIgnorees||'').split(',').map(item=>item.trim()).filter(Boolean),
            rateVersions: importExcelRateVersions(r.TarifsDatés, String(importedBaseCurrency || settings.baseCurrency || 'EUR').toUpperCase(), String(r.Devise || settings.baseCurrency || 'EUR').toUpperCase()),
            subscription: importExcelSubscription(r.SuiviAbonnement, String(r.Devise || settings.baseCurrency || 'EUR').toUpperCase()),
            isRecurring:true
          };
        }).filter(r=>r.amount>0 && r.startDate);
        if (!importedRecur.length) importedRecur=null;
      }

      const debtSheet = find('dette');
      let importedDebts=null;
      if (debtSheet) {
        const wsD=wb.Sheets[debtSheet];
        const jsonD=XLSX.utils.sheet_to_json(wsD, {defval:''});
        importedDebts = jsonD.map(r => {
          const initial = safeNumber(r.MontantInitial ?? r.Montant ?? 0, 0);
          const remaining = safeNumber(r.MontantRestant ?? r.MontantInitial ?? r.Montant ?? 0, 0);
          return {
            id: r.ID || (genId()),
            date: excelDateToISO(r.Date || r.date),
            person: r.Personne || r.person || '',
            direction: r.Direction || r.direction || 'they_owe_me',
            amount: initial,
            initialAmount: initial,
            remainingAmount: remaining,
            startDate: r.DateDebut || r.startDate || '',
            endDate: r.DateFin || r.endDate || '',
            note: r.Note || ''
          };
        }).filter(d => d.person && d.amount > 0 && d.date);
        if (!importedDebts.length) importedDebts=null;
      }

      // Apply
      if (!merge) {
        transactions = importedTx;
        if (importedRecur) recurringTransactions = importedRecur;
        if (importedSavings) savingsAccounts = importedSavings;
        if (importedDebts) debts = importedDebts;
        if (importedCapital !== null) initialCapital = importedCapital;
        if (importedBudget !== null) monthlyBudget = importedBudget;
        if (importedBaseCurrency) settings.baseCurrency = importedBaseCurrency;
        if (importedDefaultMode) settings.defaultMode = importedDefaultMode;
      } else {
        const mapTx = new Map(transactions.map(t=>[String(t.id), t]));
        importedTx.forEach(t=>mapTx.set(String(t.id), t));
        transactions = Array.from(mapTx.values());

        if (importedRecur) {
          const mapR = new Map(recurringTransactions.map(r=>[String(r.id), r]));
          importedRecur.forEach(r=>mapR.set(String(r.id), r));
          recurringTransactions = Array.from(mapR.values());
        }
        if (importedSavings) savingsAccounts = { ...(savingsAccounts||{}), ...importedSavings };
        if (importedDebts) debts = [...(debts||[]), ...importedDebts];

        if (importedCapital !== null) initialCapital = importedCapital;
        if (importedBudget !== null) monthlyBudget = importedBudget;
        if (importedBaseCurrency) settings.baseCurrency = importedBaseCurrency;
        if (importedDefaultMode) settings.defaultMode = importedDefaultMode;
      }

      generateRecurringOccurrences();

      // ✅ FIX : logique de reconstruction de l'épargne corrigée
      //
      // PROBLÈME PRÉCÉDENT : en mode REMPLACER, on faisait toujours savingsAccounts = {}
      // puis on recalculait depuis les transferts — ce qui ignorait les livrets alimentés
      // MANUELLEMENT via "Gérer l'épargne" (ajouts directs sans transaction de transfert).
      //
      // NOUVELLE LOGIQUE :
      // • Feuille "Épargne" présente dans l'Excel → utiliser ces soldes directement
      //   (ils représentent l'état final exporté, incluant les ajouts manuels ET transferts)
      // • Feuille "Épargne" absente → reconstruire depuis les transferts (fallback)
      const todayStr = isoDate(getToday());
      if (!merge) {
        if (importedSavings && Object.keys(importedSavings).length > 0) {
          // Cas normal : la feuille Épargne est présente → soldes exacts du fichier
          savingsAccounts = { ...importedSavings };
        } else {
          // Fallback : pas de feuille Épargne → reconstruire depuis les transferts
          savingsAccounts = {};
          transactions
            .filter(t => t.type === 'transfer' && !t.isRecurring && (t.date || '') <= todayStr)
            .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
            .forEach(t => applyTransferToSavings(t.transferTarget || defaultSavingsTarget(), Number(t.amountBase ?? t.amount) || 0));
        }
      } else {
        // Mode FUSIONNER : appliquer uniquement les nouveaux transferts importés
        importedTx
          .filter(t => t.type === 'transfer' && (t.date || '') <= todayStr)
          .forEach(t => applyTransferToSavings(t.transferTarget || defaultSavingsTarget(), Number(t.amount) || 0));
      }

      saveData();
      syncAllUI();
      showToast(`Import Excel sécurisé terminé : ${importedTx.length} transaction(s) validée(s).`, 'success');

    } catch(err) {
      console.error(err);
      showToast('Erreur import Excel', 'error');
    }
    input.value='';
  };

  reader.readAsArrayBuffer(file);
}

// ---------- PDF export (month report) — ouvre rapport-mensuel.html ----------
function exportToPDF() {
  const month = document.getElementById('globalMonthPicker')?.value || isoMonth();
  const accId = (multiViewMode === 'individual') ? (currentAccountId || '') : '__all__';
  const params = new URLSearchParams({ month, account: accId });
  window.open('rapport-mensuel.html?' + params.toString(), '_blank');
}

// ---------- Rapprochement bancaire ----------
function toggleReconcile(id, accountId='') {
  let t = null;
  if (accountId) {
    const acc = accounts.find(a => String(a.id) === String(accountId));
    t = (acc?.transactions || []).find(x => String(x.id) === String(id));
  }
  if (!t) t = transactions.find(x => String(x.id) === String(id));
  if (!t) return;
  if (t.paymentStatus === 'planned') return showToast('Validez d’abord le paiement pour pouvoir le rapprocher.', 'info');
  t.reconciled = !t.reconciled;
  if (t.reconciled && t.reconcileColor === undefined) t.reconcileColor = '';
  logAction(t.reconciled ? 'reconcile' : 'unreconcile', 'transaction', null, { id, accountId });
  saveData();
  if (currentView === 'transactions') renderAllTransactions();
  if (currentView === 'dashboard') renderRecentTransactions();
  showToast(t.reconciled ? 'Transaction vérifiée ✓' : 'Vérification annulée', t.reconciled ? 'success' : 'neutral');
}


function validateImportData(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Format invalide : fichier non reconnu');
  if (!Array.isArray(parsed.accounts)) throw new Error('Champ "accounts" manquant ou invalide');
  if (parsed.accounts.length === 0) throw new Error('Le fichier ne contient aucun compte');
  if (parsed.accounts.length > IMPORT_LIMITS.accounts) throw new Error('Trop de comptes dans le fichier');
  let totalTransactions = 0;
  const seenAccountIds = new Set();
  const positiveMoney = (value, label, currency = 'EUR') => {
    const parsed = globalThis.FREEVMoney?.parseAmount(value, currency, 'amount');
    const maxMinor = 1e12 * (10 ** (globalThis.FREEVMoney?.minorDigits(currency) ?? 2));
    if (!parsed?.ok || parsed.minor <= 0 || parsed.minor > maxMinor)
      throw importError(`${label} : montant invalide`);
  };
  const nonNegativeMoney = (value, label, currency = 'EUR') => {
    const parsed = globalThis.FREEVMoney?.parseAmount(value, currency, 'amount');
    const maxMinor = 1e12 * (10 ** (globalThis.FREEVMoney?.minorDigits(currency) ?? 2));
    if (!parsed?.ok || parsed.minor < 0 || parsed.minor > maxMinor) throw importError(`${label} : montant invalide`);
  };
  parsed.accounts.forEach((acc, i) => {
    if (!acc || typeof acc !== 'object') throw new Error(`Compte #${i + 1} invalide`);
    const accountId = validateImportId(acc.id, `Identifiant du compte #${i + 1}`);
    if (seenAccountIds.has(accountId)) throw importError(`Identifiant de compte en double (${accountId})`);
    seenAccountIds.add(accountId);
    validateImportText(acc.name, `Nom du compte #${i + 1}`, 120);
    const baseCurrency = String(acc.settings?.baseCurrency || 'EUR').toUpperCase();
    const txIds = new Set();
    const ruleIds = new Set();
    if (!Array.isArray(acc.transactions)) throw new Error(`Transactions manquantes sur le compte "${acc.name}"`);
    if (acc.transactions.length > IMPORT_LIMITS.transactionsPerAccount) throw new Error(`Trop de transactions sur le compte "${acc.name}"`);
    totalTransactions += acc.transactions.length;
    validateImportedEntries(acc.transactions, `Transaction du compte "${acc.name}"`, IMPORT_LIMITS.transactionsPerAccount, (transaction, label) => {
      if (!transaction || typeof transaction !== 'object') throw importError(`${label} invalide`);
      const id = validateImportId(transaction.id, `${label} : identifiant`);
      if (txIds.has(id)) throw importError(`${label} : identifiant en double`);
      txIds.add(id);
      if (!isValidISODate(transaction.date)) throw importError(`${label} : date invalide`);
      if (transaction.time !== undefined && transaction.time !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(transaction.time))) throw importError(`${label} : heure invalide`);
      if (!['expense', 'income', 'transfer'].includes(transaction.type)) throw importError(`${label} : type invalide`);
      positiveMoney(transaction.amountBase ?? transaction.amount, label, baseCurrency);
      if (transaction.originalAmount !== undefined) positiveMoney(transaction.originalAmount, `${label} (montant d’origine)`, transaction.currency || baseCurrency);
      if (transaction.incomeClass !== undefined && !['', 'regular', 'variable', 'exceptional'].includes(transaction.incomeClass)) throw importError(`${label} : classement de revenu invalide`);
      if (transaction.paymentStatus !== undefined && !['paid','planned'].includes(transaction.paymentStatus)) throw importError(`${label} : statut de paiement invalide`);
      if (transaction.paymentStatus === 'planned' && (transaction.parentId || transaction.linkedDebtId || transaction.fromSavings || !['income','expense'].includes(transaction.type) || transaction.category === 'Remboursement dette')) throw importError(`${label} : opération prévue incompatible avec dette, virement ou récurrence`);
      validateImportText(String(transaction.category || ''), `${label} : catégorie`, 120);
      validateImportText(String(transaction.desc || ''), `${label} : description`);
      validateImportedEntries(transaction.tags || [], `${label} : tags`, 20, (tag, tagLabel) => validateImportText(tag, tagLabel, 80));
      validateImportColor(transaction.reconcileColor, `${label} : couleur`);
    });
    if (acc.categoryLearning !== undefined) {
      const learning = acc.categoryLearning;
      if (!learning || typeof learning !== 'object' || Array.isArray(learning) || learning.schemaVersion !== 1 || learning.accountId !== accountId || !Array.isArray(learning.entries) || learning.entries.length > IMPORT_LIMITS.categoryLearningEntries)
        throw importError(`Mémoire de classement invalide sur le compte "${acc.name}"`);
      const evidenceIds = new Set();
      const allowedFields = new Set(['id', 'accountId', 'transactionId', 'merchant', 'sourceCategory', 'sourceType', 'category', 'type', 'origin', 'confirmedAt', 'status', 'supersededBy', 'undoneAt']);
      validateImportedEntries(learning.entries, `Correction mémorisée du compte "${acc.name}"`, IMPORT_LIMITS.categoryLearningEntries, (entry, label) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(key => !allowedFields.has(key))) throw importError(`${label} invalide`);
        const id = validateImportId(entry.id, `${label} : identifiant`);
        if (evidenceIds.has(id)) throw importError(`${label} : identifiant en double`);
        evidenceIds.add(id);
        if (entry.accountId !== accountId || !['income', 'expense'].includes(entry.sourceType) || !['income', 'expense'].includes(entry.type) || !['active', 'superseded', 'undone'].includes(entry.status) || !Number.isFinite(Date.parse(entry.confirmedAt))) throw importError(`${label} : compte, type, état ou date invalide`);
        validateImportId(entry.transactionId, `${label} : opération d’origine`);
        validateImportText(entry.merchant, `${label} : commerçant`, 120);
        validateImportText(entry.sourceCategory, `${label} : catégorie précédente`, 120);
        validateImportText(entry.category, `${label} : catégorie confirmée`, 120);
        if (!['transaction-editor', 'transaction-detail-editor', 'transaction-quick-edit', 'transaction-bulk-confirmation'].includes(entry.origin)) throw importError(`${label} : origine non autorisée`);
        if (entry.status === 'superseded') validateImportId(entry.supersededBy, `${label} : correction suivante`);
        else if (entry.supersededBy !== undefined) throw importError(`${label} : lien de remplacement invalide`);
        if (entry.status === 'undone') {
          if (!Number.isFinite(Date.parse(entry.undoneAt))) throw importError(`${label} : date d’annulation invalide`);
        } else if (entry.undoneAt !== undefined) throw importError(`${label} : date d’annulation inattendue`);
      });
    }
    validateImportedEntries(acc.wealthAssets || [], `Actif du compte "${acc.name}"`, IMPORT_LIMITS.wealthAssetsPerAccount, (asset, label) => {
      if (!asset || typeof asset !== 'object' || Array.isArray(asset)) throw importError(`${label} invalide`);
      validateImportId(asset.id, `${label} : identifiant`);
      validateImportText(asset.name, `${label} : nom`, 80);
      if (!['property', 'vehicle', 'investment', 'other'].includes(asset.type)) throw importError(`${label} : type invalide`);
      nonNegativeMoney(asset.value, label, baseCurrency);
      if (asset.createdAt !== undefined && !Number.isFinite(Date.parse(asset.createdAt))) throw importError(`${label} : date de création invalide`);
      if (asset.updatedAt !== undefined && !Number.isFinite(Date.parse(asset.updatedAt))) throw importError(`${label} : date de mise à jour invalide`);
      if (asset.valuations !== undefined) {
        validateImportedEntries(asset.valuations, `${label} : historique des estimations`, IMPORT_LIMITS.wealthValuationsPerAsset, (valuation, valuationLabel) => {
          if (!valuation || typeof valuation !== 'object' || Array.isArray(valuation) || !isValidISODate(valuation.date)) throw importError(`${valuationLabel} invalide`);
          validateImportId(valuation.id, `${valuationLabel} : identifiant`);
          nonNegativeMoney(valuation.value, valuationLabel, baseCurrency);
          if (valuation.recordedAt !== undefined && !Number.isFinite(Date.parse(valuation.recordedAt))) throw importError(`${valuationLabel} : date de saisie invalide`);
        });
        const dates = asset.valuations.map(valuation => valuation.date);
        if (new Set(dates).size !== dates.length) throw importError(`${label} : plusieurs estimations à la même date`);
      }
    });
    validateImportedEntries(acc.importHistory, `Historique d’import du compte "${acc.name}"`, IMPORT_LIMITS.importHistoryPerAccount, (record, label) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw importError(`${label} invalide`);
      validateImportId(record.id, `${label} : identifiant`);
      if (record.accountId !== accountId || !Number.isFinite(Date.parse(record.createdAt))) throw importError(`${label} : compte ou date invalide`);
      validateImportText(record.filename, `${label} : nom du fichier`, 120);
      for (const field of ['importedCount', 'duplicateCount', 'skippedCount', 'errorCount'])
        if (!Number.isInteger(record[field]) || record[field] < 0 || record[field] > 20000) throw importError(`${label} : nombre ${field} invalide`);
      if ((record.undoneAt !== undefined && (typeof record.undoneAt !== 'string' || !Number.isFinite(Date.parse(record.undoneAt)))) || (record.undoneCount !== undefined && (!Number.isInteger(record.undoneCount) || record.undoneCount < 0 || record.undoneCount > record.importedCount)) || (record.undoneAt === undefined) !== (record.undoneCount === undefined))
        throw importError(`${label} : état d’annulation invalide`);
    });
    validateImportedEntries(acc.recurringTransactions || [], `Récurrence du compte "${acc.name}"`, IMPORT_LIMITS.recurrencesPerAccount, (rule, label) => {
      if (!rule || typeof rule !== 'object') throw importError(`${label} invalide`);
      const id = validateImportId(rule.id, `${label} : identifiant`);
      if (ruleIds.has(id)) throw importError(`${label} : identifiant en double`);
      ruleIds.add(id);
      if (!isValidISODate(rule.startDate)) throw importError(`${label} : date de début invalide`);
      if (!['monthly', 'weekly', 'yearly'].includes(rule.frequency || 'monthly')) throw importError(`${label} : fréquence invalide`);
      positiveMoney(rule.amountBase ?? rule.amount, label, baseCurrency);
      if (rule.originalAmount !== undefined) positiveMoney(rule.originalAmount, `${label} (montant d’origine)`, rule.currency || baseCurrency);
      if (rule.incomeClass !== undefined && !['', 'regular', 'variable', 'exceptional'].includes(rule.incomeClass)) throw importError(`${label} : classement de revenu invalide`);
      if (rule.rateVersions !== undefined) {
        validateImportedEntries(rule.rateVersions, `${label} : tarifs datés`, 100, (version, versionLabel) => {
          if (!version || typeof version !== 'object' || !isValidISODate(version.effectiveFrom)) throw importError(`${versionLabel} invalide`);
          const currency = String(version.currency || rule.currency || baseCurrency).toUpperCase();
          if (!/^[A-Z]{3}$/.test(currency)) throw importError(`${versionLabel} : devise invalide`);
          positiveMoney(version.amountBase, versionLabel, baseCurrency);
          positiveMoney(version.originalAmount, `${versionLabel} (montant d’origine)`, currency);
          if (currency !== baseCurrency && !(Number(version.fxRate) > 0 && Number.isFinite(Number(version.fxRate)))) throw importError(`${versionLabel} : taux de conversion invalide`);
        });
        const dates = (rule.rateVersions || []).map(version => version.effectiveFrom);
        if (new Set(dates).size !== dates.length) throw importError(`${label} : plusieurs tarifs ont la même date d’effet`);
      }
      if (rule.subscription !== undefined && rule.subscription !== null) {
        const subscription = rule.subscription;
        if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)) throw importError(`${label} : suivi d’abonnement invalide`);
        for (const field of ['trialEndDate', 'nextPaymentDate', 'effectiveEndDate'])
          if (subscription[field] && !isValidISODate(subscription[field])) throw importError(`${label} : ${field} invalide`);
        if (subscription.automaticRenewal !== undefined && !['yes', 'no', 'unknown'].includes(subscription.automaticRenewal)) throw importError(`${label} : renouvellement invalide`);
        if (subscription.noticeDays !== undefined && (!Number.isInteger(subscription.noticeDays) || subscription.noticeDays < 0 || subscription.noticeDays > 365)) throw importError(`${label} : préavis invalide`);
        const expectedCurrency = String(subscription.expectedCurrency || rule.currency || baseCurrency).toUpperCase();
        if (!/^[A-Z]{3}$/.test(expectedCurrency)) throw importError(`${label} : devise d’abonnement invalide`);
        if (subscription.expectedAmount != null) nonNegativeMoney(subscription.expectedAmount, `${label} (montant attendu)`, expectedCurrency);
        if (subscription.remainingDue != null) nonNegativeMoney(subscription.remainingDue, `${label} (somme restant due)`, expectedCurrency);
        if (subscription.managementUrl) {
          validateImportText(subscription.managementUrl, `${label} : lien de gestion`, 500);
          try {
            const url = new URL(subscription.managementUrl);
            if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
          } catch { throw importError(`${label} : lien de gestion invalide`); }
        }
        if (subscription.reminders !== undefined && (!subscription.reminders || typeof subscription.reminders !== 'object' || Array.isArray(subscription.reminders) ||
            (subscription.reminders.sevenDays !== undefined && typeof subscription.reminders.sevenDays !== 'boolean') ||
            (subscription.reminders.oneDay !== undefined && typeof subscription.reminders.oneDay !== 'boolean'))) throw importError(`${label} : rappels invalides`);
        if (subscription.remindersEmitted !== undefined) validateImportedEntries(subscription.remindersEmitted, `${label} : historique des rappels`, 100, (entry, entryLabel) => {
          if (!entry || typeof entry !== 'object' || typeof entry.key !== 'string' || entry.key.length > 160 || !Number.isFinite(Date.parse(entry.emittedAt))) throw importError(`${entryLabel} invalide`);
        });
      }
      validateImportText(String(rule.category || ''), `${label} : catégorie`, 120);
      validateImportText(String(rule.desc || ''), `${label} : description`);
      validateImportedEntries(rule.tags || [], `${label} : tags`, 20, (tag, tagLabel) => validateImportText(tag, tagLabel, 80));
      validateImportColor(rule.reconcileColor, `${label} : couleur`);
    });
    if (acc.plannerSettings !== undefined) {
      if (!acc.plannerSettings || typeof acc.plannerSettings !== 'object' || Array.isArray(acc.plannerSettings)) throw importError(`Réglages du planificateur invalides sur le compte "${acc.name}"`);
      const profile = acc.plannerSettings.incomeProfile;
      if (profile !== undefined) {
        if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw importError(`Profil de revenus invalide sur le compte "${acc.name}"`);
        if (profile.baseMode !== undefined && !['manual', 'auto'].includes(profile.baseMode)) throw importError(`Mode de base de revenus invalide sur le compte "${acc.name}"`);
        if (profile.coefficientBps !== undefined && (!Number.isInteger(profile.coefficientBps) || profile.coefficientBps < 5000 || profile.coefficientBps > 10000)) throw importError(`Coefficient de revenus invalide sur le compte "${acc.name}"`);
        if (profile.baseCurrency !== undefined && !/^[A-Z]{3}$/.test(String(profile.baseCurrency))) throw importError(`Devise du profil de revenus invalide sur le compte "${acc.name}"`);
        for (const field of ['incomeBudgetBaseMinor', 'suggestionSnapshotMinor'])
          if (profile[field] != null && (!Number.isSafeInteger(profile[field]) || profile[field] < 0)) throw importError(`Montant ${field} invalide sur le compte "${acc.name}"`);
        if (profile.coverageByMonth !== undefined) {
          if (!profile.coverageByMonth || typeof profile.coverageByMonth !== 'object' || Array.isArray(profile.coverageByMonth) || Object.keys(profile.coverageByMonth).length > 24) throw importError(`Mois couverts invalides sur le compte "${acc.name}"`);
          Object.entries(profile.coverageByMonth).forEach(([month, covered]) => {
            if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || typeof covered !== 'boolean') throw importError(`Mois couvert invalide sur le compte "${acc.name}"`);
          });
        }
      }
    }
    if (acc.presentationSettings !== undefined) {
      if (!acc.presentationSettings || typeof acc.presentationSettings !== 'object' || Array.isArray(acc.presentationSettings)) throw importError(`Préférences de présentation invalides sur le compte "${acc.name}"`);
      const layout = acc.presentationSettings.layout;
      if (layout !== undefined) {
        if (!layout || typeof layout !== 'object' || Array.isArray(layout)) throw importError(`Disposition invalide sur le compte "${acc.name}"`);
        for (const field of ['hidden', 'order'])
          if (layout[field] !== undefined && (!layout[field] || typeof layout[field] !== 'object' || Array.isArray(layout[field]))) throw importError(`Préférences ${field} invalides sur le compte "${acc.name}"`);
        Object.entries(layout.hidden || {}).forEach(([scope, keys]) => {
          if (!Object.hasOwn(IMPORT_LAYOUT_KEYS, scope) || !Array.isArray(keys) || keys.length > IMPORT_LAYOUT_KEYS[scope].length || keys.some(key => !IMPORT_LAYOUT_KEYS[scope].includes(key) || IMPORT_LAYOUT_REQUIRED_KEYS[scope]?.includes(key)) || new Set(keys).size !== keys.length)
            throw importError(`Blocs masqués invalides sur le compte "${acc.name}"`);
        });
        Object.entries(layout.order || {}).forEach(([group, keys]) => {
          if (!Object.hasOwn(IMPORT_LAYOUT_GROUP_KEYS, group) || !Array.isArray(keys) || keys.length > IMPORT_LAYOUT_GROUP_KEYS[group].length || keys.some(key => !IMPORT_LAYOUT_GROUP_KEYS[group].includes(key)) || new Set(keys).size !== keys.length)
            throw importError(`Ordre des blocs invalide sur le compte "${acc.name}"`);
        });
      }
    }
    if (acc.bulkUndo !== undefined && acc.bulkUndo !== null) {
      const record = acc.bulkUndo;
      const isStatementImport = record?.action === 'statement-import';
      const isMonthDuplication = record?.action === 'monthly-transaction-duplication';
      if (!record || typeof record !== 'object' || Array.isArray(record) || !['automation-rule-reclassification', 'manual-bulk-category-reclassification', 'statement-import', 'monthly-transaction-duplication'].includes(record.action) || record.accountId !== accountId || typeof record.ownerUid !== 'string' || record.ownerUid.length > 200 || !Number.isFinite(Date.parse(record.createdAt)) || !/^\d{1,8}:[0-9a-f]{1,8}:[0-9a-f]{1,8}$/i.test(record.revision) || !Array.isArray(record.changes) || !record.changes.length || record.changes.length > 4000 || (isStatementImport && (!record.importId || !validateImportId(record.importId, 'Identifiant de l’import annulable') || typeof record.filename !== 'string')) || (isMonthDuplication && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(record.sourceMonth || '') || !/^\d{4}-(0[1-9]|1[0-2])$/.test(record.targetMonth || '') || record.sourceMonth === record.targetMonth))) throw importError(`Action annulable invalide sur le compte "${acc.name}"`);
      if (isStatementImport) validateImportText(record.filename, 'Nom du relevé annulable', 120);
      const undoIds = new Set();
      validateImportedEntries(record.changes, `Action annulable du compte "${acc.name}"`, 4000, (change, label) => {
        if (!change || typeof change !== 'object') throw importError(`${label} invalide`);
        const id = validateImportId(change.transactionId, `${label} : opération`);
        if (undoIds.has(id)) throw importError(`${label} : opération en double`);
        undoIds.add(id);
        if (isStatementImport || isMonthDuplication) {
          if (Object.keys(change).some(key => key !== 'transactionId')) throw importError(`${label} : référence d’action annulable invalide`);
          return;
        }
        for (const state of [change.before, change.after]) {
          if (!state || typeof state !== 'object' || Array.isArray(state) || typeof state.categoryPresent !== 'boolean' || typeof state.rulePresent !== 'boolean' || !['income', 'expense'].includes(state.type)) throw importError(`${label} : état financier invalide`);
          validateImportText(String(state.category || ''), `${label} : catégorie`, 120);
          validateImportText(String(state.ruleId || ''), `${label} : identifiant de règle`, 160);
        }
      });
      if (isStatementImport) {
        const importRecord = (acc.importHistory || []).find(item => item.id === record.importId && item.accountId === accountId);
        if (!importRecord || importRecord.undoneAt || importRecord.filename !== record.filename || importRecord.importedCount !== record.changes.length)
          throw importError(`Lien de l’import annulable invalide sur le compte "${acc.name}"`);
      }
      if (isMonthDuplication) {
        const transactionById = new Map((acc.transactions || []).map(transaction => [String(transaction.id), transaction]));
        if (record.changes.some(change => {
          const transaction = transactionById.get(change.transactionId);
          return !transaction || !String(transaction.date || '').startsWith(record.targetMonth) ||
            !String(transaction.desc || '').endsWith(' (mois dupliqué)') || transaction.source !== 'manual' ||
            transaction.isRecurring || transaction.parentId || !['income', 'expense'].includes(transaction.type) ||
            transaction.linkedTransferId || transaction.linkedAccountId || transaction.linkedDebtId || transaction.fromSavings || transaction.toSavings;
        })) throw importError(`Lien de la duplication annulable invalide sur le compte "${acc.name}"`);
      }
    }
    validateImportedEntries(acc.debts || [], `Dette du compte "${acc.name}"`, IMPORT_LIMITS.debtsPerAccount, (debt, label) => {
      if (!debt || typeof debt !== 'object') throw importError(`${label} invalide`);
      validateImportId(debt.id, `${label} : identifiant`);
      validateImportText(String(debt.person || ''), `${label} : personne`, 120);
      validateImportText(String(debt.note || ''), `${label} : note`);
    });
  });
  if (totalTransactions > IMPORT_LIMITS.transactions) throw new Error('Trop de transactions dans le fichier');
  if (parsed.currentAccountId) validateImportId(parsed.currentAccountId, 'Compte actif');
  validateImportedEntries(parsed.customCategories || [], 'Catégorie personnalisée', IMPORT_LIMITS.customCategories, (category, label) => {
    if (!category || typeof category !== 'object') throw importError(`${label} invalide`);
    validateImportText(category.name, `${label} : nom`, 80);
    validateImportColor(category.color, `${label} : couleur`);
  });
  validateImportedEntries(parsed.uiSettings?.favoriteTags || [], 'Tag favori', IMPORT_LIMITS.favoriteTags, (tag, label) => validateImportText(tag, label, 80));
  return true;
}


function setupShortcuts() {
  window.addEventListener('keydown', (e) => {
    // '+' opens modal
    if (e.key === '+' || (e.key === '=' && e.shiftKey)) {
      e.preventDefault();
      openModal();
      return;
    }

    // Ctrl+F focuses search (in transactions)
    if (e.ctrlKey && e.key.toLowerCase() === 'f') {
      const s = document.getElementById('txSearch');
      if (s) { e.preventDefault(); switchView('transactions'); setTimeout(()=>s.focus(), 0); }
    }

    // Ctrl+Shift+S export Excel
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      exportToExcel();
    }

    // Escape closes modals
    if (e.key === 'Escape') {
      ['transactionModal','budgetModal','capitalModal','savingsModal','debtModal','interAccountModal','accountsModal'].forEach(id => {
        const m = document.getElementById(id);
        if (m && !m.classList.contains('hidden')) m.classList.add('hidden');
      });
    }
  });
}

// ---------- Mobile sidebar ----------
function setupSidebarToggle() {
  const sidebar = document.querySelector('.sidebar');
  const btn = document.getElementById('sidebarToggle');
  const compactQuery = window.matchMedia('(max-width: 768px), (pointer: coarse) and (max-width: 1024px), (horizontal-viewport-segments: 2), (vertical-viewport-segments: 2)');

  // show button on small screens
  const update = () => {
    const small = compactQuery.matches;
    if (btn) btn.style.display = small ? 'inline-flex' : 'none';
    if (!small && sidebar?.classList.contains('open')) closeSidebarMobile();
  };
  window.addEventListener('resize', update);
  compactQuery.addEventListener?.('change', update);
  update();

  if (btn && sidebar) {
    btn.addEventListener('click', () => {
      const isOpen = sidebar.classList.contains('open');
      isOpen ? closeSidebarMobile() : openSidebarMobile();
    });
  }
}

// ---------- Month picker change ----------
function onMonthPickerChange() {
  // La navigation lit les échéances prévues sans créer ni modifier d'opérations.
  syncAllUI();
}

// ---------- Month navigation ----------
function changeMonth(offset) {
  const input = document.getElementById('globalMonthPicker');
  const cur = (input?.value || isoMonth());
  const parts = cur.split('-').map(Number);
  const y = parts[0] || new Date().getFullYear();
  const m = parts[1] || (new Date().getMonth() + 1);
  const date = new Date(y, m - 1, 1); // local-safe
  date.setMonth(date.getMonth() + offset);
  if (input) input.value = isoMonth(date);
  syncAllUI();
}

// ---------- Utility refresh ----------
// ✅ FIX Performance : syncAllUI ne redessine que la vue active,
// ce qui était déjà le cas — on ajoute en plus un debounce pour éviter
// les appels en rafale (ex: sauvegarde qui appelait syncAllUI plusieurs fois de suite).
let _syncTimer = null;
function syncAllUI(immediate = false) {
  if (immediate) {
    _doSyncAllUI();
  } else {
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(_doSyncAllUI, 16); // un seul rendu par frame (≈60fps)
  }
}

function _doSyncAllUI() {
  window.applyFreevLayoutPreferences?.();
  refreshSavingsSelect();
  refreshCategoryFilter();
  populateCategorySelects(); // ✅ Rafraîchit les catégories perso après changement de compte

  if (currentView === 'transactions') renderAllTransactions();
  if (currentView === 'recurring') renderRecurringList();
  if (currentView === 'analytics') setTimeout(() => renderAnalytics(), 0);
  if (currentView === 'planner') window.FreevV4?.render?.();
  if (currentView === 'smart') window.FreevV5?.render?.();
  if (currentView === 'savings') renderSavingsList();
  if (currentView === 'debts') renderDebts();
  if (currentView === 'history') renderHistory();
  if (currentView === 'settings') {
    if (document.getElementById('freevLayoutScope')?.value === 'debts') renderDebts();
    loadSettingsUI(); renderDataHealth(); window.renderFreevLayoutControls?.();
  }

  // Les graphiques sont coûteux sur mobile : ne pas les recréer lorsqu'ils sont cachés.
  if (currentView === 'dashboard') updateDashboard();
  renderAccountsSidebar();
}

// Mise à jour légère : uniquement le dashboard et la sidebar (pas les listes)
// Utilisée après des actions simples (ex: changement de capital, budget)
function syncDashboard() {
  updateDashboard();
  renderAccountsSidebar();
}



// ---------- Duplicate month ----------
const DUPLICATE_MONTH_PAGE_SIZE = 40;
const DUPLICATE_MONTH_TRANSACTION_LIMIT = 4000;

function duplicateMonthPrompt() {
  const chosenMonth = document.getElementById('globalMonthPicker')?.value;
  const from = isValidDuplicateMonth(chosenMonth) ? chosenMonth : isoMonth();
  const [year, month] = from.split('-').map(Number);
  const to = month === 12 ? `${String(year + 1).padStart(4, '0')}-01` : `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}`;
  document.getElementById('duplicateMonthFrom').value = from;
  document.getElementById('duplicateMonthTo').value = to;
  document.getElementById('duplicateMonthPreviewResults').hidden = true;
  window.__freevDuplicateMonthReturnFocus = document.activeElement;
  window.__freevDuplicateMonthPreview = null;
  const overlay = document.getElementById('duplicateMonthPreview');
  if (overlay) overlay.hidden = false;
  document.getElementById('duplicateMonthFrom')?.focus();
}

function prepareDuplicateMonthPreview() {
  const from = document.getElementById('duplicateMonthFrom')?.value || '';
  const to = document.getElementById('duplicateMonthTo')?.value || '';
  if (!isValidDuplicateMonth(from) || !isValidDuplicateMonth(to)) {
    showToast('Format mois invalide', 'error');
    return;
  }
  if (from === to) {
    showToast('Les mois sont identiques', 'info');
    return;
  }
  const state = window._getAppState?.();
  const account = state?.accounts?.find(item => String(item.id) === String(state.currentAccountId));
  if (!account || !window.freevTransactionRevision) {
    showToast('Impossible de préparer l’aperçu pour ce compte.', 'error');
    return;
  }
  const preview = buildDuplicateMonthPlan(account, from, to);
  window.__freevDuplicateMonthPreview = {
    accountId: account.id,
    fromMonth: from,
    toMonth: to,
    revision: window.freevTransactionRevision(account),
    changes: preview.changes.map(item => ({ sourceId: item.sourceId, date: item.date, desc: item.desc })),
    excluded: preview.excluded,
    duplicates: preview.duplicates,
    overflow: preview.overflow,
    page: 0,
    returnFocus: window.__freevDuplicateMonthReturnFocus || document.activeElement
  };
  renderDuplicateMonthPreview(preview);
  document.getElementById('duplicateMonthPreviewResults').hidden = false;
  document.getElementById('duplicateMonthConfirm')?.focus();
}

function isValidDuplicateMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value)) && isValidISODate(`${value}-01`);
}

function duplicateMonthSignature(transaction, date = transaction?.date, desc = transaction?.desc || '') {
  return `${date}|${transaction?.type || ''}|${transaction?.category || ''}|${Number(transaction?.amountBase ?? transaction?.amount)}|${desc}`;
}

function isDuplicateMonthSource(transaction, idCounts) {
  const date = String(transaction?.date || '');
  const amount = Number(transaction?.amountBase ?? transaction?.amount);
  return Boolean(transaction && !transaction.isRecurring && !transaction.parentId &&
    !['transfer'].includes(transaction.type) && ['income', 'expense'].includes(transaction.type) &&
    !transaction.linkedTransferId && !transaction.linkedAccountId && !transaction.linkedDebtId &&
    !transaction.fromSavings && !transaction.toSavings &&
    idCounts.get(String(transaction.id || '')) === 1 && Number.isFinite(amount) &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) && isValidISODate(date));
}

function buildDuplicateMonthPlan(account, fromMonth, toMonth) {
  const all = Array.isArray(account?.transactions) ? account.transactions : [];
  const fromList = all.filter(transaction => String(transaction?.date || '').startsWith(fromMonth));
  const idCounts = new Map();
  all.forEach(transaction => {
    const id = String(transaction?.id || '');
    if (id) idCounts.set(id, (idCounts.get(id) || 0) + 1);
  });
  const signatures = new Set(all.map(transaction => duplicateMonthSignature(transaction)));
  const [year, month] = toMonth.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const changes = [];
  let excluded = 0;
  let duplicates = 0;
  fromList
    .filter(transaction => isDuplicateMonthSource(transaction, idCounts))
    .sort((left, right) => String(left.date).localeCompare(String(right.date)) || String(left.id).localeCompare(String(right.id), 'fr'))
    .forEach(transaction => {
      const day = Number(String(transaction.date).slice(8, 10));
      const date = `${toMonth}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
      const desc = `${transaction.desc || ''} (mois dupliqué)`;
      const signature = duplicateMonthSignature(transaction, date, desc);
      if (signatures.has(signature)) {
        duplicates += 1;
        return;
      }
      signatures.add(signature);
      changes.push({ sourceId: String(transaction.id), date, desc, transaction });
    });
  excluded = fromList.length - fromList.filter(transaction => isDuplicateMonthSource(transaction, idCounts)).length;
  const overflow = changes.length > 0 && all.length + changes.length > DUPLICATE_MONTH_TRANSACTION_LIMIT;
  return { fromMonth, toMonth, sourceCount: fromList.length, changes, excluded, duplicates, overflow, account };
}

function escapeDuplicateMonthHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function renderDuplicateMonthPreview(plan = null) {
  const pending = window.__freevDuplicateMonthPreview;
  if (!pending) return;
  const account = plan?.account || window._getAppState?.().accounts?.find(item => String(item.id) === String(pending.accountId));
  const currentPlan = plan || (account ? buildDuplicateMonthPlan(account, pending.fromMonth, pending.toMonth) : null);
  const summary = document.getElementById('duplicateMonthPreviewSummary');
  const rows = document.getElementById('duplicateMonthPreviewRows');
  const pagination = document.getElementById('duplicateMonthPreviewPagination');
  const confirmButton = document.getElementById('duplicateMonthConfirm');
  if (!currentPlan || !summary || !rows || !pagination || !confirmButton) return;
  const additions = currentPlan.changes.length;
  const state = window._getAppState?.();
  const stale = !account || String(state?.currentAccountId) !== String(pending.accountId) || window.freevTransactionRevision?.(account) !== pending.revision ||
    document.getElementById('duplicateMonthFrom')?.value !== pending.fromMonth || document.getElementById('duplicateMonthTo')?.value !== pending.toMonth;
  summary.innerHTML = `<p><strong>${escapeDuplicateMonthHTML(pending.fromMonth)} → ${escapeDuplicateMonthHTML(pending.toMonth)}</strong> · ${additions} opération(s) seront créées.</p><p>${currentPlan.duplicates} doublon(s) déjà présent(s) ignoré(s) · ${currentPlan.excluded} opération(s) exclue(s) (récurrence, transfert ou données invalides).</p>${currentPlan.overflow ? '<p role="alert">La limite de 4 000 opérations par compte serait dépassée. Réduisez d’abord le nombre d’opérations du compte.</p>' : ''}${stale ? '<p role="alert">Le compte, les opérations ou les mois ont changé. Cliquez sur « Afficher l’aperçu » pour recalculer avant de confirmer.</p>' : ''}`;
  const start = pending.page * DUPLICATE_MONTH_PAGE_SIZE;
  rows.innerHTML = currentPlan.changes.slice(start, start + DUPLICATE_MONTH_PAGE_SIZE).map(item => {
    const transaction = item.transaction;
    const amount = formatCurrencySimple(transaction.amountBase ?? transaction.amount, account?.settings?.baseCurrency || 'EUR');
    const type = transaction.type === 'income' ? 'Revenu' : 'Dépense';
    const description = item.desc || transaction.merchant || 'Opération sans libellé';
    return `<article class="v5-rule-preview-row"><span class="v5-rule-preview-main"><strong>${escapeDuplicateMonthHTML(transaction.date)} → ${escapeDuplicateMonthHTML(item.date)} · ${escapeDuplicateMonthHTML(description)}</strong><small>${escapeDuplicateMonthHTML(amount)} · ${type} · ${escapeDuplicateMonthHTML(transaction.category || 'Sans catégorie')}</small></span></article>`;
  }).join('') || '<p class="v5-empty">Aucune opération à dupliquer.</p>';
  const pageCount = Math.ceil(additions / DUPLICATE_MONTH_PAGE_SIZE);
  pagination.innerHTML = pageCount > 1 ? `<button type="button" class="btn btn-secondary btn-sm" data-duplicate-month-page="previous" ${pending.page <= 0 ? 'disabled' : ''}>Précédent</button><span>Page ${pending.page + 1} / ${pageCount} · ${additions} opération(s)</span><button type="button" class="btn btn-secondary btn-sm" data-duplicate-month-page="next" ${pending.page >= pageCount - 1 ? 'disabled' : ''}>Suivant</button>` : additions ? `<span>${additions} opération(s) à créer</span>` : '';
  confirmButton.disabled = stale || additions === 0 || currentPlan.overflow;
  confirmButton.textContent = currentPlan.overflow ? 'Limite du compte dépassée' : additions ? `Dupliquer ${additions} opération(s)` : 'Aucune opération à dupliquer';
  pending.changes = currentPlan.changes.map(item => ({ sourceId: item.sourceId, date: item.date, desc: item.desc }));
  pending.excluded = currentPlan.excluded;
  pending.duplicates = currentPlan.duplicates;
  pending.overflow = currentPlan.overflow;
}

function closeDuplicateMonthPreview() {
  const pending = window.__freevDuplicateMonthPreview;
  const returnFocus = pending?.returnFocus || window.__freevDuplicateMonthReturnFocus;
  const overlay = document.getElementById('duplicateMonthPreview');
  if (overlay) overlay.hidden = true;
  window.__freevDuplicateMonthPreview = null;
  window.__freevDuplicateMonthReturnFocus = null;
  returnFocus?.focus?.();
}

function confirmDuplicateMonthPreview() {
  const pending = window.__freevDuplicateMonthPreview;
  const state = window._getAppState?.();
  const account = state?.accounts?.find(item => String(item.id) === String(pending?.accountId));
  if (pending && (document.getElementById('duplicateMonthFrom')?.value !== pending.fromMonth || document.getElementById('duplicateMonthTo')?.value !== pending.toMonth)) {
    renderDuplicateMonthPreview();
    showToast('Les mois ont changé depuis l’aperçu. Recalculez-le avant de confirmer.', 'info');
    return;
  }
  if (!pending || !account || String(state.currentAccountId) !== String(pending.accountId) ||
      window.freevTransactionRevision?.(account) !== pending.revision) {
    closeDuplicateMonthPreview();
    showToast('Les données du compte ont changé. Relancez l’aperçu avant de dupliquer.', 'error');
    return;
  }
  const plan = buildDuplicateMonthPlan(account, pending.fromMonth, pending.toMonth);
  const plannedIds = plan.changes.map(item => item.sourceId);
  if (plan.overflow || !plannedIds.length || JSON.stringify(plannedIds) !== JSON.stringify(pending.changes.map(item => item.sourceId))) {
    closeDuplicateMonthPreview();
    showToast('L’aperçu a changé ou dépasse la limite du compte. Aucune opération n’a été créée.', 'error');
    return;
  }
  if (plan.changes.length + account.transactions.length > DUPLICATE_MONTH_TRANSACTION_LIMIT) {
    closeDuplicateMonthPreview();
    showToast('La limite de 4 000 opérations par compte serait dépassée.', 'error');
    return;
  }
  const sourceById = new Map(account.transactions.map(transaction => [String(transaction.id), transaction]));
  const created = [];
  plan.changes.forEach(item => {
    const source = sourceById.get(item.sourceId);
    if (!source) return;
    const copy = {
      ...source,
      id: genId(), date: item.date, desc: item.desc, parentId: '', periodKey: '',
      linkedTransferId: '', linkedAccountId: '', linkedTransferRole: '', linkedTransferRate: null,
      source: 'manual', reconciled: false, _effectsApplied: false
    };
    transactions.push(copy);
    logAction('duplicate_month', 'transaction', source, copy);
    created.push({ transactionId: String(copy.id) });
  });
  if (created.length !== plan.changes.length) {
    transactions = transactions.filter(transaction => !created.some(change => change.transactionId === String(transaction.id)));
    saveData();
    closeDuplicateMonthPreview();
    showToast('La duplication a été interrompue ; aucune opération n’a été conservée.', 'error');
    return;
  }
  saveData();
  const accountAfter = window._getAppState?.().accounts?.find(item => String(item.id) === String(pending.accountId));
  if (!accountAfter) {
    closeDuplicateMonthPreview();
    showToast('Impossible d’enregistrer le suivi de cette duplication.', 'error');
    return;
  }
  accountAfter.bulkUndo = {
    action: 'monthly-transaction-duplication', ownerUid: String(window.__freevUserId || 'device'), accountId: accountAfter.id,
    sourceMonth: pending.fromMonth, targetMonth: pending.toMonth, createdAt: new Date().toISOString(), changes: created
  };
  accountAfter.bulkUndo.revision = window.freevTransactionRevision(accountAfter);
  saveAccountSystem();
  closeDuplicateMonthPreview();
  syncAllUI();
  window.FreevV5?.render?.();
  showToast(`${created.length} opération(s) dupliquée(s). Annulation disponible pendant 30 minutes.`, 'success');
}

window.renderDuplicateMonthPreview = renderDuplicateMonthPreview;
window.closeDuplicateMonthPreview = closeDuplicateMonthPreview;
window.confirmDuplicateMonthPreview = confirmDuplicateMonthPreview;
window.prepareDuplicateMonthPreview = prepareDuplicateMonthPreview;
