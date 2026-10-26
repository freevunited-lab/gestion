// Extraction prudente des champs d'un ticket. Le moteur ne comptabilise jamais
// directement : chaque valeur extraite reste à relire par la personne.
const MERCHANTS = [
  { pattern: /\b(?:auchan|simply market)\b/i, name: 'Auchan', category: 'Alimentation', label: 'Courses' },
  { pattern: /\bcarrefour(?: market| city| express)?\b/i, name: 'Carrefour', category: 'Alimentation', label: 'Courses' },
  { pattern: /\b(?:e\s*[.]?\s*)?leclerc\b/i, name: 'E.Leclerc', category: 'Alimentation', label: 'Courses' },
  { pattern: /\bintermarch[eé]\b/i, name: 'Intermarché', category: 'Alimentation', label: 'Courses' },
  { pattern: /\blidl\b/i, name: 'Lidl', category: 'Alimentation', label: 'Courses' },
  { pattern: /\baldi\b/i, name: 'Aldi', category: 'Alimentation', label: 'Courses' },
  { pattern: /\bsuper\s*u\b/i, name: 'Super U', category: 'Alimentation', label: 'Courses' },
  { pattern: /\bmonoprix\b/i, name: 'Monoprix', category: 'Alimentation', label: 'Courses' },
  { pattern: /\bcasino\b/i, name: 'Casino', category: 'Alimentation', label: 'Courses' },
  { pattern: /\bpharmacie\b/i, name: 'Pharmacie', category: 'Santé', label: 'Pharmacie' },
  { pattern: /\bdecathlon\b/i, name: 'Decathlon', category: 'Shopping', label: 'Achat' },
  { pattern: /\bikea\b/i, name: 'IKEA', category: 'Shopping', label: 'Achat' },
  { pattern: /\bfnac\b/i, name: 'Fnac', category: 'Shopping', label: 'Achat' },
  { pattern: /\baction\b/i, name: 'Action', category: 'Shopping', label: 'Achat' },
  { pattern: /\btotalenergies\b/i, name: 'TotalEnergies', category: 'Transport', label: 'Carburant' },
  { pattern: /\btotal access\b/i, name: 'Total Access', category: 'Transport', label: 'Carburant' },
  { pattern: /\besso\b/i, name: 'Esso', category: 'Transport', label: 'Carburant' },
  { pattern: /\bshell\b/i, name: 'Shell', category: 'Transport', label: 'Carburant' }
];

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
const validDate = (year, month, day) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

function findDate(lines) {
  const candidates = [];
  for (const [lineIndex, rawLine] of lines.entries()) {
    const source = String(rawLine);
    const normalized = normalize(source);
    if (/\b(?:validite|expiration|expire|echeance|livraison|garantie|promotion|promo|retour)\b/.test(normalized)) continue;
    const score = /\bdate\b/.test(normalized) ? 3 : /\b(?:[01]?\d|2[0-3])(?::|h)[0-5]\d\b/.test(normalized) ? 2 : lineIndex < 6 ? 1 : 0;
    const line = /[OQIl|]/.test(source) && /\d/.test(source) && /[/.\-]/.test(source)
      ? source.replace(
        /(?<![\p{L}\p{N}])([\dOQIl|]{1,4})([/.\-])([\dOQIl|]{1,2})([/.\-])([\dOQIl|]{2,4})(?![\p{L}\p{N}])/giu,
        (_, first, separatorOne, second, separatorTwo, third) => `${first}${separatorOne}${second}${separatorTwo}${third}`.replace(/[OQ]/gi, '0').replace(/[Il|]/g, '1')
      )
      : source;
    for (const iso of line.matchAll(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
      const [, year, month, day] = iso;
      if (validDate(+year, +month, +day)) candidates.push({ date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, lineIndex, score });
    }
    for (const match of line.matchAll(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|20\d{2})\b/g)) {
      const [, day, month, rawYear] = match;
      const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
      if (validDate(year, +month, +day)) candidates.push({ date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, lineIndex, score });
    }
  }
  if (!candidates.length) return { date: null, ambiguous: false };
  const highest = Math.max(...candidates.map(item => item.score));
  const best = candidates.filter(item => item.score === highest);
  return new Set(best.map(item => item.date)).size === 1
    ? { date: best[0].date, ambiguous: false }
    : { date: null, ambiguous: true };
}

function findTime(lines) {
  const candidates = [];
  for (const [lineIndex, raw] of lines.entries()) {
    const line = normalize(raw).replace(
      /(?<![\p{L}\p{N}])([0-2oqil|][0-9oqil|]?)([:h])([0-5oqil|][0-9oqil|])(?![\p{L}\p{N}])/gu,
      (token, hour, separator, minute) => `${hour}${separator}${minute}`.replace(/[OQ]/gi, '0').replace(/[Il|]/g, '1')
    );
    if (/\b(?:horaires?|ouverture|fermeture|ouvert|ferme|validite|expiration|expire|echeance|livraison|garantie|promotion|promo|retour)\b/.test(line)) continue;
    const hasDate = /\b(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.](?:\d{2}|20\d{2}))\b/.test(line);
    const labelled = /\b(?:date|heure|time|encaissement|paiement)\b/.test(line);
    const loneTime = /^\s*\d{1,2}(?::|h)\d{2}\s*$/.test(line);
    if (!hasDate && !labelled && !loneTime) continue;
    for (const match of line.matchAll(/(?<!\d)([01]?\d|2[0-3])(?::|h)([0-5]\d)(?!\d)/g)) {
      candidates.push({ time: `${match[1].padStart(2, '0')}:${match[2]}`, score: hasDate ? 3 : labelled ? 2 : 1, lineIndex });
    }
  }
  if (!candidates.length) return { time: null, ambiguous: false };
  const bestScore = Math.max(...candidates.map(item => item.score));
  const best = candidates.filter(item => item.score === bestScore);
  return new Set(best.map(item => item.time)).size === 1
    ? { time: best[0].time, ambiguous: false }
    : { time: null, ambiguous: true };
}

function parseReceiptAmount(raw) {
  const compact = String(raw).replace(/[\s\u00a0\u202f]/g, '');
  const decimalIndex = Math.max(compact.lastIndexOf(','), compact.lastIndexOf('.'));
  if (decimalIndex < 0) return null;
  const whole = compact.slice(0, decimalIndex).replace(/[,.]/g, '');
  const fraction = compact.slice(decimalIndex + 1);
  if (!/^\d+$/.test(whole || '0') || !/^\d{2}$/.test(fraction)) return null;
  const amount = `${whole || '0'},${fraction}`;
  const minor = Number(BigInt(whole || '0') * 100n + BigInt(fraction));
  return Number.isSafeInteger(minor) && minor > 0 ? { amount, minor } : null;
}

function repairOcrTotalLabel(value) {
  const line = normalize(value);
  if (!/\bt[0o]tal\b|\btota[i1l]\b/.test(line)) return line;
  return line
    .replace(/\bt[0o]tal\b/g, 'total')
    .replace(/\btota[i1l]\b/g, 'total')
    .replace(/\bnet\s*a\s*payer\b/g, 'net a payer');
}

function repairOcrAmounts(value) {
  // Corrige O/I/l uniquement dans un jeton numérique avec séparateur décimal.
  // Les mots du ticket ne sont donc pas réécrits.
  const source = String(value);
  if (!/[OQIl|]/.test(source) || !/\d/.test(source) || !/[,.]/.test(source) || !/(?:\d[OQIl|]|[OQIl|]\d)/.test(source)) return source;
  return source.replace(
    /(?<![\p{L}\p{N}])[\dOQIl|][\dOQIl| .,\u00a0\u202f]*[.,][\dOQIl|]{2}(?![\p{L}\p{N}])/giu,
    token => token.replace(/[OQ]/gi, '0').replace(/[Il|]/g, '1')
  );
}

function findTotal(lines) {
  const amounts = /(?<!\d)(?:\d{1,3}(?:[ .\u00a0\u202f]\d{3})+|\d+)[,.]\d{2}(?!\d)/g;
  const candidates = [];
  const exclusions = /\b(?:sous[ -]?total|sous[ -]?tot|tva|\bht\b|rendu|a rendre|monnaie|remise|reduction|fid[eé]lit[eé]|carte|ticket|caisse|articles?|dont|economie|economies)\b/;
  const priorities = [
    [/\bnet\s*(?:a|à)\s*payer\b/, 120],
    [/\btotal\s*(?:ttc|a payer|a regler|du|general|paye)\b/, 110],
    [/\bmontant\s*(?:total|ttc|du|paye|a payer)\b/, 100],
    [/\b(?:somme\s+)?(?:a|à)\s*payer\b/, 95],
    [/\btotal\b/, 75]
  ];
  for (const [lineIndex, rawLine] of lines.entries()) {
    const repairedLine = repairOcrAmounts(rawLine);
    const line = repairOcrTotalLabel(repairedLine);
    const matches = [...repairedLine.matchAll(amounts)];
    const priority = priorities.find(([pattern]) => pattern.test(line))?.[1] || 0;
    const labelMatch = priority ? line.match(/\b(?:net\s*a\s*payer|total(?:\s+(?:ttc|a payer|a regler|du|general|paye))?|montant\s+(?:total|ttc|du|paye|a payer)|(?:somme\s+)?a\s*payer)\b/) : null;
    // Une mention de carte ou de TVA après le total ne disqualifie pas celui-ci.
    // En revanche « sous-total » ou « carte total » avant le libellé désigne
    // un montant annexe : on ne le propose pas comme somme payée.
    if (exclusions.test(labelMatch ? line.slice(0, labelMatch.index + labelMatch[0].length) : line)) continue;
    const labelEnd = labelMatch ? labelMatch.index + labelMatch[0].length : -1;
    const parsed = matches.map(match => ({ parsed: parseReceiptAmount(match[0]), raw: match[0], matchIndex: match.index,
      negative: /-\s*$/.test(repairedLine.slice(0, match.index)) || /^\s*\(/.test(repairedLine.slice(Math.max(0, match.index - 2), match.index)) && /^\)/.test(repairedLine.slice(match.index + match[0].length).trimStart())
    })).filter(item => item.parsed && (labelEnd < 0 || item.matchIndex >= labelEnd || (
      matches.length === 1 && /^[\s€]*(?:[\d .\u00a0\u202f]+[,.]\d{2})?\s*(?:€|EUR|EUROS?)?\s*$/i.test(repairedLine.slice(0, labelMatch.index))
    )));
    const nearest = priority && parsed.length ? parsed.reduce((best, item) => item.matchIndex < best.matchIndex ? item : best) : null;
    for (const item of parsed) {
      if (nearest && item !== nearest) continue;
      const proximity = /\b(?:euros?|eur|€)\b|€/.test(line) ? 2 : 0;
      const evidence = priority >= 120 ? 'net-a-payer'
        : priority >= 110 ? 'total-ttc-ou-du'
          : priority >= 95 ? 'montant-a-payer'
            : priority >= 75 ? 'total'
              : 'montant-sans-libelle';
      candidates.push({ ...item.parsed, negative: item.negative, score: priority + proximity, evidence, lineIndex, matchIndex: item.matchIndex });
    }
    // Certains terminaux impriment le libellé et la somme sur deux lignes.
    // La seconde ligne doit contenir uniquement le prix et, éventuellement, la devise.
    if (priority && !matches.length && lines[lineIndex + 1]) {
      const nextLine = repairOcrAmounts(lines[lineIndex + 1]).trim();
      const isolated = nextLine.match(/^(-)?\s*(?:€\s*)?((?:\d{1,3}(?:[ .\u00a0\u202f]\d{3})+|\d+)[,.]\d{2})\s*(?:€|EUR|EUROS?)?$/i);
      const amount = isolated && parseReceiptAmount(isolated[2]);
      if (amount) {
        const evidence = priority >= 120 ? 'net-a-payer'
          : priority >= 110 ? 'total-ttc-ou-du'
            : priority >= 95 ? 'montant-a-payer' : 'total';
        candidates.push({ ...amount, negative: Boolean(isolated[1]), score: priority - 1, evidence, lineIndex: lineIndex + 1, matchIndex: 0 });
      }
    }
  }
  if (!candidates.length) return null;
  const highest = Math.max(...candidates.map(item => item.score));
  const best = candidates.filter(item => item.score === highest);
  if (new Set(best.map(item => `${item.minor}:${item.negative}`)).size > 1) return { ambiguous: true };
  return best.sort((a, b) => b.lineIndex - a.lineIndex)[0];
}

function detectMerchant(lines) {
  const header = lines.slice(0, 8).join('\n');
  const known = MERCHANTS.filter(merchant => merchant.pattern.test(header));
  if (known.length === 1) return { name: known[0].name, category: known[0].category, label: known[0].label, recognized: true, ambiguous: false };
  if (known.length > 1) return { name: '', category: '', label: 'Ticket', recognized: false, ambiguous: true };
  const ignored = /\b(?:siret|siren|tva|ticket|caisse|recu|merci|bienvenue|tel|telephone|www|http|date|heure|cb|carte|total|adresse|ouvert|ferme)\b/i;
  const line = lines.slice(0, 6).map(value => value.replace(/[^\p{L}\p{N}&'. -]/gu, ' ').replace(/\s+/g, ' ').trim())
    .find(value => value.length >= 3 && value.length <= 42 && /\p{L}/u.test(value) && !ignored.test(normalize(value)));
  return line ? { name: line, category: '', label: 'Ticket', recognized: false, ambiguous: false } : { name: '', category: '', label: 'Ticket', recognized: false, ambiguous: false };
}

export function parseFrenchReceipt(text = '') {
  const lines = String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const merchant = detectMerchant(lines);
  const total = findTotal(lines);
  const dateResult = findDate(lines);
  const timeResult = findTime(lines);
  const normalizedText = normalize(text);
  const headerText = normalize(lines.slice(0, 6).join(' '));
  const refundLabel = /\b(?:ticket|recu|justificatif)\s*(?:de\s*)?(?:remboursement|retour|avoir)\b|\b(?:remboursement|avoir)\s+client\b/.test(headerText)
    || lines.some(line => /\b(?:total\s+(?:remboursement|rembourse|a rembourser)|montant\s+(?:rembourse|a rembourser))\b/.test(normalize(line)));
  const documentKind = refundLabel || total?.negative ? 'refund' : 'expense';
  const currencies = [
    [/€|\beur\b/, 'EUR'], [/\bchf\b/, 'CHF'], [/\bgbp\b|£/, 'GBP'],
    [/\bcad\b|\bca\$/, 'CAD'], [/\busd\b|\bus\$/, 'USD']
  ].filter(([pattern]) => pattern.test(normalizedText)).map(([, code]) => code);
  const currency = currencies.length === 1 ? currencies[0] : null;
  const missing = [];
  if (!merchant.name) missing.push('magasin');
  if (!total?.minor) missing.push('montant');
  if (!dateResult.date) missing.push('date');
  const ambiguous = [
    ...(merchant.ambiguous ? ['magasin'] : []),
    ...(total?.ambiguous ? ['montant'] : []),
    ...(dateResult.ambiguous ? ['date'] : []),
    ...(timeResult.ambiguous ? ['heure'] : []),
    ...(currencies.length > 1 ? ['devise'] : [])
  ];
  return {
    merchant: merchant.name,
    merchantRecognized: merchant.recognized,
    description: documentKind === 'refund' ? `Remboursement · ${merchant.name || 'ticket'}` : merchant.name ? `${merchant.label} · ${merchant.name}` : 'Ticket de caisse',
    documentKind,
    category: merchant.category,
    amount: total?.amount || '',
    amountMinor: total?.minor ?? null,
    amountEvidence: total?.evidence || null,
    date: dateResult.date,
    time: timeResult.time,
    currency,
    missing,
    ambiguous,
    needsReview: true
  };
}

const AMOUNT_EVIDENCE_WEIGHT = Object.freeze({
  'net-a-payer': 5,
  'total-ttc-ou-du': 4,
  'montant-a-payer': 3,
  total: 2,
  'montant-sans-libelle': 0
});

function reconcileField(reads, field, ambiguous, options = {}) {
  if (ambiguous.includes(options.label || field)) return null;
  const values = reads.map(read => read[field]).filter(value => value !== null && value !== undefined && value !== '');
  const groups = new Map();
  for (const value of values) groups.set(value, (groups.get(value) || 0) + 1);
  if (!groups.size) return null;
  if (groups.size === 1) return groups.keys().next().value;

  if (field === 'amountMinor') {
    const ranked = [...groups].map(([value]) => {
      const matchingReads = reads.filter(read => read.amountMinor === value);
      const evidence = Math.max(...matchingReads.map(read => AMOUNT_EVIDENCE_WEIGHT[read.amountEvidence] ?? 0));
      return { value, evidence };
    }).sort((a, b) => b.evidence - a.evidence);
    const [best, runnerUp] = ranked;
    // Plusieurs lectures du même cliché ne sont pas des preuves indépendantes.
    if (best.evidence - runnerUp.evidence >= 2) return best.value;
    ambiguous.push(options.label || field);
    return null;
  }

  if (field === 'merchant') {
    const recognized = reads.filter(read => read.merchantRecognized && read.merchant).map(read => read.merchant);
    if (new Set(recognized).size === 1) return recognized[0];
  }
  ambiguous.push(options.label || field);
  return null;
}

/**
 * Combine independent OCR layouts without silently choosing conflicting values.
 * A unique value can fill a missing field; disagreements stay blank for review.
 */
export function reconcileReceiptReads(textReads = []) {
  const allFields = ['amountMinor', 'date', 'time', 'merchant', 'currency'];
  const ambiguityFields = { montant: 'amountMinor', date: 'date', heure: 'time', magasin: 'merchant', devise: 'currency' };
  const entries = textReads.map(value => typeof value === 'string' ? { text: value, fields: allFields } : value)
    .filter(value => String(value?.text || '').trim())
    .map(value => ({ parsed: parseFrenchReceipt(value.text), fields: new Set(Array.isArray(value.fields) ? value.fields : allFields) }));
  if (!entries.length) return parseFrenchReceipt('');
  const forField = field => entries.filter(entry => entry.fields.has(field)).map(entry => entry.parsed);
  const ambiguous = entries.flatMap(entry => entry.parsed.ambiguous.filter(label => entry.fields.has(ambiguityFields[label])));
  const amountMinor = reconcileField(forField('amountMinor'), 'amountMinor', ambiguous, { label: 'montant' });
  const date = reconcileField(forField('date'), 'date', ambiguous, { label: 'date' });
  const time = reconcileField(forField('time'), 'time', ambiguous, { label: 'heure' });
  const merchant = reconcileField(forField('merchant'), 'merchant', ambiguous, { label: 'magasin' });
  const currency = reconcileField(forField('currency'), 'currency', ambiguous, { label: 'devise' });
  const selectedMerchant = forField('merchant').find(read => read.merchant === merchant);
  const selectedAmount = forField('amountMinor').filter(read => read.amountMinor === amountMinor)
    .sort((a, b) => (AMOUNT_EVIDENCE_WEIGHT[b.amountEvidence] ?? 0) - (AMOUNT_EVIDENCE_WEIGHT[a.amountEvidence] ?? 0))[0];
  const selected = entries[0].parsed;
  const documentKind = entries.some(entry => entry.parsed.documentKind === 'refund') ? 'refund' : 'expense';
  const result = {
    ...selected,
    merchant: merchant || '',
    merchantRecognized: Boolean(selectedMerchant?.merchantRecognized),
    description: documentKind === 'refund' ? `Remboursement · ${merchant || 'ticket'}` : merchant ? `${selectedMerchant?.description.split(' · ')[0] || 'Ticket'} · ${merchant}` : 'Ticket de caisse',
    documentKind,
    category: selectedMerchant?.category || '',
    amount: amountMinor === null ? '' : (selectedAmount?.amount || ''),
    amountMinor,
    amountEvidence: amountMinor === null ? null : selectedAmount?.amountEvidence || null,
    date: date || null,
    time: time || null,
    currency: currency || null,
    ambiguous: [...new Set(ambiguous)],
    needsReview: true
  };
  result.missing = [];
  if (!result.merchant) result.missing.push('magasin');
  if (result.amountMinor === null) result.missing.push('montant');
  if (!result.date) result.missing.push('date');
  return result;
}

/** A second OCR layout is worthwhile for missing or contradictory key fields, or very weak text. */
export function shouldReadReceiptAgain(parsed, confidence) {
  const score = Number(confidence);
  return !parsed?.amount || !parsed?.date || !parsed?.merchant || Boolean(parsed?.ambiguous?.length) || parsed.amountEvidence === 'montant-sans-libelle' || (Number.isFinite(score) && score < 45);
}

export function receiptFieldConfidence(parsed) {
  const ambiguous = new Set(parsed?.ambiguous || []);
  const missing = new Set(parsed?.missing || []);
  const status = (field, present, strong) => ambiguous.has(field) || missing.has(field) || !present ? 'review' : strong ? 'high' : 'medium';
  return {
    merchant: status('magasin', parsed?.merchant, parsed?.merchantRecognized),
    amount: status('montant', parsed?.amount, ['net-a-payer', 'total-ttc-ou-du', 'montant-a-payer', 'total'].includes(parsed?.amountEvidence)),
    date: status('date', parsed?.date, true),
    time: !parsed?.time && !ambiguous.has('heure') ? 'optional' : status('heure', parsed?.time, true)
  };
}

/** Ouvre le formulaire seulement quand les éléments essentiels sont cohérents. */
export function canPrefillReceiptTransaction(parsed, accountCurrency, secondReadFailed = false) {
  if (!parsed || secondReadFailed || !parsed.amount || !parsed.date || !parsed.merchant) return false;
  if (parsed.documentKind === 'refund') return false;
  if (parsed.missing?.length || parsed.ambiguous?.length) return false;
  if (parsed.amountEvidence === 'montant-sans-libelle') return false;
  return parsed.currency === String(accountCurrency || 'EUR').toUpperCase();
}
