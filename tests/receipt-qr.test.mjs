import test from 'node:test';
import assert from 'node:assert/strict';
import { extractReceiptQrText } from '../assets/js/receipt-qr.mjs';

test('un QR contenant les données du ticket peut compléter la lecture locale', () => {
  const text = 'AUCHAN\nDATE 25/10/2026 12:42\nTOTAL TTC 12,40 €';
  assert.equal(extractReceiptQrText([{ format: 'qr_code', rawValue: text }]), text);
});

test('un lien QR et un code sans montant ne créent aucune dépense', () => {
  assert.equal(extractReceiptQrText([{ format: 'qr_code', rawValue: 'https://exemple.fr/facture/123' }]), '');
  assert.equal(extractReceiptQrText([{ format: 'qr_code', rawValue: 'Ticket n° 123' }]), '');
});
