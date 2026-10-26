// FREEV Gestion — présentation des six espaces : état actif du menu et onglets internes.
// Aucune écriture financière : ce module ne lit ni ne modifie les opérations.
import { SPACES, spaceOfView, tabsForView, mobileTabFor } from './spaces-model.mjs';

function buildTabs(view) {
  const tabs = tabsForView(view);
  if (!tabs.length) return null;
  const space = spaceOfView(view);
  const bar = document.createElement('div');
  bar.className = 'space-tabs';
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', space.label);
  bar.dataset.spaceTabs = space.id;
  tabs.forEach(item => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'space-tab';
    button.setAttribute('role', 'tab');
    button.dataset.spaceView = item.view;
    button.textContent = item.label;
    button.addEventListener('click', () => {
      window.switchView?.(item.view);
      // La vue d'origine est masquée : le focus clavier suit l'onglet équivalent de la nouvelle vue.
      document.querySelector(`#${item.view}-view > .space-tabs [data-space-view="${item.view}"]`)?.focus();
    });
    bar.appendChild(button);
  });
  bar.addEventListener('keydown', event => {
    const keys = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' };
    if (!(event.key in keys)) return;
    const buttons = [...bar.querySelectorAll('[role="tab"]')];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    const step = keys[event.key];
    const next = step === 'first' ? 0 : step === 'last' ? buttons.length - 1 : (index + step + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next].click();
  });
  return bar;
}

function ensureTabs(view) {
  const container = document.getElementById(`${view}-view`);
  if (!container) return;
  if (!container.querySelector(':scope > .space-tabs')) {
    const bar = buildTabs(view);
    if (bar) container.insertBefore(bar, container.firstChild);
  }
}

export function sync(view) {
  const space = spaceOfView(view);
  if (!space) return false;
  document.querySelectorAll('#sidebarNav .nav-item[data-space]').forEach(item => {
    const current = item.dataset.space === space.id;
    item.classList.toggle('active', current);
    if (current) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  tabsForView(view).forEach(() => ensureTabs(view));
  document.querySelectorAll(`#${view}-view > .space-tabs .space-tab`).forEach(tab => {
    const selected = tab.dataset.spaceView === view;
    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
    tab.tabIndex = selected ? 0 : -1;
    tab.classList.toggle('active', selected);
  });
  document.body.dataset.freevSpace = space.id;
  const mobile = mobileTabFor(view);
  document.querySelectorAll('.bottom-nav-item').forEach(item => {
    const current = item.id === `bnav-${mobile}`;
    item.classList.toggle('active', current);
    if (current) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  return true;
}

window.FreevSpaces = Object.freeze({ sync, spaces: SPACES, spaceOf: view => spaceOfView(view)?.id || null, mobileTab: mobileTabFor });
const start = () => sync(typeof currentView === 'string' ? currentView : 'dashboard');
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
