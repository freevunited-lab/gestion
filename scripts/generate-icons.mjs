// Génère les icônes PNG de la PWA à partir de l’icône SVG officielle.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(path.isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const svg = fs.readFileSync(path.join(root, 'assets', 'icons', 'icon.svg'), 'utf8');
const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const targets = [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512]
];

const browser = await chromium.launch({ headless: true });
try {
  for (const [name, size] of targets) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#1e3a8a}#icon{width:100%;height:100%;background:#1e3a8a}img{display:block;width:100%;height:100%}</style><div id="icon"><img src="${source}" alt=""></div>`);
    await page.locator('#icon img').waitFor({ state: 'visible' });
    await page.locator('#icon').screenshot({ path: path.join(root, 'assets', 'icons', name), type: 'png', omitBackground: false });
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`Icônes générées : ${targets.map(([name, size]) => `${name} (${size}×${size})`).join(', ')}`);
