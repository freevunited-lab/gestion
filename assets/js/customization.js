// ============================================================
// ===== TAUX DE CHANGE EN TEMPS RÉEL (Frankfurter API) =======
// ============================================================

async function fetchExchangeRates() {
  const base = settings.baseCurrency || 'EUR';
  const statusEl = document.getElementById('ratesStatus');
  const displayEl = document.getElementById('ratesDisplay');
  if (statusEl) statusEl.textContent = 'Chargement...';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // timeout 5s
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(base)}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    settings.exchangeRates = data.rates;
    settings.ratesBase = base;
    settings.ratesUpdatedAt = new Date().toISOString();
    saveData();
    if (statusEl) statusEl.innerHTML = `<span style="color:#10b981;"><i class="fa-solid fa-check-circle"></i> Mis à jour le ${new Date().toLocaleString('fr-FR')}</span>`;
    if (displayEl) {
      const pairs = Object.entries(data.rates).slice(0, 8).map(([c, r]) => `1 ${base} = ${r.toFixed(4)} ${c}`).join(' · ');
      displayEl.textContent = pairs;
    }
    showToast('Taux de change mis à jour', 'success');
  } catch(e) {
    // Silencieux si hors-ligne ou timeout — juste mise à jour du statut dans les réglages
    console.info('fetchExchangeRates: hors-ligne ou API indisponible', e?.message || e);
    if (statusEl) statusEl.innerHTML = `<span style="color:#94a3b8;"><i class="fa-solid fa-wifi" style="text-decoration:line-through;"></i> Hors-ligne — taux non disponibles</span>`;
    // Pas de showToast ici : erreur silencieuse pour ne pas perturber l'utilisateur
  }
}

function convertToBase(amount, fromCurrency) {
  if (!fromCurrency || fromCurrency === (settings.baseCurrency || 'EUR')) return amount;
  const rates = settings.exchangeRates || {};
  const rate = rates[fromCurrency];
  if (!rate) return amount;
  return roundMoney(amount / rate);
}

function loadRatesUI() {
  const statusEl = document.getElementById('ratesStatus');
  const displayEl = document.getElementById('ratesDisplay');
  if (!statusEl) return;
  if (settings.ratesUpdatedAt) {
    statusEl.innerHTML = `<span style="color:#10b981;"><i class="fa-solid fa-check-circle"></i> ${new Date(settings.ratesUpdatedAt).toLocaleString('fr-FR')}</span>`;
    if (displayEl && settings.exchangeRates) {
      const base = settings.ratesBase || settings.baseCurrency || 'EUR';
      const pairs = Object.entries(settings.exchangeRates).slice(0, 8).map(([c, r]) => `1 ${base} = ${r.toFixed(4)} ${c}`).join(' · ');
      displayEl.textContent = pairs;
    }
  } else {
    statusEl.textContent = 'Non chargé';
  }
}

// ============================================================
// ===== CATÉGORIES PERSONNALISÉES ============================
// ============================================================

const DEFAULT_CATEGORIES = [
  { name: 'Alimentation', color: '#ef4444' },
  { name: 'Transport', color: '#f97316' },
  { name: 'Logement', color: '#eab308' },
  { name: 'Santé', color: '#22c55e' },
  { name: 'Loisirs', color: '#06b6d4' },
  { name: 'Shopping', color: '#8b5cf6' },
  { name: 'Factures', color: '#ec4899' },
  { name: 'Salaire', color: '#10b981' },
  { name: 'Freelance', color: '#3b82f6' },
  { name: 'Investissement', color: '#6366f1' },
  { name: 'Épargne', color: '#059669' },
  { name: 'Transfert épargne', color: '#0891b2' },
  { name: 'Transfert inter-comptes', color: '#7c3aed' },
  { name: 'Remboursement dette', color: '#dc2626' },
  { name: 'Autre', color: '#64748b' }
];

function safeCustomCategoryName(value) {
  const name = String(value || '').trim();
  return name && name.length <= 80 && !/[\u0000-\u001f\u007f]/.test(name) ? name : '';
}

function safeCustomCategoryColor(value) {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '#64748b';
}

function getAllCategories() {
  // FIX : utilise la variable globale (partagee entre tous les comptes)
  const custom = (customCategories || []).map(c => ({
    name: safeCustomCategoryName(c?.name),
    color: safeCustomCategoryColor(c?.color)
  })).filter(c => c.name);
  return [
    ...DEFAULT_CATEGORIES,
    ...custom.filter(c => !DEFAULT_CATEGORIES.find(d => d.name === c.name))
  ];
}

function getCategoryColor(name) {
  const all = getAllCategories();
  return safeCustomCategoryColor(all.find(c => c.name === name)?.color);
}

function populateCategorySelects() {
  const cats = getAllCategories();
  const optionsHtml = '<option value="">Sélectionner...</option>' + cats.map(c =>
    `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`
  ).join('');

  ['transCategory'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const current = el.value;
    el.innerHTML = optionsHtml;
    if (current) el.value = current;
  });

  // Also refresh category filter in transactions
  refreshCategoryFilter();
}

function renderCustomCategoriesList() {
  const container = document.getElementById('customCategoriesList');
  if (!container) return;
  const custom = customCategories || [];
  if (!custom.length) {
    container.innerHTML = '<span class="text-sm text-slate-400">Aucune catégorie personnalisée</span>';
    return;
  }
  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:0.5rem;width:100%;';
  custom.forEach(c => {
    const row = document.createElement('div');
    row.className = 'cat-row'; row.dataset.catname = c.name;
    row.style.cssText = `display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0.75rem;background:${c.color}11;border:1px solid ${c.color}44;border-radius:0.625rem;`;
    const dot = document.createElement('span');
    dot.style.cssText = `width:14px;height:14px;border-radius:50%;background:${c.color};flex-shrink:0;display:inline-block;`;
    const label = document.createElement('span');
    label.style.cssText = `font-size:0.82rem;font-weight:600;color:${c.color};flex:1;`; label.textContent = c.name;
    const edit = document.createElement('button');
    edit.type = 'button'; edit.title = 'Modifier';
    edit.style.cssText = `background:${c.color}22;border:1px solid ${c.color}44;border-radius:0.4rem;padding:0.2rem 0.5rem;cursor:pointer;font-size:0.72rem;color:${c.color};font-weight:600;`;
    edit.innerHTML = '<i class="fa-solid fa-pencil"></i>';
    edit.addEventListener('click', () => startEditCategory(c.name));
    const remove = document.createElement('button');
    remove.type = 'button'; remove.title = 'Supprimer';
    remove.style.cssText = 'background:none;border:none;cursor:pointer;color:#94a3b8;font-size:0.8rem;padding:0.2rem;';
    remove.textContent = '✕'; remove.addEventListener('click', () => removeCustomCategory(c.name));
    row.append(dot, label, edit, remove); list.appendChild(row);
  });
  container.replaceChildren(list);
}

function startEditCategory(name) {
  const c = customCategories.find(x => x.name === name);
  if (!c) return;
  // Reset tout formulaire ouvert avant d'en ouvrir un nouveau
  const container = document.getElementById('customCategoriesList');
  if (!container) return;
  renderCustomCategoriesList();

  const targetRow = [...container.querySelectorAll('.cat-row')].find(row => row.dataset.catname === name);
  if (!targetRow) return;
  targetRow.style.cssText = 'display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0.75rem;background:#f8fafc;border:2px solid #3b82f6;border-radius:0.625rem;';
  const colorControl = document.createElement('label');
  colorControl.className = 'freev-color-choice freev-color-choice-compact';
  colorControl.title = 'Personnaliser la couleur de la catégorie';
  const color = document.createElement('input');
  color.type = 'color'; color.id = 'editCatColor'; color.value = safeCustomCategoryColor(c.color);
  color.setAttribute('aria-label', `Personnaliser la couleur de la catégorie ${c.name}`);
  const colorVisual = document.createElement('span');
  colorVisual.className = 'freev-color-choice-ui';
  const paletteIcon = document.createElement('i');
  paletteIcon.className = 'fa-solid fa-palette'; paletteIcon.setAttribute('aria-hidden', 'true');
  const colorLabel = document.createElement('span'); colorLabel.textContent = 'Couleur';
  const colorDot = document.createElement('i');
  colorDot.className = 'freev-color-choice-dot'; colorDot.setAttribute('aria-hidden', 'true'); colorDot.style.background = color.value;
  color.addEventListener('input', () => { colorDot.style.background = color.value; });
  colorVisual.append(paletteIcon, colorLabel, colorDot);
  colorControl.append(color, colorVisual);
  const input = document.createElement('input');
  input.type = 'text'; input.id = 'editCatName'; input.value = c.name;
  input.style.cssText = 'flex:1;padding:0.35rem 0.5rem;border:1px solid #e2e8f0;border-radius:0.4rem;font-size:0.82rem;font-weight:600;';
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') saveEditCategory(name);
    if (event.key === 'Escape') renderCustomCategoriesList();
  });
  const save = document.createElement('button');
  save.type = 'button'; save.style.cssText = 'background:#2563eb;color:white;border:none;border-radius:0.4rem;padding:0.35rem 0.65rem;cursor:pointer;font-size:0.8rem;font-weight:600;';
  save.innerHTML = '<i class="fa-solid fa-check"></i>'; save.addEventListener('click', () => saveEditCategory(name));
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.style.cssText = 'background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0;border-radius:0.4rem;padding:0.35rem 0.5rem;cursor:pointer;font-size:0.8rem;';
  cancel.innerHTML = '<i class="fa-solid fa-xmark"></i>'; cancel.addEventListener('click', renderCustomCategoriesList);
  targetRow.replaceChildren(colorControl, input, save, cancel);
  input.focus();
}

function saveEditCategory(oldName) {
  const newName = safeCustomCategoryName(document.getElementById('editCatName')?.value);
  const newColor = safeCustomCategoryColor(document.getElementById('editCatColor')?.value);
  if (!newName) { showToast('Nom requis', 'error'); return; }
  const idx = customCategories.findIndex(c => c.name === oldName);
  if (idx === -1) return;
  if (newName !== oldName && customCategories.find(c => c.name.toLowerCase() === newName.toLowerCase())) {
    showToast('Cette catégorie existe déjà', 'error'); return;
  }
  // Mettre à jour le nom dans toutes les transactions + récurrentes + budgets
  if (newName !== oldName) {
    // Transactions de tous les comptes
    accounts.forEach(acc => {
      (acc.transactions || []).forEach(t => { if (t.category === oldName) t.category = newName; });
      // Récurrentes de tous les comptes
      (acc.recurringTransactions || []).forEach(r => { if (r.category === oldName) r.category = newName; });
      // Budgets par catégorie
      if (acc.budgetsByCategory?.[oldName] !== undefined) {
        acc.budgetsByCategory[newName] = acc.budgetsByCategory[oldName];
        delete acc.budgetsByCategory[oldName];
      }
    });
    // Variables globales du compte courant
    transactions.forEach(t => { if (t.category === oldName) t.category = newName; });
    recurringTransactions.forEach(r => { if (r.category === oldName) r.category = newName; });
    if (budgetsByCategory[oldName] !== undefined) {
      budgetsByCategory[newName] = budgetsByCategory[oldName];
      delete budgetsByCategory[oldName];
    }
  }
  customCategories[idx] = { name: newName, color: newColor };
  saveData();
  renderCustomCategoriesList();
  populateCategorySelects();
  showToast(`Catégorie "${newName}" mise à jour`, 'success');
}

function addCustomCategory() {
  const nameEl = document.getElementById('newCategoryName');
  const colorEl = document.getElementById('newCategoryColor');
  if (!nameEl) return;
  const name = safeCustomCategoryName(nameEl.value);
  if (!name) { showToast('Nom de catégorie invalide (80 caractères maximum)', 'error'); return; }
  if (getAllCategories().find(c => c.name.toLowerCase() === name.toLowerCase())) {
    showToast('Cette catégorie existe déjà', 'error'); return;
  }
  const color = safeCustomCategoryColor(colorEl?.value);
  // FIX : utilise la variable globale
  if (!customCategories) customCategories = [];
  customCategories.push({ name, color });
  nameEl.value = '';
  saveData();
  renderCustomCategoriesList();
  populateCategorySelects();
  showToast(`Catégorie "${name}" ajoutée`, 'success');
}

// ✅ Récupère les catégories personnalisées à partir des transactions existantes
function recoverCategoriesFromTransactions() {
  const defaultNames = new Set([
    'Alimentation','Transport','Logement','Santé','Loisirs','Shopping',
    'Factures','Salaire','Freelance','Investissement','Épargne',
    'Transfert épargne','Remboursement dette','Autre'
  ]);

  // Sync le compte courant avant de lire (pour inclure les dernières transactions non sauvegardées)
  saveCurrentGlobalsToAccount();

  // Chercher dans TOUS les comptes
  const found = [];
  accounts.forEach(acc => {
    (acc.transactions || []).forEach(t => {
      const cat = (t.category || '').trim();
      if (cat && !defaultNames.has(cat)) found.push(cat);
    });
  });

  const unique = [...new Set(found.map(safeCustomCategoryName).filter(Boolean))];
  if (!unique.length) {
    showToast('Aucune catégorie personnalisée trouvée dans vos transactions', 'info');
    return;
  }

  // Couleurs auto assignées
  const palette = ['#8b5cf6','#06b6d4','#f59e0b','#10b981','#f43f5e','#3b82f6','#ec4899','#84cc16','#f97316','#6366f1'];
  let added = 0;
  if (!customCategories) customCategories = [];

  unique.forEach((name, i) => {
    if (!customCategories.find(c => c.name.toLowerCase() === name.toLowerCase())) {
      const color = palette[i % palette.length];
      customCategories.push({ name, color });
      added++;
    }
  });

  if (added === 0) {
    showToast('Toutes ces catégories existent déjà dans la liste', 'info');
    return;
  }

  saveData();
  renderCustomCategoriesList();
  populateCategorySelects();
  showToast(`✅ ${added} catégorie(s) récupérée(s) : ${unique.slice(0, 5).join(', ')}${unique.length > 5 ? '…' : ''}`, 'success');
}

// FIX : suppression par nom au lieu de l'index pour eviter les suppressions accidentelles
function removeCustomCategory(name) {
  if (!customCategories) return;
  const idx = customCategories.findIndex(c => c.name === name);
  if (idx === -1) return;
  if (!confirm(`Supprimer la catégorie "${name}" ?`)) return;
  customCategories.splice(idx, 1);
  saveData();
  renderCustomCategoriesList();
  populateCategorySelects();
  showToast(`Catégorie "${name}" supprimée`, 'neutral');
}

// ============================================================
// ===== ALERTES DASHBOARD ENRICHIES ==========================
// ============================================================

function getUpcomingDebts(daysAhead = 7) {
  const today = getToday();
  const limit = new Date(today);
  limit.setDate(limit.getDate() + daysAhead);
  const limitISO = isoDate(limit);
  const todayISO = isoDate(today);
  return debts.filter(d => {
    if (!d.endDate) return false;
    const remaining = Number(d.remainingAmount ?? d.amount) || 0;
    return remaining > 0 && d.endDate >= todayISO && d.endDate <= limitISO;
  });
}

function getUpcomingRecurrings(daysAhead = 5) {
  return getUpcomingRecurringOccurrences(daysAhead);
}
