// ============================================================
// ===== INIT =================================================
// ============================================================

function init() {
  // Firebase est obligatoire : l'interface est initialisée uniquement après authentification.
  if (window.FIREBASE_REQUIRED) return;
  if (window.__freevBooted) return;
  window.__freevBooted = true;

  loadData(); // charge le système multi-comptes
  setChartDefaults();
  if (window.Chart) {
    try { Chart.register(donutCenterTextPlugin); } catch(e) {}
  }

  // month & default date
  const monthPicker = document.getElementById('globalMonthPicker');
  if (monthPicker) monthPicker.value = isoMonth(today);
  const dateInput = document.getElementById('transDate');
  if (dateInput) dateInput.value = isoDate(today);

  // attach type change
  const typeSel = document.getElementById('transType');
  if (typeSel) typeSel.addEventListener('change', handleTypeChange);

  // recurring
  generateRecurringOccurrences();

  // shortcuts + mobile
  setupShortcuts();
  setupSidebarToggle();

  // initial UI
  refreshSavingsSelect();
  refreshCategoryFilter();
  loadSettingsUI();

  // ✅ Multi-compte : rendu initial
  renderAccountsSidebar();
  updateViewModeUI();

  // ✅ Dark mode : restaurer la préférence sauvegardée
  initDarkMode();

  // ✅ Catégories personnalisées : alimenter les selects
  populateCategorySelects();
  // ✅ Couleur FAB personnalisée
  loadFabColor();
  // ✅ Couleur icône de validation
  loadReconcileColor();

  // ✅ Auto-backup : vérifier le backup au démarrage + lancer l'interval
  checkAutoBackup();
  setInterval(autoBackupSilent, 5 * 60 * 1000); // toutes les 5 minutes

  // ✅ Taux de change : charger si les taux ont plus de 1h ou manquants (silencieux si hors-ligne)
  if (!settings.ratesUpdatedAt || (Date.now() - new Date(settings.ratesUpdatedAt)) > 3600000) {
    fetchExchangeRates().catch(() => {}); // toujours silencieux au démarrage
  }

  updateDashboard();
}

// Mise en cache locale des fichiers de l'application lorsqu'elle est servie en HTTP(S).
window.addEventListener('load', () => {
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('./sw.js').catch(error =>
      console.info('[Freev] Cache hors-ligne non activé :', error?.message || error)
    );
  }
});
