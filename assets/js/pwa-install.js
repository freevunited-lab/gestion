// Installation PWA Freev Valeur 5.0 : invitation Android/ordinateur et guide iPhone.
(function () {
  'use strict';

  const DISMISS_KEY = 'freevPwaInstallDismissed_5_0';
  let deferredPrompt = null;

  const byId = id => document.getElementById(id);
  const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = () => /iPad|iPhone|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = () => /Safari/i.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent);
  const isMobile = () => navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

  function updateInstallButton() {
    const button = byId('pwaInstallButton');
    if (!button) return;
    const label = button.querySelector('span');
    const installed = isStandalone();
    button.classList.toggle('is-installed', installed);
    if (label) label.textContent = installed ? 'Application installée' : 'Installer l’application';
    button.setAttribute('aria-label', installed ? 'Freev Valeur est installée' : 'Installer Freev Valeur');
  }

  function setGuide(title, intro, steps) {
    const titleNode = byId('pwaInstallTitle');
    const introNode = byId('pwaInstallIntro');
    const list = byId('pwaInstallSteps');
    if (titleNode) titleNode.textContent = title;
    if (introNode) introNode.textContent = intro;
    if (list) {
      list.replaceChildren(...steps.map(step => {
        const item = document.createElement('li');
        item.textContent = step;
        return item;
      }));
    }
  }

  function openGuide() {
    const modal = byId('pwaInstallModal');
    if (!modal) return;
    if (isIOS()) {
      const safariLead = isSafari()
        ? 'Sur iPhone et iPad, Apple utilise le menu de partage de Safari pour installer une application web.'
        : 'Ouvrez d’abord cette page dans Safari : l’installation sur l’écran d’accueil se fait depuis Safari.';
      setGuide('Installer sur iPhone ou iPad', safariLead, [
        isSafari() ? 'Touchez le bouton Partager de Safari (le carré avec une flèche vers le haut).' : 'Dans votre navigateur, choisissez « Ouvrir dans Safari » puis revenez sur cette page.',
        'Faites défiler le menu et touchez « Sur l’écran d’accueil ».',
        'Vérifiez le nom et l’icône Freev Valeur, puis touchez « Ajouter ». '
      ]);
    } else {
      setGuide('Installer Freev Valeur', 'Votre navigateur peut ajouter Freev Valeur comme une application autonome.', [
        'Ouvrez le menu de votre navigateur.',
        'Choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil ».',
        'Confirmez pour retrouver l’icône Freev Valeur parmi vos applications.'
      ]);
    }
    modal.hidden = false;
    document.body.classList.add('v4-modal-open');
    requestAnimationFrame(() => modal.querySelector('button')?.focus());
  }

  function closeGuide() {
    const modal = byId('pwaInstallModal');
    if (modal) modal.hidden = true;
    document.body.classList.remove('v4-modal-open');
  }

  async function promptInstall() {
    if (isStandalone()) {
      window.showToast?.('Freev Valeur est déjà installée sur cet appareil.', 'info');
      return;
    }
    if (!deferredPrompt || isIOS()) {
      openGuide();
      return;
    }
    const prompt = deferredPrompt;
    deferredPrompt = null;
    await prompt.prompt();
    const choice = await prompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
    if (choice.outcome === 'accepted') {
      dismissBanner(true);
      window.showToast?.('Installation de Freev Valeur lancée.', 'success');
    } else {
      window.showToast?.('Installation annulée. Le bouton reste disponible dans le menu.', 'info');
    }
  }

  function showBanner(force = false) {
    if (isStandalone() || (!force && !isMobile())) return;
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY)) || 0;
    if (!force && Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000) return;
    const banner = byId('pwaInstallBanner');
    if (banner) banner.hidden = false;
  }

  function dismissBanner(permanent = false) {
    const banner = byId('pwaInstallBanner');
    if (banner) banner.hidden = true;
    localStorage.setItem(DISMISS_KEY, permanent ? String(Date.now() + 365 * 24 * 60 * 60 * 1000) : String(Date.now()));
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    updateInstallButton();
    showBanner(false);
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    dismissBanner(true);
    updateInstallButton();
    window.showToast?.('Freev Valeur est installée.', 'success');
  });

  window.addEventListener('freev:ready', () => {
    updateInstallButton();
    const requestedView = new URLSearchParams(location.search).get('view');
    if (['dashboard', 'planner', 'smart', 'transactions', 'analytics', 'savings'].includes(requestedView)) {
      window.switchView?.(requestedView);
    }
    window.setTimeout(() => showBanner(false), 2800);
  });

  document.addEventListener('DOMContentLoaded', () => {
    updateInstallButton();
    // La proposition doit être visible dès l’arrivée sur le lien public, même
    // si l’utilisateur n’a pas encore ouvert sa session Firebase.
    window.setTimeout(() => showBanner(false), 1800);
    const modal = byId('pwaInstallModal');
    modal?.addEventListener('click', event => {
      if (event.target === modal) closeGuide();
    });
  }, { once: true });

  window.FreevPWA = { promptInstall, openGuide, closeGuide, showBanner, dismissBanner, isStandalone };
})();
