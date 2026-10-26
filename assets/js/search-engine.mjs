// FREEV Gestion — recherche unique interprétée (REC 01 à REC 03, ALX 14).
// Module pur, sans accès au DOM ni au stockage : une demande en langage courant devient des critères
// structurés (visibles, modifiables), exécutés sur un index. Les montants sont comparés en centimes entiers.
// Aucune IA externe : l'interprétation de base est déterministe. Seul le texte tolère les fautes de frappe ;
// dates, montants et statuts demandés ne sont jamais élargis sans l'accord de l'utilisateur.

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const MONTH_LABELS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const STOPWORDS = new Set(('mes mon ma le la les l un une des du de d au aux en dans chez pour avec sur qui que ont est sont a y et ou ce cette ces ' +
  'mois annee moi tous toutes tout je voir afficher montre montrer liste trouve trouver cherche chercher recherche pas encore plus moins tres ' +
  'quel quelle quels quelles ai j operations operation transactions transaction par sont ete etre').split(' '));

const NAV_WORDS = new Set(['ou', 'comment', 'aller', 'ouvrir', 'acceder']);

// Groupes de synonymes (radicaux sans accent ni pluriel). Un groupe n'est utilisé que si une catégorie réelle y correspond.
const SYNONYM_GROUPS = [
  ['course', 'alimentation', 'alimentaire', 'supermarche', 'epicerie', 'nourriture'],
  ['transport', 'carburant', 'essence', 'deplacement'],
  ['logement', 'loyer', 'habitat'],
  ['restaurant', 'resto', 'restauration'],
  ['sante', 'pharmacie', 'medecin', 'medical'],
  ['loisir', 'divertissement', 'distraction'],
  ['abonnement', 'streaming'],
  ['shopping', 'vetement', 'habillement'],
  ['salaire', 'paie']
];

const EXPENSE_WORDS = new Set(['depense', 'achat', 'sortie', 'prelevement']);
const INCOME_WORDS = new Set(['revenu', 'entree', 'rentree', 'recette']);
const UP_WORDS = new Set(['augmente', 'augmentee', 'augmentes', 'augmentees', 'augmentation', 'hausse', 'monte', 'grimpe']);
const DOWN_WORDS = new Set(['baisse', 'baissee', 'diminue', 'diminuee']);

// Raccourcis de navigation : ils n'exécutent jamais l'action (export, import…) ; ils ouvrent seulement l'écran.
export const DESTINATIONS = [
  { id: 'export', label: 'Exporter mes opérations', path: 'Paramètres › Données et sauvegardes', view: 'settings', anchor: 'settingsData', keywords: ['exporter', 'export', 'telecharger', 'csv', 'qif', 'donnee'] },
  { id: 'import', label: 'Importer des opérations', path: 'Paramètres › Données et sauvegardes', view: 'settings', anchor: 'settingsData', keywords: ['importer', 'import', 'releve', 'csv', 'qif'] },
  { id: 'backup', label: 'Sauvegarder ou restaurer mes données', path: 'Paramètres › Données et sauvegardes', view: 'settings', anchor: 'settingsData', keywords: ['sauvegarde', 'sauvegarder', 'restaurer', 'restauration', 'backup', 'donnee'] },
  { id: 'settings', label: 'Paramètres', path: 'Paramètres', view: 'settings', anchor: null, keywords: ['parametre', 'reglage', 'apparence', 'theme'] },
  { id: 'accounts', label: 'Gérer mes comptes', path: 'Paramètres › Comptes', view: 'settings', anchor: 'settingsAccounts', keywords: ['compte', 'ajouter compte'] },
  { id: 'security', label: 'Sécurité et appareil', path: 'Paramètres › Sécurité', view: 'settings', anchor: 'settingsSecurity', keywords: ['securite', 'appareil', 'deconnexion'] },
  { id: 'spendable', label: 'Ce que je peux encore dépenser', path: 'Accueil', view: 'dashboard', anchor: 'spendableBlock', keywords: ['disponible', 'depenser', 'reserve', 'libre'] },
  { id: 'dashboard', label: 'Accueil', path: 'Accueil', view: 'dashboard', anchor: null, keywords: ['accueil', 'tableau'] },
  { id: 'transactions', label: 'Opérations', path: 'Opérations', view: 'transactions', anchor: null, keywords: ['operation', 'transaction', 'saisie', 'ajouter'] },
  { id: 'recurring', label: 'Opérations récurrentes', path: 'Opérations › Récurrences', view: 'recurring', anchor: null, keywords: ['recurrence', 'recurrent', 'recurrente', 'abonnement', 'echeance'] },
  { id: 'planner', label: 'Planificateur 1.0', path: 'Planificateur', view: 'planner', anchor: null, keywords: ['planificateur', 'prevision', 'simulation', 'simuler', 'objectif', 'enveloppe', 'budget'] },
  { id: 'smart', label: 'Centre intelligent 1.0', path: 'Planificateur › Centre intelligent', view: 'smart', anchor: null, keywords: ['centre', 'intelligent', 'alerte', 'anomalie'] },
  { id: 'analytics', label: 'Analyses', path: 'Analyses', view: 'analytics', anchor: null, keywords: ['analyse', 'graphique', 'statistique'] },
  { id: 'savings', label: 'Épargne', path: 'Patrimoine › Épargne', view: 'savings', anchor: null, keywords: ['epargne', 'patrimoine'] },
  { id: 'debts', label: 'Dettes', path: 'Patrimoine › Dettes', view: 'debts', anchor: null, keywords: ['dette', 'credit', 'emprunt', 'pret'] },
  { id: 'history', label: 'Historique', path: 'Historique', view: 'history', anchor: null, keywords: ['historique'] }
];

/** Minuscules, sans accents, apostrophes et espaces insécables normalisés. */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[  ]/g, ' ');
}

const stem = word => (word.length > 3 ? word.replace(/(?:s|x)$/, '') : word);
const toCents = text => Math.round(parseFloat(String(text).replace(',', '.')) * 100);
const pad = n => String(n).padStart(2, '0');
const lastDay = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate(); // month : 1..12
const monthRange = (year, month) => ({ from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(lastDay(year, month))}` });
const ymd = iso => { const [y, m, d] = String(iso).split('-').map(Number); return { y, m, d }; };
const shiftMonth = (year, month, delta) => { const index = year * 12 + (month - 1) + delta; return { y: Math.floor(index / 12), m: (index % 12) + 1 }; };
const addDays = (iso, delta) => { const { y, m, d } = ymd(iso); const date = new Date(Date.UTC(y, m - 1, d + delta)); return date.toISOString().slice(0, 10); };
const cap = text => text.charAt(0).toUpperCase() + text.slice(1);

function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Distance de Damerau-Levenshtein bornée (retourne max+1 au-delà). */
export function editDistance(a, b, max = 2) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = [];
  for (let i = 0; i <= a.length; i++) { rows.push(new Array(b.length + 1).fill(0)); rows[i][0] = i; }
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  }
  return rows[a.length][b.length];
}
const fuzzyLimit = term => (term.length <= 3 ? 0 : term.length <= 5 ? 1 : 2);

// ---------------------------------------------------------------------------------------------
// Interprétation
// ---------------------------------------------------------------------------------------------

const NUM = '(\\d+(?:[.,]\\d{1,2})?)';
const CUR = '(?:\\s*(?:€|eur(?![a-z])|euros?(?![a-z])))?';
const AMOUNT_PATTERNS = [
  ['between', new RegExp(`entre\\s+${NUM}${CUR}\\s+et\\s+${NUM}${CUR}`)],
  ['gte', new RegExp(`(?:au moins|minimum|>=|≥)\\s*${NUM}${CUR}`)],
  ['lte', new RegExp(`(?:au plus|maximum|<=|≤)\\s*${NUM}${CUR}`)],
  ['gt', new RegExp(`(?:au[- ]dessus de|plus de|superieur(?:e|es|s)? a|depassant|depasse(?:nt)?|>)\\s*${NUM}${CUR}`)],
  ['lt', new RegExp(`(?:en[- ]dessous de|moins de|inferieur(?:e|es|s)? a|sous les|sous|<)\\s*${NUM}${CUR}`)],
  ['approx', new RegExp(`(?:environ|autour de|approximativement|a peu pres|~)\\s*${NUM}${CUR}`)],
  ['exact', new RegExp(`${NUM}\\s*(?:€|eur(?![a-z])|euros?(?![a-z]))`)]
];

/** Tolérance proposée pour « environ » : un sixième du montant (30 € → 25–35 €), modifiable ensuite. */
export const approxTolerance = cents => Math.round(cents / 6);

function amountCriterion(mode, a, b) {
  const v = toCents(a);
  switch (mode) {
    case 'gt': return { mode, min: v, minInclusive: false, max: null, maxInclusive: true };
    case 'gte': return { mode, min: v, minInclusive: true, max: null, maxInclusive: true };
    case 'lt': return { mode, min: null, minInclusive: true, max: v, maxInclusive: false };
    case 'lte': return { mode, min: null, minInclusive: true, max: v, maxInclusive: true };
    case 'between': { const w = toCents(b); return { mode, min: Math.min(v, w), minInclusive: true, max: Math.max(v, w), maxInclusive: true }; }
    case 'approx': { const t = approxTolerance(v); return { mode, center: v, min: Math.max(0, v - t), minInclusive: true, max: v + t, maxInclusive: true }; }
    default: return { mode: 'exact', min: v, minInclusive: true, max: v, maxInclusive: true };
  }
}

function resolveMonth(monthIndex, today) {
  const t = ymd(today);
  const m = monthIndex + 1;
  return m <= t.m ? t.y : t.y - 1;
}

/**
 * Transforme une demande en critères structurés.
 * @param {string} query
 * @param {{today?:string, categories?:string[]}} [options] categories : catégories réellement présentes dans les comptes accessibles
 */
export function parseQuery(query, options = {}) {
  const today = options.today || todayISO();
  const knownCategories = [...new Set((options.categories || []).map(c => String(c || '')).filter(Boolean))];
  const criteria = { raw: String(query ?? ''), terms: [], type: null, categories: null, dateRange: null, amount: null, pointage: null, payment: null, trend: null, scope: 'current', notes: [] };
  let rest = ` ${normalizeText(query)} `;
  const take = (regex, handler) => {
    const match = regex.exec(rest);
    if (!match) return false;
    rest = `${rest.slice(0, match.index)} ${rest.slice(match.index + match[0].length)}`;
    handler(match);
    return true;
  };
  const T = ymd(today);

  // Statuts : pointage (rapprochement) et paiement sont deux notions distinctes.
  take(/\b(?:pas encore|non|jamais|a|sans)\s+(?:pointe|pointee|pointes|pointees|pointage|rapproche|rapprochee|rapproches|rapprochees|rapprochement)\b/, () => { criteria.pointage = 'unreconciled'; });
  if (!criteria.pointage) take(/\b(?:a pointer|a rapprocher)\b/, () => { criteria.pointage = 'unreconciled'; });
  if (!criteria.pointage) take(/\b(?:pointe|pointee|pointes|pointees|rapproche|rapprochee|rapproches|rapprochees)\b/, () => { criteria.pointage = 'reconciled'; });
  if (!take(/\b(?:pas encore (?:paye|payee|payes|payees)|impaye|impayee|impayes|impayees|a payer|planifie|planifiee|planifies|planifiees|a venir)\b/, () => { criteria.payment = 'planned'; })) {
    take(/\b(?:deja )?(?:paye|payee|payes|payees|regle|reglee|regles|reglees)\b/, () => { criteria.payment = 'paid'; });
  }

  // Dates exactes et relatives.
  let dateSet = false;
  const setDate = (range, label, kind, assumed = false) => { if (dateSet) return; dateSet = true; criteria.dateRange = { ...range, label, kind, assumed }; };
  take(/\b(\d{4})-(\d{2})-(\d{2})\b/, m => setDate({ from: m[0], to: m[0] }, `Le ${m[3]}/${m[2]}/${m[1]}`, 'day'));
  take(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/, m => { const iso = `${m[3]}-${pad(m[2])}-${pad(m[1])}`; setDate({ from: iso, to: iso }, `Le ${pad(m[1])}/${pad(m[2])}/${m[3]}`, 'day'); });
  take(/\bavant-hier\b/, () => { const d = addDays(today, -2); setDate({ from: d, to: d }, 'Avant-hier', 'day'); });
  take(/\bhier\b/, () => { const d = addDays(today, -1); setDate({ from: d, to: d }, 'Hier', 'day'); });
  take(/\baujourd'?hui\b/, () => setDate({ from: today, to: today }, 'Aujourd’hui', 'day'));
  take(/\b(\d{1,3}) derniers jours\b/, m => setDate({ from: addDays(today, -(Number(m[1]) - 1)), to: today }, `${m[1]} derniers jours`, 'range'));
  take(/\bmois (?:dernier|precedent)\b/, () => { const s = shiftMonth(T.y, T.m, -1); setDate(monthRange(s.y, s.m), `${cap(MONTH_LABELS[s.m - 1])} ${s.y}`, 'month'); });
  take(/\b(?:ce mois(?:-ci)?|mois en cours)\b/, () => setDate(monthRange(T.y, T.m), `${cap(MONTH_LABELS[T.m - 1])} ${T.y}`, 'month'));
  take(/\bannee (?:derniere|precedente)\b/, () => setDate({ from: `${T.y - 1}-01-01`, to: `${T.y - 1}-12-31` }, String(T.y - 1), 'year'));
  take(/\bcette annee\b/, () => setDate({ from: `${T.y}-01-01`, to: `${T.y}-12-31` }, String(T.y), 'year'));

  // Montants.
  for (const [mode, regex] of AMOUNT_PATTERNS) {
    if (criteria.amount) break;
    take(regex, m => { criteria.amount = amountCriterion(mode, m[1], m[2]); });
  }

  // Mois nommé, avec ou sans année ; une année seule.
  const monthRegex = new RegExp(`\\b(${MONTHS.join('|')})(?:\\s+((?:19|20)\\d{2}))?\\b`);
  take(monthRegex, m => {
    const index = MONTHS.indexOf(m[1]);
    const explicit = m[2] ? Number(m[2]) : null;
    const year = explicit ?? resolveMonth(index, today);
    setDate(monthRange(year, index + 1), `${cap(MONTH_LABELS[index])} ${year}`, 'month', !explicit);
    if (!explicit) criteria.notes.push(`Année ${year} retenue pour ${MONTH_LABELS[index]} : précisez l’année si besoin.`);
  });
  take(/\b((?:19|20)\d{2})\b/, m => setDate({ from: `${m[1]}-01-01`, to: `${m[1]}-12-31` }, m[1], 'year'));

  // Mots restants : type, tendance, catégories, puis texte libre.
  const tokens = rest.split(/[^a-z0-9]+/).filter(Boolean);
  const categoryInfo = knownCategories.map(name => ({ name, words: normalizeText(name).split(/[^a-z0-9]+/).filter(Boolean).map(stem) }));
  const matchedCategories = new Set();
  const categoryLabels = [];
  for (const token of tokens) {
    const s = stem(token);
    if (EXPENSE_WORDS.has(s)) { if (!criteria.type) criteria.type = 'expense'; if (s === 'prelevement') criteria.series = true; continue; }
    if (INCOME_WORDS.has(s)) { if (!criteria.type) criteria.type = 'income'; continue; }
    if (UP_WORDS.has(token)) { criteria.trend = 'increased'; continue; }
    if (DOWN_WORDS.has(token)) { criteria.trend = 'decreased'; continue; }
    if (STOPWORDS.has(token) || NAV_WORDS.has(token) || (token.length < 2 && !/\d/.test(token))) continue;
    const group = new Set([s]);
    SYNONYM_GROUPS.filter(g => g.includes(s)).forEach(g => g.forEach(w => group.add(w)));
    const hits = categoryInfo.filter(info => info.words.some(w => group.has(w)));
    if (hits.length) { hits.forEach(h => matchedCategories.add(h.name)); categoryLabels.push(token); continue; }
    criteria.terms.push(token);
  }
  if (matchedCategories.size) criteria.categories = { names: [...matchedCategories].sort((a, b) => a.localeCompare(b, 'fr')), asked: categoryLabels };
  if (criteria.trend && !criteria.type) criteria.type = 'expense';
  return criteria;
}

/** Raccourcis de navigation correspondant à la demande (distincts des résultats financiers). */
export function findShortcuts(query) {
  const tokens = normalizeText(query).split(/[^a-z0-9]+/).filter(Boolean);
  const navPhrase = tokens.some(t => NAV_WORDS.has(t));
  const content = tokens.filter(t => !STOPWORDS.has(t) && !NAV_WORDS.has(t) && t.length > 1).map(stem);
  if (!content.length) return { navPhrase, shortcuts: [], intent: 'search' };
  const found = [];
  for (const destination of DESTINATIONS) {
    const keys = new Set(destination.keywords.map(k => stem(k)));
    const hits = content.filter(t => keys.has(t)).length;
    // Sans tournure de navigation (« où », « comment »…), toute la demande doit viser cet écran.
    if (hits > 0 && (navPhrase || hits === content.length)) found.push({ destination, hits });
  }
  found.sort((a, b) => b.hits - a.hits || DESTINATIONS.indexOf(a.destination) - DESTINATIONS.indexOf(b.destination));
  const shortcuts = found.slice(0, 3).map(f => f.destination);
  return { navPhrase, shortcuts, intent: navPhrase && shortcuts.length ? 'navigation' : 'search' };
}

// ---------------------------------------------------------------------------------------------
// Index et exécution
// ---------------------------------------------------------------------------------------------

function wordsOf(text) {
  return String(text ?? '').split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(original => ({ n: normalizeText(original), o: original }));
}

/** Construit l'index de recherche (une entrée par opération réelle ; modèles récurrents et projections exclus). */
export function buildIndex(accounts) {
  const entries = [];
  for (const account of Array.isArray(accounts) ? accounts : []) {
    if (!account) continue;
    const accountName = String(account.name || 'Compte');
    for (const t of Array.isArray(account.transactions) ? account.transactions : []) {
      if (!t || typeof t !== 'object' || t.isRecurring || t.projected) continue;
      const raw = Number(t.amountBase ?? t.amount);
      const tags = Array.isArray(t.tags) ? t.tags.map(String) : [];
      const desc = String(t.desc || '');
      const category = String(t.category || '');
      const descN = normalizeText(desc);
      entries.push({
        tx: t,
        accountId: account.id,
        accountName,
        id: String(t.id ?? ''),
        date: String(t.date || ''),
        type: t.type === 'income' ? 'income' : t.type === 'transfer' ? 'transfer' : 'expense',
        cents: Number.isFinite(raw) ? Math.abs(Math.round(raw * 100)) : null,
        descN,
        catN: normalizeText(category),
        tagsN: normalizeText(tags.join(' ')),
        accN: normalizeText(accountName),
        words: [...wordsOf(desc), ...wordsOf(category), ...tags.flatMap(wordsOf)],
        planned: t.paymentStatus === 'planned',
        reconciled: Boolean(t.reconciled),
        seriesKey: t.parentId ? `p:${t.parentId}` : `d:${descN.replace(/[0-9]+/g, '').replace(/\s+/g, ' ').trim()}`
      });
    }
  }
  return entries;
}

function matchTerms(entry, terms) {
  let score = 0;
  const notes = [];
  for (const term of terms) {
    if (entry.descN.includes(term)) { score += 3; continue; }
    if (entry.catN.includes(term) || entry.tagsN.includes(term) || entry.accN.includes(term)) { score += 2; continue; }
    const limit = fuzzyLimit(term);
    let best = null;
    if (limit > 0) {
      for (const word of entry.words) {
        if (!word.n) continue;
        const d = editDistance(term, word.n, limit);
        if (d <= limit && (!best || d < best.d)) best = { d, word: word.o };
      }
    }
    if (!best) return null;
    score += 1;
    notes.push(`« ${term} » ≈ « ${best.word} » (orthographe proche)`);
  }
  return { score, notes };
}

const inRange = (cents, a) => {
  if (!a) return true;
  if (cents === null) return false;
  if (a.min !== null && a.min !== undefined && (a.minInclusive ? cents < a.min : cents <= a.min)) return false;
  if (a.max !== null && a.max !== undefined && (a.maxInclusive ? cents > a.max : cents >= a.max)) return false;
  return true;
};

function passes(entry, c, skip = {}) {
  if (c.type && entry.type !== c.type) return false;
  if (c.categories && !c.categories.names.includes(String(entry.tx.category || ''))) return false;
  if (!skip.date && c.dateRange && !(entry.date >= c.dateRange.from && entry.date <= c.dateRange.to)) return false;
  if (!skip.amount && !inRange(entry.cents, c.amount)) return false;
  if (!skip.status) {
    if (c.pointage === 'unreconciled' && (entry.reconciled || entry.planned)) return false;
    if (c.pointage === 'reconciled' && !entry.reconciled) return false;
    if (c.payment === 'planned' && !entry.planned) return false;
    if (c.payment === 'paid' && entry.planned) return false;
  }
  return true;
}

const byRank = (a, b) => b.score - a.score || b.entry.date.localeCompare(a.entry.date) || String(a.entry.accountId).localeCompare(String(b.entry.accountId)) || a.entry.id.localeCompare(b.entry.id);

function runCriteria(index, criteria, accountIds) {
  const scoped = index.filter(e => accountIds.has(e.accountId));
  if (criteria.trend) return runTrend(scoped, criteria);
  const results = [];
  for (const entry of scoped) {
    if (!passes(entry, criteria)) continue;
    const match = matchTerms(entry, criteria.terms);
    if (!match) continue;
    results.push({ entry, score: match.score, notes: match.notes });
  }
  return results.sort(byRank);
}

/** Évolution d'une série (même libellé ou même règle récurrente) : compare avec l'occurrence précédente. */
function runTrend(scoped, criteria) {
  const groups = new Map();
  for (const entry of scoped) {
    if (entry.planned || entry.cents === null || !entry.date) continue;
    if (!passes(entry, criteria, { date: true, amount: true, status: true })) continue;
    const key = `${entry.accountId}|${entry.seriesKey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const results = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    let current = -1;
    for (let i = list.length - 1; i >= 1; i--) {
      if (list[i].date === list[i - 1].date) continue;
      if (passes(list[i], criteria, { date: false }) ) { current = i; break; }
    }
    if (current < 1) continue;
    const now = list[current];
    const before = list[current - 1];
    const increased = now.cents > before.cents;
    const decreased = now.cents < before.cents;
    if ((criteria.trend === 'increased' && !increased) || (criteria.trend === 'decreased' && !decreased)) continue;
    const match = matchTerms(now, criteria.terms);
    if (!match) continue;
    results.push({ entry: now, score: match.score, notes: match.notes, change: { previous: { date: before.date, cents: before.cents }, current: { date: now.date, cents: now.cents }, delta: now.cents - before.cents } });
  }
  return results.sort(byRank);
}

const clone = c => JSON.parse(JSON.stringify(c));

function describeRange(range) {
  return range ? range.label : '';
}

function widenDates(criteria, today) {
  const r = criteria.dateRange;
  if (!r) return [];
  const out = [];
  const a = ymd(r.from);
  const monthOf = (y, m) => ({ range: monthRange(y, m), label: `${cap(MONTH_LABELS[m - 1])} ${y}`, kind: 'month' });
  if (r.kind === 'day' || r.kind === 'range') out.push(monthOf(a.y, a.m));
  if (r.kind === 'month' || r.kind === 'day' || r.kind === 'range') {
    const prev = shiftMonth(a.y, a.m, -1);
    const next = shiftMonth(a.y, a.m, 1);
    out.push(monthOf(prev.y, prev.m));
    if (`${next.y}-${pad(next.m)}` <= today.slice(0, 7)) out.push(monthOf(next.y, next.m));
    out.push({ range: { from: `${a.y}-01-01`, to: `${a.y}-12-31` }, label: String(a.y), kind: 'year' });
    out.push(monthOf(a.y - 1, a.m));
  } else if (r.kind === 'year') {
    out.push({ range: { from: `${a.y - 1}-01-01`, to: `${a.y - 1}-12-31` }, label: String(a.y - 1), kind: 'year' });
  }
  return out.map(o => ({ ...o, text: `Période : ${o.label}` }));
}

function widenAmount(a) {
  if (!a) return null;
  const mk = patch => ({ ...a, ...patch, mode: 'between' });
  const down = v => Math.round(v * 0.8);
  const up = v => Math.round(v * 1.2);
  if (a.mode === 'exact' || a.mode === 'approx') {
    const lo = Math.max(0, down(a.min)); const hi = up(a.max);
    return mk({ min: Math.min(lo, a.min - 100 > 0 ? a.min - 100 : lo), max: Math.max(hi, a.max + 100), minInclusive: true, maxInclusive: true });
  }
  if (a.mode === 'gt' || a.mode === 'gte') return mk({ min: down(a.min), minInclusive: true });
  if (a.mode === 'lt' || a.mode === 'lte') return mk({ max: up(a.max), maxInclusive: true });
  return mk({ min: a.min === null ? null : down(a.min), max: a.max === null ? null : up(a.max), minInclusive: true, maxInclusive: true });
}

/**
 * Exécute les critères sur les comptes autorisés.
 * @param {{currentAccounts:object[], allAccounts?:object[], criteria:object, today?:string, limit?:number, formatCents?:(c:number)=>string}} input
 *   currentAccounts : périmètre courant ; allAccounts : tous les comptes auxquels l'utilisateur a droit.
 */
export function executeSearch({ currentAccounts, allAccounts, criteria, today = todayISO(), limit = 50, formatCents = defaultFormat }) {
  const authorised = Array.isArray(allAccounts) && allAccounts.length ? allAccounts : currentAccounts || [];
  const index = buildIndex(authorised);
  const authorisedIds = new Set(authorised.filter(Boolean).map(a => a.id));
  const currentIds = new Set((currentAccounts || []).filter(a => a && authorisedIds.has(a.id)).map(a => a.id));
  const scopeIds = criteria.scope === 'all' ? authorisedIds : currentIds;
  const all = runCriteria(index, criteria, scopeIds);
  const result = {
    results: all.slice(0, limit).map(r => ({ ...r.entry, notes: r.notes, change: r.change, score: r.score })),
    total: all.length,
    truncated: all.length > limit,
    suggestions: [],
    scopeCount: scopeIds.size,
    hasMoreScope: authorisedIds.size > scopeIds.size
  };
  if (all.length) return result;

  // Aucun résultat exact : on ne propose que des élargissements qui donnent réellement des résultats, jamais appliqués d'office.
  const suggestions = [];
  const consider = (id, label, next) => {
    const count = runCriteria(index, next, next.scope === 'all' ? authorisedIds : currentIds).length;
    if (count > 0) suggestions.push({ id, label: `${label} · ${count} résultat${count > 1 ? 's' : ''}`, criteria: next, count });
  };
  const hasFilters = criteria.dateRange || criteria.amount || criteria.terms.length || criteria.categories || criteria.pointage || criteria.payment;
  if (!hasFilters) return result;

  widenDates(criteria, today).slice(0, 5).forEach((o, i) => {
    const next = clone(criteria);
    next.dateRange = { ...o.range, label: o.label, kind: o.kind, assumed: false };
    consider(`date-${i}`, o.text, next);
  });
  const wider = widenAmount(criteria.amount);
  if (wider) {
    const next = clone(criteria);
    next.amount = wider;
    consider('amount', `Montants de ${wider.min === null ? '…' : formatCents(wider.min)} à ${wider.max === null ? '…' : formatCents(wider.max)}`, next);
  }
  // Orthographe : mots du texte qui ne correspondent à rien dans le périmètre, rapprochés du vocabulaire connu.
  const vocab = new Map();
  index.filter(e => scopeIds.has(e.accountId)).forEach(e => e.words.forEach(w => { if (w.n.length > 2 && !vocab.has(w.n)) vocab.set(w.n, w.o); }));
  criteria.terms.forEach((term, ti) => {
    const limit = Math.max(2, Math.ceil(term.length * 0.4));
    let best = null;
    for (const [n, o] of vocab) {
      const d = editDistance(term, n, limit);
      if (d <= limit && n !== term && (!best || d < best.d || (d === best.d && n < best.n))) best = { d, n, o };
    }
    if (!best) return;
    const next = clone(criteria);
    next.terms[ti] = best.n;
    consider(`spell-${ti}`, `Vouliez-vous dire « ${best.o} » ?`, next);
  });
  if (criteria.scope !== 'all' && authorisedIds.size > scopeIds.size) {
    const next = clone(criteria);
    next.scope = 'all';
    consider('scope', 'Chercher dans tous mes comptes', next);
  }
  result.suggestions = suggestions.slice(0, 5);
  return result;
}

// ---------------------------------------------------------------------------------------------
// Critères affichables et modifiables
// ---------------------------------------------------------------------------------------------

function defaultFormat(cents) {
  return `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })} €`;
}

/** Liste des filtres compris, sous forme de pastilles : { key, label }. */
export function describeCriteria(criteria, { formatCents = defaultFormat } = {}) {
  const chips = [];
  if (criteria.type) chips.push({ key: 'type', label: criteria.type === 'income' ? 'Revenus' : 'Dépenses' });
  if (criteria.trend) chips.push({ key: 'trend', label: criteria.trend === 'increased' ? 'Montant en hausse' : 'Montant en baisse' });
  if (criteria.categories) chips.push({ key: 'categories', label: `Catégorie : ${criteria.categories.names.join(' / ')}` });
  criteria.terms.forEach((term, i) => chips.push({ key: `term:${i}`, label: `Texte : ${term}` }));
  if (criteria.dateRange) chips.push({ key: 'dateRange', label: describeRange(criteria.dateRange) });
  const a = criteria.amount;
  if (a) {
    let label;
    if (a.mode === 'approx') label = `Environ ${formatCents(a.center)} (${formatCents(a.min)} à ${formatCents(a.max)})`;
    else if (a.mode === 'exact') label = `Exactement ${formatCents(a.min)}`;
    else if (a.mode === 'gt') label = `Supérieur à ${formatCents(a.min)}`;
    else if (a.mode === 'gte') label = `Au moins ${formatCents(a.min)}`;
    else if (a.mode === 'lt') label = `Inférieur à ${formatCents(a.max)}`;
    else if (a.mode === 'lte') label = `Au plus ${formatCents(a.max)}`;
    else label = `De ${a.min === null ? '…' : formatCents(a.min)} à ${a.max === null ? '…' : formatCents(a.max)}`;
    chips.push({ key: 'amount', label });
  }
  if (criteria.pointage) chips.push({ key: 'pointage', label: criteria.pointage === 'unreconciled' ? 'Non pointées (paiements déjà réglés)' : 'Pointées' });
  if (criteria.payment) chips.push({ key: 'payment', label: criteria.payment === 'planned' ? 'À payer' : 'Payées' });
  return chips;
}

export function removeFilter(criteria, key) {
  const next = clone(criteria);
  if (key.startsWith('term:')) next.terms.splice(Number(key.slice(5)), 1);
  else if (key === 'trend') { next.trend = null; }
  else next[key] = null;
  return next;
}

/** Modifie l'intervalle de montant (centimes). null = borne absente. Bornes toujours inclusives une fois éditées. */
export function setAmountRange(criteria, min, max) {
  const next = clone(criteria);
  next.amount = (min === null && max === null) ? null : { mode: 'between', min, minInclusive: true, max, maxInclusive: true };
  return next;
}

/** Fixe un mois précis (« AAAA-MM »). */
export function setMonth(criteria, monthKey) {
  const next = clone(criteria);
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''));
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return next;
  const y = Number(match[1]); const m = Number(match[2]);
  next.dateRange = { ...monthRange(y, m), label: `${cap(MONTH_LABELS[m - 1])} ${y}`, kind: 'month', assumed: false };
  next.notes = (next.notes || []).filter(n => !n.startsWith('Année'));
  return next;
}

export function setType(criteria, type) {
  const next = clone(criteria);
  next.type = type === 'income' || type === 'expense' ? type : null;
  return next;
}

export function setScope(criteria, scope) {
  const next = clone(criteria);
  next.scope = scope === 'all' ? 'all' : 'current';
  return next;
}
