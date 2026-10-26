/* FREEV Gestion · motion des vues et des surfaces, sans état financier. */
(() => {
  'use strict';
  const running = new WeakMap();
  const runningSurfaces = new WeakMap();
  const surfaceObservers = new WeakMap();
  const revealedSurfaces = new WeakSet();
  let activeSurfaceTarget = null;
  const shouldReduceMotion = (media = window.matchMedia) => {
    try { return Boolean(media?.('(prefers-reduced-motion: reduce)')?.matches); }
    catch { return true; }
  };
  const cancelSurfaceReveal = target => {
    runningSurfaces.get(target)?.forEach(animation => animation.cancel?.());
    runningSurfaces.delete(target);
    surfaceObservers.get(target)?.disconnect?.();
    surfaceObservers.delete(target);
  };
  const animateSurface = (surface, animations, delay = 0) => {
    if (revealedSurfaces.has(surface) || typeof surface.animate !== 'function') return;
    revealedSurfaces.add(surface);
    try {
      const animation = surface.animate(
        [{ opacity: 0, transform: 'translate3d(0, 12px, 0) scale(.99)' },
         { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' }],
        { duration: 330, delay, easing: 'cubic-bezier(.22,.68,0,1)', fill: 'none' }
      );
      animations.add(animation);
      animation.addEventListener?.('finish', () => animations.delete(animation), { once: true });
    } catch { /* Le contenu reste visible si l'animation est indisponible. */ }
  };
  const revealSurfaces = target => {
    if (typeof target.querySelectorAll !== 'function') return;
    const selector = ':scope > .card, :scope > section.card, .premium-stat-grid > *, .premium-v4-chart-grid > *, .fp2-metrics > *, .fp2-panels > *, .v4-layout > *, .v4-summary-grid > *, .v4-intelligence-grid > *, .v5-summary > *, .v51-change-grid > *, .v5-panel:not([hidden]) > .v5-card, .v5-insights > article';
    const surfaces = [...target.querySelectorAll(selector)].filter(node => !node.hidden && !revealedSurfaces.has(node)).slice(0, 28);
    const animations = new Set();
    const viewportHeight = window.innerHeight || 900;
    const belowFold = [];
    let visibleIndex = 0;
    surfaces.forEach(surface => {
      const rect = surface.getBoundingClientRect?.();
      if (rect && rect.bottom <= 0) return;
      if (!rect || rect.top < viewportHeight + 80) {
        animateSurface(surface, animations, Math.min(visibleIndex++, 4) * 34);
      } else belowFold.push(surface);
    });
    if (belowFold.length && typeof IntersectionObserver === 'function') {
      const observer = new IntersectionObserver(entries => {
        if (shouldReduceMotion()) { observer.disconnect(); return; }
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          animateSurface(entry.target, animations);
        });
      }, { rootMargin: '0px 0px -40px 0px', threshold: .08 });
      belowFold.forEach(surface => observer.observe(surface));
      surfaceObservers.set(target, observer);
    }
    if (animations.size || belowFold.length) runningSurfaces.set(target, animations);
  };
  const revealView = (target, media = window.matchMedia) => {
    if (!target) return false;
    if (activeSurfaceTarget && activeSurfaceTarget !== target) cancelSurfaceReveal(activeSurfaceTarget);
    activeSurfaceTarget = target;
    const old = running.get(target);
    old?.cancel?.();
    running.delete(target);
    cancelSurfaceReveal(target);
    if (shouldReduceMotion(media)) return true;
    if (typeof target.animate !== 'function') return false; // existing CSS fallback
    try {
      const animation = target.animate(
        [{ opacity: 0.65, transform: 'translate3d(0, 7px, 0)' },
         { opacity: 1, transform: 'translate3d(0, 0, 0)' }],
        { duration: 240, easing: 'cubic-bezier(.22,.68,0,1)', fill: 'none' }
      );
      running.set(target, animation);
      animation.addEventListener?.('finish', () => {
        if (running.get(target) === animation) running.delete(target);
      }, { once: true });
      const lowEndDevice = typeof navigator !== 'undefined' && Number(navigator.hardwareConcurrency) > 0 && Number(navigator.hardwareConcurrency) <= 4;
      if (!lowEndDevice) revealSurfaces(target);
      return true;
    } catch { return false; }
  };
  // Gradient cached for each Chart.js instance and chart area (no allocations per frame).
  const gradients = new WeakMap();
  const areaFill = context => {
    const chart = context?.chart;
    const area = chart?.chartArea;
    const ctx = chart?.ctx;
    if (!area || !ctx?.createLinearGradient) return 'rgba(31,97,219,.10)';
    const dark = document.body?.classList?.contains('dark-mode') || false;
    const key = `${area.top}:${area.bottom}:${dark}`;
    const existing = gradients.get(chart);
    if (existing?.key === key) return existing.gradient;
    const gradient = ctx.createLinearGradient(0, area.top, 0, area.bottom);
    gradient.addColorStop(0, dark ? 'rgba(131,181,255,.23)' : 'rgba(31,97,219,.18)');
    gradient.addColorStop(1, dark ? 'rgba(131,181,255,0)' : 'rgba(31,97,219,0)');
    gradients.set(chart, { key, gradient });
    return gradient;
  };
  const chartPalette = (body = document.body) => {
    let css = null;
    try { css = getComputedStyle(body); } catch { /* no DOM / SSR */ }
    const token = (property, fallback) => css?.getPropertyValue?.(property)?.trim() || fallback;
    const dark = body?.classList?.contains('dark-mode') || false;
    return {
      accent: token('--signature-blue', dark ? '#83b5ff' : '#1f61db'),
      income: token('--signature-green', dark ? '#54d2b2' : '#187b68'),
      expense: token('--signature-red', dark ? '#ff857e' : '#d63f3a'),
      muted: token('--apple-muted', dark ? '#a1a1aa' : '#6e6e73'),
      grid: token('--signature-chart-grid', dark ? 'rgba(195,199,216,.11)' : 'rgba(112,117,127,.11)'),
      surface: token('--apple-surface', dark ? '#202126' : '#ffffff')
    };
  };
  document.addEventListener?.('click', event => {
    const button = event.target.closest?.('[data-freev-scroll-target]');
    if (!button) return;
    const id = button.dataset.freevScrollTarget;
    if (id === 'v5Overview') window.FreevV5?.setActiveTab?.('overview');
    requestAnimationFrame(() => {
      const target = document.getElementById(id);
      if (!target) return;
      target.scrollIntoView({ behavior: shouldReduceMotion() ? 'auto' : 'smooth', block: 'start' });
      target.focus?.({ preventScroll: true });
    });
  });
  window.FreevSignature2 = Object.freeze({ revealView, chartPalette, shouldReduceMotion, areaFill });
})();
