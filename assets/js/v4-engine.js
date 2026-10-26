// Freev Valeur 4.3 — moteur financier pur, sans dépendance au DOM.
// Garder les calculs ici permet de les tester et de les réutiliser sur mobile.
import { minorDigits, parseStoredAmount, parseTransactionBaseMinor } from './finance-core.mjs';
import { validateReconciliationAllocations } from './financial-matching-engine.mjs';
import { bookedAccountBalance, bookedAccountMonth, bookedAccountMonths } from './freev-account-core.mjs';
import { calculateForecastLedger, forecastMonthBalances } from './freev-ledger-bridge.mjs';

const DAY_MS = 86_400_000;
const ISO_DATE_PARTS = /^(\d{4})-(\d{2})-(\d{2})$/;
const PROJECTION_SCOPES = new Set(['recurring', 'recurring-scheduled', 'complete']);
const DEFAULT_FORECAST_MONTHS = 6;
const MIN_FORECAST_MONTHS = 1;
const MAX_FORECAST_MONTHS = 24;

export function normalizeProjectionScope(value) {
  return PROJECTION_SCOPES.has(value) ? value : 'complete';
}

export function normalizeForecastMonths(value, fallback = DEFAULT_FORECAST_MONTHS) {
  const months = Number(value);
  if (!Number.isFinite(months) || months < MIN_FORECAST_MONTHS) return fallback;
  return Math.min(MAX_FORECAST_MONTHS, Math.round(months));
}

export function toAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

export function localDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

export function isoDate(value = new Date()) {
  const date = localDate(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function monthKey(value = new Date()) {
  return isoDate(value).slice(0, 7);
}

export function addMonths(value, offset) {
  const date = localDate(value);
  return new Date(date.getFullYear(), date.getMonth() + Number(offset || 0), 1, 12);
}

export function transactionEffect(transaction) {
  const amount = toAmount(transaction?.amountBase ?? transaction?.amount);
  return transaction?.type === 'income' ? amount : -amount;
}

function validReconciliationDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Use persisted allocations only when the whole account batch is still valid.
// A stale/corrupt link must never make a planned cash flow disappear.
function buildReconciliationContext(account) {
  const allocations = Array.isArray(account?.reconciliationAllocations) ? account.reconciliationAllocations : [];
  const currency = String(account?.settings?.baseCurrency || 'EUR').toUpperCase();
  const empty = { currency, paidByObligation: new Map() };
  if (!allocations.length || !Array.isArray(account?.transactions)) return empty;

  const actuals = [], obligations = [];
  for (const transaction of account.transactions) {
    if (!transaction || transaction.projected || !['income', 'expense'].includes(transaction.type) ||
        !transaction.id || !validReconciliationDate(transaction.date)) continue;
    const amount = parseTransactionBaseMinor(transaction, currency);
    if (!amount.ok || amount.minor < 0) continue;
    const row = {
      id: String(transaction.id), accountId: String(account.id || ''), currency,
      direction: transaction.type, amountMinor: amount.minor, date: transaction.date,
      label: transaction.desc || transaction.category || ''
    };
    if (transaction.paymentStatus === 'planned') obligations.push(row);
    else actuals.push(row);
  }
  const result = validateReconciliationAllocations({ actuals, obligations, allocations, existingAllocations: [] });
  if (!result.ok) return empty;

  const paidByObligation = new Map();
  for (const allocation of result.allocations) {
    const total = (paidByObligation.get(allocation.obligationId) || 0n) + BigInt(allocation.amountMinor);
    paidByObligation.set(allocation.obligationId, total);
  }
  return { currency, paidByObligation };
}

function applyPlannedRemainder(transaction, context) {
  if (transaction?.paymentStatus !== 'planned' || !transaction?.id) return transaction;
  const paid = context?.paidByObligation?.get(String(transaction.id)) || 0n;
  if (paid <= 0n) return transaction;
  const currency = context.currency || 'EUR';
  const amount = parseTransactionBaseMinor(transaction, currency);
  if (!amount.ok || amount.minor < 0) return transaction;
  const remaining = BigInt(amount.minor) - paid;
  if (remaining < 0n) return transaction;
  if (remaining === 0n) return null;
  const scale = 10 ** minorDigits(currency);
  return {
    ...transaction,
    amountBase: Number(remaining) / scale,
    reconciliationPaidMinor: Number(paid),
    reconciliationRemainingMinor: Number(remaining)
  };
}

export function accountBalance(account, throughDate = null) {
  const dates = (account?.transactions || []).map(transaction => transaction?.date).filter(Boolean);
  const limit = throughDate ? isoDate(throughDate) : dates.sort().at(-1) || isoDate(new Date());
  return bookedAccountBalance(account, limit).amount;
}

/** Solde strict en unités minimales. Contrairement à accountBalance (API historique), une donnée invalide bloque le résultat. */
export function accountBalanceMinor(account, throughDate = null) {
  const currency = String(account?.settings?.baseCurrency || 'EUR').toUpperCase();
  const invalid = (code, message, field, transactionId = null) => ({
    ok: false,
    error: { code, message, field },
    ...(transactionId === null ? {} : { transactionId })
  });
  const isISODate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  let limit = null;
  if (throughDate != null) {
    if (throughDate instanceof Date && !Number.isFinite(throughDate.getTime())) {
      return invalid('invalid-date', 'Date de calcul invalide', 'throughDate');
    }
    limit = throughDate instanceof Date ? isoDate(throughDate) : String(throughDate).slice(0, 10);
    if (!isISODate(limit)) return invalid('invalid-date', 'Date de calcul invalide', 'throughDate');
  }
  const capitalValue = account?.initialCapital;
  const capital = parseStoredAmount(capitalValue == null || capitalValue === '' ? 0 : capitalValue, currency, 'initialCapital');
  if (!capital.ok) return capital;
  let balance = BigInt(capital.minor);
  for (const [index, transaction] of (Array.isArray(account?.transactions) ? account.transactions : []).entries()) {
    if (!transaction || transaction.paymentStatus === 'planned' || transaction.projected || transaction.isRecurring) continue;
    const id = String(transaction.id ?? index);
    if (!isISODate(transaction.date)) return invalid('invalid-date', 'Date d’opération invalide', `transactions.${id}.date`, transaction.id ?? null);
    if (limit && transaction.date > limit) continue;
    if (!['income', 'expense', 'transfer', 'savings_withdrawal', 'inter_account'].includes(transaction.type)) {
      return invalid('invalid-type', 'Type d’opération invalide', `transactions.${id}.type`, transaction.id ?? null);
    }
    const amount = parseTransactionBaseMinor(transaction, currency);
    if (!amount.ok) return amount;
    if (amount.minor < 0) return invalid('negative-transaction', 'Le montant doit être positif', `transactions.${id}.amount`, transaction.id ?? null);
    const sign = transaction.type === 'income' ? 1n : -1n;
    balance += sign * BigInt(amount.minor);
    if (balance > BigInt(Number.MAX_SAFE_INTEGER) || balance < -BigInt(Number.MAX_SAFE_INTEGER)) {
      return invalid('out-of-range', 'Solde hors limites', 'balance', transaction.id ?? null);
    }
  }
  return { ok: true, minor: Number(balance), currency, digits: minorDigits(currency) };
}

function historicalManualNet(account, today, months = 3) {
  const keys = Array.from({ length: months }, (_, index) => monthKey(addMonths(today, -(months - index))));
  const totals = bookedAccountMonths(account, keys, { excludeRecurringChildren: true }).map(row => row.net);
  return totals.length ? totals.reduce((sum, value) => sum + value, 0) / totals.length : 0;
}

function median(values) {
  const sorted = (values || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function recurringPeriodKey(dateISO, frequency = 'monthly') {
  // La plupart des appels du moteur passent déjà des dates ISO validées.
  // Éviter de construire une Date pour les périodes mensuelles et annuelles.
  if (typeof dateISO === 'string') {
    const parts = ISO_DATE_PARTS.exec(dateISO);
    if (parts) {
      const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]) {
        if (frequency === 'yearly') return parts[1];
        if (frequency !== 'weekly') return `${parts[1]}-${parts[2]}`;
      }
    }
  }
  const date = localDate(dateISO);
  if (frequency === 'weekly') {
    const cursor = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNumber = cursor.getUTCDay() || 7;
    cursor.setUTCDate(cursor.getUTCDate() + 4 - dayNumber);
    const yearStart = new Date(Date.UTC(cursor.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((cursor - yearStart) / DAY_MS) + 1) / 7);
    return `${cursor.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  if (frequency === 'yearly') return String(date.getFullYear());
  return isoDate(date).slice(0, 7);
}

export function recurringDates(rule, from, until) {
  const start = localDate(rule?.startDate || from);
  const cursor = new Date(Math.max(start.getTime(), from.getTime()));
  const dates = [];
  const max = 200;
  const frequency = ['weekly', 'yearly'].includes(rule?.frequency) ? rule.frequency : 'monthly';
  const skipped = new Set(Array.isArray(rule?.skippedPeriods) ? rule.skippedPeriods : []);
  const effectiveEndDate = String(rule?.subscription?.effectiveEndDate || '');
  const append = candidate => {
    const date = isoDate(candidate);
    if (!skipped.has(recurringPeriodKey(date, frequency)) &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveEndDate) || date <= effectiveEndDate)) dates.push(date);
  };

  if (frequency === 'weekly') {
    while (cursor.getDay() !== start.getDay()) cursor.setDate(cursor.getDate() + 1);
    while (cursor <= until && dates.length < max) {
      append(cursor);
      cursor.setDate(cursor.getDate() + 7);
    }
    return dates;
  }

  const startMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12);
  for (let month = startMonth; month <= until && dates.length < max; month = addMonths(month, 1)) {
    if (frequency === 'yearly' && month.getMonth() !== start.getMonth()) continue;
    const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const day = Math.min(Number(rule?.dayOfMonth) || start.getDate(), lastDay);
    const candidate = new Date(month.getFullYear(), month.getMonth(), day, 12);
    if (candidate >= from && candidate <= until && candidate >= start) append(candidate);
  }
  return dates;
}

function recurringTransactionForDate(account, rule, date, reconciliationContext = null) {
  const key = recurringPeriodKey(date, rule?.frequency);
  const stored = (account?.transactions || []).find(transaction =>
    String(transaction?.parentId || '') === String(rule?.id || '') &&
    (String(transaction?.periodKey || '') === key || String(transaction?.date || '') === date)
  );
  if (stored) return applyPlannedRemainder(stored, reconciliationContext || buildReconciliationContext(account));
  const versions = (Array.isArray(rule?.rateVersions) ? rule.rateVersions : [])
    .filter(version => /^\d{4}-\d{2}-\d{2}$/.test(String(version?.effectiveFrom || '')) &&
      version.effectiveFrom <= date && Number.isFinite(Number(version?.amountBase)) && Number(version.amountBase) > 0)
    .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));
  return versions.length ? { ...rule, ...versions.at(-1) } : rule;
}

function recurringNetForMonth(account, month, reconciliationContext = buildReconciliationContext(account)) {
  const [year, monthNumber] = String(month).split('-').map(Number);
  const from = new Date(year, monthNumber - 1, 1, 12);
  const until = new Date(year, monthNumber, 0, 12);
  return (account?.recurringTransactions || []).reduce((sum, rule) => {
    const occurrences = recurringDates(rule, from, until);
    return sum + occurrences.reduce((subtotal, date) => subtotal + transactionEffect(recurringTransactionForDate(account, rule, date, reconciliationContext)), 0);
  }, 0);
}

// Cumul des dépenses récurrentes, aligné exactement sur les mois de la prévision.
export function recurringExpenseCostByCategory(accounts, options = {}) {
  const source = Array.isArray(accounts) ? accounts : [];
  const months = normalizeForecastMonths(options.months);
  const today = localDate(options.today || new Date());
  const from = addMonths(today, 1);
  const until = new Date(today.getFullYear(), today.getMonth() + months + 1, 0, 12);
  const totals = new Map();

  source.forEach(account => {
    const reconciliationContext = buildReconciliationContext(account);
    (account?.recurringTransactions || []).forEach(rule => {
    recurringDates(rule, from, until).forEach(date => {
      const transaction = recurringTransactionForDate(account, rule, date, reconciliationContext);
      const effect = transactionEffect(transaction);
      if (effect >= 0) return;
      const category = String(transaction?.category || rule?.category || 'Sans catégorie').trim() || 'Sans catégorie';
      const current = totals.get(category) || { category, total: 0, occurrences: 0 };
      current.total = toAmount(current.total + Math.abs(effect));
      current.occurrences += 1;
      totals.set(category, current);
    });
    });
  });

  return [...totals.values()]
    .map(item => ({ ...item, monthlyAverage: toAmount(item.total / months) }))
    .sort((left, right) => right.total - left.total || left.category.localeCompare(right.category, 'fr'));
}

export function calculateForecast(accounts, options = {}) {
  const source = Array.isArray(accounts) ? accounts : [];
  const months = normalizeForecastMonths(options.months);
  const today = localDate(options.today || new Date());
  const todayISO = isoDate(today);
  const projectionScope = normalizeProjectionScope(options.projectionScope);
  const includeHistory = projectionScope === 'complete';
  const includeScheduled = projectionScope !== 'recurring';
  // `monthlyAdjustment` reste pris en charge pour les données créées en 4.1.
  const adjustment = toAmount(options.monthlyAdjustment);
  const incomeAdjustment = Math.max(0, toAmount(options.incomeAdjustment));
  const expenseAdjustment = Math.max(0, toAmount(options.expenseAdjustment));
  const oneTimeExpense = Math.max(0, toAmount(options.oneTimeExpense));
  const oneTimeMonth = Math.max(1, Math.min(months, Number(options.oneTimeMonth) || 1));
  const reconciliationContexts = new Map(source.map(account => [account, buildReconciliationContext(account)]));
  const startingBalance = toAmount(source.reduce((sum, account) => sum + accountBalance(account, today), 0));

  const historicalChange = includeHistory
    ? source.reduce((sum, account) => sum + historicalManualNet(account, today, 3), 0)
    : 0;

  const rows = Array.from({ length: months }, (_, index) => {
    const date = addMonths(today, index + 1);
    const key = monthKey(date);
    const scheduled = includeScheduled
      ? source.reduce((sum, account) => {
        const reconciliationContext = reconciliationContexts.get(account);
        return sum + (account?.transactions || []).reduce((subtotal, transaction) => {
        const dateISO = String(transaction?.date || '');
        if (dateISO <= todayISO || dateISO.slice(0, 7) !== key || transaction?.parentId) return subtotal;
        const remaining = applyPlannedRemainder(transaction, reconciliationContext);
        return subtotal + (remaining ? transactionEffect(remaining) : 0);
      }, 0);
      }, 0)
      : 0;
    const recurringChange = source.reduce((sum, account) =>
      sum + recurringNetForMonth(account, key, reconciliationContexts.get(account)), 0);
    const monthlySimulation = toAmount(adjustment + incomeAdjustment - expenseAdjustment);
    const oneTimeAdjustment = index + 1 === oneTimeMonth ? -oneTimeExpense : 0;
    const baselineChange = toAmount(historicalChange + recurringChange + scheduled);
    const change = toAmount(baselineChange + monthlySimulation + oneTimeAdjustment);
    return {
      month: key,
      change,
      baselineChange,
      historicalChange: toAmount(historicalChange),
      recurringChange: toAmount(recurringChange),
      scheduledChange: toAmount(scheduled),
      monthlySimulation,
      oneTimeAdjustment,
      projectionScope,
      projected: true
    };
  });
  if (!rows.length) return rows;
  const currency = String(source[0]?.settings?.baseCurrency || 'EUR').toUpperCase();
  const scale = 10 ** minorDigits(currency);
  const toMinor = value => {
    const parsed = parseStoredAmount(value, currency, 'forecast');
    if (!parsed.ok) throw new RangeError(parsed.error.message);
    return parsed.minor;
  };
  const last = rows.at(-1).month;
  const lastDate = isoDate(new Date(Number(last.slice(0, 4)), Number(last.slice(5, 7)), 0));
  const flows = rows.map((row, index) => {
    const amountMinor = toMinor(Math.abs(row.change));
    const date = isoDate(new Date(Number(row.month.slice(0, 4)), Number(row.month.slice(5, 7)), 0));
    return { id: `planner:${index}`, date, type: row.change < 0 ? 'expense' : 'income', amountMinor };
  });
  const ledger = calculateForecastLedger(flows, { openingDate: todayISO, throughDate: lastDate,
    openingBalanceMinor: toMinor(startingBalance) });
  const balances = forecastMonthBalances(ledger, rows[0].month, rows.length);
  return rows.map((row, index) => ({ ...row, balance: balances[index].closingBalanceMinor / scale }));
}

export function summarizeForecast(forecast, startingBalance = 0) {
  const rows = Array.isArray(forecast) ? forecast.filter(row => Number.isFinite(Number(row?.balance))) : [];
  const start = toAmount(startingBalance);
  if (!rows.length) {
    return {
      startingBalance: start,
      finalBalance: start,
      totalChange: 0,
      lowestBalance: start,
      lowestMonth: null,
      firstNegativeMonth: null,
      bestMonth: null,
      worstMonth: null,
      trend: 'stable'
    };
  }

  const lowest = rows.reduce((current, row) => Number(row.balance) < Number(current.balance) ? row : current, rows[0]);
  const best = rows.reduce((current, row) => Number(row.change) > Number(current.change) ? row : current, rows[0]);
  const worst = rows.reduce((current, row) => Number(row.change) < Number(current.change) ? row : current, rows[0]);
  const finalBalance = toAmount(rows.at(-1).balance);
  const totalChange = toAmount(finalBalance - start);
  return {
    startingBalance: start,
    finalBalance,
    totalChange,
    lowestBalance: toAmount(lowest.balance),
    lowestMonth: lowest.month,
    firstNegativeMonth: rows.find(row => Number(row.balance) < 0)?.month || null,
    bestMonth: { month: best.month, change: toAmount(best.change) },
    worstMonth: { month: worst.month, change: toAmount(worst.change) },
    trend: totalChange > 0 ? 'up' : totalChange < 0 ? 'down' : 'stable'
  };
}

export function goalProgress(goal, today = new Date()) {
  const target = Math.max(0, toAmount(goal?.target));
  const current = Math.max(0, toAmount(goal?.current));
  const remaining = Math.max(0, toAmount(target - current));
  const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const deadline = goal?.deadline ? localDate(goal.deadline) : null;
  const daysLeft = deadline ? Math.ceil((deadline.getTime() - localDate(today).getTime()) / DAY_MS) : null;
  const overdue = daysLeft !== null && daysLeft < 0 && remaining > 0;
  const monthsLeft = daysLeft === null ? null : overdue ? 0 : Math.max(1, Math.ceil(daysLeft / 30.44));
  const monthlyNeeded = monthsLeft ? toAmount(remaining / monthsLeft) : remaining;
  return { target, current, remaining, percent, daysLeft, monthsLeft, monthlyNeeded, overdue };
}

export function envelopeUsage(account, month = monthKey()) {
  const budgets = account?.envelopes && typeof account.envelopes === 'object' && !Array.isArray(account.envelopes)
    ? account.envelopes
    : account?.budgetsByCategory || {};
  const spent = (account?.transactions || []).reduce((map, transaction) => {
    if (transaction?.type === 'income' || transaction?.paymentStatus === 'planned' || String(transaction?.date || '').slice(0, 7) !== month) return map;
    const category = String(transaction?.category || 'Autre');
    map[category] = toAmount((map[category] || 0) + Math.abs(transactionEffect(transaction)));
    return map;
  }, {});

  return Object.entries(budgets).map(([category, rawLimit]) => {
    const limit = Math.max(0, toAmount(rawLimit));
    const used = spent[category] || 0;
    const percent = limit > 0 ? Math.round((used / limit) * 100) : 0;
    return { category, limit, used, remaining: toAmount(limit - used), percent };
  }).sort((a, b) => b.percent - a.percent);
}

export function financialCalendar(accounts, options = {}) {
  const source = Array.isArray(accounts) ? accounts : [];
  const from = localDate(options.from || new Date());
  const requestedDays = Number(options.days);
  const days = Number.isFinite(requestedDays) && requestedDays >= 7
    ? Math.min(732, Math.round(requestedDays))
    : 90;
  const requestedLimit = Number(options.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(1000, Math.round(requestedLimit))
    : 80;
  const until = new Date(from.getTime() + days * DAY_MS);
  const fromISO = isoDate(from);
  const untilISO = isoDate(until);
  const events = [];

  source.forEach(account => {
    const reconciliationContext = buildReconciliationContext(account);
    (account?.transactions || []).forEach(transaction => {
      const date = String(transaction?.date || '');
      if (date >= fromISO && date <= untilISO) {
        const remaining = applyPlannedRemainder(transaction, reconciliationContext);
        if (remaining) events.push({ ...remaining, accountId: account.id, accountName: account.name, source: 'transaction' });
      }
    });
      (account?.recurringTransactions || []).forEach(rule => {
      recurringDates(rule, from, until).forEach(date => {
        const alreadyExists = (account?.transactions || []).some(transaction =>
          String(transaction?.parentId || '') === String(rule?.id || '') && transaction?.date === date
        );
          if (!alreadyExists) {
            const projected = recurringTransactionForDate(account, rule, date, reconciliationContext);
            if (projected) events.push({ ...projected, date, accountId: account.id, accountName: account.name, source: 'recurring' });
          }
      });
    });
  });
  return events.sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, limit);
}

export function searchTransactions(accounts, query, limit = 50) {
  const terms = String(query || '').toLocaleLowerCase('fr').trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const results = [];
  (Array.isArray(accounts) ? accounts : []).forEach(account => {
    (account?.transactions || []).forEach(transaction => {
      const haystack = [transaction?.desc, transaction?.category, transaction?.type, transaction?.date,
        ...(Array.isArray(transaction?.tags) ? transaction.tags : []), account?.name]
        .join(' ').toLocaleLowerCase('fr');
      if (terms.every(term => haystack.includes(term))) results.push({ ...transaction, accountId: account.id, accountName: account.name });
    });
  });
  return results.sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, limit);
}

export function buildSmartAlerts(accounts, options = {}) {
  const source = Array.isArray(accounts) ? accounts : [];
  const month = options.month || monthKey(options.today || new Date());
  const lowBalance = toAmount(options.lowBalance ?? 100);
  const alerts = [];

  source.forEach(account => {
    const balance = accountBalance(account, options.today || new Date());
    if (balance < 0) alerts.push({ level: 'danger', accountId: account.id, title: `${account.name} est à découvert`, detail: `Solde actuel : ${balance}` });
    else if (balance < lowBalance) alerts.push({ level: 'warning', accountId: account.id, title: `Solde faible sur ${account.name}`, detail: `Solde actuel : ${balance}` });

    envelopeUsage(account, month).forEach(envelope => {
      if (envelope.percent >= 100) alerts.push({ level: 'danger', accountId: account.id, title: `Budget ${envelope.category} dépassé`, detail: `${envelope.used} sur ${envelope.limit}` });
      else if (envelope.percent >= 80) alerts.push({ level: 'warning', accountId: account.id, title: `Budget ${envelope.category} bientôt atteint`, detail: `${envelope.percent}% utilisé` });
    });

    const expenses = (account?.transactions || []).filter(transaction =>
      transaction?.type !== 'income' && String(transaction?.date || '').slice(0, 7) === month
    ).map(transaction => Math.abs(transactionEffect(transaction)));
    if (expenses.length >= 5) {
      const typical = median(expenses);
      const deviation = median(expenses.map(value => Math.abs(value - typical)));
      const threshold = Math.max(100, typical * 2.5, typical + deviation * 4);
      const unusual = (account?.transactions || []).filter(transaction =>
        transaction?.type !== 'income' && String(transaction?.date || '').slice(0, 7) === month
      ).sort((first, second) => Math.abs(transactionEffect(second)) - Math.abs(transactionEffect(first)))
        .find(transaction => Math.abs(transactionEffect(transaction)) > threshold);
      if (unusual) alerts.push({ level: 'info', accountId: account.id, title: 'Dépense inhabituelle détectée', detail: unusual.desc || unusual.category || 'Transaction' });
    }
  });
  return alerts.slice(0, 12);
}

function recentMonthlyStats(accounts, today = new Date(), months = 3) {
  const source = Array.isArray(accounts) ? accounts : [];
  const keys = Array.from({ length: months }, (_, index) => monthKey(addMonths(today, -(index + 1))));
  const byAccount = source.map(account => bookedAccountMonths(account, keys));
  const totals = keys.map((_, index) =>
    byAccount.reduce((result, rows) => {
      const booked = rows[index];
      result.income += booked.income;
      result.expenses += booked.expenses;
      return result;
    }, { income: 0, expenses: 0 }));
  const divisor = Math.max(1, totals.length);
  return {
    income: toAmount(totals.reduce((sum, item) => sum + item.income, 0) / divisor),
    expenses: toAmount(totals.reduce((sum, item) => sum + item.expenses, 0) / divisor)
  };
}

function completedMonthlySeries(accounts, today = new Date(), months = 6) {
  const source = Array.isArray(accounts) ? accounts : [];
  const keys = Array.from({ length: months }, (_, index) => monthKey(addMonths(today, -(months - index))));
  const byAccount = source.map(account => bookedAccountMonths(account, keys));
  return keys.map((month, index) => {
    return byAccount.reduce((result, rows) => {
      const booked = rows[index];
      result.income += booked.income;
      result.expenses += booked.expenses;
      result.transactions += booked.transactions;
      return result;
    }, { month, income: 0, expenses: 0, transactions: 0, net: 0 });
  }).map(row => ({
    ...row,
    income: toAmount(row.income),
    expenses: toAmount(row.expenses),
    net: toAmount(row.income - row.expenses)
  }));
}

/**
 * ALX 07 — sépare les échéances réellement connues des habitudes observées.
 * Les montants restent en unités minimales ; les écritures récurrentes sont
 * exclues de l'historique puis comptées une seule fois via leurs règles.
 */
export function estimateNextMonthExpenses(accounts, options = {}) {
  const source = Array.isArray(accounts) ? accounts : [];
  const today = localDate(options.today || new Date());
  const targetStart = addMonths(today, 1);
  const targetMonth = monthKey(targetStart);
  const targetEnd = new Date(targetStart.getFullYear(), targetStart.getMonth() + 1, 0, 12);
  const accountCurrencies = [...new Set(source.map(account => String(account?.settings?.baseCurrency || 'EUR').toUpperCase()))];
  if (accountCurrencies.length > 1) {
    return { ok: false, reason: 'mixed-currencies', targetMonth, currency: null, totalMinor: null, habitualMinor: null, committedMinor: null, categories: [], coveredMonths: 0, incompleteRecords: 0 };
  }
  const currency = accountCurrencies[0] || String(options.currency || 'EUR').toUpperCase();
  const months = Array.from({ length: 24 }, (_, index) => monthKey(addMonths(today, -(24 - index))));
  const monthTotals = new Map(months.map(month => [month, { covered: false, byCategory: new Map() }]));
  let incompleteRecords = 0;
  const medianMinor = values => {
    const sorted = values.filter(Number.isSafeInteger).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const middle = sorted.length >> 1;
    if (sorted.length % 2) return sorted[middle];
    return Number((BigInt(sorted[middle - 1]) + BigInt(sorted[middle]) + 1n) / 2n);
  };
  const isValidDate = value => {
    const date = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const parsed = new Date(`${date}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  };
  const addMinor = (map, key, amount) => {
    const previous = map.get(key) || 0n;
    const next = previous + BigInt(amount);
    if (next > BigInt(Number.MAX_SAFE_INTEGER)) return false;
    map.set(key, next);
    return true;
  };

  for (const account of source) {
    for (const transaction of Array.isArray(account?.transactions) ? account.transactions : []) {
      if (transaction?.projected || transaction?.paymentStatus === 'planned') continue;
      const month = String(transaction?.date || '').slice(0, 7);
      const bucket = monthTotals.get(month);
      if (!bucket) continue;
      bucket.covered = true;
      if (transaction?.type !== 'expense' || transaction?.isRecurring || transaction?.parentId) continue;
      if (!isValidDate(transaction.date)) { incompleteRecords += 1; continue; }
      const parsed = parseTransactionBaseMinor(transaction, currency);
      if (!parsed.ok || !Number.isSafeInteger(parsed.minor) || parsed.minor < 0) { incompleteRecords += 1; continue; }
      const category = String(transaction.category || '').trim() || 'Sans catégorie';
      if (!addMinor(bucket.byCategory, category, parsed.minor)) incompleteRecords += 1;
    }
  }

  const coveredMonths = months.filter(month => monthTotals.get(month)?.covered);
  const habitual = new Map();
  const categories = new Set(months.flatMap(month => [...monthTotals.get(month).byCategory.keys()]));
  for (const category of categories) {
    const samples = coveredMonths.map(month => Number(monthTotals.get(month).byCategory.get(category) || 0n));
    const positive = samples.filter(value => value > 0);
    if (positive.length < 2 || coveredMonths.length < 3) continue;
    const comparable = months.filter(month => month.slice(5, 7) === targetMonth.slice(5, 7) && monthTotals.get(month).covered)
      .map(month => Number(monthTotals.get(month).byCategory.get(category) || 0n)).filter(value => value > 0);
    const positiveMedian = medianMinor(positive);
    const monthlyRate = Number((BigInt(positiveMedian) * BigInt(positive.length) + BigInt(Math.floor(coveredMonths.length / 2))) / BigInt(coveredMonths.length));
    const estimate = comparable.length >= 2 ? medianMinor(comparable) : monthlyRate;
    if (Number.isSafeInteger(estimate) && estimate > 0) {
      habitual.set(category, {
        category, habitualMinor: estimate, committedMinor: 0,
        method: comparable.length >= 2 ? 'seasonal' : 'observed',
        samples: comparable.length >= 2 ? comparable.length : positive.length
      });
    }
  }

  const committed = new Map();
  const addCommitted = (category, transaction, account) => {
    const amount = parseTransactionBaseMinor(transaction, currency);
    if (!amount.ok || amount.minor < 0) { incompleteRecords += 1; return; }
    const name = String(category || transaction?.category || '').trim() || 'Sans catégorie';
    if (!addMinor(committed, name, amount.minor)) incompleteRecords += 1;
  };
  for (const account of source) {
    for (const rule of Array.isArray(account?.recurringTransactions) ? account.recurringTransactions : []) {
      const dates = recurringDates(rule, targetStart, targetEnd);
      for (const date of dates) {
        const transaction = recurringTransactionForDate(account, rule, date);
        if (transaction?.type !== 'expense') continue;
        addCommitted(transaction.category || rule.category, transaction, account);
      }
    }
    for (const transaction of Array.isArray(account?.transactions) ? account.transactions : []) {
      if (transaction?.type !== 'expense' || transaction?.paymentStatus !== 'planned' || transaction?.parentId) continue;
      if (!isValidDate(transaction.date) || String(transaction.date).slice(0, 7) !== targetMonth) continue;
      addCommitted(transaction.category, transaction, account);
    }
  }

  const allCategories = new Set([...habitual.keys(), ...committed.keys()]);
  const rows = [...allCategories].map(category => {
    const observed = habitual.get(category);
    const plannedMinor = Number(committed.get(category) || 0n);
    const historicalMinor = observed?.habitualMinor || 0;
    const categoryTotal = BigInt(historicalMinor) + BigInt(plannedMinor);
    if (categoryTotal > BigInt(Number.MAX_SAFE_INTEGER)) { incompleteRecords += 1; return null; }
    return {
      category,
      habitualMinor: historicalMinor,
      committedMinor: plannedMinor,
      totalMinor: Number(categoryTotal),
      method: observed?.method || 'known',
      samples: observed?.samples || 0
    };
  }).filter(row => row && row.totalMinor > 0)
    .sort((a, b) => b.totalMinor - a.totalMinor || a.category.localeCompare(b.category, 'fr'));
  const habitualTotal = rows.reduce((sum, row) => sum + BigInt(row.habitualMinor), 0n);
  const committedTotal = rows.reduce((sum, row) => sum + BigInt(row.committedMinor), 0n);
  const totalMinor = habitualTotal + committedTotal;
  const valid = [habitualTotal, committedTotal, totalMinor].every(value => value <= BigInt(Number.MAX_SAFE_INTEGER));
  return {
    ok: valid,
    reason: valid ? (coveredMonths.length < 3 ? 'insufficient-history' : null) : 'out-of-range',
    targetMonth,
    currency,
    totalMinor: valid ? Number(totalMinor) : null,
    habitualMinor: valid ? Number(habitualTotal) : null,
    committedMinor: valid ? Number(committedTotal) : null,
    categories: rows,
    coveredMonths: coveredMonths.length,
    seasonalCategories: rows.filter(row => row.method === 'seasonal').length,
    incompleteRecords
  };
}

export function calculatePlannerIntelligence(accounts, options = {}) {
  const source = Array.isArray(accounts) ? accounts : [];
  const today = localDate(options.today || new Date());
  const months = Math.max(3, normalizeForecastMonths(options.months));
  const forecast = Array.isArray(options.forecast)
    ? options.forecast
    : calculateForecast(source, { ...options, months, today });
  const startingBalance = toAmount(source.reduce((sum, account) => sum + accountBalance(account, today), 0));
  const summary = summarizeForecast(forecast, startingBalance);
  const history = completedMonthlySeries(source, today, 6);
  const activeMonths = history.filter(row => row.transactions > 0).length;
  const transactionCount = history.reduce((sum, row) => sum + row.transactions, 0);
  const recent = recentMonthlyStats(source, today, 3);
  const savings = source.reduce((sum, account) => sum + Object.values(account?.savingsAccounts || {})
    .reduce((subtotal, value) => subtotal + Math.max(0, toAmount(value)), 0), 0);
  const availableReserve = Math.max(0, startingBalance) + savings;
  const runwayMonths = recent.expenses > 0 ? toAmount(availableReserve / recent.expenses) : null;
  const safetyTarget = Math.max(0, toAmount(options.safetyTarget ?? recent.expenses));
  const safetyShortfall = Math.max(0, toAmount(safetyTarget - summary.lowestBalance));
  const recommendedMonthlyAdjustment = safetyShortfall > 0
    ? Math.ceil((safetyShortfall / months) / 10) * 10
    : 0;
  const netValues = history.filter(row => row.transactions > 0).map(row => row.net);
  const netMedian = median(netValues);
  const medianAbsoluteDeviation = median(netValues.map(value => Math.abs(value - netMedian)));
  const volatility = activeMonths >= 2 ? toAmount(1.4826 * medianAbsoluteDeviation) : null;
  // A scenario range is shown only with at least four observed months. It is not a probability interval.
  const bands = activeMonths >= 4 ? forecast.map((row, index) => {
    const uncertainty = (volatility || 0) * Math.sqrt(index + 1);
    return {
      month: row.month,
      base: toAmount(row.balance),
      optimistic: toAmount(row.balance + uncertainty),
      stress: toAmount(row.balance - uncertainty),
      status: 'uncalibrated-scenario'
    };
  }) : [];
  const risk = summary.firstNegativeMonth
    ? { level: 'danger', label: 'Solde négatif prévu', detail: `La projection actuelle passe sous zéro en ${summary.firstNegativeMonth}.` }
    : summary.lowestBalance < safetyTarget
      ? { level: 'warning', label: 'Marge de sécurité faible', detail: `Le point bas reste sous votre réserve cible de ${toAmount(safetyTarget)}.` }
      : { level: 'success', label: 'Trajectoire protégée', detail: 'La prévision reste au-dessus de la marge de sécurité calculée.' };

  return {
    confidence: null,
    confidenceLabel: 'Non calibrée',
    calibration: {
      status: 'uncalibrated',
      method: null,
      reason: 'walk-forward-validation-required',
      sampleMonths: activeMonths,
      minimumMonthsForScenario: 4
    },
    horizonMonths: months,
    activeMonths,
    transactionCount,
    risk,
    safetyTarget,
    safetyShortfall,
    recommendedMonthlyAdjustment,
    runwayMonths,
    monthlyIncome: recent.income,
    monthlyExpenses: recent.expenses,
    monthlyNet: toAmount(recent.income - recent.expenses),
    expenseEstimate: estimateNextMonthExpenses(source, { today, currency: source[0]?.settings?.baseCurrency || 'EUR' }),
    volatility,
    bands,
    summary
  };
}

export function calculateFinancialHealth(accounts, options = {}) {
  const source = Array.isArray(accounts) ? accounts : [];
  const today = options.today || new Date();
  const month = options.month || monthKey(today);
  const stats = recentMonthlyStats(source, today, 3);
  const balance = toAmount(source.reduce((sum, account) => sum + accountBalance(account, today), 0));
  const savings = toAmount(source.reduce((sum, account) => sum + Object.values(account?.savingsAccounts || {})
    .reduce((subtotal, value) => subtotal + Math.max(0, toAmount(value)), 0), 0));
  const debts = toAmount(source.reduce((sum, account) => sum + (account?.debts || [])
    .filter(debt => debt?.direction === 'i_owe_them')
    .reduce((subtotal, debt) => subtotal + Math.max(0, toAmount(debt?.remainingAmount ?? debt?.amount)), 0), 0));
  const savingsRate = stats.income > 0 ? ((stats.income - stats.expenses) / stats.income) * 100 : 0;
  const emergencyMonths = stats.expenses > 0 ? (Math.max(0, balance) + savings) / stats.expenses : (balance + savings > 0 ? 6 : 0);
  const envelopes = source.flatMap(account => envelopeUsage(account, month));
  const envelopeAverage = envelopes.length
    ? envelopes.reduce((sum, envelope) => sum + Math.max(0, envelope.percent), 0) / envelopes.length
    : null;
  const annualIncome = stats.income * 12;
  const debtRatio = annualIncome > 0 ? debts / annualIncome : (debts > 0 ? 1 : 0);

  const balanceScore = balance < 0 ? 0 : balance >= stats.expenses ? 20 : 12;
  const savingsScore = stats.income > 0 ? Math.round(Math.max(0, Math.min(20, savingsRate))) : 5;
  const reserveScore = Math.round(Math.max(0, Math.min(25, (emergencyMonths / 3) * 25)));
  const budgetScore = envelopeAverage === null ? 10 : Math.round(Math.max(0, Math.min(20, 28 - envelopeAverage * 0.1)));
  const debtScore = debts <= 0 ? 15 : Math.round(Math.max(0, 15 * (1 - Math.min(1, debtRatio / 0.5))));
  const score = Math.max(0, Math.min(100, balanceScore + savingsScore + reserveScore + budgetScore + debtScore));
  const label = score >= 80 ? 'Excellente' : score >= 65 ? 'Solide' : score >= 45 ? 'À renforcer' : 'Fragile';

  return {
    score,
    label,
    balance,
    savings,
    debts,
    monthlyIncome: stats.income,
    monthlyExpenses: stats.expenses,
    savingsRate: toAmount(savingsRate),
    emergencyMonths: toAmount(emergencyMonths),
    debtRatio: toAmount(debtRatio * 100),
    breakdown: [
      { key: 'balance', label: 'Solde', score: balanceScore, max: 20, value: balance, advice: balance < 0 ? 'Revenir à un solde positif en priorité.' : 'Votre trésorerie immédiate est positive.' },
      { key: 'savings', label: 'Capacité d’épargne', score: savingsScore, max: 20, value: toAmount(savingsRate), unit: '%', advice: savingsRate < 10 ? 'Viser progressivement 10 % des revenus.' : 'Votre rythme d’épargne est bien orienté.' },
      { key: 'reserve', label: 'Réserve de sécurité', score: reserveScore, max: 25, value: toAmount(emergencyMonths), unit: 'mois', advice: emergencyMonths < 3 ? 'Construire trois mois de dépenses de réserve.' : 'Votre réserve couvre au moins trois mois.' },
      { key: 'budget', label: 'Maîtrise des budgets', score: budgetScore, max: 20, value: envelopeAverage === null ? null : Math.round(envelopeAverage), unit: '%', advice: envelopeAverage === null ? 'Créer des enveloppes pour mesurer ce critère.' : envelopeAverage > 100 ? 'Réduire les catégories qui dépassent leur enveloppe.' : 'Les enveloppes sont globalement maîtrisées.' },
      { key: 'debt', label: 'Endettement', score: debtScore, max: 15, value: debts, advice: debts > 0 ? 'Prioriser les dettes les plus coûteuses.' : 'Aucune dette à rembourser enregistrée.' }
    ]
  };
}

export function buildActionPlan(accounts, options = {}) {
  const health = calculateFinancialHealth(accounts, options);
  const alerts = buildSmartAlerts(accounts, options);
  const actions = [];
  if (health.balance < 0) actions.push({ priority: 'urgent', icon: 'wallet', title: 'Rétablir un solde positif', detail: `Il manque ${Math.abs(health.balance)} pour revenir à zéro.` });
  const exceeded = alerts.filter(alert => alert.title.includes('dépassé'));
  if (exceeded.length) actions.push({ priority: 'urgent', icon: 'gauge-high', title: 'Corriger les enveloppes dépassées', detail: `${exceeded.length} catégorie(s) sont au-dessus de leur limite.` });
  if (health.emergencyMonths < 3) {
    const target = toAmount(Math.max(0, health.monthlyExpenses * 3 - Math.max(0, health.balance) - health.savings));
    actions.push({ priority: 'important', icon: 'shield-heart', title: 'Construire la réserve de sécurité', detail: `${target} restent à constituer pour couvrir trois mois.` });
  }
  if (health.savingsRate < 10 && health.monthlyIncome > 0) {
    const suggested = toAmount(Math.max(10, health.monthlyIncome * 0.1 - Math.max(0, health.monthlyIncome - health.monthlyExpenses)));
    actions.push({ priority: 'important', icon: 'piggy-bank', title: 'Atteindre 10 % d’épargne', detail: `Essayez de dégager ${suggested} supplémentaires par mois.` });
  }
  if (health.debts > 0) actions.push({ priority: 'normal', icon: 'hand-holding-dollar', title: 'Accélérer le remboursement', detail: `${health.debts} de dettes restantes sont enregistrées.` });
  if (!actions.length) actions.push({ priority: 'normal', icon: 'circle-check', title: 'Maintenir votre trajectoire', detail: 'Aucun point prioritaire détecté pour le moment.' });
  return actions.slice(0, 5);
}
