import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/css/premium-priority3.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'assets/js/premium-priority3.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'assets/js/core.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

const createNode = (onclick = '') => {
  const attrs = new Map([['onclick', onclick]]);
  return {
    textContent: '',
    attrs,
    getAttribute(key) { return attrs.get(key) ?? null; },
    setAttribute(key, value) { attrs.set(key, value); },
    removeAttribute(key) { attrs.delete(key); }
  };
};

function harness(currentView='dashboard') {
  const ids = new Map(['premiumWorkspaceTitle','premiumWorkspaceSection','premiumWorkspaceDesc'].map(id=>[id, createNode()]));
  const sidebar = { classList: { contains: () => false } };
  const sidebarNav = ['dashboard','transactions','recurring','analytics','planner','smart','savings','debts','history','settings'].map(view => createNode(`switchView('${view}')`));
  const mobileNav = ['dashboard','transactions','analytics','savings','more'].map(view => ({ ...createNode(), id: `bnav-${view}` }));
  const document = {
    readyState: 'complete',
    body: null,
    getElementById: id => ids.get(id) || null,
    querySelector: selector => selector==='.sidebar'? sidebar : null,
    querySelectorAll: selector => selector.startsWith('#sidebarNav')? sidebarNav: selector==='.bottom-nav-item'? mobileNav:[],
    addEventListener() {}
  };
  const body = { dataset: {} };
  document.body = body;
  const window = {};
  vm.runInNewContext(js,{document,window,currentView, Object});
  return { window, document, ids, sidebarNav, mobileNav };
}

test('l’interface enregistre les dix vues sans changer les données financières', () => {
  const h=harness();
  for (const view of ['dashboard','transactions','recurring','analytics','planner','smart','savings','debts','history','settings'])
    assert.equal(h.window.FreevPremiumUI.setView(view), true, view);
  assert.equal(h.document.body.dataset.freevView, 'settings');
});

test('une navigation affiche un titre contextualisé et sa description', () => {
  const h=harness();
  h.window.FreevPremiumUI.setView('recurring');
  assert.equal(h.ids.get('premiumWorkspaceTitle').textContent, 'Paiements réguliers');
  assert.match(h.ids.get('premiumWorkspaceDesc').textContent, /reviennent/);
});

test('les valeurs sont insérées en texte et non en HTML', () => {
  const h=harness();
  assert.equal(h.window.FreevPremiumUI.setView('dashboard'), true);
  assert.equal(typeof h.ids.get('premiumWorkspaceTitle').textContent, 'string');
  assert.doesNotMatch(js, /document\.write/);
  assert.match(js, /titleEl\.textContent = title/);
  assert.match(js, /descEl\.textContent = desc/);
  assert.match(js, /art\.innerHTML = pageArt\[view\]/);
});

test('une vue inconnue ne modifie pas le titre ni le menu', () => {
  const h=harness();
  const title = h.ids.get('premiumWorkspaceTitle').textContent;
  assert.equal(h.window.FreevPremiumUI.setView('not-a-view'), false);
  assert.equal(h.ids.get('premiumWorkspaceTitle').textContent, title);
});

test('une seule entrée du menu reçoit aria-current=page', () => {
  const h=harness();
  h.window.FreevPremiumUI.setView('history');
  const active=h.sidebarNav.filter(n=>n.getAttribute('aria-current')==='page');
  assert.equal(active.length,1);
  assert.match(active[0].getAttribute('onclick'), /history/);
});

test('la navigation mobile reçoit son état actif correctement', () => {
  const h=harness();
  h.window.FreevPremiumUI.setView('analytics');
  assert.deepEqual(h.mobileNav.filter(n=>n.getAttribute('aria-current')==='page').map(n=>n.id), ['bnav-analytics']);
  h.window.FreevPremiumUI.setView('debts');
  assert.equal(h.mobileNav.filter(n=>n.getAttribute('aria-current')==='page').length,0);
});

test('le menu natif est utilisable au clavier avec un bouton par vue', () => {
  assert.equal((html.match(/<button type="button" class="nav-item[^>]*onclick="switchView/g)||[]).length,6);
  assert.match(html, /href="#mainWorkspace"/);
  assert.match(html, /id="mainWorkspace" tabindex="-1"/);
});

test('les en-têtes contiennent des actions qui appellent les fonctions existantes', () => {
  assert.match(html, /id="workspaceAddTrigger"[^>]*aria-controls="workspaceAddPanel"/);
  assert.match(html, /data-workspace-add="transaction"/);
  assert.match(core, /if \(action === 'transaction'\) openModal\(\)/);
});

test('les actions hors contexte sont masquées et le solde de départ fonctionne depuis le tableau de bord', () => {
  assert.match(css, /\.premium-workspace-add-item\[hidden\]\s*\{\s*display:\s*none\s*!important\s*\}/);
  assert.match(core, /dashboard:\s*\[[^\]]*'capital'/);
  assert.match(core, /action === 'capital'\)\s*\{\s*toggleCapitalModal\(\)/);
});

test('chaque action proposée par le menu Ajouter possède un gestionnaire', () => {
  const menuActions = new Set([...html.matchAll(/data-workspace-add="([^"]+)"/g)].map(match => match[1]));
  const handledActions = new Set([...core.matchAll(/action === '([^']+)'/g)].map(match => match[1]));
  for (const action of menuActions) assert.ok(handledActions.has(action), `gestionnaire manquant : ${action}`);
});

test('le changement de vue synchronise menus et contexte sans recalcul financier', () => {
  assert.match(core, /FreevPremiumUI\?\.setView\?\.\(view\)/);
  assert.match(core, /setBottomNav\(view\)/);
  assert.doesNotMatch(js, /saveData|firebase|localStorage|transactions\s*=/i);
});

test('les commandes mois et scan mobile sont annoncées au lecteur d’écran', () => {
  assert.match(html, /aria-label="Mois précédent"/);
  assert.match(html, /aria-label="Mois suivant"/);
  assert.match(html, /id="bnav-scan"[^>]+aria-label="Scanner un ticket de caisse" aria-haspopup="dialog"/);
  assert.match(html, /id="sidebarNav" aria-label="Navigation de FREEV Gestion"/);
});

test('les styles prévoient les écrans mobiles et très étroits', () => {
  assert.match(css, /max-width:\s*768px/);
  assert.match(css, /max-width:\s*375px/);
  assert.match(css, /\.premium-workspace-actions \{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('le mode sombre et les préférences de mouvement réduit sont respectés', () => {
  assert.match(css, /\.dark-mode\s*\{/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /:focus-visible/);
});

test('la PWA charge et met en cache les deux nouveaux assets', () => {
  assert.match(html, /assets\/css\/premium-priority3\.css/);
  assert.match(html, /assets\/js\/premium-priority3\.js/);
  assert.match(sw, /freev-v5\.2\.0-everyday-\d{8}-v\d+/);
  assert.match(sw, /\.\/assets\/css\/premium-priority3\.css/);
  assert.match(sw, /\.\/assets\/js\/premium-priority3\.js/);
});
