// Freev Valeur 5.1 — moteur pur pour imports, règles, abonnements, intelligence et patrimoine.
// Aucune fonction de ce fichier ne modifie directement les données de l’utilisateur.
import './finance-money.js';
import { recurringDates, recurringPeriodKey } from './v4-engine.js';
import { bookedAccountBalance, bookedAccountMonth, bookedAccountMonths } from './freev-account-core.mjs';

const roundMoney = value => Math.round((Number(value) || 0) * 100) / 100;
const MAX_IMPORT_ROWS = 10_000;

function median(values) {
  const sorted = (values || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/\b(cb|carte|paiement|prelevement|prlv|virement|vir|sepa)\b/g, ' ')
    .replace(/\d{2,}/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function merchantKey(transaction) {
  const normalized = normalizeText(transaction?.merchant || transaction?.desc || transaction?.label);
  const genericWords = new Set(['market', 'store', 'shop', 'france', 'sas', 'sarl', 'sa', 'eu']);
  return normalized.split(' ').filter(word => word.length > 1 && !genericWords.has(word)).slice(0, 4).join(' ') || 'operation';
}

function parseMoney(value) {
  const result = globalThis.FREEVMoney.parseAmount(value, 'EUR', 'amount');
  return result.ok ? result.minor / 100 : 0;
}

function parseDate(value) {
  const raw = String(value || '').trim();
  const toValidISO = (year, month, day) => {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const date = new Date(`${iso}T12:00:00`);
    return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day ? iso : '';
  };
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    return toValidISO(year, month, day);
  }
  const parts = raw.split(/[/.\-]/).map(Number);
  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return '';
  let [first, second, third] = parts;
  if (first > 1900) return toValidISO(first, second, third);
  const year = third < 100 ? 2000 + third : third;
  return toValidISO(year, second, first);
}

function detectDelimiter(firstLine) {
  const candidates = [';', ',', '\t'];
  return candidates.sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
}

function parseDelimitedLine(line, delimiter) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      values.push(value.trim());
      value = '';
    } else value += character;
  }
  values.push(value.trim());
  return values;
}

const HEADER_ALIASES = {
  date: ['date', 'date operation', 'date de l operation', 'booking date'],
  description: ['description', 'libelle', 'libelle operation', 'operation', 'nom', 'payee', 'merchant', 'memo'],
  amount: ['montant', 'amount', 'valeur', 'somme'],
  debit: ['debit', 'montant debit', 'depense', 'sortie'],
  credit: ['credit', 'montant credit', 'revenu', 'entree'],
  category: ['categorie', 'category'],
  type: ['type', 'sens']
};

function resolveHeaders(headers) {
  const normalized = headers.map(normalizeText);
  return Object.fromEntries(Object.entries(HEADER_ALIASES).map(([key, aliases]) => [
    key,
    normalized.findIndex(header => aliases.includes(header))
  ]));
}

export function parseCSVStatement(text) {
  const allLines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  const lines = allLines.slice(0, MAX_IMPORT_ROWS + 1);
  if (lines.length < 2) return { transactions: [], errors: ['Le relevé CSV est vide.'], delimiter: ';' };
  const delimiter = detectDelimiter(lines[0]);
  const headers = parseDelimitedLine(lines[0], delimiter);
  const columns = resolveHeaders(headers);
  if (columns.date < 0 || columns.description < 0 || (columns.amount < 0 && columns.debit < 0 && columns.credit < 0)) {
    return { transactions: [], errors: ['Colonnes requises : date, description et montant (ou débit/crédit).'], delimiter };
  }

  const transactions = [];
  const errors = allLines.length > MAX_IMPORT_ROWS + 1
    ? [`Import limité aux ${MAX_IMPORT_ROWS.toLocaleString('fr-FR')} premières opérations.`]
    : [];
  lines.slice(1).forEach((line, rowIndex) => {
    const cells = parseDelimitedLine(line, delimiter);
    const date = parseDate(cells[columns.date]);
    const description = String(cells[columns.description] || '').trim();
    const amountValue = columns.amount >= 0 ? parseMoney(cells[columns.amount]) : 0;
    const debit = columns.debit >= 0 ? Math.abs(parseMoney(cells[columns.debit])) : 0;
    const credit = columns.credit >= 0 ? Math.abs(parseMoney(cells[columns.credit])) : 0;
    const explicitType = normalizeText(columns.type >= 0 ? cells[columns.type] : '');
    let type = amountValue < 0 || debit > 0 || /debit|depense|sortie/.test(explicitType) ? 'expense' : 'income';
    const amount = roundMoney(debit || credit || Math.abs(amountValue));
    if (!date || !description || amount <= 0) {
      errors.push(`Ligne ${rowIndex + 2} ignorée : date, description ou montant invalide.`);
      return;
    }
    if (credit > 0) type = 'income';
    transactions.push({
      id: `import-${date}-${rowIndex}-${Math.random().toString(36).slice(2, 8)}`,
      date,
      desc: description.slice(0, 180),
      merchant: merchantKey({ desc: description }),
      type,
      amount,
      amountBase: amount,
      category: String(columns.category >= 0 ? cells[columns.category] : '').trim().slice(0, 60) || 'À classer',
      currency: 'EUR',
      source: 'statement-import',
      reconciled: false,
      importedAt: new Date().toISOString()
    });
  });
  return { transactions, errors, delimiter };
}

export function parseQIFStatement(text) {
  const allRecords = String(text || '').split(/^\^\s*$/m).map(record => record.trim()).filter(Boolean);
  const records = allRecords.slice(0, MAX_IMPORT_ROWS + 1);
  const transactions = [];
  const errors = allRecords.length > MAX_IMPORT_ROWS + 1
    ? [`Import limité aux ${MAX_IMPORT_ROWS.toLocaleString('fr-FR')} premières opérations.`]
    : [];
  records.forEach((record, index) => {
    const recordLines = record.split(/\r?\n/).filter(line => !line.startsWith('!Type'));
    if (!recordLines.length) return;
    const fields = {};
    recordLines.forEach(line => {
      if (line.length > 1) fields[line[0]] = line.slice(1).trim();
    });
    const date = parseDate(fields.D);
    const signedAmount = parseMoney(fields.T);
    const description = fields.P || fields.M || 'Opération importée';
    if (!date || !signedAmount) {
      errors.push(`Opération QIF ${index + 1} ignorée.`);
      return;
    }
    const amount = roundMoney(Math.abs(signedAmount));
    transactions.push({
      id: `qif-${date}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      date,
      desc: description.slice(0, 180),
      merchant: merchantKey({ desc: description }),
      type: signedAmount < 0 ? 'expense' : 'income',
      amount,
      amountBase: amount,
      category: String(fields.L || 'À classer').replace(/^\[/, '').replace(/\]$/, '').slice(0, 60),
      currency: 'EUR',
      source: 'statement-import',
      reconciled: false,
      importedAt: new Date().toISOString()
    });
  });
  return { transactions, errors };
}

export function transactionFingerprint(transaction) {
  return [
    String(transaction?.date || '').slice(0, 10),
    transaction?.type || 'expense',
    roundMoney(transaction?.amountBase ?? transaction?.amount).toFixed(2),
    merchantKey(transaction)
  ].join('|');
}

export function partitionDuplicates(existing, incoming) {
  const known = new Set((existing || []).map(transactionFingerprint));
  const accepted = [];
  const duplicates = [];
  (incoming || []).forEach(transaction => {
    const fingerprint = transactionFingerprint(transaction);
    if (known.has(fingerprint)) duplicates.push(transaction);
    else {
      known.add(fingerprint);
      accepted.push(transaction);
    }
  });
  return { accepted, duplicates };
}

export function applyAutomationRules(transactions, rules) {
  let changed = 0;
  const appliedByRule = {};
  const result = (transactions || []).map(transaction => {
    // Les transferts ne sont jamais reclassés par une règle de commerçant.
    if (transaction?.type === 'transfer') return { ...transaction };
    const haystack = normalizeText([transaction.desc, transaction.merchant, transaction.category].join(' '));
    const rule = (rules || []).find(candidate => candidate?.enabled !== false &&
      (!candidate?.matchType || (['income', 'expense'].includes(candidate.matchType) && candidate.matchType === transaction?.type)) &&
      normalizeText(candidate?.contains) && haystack.includes(normalizeText(candidate.contains)));
    if (!rule) return { ...transaction };
    const next = { ...transaction };
    let transactionChanged = false;
    if (rule.category && next.category !== rule.category) {
      next.category = String(rule.category).slice(0, 60);
      transactionChanged = true;
    }
    if ((rule.type === 'income' || rule.type === 'expense') && next.type !== rule.type) {
      next.type = rule.type;
      transactionChanged = true;
    }
    if (transactionChanged) {
      changed += 1;
      appliedByRule[rule.id] = (appliedByRule[rule.id] || 0) + 1;
    }
    next.automationRuleId = rule.id;
    return next;
  });
  return { transactions: result, changed, appliedByRule };
}

export function suggestAutomationRules(transactions) {
  const groups = new Map();
  (transactions || []).forEach(transaction => {
    const category = String(transaction?.category || '').trim();
    if (!transaction || (!transaction.desc && !transaction.merchant) ||
        !['income', 'expense'].includes(transaction.type) ||
        !category || normalizeText(category) === 'a classer' ||
        transaction.automationRuleId || transaction.parentId || transaction.isRecurring || transaction.projected ||
        transaction.linkedTransferId || transaction.linkedAccountId || transaction.linkedDebtId ||
        transaction.fromSavings || transaction.toSavings) return;
    const key = merchantKey(transaction);
    if (key.length < 3 || key === 'operation') return;
    const groupKey = `${transaction.type}|${key}`;
    const group = groups.get(groupKey) || { merchant: key, matchType: transaction.type, total: 0, categories: new Map(), topCategory: '', topCount: 0 };
    group.total += 1;
    const count = (group.categories.get(category) || 0) + 1;
    group.categories.set(category, count);
    if (count > group.topCount || (count === group.topCount && category.localeCompare(group.topCategory, 'fr') < 0)) {
      group.topCategory = category;
      group.topCount = count;
    }
    groups.set(groupKey, group);
  });
  return [...groups.values()].map(group => {
    return {
      contains: group.merchant,
      category: group.topCategory,
      count: group.topCount,
      sampleSize: group.total,
      confidence: group.total ? Math.round((group.topCount / group.total) * 100) : 0,
      matchType: group.matchType
    };
  }).filter(suggestion => suggestion.count >= 3 && suggestion.confidence >= 80)
    .sort((a, b) => b.count - a.count || b.confidence - a.confidence || a.contains.localeCompare(b.contains, 'fr') || a.matchType.localeCompare(b.matchType))
    .slice(0, 12);
}

function daysBetween(first, second) {
  return Math.round(Math.abs(new Date(`${second}T12:00:00`) - new Date(`${first}T12:00:00`)) / 86_400_000);
}

export function detectSubscriptions(transactions, recurringRules = []) {
  const results = [];
  const recurringMerchants = new Set();
  (recurringRules || []).filter(rule => rule.type !== 'income').forEach(rule => {
    const merchant = merchantKey(rule);
    recurringMerchants.add(merchant);
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
    const until = new Date(from);
    until.setFullYear(until.getFullYear() + 1);
    until.setDate(until.getDate() - 1);
    const dates = recurringDates(rule, from, until);
    const amountAt = date => {
      const versions = (Array.isArray(rule.rateVersions) ? rule.rateVersions : [])
        .filter(version => /^\d{4}-\d{2}-\d{2}$/.test(String(version?.effectiveFrom || '')) &&
          version.effectiveFrom <= date && Number.isFinite(Number(version?.amountBase)) && Number(version.amountBase) > 0)
        .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));
      return Math.abs(roundMoney(versions.length ? versions.at(-1).amountBase : (rule.amountBase ?? rule.amount)));
    };
    const yearly = dates.reduce((sum, date) => {
      const key = recurringPeriodKey(date, rule.frequency);
      const stored = (transactions || []).find(transaction => String(transaction?.parentId || '') === String(rule.id) &&
        (String(transaction.periodKey || '') === key || String(transaction.date || '') === date));
      return sum + Math.abs(roundMoney(stored ? (stored.amountBase ?? stored.amount) : amountAt(date)));
    }, 0);
    const nextDate = dates[0] || '';
    const amount = nextDate ? amountAt(nextDate) : Math.abs(roundMoney(rule.amountBase ?? rule.amount));
    const monthly = roundMoney(yearly / 12);
    results.push({
      id: `rule-${rule.id}`,
      merchant: rule.desc || rule.category || merchant,
      key: merchant,
      source: 'recurring',
      frequency: rule.frequency || 'monthly',
      latestAmount: amount,
      monthlyCost: roundMoney(monthly),
      yearlyCost: roundMoney(yearly),
      nextDate: rule.nextDate || nextDate,
      priceChange: 0,
      occurrences: null,
      confidence: 100,
      amountStability: 100
    });
  });

  const groups = new Map();
  (transactions || []).filter(transaction => transaction.type === 'expense' && !transaction.projected && transaction.date).forEach(transaction => {
    const key = merchantKey(transaction);
    const group = groups.get(key) || [];
    group.push(transaction);
    groups.set(key, group);
  });

  groups.forEach((group, key) => {
    if (group.length < 2 || recurringMerchants.has(key)) return;
    const sorted = [...group].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const uniqueMonths = new Set(sorted.map(transaction => String(transaction.date).slice(0, 7)));
    if (uniqueMonths.size < 2) return;
    const intervals = sorted.slice(1).map((transaction, index) => daysBetween(sorted[index].date, transaction.date));
    const averageDays = intervals.reduce((sum, value) => sum + value, 0) / Math.max(1, intervals.length);
    const frequency = averageDays >= 330 ? 'yearly' : averageDays >= 20 && averageDays <= 45 ? 'monthly' : averageDays >= 5 && averageDays <= 9 ? 'weekly' : '';
    if (!frequency) return;
    const amounts = sorted.map(transaction => Math.abs(roundMoney(transaction.amountBase ?? transaction.amount)));
    const latestAmount = amounts.at(-1);
    const previousAmount = amounts.at(-2);
    const typicalAmount = median(amounts);
    const amountDeviation = typicalAmount > 0
      ? Math.max(...amounts.map(amount => Math.abs(amount - typicalAmount) / typicalAmount))
      : 1;
    if (amountDeviation > 0.4) return;
    const expectedDays = frequency === 'weekly' ? 7 : frequency === 'yearly' ? 365 : 30.44;
    const cadenceDeviation = Math.abs(averageDays - expectedDays) / expectedDays;
    const cadenceScore = Math.max(0, 100 - cadenceDeviation * 120);
    const amountStability = Math.max(0, 100 - amountDeviation * 100);
    const confidence = Math.round(cadenceScore * 0.6 + amountStability * 0.4);
    if (confidence < 68) return;
    const priceChange = previousAmount > 0 ? roundMoney(((latestAmount - previousAmount) / previousAmount) * 100) : 0;
    const monthlyCost = frequency === 'weekly' ? latestAmount * 52 / 12 : frequency === 'yearly' ? latestAmount / 12 : latestAmount;
    results.push({
      id: `detected-${key}`,
      merchant: sorted.at(-1).desc || key,
      key,
      source: 'detected',
      frequency,
      latestAmount,
      monthlyCost: roundMoney(monthlyCost),
      yearlyCost: roundMoney(monthlyCost * 12),
      lastDate: sorted.at(-1).date,
      priceChange,
      occurrences: sorted.length,
      confidence,
      amountStability: Math.round(amountStability)
    });
  });
  return results.sort((a, b) => b.yearlyCost - a.yearlyCost);
}

function shiftMonth(date, offset) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1, 12).toISOString().slice(0, 7);
}

function monthTotals(account, month, lookup = null) {
  return lookup?.get(month) || bookedAccountMonth(account, month, { excludeLinkedTransfers: true });
}

function percentageChange(current, previous) {
  if (previous === 0) return current === 0 ? 0 : null;
  return roundMoney(((current - previous) / Math.abs(previous)) * 100);
}

/** Repère une hausse de catégorie qui tient sur plusieurs mois ; un mois isolé ne suffit pas. */
export function detectPersistentExpenseChanges(account, today = new Date(), lookup = null) {
  const reference = today instanceof Date ? today : new Date(`${String(today).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(reference.getTime())) return [];
  const months = Array.from({ length: 6 }, (_, index) => monthTotals(account, shiftMonth(reference, index - 6), lookup));
  const categories = new Set(months.flatMap(month => Object.keys(month.categories)));
  const changes = [];
  for (const category of categories) {
    const values = months.map(month => Math.round((month.categories[category] || 0) * 100));
    const baseline = values.slice(0, 3);
    const recent = values.slice(3);
    if (baseline.filter(value => value > 0).length < 2 || recent.filter(value => value > 0).length < 2) continue;
    const baselineMedian = median(baseline);
    const baselineMad = median(baseline.map(value => Math.abs(value - baselineMedian)));
    const threshold = Math.max(2000, baselineMedian * 1.25, baselineMedian + baselineMad * 3);
    const recentMedian = median(recent);
    const aboveThresholdMonths = recent.filter(value => value > threshold).length;
    if (aboveThresholdMonths < 2 || recentMedian <= threshold) continue;
    changes.push({
      category,
      baselineMedian: baselineMedian / 100,
      baselineMad: baselineMad / 100,
      recentMedian: recentMedian / 100,
      difference: (recentMedian - baselineMedian) / 100,
      aboveThresholdMonths,
      sampleMonths: { baseline: 3, recent: 3 },
      threshold: threshold / 100,
      method: 'médiane et écart absolu médian sur 3 mois contre 3 mois'
    });
  }
  return changes.sort((left, right) => right.difference - left.difference || left.category.localeCompare(right.category, 'fr'));
}

function detectExpenseAnomalies(account, today) {
  const cutoff = new Date(today);
  cutoff.setMonth(cutoff.getMonth() - 6);
  const expenses = (account?.transactions || []).filter(transaction =>
    transaction?.type === 'expense' && !transaction?.projected && !transaction?.linkedTransferId &&
    transaction?.date && new Date(`${transaction.date}T12:00:00`) >= cutoff
  );
  const groups = new Map();
  expenses.forEach(transaction => {
    const key = merchantKey(transaction);
    const group = groups.get(key) || [];
    group.push(transaction);
    groups.set(key, group);
  });
  const anomalies = [];
  groups.forEach((group, key) => {
    if (group.length < 3) return;
    const amounts = group.map(transaction => Math.abs(roundMoney(transaction?.amountBase ?? transaction?.amount)));
    const typical = median(amounts);
    const deviations = amounts.map(amount => Math.abs(amount - typical));
    const robustDeviation = median(deviations);
    const threshold = Math.max(100, typical * 1.8, typical + robustDeviation * 4);
    group.forEach(transaction => {
      const amount = Math.abs(roundMoney(transaction?.amountBase ?? transaction?.amount));
      if (amount > threshold) anomalies.push({
        id: transaction.id || `${key}-${transaction.date}`,
        merchant: transaction.desc || key,
        date: transaction.date,
        amount,
        typical: roundMoney(typical),
        difference: roundMoney(amount - typical)
      });
    });
  });
  return anomalies.sort((first, second) => second.difference - first.difference).slice(0, 5);
}

export function buildFinancialIntelligence(account, options = {}) {
  const today = options.today instanceof Date ? options.today : new Date(`${String(options.today || new Date().toISOString().slice(0, 10)).slice(0, 10)}T12:00:00`);
  const historyKeys = Array.from({ length: 6 }, (_, index) => shiftMonth(today, -(index + 1)));
  const monthLookup = new Map(bookedAccountMonths(account, historyKeys, { excludeLinkedTransfers: true })
    .map(row => [row.month, row]));
  const history = historyKeys.map(month => monthTotals(account, month, monthLookup));
  const lastMonth = history[0];
  const previousMonth = history[1];
  const activeMonths = history.filter(month => month.transactions > 0).length;
  const transactionCount = history.reduce((sum, month) => sum + month.transactions, 0);
  const totalIncome = history.reduce((sum, month) => sum + month.income, 0);
  const totalExpenses = history.reduce((sum, month) => sum + month.expenses, 0);
  const monthlyIncome = activeMonths ? totalIncome / activeMonths : 0;
  const monthlyExpenses = activeMonths ? totalExpenses / activeMonths : 0;
  const savingsRate = monthlyIncome > 0 ? ((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100 : 0;
  const allTransactions = (account?.transactions || []).filter(transaction => !transaction?.projected && !transaction?.linkedTransferId);
  const unclassified = allTransactions.filter(transaction => !transaction?.category || transaction.category === 'À classer').length;
  const classificationRate = allTransactions.length ? ((allTransactions.length - unclassified) / allTransactions.length) * 100 : 0;
  const confidence = null;
  const worth = calculateNetWorth(account, today.toISOString().slice(0, 10));
  const debts = worth.liabilities;
  const subscriptions = detectSubscriptions(account?.transactions, account?.recurringTransactions);
  const monthlySubscriptions = subscriptions.reduce((sum, item) => sum + item.monthlyCost, 0);
  const subscriptionBurden = monthlyIncome > 0 ? (monthlySubscriptions / monthlyIncome) * 100 : 0;
  const cashCoverage = monthlyExpenses > 0 ? Math.max(0, worth.cash + worth.savings) / monthlyExpenses : (worth.cash + worth.savings > 0 ? 6 : 0);
  const rawScore = Math.max(0, Math.min(100, Math.round(
    35 + Math.max(-15, Math.min(20, savingsRate)) + Math.min(20, cashCoverage * 6.67) +
    Math.min(15, classificationRate * 0.15) + (debts <= 0 ? 10 : Math.max(0, 10 - debts / Math.max(1, monthlyIncome * 12) * 20))
  )));
  // Une note calculée sur peu de données revient vers 50 plutôt que d'afficher
  // une fausse certitude positive ou négative.
  const score = rawScore;
  const categories = new Set([...Object.keys(lastMonth.categories), ...Object.keys(previousMonth.categories)]);
  const categoryChanges = [...categories].map(category => {
    const current = roundMoney(lastMonth.categories[category] || 0);
    const previous = roundMoney(previousMonth.categories[category] || 0);
    return { category, current, previous, difference: roundMoney(current - previous), percent: percentageChange(current, previous) };
  }).sort((first, second) => second.difference - first.difference);
  const anomalies = detectExpenseAnomalies(account, today);
  const persistentExpenseChanges = detectPersistentExpenseChanges(account, today, monthLookup);
  const decisions = [];
  if (activeMonths < 3) decisions.push({ priority: 1, tone: 'info', icon: 'database', title: 'Historique encore limité', detail: 'Les tendances restent partielles tant que plusieurs mois ne sont pas documentés.', action: 'imports', label: 'Importer un relevé', impact: `${activeMonths}/6 mois avec opérations` });
  if (unclassified > 0) decisions.push({ priority: 1, tone: 'warning', icon: 'inbox', title: `${unclassified} opération(s) à classer`, detail: 'Un meilleur classement rend les tendances par catégorie plus lisibles.', action: 'rules', label: 'Automatiser', impact: `${roundMoney(classificationRate).toLocaleString('fr-FR')} % des opérations classées` });
  const expenseTrend = percentageChange(lastMonth.expenses, previousMonth.expenses);
  if (expenseTrend !== null && expenseTrend >= 10) decisions.push({ priority: 3, tone: 'info', icon: 'arrow-trend-up', title: `Variation des dépenses : +${expenseTrend.toLocaleString('fr-FR')} %`, detail: 'Comparaison de deux mois complets. Une variation ponctuelle ne devient pas une tendance persistante.', action: 'overview', label: 'Comparer', impact: `+${roundMoney(lastMonth.expenses - previousMonth.expenses).toLocaleString('fr-FR')} sur un mois` });
  for (const change of persistentExpenseChanges.slice(0, 2)) decisions.push({ priority: 1, tone: 'warning', icon: 'arrow-trend-up', title: `Hausse persistante · ${change.category}`, detail: `La médiane mensuelle passe de ${change.baselineMedian.toLocaleString('fr-FR')} à ${change.recentMedian.toLocaleString('fr-FR')} sur deux périodes de trois mois.`, action: 'overview', label: 'Analyser', impact: `Au-dessus du seuil pendant ${change.aboveThresholdMonths}/3 mois récents` });
  const increases = subscriptions.filter(subscription => subscription.priceChange >= 5);
  if (increases.length) decisions.push({ priority: 2, tone: 'warning', icon: 'repeat', title: `${increases.length} abonnement(s) ont augmenté`, detail: 'Vérifiez les offres devenues plus chères avant le prochain prélèvement.', action: 'subscriptions', label: 'Vérifier', impact: `${roundMoney(monthlySubscriptions * 12).toLocaleString('fr-FR')} par an suivis` });
  if (savingsRate < 10 && monthlyIncome > 0) decisions.push({ priority: 2, tone: 'info', icon: 'piggy-bank', title: 'Capacité d’épargne à renforcer', detail: `Votre moyenne récente est de ${roundMoney(savingsRate).toLocaleString('fr-FR')} % des revenus.`, action: 'wealth', label: 'Voir le patrimoine', impact: 'Cible progressive : 10 %' });
  if (anomalies.length) decisions.push({ priority: 2, tone: 'warning', icon: 'wave-square', title: `${anomalies.length} dépense(s) inhabituelle(s)`, detail: `${anomalies[0].merchant} dépasse son montant habituel de ${anomalies[0].difference.toLocaleString('fr-FR')}.`, action: 'overview', label: 'Voir', impact: 'Détection par médiane locale' });
  if (!decisions.length) decisions.push({ priority: 3, tone: 'success', icon: 'shield-check', title: 'Aucune hausse persistante détectée', detail: 'Aucune catégorie ne dépasse le seuil pendant plusieurs mois consécutifs.', action: 'overview', label: 'Voir la synthèse', impact: `${activeMonths}/6 mois avec opérations` });

  return {
    score,
    scoreLabel: score >= 80 ? 'Très solide' : score >= 65 ? 'Solide' : score >= 45 ? 'À renforcer' : 'Fragile',
    confidence,
    confidenceLabel: 'Non évaluée',
    dataCoverage: { activeMonths, availableMonths: 6, transactionCount, classificationRate: roundMoney(classificationRate) },
    lastMonth,
    previousMonth,
    changes: {
      income: percentageChange(lastMonth.income, previousMonth.income),
      expenses: expenseTrend,
      net: roundMoney((lastMonth.income - lastMonth.expenses) - (previousMonth.income - previousMonth.expenses))
    },
    monthlyIncome: roundMoney(monthlyIncome),
    monthlyExpenses: roundMoney(monthlyExpenses),
    savingsRate: roundMoney(savingsRate),
    classificationRate: roundMoney(classificationRate),
    cashCoverage: roundMoney(cashCoverage),
    subscriptionBurden: roundMoney(subscriptionBurden),
    categoryChanges: categoryChanges.slice(0, 5),
    anomalies,
    persistentExpenseChanges,
    decisions: decisions.sort((first, second) => first.priority - second.priority).slice(0, 6)
  };
}

export function calculateNetWorth(account, throughDate = new Date().toISOString().slice(0, 10)) {
  const cash = bookedAccountBalance(account, throughDate).amount;
  const savings = roundMoney(Object.values(account?.savingsAccounts || {}).reduce((sum, value) => sum + (Number(value) || 0), 0));
  const assets = roundMoney((account?.wealthAssets || []).reduce((sum, asset) => sum + Math.max(0, Number(asset.value) || 0), 0));
  const liabilities = roundMoney((account?.debts || []).filter(debt => debt.direction === 'i_owe_them').reduce((sum, debt) => sum + Math.max(0, Number(debt.remainingAmount ?? debt.amount) || 0), 0));
  return { cash, savings, assets, liabilities, netWorth: roundMoney(cash + savings + assets - liabilities) };
}

export function buildLocalAlerts(account, today = new Date().toISOString().slice(0, 10)) {
  const alerts = [];
  const todayDate = new Date(`${today}T12:00:00`);
  const daysUntil = value => Math.ceil((new Date(`${value}T12:00:00`) - todayDate) / 86_400_000);

  detectSubscriptions(account?.transactions, account?.recurringTransactions)
    .filter(subscription => subscription.priceChange >= 5)
    .forEach(subscription => alerts.push({
      id: `subscription-${subscription.key}`,
      level: 'warning',
      title: `Hausse détectée pour ${subscription.merchant}`,
      detail: `Le dernier montant est supérieur de ${subscription.priceChange.toLocaleString('fr-FR')} %.`
    }));

  (account?.debts || []).forEach(debt => {
    const remaining = Math.max(0, Number(debt.remainingAmount ?? debt.amount) || 0);
    const delay = debt.endDate ? daysUntil(debt.endDate) : Number.POSITIVE_INFINITY;
    if (remaining > 0 && delay >= 0 && delay <= 7) alerts.push({
      id: `debt-${debt.id}`,
      level: delay <= 2 ? 'danger' : 'warning',
      title: `Échéance de dette dans ${delay === 0 ? 'la journée' : `${delay} jour(s)`}`,
      detail: debt.person ? `Échéance liée à ${debt.person}.` : 'Une dette arrive bientôt à échéance.'
    });
  });

  const month = today.slice(0, 7);
  const bookedCategories = bookedAccountMonth(account, month, { excludeLinkedTransfers: true }).categories;
  Object.entries(account?.envelopes || {}).forEach(([category, limitValue]) => {
    const limit = Number(limitValue) || 0;
    if (limit <= 0) return;
    const spent = bookedCategories[category] || 0;
    const percent = Math.round((spent / limit) * 100);
    if (percent >= 80) alerts.push({
      id: `envelope-${normalizeText(category)}`,
      level: percent >= 100 ? 'danger' : 'warning',
      title: percent >= 100 ? `Budget ${category} dépassé` : `Budget ${category} utilisé à ${percent} %`,
      detail: percent >= 100 ? 'Cette enveloppe mérite votre attention.' : 'La limite mensuelle approche.'
    });
  });

  const order = { danger: 0, warning: 1, info: 2 };
  return alerts.sort((first, second) => (order[first.level] ?? 9) - (order[second.level] ?? 9)).slice(0, 6);
}
