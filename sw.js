// Retrait de la sélection en lot dans la liste des opérations.
const CACHE_NAME = 'freev-v5.2.0-everyday-20261026-v89';
const LOCAL_ASSETS = [
  './',
  './index.html',
  './rapport-mensuel.html',
  './manifest.webmanifest',
  './assets/icons/icon.svg',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/css/app.css',
  './assets/css/mobile.css?v=20261025-adaptive-devices',
  './assets/css/v4.css',
  './assets/css/v5.css',
  './assets/css/layout-preferences.css',
  './assets/css/recurrence-priority1.css',
  './assets/css/finance-priority2.css',
  './assets/css/premium-priority3.css',
  './assets/css/premium-v4.css',
  './assets/css/apple-premium.css',
  './assets/css/signature2.css',
  './assets/css/color-controls.css',
  './assets/css/clarity.css',
  './assets/css/account-profile.css',
  './assets/css/focus-polish.css',
  './assets/css/chart-motion.css',
  './assets/css/receipt-scanner.css',
  './assets/css/adaptive-devices.css',
  './assets/css/menu-system.css',
  './assets/css/site-motion.css',
  './assets/css/help.css',
  './assets/css/report.css',
  './assets/css/selects.css',
  './assets/css/buttons.css',
  './assets/css/theme-toggle.css',
  './assets/css/mobile-nav.css',
  './assets/css/space-tabs.css',
  './assets/css/spendable.css',
  './assets/css/reconciliation-ui.css',
  './assets/js/vendor-loader.js',
  './assets/js/config.js',
  './assets/js/state.js',
  './assets/js/core.js',
  './assets/js/finance-money.js',
  './assets/js/chart-motion.js',
  './assets/js/dashboard.js',
  './assets/js/transactions.js',
  './assets/js/recurring.js',
  './assets/js/everyday-features.js',
  './assets/js/recurrence-priority1.js',
  './assets/js/finance-priority2.js',
  './assets/js/premium-priority3.js',
  './assets/js/spaces.js',
  './assets/js/spaces-model.mjs',
  './assets/js/spendable.js',
  './assets/js/spendable-engine.mjs',
  './assets/js/search-engine.mjs',
  './assets/js/search-ui.js',
  './assets/js/monthly-check-engine.mjs',
  './assets/js/monthly-check.js',
  './assets/js/finance-core.mjs',
  './assets/js/freev-algorithm.mjs',
  './assets/js/freev-account-core.mjs',
  './assets/js/freev-store.mjs',
  './assets/js/freev-delta-ledger.mjs',
  './assets/js/freev-ledger-audit.mjs',
  './assets/js/freev-forecast.mjs',
  './assets/js/freev-ledger-bridge.mjs',
  './assets/js/forecast-session-cache.mjs',
  './assets/js/streaming-ledger.mjs',
  './assets/js/calculation-coordination.mjs',
  './assets/js/financial-matching-engine.mjs',
  './assets/js/planner-evaluation-insight.mjs',
  './assets/js/category-learning.mjs',
  './assets/js/premium-v4.js',
  './assets/js/signature2.js',
  './assets/js/finance-priority2-engine.mjs',
  './assets/js/finance.js',
  './assets/js/health.js',
  './assets/js/data-io.js',
  './assets/js/layout-preferences.js',
  './assets/js/customization.js',
  './assets/js/bootstrap.js',
  './assets/js/transfers.js',
  './assets/js/ui.js',
  './assets/js/auth-bridge.js',
  './assets/js/account-profile.js',
  './assets/js/pwa-install.js',
  './assets/js/help.js',
  './assets/js/custom-selects.js',
  './assets/js/button-motion.js',
  './assets/js/firebase-auth.js',
  './assets/js/cloud-sync-guard.mjs',
  './assets/js/v4-engine.js',
  './assets/js/v4.js',
  './assets/js/v5-engine.js',
  './assets/js/v5.js',
  './assets/js/reconciliation-ui.js',
  './assets/js/receipt-scanner.js',
  './assets/js/receipt-recovery.mjs',
  './assets/js/receipt-duplicate.mjs',
  './assets/js/receipt-scan-engine.mjs',
  './assets/js/receipt-learning.mjs',
  './assets/js/receipt-image-quality.mjs',
  './assets/js/receipt-qr.mjs',
  './assets/js/report.js'
];

// OCR embarqué mais chargé uniquement à la première lecture de ticket :
// ces fichiers lourds ne ralentissent ni l’installation ni l’ouverture de la PWA.
const DEFERRED_ASSETS = [
  './assets/vendor/tesseract/tesseract.min.js',
  './assets/vendor/tesseract/worker.min.js',
  './assets/vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js',
  './assets/vendor/tesseract/core/tesseract-core-simd-lstm.wasm',
  './assets/vendor/tesseract/core/tesseract-core-lstm.wasm.js',
  './assets/vendor/tesseract/core/tesseract-core-lstm.wasm',
  './assets/vendor/tesseract/lang/fra.traineddata.gz'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(LOCAL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Le cache PWA ne contient QUE des fichiers statiques listés explicitement.
// Aucun JSON utilisateur, aucune API et aucune ressource arbitraire ne peut y entrer.
const DEFERRED_PATHS = new Set(DEFERRED_ASSETS.map(item => new URL(item, self.registration.scope).pathname));
const STATIC_PATHS = new Set([...LOCAL_ASSETS, ...DEFERRED_ASSETS].filter(item => item.startsWith('./assets/'))
  .map(item => new URL(item, self.registration.scope).pathname));
const NAV_PATHS = new Set(['./', './index.html', './rapport-mensuel.html']
  .map(item => new URL(item, self.registration.scope).pathname));
const cachedAsset = async (key) => (await caches.open(CACHE_NAME)).match(key, { ignoreSearch: true });
const savePublicAsset = async (key, response) => {
  if (response.ok && response.type !== 'opaque') {
    try { await (await caches.open(CACHE_NAME)).put(key, response.clone()); }
    catch (error) { console.warn('[Freev] Cache PWA indisponible :', error); }
  }
  return response;
};

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const cacheKey = `${url.origin}${url.pathname}`; // Évite les entrées infinies pour ?view=...

  if (request.mode === 'navigate') {
    if (!NAV_PATHS.has(url.pathname)) return;
    event.respondWith(fetch(request)
      .then(response => savePublicAsset(cacheKey, response))
      .catch(async () => (await cachedAsset(cacheKey)) || Response.error()));
    return;
  }
  if (!STATIC_PATHS.has(url.pathname)) return;

  // Ressources OCR volumineuses : garder la première copie disponible après
  // téléchargement, mais ne jamais les précharger pendant l’installation PWA.
  if (DEFERRED_PATHS.has(url.pathname)) {
    event.respondWith(cachedAsset(cacheKey).then(hit => hit || fetch(request).then(response => savePublicAsset(cacheKey, response))));
    return;
  }

  // Scripts et styles réseau d'abord ; repli dans le cache de CETTE version,
  // jamais dans un vieux cache d'une autre version.
  if (/\.(?:m?js|css)$/.test(url.pathname)) {
    event.respondWith(fetch(request)
      .then(response => savePublicAsset(cacheKey, response))
      .catch(async () => (await cachedAsset(cacheKey)) || Response.error()));
    return;
  }
  // Images/icônes : cache d'abord, revalidation réseau en arrière-plan.
  const refresh = fetch(request).then(response => savePublicAsset(cacheKey, response));
  event.waitUntil(refresh.catch(() => {}));
  event.respondWith(cachedAsset(cacheKey).then(hit => hit || refresh));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const fallback = new URL('./index.html?source=notification&view=smart', self.registration.scope);
  let target = fallback.href;
  try {
    const candidate = new URL(event.notification.data?.url || fallback.href, self.registration.scope);
    if (candidate.origin === self.location.origin && NAV_PATHS.has(candidate.pathname)) target = candidate.href;
  } catch (_) { /* URL invalide : garder la destination interne sûre. */ }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(client => 'focus' in client);
      if (existing) {
        existing.navigate?.(target);
        return existing.focus();
      }
      return self.clients.openWindow?.(target);
    })
  );
});
