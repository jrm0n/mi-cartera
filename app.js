window.exportBackup=exportBackup;
window.verifyBackupFile=verifyBackupFile;
window.restoreBackupFile=restoreBackupFile;

function toggleTheme(){const root=document.documentElement;root.dataset.theme=root.dataset.theme==='dark'?'':'dark';safeStorageSet(THEME_KEY,root.dataset.theme||'light');setTimeout(()=>{const c=document.getElementById('fundChart');if(c){const p=state.positions.find(x=>document.getElementById('detailBackdrop').classList.contains('open')&&document.getElementById('detailContent').textContent.includes(meta(x).name));if(p)drawChart(p,'YTD')}if(document.getElementById('page-analysis')?.classList.contains('active'))renderAnalysis()},30)}

function closeViewerSync(){document.getElementById('viewerSyncOverlay').hidden=true;document.getElementById('viewerSyncBtn').focus()}
async function syncViewerData(){
 const button=document.getElementById('viewerSyncBtn');if(button.disabled)return;
 const overlay=document.getElementById('viewerSyncOverlay'),spinner=document.getElementById('viewerSyncSpinner'),title=document.getElementById('viewerSyncTitle'),message=document.getElementById('viewerSyncMessage'),close=document.getElementById('viewerSyncClose');
 button.disabled=true;overlay.hidden=false;spinner.hidden=false;close.hidden=true;title.textContent='Sincronizando datos…';message.textContent='Consultando la cartera en Supabase. Espera un momento.';
 try{
  const ok=await syncFromCloud(false);
  title.textContent=ok?'Datos sincronizados':'No se pudo sincronizar';
  message.textContent=ok?'La cartera ya muestra los datos disponibles en Supabase.':'Comprueba la conexión e inténtalo de nuevo.';
 }catch(error){console.error(error);title.textContent='No se pudo sincronizar';message.textContent='Comprueba la conexión e inténtalo de nuevo.'}
 finally{button.disabled=false;spinner.hidden=true;close.hidden=false;close.focus()}
}

async function init(){
 if(!SUPABASE_URL||!SUPABASE_KEY){showAuth();setAuthMessage('Configuración de Supabase incompleta.',true);return}
 if(await acceptInvitation())return;
 const ok=await ensureSession();if(!ok){showAuth();return}await loadCache();if(state.portfolios.length)updateAccessMode();state.lastValue=null;renderAll();showApp();if(await syncFromCloud()&&!state.readonly)await refreshOnStartup(true);
}

async function acceptInvitation(){
 const hash=new URLSearchParams(location.hash.slice(1));
 if(hash.get('type')!=='invite'||!hash.get('access_token')||!hash.get('refresh_token'))return false;
 history.replaceState(null,'',location.pathname+location.search);
 try{
  const user=await authFetch('/auth/v1/user',{headers:{Authorization:`Bearer ${hash.get('access_token')}`}});
  saveSession({access_token:hash.get('access_token'),refresh_token:hash.get('refresh_token'),expires_in:Number(hash.get('expires_in'))||3600,expires_at:Math.floor(Date.now()/1000)+(Number(hash.get('expires_in'))||3600),user});
  showAuth();document.getElementById('authTitle').textContent='Crear contraseña';document.getElementById('authSubtitle').textContent='Elige una contraseña para acceder a las carteras compartidas contigo.';
  document.getElementById('loginForm').style.display='none';document.getElementById('invitationForm').style.display='grid';
 }catch(error){showAuth();setAuthMessage('No se pudo abrir la invitación: '+error.message,true)}
 return true;
}
document.getElementById('invitationForm').addEventListener('submit',async event=>{
 event.preventDefault();const button=event.currentTarget.querySelector('button'),message=document.getElementById('invitationMessage');button.disabled=true;
 try{await authFetch('/auth/v1/user',{method:'PUT',headers:{Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({password:document.getElementById('invitationPassword').value})});document.getElementById('invitationPassword').value='';document.getElementById('invitationForm').style.display='none';document.getElementById('loginForm').style.display='grid';if(!await syncFromCloud())throw new Error('No se pudo cargar la cartera compartida. Vuelve a iniciar sesión.');showApp();}
 catch(error){showAuth();message.textContent='No se pudo guardar la contraseña: '+error.message}
 finally{button.disabled=false}
});

document.getElementById('loginForm')?.addEventListener('submit',async e=>{e.preventDefault();const email=document.getElementById('loginEmail').value.trim(),password=document.getElementById('loginPassword').value;const btn=document.getElementById('loginBtn');btn.disabled=true;setAuthMessage('Conectando…');try{await signIn(email,password);state.positions=[];state.operations=[];state.portfolios=[];cloudSnapshot=null;state.readonly=false;await loadCache();if(state.portfolios.length)updateAccessMode();setAuthMessage('');if(await syncFromCloud())showApp()}catch(err){setAuthMessage(err.message,true)}finally{btn.disabled=false}});
document.getElementById('logoutBtn')?.addEventListener('click',signOut);
document.getElementById('portfolioSelect')?.addEventListener('change',e=>changeActivePortfolio(e.target.value));
document.getElementById('refreshBtn').onclick=refreshPortfolio;document.getElementById('newOpFab').onclick=openNewOp;document.getElementById('newOpTop').onclick=openNewOp;document.getElementById('newSanTop').onclick=()=>{if(state.readonly)return;openNewOp();document.querySelectorAll('#typeSeg button').forEach(x=>x.classList.toggle('active',x.dataset.type==='Inicio SAN 2026'));renderOpForm('Inicio SAN 2026')};document.getElementById('positionSearch').oninput=renderPositions;
document.getElementById('opBackdrop').addEventListener('click',e=>{if(e.target.id==='opBackdrop')closeOp()});document.getElementById('detailBackdrop').addEventListener('click',e=>{if(e.target.id==='detailBackdrop')closeDetail()});
document.querySelectorAll('#groupMode button').forEach(b=>b.onclick=()=>{state.group=b.dataset.group;document.querySelectorAll('#groupMode button').forEach(x=>x.classList.toggle('active',x===b));saveCache();renderPositions()});
document.querySelectorAll('#opFilter button').forEach(b=>b.onclick=()=>{state.opFilter=b.dataset.filter;document.querySelectorAll('#opFilter button').forEach(x=>x.classList.toggle('active',x===b));saveCache();renderOps()});
document.getElementById('themeBtn').onclick=toggleTheme;document.getElementById('themeDesktop').onclick=toggleTheme;
let analysisResizeTimer=null;window.addEventListener('resize',()=>{clearTimeout(analysisResizeTimer);analysisResizeTimer=setTimeout(()=>{if(document.getElementById('page-analysis')?.classList.contains('active'))renderAnalysis()},120)});
const savedTheme=safeStorageGet(THEME_KEY);if(savedTheme==='dark')document.documentElement.dataset.theme='dark';
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
