import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('les règles Firestore limitent chaque document financier à son propriétaire', () => {
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  assert.match(rules, /request\.auth\.uid\s*==\s*userId/);
  assert.match(rules, /match \/users\/\{userId\}/);
  assert.match(rules, /validFinancialWrite\(\)/);
  assert.match(rules, /request\.resource\.data\.revision == resource\.data\.revision \+ 1/);
  assert.match(rules, /allow delete: if false/);
  assert.match(rules, /match \/\{document=\*\*\}[\s\S]*allow read, write: if false/);
});

test('Storage reste fermé tant que le coffre documentaire n’est pas livré', () => {
  const rules = fs.readFileSync(path.join(root, 'storage.rules'), 'utf8');
  assert.match(rules, /match \/\{allPaths=\*\*\}/);
  assert.match(rules, /allow read, write: if false/);
});

test('l’export Excel neutralise les chaînes interprétables comme formules', () => {
  const source = fs.readFileSync(path.join(root, 'assets/js/data-io.js'), 'utf8');
  assert.match(source, /function spreadsheetSafeRows/);
  assert.match(source, /\^\[=\+\\-@\\t\\r\]/);
  assert.ok((source.match(/spreadsheetSafeRows\(/g) || []).length >= 6);
});
