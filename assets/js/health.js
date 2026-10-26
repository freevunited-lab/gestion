// ============================================================
// ===== CONTRÔLE DE SANTÉ DES DONNÉES =======================
// ============================================================

function auditDataHealth() {
  saveCurrentGlobalsToAccount();
  const issues = [];
  const transferLinks = new Map();
  let transactionCount = 0;
  let recurringCount = 0;

  accounts.forEach(account => {
    const rules = account.recurringTransactions || [];
    const ruleIds = new Set(rules.map(rule => String(rule.id || '')));
    const debtIds = new Set((account.debts || []).map(debt => String(debt.id || '')));
    const seenTransactionIds = new Set();
    const seenRuleIds = new Set();
    const seenDebtIds = new Set();
    const occurrenceKeys = new Set();

    rules.forEach(rule => {
      recurringCount += 1;
      if (!rule.id) issues.push({ code: 'rule_missing_id', severity: 'error', accountId: account.id, label: 'Récurrence sans identifiant' });
      else if (seenRuleIds.has(String(rule.id))) issues.push({ code: 'rule_duplicate_id', severity: 'error', accountId: account.id, label: `Identifiant de récurrence en double (${rule.id})` });
      seenRuleIds.add(String(rule.id || ''));
      if (!(Number(rule.amountBase ?? rule.amount) > 0)) issues.push({ code: 'rule_invalid_amount', severity: 'error', accountId: account.id, label: `Montant invalide pour « ${rule.desc || rule.category || 'Récurrence'} »` });
      if (!isValidISODate(rule.startDate)) issues.push({ code: 'rule_invalid_date', severity: 'error', accountId: account.id, label: `Date de début invalide pour « ${rule.desc || rule.category || 'Récurrence'} »` });
      if (!['monthly', 'weekly', 'yearly'].includes(rule.frequency || 'monthly')) issues.push({ code: 'rule_invalid_frequency', severity: 'warning', accountId: account.id, label: `Fréquence inconnue pour « ${rule.desc || rule.category || 'Récurrence'} »` });
    });

    (account.transactions || []).forEach(transaction => {
      transactionCount += 1;
      const id = String(transaction.id || '');
      if (!id || seenTransactionIds.has(id)) issues.push({ code: 'transaction_duplicate_id', severity: 'error', accountId: account.id, transactionId: id, label: id ? `Identifiant de transaction en double (${id})` : 'Transaction sans identifiant' });
      if (id) seenTransactionIds.add(id);
      if (!isValidISODate(transaction.date)) issues.push({ code: 'transaction_invalid_date', severity: 'error', accountId: account.id, transactionId: id, label: `Date invalide pour « ${transaction.desc || transaction.category || 'Transaction'} »` });
      if (!(Number(transaction.amountBase ?? transaction.amount) > 0)) issues.push({ code: 'transaction_invalid_amount', severity: 'error', accountId: account.id, transactionId: id, label: `Montant invalide pour « ${transaction.desc || transaction.category || 'Transaction'} »` });
      if (!['income', 'expense', 'transfer'].includes(transaction.type)) issues.push({ code: 'transaction_invalid_type', severity: 'error', accountId: account.id, transactionId: id, label: `Type invalide pour « ${transaction.desc || transaction.category || 'Transaction'} »` });

      if (transaction.parentId) {
        const parentRule = rules.find(rule => String(rule.id) === String(transaction.parentId));
        if (parentRule && transaction.periodKey && isValidISODate(transaction.date) &&
            transaction.periodKey !== periodKey(transaction.date, parentRule.frequency)) {
          issues.push({ code: 'recurring_period_mismatch', severity: 'error', accountId: account.id,
            transactionId: id, label: `Échéance hors de sa période d’origine : « ${transaction.desc || transaction.category} »` });
        }
        if (!ruleIds.has(String(transaction.parentId))) {
          issues.push({ code: 'orphan_occurrence', severity: 'warning', accountId: account.id, transactionId: id, label: `Occurrence sans règle : « ${transaction.desc || transaction.category} »` });
        }
        const key = `${transaction.parentId}|${transaction.periodKey || transaction.date}`;
        if (occurrenceKeys.has(key)) issues.push({ code: 'duplicate_occurrence', severity: 'error', accountId: account.id, transactionId: id, label: `Occurrence récurrente en double (${transaction.periodKey || transaction.date})` });
        occurrenceKeys.add(key);
      }

      if (transaction.linkedTransferId) {
        const key = String(transaction.linkedTransferId);
        if (!transferLinks.has(key)) transferLinks.set(key, []);
        transferLinks.get(key).push({ accountId: account.id, transaction });
      }

      if (transaction.linkedDebtId) {
        const targetAccount = transaction.linkedDebtAccountId
          ? accounts.find(item => String(item.id) === String(transaction.linkedDebtAccountId))
          : account;
        const targetDebtIds = new Set((targetAccount?.debts || []).map(debt => String(debt.id || '')));
        if (!targetAccount || !targetDebtIds.has(String(transaction.linkedDebtId))) {
          issues.push({ code: 'broken_debt_link', severity: 'warning', accountId: account.id, transactionId: id, label: `Dette liée introuvable pour « ${transaction.desc || transaction.category} »` });
        }
      }

      if (occurrenceHasSideEffects(transaction)) {
        const todayISO = isoDate(getToday());
        if (transaction.date > todayISO && transaction._effectsApplied === true) issues.push({ code: 'premature_effect', severity: 'error', accountId: account.id, transactionId: id, label: `Effet financier appliqué trop tôt : « ${transaction.desc || transaction.category} »` });
        if (transaction.date <= todayISO && transaction._effectsApplied === false) issues.push({ code: 'pending_due_effect', severity: 'error', accountId: account.id, transactionId: id, label: `Effet financier en attente : « ${transaction.desc || transaction.category} »` });
      }
    });

    (account.debts || []).forEach(debt => {
      const initial = Number(debt.initialAmount ?? debt.amount) || 0;
      const remaining = Number(debt.remainingAmount ?? debt.amount) || 0;
      if (!debt.id || initial <= 0 || remaining < 0 || remaining > initial) issues.push({ code: 'invalid_debt', severity: 'error', accountId: account.id, label: `Dette incohérente : « ${debt.person || 'Sans nom'} »` });
      if (debt.id && seenDebtIds.has(String(debt.id))) issues.push({ code: 'duplicate_debt_id', severity: 'error', accountId: account.id, label: `Identifiant de dette en double (${debt.id})` });
      seenDebtIds.add(String(debt.id || ''));
    });
  });

  transferLinks.forEach((entries, linkId) => {
    const roles = new Set(entries.map(entry => entry.transaction.linkedTransferRole || entry.transaction.type));
    if (entries.length !== 2 || roles.size < 2) {
      entries.forEach(entry => issues.push({ code: 'broken_transfer_link', severity: 'warning', accountId: entry.accountId, transactionId: entry.transaction.id, linkId, label: `Transfert entre comptes incomplet (${entries.length}/2 écriture)` }));
    }
  });

  return {
    checkedAt: new Date().toISOString(),
    accounts: accounts.length,
    transactions: transactionCount,
    recurring: recurringCount,
    issues,
    errors: issues.filter(issue => issue.severity === 'error').length,
    warnings: issues.filter(issue => issue.severity === 'warning').length
  };
}

function findAccountTransaction(accountId, transactionId) {
  const account = accounts.find(item => String(item.id) === String(accountId));
  const transaction = (account?.transactions || []).find(item => String(item.id || '') === String(transactionId || ''));
  return account && transaction ? { account, transaction } : null;
}

function adjustHealthSavings(account, target, delta) {
  account.savingsAccounts = account.savingsAccounts || {};
  const keys = Object.keys(account.savingsAccounts);
  const key = target || keys[0] || 'Livret A';
  const next = roundMoney((Number(account.savingsAccounts[key]) || 0) + (Number(delta) || 0));
  if (next === 0) delete account.savingsAccounts[key];
  else account.savingsAccounts[key] = next;
}

function adjustHealthDebt(transaction, delta) {
  if (!transaction.linkedDebtId) return;
  const source = transaction.linkedDebtAccountId
    ? accounts.find(account => String(account.id) === String(transaction.linkedDebtAccountId))
    : accounts.find(account => (account.debts || []).some(debt => String(debt.id) === String(transaction.linkedDebtId)));
  const debt = (source?.debts || []).find(item => String(item.id) === String(transaction.linkedDebtId));
  if (!debt) return;
  const initial = Number(debt.initialAmount ?? debt.amount) || 0;
  const debtDelta = Number(transaction.linkedDebtAmount ?? delta) || 0;
  debt.remainingAmount = roundMoney(Math.max(0, Math.min(initial, (Number(debt.remainingAmount ?? debt.amount) || 0) + (delta < 0 ? -debtDelta : debtDelta))));
}

function repairDataHealth() {
  const report = auditDataHealth();
  if (!report.issues.length) return showToast('Aucune anomalie à réparer', 'success');
  if (!confirm(`Réparer automatiquement ${report.issues.length} anomalie(s) ?\n\nUne sauvegarde locale complète sera créée avant la réparation.`)) return;
  manualAutoBackup();
  let repaired = 0;
  const brokenTransferIds = new Set(report.issues.filter(issue => issue.code === 'broken_transfer_link').map(issue => issue.linkId));

  accounts.forEach(account => {
    const seenIds = new Set();
    const rules = account.recurringTransactions || [];
    const ruleIds = new Set();
    rules.forEach(rule => {
      if (!rule.id || ruleIds.has(String(rule.id))) { rule.id = genId(); repaired += 1; }
      ruleIds.add(String(rule.id));
      const normalizedFrequency = normalizeRecurringFrequency(rule.frequency);
      if (rule.frequency !== normalizedFrequency) { rule.frequency = normalizedFrequency; repaired += 1; }
      const normalizedDay = Math.max(1, Math.min(31, Number(rule.dayOfMonth) || 1));
      if (rule.dayOfMonth !== normalizedDay) { rule.dayOfMonth = normalizedDay; repaired += 1; }
      if (!isValidISODate(rule.startDate)) { rule.startDate = isoDate(getToday()); repaired += 1; }
      if (!Array.isArray(rule.tags)) { rule.tags = []; repaired += 1; }
      normalizeSkippedPeriods(rule);
    });

    (account.transactions || []).forEach(transaction => {
      const id = String(transaction.id || '');
      if (!id || seenIds.has(id)) { transaction.id = genId(); repaired += 1; }
      seenIds.add(String(transaction.id));

      if (transaction.parentId && !ruleIds.has(String(transaction.parentId))) {
        transaction.parentId = '';
        transaction.periodKey = '';
        transaction.source = 'manual';
        transaction._manuallyEdited = true;
        repaired += 1;
      }

      if (transaction.linkedTransferId && brokenTransferIds.has(String(transaction.linkedTransferId))) {
        transaction.linkedTransferId = '';
        transaction.linkedAccountId = '';
        transaction.linkedTransferRole = '';
        transaction.linkedTransferRate = null;
        repaired += 1;
      }

      if (transaction.linkedDebtId) {
        const targetAccount = transaction.linkedDebtAccountId
          ? accounts.find(item => String(item.id) === String(transaction.linkedDebtAccountId))
          : account;
        const debtExists = (targetAccount?.debts || []).some(debt => String(debt.id) === String(transaction.linkedDebtId));
        if (!debtExists) {
          transaction.linkedDebtId = null;
          transaction.linkedDebtAccountId = '';
          repaired += 1;
        }
      }

      if (occurrenceHasSideEffects(transaction) && transaction._effectsApplied === true && transaction.date > isoDate(getToday())) {
        const amount = Number(transaction.amountBase ?? transaction.amount) || 0;
        if (transaction.type === 'transfer') adjustHealthSavings(account, transaction.transferTarget, -amount);
        if (transaction.fromSavings) adjustHealthSavings(account, transaction.transferTarget, amount);
        if (transaction.linkedDebtId) adjustHealthDebt(transaction, amount);
        transaction._effectsApplied = false;
        repaired += 1;
      } else if (occurrenceHasSideEffects(transaction) && transaction._effectsApplied === false && transaction.date <= isoDate(getToday())) {
        const amount = Number(transaction.amountBase ?? transaction.amount) || 0;
        if (transaction.type === 'transfer') adjustHealthSavings(account, transaction.transferTarget, amount);
        if (transaction.fromSavings) adjustHealthSavings(account, transaction.transferTarget, -amount);
        if (transaction.linkedDebtId) adjustHealthDebt(transaction, -amount);
        transaction._effectsApplied = true;
        repaired += 1;
      }
    });

    (account.debts || []).forEach(debt => {
      if (!debt.id) { debt.id = genId(); repaired += 1; }
      const initial = Math.max(0, Number(debt.initialAmount ?? debt.amount) || 0);
      const normalizedRemaining = roundMoney(Math.max(0, Math.min(initial, Number(debt.remainingAmount ?? debt.amount) || 0)));
      if (debt.initialAmount !== initial || debt.remainingAmount !== normalizedRemaining) {
        debt.initialAmount = initial;
        debt.amount = initial;
        debt.remainingAmount = normalizedRemaining;
        repaired += 1;
      }
    });
  });

  loadCurrentAccountIntoGlobals();
  dedupeRecurringOccurrences();
  saveData();
  syncAllUI(true);
  renderDataHealth();
  showToast(`${repaired} correction(s) appliquée(s)`, 'success');
}

function renderDataHealth() {
  const container = document.getElementById('dataHealthPanel');
  if (!container) return;
  const report = auditDataHealth();
  const healthy = report.issues.length === 0;
  const issueRows = report.issues.slice(0, 20).map(issue => `
    <div class="health-issue ${issue.severity}">
      <i class="fa-solid fa-${issue.severity === 'error' ? 'circle-xmark' : 'triangle-exclamation'}"></i>
      <span>${escapeHTML(issue.label)}</span>
      <small>${escapeHTML(accounts.find(account => String(account.id) === String(issue.accountId))?.name || 'Compte')}</small>
    </div>`).join('');

  container.innerHTML = `
    <div class="health-overview ${healthy ? 'healthy' : 'attention'}">
      <div class="health-score"><i class="fa-solid fa-${healthy ? 'shield-circle-check' : 'shield-halved'}"></i><strong>${healthy ? 'Données saines' : `${report.issues.length} anomalie(s)`}</strong><span>Contrôle effectué à ${new Date(report.checkedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span></div>
      <div class="health-metrics"><span><strong>${report.accounts}</strong> comptes</span><span><strong>${report.transactions}</strong> transactions</span><span><strong>${report.recurring}</strong> récurrences</span><span><strong>${report.errors}</strong> erreurs</span><span><strong>${report.warnings}</strong> alertes</span></div>
    </div>
    ${issueRows ? `<div class="health-issues">${issueRows}${report.issues.length > 20 ? `<div class="text-sm text-slate-500">+ ${report.issues.length - 20} autre(s) anomalie(s)</div>` : ''}</div>` : '<p class="text-sm text-slate-500">Aucun lien cassé, doublon ou effet financier en retard détecté.</p>'}
    <div class="health-actions"><button class="btn btn-secondary btn-sm" onclick="renderDataHealth()"><i class="fa-solid fa-rotate"></i> Analyser</button>${healthy ? '' : '<button class="btn btn-primary btn-sm" onclick="repairDataHealth()"><i class="fa-solid fa-screwdriver-wrench"></i> Réparer automatiquement</button>'}</div>`;
}
