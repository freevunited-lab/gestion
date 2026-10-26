// ---------- Transferts épargne : application/rétroaction ----------
let analyticsRangeMonths = [6, 12, 24].includes(Number(localStorage.getItem('freevAnalyticsRange')))
  ? Number(localStorage.getItem('freevAnalyticsRange'))
  : 12;
let dashboardChartMode = ['cashflow', 'balance'].includes(localStorage.getItem('freevDashboardChartMode'))
  ? localStorage.getItem('freevDashboardChartMode')
  : 'cashflow';
let dashboardChartRange = [6, 12].includes(Number(localStorage.getItem('freevDashboardChartRange')))
  ? Number(localStorage.getItem('freevDashboardChartRange'))
  : 12;
let dashboardChartForecast = localStorage.getItem('freevDashboardChartForecast') !== '0';

let chartLibraryPromise = null;
let chartLibraryConfigured = false;
let dashboardChartResizeObserver = null;
let dashboardChartResizeTimer = null;
const dashboardValueAnimations = new WeakMap();

// Le tableau de bord classique reçoit le même grand livre que le cockpit et le planificateur.
Promise.all([import('./freev-ledger-bridge.mjs'), import('./freev-account-core.mjs')]).then(([bridge, core]) => {
  window.FreevForecastBridge = bridge;
  window.FreevAccountCore = core;
  if (typeof syncAllUI === 'function') syncAllUI();
}).catch(error => console.warn('[Freev] Moteur financier partagé indisponible :', error));

function ensureChartsReady() {
  if (!chartLibraryPromise) chartLibraryPromise = ensureChartJS().then(() => {
    if (!chartLibraryConfigured) {
      setChartDefaults();
      try { Chart.register(donutCenterTextPlugin); } catch (_) {}
      chartLibraryConfigured = true;
    }
    return window.Chart;
  }).catch(error => {
    chartLibraryPromise = null;
    console.warn('[Freev] Graphiques indisponibles :', error);
    throw error;
  });
  return chartLibraryPromise;
}

function showDashboardChartsUnavailable() {
  const message = 'Les graphiques ne se chargent pas. Actualisez la page pour réessayer ; vos opérations restent disponibles.';
  drawEmptyOnCanvas(document.getElementById('trendChart'), 'Graphique indisponible');
  drawEmptyOnCanvas(document.getElementById('categoryChart'), 'Graphique indisponible');
  ['trendChartSummary', 'categoryChartSummary'].forEach(id => {
    const summary = document.getElementById(id);
    if (summary) summary.textContent = message;
  });
}

function renderDashboardCharts() {
  if (!window.Chart) {
    ensureChartsReady().then(() => {
      if (currentView === 'dashboard') renderDashboardCharts();
    }).catch(showDashboardChartsUnavailable);
    return;
  }
  syncDashboardChartControls();
  renderTrendChart();
  renderCategoryChart();
  setupDashboardChartResizeObserver();
}

function setupDashboardChartResizeObserver() {
  if (dashboardChartResizeObserver || !window.ResizeObserver) return;
  dashboardChartResizeObserver = new ResizeObserver(() => {
    clearTimeout(dashboardChartResizeTimer);
    dashboardChartResizeTimer = setTimeout(() => {
      charts.trend?.resize?.();
      charts.category?.resize?.();
    }, 80);
  });
  document.querySelectorAll('#dashboard-view .chart-container').forEach(container => dashboardChartResizeObserver.observe(container));
}

function syncDashboardChartControls() {
  document.querySelectorAll('[data-dashboard-mode]').forEach(button => {
    const active = button.dataset.dashboardMode === dashboardChartMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  document.querySelectorAll('[data-dashboard-range]').forEach(button => {
    const active = Number(button.dataset.dashboardRange) === dashboardChartRange;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const toggle = document.getElementById('dashboardForecastToggle');
  if (toggle) toggle.checked = dashboardChartForecast;
}

function setDashboardChartMode(mode) {
  dashboardChartMode = mode === 'balance' ? 'balance' : 'cashflow';
  localStorage.setItem('freevDashboardChartMode', dashboardChartMode);
  renderDashboardCharts();
}

function setDashboardChartRange(months) {
  dashboardChartRange = Number(months) === 6 ? 6 : 12;
  localStorage.setItem('freevDashboardChartRange', String(dashboardChartRange));
  renderDashboardCharts();
}

function setDashboardChartForecast(enabled) {
  dashboardChartForecast = Boolean(enabled);
  localStorage.setItem('freevDashboardChartForecast', dashboardChartForecast ? '1' : '0');
  renderDashboardCharts();
}

function downloadDashboardChart(canvasId, baseName) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || canvas.classList.contains('hidden')) return showToast('Aucun graphique à télécharger', 'info');
  const link = document.createElement('a');
  const month = document.getElementById('globalMonthPicker')?.value || isoMonth();
  link.download = `${baseName}-${month}.png`;
  link.href = canvas.toDataURL('image/png', 1);
  link.click();
  showToast('Graphique téléchargé en PNG', 'success');
}

function getDashboardChartTransactions(month) {
  const monthTransactions = getMonthTransactions(month);
  const today = isoDate(getToday());
  const actual = monthTransactions.filter(t => t.paymentStatus !== 'planned' &&
    (dashboardChartForecast || t.date <= today));
  if (!dashboardChartForecast) return actual;
  const planned = month >= isoMonth(getToday())
    ? monthTransactions.filter(t => t.paymentStatus === 'planned').map(t => ({ ...t, paymentStatus: 'paid', projected: true }))
    : [];
  return actual.concat(planned, getProjectedRecurringTransactions(month, actual));
}

function getDashboardProjectedBalance(month) {
  const firstDataMonth = getViewAccounts()
    .flatMap(account => (account.transactions || [])
      .filter(transaction => !transaction.isRecurring && transaction.date)
      .map(transaction => String(transaction.date).slice(0, 7)))
    .sort()[0];
  // Ne jamais transformer une absence d’historique en solde nul : cela créait
  // une hausse ou une chute artificielle dans la courbe.
  if (firstDataMonth && month < firstDataMonth) return null;
  if (!dashboardChartForecast || month < isoMonth(getToday())) {
    const balance = computeBalance(month);
    return Number.isFinite(balance) ? balance : null;
  }
  const summary = getDashboardMonthSummary(month, { includeCurrentForecast: true });
  return Number.isFinite(summary.balance) ? summary.balance : null;
}

function getAnalyticsMonthWindow(baseMonth, count = analyticsRangeMonths) {
  const base = new Date(`${baseMonth}-01T12:00:00`);
  return Array.from({ length: count }, (_, index) => {
    const d = new Date(base);
    d.setMonth(d.getMonth() - (count - 1 - index));
    return {
      date: d,
      iso: isoMonth(d),
      label: d.toLocaleDateString('fr-FR', { month: 'short', year: count > 12 ? '2-digit' : 'numeric' })
    };
  });
}

function setAnalyticsRange(months) {
  const next = [6, 12, 24].includes(Number(months)) ? Number(months) : 12;
  analyticsRangeMonths = next;
  localStorage.setItem('freevAnalyticsRange', String(next));
  document.querySelectorAll('.analytics-range button').forEach(button => {
    const active = Number(button.dataset.months) === next;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  renderAnalytics();
}

// Retourne le premier livret d'épargne existant, ou 'Livret A' en dernier recours
function defaultSavingsTarget() {
  const keys = Object.keys(savingsAccounts || {});
  return keys.length > 0 ? keys[0] : 'Livret A';
}

function applyTransferToSavings(target, amountDelta) {
  const key = target || defaultSavingsTarget();
  const delta = Number(amountDelta) || 0;
  if (!delta) return;
  const prev = Number(savingsAccounts[key]) || 0;
  const rawNext = prev + delta;

  // ✅ FIX : on conserve les soldes négatifs (erreur de saisie possible) au lieu de
  // supprimer silencieusement le livret. Un solde à 0 exact supprime le livret,
  // mais un solde négatif issu d'un undo est conservé pour garder la traçabilité.
  if (rawNext === 0) {
    delete savingsAccounts[key];
  } else {
    // Math.max(0) supprimé : on autorise les négatifs transitoires (undo, corrections)
    savingsAccounts[key] = roundMoney(rawNext);
  }
}

function revertTransferEffect(tx) {
  if (!tx || tx.type !== 'transfer') return;
  const amt = Number(tx.amountBase ?? tx.amount) || 0;
  applyTransferToSavings(tx.transferTarget || defaultSavingsTarget(), -amt);
}

function applyTransferEffect(tx) {
  if (!tx || tx.type !== 'transfer') return;
  const amt = Number(tx.amountBase ?? tx.amount) || 0;
  applyTransferToSavings(tx.transferTarget || defaultSavingsTarget(), amt);
}

// ---------- Dashboard Alerts ----------
function updateDashboardAlerts(selectedMonth, currentMonth) {
  const container = document.getElementById('dashboardAlerts');
  if (!container) return;
  
  const alerts = [];
  
  // 1️⃣ Alerte mois incomplet
  if (selectedMonth === currentMonth) {
    const todayDate = new Date(getToday());
    const dayOfMonth = todayDate.getDate();
    const lastDayOfMonth = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0).getDate();
    
    alerts.push(`
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-3">
        <i class="fa-solid fa-info-circle text-blue-600 mt-0.5"></i>
        <div class="text-sm text-blue-800">
          <strong>Mois en cours :</strong> Les statistiques sont incomplètes (jour ${dayOfMonth}/${lastDayOfMonth}). 
          Les récurrentes programmées pour plus tard ce mois ne sont pas encore comptabilisées.
        </div>
      </div>
    `);
  }
  
  // 2️⃣ Récurrentes futures ce mois
  if (selectedMonth === currentMonth) {
    const todayStr = isoDate(getToday());
    const upcomingTransactions = getProjectedRecurringTransactions(selectedMonth)
      .filter(transaction => transaction.date > todayStr);
    const upcomingCount = upcomingTransactions.length;
    
    if (upcomingCount > 0) {
      const totalAmount = upcomingTransactions
        .reduce((sum, transaction) => {
          const amount = Number(transaction.amountBase ?? transaction.amount) || 0;
          if (transaction.type === 'expense' || transaction.type === 'transfer') return sum + amount;
          if (transaction.type === 'income') return sum - amount;
          return sum;
        }, 0);
      
      // Impact net : positif = coût, négatif = gain
      let impactStr;
      if (totalAmount > 0) {
        impactStr = `Impact prévu : <strong style="color:#ef4444;">-${formatCurrency(totalAmount)}</strong>`;
      } else if (totalAmount < 0) {
        impactStr = `Impact prévu : <strong style="color:#10b981;">+${formatCurrency(Math.abs(totalAmount))}</strong>`;
      } else {
        impactStr = `Impact prévu : neutre`;
      }
      
      alerts.push(`
        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-3">
          <i class="fa-solid fa-clock text-yellow-600 mt-0.5"></i>
          <div class="text-sm text-yellow-800">
            <strong>${upcomingCount} transaction(s) récurrente(s) programmée(s)</strong> pour ce mois. ${impactStr}
          </div>
        </div>
      `);
    }
  }
  
  // Sauvegarde temporairement locale uniquement lorsque le cloud est réellement hors ligne.
  // L'ancien message s'affichait même avec le badge Firebase « Synchronisé ».
  if (window.__freevCloudState === 'offline') {
    alerts.push(`
      <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-3">
        <i class="fa-solid fa-cloud-arrow-up text-yellow-600 mt-0.5"></i>
        <div class="text-sm text-yellow-800">
          <strong>Synchronisation suspendue :</strong> vos changements restent protégés sur cet appareil et seront envoyés à Firebase dès le retour de la connexion.
        </div>
      </div>
    `);
  }

  // 🆕 Dettes arrivant à échéance dans les 7 prochains jours
  if (selectedMonth === currentMonth) {
    try {
      const upcomingDebts = getUpcomingDebts(7);
      upcomingDebts.forEach(d => {
        const remaining = Number(d.remainingAmount ?? d.amount) || 0;
        const label = d.direction === 'they_owe_me' ? `${d.person} vous doit` : `Vous devez à ${d.person}`;
        alerts.push(`
          <div class="bg-rose-50 border border-rose-200 rounded-lg p-3 flex items-start gap-3">
            <i class="fa-solid fa-calendar-xmark text-rose-600 mt-0.5"></i>
            <div class="text-sm text-rose-800">
              <strong>Échéance dette :</strong> ${escapeHTML(label)} <strong>${formatCurrency(remaining)}</strong> — 
              date limite : <strong>${new Date(d.endDate + 'T12:00:00').toLocaleDateString('fr-FR')}</strong>
              ${d.note ? ` · <em>${escapeHTML(d.note)}</em>` : ''}
            </div>
          </div>
        `);
      });
    } catch(e) {}
  }

  // 🆕 Récurrentes à venir dans les 5 prochains jours
  if (selectedMonth === currentMonth) {
    try {
      const upcoming = getUpcomingRecurrings(5);
      if (upcoming.length > 0) {
        const items = upcoming.map(r => {
          const sign = r.type === 'income' ? '+' : '-';
          const color = r.type === 'income' ? '#059669' : '#dc2626';
          return `<strong>${escapeHTML(r.desc || r.category)}</strong> <span style="color:${color};">${sign}${formatCurrency(r.amount)}</span> le ${new Date(r.nextDate + 'T12:00:00').toLocaleDateString('fr-FR')}`;
        }).join(' · ');
        alerts.push(`
          <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-3">
            <i class="fa-solid fa-bell text-yellow-600 mt-0.5"></i>
            <div class="text-sm text-yellow-800">
              <strong>${upcoming.length} récurrente(s) dans les 5 prochains jours :</strong> ${items}
            </div>
          </div>
        `);
      }
    } catch(e) {}
  }
  
  container.innerHTML = alerts.join('');
  // Animate alerts one by one
  container.querySelectorAll(':scope > div').forEach((el, i) => {
    el.classList.add('alert-animate');
    el.style.animationDelay = (i * 80) + 'ms';
  });
}

// ---------- Dashboard ----------
function dashboardWelcomeGuideKey() {
  return `freev.dashboard.welcome.dismissed:${String(currentAccountId || 'default')}`;
}

function updateDashboardWelcomeGuide() {
  const guide = document.getElementById('dashboardWelcomeGuide');
  if (!guide) return;

  const visibleAccounts = multiViewMode === 'individual'
    ? [{ transactions }]
    : getViewAccounts();
  const hasRecordedOperation = visibleAccounts.some(account =>
    (account.transactions || []).some(operation => !operation.isRecurring && !operation.parentId)
  );
  let dismissed = false;
  try { dismissed = localStorage.getItem(dashboardWelcomeGuideKey()) === '1'; }
  catch { /* La préférence peut être indisponible sans bloquer l’application. */ }
  guide.hidden = hasRecordedOperation || dismissed;
}

function dismissDashboardWelcomeGuide() {
  try { localStorage.setItem(dashboardWelcomeGuideKey(), '1'); }
  catch { /* Le guide reste masqué jusqu’au prochain chargement. */ }
  const guide = document.getElementById('dashboardWelcomeGuide');
  if (guide) guide.hidden = true;
}

const DASHBOARD_FORECAST_MAX_MONTHS = 36;

function addDashboardMoney(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  const currency = getActiveFinanceCurrency();
  if (!currency.ok) return NaN;
  const scale = 10 ** FREEVMoney.minorDigits(currency.currency);
  const first = Math.round(a * scale);
  const second = Math.round(b * scale);
  const total = first + second;
  return Number.isSafeInteger(first) && Number.isSafeInteger(second) && Number.isSafeInteger(total)
    ? total / scale : NaN;
}

function dashboardBalanceFromLedger(bookedBalance, forecastEntries, throughDate) {
  const bridge = typeof window !== 'undefined' ? window.FreevForecastBridge : null;
  if (!bridge) {
    const totals = financeTotalsAsAmounts(forecastEntries, { cutoffDate: throughDate });
    return totals.ok ? addDashboardMoney(bookedBalance, totals.net) : NaN;
  }
  const currency = getActiveFinanceCurrency();
  if (!currency.ok) return NaN;
  const scale = 10 ** FREEVMoney.minorDigits(currency.currency);
  const opening = FREEVMoney.parseStoredAmount(bookedBalance, currency.currency, 'bookedBalance');
  if (!opening.ok) return NaN;
  const todayISO = isoDate(getToday());
  const entries = forecastEntries.map((transaction, index) => {
    const parsed = FREEVMoney.parseTransactionBaseMinor(transaction, currency.currency);
    if (!parsed.ok) throw new RangeError(`Montant prévisionnel invalide : ${transaction.id ?? index}`);
    return { id: String(transaction.id ?? index), date: transaction.date < todayISO ? todayISO : transaction.date,
      amountMinor: parsed.minor, type: transaction.type === 'income' ? 'income' : 'expense' };
  });
  return bridge.calculateForecastLedger(entries, { openingDate: todayISO, throughDate,
    openingBalanceMinor: opening.minor }).closingBalanceMinor / scale;
}

// Les mois clos et le mois courant montrent le réalisé. Un mois futur inclut
// les échéances connues sans créer de transaction ni modifier le solde réel.
function getDashboardMonthSummary(month, { includeCurrentForecast = false } = {}) {
  const currentMonth = isoMonth(getToday());
  if (month < currentMonth || (month === currentMonth && !includeCurrentForecast)) {
    return { ...getMonthCashNet(month), balance: computeBalance(month), isForecast: false, plannedCount: 0 };
  }

  const unavailable = { income: NaN, expenses: NaN, transfers: NaN, net: NaN,
    balance: NaN, isForecast: true, plannedCount: 0 };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) return unavailable;
  const [year, monthNumber] = month.split('-').map(Number);
  const [currentYear, currentMonthNumber] = currentMonth.split('-').map(Number);
  const monthsAhead = (year - currentYear) * 12 + monthNumber - currentMonthNumber;
  const monthEnd = isoDate(new Date(year, monthNumber, 0));
  const monthTransactions = getMonthTransactions(month);
  const actualTotals = financeTotalsAsAmounts(monthTransactions, { fromDate: `${month}-01`, toDate: monthEnd });
  const bookedBalance = computeBalance(month);
  if (!actualTotals.ok || !Number.isFinite(bookedBalance)) return unavailable;

  // Un horizon très lointain reste lisible, mais ne reçoit pas une fausse prévision.
  if (monthsAhead >= DASHBOARD_FORECAST_MAX_MONTHS) {
    return { ...actualTotals, balance: bookedBalance, isForecast: false,
      forecastLimitReached: true, plannedCount: 0 };
  }

  try {
    const source = multiViewMode === 'individual' ? transactions : getDisplayTransactions();
    const planned = source.filter(t => t && !t.isRecurring && t.paymentStatus === 'planned' &&
      isValidISODate(t.date) && t.date <= monthEnd)
      .map(t => ({ ...t, paymentStatus: 'paid', projected: true }));
    if (source.some(t => t && !t.isRecurring && t.paymentStatus === 'planned' && !isValidISODate(t.date)))
      return unavailable;

    const projected = [];
    const selectedProjected = [];
    for (let step = 0; step <= monthsAhead; step++) {
      const key = isoMonth(new Date(currentYear, currentMonthNumber - 1 + step, 1));
      const occurrences = getProjectedRecurringTransactions(key);
      projected.push(...occurrences);
      if (key === month) selectedProjected.push(...occurrences);
    }
    const selectedPlanned = planned.filter(t => t.date.startsWith(month));
    // Le solde comptabilisé du mois courant s'arrête aujourd'hui ; le graphique
    // prévisionnel doit aussi ajouter les opérations déjà datées plus tard.
    const futureDated = month === currentMonth && includeCurrentForecast
      ? source.filter(t => t && !t.isRecurring && t.paymentStatus !== 'planned' &&
        t.date > isoDate(getToday()) && t.date <= monthEnd)
      : [];
    const forecastTotals = financeTotalsAsAmounts(planned.concat(projected, futureDated),
      { cutoffDate: monthEnd });
    const monthTotals = financeTotalsAsAmounts(monthTransactions.concat(selectedPlanned, selectedProjected),
      { fromDate: `${month}-01`, toDate: monthEnd });
    if (!forecastTotals.ok || !monthTotals.ok) return unavailable;
    return { ...monthTotals,
      balance: dashboardBalanceFromLedger(bookedBalance, planned.concat(projected, futureDated), monthEnd),
      isForecast: true,
      plannedCount: selectedPlanned.length + selectedProjected.length };
  } catch (error) {
    console.warn('[FREEV] Prévision du tableau de bord indisponible :', error);
    return unavailable;
  }
}

function updateDashboard() {
  updateDashboardWelcomeGuide();
  const month = document.getElementById('globalMonthPicker')?.value || isoMonth();
  const { income, expenses, transfers, net, balance, isForecast, plannedCount,
    forecastLimitReached } = getDashboardMonthSummary(month);
  const totalSavings = computeSavingsTotal(month);

  const currentMonth = isoMonth(getToday());
  const monthName = new Date(`${month}-01T12:00:00`).toLocaleDateString('fr-FR',
    { month: 'long', year: 'numeric' });
  const balanceLabel = document.getElementById('balanceLabel');
  if (balanceLabel) {
    // Préfixe du compte ou du mode
    let prefix = '';
    if (multiViewMode === 'global') prefix = 'Tous les comptes — ';
    else if (multiViewMode === 'group') {
      const names = getViewAccounts().map(a => a.name).join(', ');
      prefix = names + ' — ';
    } else {
      const acc = getCurrentAccount();
      if (acc && accounts.length > 1) prefix = acc.name + ' — ';
    }

    if (month === currentMonth) {
      balanceLabel.textContent = prefix + 'Solde actuel';
      balanceLabel.style.color = '#64748b';
    } else if (month > currentMonth) {
      balanceLabel.textContent = prefix + (forecastLimitReached
        ? `Solde des opérations saisies · fin ${monthName}`
        : `Solde estimé · fin ${monthName}`);
      balanceLabel.style.color = '#3b82f6';
    } else {
      balanceLabel.textContent = prefix + 'Solde (fin ' + month + ')';
      balanceLabel.style.color = '#64748b';
    }
  }
  const incomeLabel = document.getElementById('dashboardIncomeLabel');
  const expenseLabel = document.getElementById('dashboardExpenseLabel');
  const savingsLabel = document.getElementById('dashboardSavingsLabel');
  if (incomeLabel) incomeLabel.textContent = month > currentMonth
    ? (isForecast ? 'Revenus attendus ce mois' : 'Revenus déjà saisis') : 'Revenus du mois';
  if (expenseLabel) expenseLabel.textContent = month > currentMonth
    ? (isForecast ? 'Dépenses attendues ce mois' : 'Dépenses déjà saisies') : 'Dépenses du mois';
  if (savingsLabel) savingsLabel.textContent = month > currentMonth
    ? 'Épargne connue à ce jour' : month < currentMonth ? 'Épargne fin de mois' : 'Épargne totale';

  // Un seul compte à rebours par carte : un changement rapide de mois ne doit
  // jamais laisser une ancienne animation réécrire la nouvelle valeur.
  function animateValue(el, targetValue, currency, duration = 700) {
    if (!el) return;
    const previous = dashboardValueAnimations.get(el);
    if (previous?.frame) cancelAnimationFrame(previous.frame);
    if (!Number.isFinite(Number(targetValue))) {
      el.textContent = 'À vérifier';
      dashboardValueAnimations.set(el, { frame: 0, value: NaN });
      return;
    }
    const target = Number(targetValue);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      el.textContent = formatCurrency(target, currency);
      dashboardValueAnimations.set(el, { frame: 0, value: target });
      return;
    }
    const startValue = Number.isFinite(previous?.value) ? previous.value : 0;
    const start = performance.now();
    const animation = { frame: 0, value: startValue };
    dashboardValueAnimations.set(el, animation);
    const tick = now => {
      if (dashboardValueAnimations.get(el) !== animation) return;
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      animation.value = startValue + (target - startValue) * ease;
      el.textContent = formatCurrency(animation.value, currency);
      if (progress < 1) animation.frame = requestAnimationFrame(tick);
      else { animation.frame = 0; animation.value = target; el.textContent = formatCurrency(target, currency); }
    };
    animation.frame = requestAnimationFrame(tick);
  }
  const cur = settings?.baseCurrency;
  animateValue(document.getElementById('cardBalance'), balance, cur);
  animateValue(document.getElementById('totalIncome'), income, cur);
  animateValue(document.getElementById('totalExpenses'), expenses, cur);
  animateValue(document.getElementById('totalSavings'), totalSavings, cur);

  // Petit texte sous le solde : résultat cash du mois + comparaison mois précédent
  const bc = document.getElementById('balanceChange');
  if (bc) {
    if (![balance, income, expenses, transfers, net].every(Number.isFinite)) {
      bc.textContent = 'Calcul incomplet : vérifiez les montants, dates et devises des comptes sélectionnés.';
    } else if (month > currentMonth) {
      if (forecastLimitReached) {
        bc.textContent = 'Prévision limitée à 36 mois : seules les opérations déjà saisies sont incluses.';
      } else {
        const sign = net >= 0 ? '+' : '−';
        bc.textContent = `Résultat attendu en ${monthName} : ${sign} ${formatCurrency(Math.abs(net))}. ` +
          (plannedCount ? `${plannedCount} échéance${plannedCount > 1 ? 's' : ''} prévue${plannedCount > 1 ? 's' : ''} incluse${plannedCount > 1 ? 's' : ''}.`
            : 'Aucune échéance supplémentaire connue ce mois.');
      }
    } else {
      const d = new Date(month + '-01');
      d.setMonth(d.getMonth() - 1);
      const prevMonth = isoMonth(d);
      const prev = getMonthCashNet(prevMonth);
      if (!Number.isFinite(prev.net)) {
        bc.textContent = 'Calcul incomplet : les données du mois précédent doivent être vérifiées.';
      } else {
        const sign = net >= 0 ? '+' : '−';
        const signPrev = prev.net >= 0 ? '+' : '−';
        bc.textContent = `Résultat du mois : ${sign} ${formatCurrency(Math.abs(net))} (mois précédent : ${signPrev} ${formatCurrency(Math.abs(prev.net))})`;
      }
    }
  }

  // Budget global : basé uniquement sur les dépenses (hors transferts)
  const budgetCard = document.getElementById('budgetCard');
  if (budgetCard) budgetCard.style.display = monthlyBudget > 0 ? 'block' : 'none';

  if (monthlyBudget > 0) {
    const pct = Math.min((expenses / monthlyBudget) * 100, 100);
    const progress = document.getElementById('budgetProgress');
    const perc = document.getElementById('budgetPercentage');
    const spent = document.getElementById('budgetSpent');
    const total = document.getElementById('budgetTotal');
    if (progress) {
      // Animate from current to new value
      progress.style.transition = 'width 0.9s cubic-bezier(0.22, 1, 0.36, 1), background 0.4s ease';
      const prev = progress.style.width;
      progress.style.width = '0%';
      requestAnimationFrame(() => requestAnimationFrame(() => { progress.style.width = pct + '%'; }));
    }
    if (perc) perc.textContent = Math.round(pct) + '%';
    if (spent) spent.textContent = 'Dépensé: ' + formatCurrency(expenses);
    if (total) total.textContent = 'Budget: ' + formatCurrency(monthlyBudget);
    if (progress) {
      if (pct >= 90) progress.style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
      else if (pct >= 75) progress.style.background = 'linear-gradient(90deg, #f97316, #ea580c)';
      else progress.style.background = 'linear-gradient(90deg, #3b82f6, #2563eb)';
    }
  }

  // ✅ Générer les alertes d'information
  updateDashboardAlerts(month, currentMonth);

  renderRecentTransactions();
  renderDashboardCharts();
  window.renderFinancePriority2?.();
  window.FreevSpendable?.render?.();

  // Animate stat cards staggered entrance
  document.querySelectorAll('#dashboard-view .stat-card').forEach((card, i) => {
    card.classList.remove('stat-card-animate');
    void card.offsetWidth;
    card.style.animationDelay = (i * 80) + 'ms';
    card.classList.add('stat-card-animate');
    setTimeout(() => { card.classList.remove('stat-card-animate'); card.style.animationDelay = ''; }, 600);
  });
}

// ---------- Charts ----------
function renderTrendChart() {
  const ctx = document.getElementById('trendChart');
  if (!ctx) return;

  const labels = [];
  const monthKeys = [];
  const incomes = [];
  const expenses = [];
  const nets = [];
  const balances = [];
  const projected = [];
  const summaryTransactions = [];
  const baseMonth = (document.getElementById('globalMonthPicker')?.value || isoMonth(getToday()));
  getAnalyticsMonthWindow(baseMonth, dashboardChartRange).forEach(({ iso, label }) => {
    const monthTransactions = getDashboardChartTransactions(iso);
    const totals = financeTotalsAsAmounts(monthTransactions);
    const income = totals.ok ? totals.income : NaN;
    const expense = totals.ok ? totals.expenses : NaN;
    labels.push(label);
    monthKeys.push(iso);
    incomes.push(income);
    expenses.push(expense);
    nets.push(totals.ok ? totals.net : NaN);
    balances.push(getDashboardProjectedBalance(iso));
    projected.push(monthTransactions.some(transaction => transaction.projected));
    for (const transaction of monthTransactions) summaryTransactions.push(transaction);
  });

  const title = document.getElementById('trendChartTitle');
  const subtitle = document.getElementById('trendChartSubtitle');
  const summary = document.getElementById('trendChartSummary');
  const forecastText = dashboardChartForecast && projected.some(Boolean) ? ' Les mois marqués * incluent des récurrences prévues.' : '';
  if (dashboardChartMode === 'balance') {
    if (title) title.textContent = 'Trajectoire du solde';
    if (subtitle) subtitle.textContent = `Solde de fin de mois sur ${dashboardChartRange} mois.${forecastText}`;
    if (summary) {
      const available = balances.filter(Number.isFinite);
      const change = available.length > 1 ? roundMoney(available.at(-1) - available[0]) : null;
      summary.textContent = change === null
        ? `Solde final ${formatCurrency(available.at(-1) || 0)} · historique insuffisant pour calculer une évolution.`
        : `Solde final ${formatCurrency(available.at(-1))} · évolution ${change >= 0 ? '+' : ''}${formatCurrency(change)}.`;
    }
  } else {
    if (title) title.textContent = 'Flux financiers';
    if (subtitle) subtitle.textContent = `Revenus, dépenses et résultat net sur ${dashboardChartRange} mois.${forecastText}`;
    if (summary) {
      const totals = financeTotalsAsAmounts(summaryTransactions);
      summary.textContent = totals.ok
        ? `Total : ${formatCurrency(totals.income)} de revenus, ${formatCurrency(totals.expenses)} de dépenses, résultat ${totals.net >= 0 ? '+' : ''}${formatCurrency(totals.net)}.`
        : 'Totaux indisponibles : vérifiez les opérations de la période affichée.';
    }
  }
  const accessibleLabels = labels.map((label, index) => `${label}${projected[index] ? ' *' : ''}`);
  const finiteBalances = balances.filter(Number.isFinite);
  const balanceSpread = finiteBalances.length > 1 ? Math.max(...finiteBalances) - Math.min(...finiteBalances) : 0;
  const yAxisDecimals = dashboardChartMode === 'balance' && balanceSpread < 100 ? 2 : 0;
  ctx.setAttribute('aria-label', dashboardChartMode === 'balance'
    ? `Trajectoire du solde sur ${dashboardChartRange} mois jusqu’à ${baseMonth}`
    : `Revenus, dépenses et résultat sur ${dashboardChartRange} mois jusqu’à ${baseMonth}`);

  if (charts.trend) { try { charts.trend.destroy(); } catch(e) {} charts.trend = null; }
  const signature = window.FreevSignature2?.chartPalette?.() || {
    accent: '#2563eb', income: '#059669', expense: '#e11d48',
    muted: '#94a3b8', grid: 'rgba(148,163,184,0.12)', surface: '#fff'
  };
  const datasets = dashboardChartMode === 'balance'
    ? [{
        label: 'Solde de fin de mois', data: balances, borderColor: signature.accent, backgroundColor: context => window.FreevSignature2?.areaFill?.(context) || 'rgba(0,105,211,0.10)',
        fill: true, borderWidth: 2.5, tension: 0.18, cubicInterpolationMode: 'monotone',
        pointRadius: context => Number.isFinite(context.raw) ? 4 : 0, pointHoverRadius: 7, pointBackgroundColor: balances.map((value, index) => Number.isFinite(value) && projected[index] ? '#f59e0b' : signature.accent),
        pointBorderColor: '#fff', pointBorderWidth: 2,
        segment: { borderDash: context => monthKeys[context.p1DataIndex] > isoMonth(getToday()) ? [6, 4] : undefined }
      }]
    : [
        { label: 'Revenus', type: 'bar', data: incomes, backgroundColor: signature.income, borderColor: signature.income, borderWidth: 1, borderRadius: 5, maxBarThickness: 34 },
        { label: 'Dépenses', type: 'bar', data: expenses, backgroundColor: signature.expense, borderColor: signature.expense, borderWidth: 1, borderRadius: 5, maxBarThickness: 34 },
        { label: 'Résultat net', type: 'line', data: nets, borderColor: signature.accent, backgroundColor: signature.accent, borderWidth: 2.5, tension: 0, pointRadius: 4, pointHoverRadius: 7, pointBackgroundColor: nets.map(value => value >= 0 ? signature.accent : signature.expense), pointBorderColor: '#fff', pointBorderWidth: 2 }
      ];
  charts.trend = safeNewChart('trendChart', {
    type: dashboardChartMode === 'balance' ? 'line' : 'bar',
    data: { labels: accessibleLabels, datasets },
    options: {
      animation: window.FreevChartMotion?.entry({ duration: 850, pointStep: 22, datasetStep: 54, maxDelay: 420 }) ?? false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: {
          label: context => `${context.dataset.label} : ${formatCurrency(context.raw, settings.baseCurrency)}`,
          footer: items => projected[items[0]?.dataIndex] ? 'Inclut des récurrences prévues' : ''
        } }
      },
      scales: {
        y: { beginAtZero: dashboardChartMode !== 'balance', ticks: { callback: value => formatCurrency(value, settings.baseCurrency, yAxisDecimals), color: signature.muted, font: { size: 11 }, maxTicksLimit: 6 }, grid: { color: signature.grid }, border: { display: false } },
        x: { ticks: { color: signature.muted, font: { size: 11 } }, grid: { display: false }, border: { display: false } }
      }
    }
  });
}

function sumCategoriesExact(transactionsToSum) {
  const currency = getActiveFinanceCurrency();
  if (!currency.ok) return { ok: false, error: currency.error };
  const categories = new Map();
  let total = 0n;
  for (const transaction of transactionsToSum) {
    if (transaction.type !== 'expense' || transaction.isRecurring || transaction.paymentStatus === 'planned') continue;
    if (!isValidISODate(transaction.date)) return { ok: false, error: { code: 'invalid-date', transactionId: transaction.id ?? null } };
    const amount = FREEVMoney.parseStoredAmount(transaction.amountBase ?? transaction.amount, currency.currency, `transactions.${transaction.id || 'unknown'}.amount`);
    if (!amount.ok || amount.minor < 0) return { ok: false, error: amount.error || { code: 'negative-transaction' } };
    const category = transaction.category || 'Autre';
    const value = (categories.get(category) || 0n) + BigInt(amount.minor);
    total += BigInt(amount.minor);
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || total > BigInt(Number.MAX_SAFE_INTEGER)) {
      return { ok: false, error: { code: 'out-of-range' } };
    }
    categories.set(category, value);
  }
  const scale = 10 ** FREEVMoney.minorDigits(currency.currency);
  return {
    ok: true,
    currency: currency.currency,
    totalMinor: Number(total),
    total: Number(total) / scale,
    categoriesMinor: [...categories].map(([category, minor]) => [category, Number(minor)]),
    categories: [...categories].map(([category, minor]) => [category, Number(minor) / scale])
  };
}

function renderCategoryChart() {
  const month = document.getElementById('globalMonthPicker')?.value || isoMonth();
  const mt = getDashboardChartTransactions(month);
  const exp = mt.filter(t => t.type === 'expense');

  const ctx = document.getElementById('categoryChart');
  const empty = document.getElementById('categoryChartEmpty');
  const subtitle = document.getElementById('categoryChartSubtitle');
  const summary = document.getElementById('categoryChartSummary');
  if (!ctx) return;

  if (!exp.length) {
    if (charts.category) { try { charts.category.destroy(); } catch(e) {} charts.category = null; }
    try {
      const existing = typeof Chart.getChart === 'function' ? Chart.getChart(ctx) : null;
      if (existing) existing.destroy();
    } catch(e) {}
    ctx.classList.add('hidden');
    empty?.classList.remove('hidden');
    if (subtitle) subtitle.textContent = 'Aucune catégorie à représenter pour le mois sélectionné.';
    if (summary) summary.textContent = 'Ajoutez une dépense ou activez les prévisions.';
    return;
  }

  ctx.classList.remove('hidden');
  empty?.classList.add('hidden');

  const categoryResult = sumCategoriesExact(exp);
  if (!categoryResult.ok) {
    if (charts.category) { try { charts.category.destroy(); } catch(e) {} charts.category = null; }
    ctx.classList.add('hidden');
    empty?.classList.remove('hidden');
    if (subtitle) subtitle.textContent = 'Les données ne permettent pas de calculer cette répartition.';
    if (summary) summary.textContent = 'Vérifiez les montants, dates et devises des opérations.';
    return;
  }
  const ranked = categoryResult.categories.sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 5);
  const scale = 10 ** FREEVMoney.minorDigits(categoryResult.currency);
  const topCategories = new Set(top.map(([category]) => category));
  const otherMinor = categoryResult.categoriesMinor
    .filter(([category]) => !topCategories.has(category))
    .reduce((sum, [, minor]) => sum + BigInt(minor), 0n);
  const other = Number(otherMinor) / scale;
  if (other > 0) top.push(['Autres', other]);
  const labels = top.map(([label]) => label);
  const data = top.map(([, value]) => value);
  const colors = labels.map(cat => getCategoryColor(cat));
  const total = categoryResult.total;
  const hasProjected = exp.some(transaction => transaction.projected);
  if (subtitle) subtitle.textContent = `Catégories de ${new Date(`${month}-01T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}${hasProjected ? ' · prévisions incluses' : ''}.`;
  if (summary) summary.textContent = `${labels.length} catégorie(s) · total ${formatCurrency(total)}${hasProjected ? ' avec les récurrences prévues' : ''}.`;
  ctx.setAttribute('aria-label', `Répartition de ${formatCurrency(total)} de dépenses entre ${labels.length} catégories pour ${month}`);

  const updateVisibleSummary = chart => {
    const visibleCount = chart.data.labels.filter((_, index) => chart.getDataVisibility(index)).length;
    const visibleTotal = roundMoney(visibleDonutTotal(chart));
    if (summary) summary.textContent = `${visibleCount} catégorie(s) visible(s) · total ${formatCurrency(visibleTotal)}${hasProjected ? ' avec les récurrences prévues' : ''}.`;
    ctx.setAttribute('aria-label', `Répartition de ${formatCurrency(visibleTotal)} de dépenses entre ${visibleCount} catégories visibles pour ${month}`);
  };

  charts.category = safeNewChart('categoryChart', {
    type:'doughnut',
    data:{ labels, datasets:[{ data, backgroundColor: colors, borderWidth:3, borderColor:window.FreevSignature2?.chartPalette?.().surface || '#fff', hoverBorderWidth: 3, hoverOffset: 5 }] },
    options:{
      animation: window.FreevChartMotion?.doughnut({ duration: 840, sliceStep: 34 }) ?? false,
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{
          position:'bottom',
          labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 10, font: { size: 11 }, padding: 14 },
          onClick: (_event, item, legend) => {
            const chart = legend.chart;
            chart.toggleDataVisibility(item.index);
            chart.update();
            updateVisibleSummary(chart);
          }
        },
        tooltip: { callbacks: {
          label: context => {
            const value = Number(context.raw) || 0;
            const visibleTotal = visibleDonutTotal(context.chart);
            const percent = visibleTotal > 0 ? Math.round((value / visibleTotal) * 100) : 0;
            return `${context.label} : ${formatCurrency(value)} (${percent} %)`;
          },
          footer: () => hasProjected ? 'Inclut des récurrences prévues' : ''
        } },
        donutCenterTextPlugin:{ lines:['Total', formatCurrency(total)], formatter: value => formatCurrency(value, settings.baseCurrency) }
      },
      cutout:'72%'
    }
  });
}

// Crée un graphique Chart.js en détruisant proprement tout graphique existant sur ce canvas
function safeNewChart(id, config) {
  const canvas = document.getElementById(id);
  if (!canvas) return null;

  // ✅ FIX Mémoire : destruction propre en une seule passe
  // Priorité à l'API officielle Chart.js 3.x, fallback sur le registre interne
  try {
    const existing = typeof Chart.getChart === 'function' ? Chart.getChart(canvas) : null;
    if (existing) {
      existing.destroy();
    } else if (canvas._chartInstance) {
      // Référence interne stockée par nous (voir ci-dessous)
      canvas._chartInstance.destroy();
    }
  } catch(e) { /* ignore — le canvas est peut-être déjà clean */ }

  // Nettoyer toute référence résiduelle sur le canvas
  delete canvas._chartInstance;

  try {
    const chart = new Chart(canvas, config);
    canvas._chartInstance = chart;
    // Fade-in the chart container
    const container = canvas.closest('.chart-container');
    if (container) {
      container.classList.remove('chart-reveal');
      void container.offsetWidth;
      container.classList.add('chart-reveal');
      setTimeout(() => container.classList.remove('chart-reveal'), 600);
    }
    return chart;
  } catch(e) {
    console.error('safeNewChart error on', id, e);
    return null;
  }
}

function renderAnalytics() {
  if (!window.Chart) {
    ensureChartsReady().then(() => {
      if (currentView === 'analytics') renderAnalytics();
    }).catch(() => showToast('Graphiques indisponibles. Vérifiez la connexion.', 'error'));
    return;
  }
  const baseMonth = (document.getElementById('globalMonthPicker')?.value || isoMonth(getToday()));
  const monthWindow = getAnalyticsMonthWindow(baseMonth);

  document.querySelectorAll('.analytics-range button').forEach(button => {
    const active = Number(button.dataset.months) === analyticsRangeMonths;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const title = document.getElementById('analyticsBalanceTitle');
  if (title) title.textContent = `Évolution sur ${analyticsRangeMonths} mois`;
  const subtitle = document.getElementById('analyticsMonthlySubtitle');
  if (subtitle) subtitle.textContent = `Comparaison et résultat net sur les ${analyticsRangeMonths} derniers mois`;

  const months = [];
  const balances = [];

  // En mode multi-compte, construire un solde de départ combiné
  const windowStartISO = monthWindow[0].iso + '-01';

  const displayTxs = getDisplayTransactions();
  const displayCap  = getDisplayCapital();

  let running = displayCap + displayTxs
    .filter(t => !t.isRecurring && (t.date || '') < windowStartISO)
    .reduce((s, t) => {
      if (t.type === 'income')   return s + (Number(t.amountBase ?? t.amount) || 0);
      if (t.type === 'expense')  return s - (Number(t.amountBase ?? t.amount) || 0);
      if (t.type === 'transfer') return s - (Number(t.amountBase ?? t.amount) || 0);
      return s;
    }, 0);

  // En mode multi-compte groupé, générer un dataset par compte pour comparaison
  const isMulti = multiViewMode !== 'individual' && getViewAccounts().length > 1;

  if (isMulti) {
    // Construire des datasets par compte
    const viewAccs = getViewAccounts();
    const datasetsMap = viewAccs.map((acc, i) => {
      const colors = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#ec4899','#65a30d'];
      return { label: acc.name, data: [], borderColor: colors[i % colors.length], backgroundColor: colors[i % colors.length] + '1a', tension: 0.35, fill: false, borderWidth: 2, pointRadius: 3 };
    });

    const monthsArr = monthWindow.map(({ label, iso }) => ({ label, iso }));

    viewAccs.forEach((acc, ai) => {
      let run = (Number(acc.initialCapital)||0) + (acc.transactions||[])
        .filter(t => !t.isRecurring && (t.date||'') < windowStartISO)
        .reduce((s,t) => {
          if (t.type==='income') return s+(Number(t.amountBase??t.amount)||0);
          if (t.type==='expense'||t.type==='transfer') return s-(Number(t.amountBase??t.amount)||0);
          return s;
        }, 0);
      monthsArr.forEach(({iso}) => {
        const mt = (acc.transactions||[]).filter(t => (t.date||'').startsWith(iso) && !t.isRecurring);
        const inc = mt.filter(t=>t.type==='income').reduce((s,t)=>s+(Number(t.amountBase??t.amount)||0),0);
        const exp = mt.filter(t=>t.type==='expense').reduce((s,t)=>s+(Number(t.amountBase??t.amount)||0),0);
        const trf = mt.filter(t=>t.type==='transfer').reduce((s,t)=>s+(Number(t.amountBase??t.amount)||0),0);
        run = roundMoney(run + inc - exp - trf);
        datasetsMap[ai].data.push(run);
      });
    });

    if (charts.analytics) { try { charts.analytics.destroy(); } catch(e) {} charts.analytics = null; }
    charts.analytics = safeNewChart('analyticsChart', {
      type: 'line',
      data: { labels: monthsArr.map(m=>m.label), datasets: datasetsMap },
      options: {
        animation: window.FreevChartMotion?.progressiveLine({ duration: 640, pointStep: 20, datasetStep: 48, maxDelay: 420 }) ?? false,
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 10 } } },
        scales: { y: { ticks: { callback: v => formatCurrency(v, settings.baseCurrency, 0) } } }
      }
    });
  } else {
    monthWindow.forEach(({ iso, label }) => {
      const mt = getMonthTransactions(iso).filter(t => t.paymentStatus !== 'planned');
      const inc = mt.filter(t => t.type === 'income').reduce((s, t) => s + (Number(t.amountBase ?? t.amount) || 0), 0);
      const exp = mt.filter(t => t.type === 'expense').reduce((s, t) => s + (Number(t.amountBase ?? t.amount) || 0), 0);
      const trf = mt.filter(t => t.type === 'transfer').reduce((s, t) => s + (Number(t.amountBase ?? t.amount) || 0), 0);
      running = roundMoney(running + inc - exp - trf);
      months.push(label);
      balances.push(running);
    });

    if (charts.analytics) { try { charts.analytics.destroy(); } catch(e) {} charts.analytics = null; }
    charts.analytics = safeNewChart('analyticsChart', {
      type: 'line',
      data: { labels: months, datasets: [{
        label: 'Solde',
        data: balances,
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99,102,241,0.10)',
        tension: 0.4,
        fill: false,
        borderWidth: 3,
        pointBackgroundColor: balances.map(v => v >= 0 ? '#6366f1' : '#ef4444'),
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 5,
        pointHoverRadius: 8,
        pointHoverBorderWidth: 2,
      }] },
      options: {
        animation: window.FreevChartMotion?.progressiveLine({ duration: 620, pointStep: 18, maxDelay: 420 }) ?? false,
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `Solde : ${formatCurrency(ctx.raw, settings.baseCurrency)}`
            }
          }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 11 } } },
          y: {
            grid: { color: 'rgba(148,163,184,0.12)', drawBorder: false },
            border: { display: false },
            ticks: { callback: v => formatCurrency(v, settings.baseCurrency, 0), color: '#94a3b8', font: { size: 11 } }
          }
        }
      }
    });
  }

  renderAnalyticsMonthly();
  renderCategoryStats();
  renderDailyBalanceChart();
  renderWeekdayChart();
  renderAnalyticsStatsCards();
}

function renderAnalyticsMonthly() {
  const baseMonth = (document.getElementById('globalMonthPicker')?.value || isoMonth(getToday()));

  const months = [];
  const incomes = [];
  const expenses = [];
  const nets = [];

  getAnalyticsMonthWindow(baseMonth).forEach(({ iso, label }) => {
    const mt = getMonthTransactions(iso).filter(t => t.paymentStatus !== 'planned');
    const totals = financeTotalsAsAmounts(mt);
    months.push(label);
    incomes.push(totals.ok ? totals.income : NaN);
    expenses.push(totals.ok ? totals.expenses : NaN);
    nets.push(totals.ok ? totals.net : NaN);
  });

  if (charts.analyticsMonthly) { try { charts.analyticsMonthly.destroy(); } catch(e) {} charts.analyticsMonthly = null; }
  charts.analyticsMonthly = safeNewChart('analyticsMonthlyChart', {
    type: 'bar',
    data: {
      labels: months,
      datasets: [
        {
          label: 'Revenus',
          data: incomes,
          backgroundColor: 'rgba(16,185,129,0.8)',
          borderColor: '#10b981',
          borderWidth: 0,
          borderRadius: { topLeft: 5, topRight: 5 },
          borderSkipped: 'bottom',
          barPercentage: 0.7,
        },
        {
          label: 'Dépenses',
          data: expenses,
          backgroundColor: 'rgba(239,68,68,0.75)',
          borderColor: '#ef4444',
          borderWidth: 0,
          borderRadius: { topLeft: 5, topRight: 5 },
          borderSkipped: 'bottom',
          barPercentage: 0.7,
        },
        {
          type: 'line',
          label: 'Résultat net',
          data: nets,
          borderColor: '#6366f1',
          backgroundColor: '#6366f1',
          borderWidth: 2.5,
          borderDash: [5, 4],
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBackgroundColor: nets.map(value => value >= 0 ? '#6366f1' : '#dc2626'),
          pointBorderColor: '#fff',
          pointBorderWidth: 1.5,
          tension: 0.25,
          order: 0
        }
      ]
    },
    options: {
      animation: window.FreevChartMotion?.entry({ duration: 760, pointStep: 18, datasetStep: 46, maxDelay: 360 }) ?? false,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: { boxWidth: 12, font: { size: 11 }, usePointStyle: true, pointStyle: 'circle' }
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label} : ${formatCurrency(ctx.raw, settings.baseCurrency)}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 11 } } },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(148,163,184,0.12)', drawBorder: false },
          border: { display: false },
          ticks: { callback: v => formatCurrency(v, settings.baseCurrency, 0), color: '#94a3b8', font: { size: 11 } }
        }
      }
    }
  });
}

function renderCategoryStats() {
  const container = document.getElementById('categoryStats');
  if (!container) return;

  const month = document.getElementById('globalMonthPicker')?.value || isoMonth();

  // Update the month label
  const labelEl = document.getElementById('categoryStatsMonthLabel');
  if (labelEl) {
    const d = new Date(month + '-01T12:00:00');
    labelEl.textContent = `Dépenses de ${d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`;
  }

  const exp = getMonthTransactions(month).filter(t => t.type === 'expense' && t.paymentStatus !== 'planned');

  if (!exp.length) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-chart-pie"></i><p>Aucune dépense ce mois-ci</p></div>`;
    return;
  }

  const categoryResult = sumCategoriesExact(exp);
  if (!categoryResult.ok) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Répartition indisponible. Vérifiez les montants, dates et devises.</p></div>`;
    return;
  }
  const total = categoryResult.total;
  const sorted = categoryResult.categories.sort((a, b) => b[1] - a[1]);

  container.innerHTML = sorted.map(([cat, amt], idx) => {
    const pct = total ? ((amt/total)*100).toFixed(1) : '0.0';
    const budget = budgetsByCategory[cat];
    const isOverBudget = Number.isFinite(budget) && amt > budget;
    const budgetStr = Number.isFinite(budget) ? ` • Budget: ${formatCurrency(budget)}` : '';
    const warn = isOverBudget ? ' <span style="color:#ef4444;font-weight:700;">(dépassement)</span>' : '';
    const barColor = isOverBudget ? '#ef4444' : '';
    const catColor = getCategoryColor(cat);
    const delay = idx * 70;
    return `
      <div class="mb-4 stat-row-animate" style="animation-delay:${delay}ms;">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${catColor};flex-shrink:0;"></span>
            <span class="font-medium text-slate-700">${escapeHTML(cat)}</span>
            <span class="text-xs text-slate-500">${budgetStr}${warn}</span>
          </div>
          <div class="text-right">
            <div class="font-semibold text-slate-800">${formatCurrency(amt)}</div>
            <div class="text-xs text-slate-500">${pct}%</div>
          </div>
        </div>
        <div class="progress-bar" style="height:7px;">
          <div class="progress-fill" style="width:${pct}%;${barColor ? 'background:'+barColor+';' : 'background:'+catColor+';'}transition:width 0.8s cubic-bezier(0.22,1,0.36,1) ${delay}ms;"></div>
        </div>
      </div>
    `;
  }).join('');
  // Trigger animated width (start from 0 then set real value)
  requestAnimationFrame(() => {
    container.querySelectorAll('.progress-fill').forEach(bar => {
      const target = bar.style.width;
      bar.style.width = '0%';
      requestAnimationFrame(() => { bar.style.width = target; });
    });
  });
}

// ==========================================
// COURBE JOURNALIÈRE + ANALYTICS AVANCÉS
// ==========================================

function computeDailyBalances(month) {
  const src = getDisplayTransactions();
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  const todayStr = isoDate(getToday());
  const currentMonth = isoMonth(getToday());

  // Solde de départ = capital + tout ce qui précède ce mois
  const cap = getDisplayCapital();
  const prevMonthEnd = isoDate(new Date(year, mon - 1, 0)); // dernier jour du mois précédent
  const startBal = roundMoney(
    cap + src.filter(t => !t.isRecurring && (t.date || '') <= prevMonthEnd)
      .reduce((s, t) => {
        if (t.type === 'income') return s + (Number(t.amountBase ?? t.amount) || 0);
        if (t.type === 'expense' || t.type === 'transfer') return s - (Number(t.amountBase ?? t.amount) || 0);
        return s;
      }, 0)
  );

  // Grouper les transactions existantes par jour
  const txByDay = {};
  src.filter(t => !t.isRecurring && (t.date || '').startsWith(month))
    .forEach(t => {
      const d = parseInt(t.date.slice(8, 10));
      if (!txByDay[d]) txByDay[d] = [];
      txByDay[d].push(t);
    });

  // Utiliser le même moteur que la liste des transactions : mensuel,
  // hebdomadaire, annuel et échéances ignorées restent ainsi cohérents.
  if (month >= currentMonth) {
    getProjectedRecurringTransactions(month).forEach(transaction => {
      const day = parseInt((transaction.date || '').slice(8, 10), 10);
      if (!day) return;
      if (!txByDay[day]) txByDay[day] = [];
      txByDay[day].push(transaction);
    });
  }

  // Construire la série jour par jour
  const balances = [], events = [], labels = [], isProjected = [];
  let run = startBal;
  for (let d = 1; d <= lastDay; d++) {
    const dayTxs = (txByDay[d] || []).sort((a, b) => a.type.localeCompare(b.type));
    let hasProjected = false;
    dayTxs.forEach(t => {
      const amt = Number(t.amountBase ?? t.amount) || 0;
      if (t.type === 'income') run += amt;
      else if (t.type === 'expense' || t.type === 'transfer') run -= amt;
      if (t.projected) hasProjected = true;
    });
    run = roundMoney(run);
    const dt = new Date(year, mon - 1, d);
    const dateIso = `${month}-${String(d).padStart(2, '0')}`;
    labels.push(dt.toLocaleDateString('fr-FR', { day: 'numeric', weekday: 'short' }));
    balances.push(run);
    events.push(dayTxs);
    // Considéré "futur" si date > aujourd'hui ET mois courant, ou si mois futur
    isProjected.push(dateIso > todayStr);
  }

  return { balances, events, labels, startBal, lastDay };
}

function renderDailyBalanceChart() {
  const month = document.getElementById('globalMonthPicker')?.value || isoMonth();
  const [year, mon] = month.split('-').map(Number);
  const todayStr = isoDate(getToday());

  const labelEl = document.getElementById('dailyChartMonthLabel');
  if (labelEl) {
    const d = new Date(month + '-01T12:00:00');
    labelEl.textContent = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  }

  const { balances, events, labels, lastDay } = computeDailyBalances(month);

  // Deux datasets : passé (violet) + projeté (gris) — évite segment callbacks
  const pastBalances   = [];
  const futureBalances = [];
  // Trouver le premier index futur
  const firstFutureIdx = balances.findIndex((_, i) => `${month}-${String(i+1).padStart(2,'0')}` > todayStr);

  for (let i = 0; i < balances.length; i++) {
    const isFuture = firstFutureIdx !== -1 && i >= firstFutureIdx;
    pastBalances.push(isFuture ? null : balances[i]);
    // Le dataset futur inclut le dernier point passé pour continuité de la courbe
    if (firstFutureIdx === -1) {
      futureBalances.push(null); // Tout est passé, pas de projection
    } else if (i === firstFutureIdx - 1 || isFuture) {
      futureBalances.push(balances[i]);
    } else {
      futureBalances.push(null);
    }
  }

  if (charts.daily) { try { charts.daily.destroy(); } catch(e) {} charts.daily = null; }

  const canvas = document.getElementById('dailyBalanceChart');
  if (!canvas) return;

  // Gradient fill via beforeRender — on crée après création du chart
  charts.daily = safeNewChart('dailyBalanceChart', {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Solde',
          data: pastBalances,
          borderColor: '#6366f1',
          backgroundColor: ctx => { const ch = ctx.chart; const { ctx: c, chartArea } = ch; if (!chartArea) return 'rgba(99,102,241,0.12)'; const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom); g.addColorStop(0, 'rgba(99,102,241,0.22)'); g.addColorStop(1, 'rgba(99,102,241,0)'); return g; },
          pointBackgroundColor: pastBalances.map((v, i) => {
            if (v === null) return 'transparent';
            return events[i].length > 0 ? '#6366f1' : 'rgba(99,102,241,0.4)';
          }),
          pointBorderColor: '#6366f1',
          pointBorderWidth: 2,
          pointRadius: pastBalances.map((v, i) => v !== null && events[i].length > 0 ? 5 : (v !== null ? 3 : 0)),
          pointHoverRadius: 7,
          tension: 0.4,
          fill: true,
          borderWidth: 3,
          spanGaps: false,
        },
        {
          label: 'Prévu',
          data: futureBalances,
          borderColor: 'rgba(148,163,184,0.7)',
          backgroundColor: 'rgba(148,163,184,0.06)',
          borderDash: [6, 4],
          pointBackgroundColor: 'rgba(148,163,184,0.5)',
          pointBorderColor: 'rgba(148,163,184,0.7)',
          pointBorderWidth: 1.5,
          pointRadius: futureBalances.map((v, i) => v !== null && events[i].length > 0 ? 4 : (v !== null ? 2 : 0)),
          pointHoverRadius: 6,
          tension: 0.4,
          fill: true,
          borderWidth: 2,
          spanGaps: false,
        }
      ]
    },
    options: {
      animation: window.FreevChartMotion?.progressiveLine({ duration: 560, pointStep: 12, datasetStep: 36, maxDelay: 380 }) ?? false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: futureBalances.some(v => v !== null),
          position: 'top',
          align: 'end',
          labels: { boxWidth: 12, font: { size: 11 }, usePointStyle: true }
        },
        tooltip: { enabled: false }
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: 11, maxRotation: 0, font: { size: 11 }, color: '#94a3b8' },
          grid: { display: false },
          border: { display: false }
        },
        y: {
          ticks: { callback: v => formatCurrency(v, settings.baseCurrency, 0), font: { size: 11 }, color: '#94a3b8' },
          grid: { color: 'rgba(148,163,184,0.12)', drawBorder: false },
          border: { display: false, dash: [4, 4] }
        }
      }
    }
  });

  // ---- Tooltip custom via mousemove (sans aucune API Chart.js privée) ----
  const tooltipEl = document.getElementById('dailyTooltip');
  let lastIdx = -1;
  let crossX = null;

  function buildTooltipHTML(idx) {
    const balance = balances[idx];
    const dayTxs  = events[idx];
    const d = idx + 1;
    const dateIso = `${month}-${String(d).padStart(2, '0')}`;
    const isProj  = dateIso > todayStr;
    const dateLabel = new Date(year, mon - 1, d)
      .toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const balColor = balance >= 0 ? '#10b981' : '#ef4444';
    const projBadge = isProj
      ? `<span style="font-size:0.68rem;background:#f59e0b;color:white;border-radius:0.25rem;padding:1px 5px;margin-left:5px;vertical-align:middle;">Prévu</span>`
      : '';

    let html = `
      <div style="font-weight:700;color:var(--text-primary,#1e293b);margin-bottom:0.3rem;font-size:0.83rem;line-height:1.3;">
        ${dateLabel}${projBadge}
      </div>
      <div style="font-size:1.15rem;font-weight:800;color:${balColor};margin-bottom:0.45rem;letter-spacing:-0.01em;">
        ${formatCurrency(balance)}
      </div>`;

    if (dayTxs.length > 0) {
      html += `<div style="border-top:1px solid var(--border-color,#e2e8f0);padding-top:0.4rem;display:flex;flex-direction:column;gap:0.3rem;">`;
      dayTxs.forEach(t => {
        const amt  = Number(t.amountBase ?? t.amount) || 0;
        const sign = t.type === 'income' ? '+' : '−';
        const col  = t.type === 'income' ? '#10b981' : (t.type === 'transfer' ? '#6366f1' : '#ef4444');
        const icon = t.type === 'income' ? '↑' : (t.type === 'transfer' ? '↔' : '↓');
        const projMark = t.projected ? `<span style="opacity:0.55;font-size:0.68rem;"> (prévu)</span>` : '';
        const desc = escapeHTML((t.desc || t.category || 'Transaction').slice(0, 22));
        html += `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:0.6rem;min-width:0;">
            <span style="color:var(--text-secondary,#475569);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.78rem;">
              <span style="color:${col};font-weight:700;">${icon}</span> ${desc}${projMark}
            </span>
            <span style="color:${col};font-weight:700;font-size:0.82rem;white-space:nowrap;">${sign}${formatCurrency(amt)}</span>
          </div>`;
      });
      html += `</div>`;
    } else {
      html += `<div style="color:var(--text-muted,#94a3b8);font-size:0.75rem;margin-top:0.1rem;">Aucune transaction ce jour</div>`;
    }
    return html;
  }

  function onCanvasMove(e) {
    const chart = charts.daily;
    if (!chart) return;
    try {
      const elems = chart.getElementsAtEventForMode(e, 'index', { intersect: false }, true);
      if (!elems || !elems.length) { if (tooltipEl) tooltipEl.style.display = 'none'; return; }
      const idx = elems[0].index;

      // Crosshair : redessiner le canvas proprement via Chart.js update léger
      if (idx !== lastIdx) {
        lastIdx = idx;
        if (tooltipEl) tooltipEl.innerHTML = buildTooltipHTML(idx);
      }

      if (!tooltipEl) return;
      tooltipEl.style.display = 'block';

      // Position du tooltip par rapport au wrapper
      const wrapper   = canvas.parentElement;
      const wRect     = wrapper.getBoundingClientRect();
      const cRect     = canvas.getBoundingClientRect();
      const scaleX    = canvas.width / cRect.width;
      const pointX    = elems[0].element.x / scaleX; // en CSS px par rapport au canvas
      const canvasLeft = cRect.left - wRect.left;
      const absX       = canvasLeft + pointX;
      const tooltipW   = 270;
      const margin     = 14;
      let left = absX + margin;
      if (left + tooltipW > wRect.width - 8) left = absX - tooltipW - margin;
      if (left < 4) left = 4;

      const pointY = elems[0].element.y / scaleX;
      const canvasTop = cRect.top - wRect.top;
      let top = canvasTop + pointY - 50;
      if (top < 4) top = 4;

      tooltipEl.style.left = left + 'px';
      tooltipEl.style.top  = top  + 'px';
    } catch(err) { /* ignore hover errors */ }
  }

  const activeCanvas = document.getElementById('dailyBalanceChart');
  if (activeCanvas) {
    // ✅ FIX : annuler les anciens listeners avant d'en ajouter de nouveaux
    if (activeCanvas._dailyCtrl) activeCanvas._dailyCtrl.abort();
    const ctrl = new AbortController();
    activeCanvas._dailyCtrl = ctrl;
    activeCanvas.addEventListener('mousemove', onCanvasMove, { signal: ctrl.signal });
    activeCanvas.addEventListener('mouseleave', () => {
      lastIdx = -1;
      if (tooltipEl) tooltipEl.style.display = 'none';
    }, { signal: ctrl.signal });
  }
}

function renderWeekdayChart() {
  const baseMonth = document.getElementById('globalMonthPicker')?.value || isoMonth(getToday());

  // Accumuler les dépenses par jour de la semaine sur la période choisie.
  const weekTotals = [0, 0, 0, 0, 0, 0, 0]; // dim, lun, mar, mer, jeu, ven, sam
  const weekCounts = [0, 0, 0, 0, 0, 0, 0];

  getAnalyticsMonthWindow(baseMonth).forEach(({ iso }) => {
    const mt = getMonthTransactions(iso).filter(t => t.paymentStatus !== 'planned' && t.type === 'expense');
    mt.forEach(t => {
      const dt = new Date(t.date + 'T12:00:00');
      const wd = dt.getDay();
      weekTotals[wd] += Number(t.amountBase ?? t.amount) || 0;
      weekCounts[wd]++;
    });
  });

  // Réordonner : Lun..Dim (style européen)
  const order = [1, 2, 3, 4, 5, 6, 0];
  const labels = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const averages = order.map(wd => weekCounts[wd] > 0 ? roundMoney(weekTotals[wd] / weekCounts[wd]) : 0);
  const orderedCounts = order.map(wd => weekCounts[wd]);
  const maxAvg = Math.max(...averages);
  const bgColors = averages.map(v => v === maxAvg && maxAvg > 0 ? '#f97316' : '#60a5fa');

  const subtitle = document.getElementById('weekdayChartSubtitle');
  if (subtitle) subtitle.textContent = `Montant moyen par transaction sur ${analyticsRangeMonths} mois, avec le nombre d’opérations.`;

  if (charts.weekday) { try { charts.weekday.destroy(); } catch(e) {} charts.weekday = null; }
  charts.weekday = safeNewChart('weekdayChart', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Dépense moyenne / transaction',
        data: averages,
        backgroundColor: bgColors,
        borderColor: averages.map(v => v === maxAvg && maxAvg > 0 ? '#c2410c' : '#2563eb'),
        borderWidth: 1,
        borderRadius: 8,
        borderSkipped: 'bottom',
      }]
    },
    options: {
      animation: window.FreevChartMotion?.entry({ duration: 680, pointStep: 34, maxDelay: 260 }) ?? false,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `Moyenne : ${formatCurrency(ctx.raw, settings.baseCurrency)}`,
            afterLabel: ctx => `${orderedCounts[ctx.dataIndex]} transaction(s) · total ${formatCurrency(weekTotals[order[ctx.dataIndex]], settings.baseCurrency)}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: v => formatCurrency(v, settings.baseCurrency, 0), color: '#94a3b8', font: { size: 11 } },
          grid: { color: 'rgba(148,163,184,0.15)' },
          border: { display: false }
        },
        x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 12, weight: '600' } }, border: { display: false } }
      }
    }
  });
}

function renderAnalyticsStatsCards() {
  const container = document.getElementById('analyticsStatsCards');
  if (!container) return;

  const month = document.getElementById('globalMonthPicker')?.value || isoMonth();
  const todayStr = isoDate(getToday());
  const currentMonth = isoMonth(getToday());

  const mt = getMonthTransactions(month).filter(t => t.paymentStatus !== 'planned');
  const incomes  = mt.filter(t => t.type === 'income');
  const expenses = mt.filter(t => t.type === 'expense');

  const flowTotals = financeTotalsAsAmounts(mt);
  const totalIncome = flowTotals.ok ? flowTotals.income : NaN;
  const totalExpense = flowTotals.ok ? flowTotals.expenses : NaN;
  const balance = flowTotals.ok ? flowTotals.netBeforeTransfers : NaN;
  const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome * 100) : null;

  // Solde de départ du mois
  const [year, mon] = month.split('-').map(Number);
  const prevMonthEnd = isoDate(new Date(year, mon - 1, 0));
  const cap = getDisplayCapital();
  const src = getDisplayTransactions();
  const startBal = roundMoney(
    cap + src.filter(t => !t.isRecurring && (t.date || '') <= prevMonthEnd)
      .reduce((s, t) => {
        if (t.type === 'income') return s + (Number(t.amountBase ?? t.amount) || 0);
        if (t.type === 'expense' || t.type === 'transfer') return s - (Number(t.amountBase ?? t.amount) || 0);
        return s;
      }, 0)
  );

  // Plus grosse dépense unique
  const biggestExp = expenses.reduce((max, t) => {
    const a = Number(t.amountBase ?? t.amount) || 0;
    return a > (max?.amt || 0) ? { amt: a, desc: t.desc || t.category || '?' } : max;
  }, null);

  // Récurrentes prévues (pour le mois courant non encore passées)
  let upcomingRecur = 0;
  if (month === currentMonth) {
    upcomingRecur = getProjectedRecurringTransactions(month)
      .filter(transaction => transaction.date > todayStr && transaction.type !== 'income')
      .reduce((sum, transaction) => sum + (Number(transaction.amountBase ?? transaction.amount) || 0), 0);
  }

  let cardIdx = 0;
  const card = (icon, label, value, color, sub) => {
    const delay = cardIdx++ * 70;
    return `
    <div class="card mini-card-animate" style="padding:1rem 1.2rem;animation-delay:${delay}ms;">
      <div style="font-size:1.4rem;margin-bottom:0.3rem;">${icon}</div>
      <div style="font-size:0.72rem;color:var(--text-muted,#64748b);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:0.15rem;">${label}</div>
      <div style="font-size:1.1rem;font-weight:800;color:${color};">${value}</div>
      ${sub ? `<div style="font-size:0.7rem;color:var(--text-muted,#64748b);margin-top:0.1rem;">${sub}</div>` : ''}
    </div>
  `};

  let html = '';
  html += card('💼', 'Solde départ', formatCurrency(startBal), startBal >= 0 ? '#10b981' : '#ef4444', 'début du mois');
  html += card('📈', 'Revenus du mois', formatCurrency(totalIncome), '#10b981', `${incomes.length} transaction(s)`);
  html += card('📉', 'Dépenses du mois', formatCurrency(totalExpense), '#ef4444', `${expenses.length} transaction(s)`);

  if (savingsRate !== null) {
    const rateColor = savingsRate >= 20 ? '#10b981' : savingsRate >= 0 ? '#f59e0b' : '#ef4444';
    html += card('💰', 'Taux épargne', `${savingsRate.toFixed(1)} %`, rateColor, `${formatCurrency(balance)} économisés`);
  }

  if (biggestExp) {
    html += card('🔺', 'Plus grosse dépense', formatCurrency(biggestExp.amt), '#ef4444', escapeHTML(biggestExp.desc.length > 20 ? biggestExp.desc.slice(0, 20) + '…' : biggestExp.desc));
  }

  if (upcomingRecur > 0) {
    html += card('🔁', 'Récurrentes à venir', formatCurrency(upcomingRecur), '#f59e0b', 'dépenses prévues ce mois');
  }

  container.innerHTML = html;
  renderAnalyticsInsights(month);
}

function renderAnalyticsInsights(month) {
  const container = document.getElementById('analyticsInsights');
  if (!container) return;

  const monthTx = getMonthTransactions(month).filter(t => t.paymentStatus !== 'planned');
  const flowTotals = financeTotalsAsAmounts(monthTx);
  if (!flowTotals.ok) {
    container.textContent = 'Analyse indisponible : vérifiez les montants, les dates et les devises des opérations.';
    return;
  }
  const { income, expenses, transfers, net } = flowTotals;

  const previousDate = new Date(`${month}-01T12:00:00`);
  previousDate.setMonth(previousDate.getMonth() - 1);
  const previous = getMonthCashNet(isoMonth(previousDate));
  const expenseDelta = previous.expenses > 0 ? ((expenses - previous.expenses) / previous.expenses) * 100 : null;

  const categoryResult = sumCategoriesExact(monthTx);
  if (!categoryResult.ok) {
    container.textContent = 'Répartition par catégorie indisponible : vérifiez les montants et les devises.';
    return;
  }
  const topCategory = categoryResult.categories.sort((a, b) => b[1] - a[1])[0];
  const topShare = topCategory && expenses > 0 ? (topCategory[1] / expenses) * 100 : 0;

  const [year, monthNumber] = month.split('-').map(Number);
  const days = new Date(year, monthNumber, 0).getDate();
  const currentMonth = isoMonth(getToday());
  const elapsedDays = month === currentMonth ? Math.max(1, Math.min(getToday().getDate(), days)) : days;
  const projectedExpenses = month === currentMonth ? roundMoney(expenses / elapsedDays * days) : expenses;
  const projectedBudgetPct = monthlyBudget > 0 ? projectedExpenses / monthlyBudget * 100 : null;

  const insights = [];
  insights.push({
    icon: net >= 0 ? 'fa-arrow-trend-up' : 'fa-triangle-exclamation',
    color: net >= 0 ? '#0f766e' : '#dc2626',
    title: net >= 0 ? 'Mois excédentaire' : 'Mois déficitaire',
    text: `${net >= 0 ? 'Le résultat disponible est de' : 'Le déficit atteint'} ${formatCurrency(Math.abs(net))}, après ${formatCurrency(transfers)} de transferts.`
  });

  insights.push({
    icon: 'fa-layer-group',
    color: '#7c3aed',
    title: topCategory ? `Premier poste : ${escapeHTML(topCategory[0])}` : 'Aucune dépense',
    text: topCategory
      ? `${formatCurrency(topCategory[1])}, soit ${topShare.toFixed(1).replace('.', ',')} % des dépenses du mois.`
      : 'Ajoutez des dépenses pour obtenir une analyse par catégorie.'
  });

  let projectionText;
  if (month === currentMonth) {
    projectionText = monthlyBudget > 0
      ? `Au rythme actuel : ${formatCurrency(projectedExpenses)} en fin de mois (${Math.round(projectedBudgetPct)} % du budget).`
      : `Au rythme actuel : environ ${formatCurrency(projectedExpenses)} de dépenses en fin de mois.`;
  } else if (expenseDelta === null) {
    projectionText = 'Aucun mois précédent comparable pour calculer une tendance fiable.';
  } else {
    projectionText = `Les dépenses ont ${expenseDelta <= 0 ? 'baissé' : 'augmenté'} de ${Math.abs(expenseDelta).toFixed(1).replace('.', ',')} % par rapport au mois précédent.`;
  }
  insights.push({
    icon: month === currentMonth ? 'fa-wand-magic-sparkles' : 'fa-scale-balanced',
    color: projectedBudgetPct !== null && projectedBudgetPct > 100 ? '#dc2626' : '#2563eb',
    title: month === currentMonth ? 'Projection fin de mois' : 'Comparaison mensuelle',
    text: projectionText
  });

  container.innerHTML = insights.map(item => `
    <div class="analytics-insight">
      <div class="analytics-insight-icon" style="background:${item.color}"><i class="fa-solid ${item.icon}"></i></div>
      <div><div class="analytics-insight-title">${item.title}</div><div class="analytics-insight-text">${item.text}</div></div>
    </div>`).join('');
}
