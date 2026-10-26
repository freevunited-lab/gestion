import { parseFrenchReceipt, receiptFieldConfidence } from './receipt-scan-engine.mjs';

const FIELDS = ['merchant', 'amount', 'date', 'time'];

// Évalue les transcriptions OCR annotées ; ne prétend pas mesurer la qualité
// de l'appareil photo ou du moteur OCR sans les images d'origine.
export function evaluateReceiptTranscriptions(samples = []) {
  const result = { count: 0, fields: {}, unsafeHighConfidence: 0, cases: [] };
  for (const field of FIELDS) result.fields[field] = { correct: 0, proposed: 0, wrong: 0, missing: 0, expected: 0 };
  for (const sample of samples) {
    if (typeof sample?.text !== 'string' || !sample.expected || FIELDS.some(field => !(field in sample.expected))) throw new TypeError('Ticket annoté incomplet');
    const parsed = parseFrenchReceipt(sample.text);
    const confidence = receiptFieldConfidence(parsed);
    const errors = [];
    result.count++;
    for (const field of FIELDS) {
      const expected = sample.expected[field] ?? null;
      const actual = parsed[field] || null;
      const score = result.fields[field];
      if (expected !== null) score.expected++;
      if (actual !== null) score.proposed++;
      if (actual === expected) score.correct++;
      else {
        if (actual === null) score.missing++;
        else score.wrong++;
        errors.push({ field, expected, actual, confidence: confidence[field] });
        if (confidence[field] === 'high') result.unsafeHighConfidence++;
      }
    }
    if (errors.length) result.cases.push({ name: sample.name || `ticket ${result.count}`, errors });
  }
  return result;
}
