import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('le chargement d’une bibliothèque distante expire rapidement et reste réessayable', () => {
  const source = read('assets/js/vendor-loader.js');
  assert.match(source, /}, 8_000\);/);
  assert.match(source, /vendorPromises\.delete\(name\)/);
});

test('le tableau de bord explique l’indisponibilité des graphiques', () => {
  const source = read('assets/js/dashboard.js');
  assert.match(source, /trendChartSummary/);
  assert.match(source, /Les graphiques ne se chargent pas\. Actualisez la page/);
});
