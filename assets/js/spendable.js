// FREEV Gestion — bloc « Ce que je peux encore dépenser » (QUO 01, QUO 02). Lecture seule hors réglages explicites.
import { buildSpendable } from './spendable-engine.mjs';
import { formatMinor, parseAmount } from './finance-core.mjs';

const $ = id => document.getElementById(id);
const state = () => window._getAppState?.() || { accounts: [], currentAccountId: null, multiViewMode: 'individual', selectedGroupIds: new Set() };

function scopeAccounts(appState) {
  const current = appState.accounts.find(a => a.id === appState.currentAccountId) || appState.accounts[0] || null;
  if (appState.multiViewMode === 'global') return appState.accounts;
  if (appState.multiViewMode === 'group') {
    const ids = appState.selectedGroupIds instanceof Set ? appState.selectedGroupIds : new Set(appState.selectedGroupIds || []);
    const group = appState.accounts.filter(a => ids.has(a.id));
    if (group.length) return group;
  }
  return current ? [current] : [];
}

const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const dateFr = iso => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

const KIND_LABEL = { overdue: 'En retard', recurring: 'Récurrence attendue', planned: 'Planifié', scheduled: 'À venir' };

function renderDetail(result, money) {
  const root = $('spendableDetail');
  if (!root) return;
  const rows = [
    ['Trésorerie réglée aujourd’hui', money(result.breakdown.cash)],
    ['Paiements restant à débiter', `− ${money(result.breakdown.due)}`],
    ['Réserve choisie', result.missing.includes('reserve') ? 'non définie' : `− ${money(result.breakdown.reserve)}`],
    ['Résultat', money(result.raw)]
  ];
  const table = el('dl', 'spendable-lines');
  rows.forEach(([label, value]) => { table.append(el('dt', '', label), el('dd', '', value)); });
  root.replaceChildren(table);
  const explanation = el('p', 'spendable-note', 'Ce calcul part du solde déjà enregistré, retire les paiements prévus jusqu’à la date affichée, puis la réserve choisie. Les revenus futurs ne sont pas ajoutés : le résultat reste prudent.');
  root.append(explanation);
  if (result.nextIncome && result.periodSource === 'next-income') {
    root.append(el('p', 'spendable-note', `Le prochain revenu prévu (${money(result.nextIncome.amount)} le ${dateFr(result.nextIncome.date)}) fixe la fin de cette période ; il n’est pas compté dans le montant disponible.`));
  }
  if (result.due.length) {
    const list = el('ul', 'spendable-due');
    result.due.slice(0, 25).forEach(item => {
      const li = el('li');
      li.append(el('span', '', `${dateFr(item.date)} · ${item.label}`), el('small', '', `${KIND_LABEL[item.kind] || ''} · ${item.account}`), el('strong', '', money(item.amount)));
      list.append(li);
    });
    root.append(el('h3', '', 'Paiements pris en compte'), list);
    if (result.due.length > 25) root.append(el('p', 'spendable-note', `${result.due.length - 25} autre(s) paiement(s) non affiché(s) ; le total les inclut.`));
  }
  result.limits.forEach(text => root.append(el('p', 'spendable-note', text)));
}

export function render() {
  const body = $('spendableBody');
  if (!body) return;
  const appState = state();
  const result = buildSpendable(scopeAccounts(appState));
  const scope = $('spendableScope');
  if (!result.ok) {
    if (scope) scope.textContent = '';
    const message = result.reason === 'mixed-currency'
      ? `Total indisponible : les comptes sélectionnés utilisent des devises différentes (${result.currencies.join(', ')}) et aucun taux valable n’est appliqué.`
      : result.reason === 'no-account' ? 'Aucun compte à analyser.' : 'Le calcul n’a pas pu être établi : une donnée est invalide.';
    body.replaceChildren(el('p', 'spendable-note', message));
    $('spendableDetail')?.replaceChildren();
    return;
  }
  const money = value => formatMinor(value, result.currency);
  if (scope) scope.textContent = `Jusqu’au ${dateFr(result.periodEnd)} · ${result.scopeNames.join(', ')}`;
  const main = el('div', `spendable-main ${result.status}`);
  if (result.status === 'shortfall') {
    main.append(el('strong', 'spendable-amount', `${money(0)} libre`), el('p', 'spendable-alert', `Il manque ${money(result.shortfall)} pour couvrir les paiements prévus et votre réserve d’ici le ${dateFr(result.periodEnd)}.`));
  } else {
    main.append(el('strong', 'spendable-amount', money(result.free)), el('p', 'spendable-sub', result.status === 'none-left' ? `Tout le solde est réservé aux paiements prévus jusqu’au ${dateFr(result.periodEnd)}.` : `Vous pouvez encore utiliser ce montant jusqu’au ${dateFr(result.periodEnd)}, après les paiements prévus et la réserve.`));
  }
  const formula = el('div', 'spendable-formula');
  const formulaParts = [
    ['Solde enregistré', money(result.breakdown.cash)],
    ['Paiements prévus', `− ${money(result.breakdown.due)}`],
    ['Réserve', `− ${money(result.breakdown.reserve)}`]
  ];
  formulaParts.forEach(([label, value]) => {
    const part = el('span', 'spendable-formula-part');
    part.append(el('small', '', label), el('strong', '', value));
    formula.append(part);
  });
  main.append(formula);
  const notes = el('ul', 'spendable-notes');
  if (result.periodSource === 'month-end') notes.append(el('li', '', 'Aucun revenu futur n’est renseigné : la période va jusqu’à la fin du mois. Vous pouvez choisir une autre date dans le détail.'));
  if (result.periodSource === 'chosen') notes.append(el('li', '', 'Date de fin choisie par vous.'));
  if (result.missing.includes('reserve')) notes.append(el('li', '', 'Aucune réserve définie : aucun montant n’est mis de côté dans ce calcul.'));
  if (result.duplicatesIgnored) notes.append(el('li', '', `${result.duplicatesIgnored} doublon(s) d’échéance ignoré(s).`));
  body.replaceChildren(main, ...(notes.children.length ? [notes] : []));
  renderDetail(result, money);
  const current = appState.accounts.find(a => a.id === appState.currentAccountId) || appState.accounts[0];
  const reserveInput = $('spendableReserve'), endInput = $('spendablePeriodEnd');
  if (reserveInput && document.activeElement !== reserveInput) {
    const stored = current?.plannerSettings?.spendReserve;
    reserveInput.value = stored === undefined || stored === null ? '' : String(stored).replace('.', ',');
  }
  if (endInput && document.activeElement !== endInput) endInput.value = current?.plannerSettings?.spendPeriodEnd || '';
}

function save(event) {
  event.preventDefault();
  const error = $('spendableFormError');
  const showError = message => { if (error) { error.textContent = message; error.hidden = !message; } };
  showError('');
  const appState = state();
  const current = appState.accounts.find(a => a.id === appState.currentAccountId) || appState.accounts[0];
  if (!current) return;
  const raw = $('spendableReserve').value.trim();
  let reserve = null;
  if (raw !== '') {
    const parsed = parseAmount(raw, current.settings?.baseCurrency || 'EUR', 'reserve');
    if (!parsed.ok || parsed.minor < 0) return showError('Réserve invalide : saisissez un montant positif, par exemple 200 ou 150,50. Rien n’a été enregistré.');
    reserve = parsed.minor / 100;
  }
  const end = $('spendablePeriodEnd').value;
  if (end && !/^\d{4}-\d{2}-\d{2}$/.test(end)) return showError('Date invalide. Rien n’a été enregistré.');
  window._mutateAccountData?.(current.id, account => {
    const next = { ...(account.plannerSettings || {}) };
    if (reserve === null) delete next.spendReserve; else next.spendReserve = reserve;
    if (end) next.spendPeriodEnd = end; else delete next.spendPeriodEnd;
    account.plannerSettings = next;
  });
  render();
}

window.FreevSpendable = Object.freeze({ render });
const init = () => { $('spendableForm')?.addEventListener('submit', save); render(); };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
