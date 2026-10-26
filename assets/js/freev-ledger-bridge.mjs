// FREEV Gestion — Adaptateur pur entre les échéances métier existantes et le noyau de calcul.
// Le format historique (amountBase, savings_withdrawal, periodKey, skippedPeriods, devises)
// est traduit APRES l'application des règles historiques par finance-priority2-engine.
// Aucune donnée de compte n'est modifiée ni sauvegardée ici.
import { createLedgerStore } from './freev-store.mjs';
import { cashflowRiskInsights } from './freev-forecast.mjs';
import { createForecastSessionCache } from './forecast-session-cache.mjs';

const SCOPE = '__freev_future_cashflow__';
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/**
 * Calcule le flux futur dans l'unité minimale de la devise du cockpit.
 * Les lignes fournies sont UNIQUEMENT les opérations à prévoir, déjà converties en
 * centimes/millièmes/etc. et dédoublonnées par période dans le moteur métier.
 * Les virements/sorties d'épargne sont des débits pour ce modèle de compte historique.
 */
export function calculateForecastLedger(entries, { openingDate, throughDate, openingBalanceMinor }, session = null) {
  if (session) return session.cache.calculate(entries, { openingDate, throughDate, openingBalanceMinor }, session.context);
  if (!validDate(openingDate) || !validDate(throughDate) || openingDate > throughDate ||
      !Number.isSafeInteger(openingBalanceMinor)) throw new RangeError('Période ou solde initial invalide');
  if (!Array.isArray(entries)) throw new TypeError('Liste des flux invalide');
  const store = createLedgerStore({ accountId: SCOPE, openingDate, throughDate,
    openingBalanceMinor, includeProjections: true });
  for (const [index, entry] of entries.entries()) {
    if (!entry || !validDate(entry.date) || entry.date < openingDate || entry.date > throughDate ||
        !Number.isSafeInteger(entry.amountMinor) || entry.amountMinor < 0 ||
        !['income', 'expense', 'transfer', 'savings_withdrawal', 'inter_account'].includes(entry.type)) {
      throw new RangeError(`Flux de prévision invalide : ${entry?.id ?? index}`);
    }
    store.addTransaction({
      id: `future-${index}`, accountId: SCOPE, date: entry.date,
      type: entry.type === 'income' ? 'income' : 'expense',
      amountMinor: entry.amountMinor, paymentStatus: 'planned'
    });
  }
  return store.getLedger();
}

/** Soldes de fin et minima mensuels, y compris pour les mois sans échéance. */
export function forecastMonthBalances(ledger, firstMonth, monthCount) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(firstMonth) || !Number.isInteger(monthCount) ||
      monthCount < 1 || monthCount > 120) throw new RangeError('Mois de prévision invalides');
  const byMonth = new Map(ledger.months.map(row => [row.month, row]));
  let running = ledger.openingBalanceMinor;
  const result = [];
  const [year, month] = firstMonth.split('-').map(Number);
  for (let offset = 0; offset < monthCount; offset++) {
    const utc = new Date(Date.UTC(year, month - 1 + offset, 1));
    const key = `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}`;
    const row = byMonth.get(key);
    const lowestBalanceMinor = row ? Math.min(running, row.lowestBalanceMinor) : running;
    running = row ? row.closingBalanceMinor : running;
    result.push({ month: key, closingBalanceMinor: running, lowestBalanceMinor });
  }
  return result;
}

/** Premier jour dont la clôture prévisionnelle est négative, sans inventer de certitude. */
export function firstNegativeDailyClose(ledger) {
  return cashflowRiskInsights(ledger, { maxOutflows: 0 }).firstBelowThresholdDate;
}
