import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('les contrôles animés restent accessibles et respectent les mouvements réduits', async () => {
  const css = await readFile(new URL('../assets/css/app.css', import.meta.url), 'utf8');

  assert.match(css, /Uiverse component adaptation: Switch by m1her/);
  assert.match(css, /\.btn:focus-visible/);
  assert.match(css, /\.form-select\s*\{[\s\S]*appearance:\s*none/);
  assert.match(css, /\.form-select:hover/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.freev-motion-button/);

  const buttonCss = await readFile(new URL('../assets/css/buttons.css', import.meta.url), 'utf8');
  const buttonScript = await readFile(new URL('../assets/js/button-motion.js', import.meta.url), 'utf8');
  assert.match(buttonCss, /Uiverse component adaptation: Button by gharsh11032000/);
  assert.match(buttonCss, /loud-chicken-53/);
  assert.match(buttonCss, /\.freev-button-ripple/);
  assert.match(buttonCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(buttonScript, /prefers-reduced-motion: reduce/);
  assert.match(buttonScript, /freev-button-ripple/);

  const themeCss = await readFile(new URL('../assets/css/theme-toggle.css', import.meta.url), 'utf8');
  assert.match(themeCss, /Uiverse component adaptation: Switch by m1her/);
  assert.match(themeCss, /\[aria-pressed="true"\]/);
  assert.match(themeCss, /@media \(prefers-reduced-motion: reduce\)/);
});

test('le graphique prévisionnel garde son accent FREEV et ne coupe pas la courbe sur mobile', async () => {
  const css = await readFile(new URL('../assets/css/v4.css', import.meta.url), 'utf8');
  const script = await readFile(new URL('../assets/js/v4.js', import.meta.url), 'utf8');
  assert.match(css, /\.v42-forecast-line[^}]*stroke:\s*#16836b/);
  assert.match(css, /\.v42-forecast-chart svg \{[^}]*width:\s*100%/);
  assert.doesNotMatch(css, /\.v42-forecast-chart svg \{[^}]*width:\s*160%/);
  assert.match(script, /stop-color="#16836b"/);
});
