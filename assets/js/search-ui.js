// FREEV Gestion — affichage de la recherche unique (REC 01 à REC 03). Construction DOM sans innerHTML :
// libellés et noms de comptes saisis par l'utilisateur ne sont jamais interprétés comme du HTML.
import { parseQuery, executeSearch, findShortcuts, describeCriteria, removeFilter, setAmountRange, setMonth, setType, setScope } from './search-engine.mjs';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * @param {object} deps
 * @param {HTMLInputElement} deps.input
 * @param {HTMLElement} deps.container
 * @param {() => object} deps.getState état de l'application (comptes autorisés)
 * @param {(state:object) => object[]} deps.scopeAccounts périmètre courant
 * @param {(value:number, state:object) => string} deps.formatMoney
 * @param {(iso:string) => string} deps.formatDate
 * @param {(entry:object) => void} deps.onOpenEntry
 * @param {(destination:object) => void} deps.onNavigate
 */
export function createSearchPanel(deps) {
  const { input, container } = deps;
  let criteria = null;
  let query = '';
  let scope = 'current';

  const formatCents = cents => deps.formatMoney(cents / 100, deps.getState());
  const categoriesOf = accounts => [...new Set(accounts.flatMap(a => (a.transactions || []).map(t => t?.category)).filter(Boolean))];

  function parse() {
    const state = deps.getState();
    const accounts = state.accounts || [];
    criteria = parseQuery(query, { categories: categoriesOf(accounts) });
    criteria.scope = scope;
  }

  function apply(next) {
    criteria = next;
    scope = next.scope;
    render();
  }

  function chipsBar(chips) {
    const bar = el('div', 'v4-search-chips');
    bar.setAttribute('role', 'list');
    chips.forEach(chip => {
      const item = el('span', 'v4-search-chip');
      item.setAttribute('role', 'listitem');
      item.append(el('span', '', chip.label));
      const remove = el('button', 'v4-search-chip-remove', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Retirer le filtre : ${chip.label}`);
      remove.addEventListener('click', () => apply(removeFilter(criteria, chip.key)));
      item.append(remove);
      bar.append(item);
    });
    return bar;
  }

  function editors() {
    const row = el('div', 'v4-search-editors');
    const typeLabel = el('label', 'v4-search-editor');
    typeLabel.append(el('span', '', 'Type'));
    const select = el('select');
    [['', 'Tous'], ['expense', 'Dépenses'], ['income', 'Revenus']].forEach(([value, label]) => {
      const option = el('option', '', label);
      option.value = value;
      if ((criteria.type || '') === value) option.selected = true;
      select.append(option);
    });
    select.addEventListener('change', () => apply(setType(criteria, select.value)));
    typeLabel.append(select);
    row.append(typeLabel);

    const monthLabel = el('label', 'v4-search-editor');
    monthLabel.append(el('span', '', 'Mois'));
    const month = el('input');
    month.type = 'month';
    if (criteria.dateRange?.kind === 'month') month.value = criteria.dateRange.from.slice(0, 7);
    month.addEventListener('change', () => apply(month.value ? setMonth(criteria, month.value) : removeFilter(criteria, 'dateRange')));
    monthLabel.append(month);
    row.append(monthLabel);

    if (criteria.amount) {
      const toInput = cents => (cents === null || cents === undefined ? '' : (cents / 100).toFixed(2));
      const make = (text, value) => {
        const label = el('label', 'v4-search-editor');
        label.append(el('span', '', text));
        const field = el('input');
        field.type = 'number';
        field.min = '0';
        field.step = '0.01';
        field.inputMode = 'decimal';
        field.value = toInput(value);
        label.append(field);
        return { label, field };
      };
      const min = make('Montant min', criteria.amount.min);
      const max = make('Montant max', criteria.amount.max);
      const commit = () => {
        const read = field => (field.value === '' || !Number.isFinite(Number(field.value)) ? null : Math.round(Number(field.value) * 100));
        apply(setAmountRange(criteria, read(min.field), read(max.field)));
      };
      min.field.addEventListener('change', commit);
      max.field.addEventListener('change', commit);
      row.append(min.label, max.label);
    }
    return row;
  }

  function scopeBar(searchResult) {
    const state = deps.getState();
    const current = deps.scopeAccounts(state).map(a => a.name || 'Compte');
    const bar = el('div', 'v4-search-scope');
    const names = criteria.scope === 'all' ? 'tous mes comptes' : current.join(', ') || 'aucun compte';
    bar.append(el('span', '', `Périmètre : ${names}`));
    if (searchResult.hasMoreScope || criteria.scope === 'all') {
      const label = el('label', 'v4-search-scope-toggle');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = criteria.scope === 'all';
      box.addEventListener('change', () => apply(setScope(criteria, box.checked ? 'all' : 'current')));
      label.append(box, el('span', '', 'Élargir à tous mes comptes'));
      bar.append(label);
    }
    return bar;
  }

  function shortcutList(shortcuts) {
    const section = el('section', 'v4-search-section');
    section.append(el('h3', 'v4-search-heading', 'Aller à'));
    shortcuts.forEach(dest => {
      const button = el('button', 'v4-search-result v4-search-shortcut');
      button.type = 'button';
      const icon = el('span', 'v4-search-result-icon');
      icon.append(Object.assign(document.createElement('i'), { className: 'fa-solid fa-arrow-right' }));
      const text = el('span');
      text.append(el('strong', '', dest.label), el('small', '', dest.path));
      button.append(icon, text);
      button.addEventListener('click', () => deps.onNavigate(dest));
      section.append(button);
    });
    return section;
  }

  function resultRow(entry) {
    const button = el('button', 'v4-search-result');
    button.type = 'button';
    button.dataset.accountId = entry.accountId;
    const icon = el('span', 'v4-search-result-icon');
    icon.append(Object.assign(document.createElement('i'), { className: `fa-solid fa-${entry.type === 'income' ? 'arrow-up' : 'arrow-down'}` }));
    const text = el('span');
    text.append(el('strong', '', entry.tx.desc || entry.tx.category || 'Opération'));
    text.append(el('small', '', `${entry.accountName} · ${deps.formatDate(entry.date)} · ${entry.tx.category || 'Autre'}`));
    const statuses = [entry.planned ? 'À payer' : 'Payée'];
    if (!entry.planned) statuses.push(entry.reconciled ? 'Pointée' : 'Non pointée');
    text.append(el('small', 'v4-search-status', statuses.join(' · ')));
    if (entry.change) {
      const { previous, current, delta } = entry.change;
      text.append(el('small', 'v4-search-explain', `${delta > 0 ? 'Hausse' : 'Baisse'} de ${formatCents(Math.abs(delta))} : ${formatCents(previous.cents)} le ${deps.formatDate(previous.date)} → ${formatCents(current.cents)} le ${deps.formatDate(current.date)}`));
    }
    (entry.notes || []).forEach(note => text.append(el('small', 'v4-search-explain', note)));
    const amount = el('b', entry.type === 'income' ? 'positive-text' : 'negative-text', entry.cents === null ? 'Montant invalide' : `${entry.type === 'income' ? '+' : '−'}${formatCents(entry.cents)}`);
    button.append(icon, text, amount);
    button.addEventListener('click', () => deps.onOpenEntry(entry));
    return button;
  }

  function render() {
    container.replaceChildren();
    if (query.trim().length < 2) {
      container.append(el('p', 'v4-empty', 'Saisissez au moins deux caractères. Exemples : « courses du mois dernier au-dessus de 50 € », « où exporter mes opérations ».'));
      return;
    }
    const nav = findShortcuts(query);
    if (nav.intent === 'navigation') {
      container.append(shortcutList(nav.shortcuts));
      container.append(el('p', 'v4-search-note', 'Ce raccourci ouvre l’écran concerné sans lancer aucune action.'));
      return;
    }
    const state = deps.getState();
    const result = executeSearch({ currentAccounts: deps.scopeAccounts(state), allAccounts: state.accounts, criteria, formatCents });

    container.append(scopeBar(result));
    const chips = describeCriteria(criteria, { formatCents });
    if (chips.length) {
      container.append(el('p', 'v4-search-label', 'Compris :'), chipsBar(chips), editors());
    }
    (criteria.notes || []).forEach(note => container.append(el('p', 'v4-search-note', note)));
    if (nav.shortcuts.length) container.append(shortcutList(nav.shortcuts));

    const status = el('p', 'v4-search-count');
    status.setAttribute('aria-live', 'polite');
    if (!result.results.length) {
      status.textContent = 'Aucun résultat exact.';
      container.append(status);
      if (result.suggestions.length) {
        const box = el('section', 'v4-search-section');
        box.append(el('h3', 'v4-search-heading', 'Élargir la recherche ?'));
        result.suggestions.forEach(s => {
          const button = el('button', 'btn btn-secondary btn-sm v4-search-suggestion', s.label);
          button.type = 'button';
          button.addEventListener('click', () => apply(s.criteria));
          box.append(button);
        });
        container.append(box);
      }
      return;
    }
    status.textContent = result.truncated ? `${result.total} résultats, les ${result.results.length} premiers sont affichés.` : `${result.total} résultat${result.total > 1 ? 's' : ''}.`;
    container.append(status, ...result.results.map(resultRow));
  }

  return {
    /** Appelé à chaque saisie : la demande est ré-interprétée. */
    update() { query = input.value; if (query.trim().length >= 2) parse(); render(); },
    reset() { query = ''; criteria = null; scope = 'current'; render(); }
  };
}
