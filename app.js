window.exportBackup=exportBackup;
window.verifyBackupFile=verifyBackupFile;
window.restoreBackupFile=restoreBackupFile;

function toggleTheme(){const root=document.documentElement;root.dataset.theme=root.dataset.theme==='dark'?'':'dark';localStorage.setItem(THEME_KEY,root.dataset.theme||'light');setTimeout(()=>{const c=document.getElementById('fundChart');if(c){const p=state.positions.find(x=>document.getElementById('detailBackdrop').classList.contains('open')&&document.getElementById('detailContent').textContent.includes(meta(x).name));if(p)drawChart(p,'YTD')}if(document.getElementById('page-analysis')?.classList.contains('active'))renderAnalysis()},30)}

async function init(){
 if(!SUPABASE_URL||!SUPABASE_KEY){showAuth();setAuthMessage('Configuración de Supabase incompleta.',true);return}
 loadCache();state.lastValue=null;renderAll();const ok=await ensureSession();if(!ok){showAuth();return}showApp();await syncFromCloud();await refreshOnStartup();
}

document.getElementById('loginForm')?.addEventListener('submit',async e=>{e.preventDefault();const email=document.getElementById('loginEmail').value.trim(),password=document.getElementById('loginPassword').value;const btn=document.getElementById('loginBtn');btn.disabled=true;setAuthMessage('Conectando…');try{await signIn(email,password);showApp();setAuthMessage('');await syncFromCloud()}catch(err){setAuthMessage(err.message,true)}finally{btn.disabled=false}});
document.getElementById('logoutBtn')?.addEventListener('click',signOut);
document.getElementById('portfolioSelect')?.addEventListener('change',e=>changeActivePortfolio(e.target.value));document.getElementById('managePortfoliosBtn')?.addEventListener('click',openPortfolioManager);
document.getElementById('refreshBtn').onclick=refreshPortfolio;document.getElementById('newOpFab').onclick=openNewOp;document.getElementById('newOpTop').onclick=openNewOp;document.getElementById('positionSearch').oninput=renderPositions;
document.getElementById('opBackdrop').addEventListener('click',e=>{if(e.target.id==='opBackdrop')closeOp()});document.getElementById('detailBackdrop').addEventListener('click',e=>{if(e.target.id==='detailBackdrop')closeDetail()});
document.querySelectorAll('#groupMode button').forEach(b=>b.onclick=()=>{state.group=b.dataset.group;document.querySelectorAll('#groupMode button').forEach(x=>x.classList.toggle('active',x===b));saveCache();renderPositions()});
document.querySelectorAll('#opFilter button').forEach(b=>b.onclick=()=>{state.opFilter=b.dataset.filter;document.querySelectorAll('#opFilter button').forEach(x=>x.classList.toggle('active',x===b));saveCache();renderOps()});
document.getElementById('themeBtn').onclick=toggleTheme;document.getElementById('themeDesktop').onclick=toggleTheme;
let analysisResizeTimer=null;window.addEventListener('resize',()=>{clearTimeout(analysisResizeTimer);analysisResizeTimer=setTimeout(()=>{if(document.getElementById('page-analysis')?.classList.contains('active'))renderAnalysis()},120)});
const savedTheme=localStorage.getItem(THEME_KEY);if(savedTheme==='dark')document.documentElement.dataset.theme='dark';
let deferredInstallPrompt=null;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;for(const id of ['installBtn','installDesktop']){const b=document.getElementById(id);if(b)b.style.display='block'}});async function installApp(){if(!deferredInstallPrompt){alert('Usa el menú del navegador: “Instalar aplicación” o “Añadir a pantalla de inicio”.');return}deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;for(const id of ['installBtn','installDesktop']){const b=document.getElementById(id);if(b)b.style.display='none'}}document.getElementById('installBtn').onclick=installApp;document.getElementById('installDesktop').onclick=installApp;
if('serviceWorker' in navigator){
 window.addEventListener('load',async()=>{
  try{
   const reg=await navigator.serviceWorker.register(`./sw.js?v=${APP_VERSION}`,{updateViaCache:'none'});
   await reg.update().catch(()=>{});
   if(reg.waiting)reg.waiting.postMessage({type:'SKIP_WAITING'});
   let reloading=false;
   navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(reloading)return; reloading=true; window.location.reload();
   });
   fetch(`./version.json?t=${Date.now()}`,{cache:'no-store'}).then(r=>r.ok?r.json():null).then(v=>{
    if(v?.appVersion&&v.appVersion!==APP_VERSION) reg.update().catch(()=>{});
   }).catch(()=>{});
  }catch(err){console.warn('Service worker',err)}
 });
}
renderVersionLabels();
init();
