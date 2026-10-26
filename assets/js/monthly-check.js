// FREEV Gestion — écran « Vérification du mois » (QUO 07), dans le Centre intelligent.
// Les décisions (confirmer, ignorer, reporter, valider) sont enregistrées dans le compte actif (monthlyChecks).
import { buildMonthlyCheck, recordDecision, validateMonth, traceReopen, defaultMonth } from './monthly-check-engine.mjs';

const $ = id => document.getElementById(id);
const state = () => window._getAppState?.() || { accounts: [], currentAccountId: null };
const currentAccount = () => { const s = state(); return s.accounts.find(a => a.id === s.currentAccountId) || s.accounts[0] || null; };
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
const dateFr = iso => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const monthFr = month => new Date(`${month}-01T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
const EVENT_LABEL = { confirmed: 'Confirmé normal', ignored: 'Ignoré pour ce mois', postponed: 'Reporté', validated: 'Mois vérifié', reopened: 'Mois rouvert' };

let selectedMonth = null;
let bound = false;

function write(account, month, build) {
  window._mutateAccountData?.(account.id, acc => {
    acc.monthlyChecks = { ...(acc.monthlyChecks || {}), [month]: build(acc) };
  });
  render();
}

function itemCard(account, month, item, today) {
  const card = el('article', `mc-item mc-${item.kind}`);
  const head = el('div', 'mc-item-head');
  head.append(el('strong', '', item.title));
  if (item.reopened) head.append(el('span', 'mc-badge', 'Nouvelle donnée'));
  card.append(head, el('p', 'mc-cause', item.cause), el('p', 'mc-uncertainty', item.uncertaintyLabel));
  const actions = el('div', 'mc-actions');
  const add = (label, handler, cls = 'btn btn-secondary btn-sm') => { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', handler); actions.append(b); };
  add('Corriger', () => {
    window.switchView?.('transactions');
    if (item.refs[0] && !item.refs[0].startsWith('idx')) window.openModalById?.(item.refs[0]);
  }, 'btn btn-primary btn-sm');
  add('C’est normal', () => write(account, month, acc => recordDecision(acc, month, item, 'confirmed', { today })));
  add('Ignorer ce mois', () => write(account, month, acc => recordDecision(acc, month, item, 'ignored', { today })));
  add('Reporter 7 jours', () => write(account, month, acc => recordDecision(acc, month, item, 'postponed', { today })));
  card.append(actions);
  return card;
}

export function render() {
  const root = $('mcRoot');
  const account = currentAccount();
  if (!root || !account) return;
  const today = todayISO();
  if (!selectedMonth) selectedMonth = defaultMonth(today);
  const input = $('mcMonth');
  if (input && input.value !== selectedMonth) input.value = selectedMonth;
  const check = buildMonthlyCheck(account, selectedMonth, { today });
  if (!check.ok) {
    const message = check.reason === 'invalid-data'
      ? `Vérification suspendue : ${check.errors.length} donnée(s) sont à corriger avant d’analyser ce mois. ${check.errors.slice(0, 3).map(error => error.field).join(' · ')}`
      : check.reason === 'invalid-date' ? 'Vérification suspendue : la date de calcul est invalide.' : 'Choisissez un mois valide.';
    root.replaceChildren(el('p', 'v4-empty', message));
    return;
  }

  // Une opération modifiée après validation rouvre le mois ; la trace n'est écrite qu'une fois par état.
  if (check.status === 'reopened') {
    const rec = traceReopen(account, selectedMonth, { today });
    if (rec) { write(account, selectedMonth, () => rec); return; }
  }

  const parts = [];
  const status = el('p', `mc-status mc-status-${check.status}`);
  status.setAttribute('aria-live', 'polite');
  status.textContent = check.status === 'validated'
    ? `${monthFr(selectedMonth)} : vérifié par vous le ${dateFr(check.validatedAt)}. Ce n’est pas une certification comptable.`
    : check.status === 'reopened'
      ? `${monthFr(selectedMonth)} : une opération a été modifiée depuis votre validation, le mois est rouvert.`
      : check.items.length
        ? `${monthFr(selectedMonth)} : ${check.items.length} point${check.items.length > 1 ? 's' : ''} à regarder. Les ${check.counts.healthy} autres opérations ne demandent rien.`
        : `${monthFr(selectedMonth)} : rien à décider. ${check.counts.operations} opération(s) analysée(s).`;
  parts.push(status);
  check.items.forEach(item => parts.push(itemCard(account, selectedMonth, item, today)));

  if (check.status !== 'validated') {
    const validate = el('button', 'btn btn-primary mc-validate', check.items.length ? 'Marquer le mois comme vérifié malgré tout' : 'Marquer le mois comme vérifié');
    validate.type = 'button';
    validate.addEventListener('click', () => write(account, selectedMonth, acc => validateMonth(acc, selectedMonth, { today })));
    parts.push(validate);
  }
  if (check.hidden.length) {
    const details = el('details', 'mc-hidden');
    details.append(el('summary', '', `${check.hidden.length} proposition${check.hidden.length > 1 ? 's' : ''} déjà traitée${check.hidden.length > 1 ? 's' : ''}`));
    const list = el('ul');
    check.hidden.forEach(({ item, decision }) => list.append(el('li', '', `${item.title} — ${EVENT_LABEL[decision.action]} le ${dateFr(decision.at)}${decision.until ? `, revient le ${dateFr(decision.until)}` : ''}`)));
    details.append(list, el('p', 'mc-note', 'Elles réapparaissent seulement si une opération concernée change.'));
    parts.push(details);
  }
  if (check.log.length) {
    const log = el('details', 'mc-hidden');
    log.append(el('summary', '', 'Historique des actions'));
    const list = el('ul');
    check.log.slice(0, 8).forEach(entry => list.append(el('li', '', `${dateFr(entry.at)} · ${EVENT_LABEL[entry.event] || entry.event} : ${entry.title}`)));
    log.append(list);
    parts.push(log);
  }
  root.replaceChildren(...parts);
}

function bind() {
  if (bound) return;
  bound = true;
  $('mcMonth')?.addEventListener('change', event => { selectedMonth = event.currentTarget.value || null; render(); });
}

window.FreevMonthCheck = { render };
document.addEventListener('DOMContentLoaded', bind, { once: true });
