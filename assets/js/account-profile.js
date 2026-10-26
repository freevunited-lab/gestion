(() => {
  const layer = document.getElementById('accountProfileLayer');
  const dialog = document.getElementById('accountProfilePopover');
  const trigger = document.getElementById('sidebarUserInfo');
  const details = document.getElementById('accountProfileDetails');
  const deleteForm = document.getElementById('accountDeleteForm');
  const errorBox = document.getElementById('accountDeleteError');
  const passwordInput = document.getElementById('accountDeletePassword');
  const phraseInput = document.getElementById('accountDeletePhrase');
  const submitButton = document.getElementById('accountDeleteConfirm');
  if (!layer || !dialog || !trigger || !details || !deleteForm) return;

  let closeTimer = 0;
  let isSubmitting = false;
  let previousFocus = null;

  function durationSince(date) {
    const now = new Date();
    let years = now.getFullYear() - date.getFullYear();
    let months = now.getMonth() - date.getMonth();
    let days = now.getDate() - date.getDate();
    if (days < 0) {
      months -= 1;
      const daysInPreviousMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
      days += daysInPreviousMonth;
    }
    if (months < 0) { years -= 1; months += 12; }

    const parts = [];
    if (years > 0) parts.push(`${years} an${years > 1 ? 's' : ''}`);
    if (months > 0) parts.push(`${months} mois`);
    if (!years && days > 0) parts.push(`${days} jour${days > 1 ? 's' : ''}`);
    if (!parts.length) return 'Inscription récente';
    return `Depuis ${parts.slice(0, 2).join(' et ')}`;
  }

  function renderAccounts() {
    const list = document.getElementById('accountProfileAccountList');
    const count = document.getElementById('accountProfileAccountCount');
    if (!list || !count) return;
    const state = window._getAppState?.() || {};
    const accounts = Array.isArray(state.accounts) ? state.accounts : [];
    count.textContent = String(accounts.length);
    list.replaceChildren();

    if (!accounts.length) {
      const empty = document.createElement('li');
      empty.className = 'account-profile-empty';
      empty.textContent = 'Aucun compte FREEV associé';
      list.append(empty);
      return;
    }

    accounts.forEach((account, index) => {
      const item = document.createElement('li');
      item.className = 'account-profile-account';
      const initials = document.createElement('span');
      initials.className = 'account-profile-account-mark';
      initials.setAttribute('aria-hidden', 'true');
      initials.textContent = String(account?.name || 'C').trim().slice(0, 1).toUpperCase() || 'C';
      const name = document.createElement('span');
      name.className = 'account-profile-account-name';
      name.textContent = String(account?.name || `Compte ${index + 1}`);
      item.append(initials, name);
      if (String(account?.id) === String(state.currentAccountId)) {
        const active = document.createElement('span');
        active.className = 'account-profile-current';
        active.textContent = 'Actif';
        item.append(active);
      }
      list.append(item);
    });
  }

  function renderProfile() {
    const user = window._fbGetCurrentUser?.();
    const email = document.getElementById('accountProfileEmail');
    const since = document.getElementById('accountProfileSince');
    const createdAt = document.getElementById('accountProfileCreatedAt');
    if (email) email.textContent = user?.email || 'Adresse non disponible';
    const created = user?.metadata?.creationTime ? new Date(user.metadata.creationTime) : null;
    if (since) since.textContent = created && !Number.isNaN(created.getTime()) ? durationSince(created) : 'Date d’inscription indisponible';
    if (createdAt) createdAt.textContent = created && !Number.isNaN(created.getTime())
      ? `Inscrit le ${new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(created)}`
      : '';
    renderAccounts();
  }

  function resetDeleteForm() {
    deleteForm.reset();
    errorBox.hidden = true;
    errorBox.textContent = '';
    errorBox.classList.remove('is-success');
    submitButton.disabled = true;
    submitButton.querySelector('span').textContent = 'Supprimer définitivement';
  }

  function setDeleteView(open) {
    if (isSubmitting) return;
    if (open) {
      details.hidden = true;
      deleteForm.hidden = false;
      errorBox.hidden = true;
      window.setTimeout(() => passwordInput?.focus(), 30);
      return;
    }
    resetDeleteForm();
    deleteForm.hidden = true;
    details.hidden = false;
    document.getElementById('accountDeleteStart')?.focus();
  }

  function openPopover() {
    if (!layer.hidden) return;
    window.clearTimeout(closeTimer);
    previousFocus = document.activeElement;
    renderProfile();
    layer.hidden = false;
    layer.inert = false;
    layer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('account-profile-open');
    trigger.setAttribute('aria-expanded', 'true');
    window.requestAnimationFrame(() => {
      layer.classList.add('is-open');
      dialog.querySelector('.account-profile-close')?.focus();
    });
  }

  function closePopover() {
    if (isSubmitting || layer.hidden) return;
    layer.classList.remove('is-open');
    layer.inert = true;
    layer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('account-profile-open');
    trigger.setAttribute('aria-expanded', 'false');
    closeTimer = window.setTimeout(() => { layer.hidden = true; }, 190);
    const target = previousFocus?.isConnected ? previousFocus : trigger;
    if (target && !target.hidden) target.focus({ preventScroll: true });
  }

  function refreshConfirmState() {
    submitButton.disabled = isSubmitting || !passwordInput.value || phraseInput.value.trim().toLocaleUpperCase('fr-FR') !== 'SUPPRIMER';
  }

  function showDeleteError(message) {
    errorBox.classList.remove('is-success');
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function friendlyError(error) {
    const code = String(error?.code || '');
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') return 'Le mot de passe ne correspond pas à ce compte.';
    if (code === 'auth/too-many-requests') return 'Trop de tentatives. Réessayez dans quelques minutes.';
    if (code === 'auth/unsupported-provider') return 'La suppression doit être confirmée avec le fournisseur de connexion de ce compte.';
    if (code === 'functions/not-found') return 'Le service sécurisé de suppression n’est pas encore déployé. Aucune donnée n’a été supprimée.';
    if (code === 'functions/unauthenticated' || code === 'auth/session-changed') return 'Votre session a expiré. Reconnectez-vous avant de réessayer.';
    if (code === 'freev/cloud-sync-pending') return 'La dernière sauvegarde n’a pas pu être confirmée. Réessayez une fois la synchronisation terminée.';
    if (code === 'functions/failed-precondition' || code === 'functions/permission-denied') return 'La demande n’a pas pu être confirmée. Aucune suppression n’a été validée.';
    if (code.includes('network') || code === 'functions/unavailable' || code === 'functions/deadline-exceeded') return 'La connexion a été interrompue. Vérifiez votre connexion avant de réessayer.';
    return 'La suppression a échoué. Réessayez après avoir vérifié votre connexion.';
  }

  window.toggleAccountProfilePopover = (event) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (layer.hidden) openPopover();
    else closePopover();
  };
  window.closeAccountProfilePopover = closePopover;
  window._renderAccountProfilePopover = renderProfile;

  document.querySelectorAll('[data-account-profile-close]').forEach(button => button.addEventListener('click', closePopover));
  document.getElementById('accountDeleteStart')?.addEventListener('click', () => setDeleteView(true));
  document.getElementById('accountDeleteBack')?.addEventListener('click', () => setDeleteView(false));
  document.getElementById('accountDeleteCancel')?.addEventListener('click', () => setDeleteView(false));
  [passwordInput, phraseInput].forEach(input => input.addEventListener('input', refreshConfirmState));

  deleteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitButton.disabled || isSubmitting) return;
    isSubmitting = true;
    passwordInput.disabled = true;
    phraseInput.disabled = true;
    submitButton.disabled = true;
    submitButton.querySelector('span').textContent = 'Suppression en cours…';
    errorBox.hidden = true;
    try {
      await window._fbDeleteOwnAccount(passwordInput.value);
      errorBox.classList.add('is-success');
      errorBox.textContent = 'Compte supprimé. Fermeture de la session…';
      errorBox.hidden = false;
      window.setTimeout(async () => {
        try { await window._fbEndDeletedAccountSession?.(); } catch (_) {}
        window.location.reload();
      }, 900);
    } catch (error) {
      isSubmitting = false;
      passwordInput.disabled = false;
      phraseInput.disabled = false;
      submitButton.querySelector('span').textContent = 'Supprimer définitivement';
      showDeleteError(friendlyError(error));
      refreshConfirmState();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (layer.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closePopover();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),[href],[tabindex]:not([tabindex="-1"])')]
      .filter(element => !element.hidden && element.getClientRects().length);
    if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
})();
