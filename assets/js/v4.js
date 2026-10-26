import {
  accountBalance,
  buildActionPlan,
  buildSmartAlerts,
  calculateForecast,
  calculateFinancialHealth,
  calculatePlannerIntelligence,
  envelopeUsage,
  financialCalendar,
  isoDate,
  goalProgress,
  normalizeForecastMonths,
  normalizeProjectionScope,
  recurringExpenseCostByCategory,
  recurringPeriodKey,
  summarizeForecast,
  transactionEffect
} from './v4-engine.js';
import { dailyProjection, formatMinor, minorDigits, parseAmount } from './finance-core.mjs';
import { createSearchPanel } from './search-ui.js';
import { buildPlannerEvaluationInsight } from './planner-evaluation-insight.mjs';

const RELEASE_KEY = 'freevValeurWhatsNew_4_3';
let initialized = false;
let searchTimer = null;
let simulatorTimer = null;

const PROJECTION_DESCRIPTIONS = {
  recurring: 'Projection limitée aux revenus et dépenses récurrents.',
  'recurring-scheduled': 'Projection basée sur les récurrences et les opérations futures déjà planifiées.',
  complete: 'Projection basée sur vos habitudes, récurrences et opérations planifiées.'
};

const $ = id => document.getElementById(id);
const releaseKey = () => `${RELEASE_KEY}:${window.__freevUserId || 'device'}`;
const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));

function state() {
  return window._getAppState?.() || { accounts: [], currentAccountId: null, multiViewMode: 'individual', selectedGroupIds: new Set() };
}

function currentAccount(appState = state()) {
  return appState.accounts.find(account => account.id === appState.currentAccountId) || appState.accounts[0] || null;
}

function syncPlannerMaintenance() {
  const view = $('planner-view');
  const maintenance = $('v4PlannerMaintenance');
  if (!view || !maintenance) return false;
  const localPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    && new URLSearchParams(window.location.search).get('plannerPreview') === '1';
  const enabled = window.FREEV_FEATURE_FLAGS?.plannerMaintenance === true && !localPreview;
  maintenance.hidden = !enabled;
  Array.from(view.children).forEach(child => {
    if (child !== maintenance) child.hidden = enabled;
  });
  return enabled;
}

function visibleAccounts(appState = state()) {
  if (appState.multiViewMode === 'global') return appState.accounts;
  if (appState.multiViewMode === 'group') {
    const selected = appState.selectedGroupIds instanceof Set
      ? appState.selectedGroupIds
      : new Set(appState.selectedGroupIds || []);
    const group = appState.accounts.filter(account => selected.has(account.id));
    if (group.length) return group;
  }
  const account = currentAccount(appState);
  return account ? [account] : [];
}

function currency(appState = state()) {
  return currentAccount(appState)?.settings?.baseCurrency || 'EUR';
}

function formatMoney(value, appState = state()) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency(appState), maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function formatDate(value) {
  const date = new Date(`${String(value || '').slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? 'Date inconnue' : new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function notify(message, type = 'success') {
  window.showToast?.(message, type);
}

function persist() {
  window.saveData?.();
  window.renderAccountsSidebar?.();
  render();
}

function summaryCard(icon, label, value, detail, tone = '') {
  return `<article class="v4-summary-card ${tone}"><span class="v4-summary-icon"><i class="fa-solid fa-${icon}"></i></span><div><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong><small>${escapeHTML(detail)}</small></div></article>`;
}

function renderSummary(appState, accounts, forecast, alerts) {
  const container = $('v4Summary');
  if (!container) return;
  const balance = accounts.reduce((sum, account) => sum + accountBalance(account, new Date()), 0);
  const finalBalance = forecast.at(-1)?.balance ?? balance;
  const goals = accounts.reduce((sum, account) => sum + (account.goals?.length || 0), 0);
  const scope = accounts.length > 1 ? `${accounts.length} comptes dans cette vue` : (accounts[0]?.name || 'Aucun compte');
  container.innerHTML = [
    summaryCard('wallet', 'Solde actuel', formatMoney(balance, appState), scope, balance < 0 ? 'danger' : ''),
    summaryCard('arrow-trend-up', 'Solde prévu', formatMoney(finalBalance, appState), `Dans ${forecast.length} mois`, finalBalance < balance ? 'warning' : 'success'),
    summaryCard('bullseye', 'Objectifs actifs', String(goals), goals ? 'Continuez votre progression' : 'Créez votre premier objectif'),
    summaryCard('bell', 'Points à surveiller', String(alerts.length), alerts.length ? 'Consultez les alertes ci-dessous' : 'Tout semble sous contrôle', alerts.length ? 'warning' : 'success')
  ].join('');
}

function renderForecast(appState, forecast) {
  const container = $('v4Forecast');
  if (!container) return;
  if (!forecast.length) {
    container.innerHTML = '<p class="v4-empty">Aucune trajectoire à afficher. Ajoutez une opération datée ou un paiement régulier pour démarrer.</p>';
    return;
  }
  const largest = Math.max(...forecast.map(item => Math.abs(item.balance)), 1);
  container.innerHTML = forecast.map(item => {
    const width = Math.max(6, Math.round((Math.abs(item.balance) / largest) * 100));
    const positive = item.balance >= 0;
    const label = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit' }).format(new Date(`${item.month}-01T12:00:00`));
    return `<div class="v4-forecast-row"><span>${escapeHTML(label)}</span><div class="v4-forecast-track"><span class="${positive ? 'positive' : 'negative'}" style="width:${width}%"></span></div><strong>${escapeHTML(formatMoney(item.balance, appState))}</strong><small class="${item.change >= 0 ? 'positive-text' : 'negative-text'}">${item.change >= 0 ? '+' : ''}${escapeHTML(formatMoney(item.change, appState))}</small></div>`;
  }).join('');
}

function monthLabel(month, style = 'short') {
  return new Intl.DateTimeFormat('fr-FR', { month: style, year: 'numeric' })
    .format(new Date(`${month}-01T12:00:00`));
}

function renderForecastInsights(appState, forecast, startingBalance) {
  const container = $('v42ForecastInsights');
  if (!container) return;
  const insight = summarizeForecast(forecast, startingBalance);
  const negative = insight.firstNegativeMonth
    ? `<article class="danger"><i class="fa-solid fa-triangle-exclamation"></i><div><span>Risque de découvert</span><strong>${escapeHTML(monthLabel(insight.firstNegativeMonth))}</strong></div></article>`
    : '<article class="success"><i class="fa-solid fa-shield-halved"></i><div><span>Risque de découvert</span><strong>Aucun sur la période</strong></div></article>';
  container.innerHTML = [
    `<article class="${insight.totalChange >= 0 ? 'success' : 'warning'}"><i class="fa-solid fa-arrow-trend-${insight.totalChange >= 0 ? 'up' : 'down'}"></i><div><span>Variation totale</span><strong>${insight.totalChange >= 0 ? '+' : ''}${escapeHTML(formatMoney(insight.totalChange, appState))}</strong></div></article>`,
    `<article><i class="fa-solid fa-water"></i><div><span>Solde minimum</span><strong>${escapeHTML(formatMoney(insight.lowestBalance, appState))}</strong><small>${insight.lowestMonth ? escapeHTML(monthLabel(insight.lowestMonth)) : 'Maintenant'}</small></div></article>`,
    negative
  ].join('');
}

function renderForecastBreakdown(appState, forecast) {
  const container = $('v43ForecastBreakdown');
  const firstMonth = forecast[0];
  if (!container) return;
  if (!firstMonth) {
    container.innerHTML = '';
    container.hidden = true;
    return;
  }

  container.hidden = false;
  const amount = value => Number(value) || 0;
  const signedMoney = value => {
    const normalized = amount(value);
    return `${normalized > 0 ? '+' : ''}${formatMoney(normalized, appState)}`;
  };
  const projectionScope = normalizeProjectionScope(firstMonth.projectionScope);
  const rows = [
    {
      icon: 'clock-rotate-left',
      label: 'Habitudes récentes',
      detail: projectionScope === 'complete' ? 'Moyenne mensuelle de vos 3 derniers mois' : 'Exclues par votre filtre de projection',
      value: amount(firstMonth.historicalChange),
      excluded: projectionScope !== 'complete'
    },
    {
      icon: 'arrows-rotate',
      label: 'Récurrences',
      detail: 'Revenus et dépenses qui se répètent ce mois-ci',
      value: amount(firstMonth.recurringChange)
    },
    {
      icon: 'calendar-check',
      label: 'Opérations planifiées',
      detail: projectionScope === 'recurring' ? 'Exclues par votre filtre de projection' : 'Transactions futures déjà enregistrées pour ce mois',
      value: amount(firstMonth.scheduledChange),
      excluded: projectionScope === 'recurring'
    }
  ];
  if (Math.abs(amount(firstMonth.monthlySimulation)) >= 0.005) {
    rows.push({
      icon: 'sliders',
      label: 'Simulation',
      detail: 'Ajustements testés dans le simulateur avancé',
      value: amount(firstMonth.monthlySimulation)
    });
  }
  if (Math.abs(amount(firstMonth.oneTimeAdjustment)) >= 0.005) {
    rows.push({
      icon: 'triangle-exclamation',
      label: 'Imprévu',
      detail: 'Dépense ponctuelle simulée pour ce mois',
      value: amount(firstMonth.oneTimeAdjustment)
    });
  }
  rows.push({
    icon: 'equals',
    label: 'Total mensuel',
    detail: 'Somme utilisée pour calculer le prochain solde',
    value: amount(firstMonth.change),
    total: true
  });

  container.innerHTML = `
    <div class="v43-breakdown-head">
      <div>
        <strong id="v43ForecastBreakdownTitle">D’où vient la prévision de ${escapeHTML(monthLabel(firstMonth.month, 'long'))} ?</strong>
        <span>Les lignes grisées sont exclues du calcul. Les simulations ne modifient pas vos transactions.</span>
      </div>
    </div>
    <dl class="v43-breakdown-grid">
      ${rows.map(row => `<div class="v43-breakdown-row${row.total ? ' total' : ''}${row.excluded ? ' excluded' : ''}" data-v43-breakdown-row>
        <dt><i class="fa-solid fa-${row.icon}" aria-hidden="true"></i><span><strong>${escapeHTML(row.label)}</strong><small>${escapeHTML(row.detail)}</small></span></dt>
        <dd class="${row.value >= 0 ? 'positive-text' : 'negative-text'}">${escapeHTML(signedMoney(row.value))}</dd>
      </div>`).join('')}
    </dl>`;
}

function renderPlannerIntelligence(appState, intelligence, evaluationInsight) {
  const container = $('v43PlannerIntelligence');
  if (!container) return;
  const expenseEstimate = intelligence.expenseEstimate;
  const expenseMonthLabel = expenseEstimate?.targetMonth ? monthLabel(expenseEstimate.targetMonth, 'long') : 'mois suivant';
  const expectedExpenses = expenseEstimate?.reason === 'insufficient-history' && !expenseEstimate.committedMinor
    ? 'Historique insuffisant'
    : expenseEstimate?.ok && Number.isSafeInteger(expenseEstimate.totalMinor)
    ? formatMinor(expenseEstimate.totalMinor, expenseEstimate.currency)
    : 'À vérifier';
  const observedExpenses = expenseEstimate?.ok && Number.isSafeInteger(expenseEstimate.habitualMinor)
    ? formatMinor(expenseEstimate.habitualMinor, expenseEstimate.currency)
    : '—';
  const committedExpenses = expenseEstimate?.ok && Number.isSafeInteger(expenseEstimate.committedMinor)
    ? formatMinor(expenseEstimate.committedMinor, expenseEstimate.currency)
    : '—';
  const expenseEstimateDetail = expenseEstimate?.reason === 'mixed-currencies'
    ? 'Les comptes sélectionnés n’ont pas la même devise de base.'
    : `${expenseEstimate?.coveredMonths || 0} mois observés · habitudes ${expenseEstimate?.reason === 'insufficient-history' ? 'non estimées' : observedExpenses} · échéances ${committedExpenses}${expenseEstimate?.seasonalCategories ? ` · ${expenseEstimate.seasonalCategories} catégorie(s) saisonnière(s)` : ''}${expenseEstimate?.incompleteRecords ? ` · ${expenseEstimate.incompleteRecords} opération(s) exclue(s), à vérifier` : ''}`;
  const expenseCategorySummary = expenseEstimate?.categories?.slice(0, 3)
    .map(row => `${row.category} ${formatMinor(row.totalMinor, expenseEstimate.currency)}`).join(' · ');
  const runway = intelligence.runwayMonths === null
    ? 'Sans dépense moyenne'
    : `${intelligence.runwayMonths.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mois`;
  const effort = intelligence.recommendedMonthlyAdjustment > 0
    ? `${formatMoney(intelligence.recommendedMonthlyAdjustment, appState)} / mois`
    : 'Aucun effort requis';
  container.innerHTML = [
    `<article class="${intelligence.risk.level}"><i class="fa-solid fa-shield-halved"></i><div><span>Risque prévisionnel</span><strong>${escapeHTML(intelligence.risk.label)}</strong><small>${escapeHTML(intelligence.risk.detail)}</small></div></article>`,
    `<article><i class="fa-solid fa-life-ring"></i><div><span>Autonomie estimée</span><strong>${escapeHTML(runway)}</strong><small>Trésorerie et épargne face aux dépenses moyennes.</small></div></article>`,
    `<article class="${intelligence.recommendedMonthlyAdjustment > 0 ? 'warning' : 'success'}"><i class="fa-solid fa-bullseye"></i><div><span>Effort de sécurité conseillé</span><strong>${escapeHTML(effort)}</strong><small>Cible : garder ${escapeHTML(formatMoney(intelligence.safetyTarget, appState))} au point le plus bas.</small></div></article>`,
    `<article class="warning"><i class="fa-solid fa-chart-simple"></i><div><span>Mesure de précision</span><strong>${escapeHTML(evaluationInsight.headline)}</strong><small>${escapeHTML(evaluationInsight.detail)}</small></div></article>`,
    `<article class="${expenseEstimate?.ok && !expenseEstimate.incompleteRecords && !expenseEstimate.reason ? 'success' : 'warning'}"><i class="fa-solid fa-basket-shopping"></i><div><span>Dépenses estimées · ${escapeHTML(expenseMonthLabel)}</span><strong>${escapeHTML(expectedExpenses)}</strong><small>${escapeHTML(expenseEstimateDetail)}. Les habitudes ne sont ajoutées aux échéances que si elles sont distinctes.</small>${expenseCategorySummary ? `<small>Par catégorie : ${escapeHTML(expenseCategorySummary)}.</small>` : ''}</div></article>`
  ].join('');
}

function renderForecastChart(appState, forecast, startingBalance, bands = []) {
  const container = $('v42ForecastChart');
  if (!container) return;
  if (!forecast.length) {
    container.innerHTML = '<p class="v4-empty">Aucune trajectoire à afficher. Ajoutez une opération datée ou un paiement régulier pour démarrer.</p>';
    return;
  }
  const width = 760;
  const height = 245;
  const padding = { left: 18, right: 18, top: 22, bottom: 36 };
  const rows = [{ month: 'Aujourd’hui', balance: startingBalance }, ...forecast];
  const balances = [
    ...rows.map(row => Number(row.balance) || 0),
    ...bands.flatMap(row => [Number(row.optimistic) || 0, Number(row.stress) || 0])
  ];
  const minimum = Math.min(0, ...balances);
  const maximum = Math.max(0, ...balances);
  const spread = Math.max(1, maximum - minimum);
  const x = index => padding.left + (index / Math.max(1, rows.length - 1)) * (width - padding.left - padding.right);
  const y = balance => padding.top + ((maximum - balance) / spread) * (height - padding.top - padding.bottom);
  const points = rows.map((row, index) => `${x(index).toFixed(1)},${y(row.balance).toFixed(1)}`).join(' ');
  const area = `${padding.left},${height - padding.bottom} ${points} ${width - padding.right},${height - padding.bottom}`;
  const bandRows = [{ optimistic: startingBalance, stress: startingBalance }, ...bands];
  const upper = bandRows.map((row, index) => `${x(index).toFixed(1)},${y(row.optimistic).toFixed(1)}`);
  const lower = [...bandRows].reverse().map((row, reverseIndex) => {
    const index = bandRows.length - reverseIndex - 1;
    return `${x(index).toFixed(1)},${y(row.stress).toFixed(1)}`;
  });
  const riskBand = [...upper, ...lower].join(' ');
  const zeroY = y(0).toFixed(1);
  const labelEvery = Math.max(1, Math.ceil((rows.length - 1) / 6));
  const labels = rows.map((row, index) => {
    if (index !== 0 && index !== rows.length - 1 && index % labelEvery !== 0) return '';
    const label = index === 0 ? 'Maint.' : monthLabel(row.month, 'short').replace('.', '');
    return `<text x="${x(index).toFixed(1)}" y="${height - 12}" text-anchor="${index === 0 ? 'start' : index === rows.length - 1 ? 'end' : 'middle'}">${escapeHTML(label)}</text>`;
  }).join('');
  const dots = rows.map((row, index) => `<circle class="v42-forecast-point" style="--forecast-point-delay:${Math.min(560, index * 32)}ms" cx="${x(index).toFixed(1)}" cy="${y(row.balance).toFixed(1)}" r="${index === rows.length - 1 ? 5 : 3}"><title>${escapeHTML(index === 0 ? 'Aujourd’hui' : monthLabel(row.month))} : ${escapeHTML(formatMoney(row.balance, appState))}</title></circle>`).join('');
  container.setAttribute('aria-label', `Solde prévu de ${formatMoney(startingBalance, appState)} à ${formatMoney(forecast.at(-1).balance, appState)} sur ${forecast.length} mois.`);
  const canAnimate = window.FreevChartMotion
    ? !window.FreevChartMotion.isReduced()
    : !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  container.innerHTML = `<svg class="${canAnimate ? 'is-animating' : ''}" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false"><defs><linearGradient id="v42ForecastGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16836b" stop-opacity=".25"/><stop offset="1" stop-color="#16836b" stop-opacity=".02"/></linearGradient></defs><line class="v42-zero-line" x1="${padding.left}" x2="${width - padding.right}" y1="${zeroY}" y2="${zeroY}"/>${bands.length ? `<polygon class="v43-risk-band" points="${riskBand}"/>` : ''}<polygon class="v42-forecast-area" points="${area}"/><polyline class="v42-forecast-line" points="${points}"/>${dots}${labels}</svg>`;
  if (canAnimate) {
    const svg = container.querySelector('svg');
    const line = svg?.querySelector('.v42-forecast-line');
    const areaElement = svg?.querySelector('.v42-forecast-area');
    if (line) {
      try {
        const length = line.getTotalLength();
        line.style.setProperty('--forecast-line-length', `${length}`);
        requestAnimationFrame(() => {
          line.classList.add('is-drawn');
          areaElement?.classList.add('is-visible');
        });
      } catch (_) {
        line.classList.add('is-drawn');
        areaElement?.classList.add('is-visible');
      }
    }
  }
}

function renderAlerts(appState, alerts) {
  const container = $('v4Alerts');
  const count = $('v4AlertCount');
  if (count) count.textContent = String(alerts.length);
  if (!container) return;
  if (!alerts.length) {
    container.innerHTML = '<div class="v4-empty v4-empty-success"><i class="fa-solid fa-circle-check"></i><strong>Aucune alerte importante</strong><span>Vos comptes et budgets sont sous contrôle.</span></div>';
    return;
  }
  container.innerHTML = alerts.map(alert => {
    const icon = alert.level === 'danger' ? 'triangle-exclamation' : alert.level === 'warning' ? 'bell' : 'circle-info';
    return `<article class="v4-alert ${alert.level}"><i class="fa-solid fa-${icon}"></i><div><strong>${escapeHTML(alert.title)}</strong><span>${escapeHTML(alert.detail)}</span></div></article>`;
  }).join('');
}

function renderHealth(appState, health) {
  const container = $('v41Health');
  if (!container) return;
  const tone = health.score >= 80 ? 'excellent' : health.score >= 65 ? 'solid' : health.score >= 45 ? 'warning' : 'danger';
  container.innerHTML = `<div class="v41-health-overview"><div class="v41-score-ring ${tone}" style="--score:${health.score}"><div><strong>${health.score}</strong><span>/ 100</span></div></div><div class="v41-health-copy"><span>Santé ${escapeHTML(health.label.toLowerCase())}</span><strong>${health.emergencyMonths.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mois de réserve</strong><small>${health.savingsRate.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}% de capacité d’épargne récente</small></div></div><div class="v41-breakdown">${health.breakdown.map(item => {
    const value = item.value === null ? 'À configurer' : item.unit === '%' ? `${item.value}%` : item.unit === 'mois' ? `${item.value} mois` : formatMoney(item.value, appState);
    const percent = Math.round((item.score / item.max) * 100);
    return `<article><div class="v41-metric-head"><strong>${escapeHTML(item.label)}</strong><span>${item.score}/${item.max}</span></div><div class="v4-progress"><span style="width:${percent}%"></span></div><div class="v41-metric-foot"><span>${escapeHTML(value)}</span><small>${escapeHTML(item.advice)}</small></div></article>`;
  }).join('')}</div>`;
}

function renderActionPlan(actions) {
  const container = $('v41Actions');
  if (!container) return;
  container.innerHTML = actions.map((action, index) => `<article class="v41-action ${action.priority}"><span class="v41-action-index">${index + 1}</span><i class="fa-solid fa-${escapeHTML(action.icon)}"></i><div><strong>${escapeHTML(action.title)}</strong><span>${escapeHTML(action.detail)}</span></div></article>`).join('');
}

function renderGoals(appState, account) {
  const container = $('v4Goals');
  if (!container) return;
  const goals = Array.isArray(account?.goals) ? account.goals : [];
  if (!goals.length) {
    container.innerHTML = '<p class="v4-empty">Aucun objectif. Ajoutez un projet comme un voyage, un achat ou un fonds d’urgence.</p>';
    return;
  }
  container.innerHTML = goals.map(goal => {
    const progress = goalProgress(goal);
    const deadline = goal.deadline ? `Échéance ${formatDate(goal.deadline)}` : 'Sans date limite';
    const advice = progress.overdue ? `Échéance dépassée · ${formatMoney(progress.remaining, appState)} restent à planifier` : progress.remaining > 0 ? `${formatMoney(progress.monthlyNeeded, appState)} par mois conseillés` : 'Objectif atteint, bravo !';
    return `<article class="v4-goal ${progress.overdue ? 'overdue' : ''}"><div class="v4-goal-head"><div><strong>${escapeHTML(goal.name)}</strong><span>${escapeHTML(deadline)}</span></div><span>${progress.percent}%</span></div><div class="v4-progress"><span style="width:${progress.percent}%"></span></div><div class="v4-goal-numbers"><span>${escapeHTML(formatMoney(progress.current, appState))} épargnés</span><span>${escapeHTML(formatMoney(progress.remaining, appState))} restants</span></div><small>${escapeHTML(advice)}</small><div class="v4-row-actions"><button type="button" class="btn btn-secondary btn-sm" data-v4-contribute="${escapeHTML(goal.id)}"><i class="fa-solid fa-plus"></i> Contribution</button><button type="button" class="btn-icon" data-v4-delete-goal="${escapeHTML(goal.id)}" aria-label="Supprimer l’objectif"><i class="fa-solid fa-trash"></i></button></div></article>`;
  }).join('');
  container.querySelectorAll('[data-v4-contribute]').forEach(button => button.addEventListener('click', () => contributeGoal(button.dataset.v4Contribute)));
  container.querySelectorAll('[data-v4-delete-goal]').forEach(button => button.addEventListener('click', () => deleteGoal(button.dataset.v4DeleteGoal)));
}

function renderEnvelopes(appState, account) {
  const container = $('v4Envelopes');
  if (!container) return;
  const entries = envelopeUsage(account, $('globalMonthPicker')?.value);
  if (!entries.length) {
    container.innerHTML = '<p class="v4-empty">Aucune enveloppe. Définissez par exemple 300 € pour les courses.</p>';
    return;
  }
  container.innerHTML = entries.map(item => {
    const capped = Math.min(100, Math.max(0, item.percent));
    const tone = item.percent >= 100 ? 'danger' : item.percent >= 80 ? 'warning' : 'success';
    return `<article class="v4-envelope"><div class="v4-envelope-head"><strong>${escapeHTML(item.category)}</strong><span class="${tone}">${item.percent}%</span></div><div class="v4-progress ${tone}"><span style="width:${capped}%"></span></div><div class="v4-goal-numbers"><span>${escapeHTML(formatMoney(item.used, appState))} utilisés</span><span>sur ${escapeHTML(formatMoney(item.limit, appState))}</span></div><button type="button" class="v4-text-button" data-v4-delete-envelope="${escapeHTML(item.category)}">Retirer cette enveloppe</button></article>`;
  }).join('');
  container.querySelectorAll('[data-v4-delete-envelope]').forEach(button => button.addEventListener('click', () => deleteEnvelope(button.dataset.v4DeleteEnvelope)));
}

function renderCalendar(appState, accounts, months) {
  const container = $('v4Calendar');
  if (!container) return;
  const account = currentAccount(appState);
  const visibleLimit = Math.max(15, Math.min(1000, Number(account?.plannerSettings?.calendarVisibleLimit) || 15));
  const events = financialCalendar(accounts, { days: Math.round(months * 30.5), limit: 1000 });
  const description = $('v4CalendarDescription');
  if (description) description.textContent = `Échéances prévues sur les ${months} prochains mois.`;
  if (!events.length) {
    container.innerHTML = `<p class="v4-empty">Aucune échéance prévue dans les ${months} prochains mois.</p>`;
    return;
  }
  const visibleEvents = events.slice(0, visibleLimit);
  container.innerHTML = visibleEvents.map(event => {
    const effect = transactionEffect(event);
    return `<article class="v4-calendar-item"><time datetime="${escapeHTML(event.date)}"><strong>${escapeHTML(new Date(`${event.date}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit' }))}</strong><span>${escapeHTML(new Date(`${event.date}T12:00:00`).toLocaleDateString('fr-FR', { month: 'short' }))}</span></time><div><strong>${escapeHTML(event.desc || event.category || 'Échéance')}</strong><span>${escapeHTML(event.accountName || '')}${event.source === 'recurring' ? ' · Récurrente' : ''}</span></div><b class="${effect >= 0 ? 'positive-text' : 'negative-text'}">${effect >= 0 ? '+' : ''}${escapeHTML(formatMoney(effect, appState))}</b></article>`;
  }).join('') + (events.length > visibleEvents.length
    ? `<button type="button" class="v4-text-button" data-v4-calendar-more>Afficher ${Math.min(15, events.length - visibleEvents.length)} échéance(s) suivante(s)</button>`
    : '');
  container.querySelector('[data-v4-calendar-more]')?.addEventListener('click', () => {
    if (!account) return;
    account.plannerSettings = { ...(account.plannerSettings || {}), calendarVisibleLimit: Math.min(1000, visibleLimit + 15) };
    window.saveData?.();
    render();
  });
}

function renderRecurringExpenseCosts(appState, accounts, months) {
  const container = $('v43RecurringExpenseCosts');
  if (!container) return;
  const costs = recurringExpenseCostByCategory(accounts, { months });
  if (!costs.length) {
    container.hidden = false;
    container.innerHTML = '<div class="v43-recurring-costs-head"><div><strong id="v43RecurringExpenseCostsTitle">Coût des dépenses récurrentes</strong><span>Aucune dépense récurrente à cumuler sur cette période.</span></div></div>';
    return;
  }
  container.hidden = false;
  container.innerHTML = `
    <div class="v43-recurring-costs-head">
      <div><strong id="v43RecurringExpenseCostsTitle">Coût des dépenses récurrentes</strong><span>Total par catégorie sur les ${months} prochains mois.</span></div>
    </div>
    <div class="v43-recurring-costs-list">
      ${costs.map(cost => `<article><div><strong>${escapeHTML(cost.category)}</strong><small>${cost.occurrences} échéance(s) · ${escapeHTML(formatMoney(cost.monthlyAverage, appState))} / mois en moyenne</small></div><b>${escapeHTML(formatMoney(cost.total, appState))}</b></article>`).join('')}
    </div>`;
}

function renderDailyProjection(appState, accounts) {
  const container = $('v44DailyProjection');
  if (!container) return;
  const currencies = [...new Set(accounts.map(account => String(account?.settings?.baseCurrency || 'EUR').toUpperCase()))];
  if (currencies.length > 1) {
    container.innerHTML = '<p class="v4-empty">La prévision quotidienne agrégée nécessite une même devise de base pour les comptes sélectionnés.</p>';
    return;
  }
  const code = currencies[0] || currency(appState);
  const horizonInput = $('v44DailyHorizon');
  const allowedHorizons = [14, 30, 60, 90];
  const horizon = allowedHorizons.includes(Number(horizonInput?.value)) ? Number(horizonInput.value) : 30;
  if (horizonInput && String(horizonInput.value) !== String(horizon)) horizonInput.value = String(horizon);
  const today = new Date();
  const todayISO = isoDate(today);
  let startMinor = 0;
  let startInvalid = false;
  accounts.forEach(account => {
    const parsed = parseAmount(String(accountBalance(account, today)), code, 'balance');
    if (!parsed?.ok || !Number.isSafeInteger(startMinor + parsed.minor)) startInvalid = true;
    else startMinor += parsed.minor;
  });
  if (startInvalid) {
    container.innerHTML = '<p class="v4-empty">Le solde de départ est invalide ; la prévision quotidienne est indisponible.</p>';
    return;
  }
  const calendar = financialCalendar(accounts, { from: today, days: horizon - 1, limit: 1000 });
  const flows = [];
  let invalidFlows = 0;
  calendar.forEach(event => {
    if (event.source === 'recurring') {
      const owner = accounts.find(account => String(account.id) === String(event.accountId));
      const key = recurringPeriodKey(event.date, event.frequency);
      const occurrenceExists = (owner?.transactions || []).some(transaction =>
        String(transaction.parentId || '') === String(event.id || '') &&
        (String(transaction.periodKey || '') === key || String(transaction.date || '') === String(event.date))
      );
      if (occurrenceExists) return;
    }
    // Le solde de départ comprend déjà les opérations réglées d’aujourd’hui.
    if (event.date === todayISO && event.source !== 'recurring' && event.paymentStatus !== 'planned') return;
    const effect = transactionEffect(event);
    const parsed = parseAmount(String(Math.abs(effect)), code, 'amount');
    if (!parsed?.ok) { invalidFlows += 1; return; }
    const amount = effect < 0 ? -parsed.minor : parsed.minor;
    if (!amount) return;
    flows.push({
      date: String(event.date),
      amount,
      label: `${event.desc || event.category || 'Échéance'}${event.accountName && accounts.length > 1 ? ` · ${event.accountName}` : ''}`,
      certain: event.source !== 'recurring' && event.paymentStatus !== 'planned'
    });
  });
  accounts.forEach(account => (account?.transactions || []).forEach(event => {
    if (event.paymentStatus !== 'planned' || !event.date || event.date >= todayISO) return;
    const effect = transactionEffect(event);
    const parsed = parseAmount(String(Math.abs(effect)), code, 'amount');
    if (!parsed?.ok) { invalidFlows += 1; return; }
    const amount = effect < 0 ? -parsed.minor : parsed.minor;
    if (!amount) return;
    flows.push({
      date: todayISO,
      amount,
      label: `En retard · ${event.desc || event.category || 'Opération planifiée'}${accounts.length > 1 ? ` · ${account.name || 'Compte'}` : ''}`,
      certain: false
    });
  }));
  const endDate = new Date(`${todayISO}T12:00:00`);
  endDate.setDate(endDate.getDate() + horizon - 1);
  const to = isoDate(endDate);
  let projection;
  try {
    projection = dailyProjection(startMinor, flows, { from: todayISO, to });
  } catch {
    container.innerHTML = '<p class="v4-empty">Un flux ou une date invalide empêche le calcul de la prévision quotidienne.</p>';
    return;
  }
  const estimatedCount = flows.filter(flow => flow.certain === false).length;
  const summary = [];
  if (projection.firstShortfall) {
    summary.push(`<strong style="color:#b91c1c">Risque de solde négatif le ${escapeHTML(formatDate(projection.firstShortfall.date))} : ${escapeHTML(formatMinor(projection.firstShortfall.need, code))} à couvrir.</strong>`);
  } else {
    summary.push('<strong style="color:#047857">Aucun solde négatif prévu sur cet horizon.</strong>');
  }
  if (projection.minimum) summary.push(`Point bas : ${escapeHTML(formatMinor(projection.minimum.balance, code))} le ${escapeHTML(formatDate(projection.minimum.date))}.`);
  if (estimatedCount) summary.push(`${estimatedCount} flux récurrent(s) estimé(s).`);
  if (projection.intradayOrderUnknown) summary.push('Plusieurs flux tombent le même jour ; les sorties sont placées avant les entrées par prudence.');
  if (calendar.length >= 1000) summary.push('La liste atteint la limite de 1 000 échéances sur la période.');
  if (invalidFlows) summary.push(`${invalidFlows} flux invalide(s) ignoré(s).`);
  const rows = projection.days.map(day => {
    const events = day.flows.slice(0, 3).map(flow => `${escapeHTML(flow.label)}: ${escapeHTML(formatMinor(flow.amount, code))}`).join('<br>') || 'Aucun mouvement prévu';
    const more = day.flows.length > 3 ? `<br>+ ${day.flows.length - 3} autre(s)` : '';
    return `<tr>
      <td><time datetime="${escapeHTML(day.date)}">${escapeHTML(formatDate(day.date))}</time></td>
      <td>${events}${more}${day.estimated ? '<br><span class="text-sm text-slate-500">Inclut une échéance estimée</span>' : ''}</td>
      <td class="text-right ${day.lowest < 0 ? 'negative-text' : ''}">${escapeHTML(formatMinor(day.lowest, code))}</td>
      <td class="text-right ${day.balance < 0 ? 'negative-text' : ''}">${escapeHTML(formatMinor(day.balance, code))}</td>
    </tr>`;
  }).join('');
  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap;margin-bottom:.75rem;">
      <div><strong>Prévision de trésorerie au jour le jour</strong><p class="text-sm text-slate-500" style="margin:.2rem 0 0">Opérations datées et récurrences connues. Les sorties d’une même journée sont comptées en premier.</p></div>
      <label class="text-sm">Horizon <select id="v44DailyHorizon" class="form-select" aria-label="Horizon de la prévision quotidienne" style="width:auto;display:inline-block"><option value="14">14 jours</option><option value="30">30 jours</option><option value="60">60 jours</option><option value="90">90 jours</option></select></label>
    </div>
    <div class="text-sm" role="status" aria-live="polite" style="display:grid;gap:.25rem;margin-bottom:.75rem;">${summary.map(item => `<div>${item}</div>`).join('')}</div>
    <div class="table-container" style="max-height:34rem;overflow:auto"><table class="table"><thead><tr><th>Jour</th><th>Mouvements</th><th class="text-right">Point bas</th><th class="text-right">Solde fin de journée</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  container.querySelector('#v44DailyHorizon')?.addEventListener('change', render);
  const renderedHorizon = container.querySelector('#v44DailyHorizon');
  if (renderedHorizon) renderedHorizon.value = String(horizon);
}

function incomeProfileMonths() {
  return Array.from({ length: 6 }, (_, index) => forecastMonth(-(index + 1)));
}

function medianInteger(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Number((BigInt(sorted[middle - 1]) + BigInt(sorted[middle]) + 1n) / 2n);
}

function incomeProfileFor(account) {
  const code = String(account?.settings?.baseCurrency || 'EUR').toUpperCase();
  account.plannerSettings = { ...(account.plannerSettings || {}) };
  const oldProfile = account.plannerSettings.incomeProfile || {};
  const profile = {
    coverageByMonth: oldProfile.coverageByMonth && typeof oldProfile.coverageByMonth === 'object' ? oldProfile.coverageByMonth : {},
    coefficientBps: Math.max(5000, Math.min(10000, Math.round(Number(oldProfile.coefficientBps) || 8000))),
    baseMode: oldProfile.baseMode === 'auto' ? 'auto' : 'manual',
    incomeBudgetBaseMinor: Number.isSafeInteger(oldProfile.incomeBudgetBaseMinor) ? oldProfile.incomeBudgetBaseMinor : null,
    baseCurrency: String(oldProfile.baseCurrency || code).toUpperCase(),
    suggestionSnapshotMinor: Number.isSafeInteger(oldProfile.suggestionSnapshotMinor) ? oldProfile.suggestionSnapshotMinor : null
  };
  account.plannerSettings.incomeProfile = profile;
  const months = incomeProfileMonths();
  const totals = new Map(months.map(month => [month, { eligible: 0, exceptional: 0, unclassified: 0, excluded: 0, expenses: 0, count: 0 }]));
  (account.transactions || []).forEach(transaction => {
    const month = String(transaction?.date || '').slice(0, 7);
    const row = totals.get(month);
    if (!row || transaction?.paymentStatus === 'planned') return;
    const rawAmount = Number(transaction.amountBase ?? transaction.amount);
    if (!Number.isFinite(rawAmount)) { row.invalid = true; return; }
    const parsed = parseAmount(String(Math.abs(rawAmount)), code, 'amount');
    if (!parsed?.ok) { row.invalid = true; return; }
    const amount = parsed.minor;
    if (transaction.type === 'expense') {
      if (!Number.isSafeInteger(row.expenses + amount)) row.invalid = true;
      else row.expenses += amount;
      return;
    }
    if (transaction.type !== 'income') return;
    const category = String(transaction.category || '').toLocaleLowerCase('fr');
    const refund = Boolean(transaction.fromSavings || transaction.linkedTransferId || transaction.transferId ||
      transaction.linkedDebtId || /rembours|refund/.test(category) || transaction.source === 'reimbursement');
    const add = field => {
      if (!Number.isSafeInteger(row[field] + amount)) { row.invalid = true; return; }
      row[field] += amount;
    };
    if (refund) { add('excluded'); return; }
    if (transaction.incomeClass === 'exceptional') { add('exceptional'); return; }
    if (transaction.incomeClass === 'regular' || transaction.incomeClass === 'variable') {
      add('eligible');
      row.count += 1;
    } else add('unclassified');
  });
  const covered = months.filter(month => profile.coverageByMonth[month] === true);
  const coveredTotals = covered.map(month => totals.get(month).eligible);
  const median = medianInteger(coveredTotals);
  const medianExpenses = medianInteger(covered.map(month => totals.get(month).expenses));
  const invalidCovered = covered.some(month => totals.get(month).invalid);
  const suggestedRaw = median === null ? null : Number((BigInt(median) * BigInt(profile.coefficientBps) + 5000n) / 10000n);
  const suggested = !invalidCovered && suggestedRaw !== null && Number.isSafeInteger(suggestedRaw) ? suggestedRaw : null;
  const currencyChanged = profile.baseCurrency !== code;
  const selected = currencyChanged ? null : profile.incomeBudgetBaseMinor;
  const remainingAfterObservedExpenses = selected === null || medianExpenses === null ? null : selected - medianExpenses;
  const envelopesMinor = Object.values(account.envelopes || {}).reduce((sum, value) => {
    const parsed = parseAmount(String(Number(value) || 0), code, 'amount');
    return parsed?.ok && Number.isSafeInteger(sum + parsed.minor) ? sum + parsed.minor : sum;
  }, 0);
  return { code, profile, months, totals, covered, median, medianExpenses, suggested, selected, remainingAfterObservedExpenses, currencyChanged, envelopesMinor, invalidCovered };
}

function renderIncomeProfile(appState, account) {
  const container = $('v44IncomeProfile');
  if (!container) return;
  const model = incomeProfileFor(account);
  const { code, profile, months, totals, covered, median, medianExpenses, suggested, selected, remainingAfterObservedExpenses, currencyChanged, envelopesMinor, invalidCovered } = model;
  const monthRows = months.map(month => {
    const row = totals.get(month);
    const label = new Date(`${month}-01T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    return `<label class="income-profile-month"><input type="checkbox" data-income-covered="${escapeHTML(month)}" ${covered.includes(month) ? 'checked' : ''}><span><strong>${escapeHTML(label)}</strong><small>Revenus retenus ${escapeHTML(formatMinor(row.eligible, code))} · dépenses observées ${escapeHTML(formatMinor(row.expenses, code))} · non classés ${escapeHTML(formatMinor(row.unclassified, code))}${row.exceptional ? ` · exceptionnels ${escapeHTML(formatMinor(row.exceptional, code))}` : ''}${row.excluded ? ` · remboursements / transferts exclus ${escapeHTML(formatMinor(row.excluded, code))}` : ''}${row.invalid ? ' · cumul hors limite, vérification requise' : ''}</small></span><span class="income-profile-coverage">Données suffisantes</span></label>`;
  }).join('');
  const canSuggest = covered.length >= 3 && suggested !== null && !currencyChanged;
  const selectedLabel = selected === null ? 'Aucune base retenue' : `${profile.baseMode === 'auto' ? 'Suggestion appliquée' : 'Base manuelle'} : ${formatMinor(selected, code)}`;
  const budgetShare = selected > 0 ? `${Math.round(envelopesMinor / selected * 100)} %` : '—';
  container.innerHTML = `<div class="v4-section-head"><div><h3>Base prudente des revenus</h3><p>Compte : ${escapeHTML(account.name || 'Compte')} · base de budget uniquement, sans revenu ajouté au solde.</p></div><strong>${escapeHTML(selectedLabel)}</strong></div>
    ${currencyChanged ? '<p class="income-profile-warning" role="status">La devise de base a changé. Confirmez une nouvelle base dans cette devise avant de la réutiliser.</p>' : ''}
    <p class="text-sm text-slate-500">Cochez uniquement les mois civils complets dont les données sont suffisamment couvertes. Les mois inconnus restent exclus ; un mois couvert sans revenu compte pour zéro.</p>
    <div class="income-profile-months">${monthRows}</div>
    <div class="income-profile-controls">
      <label><span>Coefficient prudent</span><select id="v44IncomeCoefficient" class="form-select"><option value="5000">50 %</option><option value="6000">60 %</option><option value="7000">70 %</option><option value="8000">80 %</option><option value="9000">90 %</option><option value="10000">100 %</option></select></label>
      <div class="income-profile-suggestion"><strong>Médiane des revenus retenus : ${median === null ? '—' : escapeHTML(formatMinor(median, code))}</strong><span>Suggestion : ${suggested === null ? '—' : escapeHTML(formatMinor(suggested, code))}${covered.length < 3 ? ' · au moins trois mois couverts sont nécessaires' : ''}${invalidCovered ? ' · un cumul dépasse la limite exacte, vérifiez les opérations' : ''}${selected !== null && profile.baseMode === 'auto' && suggested !== profile.suggestionSnapshotMinor ? ' · de nouvelles données suggèrent une révision, à confirmer' : ''}</span><span>Dépenses observées médianes : ${medianExpenses === null ? '—' : escapeHTML(formatMinor(medianExpenses, code))}${remainingAfterObservedExpenses === null ? '' : ` · écart de budget observé : ${escapeHTML(formatMinor(remainingAfterObservedExpenses, code))}`}</span></div>
      <button type="button" class="btn btn-secondary" data-income-apply-suggestion ${canSuggest ? '' : 'disabled'}>${profile.baseMode === 'auto' && selected !== null ? 'Mettre à jour avec la suggestion' : 'Appliquer la suggestion'}</button>
    </div>
    <form id="v44IncomeManualForm" class="income-profile-manual"><label for="v44IncomeManualBase">Base manuelle (${escapeHTML(code)})</label><input id="v44IncomeManualBase" class="form-input" type="text" inputmode="decimal" placeholder="Ex. 1 500,00" value="${profile.baseMode === 'manual' && selected !== null && !currencyChanged ? (selected / (10 ** minorDigits(code))).toFixed(minorDigits(code)).replace('.', ',') : ''}"><button type="submit" class="btn btn-primary">Enregistrer la base manuelle</button></form>
    <p class="text-sm text-slate-500">Les enveloppes actuelles représentent ${escapeHTML(budgetShare)} de cette base. L’écart avec les dépenses médianes est un repère de budget fondé sur les mois cochés, pas une prévision garantie. Les revenus exceptionnels, remboursements, virements et lignes non classées sont exclus de la suggestion. Le coefficient exprime une prudence choisie, pas une probabilité.</p>`;
  const coefficient = $('v44IncomeCoefficient');
  if (coefficient) coefficient.value = String(profile.coefficientBps);
}

function saveIncomeProfile(account) {
  window.saveData?.();
  window.renderAccountsSidebar?.();
  render();
}

function onIncomeProfileChange(event) {
  const account = currentAccount();
  if (!account) return;
  const model = incomeProfileFor(account);
  if (event.target?.matches('[data-income-covered]')) {
    model.profile.coverageByMonth[event.target.dataset.incomeCovered] = event.target.checked;
    saveIncomeProfile(account);
  } else if (event.target?.id === 'v44IncomeCoefficient') {
    const coefficient = Number(event.target.value);
    if (coefficient >= 5000 && coefficient <= 10000) model.profile.coefficientBps = coefficient;
    saveIncomeProfile(account);
  }
}

function onIncomeProfileClick(event) {
  if (!event.target?.closest('[data-income-apply-suggestion]')) return;
  const account = currentAccount();
  if (!account) return;
  const model = incomeProfileFor(account);
  if (model.covered.length < 3 || model.suggested === null || model.currencyChanged) return;
  model.profile.baseMode = 'auto';
  model.profile.incomeBudgetBaseMinor = model.suggested;
  model.profile.suggestionSnapshotMinor = model.suggested;
  model.profile.baseCurrency = model.code;
  saveIncomeProfile(account);
  notify('Base prudente appliquée au budget');
}

function onIncomeProfileSubmit(event) {
  if (event.target?.id !== 'v44IncomeManualForm') return;
  event.preventDefault();
  const account = currentAccount();
  if (!account) return;
  const model = incomeProfileFor(account);
  const parsed = parseAmount(String($('v44IncomeManualBase')?.value || ''), model.code, 'amount');
  if (!parsed?.ok) return notify('Saisissez une base manuelle valide', 'error');
  model.profile.baseMode = 'manual';
  model.profile.incomeBudgetBaseMinor = parsed.minor;
  model.profile.baseCurrency = model.code;
  model.profile.suggestionSnapshotMinor = null;
  saveIncomeProfile(account);
  notify('Base manuelle enregistrée');
}

export function render() {
  if (syncPlannerMaintenance()) return;
  const appState = state();
  const accounts = visibleAccounts(appState);
  const account = currentAccount(appState);
  if (!account) return;
  account.goals = Array.isArray(account.goals) ? account.goals : [];
  account.envelopes = account.envelopes && typeof account.envelopes === 'object' && !Array.isArray(account.envelopes) ? account.envelopes : {};
  account.plannerSettings = {
    forecastMonths: 6,
    projectionScope: 'complete',
    monthlyAdjustment: 0,
    incomeAdjustment: 0,
    expenseAdjustment: 0,
    oneTimeExpense: 0,
    oneTimeMonth: 1,
    ...(account.plannerSettings || {})
  };
  const months = Math.max(3, normalizeForecastMonths(account.plannerSettings.forecastMonths));
  account.plannerSettings.forecastMonths = months;
  const projectionScope = normalizeProjectionScope(account.plannerSettings.projectionScope);
  account.plannerSettings.projectionScope = projectionScope;
  const simulator = {
    monthlyAdjustment: Number(account.plannerSettings.monthlyAdjustment) || 0,
    incomeAdjustment: Math.max(0, Number(account.plannerSettings.incomeAdjustment) || 0),
    expenseAdjustment: Math.max(0, Number(account.plannerSettings.expenseAdjustment) || 0),
    oneTimeExpense: Math.max(0, Number(account.plannerSettings.oneTimeExpense) || 0),
    oneTimeMonth: Math.max(1, Math.min(months, Number(account.plannerSettings.oneTimeMonth) || 1))
  };
  const simulatorInputs = {
    v4Adjustment: simulator.monthlyAdjustment,
    v42IncomeAdjustment: simulator.incomeAdjustment,
    v42ExpenseAdjustment: simulator.expenseAdjustment,
    v42OneTimeExpense: simulator.oneTimeExpense
  };
  Object.entries(simulatorInputs).forEach(([id, value]) => {
    const input = $(id);
    if (input && document.activeElement !== input) input.value = String(value);
  });
  const oneTimeMonth = $('v42OneTimeMonth');
  if (oneTimeMonth) {
    oneTimeMonth.innerHTML = Array.from({ length: months }, (_, index) => `<option value="${index + 1}">${escapeHTML(monthLabel(forecastMonth(index + 1)))}</option>`).join('');
    oneTimeMonth.value = String(simulator.oneTimeMonth);
  }
  const projectionScopeInput = $('v43ProjectionScope');
  if (projectionScopeInput && document.activeElement !== projectionScopeInput) projectionScopeInput.value = projectionScope;
  const projectionDescription = $('v43ProjectionDescription');
  if (projectionDescription) projectionDescription.textContent = PROJECTION_DESCRIPTIONS[projectionScope];
  document.querySelectorAll('[data-v4-months]').forEach(button => button.classList.toggle('active', Number(button.dataset.v4Months) === months));
  const forecast = calculateForecast(accounts, { months, projectionScope, ...simulator });
  const intelligence = calculatePlannerIntelligence(accounts, { months, projectionScope, forecast, ...simulator });
  const evaluationInsight = buildPlannerEvaluationInsight(accounts);
  const alerts = buildSmartAlerts(accounts, { month: $('globalMonthPicker')?.value });
  const health = calculateFinancialHealth(accounts, { month: $('globalMonthPicker')?.value });
  const actions = buildActionPlan(accounts, { month: $('globalMonthPicker')?.value });
  renderSummary(appState, accounts, forecast, alerts);
  renderPlannerIntelligence(appState, intelligence, evaluationInsight);
  renderHealth(appState, health);
  renderActionPlan(actions);
  const startingBalance = accounts.reduce((sum, item) => sum + accountBalance(item, new Date()), 0);
  renderForecastInsights(appState, forecast, startingBalance);
  renderForecastBreakdown(appState, forecast);
  renderRecurringExpenseCosts(appState, accounts, months);
  renderForecastChart(appState, forecast, startingBalance, intelligence.bands);
  renderForecast(appState, forecast);
  renderDailyProjection(appState, accounts);
  renderIncomeProfile(appState, account);
  renderAlerts(appState, alerts);
  renderGoals(appState, account);
  renderEnvelopes(appState, account);
  renderCalendar(appState, accounts, months);
}

function forecastMonth(offset) {
  const date = new Date();
  return `${new Date(date.getFullYear(), date.getMonth() + Number(offset), 1, 12).getFullYear()}-${String(new Date(date.getFullYear(), date.getMonth() + Number(offset), 1, 12).getMonth() + 1).padStart(2, '0')}`;
}

function addGoal(event) {
  event.preventDefault();
  const appState = state();
  const account = currentAccount(appState);
  if (!account) return;
  const name = $('v4GoalName')?.value.trim();
  const target = Number($('v4GoalTarget')?.value);
  if (!name || !Number.isFinite(target) || target <= 0) return notify('Nom et montant d’objectif requis', 'error');
  account.goals = Array.isArray(account.goals) ? account.goals : [];
  account.goals.push({
    id: crypto.randomUUID?.() || `goal-${Date.now()}`,
    name,
    target: Math.round(target * 100) / 100,
    current: 0,
    deadline: $('v4GoalDeadline')?.value || '',
    createdAt: new Date().toISOString()
  });
  event.currentTarget.reset();
  persist();
  notify('Objectif ajouté');
}

function contributeGoal(id) {
  const account = currentAccount();
  const goal = account?.goals?.find(item => String(item.id) === String(id));
  if (!goal) return;
  const amount = Number(prompt(`Montant à ajouter à « ${goal.name} » :`, '50'));
  if (!Number.isFinite(amount) || amount <= 0) return;
  goal.current = Math.round(((Number(goal.current) || 0) + amount) * 100) / 100;
  persist();
  notify('Contribution enregistrée');
}

function deleteGoal(id) {
  const account = currentAccount();
  const goal = account?.goals?.find(item => String(item.id) === String(id));
  if (!goal || !confirm(`Supprimer l’objectif « ${goal.name} » ?`)) return;
  account.goals = account.goals.filter(item => String(item.id) !== String(id));
  persist();
  notify('Objectif supprimé', 'info');
}

function saveEnvelope(event) {
  event.preventDefault();
  const account = currentAccount();
  if (!account) return;
  const category = $('v4EnvelopeCategory')?.value.trim();
  const limit = Number($('v4EnvelopeLimit')?.value);
  if (!category || !Number.isFinite(limit) || limit <= 0) return notify('Catégorie et limite requises', 'error');
  account.envelopes = account.envelopes && typeof account.envelopes === 'object' ? account.envelopes : {};
  account.envelopes[category] = Math.round(limit * 100) / 100;
  event.currentTarget.reset();
  persist();
  notify('Enveloppe enregistrée');
}

function deleteEnvelope(category) {
  const account = currentAccount();
  if (!account?.envelopes || !confirm(`Retirer l’enveloppe « ${category} » ?`)) return;
  delete account.envelopes[category];
  persist();
  notify('Enveloppe retirée', 'info');
}

function setForecastMonths(months) {
  const account = currentAccount();
  if (!account) return;
  account.plannerSettings = {
    ...(account.plannerSettings || {}),
    forecastMonths: Math.max(3, normalizeForecastMonths(months)),
    calendarVisibleLimit: 15
  };
  window.saveData?.();
  render();
}

function setProjectionScope(value) {
  const account = currentAccount();
  if (!account) return;
  const projectionScope = normalizeProjectionScope(value);
  account.plannerSettings = { ...(account.plannerSettings || {}), projectionScope };
  window.saveData?.();
  render();
  notify('Contenu de la projection mis à jour');
}

function setSimulatorSettings() {
  const account = currentAccount();
  if (!account) return;
  const number = id => {
    const value = Number($(id)?.value);
    return Number.isFinite(value) ? value : 0;
  };
  account.plannerSettings = {
    ...(account.plannerSettings || {}),
    monthlyAdjustment: number('v4Adjustment'),
    incomeAdjustment: Math.max(0, number('v42IncomeAdjustment')),
    expenseAdjustment: Math.max(0, number('v42ExpenseAdjustment')),
    oneTimeExpense: Math.max(0, number('v42OneTimeExpense')),
    oneTimeMonth: Math.max(1, number('v42OneTimeMonth') || 1)
  };
  window.saveData?.();
  render();
}

function scheduleSimulatorUpdate() {
  clearTimeout(simulatorTimer);
  simulatorTimer = setTimeout(setSimulatorSettings, 180);
}

function applySimulatorPreset(preset) {
  const account = currentAccount();
  if (!account) return;
  const base = { ...(account.plannerSettings || {}) };
  if (preset === 'save') Object.assign(base, { monthlyAdjustment: 0, incomeAdjustment: 0, expenseAdjustment: 0, oneTimeExpense: 0 }, { incomeAdjustment: 200 });
  if (preset === 'unexpected') Object.assign(base, { monthlyAdjustment: 0, incomeAdjustment: 0, expenseAdjustment: 0, oneTimeExpense: 500, oneTimeMonth: 1 });
  if (preset === 'reset') Object.assign(base, { monthlyAdjustment: 0, incomeAdjustment: 0, expenseAdjustment: 0, oneTimeExpense: 0, oneTimeMonth: 1 });
  account.plannerSettings = base;
  window.saveData?.();
  render();
  notify(preset === 'reset' ? 'Simulation réinitialisée' : 'Simulation appliquée');
}

function downloadForecastCSV() {
  const appState = state();
  const account = currentAccount(appState);
  if (!account) return;
  const accounts = visibleAccounts(appState);
  const settings = { forecastMonths: 6, ...(account.plannerSettings || {}) };
  const forecast = calculateForecast(accounts, { months: Math.max(3, normalizeForecastMonths(settings.forecastMonths)), ...settings });
  const rows = [
    ['Mois', 'Tendance historique', 'Récurrences exactes', 'Transactions planifiées', 'Variation de base', 'Simulation mensuelle', 'Événement ponctuel', 'Variation totale', 'Solde prévu'],
    ...forecast.map(row => [row.month, row.historicalChange, row.recurringChange, row.scheduledChange, row.baselineChange, row.monthlySimulation, row.oneTimeAdjustment, row.change, row.balance])
  ];
  const csv = `\uFEFF${rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(';')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `freev-prevision-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
  notify('Prévision CSV téléchargée');
}

function openSearch() {
  const overlay = $('v4SearchOverlay');
  if (!overlay) return;
  overlay.hidden = false;
  document.body.classList.add('v4-modal-open');
  requestAnimationFrame(() => $('v4SearchInput')?.focus());
  renderSearch();
}

function closeSearch() {
  const overlay = $('v4SearchOverlay');
  if (overlay) overlay.hidden = true;
  document.body.classList.remove('v4-modal-open');
}

let searchPanel = null;

function getSearchPanel() {
  const input = $('v4SearchInput');
  const container = $('v4SearchResults');
  if (!input || !container) return null;
  if (!searchPanel) {
    searchPanel = createSearchPanel({
      input,
      container,
      getState: state,
      scopeAccounts: visibleAccounts,
      formatMoney,
      formatDate,
      onOpenEntry: entry => {
        closeSearch();
        window.switchAccount?.(entry.accountId);
        window.switchView?.('transactions');
      },
      // REC 01 : un raccourci ouvre l'écran, il ne lance jamais l'action (export, import…).
      onNavigate: destination => {
        closeSearch();
        window.switchView?.(destination.view);
        if (destination.anchor) {
          setTimeout(() => {
            const target = $(destination.anchor);
            if (!target) return;
            if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
            target.scrollIntoView({ block: 'start' });
            target.focus({ preventScroll: true });
          }, 80);
        }
      }
    });
  }
  return searchPanel;
}

function renderSearch() {
  getSearchPanel()?.update();
}

function showWhatsNew(force = false) {
  if (!force && localStorage.getItem(releaseKey()) === 'seen') return;
  const overlay = $('v4WhatsNew');
  if (!overlay) return;
  overlay.hidden = false;
  document.body.classList.add('v4-modal-open');
}

function closeWhatsNew(openPlanner = false) {
  localStorage.setItem(releaseKey(), 'seen');
  const overlay = $('v4WhatsNew');
  if (overlay) overlay.hidden = true;
  document.body.classList.remove('v4-modal-open');
  if (openPlanner) window.switchView?.('planner');
}

function bind() {
  if (initialized) return;
  initialized = true;
  $('v4GoalForm')?.addEventListener('submit', addGoal);
  $('v4EnvelopeForm')?.addEventListener('submit', saveEnvelope);
  $('v44IncomeProfile')?.addEventListener('change', onIncomeProfileChange);
  $('v44IncomeProfile')?.addEventListener('click', onIncomeProfileClick);
  $('v44IncomeProfile')?.addEventListener('submit', onIncomeProfileSubmit);
  document.querySelectorAll('[data-v4-months]').forEach(button => button.addEventListener('click', () => setForecastMonths(button.dataset.v4Months)));
  $('v43ProjectionScope')?.addEventListener('change', event => setProjectionScope(event.currentTarget.value));
  ['v4Adjustment', 'v42IncomeAdjustment', 'v42ExpenseAdjustment', 'v42OneTimeExpense']
    .forEach(id => $(id)?.addEventListener('input', scheduleSimulatorUpdate));
  $('v42OneTimeMonth')?.addEventListener('change', setSimulatorSettings);
  document.querySelectorAll('[data-v42-preset]').forEach(button => button.addEventListener('click', () => applySimulatorPreset(button.dataset.v42Preset)));
  $('v4SearchInput')?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderSearch, 100);
  });
  [$('v4SearchOverlay'), $('v4WhatsNew')].forEach(overlay => overlay?.addEventListener('click', event => {
    if (event.target !== overlay) return;
    if (overlay.id === 'v4SearchOverlay') closeSearch();
    else closeWhatsNew(false);
  }));
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openSearch();
    }
    if (event.key === 'Escape') {
      closeSearch();
      if (!$('v4WhatsNew')?.hidden) closeWhatsNew(false);
    }
  });
}

window.FreevV4 = { render, openSearch, closeSearch, showWhatsNew, closeWhatsNew, downloadForecastCSV };
document.addEventListener('DOMContentLoaded', bind, { once: true });
window.addEventListener('freev:ready', () => {
  bind();
  render();
});
