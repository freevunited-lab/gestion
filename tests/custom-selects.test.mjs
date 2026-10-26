import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('les menus déroulants Freev conservent les formulaires et le clavier', async () => {
  const source = await readFile(new URL('../assets/js/custom-selects.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../assets/css/selects.css', import.meta.url), 'utf8');

  assert.match(source, /role', 'combobox'/);
  assert.match(source, /role', 'listbox'/);
  assert.match(source, /new Event\('change', \{ bubbles: true \}\)/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /ArrowDown/);
  assert.match(css, /Uiverse component adaptation: Switch by m1her/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
