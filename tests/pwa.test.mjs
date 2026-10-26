import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function pngSize(relativePath) {
  const buffer = fs.readFileSync(path.join(root, relativePath));
  assert.equal(buffer.subarray(1, 4).toString(), 'PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('la PWA possède un manifeste, les icônes iPhone/Android et un cache 5.1 cohérents', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.start_url.includes('source=pwa'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192' && icon.type === 'image/png'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'));
  assert.deepEqual(pngSize('assets/icons/apple-touch-icon.png'), { width: 180, height: 180 });
  assert.deepEqual(pngSize('assets/icons/icon-192.png'), { width: 192, height: 192 });
  assert.deepEqual(pngSize('assets/icons/icon-512.png'), { width: 512, height: 512 });
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /apple-touch-icon\.png/);
  assert.match(serviceWorker, /freev-v5\.2\.0/);
  assert.match(serviceWorker, /pwa-install\.js/);
  assert.match(serviceWorker, /v5-engine\.js/);
  assert.match(serviceWorker, /v5\.css/);
  assert.match(serviceWorker, /help\.css/);
  assert.match(serviceWorker, /help\.js/);
  assert.ok(manifest.shortcuts.some(shortcut => shortcut.url.includes('view=smart')));
});
