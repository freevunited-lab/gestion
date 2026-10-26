// Diagnostic conservateur : signale les photos manifestement illisibles,
// sans prétendre mesurer à lui seul la netteté du texte.
export function receiptFrameSharpness(imageData) {
  const { data, width, height } = imageData || {};
  if (!data || width < 3 || height < 3 || data.length < width * height * 4) return 0;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4;
    gray[i] = Math.round(.299 * data[p] + .587 * data[p + 1] + .114 * data[p + 2]);
  }
  let detail = 0, count = 0;
  for (let y = 1; y < height - 1; y += 2) for (let x = 1; x < width - 1; x += 2) {
    const i = y * width + x;
    const local = Math.abs(4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width]);
    // Les valeurs extrêmes viennent souvent d'un reflet ou du bruit du capteur.
    detail += Math.min(local, 160);
    count++;
  }
  return count ? detail / count : 0;
}

export function assessReceiptImage(imageData, sourceWidth, sourceHeight) {
  const { data, width, height } = imageData || {};
  if (!data || !width || !height || data.length < width * height * 4) return { usable: false, issues: ['image indisponible'] };
  let sum = 0, sumSquares = 0, edges = 0, edgeCount = 0;
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    const pixel = index * 4;
    const value = Math.round(.299 * data[pixel] + .587 * data[pixel + 1] + .114 * data[pixel + 2]);
    gray[index] = value;
    sum += value;
    sumSquares += value * value;
    if (x && y) { edges += Math.abs(value - gray[index - 1]) + Math.abs(value - gray[index - width]); edgeCount += 2; }
  }
  const count = width * height;
  const mean = sum / count;
  const contrast = Math.sqrt(Math.max(0, sumSquares / count - mean * mean));
  const edge = edges / Math.max(1, edgeCount);
  const issues = [];
  if (Math.min(Number(sourceWidth) || width, Number(sourceHeight) || height) < 550) issues.push('photo trop petite');
  if (mean < 55) issues.push('photo trop sombre');
  if (mean > 245 && contrast < 18) issues.push('photo surexposée');
  if (contrast < 9 || edge < 1.2) issues.push('texte possiblement flou ou absent');
  return { usable: issues.length === 0, issues, metrics: { brightness: Math.round(mean), contrast: Math.round(contrast), edge: Math.round(edge * 10) / 10 } };
}

// Conseil avant la capture. Ne bloque jamais la prise de photo : sur un fond
// clair, les bords du ticket peuvent être invisibles malgré un texte lisible.
export function assessLiveReceiptFrame(imageData, sourceWidth, sourceHeight) {
  const quality = assessReceiptImage(imageData, sourceWidth, sourceHeight);
  const sharpness = receiptFrameSharpness(imageData);
  if (!imageData?.data) return { status: 'wait', message: 'Attendez l’aperçu de la caméra.' };
  const { data, width, height } = imageData;
  let brightCount = 0, sampled = 0, minX = width, maxX = 0, minY = height, maxY = 0;
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
    const i = (y * width + x) * 4;
    sampled++;
    if (.299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2] > 165) {
      brightCount++; minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  const brightRatio = brightCount / Math.max(1, sampled);
  if (brightRatio > .025 && brightRatio < .24 &&
      (maxX - minX < width * .27 || maxY - minY < height * .42))
    return { status: 'distance', message: 'Rapprochez le téléphone, ticket entier visible.' };
  if (quality.issues.includes('photo trop sombre')) return { status: 'light', message: 'Ajoutez de la lumière sur le ticket.' };
  if (quality.issues.includes('photo surexposée')) return { status: 'light', message: 'Évitez le reflet sur le ticket.' };
  if (quality.issues.includes('photo trop petite')) return { status: 'distance', message: 'Rapprochez le téléphone du ticket.' };
  const bounds = detectReceiptBounds(imageData);
  if (bounds && (bounds.width < .27 || bounds.height < .42)) return { status: 'distance', message: 'Rapprochez le téléphone, ticket entier visible.' };
  if (quality.issues.includes('texte possiblement flou ou absent') || sharpness < 3.5) return { status: 'steady', message: 'Gardez le téléphone stable et rapprochez le ticket.' };
  return { status: 'ready', message: 'Image lisible. Prenez la photo.' };
}

export function scoreReceiptCaptureFrame(imageData, sourceWidth, sourceHeight) {
  const quality = assessReceiptImage(imageData, sourceWidth, sourceHeight);
  if (!imageData?.data) return -Infinity;
  const sharpness = Math.min(40, receiptFrameSharpness(imageData));
  const penalties = quality.issues.reduce((sum, issue) => sum + (
    issue === 'photo trop sombre' || issue === 'photo surexposée' ? 35 :
      issue === 'photo trop petite' ? 15 : 12
  ), 0);
  return sharpness - penalties;
}

export function receiptContrastLevels(histogram, pixelCount) {
  if (!histogram || histogram.length !== 256 || pixelCount <= 0) return null;
  const lowTarget = pixelCount * .005;
  const highTarget = pixelCount * .995;
  let cumulative = 0, low = 0, high = 255;
  for (let value = 0; value < 256; value++) {
    cumulative += histogram[value] || 0;
    if (cumulative >= lowTarget) { low = value; break; }
  }
  cumulative = 0;
  for (let value = 0; value < 256; value++) {
    cumulative += histogram[value] || 0;
    if (cumulative >= highTarget) { high = value; break; }
  }
  return high - low >= 35 ? { low, high } : null;
}

export function receiptRotationAngles(width, height, parsed) {
  const missing = [!parsed?.amount, !parsed?.date, !parsed?.merchant].filter(Boolean).length;
  if (missing < 2 || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
  return width > height * 1.2 ? [90, 270] : [180];
}

// Seuil local : la moyenne suit l'éclairage du papier au lieu d'utiliser un gris global.
// Modifie les pixels fournis ; réservé à un passage OCR de secours.
export function adaptiveReceiptBinarize(imageData, radius = 24, offset = 9) {
  const { data, width, height } = imageData || {};
  if (!data || !width || !height || data.length < width * height * 4 || width * height > 2_500_000) return null;
  const stride = width + 1;
  const sums = new Uint32Array(stride * (height + 1));
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const pixel = index * 4;
      const value = Math.round(.299 * data[pixel] + .587 * data[pixel + 1] + .114 * data[pixel + 2]);
      gray[index] = value;
      rowSum += value;
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + rowSum;
    }
  }
  const neighborhood = Math.max(8, Math.min(64, Math.trunc(radius) || 24));
  const bias = Math.max(2, Math.min(32, Number(offset) || 9));
  let dark = 0;
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - neighborhood);
    const y1 = Math.min(height, y + neighborhood + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - neighborhood);
      const x1 = Math.min(width, x + neighborhood + 1);
      const sum = sums[y1 * stride + x1] - sums[y0 * stride + x1] - sums[y1 * stride + x0] + sums[y0 * stride + x0];
      const threshold = sum / ((x1 - x0) * (y1 - y0)) - bias;
      const black = gray[y * width + x] < threshold;
      const pixel = (y * width + x) * 4;
      data[pixel] = data[pixel + 1] = data[pixel + 2] = black ? 0 : 255;
      dark += Number(black);
    }
  }
  const inkRatio = dark / (width * height);
  return inkRatio >= .002 && inkRatio <= .45 ? { inkRatio } : null;
}

// Recadre seulement un papier clair nettement séparé d'un fond sombre.
// Les coordonnées sont normalisées ; un doute conserve toujours l'image entière.
export function detectReceiptBounds(imageData) {
  const { data, width, height } = imageData || {};
  if (!data || width < 24 || height < 24 || data.length < width * height * 4) return null;
  const brightness = new Uint8Array(width * height);
  const border = [];
  const center = [];
  const edgeX = Math.max(2, Math.floor(width * .08));
  const edgeY = Math.max(2, Math.floor(height * .08));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    const pixel = index * 4;
    const value = Math.round(.299 * data[pixel] + .587 * data[pixel + 1] + .114 * data[pixel + 2]);
    brightness[index] = value;
    if (x < edgeX || x >= width - edgeX || y < edgeY || y >= height - edgeY) border.push(value);
    else if (x >= width * .25 && x < width * .75 && y >= height * .2 && y < height * .8) center.push(value);
  }
  const percentile = (values, fraction) => {
    const bins = new Uint32Array(256);
    for (const value of values) bins[value]++;
    const target = values.length * fraction;
    let count = 0;
    for (let value = 0; value < 256; value++) { count += bins[value]; if (count >= target) return value; }
    return 255;
  };
  const background = percentile(border, .65);
  const paper = percentile(center, .65);
  if (paper < 160 || paper - background < 55) return null;
  const threshold = Math.round((paper + background) / 2);
  const columns = new Uint32Array(width);
  const rows = new Uint32Array(height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (brightness[y * width + x] >= threshold) { columns[x]++; rows[y]++; }
  }
  const longestRun = (counts, minimum) => {
    let start = -1, bestStart = -1, bestEnd = -1;
    for (let index = 0; index <= counts.length; index++) {
      if (index < counts.length && counts[index] >= minimum) { if (start < 0) start = index; }
      else if (start >= 0) {
        if (index - start > bestEnd - bestStart) { bestStart = start; bestEnd = index; }
        start = -1;
      }
    }
    return bestStart < 0 ? null : { start: bestStart, end: bestEnd };
  };
  const horizontal = longestRun(columns, Math.max(2, Math.floor(height * .25)));
  const vertical = longestRun(rows, Math.max(2, Math.floor(width * .1)));
  if (!horizontal || !vertical || horizontal.end - horizontal.start < width * .12 || vertical.end - vertical.start < height * .35) return null;
  const paddingX = Math.ceil(width * .035);
  const paddingY = Math.ceil(height * .035);
  const left = Math.max(0, horizontal.start - paddingX);
  const right = Math.min(width, horizontal.end + paddingX);
  const top = Math.max(0, vertical.start - paddingY);
  const bottom = Math.min(height, vertical.end + paddingY);
  if ((right - left) * (bottom - top) > width * height * .88) return null;
  return { left: left / width, top: top / height, width: (right - left) / width, height: (bottom - top) / height };
}

// Repère un ticket trapézoïdal seulement lorsque les deux bords latéraux
// restent visibles sur plusieurs lignes. Une scène incertaine garde le cadrage
// rectangulaire habituel : une correction erronée détruirait le texte.
export function detectReceiptPerspective(imageData, bounds = detectReceiptBounds(imageData)) {
  const { data, width, height } = imageData || {};
  if (!bounds || !data || width < 80 || height < 100) return null;
  const x0 = Math.max(0, Math.floor(bounds.left * width));
  const x1 = Math.min(width, Math.ceil((bounds.left + bounds.width) * width));
  const y0 = Math.max(0, Math.floor(bounds.top * height));
  const y1 = Math.min(height, Math.ceil((bounds.top + bounds.height) * height));
  const brightness = (x, y) => {
    const i = (y * width + x) * 4;
    return .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2];
  };
  const background = [];
  const paper = [];
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 30))) {
    background.push(brightness(1, y), brightness(width - 2, y));
  }
  for (let y = y0 + 4; y < y1 - 4; y += Math.max(1, Math.floor((y1 - y0) / 20))) {
    paper.push(brightness(Math.floor((x0 + x1) / 2), y));
  }
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  if (!paper.length || !background.length) return null;
  const dark = median(background), light = median(paper);
  if (light < 170 || light - dark < 55) return null;
  const threshold = (light + dark) / 2;
  const scan = centerY => {
    const observations = [];
    const radius = Math.max(2, Math.round((y1 - y0) * .025));
    for (let y = centerY - radius; y <= centerY + radius; y += 2) {
      if (y < y0 + 2 || y >= y1 - 2) continue;
      let left = -1, right = -1;
      for (let x = x0; x < x1 - 2; x++) {
        if (brightness(x, y) >= threshold && brightness(x + 1, y) >= threshold && brightness(x + 2, y) >= threshold) { left = x; break; }
      }
      for (let x = x1 - 1; x >= x0 + 2; x--) {
        if (brightness(x, y) >= threshold && brightness(x - 1, y) >= threshold && brightness(x - 2, y) >= threshold) { right = x; break; }
      }
      if (left >= 0 && right - left > width * .12) observations.push({ left, right });
    }
    if (observations.length < 3) return null;
    return { y: centerY, left: median(observations.map(item => item.left)), right: median(observations.map(item => item.right)) };
  };
  const top = scan(Math.round(y0 + (y1 - y0) * .16));
  const bottom = scan(Math.round(y0 + (y1 - y0) * .84));
  if (!top || !bottom) return null;
  const factor = (y1 - y0) / (bottom.y - top.y);
  const leftTop = top.left + (bottom.left - top.left) * (y0 - top.y) / (bottom.y - top.y);
  const rightTop = top.right + (bottom.right - top.right) * (y0 - top.y) / (bottom.y - top.y);
  const leftBottom = leftTop + (bottom.left - top.left) * factor;
  const rightBottom = rightTop + (bottom.right - top.right) * factor;
  const tilt = Math.max(Math.abs(leftBottom - leftTop), Math.abs(rightBottom - rightTop));
  if (tilt < width * .035 || tilt > width * .3) return null;
  if (Math.min(rightTop - leftTop, rightBottom - leftBottom) < width * .12) return null;
  if ([leftTop, rightTop, leftBottom, rightBottom].some(value => value < 0 || value > width)) return null;
  const marginX = width * .025, marginY = height * .015;
  return {
    topLeft: { x: Math.max(0, leftTop - marginX) / width, y: Math.max(0, y0 - marginY) / height },
    topRight: { x: Math.min(width, rightTop + marginX) / width, y: Math.max(0, y0 - marginY) / height },
    bottomLeft: { x: Math.max(0, leftBottom - marginX) / width, y: Math.min(height, y1 + marginY) / height },
    bottomRight: { x: Math.min(width, rightBottom + marginX) / width, y: Math.min(height, y1 + marginY) / height }
  };
}
