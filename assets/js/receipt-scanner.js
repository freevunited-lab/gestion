import { parseFrenchReceipt, reconcileReceiptReads, canPrefillReceiptTransaction, receiptFieldConfidence } from './receipt-scan-engine.mjs';
import { assessReceiptImage, assessLiveReceiptFrame, scoreReceiptCaptureFrame, receiptContrastLevels, receiptRotationAngles, adaptiveReceiptBinarize, detectReceiptBounds, detectReceiptPerspective } from './receipt-image-quality.mjs';
import { extractReceiptQrText } from './receipt-qr.mjs';
import { findLikelyReceiptDuplicates } from './receipt-duplicate.mjs';
import { createReceiptRecoveryBudget, shouldTryAlternateReceiptLayout } from './receipt-recovery.mjs';
import { receiptLearningKey, learnMerchantCorrection, suggestMerchantCorrection } from './receipt-learning.mjs';

const $ = id => document.getElementById(id);
const dialog = $('receiptScannerDialog');
const mobileQuery = window.matchMedia('(max-width: 768px), (pointer: coarse) and (max-width: 1024px), (horizontal-viewport-segments: 2), (vertical-viewport-segments: 2)');
const vendorRoot = new URL('../vendor/tesseract/', import.meta.url);
let transactionPreviewUrl = '';
const state = {
  stream: null,
  worker: null,
  workerPromise: null,
  scriptPromise: null,
  photo: null,
  photoUrl: '',
  preparedCanvas: null,
  ocrDone: false,
  qualityOverride: false,
  capturePending: false,
  captureEpoch: 0,
  cameraGuideTimer: 0,
  visualStage: 0,
  secondaryRead: false,
  detectedCurrency: null,
  documentKind: 'expense',
  ocrMerchant: '',
  accountId: null,
  currency: 'EUR',
  jobId: 0,
  busy: false,
  idleTimer: 0
};

function clearTransactionPreview() {
  if (transactionPreviewUrl) URL.revokeObjectURL(transactionPreviewUrl);
  transactionPreviewUrl = '';
  $('receiptPrefillImage')?.removeAttribute('src');
  $('receiptPrefillPhoto')?.classList.add('hidden');
}

const STAGES = new Map([
  ['loading tesseract core', 'Préparation du moteur'],
  ['loading language traineddata', 'Chargement du modèle français'],
  ['initializing api', 'Initialisation de la lecture'],
  ['recognizing text', 'Lecture du ticket'],
  ['checking receipt', 'Vérification complémentaire']
]);

function appState() { return window._getAppState?.() || { accounts: [], currentAccountId: null }; }
function receiptLearningStorage() { try { return window.localStorage; } catch (_) { return null; } }
function currentAccount(snapshot = appState()) {
  return snapshot.accounts?.find(account => String(account.id) === String(snapshot.currentAccountId)) || snapshot.accounts?.[0] || null;
}
function announce(message) {
  const node = $('receiptScannerAlert');
  if (!node) return;
  node.textContent = message;
  node.hidden = !message;
}
function clearAlert() { announce(''); }
function stopCamera() {
  state.captureEpoch++;
  state.capturePending = false;
  if (state.cameraGuideTimer) window.clearTimeout(state.cameraGuideTimer);
  state.cameraGuideTimer = 0;
  const captureButton = $('receiptScanCapture');
  if (captureButton) captureButton.disabled = false;
  $('receiptCameraFrame')?.classList.remove('is-capturing');
  $('receiptCameraFrame')?.removeAttribute('data-quality');
  state.stream?.getTracks?.().forEach(track => track.stop());
  state.stream = null;
  const video = $('receiptCameraVideo');
  if (video) { video.pause(); video.srcObject = null; }
}
function startCameraGuidance(video) {
  const epoch = state.captureEpoch;
  const initialHint = 'Cadrez le ticket entier et gardez le téléphone stable.';
  if ($('receiptCameraHint')) $('receiptCameraHint').textContent = initialHint;
  if ($('receiptCameraHudText')) $('receiptCameraHudText').textContent = 'Cadrez le ticket entier';
  $('receiptCameraFrame')?.removeAttribute('data-quality');
  const probe = document.createElement('canvas');
  probe.width = 192;
  probe.height = Math.max(64, Math.min(320, Math.round(192 * (video.videoHeight || 4) / (video.videoWidth || 3))));
  const context = probe.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  let pendingStatus = '', repeats = 0, shownStatus = '';
  const tick = () => {
    if (epoch !== state.captureEpoch || !state.stream || !dialog?.open) return;
    if (!state.capturePending && video.readyState >= 2) {
      try {
        context.drawImage(video, 0, 0, probe.width, probe.height);
        const advice = assessLiveReceiptFrame(context.getImageData(0, 0, probe.width, probe.height), video.videoWidth, video.videoHeight);
        repeats = advice.status === pendingStatus ? repeats + 1 : 1;
        pendingStatus = advice.status;
        if (repeats >= 2 && shownStatus !== advice.status) {
          shownStatus = advice.status;
          const hint = $('receiptCameraHint');
          const hud = $('receiptCameraHudText');
          if (hint) hint.textContent = advice.message;
          if (hud) hud.textContent = advice.message;
          const frame = $('receiptCameraFrame');
          if (frame) frame.dataset.quality = advice.status === 'ready' ? 'ready' : 'adjust';
        }
      } catch (_) { /* Le guide reste facultatif ; la caméra peut capturer. */ }
    }
    state.cameraGuideTimer = window.setTimeout(tick, 420);
  };
  state.cameraGuideTimer = window.setTimeout(tick, 350);
}
function clearPhoto() {
  if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
  state.photoUrl = '';
  state.photo = null;
  state.preparedCanvas = null;
  state.ocrDone = false;
  state.detectedCurrency = null;
  state.documentKind = 'expense';
  state.ocrMerchant = '';
  if ($('receiptScannerActionLabel')) $('receiptScannerActionLabel').textContent = 'AJOUTER UNE DÉPENSE';
  state.qualityOverride = false;
  const preview = $('receiptScanPreview');
  if (preview) preview.removeAttribute('src');
}
function setScreen(name) {
  const screens = {
    start: $('receiptScannerStart'),
    camera: $('receiptScannerCamera'),
    review: $('receiptScannerReview'),
    processing: $('receiptScannerProcessing')
  };
  Object.entries(screens).forEach(([key, node]) => { if (node) node.hidden = key !== name; });
  const footer = $('receiptScannerFooter');
  if (footer) footer.hidden = name === 'processing';
  const analyze = $('receiptScanAnalyze');
  const proceed = $('receiptScanContinue');
  if (analyze) analyze.hidden = name !== 'review' || !state.photo || state.ocrDone;
  if (proceed) proceed.hidden = name !== 'review' || !state.photo || !state.ocrDone;
}

function assessPreparedCanvas(canvas) {
  const probe = document.createElement('canvas');
  const scale = Math.min(1, 256 / Math.max(canvas.width, canvas.height));
  probe.width = Math.max(1, Math.round(canvas.width * scale));
  probe.height = Math.max(1, Math.round(canvas.height * scale));
  const context = probe.getContext('2d', { willReadFrequently: true });
  if (!context) return { usable: true, issues: [] };
  context.drawImage(canvas, 0, 0, probe.width, probe.height);
  try { return assessReceiptImage(context.getImageData(0, 0, probe.width, probe.height), canvas.receiptSourceWidth || canvas.width, canvas.receiptSourceHeight || canvas.height); }
  catch (_) { return { usable: true, issues: [] }; }
}

function makeContrastCanvas(source) {
  const scale = Math.min(1, Math.sqrt(2_400_000 / Math.max(1, source.width * source.height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  try {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const histogram = new Uint32Array(256);
    const gray = new Uint8Array(canvas.width * canvas.height);
    for (let index = 0; index < gray.length; index++) {
      const offset = index * 4;
      const value = Math.round(.299 * pixels.data[offset] + .587 * pixels.data[offset + 1] + .114 * pixels.data[offset + 2]);
      gray[index] = value;
      histogram[value]++;
    }
    const levels = receiptContrastLevels(histogram, gray.length);
    if (!levels) return null;
    const factor = 255 / (levels.high - levels.low);
    for (let index = 0; index < gray.length; index++) {
      const value = Math.max(0, Math.min(255, Math.round((gray[index] - levels.low) * factor)));
      const offset = index * 4;
      pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = value;
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
  } catch (_) { return null; }
}

function makeAdaptiveCanvas(source) {
  const scale = Math.min(1, Math.sqrt(2_400_000 / Math.max(1, source.width * source.height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  try {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    if (!adaptiveReceiptBinarize(pixels)) return null;
    context.putImageData(pixels, 0, 0);
    return canvas;
  } catch (_) { return null; }
}

function makeRotatedCanvas(source, angle) {
  const scale = Math.min(1, Math.sqrt(2_400_000 / Math.max(1, source.width * source.height)));
  const canvas = document.createElement('canvas');
  const quarterTurn = angle === 90 || angle === 270;
  canvas.width = Math.max(1, Math.round((quarterTurn ? source.height : source.width) * scale));
  canvas.height = Math.max(1, Math.round((quarterTurn ? source.width : source.height) * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return null;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(angle * Math.PI / 180);
  context.drawImage(source, -source.width * scale / 2, -source.height * scale / 2, source.width * scale, source.height * scale);
  return canvas;
}

async function readReceiptQr(canvas) {
  if (typeof window.BarcodeDetector !== 'function') return '';
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats?.();
    if (supported && !supported.includes('qr_code')) return '';
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    const codes = await Promise.race([
      detector.detect(canvas),
      new Promise(resolve => window.setTimeout(() => resolve([]), 1200))
    ]);
    return extractReceiptQrText(codes);
  } catch (_) { return ''; }
}
function setBusy(busy) {
  state.busy = busy;
  ['receiptScanAnalyze', 'receiptScanCameraStart', 'receiptScanChooseFile', 'receiptScanCapture', 'receiptScanRetake'].forEach(id => {
    const button = $(id);
    if (button) button.disabled = busy;
  });
}
function accountSummary() {
  const snapshot = appState();
  const account = currentAccount(snapshot);
  const row = $('receiptScannerAccount');
  if (row) row.querySelector('strong').textContent = account?.name || 'Aucun compte';
  return { snapshot, account };
}
function closeScanner() {
  state.capturePending = false;
  stopCamera();
  if (state.busy) {
    state.jobId += 1;
    state.busy = false;
    const worker = state.worker;
    state.worker = null;
    state.workerPromise = null;
    if (worker) void worker.terminate().catch(() => {});
  }
  clearPhoto();
  clearAlert();
  setBusy(false);
  setScreen('start');
  if (state.idleTimer) clearTimeout(state.idleTimer);
  if (state.worker) {
    state.idleTimer = window.setTimeout(() => { void releaseWorker(); }, 45_000);
  }
}
async function releaseWorker() {
  if (state.busy) return;
  const worker = state.worker;
  state.worker = null;
  state.workerPromise = null;
  if (worker) {
    try { await worker.terminate(); } catch (_) { /* déjà arrêté */ }
  }
}
function resetProgress() {
  state.visualStage = 0;
  state.secondaryRead = false;
  const screen = $('receiptScannerProcessing');
  if (screen) screen.dataset.stage = 'prepare';
  const track = $('receiptProgressTrack');
  const bar = $('receiptProgressBar');
  const value = $('receiptProgressValue');
  const title = $('receiptScanProgressTitle');
  const stage = $('receiptProgressStage');
  if (bar) bar.style.width = '0%';
  if (value) value.textContent = '';
  if (stage) stage.textContent = 'Le ticket reste sur votre appareil';
  if (title) title.textContent = 'Préparation de la lecture';
  if (track) { track.classList.add('is-indeterminate'); track.removeAttribute('aria-valuenow'); }
}
function updateProgress(message = {}) {
  if (!dialog?.open || !state.busy) return;
  const status = String(message.status || '');
  if (status === 'checking receipt') state.secondaryRead = true;
  const nextStage = status === 'checking receipt' ? 2 : status === 'recognizing text' ? 1 : 0;
  state.visualStage = Math.max(state.visualStage, nextStage);
  const screen = $('receiptScannerProcessing');
  if (screen) screen.dataset.stage = ['prepare', 'read', 'verify'][state.visualStage];
  const friendly = STAGES.get(status) || 'Traitement de la photo';
  const title = $('receiptScanProgressTitle');
  const stage = $('receiptProgressStage');
  const progressValue = $('receiptProgressValue');
  const track = $('receiptProgressTrack');
  const bar = $('receiptProgressBar');
  if (title) title.textContent = friendly;
  if (stage) stage.textContent = status === 'loading language traineddata' ? 'Modèle français · première lecture parfois plus longue'
    : status === 'checking receipt' ? 'Lecture complémentaire ciblée, toujours sur cet appareil'
      : 'Traitement local, sans envoyer la photo';
  const progress = Number(message.progress);
  if (!state.secondaryRead && Number.isFinite(progress) && progress >= 0 && progress <= 1) {
    const percent = Math.round(progress * 100);
    if (track) { track.classList.remove('is-indeterminate'); track.setAttribute('aria-valuenow', String(percent)); }
    if (bar) bar.style.width = `${percent}%`;
    if (progressValue) progressValue.textContent = `${percent} %`;
  } else {
    if (track) { track.classList.add('is-indeterminate'); track.removeAttribute('aria-valuenow'); }
    if (progressValue) progressValue.textContent = '';
  }
}
function loadTesseractScript() {
  if (window.Tesseract?.createWorker) return Promise.resolve(window.Tesseract);
  if (state.scriptPromise) return state.scriptPromise;
  state.scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('tesseract.min.js', vendorRoot).href;
    script.async = true;
    script.onload = () => window.Tesseract?.createWorker
      ? resolve(window.Tesseract)
      : reject(new Error('Le moteur de lecture est indisponible.'));
    script.onerror = () => reject(new Error('Impossible de charger le moteur local. Vérifiez la connexion puis réessayez.'));
    document.head.append(script);
  }).catch(error => { state.scriptPromise = null; throw error; });
  return state.scriptPromise;
}
async function getWorker() {
  if (state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = 0; }
  if (state.worker) return state.worker;
  if (state.workerPromise) return state.workerPromise;
  const tesseract = await loadTesseractScript();
  const creation = tesseract.createWorker('fra', 1, {
    workerPath: new URL('worker.min.js', vendorRoot).href,
    corePath: new URL('core/', vendorRoot).href,
    langPath: new URL('lang/', vendorRoot).href,
    logger: updateProgress
  });
  state.workerPromise = creation;
  try {
    const worker = await creation;
    if (state.workerPromise !== creation) {
      await worker.terminate();
      throw new Error('Lecture interrompue.');
    }
    state.worker = worker;
    state.workerPromise = null;
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    return worker;
  } catch (error) {
    if (state.workerPromise === creation) state.workerPromise = null;
    throw error;
  }
}
async function decodeReceiptPhoto(blob) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (_) {
    bitmap = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Cette photo ne peut pas être ouverte. Choisissez une autre image.')); };
      image.src = url;
    });
  }
  return bitmap;
}
async function prepareCanvas(blob) {
  const bitmap = await decodeReceiptPhoto(blob);
  const sourceWidth = bitmap.width || bitmap.naturalWidth;
  const sourceHeight = bitmap.height || bitmap.naturalHeight;
  let crop = { left: 0, top: 0, width: sourceWidth, height: sourceHeight };
  let perspective = null;
  try {
    const probe = document.createElement('canvas');
    const probeScale = Math.min(1, 512 / Math.max(sourceWidth, sourceHeight));
    probe.width = Math.max(1, Math.round(sourceWidth * probeScale));
    probe.height = Math.max(1, Math.round(sourceHeight * probeScale));
    const probeContext = probe.getContext('2d', { willReadFrequently: true });
    if (probeContext) {
      probeContext.drawImage(bitmap, 0, 0, probe.width, probe.height);
      const pixels = probeContext.getImageData(0, 0, probe.width, probe.height);
      const bounds = detectReceiptBounds(pixels);
      if (bounds) {
        perspective = detectReceiptPerspective(pixels, bounds);
        const left = Math.floor(bounds.left * sourceWidth);
        const top = Math.floor(bounds.top * sourceHeight);
        crop = { left, top, width: Math.min(sourceWidth - left, Math.ceil(bounds.width * sourceWidth)), height: Math.min(sourceHeight - top, Math.ceil(bounds.height * sourceHeight)) };
      }
    }
  } catch (_) { /* un cadrage incertain conserve la photo entière */ }
  if (perspective) {
    const points = Object.fromEntries(Object.entries(perspective).map(([key, point]) => [key, { x: point.x * sourceWidth, y: point.y * sourceHeight }]));
    const topWidth = points.topRight.x - points.topLeft.x;
    const bottomWidth = points.bottomRight.x - points.bottomLeft.x;
    const sourceHeightRectified = points.bottomLeft.y - points.topLeft.y;
    const sourceWidthRectified = Math.max(topWidth, bottomWidth);
    const scale = Math.min(1, Math.sqrt(4_200_000 / Math.max(1, sourceWidthRectified * sourceHeightRectified)));
    const rectified = document.createElement('canvas');
    rectified.width = Math.max(1, Math.round(sourceWidthRectified * scale));
    rectified.height = Math.max(1, Math.round(sourceHeightRectified * scale));
    const context = rectified.getContext('2d', { alpha: false });
    if (context) {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, rectified.width, rectified.height);
      // Bandes fines : chaque ligne suit les bords du ticket, sans charger une
      // seconde image brute de plusieurs mégapixels dans la mémoire du mobile.
      for (let y = 0; y < rectified.height; y += 2) {
        const t = (y + 1) / rectified.height;
        const left = points.topLeft.x + (points.bottomLeft.x - points.topLeft.x) * t;
        const right = points.topRight.x + (points.bottomRight.x - points.topRight.x) * t;
        const sourceSlice = Math.max(1, sourceHeightRectified * 2 / rectified.height);
        const sourceY = Math.min(sourceHeight - sourceSlice, points.topLeft.y + sourceHeightRectified * t);
        context.drawImage(bitmap, left, Math.max(0, sourceY), right - left, sourceSlice, 0, y, rectified.width, Math.min(2, rectified.height - y));
      }
      rectified.receiptSourceWidth = sourceWidthRectified;
      rectified.receiptSourceHeight = sourceHeightRectified;
      rectified.receiptOriginalPixels = sourceWidth * sourceHeight;
      rectified.receiptCrop = crop;
      rectified.receiptPerspective = true;
      bitmap.close?.();
      return rectified;
    }
  }
  const maxPixels = 4_200_000;
  const scale = Math.min(1, Math.sqrt(maxPixels / Math.max(1, crop.width * crop.height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(crop.width * scale));
  canvas.height = Math.max(1, Math.round(crop.height * scale));
  canvas.receiptSourceWidth = crop.width;
  canvas.receiptSourceHeight = crop.height;
  canvas.receiptOriginalPixels = sourceWidth * sourceHeight;
  canvas.receiptCrop = crop;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Préparation de l’image impossible sur cet appareil.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, crop.left, crop.top, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
}
function makeDetailCanvas(bitmap, fraction, baseCrop) {
  const sourceWidth = bitmap.width || bitmap.naturalWidth;
  const sourceHeight = bitmap.height || bitmap.naturalHeight;
  const crop = baseCrop || { left: 0, top: 0, width: sourceWidth, height: sourceHeight };
  const top = crop.top + Math.floor(crop.height * fraction.top);
  const bottom = Math.min(sourceHeight, crop.top + Math.ceil(crop.height * fraction.bottom));
  const cropHeight = Math.max(1, bottom - top);
  const scale = Math.min(1, Math.sqrt(2_400_000 / Math.max(1, crop.width * cropHeight)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(crop.width * scale));
  canvas.height = Math.max(1, Math.round(cropHeight * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return null;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, crop.left, top, crop.width, cropHeight, 0, 0, canvas.width, canvas.height);
  return canvas;
}
function setCategories(selected = '') {
  const select = $('receiptCategory');
  if (!select) return;
  const categories = window.getAllCategories?.() || [
    { name: 'Alimentation' }, { name: 'Transport' }, { name: 'Logement' }, { name: 'Santé' },
    { name: 'Loisirs' }, { name: 'Shopping' }, { name: 'Factures' }, { name: 'Autre' }
  ];
  select.replaceChildren(new Option('À classer', ''));
  categories.forEach(category => select.add(new Option(String(category.name), String(category.name))));
  select.value = [...select.options].some(option => option.value === selected) ? selected : '';
}
function setCurrencies(selected = 'EUR') {
  const select = $('receiptCurrency');
  if (!select) return;
  const nativeOptions = $('transCurrency') ? [...$('transCurrency').options].map(option => ({ value: option.value, label: option.textContent })) : [];
  select.replaceChildren(...nativeOptions.map(option => new Option(option.label, option.value)));
  select.value = nativeOptions.some(option => option.value === selected) ? selected : (nativeOptions[0]?.value || 'EUR');
  state.currency = select.value;
}
function updateCurrencyNote(recognizedCurrency, accountBase) {
  const note = $('receiptCurrencyNote');
  const current = $('receiptCurrency')?.value || accountBase || 'EUR';
  const available = [...($('transCurrency')?.options || [])].some(option => option.value === recognizedCurrency);
  if (recognizedCurrency && available) {
    const matches = current === recognizedCurrency;
    note.textContent = `${matches ? `Devise repérée : ${recognizedCurrency}` : `Devise choisie : ${current} ; le ticket indique ${recognizedCurrency}`} · ${current === accountBase ? 'vérifiez le montant sur la photo.' : `un taux vers ${accountBase} sera demandé avant l’enregistrement.`}`;
  } else if (recognizedCurrency) {
    note.textContent = `Le ticket semble être en ${recognizedCurrency}, non proposée par le formulaire. Le compte utilise ${accountBase} : vérifiez la devise et le montant avant de continuer.`;
  } else {
    note.textContent = current === accountBase
      ? `Devise non repérée. La devise du compte (${accountBase}) est présélectionnée ; vérifiez le ticket.`
      : `Devise sélectionnée : ${current}. FREEV demandera un taux vers ${accountBase} avant l’enregistrement.`;
  }
}
function populateReview(parsed, quality = { usable: true, issues: [] }, ocrConfidence = null) {
  state.ocrMerchant = parsed.ocrMerchant || parsed.merchant || '';
  state.documentKind = parsed.documentKind === 'refund' ? 'refund' : 'expense';
  if ($('receiptScannerActionLabel')) $('receiptScannerActionLabel').textContent = state.documentKind === 'refund' ? 'AJOUTER UN REMBOURSEMENT' : 'AJOUTER UNE DÉPENSE';
  const merchant = $('receiptMerchant');
  const amount = $('receiptAmount');
  const date = $('receiptDate');
  const description = $('receiptDescription');
  if (merchant) merchant.value = parsed.merchant || '';
  if (amount) amount.value = parsed.amount || '';
  if (date) date.value = parsed.date || '';
  if ($('receiptTime')) $('receiptTime').value = parsed.time || '';
  if (description) description.value = parsed.description || 'Ticket de caisse';
  const confidence = receiptFieldConfidence(parsed);
  const labels = { high: 'Repéré', medium: 'À confirmer', review: 'À vérifier', optional: 'Facultative' };
  for (const field of ['merchant', 'amount', 'date', 'time']) {
    const node = $(`receipt${field[0].toUpperCase()}${field.slice(1)}Confidence`);
    if (node) {
      const weakRead = Number.isFinite(ocrConfidence) && ocrConfidence < 45;
      const level = (!quality.usable || weakRead) && confidence[field] !== 'optional' ? 'review' : confidence[field];
      node.textContent = labels[level]; node.dataset.confidence = level;
    }
  }
  setCategories(parsed.category || '');
  const account = currentAccount();
  const baseCurrency = String(account?.settings?.baseCurrency || 'EUR').toUpperCase();
  const detected = parsed.currency;
  state.detectedCurrency = detected;
  const formSupports = [...($('transCurrency')?.options || [])].some(option => option.value === detected);
  setCurrencies(formSupports ? detected : baseCurrency);
  state.currency = $('receiptCurrency')?.value || baseCurrency;
  updateCurrencyNote(detected, baseCurrency);
  const note = $('receiptReviewNote');
  const missing = parsed.missing || [];
  const ambiguous = parsed.ambiguous || [];
  const issues = [...new Set([...missing, ...ambiguous])];
  note.textContent = !quality.usable
    ? `Photo difficile à lire (${quality.issues.join(', ')}). Comparez chaque champ à la photo avant d’enregistrer.`
    : issues.length
    ? `À vérifier : ${issues.join(', ')}. Les lectures contradictoires restent vides ; aucune valeur n’a été inventée.`
    : 'Les champs sont préremplis à partir du ticket. Comparez-les à la photo avant de continuer.';
  if (Number.isFinite(ocrConfidence) && ocrConfidence < 45) note.textContent = `Lecture du texte peu fiable : vérifiez chaque champ sur la photo. ${note.textContent}`;
  if (parsed.learnedMerchant) note.textContent = `Magasin proposé d’après vos corrections précédentes : confirmez-le sur la photo. ${note.textContent}`;
  if (state.documentKind === 'refund') note.textContent = `Ce ticket semble être un remboursement. Vérifiez le montant et le type d’opération avant de l’enregistrer comme revenu. ${note.textContent}`;
  const continueButton = $('receiptScanContinue');
  if (continueButton) continueButton.innerHTML = state.documentKind === 'refund'
    ? '<i class="fa-solid fa-arrow-right" aria-hidden="true"></i> Vérifier le remboursement'
    : '<i class="fa-solid fa-arrow-right" aria-hidden="true"></i> Vérifier la dépense';
  if (issues.length) announce(`Lecture à vérifier : ${issues.join(', ')}.`);
  else clearAlert();
  $('receiptAmount')?.focus();
}
function setPhoto(blob) {
  stopCamera();
  clearPhoto();
  state.photo = blob;
  state.photoUrl = URL.createObjectURL(blob);
  const preview = $('receiptScanPreview');
  if (preview) preview.src = state.photoUrl;
  setScreen('review');
  clearAlert();
  const analyze = $('receiptScanAnalyze');
  if (analyze) analyze.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Lire le ticket';
  $('receiptScanAnalyze')?.focus();
}
async function startCamera() {
  if (!mobileQuery.matches) return;
  clearAlert();
  if (!navigator.mediaDevices?.getUserMedia) {
    announce('L’appareil photo direct n’est pas disponible ici. Choisissez une photo de ticket.');
    return;
  }
  const button = $('receiptScanCameraStart');
  if (button) button.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 }, height: { ideal: 2200 } }, audio: false });
    if (!dialog.open) { stream.getTracks().forEach(track => track.stop()); return; }
    state.stream = stream;
    const video = $('receiptCameraVideo');
    video.srcObject = stream;
    await video.play();
    setScreen('camera');
    startCameraGuidance(video);
    $('receiptScanCapture')?.focus();
  } catch (error) {
    if (state.stream) stopCamera();
    const permission = error?.name === 'NotAllowedError' ? 'Autorisez l’accès à la caméra dans les réglages du navigateur.'
      : error?.name === 'NotFoundError' ? 'Aucune caméra n’a été trouvée.'
        : 'La caméra ne peut pas démarrer sur cet appareil.';
    announce(`${permission} Vous pouvez choisir une photo à la place.`);
  } finally {
    if (button) button.disabled = false;
  }
}
async function captureFrame() {
  if (state.capturePending) return;
  const video = $('receiptCameraVideo');
  if (!video?.videoWidth || !video.videoHeight) return announce('Attendez que l’aperçu soit prêt, puis reprenez la photo.');
  state.capturePending = true;
  const captureEpoch = state.captureEpoch;
  const captureButton = $('receiptScanCapture');
  if (captureButton) captureButton.disabled = true;
  const cameraFrame = $('receiptCameraFrame');
  cameraFrame?.classList.remove('is-capturing');
  void cameraFrame?.offsetWidth;
  cameraFrame?.classList.add('is-capturing');
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, Math.sqrt(4_200_000 / (video.videoWidth * video.videoHeight)));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext('2d', { alpha: false });
  try {
    if (!context) throw new Error('canvas unavailable');
    const probe = document.createElement('canvas');
    probe.width = 256;
    probe.height = Math.max(64, Math.round(256 * video.videoHeight / video.videoWidth));
    const probeContext = probe.getContext('2d', { willReadFrequently: true });
    let bestScore = -1;
    // Trois images en 180 ms : une main qui bouge ne condamne plus tout le scan.
    for (let sample = 0; sample < 3; sample++) {
      if (captureEpoch !== state.captureEpoch || !dialog?.open) return;
      if (sample) await new Promise(resolve => window.setTimeout(resolve, 90));
      if (captureEpoch !== state.captureEpoch || !dialog?.open) return;
      let score = 0;
      if (probeContext) {
        probeContext.drawImage(video, 0, 0, probe.width, probe.height);
        score = scoreReceiptCaptureFrame(probeContext.getImageData(0, 0, probe.width, probe.height), video.videoWidth, video.videoHeight);
      }
      if (sample === 0 || score > bestScore) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        bestScore = score;
      }
    }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .93));
    if (captureEpoch !== state.captureEpoch || !dialog?.open) return;
    if (!blob) throw new Error('image unavailable');
    setPhoto(blob);
    void analyzePhoto();
  } catch (_) {
    if (captureEpoch === state.captureEpoch) announce('La photo n’a pas pu être enregistrée. Reprenez-la ou choisissez une photo.');
  } finally {
    if (captureEpoch === state.captureEpoch) {
      cameraFrame?.classList.remove('is-capturing');
      state.capturePending = false;
      if (captureButton) captureButton.disabled = false;
    }
  }
}
function choosePhoto(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) return announce('Choisissez une photo au format image.');
  if (file.size > 25 * 1024 * 1024) return announce('Cette photo dépasse 25 Mo. Prenez une image plus légère ou recadrez le ticket.');
  setPhoto(file);
  void analyzePhoto();
}
async function analyzePhoto() {
  if (!state.photo || state.busy) return;
  const runId = ++state.jobId;
  setBusy(true);
  clearAlert();
  resetProgress();
  setScreen('processing');
  stopCamera();
  try {
    state.preparedCanvas = await prepareCanvas(state.photo);
    if (runId !== state.jobId) return;
    const quality = assessPreparedCanvas(state.preparedCanvas);
    if (!quality.usable && !state.qualityOverride) {
      setScreen('review');
      const analyze = $('receiptScanAnalyze');
      if (analyze) analyze.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Lire quand même';
      announce(`La photo semble difficile à lire (${quality.issues.join(', ')}). Reprenez-la avec plus de lumière et le ticket bien à plat, ou choisissez « Lire quand même ».`);
      return;
    }
    updateProgress({ status: 'loading tesseract core' });
    const worker = await getWorker();
    if (runId !== state.jobId) { await worker.terminate(); return; }
    const result = await worker.recognize(state.preparedCanvas);
    if (runId !== state.jobId) return;
    const firstText = result?.data?.text || '';
    const firstParsed = parseFrenchReceipt(firstText);
    const recovery = createReceiptRecoveryBudget(4);
    const reads = [firstText];
    const qrText = await readReceiptQr(state.preparedCanvas);
    if (runId !== state.jobId) return;
    if (qrText) reads.push(qrText);
    let secondReadFailed = false;
    if (shouldTryAlternateReceiptLayout(firstParsed, result?.data?.confidence, state.preparedCanvas.width, state.preparedCanvas.height)) {
      updateProgress({ status: 'checking receipt' });
      let alternateModeReady = false;
      try {
        await worker.setParameters({ tessedit_pageseg_mode: '11' });
        alternateModeReady = true;
        const alternate = await recovery.recognize(worker, state.preparedCanvas);
        if (runId !== state.jobId) return;
        if (alternate?.data?.text) reads.push(alternate.data.text);
      } catch (_) {
        // La première lecture reste exploitable si le passage complémentaire échoue.
        secondReadFailed = true;
      } finally {
        if (alternateModeReady) {
          try { await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' }); }
          catch (_) {
            secondReadFailed = true;
            if (state.worker === worker) state.worker = null;
            state.workerPromise = null;
            try { await worker.terminate(); } catch (_) { /* le worker sera recréé au prochain scan */ }
          }
        }
      }
    }
    if (runId !== state.jobId) return;
    let preliminary = reads.length > 1 ? reconcileReceiptReads(reads) : firstParsed;
    const rotationAngles = receiptRotationAngles(state.preparedCanvas.width, state.preparedCanvas.height, preliminary);
    if (rotationAngles.length) {
      let bestText = '';
      let bestScore = [preliminary.amount, preliminary.date, preliminary.merchant].filter(Boolean).length;
      updateProgress({ status: 'checking receipt' });
      for (const angle of rotationAngles) {
        if (!recovery.remaining) break;
        const rotatedCanvas = makeRotatedCanvas(state.preparedCanvas, angle);
        if (!rotatedCanvas) continue;
        try {
          const rotated = await recovery.recognize(worker, rotatedCanvas);
          if (runId !== state.jobId) return;
          const candidateText = rotated?.data?.text || '';
          const candidate = parseFrenchReceipt(candidateText);
          const score = [candidate.amount, candidate.date, candidate.merchant].filter(Boolean).length;
          if (score > bestScore) { bestScore = score; bestText = candidateText; }
          if (score === 3 && !candidate.ambiguous.length) break;
        } catch (_) { /* La lecture initiale reste disponible. */ }
      }
      if (bestText) {
        reads.splice(0, reads.length, bestText);
        if (qrText) reads.push(qrText);
        preliminary = reads.length > 1 ? reconcileReceiptReads(reads) : parseFrenchReceipt(bestText);
      }
    }
    const regionReserve = Number(!preliminary.date || !preliminary.merchant) + Number(!preliminary.amount || !preliminary.date || preliminary.amountEvidence === 'montant-sans-libelle');
    if (recovery.remaining > regionReserve && quality.usable && quality.metrics?.contrast < 45 && (!preliminary.amount || !preliminary.date || preliminary.ambiguous?.length)) {
      const contrastCanvas = makeContrastCanvas(state.preparedCanvas);
      if (contrastCanvas) {
        updateProgress({ status: 'checking receipt' });
        try {
          const enhanced = await recovery.recognize(worker, contrastCanvas);
          if (runId !== state.jobId) return;
          if (enhanced?.data?.text?.trim()) reads.push(enhanced.data.text);
          preliminary = reconcileReceiptReads(reads);
        } catch (_) { /* la photo originale garde sa priorité */ }
      }
    }
    if (runId !== state.jobId) return;
    if (!preliminary.amount || !preliminary.date || !preliminary.merchant || preliminary.ambiguous?.length || preliminary.amountEvidence === 'montant-sans-libelle') {
      const topHeight = Math.max(1, Math.round(state.preparedCanvas.height * .48));
      const bottomTop = Math.round(state.preparedCanvas.height * .48);
      const regions = [];
      if (!preliminary.date || !preliminary.merchant || preliminary.ambiguous?.includes('date') || preliminary.ambiguous?.includes('magasin'))
        regions.push({ rectangle: { left: 0, top: 0, width: state.preparedCanvas.width, height: topHeight }, fraction: { top: 0, bottom: .52 }, fields: ['merchant', 'date', 'time', 'currency'] });
      if (!preliminary.amount || !preliminary.date || preliminary.amountEvidence === 'montant-sans-libelle' || preliminary.ambiguous?.includes('montant') || preliminary.ambiguous?.includes('date'))
        regions.push({ rectangle: { left: 0, top: bottomTop, width: state.preparedCanvas.width, height: state.preparedCanvas.height - bottomTop }, fraction: { top: .48, bottom: 1 }, fields: ['amountMinor', 'date', 'time', 'currency'] });
      if (!preliminary.amount || preliminary.amountEvidence === 'montant-sans-libelle') regions.reverse();
      if (regions.length) {
        updateProgress({ status: 'checking receipt' });
        const sourcePixels = state.preparedCanvas.receiptOriginalPixels;
        const useSource = !state.preparedCanvas.receiptPerspective && sourcePixels <= 16_000_000 && state.preparedCanvas.receiptSourceWidth > state.preparedCanvas.width * 1.15;
        let original = null;
        if (useSource) {
          try { original = await decodeReceiptPhoto(state.photo); }
          catch (_) { /* la version préparée reste disponible */ }
        }
        try {
          if (runId !== state.jobId) return;
          for (const region of regions) {
            if (!recovery.remaining) break;
            try {
              const detail = original ? makeDetailCanvas(original, region.fraction, state.preparedCanvas.receiptCrop) : null;
              const result = detail
                ? await recovery.recognize(worker, detail)
                : await recovery.recognize(worker, state.preparedCanvas, { rectangle: region.rectangle });
              if (runId !== state.jobId) return;
              if (result?.data?.text?.trim()) {
                reads.push({ text: result.data.text, fields: region.fields });
                const updated = reconcileReceiptReads(reads);
                if (updated.amount && updated.date && updated.merchant && !updated.ambiguous.length && updated.amountEvidence !== 'montant-sans-libelle') break;
              }
            } catch (_) { /* le résultat complet reste disponible */ }
          }
        } finally { original?.close?.(); }
      }
    }
    if (runId !== state.jobId) return;
    const beforeAdaptive = reads.length > 1 ? reconcileReceiptReads(reads) : parseFrenchReceipt(reads[0]);
    if (recovery.remaining && (!beforeAdaptive.amount || !beforeAdaptive.date || beforeAdaptive.amountEvidence === 'montant-sans-libelle') && !beforeAdaptive.ambiguous?.length) {
      const adaptiveCanvas = makeAdaptiveCanvas(state.preparedCanvas);
      if (adaptiveCanvas) {
        updateProgress({ status: 'checking receipt' });
        try {
          const adaptive = await recovery.recognize(worker, adaptiveCanvas);
          if (runId !== state.jobId) return;
          const candidateText = adaptive?.data?.text || '';
          const candidate = parseFrenchReceipt(candidateText);
          if (candidate.amount || candidate.date) reads.push(candidateText);
        } catch (_) { /* le scan reste vérifiable avec les lectures précédentes */ }
      }
    }
    if (runId !== state.jobId) return;
    let parsed = reads.length > 1 ? reconcileReceiptReads(reads) : parseFrenchReceipt(reads[0]);
    if (parsed.merchant && !parsed.merchantRecognized) {
      const key = receiptLearningKey(window.__freevUserId, state.accountId);
      const learned = suggestMerchantCorrection(receiptLearningStorage(), key, parsed.merchant);
      if (learned) parsed = { ...parsed, ocrMerchant: parsed.merchant, merchant: learned, description: `Ticket · ${learned}`, learnedMerchant: true };
    }
    state.ocrDone = true;
    const weakOcr = Number.isFinite(Number(result?.data?.confidence)) && Number(result.data.confidence) < 45;
    populateReview(parsed, quality, Number(result?.data?.confidence));
    if (secondReadFailed) announce('La vérification complémentaire n’a pas abouti. Contrôlez chaque champ avec la photo avant de continuer.');
    else if (!quality.usable) announce('Photo difficile à lire : vérifiez chaque information avec la photo avant de continuer.');
    setScreen('review');
    const accountCurrency = String(currentAccount()?.settings?.baseCurrency || 'EUR').toUpperCase();
    const possibleDuplicates = findLikelyReceiptDuplicates(currentAccount()?.transactions, { ...parsed, type: parsed.documentKind === 'refund' ? 'income' : 'expense' }, accountCurrency);
    if (possibleDuplicates.length) announce('Ce ticket ressemble à une dépense déjà enregistrée sur ce compte. Vérifiez la date, le magasin, le montant et l’heure avant de continuer.');
    if (!possibleDuplicates.length && !parsed.learnedMerchant && canPrefillReceiptTransaction(parsed, accountCurrency, secondReadFailed || !quality.usable || weakOcr)) {
      continueToTransaction();
      return;
    }
    if (!parsed.amount) $('receiptAmount')?.focus();
    else if (!parsed.date) $('receiptDate')?.focus();
    else $('receiptAmount')?.focus();
  } catch (error) {
    if (runId !== state.jobId) return;
    state.ocrDone = true;
    setScreen('review');
    announce(`${error?.message || 'Lecture impossible.'} Saisissez les informations à partir de la photo, puis vérifiez la dépense.`);
  } finally {
    if (runId === state.jobId) setBusy(false);
  }
}
function validateReview() {
  const currency = $('receiptCurrency')?.value || 'EUR';
  const parsedAmount = window.FREEVMoney?.parseAmount($('receiptAmount')?.value || '', currency, 'receiptAmount');
  const amountField = $('receiptAmount');
  const dateField = $('receiptDate');
  const dateValue = dateField?.value || '';
  const timeValue = $('receiptTime')?.value || '';
  const dateObject = /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? new Date(`${dateValue}T00:00:00.000Z`) : null;
  const parsedDate = Number.isFinite(dateObject?.getTime()) && dateObject.toISOString().slice(0, 10) === dateValue;
  amountField?.setAttribute('aria-invalid', String(!parsedAmount?.ok || parsedAmount.minor <= 0));
  dateField?.setAttribute('aria-invalid', String(!parsedDate));
  $('receiptTime')?.setAttribute('aria-invalid', String(Boolean(timeValue) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeValue)));
  if (!parsedAmount?.ok || parsedAmount.minor <= 0) { announce('Saisissez un montant positif valide dans la devise choisie.'); amountField?.focus(); return null; }
  if (!parsedDate) { announce('Vérifiez la date du ticket.'); dateField?.focus(); return null; }
  if (timeValue && !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeValue)) { announce('Vérifiez l’heure du ticket.'); $('receiptTime')?.focus(); return null; }
  clearAlert();
  return { amount: $('receiptAmount').value.trim(), amountMinor: parsedAmount.minor, date: dateValue, time: timeValue, currency };
}
function continueToTransaction() {
  const values = validateReview();
  if (!values) return;
  const current = appState();
  const account = currentAccount(current);
  if (!account || String(account.id) !== String(state.accountId)) {
    return announce('Le compte actif a changé pendant le scan. Fermez cette fenêtre et relancez le scan depuis le compte souhaité.');
  }
  if (typeof window.openModal !== 'function') return announce('Le formulaire de dépense est indisponible. Fermez puis rechargez l’application.');
  const description = $('receiptDescription')?.value.trim() || 'Ticket de caisse';
  const merchant = $('receiptMerchant')?.value.trim() || '';
  const ocrMerchant = state.ocrMerchant;
  const category = $('receiptCategory')?.value || '';
  const documentKind = state.documentKind;
  const transactionType = documentKind === 'refund' ? 'income' : 'expense';
  const possibleDuplicates = findLikelyReceiptDuplicates(account.transactions, { ...values, merchant, type: transactionType }, String(account.settings?.baseCurrency || 'EUR').toUpperCase());
  const photo = state.photo;
  // Fermer le dialogue natif avant d’ouvrir la feuille de transaction :
  // sur mobile, un dialog dans la top layer masque sinon le formulaire.
  closeScanner();
  if (dialog.open) dialog.close('continue');
  window.openModal();
  if (photo && $('receiptPrefillImage')) {
    clearTransactionPreview();
    transactionPreviewUrl = URL.createObjectURL(photo);
    $('receiptPrefillImage').src = transactionPreviewUrl;
    $('receiptPrefillPhoto')?.classList.remove('hidden');
  }
  const type = $('transType');
  if (type) { type.value = transactionType; type.dispatchEvent(new Event('change', { bubbles: true })); }
  if (documentKind === 'refund' && $('transIncomeClass')) $('transIncomeClass').value = 'exceptional';
  if ($('transPaymentStatus')) $('transPaymentStatus').value = 'paid';
  if ($('transAmount')) $('transAmount').value = values.amount;
  if ($('transDate')) $('transDate').value = values.date;
  if ($('transTime')) $('transTime').value = values.time;
  if ($('transDesc')) $('transDesc').value = description;
  if ($('transTags')) $('transTags').value = documentKind === 'refund' ? 'ticket de caisse, remboursement' : 'ticket de caisse';
  if ($('transCurrency')) $('transCurrency').value = values.currency;
  if (typeof window.toggleFxRate === 'function') window.toggleFxRate();
  if (typeof window.selectTransactionCategory === 'function') window.selectTransactionCategory(category);
  window.FreevCustomSelects?.refresh?.($('transactionModal'));
  const notice = $('receiptPrefillNotice');
  if (notice) {
    notice.classList.remove('hidden');
    notice.classList.toggle('is-duplicate', possibleDuplicates.length > 0);
    notice.dataset.merchant = merchant;
    notice.dataset.ocrMerchant = ocrMerchant;
    const icon = notice.querySelector('i');
    if (icon) icon.className = possibleDuplicates.length ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-check';
    const message = notice.querySelector('span');
    if (message) message.textContent = possibleDuplicates.length
      ? 'Ce ticket ressemble à une opération déjà enregistrée. Comparez les informations avant d’enregistrer ; FREEV vous redemandera confirmation.'
      : documentKind === 'refund' ? 'Remboursement présélectionné comme revenu exceptionnel. Vérifiez le montant, la date et la description avant d’enregistrer.'
        : 'Ticket lu. Vérifiez le montant, la date, l’heure si elle figure sur le ticket, la catégorie et la description avant d’enregistrer.';
  }
  const title = $('modalTitle');
  if (title) title.textContent = documentKind === 'refund' ? 'Vérifier le remboursement du ticket' : 'Vérifier la dépense du ticket';
}
function openScanner() {
  if (!mobileQuery.matches || !dialog || dialog.open) return;
  const { account } = accountSummary();
  if (!account) return window.showToast?.('Créez ou sélectionnez un compte avant de scanner un ticket.', 'error');
  state.accountId = account.id;
  clearAlert();
  setScreen('start');
  dialog.showModal();
  $('receiptScannerClose')?.focus();
}
function cancelReading() {
  state.jobId += 1;
  state.busy = false;
  const worker = state.worker;
  state.worker = null;
  state.workerPromise = null;
  if (worker) void worker.terminate().catch(() => {});
  setBusy(false);
  setScreen('review');
  announce('Lecture arrêtée. Aucune opération n’a été enregistrée.');
}

$('receiptScanOpen')?.addEventListener('click', openScanner);
$('receiptScannerClose')?.addEventListener('click', () => dialog.close('cancel'));
$('receiptScanCameraStart')?.addEventListener('click', startCamera);
$('receiptScanCameraCancel')?.addEventListener('click', () => { stopCamera(); setScreen('start'); });
$('receiptScanCapture')?.addEventListener('click', () => { void captureFrame(); });
$('receiptScanChooseFile')?.addEventListener('click', () => $('receiptScanFile')?.click());
$('receiptScanFile')?.addEventListener('change', choosePhoto);
$('receiptScanAnalyze')?.addEventListener('click', () => { state.qualityOverride = true; void analyzePhoto(); });
$('receiptScanRetake')?.addEventListener('click', () => { clearPhoto(); clearAlert(); setScreen('start'); });
$('receiptScanCancelJob')?.addEventListener('click', cancelReading);
$('receiptScanContinue')?.addEventListener('click', continueToTransaction);
$('receiptCurrency')?.addEventListener('change', () => {
  state.currency = $('receiptCurrency').value;
  const account = currentAccount();
  updateCurrencyNote(state.detectedCurrency, String(account?.settings?.baseCurrency || 'EUR').toUpperCase());
});
dialog?.addEventListener('close', closeScanner);
dialog?.addEventListener('cancel', stopCamera);
mobileQuery.addEventListener?.('change', event => { if (!event.matches && dialog?.open) dialog.close('desktop'); });
window.addEventListener('pagehide', () => {
  stopCamera();
  state.jobId += 1;
  state.busy = false;
  const worker = state.worker;
  state.worker = null;
  state.workerPromise = null;
  if (worker) void worker.terminate().catch(() => {});
});

// Facilite les essais navigateur automatisés sans exposer de données de compte.
window.FreevReceiptScanner = Object.freeze({
  open: openScanner, parseFrenchReceipt, findLikelyReceiptDuplicates, clearTransactionPreview,
  isAvailable: () => mobileQuery.matches,
  learnConfirmedMerchant: (accountId, observed, corrected) => learnMerchantCorrection(receiptLearningStorage(), receiptLearningKey(window.__freevUserId, accountId), observed, corrected)
});
