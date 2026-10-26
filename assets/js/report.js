
// ===== CONFIG =====
const STORAGE_KEY = 'freevMultiAccounts_v2';
const REPORT_PREFS_KEY = 'freevReportPrefs_v3';
let allAccounts = [];
let decPrec = 2;
let txLim = 'all';
let catChType = 'bar';
let txSearch = '';
let txSearchTimer = 0;
let reportChartsReady = Promise.resolve();
let reportChartPluginsRegistered = false;

const REPORT_CHART_FALLBACKS = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js',
  'https://unpkg.com/chart.js@4.4.0/dist/chart.umd.js'
];

// ===== UTILS =====
const round2 = n => Math.round((Number(n)||0)*100)/100;
function fmt(n, cur='EUR') {
  return new Intl.NumberFormat('fr-FR',{style:'currency',currency:cur,minimumFractionDigits:decPrec,maximumFractionDigits:decPrec}).format(Number(n)||0);
}
function fmtAxis(n,cur='EUR'){
  return new Intl.NumberFormat('fr-FR',{style:'currency',currency:cur,notation:'compact',maximumFractionDigits:1}).format(Number(n)||0);
}
function fmtSigned(n,cur='EUR'){
  const value=round2(n);
  if(Math.abs(value)<0.005)return fmt(0,cur);
  return `${value>0?'+':'-'}${fmt(Math.abs(value),cur)}`;
}
function fmtPct(v,t){return t?((Math.round(v/t*1000)/10).toFixed(1).replace('.',',')+'\u202f%'):'0\u202f%';}
function isoMonth(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
function isoDate(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function frenchMonth(s){const[y,m]=s.split('-');return['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'][+m-1]+' '+y;}
function frDate(s){if(!s)return'—';const[y,m,d]=s.split('-');return`${d}/${m}/${y}`;}
function daysInMonth(isoM){const[y,m]=isoM.split('-').map(Number);return new Date(y,m,0).getDate();}
function prevEnd(isoM){const[y,m]=isoM.split('-').map(Number);return isoDate(new Date(y,m-1,0));}
function prevMonth(isoM){const[y,m]=isoM.split('-').map(Number);const d=new Date(y,m-2,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}

function deltaChip(curr, prev) {
  if(prev === 0 && curr === 0) return '';
  if(prev === 0) return `<div class="delta up">▲ nouveau</div>`;
  const pct = Math.round((curr - prev) / Math.abs(prev) * 100);
  const cls = pct > 0 ? 'up' : pct < 0 ? 'dn' : 'nt';
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '—';
  return `<div class="delta ${cls}">${arrow} ${Math.abs(pct)} %</div>`;
}

// Delta inversé (pour dépenses : baisse = bien)
function deltaChipInv(curr, prev) {
  if(prev === 0 && curr === 0) return '';
  if(prev === 0) return '';
  const pct = Math.round((curr - prev) / Math.abs(prev) * 100);
  const cls = pct < 0 ? 'up' : pct > 0 ? 'dn' : 'nt';
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '—';
  return `<div class="delta ${cls}">${arrow} ${Math.abs(pct)} %</div>`;
}

function hexToRgba(hex, a) {
  hex = hex.trim().replace('#','');
  if(hex.length === 3) hex = hex.split('').map(c=>c+c).join('');
  const r=parseInt(hex.slice(0,2),16), g=parseInt(hex.slice(2,4),16), b=parseInt(hex.slice(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
}

function getBrand() {
  return getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#3b82f6';
}

function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

function hlSearch(str) {
  const safe = escapeHTML(str);
  if(!txSearch || !safe) return safe;
  const esc = escapeHTML(txSearch).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return safe.replace(new RegExp(`(${esc})`,'gi'),'<mark>$1</mark>');
}

function onTxSearchInput(value) {
  txSearch = value;
  clearTimeout(txSearchTimer);
  txSearchTimer = setTimeout(render, 140);
}

const PAL = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899','#14b8a6','#84cc16','#6366f1','#64748b','#a16207','#0f766e','#be123c'];

// ===== DATA =====
function loadData(expectedOwnerUid=''){
  try{
    const p=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');
    const ownerUid=String(p.ownerUid||localStorage.getItem('freevLastFirebaseUid')||'');
    if(expectedOwnerUid&&ownerUid&&ownerUid!==expectedOwnerUid)return false;
    allAccounts=p.accounts||[];
    return allAccounts.length>0;
  }
  catch{return false;}
}
function gAcc(id){return allAccounts.find(a=>a.id===id);}
function gCur(id){return id==='__all__'?allAccounts[0]?.settings?.baseCurrency||'EUR':gAcc(id)?.settings?.baseCurrency||'EUR';}
function gTx(id){
  // Déduplique les occurrences récurrentes par (parentId, periodKey) au cas où
  // des doublons seraient encore présents dans les données sauvegardées.
  const raw = id==='__all__'
    ? allAccounts.flatMap(a=>(a.transactions||[]).map(t=>({...t,_accountId:a.id})))
    : gAcc(id)?.transactions||[];
  const seen=new Set();
  return raw.filter(t=>{
    if(!t.parentId) return true;
    const k=`${t._accountId||id}|${String(t.parentId)}|${t.periodKey||t.date||''}`;
    if(seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function gCap(id){return id==='__all__'?allAccounts.reduce((s,a)=>s+(Number(a.initialCapital)||0),0):Number(gAcc(id)?.initialCapital)||0;}
function gSavTot(id){const accs=id==='__all__'?allAccounts:[gAcc(id)].filter(Boolean);return accs.reduce((s,a)=>s+Object.values(a.savingsAccounts||{}).reduce((x,v)=>x+(Number(v)||0),0),0);}
function gSavDet(id){if(id==='__all__'){const m={};allAccounts.forEach(a=>Object.entries(a.savingsAccounts||{}).forEach(([k,v])=>{m[k]=(m[k]||0)+(Number(v)||0);}));return m;}return gAcc(id)?.savingsAccounts||{};}
function gBudgets(id){
  // index.html stores budgets as acc.budgetsByCategory = {Cat: number}
  // (not settings.budgetCategories string — that was a legacy format)
  if(id==='__all__'){
    const merged={};
    allAccounts.forEach(a=>{
      const bbc=a.budgetsByCategory||{};
      Object.entries(bbc).forEach(([k,v])=>{ merged[k]=(merged[k]||0)+(Number(v)||0); });
    });
    return merged;
  }
  return Object.fromEntries(
    Object.entries(gAcc(id)?.budgetsByCategory||{}).map(([k,v])=>[k,Number(v)||0])
  );
}

// ===== BALANCE =====
function balUpTo(txList,cap,cutoff){
  // txList est déjà dédupliqué (issu de gTx)
  const tx=txList.filter(t=>!t.isRecurring&&(t.date||'')<=cutoff);
  const i=tx.filter(t=>t.type==='income').reduce((s,t)=>s+(Number(t.amountBase??t.amount)||0),0);
  const e=tx.filter(t=>t.type==='expense').reduce((s,t)=>s+(Number(t.amountBase??t.amount)||0),0);
  const r=tx.filter(t=>t.type==='transfer').reduce((s,t)=>s+(Number(t.amountBase??t.amount)||0),0);
  return round2(cap+i-e-r);
}

// ===== CONTROLS =====
function initCtrl(){
  const sel=document.getElementById('accountSel');sel.innerHTML='';
  const currencies=new Set(allAccounts.map(a=>a.settings?.baseCurrency||'EUR'));
  if(allAccounts.length>1&&currencies.size===1){const o=document.createElement('option');o.value='__all__';o.textContent='Tous les comptes';sel.appendChild(o);}
  else if(allAccounts.length>1){const o=document.createElement('option');o.disabled=true;o.textContent='Vue globale indisponible (devises différentes)';sel.appendChild(o);}
  allAccounts.forEach(a=>{const o=document.createElement('option');o.value=a.id;o.textContent=a.name||'Compte';sel.appendChild(o);});
  const p=new URLSearchParams(location.search);
  const pm=p.get('month'),pa=p.get('account');
  document.getElementById('monthSel').value=pm||isoMonth();
  if(pa&&Array.from(sel.options).some(option=>option.value===pa))sel.value=pa;
  else if(allAccounts.length)sel.value=allAccounts[0].id;
  restoreReportPreferences();
  document.querySelectorAll('.check-row input[type="checkbox"]').forEach(input=>{
    if(!input.dataset.prefBound){input.dataset.prefBound='1';input.addEventListener('change',saveReportPreferences);}
  });
  updPdfName();
}
function updPdfName(){
  const month=document.getElementById('monthSel').value||isoMonth();
  const id=document.getElementById('accountSel').value;
  const acc=id==='__all__'?null:gAcc(id);
  const slug=acc?acc.name.replace(/[^a-zA-Z0-9]/g,'_'):'Tous';
  document.getElementById('pdfName').value=`Freev_${slug}_${month}`;
}
function onCtrlChange(){updPdfName();saveReportPreferences();render();}
function setPrecision(el){document.querySelectorAll('#precGroup .rpill').forEach(p=>p.classList.remove('active'));el.classList.add('active');decPrec=Number(el.dataset.v);saveReportPreferences();render();}
function setTxLim(el){document.querySelectorAll('#txLimGroup .rpill').forEach(p=>p.classList.remove('active'));el.classList.add('active');txLim=el.dataset.v;saveReportPreferences();render();}

function setTheme(el) {
  document.querySelectorAll('.theme-sw').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  document.documentElement.setAttribute('data-theme', el.dataset.t);
  saveReportPreferences();
  // rebuild charts with new brand color
  setTimeout(()=>rebuildCharts(), 50);
}
function setCompact(el) {
  document.querySelectorAll('#compGroup .rpill').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('RW').classList.toggle('compact', el.dataset.v==='compact');
  saveReportPreferences();
}
function setCatChType(el) {
  document.querySelectorAll('#catChGroup .rpill').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  catChType = el.dataset.v;
  saveReportPreferences();
  rebuildCatChart();
}

function onReportOptionChange(){saveReportPreferences();render();}

function saveReportPreferences(){
  try {
    const sections={};
    document.querySelectorAll('.check-row input[type="checkbox"]').forEach(input=>{sections[input.id]=input.checked;});
    localStorage.setItem(REPORT_PREFS_KEY,JSON.stringify({
      sections,
      theme:document.documentElement.getAttribute('data-theme')||'blue',
      density:document.getElementById('RW')?.classList.contains('compact')?'compact':'normal',
      precision:decPrec,
      txLimit:txLim,
      categoryChart:catChType
    }));
  } catch(_) {}
}

function activatePill(groupId,value){
  document.querySelectorAll(`#${groupId} .rpill`).forEach(pill=>pill.classList.toggle('active',String(pill.dataset.v)===String(value)));
}

function restoreReportPreferences(){
  try {
    const prefs=JSON.parse(localStorage.getItem(REPORT_PREFS_KEY)||'null');
    if(!prefs) return;
    Object.entries(prefs.sections||{}).forEach(([id,checked])=>{const input=document.getElementById(id);if(input)input.checked=Boolean(checked);});
    const theme=['blue','green','amber','rose','violet'].includes(prefs.theme)?prefs.theme:'blue';
    document.documentElement.setAttribute('data-theme',theme);
    document.querySelectorAll('.theme-sw').forEach(swatch=>swatch.classList.toggle('active',swatch.dataset.t===theme));
    decPrec=[0,2,3].includes(Number(prefs.precision))?Number(prefs.precision):2;
    txLim=['all','10','20'].includes(String(prefs.txLimit))?String(prefs.txLimit):'all';
    catChType=['donut','bar','radar'].includes(prefs.categoryChart)?prefs.categoryChart:'bar';
    activatePill('precGroup',decPrec);activatePill('txLimGroup',txLim);activatePill('catChGroup',catChType);
    const density=prefs.density==='compact'?'compact':'normal';
    activatePill('compGroup',density);document.getElementById('RW')?.classList.toggle('compact',density==='compact');
  } catch(_) {}
}
function rebuildCharts() {
  // Re-render charts after theme change
  const id=document.getElementById('accountSel').value;
  const month=document.getElementById('monthSel').value;
  if(!month||!id) return;
  const D=compute(id,month);
  if($c('o_bc')) mkLine('ch_bal', D.daily, D.cur);
  rebuildCatChart();
  if($c('o_ic')) mkBar('ch_ine', D.income, D.expenses, D.transfers, D.cur);
  if($c('o_cf')) mkCashBridge('ch_flow',D);
  if($c('o_tr')) mkTrend('ch_trend',computeTrend(id,month),D.cur);
}
function rebuildCatChart() {
  const id=document.getElementById('accountSel').value;
  const month=document.getElementById('monthSel').value;
  if(!month||!id||!$c('o_cc')) return;
  const D=compute(id,month);
  if(catChType==='donut') mkDonut('ch_cat',D.catBD,D.cur);
  else if(catChType==='bar') mkBarCat('ch_cat',D.catBD,D.cur);
  else mkRadar('ch_cat',D.catBD,D.cur);
}

// ===== COMPUTE =====
function compute(id, month) {
  const allTx=gTx(id), cap=gCap(id), cur=gCur(id);
  const mt=allTx.filter(t=>(t.date||'').startsWith(month)&&!t.isRecurring);
  const income  =round2(mt.filter(t=>t.type==='income')  .reduce((s,t)=>s+(Number(t.amountBase??t.amount)||0),0));
  const expenses=round2(mt.filter(t=>t.type==='expense') .reduce((s,t)=>s+(Number(t.amountBase??t.amount)||0),0));
  const transfers=round2(mt.filter(t=>t.type==='transfer').reduce((s,t)=>s+(Number(t.amountBase??t.amount)||0),0));
  const net=round2(income-expenses-transfers);
  const days=daysInMonth(month);
  const previousCutoff=prevEnd(month);
  const monthDeltas=Array(days+1).fill(0);
  const delta=t=>{
    const amount=Number(t.amountBase??t.amount)||0;
    return t.type==='income'?amount:(t.type==='expense'||t.type==='transfer'?-amount:0);
  };
  let running=cap;
  allTx.filter(t=>!t.isRecurring&&/^\d{4}-\d{2}-\d{2}$/.test(t.date||'')).forEach(t=>{
    if(t.date<=previousCutoff) running+=delta(t);
    else if(t.date.startsWith(month)){
      const day=Number(t.date.slice(8,10));
      if(day>=1&&day<=days) monthDeltas[day]+=delta(t);
    }
  });
  const startBal=round2(running);
  const daily=[];
  for(let day=1;day<=days;day++){
    running=round2(running+monthDeltas[day]);
    daily.push({day,date:`${month}-${String(day).padStart(2,'0')}`,balance:running});
  }
  const endBal=daily.at(-1)?.balance??startBal;
  const catMap={};mt.filter(t=>t.type==='expense').forEach(t=>{const c=t.category||'Autre';catMap[c]=(catMap[c]||0)+(Number(t.amountBase??t.amount)||0);});
  const catBD=Object.entries(catMap).map(([cat,val])=>({cat,val:round2(val)})).sort((a,b)=>b.val-a.val);
  const incMap={};mt.filter(t=>t.type==='income').forEach(t=>{const c=t.category||'Autre';incMap[c]=(incMap[c]||0)+(Number(t.amountBase??t.amount)||0);});
  const incCats=Object.entries(incMap).map(([cat,val])=>({cat,val:round2(val)})).sort((a,b)=>b.val-a.val);
  const expTx=mt.filter(t=>t.type==='expense');
  const avgExp=expTx.length?round2(expenses/expTx.length):0;
  const maxExpVal=expTx.length?Math.max(...expTx.map(t=>Number(t.amountBase??t.amount)||0)):0;
  const maxExpTx=expTx.find(t=>(Number(t.amountBase??t.amount)||0)===maxExpVal);
  const savRate=income>0?Math.round(Math.max(0,((income-expenses)/income))*1000)/10:0;
  return {cur,mt,income,expenses,transfers,net,startBal,endBal,daily,catBD,incCats,days,
    avgExp,maxExpVal,maxExpTx,dailyAvgExp:round2(expenses/days),savRate,
    savings:gSavTot(id),savDet:gSavDet(id),budgets:gBudgets(id),
    txByType:{i:mt.filter(t=>t.type==='income').length,e:mt.filter(t=>t.type==='expense').length,t:mt.filter(t=>t.type==='transfer').length}};
}

function computeTrend(id, month, count=12){
  const [year,monthNumber]=month.split('-').map(Number);
  const end=new Date(year,monthNumber-1,1,12);
  return Array.from({length:count},(_,index)=>{
    const date=new Date(end);date.setMonth(date.getMonth()-(count-1-index));
    const key=isoMonth(date);const data=compute(id,key);
    return {month:key,label:date.toLocaleDateString('fr-FR',{month:'short',year:'2-digit'}),net:data.net,endBal:data.endBal,income:data.income,expenses:data.expenses};
  });
}

function buildReportInsights(D,P,month){
  const top=D.catBD[0];
  const topShare=top&&D.expenses>0?top.val/D.expenses*100:0;
  const budgetTotal=Object.values(D.budgets).reduce((sum,value)=>sum+(Number(value)||0),0);
  const budgetSpent=Object.keys(D.budgets).reduce((sum,category)=>sum+(D.catBD.find(item=>item.cat===category)?.val||0),0);
  const [year,monthNumber]=month.split('-').map(Number);
  const current=isoMonth();
  const elapsed=month===current?Math.max(1,Math.min(new Date().getDate(),D.days)):D.days;
  const projected=month===current?round2(D.expenses/elapsed*D.days):D.expenses;
  const cards=[];

  cards.push({
    tone:D.net>=0?'good':'alert',icon:D.net>=0?'↗':'!',title:D.net>=0?'Trésorerie positive':'Trésorerie à surveiller',
    text:`Le mois se termine avec ${D.net>=0?'un excédent de':'un déficit de'} ${fmt(Math.abs(D.net),D.cur)} après transferts.${P?` Écart de ${fmt(Math.abs(D.net-P.net),D.cur)} par rapport au mois précédent.`:''}`
  });
  cards.push({
    tone:'info',icon:'◎',title:top?`Poste principal : ${escapeHTML(top.cat)}`:'Répartition à compléter',
    text:top?`${fmt(top.val,D.cur)}, soit ${topShare.toFixed(1).replace('.',',')} % des dépenses. La concentration est ${topShare>=40?'élevée':'maîtrisée'}.`:'Aucune dépense catégorisée sur la période.'
  });
  cards.push({
    tone:budgetTotal>0&&projected>budgetTotal?'alert':'good',icon:'◇',title:month===current?'Projection fin de mois':'Budget du mois',
    text:month===current
      ? `Au rythme observé, les dépenses atteindraient environ ${fmt(projected,D.cur)}.${budgetTotal>0?` Budget défini : ${fmt(budgetTotal,D.cur)}.`:''}`
      : budgetTotal>0?`${fmt(budgetSpent,D.cur)} consommés sur ${fmt(budgetTotal,D.cur)} de budgets catégoriels.`:'Aucun budget catégoriel n’était défini.'
  });
  return cards;
}

// ===== CHARTS =====
const ch = {};
function killCh(k){if(ch[k]){ch[k].destroy();delete ch[k];}}

// Plugin : texte central du donut (total dépenses)
const rptDonutCenterPlugin = {
  id: 'rptDonutCenter',
  afterDraw(chart, args, opts) {
    if (chart.config.type !== 'doughnut') return;
    const meta = chart.getDatasetMeta(0);
    if (!meta?.data?.length) return;
    const {x, y} = meta.data[0];
    const lines = opts?.lines || [];
    if (!lines.length) return;
    const {ctx} = chart;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#64748b';
    ctx.font = '600 11px Inter';
    ctx.fillText(lines[0], x, y - 12);
    ctx.fillStyle = '#0f172a';
    ctx.font = '800 14px Inter';
    ctx.fillText(lines[1], x, y + 11);
    ctx.restore();
  }
};
const rptValueLabelsPlugin={
  id:'rptValueLabels',
  afterDatasetsDraw(chart,args,opts){
    if(!opts?.enabled)return;
    const {ctx}=chart;ctx.save();ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillStyle='#334155';ctx.font='700 9px Inter';
    chart.getDatasetMeta(0).data.forEach((bar,index)=>{
      const label=opts.labels?.[index];if(label)ctx.fillText(label,bar.x,Math.min(bar.y,bar.base)-5);
    });ctx.restore();
  }
};
const rptWaterfallConnectorPlugin={
  id:'rptWaterfallConnector',
  afterDatasetsDraw(chart,args,opts){
    if(!opts?.enabled)return;
    const meta=chart.getDatasetMeta(0);
    const values=chart.data.datasets[0]?.data||[];
    const scale=chart.scales?.y;
    if(!scale||meta.data.length<2)return;
    const {ctx}=chart;ctx.save();
    ctx.strokeStyle=opts.color||'rgba(100,116,139,.55)';
    ctx.lineWidth=opts.lineWidth||1;
    ctx.setLineDash(opts.dash||[3,3]);
    for(let index=0;index<meta.data.length-1;index++){
      const current=values[index];
      const level=Array.isArray(current)?Number(current[1]):Number(current);
      if(!Number.isFinite(level))continue;
      const from=meta.data[index],to=meta.data[index+1];
      const y=scale.getPixelForValue(level);
      ctx.beginPath();ctx.moveTo(from.x+from.width/2,y);ctx.lineTo(to.x-to.width/2,y);ctx.stroke();
    }
    ctx.restore();
  }
};

function registerReportChartPlugins(){
  if(!window.Chart||reportChartPluginsRegistered)return;
  Chart.defaults.font.family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  Chart.defaults.devicePixelRatio=Math.max(2,Math.min(3,window.devicePixelRatio||1));
  Chart.register(rptDonutCenterPlugin,rptWaterfallConnectorPlugin,rptValueLabelsPlugin);
  reportChartPluginsRegistered=true;
}

function loadReportChartFallback(url){
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    const timeout=setTimeout(()=>{script.remove();reject(new Error('Délai Chart.js dépassé'));},8000);
    script.src=url;script.async=true;script.crossOrigin='anonymous';
    script.onload=()=>{clearTimeout(timeout);window.Chart?resolve():reject(new Error('Chart.js incomplet'));};
    script.onerror=()=>{clearTimeout(timeout);script.remove();reject(new Error('Chargement Chart.js impossible'));};
    document.head.appendChild(script);
  });
}

async function ensureReportCharts(){
  if(window.Chart){registerReportChartPlugins();return true;}
  for(const url of REPORT_CHART_FALLBACKS){
    try{await loadReportChartFallback(url);registerReportChartPlugins();return true;}
    catch(error){console.warn('[Freev rapport] Source graphique indisponible',url,error);}
  }
  return false;
}

function showChartUnavailable(id){
  const canvas=document.getElementById(id);if(!canvas)return;
  const box=canvas.parentElement;if(!box)return;
  canvas.hidden=true;
  let message=box.querySelector('.chart-unavailable');
  if(!message){
    message=document.createElement('div');message.className='chart-unavailable';
    message.innerHTML='<strong>Graphique indisponible</strong><span>Vérifiez Internet, puis rechargez le rapport.</span>';
    box.appendChild(message);
  }
}

function safeChart(id,create){
  try{create();}
  catch(error){console.error(`[Freev rapport] Graphique ${id} impossible`,error);showChartUnavailable(id);}
}

function mkLine(id, data, cur) {
  const el=document.getElementById(id); if(!el) return; killCh(id);
  const brand=getBrand();
  const pointRadius=data.map((item,index)=>{
    if(index===0||index===data.length-1)return 3;
    return item.balance!==data[index-1]?.balance?3:0;
  });
  ch[id]=new Chart(el,{type:'line',data:{labels:data.map(d=>d.day),datasets:[{
    label:'Solde',data:data.map(d=>d.balance),borderColor:brand,
    backgroundColor:hexToRgba(brand,.10),
    borderWidth:2.25,
    pointRadius,pointHoverRadius:5,pointHitRadius:8,
    pointBackgroundColor:brand,
    pointHoverBackgroundColor:'white',
    pointHoverBorderColor:brand,
    pointHoverBorderWidth:2.5,
    fill:false,
    stepped:'after',
    tension:0
  }]},
    options:{animation:window.FreevChartMotion?.progressiveLine({duration:620,pointStep:14,maxDelay:420})??false,responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`Solde : ${fmt(c.raw,cur)}`,title:c=>`Jour ${c[0].label}`}}},
      scales:{x:{grid:{display:false},ticks:{color:'#94a3b8',font:{size:10},maxTicksLimit:10},border:{display:false}},
              y:{grid:{color:ctx=>Number(ctx.tick?.value)===0?'rgba(100,116,139,.38)':'rgba(148,163,184,.1)',lineWidth:ctx=>Number(ctx.tick?.value)===0?1.2:1},ticks:{color:'#64748b',font:{size:10},callback:v=>fmtAxis(v,cur),maxTicksLimit:7},border:{display:false}}},
      layout:{padding:{left:4,right:8,top:8,bottom:2}}}});
}

function mkDonut(id, cats, cur) {
  const el=document.getElementById(id); if(!el||!cats.length) return; killCh(id);
  const tot=cats.reduce((s,c)=>s+c.val,0);
  ch[id]=new Chart(el,{type:'doughnut',data:{labels:cats.map(c=>c.cat),datasets:[{
    data:cats.map(c=>c.val),
    backgroundColor:cats.map((_,i)=>PAL[i%PAL.length]),
    borderWidth:3,borderColor:'white',
    hoverOffset:10,hoverBorderWidth:3}]},
    options:{animation:window.FreevChartMotion?.doughnut({duration:820,sliceStep:34})??false,responsive:true,maintainAspectRatio:false,cutout:'68%',
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:c=>`${c.label} : ${fmt(c.raw,cur)} (${fmtPct(c.raw,tot)})`}},
        rptDonutCenter:{lines:['Total',fmt(tot,cur)]}
      }
    }
  });
}

function mkBarCat(id, cats, cur) {
  const el=document.getElementById(id); if(!el||!cats.length) return; killCh(id);
  const top=cats.slice(0,8);
  const labels=top.map(c=>c.cat.length>18?c.cat.slice(0,17)+'…':c.cat);
  ch[id]=new Chart(el,{type:'bar',data:{labels,datasets:[{
    data:top.map(c=>c.val),
    backgroundColor:top.map((_,i)=>PAL[i%PAL.length]),
    borderRadius:{topRight:6,bottomRight:6},
    borderSkipped:'start',
    barPercentage:0.72}]},
    options:{indexAxis:'y',animation:window.FreevChartMotion?.entry({duration:680,pointStep:38,maxDelay:280})??false,responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt(c.raw,cur)}}},
      scales:{x:{grid:{color:'rgba(148,163,184,.1)'},ticks:{color:'#64748b',font:{size:9},callback:v=>fmtAxis(v,cur)},border:{display:false}},
              y:{grid:{display:false},ticks:{color:'#334155',font:{size:10,weight:'600'}},border:{display:false}}},
      layout:{padding:{right:8,top:4,bottom:2}}}});
}

function mkRadar(id, cats, cur) {
  const el=document.getElementById(id); if(!el||!cats.length) return; killCh(id);
  const top=cats.slice(0,8);
  const brand=getBrand();
  ch[id]=new Chart(el,{type:'radar',data:{labels:top.map(c=>c.cat.length>12?c.cat.slice(0,11)+'…':c.cat),datasets:[{
    label:'Dépenses',data:top.map(c=>c.val),
    backgroundColor:hexToRgba(brand,.18),borderColor:brand,
    pointBackgroundColor:brand,pointBorderColor:'white',pointBorderWidth:2,borderWidth:2.5,pointRadius:4,pointHoverRadius:6}]},
    options:{animation:window.FreevChartMotion?.entry({duration:760,pointStep:28,maxDelay:240})??false,responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt(c.raw,cur)}}},
      scales:{r:{ticks:{display:false,backdropColor:'transparent'},
                 grid:{color:'rgba(148,163,184,.2)'},
                 pointLabels:{font:{size:9,weight:'500'},color:'#475569'}}}}}  );
}

function mkBar(id, inc, exp, tr, cur) {
  const el=document.getElementById(id); if(!el) return; killCh(id);
  ch[id]=new Chart(el,{type:'bar',data:{labels:['Revenus','Dépenses','Transferts'],datasets:[{
    data:[inc,exp,tr],
    backgroundColor:['rgba(16,185,129,.82)','rgba(244,63,94,.82)','rgba(139,92,246,.82)'],
    borderColor:['#10b981','#f43f5e','#8b5cf6'],
    borderWidth:0,
    borderRadius:{topLeft:8,topRight:8},
    borderSkipped:'bottom',
    barPercentage:0.65}]},
    options:{animation:window.FreevChartMotion?.entry({duration:660,pointStep:70,maxDelay:210})??false,responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt(c.raw,cur)}}},
      scales:{x:{grid:{display:false},ticks:{color:'#475569',font:{size:11,weight:'600'}},border:{display:false}},
              y:{beginAtZero:true,grid:{color:'rgba(148,163,184,.1)'},ticks:{color:'#64748b',font:{size:10},callback:v=>fmtAxis(v,cur)},border:{display:false}}},
      layout:{padding:{top:8,right:8,bottom:2}}}});
}

function mkCashBridge(id,D){
  const el=document.getElementById(id);if(!el)return;killCh(id);
  const afterIncome=round2(D.startBal+D.income);
  const afterExpenses=round2(afterIncome-D.expenses);
  const checkpoints=[D.startBal,afterIncome,afterExpenses,D.endBal];
  const largestMove=Math.max(D.income,D.expenses,D.transfers,Math.abs(D.endBal-D.startBal),1);
  const pathRange=Math.max(...checkpoints)-Math.min(...checkpoints);
  const padding=Math.max(pathRange*.14,largestMove*.08,1);
  const baseline=Math.min(...checkpoints)-padding;
  const suggestedMax=Math.max(...checkpoints)+padding;
  const values=[
    [baseline,D.startBal],
    [D.startBal,afterIncome],
    [afterIncome,afterExpenses],
    [afterExpenses,D.endBal],
    [baseline,D.endBal]
  ];
  const labels=[fmt(D.startBal,D.cur),fmtSigned(D.income,D.cur),fmtSigned(-D.expenses,D.cur),fmtSigned(-D.transfers,D.cur),fmt(D.endBal,D.cur)];
  ch[id]=new Chart(el,{type:'bar',data:{labels:['Départ','Revenus','Dépenses','Transferts','Arrivée'],datasets:[{
    data:values,
    backgroundColor:['#475569','#2563eb','#f97316','#f97316','#475569'],
    borderColor:['#334155','#1d4ed8','#c2410c','#c2410c','#334155'],
    borderWidth:1,borderRadius:4,borderSkipped:false,barPercentage:.56
  }]},options:{animation:window.FreevChartMotion?.entry({duration:700,pointStep:38,maxDelay:220})??false,responsive:true,maintainAspectRatio:false,
    plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>labels[ctx.dataIndex]}},rptWaterfallConnector:{enabled:true},rptValueLabels:{enabled:true,labels}},
    scales:{x:{grid:{display:false},ticks:{color:'#334155',font:{size:9,weight:'600'}},border:{display:false}},y:{min:baseline,suggestedMax,grid:{color:'rgba(148,163,184,.12)'},ticks:{color:'#64748b',font:{size:9},callback:value=>fmtAxis(value,D.cur),maxTicksLimit:6},border:{display:false}}},
    layout:{padding:{top:20,right:6,bottom:2}}}});
}

function mkTrend(id,trend,cur){
  const el=document.getElementById(id);if(!el)return;killCh(id);
  const net=trend.map(item=>item.net);
  ch[id]=new Chart(el,{type:'bar',data:{labels:trend.map(item=>item.label),datasets:[{
    label:'Résultat net',data:net,backgroundColor:net.map(value=>value>=0?'#2563eb':'#f97316'),borderColor:net.map(value=>value>=0?'#1d4ed8':'#c2410c'),borderWidth:1,borderRadius:4,borderSkipped:'middle',barPercentage:.66,yAxisID:'yNet'
  },{
    type:'line',label:'Solde fin de mois',data:trend.map(item=>item.endBal),borderColor:'#334155',backgroundColor:'#334155',borderWidth:2.25,pointRadius:2.5,pointBackgroundColor:'#fff',pointBorderColor:'#334155',pointBorderWidth:1.5,tension:.2,yAxisID:'yBalance'
  }]},options:{animation:window.FreevChartMotion?.entry({duration:740,pointStep:18,datasetStep:46,maxDelay:420})??false,responsive:true,maintainAspectRatio:false,
    interaction:{mode:'index',intersect:false},
    plugins:{legend:{position:'bottom',labels:{usePointStyle:true,boxWidth:8,padding:10,color:'#475569',font:{size:9,weight:'600'}}},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label} : ${fmt(ctx.raw,cur)}`}}},
    scales:{
      x:{grid:{display:false},ticks:{color:'#475569',font:{size:8},maxRotation:0},border:{display:false}},
      yNet:{position:'left',grid:{color:ctx=>Number(ctx.tick?.value)===0?'rgba(100,116,139,.42)':'rgba(148,163,184,.12)',lineWidth:ctx=>Number(ctx.tick?.value)===0?1.3:1},ticks:{color:'#2563eb',font:{size:8},callback:value=>fmtAxis(value,cur),maxTicksLimit:5},border:{display:false},title:{display:true,text:'Net',color:'#2563eb',font:{size:8,weight:'700'}}},
      yBalance:{position:'right',grid:{display:false},ticks:{display:true,color:'#334155',font:{size:8},callback:value=>fmtAxis(value,cur),maxTicksLimit:5},border:{display:true,color:'rgba(51,65,85,.22)'},title:{display:true,text:'Solde',color:'#334155',font:{size:8,weight:'700'}}}
    },
    layout:{padding:{top:8,right:2,bottom:0}}}});
}

// ===== EXPORT CSV =====
function exportCSV() {
  const id=document.getElementById('accountSel').value;
  const month=document.getElementById('monthSel').value;
  if(!month||!id) return;
  const D=compute(id,month);
  const rows=[['Date','Type','Description','Catégorie','Montant','Devise']];
  [...D.mt].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).forEach(t=>{
    rows.push([
      t.date||'',
      t.type==='income'?'Revenu':t.type==='expense'?'Dépense':'Transfert',
      t.desc||t.description||'',
      t.category||'Autre',
      (Number(t.amountBase??t.amount)||0).toFixed(2).replace('.',','),
      D.cur
    ]);
  });
  const csvCell=value=>{
    let text=String(value??'');
    if(/^[=+\-@]/.test(text)) text=`'${text}`;
    return `"${text.replace(/"/g,'""')}"`;
  };
  const csv=rows.map(r=>r.map(csvCell).join(';')).join('\r\n');
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`Freev_${month}_transactions.csv`;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

// ===== HTML HELPERS =====
function catListHTML(cats, totalForPct, cur) {
  if(!cats.length) return '<div class="no-data">Aucune donnée.</div>';
  const max=cats[0].val||1;
  return `<div class="cat-list">${cats.map((c,i)=>{
    const col=PAL[i%PAL.length];
    const pct=totalForPct>0?Math.round(c.val/totalForPct*100):0;
    const bw=Math.round(c.val/max*100);
    return `<div class="cat-item"><div class="cat-dot" style="background:${col}"></div><div class="cat-name">${escapeHTML(c.cat)}</div><div class="cat-bw"><div class="cat-b" style="width:${bw}%;background:${col}"></div></div><div class="cat-pct">${pct}%</div><div class="cat-val">${fmt(c.val,cur)}</div></div>`;
  }).join('')}</div>`;
}

// ===== RENDER =====
function render() {
  const id=document.getElementById('accountSel').value;
  const month=document.getElementById('monthSel').value;
  if(!month||!id) return;

  const acc=id==='__all__'?null:gAcc(id);
  const accName=id==='__all__'?'Tous les comptes':(acc?.name||'Compte');
  const rawAccColor=acc?.color||'#3b82f6';
  const accColor=/^#[0-9a-f]{3,8}$/i.test(rawAccColor)?rawAccColor:'#3b82f6';
  const opts={
    ins:$c('o_ins'),cf:$c('o_cf'),tr:$c('o_tr'),
    bc:$c('o_bc'),cc:$c('o_cc'),ic:$c('o_ic'),cd:$c('o_cd'),st:$c('o_st'),
    bu:$c('o_bu'),sd:$c('o_sd'),tx:$c('o_tx'),tg:$c('o_tg'),cmp:$c('o_cmp')
  };

  const D=compute(id,month);
  const prevM=prevMonth(month);
  const P=opts.cmp ? compute(id, prevM) : null;
  const trend=opts.tr?computeTrend(id,month):[];
  const insights=opts.ins?buildReportInsights(D,P,month):[];

  const now=new Date();
  const genDate=now.toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const sortedTx=[...D.mt].sort((a,b)=>(b.date||'').localeCompare(a.date||''));

  // Apply search filter
  const searchLow=txSearch.toLowerCase();
  const filteredTx=txSearch ? sortedTx.filter(t=>{
    const desc=(t.desc||t.description||'').toLowerCase();
    const cat=(t.category||'').toLowerCase();
    return desc.includes(searchLow)||cat.includes(searchLow);
  }) : sortedTx;
  const dispTx=txLim==='all'?filteredTx:filteredTx.slice(0,Number(txLim));

  // Save focus state
  const hadTxFocus = document.activeElement?.id==='txSearchInput';

  Object.keys(ch).forEach(killCh);

  const hasBudget=Object.keys(D.budgets).length>0;
  const hasSavDet=Object.keys(D.savDet).length>0;

  document.getElementById('RC').innerHTML = `
  <div class="rh">
    <div class="rh-b1"></div><div class="rh-b2"></div>
    <div class="rh-in">
      <div class="rh-brand">
        <div class="rh-icon">💳</div>
        <div><div class="rh-bname">Freev Valeur</div><div class="rh-bsub">Rapport financier mensuel</div></div>
      </div>
      <div class="rh-row">
        <div>
          <div class="rh-title">${frenchMonth(month)}</div>
          <div class="rh-sub">${D.mt.length} transaction${D.mt.length>1?'s':''} · ${D.cur} · ${D.days} jours${P?` · vs ${frenchMonth(prevM)}`:''}</div>
        </div>
        <div class="rh-meta">
          <div class="acc-chip"><span class="acc-dot" style="background:${accColor}"></span>${escapeHTML(accName)}</div>
          <div class="gen-date">Généré le ${genDate}</div>
        </div>
      </div>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi kpi-i">
      <div class="kpi-lbl">Revenus</div>
      <div class="kpi-val">${fmt(D.income,D.cur)}</div>
      <div class="kpi-sub">${D.txByType.i} entrée${D.txByType.i>1?'s':''}</div>
      ${P ? deltaChip(D.income, P.income) : ''}
      <div class="kpi-ico">↑</div>
    </div>
    <div class="kpi kpi-e">
      <div class="kpi-lbl">Dépenses</div>
      <div class="kpi-val">${fmt(D.expenses,D.cur)}</div>
      <div class="kpi-sub">${D.txByType.e} sortie${D.txByType.e>1?'s':''}</div>
      ${P ? deltaChipInv(D.expenses, P.expenses) : ''}
      <div class="kpi-ico">↓</div>
    </div>
    <div class="kpi kpi-n">
      <div class="kpi-lbl">Résultat net</div>
      <div class="kpi-val${D.net<0?' neg':''}">${D.net>=0?'+':''}${fmt(D.net,D.cur)}</div>
      <div class="kpi-sub">${D.net>=0?'Excédent':'Déficit'}</div>
      ${P ? deltaChip(D.net, P.net) : ''}
      <div class="kpi-ico">≈</div>
    </div>
    <div class="kpi kpi-b">
      <div class="kpi-lbl">Solde fin mois</div>
      <div class="kpi-val">${fmt(D.endBal,D.cur)}</div>
      <div class="kpi-sub">Début : ${fmt(D.startBal,D.cur)}</div>
      ${P ? deltaChip(D.endBal, P.endBal) : ''}
      <div class="kpi-ico">⬤</div>
    </div>
    <div class="kpi kpi-s">
      <div class="kpi-lbl">Épargne totale</div>
      <div class="kpi-val">${fmt(D.savings,D.cur)}</div>
      <div class="kpi-sub">Transferts : ${fmt(D.transfers,D.cur)}</div>
      ${P ? deltaChip(D.savings, P.savings) : ''}
      <div class="kpi-ico">🏦</div>
    </div>
  </div>

  ${opts.ins?`<div class="sec insight-sec">
    <div class="sec-hd"><div class="sec-title">Synthèse du mois</div><span class="sec-badge">Analyse automatique</span></div>
    <div class="insight-grid">${insights.map(item=>`<div class="insight-card ${item.tone}"><div class="insight-icon">${item.icon}</div><div><div class="insight-title">${item.title}</div><div class="insight-text">${item.text}</div></div></div>`).join('')}</div>
  </div>`:''}

  ${opts.cf||opts.tr?`<div class="ch2 report-decision-charts">
    ${opts.cf?`<div class="sec chart-section"><div class="sec-hd"><div class="sec-title">Pont de trésorerie</div><span class="sec-badge">Étapes · échelle ajustée</span></div><div class="ch-box-sm chart-flow"><canvas id="ch_flow" role="img" aria-label="Pont de trésorerie du mois"></canvas></div></div>`:'<div></div>'}
    ${opts.tr?`<div class="sec chart-section"><div class="sec-hd"><div class="sec-title">Tendance sur 12 mois</div><span class="sec-badge">Net à gauche · solde à droite</span></div><div class="ch-box-sm"><canvas id="ch_trend" role="img" aria-label="Résultat net et solde sur douze mois avec deux échelles visibles"></canvas></div></div>`:'<div></div>'}
  </div>`:''}

  ${opts.bc?`<div class="sec chart-section"><div class="sec-hd"><div class="sec-title">Évolution du solde</div><span class="sec-badge">Après chaque opération</span></div><div class="ch-box"><canvas id="ch_bal" role="img" aria-label="Évolution du solde après chaque opération"></canvas></div></div>`:''}

  ${opts.cc||opts.ic?`<div class="ch2">
    ${opts.cc?`<div class="sec chart-section"><div class="sec-hd"><div class="sec-title">Répartition dépenses</div><span class="sec-badge">${D.catBD.length} catégorie${D.catBD.length>1?'s':''}</span></div><div class="ch-box-sm"><canvas id="ch_cat" role="img" aria-label="Répartition des dépenses par catégorie"></canvas></div></div>`:'<div></div>'}
    ${opts.ic?`<div class="sec chart-section"><div class="sec-hd"><div class="sec-title">Revenus · Dépenses · Transferts</div></div><div class="ch-box-sm"><canvas id="ch_ine" role="img" aria-label="Comparaison des revenus, dépenses et transferts"></canvas></div></div>`:'<div></div>'}
  </div>`:''}

  ${opts.cd||opts.st?`<div class="stat2">
    ${opts.cd?`<div class="sec pdf-categories">
      <div class="sec-hd"><div class="sec-title">Top catégories dépenses</div></div>
      ${catListHTML(D.catBD,D.expenses,D.cur)}
      ${D.incCats.length?`<div class="sec-hd" style="margin-top:1rem;"><div class="sec-title">Top catégories revenus</div></div>${catListHTML(D.incCats,D.income,D.cur)}`:''}
    </div>`:'<div></div>'}
    ${opts.st?`<div class="sec pdf-stats">
      <div class="sec-hd"><div class="sec-title">Statistiques avancées</div></div>
      <div class="stats-grid"><div class="stats-block">
      <div class="stat-row"><span class="stat-k">Taux d'épargne</span><span class="stat-v ${D.savRate>=20?'pos':D.savRate<0?'neg':''}">${D.savRate.toFixed(1).replace('.',',')} %</span></div>
      <div class="stat-row"><span class="stat-k">Dépense moy. / transaction</span><span class="stat-v">${fmt(D.avgExp,D.cur)}</span></div>
      <div class="stat-row"><span class="stat-k">Dépense moy. / jour</span><span class="stat-v">${fmt(D.dailyAvgExp,D.cur)}</span></div>
      <div class="stat-row"><span class="stat-k">Plus grosse dépense</span><span class="stat-v neg">${fmt(D.maxExpVal,D.cur)}${D.maxExpTx?` <small style="font-weight:400;color:var(--s400)">(${escapeHTML(D.maxExpTx.category||'?')})</small>`:''}</span></div>
      <div class="stat-row"><span class="stat-k">Variation du solde</span><span class="stat-v ${D.endBal>=D.startBal?'pos':'neg'}">${D.endBal>=D.startBal?'+':''}${fmt(D.endBal-D.startBal,D.cur)}</span></div>
      <div class="stat-row"><span class="stat-k">Solde début de mois</span><span class="stat-v">${fmt(D.startBal,D.cur)}</span></div>
      <div class="stat-row"><span class="stat-k">Solde fin de mois</span><span class="stat-v">${fmt(D.endBal,D.cur)}</span></div>
      <div class="stat-row"><span class="stat-k">Transactions (revenus)</span><span class="stat-v pos">${D.txByType.i}</span></div>
      <div class="stat-row"><span class="stat-k">Transactions (dépenses)</span><span class="stat-v neg">${D.txByType.e}</span></div>
      </div><div class="stats-block">
      <div class="stat-row"><span class="stat-k">Transactions (transferts)</span><span class="stat-v">${D.txByType.t}</span></div>
      <div class="stat-row"><span class="stat-k">Catégories de dépenses</span><span class="stat-v">${D.catBD.length}</span></div>
      <div class="stat-row"><span class="stat-k">Nombre de jours</span><span class="stat-v">${D.days}</span></div>
      ${P?`
      <div class="stat-row" style="border-top:2px solid var(--s200);margin-top:.4rem;padding-top:.55rem">
        <span class="stat-k" style="font-weight:700;color:var(--s700)">↔️ vs ${frenchMonth(prevM)}</span>
      </div>
      <div class="stat-row"><span class="stat-k">Δ Revenus</span><span class="stat-v ${D.income>=P.income?'pos':'neg'}">${D.income>=P.income?'+':''}${fmt(D.income-P.income,D.cur)}</span></div>
      <div class="stat-row"><span class="stat-k">Δ Dépenses</span><span class="stat-v ${D.expenses<=P.expenses?'pos':'neg'}">${D.expenses>=P.expenses?'+':''}${fmt(D.expenses-P.expenses,D.cur)}</span></div>
      <div class="stat-row"><span class="stat-k">Δ Résultat net</span><span class="stat-v ${D.net>=P.net?'pos':'neg'}">${D.net>=P.net?'+':''}${fmt(D.net-P.net,D.cur)}</span></div>
      <div class="stat-row"><span class="stat-k">Δ Taux d'épargne</span><span class="stat-v ${D.savRate>=P.savRate?'pos':'neg'}">${D.savRate>=P.savRate?'+':''}${(D.savRate-P.savRate).toFixed(1).replace('.',',')} pts</span></div>`:''}
      </div></div>
    </div>`:'<div></div>'}
  </div>`:''}

  ${opts.bu&&hasBudget?`<div class="sec pdf-budget">
    <div class="sec-hd"><div class="sec-title">Analyse des budgets</div><span class="sec-badge">${Object.keys(D.budgets).length} catégorie${Object.keys(D.budgets).length>1?'s':''}</span></div>
    ${Object.entries(D.budgets).map(([cat,budget])=>{
      const spent=D.catBD.find(c=>c.cat===cat)?.val||0;
      const pct=budget>0?Math.min(Math.round(spent/budget*100),100):0;
      const cls=spent>budget?'over':spent>budget*.8?'warn':'ok';
      return `<div class="bud-row"><div class="bud-cat">${escapeHTML(cat)}</div><div class="bud-bw"><div class="bud-b ${cls}" style="width:${pct}%"></div></div><div class="bud-vals">${fmt(spent,D.cur)} / ${fmt(budget,D.cur)}</div><div class="bud-st ${cls}">${spent>budget?'Dépassé':spent>budget*.8?'⚠ Limite':'✓ OK'}</div></div>`;
    }).join('')}
  </div>`:''}

  ${opts.sd&&hasSavDet?`<div class="sec pdf-savings">
    <div class="sec-hd"><div class="sec-title">Détail des livrets d'épargne</div></div>
    ${Object.entries(D.savDet).map(([n,v])=>`<div class="stat-row"><span class="stat-k">🏦 ${escapeHTML(n)}</span><span class="stat-v pos">${fmt(v,D.cur)}</span></div>`).join('')}
    <div class="stat-row" style="border-top:2px solid var(--s200);margin-top:4px;padding-top:8px;">
      <span class="stat-k" style="font-weight:700;color:var(--s700)">Total épargne</span>
      <span class="stat-v pos" style="font-size:.87rem">${fmt(D.savings,D.cur)}</span>
    </div>
  </div>`:''}

  <div class="strip">
    <div class="str-it"><div class="str-lbl">Taux d'épargne</div><div class="str-val" style="color:#10b981">${D.savRate.toFixed(1).replace('.',',')} %</div></div>
    <div class="str-it"><div class="str-lbl">Dépense / jour</div><div class="str-val" style="color:#f43f5e">${fmt(D.dailyAvgExp,D.cur)}</div></div>
    <div class="str-it"><div class="str-lbl">Transferts épargne</div><div class="str-val" style="color:#8b5cf6">${fmt(D.transfers,D.cur)}</div></div>
    <div class="str-it"><div class="str-lbl">Épargne totale</div><div class="str-val" style="color:#f59e0b">${fmt(D.savings,D.cur)}</div></div>
  </div>

  ${opts.tx?`<div class="sec pdf-transactions">
    <div class="sec-hd">
      <div class="sec-title">Détail des transactions</div>
      <span class="sec-badge">${dispTx.length}${txSearch?` / ${filteredTx.length} filtrées`:txLim!=='all'?` / ${D.mt.length}`:''}</span>
      <div class="sec-act">
        <input class="tx-search" type="text" id="txSearchInput" placeholder="🔍 Rechercher…"
          value="${escapeHTML(txSearch)}"
          oninput="onTxSearchInput(this.value)">
        <button class="btn-csv" onclick="exportCSV()" title="Exporter en CSV">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export CSV
        </button>
      </div>
    </div>
    ${dispTx.length?`<table class="tx-t">
      <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Catégorie</th>${opts.tg?'<th>Tags</th>':''}<th>Montant</th></tr></thead>
      <tbody>${dispTx.map(t=>{
        const amt=Number(t.amountBase??t.amount)||0;
        const aC=t.type==='income'?'a-inc':t.type==='expense'?'a-exp':'a-tr';
        const sign=t.type==='income'?'+':t.type==='transfer'?'→':'-';
        const cat=t.category||'Autre';
        const ci=D.catBD.findIndex(c=>c.cat===cat);
        const cc=PAL[ci>=0?ci%PAL.length:Math.abs(cat.charCodeAt(0)%PAL.length)];
        const fx=t.currency&&t.currency!==D.cur&&t.amount!==undefined?`<br><span class="tx-fx">${fmt(t.amount,t.currency||D.cur)} × ${t.fxRate||1}</span>`:'';
        const desc=t.desc||t.description||'—';
        return `<tr>
          <td class="tx-date">${frDate(t.date)}</td>
          <td><span class="badge ${t.type==='income'?'b-inc':t.type==='expense'?'b-exp':'b-tr'}">${t.type==='income'?'Revenu':t.type==='expense'?'Dépense':'Transfert'}</span></td>
          <td class="tx-desc" title="${escapeHTML(desc)}">${hlSearch(desc)}${fx}</td>
          <td><span class="tx-cat-p"><span class="tx-cat-d" style="background:${cc}"></span>${hlSearch(cat)}</span></td>
          ${opts.tg?`<td class="tx-tags">${escapeHTML((t.tags||[]).join(', ')||'—')}</td>`:''}
          <td class="${aC}">${sign} ${fmt(amt,D.cur)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>
    ${txLim!=='all'&&filteredTx.length>dispTx.length?`<div style="text-align:center;padding:.65rem;font-size:.72rem;color:var(--s400)">${filteredTx.length-dispTx.length} transaction(s) masquée(s) — modifiez la limite à gauche.</div>`:''}`
    :`<div class="no-data">${txSearch?`Aucune transaction ne correspond à « ${escapeHTML(txSearch)} ».`:'Aucune transaction pour ce mois.'}</div>`}
  </div>`:''}

  <div class="rfoot">Rapport <strong>Freev Valeur</strong> — ${genDate}<br>Document confidentiel · Données personnelles · ${escapeHTML(accName)}</div>
  <div class="print-page-footer"><span>Freev Valeur · ${escapeHTML(accName)} · ${frenchMonth(month)}</span><span class="print-page-number"></span></div>`;

  // Restore search input focus
  if(hadTxFocus || txSearch) {
    const si=document.getElementById('txSearchInput');
    if(si){si.focus();const l=si.value.length;si.setSelectionRange(l,l);}
  }

  reportChartsReady=new Promise(resolve=>setTimeout(()=>{
    if(window.Chart){
      registerReportChartPlugins();
      if(opts.cf) safeChart('ch_flow',()=>mkCashBridge('ch_flow',D));
      if(opts.tr) safeChart('ch_trend',()=>mkTrend('ch_trend',trend,D.cur));
      if(opts.bc) safeChart('ch_bal',()=>mkLine('ch_bal',D.daily,D.cur));
      if(opts.cc){
        if(D.catBD.length) safeChart('ch_cat',()=>{
          if(catChType==='donut')    mkDonut('ch_cat',D.catBD,D.cur);
          else if(catChType==='bar') mkBarCat('ch_cat',D.catBD,D.cur);
          else                       mkRadar('ch_cat',D.catBD,D.cur);
        });
        else showChartUnavailable('ch_cat');
      }
      if(opts.ic) safeChart('ch_ine',()=>mkBar('ch_ine',D.income,D.expenses,D.transfers,D.cur));
    }else document.querySelectorAll('.ch-box canvas,.ch-box-sm canvas').forEach(canvas=>showChartUnavailable(canvas.id));
    requestAnimationFrame(()=>requestAnimationFrame(resolve));
  },60));
}

function $c(id){return document.getElementById(id).checked;}

// ===== PRINT =====
async function doPrint(){
  const name=document.getElementById('pdfName').value.trim()||'Freev_Rapport';
  const button=document.getElementById('printBtn');
  const oldHtml=button?.innerHTML;
  if(button){button.disabled=true;button.innerHTML='<span class="print-spinner"></span> Préparation…';}
  try{
    await reportChartsReady;
    if(document.fonts?.ready)await document.fonts.ready;
    document.title=name;
    document.body.classList.add('printing-ready');
    await resizeChartsForCurrentLayout();
    await new Promise(resolve=>setTimeout(resolve,160));
    window.print();
  }finally{
    document.body.classList.remove('printing-ready');
    document.title='Freev — Rapport Mensuel';
    if(button){button.disabled=false;button.innerHTML=oldHtml;}
  }
}

async function resizeChartsForCurrentLayout(){
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  Object.values(ch).forEach(chart=>{try{chart.resize();chart.update('none');}catch(_) {}});
  await new Promise(resolve=>requestAnimationFrame(resolve));
}

// ===== INIT =====
function showAccessMessage(title,message){
  document.getElementById('RC').innerHTML=`<div class="access-card"><div class="access-icon">🔒</div><div class="access-title">${escapeHTML(title)}</div><div class="access-text">${escapeHTML(message)}</div><a class="access-link" href="index.html">Retour à la connexion Freev</a></div>`;
}

async function requireFirebaseSession(){
  if(window.FIREBASE_REQUIRED===false)return { uid: '' };
  if(!window.FIREBASE_CONFIGURED||!window.FIREBASE_CONFIG){showAccessMessage('Firebase obligatoire','La configuration Firebase est absente ou incomplète.');return false;}
  try{
    const imports=Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js')
    ]);
    const timeout=new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),8000));
    const [appModule,authModule]=await Promise.race([imports,timeout]);
    // Firebase Auth sépare sa session par nom d'application. L'écran principal
    // utilise l'application [DEFAULT] : le rapport doit impérativement utiliser
    // la même clé, sinon un utilisateur déjà connecté apparaît déconnecté ici.
    const app=appModule.getApps().length
      ? appModule.getApp()
      : appModule.initializeApp(window.FIREBASE_CONFIG);
    const auth=authModule.getAuth(app);
    const user=await new Promise(resolve=>{
      let stop=()=>{};
      stop=authModule.onAuthStateChanged(auth,current=>{stop();resolve(current||null);},()=>resolve(null));
    });
    if(!user){showAccessMessage('Connexion requise','Connectez-vous à Freev avec Firebase avant d’ouvrir le rapport mensuel.');return null;}
    return user;
  }catch(error){
    console.error('[Freev rapport] Firebase indisponible',error);
    showAccessMessage('Connexion Firebase impossible','Vérifiez votre connexion Internet puis réessayez depuis Freev.');
    return false;
  }
}

window.addEventListener('beforeprint',()=>{
  document.body.classList.add('printing-ready');
  Object.values(ch).forEach(chart=>{try{chart.resize();chart.update('none');}catch(_) {}});
});
window.addEventListener('afterprint',()=>{
  document.body.classList.remove('printing-ready');
  Object.values(ch).forEach(chart=>{try{chart.resize();chart.update('none');}catch(_) {}});
});

async function init(){
  const user=await requireFirebaseSession();
  if(!user)return;
  if(!loadData(user.uid)){
    showAccessMessage('Données non disponibles','Ouvrez ce rapport depuis le même navigateur et le même compte Freev. Les données locales d’un autre compte ne sont jamais affichées.');
    return;
  }
  await ensureReportCharts();
  initCtrl();render();
}
document.addEventListener('DOMContentLoaded',init);
