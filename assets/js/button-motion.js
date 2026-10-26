// Retour tactile local pour les boutons Freev, sans modifier leur action existante.
(() => {
  const SELECTOR = 'button:not(:disabled):not(.freev-select-trigger):not(.freev-select-option)';
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function ripple(button, clientX = null, clientY = null) {
    if (reducedMotion() || !button.matches(SELECTOR)) return;
    button.querySelector('.freev-button-ripple')?.remove();
    const bounds = button.getBoundingClientRect();
    const wave = document.createElement('span');
    wave.className = 'freev-button-ripple';
    wave.style.left = `${clientX === null ? bounds.width / 2 : clientX - bounds.left}px`;
    wave.style.top = `${clientY === null ? bounds.height / 2 : clientY - bounds.top}px`;
    button.append(wave);
    wave.addEventListener('animationend', () => wave.remove(), { once: true });
  }

  document.addEventListener('pointerdown', event => {
    const button = event.target.closest?.(SELECTOR);
    if (button) ripple(button, event.clientX, event.clientY);
  });
  document.addEventListener('keydown', event => {
    if (!['Enter', ' '].includes(event.key)) return;
    const button = event.target.closest?.(SELECTOR);
    if (button) ripple(button);
  });
})();
