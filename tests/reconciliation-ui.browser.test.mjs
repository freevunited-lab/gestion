import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let chromium = null;
try {
  const playwrightModule = process.env.PLAYWRIGHT_MODULE || 'playwright';
  const specifier = playwrightModule.startsWith('.') || path.isAbsolute(playwrightModule)
    ? pathToFileURL(path.resolve(playwrightModule)).href
    : playwrightModule;
  const loaded = await import(specifier);
  chromium = loaded.chromium ? loaded.chromium : loaded.default?.chromium;
} catch {
  // Keep the normal unit-test suite usable where the optional browser runtime is absent.
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png'
};

let server, browser, baseUrl;

before(async () => {
  if (!chromium) return;
  server = http.createServer((request, response) => {
    const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
    const target = path.resolve(root, relative);
    if (!target.startsWith(root) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(target).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    // Playwright may be available while its optional Chromium binary is not.
    // The UI test can still run in environments that provide that binary.
  }
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

test('le flux de rapprochement demande une confirmation, préserve les opérations et permet le retour arrière', { skip: chromium ? false : 'Playwright unavailable; set PLAYWRIGHT_MODULE to enable the browser check' }, async t => {
  if (!browser) {
    t.skip('Chromium binary unavailable; install it in a browser-enabled environment to run this check');
    return;
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/index.html?plannerPreview=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.FreevV4 && window.FreevV5 && window.FreevReconciliation && window._applyCloudData));
  await page.addStyleTag({ content: '#authOverlay, #authLoadingScreen { display: none !important; pointer-events: none !important; }' });
  await page.evaluate(() => {
    window._applyCloudData({
      currentAccountId: 'reconciliation-test',
      accounts: [{
        id: 'reconciliation-test', name: 'Compte de test', initialCapital: 1000,
        settings: { baseCurrency: 'EUR' },
        transactions: [
          { id: 'actual-a', type: 'expense', amount: 12, amountBase: 12, date: '2026-10-20', desc: 'Musique abonnement' },
          { id: 'actual-b', type: 'expense', amount: 12, amountBase: 12, date: '2026-10-20', desc: 'Musique abonnement' },
          { id: 'planned-a', type: 'expense', amount: 12, amountBase: 12, date: '2026-11-05', desc: 'Musique abonnement', paymentStatus: 'planned' },
          { id: 'planned-b', type: 'expense', amount: 12, amountBase: 12, date: '2026-11-05', desc: 'Musique abonnement', paymentStatus: 'planned' }
        ],
        recurringTransactions: [], plannerSettings: { forecastMonths: 1 }, debts: [], historyLog: []
      }]
    });
    window.switchView('smart');
    window.FreevV5.setActiveTab('monthcheck');
    window.FreevReconciliation.render();
  });
  await page.waitForSelector('#freevReconciliationPanel .rc-option');
  assert.ok(await page.locator('#freevReconciliationPanel').getByText('Plusieurs correspondances proches').count() > 0);
  assert.equal(await page.evaluate(() => window._getAppState().accounts[0].reconciliationAllocations?.length || 0), 0, 'Les propositions ne doivent pas écrire de lien automatiquement');

  await page.locator('#freevReconciliationPanel [data-rc-select="0"]').check();
  await page.locator('#freevReconciliationPanel [data-rc-review]').click();
  await page.waitForSelector('#freevReconciliationDialog[open]');
  assert.ok(await page.locator('#freevReconciliationDialog').getByText(/Plusieurs correspondances proches/).count());
  await page.locator('#rcDialogConfirm').click();
  await page.waitForFunction(() => window._getAppState().accounts[0].reconciliationAllocations?.length === 1);

  const stored = await page.evaluate(() => {
    const account = window._getAppState().accounts[0];
    return {
      allocation: account.reconciliationAllocations[0],
      sourceRows: account.transactions.map(item => ({ id: item.id, amountBase: item.amountBase, paymentStatus: item.paymentStatus }))
    };
  });
  assert.equal(stored.allocation.amountMinor, 1200);
  assert.equal(stored.sourceRows.find(row => row.id === 'actual-a').amountBase, 12);
  assert.equal(stored.sourceRows.find(row => row.id === 'planned-a').paymentStatus, 'planned');

  await page.locator('#freevReconciliationPanel [data-rc-undo]').click();
  await page.waitForSelector('#freevReconciliationDialog[open]');
  await page.locator('#rcDialogConfirm').click();
  await page.waitForFunction(() => (window._getAppState().accounts[0].reconciliationAllocations || []).length === 0);
  assert.equal(await page.locator('#freevReconciliationPanel').getByText('Annuler le dernier rapprochement').count(), 0);

  await page.locator('#freevReconciliationPanel [data-rc-scan-duplicates]').click();
  await page.waitForSelector('#freevReconciliationPanel .rc-duplicate-card');
  assert.equal(await page.locator('#freevReconciliationPanel .rc-duplicate-card').count(), 1);
  assert.ok((await page.locator('#freevReconciliationPanel .rc-duplicate-card').innerText()).includes('Ressemblance à vérifier'));
  assert.equal(await page.evaluate(() => window._getAppState().accounts[0].transactions.length), 4, 'L’analyse de doublons reste en lecture seule');
  assert.deepEqual(pageErrors, []);
  await page.close();
});
