import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('index.html');
const css = read('assets/css/signature2.css');
const js = read('assets/js/signature2.js');
const dashboard = read('assets/js/dashboard.js');
const chartMotion = read('assets/js/chart-motion.js');
const core = read('assets/js/core.js');
const sw = read('sw.js');
const load = (dark = false, tokens = {}) => {
  const body = { classList: { contains: name => name === 'dark-mode' && dark } };
  const window = { matchMedia: () => ({ matches: false }) };
  const context = { window, document: { body }, getComputedStyle: () => ({ getPropertyValue: name => tokens[name] || '' }), WeakMap, Object };
  vm.runInNewContext(js, context);
  return window.FreevSignature2;
};

test('Signature 2.0 se charge après le thème Signature sans bloquer les scripts existants', () => {
  assert.ok(html.indexOf('apple-premium.css') < html.indexOf('signature2.css'));
  assert.ok(html.indexOf('premium-v4.js') < html.indexOf('signature2.js'));
  assert.match(html, /class="freev-premium-v3 freev-premium-v4 freev-apple"/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com/);
});
test('animation visuelle sans mutation des finances, avec prise en charge du mouvement réduit', () => {
  const ui = load();
  let calls = 0;
  const target = { animate: (frames, options) => {
    calls++;
    assert.equal(frames[0].opacity, .65);
    assert.equal(options.duration, 240);
    return { addEventListener() {}, cancel() {} };
  } };
  assert.equal(ui.revealView(target), true);
  assert.equal(calls, 1);
  assert.equal(ui.revealView(target, () => ({ matches: true })), true);
  assert.equal(calls, 1);
  assert.equal(ui.shouldReduceMotion(() => ({ matches: true })), true);
  assert.equal(ui.revealView(null), false);
});
test('une animation précédente est annulée lors de changements rapides de page', () => {
  const ui = load();
  let cancelled = 0;
  const target = { animate: () => ({ cancel: () => cancelled++, addEventListener() {} }) };
  ui.revealView(target);
  ui.revealView(target);
  assert.equal(cancelled, 1);
});
test('repli CSS prévu pour les navigateurs sans Web Animations API', () => {
  assert.equal(load().revealView({}), false);
  assert.match(core, /FreevSignature2\?\.revealView/);
  assert.match(core, /repli pour les navigateurs sans Web Animations API/);
});
test('palette adaptative, y compris les contrastes du mode sombre', () => {
  const light = load(false).chartPalette();
  const dark = load(true).chartPalette();
  assert.equal(light.accent, '#1f61db');
  assert.equal(dark.accent, '#83b5ff');
  const custom = load(false, { '--signature-blue': '#113355', '--signature-green':'#008844' }).chartPalette();
  assert.equal(custom.accent, '#113355');
  assert.equal(custom.income, '#008844');
});
test('dégradé financier mis en cache et renouvelé si taille ou thème change', () => {
  const ui = load();
  let created = 0;
  const chart = {
    chartArea: { top: 10, bottom: 170 },
    ctx: { createLinearGradient: () => {
      created++;
      return { addColorStop() {} };
    } }
  };
  const a = ui.areaFill({ chart });
  assert.equal(ui.areaFill({ chart }), a);
  assert.equal(created, 1);
  chart.chartArea.bottom = 240;
  assert.notEqual(ui.areaFill({ chart }), a);
  assert.equal(created, 2);
  assert.equal(ui.areaFill({ chart: {} }), 'rgba(31,97,219,.10)');
});
test('graphiques respectent la préférence de mouvement réduit et restent lisibles', () => {
  assert.match(dashboard, /FreevSignature2\?\.chartPalette/);
  assert.match(dashboard, /FreevSignature2\?\.areaFill/);
  assert.match(chartMotion, /prefers-reduced-motion: reduce/);
  assert.match(chartMotion, /if \(isReduced\(\)\) return false/);
  assert.match(dashboard, /FreevChartMotion\?\.entry/);
  for (const id of ['trendChartSummary', 'categoryChartSummary']) assert.match(html, new RegExp(`id="${id}"`));
});
test('styles mobiles, transparence réduite, contraste fort et geste tactile protégés', () => {
  for(const fragment of ['@media (max-width:768px)','@media (max-width:390px)','prefers-reduced-motion:reduce', 'prefers-reduced-transparency:reduce','prefers-contrast:more','env(safe-area-inset-bottom)', 'overscroll-behavior-x:contain', ':focus-visible']) {
    assert.ok(css.includes(fragment), fragment);
  }
  assert.match(css, /bottom-nav-item\[aria-current="page"\]/);
  assert.match(css, /dashboard-chart-card/);
  assert.match(css, /modal-content/);
});
test('cache de la PWA est renouvelé et comprend les deux nouveaux fichiers statiques', () => {
  assert.match(sw, /freev-v5\.2\.0-everyday-\d{8}-v\d+/);
  assert.match(sw, /\.\/assets\/css\/signature2\.css/);
  assert.match(sw, /\.\/assets\/js\/signature2\.js/);
});
test('Signature 2 ne modifie ni base, ni comptes, ni transactions', () => {
  assert.doesNotMatch(js, /saveData|transactions\.|recurringTransactions|firebase|localStorage|accounts\./);
  assert.doesNotMatch(css, /(?:localStorage|saveData|firebase|account\.transactions)/);
});

test('navigation mobile : Réglages reste actif dans sa page', () => {
  const ui = read('assets/js/ui.js');
  const definition = ui.match(/function setBottomNav\(view\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(definition, 'setBottomNav doit exister');
  const states = new Map(['dashboard','transactions','scan','settings'].map(name => {
    let active=false;
    return [name, { classList: { add: c => { if(c==='active') active=true; }, remove:c => { if(c==='active') active=false; }, contains:c=> c==='active'&&active } }];
  }));
  const context={document:{
    querySelectorAll: selector => selector==='.bottom-nav-item' ? [...states.values()] : [],
    getElementById: id => states.get(id.replace('bnav-','')) || null
  },closeSidebarMobile:()=>{}};
  vm.runInNewContext(`${definition}\nsetBottomNav('settings')`, context);
  assert.equal(states.get('settings').classList.contains('active'),true);
  vm.runInNewContext(`${definition}\nsetBottomNav('dashboard')`, context);
  assert.equal(states.get('dashboard').classList.contains('active'),true);
  assert.equal(states.get('settings').classList.contains('active'),false);
});

test('navigation mobile : blocage du défilement et fermeture propre du menu', () => {
  const ui=read('assets/js/ui.js');
  assert.match(ui, /classList\?\.add\('freev-mobile-nav-open'\)/);
  assert.match(ui, /classList\?\.remove\('freev-mobile-nav-open'\)/);
  assert.match(css, /body\.freev-apple\.freev-mobile-nav-open \{overflow:hidden;touch-action:none\}/);
});
