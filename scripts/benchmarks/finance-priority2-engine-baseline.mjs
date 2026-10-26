// FREEV Gestion — Priorité 2. Fonctions pures : aucun stockage ni effet de bord.
import { recurringDates, recurringPeriodKey } from '../../assets/js/v4-engine.js';

const EURO_CENTS_LIMIT = 1e14;
const TYPES = new Set(['income', 'expense', 'transfer', 'savings_withdrawal', 'inter_account']);
const money = value => Math.round((Number(value) || 0) * 100) / 100;
const cents = value => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1e12) return 0;
  return Math.round(numeric * 100);
};
const monthKey = date => String(date || '').slice(0, 7);
const dateOK = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.valueOf()) && date.getFullYear() === Number(value.slice(0,4)) &&
    date.getMonth() + 1 === Number(value.slice(5,7)) && date.getDate() === Number(value.slice(8,10));
};
const moneyFromCents = value => Math.round(value) / 100;
const txCents = tx => cents(tx?.amountBase ?? tx?.amount);
const sign = type => type === 'income' ? 1 : -1;
const actual = tx => !!tx && !tx.isRecurring && !tx.projected && tx.paymentStatus !== 'planned';
const array = value => Array.isArray(value) ? value : [];

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
function txAmount(tx) { return moneyFromCents(txCents(tx)); }

export function monthTotals(accounts, month, today = `${month}-31`) {
  const result = { incomeCents: 0, expenseCents: 0, transferCents: 0, paidCount: 0, plannedCount: 0, byCategory: {} };
  for (const acc of array(accounts)) for (const tx of array(acc.transactions)) {
    if (tx?.isRecurring || monthKey(tx?.date) !== month || !dateOK(tx.date)) continue;
    if (!actual(tx) || tx.date > today) { result.plannedCount++; continue; }
    const value = txCents(tx);
    if (tx.type === 'income') result.incomeCents += value;
    else if (tx.type === 'expense') {
      result.expenseCents += value;
      const cat = String(tx.category || 'Autre');
      result.byCategory[cat] = (result.byCategory[cat] || 0) + value;
    } else if (tx.type === 'transfer') result.transferCents += value;
    result.paidCount++;
  }
  return {
    income: moneyFromCents(result.incomeCents),
    expenses: moneyFromCents(result.expenseCents),
    transfers: moneyFromCents(result.transferCents),
    net: moneyFromCents(result.incomeCents - result.expenseCents - result.transferCents),
    paidCount: result.paidCount, plannedCount: result.plannedCount,
    byCategory: Object.fromEntries(Object.entries(result.byCategory).map(([cat, val]) => [cat, moneyFromCents(val)]))
  };
}

export function bookedBalance(accounts, today) {
  let balance = 0;
  for (const account of array(accounts)) {
    balance += Math.round((Number(account.initialCapital) || 0) * 100);
    for (const tx of array(account.transactions)) {
      if (!actual(tx) || !dateOK(tx.date) || tx.date > today) continue;
      balance += sign(tx.type) * txCents(tx);
    }
  }
  return moneyFromCents(balance);
}

function periodDateEntries(account, today, endDate) {
  const entries = [];
  const transactions = array(account.transactions);
  const paidFuture = transactions.filter(tx => !tx?.isRecurring && dateOK(tx.date) &&
    (tx.date > today || tx.paymentStatus === 'planned') && TYPES.has(tx.type));
  const frequencyById = new Map(array(account.recurringTransactions).map(rule => [String(rule.id), rule.frequency || 'monthly']));
  const occurrenceKeys = new Set(transactions.filter(tx => tx?.parentId && dateOK(tx.date))
    .map(tx => `${String(tx.parentId)}|${String(tx.periodKey || recurringPeriodKey(tx.date, frequencyById.get(String(tx.parentId))))}`));
  for (const tx of paidFuture) {
    if (tx.date > endDate && tx.paymentStatus !== 'planned') continue;
    const date = tx.date <= today ? today : tx.date;
    if (date > endDate) continue;
    entries.push({ date, scheduledDate: tx.date, accountId: account.id, type: tx.type,
      category: tx.category || 'Autre', desc: tx.desc || tx.category || 'Opération prévue',
      amount: txAmount(tx), source: tx.paymentStatus === 'planned' ? 'planned' : 'dated', id: tx.id });
  }
  const fromDate = atNoon(`${monthKey(today)}-01`);
  const until = atNoon(endDate);
  for (const rule of array(account.recurringTransactions)) {
    if (!rule?.id || !dateOK(rule.startDate)) continue;
    for (const date of recurringDates(rule, fromDate, until)) {
      if (date <= today) continue;
      const key = recurringPeriodKey(date, rule.frequency);
      if (occurrenceKeys.has(`${String(rule.id)}|${key}`)) continue;
      entries.push({ date, scheduledDate: date, accountId: account.id,
        type: rule.type, category: rule.category || 'Autre',
        desc: rule.desc || rule.category || 'Récurrence', amount: txAmount(rule),
        source: 'recurring', id: `${rule.id}|${key}` });
    }
  }
  return entries;
}

export function forecastMonths(accounts, { today, months = 3 } = {}) {
  if (!dateOK(today)) throw Error('Date de référence invalide');
  const horizon = Math.max(1, Math.min(12, Math.floor(Number(months) || 3)));
  const firstMonth = monthKey(today);
  const lastMonth = monthOffset(firstMonth, horizon - 1);
  const entries = array(accounts).flatMap(account => periodDateEntries(account, today, endOfMonth(lastMonth)))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  let running = Math.round(bookedBalance(accounts, today) * 100);
  return Array.from({ length: horizon }, (_, index) => {
    const month = monthOffset(firstMonth, index);
    const monthly = entries.filter(item => monthKey(item.date) === month);
    const changeCents = monthly.reduce((sum, item) => sum + sign(item.type) * cents(item.amount), 0);
    running += changeCents;
    return { month, income: moneyFromCents(monthly.filter(item => item.type === 'income').reduce((sum, item) => sum + cents(item.amount), 0)),
      expenses: moneyFromCents(monthly.filter(item => item.type === 'expense').reduce((sum, item) => sum + cents(item.amount), 0)),
      change: moneyFromCents(changeCents), balance: moneyFromCents(running), items: monthly };
  });
}

export function categoryBudgets(accounts, month, today) {
  const result = [];
  for (const account of array(accounts)) {
    const spent = monthTotals([account], month, today).byCategory;
    for (const [category, amount] of Object.entries(account.budgetsByCategory || {})) {
      const limit = money(Number(amount));
      if (!(limit > 0) || !Number.isFinite(limit)) continue;
      const total = money(spent[category] || 0);
      const percent = Math.round((total / limit) * 100);
      result.push({ accountId: account.id, accountName: account.name || 'Compte', category,
        spent: total, limit, remaining: money(limit - total), percent, level: total > limit ? 'danger' : percent >= 80 ? 'warning' : 'ok' });
    }
  }
  return result.sort((a, b) => b.percent - a.percent || a.category.localeCompare(b.category, 'fr'));
}

export function financeAlerts(accounts, { month, today, forecast } = {}) {
  const alerts = [];
  if (month === monthKey(today)) for (const budget of categoryBudgets(accounts, month, today)) {
    if (budget.level !== 'ok') alerts.push({ level: budget.level,
      text: `${budget.category} (${budget.accountName}) : ${budget.spent.toFixed(2)} € sur ${budget.limit.toFixed(2)} €.` });
  }
  if (forecast?.[0]?.balance < 0) alerts.push({ level: 'danger', text: 'Solde prévisionnel de fin de mois négatif. Vérifiez les échéances avant de payer.' });
  // Une limite de catégorie estimée dépassée n'est pas un paiement réalisé.
  if (month === monthKey(today) && forecast?.[0]) {
    const byAccount = new Map();
    for (const item of forecast[0].items) {
      if (item.type !== 'expense') continue;
      const key = `${String(item.accountId)}|${String(item.category)}`;
      byAccount.set(key, (byAccount.get(key) || 0) + cents(item.amount));
    }
    for (const budget of categoryBudgets(accounts, month, today)) {
      const pending = moneyFromCents(byAccount.get(`${String(budget.accountId)}|${String(budget.category)}`) || 0);
      if (budget.spent <= budget.limit && pending > 0 && budget.spent + pending > budget.limit)
        alerts.push({ level: 'warning', text: `Budget « ${budget.category} » : les prochaines échéances pourraient dépasser la limite. Montant non encore payé.` });
    }
  }
  // Une augmentation réelle d'une récurrence mensuelle doit être comparée à
  // une ancienne échéance enregistrée, jamais au tarif général déjà modifié.
  for (const account of array(accounts)) {
    for (const rule of array(account.recurringTransactions)) {
      if ((rule.frequency || 'monthly') !== 'monthly') continue;
      const entries = array(account.transactions).filter(tx => String(tx.parentId || '') === String(rule.id) &&
        actual(tx) && (monthKey(tx.date) === month || monthKey(tx.date) === monthOffset(month, -1)));
      const previous = entries.find(tx => monthKey(tx.date) === monthOffset(month, -1));
      const current = entries.find(tx => monthKey(tx.date) === month && tx.date <= today);
      if (!previous || !current) continue;
      const diff = txCents(current) - txCents(previous);
      if (txCents(previous) > 0 && diff >= 1000 && diff / txCents(previous) >= 0.2)
        alerts.push({ level: 'warning', text: `Hausse d’une récurrence (« ${rule.desc || rule.category || 'sans nom'} ») par rapport au mois précédent. Vérifiez le nouveau prélèvement.` });
    }
  }

  const current = monthTotals(accounts, month, today);
  const previous = monthTotals(accounts, monthOffset(month, -1), today);
  if (current.expenses > 0 && previous.expenses > 0 && current.expenses >= previous.expenses * 1.3 && current.expenses - previous.expenses >= 30) {
    alerts.push({ level: 'warning', text: 'Dépenses en hausse d’au moins 30 % par rapport au mois précédent (comparaison de mois possiblement incomplets).' });
  }
  for (const account of array(accounts)) {
    const paid = array(account.transactions).filter(tx => actual(tx) && monthKey(tx.date) === month && txCents(tx) > 0 &&
      (tx.type === 'expense' || tx.type === 'income'));
    const group = new Map();
    for (const tx of paid) {
      const key = `${tx.date}|${tx.type}|${txCents(tx)}|${String(tx.category || '').trim().toLowerCase()}|${String(tx.desc || '').trim().toLowerCase()}`;
      group.set(key, (group.get(key) || 0) + 1);
    }
    if ([...group.values()].some(count => count > 1)) alerts.push({ level: 'info', text: `Doublons potentiels dans « ${account.name || 'Compte'} » : vérifiez les opérations du mois. Aucune suppression automatique.` });
  }
  for (const tx of array(accounts).flatMap(acc => array(acc.transactions))) {
    if (tx?.paymentStatus === 'planned' && dateOK(tx.date) && tx.date < today && monthKey(tx.date) <= month &&
      canPlanTransaction(tx)) { alerts.push({ level: 'warning', text: 'Une opération prévue a dépassé sa date sans être marquée payée.' }); break; }
  }
  return alerts.slice(0, 8);
}

export function financeOverview(accounts, { month, today, months = 3 } = {}) {
  if (!dateOK(today) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('Période invalide');
  const monthActual = monthTotals(accounts, month, today);
  const previous = monthTotals(accounts, monthOffset(month, -1), today);
  const forecasts = forecastMonths(accounts, { today, months });
  return { month, today, current: monthActual, previous, forecasts,
    startingBalance: bookedBalance(accounts, today),
    budgets: categoryBudgets(accounts, month, today),
    alerts: financeAlerts(accounts, { month, today, forecast: forecasts }) };
}
