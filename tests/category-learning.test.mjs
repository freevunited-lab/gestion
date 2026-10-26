import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCorrectionSuggestions,
  createCorrectionLearningState,
  recordConfirmedCorrection,
  undoCorrectionEvidence
} from '../assets/js/category-learning.mjs';

function transaction(id, overrides = {}) {
  return {
    id,
    date: '2026-08-12',
    desc: 'CB CARREFOUR 4812',
    merchant: 'Carrefour',
    type: 'expense',
    amount: 24.5,
    category: 'Divers',
    ...overrides
  };
}

function confirm(state, item, corrected = { category: 'Alimentation', type: 'expense' }, extra = {}) {
  return recordConfirmedCorrection(state, {
    accountId: 'account-a',
    transaction: item,
    corrected,
    confirmedByUser: true,
    origin: 'transaction-editor',
    confirmedAt: '2026-08-12T10:00:00.000Z',
    ...extra
  });
}

test('un compte commence avec un journal d’apprentissage versionné et isolé', () => {
  assert.deepEqual(createCorrectionLearningState('account-a'), {
    schemaVersion: 1,
    accountId: 'account-a',
    entries: []
  });
});

test('seule une correction confirmée dans un éditeur de transaction produit une preuve', () => {
  const state = createCorrectionLearningState('account-a');
  const result = confirm(state, transaction('tx-1'), { category: 'Alimentation', type: 'expense' }, { evidenceId: 'evidence-1' });

  assert.equal(result.accepted, true);
  assert.equal(result.evidence.id, 'evidence-1');
  assert.equal(result.evidence.accountId, 'account-a');
  assert.equal(result.evidence.sourceCategory, 'Divers');
  assert.equal(result.evidence.category, 'Alimentation');
  assert.equal(result.reasonCode, 'recorded');
  assert.equal(state.entries.length, 0, 'l’état fourni reste immuable');
});

test('les transferts, récurrences, projections, aperçus d’import et actions non confirmées ne sont jamais appris', () => {
  const state = createCorrectionLearningState('account-a');
  const rejected = [
    confirm(state, transaction('transfer', { type: 'transfer' })),
    confirm(state, transaction('recurrence', { parentId: 'rule-1' })),
    confirm(state, transaction('recurrence-flag', { isRecurring: true })),
    confirm(state, transaction('projection', { projected: true })),
    confirm(state, transaction('planned', { paymentStatus: 'planned' })),
    confirm(state, transaction('preview-flag', { importPreview: true })),
    confirm(state, transaction('preview-origin'), undefined, { origin: 'import-preview' }),
    confirm(state, transaction('unconfirmed'), undefined, { confirmedByUser: false })
  ];

  assert.ok(rejected.every(result => !result.accepted));
  assert.equal(state.entries.length, 0);
});

test('un échantillon faible reste une suggestion avec une raison compréhensible et aucune application automatique', () => {
  let state = createCorrectionLearningState('account-a');
  state = confirm(state, transaction('tx-1')).state;
  state = confirm(state, transaction('tx-2')).state;
  const suggestions = buildCorrectionSuggestions('account-a', state);

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].status, 'suggestion');
  assert.equal(suggestions[0].sampleSize, 2);
  assert.equal(suggestions[0].confidence, 100);
  assert.equal(suggestions[0].eligibleForRule, false);
  assert.equal(suggestions[0].autoApply, false);
  assert.match(suggestions[0].reason, /2 corrections confirmées/);
  assert.match(suggestions[0].reason, /aucune opération ne sera modifiée/i);
});

test('trois corrections cohérentes peuvent être proposées pour revue, jamais appliquées automatiquement', () => {
  let state = createCorrectionLearningState('account-a');
  for (let index = 1; index <= 3; index += 1) state = confirm(state, transaction(`tx-${index}`)).state;
  const [suggestion] = buildCorrectionSuggestions('account-a', state);

  assert.equal(suggestion.status, 'ready-for-review');
  assert.equal(suggestion.sampleSize, 3);
  assert.equal(suggestion.confidence, 100);
  assert.equal(suggestion.eligibleForRule, true);
  assert.equal(suggestion.autoApply, false);
  assert.match(suggestion.reason, /3 corrections confirmées/);
});

test('des corrections contradictoires abaissent la confiance et restent à vérifier', () => {
  let state = createCorrectionLearningState('account-a');
  state = confirm(state, transaction('tx-1')).state;
  state = confirm(state, transaction('tx-2')).state;
  state = confirm(state, transaction('tx-3'), { category: 'Loisirs', type: 'expense' }).state;
  const [suggestion] = buildCorrectionSuggestions('account-a', state);

  assert.equal(suggestion.sampleSize, 3);
  assert.equal(suggestion.confidence, 67);
  assert.equal(suggestion.status, 'suggestion');
  assert.equal(suggestion.eligibleForRule, false);
  assert.match(suggestion.reason, /cohérence de 67 %/);
});

test('les suggestions sont isolées par compte et par type d’origine', () => {
  let state = createCorrectionLearningState('account-a');
  state = confirm(state, transaction('tx-1'), { category: 'Revenus', type: 'income' }).state;
  const leaked = buildCorrectionSuggestions('account-b', state);
  const suggestions = buildCorrectionSuggestions('account-a', state);

  assert.deepEqual(leaked, []);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].matchType, 'expense');
  assert.equal(suggestions[0].type, 'income');
  assert.equal(suggestions[0].category, 'Revenus');
});

test('la persistance JSON conserve les preuves et annuler une correction retire son influence', () => {
  let state = createCorrectionLearningState('account-a');
  state = confirm(state, transaction('tx-1'), { category: 'Alimentation', type: 'expense' }, { evidenceId: 'first' }).state;
  state = confirm(state, transaction('tx-1'), { category: 'Loisirs', type: 'expense' }, { evidenceId: 'second' }).state;
  const persisted = JSON.parse(JSON.stringify(state));

  assert.equal(buildCorrectionSuggestions('account-a', persisted)[0].category, 'Loisirs');
  const undone = undoCorrectionEvidence(persisted, 'second', {
    accountId: 'account-a',
    undoneAt: '2026-08-12T11:00:00.000Z'
  });
  const [restoredSuggestion] = buildCorrectionSuggestions('account-a', undone.state);

  assert.equal(undone.undone, true);
  assert.equal(restoredSuggestion.category, 'Alimentation');
  assert.equal(restoredSuggestion.sampleSize, 1);
  assert.equal(restoredSuggestion.status, 'suggestion');
  assert.equal(undone.evidence.reason, 'Correction annulée : cette opération ne contribue plus à la suggestion.');
});

test('enregistrer une correction plus récente ne modifie pas l’ancien état sauvegardé', () => {
  const first = confirm(createCorrectionLearningState('account-a'), transaction('tx-1'),
    { category: 'Alimentation', type: 'expense' }, { evidenceId: 'first' });
  const previousSnapshot = JSON.stringify(first.state);
  const second = confirm(first.state, transaction('tx-1'),
    { category: 'Loisirs', type: 'expense' }, { evidenceId: 'second' });

  assert.equal(first.state.entries[0].status, 'active');
  assert.equal(JSON.stringify(first.state), previousSnapshot);
  assert.equal(second.state.entries.find(entry => entry.id === 'first').status, 'superseded');
});

test('un état d’un autre compte ou une annulation d’un autre compte est refusé sans fuite', () => {
  const state = createCorrectionLearningState('account-a');
  const wrongScope = recordConfirmedCorrection(state, {
    accountId: 'account-b', transaction: transaction('tx-1'),
    corrected: { category: 'Alimentation', type: 'expense' },
    confirmedByUser: true, origin: 'transaction-editor'
  });
  const undoWrongScope = undoCorrectionEvidence(state, 'any-id', { accountId: 'account-b' });

  assert.equal(wrongScope.accepted, false);
  assert.equal(wrongScope.reasonCode, 'account-scope-mismatch');
  assert.equal(undoWrongScope.undone, false);
  assert.deepEqual(buildCorrectionSuggestions('account-b', state), []);
});
