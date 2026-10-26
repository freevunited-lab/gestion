import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrenchReceipt, reconcileReceiptReads, shouldReadReceiptAgain, canPrefillReceiptTransaction, receiptFieldConfidence } from '../assets/js/receipt-scan-engine.mjs';

test('le formulaire automatique exige un ticket cohérent dans la devise du compte', () => {
  const complete = { amount: '42,50', date: '2026-10-25', merchant: 'Auchan', currency: 'EUR', missing: [], ambiguous: [] };
  assert.equal(canPrefillReceiptTransaction(complete, 'EUR'), true);
  assert.equal(canPrefillReceiptTransaction({ ...complete, ambiguous: ['montant'] }, 'EUR'), false);
  assert.equal(canPrefillReceiptTransaction({ ...complete, date: null }, 'EUR'), false);
  assert.equal(canPrefillReceiptTransaction(complete, 'USD'), false);
  assert.equal(canPrefillReceiptTransaction(complete, 'EUR', true), false);
});

test('le ticket Auchan extrait son marchand, sa date et son total TTC sans reprendre le paiement ni la monnaie rendue', () => {
  const parsed = parseFrenchReceipt(`AUCHAN SUPERMARCHE\nDATE 14/02/2026 12:42\nTVA 20,00 3,20\nTOTAL TTC 123,45 €\nCARTE 123,45 €\nRENDU 0,00 €`);
  assert.equal(parsed.merchant, 'Auchan');
  assert.equal(parsed.category, 'Alimentation');
  assert.equal(parsed.amount, '123,45');
  assert.equal(parsed.amountMinor, 12345);
  assert.equal(parsed.date, '2026-02-14');
  assert.equal(parsed.time, '12:42');
  assert.equal(parsed.currency, 'EUR');
  assert.equal(parsed.needsReview, true);
  assert.deepEqual(parsed.missing, []);
});

test('un ticket de remboursement et un total négatif ne deviennent jamais automatiquement une dépense', () => {
  const refund = parseFrenchReceipt('AUCHAN\nTICKET DE REMBOURSEMENT\nDATE 25/10/2026\nTOTAL TTC 12,40 €');
  assert.equal(refund.documentKind, 'refund');
  assert.equal(refund.description, 'Remboursement · Auchan');
  assert.equal(canPrefillReceiptTransaction(refund, 'EUR'), false);
  const negative = parseFrenchReceipt('LIDL\nDATE 25/10/2026\nNET A PAYER -12,40 €');
  assert.equal(negative.documentKind, 'refund');
  const splitNegative = parseFrenchReceipt('LIDL\nDATE 25/10/2026\nNET A PAYER\n-12,40 €');
  assert.equal(splitNegative.documentKind, 'refund');
  assert.equal(splitNegative.amountMinor, 1240);
  const ordinary = parseFrenchReceipt('LIDL\nDATE 25/10/2026\nAVOIR FIDÉLITÉ 2,00 €\nTOTAL TTC 12,40 €');
  assert.equal(ordinary.documentKind, 'expense');
});

test('détecte une heure explicite sans confondre les horaires du magasin', () => {
  const parsed = parseFrenchReceipt('LIDL\nDATE 25/10/2026\nHEURE 09h07\nHORAIRES OUVERTURE 08:00-20:00\nTOTAL TTC 18,20 €');
  assert.equal(parsed.time, '09:07');
  assert.deepEqual(parsed.ambiguous, []);
});

test('répare les confusions OCR dans une heure liée à la date sans inventer les horaires du magasin', () => {
  const parsed = parseFrenchReceipt('AUCHAN\nDATE 25/10/2026 O9:3O\nHORAIRES 08:00-20:00\nTOTAL TTC 18,20 €');
  assert.equal(parsed.time, '09:30');
  assert.equal(canPrefillReceiptTransaction(parsed, 'EUR'), true);
});

test('laisse vide une heure absente ou contradictoire', () => {
  const absent = parseFrenchReceipt('AUCHAN\nDATE 25/10/2026\nTOTAL TTC 18,20 €');
  assert.equal(absent.time, null);
  const conflicting = parseFrenchReceipt('AUCHAN\nDATE 25/10/2026 09:07\nDATE 25/10/2026 19:07\nTOTAL TTC 18,20 €');
  assert.equal(conflicting.time, null);
  assert.ok(conflicting.ambiguous.includes('heure'));
  assert.equal(canPrefillReceiptTransaction(conflicting, 'EUR'), false);
});

test('écarte les dates de validité et protège les dates de ticket contradictoires', () => {
  const valid = parseFrenchReceipt('AUCHAN\nDATE 25/10/2026\nVALIDITÉ CARTE 31/12/2027\nTOTAL TTC 12,40 €');
  assert.equal(valid.date, '2026-10-25');
  const conflict = parseFrenchReceipt('AUCHAN\nDATE 25/10/2026\nDATE 26/10/2026\nTOTAL TTC 12,40 €');
  assert.equal(conflict.date, null);
  assert.ok(conflict.ambiguous.includes('date'));
  assert.equal(canPrefillReceiptTransaction(conflict, 'EUR'), false);
});

test('repère deux dates contradictoires sur une même ligne et ignore l’heure d’une offre', () => {
  const dates = parseFrenchReceipt('AUCHAN\nDATE 25/10/2026 - 26/10/2026\nTOTAL TTC 12,40 €');
  assert.equal(dates.date, null);
  assert.ok(dates.ambiguous.includes('date'));
  const time = parseFrenchReceipt('AUCHAN\nDATE 25/10/2026 09:30\nVALIDITÉ PROMOTION 31/10/2026 23:59\nTOTAL TTC 12,40 €');
  assert.equal(time.time, '09:30');
  assert.deepEqual(time.ambiguous, []);
});

test('le total choisi est celui proche du libellé, pas la TVA imprimée après', () => {
  const parsed = parseFrenchReceipt('CARREFOUR\nDATE 25/10/2026\nTOTAL TTC 42,50 € TVA 7,08 €');
  assert.equal(parsed.amount, '42,50');
  const conflict = parseFrenchReceipt('CARREFOUR\nDATE 25/10/2026\nTOTAL TTC 42,50 €\nTOTAL TTC 24,50 €');
  assert.equal(conflict.amount, '');
  assert.ok(conflict.ambiguous.includes('montant'));
});

test('lit le total même si le paiement par carte est imprimé sur la même ligne', () => {
  const parsed = parseFrenchReceipt('AUCHAN\nDATE 25/10/2026\nTOTAL 42,50 €  CARTE 42,50 €\nTVA 3,70 €');
  assert.equal(parsed.amountMinor, 4250);
  assert.equal(parsed.amountEvidence, 'total');
  const subtotal = parseFrenchReceipt('AUCHAN\nDATE 25/10/2026\nSOUS-TOTAL 37,00 €\nTVA 5,50 €\nTOTAL 42,50 € CARTE 42,50 €');
  assert.equal(subtotal.amountMinor, 4250);
});

test('reconnaît les libellés usuels de montant payé sans retenir les prix des articles', () => {
  for (const label of ['MONTANT TOTAL', 'MONTANT TTC', 'TOTAL GÉNÉRAL', 'SOMME À PAYER']) {
    const parsed = parseFrenchReceipt(`AUCHAN\nDATE 25/10/2026\nCHOCOLAT 4,20 €\n${label} 12,40 €`);
    assert.equal(parsed.amountMinor, 1240, label);
    assert.notEqual(parsed.amountEvidence, 'montant-sans-libelle', label);
    assert.equal(canPrefillReceiptTransaction(parsed, 'EUR'), true, label);
  }
});

test('lit un total placé après son montant seulement si la ligne reste isolée', () => {
  const safe = parseFrenchReceipt('AUCHAN\nDATE 25/10/2026\n12,40 € TOTAL TTC');
  assert.equal(safe.amountMinor, 1240);
  const unsafe = parseFrenchReceipt('AUCHAN\nDATE 25/10/2026\nCHOCOLAT 12,40 € TOTAL TTC');
  assert.equal(unsafe.amountMinor, null);
  assert.equal(canPrefillReceiptTransaction(unsafe, 'EUR'), false);
});

test('lit un total imprimé sur la ligne suivante sans prendre le prix d’un article', () => {
  const split = parseFrenchReceipt('AUCHAN\nDATE 25/10/2026\nARTICLE 1,20 €\nTOTAL TTC\n12,40 €\nCARTE 12,40 €');
  assert.equal(split.amount, '12,40');
  assert.equal(split.amountEvidence, 'total-ttc-ou-du');
  const product = parseFrenchReceipt('AUCHAN\nDATE 25/10/2026\nTOTAL TTC\nCHOCOLAT 12,40 €');
  assert.equal(product.amount, '12,40');
  assert.equal(product.amountEvidence, 'montant-sans-libelle');
  assert.equal(canPrefillReceiptTransaction(product, 'EUR'), false);
});

test('un prix dans une autre devise et une marque dans les articles ne sont pas pris pour le ticket', () => {
  const mixed = parseFrenchReceipt('LIDL\nDATE 25/10/2026\nTOTAL TTC 12,40 €\nPRIX INDICATIF 13,20 USD');
  assert.equal(mixed.currency, null);
  assert.ok(mixed.ambiguous.includes('devise'));
  const merchant = parseFrenchReceipt('LIDL\nDATE 25/10/2026\nTOTAL TTC 12,40 €\nProduit AUCHAN');
  assert.equal(merchant.merchant, '');
  assert.ok(merchant.ambiguous.includes('magasin'));
});

test('trois lectures corrélées ne masquent pas un montant contradictoire', () => {
  const parsed = reconcileReceiptReads([
    'AUCHAN\nDATE 25/10/2026\nTOTAL TTC 12,40 €',
    'AUCHAN\nDATE 25/10/2026\nTOTAL TTC 12,40 €',
    'AUCHAN\nDATE 25/10/2026\nTOTAL TTC 21,40 €'
  ]);
  assert.equal(parsed.amount, '');
  assert.ok(parsed.ambiguous.includes('montant'));
});

test('les lectures des zones ne contaminent pas les champs hors de leur zone', () => {
  const parsed = reconcileReceiptReads([
    'AUCHAN\nDATE 25/10/2026\nTOTAL TTC 12,40 €',
    { text: 'AUCHAN\nDATE 25/10/2026\nPRODUIT 3,20 €', fields: ['merchant', 'date', 'time', 'currency'] },
    { text: 'PROMOTION LIDL\nDATE 25/10/2026\nNET A PAYER 12,40 €', fields: ['amountMinor', 'date', 'time', 'currency'] }
  ]);
  assert.equal(parsed.merchant, 'Auchan');
  assert.equal(parsed.amountMinor, 1240);
  assert.equal(parsed.date, '2026-10-25');
  assert.deepEqual(parsed.ambiguous, []);
});

test('un champ contradictoire reste vide même si une autre lecture donne une valeur', () => {
  const parsed = reconcileReceiptReads([
    'AUCHAN\nDATE 25/10/2026\nTOTAL TTC 12,40 €',
    { text: 'TOTAL TTC 12,40 €\nTOTAL TTC 21,40 €', fields: ['amountMinor'] }
  ]);
  assert.equal(parsed.amount, '');
  assert.ok(parsed.ambiguous.includes('montant'));
  assert.equal(canPrefillReceiptTransaction(parsed, 'EUR'), false);
});

test('les totaux identifiés priment sur les sous-totaux et les lignes de TVA', () => {
  const parsed = parseFrenchReceipt(`LIDL\nSOUS-TOTAL 18,00 €\nTVA 3,00 €\nNET A PAYER 21,00 €`);
  assert.equal(parsed.amount, '21,00');
  assert.equal(parsed.date, null);
  assert.deepEqual(parsed.missing, ['date']);
});

test('un ticket incomplet demande une vérification et ne fabrique ni montant ni date', () => {
  const parsed = parseFrenchReceipt('PETIT COMMERCE\nMerci de votre visite');
  assert.equal(parsed.amount, '');
  assert.equal(parsed.date, null);
  assert.equal(parsed.needsReview, true);
  assert.ok(parsed.missing.includes('montant'));
  assert.ok(parsed.missing.includes('date'));
});

test('une date impossible est écartée et les milliers français restent exacts', () => {
  const parsed = parseFrenchReceipt('CARREFOUR\nDate 31/02/2026\nTOTAL TTC 1 234,56 €');
  assert.equal(parsed.date, null);
  assert.equal(parsed.amount, '1234,56');
  assert.equal(parsed.amountMinor, 123456);
});

test('corrige les confusions OCR O/0 dans un montant et une date sans réécrire les mots du ticket', () => {
  const parsed = parseFrenchReceipt('AUCHAN\nDATE 14/02/2O26\nNET A PAYER 1O,9O €');
  assert.equal(parsed.amountMinor, 1090);
  assert.equal(parsed.date, '2026-02-14');
  assert.equal(parsed.merchant, 'Auchan');
});

test('reconnaît un libellé de total où le zéro a été confondu avec la lettre O', () => {
  const parsed = parseFrenchReceipt('CARREFOUR\nDATE 14/02/2026\nT0TAL TTC 18,40 €');
  assert.equal(parsed.amountMinor, 1840);
  assert.equal(parsed.amountEvidence, 'total-ttc-ou-du');
});

test('combine deux lectures concordantes et complète les champs manquants', () => {
  const parsed = reconcileReceiptReads([
    'AUCHAN\nDATE 14/02/2026\nTOTAL TTC 12,49 €',
    'DATE 14/02/2026\n12,49 EUR'
  ]);
  assert.equal(parsed.merchant, 'Auchan');
  assert.equal(parsed.amountMinor, 1249);
  assert.equal(parsed.date, '2026-02-14');
  assert.deepEqual(parsed.ambiguous, []);
});

test('laisse vide un montant contradictoire quand les deux lectures ont la même force', () => {
  const parsed = reconcileReceiptReads([
    'AUCHAN\nDATE 14/02/2026\nNET A PAYER 10,90 €',
    'AUCHAN\nDATE 14/02/2026\nNET A PAYER 19,90 €'
  ]);
  assert.equal(parsed.amount, '');
  assert.equal(parsed.amountMinor, null);
  assert.ok(parsed.ambiguous.includes('montant'));
  assert.ok(parsed.missing.includes('montant'));
});

test('ne relance la lecture que si un champ clé manque ou si la confiance OCR est très basse', () => {
  const complete = parseFrenchReceipt('AUCHAN\nDATE 14/02/2026\nTOTAL TTC 12,49 €');
  const partial = parseFrenchReceipt('AUCHAN\nTOTAL TTC 12,49 €');
  assert.equal(shouldReadReceiptAgain(complete, 82), false);
  assert.equal(shouldReadReceiptAgain(complete, 44), true);
  assert.equal(shouldReadReceiptAgain(partial, 82), true);
  assert.equal(shouldReadReceiptAgain(parseFrenchReceipt('AUCHAN\nDATE 14/02/2026\n12,49 €'), 82), true);
  assert.equal(shouldReadReceiptAgain(parseFrenchReceipt('AUCHAN\nDATE 14/02/2026\nDATE 15/02/2026\nTOTAL TTC 12,49 €'), 82), true);
});

test('les indicateurs distinguent les champs reconnus des valeurs à vérifier', () => {
  const strong = receiptFieldConfidence(parseFrenchReceipt('AUCHAN\nDATE 14/02/2026 12:42\nTOTAL TTC 12,49 €'));
  assert.deepEqual(strong, { merchant: 'high', amount: 'high', date: 'high', time: 'high' });
  const weak = receiptFieldConfidence(parseFrenchReceipt('PETIT COMMERCE\nDATE 14/02/2026\n12,49 €'));
  assert.equal(weak.merchant, 'medium');
  assert.equal(weak.amount, 'medium');
  assert.equal(weak.time, 'optional');
});
