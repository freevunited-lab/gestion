import test from 'node:test';
import assert from 'node:assert/strict';
import { assessReceiptImage, assessLiveReceiptFrame, scoreReceiptCaptureFrame, receiptFrameSharpness, receiptContrastLevels, receiptRotationAngles, adaptiveReceiptBinarize, detectReceiptBounds, detectReceiptPerspective } from '../assets/js/receipt-image-quality.mjs';

function image(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = pixel(x, y), index = (y * width + x) * 4;
    data[index] = data[index + 1] = data[index + 2] = value;
    data[index + 3] = 255;
  }
  return { data, width, height };
}

test('signale les captures vides, trop sombres et trop petites', () => {
  assert.equal(assessReceiptImage(null, 0, 0).usable, false);
  assert.ok(assessReceiptImage(image(32, 32, () => 20), 1200, 1800).issues.includes('photo trop sombre'));
  assert.ok(assessReceiptImage(image(32, 32, (x, y) => (x + y) % 2 ? 255 : 0), 400, 700).issues.includes('photo trop petite'));
});

test('un texte contrasté sur papier clair peut être lu', () => {
  const result = assessReceiptImage(image(64, 64, (x, y) => y % 8 < 2 && x > 5 && x < 55 ? 18 : 240), 1200, 1800);
  assert.equal(result.usable, true);
});

test('choisit la trame avec des contours de texte plus nets', () => {
  const crisp = image(64, 64, (x, y) => x > 8 && x < 56 && y % 10 < 2 ? 20 : 240);
  const blurred = image(64, 64, (x, y) => x > 8 && x < 56 && y % 10 < 2 ? 170 : 205);
  assert.ok(receiptFrameSharpness(crisp) > receiptFrameSharpness(blurred));
  assert.equal(receiptFrameSharpness(null), 0);
});

test('la normalisation étire un contraste utile et évite les images presque uniformes', () => {
  const histogram = new Uint32Array(256);
  histogram[70] = 10; histogram[220] = 90;
  assert.deepEqual(receiptContrastLevels(histogram, 100), { low: 70, high: 220 });
  const flat = new Uint32Array(256); flat[225] = 100;
  assert.equal(receiptContrastLevels(flat, 100), null);
});

test('la relecture orientée est réservée aux tickets largement illisibles', () => {
  assert.deepEqual(receiptRotationAngles(1800, 900, { amount: '', date: null, merchant: '' }), [90, 270]);
  assert.deepEqual(receiptRotationAngles(900, 1800, { amount: '', date: null, merchant: '' }), [180]);
  assert.deepEqual(receiptRotationAngles(900, 1800, { amount: '12,40', date: '2026-10-25', merchant: '' }), []);
});

test('le seuil local retrouve un texte pâle malgré un éclairage inégal', () => {
  const photo = image(96, 48, (x, y) => {
    const paper = 155 + Math.round(x * .8);
    return y >= 20 && y <= 23 && x >= 12 && x <= 84 ? paper - 32 : paper;
  });
  const result = adaptiveReceiptBinarize(photo, 10, 9);
  assert.ok(result?.inkRatio > .01);
  assert.equal(photo.data[(21 * photo.width + 30) * 4], 0);
  assert.equal(photo.data[(7 * photo.width + 30) * 4], 255);
  const empty = image(64, 64, () => 215);
  assert.equal(adaptiveReceiptBinarize(empty), null);
});

test('cadre prudemment un ticket clair sur fond sombre et garde les scènes incertaines', () => {
  const framed = image(200, 300, (x, y) => x >= 55 && x < 145 && y >= 20 && y < 280 ? 235 : 35);
  const bounds = detectReceiptBounds(framed);
  assert.ok(bounds);
  assert.ok(bounds.left < 55 / 200 && bounds.left > .15);
  assert.ok(bounds.left + bounds.width > 145 / 200);
  assert.ok(bounds.top < 20 / 300);
  assert.ok(bounds.top + bounds.height > 280 / 300);
  assert.equal(detectReceiptBounds(image(200, 300, () => 238)), null);
  assert.equal(detectReceiptBounds(image(200, 300, (x, y) => x > 55 && x < 145 && y > 115 && y < 170 ? 235 : 35)), null);
});

test('redresse seulement une perspective marquée et visible', () => {
  const tilted = image(200, 300, (x, y) => {
    if (y < 20 || y >= 280) return 35;
    const fraction = (y - 20) / 260;
    return x >= 38 + 30 * fraction && x <= 160 - 18 * fraction ? 235 : 35;
  });
  const corners = detectReceiptPerspective(tilted);
  assert.ok(corners);
  assert.ok(corners.bottomLeft.x > corners.topLeft.x);
  assert.ok(corners.bottomRight.x < corners.topRight.x);
  const straight = image(200, 300, (x, y) => x >= 55 && x < 145 && y >= 20 && y < 280 ? 235 : 35);
  assert.equal(detectReceiptPerspective(straight), null);
  assert.equal(detectReceiptPerspective(image(200, 300, () => 235)), null);
});

test('le guide caméra indique lumière, distance et stabilité sans bloquer la capture', () => {
  assert.equal(assessLiveReceiptFrame(null, 1200, 1600).status, 'wait');
  assert.equal(assessLiveReceiptFrame(image(100, 120, () => 20), 1200, 1600).status, 'light');
  const distant = image(200, 300, (x, y) => x >= 77 && x < 123 && y >= 80 && y < 220 ? 235 : 30);
  assert.equal(assessLiveReceiptFrame(distant, 1200, 1600).status, 'distance');
  assert.equal(assessLiveReceiptFrame(image(100, 120, () => 180), 1200, 1600).status, 'steady');
  const readable = image(100, 120, (x, y) => y % 8 < 2 && x > 5 && x < 95 ? 18 : 240);
  assert.equal(assessLiveReceiptFrame(readable, 1200, 1600).status, 'ready');
});

test('la rafale privilégie un texte lisible plutôt qu’un cadre sombre très contrasté', () => {
  const readable = image(100, 120, (x, y) => y % 8 < 2 && x > 5 && x < 95 ? 18 : 240);
  const dark = image(100, 120, (x, y) => (x + y) % 2 ? 0 : 80);
  const blank = image(100, 120, () => 230);
  assert.ok(scoreReceiptCaptureFrame(readable, 1200, 1600) > scoreReceiptCaptureFrame(dark, 1200, 1600));
  assert.ok(scoreReceiptCaptureFrame(readable, 1200, 1600) > scoreReceiptCaptureFrame(blank, 1200, 1600));
  assert.equal(scoreReceiptCaptureFrame(null, 1200, 1600), -Infinity);
});
