// FREEV Gestion — Cockpit financier. Les calculs sont isolés dans finance-priority2-engine.mjs.
(() => {
  let engine = null;
  let lastBudgetSelection = '';
  const section = () => document.getElementById('financePriority2');
  const el = (tag, name, text) => {
    const node = document.createElement(tag);
    if (name) node.className = name;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const euro = value => formatCurrency(Number(value) || 0, settings?.baseCurrency || 'EUR');
  function metric(root, label, value, detail, tone = '') {
    const node = el('div', `fp2-metric ${tone}`);
    node.append(el('span', 'fp2-metric-label', label), el('strong', 'fp2-metric-value', value), el('small', 'fp2-metric-detail', detail));
    root.append(node);
  }
  const monthName = month => new Date(`${month}-01T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  function showRows(id, rows, emptyMessage) {
    const target = document.getElementById(id);
    if (!target) return;
    target.replaceChildren(...rows);
    if (!rows.length) target.append(el('p', 'fp2-empty', emptyMessage));
  }
  function row(title, detail, value, tone) {
    const container = el('div', 'fp2-row');
    const body = el('div', 'fp2-row-body');
    body.append(el('strong', '', title), el('small', '', detail));
    container.append(body, el('strong', `fp2-amount ${tone || ''}`, value));
    return container;
  }
  function visibleAccounts() {
    // Synchroniser le compte affiché vers le modèle (sans écriture réseau).
    saveCurrentGlobalsToAccount();
    return getViewAccounts();
  }
  function financeDataRevision(accounts) {
    return JSON.stringify(accounts.map((account, index) => ({
      id: account?.id ?? `account-${index}`,
      transactions: window.freevTransactionRevision?.(account) || JSON.stringify(account?.transactions || []),
      initialCapital: account?.initialCapital,
      recurringTransactions: account?.recurringTransactions || [],
      budgetsByCategory: account?.budgetsByCategory || {},
      currency: account?.settings?.baseCurrency || 'EUR'
    })));
  }
  function refreshCategories() {
    const select = document.getElementById('fp2BudgetCategory');
    if (!select) return;
    const previous = select.value;
    const list = new Set(getAllCategories().map(entry => entry.name));
    const current = getCurrentAccount();
    Object.keys(current?.budgetsByCategory || {}).forEach(category => list.add(category));
    (current?.transactions || []).forEach(tx => { if (tx?.category) list.add(tx.category); });
    select.replaceChildren(...[...list].filter(Boolean).sort((a,b)=>a.localeCompare(b,'fr')).map(category => {
      const opt = el('option', '', category);
      opt.value = category;
      return opt;
    }));
    if (previous && list.has(previous)) select.value = previous;
  }
  function refreshSelectedBudget() {
    const category = document.getElementById('fp2BudgetCategory')?.value;
    const field = document.getElementById('fp2BudgetAmount');
    if (!field) return;
    const value = getCurrentAccount()?.budgetsByCategory?.[category];
    field.value = Number(value) > 0 ? String(Number(value)) : '';
  }
  function saveBudget(event) {
    event.preventDefault();
    if (multiViewMode !== 'individual') return showToast('Sélectionnez un compte pour modifier ses budgets.', 'info');
    const category = document.getElementById('fp2BudgetCategory')?.value;
    const value = document.getElementById('fp2BudgetAmount')?.value;
    if (!category || !/^\d+(?:[.,]\d{1,2})?$/.test(String(value || '')) || Number(value.replace(',', '.')) > 1e9)
      return showToast('Budget invalide : saisissez un montant positif avec deux décimales maximum.', 'error');
    const amount = Math.round(Number(value.replace(',', '.')) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 0) return showToast('Budget invalide.', 'error');
    if (!budgetsByCategory || typeof budgetsByCategory !== 'object') budgetsByCategory = {};
    if (amount === 0) delete budgetsByCategory[category];
    else budgetsByCategory[category] = amount;
    saveData();
    syncAllUI(true);
    showToast(amount ? 'Budget de catégorie mis à jour' : 'Budget de catégorie supprimé', 'success');
  }
  function render() {
    if (!engine || !section() || !window.__freevBooted) return;
    try {
      const month = document.getElementById('globalMonthPicker')?.value || isoMonth(getToday());
      const today = isoDate(getToday());
      const accounts = visibleAccounts();
      const model = engine.financeOverview(accounts, { month, today, months: 3, dataRevision: financeDataRevision(accounts) });
      const selectedIsCurrent = month === today.slice(0,7);
      const kpis = document.getElementById('fp2Metrics');
      if (kpis) {
        kpis.replaceChildren();
        metric(kpis, 'Solde comptabilisé aujourd’hui', euro(model.startingBalance), 'Opérations payées, hors échéances futures', model.startingBalance < 0 ? 'fp2-danger' : '');
        metric(kpis, 'Fin de mois prévue', euro(model.forecasts[0].balance), 'Estimation, sans garantie', model.forecasts[0].balance < 0 ? 'fp2-danger' : '');
        const pointBas = Math.min(...model.forecasts.map(item => item.lowestBalance));
        metric(kpis, 'Point bas prévisionnel', euro(pointBas), 'Sur les 3 prochains mois · dates estimées', pointBas < 0 ? 'fp2-danger' : '');
        metric(kpis, 'Dépenses enregistrées', euro(model.current.expenses), `Mois sélectionné · ${model.current.paidCount} opération(s)`);
        metric(kpis, 'Opérations non comptabilisées', String(model.current.plannedCount), 'Prévues ou datées dans le futur');
      }
      const forecast = model.forecasts.map(data => {
        const riskNote = data.negativeDailyCloseDate
          ? ` · Solde journalier négatif possible dès le ${data.negativeDailyCloseDate}`
          : data.lowestBalanceMinor < 0 ? ' · Creux intra-journalier possible' : '';
        return row(monthName(data.month),
          `Revenus attendus ${euro(data.income)} · Dépenses attendues ${euro(data.expenses)} · Point bas ${euro(data.lowestBalance)}${riskNote}`,
          euro(data.balance), data.balance < 0 || data.negativeDailyCloseDate ? 'fp2-danger' : '');
      });
      showRows('fp2Forecast', forecast, 'Aucune prévision disponible.');
      const difference = Math.round((model.current.expenses - model.previous.expenses) * 100) / 100;
      const comparison = [
        row('Revenus', `${monthName(month)} / mois précédent`, `${euro(model.current.income)} / ${euro(model.previous.income)}`),
        row('Dépenses', `${monthName(month)} / mois précédent`, `${euro(model.current.expenses)} / ${euro(model.previous.expenses)}`),
        row('Écart de dépenses', 'Positif = hausse par rapport au mois précédent', `${difference >= 0 ? '+' : '−'} ${euro(Math.abs(difference))}`, difference > 0 ? 'fp2-danger' : ''),
        row('Résultat net', 'Revenus − dépenses − transferts', `${euro(model.current.net)} / ${euro(model.previous.net)}`)
      ];
      showRows('fp2Comparison', comparison, 'Comparaison indisponible.');
      const compareNote = document.getElementById('fp2ComparisonNote');
      if (compareNote) compareNote.textContent = selectedIsCurrent
        ? 'Le mois en cours est incomplet : comparaison informative, pas une tendance définitive.'
        : month > today.slice(0,7) ? 'Mois futur : les opérations prévues ne sont pas incluses parmi les montants réellement payés.'
        : 'Les dépenses et revenus ne comprennent que les opérations comptabilisées.';
      showRows('fp2Alerts', model.alerts.map(alert => {
        const item = el('p', `fp2-alert fp2-${alert.level}`, alert.text);
        item.setAttribute('role','status');
        return item;
      }), 'Aucune alerte détectée avec les données disponibles.');
      showRows('fp2Budgets', model.budgets.map(budget => {
        const card = row(`${budget.category} · ${budget.accountName}`, `${euro(budget.spent)} sur ${euro(budget.limit)} · reste ${euro(budget.remaining)}`,
          `${budget.percent}%`, budget.level === 'danger' ? 'fp2-danger' : budget.level === 'warning' ? 'fp2-warning' : '');
        const bar = el('div','fp2-progress');
        const fill = el('div',`fp2-fill fp2-${budget.level}`);
        fill.style.width = `${Math.min(100, Math.max(0,budget.percent))}%`;
        bar.append(fill);
        card.append(bar);
        return card;
      }), 'Aucun budget de catégorie défini.');
      const upcoming = model.forecasts[0].items.slice(0, 8).map(item => {
        const card = row(item.desc, `${item.scheduledDate} · ${item.source === 'recurring' ? 'Récurrence prévue' : item.source === 'planned' ? 'À confirmer' : 'Transaction datée à venir'}`,
          `${item.type === 'income' ? '+' : '−'} ${euro(item.amount)}`);
        if (item.source === 'planned' && multiViewMode === 'individual') {
          const button = el('button', 'btn btn-sm btn-secondary', 'Marquer payée');
          button.type = 'button';
          button.addEventListener('click', () => markPlannedTransactionPaid(item.id));
          card.append(button);
        }
        return card;
      });
      showRows('fp2Upcoming', upcoming, 'Aucune échéance à venir sur le mois.');
      refreshCategories();
      const budgetSelection = `${currentAccountId}|${document.getElementById('fp2BudgetCategory')?.value || ''}`;
      if (budgetSelection !== lastBudgetSelection) { lastBudgetSelection = budgetSelection; refreshSelectedBudget(); }
      const editGroup = document.getElementById('fp2BudgetForm');
      if (editGroup) editGroup.hidden = multiViewMode !== 'individual';
    } catch (error) {
      console.error('[FREEV] Erreur cockpit financier :', error);
      const detail = error?.code && error?.field
        ? `Calcul suspendu : ${error.message} · ${error.field}. Corrigez cette donnée puis réessayez.`
        : 'Les prévisions sont momentanément indisponibles. Aucune transaction n’a été modifiée.';
      document.getElementById('fp2Alerts')?.replaceChildren(el('p','fp2-alert fp2-danger',detail));
    }
  }
  window.renderFinancePriority2 = render;
  document.getElementById('fp2BudgetForm')?.addEventListener('submit', saveBudget);
  document.getElementById('fp2BudgetCategory')?.addEventListener('change', () => {
    lastBudgetSelection = `${currentAccountId}|${document.getElementById('fp2BudgetCategory')?.value || ''}`;
    refreshSelectedBudget();
  });
  import('./finance-priority2-engine.mjs').then(module => {
    engine = module;
    render();
    refreshSelectedBudget();
  }).catch(error => {
    console.error('[FREEV] Module de prévisions introuvable', error);
    document.getElementById('fp2Alerts')?.replaceChildren(el('p','fp2-alert fp2-danger','Module de prévisions non chargé. Vérifiez les fichiers de l’application.'));
  });
  window.addEventListener('freev:ready', render);
})();
