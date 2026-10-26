import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../assets/css/site-motion.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('../assets/js/premium-priority3.js', import.meta.url), 'utf8');

test('épargne et réglages ont chacun une animation identifiable', () => {
  assert.match(js, /art-savings-basket/);
  assert.match(js, /art-savings-glint/);
  assert.match(js, /art-slider-progress-one/);
  assert.match(css, /@keyframes freevSavingsCoin/);
  assert.match(css, /@keyframes freevSavingsBasket/);
  assert.match(css, /@keyframes freevSettingsSlider/);
  assert.match(css, /@keyframes freevSettingsTrack/);
});

test('les illustrations redeviennent statiques lorsque le mouvement est réduit', () => {
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)[\s\S]*\.freev-workspace-illustration svg \*/);
  assert.match(css, /\.freev-workspace-illustration svg \* \{animation:none!important/);
});
