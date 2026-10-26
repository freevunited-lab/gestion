/* FREEV Gestion — Priorité 3. Présentation uniquement : aucune écriture financière. */
(() => {
  'use strict';

  const pages = Object.freeze({
    dashboard: ['TABLEAU DE BORD', 'Votre mois, en clair', 'Le solde d’aujourd’hui, les mouvements du mois et les prochaines échéances : l’essentiel pour savoir où vous en êtes.'],
    transactions: ['OPÉRATIONS', 'Vos opérations', 'Ajoutez et retrouvez vos revenus, dépenses et transferts.'],
    recurring: ['PAIEMENTS RÉGULIERS', 'Paiements réguliers', 'Retrouvez ici le loyer, les abonnements et les autres montants qui reviennent.'],
    analytics: ['ANALYSES', 'Évolution de vos finances', 'Comparez ce qui entre et sort, mois par mois.'],
    planner: ['PRÉVISIONS', 'Prévoir les prochains mois', 'Testez un changement et voyez son effet possible sur votre solde.'],
    smart: ['OUTILS INTELLIGENTS', 'Outils automatiques', 'Importez un relevé, classez des opérations et vérifiez les propositions de FREEV.'],
    savings: ['ÉPARGNE', 'Épargne et objectifs', 'Suivez l’argent mis de côté et l’avancement de vos objectifs.'],
    debts: ['DETTES', 'Dettes et remboursements', 'Notez les sommes à rembourser et les paiements effectués.'],
    history: ['HISTORIQUE', 'Modifications récentes', 'Retrouvez les changements enregistrés dans votre compte.'],
    settings: ['PARAMÈTRES', 'Réglages', 'Choisissez votre devise, vos préférences et vos sauvegardes.']
  });
  // Illustration propre à chaque page. Ces SVG sont décoratifs et ne représentent pas des données réelles.
  const pageArt = Object.freeze({
    dashboard: `<rect class="art-surface" x="25" y="31" width="210" height="94" rx="18"/><path class="art-guide" d="M43 101H218M43 74H218M43 48H218"/><rect class="art-bar art-bar-one" x="54" y="77" width="18" height="31" rx="5"/><rect class="art-bar art-bar-two" x="86" y="66" width="18" height="42" rx="5"/><rect class="art-bar art-bar-three" x="118" y="83" width="18" height="25" rx="5"/><path class="art-line" pathLength="100" d="M47 87C71 82 84 75 104 81S141 72 158 66 194 62 215 47"/><circle class="art-dot" cx="215" cy="47" r="5"/>`,
    transactions: `<g class="art-receipt"><path class="art-surface" d="M77 17h106a12 12 0 0 1 12 12v94l-12-6-13 6-13-6-13 6-13-6-13 6-13-6-13 6V29a12 12 0 0 1 12-12Z"/><path class="art-row art-row-one" d="M101 48h54"/><path class="art-row art-row-two" d="M101 67h69"/><path class="art-row art-row-three" d="M101 86h38"/><path class="art-row art-row-four" d="M101 104h55"/></g><circle class="art-status" cx="191" cy="43" r="15"/><path class="art-check" pathLength="100" d="m185 43 4 4 8-9"/>`,
    recurring: `<rect class="art-surface" x="47" y="27" width="165" height="103" rx="16"/><path class="art-guide" d="M47 55h165M84 27v28M174 27v28"/><circle class="art-calendar-date" cx="88" cy="81" r="10"/><circle class="art-calendar-date" cx="130" cy="81" r="10"/><circle class="art-calendar-date" cx="172" cy="81" r="10"/><circle class="art-calendar-date art-calendar-focus" cx="130" cy="105" r="10"/><path class="art-line" pathLength="100" d="M206 96c18-24 10-55-13-68"/><path class="art-line-tip" d="m196 20-4 9 10 2"/>`,
    analytics: `<path class="art-guide" d="M29 119H231M29 86H231M29 53H231"/><rect class="art-bar art-bar-one" x="48" y="76" width="20" height="43" rx="5"/><rect class="art-bar art-bar-two" x="86" y="62" width="20" height="57" rx="5"/><rect class="art-bar art-bar-three" x="124" y="84" width="20" height="35" rx="5"/><rect class="art-bar art-bar-four" x="162" y="44" width="20" height="75" rx="5"/><path class="art-line" pathLength="100" d="M41 88C66 94 79 64 98 71s33 24 50 13 36-34 69-45"/><circle class="art-dot" cx="217" cy="39" r="5"/>`,
    savings: `<path class="art-surface art-savings-basket" d="M79 52h102l-9 73H88L79 52Z"/><path class="art-guide" d="M72 52h116M96 125h68"/><circle class="art-coin art-coin-one" cx="108" cy="76" r="15"/><circle class="art-coin art-coin-two" cx="150" cy="82" r="15"/><g class="art-coin-three"><circle class="art-coin" cx="129" cy="47" r="15"/><path class="art-coin-mark" d="M129 40v14m-4-10h8m-8 6h8"/></g><path class="art-savings-glint" d="m186 35 2-7m6 15 7-2m-15 7 3 6"/>`,
    debts: `<path class="art-guide" d="M34 120H226"/><rect class="art-debt-step art-debt-one" x="44" y="39" width="31" height="81" rx="7"/><rect class="art-debt-step art-debt-two" x="90" y="59" width="31" height="61" rx="7"/><rect class="art-debt-step art-debt-three" x="136" y="79" width="31" height="41" rx="7"/><rect class="art-debt-step art-debt-four" x="182" y="96" width="31" height="24" rx="7"/><path class="art-line" pathLength="100" d="M59 38 105 57 151 77 197 94"/><circle class="art-dot" cx="197" cy="94" r="5"/>`,
    history: `<path class="art-line" pathLength="100" d="M28 100C65 100 63 54 100 54s43 51 79 51 40-43 54-43"/><circle class="art-history-node art-history-one" cx="31" cy="100" r="8"/><circle class="art-history-node art-history-two" cx="100" cy="54" r="8"/><circle class="art-history-node art-history-three" cx="179" cy="105" r="8"/><circle class="art-history-node art-history-four" cx="230" cy="64" r="8"/><path class="art-guide" d="M31 115v13M100 69v59M179 120v8M230 79v49"/>`,
    settings: `<path class="art-guide" d="M35 39h190M35 77h190M35 115h190"/><path class="art-slider-progress art-slider-progress-one" d="M35 39h190"/><path class="art-slider-progress art-slider-progress-two" d="M35 77h190"/><path class="art-slider-progress art-slider-progress-three" d="M35 115h190"/><circle class="art-slider-handle art-slider-one" cx="105" cy="39" r="12"/><circle class="art-slider-handle art-slider-two" cx="174" cy="77" r="12"/><circle class="art-slider-handle art-slider-three" cx="79" cy="115" r="12"/>`
  });

  function setView(view) {
    if (!Object.hasOwn(pages, view)) return false;
    const [section, title, desc] = pages[view];
    const sectionEl = document.getElementById('premiumWorkspaceSection');
    const titleEl = document.getElementById('premiumWorkspaceTitle');
    const descEl = document.getElementById('premiumWorkspaceDesc');
    if (sectionEl) sectionEl.textContent = section;
    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = desc;
    const art = document.getElementById('premiumWorkspaceIllustration');
    if (art) {
      art.dataset.artView = view;
      art.innerHTML = pageArt[view]
        ? `<svg viewBox="0 0 260 150" focusable="false" aria-hidden="true">${pageArt[view]}</svg>`
        : '';
    }

    // Only nav inside the sidebar changes aria-current; installation is not a page.
    document.querySelectorAll('#sidebarNav .nav-item[onclick]').forEach(item => {
      const action = item.getAttribute('onclick') || '';
      const space = window.FreevSpaces?.spaceOf?.(view);
      const isCurrent = space ? item.dataset?.space === space : (action.includes(`switchView('${view}')`) || action.includes(`switchView("${view}")`));
      if (isCurrent) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    document.querySelectorAll('.bottom-nav-item').forEach(item => {
      if (item.id === `bnav-${window.FreevSpaces?.mobileTab?.(view) || view}`) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    document.body.dataset.freevView = view;
    return true;
  }

  function init() {
    setView(typeof currentView === 'string' ? currentView : 'dashboard');

    // Espace pour ouvrir le menu au clavier, escape pour refermer.
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !sidebar.classList.contains('open')) return;
      // Do not intercept Escape when another dialog is open.
      if (document.querySelector('[role="dialog"]:not([hidden]):not(.hidden)')) return;
      window.closeSidebarMobile?.();
      document.getElementById('bnav-dashboard')?.focus();
    });
  }

  window.FreevPremiumUI = Object.freeze({ setView });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
