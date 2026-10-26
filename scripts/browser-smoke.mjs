import assert from 'node:assert/strict';
import axe from 'axe-core';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playwrightModule = process.env.PLAYWRIGHT_MODULE || 'playwright';
const playwrightImport = await import(playwrightModule.startsWith('.') || path.isAbsolute(playwrightModule)
  ? pathToFileURL(path.resolve(playwrightModule)).href
  : playwrightModule);
const { chromium } = playwrightImport.chromium ? playwrightImport : playwrightImport.default;

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((request, response) => {
  const requestPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const target = path.resolve(root, relative);
  if (!target.startsWith(root) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(target).pipe(response);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });

async function prepare(page) {
  await page.goto(`http://127.0.0.1:${port}/index.html?plannerPreview=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.FreevV4 && window.FreevV5 && window._applyCloudData), null, { timeout: 15_000 });
  await page.addStyleTag({ content: '#authOverlay, #authLoadingScreen { display: none !important; pointer-events: none !important; }' });
  await page.evaluate(() => {
    localStorage.removeItem('freevHelpProgress_v2');
    const month = new Date().toISOString().slice(0, 7);
    const day = `${month}-02`;
    window._applyCloudData({
      currentAccountId: 'test-account',
      accounts: [{
        id: 'test-account', name: 'Compte test', initialCapital: 1500,
        transactions: [
          { id: 'income', type: 'income', amount: 2100, amountBase: 2100, date: day, desc: 'Salaire', category: 'Revenus' },
          { id: 'food', type: 'expense', amount: 185, amountBase: 185, date: day, desc: 'Courses du mois', category: 'Alimentation', tags: ['famille'] },
          { id: 'market-1', type: 'expense', amount: 52, amountBase: 52, date: '2026-06-03', desc: 'CB Carrefour', category: 'Alimentation' },
          { id: 'market-2', type: 'expense', amount: 48, amountBase: 48, date: '2026-07-03', desc: 'Carrefour Market', category: 'Alimentation' },
          { id: 'netflix-1', type: 'expense', amount: 15, amountBase: 15, date: '2026-05-05', desc: 'Netflix', category: 'Abonnements' },
          { id: 'netflix-2', type: 'expense', amount: 15, amountBase: 15, date: '2026-06-05', desc: 'Netflix', category: 'Abonnements' },
          { id: 'netflix-3', type: 'expense', amount: 18, amountBase: 18, date: '2026-07-05', desc: 'Netflix', category: 'Abonnements' },
          { id: 'spotify', type: 'expense', amount: 11, amountBase: 11, date: '2026-07-08', desc: 'Spotify', category: 'À classer' }
        ],
        recurringTransactions: [{ id: 'internet', type: 'expense', amount: 35, frequency: 'monthly', startDate: '2026-01-05', dayOfMonth: 5, desc: 'Internet', category: 'Abonnements' }],
        monthlyBudget: 1200, budgetsByCategory: {}, savingsAccounts: {}, debts: [], historyLog: [],
        goals: [{ id: 'goal-1', name: 'Fonds d’urgence', target: 3000, current: 600, deadline: '2027-01-01' }],
        envelopes: { Alimentation: 150 }, plannerSettings: { forecastMonths: 6, monthlyAdjustment: 50, incomeAdjustment: 0, expenseAdjustment: 0, oneTimeExpense: 0, oneTimeMonth: 1 },
        automationRules: [], plannerScenarios: [], wealthAssets: [], ignoredSubscriptionKeys: [], documentIndex: [],
        settings: { baseCurrency: 'EUR', defaultMode: 'personal' }
      }]
    });
    document.getElementById('authOverlay')?.style.setProperty('display', 'none');
    document.getElementById('authLoadingScreen')?.style.setProperty('display', 'none');
    window.switchView('planner');
    window.FreevV4.render();
  });
  await page.waitForSelector('#planner-view:not(.hidden)');
}

try {
  const publicPlanner = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  await publicPlanner.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await publicPlanner.waitForFunction(() => Boolean(window.FreevV4 && window.switchView), null, { timeout: 15_000 });
  await publicPlanner.addStyleTag({ content: '#authOverlay, #authLoadingScreen { display: none !important; pointer-events: none !important; }' });
  await publicPlanner.evaluate(() => window.switchView('planner'));
  await publicPlanner.waitForSelector('#planner-view:not(.hidden)');
  assert.equal(await publicPlanner.locator('#v4PlannerMaintenance:visible').count(), 0, 'La maintenance ne doit pas masquer le planificateur public');
  assert.equal(await publicPlanner.locator('[data-v4-months="24"]:visible').count(), 1, 'L’horizon 24 mois doit être disponible publiquement');
  await publicPlanner.close();

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  desktop.on('pageerror', error => pageErrors.push(`ordinateur: ${error.message}`));
  const chartRequests = [];
  desktop.on('request', request => { if (request.url().includes('chart.js')) chartRequests.push(request.url()); });
  await prepare(desktop);
  const themeToggle = desktop.locator('#darkModeToggle');
  assert.equal(await themeToggle.getAttribute('aria-pressed'), 'false');
  assert.equal(await desktop.locator('#darkModeState').textContent(), 'Clair');
  await themeToggle.press('Enter');
  await desktop.waitForFunction(() => document.body.classList.contains('dark-mode'));
  assert.equal(await themeToggle.getAttribute('aria-pressed'), 'true');
  assert.equal(await desktop.locator('#darkModeState').textContent(), 'Sombre');
  assert.ok(await themeToggle.locator('[data-theme-knob]').count(), 'Le thème doit avoir un curseur visuel dédié');
  await themeToggle.press('Enter');
  await desktop.waitForFunction(() => !document.body.classList.contains('dark-mode'));
  const plannerHorizonButton = desktop.locator('#planner-view [data-v4-months="6"]');
  await plannerHorizonButton.hover();
  assert.ok((await plannerHorizonButton.evaluate(button => getComputedStyle(button).transitionDuration)) !== '0s', 'Les boutons d’action doivent avoir une transition visible');
  await plannerHorizonButton.click();
  await desktop.waitForTimeout(30);
  assert.equal(await plannerHorizonButton.locator('.freev-button-ripple').count(), 1, 'Un clic doit produire un retour visuel local');
  assert.equal(chartRequests.length, 0, 'Chart.js ne doit pas être téléchargé avant une vue qui utilise des graphiques');
  assert.equal(await desktop.locator('#v4Summary .v4-summary-card').count(), 4);
  assert.equal(await desktop.locator('#v4Forecast .v4-forecast-row').count(), 6);
  await desktop.locator('[data-v4-months="24"]').click();
  await desktop.waitForFunction(() => window._getAppState().accounts[0].plannerSettings.forecastMonths === 24);
  assert.equal(await desktop.locator('#v4Forecast .v4-forecast-row').count(), 24, 'L’horizon long doit afficher les 24 mois complets');
  assert.equal(await desktop.locator('#v42OneTimeMonth option').count(), 24, 'Un imprévu doit pouvoir être positionné sur chaque mois affiché');
  assert.ok((await desktop.locator('#v4CalendarDescription').textContent()).includes('24 prochains mois'));
  assert.equal(await desktop.locator('#v4Calendar .v4-calendar-item').count(), 15, 'Le calendrier doit rester lisible au premier affichage');
  await desktop.locator('[data-v4-calendar-more]').click();
  assert.ok(await desktop.locator('#v4Calendar .v4-calendar-item').count() > 15, 'Le calendrier doit pouvoir afficher les échéances lointaines suivantes');
  await desktop.locator('[data-v4-months="6"]').click();
  const forecastBreakdown = desktop.locator('#v43ForecastBreakdown');
  await forecastBreakdown.waitFor({ state: 'visible' });
  for (const label of ['Habitudes récentes', 'Récurrences', 'Opérations planifiées', 'Simulation', 'Total mensuel']) {
    assert.ok((await forecastBreakdown.textContent()).includes(label), `La décomposition doit afficher « ${label} »`);
  }
  assert.equal(await forecastBreakdown.locator('[data-v43-breakdown-row]').count(), 5);
  const visibleBreakdown = await forecastBreakdown.locator('[data-v43-breakdown-row]').evaluateAll(rows => rows.map(row => ({
    label: row.querySelector('dt strong')?.textContent?.trim(),
    amount: row.querySelector('dd')?.textContent?.trim()
  })));
  const parseDisplayedMoney = value => Number(String(value || '').replace(/[^\d,.-]/g, '').replace(',', '.'));
  const componentTotal = visibleBreakdown.slice(0, -1).reduce((sum, row) => sum + parseDisplayedMoney(row.amount), 0);
  assert.equal(Number(componentTotal.toFixed(2)), parseDisplayedMoney(visibleBreakdown.at(-1).amount), 'Le total mensuel affiché doit égaler la somme des composantes visibles');
  assert.ok(visibleBreakdown.every(row => row.label && Number.isFinite(parseDisplayedMoney(row.amount))), 'Chaque composante doit afficher un montant signé lisible');
  const projectionScope = desktop.locator('#v43ProjectionScope');
  assert.equal(await projectionScope.inputValue(), 'complete');
  const projectionMenu = desktop.locator('[data-freev-select-for="v43ProjectionScope"]');
  assert.equal(await projectionMenu.count(), 1, 'Chaque menu déroulant doit recevoir le composant Freev accessible');
  await projectionMenu.locator('[data-freev-select-trigger]').click();
  assert.equal(await projectionMenu.locator('[data-freev-select-list]').getAttribute('aria-hidden'), 'false');
  await projectionMenu.locator('[data-freev-select-option="recurring"]').click();
  await desktop.waitForFunction(() => window._getAppState().accounts[0].plannerSettings.projectionScope === 'recurring');
  assert.ok((await desktop.locator('#v43ProjectionDescription').textContent()).includes('limitée aux revenus et dépenses récurrents'));
  assert.equal(await forecastBreakdown.locator('.v43-breakdown-row.excluded').count(), 2);
  const excludedAmounts = await forecastBreakdown.locator('.v43-breakdown-row.excluded dd').allTextContents();
  assert.ok(excludedAmounts.every(value => parseDisplayedMoney(value) === 0), 'Les habitudes et opérations planifiées doivent être neutralisées en mode récurrent');
  await projectionMenu.locator('[data-freev-select-trigger]').focus();
  await projectionMenu.locator('[data-freev-select-trigger]').press('ArrowDown');
  await projectionMenu.locator('[data-freev-select-option="recurring-scheduled"]').press('Enter');
  await desktop.waitForFunction(() => window._getAppState().accounts[0].plannerSettings.projectionScope === 'recurring-scheduled');
  assert.equal(await forecastBreakdown.locator('.v43-breakdown-row.excluded').count(), 1);
  assert.ok((await desktop.locator('#v43ProjectionDescription').textContent()).includes('opérations futures déjà planifiées'));
  await projectionMenu.locator('[data-freev-select-trigger]').click();
  await projectionMenu.locator('[data-freev-select-option="complete"]').click();
  await desktop.waitForFunction(() => window._getAppState().accounts[0].plannerSettings.projectionScope === 'complete');
  assert.equal(await desktop.locator('#v42ForecastInsights article').count(), 3);
  assert.equal(await desktop.locator('#v42ForecastChart svg').count(), 1);
  assert.equal(await desktop.locator('#v43PlannerIntelligence article').count(), 4);
  assert.equal(await desktop.locator('#v42ForecastChart .v43-risk-band').count(), 1);
  assert.equal(await desktop.locator('#v4Goals .v4-goal').count(), 1);
  await desktop.locator('#v4HelpButton').click();
  await desktop.waitForSelector('#freevHelpOverlay:not([hidden])');
  assert.equal(await desktop.locator('#freevHelpTabPlanner').getAttribute('aria-selected'), 'true');
  assert.equal(await desktop.evaluate(() => document.activeElement?.id), 'freevHelpSearch');
  assert.equal(await desktop.locator('#freevHelpPanelPlanner [data-freev-help-step]').count(), 4);
  await desktop.fill('#freevHelpSearch', 'imprévu');
  assert.ok(await desktop.locator('#freevHelpPanelPlanner [data-freev-help-search]:not([hidden])').count() >= 2);
  assert.equal(await desktop.locator('#freevHelpNoResults:not([hidden])').count(), 0);
  await desktop.fill('#freevHelpSearch', 'sujet introuvable xyz');
  assert.equal(await desktop.locator('#freevHelpNoResults:not([hidden])').count(), 1);
  await desktop.locator('#freevHelpSearchClear').click();
  await desktop.locator('[data-freev-help-step="planner-data"]').check();
  assert.equal(await desktop.locator('[data-freev-help-progress="planner"]').getAttribute('aria-valuenow'), '25');
  assert.equal(await desktop.evaluate(() => JSON.parse(localStorage.getItem('freevHelpProgress_v2'))['planner-data']), true);
  await desktop.waitForTimeout(400);
  await desktop.locator('[data-freev-help-dialog]').screenshot({ path: path.join(os.tmpdir(), 'freev-help-planner-desktop.png') });
  await desktop.addScriptTag({ content: axe.source });
  const breakdownA11y = await desktop.evaluate(async () => {
    const result = await window.axe.run('#v43ForecastBreakdown', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } });
    return result.violations.filter(item => ['serious', 'critical'].includes(item.impact)).map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.map(node => node.target) }));
  });
  assert.deepEqual(breakdownA11y, [], `Violations d’accessibilité graves dans la décomposition : ${JSON.stringify(breakdownA11y)}`);
  const helpA11y = await desktop.evaluate(async () => {
    const result = await window.axe.run('#freevHelpOverlay', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } });
    return result.violations.filter(item => ['serious', 'critical'].includes(item.impact)).map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.length }));
  });
  assert.deepEqual(helpA11y, [], `Violations d’accessibilité graves dans l’aide : ${JSON.stringify(helpA11y)}`);
  await desktop.locator('#freevHelpTabPlanner').focus();
  await desktop.locator('#freevHelpTabPlanner').press('ArrowRight');
  assert.equal(await desktop.locator('#freevHelpTabSmart').getAttribute('aria-selected'), 'true');
  assert.ok((await desktop.textContent('#freevHelpPanelSmart')).includes('Classer Netflix dans Abonnements'));
  const smartHelpPosition = await desktop.evaluate(() => ({
    scrollY: window.scrollY,
    dialogTop: document.querySelector('[data-freev-help-dialog]').getBoundingClientRect().top,
    headerTop: document.querySelector('.freev-help-header').getBoundingClientRect().top,
    contentScroll: document.querySelector('.freev-help-content').scrollTop
  }));
  assert.ok(smartHelpPosition.dialogTop >= 0 && smartHelpPosition.headerTop >= 0 && smartHelpPosition.contentScroll === 0, `Position inattendue de l’aide après changement d’onglet : ${JSON.stringify(smartHelpPosition)}`);
  await desktop.locator('[data-freev-help-dialog]').screenshot({ path: path.join(os.tmpdir(), 'freev-help-smart-desktop.png') });
  await desktop.fill('#freevHelpSearch', 'Netflix');
  assert.ok(await desktop.locator('#freevHelpPanelSmart [data-freev-help-search]:not([hidden])').count() >= 1);
  assert.equal(await desktop.locator('#freevHelpNoResults:not([hidden])').count(), 0);
  await desktop.locator('#freevHelpSearchClear').click();
  const smartHelpA11y = await desktop.evaluate(async () => {
    const result = await window.axe.run('#freevHelpOverlay', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } });
    return result.violations.filter(item => ['serious', 'critical'].includes(item.impact)).map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.map(node => node.target) }));
  });
  assert.deepEqual(smartHelpA11y, [], `Violations d’accessibilité graves dans l’aide 5.1 : ${JSON.stringify(smartHelpA11y)}`);
  await desktop.keyboard.press('Escape');
  assert.equal(await desktop.locator('#freevHelpOverlay').getAttribute('hidden'), '');
  assert.equal(await desktop.evaluate(() => document.activeElement?.id), 'v4HelpButton');
  assert.equal(await desktop.locator('#v41Health .v41-breakdown article').count(), 5);
  assert.equal(await desktop.locator('#v41Scenarios .v41-scenario').count(), 3);
  assert.ok(await desktop.locator('#v41Actions .v41-action').count() >= 1);
  await desktop.locator('[data-v41-scenario]').first().click();
  assert.ok(Number(await desktop.inputValue('#v4Adjustment')) > 0);
  await desktop.locator('[data-v42-preset="unexpected"]').click();
  assert.equal(Number(await desktop.inputValue('#v42OneTimeExpense')), 500);
  assert.ok((await forecastBreakdown.textContent()).includes('Imprévu'), 'La décomposition doit afficher un imprévu non nul');
  const downloadPromise = desktop.waitForEvent('download');
  await desktop.locator('.v42-chart-head button').click();
  const forecastDownload = await downloadPromise;
  assert.ok(forecastDownload.suggestedFilename().endsWith('.csv'));
  const visibleDonutLabels = await desktop.evaluate(() => {
    const drawn = [];
    const chart = {
      ctx: { save() {}, restore() {}, fillText(value) { drawn.push(String(value)); } },
      data: { datasets: [{ data: [100, 50] }] },
      getDatasetMeta: () => ({ data: [{ x: 100, y: 100 }, { x: 100, y: 100 }] }),
      getDataVisibility: index => index !== 1
    };
    donutCenterTextPlugin.afterDraw(chart, {}, { lines: ['Total', '150'], formatter: value => String(value) });
    return drawn;
  });
  assert.deepEqual(visibleDonutLabels, ['Total', '100'], 'Le montant central doit ignorer une catégorie masquée');
  const lazyChartRequest = desktop.waitForRequest(request => request.url().includes('chart.min.js'));
  await desktop.evaluate(() => {
    window.__freevCloudState = 'synced';
    window.switchView('dashboard');
  });
  await lazyChartRequest;
  await desktop.waitForFunction(() => Boolean(window.Chart) || document.getElementById('trendChartSummary')?.textContent.includes('Graphiques indisponibles'), null, { timeout: 10_000 });
  assert.equal(chartRequests.length, 1, 'Chart.js doit être chargé une seule fois à l’ouverture du tableau de bord');
  const chartsReady = await desktop.evaluate(() => Boolean(window.Chart));
  if (chartsReady) {
    await desktop.waitForFunction(() => Boolean(window.Chart.getChart(document.getElementById('trendChart'))));
    await desktop.waitForFunction(() => Boolean(window.Chart.getChart(document.getElementById('categoryChart'))));
    const legendTarget = await desktop.evaluate(() => {
      const chart = window.Chart.getChart(document.getElementById('categoryChart'));
      const index = chart.data.labels.indexOf('Alimentation');
      if (index < 0) return null;
      const box = chart.legend.legendHitBoxes[index];
      const visibleTotal = chart.data.datasets[0].data.reduce((sum, amount, item) =>
        sum + (item === index ? 0 : Number(amount) || 0), 0);
      const fullTotal = chart.data.datasets[0].data.reduce((sum, amount) => sum + (Number(amount) || 0), 0);
      return { index, x: box.left + box.width / 2, y: box.top + box.height / 2,
        expected: formatCurrency(roundMoney(visibleTotal)), full: formatCurrency(roundMoney(fullTotal)) };
    });
    assert.ok(legendTarget, 'La catégorie Alimentation doit être présente dans la légende du test');
    await desktop.locator('#categoryChart').click({ position: { x: legendTarget.x, y: legendTarget.y } });
    await desktop.waitForFunction(index => !window.Chart.getChart(document.getElementById('categoryChart')).getDataVisibility(index), legendTarget.index);
    assert.ok((await desktop.locator('#categoryChartSummary').textContent()).includes(legendTarget.expected), 'Le résumé doit afficher le total des seules catégories visibles');
    assert.ok((await desktop.locator('#categoryChart').getAttribute('aria-label')).includes(legendTarget.expected), 'Le montant accessible doit suivre la légende');
    const renderedText = await desktop.evaluate(() => {
      const chart = window.Chart.getChart(document.getElementById('categoryChart'));
      const original = chart.ctx.fillText;
      const values = [];
      chart.ctx.fillText = function (value, ...args) {
        values.push(String(value));
        return original.call(this, value, ...args);
      };
      try { chart.draw(); } finally { chart.ctx.fillText = original; }
      return values;
    });
    assert.ok(renderedText.includes(legendTarget.expected), 'Le montant dessiné au centre doit suivre la légende');
    const tooltipLabel = await desktop.evaluate(() => {
      const chart = window.Chart.getChart(document.getElementById('categoryChart'));
      const index = chart.data.labels.indexOf('Abonnements');
      return chart.options.plugins.tooltip.callbacks.label({ chart, label: chart.data.labels[index], raw: chart.data.datasets[0].data[index] });
    });
    assert.ok(tooltipLabel.includes('100 %'), 'Le pourcentage au survol doit utiliser uniquement les catégories visibles');
    await desktop.waitForTimeout(1000);
    await desktop.locator('#categoryChart').screenshot({ path: path.join(os.tmpdir(), 'freev-category-filtered-desktop.png') });
    await desktop.locator('#categoryChart').click({ position: { x: legendTarget.x, y: legendTarget.y } });
    await desktop.waitForFunction(index => window.Chart.getChart(document.getElementById('categoryChart')).getDataVisibility(index), legendTarget.index);
    assert.ok((await desktop.locator('#categoryChartSummary').textContent()).includes(legendTarget.full), 'Réafficher la catégorie doit rétablir le total complet');
    const cashflowTypes = await desktop.evaluate(() => window.Chart.getChart(document.getElementById('trendChart')).data.datasets.map(dataset => dataset.type));
    assert.ok(cashflowTypes.includes('bar'), 'La vue Flux doit utiliser des barres lisibles');
    await desktop.locator('[data-dashboard-mode="balance"]').click();
    const balanceGraph = await desktop.evaluate(() => {
      const dataset = window.Chart.getChart(document.getElementById('trendChart')).data.datasets[0];
      return { label: dataset.label, data: dataset.data };
    });
    assert.ok(balanceGraph.label.includes('Solde'));
    assert.ok(balanceGraph.data.some(value => value === null), 'Les mois sans historique doivent rester vides');
    assert.ok(balanceGraph.data.some(value => Number.isFinite(value)), 'Les mois qui possèdent un historique doivent être dessinés');
  } else {
    assert.ok((await desktop.textContent('#trendChartSummary')).includes('Graphiques indisponibles'), 'Le tableau de bord doit expliquer clairement l’absence de graphiques');
  }
  assert.ok(!(await desktop.textContent('#dashboardAlerts')).includes('Synchronisation suspendue'));
  assert.equal(await desktop.locator('#categoryChartEmpty:not(.hidden)').count(), 0);
  await desktop.waitForTimeout(300);
  await desktop.screenshot({ path: path.join(os.tmpdir(), 'freev-v42-dashboard-desktop.png'), fullPage: true });
  await desktop.evaluate(() => window.switchView('planner'));
  await desktop.waitForTimeout(300);
  await desktop.screenshot({ path: path.join(os.tmpdir(), 'freev-v4-planner-desktop.png'), fullPage: true });

  await desktop.evaluate(() => {
    window.switchView('smart');
    window.FreevV5.render();
  });
  await desktop.waitForSelector('#smart-view:not(.hidden)');
  assert.equal(await desktop.locator('#v5Summary article').count(), 4);
  assert.equal(await desktop.locator('[data-v5-tab]').count(), 7);
  assert.equal(await desktop.locator('#v51IntelligenceBrief .v51-score').count(), 1);
  assert.equal(await desktop.locator('#v51ChangeGrid article').count(), 4);
  assert.ok(await desktop.locator('#v5Overview article').count() >= 1);
  await desktop.locator('#v5HelpButton').click();
  await desktop.waitForSelector('#freevHelpOverlay:not([hidden])');
  assert.equal(await desktop.locator('#freevHelpTabSmart').getAttribute('aria-selected'), 'true');
  await desktop.locator('[data-freev-help-view="smart"][data-freev-help-smart-tab="rules"]').first().click();
  assert.equal(await desktop.locator('#freevHelpOverlay').getAttribute('hidden'), '');
  assert.equal(await desktop.locator('#smart-view:not(.hidden)').count(), 1);
  assert.equal(await desktop.locator('[data-v5-tab="rules"]').getAttribute('aria-selected'), 'true');
  await desktop.waitForTimeout(120);
  assert.equal(await desktop.evaluate(() => document.activeElement?.id), 'v5RuleForm');
  await desktop.waitForTimeout(650);
  await desktop.evaluate(() => window.FreevV5.closeWhatsNew(false));
  const visibleOverlays = await desktop.locator('.v4-overlay').evaluateAll(overlays => overlays
    .filter(overlay => getComputedStyle(overlay).display !== 'none')
    .map(overlay => ({ id: overlay.id, hidden: overlay.hidden, display: getComputedStyle(overlay).display })));
  assert.deepEqual(visibleOverlays, [], `Une fenêtre reste visuellement ouverte : ${JSON.stringify(visibleOverlays)}`);
  await desktop.screenshot({ path: path.join(os.tmpdir(), 'freev-v51-overview-desktop.png'), fullPage: true });

  await desktop.locator('[data-v5-tab="overview"]').focus();
  await desktop.keyboard.press('ArrowRight');
  assert.equal(await desktop.locator('[data-v5-tab="rules"]').getAttribute('aria-selected'), 'true');
  assert.ok(await desktop.locator('#v5RuleSuggestions article').count() >= 1);
  await desktop.fill('#v5RuleContains', 'Spotify');
  await desktop.fill('#v5RuleCategory', 'Abonnements');
  await desktop.locator('#v5RuleForm button[type="submit"]').click();
  assert.equal(await desktop.locator('#v5RulesList .v5-rule').count(), 1);
  await desktop.fill('#v5RuleContains', 'spotify');
  await desktop.fill('#v5RuleCategory', 'Abonnements');
  await desktop.locator('#v5RuleForm button[type="submit"]').click();
  assert.equal(await desktop.locator('#v5RulesList .v5-rule').count(), 1, 'Une règle identique ne doit pas être dupliquée');
  const classifiedCategory = await desktop.evaluate(() => window._getAppState().accounts[0].transactions.find(item => item.id === 'spotify').category);
  assert.equal(classifiedCategory, 'Abonnements');

  await desktop.locator('[data-v5-tab="subscriptions"]').click();
  assert.ok(await desktop.locator('#v5Subscriptions .v5-subscription').count() >= 2);
  assert.ok((await desktop.textContent('#v5SubscriptionTotal')).includes('€'));

  await desktop.locator('[data-v5-tab="scenarios"]').click();
  await desktop.fill('#v5ScenarioName', 'Projet test');
  await desktop.locator('#v5ScenarioForm button[type="submit"]').click();
  assert.equal(await desktop.locator('#v5Scenarios .v5-scenario').count(), 1);

  await desktop.locator('[data-v5-tab="wealth"]').click();
  await desktop.fill('#v5AssetName', 'Appartement test');
  await desktop.fill('#v5AssetValue', '120000');
  await desktop.locator('#v5AssetForm button[type="submit"]').click();
  assert.equal(await desktop.locator('#v5WealthAssets article').count(), 1);
  assert.ok((await desktop.textContent('#v5WealthSummary')).includes('120'));

  await desktop.locator('[data-v5-tab="imports"]').click();
  assert.equal(await desktop.locator('#bankSyncStatus').count(), 0);
  assert.equal(await desktop.evaluate(() => typeof window.FreevBankSync), 'undefined');
  assert.equal(await desktop.locator('#v5StatementFile').count(), 1);
  await desktop.locator('#v5StatementFile').setInputFiles({
    name: 'releve-test.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`Date;Description;Montant;Catégorie\n${new Date().toISOString().slice(0, 7)}-02;Courses du mois;-185;Alimentation\n2026-07-20;Cinéma;-14,50;Loisirs`)
  });
  await desktop.waitForSelector('#v5ConfirmImport');
  assert.ok((await desktop.textContent('#v5ImportPreview')).includes('1 doublons évités'));
  await desktop.locator('#v5ConfirmImport').click();
  const cinemaImported = await desktop.evaluate(() => window._getAppState().accounts[0].transactions.some(item => item.desc === 'Cinéma'));
  assert.equal(cinemaImported, true);

  await desktop.locator('[data-v5-tab="security"]').click();
  assert.equal(await desktop.locator('#v5TrustedDevice').count(), 1);
  assert.equal(await desktop.locator('[data-v5-network]').count(), 2);
  await desktop.screenshot({ path: path.join(os.tmpdir(), 'freev-v5-smart-desktop.png'), fullPage: true });
  await desktop.evaluate(() => window.FreevV5.showWhatsNew(true));
  await desktop.waitForSelector('#v5WhatsNew:not([hidden])');
  assert.equal(await desktop.locator('#v5WhatsNew .v4-feature-grid article').count(), 6);
  await desktop.evaluate(() => window.FreevV5.closeWhatsNew(false));

  // Régressions : une exception mensuelle ne modifie pas la série et un transfert édité reste unique.
  const transactionRegression = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  transactionRegression.on('pageerror', error => pageErrors.push(`transactions: ${error.message}`));
  await prepare(transactionRegression);
  const regression = await transactionRegression.evaluate(() => {
    let account = window._getAppState().accounts[0];
    const rule = account.recurringTransactions.find(item => item.id === 'internet');
    const next = new Date();
    next.setMonth(next.getMonth() + 1, 5);
    const date = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-05`;
    const occurrence = buildRecurringOccurrence(rule, date, { id: 'test-projected-occurrence', projected: true });
    openRecurringRuleModal(rule, occurrence);
    document.getElementById('recurDateScopeSingle').checked = true;
    document.getElementById('transAmount').value = '42';
    document.getElementById('transDesc').value = 'Internet exceptionnel';
    saveTransaction({ preventDefault() {} });
    const edited = account.transactions.find(item => item.parentId === rule.id && item.periodKey === date.slice(0, 7));
    openModalById(edited.id);
    const defaultsToSingle = document.getElementById('recurDateScopeSingle').checked;
    document.getElementById('transAmount').value = '43';
    saveTransaction({ preventDefault() {} });
    const editedAgain = account.transactions.filter(item => item.parentId === rule.id && item.periodKey === date.slice(0, 7));
    const following = new Date(next);
    following.setMonth(following.getMonth() + 1, 5);
    const followingMonth = `${following.getFullYear()}-${String(following.getMonth() + 1).padStart(2, '0')}`;
    const future = getProjectedRecurringTransactions(followingMonth).find(item => item.parentId === rule.id);
    const snapshot = JSON.parse(JSON.stringify({ ...window._getAppState(), selectedGroupIds: [] }));
    window._applyCloudData(snapshot);
    generateRecurringOccurrences();
    account = window._getAppState().accounts[0];
    const restored = account.transactions.find(item => item.parentId === rule.id && item.periodKey === date.slice(0, 7));
    const futureAfterReload = getProjectedRecurringTransactions(followingMonth).find(item => item.parentId === rule.id);
    const ruleAmountBefore = account.recurringTransactions.find(item => item.id === 'internet')?.amount;
    openModalById(restored.id);
    document.getElementById('transDate').value = `${followingMonth}-05`;
    saveTransaction({ preventDefault() {} });
    const rejectedOutsidePeriod = !document.getElementById('transactionModal').classList.contains('hidden') &&
      account.transactions.find(item => item.id === restored.id)?.date === date;
    closeModal();
    openModalById(restored.id);
    document.getElementById('recurDateScopeAll').checked = true;
    document.getElementById('transAmount').value = '50';
    saveTransaction({ preventDefault() {} });
    const allScopeRule = account.recurringTransactions.find(item => item.id === 'internet')?.amount;
    const allScopeException = account.transactions.find(item => item.id === restored.id)?.amount;
    const allScopeFuture = getProjectedRecurringTransactions(followingMonth).find(item => item.parentId === rule.id)?.amount;
    const recurring = { defaultsToSingle, ruleAmount: ruleAmountBefore, editedAmount: editedAgain[0]?.amount, editedDesc: editedAgain[0]?.desc, occurrenceCount: editedAgain.length, futureAmount: future?.amount, restoredAmount: restored?.amount, futureAfterReloadAmount: futureAfterReload?.amount, rejectedOutsidePeriod, allScopeRule, allScopeException, allScopeFuture };

    account.savingsAccounts['Livret A'] = 0;
    openModal();
    document.getElementById('transType').value = 'transfer';
    document.getElementById('transCategory').value = 'Épargne';
    document.getElementById('transAmount').value = '200';
    document.getElementById('transDate').value = isoDate(getToday());
    document.getElementById('transferSavingsTarget').value = 'Livret A';
    saveTransaction({ preventDefault() {} });
    const transfer = account.transactions.find(item => item.type === 'transfer' && item.amount === 200);
    const afterCreate = account.savingsAccounts['Livret A'];
    openModalById(transfer.id);
    document.getElementById('transDesc').value = 'Transfert corrigé';
    saveTransaction({ preventDefault() {} });
    const afterEdit = account.savingsAccounts['Livret A'];
    openModalById(transfer.id);
    document.getElementById('transAmount').value = '150';
    saveTransaction({ preventDefault() {} });
    const afterAmountChange = account.savingsAccounts['Livret A'];
    generateRecurringOccurrences();
    const afterRegeneration = account.savingsAccounts['Livret A'];
    openModal();
    document.getElementById('transType').value = 'transfer';
    document.getElementById('transCategory').value = 'Épargne';
    document.getElementById('transAmount').value = '75';
    const tomorrow = new Date(getToday());
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('transDate').value = isoDate(tomorrow);
    document.getElementById('transferSavingsTarget').value = 'Livret A';
    saveTransaction({ preventDefault() {} });
    const futureTransfer = account.transactions.find(item => item.type === 'transfer' && item.amount === 75);
    const beforeFutureDue = account.savingsAccounts['Livret A'];
    openModalById(futureTransfer.id);
    document.getElementById('transDate').value = isoDate(getToday());
    saveTransaction({ preventDefault() {} });
    generateRecurringOccurrences();
    return { recurring, afterCreate, afterEdit, afterAmountChange, afterRegeneration, beforeFutureDue, afterFutureDue: account.savingsAccounts['Livret A'] };
  });
  assert.deepEqual(regression.recurring, { defaultsToSingle: true, ruleAmount: 35, editedAmount: 43, editedDesc: 'Internet exceptionnel', occurrenceCount: 1, futureAmount: 35, restoredAmount: 43, futureAfterReloadAmount: 35, rejectedOutsidePeriod: true, allScopeRule: 50, allScopeException: 43, allScopeFuture: 50 }, 'Les deux portées de modification doivent rester distinctes après rechargement');
  assert.equal(regression.afterCreate, 200, 'Le transfert initial doit créditer l’épargne une fois');
  assert.equal(regression.afterEdit, 200, 'L’édition ne doit pas recréditer l’épargne');
  assert.equal(regression.afterAmountChange, 150, 'Corriger le montant doit remplacer son effet précédent');
  assert.equal(regression.afterRegeneration, 150, 'La synchronisation ne doit pas rejouer le transfert');
  assert.equal(regression.beforeFutureDue, 150, 'Un transfert futur ne doit pas affecter l’épargne trop tôt');
  assert.equal(regression.afterFutureDue, 225, 'Un transfert devenu exigible doit être appliqué une seule fois');

  // Ancien état réellement rencontré : le livret contient déjà le transfert,
  // mais le drapeau persisté indique à tort qu'il reste à appliquer.
  const legacySavings = await transactionRegression.evaluate(() => {
    const account = window._getAppState().accounts[0];
    account.savingsAccounts['Livret A'] = 417.56;
    account.transactions.push({
      id: 'legacy-210', type: 'transfer', category: 'Épargne', amount: 210,
      amountBase: 210, originalAmount: 210, currency: 'EUR',
      date: isoDate(getToday()), desc: 'Transfert', transferTarget: 'Livret A',
      _effectsApplied: false
    });
    loadCurrentAccountIntoGlobals();
    generateRecurringOccurrences();
    const afterReload = account.savingsAccounts['Livret A'];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      openModalById('legacy-210');
      saveTransaction({ preventDefault() {} });
    }
    const afterEdits = account.savingsAccounts['Livret A'];
    account.savingsAccounts['Livret A'] = 1047.56;
    localStorage.setItem('freevTrustedDevice', '1');
    window.confirm = () => true;
    openSavingsBalanceCorrection('Livret A');
    document.getElementById('savingsAmount').value = '417.56';
    saveSavings();
    const backupBalance = JSON.parse(JSON.parse(localStorage.getItem('freevAutoBackup_v2')).data).accounts[0].savingsAccounts['Livret A'];
    const afterCorrection = account.savingsAccounts['Livret A'];
    openModalById('legacy-210');
    saveTransaction({ preventDefault() {} });
    return { afterReload, afterEdits, backupBalance, afterCorrection, afterCorrectionEdit: account.savingsAccounts['Livret A'] };
  });
  assert.deepEqual(legacySavings, { afterReload: 417.56, afterEdits: 417.56, backupBalance: 1047.56, afterCorrection: 417.56, afterCorrectionEdit: 417.56 }, 'La rectification doit garder une sauvegarde et rester stable après édition');
  await transactionRegression.close();

  // Parcours E2E : seuls les données de test sont préparées par script ; toutes
  // les créations, éditions et corrections passent par les contrôles visibles.
  const savingsE2E = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  savingsE2E.on('pageerror', error => pageErrors.push(`épargne E2E: ${error.message}`));
  savingsE2E.on('dialog', dialog => dialog.accept());
  await prepare(savingsE2E);
  await savingsE2E.evaluate(() => {
    window._runPostAuthInit();
    window.FreevV5.closeWhatsNew(false);
    const account = window._getAppState().accounts[0];
    account.transactions = [];
    account.recurringTransactions = [];
    account.savingsAccounts = { 'Livret A': 207.56, PEL: 100 };
    window.loadCurrentAccountIntoGlobals();
    window.switchView('transactions');
    window.syncAllUI(true);
  });
  const chooseVisibleOption = async (selectId, value) => {
    const menu = savingsE2E.locator(`[data-freev-select-for="${selectId}"]`);
    await menu.locator('[data-freev-select-trigger]').click();
    await menu.locator(`[data-freev-select-option="${value}"]`).click();
  };
  await savingsE2E.locator('button[onclick="openModal()"]:visible').first().click();
  await chooseVisibleOption('transType', 'transfer');
  await chooseVisibleOption('transCategory', 'Épargne');
  assert.equal(await savingsE2E.locator('#transferSavingsGroup').isVisible(), true, 'Le choix Transfert doit afficher le livret');
  await savingsE2E.locator('#transAmount').fill('210');
  await savingsE2E.locator('#transDate').fill(await savingsE2E.evaluate(() => isoDate(getToday())));
  await chooseVisibleOption('transferSavingsTarget', 'Livret A');
  await savingsE2E.locator('#transactionForm button[type="submit"]').click();
  const savingsValue = () => savingsE2E.evaluate(() => window._getAppState().accounts[0].savingsAccounts['Livret A']);
  const creationState = await savingsE2E.evaluate(() => ({
    modalHidden: document.getElementById('transactionModal').classList.contains('hidden'),
    formValid: document.getElementById('transactionForm').checkValidity(),
    invalidFields: [...document.querySelectorAll('#transactionForm :invalid')].map(input => input.id),
    type: document.getElementById('transType').value,
    category: document.getElementById('transCategory').value,
    transactionCount: window._getAppState().accounts[0].transactions.length
  }));
  assert.equal(await savingsValue(), 417.56, `Le clic de création doit ajouter 210 € une seule fois : ${JSON.stringify(creationState)}`);
  const transferId = await savingsE2E.evaluate(() => window._getAppState().accounts[0].transactions.find(t => t.type === 'transfer' && t.amount === 210)?.id);
  assert.ok(transferId, 'Une seule transaction de transfert doit avoir été créée');
  const editTransfer = savingsE2E.locator(`#allTransactions .js-edit[data-id="${transferId}"]`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await editTransfer.click();
    await savingsE2E.locator('#transactionForm button[type="submit"]').click();
    assert.equal(await savingsValue(), 417.56, 'Réenregistrer sans changement ne doit pas rejouer le transfert');
  }
  await editTransfer.click();
  await savingsE2E.locator('#transAmount').fill('205');
  await savingsE2E.locator('#transactionForm button[type="submit"]').click();
  assert.equal(await savingsValue(), 412.56, 'Modifier le montant doit appliquer uniquement l’écart de -5 €');
  await savingsE2E.evaluate(() => {
    window._getAppState().accounts[0].savingsAccounts['Livret A'] = 1047.56;
    window.switchView('savings');
  });
  await savingsE2E.getByRole('button', { name: 'Rectifier un solde erroné' }).click();
  assert.match(await savingsE2E.locator('[data-freev-select-for="savingsAction"] [data-freev-select-value]').textContent(), /solde exact/i, 'La correction doit être visible dans le menu');
  await savingsE2E.locator('#savingsAmount').fill('412.56');
  await savingsE2E.locator('#savingsModal button[onclick="saveSavings()"]').click();
  assert.equal(await savingsValue(), 412.56, 'La rectification par le formulaire doit enregistrer le solde exact');
  await savingsE2E.evaluate(() => {
    window._getAppState().accounts[0].savingsAccounts['Livret A'] = 1047.56;
    window.syncAllUI(true);
  });
  await savingsE2E.locator('.js-savings-correct-excess[data-type="Livret A"]').click();
  assert.equal(await savingsE2E.locator('#savingsAction').inputValue(), 'remove_excess', 'Le bouton du livret doit choisir la correction du trop-perçu');
  assert.equal(await savingsE2E.locator('#savingsType').inputValue(), 'Livret A', 'La correction doit cibler le bon livret');
  await savingsE2E.locator('#savingsAmount').fill('2000');
  assert.equal(await savingsE2E.locator('#savingsSubmitButton').isDisabled(), true, 'Impossible de retirer davantage que le solde du livret');
  await savingsE2E.locator('#savingsAmount').fill('635');
  assert.match(await savingsE2E.locator('#savingsCorrectionPreview').textContent(), /412,56/, 'Le solde corrigé doit être affiché avant confirmation');
  await savingsE2E.locator('#savingsSubmitButton').click();
  assert.equal(await savingsValue(), 412.56, 'Retirer le trop-perçu doit soustraire une seule fois 635 € de 1 047,56 €');
  assert.equal(await savingsE2E.evaluate(() => window._getAppState().accounts[0].savingsAccounts.PEL), 100, 'Corriger un livret ne doit pas modifier les autres');
  assert.equal(await savingsE2E.evaluate(() => window._getAppState().accounts[0].transactions.length), 1, 'La correction ne doit pas créer une deuxième transaction');
  await savingsE2E.close();

  const recurringE2E = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  recurringE2E.on('pageerror', error => pageErrors.push(`récurrence E2E: ${error.message}`));
  await prepare(recurringE2E);
  await recurringE2E.evaluate(() => {
    window._runPostAuthInit();
    window.FreevV5.closeWhatsNew(false);
    window.switchView('transactions');
  });
  await recurringE2E.locator('button[onclick="changeMonth(1)"]').click();
  const editedMonth = await recurringE2E.locator('#globalMonthPicker').inputValue();
  await recurringE2E.locator('#allTransactions .js-edit-projected').first().click();
  await recurringE2E.locator('#recurDateScopeSingle').check();
  await recurringE2E.locator('#transAmount').fill('42');
  await recurringE2E.locator('#transactionForm button[type="submit"]').click();
  const recurrenceState = () => recurringE2E.evaluate(month => {
    const account = window._getAppState().accounts[0];
    const next = new Date(`${month}-05T12:00:00`);
    next.setMonth(next.getMonth() + 1);
    const nextMonth = isoMonth(next);
    return {
      ruleAmount: account.recurringTransactions.find(rule => rule.id === 'internet')?.amount,
      exceptionAmounts: account.transactions.filter(item => item.parentId === 'internet' && item.periodKey === month).map(item => item.amount),
      nextAmount: getProjectedRecurringTransactions(nextMonth).find(item => item.parentId === 'internet')?.amount
    };
  }, editedMonth);
  const firstRecurrenceState = await recurrenceState();
  const firstRecurrenceDiagnostic = await recurringE2E.evaluate(() => ({
    modalHidden: document.getElementById('transactionModal').classList.contains('hidden'),
    invalidFields: [...document.querySelectorAll('#transactionForm :invalid')].map(input => input.id),
    category: document.getElementById('transCategory').value,
    transactions: window._getAppState().accounts[0].transactions.filter(item => item.parentId === 'internet').map(item => ({ date: item.date, periodKey: item.periodKey, amount: item.amount }))
  }));
  assert.deepEqual(firstRecurrenceState, { ruleAmount: 35, exceptionAmounts: [42], nextAmount: 35 }, `Seulement ce mois doit préserver les échéances suivantes : ${JSON.stringify(firstRecurrenceDiagnostic)}`);
  await recurringE2E.locator('#allTransactions .js-edit').first().click();
  assert.equal(await recurringE2E.locator('#recurDateScopeSingle').isChecked(), true, 'La réouverture de l’exception doit garder le choix mensuel');
  await recurringE2E.locator('#transAmount').fill('43');
  await recurringE2E.locator('#transactionForm button[type="submit"]').click();
  assert.deepEqual(await recurrenceState(), { ruleAmount: 35, exceptionAmounts: [43], nextAmount: 35 }, 'Rééditer une exception ne doit ni la dupliquer ni modifier la série');
  await recurringE2E.close();

  await desktop.evaluate(() => window.switchView('planner'));
  await desktop.evaluate(() => window.FreevV4.openSearch());
  await desktop.fill('#v4SearchInput', 'courses');
  await desktop.waitForSelector('#v4SearchResults .v4-search-result');
  await desktop.screenshot({ path: path.join(os.tmpdir(), 'freev-v4-desktop.png'), fullPage: true });

  const tablet = await browser.newPage({ viewport: { width: 768, height: 900 } });
  tablet.on('pageerror', error => pageErrors.push(`tablette: ${error.message}`));
  await prepare(tablet);
  await tablet.locator('#v4HelpButton').click();
  await tablet.waitForSelector('#freevHelpOverlay:not([hidden])');
  const tabletHelpDimensions = await tablet.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(tabletHelpDimensions.scroll <= tabletHelpDimensions.width + 1, `Débordement de l’aide tablette : ${tabletHelpDimensions.scroll}px pour ${tabletHelpDimensions.width}px`);
  await tablet.waitForTimeout(250);
  await tablet.locator('[data-freev-help-dialog]').screenshot({ path: path.join(os.tmpdir(), 'freev-help-tablet.png') });
  await tablet.keyboard.press('Escape');

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  });
  mobile.on('pageerror', error => pageErrors.push(`iPhone: ${error.message}`));
  await prepare(mobile);
  const sidebarOffscreen = () => mobile.locator('.sidebar').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.right <= 0 && !element.classList.contains('open');
  });
  assert.equal(await sidebarOffscreen(), true, 'La sidebar fermée doit être entièrement hors écran sur iPhone');
  await mobile.locator('#bnav-more').click();
  await mobile.waitForSelector('.sidebar.open');
  assert.equal(await mobile.locator('[data-mobile-hidden="planner"]').count(), 1);
  assert.equal(await mobile.locator('[data-mobile-hidden="smart"]').count(), 1);
  assert.equal(await mobile.locator('[data-mobile-hidden="planner"]').isVisible(), false, 'Le Planificateur ne doit pas encombrer le menu mobile');
  assert.equal(await mobile.locator('[data-mobile-hidden="smart"]').isVisible(), false, 'Le Centre intelligent ne doit pas encombrer le menu mobile');
  assert.equal(await mobile.locator('.bottom-nav-item').count(), 5, 'La barre mobile doit conserver cinq accès tactiles clairs');
  await mobile.locator('.sidebar-close-btn').click();
  await mobile.waitForTimeout(350);
  assert.equal(await sidebarOffscreen(), true, 'La sidebar doit disparaître entièrement après fermeture');
  await mobile.evaluate(() => {
    window.switchView('smart');
    window.FreevV5.render();
  });
  await mobile.waitForSelector('#smart-view:not(.hidden)');
  await mobile.waitForTimeout(350);
  const dimensions = await mobile.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(dimensions.scroll <= dimensions.width + 1, `Débordement horizontal mobile : ${dimensions.scroll}px pour ${dimensions.width}px`);
  assert.ok(await mobile.locator('.v5-tabs').evaluate(element => element.scrollWidth > 0));
  assert.equal(await mobile.locator('#v51ChangeGrid article').count(), 4);
  const renderDuration = await mobile.evaluate(() => {
    const start = performance.now();
    for (let index = 0; index < 15; index += 1) window.FreevV5.render();
    return performance.now() - start;
  });
  assert.ok(renderDuration < 1200, `Rendu Centre 5.1 trop lent sur mobile simulé : ${renderDuration.toFixed(1)} ms`);
  await mobile.locator('#v5PanelOverview').scrollIntoViewIfNeeded();
  await mobile.locator('#v5PanelOverview').screenshot({ path: path.join(os.tmpdir(), 'freev-v51-overview-mobile-detail.png') });
  await mobile.screenshot({ path: path.join(os.tmpdir(), 'freev-v5-smart-mobile.png'), fullPage: true });
  await mobile.evaluate(() => window.switchView('planner'));
  await mobile.locator('#v4HelpButton').click();
  await mobile.waitForSelector('#freevHelpOverlay:not([hidden])');
  const helpDimensions = await mobile.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(helpDimensions.scroll <= helpDimensions.width + 1, `Débordement de l’aide mobile : ${helpDimensions.scroll}px pour ${helpDimensions.width}px`);
  await mobile.locator('#freevHelpTabSmart').click();
  await mobile.fill('#freevHelpSearch', 'CSV');
  assert.ok(await mobile.locator('#freevHelpPanelSmart [data-freev-help-search]:not([hidden])').count() >= 1);
  assert.equal(await mobile.locator('#freevHelpNoResults:not([hidden])').count(), 0);
  await mobile.waitForTimeout(250);
  await mobile.locator('[data-freev-help-dialog]').screenshot({ path: path.join(os.tmpdir(), 'freev-help-mobile.png') });
  await mobile.keyboard.press('Escape');
  assert.equal(await mobile.inputValue('#freevHelpSearch'), '');
  await mobile.keyboard.press('Escape');
  await mobile.evaluate(() => window.FreevPWA.openGuide());
  await mobile.waitForSelector('#pwaInstallModal:not([hidden])');
  assert.ok((await mobile.textContent('#pwaInstallTitle')).includes('iPhone'));
  assert.equal(await mobile.locator('#pwaInstallSteps li').count(), 3);
  await mobile.waitForTimeout(300);
  await mobile.screenshot({ path: path.join(os.tmpdir(), 'freev-v42-install-iphone.png'), fullPage: true });
  await mobile.evaluate(() => window.FreevPWA.closeGuide());
  await mobile.evaluate(() => window.FreevPWA.showBanner(true));
  assert.equal(await mobile.locator('#pwaInstallBanner:not([hidden])').count(), 1);
  await mobile.evaluate(() => window.FreevPWA.dismissBanner());
  await mobile.screenshot({ path: path.join(os.tmpdir(), 'freev-v4-planner-mobile.png'), fullPage: true });
  const plannerDimensions = await mobile.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(plannerDimensions.scroll <= plannerDimensions.width + 1, `Débordement du Planificateur mobile : ${plannerDimensions.scroll}px pour ${plannerDimensions.width}px`);
  await mobile.locator('.v4-forecast-card').scrollIntoViewIfNeeded();
  await mobile.waitForTimeout(250);
  await mobile.locator('.v4-forecast-card').screenshot({ path: path.join(os.tmpdir(), 'freev-v42-planner-mobile-card.png') });
  await mobile.evaluate(() => window.FreevV4.showWhatsNew(true));
  await mobile.waitForSelector('#v4WhatsNew:not([hidden])');
  await mobile.screenshot({ path: path.join(os.tmpdir(), 'freev-v4-mobile.png'), fullPage: true });
  assert.deepEqual(pageErrors, [], `Erreurs JavaScript détectées : ${pageErrors.join(' | ')}`);
  console.log('Test navigateur réussi : transferts et rectification d’épargne, édition mensuelle des récurrences, recherche, progression, accès contextuels et accessibilité vérifiés sur ordinateur, tablette et iPhone.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
