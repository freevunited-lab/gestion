import { parseFrenchReceipt } from './receipt-scan-engine.mjs';

// Un QR contenant seulement un lien ou un identifiant ne constitue pas une preuve de dépense.
export function extractReceiptQrText(codes = []) {
  for (const code of codes) {
    if (code?.format !== 'qr_code') continue;
    const value = String(code.rawValue || '').trim();
    if (!value || value.length > 5000 || /^\w+:\/\//i.test(value)) continue;
    const parsed = parseFrenchReceipt(value);
    if (parsed.amount && parsed.date && parsed.merchant) return value;
  }
  return '';
}
