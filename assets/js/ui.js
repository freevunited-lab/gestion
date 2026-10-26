function openSidebarMobile() {
  document.querySelector('.sidebar')?.classList.add('open');
  document.body?.classList?.add('freev-mobile-nav-open');
  document.querySelectorAll('[aria-controls="sidebarNav"]').forEach(control => control.setAttribute('aria-expanded', 'true'));
  const bd = document.getElementById('sidebarBackdrop');
  if (bd) { bd.style.display = 'block'; requestAnimationFrame(() => bd.classList.add('visible')); }
}
function closeSidebarMobile() {
  document.querySelector('.sidebar')?.classList.remove('open');
  document.body?.classList?.remove('freev-mobile-nav-open');
  document.querySelectorAll('[aria-controls="sidebarNav"]').forEach(control => control.setAttribute('aria-expanded', 'false'));
  const bd = document.getElementById('sidebarBackdrop');
  if (bd) {
    bd.classList.remove('visible');
    setTimeout(() => { if (!bd.classList.contains('visible')) bd.style.display = ''; }, 340);
  }
}
function setBottomNav(view) {
  document.querySelectorAll('.bottom-nav-item').forEach(el => el.classList.remove('active'));
  const mapped = (typeof window !== 'undefined' && window.FreevSpaces?.mobileTab?.(view)) || view;
  const target = document.getElementById('bnav-' + mapped);
  if (target) target.classList.add('active');
  closeSidebarMobile();
}

// ============================================================
// ===== COULEUR FAB + UI SETTINGS ============================
// ============================================================
function updateColorPickerDot(id, color) {
  const dot = document.getElementById(id);
  if (dot && color) dot.style.background = color;
}

function syncColorPresetSelection(containerId, selectedColor, attribute = 'color') {
  const container = document.getElementById(containerId);
  if (!container) return;
  const datasetKey = attribute === 'reconcileColor' ? 'reconcileColor' : 'color';
  const expected = normalizeColorValue(selectedColor);
  container.querySelectorAll(`button[data-${attribute === 'reconcileColor' ? 'reconcile-color' : 'color'}]`).forEach(button => {
    const isSelected = normalizeColorValue(button.dataset[datasetKey]) === expected;
    button.classList.toggle('is-selected', isSelected);
    button.setAttribute('aria-pressed', String(isSelected));
  });
}

function applyFabColor(color) {
  document.documentElement.style.setProperty('--fab-color', color);
  const preview = document.getElementById('fabColorPreview');
  if (preview) preview.style.background = color;
  updateColorPickerDot('fabColorPickerDot', color);
  syncColorPresetSelection('fabColorPresets', color);
  const picker = document.getElementById('fabColorPicker');
  if (picker) picker.value = color;
}

function saveFabColor(color) {
  uiSettings.fabColor = color;
  applyFabColor(color);
  saveData();
  showToast('Couleur du bouton sauvegardée', 'success');
}

function resetFabColor() {
  saveFabColor('#10b981');
}

function loadFabColor() {
  const color = uiSettings?.fabColor || '#10b981';
  applyFabColor(color);
  const picker = document.getElementById('fabColorPicker');
  if (picker) picker.value = color;
}

function getActiveReconcileColor() {
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--reconcile-color').trim() || DEFAULT_RECONCILE_COLOR;
}

function normalizeColorValue(color) {
  return String(color || '').trim().toLowerCase();
}

function getSavedReconcileColor() {
  return String(uiSettings?.reconcileColor || '').trim() || getActiveReconcileColor();
}

function normalizeHexColor(color, fallback = DEFAULT_RECONCILE_COLOR) {
  const value = String(color || '').trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function getReconcileColorValue(tx=null) {
  const custom = String(tx?.reconcileColor || '').trim();
  return normalizeHexColor(custom || getSavedReconcileColor());
}

function getReconcileColorStyle(tx=null) {
  const custom = String(tx?.reconcileColor || '').trim();
  if (custom) return normalizeHexColor(custom, getSavedReconcileColor());
  return getSavedReconcileColor();
}

function setTransactionReconcileColor(id, color, accountId='') {
  const cleanColor = normalizeHexColor(color);
  let tx = null;

  if (accountId) {
    const acc = accounts.find(a => String(a.id) === String(accountId));
    tx = (acc?.transactions || []).find(t => String(t.id) === String(id));
  }

  if (!tx) tx = transactions.find(t => String(t.id) === String(id));

  if (!tx) {
    showToast('Transaction introuvable', 'error');
    return;
  }

  tx.reconcileColor = cleanColor;
  saveData();
  if (currentView === 'dashboard') renderRecentTransactions();
  if (currentView === 'transactions') renderAllTransactions();
  showToast('Couleur de vérification mise à jour', 'success');
}

function clearGlobalReconcileColorOverrides(previousColor) {
  const clearInvalidColor = tx => {
    if (tx?.reconcileColor && !/^#[0-9a-f]{6}$/i.test(String(tx.reconcileColor).trim())) {
      tx.reconcileColor = '';
    }
  };
  transactions.forEach(clearInvalidColor);
  accounts.forEach(acc => (acc.transactions || []).forEach(clearInvalidColor));
}

// ============================================================
// ===== COULEUR VALIDATION PAR TRANSACTION (modal) ===========
// ============================================================
function setTransReconcileColor(color) {
  const picker  = document.getElementById('transReconcileColor');
  const preview = document.getElementById('transReconcilePreview');
  if (!picker || !preview) return;

  // Stocke la valeur sur le dataset pour que saveTransaction puisse la lire
  picker.dataset.customColor = color || '';

  const displayColor = color || getActiveReconcileColor();
  picker.value = displayColor;
  preview.style.background = displayColor;
  preview.style.color = '#fff';
  updateColorPickerDot('transReconcileColorPickerDot', displayColor);

  // Met en évidence le bouton préréglage actif
  document.querySelectorAll('#transReconcilePresets button').forEach(btn => {
    const isDefault = btn.hasAttribute('data-global-color');
    const isMatch = btn.dataset.reconcileColor === normalizeColorValue(color);
    const isSelected = (!color && isDefault) || isMatch;
    btn.classList.toggle('is-selected', isSelected);
    btn.setAttribute('aria-pressed', String(isSelected));
  });
}

function previewTransReconcileColor(color) {
  const picker  = document.getElementById('transReconcileColor');
  const preview = document.getElementById('transReconcilePreview');
  if (picker)  picker.dataset.customColor = color;
  if (preview) { preview.style.background = color; preview.style.color = '#fff'; }
  updateColorPickerDot('transReconcileColorPickerDot', color);
  // Désélectionne les préréglages quand on utilise le color picker libre
  document.querySelectorAll('#transReconcilePresets button').forEach(btn => {
    btn.classList.remove('is-selected');
    btn.setAttribute('aria-pressed', 'false');
  });
}

// ============================================================
// ===== COULEUR ICÔNE VALIDATION (RECONCILE) =================
// ============================================================
function applyReconcileColor(color) {
  color = color || DEFAULT_RECONCILE_COLOR;
  if (!uiSettings) uiSettings = {};
  uiSettings.reconcileColor = color;
  document.documentElement.style.setProperty('--reconcile-color', color);
  const preview = document.getElementById('reconcileColorPreview');
  if (preview) {
    preview.style.background = color;
    preview.style.color = '#fff';
  }
  updateColorPickerDot('reconcileColorPickerDot', color);
  syncColorPresetSelection('reconcileColorPresets', color);
  const picker = document.getElementById('reconcileColorPicker');
  if (picker) picker.value = color;

  const transPicker = document.getElementById('transReconcileColor');
  if (transPicker && !transPicker.dataset.customColor) setTransReconcileColor('');

  if (currentView === 'transactions') renderAllTransactions();
  if (currentView === 'dashboard') renderRecentTransactions();
}

function saveReconcileColor(color) {
  if (!uiSettings) uiSettings = {};
  const previousColor = uiSettings.reconcileColor || DEFAULT_RECONCILE_COLOR;
  uiSettings.reconcileColor = color;
  clearGlobalReconcileColorOverrides(previousColor);
  applyReconcileColor(color);
  saveData();
  showToast('Couleur de validation sauvegardée', 'success');
}

function resetReconcileColor() {
  saveReconcileColor('#059669');
}

function loadReconcileColor() {
  const color = uiSettings?.reconcileColor || DEFAULT_RECONCILE_COLOR;
  applyReconcileColor(color);
}

// ============================================================
// ===== TAGS FAVORIS =========================================
// ============================================================
function renderFavoriteTagsInModal() {
  const panel = document.getElementById('favoriteTagsPanel');
  if (!panel) return;
  const favs = uiSettings.favoriteTags || [];
  if (!favs.length) { panel.replaceChildren(); return; }
  const wrapper = document.createElement('div');
  wrapper.className = 'fav-tags-panel';
  const label = document.createElement('span');
  label.style.cssText = 'font-size:0.73rem;color:#7c3aed;font-weight:700;white-space:nowrap;display:flex;align-items:center;gap:0.25rem;';
  label.innerHTML = '<i class="fa-solid fa-star" style="color:#f59e0b;font-size:0.7rem;"></i> Favoris';
  wrapper.appendChild(label);
  favs.forEach((rawTag, index) => {
    const tag = String(rawTag || '').trim();
    if (!tag) return;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'fav-tag-chip';
    chip.id = `favchip_${index}`;
    chip.title = `Ajouter ${tag}`;
    chip.textContent = tag;
    chip.addEventListener('click', () => addTagFromFavorite(tag));
    wrapper.appendChild(chip);
  });
  panel.replaceChildren(wrapper);
}

function addTagFromFavorite(tag) {
  const input = document.getElementById('transTags');
  if (!input) return;
  const existing = parseTags(input.value);
  const chips = [...document.querySelectorAll('.fav-tag-chip')];
  const chip = chips.find(item => item.textContent === tag);
  if (existing.includes(tag)) {
    if (chip) { chip.classList.add('added'); setTimeout(()=>chip.classList.remove('added'), 700); }
    return;
  }
  input.value = input.value.trim() ? (input.value.trim().replace(/,\s*$/, '') + ', ' + tag) : tag;
  if (chip) { chip.classList.add('added'); setTimeout(()=>chip.classList.remove('added'), 700); }
}

function addFavoriteTagFromSettings() {
  const input = document.getElementById('newFavTagInput');
  if (!input) return;
  const tags = parseTags(input.value);
  if (!tags.length) { showToast('Tag invalide', 'error'); return; }
  if (!uiSettings.favoriteTags) uiSettings.favoriteTags = [];
  let added = 0;
  tags.forEach(tag => { if (!uiSettings.favoriteTags.includes(tag)) { uiSettings.favoriteTags.push(tag); added++; } });
  if (added > 0) { saveData(); showToast(added > 1 ? `${added} tags favoris ajoutés` : `Favori ajouté : ${tags[0]}`, 'success'); }
  else { showToast('Ce tag est déjà en favoris', 'info'); }
  input.value = '';
  renderFavTagsSettings();
}

function removeFavoriteTag(tag) {
  if (!uiSettings.favoriteTags) return;
  uiSettings.favoriteTags = uiSettings.favoriteTags.filter(t => t !== tag);
  saveData(); renderFavTagsSettings();
  showToast('Tag retiré des favoris', 'neutral');
}

function addAllUsedTagsToFavorites() {
  const allTags = [...new Set((transactions||[]).flatMap(t=>t.tags||[]))].filter(Boolean);
  if (!allTags.length) { showToast('Aucun tag trouvé dans vos transactions', 'info'); return; }
  if (!uiSettings.favoriteTags) uiSettings.favoriteTags = [];
  let added = 0;
  allTags.forEach(tag => { if (!uiSettings.favoriteTags.includes(tag)) { uiSettings.favoriteTags.push(tag); added++; } });
  if (added > 0) { saveData(); showToast(`${added} tag(s) importé(s) depuis vos transactions`, 'success'); renderFavTagsSettings(); }
  else { showToast('Tous vos tags sont déjà en favoris', 'info'); }
}

function renderFavTagsSettings() {
  const list = document.getElementById('favTagsSettingsList');
  if (!list) return;
  const favs = uiSettings.favoriteTags || [];
  if (!favs.length) {
    list.innerHTML = '<span style="color:#94a3b8;font-size:0.8rem;font-style:italic;">Aucun tag favori pour l\'instant.</span>';
    return;
  }
  const chips = favs.map(rawTag => {
    const tag = String(rawTag || '').trim();
    if (!tag) return null;
    const chip = document.createElement('span');
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:0.25rem;background:#ede9fe;color:#4f46e5;border:1px solid #c4b5fd;border-radius:9999px;padding:0.2rem 0.4rem 0.2rem 0.7rem;font-size:0.8rem;font-weight:600;';
    chip.append(document.createTextNode(tag));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.title = 'Supprimer';
    remove.style.cssText = 'background:none;border:none;cursor:pointer;color:#7c3aed;font-size:0.8rem;padding:0 0.15rem;line-height:1;display:flex;align-items:center;';
    remove.innerHTML = '<i class="fa-solid fa-times"></i>';
    remove.addEventListener('click', () => removeFavoriteTag(tag));
    chip.appendChild(remove);
    return chip;
  }).filter(Boolean);
  list.replaceChildren(...chips);
}

// ============================================================
// ===== SWIPE GESTURES (mobile) ==============================
// ============================================================
(function setupMobileGestures() {
  // -- Swipe gauche/droite pour naviguer entre les vues
  const VIEWS_ORDER = ['dashboard', 'transactions', 'analytics', 'savings'];
  let touchStartX = 0, touchStartY = 0, touchStartTime = 0;

  document.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (!window.matchMedia('(max-width: 768px), (pointer: coarse) and (max-width: 1024px), (horizontal-viewport-segments: 2), (vertical-viewport-segments: 2)').matches) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    const dt = Date.now() - touchStartTime;

    // Ignorer si scroll vertical dominant ou trop lent
    if (Math.abs(dy) > Math.abs(dx) * 1.2) return;
    if (dt > 350 || Math.abs(dx) < 55) return;

    // Swipe depuis le bord gauche → ouvre sidebar
    if (touchStartX < 22 && dx > 55) {
      openSidebarMobile(); return;
    }
    // Sidebar ouverte : swipe gauche → ferme
    const sidebar = document.querySelector('.sidebar');
    if (sidebar?.classList.contains('open') && dx < -55) {
      closeSidebarMobile(); return;
    }

    // Navigation swipe gauche/droite entre vues
    const cur = typeof currentView !== 'undefined' ? currentView : 'dashboard';
    const idx = VIEWS_ORDER.indexOf(cur);
    if (idx === -1) return;
    if (dx < -55 && idx < VIEWS_ORDER.length - 1) {
      const next = VIEWS_ORDER[idx + 1];
      switchView(next); setBottomNav(next);
    } else if (dx > 55 && idx > 0) {
      const prev = VIEWS_ORDER[idx - 1];
      switchView(prev); setBottomNav(prev);
    }
  }, { passive: true });

  // -- Swipe vers le bas pour fermer les bottom sheets
  let sheetTouchY = 0, sheetEl = null, sheetStartScrollTop = 0;

  document.addEventListener('touchstart', e => {
    if (!window.matchMedia('(max-width: 768px), (pointer: coarse) and (max-width: 1024px), (horizontal-viewport-segments: 2), (vertical-viewport-segments: 2)').matches) return;
    const overlay = e.target.closest('.modal-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    const header = e.target.closest('.modal-header');
    if (!header) return;
    sheetTouchY = e.touches[0].clientY;
    sheetEl = overlay.querySelector('.modal-content, .accounts-modal-content');
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!sheetEl) return;
    const dy = e.touches[0].clientY - sheetTouchY;
    if (dy > 0) sheetEl.style.transform = `translateY(${Math.min(dy * 0.5, 120)}px)`;
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (!sheetEl) return;
    const dy = e.changedTouches[0].clientY - sheetTouchY;
    sheetEl.style.transform = '';
    sheetEl.style.transition = 'transform 0.25s cubic-bezier(0.22,1,0.36,1)';
    if (dy > 80) {
      // ferme la modal
      const overlay = sheetEl.closest('.modal-overlay');
      if (overlay) {
        // cherche un bouton annuler/fermer
        const closeBtn = overlay.querySelector('[onclick*="close"], [onclick*="Close"]');
        if (closeBtn) closeBtn.click();
      }
    }
    setTimeout(() => { if (sheetEl) sheetEl.style.transition = ''; sheetEl = null; }, 260);
  }, { passive: true });
})();

window.addEventListener('DOMContentLoaded', init);
