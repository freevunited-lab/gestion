// FREEV Gestion — vérification mensuelle courte (QUO 07). Module pur : aucune écriture, aucun accès au DOM.
// Ne propose que ce qui demande une décision (doublons possibles, catégories manquantes, paiements en attente,
// montants inhabituels, écarts de pointage). Chaque proposition explique sa cause et son incertitude.
// Valider un mois = « vérifié par l'utilisateur », jamais une certification comptable.
import { parseTransactionBaseMinor } from './finance-core.mjs';

const pad = n => String(n).padStart(2, '0');
const normalize = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const validDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const formatMinor = (value, currency) => globalThis.FREEVMoney.formatMinor(value, currency);
const dayNumber = iso => { const [y, m, d] = String(iso).split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86400000); };
export const addDays = (iso, delta) => new Date((dayNumber(iso) + delta) * 86400000).toISOString().slice(0, 10);
const isMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));
const monthStart = month => `${month}-01`;
const monthEnd = month => { const [y, m] = month.split('-').map(Number); return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`; };
const shiftMonth = (month, delta) => { const [y, m] = month.split('-').map(Number); const i = y * 12 + m - 1 + delta; return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`; };
const median = values => { const s = [...values].sort((a, b) => a - b); const h = s.length >> 1; return s.length % 2 ? s[h] : Math.round((s[h - 1] + s[h]) / 2); };

/** Empreinte courte et stable (djb2) d'une chaîne. */
export function fingerprint(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function prepare(account) {
  const currency = String(account?.settings?.baseCurrency || 'EUR').toUpperCase();
  return (Array.isArray(account?.transactions) ? account.transactions : [])
    .map((t, index) => {
      const amount = parseTransactionBaseMinor(t, currency);
      return {
        t,
        id: t?.id !== undefined && t?.id !== null && t?.id !== '' ? String(t.id) : `idx${index}`,
        date: String(t?.date || ''),
        amount,
        cents: amount.ok ? Math.abs(amount.minor) : null,
        type: t?.type === 'income' ? 'income' : t?.type === 'transfer' ? 'transfer' : 'expense',
        desc: String(t?.desc || ''),
        descN: normalize(t?.desc),
        category: String(t?.category || '').trim(),
        planned: t?.paymentStatus === 'planned',
        reconciled: Boolean(t?.reconciled),
        currency
      };
    })
    .filter(e => e.t && typeof e.t === 'object' && !e.t.isRecurring && !e.t.projected);
}
const sig = e => `${e.id}|${e.date}|${e.cents}|${e.amount?.error?.code || ''}|${e.type}|${e.category}|${e.planned ? 1 : 0}|${e.reconciled ? 1 : 0}|${e.descN}`;

/** Signature du contenu d'un mois : change si une opération du mois est ajoutée, retirée ou modifiée. */
export function monthSignature(account, month) {
  const rows = prepare(account).filter(e => e.date.startsWith(month)).map(sig).sort();
  return `${rows.length}:${fingerprint(rows.join('\n'))}`;
}

function item(month, kind, entries, base) {
  const ids = entries.map(e => e.id).sort();
  return {
    id: base.grouped ? `${kind}:${month}` : `${kind}:${month}:${ids.join('+')}`,
    kind, month, refs: ids,
    title: base.title, cause: base.cause, uncertainty: base.uncertainty, uncertaintyLabel: base.uncertaintyLabel,
    amountCents: base.amountCents ?? null,
    fingerprint: fingerprint(entries.map(sig).sort().join('\n'))
  };
}
const UNC = { low: 'Incertitude faible', medium: 'Incertitude moyenne', high: 'Incertitude élevée' };

function findDuplicates(month, entries) {
  const groups = new Map();
  for (const e of entries) {
    if (e.type === 'transfer' || !e.cents) continue;
    const key = `${e.type}|${e.cents}|${e.descN}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const out = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    let cluster = [list[0]];
    const flush = () => {
      if (cluster.length > 1 && !cluster.every(e => e.reconciled)) {
        const sameDay = cluster.every(e => e.date === cluster[0].date);
        out.push(item(month, 'duplicate', cluster, {
          title: `Doublon possible : ${cluster[0].desc || 'Opération'}`,
          cause: sameDay
            ? `${cluster.length} opérations de même libellé, même montant et même date (${cluster[0].date}).`
            : `${cluster.length} opérations de même libellé et même montant à moins de 3 jours d’écart.`,
          uncertainty: sameDay ? 'medium' : 'high',
          uncertaintyLabel: `${sameDay ? UNC.medium : UNC.high} : deux achats identiques sont parfois légitimes.`,
          amountCents: cluster[0].cents
        }));
      }
    };
    for (let i = 1; i < list.length; i++) {
      if (dayNumber(list[i].date) - dayNumber(list[i - 1].date) <= 3) cluster.push(list[i]);
      else { flush(); cluster = [list[i]]; }
    }
    flush();
  }
  return out;
}

function findUnusual(month, all, inMonth) {
  const from = monthStart(shiftMonth(month, -6));
  const before = monthStart(month);
  const history = new Map();
  for (const e of all) {
    if (e.type !== 'expense' || e.planned || !e.cents || !e.category || e.date < from || e.date >= before) continue;
    if (!history.has(e.category)) history.set(e.category, []);
    history.get(e.category).push(e.cents);
  }
  const flagged = [];
  for (const e of inMonth) {
    if (e.type !== 'expense' || e.planned || !e.cents || !e.category || e.t.parentId) continue;
    const h = history.get(e.category);
    if (!h || h.length < 4) continue;
    const m = median(h);
    const mad = median(h.map(v => Math.abs(v - m)));
    if (e.cents > Math.max(m * 3, m + mad * 5) && e.cents - m >= 2000) flagged.push({ e, m, n: h.length, ratio: e.cents / Math.max(m, 1) });
  }
  return flagged.sort((a, b) => b.ratio - a.ratio || a.e.id.localeCompare(b.e.id)).slice(0, 5).map(({ e, m, n, ratio }) => item(month, 'unusual', [e], {
    title: `Montant inhabituel : ${e.desc || e.category}`,
    cause: `${formatMinor(e.cents, e.currency)} en ${e.category}, alors que la médiane des ${n} dépenses précédentes (6 mois) est de ${formatMinor(m, e.currency)}.`,
    uncertainty: ratio > 5 ? 'medium' : 'low',
    uncertaintyLabel: `${ratio > 5 ? UNC.medium : UNC.low} : un achat exceptionnel peut être normal.`,
    amountCents: e.cents
  }));
}

/**
 * Analyse un mois. Les opérations saines ne sont pas listées : le résultat ne contient que des points de décision.
 * @param {object} account
 * @param {string} month « AAAA-MM »
 * @param {{today:string}} options
 */
export function buildMonthlyCheck(account, month, { today }) {
  if (!isMonth(month)) return { ok: false, reason: 'invalid-month' };
  if (!validDate(today)) return { ok: false, reason: 'invalid-date', errors: [{ code: 'invalid-date', field: 'today' }] };
  const all = prepare(account);
  const rangeStart = monthStart(shiftMonth(month, -6));
  const rangeEnd = monthEnd(month);
  const errors = [];
  for (const entry of all) {
    if (!validDate(entry.date)) {
      errors.push({ code: 'invalid-date', field: `transactions.${entry.id}.date`, transactionId: entry.t.id ?? null });
      continue;
    }
    if (entry.date < rangeStart || entry.date > rangeEnd) continue;
    if (!entry.amount.ok) errors.push({ ...entry.amount.error, transactionId: entry.t.id ?? null });
    else if (entry.amount.minor < 0) errors.push({ code: 'negative-transaction', message: 'Le montant doit être positif', field: `transactions.${entry.id}.amount`, transactionId: entry.t.id ?? null });
    if (!['income', 'expense', 'transfer'].includes(entry.t.type)) errors.push({ code: 'invalid-type', field: `transactions.${entry.id}.type`, transactionId: entry.t.id ?? null });
  }
  if (errors.length) return { ok: false, reason: 'invalid-data', errors };
  const inMonth = all.filter(e => e.date.startsWith(month));
  const raw = [];

  raw.push(...findDuplicates(month, inMonth));

  const uncategorised = inMonth.filter(e => e.type !== 'transfer' && (!e.category || normalize(e.category) === 'a classer'));
  if (uncategorised.length) {
    raw.push(item(month, 'category', uncategorised, {
      grouped: true,
      title: `${uncategorised.length} opération${uncategorised.length > 1 ? 's' : ''} sans catégorie`,
      cause: 'Catégorie vide ou « À classer » : ces opérations ne sont pas comptées dans les budgets par catégorie.',
      uncertainty: 'low', uncertaintyLabel: `${UNC.low} : la donnée est simplement absente.`
    }));
  }

  for (const e of inMonth.filter(e => e.planned && e.date < today && e.type !== 'transfer')) {
    raw.push(item(month, 'pending', [e], {
      title: `Paiement en attente : ${e.desc || 'Opération'}`,
      cause: `Prévu le ${e.date}, toujours marqué « à payer ». Il n’est pas déduit du solde actuel.`,
      uncertainty: 'low', uncertaintyLabel: `${UNC.low} : le paiement a peut-être eu lieu sans être déclaré.`,
      amountCents: e.cents
    }));
  }

  raw.push(...findUnusual(month, all, inMonth));

  // Écart de pointage : seulement si le mois est terminé et que l'utilisateur pointe déjà ses opérations.
  const paid = inMonth.filter(e => !e.planned && e.type !== 'transfer');
  const unpointed = paid.filter(e => !e.reconciled);
  if (monthEnd(month) < today && paid.some(e => e.reconciled) && unpointed.length) {
    raw.push(item(month, 'reconciliation', unpointed, {
      grouped: true,
      title: `${unpointed.length} opération${unpointed.length > 1 ? 's' : ''} non pointée${unpointed.length > 1 ? 's' : ''} sur ${paid.length}`,
      cause: 'Le reste du mois est pointé : ces opérations n’ont pas encore été comparées à votre relevé.',
      uncertainty: 'low', uncertaintyLabel: `${UNC.low} : à vérifier sur le relevé bancaire.`
    }));
  }

  const record = account?.monthlyChecks?.[month] || {};
  const decisions = record.decisions || {};
  const visible = [];
  const hidden = [];
  for (const it of raw) {
    const d = decisions[it.id];
    // Une proposition traitée ne revient qu'avec une donnée nouvelle (empreinte différente) ou à l'échéance du report.
    const sameData = d && d.fingerprint === it.fingerprint;
    const postponedOver = d?.action === 'postponed' && d.until && d.until <= today;
    if (sameData && !postponedOver) hidden.push({ item: it, decision: d });
    else visible.push({ ...it, reopened: Boolean(d && !sameData && !postponedOver) });
  }
  const flagged = new Set(visible.flatMap(v => v.refs));
  const signature = monthSignature(account, month);
  const status = record.validatedAt ? (record.signature === signature ? 'validated' : 'reopened') : 'open';
  return {
    ok: true, month, items: visible, hidden, status, signature,
    validatedAt: record.validatedAt || null,
    log: Array.isArray(record.log) ? record.log : [],
    counts: { operations: inMonth.length, healthy: inMonth.filter(e => !flagged.has(e.id)).length }
  };
}

const withRecord = (account, month) => JSON.parse(JSON.stringify(account?.monthlyChecks?.[month] || {}));
const logEntry = (record, entry) => { record.log = [entry, ...(record.log || [])].slice(0, 100); };

/**
 * Enregistre la décision de l'utilisateur sur une proposition ; retourne le nouvel enregistrement du mois.
 * @param {'confirmed'|'ignored'|'postponed'} action
 */
export function recordDecision(account, month, checkItem, action, { today, postponeDays = 7 } = {}) {
  if (!['confirmed', 'ignored', 'postponed'].includes(action)) throw new Error('Action inconnue');
  const record = withRecord(account, month);
  record.decisions = record.decisions || {};
  const decision = { action, at: today, fingerprint: checkItem.fingerprint };
  if (action === 'postponed') decision.until = addDays(today, postponeDays);
  record.decisions[checkItem.id] = decision;
  logEntry(record, { at: today, event: action, itemId: checkItem.id, title: checkItem.title });
  return record;
}

/** Valide le mois : « vérifié par l'utilisateur ». */
export function validateMonth(account, month, { today }) {
  const record = withRecord(account, month);
  record.validatedAt = today;
  record.signature = monthSignature(account, month);
  logEntry(record, { at: today, event: 'validated', title: 'Mois marqué comme vérifié par vous (pas une certification comptable).' });
  return record;
}

/** Rouvre un mois validé dont les opérations ont changé ; trace conservée une seule fois par état. */
export function traceReopen(account, month, { today }) {
  const record = withRecord(account, month);
  const signature = monthSignature(account, month);
  if (!record.validatedAt || record.signature === signature || record.reopenedFor === signature) return null;
  record.reopenedFor = signature;
  logEntry(record, { at: today, event: 'reopened', title: 'Une opération de ce mois a été modifiée après validation : le mois est rouvert.' });
  return record;
}

export const defaultMonth = today => shiftMonth(String(today).slice(0, 7), -1);
export { shiftMonth };
