import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('le centre d’aide propose recherche, parcours, exemples et accès contextuels', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'assets/js/help.js'), 'utf8');

  assert.match(html, /id="freevHelpOverlay"[^>]+role="dialog"[^>]+aria-modal="true"/);
  assert.match(html, /data-freev-help-tab="planner"/);
  assert.match(html, /data-freev-help-tab="smart"/);
  assert.match(html, /id="freevHelpSearch"/);
  assert.match(html, /data-freev-help-step="planner-data"/);
  assert.match(html, /data-freev-help-progress="smart"/);
  assert.match(html, /Tester un imprévu de 500 €/);
  assert.match(html, /Classer Netflix dans Abonnements/);
  assert.match(html, /Date;Description;Montant;Catégorie/);
  assert.match(html, /data-freev-help-smart-tab="rules"/);
  assert.match(html, /Pourquoi mon fichier est-il refusé/);
  assert.match(script, /lastFocused/);
  assert.match(script, /event\.key === 'Escape'/);
  assert.match(script, /trapFocus/);
  assert.match(script, /searchHelp/);
  assert.match(script, /localStorage\.setItem\(progressKey/);
});
