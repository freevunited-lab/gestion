import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const ui = read('../assets/js/v5.js');

test('une suggestion affiche son échantillon et limite la règle au type appris', () => {
  assert.match(ui, /data-match-type="\$\{escapeHTML\(suggestion\.matchType\)\}"/);
  assert.match(ui, /\$\{suggestion\.count\}\/\$\{suggestion\.sampleSize\} opérations/);
  assert.match(ui, /data-rule-type="\$\{escapeHTML\(suggestion\.type\)\}"/);
  assert.match(ui, /addRule\(target\.dataset\.v5AddSuggestion, target\.dataset\.category, target\.dataset\.ruleType \|\| '', true, target\.dataset\.matchType/);
  assert.match(ui, /rule\?\.matchType && \(!\['income', 'expense'\]\.includes\(rule\.matchType\) \|\| transaction\.type !== rule\.matchType\)/);
});

test('les règles filtrées par type sont distinguées dans la liste des règles', () => {
  assert.match(ui, /revenus uniquement/);
  assert.match(ui, /dépenses uniquement/);
  assert.match(ui, /String\(rule\.matchType \|\| ''\) === String\(matchType \|\| ''\)/);
});
