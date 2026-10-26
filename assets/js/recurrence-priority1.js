// FREEV Gestion — Calendrier / simulation / historique métier des récurrences.
// La sélection visuelle est volontairement éphémère; seuls les snapshots de la
// règle et de ses échéances sont persistés par saveData().
let recurringCalendarRuleId = '';
let recurringCalendarYear = getToday().getFullYear();
let recurringCalendarMonth = isoMonth(getToday());

function recurringCalendarLabel(monthISO) {
  return new Date(`${monthISO}-01T12:00:00`).toLocaleDateString('fr-FR', { month: 'long' });
}
function recurringStoredPeriods(rule) {
  const periods = new Map();
  for (const tx of transactions) {
    if (String(tx.parentId || '') !== String(rule.id)) continue;
    const key = String(tx.periodKey || (tx.date ? periodKey(tx.date, rule.frequency) : ''));
    if (!periods.has(key)) periods.set(key, []);
    periods.get(key).push(tx);
  }
  return periods;
}
function recurringPeriodEntries(rule, month, storedPeriods = null) {
  const scheduled = recurringDatesForMonth(rule, month);
  return scheduled.map(date => {
    const key = periodKey(date, rule.frequency);
    const matches = storedPeriods ? (storedPeriods.get(key) || []) : transactions.filter(tx => String(tx.parentId || '') === String(rule.id) &&
      String(tx.periodKey || (tx.date ? periodKey(tx.date, rule.frequency) : '')) === key);
    const saved = matches[0] || null;
    const skipped = isRecurringPeriodSkipped(rule, key);
    const past = month < isoMonth(getToday());
    return {
      key, date, saved, skipped, duplicate: matches.length > 1, past,
      amount: skipped ? 0 : Number(saved?.amountBase ?? saved?.amount ?? getRecurringRateForDate(rule, date).amountBase) || 0,
      status: skipped ? 'Ignorée' : matches.length > 1 ? 'Doublon à vérifier' :
        saved?._manuallyEdited ? 'Personnalisée' : saved ? 'Enregistrée' :
          past ? 'Historique absent' : 'Prévue'
    };
  });
}
function showRecurringCalendarRule(id) {
  const rule = recurringTransactions.find(item => String(item.id) === String(id));
  if (!rule) return;
  recurringCalendarRuleId = String(id);
  recurringCalendarYear = getToday().getFullYear();
  recurringCalendarMonth = isoMonth(getToday());
  const panel = document.getElementById('recurringCalendarPanel');
  if (panel) panel.hidden = false;
  renderRecurringCalendar();
  panel?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
}
function renderRecurringCalendar() {
  const panel = document.getElementById('recurringCalendarPanel');
  if (!panel) return;
  let rule = recurringTransactions.find(item => String(item.id) === String(recurringCalendarRuleId));
  if (!rule) {
    rule = recurringTransactions[0];
    recurringCalendarRuleId = rule ? String(rule.id) : '';
  }
  if (!rule) { panel.replaceChildren(); return; }
  const currentMonth = isoMonth(getToday());
  const storedPeriods = recurringStoredPeriods(rule);
  const months = Array.from({ length: 12 }, (_, i) => `${recurringCalendarYear}-${String(i + 1).padStart(2, '0')}`);
  const currency = value => escapeHTML(formatCurrency(Number(value) || 0));
  const content = months.map(month => {
    const entries = recurringPeriodEntries(rule, month, storedPeriods);
    const actual = entries.filter(e => !!e.saved).length;
    const custom = entries.filter(e => !!e.saved?._manuallyEdited).length;
    const skipped = entries.filter(e => e.skipped).length;
    const total = entries.filter(e => !e.skipped && (!e.past || !!e.saved)).reduce((a, e) => a + e.amount, 0);
    const state = !entries.length ? '—' : skipped === entries.length ? 'En pause' :
      custom ? 'Personnalisé' : entries.some(e => e.duplicate) ? 'À vérifier' :
        month < currentMonth && actual < entries.length ? 'À compléter' :
          month < currentMonth ? 'Passé' : 'À venir';
    const chosen = recurringCalendarMonth === month;
    return `<button type="button" class="rec-month ${chosen ? 'is-selected' : ''} ${month < currentMonth ? 'is-past' : ''}" data-month="${escapeHTML(month)}" aria-pressed="${chosen}">
        <span class="rec-month-name">${escapeHTML(recurringCalendarLabel(month))}</span>
        <strong>${entries.length ? currency(total) : '—'}</strong>
        <small>${escapeHTML(state)}${entries.length > 1 ? ` · ${entries.length} dates` : ''}</small>
      </button>`;
  }).join('');
  const activeMonth = months.includes(recurringCalendarMonth) ? recurringCalendarMonth : months[0];
  recurringCalendarMonth = activeMonth;
  const entries = recurringPeriodEntries(rule, activeMonth, storedPeriods);
  const details = entries.length ? entries.map(entry => {
    const editingDisabled = entry.skipped || entry.duplicate || (entry.past && !entry.saved);
    const safeDate = escapeHTML(entry.saved?.date || entry.date);
    return `<div class="rec-month-detail">
      <div><strong>${safeDate}</strong><span>${currency(entry.amount)} · ${escapeHTML(entry.status)}${entry.past ? ' · 🔒 mois clos' : ''}</span></div>
      <button type="button" class="btn btn-sm btn-secondary js-rec-period-edit" data-key="${escapeHTML(entry.key)}" ${editingDisabled ? 'disabled' : ''}>Modifier cette date</button>
    </div>`;
  }).join('') : '<p class="rec-empty-hint">Aucun paiement prévu ce mois avec ce rythme.</p>';
  const history = (Array.isArray(rule.recurrenceHistory) ? rule.recurrenceHistory : []).slice(0, 20);
  const historyHtml = history.length ? history.map(entry => {
    const targetDate = entry.after?.date || entry.afterRule?.startDate || entry.at;
    const title = entry.kind === 'single' ? 'Une date modifiée' :
      entry.kind === 'historical' ? 'Modifications passées' : 'À partir de maintenant';
    const amountBefore = entry.before?.amountBase ?? entry.beforeRule?.amountBase;
    const amountAfter = entry.after?.amountBase ?? entry.afterRule?.amountBase;
    const amountLabel = amountBefore !== undefined && amountAfter !== undefined
      ? ` · ${currency(amountBefore)} → ${currency(amountAfter)}` : '';
    const canRestore = !entry.restoredAt;
    return `<div class="rec-history-entry"><div><strong>${escapeHTML(title)}</strong> <span>${escapeHTML(new Date(entry.at).toLocaleString('fr-FR'))}${entry.period ? ` · ${escapeHTML(entry.period)}` : ''}${amountLabel}</span>${entry.restoredAt ? '<small>Restauration déjà effectuée</small>' : ''}</div>${canRestore ? `<button type="button" class="btn btn-sm btn-secondary js-rec-revision-restore" data-revision="${escapeHTML(String(entry.id))}">Restaurer</button>` : ''}</div>`;
  }).join('') : '<p class="rec-empty-hint">Aucune modification détaillée enregistrée depuis cette mise à jour. Les anciennes opérations sont conservées, mais leur historique antérieur ne peut pas être reconstitué.</p>';

  panel.innerHTML = `<div class="rec-calendar-head"><div><span class="rec-eyebrow">CALENDRIER DES PAIEMENTS</span><h3>${escapeHTML(rule.desc || rule.category || 'Opération régulière')}</h3><p>Les mois passés montrent les montants enregistrés. Les mois à venir sont estimés.</p></div><div class="rec-year-controls"><button type="button" class="btn btn-secondary btn-sm js-rec-prev" aria-label="Année précédente">‹</button><strong>${recurringCalendarYear}</strong><button type="button" class="btn btn-secondary btn-sm js-rec-next" aria-label="Année suivante">›</button><button type="button" class="btn btn-secondary btn-sm js-rec-close" aria-label="Fermer le calendrier">Fermer</button></div></div>
    <div class="rec-month-grid">${content}</div>
    <div class="rec-detail-card"><h4>${escapeHTML(recurringCalendarLabel(activeMonth))} ${recurringCalendarYear} — dates prévues</h4>${details}</div>
    <div class="rec-history-card"><h4>Historique des changements & restauration</h4>${historyHtml}</div>`;
  panel.querySelector('.js-rec-prev')?.addEventListener('click', () => {
    recurringCalendarYear -= 1; recurringCalendarMonth = `${recurringCalendarYear}-01`; renderRecurringCalendar();
  });
  panel.querySelector('.js-rec-next')?.addEventListener('click', () => {
    recurringCalendarYear += 1; recurringCalendarMonth = `${recurringCalendarYear}-01`; renderRecurringCalendar();
  });
  panel.querySelector('.js-rec-close')?.addEventListener('click', () => {
    panel.hidden = true;
    const trigger = Array.from(document.querySelectorAll('#recurringList .js-calendar-rule'))
      .find(button => button.dataset.id === recurringCalendarRuleId);
    trigger?.focus?.();
  });
  panel.querySelectorAll('.rec-month').forEach(button => button.addEventListener('click', () => {
    recurringCalendarMonth = button.dataset.month;
    renderRecurringCalendar();
  }));
  panel.querySelectorAll('.js-rec-period-edit').forEach(button => button.addEventListener('click', () => {
    const chosenRule = recurringTransactions.find(item => String(item.id) === String(recurringCalendarRuleId));
    if (!chosenRule) return;
    const month = recurringCalendarMonth;
    const entry = recurringPeriodEntries(chosenRule, month).find(item => item.key === button.dataset.key);
    if (!entry || entry.skipped || entry.duplicate || (entry.past && !entry.saved)) return;
    const occurrence = entry.saved || buildRecurringOccurrence(chosenRule, entry.date, {
      id: `__projected_current_${chosenRule.id}_${entry.key}`, projected: true
    });
    openRecurringRuleModal(chosenRule, occurrence);
  }));
  panel.querySelectorAll('.js-rec-revision-restore').forEach(button => button.addEventListener('click', () => {
    restoreRecurringRevision(String(rule.id), button.dataset.revision);
  }));
}

// Aperçu en lecture seule ; ne génère aucune opération, n'altère aucun solde.
function recurringImpactModel(rule, scope, key, amount, date) {
  if (!rule) return { affected: [], protected: [], description: '' };
  const current = isoMonth(getToday());
  const month = String(date || '').slice(0, 7);
  const effectiveScope = scope === 'single' ? 'single' : scope === 'history' ? 'history' : 'future';
  // Une exception archivée doit être visible dans l'aperçu même si elle date de plusieurs années.
  const anchor = effectiveScope === 'single' && /^\d{4}-\d{2}$/.test(month) ? month : current;
  const affected = [];
  const protectedMonths = [];
  const storedPeriods = recurringStoredPeriods(rule);
  for (let i = -3; i <= 8; i++) {
    const cursor = new Date(`${anchor}-01T12:00:00`);
    cursor.setMonth(cursor.getMonth() + i);
    const target = isoMonth(cursor);
    const entries = recurringPeriodEntries(rule, target, storedPeriods);
    if (!entries.length) continue;
    const matching = effectiveScope === 'single' ? entries.filter(entry => entry.key === key) :
      effectiveScope === 'history' ? entries.filter(entry => !entry.skipped && (!entry.past || !!entry.saved)) :
        entries.filter(entry => target >= current && entry.date > isoDate(getToday()) && !entry.skipped && !entry.saved?._manuallyEdited);
    const baseline = entries.filter(entry => !entry.skipped && (!entry.past || !!entry.saved))
      .reduce((sum, entry) => sum + entry.amount, 0);
    const newTotal = baseline - matching.reduce((sum, entry) => sum + entry.amount, 0) + matching.length * (Number.isFinite(amount) && amount > 0 ? amount : 0);
    (matching.length ? affected : protectedMonths).push({ month: target, count: matching.length, before: baseline, after: newTotal });
  }
  return {
    affected, protected: protectedMonths, description: effectiveScope === 'single'
      ? 'Une seule date est modifiée. Les autres restent inchangées.'
      : effectiveScope === 'future' ? 'Les prochaines dates changent. Les dates passées et personnalisées restent inchangées.'
        : 'Attention : les dates passées seront aussi modifiées. Deux confirmations sont nécessaires.'
  };
}
function updateRecurringImpactPreview() {
  const node = document.getElementById('recurringImpactPreview');
  if (!node) return;
  const id = document.getElementById('editId')?.value || '';
  if (!id.startsWith('__rule__')) return;
  const rule = recurringTransactions.find(item => String(item.id) === id.slice(8));
  if (!rule) return;
  const scope = getRecurringDateScope();
  const date = document.getElementById('transDate')?.value || '';
  const amt = Number(document.getElementById('transAmount')?.value);
  const key = document.getElementById('editOccurrencePeriodKey')?.value || '';
  const preview = recurringImpactModel(rule, scope, key, amt, date);
  node.replaceChildren();
  const heading = document.createElement('strong');
  heading.textContent = `Aperçu avant validation · ${Number.isFinite(amt) && amt > 0 ? formatCurrency(amt) : 'montant invalide'}`;
  const summary = document.createElement('p');
  summary.textContent = preview.description;
  const impacted = document.createElement('p');
  impacted.textContent = `Estimation sur 12 mois : ${preview.affected.map(item => `${item.month} : ${formatCurrency(item.before)} → ${formatCurrency(item.after)}`).join(' · ') || 'aucune date concernée'} · ${preview.protected.length} mois inchangés.`;
  node.append(heading, summary, impacted);
}
function wireRecurringImpactPreview() {
  const modal = document.getElementById('transactionModal');
  if (!modal) return;
  if (!modal.dataset.recurringPreviewBound) {
    modal.dataset.recurringPreviewBound = '1';
    modal.addEventListener('input', updateRecurringImpactPreview);
    modal.addEventListener('change', updateRecurringImpactPreview);
  }
  updateRecurringImpactPreview();
}
