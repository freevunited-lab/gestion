// Centre d’aide interactif Freev : prise en main et guides des outils avancés.
(() => {
  const byId = id => document.getElementById(id);
  const sections = ['start', 'planner', 'smart'];
  const sectionNames = { start: 'la prise en main', planner: 'le Planificateur', smart: 'les outils intelligents' };
  const progressKey = 'freevHelpProgress_v2';
  let initialized = false;
  let lastFocused = null;
  let activeSection = 'start';

  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  function readProgress() {
    try {
      const value = JSON.parse(localStorage.getItem(progressKey) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  function saveProgress(value) {
    try { localStorage.setItem(progressKey, JSON.stringify(value)); } catch { /* Stockage facultatif. */ }
  }

  function updateProgress(section) {
    const inputs = [...document.querySelectorAll(`[data-freev-help-step^="${section}-"]`)];
    const completed = inputs.filter(input => input.checked).length;
    const percent = inputs.length ? Math.round((completed / inputs.length) * 100) : 0;
    const bar = document.querySelector(`[data-freev-help-progress="${section}"]`);
    const label = document.querySelector(`[data-freev-help-progress-label="${section}"]`);
    if (bar) {
      bar.setAttribute('aria-valuenow', String(percent));
      bar.querySelector('span')?.style.setProperty('width', `${percent}%`);
    }
    if (label) label.textContent = `${completed}/${inputs.length} terminée${completed > 1 ? 's' : ''}`;
  }

  function restoreProgress() {
    const stored = readProgress();
    document.querySelectorAll('[data-freev-help-step]').forEach(input => {
      input.checked = Boolean(stored[input.dataset.freevHelpStep]);
    });
    sections.forEach(updateProgress);
  }

  function setSection(section, focusTab = false) {
    const selected = sections.includes(section) ? section : 'start';
    activeSection = selected;
    document.querySelectorAll('[data-freev-help-tab]').forEach(tab => {
      const active = tab.dataset.freevHelpTab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focusTab) tab.focus();
    });
    document.querySelectorAll('[data-freev-help-panel]').forEach(panel => {
      panel.hidden = panel.dataset.freevHelpPanel !== selected;
    });
    document.querySelector('.freev-help-content')?.scrollTo({ top: 0, behavior: 'auto' });
    clearSearch(false);
    const search = byId('freevHelpSearch');
    if (search) {
      const placeholders = {
        start: 'Rechercher : solde, opération, budget, paiement régulier…',
        planner: 'Rechercher : imprévu, objectif, budget, confiance…',
        smart: 'Rechercher : règle, CSV, abonnement, doublon…'
      };
      search.placeholder = placeholders[selected];
    }
  }

  function open(section = 'start') {
    const overlay = byId('freevHelpOverlay');
    if (!overlay) return;
    lastFocused = document.activeElement;
    restoreProgress();
    setSection(section);
    overlay.hidden = false;
    document.body.classList.add('v4-modal-open');
    requestAnimationFrame(() => byId('freevHelpSearch')?.focus());
  }

  function close() {
    const overlay = byId('freevHelpOverlay');
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    document.body.classList.remove('v4-modal-open');
    clearSearch(false);
    if (lastFocused instanceof HTMLElement) lastFocused.focus();
    lastFocused = null;
  }

  function clearSearch(focus = true) {
    const input = byId('freevHelpSearch');
    if (!input) return;
    input.value = '';
    document.querySelectorAll('[data-freev-help-search]').forEach(item => { item.hidden = false; });
    document.querySelectorAll('[data-freev-help-group]').forEach(group => { group.hidden = false; });
    document.querySelectorAll('.freev-help-jumps').forEach(jumps => { jumps.hidden = false; });
    byId('freevHelpNoResults').hidden = true;
    byId('freevHelpSearchClear').hidden = true;
    byId('freevHelpSearchStatus').textContent = 'Toutes les aides sont affichées.';
    if (focus) input.focus();
  }

  function searchHelp(query) {
    const value = normalize(query);
    const panel = document.querySelector(`[data-freev-help-panel="${activeSection}"]`);
    if (!panel) return;
    if (!value) {
      clearSearch(false);
      return;
    }

    let matches = 0;
    panel.querySelectorAll('[data-freev-help-search]').forEach(item => {
      const visible = normalize(item.textContent).includes(value);
      item.hidden = !visible;
      if (visible) {
        matches += 1;
        if (item.tagName === 'DETAILS') item.open = true;
      }
    });
    panel.querySelectorAll('[data-freev-help-group]').forEach(group => {
      group.hidden = !group.querySelector('[data-freev-help-search]:not([hidden])');
    });
    panel.querySelectorAll('.freev-help-jumps').forEach(jumps => { jumps.hidden = true; });
    byId('freevHelpNoResults').hidden = matches > 0;
    byId('freevHelpSearchClear').hidden = false;
    byId('freevHelpSearchStatus').textContent = matches
      ? `${matches} résultat${matches > 1 ? 's' : ''} dans ${sectionNames[activeSection]}.`
      : 'Aucun résultat dans cette rubrique.';
  }

  function runStartAction(button) {
    const action = button.dataset.freevHelpStartAction;
    close();
    if (action === 'capital') {
      window.toggleCapitalModal?.();
      requestAnimationFrame(() => byId('capitalAmount')?.focus());
    }
    else if (action === 'transaction') window.openModal?.();
    else if (action === 'recurring') window.switchView?.('recurring');
    else if (action === 'budget') {
      window.toggleBudgetModal?.();
      requestAnimationFrame(() => byId('budgetAmount')?.focus());
    }
  }

  function goTo(button) {
    const view = button.dataset.freevHelpView === 'smart' ? 'smart' : 'planner';
    const smartTab = button.dataset.freevHelpSmartTab || 'overview';
    const anchor = button.dataset.freevHelpAnchor;
    close();
    window.switchView?.(view);
    if (view === 'smart') window.FreevV5?.setActiveTab?.(smartTab);
    window.setTimeout(() => {
      const target = anchor ? byId(anchor) : null;
      if (!target) return;
      target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      if (!target.matches('input, button, select, textarea, [tabindex]')) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }, 80);
  }

  function jumpTo(button) {
    const target = byId(button.dataset.freevHelpJump);
    if (!target) return;
    target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }

  function updateStep(input) {
    const stored = readProgress();
    stored[input.dataset.freevHelpStep] = input.checked;
    saveProgress(stored);
    updateProgress(input.dataset.freevHelpStep.split('-')[0]);
  }

  function resetProgress(section) {
    const stored = readProgress();
    document.querySelectorAll(`[data-freev-help-step^="${section}-"]`).forEach(input => {
      input.checked = false;
      delete stored[input.dataset.freevHelpStep];
    });
    saveProgress(stored);
    updateProgress(section);
  }

  function trapFocus(event, dialog) {
    const focusable = [...dialog.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), details > summary, [tabindex]:not([tabindex="-1"])')]
      .filter(element => !element.closest('[hidden]'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function bind() {
    if (initialized) return;
    const overlay = byId('freevHelpOverlay');
    if (!overlay) return;
    initialized = true;
    restoreProgress();

    overlay.addEventListener('click', event => {
      const tab = event.target.closest('[data-freev-help-tab]');
      const view = event.target.closest('[data-freev-help-view]');
      const jump = event.target.closest('[data-freev-help-jump]');
      const startAction = event.target.closest('[data-freev-help-start-action]');
      const reset = event.target.closest('[data-freev-help-progress-reset]');
      if (startAction) { runStartAction(startAction); return; }
      if (event.target === overlay || event.target.closest('[data-freev-help-close]')) close();
      if (event.target.closest('[data-freev-help-search-clear]')) clearSearch();
      if (tab) setSection(tab.dataset.freevHelpTab);
      if (view) goTo(view);
      if (jump) jumpTo(jump);
      if (reset) resetProgress(reset.dataset.freevHelpProgressReset);
    });

    byId('freevHelpSearch')?.addEventListener('input', event => searchHelp(event.currentTarget.value));
    overlay.addEventListener('change', event => {
      if (event.target.matches('[data-freev-help-step]')) updateStep(event.target);
    });

    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (byId('freevHelpSearch')?.value) clearSearch();
        else close();
        return;
      }
      const tab = event.target.closest('[data-freev-help-tab]');
      if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const current = sections.indexOf(tab.dataset.freevHelpTab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + sections.length) % sections.length;
        setSection(sections[next], true);
        return;
      }
      if (event.key === 'Tab') trapFocus(event, overlay.querySelector('[data-freev-help-dialog]'));
    });
  }

  window.FreevHelp = { open, close, setSection, clearSearch, goTo };
  document.addEventListener('DOMContentLoaded', bind, { once: true });
})();
