/* FREEV Gestion · Premium V4 — confort visuel uniquement, aucune écriture financière. */
(() => {
  'use strict';
  const DENSITY_KEY = 'freev.ui.density.v4';
  const periodLabel = value => {
    if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return '—';
    const [year, month] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(year, month - 1, 1)));
  };
  const readDensity = storage => {
    try { return storage?.getItem(DENSITY_KEY) === 'compact'; }
    catch { return false; }
  };
  const writeDensity = (storage, compact) => {
    try { storage?.setItem(DENSITY_KEY, compact ? 'compact' : 'comfortable'); }
    catch { /* Préférence optionnelle si le stockage local est désactivé. */ }
  };
  const applyDensity = (body, toggle, status, compact) => {
    body?.classList?.toggle('freev-v4-compact', compact);
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(compact));
      toggle.setAttribute('aria-label', compact ? 'Désactiver l’affichage compact' : 'Activer l’affichage compact');
      const icon = toggle.querySelector('.premium-v4-density-state');
      icon?.classList?.toggle('fa-toggle-on', compact);
      icon?.classList?.toggle('fa-toggle-off', !compact);
    }
    if (status) status.textContent = compact ? 'Activé' : 'Désactivé';
    return compact;
  };
  function init() {
    const toggle = document.getElementById('freevDensityToggle');
    const status = document.getElementById('freevDensityStatus');
    const month = document.getElementById('globalMonthPicker');
    const label = document.getElementById('premiumV4Period');
    let storage = null;
    try { storage = window.localStorage; } catch { /* Stockage non disponible. */ }
    let compact = readDensity(storage);
    applyDensity(document.body, toggle, status, compact);
    toggle?.addEventListener('click', () => {
      compact = !compact;
      applyDensity(document.body, toggle, status, compact);
      writeDensity(storage, compact);
    });
    const updatePeriod = () => { if (label) label.textContent = periodLabel(month?.value); };
    month?.addEventListener('change', updatePeriod);
    document.querySelectorAll('.month-nav-btn').forEach(btn => btn.addEventListener('click', updatePeriod));
    // Certains changements du mois sont déclenchés par le code, sans événement change.
    const observer = month && typeof MutationObserver !== 'undefined'
      ? new MutationObserver(updatePeriod) : null;
    observer?.observe(month, { attributes: true, attributeFilter: ['value'] });
    updatePeriod();
    // Le changement de page reste géré par FreevPremiumUI ; aucune action financière ici.
  }
  window.FreevPremiumV4 = Object.freeze({ periodLabel, readDensity, writeDensity, applyDensity });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
