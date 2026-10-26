// FREEV Gestion — primitives monétaires sans dépendance au DOM.
// Chargé comme script classique pour les formulaires et les imports, et importé
// comme module secondaire par les moteurs ESM.
(function installFreevMoney(global) {
  'use strict';

  const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'XAF', 'XOF']);
  const THREE_DECIMAL = new Set(['BHD', 'KWD', 'OMR', 'TND', 'JOD']);
  const MAX_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

  const minorDigits = (currency = 'EUR') => {
    const code = String(currency).toUpperCase();
    return ZERO_DECIMAL.has(code) ? 0 : THREE_DECIMAL.has(code) ? 3 : 2;
  };
  const fail = (code, message, field) => ({ ok: false, error: { code, message, field } });

  function parseAmount(input, currency = 'EUR', field = 'amount') {
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) return fail('not-finite', 'Montant non numérique', field);
      return parseAmount(String(input), currency, field);
    }
    if (typeof input !== 'string') return fail('not-a-string', 'Montant manquant ou illisible', field);
    let text = input.replace(/[\s  ]/g, '').replace(/[€$£]|EUR|USD|GBP|CHF/gi, '');
    if (!text) return fail('empty', 'Montant vide', field);
    let sign = 1n;
    if (text[0] === '-' || text[0] === '−') { sign = -1n; text = text.slice(1); }
    else if (text[0] === '+') text = text.slice(1);
    if (text.startsWith('(') && text.endsWith(')')) { sign = -1n; text = text.slice(1, -1); }
    const digits = minorDigits(currency);
    const lastComma = text.lastIndexOf(','), lastDot = text.lastIndexOf('.');
    const decimalAt = Math.max(lastComma, lastDot);
    let integer = text, fraction = '';
    if (decimalAt >= 0) {
      const other = lastComma > lastDot ? '.' : ',';
      const separator = text[decimalAt];
      const repeated = text.split(separator).length - 1 > 1;
      if (repeated) {
        if (text.includes(other) || !/^\d{1,3}(?:[.,]\d{3})+$/.test(text)) return fail('ambiguous', 'Séparateurs ambigus', field);
        integer = text.split(separator).join('');
      } else {
        integer = text.slice(0, decimalAt).split(other).join('');
        fraction = text.slice(decimalAt + 1);
        if (integer.includes(',') || integer.includes('.') || !fraction) return fail('not-numeric', 'Montant non numérique', field);
      }
    }
    if (!/^\d+$/.test(integer || '0') || (fraction && !/^\d+$/.test(fraction))) return fail('not-numeric', 'Montant non numérique', field);
    if (fraction.length > digits && /[1-9]/.test(fraction.slice(digits))) return fail('too-precise', `Plus de ${digits} décimale(s) pour cette devise`, field);
    const padded = (fraction + '0'.repeat(digits)).slice(0, digits);
    let minor;
    try { minor = BigInt(`${integer || '0'}${padded}`); }
    catch { return fail('not-numeric', 'Montant non numérique', field); }
    if (minor > MAX_MINOR) return fail('out-of-range', 'Montant hors limites', field);
    return { ok: true, minor: Number(sign * minor), currency: String(currency).toUpperCase() };
  }

  // Les anciennes sauvegardes stockent des montants en nombre JavaScript.
  // Tolérer uniquement le bruit binaire inférieur à une fraction de centime ;
  // une valeur réellement trop précise reste une erreur à corriger.
  function parseStoredAmount(input, currency = 'EUR', field = 'amount') {
    if (typeof input !== 'number') return parseAmount(input, currency, field);
    if (!Number.isFinite(input)) return fail('not-finite', 'Montant non numérique', field);
    const scale = 10 ** minorDigits(currency);
    const scaled = input * scale;
    const rounded = Math.round(scaled);
    const floatErrorBudget = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
    if (!Number.isSafeInteger(rounded) || floatErrorBudget >= 0.01 || Math.abs(scaled - rounded) > Math.max(1e-7, floatErrorBudget)) {
      return fail('not-exact', 'Montant stocké trop imprécis pour la devise', field);
    }
    return { ok: true, minor: rounded, currency: String(currency).toUpperCase() };
  }

  function isValidISODate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  /** Cumule les flux comptabilisés en unités minimales, sans somme flottante intermédiaire. */
  function sumTransactionTotalsMinor(transactions, options = {}) {
    const currency = String(options.currency || 'EUR').toUpperCase();
    const cutoffDate = options.cutoffDate ?? null;
    const fromDate = options.fromDate ?? null;
    const toDate = options.toDate ?? null;
    for (const [field, date] of [['cutoffDate', cutoffDate], ['fromDate', fromDate], ['toDate', toDate]]) {
      if (date != null && !isValidISODate(date)) return fail('invalid-date', 'Date de calcul invalide', field);
    }
    if (fromDate && toDate && fromDate > toDate) return fail('invalid-range', 'Période inversée', 'fromDate');

    const totals = { income: 0n, expense: 0n, transfer: 0n };
    for (const [index, transaction] of (Array.isArray(transactions) ? transactions : []).entries()) {
      if (!transaction || transaction.isRecurring || transaction.paymentStatus === 'planned') continue;
      if (!Object.prototype.hasOwnProperty.call(totals, transaction.type)) continue;
      const id = String(transaction.id ?? index);
      if (!isValidISODate(transaction.date)) {
        return { ...fail('invalid-date', 'Date d’opération invalide', `transactions.${id}.date`), transactionId: transaction.id ?? null };
      }
      if (cutoffDate && transaction.date > cutoffDate) continue;
      if (fromDate && transaction.date < fromDate) continue;
      if (toDate && transaction.date > toDate) continue;

      const amount = parseTransactionBaseMinor(transaction, currency);
      if (!amount.ok) return { ...amount, transactionId: transaction.id ?? null };
      if (amount.minor < 0) return { ...fail('negative-transaction', 'Le montant de l’opération doit être positif', `transactions.${id}.amount`), transactionId: transaction.id ?? null };
      totals[transaction.type] += BigInt(amount.minor);
      if (totals[transaction.type] > MAX_MINOR) {
        return { ...fail('out-of-range', 'Cumul des opérations hors limites', `transactions.${id}.amount`), transactionId: transaction.id ?? null };
      }
    }
    return {
      ok: true,
      currency,
      income: Number(totals.income),
      expense: Number(totals.expense),
      transfer: Number(totals.transfer)
    };
  }

  /** Solde d’un compte à une date donnée, avec un seul arrondi au stockage initial. */
  function computeBalanceMinor({ initialCapital = 0, transactions = [], cutoffDate, currency = 'EUR' } = {}) {
    const capital = parseStoredAmount(initialCapital, currency, 'initialCapital');
    if (!capital.ok) return capital;
    const totals = sumTransactionTotalsMinor(transactions, { cutoffDate, currency });
    if (!totals.ok) return totals;
    const balance = BigInt(capital.minor) + BigInt(totals.income) - BigInt(totals.expense) - BigInt(totals.transfer);
    if (balance > MAX_MINOR || balance < -MAX_MINOR) return fail('out-of-range', 'Solde hors limites', 'balance');
    return { ok: true, minor: Number(balance), currency: String(currency).toUpperCase() };
  }

  function formatMinor(minor, currency = 'EUR') {
    if (!Number.isSafeInteger(minor)) return '—';
    const digits = minorDigits(currency);
    const abs = BigInt(Math.abs(minor)), base = 10n ** BigInt(digits);
    const whole = String(abs / base).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const fraction = digits ? `,${String(abs % base).padStart(digits, '0')}` : '';
    const code = String(currency).toUpperCase();
    const symbol = { EUR: '€', USD: '$', GBP: '£' }[code] || code;
    return `${minor < 0 ? '−' : ''}${whole}${fraction} ${symbol}`;
  }

  function parseRate(rate) {
    const text = String(rate ?? '').trim().replace(/[  \s]/g, '').replace(',', '.');
    const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(text);
    if (!match) return null;
    const scale = 10n ** BigInt((match[2] || '').length);
    return { numerator: BigInt(`${match[1]}${match[2] || ''}`), denominator: scale };
  }

  /** Convertit un montant source exact avec un taux décimal, puis arrondit une seule fois à la devise cible. */
  function convertMinor(amountMinor, rate, sourceCurrency = 'EUR', targetCurrency = 'EUR') {
    if (!Number.isSafeInteger(amountMinor)) return fail('invalid-amount', 'Montant à convertir invalide', 'amount');
    const parsedRate = parseRate(rate);
    if (!parsedRate || parsedRate.numerator <= 0n) return fail('invalid-rate', 'Taux de change invalide', 'rate');
    const sourceDigits = BigInt(minorDigits(sourceCurrency));
    const targetDigits = BigInt(minorDigits(targetCurrency));
    const numerator = BigInt(amountMinor) * parsedRate.numerator * (10n ** targetDigits);
    const denominator = parsedRate.denominator * (10n ** sourceDigits);
    const absolute = numerator < 0n ? -numerator : numerator;
    const rounded = (absolute + denominator / 2n) / denominator;
    const signed = numerator < 0n ? -rounded : rounded;
    if (signed > MAX_MINOR || signed < -MAX_MINOR) return fail('out-of-range', 'Montant converti hors limites', 'amount');
    return { ok: true, minor: Number(signed), currency: String(targetCurrency).toUpperCase() };
  }

  /** Lit une transaction dans sa devise de base en conservant les erreurs et son identifiant. */
  function parseTransactionBaseMinor(transaction, baseCurrency = 'EUR') {
    const base = String(baseCurrency || 'EUR').toUpperCase();
    const id = transaction?.id ?? null;
    const contextualize = result => result.ok ? result : {
      ...result,
      transactionId: id,
      error: { ...result.error, field: `transactions.${id ?? 'unknown'}.${result.error?.field || 'amount'}` }
    };
    if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) {
      return contextualize(fail('invalid-transaction', 'Opération absente ou illisible', 'transaction'));
    }

    const hasBaseAmount = transaction.amountBase !== null && transaction.amountBase !== undefined && transaction.amountBase !== '';
    if (hasBaseAmount) return contextualize(parseStoredAmount(transaction.amountBase, base, 'amountBase'));

    const source = String(transaction.currency || base).toUpperCase();
    const parsed = parseStoredAmount(transaction.amount, source, 'amount');
    if (!parsed.ok) return contextualize(parsed);
    if (source === base) return parsed;
    return contextualize(convertMinor(parsed.minor, transaction.fxRate, source, base));
  }

  global.FREEVMoney = Object.freeze({ minorDigits, parseAmount, parseStoredAmount, sumTransactionTotalsMinor, computeBalanceMinor, formatMinor, convertMinor, parseTransactionBaseMinor });
})(globalThis);
