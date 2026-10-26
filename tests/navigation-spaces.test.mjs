import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPACES, ALL_VIEWS, spaceOfView, primaryViewOf, mobileTabFor, tabsForView } from '../assets/js/spaces-model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const sidebar = html.slice(html.indexOf('<nav class="sidebar-nav"'), html.indexOf('</nav>', html.indexOf('<nav class="sidebar-nav"')));
const settings = html.slice(html.indexOf('<div id="settings-view"'));

test('NAV 01 : exactement six destinations, dans l’ordre du cahier des charges', () => {
  assert.deepEqual(SPACES.map(space => space.label), ['Tableau de bord', 'Opérations', 'Planificateur', 'Centre intelligent', 'Patrimoine', 'Paramètres']);
  const labels = [...sidebar.matchAll(/<button[^>]*class="nav-item[^"]*"[^>]*>[\s\S]*?<span>([^<]+)<\/span>/g)].map(match => match[1]);
  assert.deepEqual(labels, SPACES.map(space => space.label));
  assert.equal((sidebar.match(/<button /g) || []).length, 6);
});

test('NAV 01 : chaque entrée ouvre la vue principale de son espace', () => {
  for (const space of SPACES) {
    const button = sidebar.match(new RegExp(`<button[^>]*data-space="${space.id}"[^>]*>`))?.[0];
    assert.ok(button, `entrée absente : ${space.id}`);
    assert.match(button, new RegExp(`onclick="switchView\\('${space.primary}'\\)`));
    assert.equal(primaryViewOf(space.id), space.primary);
  }
});

test('NAV 01 : aucune fonction n’est orpheline, chaque vue appartient à un seul espace', () => {
  const containers = [...html.matchAll(/<div id="([a-z]+)-view"/g)].map(match => match[1]);
  assert.deepEqual([...ALL_VIEWS].sort(), containers.sort());
  const seen = new Set();
  for (const view of ALL_VIEWS) { assert.ok(spaceOfView(view)); assert.ok(!seen.has(view)); seen.add(view); }
  assert.equal(spaceOfView('inconnue'), null);
});

test('NAV 01 : récurrences, historique, dettes et analyses restent atteignables par onglets', () => {
  assert.deepEqual(tabsForView('recurring').map(item => item.view), ['transactions', 'recurring', 'history']);
  assert.deepEqual(tabsForView('debts').map(item => item.view), ['savings', 'debts']);
  assert.deepEqual(tabsForView('analytics').map(item => item.view), ['dashboard', 'analytics']);
  assert.deepEqual(tabsForView('planner'), []);
});

test('NAV 03 : la barre mobile propose Accueil, Opérations, Scanner et Réglages', () => {
  const bar = html.slice(html.indexOf('<nav class="bottom-nav"'), html.indexOf('</nav>', html.indexOf('<nav class="bottom-nav"')));
  const ids = [...bar.matchAll(/id="(bnav-[a-z]+)"/g)].map(match => match[1]);
  assert.deepEqual(ids, ['bnav-dashboard', 'bnav-transactions', 'bnav-scan', 'bnav-settings']);
  assert.equal(mobileTabFor('recurring'), 'transactions');
  assert.equal(mobileTabFor('debts'), null);
  assert.equal(mobileTabFor('analytics'), 'dashboard');
  assert.equal(mobileTabFor('smart'), null);
  assert.equal(mobileTabFor('settings'), 'settings');
  assert.doesNotMatch(sidebar, /data-mobile-hidden/);
});

test('NAV 01 : import, export, sauvegarde et restauration vivent dans Paramètres, pas dans le panneau latéral', () => {
  const aside = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
  for (const call of ['exportToExcel()', 'exportToPDF()', 'importFromExcel(this)', 'exportAllAccountsJSON()', 'importAllAccountsJSON(this)']) {
    assert.ok(!aside.includes(call), `${call} ne doit plus figurer dans le panneau latéral`);
    assert.ok(settings.slice(0, settings.indexOf('Comptes et préférences')).includes(call), `${call} doit figurer dans Paramètres`);
  }
  for (const title of ['Apparence', 'Données et sauvegardes', 'Sécurité et appareil']) assert.ok(settings.includes(title));
  assert.match(settings, /id="darkModeToggle"/);
  assert.match(settings, /id="pwaInstallButton"/);
});

test('PLA 03 : le comparateur de scénarios est retiré de l’interface, les données anciennes sont conservées', () => {
  assert.doesNotMatch(html, /Scénarios comparés|v41Scenarios|v5TabScenarios|v5PanelScenarios|v5ScenarioForm/);
  assert.doesNotMatch(read('assets/js/v4.js'), /compareForecastScenarios|renderScenarios/);
  assert.doesNotMatch(read('assets/js/v5.js'), /saveScenario|renderScenarios|data-v5-load-scenario/);
  assert.match(read('assets/js/v5.js'), /plannerScenarios = Array\.isArray\(account\.plannerScenarios\)/, 'les anciennes configurations ne sont pas effacées');
  assert.match(html, /id="v4Adjustment"/);
  assert.match(html, /Réinitialiser/);
});

test('DES : titres 1.0 pour le Planificateur et le Centre intelligent, sans badge de version répété', () => {
  assert.match(html, /PLANIFICATEUR 1\.0/);
  assert.match(html, /CENTRE INTELLIGENT 1\.0/);
  assert.doesNotMatch(html, /v4-new-badge|v5-new-badge/);
  assert.doesNotMatch(html, /Planificateur 4\.3|Centre intelligent 5\.1/);
});

test('le service worker précharge les nouveaux fichiers de navigation', () => {
  const sw = read('sw.js');
  for (const file of ['assets/css/space-tabs.css', 'assets/js/spaces.js', 'assets/js/spaces-model.mjs']) assert.ok(sw.includes(`./${file}`));
});
