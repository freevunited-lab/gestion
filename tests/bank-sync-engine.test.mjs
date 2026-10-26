import test from 'node:test';
import assert from 'node:assert/strict';
import { bankStatusCopy, buildBankMappingRows, isSafeBankRedirect, normalizeBankCandidate, normalizeBankConnectionStatus, normalizeBankMappings, prepareBankImport } from '../assets/js/bank-sync-engine.js';

test('la connexion bancaire normalise les états reçus du serveur', () => {
  assert.deepEqual(normalizeBankConnectionStatus({ state: 'ready', institution: ' Banque de test ', pendingCount: 2, lastSync: '2026-08-24T10:00:00.000Z' }), {
    state: 'ready', institution: 'Banque de test', pendingCount: 2, lastSync: '2026-08-24T10:00:00.000Z'
  });
  assert.equal(normalizeBankConnectionStatus({ state: 'unknown', pendingCount: -3 }).state, 'not_connected');
});

test('la redirection bancaire exige HTTPS', () => {
  assert.equal(isSafeBankRedirect('https://consent.example/authorize'), true);
  assert.equal(isSafeBankRedirect('http://consent.example/authorize'), false);
  assert.equal(isSafeBankRedirect('javascript:alert(1)'), false);
});

test('le statut ne promet pas d’import automatique silencieux', () => {
  assert.match(bankStatusCopy({ state: 'ready', pendingCount: 3 }).detail, /à vérifier/);
});

test('chaque compte bancaire est associé à un seul compte Freev valide', () => {
  const banks = [{ id: 'bank-current', name: 'Compte courant', type: 'current' }, { id: 'bank-savings', name: 'Livret A', type: 'savings' }];
  const freev = [{ id: 'freev-main', name: 'Compte principal' }, { id: 'freev-savings', name: 'Épargne' }];
  const mappings = normalizeBankMappings([
    { bankAccountId: 'bank-current', freevAccountId: 'freev-main' },
    { bankAccountId: 'bank-savings', freevAccountId: 'freev-main' },
    { bankAccountId: 'unknown', freevAccountId: 'freev-savings' }
  ], banks, freev);
  assert.deepEqual(mappings, [{ bankAccountId: 'bank-current', freevAccountId: 'freev-main' }]);
  assert.deepEqual(buildBankMappingRows(banks, freev, [{ bankAccountId: 'bank-savings', freevAccountId: 'freev-savings' }]).map(row => [row.bankAccount.name, row.freevAccountId]), [
    ['Compte courant', ''], ['Livret A', 'freev-savings']
  ]);
});

test('les opérations bancaires restent en aperçu et sont réparties par compte Freev', () => {
  const accounts = [
    { id: 'freev-main', name: 'Compte principal', transactions: [{ id: 'old', date: '2026-08-02', desc: 'Courses', type: 'expense', amount: 42.9 }] },
    { id: 'freev-savings', name: 'Épargne', transactions: [] }
  ];
  const prepared = prepareBankImport([
    { id: 'tx-new', bankAccountId: 'bank-current', date: '2026-08-03', label: 'Salaire août', amount: 2100, currency: 'EUR' },
    { id: 'tx-duplicate', bankAccountId: 'bank-current', date: '2026-08-02', label: 'Courses', amount: -42.9, currency: 'EUR' },
    { id: 'tx-unmapped', bankAccountId: 'bank-savings', date: '2026-08-04', label: 'Virement', amount: 20, currency: 'EUR' }
  ], [{ bankAccountId: 'bank-current', freevAccountId: 'freev-main' }], accounts);
  assert.equal(prepared.importable.length, 2, 'la ressemblance reste importable après une revue explicite');
  const salary = prepared.importable.find(item => item.type === 'income');
  assert.deepEqual(salary && { freevAccountId: salary.freevAccountId, type: salary.type, amount: salary.amount, source: salary.source }, {
    freevAccountId: 'freev-main', type: 'income', amount: 2100, source: 'bank-sync'
  });
  assert.equal(prepared.duplicates.length, 0, 'une ressemblance sans identité fournisseur reste à examiner');
  assert.equal(prepared.possibleDuplicates.length, 1);
  assert.equal(prepared.importable.find(item => item.bankTransactionId === 'tx-duplicate').needsReview, true);
  assert.equal(prepared.unmapped.length, 1);
});

test('un identifiant fournisseur déjà importé est le seul doublon bancaire écarté avec certitude', () => {
  const existing = { id: 'old', bankAccountId: 'bank-current', bankTransactionId: 'tx-same', date: '2026-08-02', desc: 'Courses', type: 'expense', amount: 42.9, currency: 'EUR' };
  const result = prepareBankImport([
    { id: 'tx-same', bankAccountId: 'bank-current', date: '2026-08-02', label: 'Courses', amount: -42.9, currency: 'EUR' }
  ], [{ bankAccountId: 'bank-current', freevAccountId: 'freev-main' }], [
    { id: 'freev-main', name: 'Compte principal', transactions: [existing] }
  ]);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.importable.length, 0);
  assert.equal(result.duplicates[0].duplicateEvidence[0].field, 'provider-identity');
});

test('une devise bancaire incompatible n’est jamais enregistrée au mauvais taux', () => {
  const result = prepareBankImport([
    { id: 'usd-tx', bankAccountId: 'bank-current', date: '2026-08-04', label: 'Café', amount: -3, currency: 'USD' }
  ], [{ bankAccountId: 'bank-current', freevAccountId: 'freev-main' }], [
    { id: 'freev-main', name: 'Compte principal', settings: { baseCurrency: 'EUR' }, transactions: [] }
  ]);
  assert.equal(result.importable.length, 0);
  assert.equal(result.currencyMismatch[0].targetCurrency, 'EUR');
});

test('une opération bancaire invalide ne peut pas être importée', () => {
  assert.equal(normalizeBankCandidate({ id: 'bad', bankAccountId: 'bank', date: '2026-08-40', label: 'Test', amount: 3 }), null);
  assert.equal(normalizeBankCandidate({ id: 'ok', bankAccountId: 'bank', date: '2026-08-04', label: 'Test', amount: -3 }).type, 'expense');
});
