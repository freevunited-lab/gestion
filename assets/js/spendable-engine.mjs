// FREEV Gestion — « Ce que je peux encore dépenser » (QUO 01, QUO 02).
// Adaptateur pur entre le modèle de comptes existant, le calendrier financier et finance-core.mjs.
// Lecture seule : aucune transaction n'est créée ni modifiée, aucune simulation n'est prise en compte.
import { accountBalanceMinor, financialCalendar, isoDate, localDate } from './v4-engine.js';
import { computeSpendable, parseStoredAmount, parseTransactionBaseMinor } from './finance-core.mjs';

const HORIZON_DAYS = 120;
const endOfMonth = day => { const d = localDate(day); return isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12)); };
const isISODate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

function addMinor(left, right, field) {
  const result = BigInt(left) + BigInt(right);
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < -BigInt(Number.MAX_SAFE_INTEGER)) {
    return { ok: false, error: { code: 'out-of-range', message: 'Cumul hors limites', field } };
  }
  return { ok: true, minor: Number(result) };
}

/**
 * @param {object[]} accounts comptes du périmètre courant (individuel, groupé ou global)
 * @param {{today?:string|Date}} [options]
 */
export function buildSpendable(accounts, options = {}) {
  const scope = Array.isArray(accounts) ? accounts.filter(Boolean) : [];
  const scopeNames = scope.map(account => account.name || 'Compte');
  if (!scope.length) return { ok: false, reason: 'no-account', scopeNames };

  const rawToday = options.today ?? new Date();
  const today = rawToday instanceof Date
    ? (Number.isFinite(rawToday.getTime()) ? isoDate(rawToday) : null)
    : String(rawToday);
  if (!isISODate(today)) return { ok: false, reason: 'invalid', error: { code: 'invalid-date', message: 'Date de calcul invalide', field: 'today' }, scopeNames };

  const currencies = new Set(scope.map(account => String(account.settings?.baseCurrency || 'EUR').toUpperCase()));
  if (currencies.size > 1) return { ok: false, reason: 'mixed-currency', currencies: [...currencies], scopeNames };
  const currency = [...currencies][0];

  let cash = 0;
  for (const account of scope) {
    const balance = accountBalanceMinor(account, today);
    if (!balance.ok) return { ...balance, reason: 'invalid', scopeNames };
    const next = addMinor(cash, balance.minor, 'cash');
    if (!next.ok) return { ...next, reason: 'invalid', scopeNames };
    cash = next.minor;
  }
  const reserveValues = scope.map(account => account.plannerSettings?.spendReserve);
  let reserve = null;
  for (const [index, value] of reserveValues.entries()) {
    if (value === undefined || value === null || value === '') continue;
    const parsed = parseStoredAmount(value, currency, `accounts.${scope[index].id ?? index}.spendReserve`);
    if (!parsed.ok || parsed.minor < 0) return {
      ...(parsed.ok ? { ok: false, error: { code: 'invalid-reserve', message: 'Réserve invalide', field: `accounts.${scope[index].id ?? index}.spendReserve` } } : parsed),
      reason: 'invalid', scopeNames
    };
    const next = addMinor(reserve ?? 0, parsed.minor, 'reserve');
    if (!next.ok) return { ...next, reason: 'invalid', scopeNames };
    reserve = next.minor;
  }

  const outflows = [];
  const incomes = [];
  const overdue = [];
  for (const account of scope) {
    // Retards : paiements planifiés dont la date est passée restent dus tant qu'ils ne sont pas réglés.
    for (const transaction of account.transactions || []) {
      if (!transaction?.isRecurring && transaction?.paymentStatus === 'planned' && !isISODate(transaction.date)) {
        return { ok: false, reason: 'invalid', error: { code: 'invalid-date', message: 'Date d’opération invalide', field: `transactions.${transaction.id ?? 'unknown'}.date` }, transactionId: transaction.id ?? null, scopeNames };
      }
      if (transaction?.type !== 'income' && transaction?.paymentStatus === 'planned' && transaction.date < today) {
        const amount = parseTransactionBaseMinor(transaction, currency);
        if (!amount.ok) return { ...amount, reason: 'invalid', scopeNames };
        if (amount.minor < 0) return { ok: false, reason: 'invalid', error: { code: 'negative-transaction', message: 'Le montant doit être positif', field: `transactions.${transaction.id ?? 'unknown'}.amount` }, transactionId: transaction.id ?? null, scopeNames };
        overdue.push({ id: `tx:${account.id}:${transaction.id}`, label: transaction.desc || 'Paiement planifié', date: transaction.date, amount: amount.minor, account: account.name, kind: 'overdue' });
      }
    }
    const events = financialCalendar([account], { from: today, days: HORIZON_DAYS, limit: 1000 });
    for (const event of events) {
      if (String(event.date) < today) continue;
      const isRecurring = event.source === 'recurring';
      // Une opération déjà réglée dont la date est aujourd'hui est comprise dans la trésorerie de départ.
      if (!isRecurring && String(event.date) === today && event.paymentStatus !== 'planned') continue;
      const id = isRecurring ? `rec:${account.id}:${event.id}:${event.date}` : `tx:${account.id}:${event.id}`;
      const amount = parseTransactionBaseMinor(event, currency);
      if (!amount.ok) return { ...amount, reason: 'invalid', scopeNames };
      if (amount.minor < 0) return { ok: false, reason: 'invalid', error: { code: 'negative-transaction', message: 'Le montant doit être positif', field: `transactions.${event.id ?? 'unknown'}.amount` }, transactionId: event.id ?? null, scopeNames };
      const item = { id, label: event.desc || 'Opération', date: event.date, amount: amount.minor, account: account.name, kind: isRecurring ? 'recurring' : event.paymentStatus === 'planned' ? 'planned' : 'scheduled' };
      if (event.type === 'income') { if (String(event.date) > today) incomes.push(item); } else outflows.push(item);
    }
  }
  incomes.sort((a, b) => a.date.localeCompare(b.date));

  // Fin de période : date choisie par l'utilisateur, sinon prochain revenu du calendrier, sinon fin de mois explicite.
  const configuredEnds = scope.map(account => account.plannerSettings?.spendPeriodEnd).filter(value => value !== undefined && value !== null && value !== '');
  const invalidEnd = configuredEnds.find(value => !isISODate(String(value)));
  if (invalidEnd) return { ok: false, reason: 'invalid', error: { code: 'invalid-date', message: 'Date de fin de période invalide', field: 'spendPeriodEnd' }, scopeNames };
  const chosen = configuredEnds.find(value => value >= today);
  let periodEnd, periodSource;
  if (chosen) { periodEnd = chosen; periodSource = 'chosen'; }
  else if (incomes.length) { periodEnd = incomes[0].date; periodSource = 'next-income'; }
  else { periodEnd = endOfMonth(today); periodSource = 'month-end'; }

  const due = [...overdue, ...outflows.filter(item => item.date <= periodEnd)].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const result = computeSpendable({
    cash,
    dueBeforeIncome: due.map(item => ({ id: item.id, amount: item.amount })),
    reserve,
    allocated: 0,
    periodEnd,
    periodEndIsExplicitFallback: periodSource !== 'next-income'
  });
  if (!result.ok) return { ...result, reason: 'invalid', scopeNames };
  return {
    ...result,
    reason: null,
    today,
    periodSource,
    nextIncome: incomes[0] || null,
    due,
    currency,
    scopeNames,
    limits: ['Les sommes affectées à des projets ne sont pas retranchées : aucun suivi d’affectation n’existe encore.']
  };
}
