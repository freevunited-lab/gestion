/* Motion shared by the dashboard, planner and monthly report charts. */
(() => {
  'use strict';

  const isReduced = () => {
    try {
      return Boolean(
        window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ||
        (typeof document !== 'undefined' && document.visibilityState === 'hidden') ||
        (typeof navigator !== 'undefined' && (
          navigator.connection?.saveData ||
          (Number(navigator.hardwareConcurrency) > 0 && Number(navigator.hardwareConcurrency) <= 4)
        ))
      );
    } catch (_) {
      return true;
    }
  };

  const pointDelay = (context, pointStep, datasetStep, maxDelay) => {
    if (context.type !== 'data') return 0;
    const point = Math.max(0, Number(context.dataIndex) || 0);
    const dataset = Math.max(0, Number(context.datasetIndex) || 0);
    return Math.min(maxDelay, point * pointStep + dataset * datasetStep);
  };

  function entry({ duration = 760, pointStep = 20, datasetStep = 48, maxDelay = 420, easing = 'easeOutQuart' } = {}) {
    if (isReduced()) return false;
    return {
      duration,
      easing,
      delay: context => pointDelay(context, pointStep, datasetStep, maxDelay)
    };
  }

  function progressiveLine({ duration = 620, pointStep = 18, datasetStep = 42, maxDelay = 480 } = {}) {
    if (isReduced()) return false;
    const reveal = axis => ({
      type: 'number',
      easing: axis === 'x' ? 'linear' : 'easeOutQuart',
      duration: Math.min(70, pointStep),
      from: NaN,
      delay(context) {
        const startedKey = `${axis}Started`;
        if (context.type !== 'data' || context[startedKey]) return 0;
        context[startedKey] = true;
        return pointDelay(context, pointStep, datasetStep, maxDelay);
      }
    });

    return { x: reveal('x'), y: { ...reveal('y'), duration } };
  }

  function doughnut({ duration = 820, sliceStep = 28 } = {}) {
    if (isReduced()) return false;
    return {
      animateRotate: true,
      animateScale: false,
      duration,
      easing: 'easeOutQuart',
      delay: context => pointDelay(context, sliceStep, 0, 260)
    };
  }

  window.FreevChartMotion = Object.freeze({ isReduced, entry, progressiveLine, doughnut });
})();
