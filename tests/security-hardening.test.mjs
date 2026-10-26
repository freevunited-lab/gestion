import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('les imports ont des limites et valident les identifiants avant affichage', () => {
  const source = read('assets/js/data-io.js');
  assert.match(source, /const IMPORT_LIMITS/);
  assert.match(source, /function validateImportId/);
  assert.match(source, /file\.size > IMPORT_LIMITS\.jsonBytes/);
  assert.match(source, /file\.size > IMPORT_LIMITS\.excelBytes/);
  assert.match(source, /Import sécurisé terminé/);
});

test('les tags, catégories et identifiants de transaction ne passent plus dans des gestionnaires HTML', () => {
  const ui = read('assets/js/ui.js');
  const categories = read('assets/js/customization.js');
  const transactions = read('assets/js/transactions.js');
  assert.match(ui, /chip\.addEventListener\('click'/);
  assert.doesNotMatch(ui, /onclick="addTagFromFavorite/);
  assert.match(categories, /edit\.addEventListener\('click'/);
  assert.match(categories, /safeCustomCategoryColor/);
  assert.doesNotMatch(categories, /onclick='startEditCategory/);
  assert.match(transactions, /js-switch-account/);
  assert.doesNotMatch(transactions, /onclick="switchAccount/);
  assert.match(transactions, /data-id="\$\{escapeHTML\(String\(t\.id/);
});

test('le cache local et le rapport sont liés à l utilisateur Firebase connecté', () => {
  const state = read('assets/js/state.js');
  const auth = read('assets/js/firebase-auth.js');
  const report = read('assets/js/report.js');
  assert.match(state, /ownerUid: String\(window\.__freevUserId/);
  assert.match(auth, /function localCacheBelongsTo/);
  assert.match(auth, /authSessionGeneration/);
  assert.match(report, /function loadData\(expectedOwnerUid/);
  assert.match(report, /ownerUid!==expectedOwnerUid/);
});
