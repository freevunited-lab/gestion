import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const html=readFileSync(resolve(root,'index.html'),'utf8');
const css=readFileSync(resolve(root,'assets/css/apple-premium.css'),'utf8');
const sw=readFileSync(resolve(root,'sw.js'),'utf8');
const manifest=JSON.parse(readFileSync(resolve(root,'manifest.webmanifest'),'utf8'));
test('édition Signature activée après V4 sans altérer la structure',()=>{
 assert.match(html, /class="freev-premium-v3 freev-premium-v4 freev-apple"/);
 assert.ok(html.indexOf('apple-premium.css')>html.indexOf('premium-v4.css'));
 assert.doesNotMatch(html,/fonts\.googleapis\.com/);
 for(const id of ['cardBalance','totalIncome','totalExpenses','totalSavings','globalMonthPicker','sidebarNav','recurring-view','dashboard-view']) assert.match(html, new RegExp(`id="${id}"`));
});
test('design adaptatif avec contraste des menus, dark mode et gestion accessibilité',()=>{
 for(const selector of ['body.freev-apple.dark-mode','.sidebar-nav .nav-item.active',':focus-visible','prefers-reduced-motion:reduce','prefers-reduced-transparency:reduce','max-width:768px','max-width:430px']) assert.ok(css.includes(selector),selector);
 assert.match(css,/\.account-sidebar-item\.active/);
 assert.match(css,/background:var\(--apple-tint\)/);
 assert.match(css,/\.premium-workspace-head h1/);
});
test('pas de logique financière introduite par la feuille de présentation',()=>{
 assert.doesNotMatch(css,/\b(?:localStorage|Firebase|fetch|account\.transactions|saveData)\b/);
 for(const id of ['--apple-accent','--apple-canvas','--apple-ink','--apple-surface','--apple-outline']) assert.ok(css.includes(id));
});
test('PWA versionnée inclut la feuille Signature et ses couleurs de démarrage',()=>{
 assert.match(sw,/freev-v5\.2\.0-everyday-\d{8}-v\d+/);
 assert.match(sw,/\.\/assets\/css\/apple-premium\.css/);
 assert.equal(manifest.theme_color,'#f5f5f7');
 assert.match(html,/<meta name="theme-color" content="#f5f5f7">/);
});
test('styles évitent d’animer les éléments lorsque mouvement réduit demandé',()=>{
 assert.match(css,/animation-duration:\.01ms!important/);
 assert.match(css,/scroll-behavior:auto!important/);
});
