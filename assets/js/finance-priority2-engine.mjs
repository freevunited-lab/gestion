// FREEV Gestion — Priorité 2. Fonctions pures : aucun stockage ni effet de bord.
import { recurringDates, recurringPeriodKey } from './v4-engine.js';
import { createCalculationCache } from './calculation-coordination.mjs';
import { calculateForecastLedger, forecastMonthBalances, firstNegativeDailyClose } from './freev-ledger-bridge.mjs';
import { minorDigits, parseStoredAmount, parseTransactionBaseMinor } from './finance-core.mjs';
import { createForecastSessionCache } from './forecast-session-cache.mjs';

const overviewCache = createCalculationCache({ maxEntries: 64 });
const forecastSessionCache = createForecastSessionCache();
let lastForecastOwner = null;

const TYPES = new Set(['income', 'expense', 'transfer', 'savings_withdrawal', 'inter_account']);
class FinanceDataError extends Error {
  constructor(result) {
    super(result?.error?.message || 'Les données financières sont à vérifier.');
    this.name = 'FinanceDataError';
    this.code = result?.error?.code || 'invalid-data';
    this.field = result?.error?.field || null;
    this.transactionId = result?.transactionId ?? null;
  }
}
const requireMinor = result => {
  if (!result?.ok) throw new FinanceDataError(result);
  return result.minor;
};
const monthKey = date => String(date || '').slice(0, 7);
const validatedDates = new Map();
const TRANSACTION_AMOUNT_CACHE_LIMIT = 65_536;
let validatedTransactionAmounts = new WeakMap();
let validatedTransactionAmountCount = 0;
let transactionAmountCachingEnabled = true;
const dateOK = value => {
  const key = String(value || '');
  if (validatedDates.has(key)) {
    const valid = validatedDates.get(key);
    validatedDates.delete(key);
    validatedDates.set(key, valid);
    return valid;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  let valid = false;
  if (match) {
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    valid = month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
  }
  if (validatedDates.size >= 512) validatedDates.delete(validatedDates.keys().next().value);
  validatedDates.set(key, valid);
  return valid;
};
const moneyFromCents = (value, currency = 'EUR') => value / (10 ** minorDigits(currency));
function fastStoredNumberMinor(tx, currency) {
  const value = tx?.amountBase;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const scaled = value * (10 ** minorDigits(currency));
  const rounded = Math.round(scaled);
  const floatErrorBudget = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  if (!Number.isSafeInteger(rounded) || floatErrorBudget >= 0.01 ||
      Math.abs(scaled - rounded) > Math.max(1e-7, floatErrorBudget)) return null;
  return rounded;
}
const txCents = (tx, currency = 'EUR') => {
  const cached = transactionAmountCachingEnabled && tx && typeof tx === 'object' ? validatedTransactionAmounts.get(tx) : null;
  const fastMinor = cached ? null : fastStoredNumberMinor(tx, currency);
  const amount = cached && cached.baseCurrency === currency && cached.amountBase === tx?.amountBase &&
    cached.amount === tx?.amount && cached.currency === tx?.currency && cached.fxRate === tx?.fxRate
    ? cached.minor
    : fastMinor !== null ? fastMinor : requireMinor(parseTransactionBaseMinor(tx, currency));
  if (amount < 0) throw new FinanceDataError({ error: { code: 'negative-transaction', message: 'Le montant doit être positif', field: `transactions.${tx?.id ?? 'unknown'}.amount` }, transactionId: tx?.id ?? null });
  if (transactionAmountCachingEnabled && tx && typeof tx === 'object' && (!cached || cached.minor !== amount || cached.baseCurrency !== currency ||
      cached.amountBase !== tx.amountBase || cached.amount !== tx.amount || cached.currency !== tx.currency || cached.fxRate !== tx.fxRate)) {
    if (!validatedTransactionAmounts.has(tx)) {
      // Les montants restent rapides sur les comptes courants ; les anciennes générations
      // ne retiennent qu'un nombre borné d'opérations lors d'un historique exceptionnel.
      if (validatedTransactionAmountCount >= TRANSACTION_AMOUNT_CACHE_LIMIT) {
        validatedTransactionAmounts = new WeakMap();
        validatedTransactionAmountCount = 0;
      }
      validatedTransactionAmountCount += 1;
    }
    validatedTransactionAmounts.set(tx, { baseCurrency: currency, amountBase: tx.amountBase, amount: tx.amount,
      currency: tx.currency, fxRate: tx.fxRate, minor: amount });
  }
  return amount;
};
const amountCents = (value, currency = 'EUR', field = 'amount') => requireMinor(parseStoredAmount(value, currency, field));
const checkedAdd = (left, right, field) => {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) throw new FinanceDataError({ error: { code: 'out-of-range', message: 'Cumul financier hors limites', field } });
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw new FinanceDataError({ error: { code: 'out-of-range', message: 'Cumul financier hors limites', field } });
  return sum;
};
const sign = type => type === 'income' ? 1 : -1;
const actual = tx => !!tx && !tx.isRecurring && !tx.projected && tx.paymentStatus !== 'planned';
const array = value => Array.isArray(value) ? value : [];
const scopeCurrency = accounts => {
  const currencies = new Set(array(accounts).map(account => String(account?.settings?.baseCurrency || 'EUR').toUpperCase()));
  if (currencies.size > 1) throw new FinanceDataError({ error: { code: 'mixed-currency', message: 'Les comptes sélectionnés utilisent des devises de base différentes.', field: 'accounts' } });
  return [...currencies][0] || 'EUR';
};

export function isPaidTransaction(tx) { return actual(tx); }
export function canPlanTransaction(tx) {
  return tx && !tx.isRecurring && !tx.parentId && !tx.fromSavings && !tx.linkedDebtId && tx.category !== 'Remboursement dette' &&
    (tx.type === 'expense' || tx.type === 'income');
}
export function normalizedPaymentStatus(tx) {
  return tx?.paymentStatus === 'planned' && canPlanTransaction(tx) ? 'planned' : 'paid';
}
export function validatePaymentStatus(tx, status) {
  if (status !== 'planned' && status !== 'paid') return false;
  return status !== 'planned' || canPlanTransaction(tx);
}

function monthOffset(month, amount) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) throw Error('Mois invalide');
  const [year, m] = month.split('-').map(Number);
  const date = new Date(year, m - 1 + amount, 1, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
function endOfMonth(month) {
  const [year, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(year, m, 0).getDate()).padStart(2, '0')}`;
}
function atNoon(value) { return new Date(`${value}T12:00:00`); }
function validatedPeriodKey(date, frequency) {
  if (frequency === 'yearly') return date.slice(0, 4);
  if (frequency !== 'weekly') return date.slice(0, 7);
  return recurringPeriodKey(date, frequency);
}
function txAmount(tx, currency) {
  const amountMinor = txCents(tx, currency);
  return { amount: moneyFromCents(amountMinor, currency), amountMinor };
}

function recurringRateAt(rule, date, currency) {
  const source = array(rule?.rateVersions);
  for (const version of source) {
    if (!dateOK(version?.effectiveFrom)) throw new FinanceDataError({ error: { code: 'invalid-date', message: 'Date de changement de tarif invalide', field: `recurrences.${rule?.id ?? 'unknown'}.rateVersions.effectiveFrom` } });
    if (version.effectiveFrom <= date) {
      const amount = txCents(version, currency);
      if (amount <= 0) throw new FinanceDataError({ error: { code: 'invalid-rate-version', message: 'Le tarif doit être supérieur à zéro', field: `recurrences.${rule?.id ?? 'unknown'}.rateVersions.amount` } });
    }
  }
  const versions = source.filter(version => version.effectiveFrom <= date)
    .slice().sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));
  return versions.length ? { ...rule, ...versions.at(-1) } : rule;
}

export function monthTotals(accounts, month, today = endOfMonth(month)) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || '')) || !dateOK(today)) throw new FinanceDataError({ error: { code: 'invalid-period', message: 'Période invalide', field: 'month' } });
  const currency = scopeCurrency(accounts);
  const result = { incomeCents: 0, expenseCents: 0, transferCents: 0, paidCount: 0, plannedCount: 0, byCategory: {} };
  for (const acc of array(accounts)) for (const tx of array(acc.transactions)) {
    if (tx?.isRecurring || tx?.projected) continue;
    if (!dateOK(tx?.date)) throw new FinanceDataError({ error: { code: 'invalid-date', message: 'Date d’opération invalide', field: `transactions.${tx?.id ?? 'unknown'}.date` }, transactionId: tx?.id ?? null });
    if (monthKey(tx.date) !== month) continue;
    if (!actual(tx) || tx.date > today) { result.plannedCount++; continue; }
    if (!TYPES.has(tx.type)) throw new FinanceDataError({ error: { code: 'invalid-type', message: 'Type d’opération invalide', field: `transactions.${tx.id ?? 'unknown'}.type` }, transactionId: tx.id ?? null });
    const value = txCents(tx, currency);
    if (tx.type === 'income') result.incomeCents = checkedAdd(result.incomeCents, value, 'income');
    else if (tx.type === 'expense' || tx.type === 'savings_withdrawal') {
      result.expenseCents = checkedAdd(result.expenseCents, value, 'expenses');
      const cat = String(tx.category || 'Autre');
      result.byCategory[cat] = checkedAdd(result.byCategory[cat] || 0, value, `categories.${cat}`);
    } else result.transferCents = checkedAdd(result.transferCents, value, 'transfers');
    result.paidCount++;
  }
  return {
    currency,
    incomeMinor: result.incomeCents, expensesMinor: result.expenseCents, transfersMinor: result.transferCents,
    income: moneyFromCents(result.incomeCents, currency),
    expenses: moneyFromCents(result.expenseCents, currency),
    transfers: moneyFromCents(result.transferCents, currency),
    net: moneyFromCents(result.incomeCents - result.expenseCents - result.transferCents, currency),
    paidCount: result.paidCount, plannedCount: result.plannedCount,
    byCategoryMinor: result.byCategory,
    byCategory: Object.fromEntries(Object.entries(result.byCategory).map(([cat, val]) => [cat, moneyFromCents(val, currency)]))
  };
}

function bookedBalanceMinor(accounts, today, currency = scopeCurrency(accounts)) {
  let balance = 0;
  for (const account of array(accounts)) {
    const capital = account.initialCapital == null || account.initialCapital === '' ? 0 : account.initialCapital;
    balance = checkedAdd(balance, amountCents(capital, currency, `accounts.${account.id ?? 'unknown'}.initialCapital`), 'balance');
    for (const tx of array(account.transactions)) {
      if (!actual(tx) || tx?.isRecurring || tx?.projected) continue;
      if (!dateOK(tx?.date)) throw new FinanceDataError({ error: { code: 'invalid-date', message: 'Date d’opération invalide', field: `transactions.${tx?.id ?? 'unknown'}.date` }, transactionId: tx?.id ?? null });
      if (tx.date > today) continue;
      if (!TYPES.has(tx.type)) throw new FinanceDataError({ error: { code: 'invalid-type', message: 'Type d’opération invalide', field: `transactions.${tx.id ?? 'unknown'}.type` }, transactionId: tx.id ?? null });
      balance = checkedAdd(balance, sign(tx.type) * txCents(tx, currency), 'balance');
    }
  }
  return balance;
}

export function bookedBalance(accounts, today) {
  const currency = scopeCurrency(accounts);
  return moneyFromCents(bookedBalanceMinor(accounts, today, currency), currency);
}

function periodDateEntries(account, today, endDate, currency) {
  const entries = [];
  const transactions = array(account.transactions);
  const frequencyById = new Map(array(account.recurringTransactions).map(rule => [String(rule.id), rule.frequency || 'monthly']));
  const occurrenceKeys = new Set();
  const paidFuture = [];
  // Une seule lecture des transactions et une seule validation de la date.
  for (const tx of transactions) {
    if (!tx || tx.isRecurring || tx.projected) continue;
    if (!dateOK(tx.date)) throw new FinanceDataError({ error: { code: 'invalid-date', message: 'Date d’opération invalide', field: `transactions.${tx.id ?? 'unknown'}.date` }, transactionId: tx.id ?? null });
    if (tx.parentId) {
      const parentId = String(tx.parentId);
      occurrenceKeys.add(`${parentId}|${String(tx.periodKey || validatedPeriodKey(tx.date, frequencyById.get(parentId)))}`);
    }
    if (!tx.isRecurring && (tx.date > today || tx.paymentStatus === 'planned') && TYPES.has(tx.type))
      paidFuture.push(tx);
  }
  for (const tx of paidFuture) {
    if (tx.date > endDate && tx.paymentStatus !== 'planned') continue;
    const date = tx.date <= today ? today : tx.date;
    if (date > endDate) continue;
    if (!TYPES.has(tx.type)) throw new FinanceDataError({ error: { code: 'invalid-type', message: 'Type d’opération invalide', field: `transactions.${tx.id ?? 'unknown'}.type` }, transactionId: tx.id ?? null });
    const amount = txAmount(tx, currency);
    entries.push({ date, scheduledDate: tx.date, accountId: account.id, type: tx.type,
      category: tx.category || 'Autre', desc: tx.desc || tx.category || 'Opération prévue',
      ...amount, source: tx.paymentStatus === 'planned' ? 'planned' : 'dated', id: tx.id });
  }
  const fromDate = atNoon(`${monthKey(today)}-01`);
  const until = atNoon(endDate);
  for (const rule of array(account.recurringTransactions)) {
    if (!rule?.id || !dateOK(rule.startDate)) throw new FinanceDataError({ error: { code: 'invalid-date', message: 'Date de début de récurrence invalide', field: `recurrences.${rule?.id ?? 'unknown'}.startDate` } });
    if (!TYPES.has(rule.type)) throw new FinanceDataError({ error: { code: 'invalid-type', message: 'Type de récurrence invalide', field: `recurrences.${rule.id}.type` } });
    const baseAmount = txCents(rule, currency);
    if (baseAmount < 0) throw new FinanceDataError({ error: { code: 'negative-transaction', message: 'Le montant doit être positif', field: `recurrences.${rule.id}.amount` } });
    for (const date of recurringDates(rule, fromDate, until)) {
      if (date <= today) continue;
      const key = validatedPeriodKey(date, rule.frequency);
      if (occurrenceKeys.has(`${String(rule.id)}|${key}`)) continue;
      entries.push({ date, scheduledDate: date, accountId: account.id,
        type: rule.type, category: rule.category || 'Autre',
        desc: rule.desc || rule.category || 'Récurrence', ...txAmount(recurringRateAt(rule, date, currency), currency),
        source: 'recurring', id: `${rule.id}|${key}` });
    }
  }
  return entries;
}

export function forecastMonths(accounts, { today, months = 3, startingBalance, startingBalanceMinor, sessionContext = null } = {}) {
  if (!dateOK(today)) throw Error('Date de référence invalide');
  const currency = scopeCurrency(accounts);
  const horizon = Math.max(1, Math.min(12, Math.floor(Number(months) || 3)));
  const firstMonth = monthKey(today);
  const lastMonth = monthOffset(firstMonth, horizon - 1);
  const entries = array(accounts).flatMap(account => periodDateEntries(account, today, endOfMonth(lastMonth), currency))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  // Regrouper une fois : ne plus rescanner toutes les échéances pour chaque mois
  // ni filtrer trois fois chaque mois pour calculer les totaux.
  const grouped = new Map();
  for (const item of entries) {
    const key = monthKey(item.date);
    let bucket = grouped.get(key);
    if (!bucket) {
      bucket = { items: [], income: 0, expenses: 0, change: 0 };
      grouped.set(key, bucket);
    }
    bucket.items.push(item);
    const amount = item.amountMinor;
    bucket.change = checkedAdd(bucket.change, sign(item.type) * amount, 'forecast.change');
    if (item.type === 'income') bucket.income = checkedAdd(bucket.income, amount, 'forecast.income');
    else if (item.type === 'expense' || item.type === 'savings_withdrawal') bucket.expenses = checkedAdd(bucket.expenses, amount, 'forecast.expenses');
  }
  const initialMinor = startingBalanceMinor === undefined
    ? startingBalance === undefined ? bookedBalanceMinor(accounts, today, currency) : amountCents(startingBalance, currency, 'startingBalance')
    : startingBalanceMinor;
  if (!Number.isSafeInteger(initialMinor)) throw new FinanceDataError({ error: { code: 'invalid-balance', message: 'Solde de départ invalide', field: 'startingBalance' } });
  // Le store est désormais la source unique des soldes futurs et des minima.
  // Les règles FREEV (semaines, exceptions, virements, remboursements) restent
  // traitées en amont ; le pont traduit ensuite leurs flux sans double débit.
  const ledger = calculateForecastLedger(entries, { openingDate: today, throughDate: endOfMonth(lastMonth), openingBalanceMinor: initialMinor },
    sessionContext ? { cache: forecastSessionCache, context: sessionContext } : null);
  const balances = forecastMonthBalances(ledger, firstMonth, horizon);
  const negativeDailyCloseDate = firstNegativeDailyClose(ledger);
  return Array.from({ length: horizon }, (_, index) => {
    const month = monthOffset(firstMonth, index);
    const bucket = grouped.get(month);
    const { closingBalanceMinor: running, lowestBalanceMinor } = balances[index];
    return { month, currency, incomeMinor: bucket?.income || 0, expensesMinor: bucket?.expenses || 0,
      changeMinor: bucket?.change || 0, balanceMinor: running, lowestBalanceMinor,
      income: moneyFromCents(bucket?.income || 0, currency),
      expenses: moneyFromCents(bucket?.expenses || 0, currency),
      change: moneyFromCents(bucket?.change || 0, currency),
      balance: moneyFromCents(running, currency), lowestBalance: moneyFromCents(lowestBalanceMinor, currency),
      negativeDailyCloseDate: negativeDailyCloseDate?.slice(0, 7) === month ? negativeDailyCloseDate : null,
      items: bucket?.items || [] };
  });
}

export function categoryBudgets(accounts, month, today) {
  const currency = scopeCurrency(accounts);
  const result = [];
  for (const account of array(accounts)) {
    const spent = monthTotals([account], month, today);
    for (const [category, amount] of Object.entries(account.budgetsByCategory || {})) {
      const limitMinor = amountCents(amount, currency, `accounts.${account.id ?? 'unknown'}.budgetsByCategory.${category}`);
      if (limitMinor < 0) throw new FinanceDataError({ error: { code: 'negative-budget', message: 'Un budget ne peut pas être négatif', field: `accounts.${account.id ?? 'unknown'}.budgetsByCategory.${category}` } });
      if (limitMinor <= 0) continue;
      const totalMinor = spent.byCategoryMinor[category] || 0;
      const total = moneyFromCents(totalMinor, currency);
      const limit = moneyFromCents(limitMinor, currency);
      const percent = Number((BigInt(totalMinor) * 100n + BigInt(limitMinor) / 2n) / BigInt(limitMinor));
      const remainingMinor = checkedAdd(limitMinor, -totalMinor, `budgets.${category}.remaining`);
      result.push({ accountId: account.id, accountName: account.name || 'Compte', category,
        spent: total, limit, remaining: moneyFromCents(remainingMinor, currency), spentMinor: totalMinor, limitMinor,
        percent, level: totalMinor > limitMinor ? 'danger' : percent >= 80 ? 'warning' : 'ok' });
    }
  }
  return result.sort((a, b) => b.percent - a.percent || a.category.localeCompare(b.category, 'fr'));
}

export function financeAlerts(accounts, { month, today, forecast, budgets, currentTotals, previousTotals } = {}) {
  const currency = scopeCurrency(accounts);
  const scale = 10 ** minorDigits(currency);
  const format = value => new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: minorDigits(currency) }).format(value);
  const alerts = [];
  const currentBudgets = budgets ?? categoryBudgets(accounts, month, today);
  if (month === monthKey(today)) for (const budget of currentBudgets) {
    if (budget.level !== 'ok') alerts.push({ level: budget.level,
      text: `${budget.category} (${budget.accountName}) : ${format(budget.spent)} sur ${format(budget.limit)}.` });
  }
  if (forecast?.[0]?.balance < 0) alerts.push({ level: 'danger', text: 'Solde prévisionnel de fin de mois négatif. Vérifiez les échéances avant de payer.' });
  if (forecast?.some(item => item.lowestBalanceMinor < 0) && forecast?.[0]?.balanceMinor >= 0) {
    const firstClose = forecast.find(item => item.negativeDailyCloseDate)?.negativeDailyCloseDate;
    alerts.push({ level: 'warning', text: firstClose
      ? `Trésorerie potentiellement négative dès le ${firstClose} avant la fin de la période. Dates estimées.`
      : 'Creux de trésorerie possible entre deux opérations du même jour. Ordre de règlement non confirmé.' });
  }
  // Une limite de catégorie estimée dépassée n'est pas un paiement réalisé.
  if (month === monthKey(today) && forecast?.[0]) {
    const byAccount = new Map();
    for (const item of forecast[0].items) {
      if (item.type !== 'expense') continue;
      const key = `${String(item.accountId)}|${String(item.category)}`;
      byAccount.set(key, checkedAdd(byAccount.get(key) || 0, item.amountMinor, 'forecast.budgets'));
    }
    for (const budget of currentBudgets) {
      const pendingMinor = byAccount.get(`${String(budget.accountId)}|${String(budget.category)}`) || 0;
      const pending = moneyFromCents(pendingMinor, currency);
      if (budget.spent <= budget.limit && pending > 0 && budget.spent + pending > budget.limit)
        alerts.push({ level: 'warning', text: `Budget « ${budget.category} » : les prochaines échéances pourraient dépasser la limite. Montant non encore payé.` });
    }
  }
  // Une augmentation réelle d'une récurrence mensuelle doit être comparée à
  // une ancienne échéance enregistrée, jamais au tarif général déjà modifié.
  const prevMonth = monthOffset(month, -1);
  for (const account of array(accounts)) {
    // Index par identifiant et mois : O(T + R), contre O(T × R).
    // Premier enregistrement dans l'ordre source = comportement du .find original.
    const byRule = new Map();
    for (const tx of array(account.transactions)) {
      if (!actual(tx) || !tx.parentId) continue;
      const m = monthKey(tx.date);
      if (m !== month && m !== prevMonth) continue;
      const id = String(tx.parentId);
      let entry = byRule.get(id);
      if (!entry) { entry = {}; byRule.set(id, entry); }
      if (m === prevMonth && !entry.previous) entry.previous = tx;
      if (m === month && tx.date <= today && !entry.current) entry.current = tx;
    }
    for (const rule of array(account.recurringTransactions)) {
      if ((rule.frequency || 'monthly') !== 'monthly') continue;
      const entry = byRule.get(String(rule.id));
      const previous = entry?.previous;
      const current = entry?.current;
      if (!previous || !current) continue;
      const previousMinor = txCents(previous, currency);
      const diff = txCents(current, currency) - previousMinor;
      if (previousMinor > 0 && diff >= 10 * scale && BigInt(diff) * 5n >= BigInt(previousMinor))
        alerts.push({ level: 'warning', text: `Hausse d’une récurrence (« ${rule.desc || rule.category || 'sans nom'} ») par rapport au mois précédent. Vérifiez le nouveau prélèvement.` });
    }
  }

  const current = currentTotals ?? monthTotals(accounts, month, today);
  const previous = previousTotals ?? monthTotals(accounts, prevMonth, today);
  if (current.expensesMinor > 0 && previous.expensesMinor > 0 && BigInt(current.expensesMinor) * 10n >= BigInt(previous.expensesMinor) * 13n && current.expensesMinor - previous.expensesMinor >= 30 * scale) {
    alerts.push({ level: 'warning', text: 'Dépenses en hausse d’au moins 30 % par rapport au mois précédent (comparaison de mois possiblement incomplets).' });
  }
  for (const account of array(accounts)) {
    const group = new Map();
    for (const tx of array(account.transactions)) {
      if (!actual(tx) || !dateOK(tx.date) || monthKey(tx.date) !== month) continue;
      const amount = txCents(tx, currency);
      if (amount <= 0 || (tx.type !== 'expense' && tx.type !== 'income')) continue;
      const key = `${tx.date}|${tx.type}|${amount}|${String(tx.category || '').trim().toLowerCase()}|${String(tx.desc || '').trim().toLowerCase()}`;
      group.set(key, (group.get(key) || 0) + 1);
    }
    let hasDuplicates = false;
    for (const count of group.values()) if (count > 1) { hasDuplicates = true; break; }
    if (hasDuplicates) alerts.push({ level: 'info', text: `Doublons potentiels dans « ${account.name || 'Compte'} » : vérifiez les opérations du mois. Aucune suppression automatique.` });
  }
  let overduePlanned = false;
  for (const account of array(accounts)) {
    for (const tx of array(account.transactions)) {
      if (tx?.paymentStatus === 'planned' && dateOK(tx.date) && tx.date < today && monthKey(tx.date) <= month &&
        canPlanTransaction(tx)) {
        alerts.push({ level: 'warning', text: 'Une opération prévue a dépassé sa date sans être marquée payée.' });
        overduePlanned = true;
        break;
      }
    }
    if (overduePlanned) break;
  }
  return alerts.slice(0, 8);
}

export function financeOverview(accounts, { month, today, months = 3, dataRevision } = {}) {
  if (!dateOK(today) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('Période invalide');
  const source = array(accounts);
  const activeUid = typeof window === 'undefined' ? '' : String(window.__freevUserId || '');
  // Purge avant la lecture du cache global : deux utilisateurs peuvent avoir des
  // identifiants de comptes identiques sur le même appareil.
  if (lastForecastOwner !== activeUid) { overviewCache.clear(); forecastSessionCache.clear(); lastForecastOwner = activeUid; }
  const cacheContext = dataRevision == null ? null : {
    engineVersion: 'finance-priority2-4-session-ledger',
    dataRevision: [activeUid, dataRevision],
    calculationDate: today,
    accountScope: source.map((account, index) => String(account?.id ?? `account-${index}`)),
    options: { month, months }
  };
  if (cacheContext) {
    const cached = overviewCache.get(cacheContext);
    if (cached !== undefined) return cached;
  }
  const transactionCount = source.reduce((count, account) => count + array(account?.transactions).length, 0);
  const bypassAmountCache = transactionCount > TRANSACTION_AMOUNT_CACHE_LIMIT;
  const previousCacheMode = transactionAmountCachingEnabled;
  if (bypassAmountCache) {
    // Un grand historique repasse plusieurs fois sur les mêmes lignes. Éviter de
    // remplir des générations de cache pour un jeu de données qui dépasse sa limite.
    transactionAmountCachingEnabled = false;
    validatedTransactionAmounts = new WeakMap();
    validatedTransactionAmountCount = 0;
  }
  try {
    const monthActual = monthTotals(accounts, month, today);
    const previous = monthTotals(accounts, monthOffset(month, -1), today);
    const currency = scopeCurrency(accounts);
    const startingBalanceMinor = bookedBalanceMinor(accounts, today, currency);
    const startingBalance = moneyFromCents(startingBalanceMinor, currency);
    // Un changement de session efface toutes les projections privées précédentes.
    const uid = activeUid;
    const forecasts = forecastMonths(accounts, { today, months, startingBalanceMinor,
      sessionContext: { ownerUid: uid, accountIds: source.map((account, index) => String(account?.id ?? `account-${index}`)), currency } });
    const budgets = categoryBudgets(accounts, month, today);
    const result = { month, today, current: monthActual, previous, forecasts,
      startingBalance, budgets,
      alerts: financeAlerts(accounts, { month, today, forecast: forecasts,
        budgets, currentTotals: monthActual, previousTotals: previous }) };
    if (cacheContext) overviewCache.set(cacheContext, result, {
      dependencies: source.map((account, index) => ({ accountId: String(account?.id ?? `account-${index}`), period: month, indicator: 'financeOverview' }))
    });
    return result;
  } finally {
    if (bypassAmountCache) {
      transactionAmountCachingEnabled = previousCacheMode;
      validatedTransactionAmounts = new WeakMap();
      validatedTransactionAmountCount = 0;
    }
  }
}

export function invalidateFinanceOverviewCache(selectors) {
  // L'invalidation du résultat agrégé n'efface pas le store : celui-ci réconcilie
  // ses opérations à la lecture suivante, sauf purge explicite complète.
  const removed = overviewCache.invalidate(selectors);
  if (selectors?.clearForecastSessions) forecastSessionCache.clear();
  return removed;
}
export function resetFinanceSessionCaches() {
  overviewCache.clear();
  forecastSessionCache.clear();
  lastForecastOwner = null;
}
export function financeForecastCacheStatistics() { return forecastSessionCache.statistics; }
