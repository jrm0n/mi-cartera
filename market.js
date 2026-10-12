// La cuota se consulta manualmente o al terminar una actualización manual de precios.
let eodQuotaSnapshot=null,quotaLoading=false,quotaError='';
function quotaCardHtml(){
 if(state.readonly)return '';
 const quota=eodQuotaSnapshot?.userId===session?.user?.id?eodQuotaSnapshot:null;
 let detail='Pulsa «Consultar cuota» para ver el consumo de tu cuenta.';
 let status='muted';
 if(quota){
  const expired=Date.now()>=Date.parse(quota.reset_at);
  const old=Date.now()-Date.parse(quota.checked_at)>10*60000;
  status=expired||old?'pending':quota.remaining===0?'metric-negative':quota.remaining<=2?'pending':'metric-positive';
  const checked=new Date(quota.checked_at).toLocaleString('es-ES',{timeZone:'Europe/Madrid'});
  const reset=new Date(quota.reset_at).toLocaleString('es-ES',{timeZone:'Europe/Madrid',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  detail=`Usadas: <strong>${quota.used} de ${quota.limit}</strong> · Disponibles: <strong>${quota.remaining}</strong>${quota.extra?` · Extras: ${quota.extra}`:''}<br>Reinicio: ${esc(reset)} · hora peninsular<br><span class="muted">Consultada: ${esc(checked)}${expired?' · El periodo ha terminado; consulta de nuevo.':old?' · Lectura anterior; consulta para comprobar el consumo actual.':''}</span>`;
 }
 return `<div class="quality-row" id="eodQuotaCard"><strong>Cuota EODHD</strong><div class="${status}" style="margin:8px 0;line-height:1.5">${detail}</div>${quotaError?`<div class="metric-negative" role="status">${esc(quotaError)}</div>`:''}<button class="btn small" type="button" onclick="refreshEodQuota()" ${quotaLoading?'disabled':''}>${quotaLoading?'Consultando…':'Consultar cuota'}</button></div>`;
}
function renderEodQuotaCard(){const el=document.getElementById('eodQuotaCard');if(el)el.outerHTML=quotaCardHtml();}
async function refreshEodQuota(){
 if(quotaLoading||state.readonly||!session?.user?.id)return;
 const userId=session.user.id,epoch=sessionEpoch;quotaLoading=true;quotaError='';renderEodQuotaCard();
 try{
  const result=await edge('resolve-fund',{action:'quota'}),q=result?.quota;
  if(session?.user?.id!==userId||sessionEpoch!==epoch)return;
  if(!q||![q.used,q.limit,q.extra,q.remaining].every(x=>Number.isFinite(x)&&x>=0)||q.limit<=0||!Number.isFinite(Date.parse(q.checked_at))||!Number.isFinite(Date.parse(q.reset_at)))throw new Error('El servicio no devolvió una cuota válida.');
  eodQuotaSnapshot={...q,userId};
 }catch(error){if(session?.user?.id===userId&&sessionEpoch===epoch)quotaError='No se pudo consultar la cuota. '+refreshSafeDetail(error.message);}
 finally{quotaLoading=false;renderEodQuotaCard();}
}
window.refreshEodQuota=refreshEodQuota;

function setRefreshProgress(running,message,current=0,totalCount=0,kind='ok'){
 const box=document.getElementById('refreshProgress'),text=document.getElementById('refreshProgressText'),fill=document.getElementById('refreshProgressFill'),button=document.getElementById('refreshBtn');if(!box||!text||!fill||!button)return;
 box.hidden=false;text.textContent=message;const percent=totalCount>0?Math.min(100,Math.max(0,current/totalCount*100)):(running?8:100);fill.style.width=`${percent}%`;fill.style.background=kind==='error'?'var(--bad)':kind==='warn'?'var(--warn)':'var(--good)';button.disabled=running;button.textContent=running?`↻ Actualizando${totalCount?` ${current}/${totalCount}`:'…'}`:'↻ Actualizar cartera';button.setAttribute('aria-busy',running?'true':'false');
}
function allPortfolioMarketPositions(){
 if(!cloudSnapshot)return state.positions||[];const activePortfolioIds=new Set((state.portfolios||[]).filter(p=>p.active!==false).map(p=>p.id)),accounts=(cloudSnapshot.accounts||[]).filter(a=>a.active!==false&&activePortfolioIds.has(a.portfolio_id)),accountIds=new Set(accounts.map(a=>a.id)),ops=(cloudSnapshot.ops||[]).filter(o=>accountIds.has(o.account_id)),rules=(cloudSnapshot.recurringRules||[]).filter(r=>accountIds.has(r.account_id)&&activePortfolioIds.has(r.portfolio_id)),recurring=expandRecurringRules(rules,cloudSnapshot.navs||[],cloudSnapshot.listingPrices||[]),positions=buildPositions([...ops,...recurring.operations],accounts,cloudSnapshot.funds||[],cloudSnapshot.navs||[],cloudSnapshot.listingPrices||[]),accountMap=Object.fromEntries(accounts.map(a=>[a.id,a])),portfolioMap=Object.fromEntries((state.portfolios||[]).map(p=>[p.id,p.name]));return positions.map(p=>{const account=accountMap[p.accountId];return{...p,portfolioName:portfolioMap[account?.portfolio_id]||'Cartera'}});
}
function refreshTargetKey(x){return `${x.isin}|${x.listingSymbol||''}`}
function refreshTargets(){
 const map=new Map();for(const p of allPortfolioMarketPositions()){const key=refreshTargetKey(p),current=map.get(key);if(current){if(p.portfolioName&&!current.portfolios.includes(p.portfolioName))current.portfolios.push(p.portfolioName);continue}map.set(key,{key,isin:p.isin,listingSymbol:p.listingSymbol||null,name:meta(p).name||p.isin,navDate:p.navDate||null,portfolios:p.portfolioName?[p.portfolioName]:[]})}return[...map.values()].sort((a,b)=>String(a.navDate||'').localeCompare(String(b.navDate||''))||a.name.localeCompare(b.name,'es'));
}
function refreshErrorText(err){
 const code=String(err?.code||err?.payload?.error||err?.message||'ERROR_DESCONOCIDO').toUpperCase(),known={INSTRUMENT_NOT_FOUND:'El ISIN no aparece en ninguna fuente disponible.',EODHD_SEARCH_FAILED:'EODHD no respondió al buscar el ISIN.',EODHD_SEARCH_UNAVAILABLE:'No se pudo conectar con EODHD.',EODHD_HISTORY_FAILED:'EODHD no devolvió el histórico solicitado.',TRADEGATE_QUOTE_UNAVAILABLE:'Tradegate no devolvió una cotización válida.',LISTING_NOT_FOUND:'La bolsa seleccionada ya no está disponible.',SERVER_CONFIGURATION_INCOMPLETE:'Falta configurar alguna credencial del servicio de actualización.',PORTFOLIO_OWNER_REQUIRED:'Solo el propietario de una cartera puede actualizar cotizaciones.',INVALID_SESSION:'La sesión de Supabase ha caducado.'};return known[code]||String(err?.message||'Error de actualización');
}
function refreshNeedsFullHistory(target){
 // El servidor descarga diez días en un refresco reciente. Recuperar el histórico
 // completo solo si no hay fecha de referencia o queda fuera de esa ventana.
 const date=String(target.navDate||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return true;
 const stamp=Date.parse(date+'T00:00:00Z');
 return !Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==date||Date.now()-stamp>9*86400000||stamp>Date.now();
}
function refreshSafeDetail(value){
 return String(value||'').replace(/https?:\/\/[^\s<>"']+/gi,'[enlace del proveedor]').replace(/(api[_-]?token|api[_-]?key|authorization|bearer)([\s=:]+)[^\s&,;"<>]+/gi,'$1$2[oculto]').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,500);
}
async function refreshOneTarget(target,action="public"){
 const startedAt=new Date().toISOString();
 try{
  const result=await resolveFund(target.isin,refreshNeedsFullHistory(target),false,target.listingSymbol||null,true,action),quote=result?.latest_nav||null;
  const validQuote=!!quote?.date&&Number.isFinite(+quote?.nav)&&+quote.nav>0;
  const quoteRefreshFailed=result?.history?.reason==='QUOTE_REFRESH_FAILED'||result?.quote_status?.refresh_failed===true;
  const stale=result?.quote_status?.stale===true,status=!validQuote||quoteRefreshFailed&&!result?.history?.fallback_used?'failed':stale?'stale':'updated';
  const diagnostics=result?.diagnostics||[];
  const error=quoteRefreshFailed&&!result?.history?.fallback_used?`No se pudo renovar la cotización.${validQuote?` Se conserva el precio del ${quote.date}.`:''}`:!validQuote?'No se obtuvo un VL/precio válido.':null;
  return{...target,name:result?.fund?.name||target.name,status,source:quote?.source||result?.sources?.identity_nav||null,quoteDate:quote?.date||null,quoteValue:validQuote?+quote.nav:null,currency:quote?.currency||null,historyReason:result?.history?.reason||null,historyRows:+result?.history?.rows_inserted||0,diagnostics,error,errorCode:quoteRefreshFailed?'QUOTE_REFRESH_FAILED':null,startedAt,finishedAt:new Date().toISOString()};
 }catch(err){
  const diagnostics=[...(err?.payload?.diagnostics||[])];
  const providerStatus=err?.payload?.status;
  const detail=refreshSafeDetail(err?.payload?.details);
  if(providerStatus||detail)diagnostics.push({source:String(err?.code||'').startsWith('EODHD')?'EODHD':'Servicio de actualización',ok:false,status:providerStatus||null,detail:[providerStatus?`HTTP ${providerStatus}`:'',detail].filter(Boolean).join(' · ')});
  const error=[refreshSafeDetail(refreshErrorText(err)),providerStatus?`Respuesta del proveedor: HTTP ${providerStatus}.`:null,detail].filter(Boolean).join(' ');
  return{...target,status:'failed',source:null,quoteDate:null,quoteValue:null,currency:null,historyReason:null,historyRows:0,diagnostics,error,errorCode:err?.code||err?.payload?.error||null,startedAt,finishedAt:new Date().toISOString()};
 }
}
async function runRefreshTargets(targets){
 const epoch=sessionEpoch,rows=new Array(targets.length);let cursor=0,completed=0;const workers=Math.min(3,Math.max(1,targets.length));async function worker(){while(true){const index=cursor++;if(index>=targets.length)return;if(sessionEpoch!==epoch)throw new Error('La sesión cambió durante la actualización');const target=targets[index];setRefreshProgress(true,`Actualizando ${completed+1} de ${targets.length}: ${target.name}`,completed,targets.length);rows[index]=await refreshOneTarget(target);completed++;const errors=rows.filter(Boolean).filter(x=>x.status==='failed').length;setCloudStatus(`Actualizando todos los perfiles… ${completed}/${targets.length}`);setRefreshProgress(true,`Procesados ${completed} de ${targets.length}`,completed,targets.length,errors?'warn':'ok')}}await Promise.all(Array.from({length:workers},()=>worker()));return rows;
}
function refreshReportSummary(rows){return{updated:rows.filter(x=>x.status==='updated').length,stale:rows.filter(x=>x.status==='stale').length,failed:rows.filter(x=>x.status==='failed').length}}
async function performAllMarketDataRefresh(showNotice=true,options={}){
 setRefreshProgress(true,'Cargando los fondos de todos los perfiles…',0,0);if((!options.reuseSnapshot||!cloudSnapshot)&&!await syncFromCloud(false))throw new Error('No se pudo sincronizar antes de actualizar; inténtalo de nuevo.');const targets=refreshTargets();setCloudStatus(`Actualizando todos los perfiles… 0/${targets.length}`);setRefreshProgress(true,targets.length?'Preparando todos los perfiles…':'No hay posiciones que actualizar',0,targets.length);if(!targets.length){setRefreshProgress(false,'No hay posiciones que actualizar.',0,0);return{updated:0,stale:0,failed:0,rows:[]}}
 const rows=await runRefreshTargets(targets);if(!await syncFromCloud(false,{priceChanges:true}))throw new Error('Se consultaron los precios, pero no se pudo sincronizar la cartera; inténtalo de nuevo.');const summary=refreshReportSummary(rows);state.refreshReport={startedAt:rows[0]?.startedAt||new Date().toISOString(),finishedAt:new Date().toISOString(),...summary,rows};saveCache();const parts=[`${summary.updated} actualizados`];if(summary.stale)parts.push(`${summary.stale} atrasados`);if(summary.failed)parts.push(`${summary.failed} con error`);const resultText=`Todos los perfiles procesados: ${parts.join(', ')}.`;setRefreshProgress(false,resultText,targets.length,targets.length,summary.failed?'error':summary.stale?'warn':'ok');setCloudStatus(`Sincronizado con Supabase · ${resultText}`,summary.failed?'error':summary.stale?'warn':'');renderAll();if(showNotice)alert(resultText);return{...summary,rows}
}
async function performRefreshRetry(keys){
 const wanted=new Set(keys),old=state.refreshReport?.rows||[],targets=old.filter(x=>wanted.has(x.key)).map(x=>({key:x.key,isin:x.isin,listingSymbol:x.listingSymbol||null,name:x.name||x.isin,navDate:x.quoteDate||x.navDate||null,portfolios:x.portfolios||[]}));if(!targets.length)return;setRefreshProgress(true,'Reintentando instrumentos fallidos…',0,targets.length);try{const retried=await runRefreshTargets(targets);if(!await syncFromCloud(false,{priceChanges:true}))throw new Error('No se pudo sincronizar la cartera después del reintento.');const byKey=new Map(retried.map(x=>[x.key,x])),rows=old.map(x=>byKey.get(x.key)||x),summary=refreshReportSummary(rows);state.refreshReport={startedAt:state.refreshReport?.startedAt||new Date().toISOString(),finishedAt:new Date().toISOString(),...summary,rows};saveCache();const text=`Reintento completado: ${retried.filter(x=>x.status==='updated').length} actualizados, ${retried.filter(x=>x.status==='stale').length} atrasados y ${retried.filter(x=>x.status==='failed').length} con error.`;setRefreshProgress(false,text,targets.length,targets.length,retried.some(x=>x.status==='failed')?'error':retried.some(x=>x.status==='stale')?'warn':'ok');renderAll();alert(text)}catch(err){setRefreshProgress(false,'No se pudo completar el reintento.',0,targets.length,'error');alert('No se pudo completar el reintento: '+err.message)}
}
window.retryRefreshTarget=key=>retryRefreshKeys([key]);window.retryFailedRefreshes=()=>retryRefreshKeys((state.refreshReport?.rows||[]).filter(x=>x.status==='failed').map(x=>x.key));
async function refreshPortfolio(){const button=document.getElementById('refreshBtn');if(button?.disabled)return;state.lastValue=total();saveCache();try{await refreshAllMarketData(true)}catch(err){console.error(err);setRefreshProgress(false,'No se pudo completar la actualización.',0,1,'error');alert('No se pudo actualizar la cartera: '+err.message)}}
const BACKUP_TABLES=['portfolios','accounts','operations','transfers','recurring_operations'];
function backupStatus(message,isError=false){const el=document.getElementById('backupStatus');if(el){el.textContent=message;el.classList.toggle('metric-negative',isError)}}
async function backupDigest(tables){
 const bytes=new TextEncoder().encode(JSON.stringify(tables));
 const hash=await crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function backupRelations(tables,ownerId=null){
 const ids=name=>new Set(tables[name].map(row=>row.id));
 const portfolioIds=ids('portfolios'),accountIds=ids('accounts'),transferIds=ids('transfers');
 for(const name of BACKUP_TABLES){
  if(tables[name].some(row=>!row||typeof row.id!=='string'||!row.id))throw new Error(`Hay registros sin identificador en ${name}.`);
  if(ids(name).size!==tables[name].length)throw new Error(`Hay identificadores repetidos en ${name}.`);
  if(ownerId&&tables[name].some(row=>row.user_id&&row.user_id!==ownerId))throw new Error(`Hay registros de otro usuario en ${name}.`);
 }
 for(const a of tables.accounts)if(!portfolioIds.has(a.portfolio_id))throw new Error('Hay cuentas sin cartera en la copia.');
 for(const o of tables.operations){
  if(!accountIds.has(o.account_id))throw new Error('Hay operaciones sin cuenta en la copia.');
  if(o.transfer_id&&!transferIds.has(o.transfer_id))throw new Error('Hay operaciones con un traspaso ajeno a la copia.');
 }
 for(const t of tables.transfers)if(!accountIds.has(t.from_account_id)||!accountIds.has(t.to_account_id))throw new Error('Hay traspasos sin cuenta en la copia.');
 for(const r of tables.recurring_operations)if(!portfolioIds.has(r.portfolio_id)||!accountIds.has(r.account_id)||tables.accounts.find(a=>a.id===r.account_id)?.portfolio_id!==r.portfolio_id)throw new Error('Hay aportaciones recurrentes sin cartera o cuenta válida en la copia.');
}
async function validateBackupPayload(payload){
 if(!payload||payload.app!=='Mi Cartera'||payload.schemaVersion!==DATA_SCHEMA_VERSION)throw new Error('El archivo no corresponde al esquema de datos de esta versión.');
 if(payload.formatVersion!==2){
  if(!payload.state||!payload.cloudData)throw new Error('El archivo anterior no contiene una copia reconocible.');
  return{legacy:true};
 }
 if(!payload.tables||!BACKUP_TABLES.every(name=>Array.isArray(payload.tables[name])))throw new Error('Faltan tablas de la cartera.');
 if(!payload.ownerId||!payload.cloudProject||!payload.payloadSha256)throw new Error('Faltan datos de identificación o integridad.');
 const {payloadSha256,...content}=payload;
 if(payloadSha256!==await backupDigest(content))throw new Error('El contenido de la copia no coincide con su huella SHA-256.');
 backupRelations(payload.tables,payload.ownerId);
 return{legacy:false,counts:Object.fromEntries(BACKUP_TABLES.map(name=>[name,payload.tables[name].length]))};
}
async function exportBackup(){
 const button=document.getElementById('exportBackupBtn');if(button?.disabled)return;
 if(button)button.disabled=true;backupStatus('Preparando la copia desde Supabase…');
 try{
  if(!session?.user?.id)throw new Error('Inicia sesión antes de exportar.');
  if(!await syncFromCloud(false))throw new Error('No se ha podido leer la cartera completa de Supabase.');
  const tables={};
  for(const name of BACKUP_TABLES)tables[name]=await selectPaged(name,'select=*&order=id.asc');
  backupRelations(tables,session.user.id);
  const payload={app:'Mi Cartera',formatVersion:2,appVersion:APP_VERSION,schemaVersion:DATA_SCHEMA_VERSION,exportedAt:new Date().toISOString(),cloudProject:SUPABASE_URL,ownerId:session.user.id,tables,state,cloudData:cloudSnapshot};
  payload.payloadSha256=await backupDigest(payload);
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`mi-cartera-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  backupStatus('Copia descargada. Usa «Comprobar copia» para verificar el archivo guardado.');
 }catch(err){backupStatus('No se pudo crear la copia: '+err.message,true)}
 finally{if(button)button.disabled=false}
}
async function verifyBackupFile(input){
 const file=input?.files?.[0];if(!file)return;
 try{
  const payload=JSON.parse(await file.text()),result=await validateBackupPayload(payload);
  if(result.legacy){backupStatus('Copia antigua legible. No contiene huella ni todas las tablas para comprobar su integridad; no se ha importado.');return}
  const counts=result.counts;
  const origin=payload.cloudProject===SUPABASE_URL&&payload.ownerId===session?.user?.id?'mismo proyecto y usuario':'otro proyecto o usuario';
  backupStatus(`Archivo íntegro (${origin}): ${counts.portfolios} carteras, ${counts.accounts} cuentas, ${counts.operations} operaciones, ${counts.transfers} traspasos y ${counts.recurring_operations} reglas. Comprobación local: no se ha restaurado en Supabase.`);
 }catch(err){backupStatus('Copia no verificable: '+err.message,true)}
 finally{input.value=''}
}
function restoreErrorMessage(err){
 const raw=String(err?.message||err||'');
 if(raw.includes('BACKUP_TARGET_NOT_EMPTY'))return 'La cartera ya contiene cuentas u operaciones. No se ha modificado nada.';
 if(raw.includes('BACKUP_MISSING_FUND'))return 'Falta algún fondo en esta base de datos. No se ha modificado nada.';
 if(raw.includes('BACKUP_MISSING_LISTING'))return 'Falta alguna cotización de ETF en esta base de datos. No se ha modificado nada.';
 if(raw.includes('BACKUP_MISSING_INSTITUTION'))return 'Falta alguna entidad financiera en esta base de datos. No se ha modificado nada.';
 if(raw.includes('PGRST202')||raw.includes('restore_user_backup_v1'))return 'Falta instalar la migración 016_restore_user_backup_v0.12.0.sql.';
 return raw;
}
async function restoreBackupFile(input){
 const file=input?.files?.[0];if(!file)return;
 const button=document.getElementById('restoreBackupBtn');if(button)button.disabled=true;
 try{
  if(!session?.user?.id)throw new Error('Inicia sesión antes de restaurar.');
  const payload=JSON.parse(await file.text()),check=await validateBackupPayload(payload);
  if(check.legacy)throw new Error('Esta copia antigua no admite restauración automática.');
  if(payload.ownerId!==session.user.id||payload.cloudProject!==SUPABASE_URL)throw new Error('La copia pertenece a otro usuario o proyecto Supabase.');
  const restoreData={app:payload.app,formatVersion:payload.formatVersion,schemaVersion:payload.schemaVersion,ownerId:payload.ownerId,tables:payload.tables};
  backupStatus('Comprobando la restauración sin escribir datos…');
  const preview=await rpc('restore_user_backup_v1',{p_backup:restoreData,p_dry_run:true});
  if(preview?.ready!==true||preview?.dry_run!==true)throw new Error('La comprobación del servidor no se completó.');
  const c=check.counts;
  if(BACKUP_TABLES.some(name=>Number(preview.counts?.[name])!==c[name]))throw new Error('Los recuentos del servidor no coinciden con la copia.');
  if(!confirm(`La cartera de destino está vacía y la copia es válida. Se restaurarán ${c.portfolios} carteras, ${c.accounts} cuentas, ${c.operations} operaciones, ${c.transfers} traspasos y ${c.recurring_operations} reglas. ¿Continuar?`)){
   backupStatus('Restauración cancelada sin cambios.');return;
  }
  if(prompt('Para confirmar la restauración escribe RESTAURAR:')!=='RESTAURAR'){
   backupStatus('Restauración cancelada sin cambios.');return;
  }
  backupStatus('Restaurando en Supabase…');
  const result=await rpc('restore_user_backup_v1',{p_backup:restoreData,p_dry_run:false});
  if(result?.ready!==true||result?.dry_run!==false)throw new Error('El servidor no confirmó la restauración.');
  if(BACKUP_TABLES.some(name=>Number(result.counts?.[name])!==c[name]))throw new Error('La restauración terminó, pero los recuentos devueltos no coinciden. No repitas la importación; sincroniza la cartera.');
  if(!await syncFromCloud(false))throw new Error('La restauración terminó, pero no se pudo volver a leer Supabase. No repitas la importación; vuelve a sincronizar.');
  backupStatus('Restauración completada y cartera leída de Supabase.');
 }catch(err){backupStatus('No se pudo restaurar: '+restoreErrorMessage(err),true)}
 finally{input.value='';if(button)button.disabled=false}
}

// Las llamadas simultáneas comparten el proceso activo de este navegador.
let marketRefreshPromise=null;
function exclusiveMarketRefresh(action){
 if(marketRefreshPromise)return marketRefreshPromise;
 const pending=Promise.resolve().then(action);marketRefreshPromise=pending;
 pending.finally(()=>{if(marketRefreshPromise===pending)marketRefreshPromise=null}).catch(()=>{});
 return pending;
}
function refreshAllMarketData(showNotice=true,options={}){return exclusiveMarketRefresh(()=>performAllMarketDataRefresh(showNotice,options));}
function retryRefreshKeys(keys){return exclusiveMarketRefresh(()=>performRefreshRetry(keys));}

// Los estados del descargador diario se leen de Supabase, incluso sin refresco manual.
function publicSourceCardHtml(){
 const rows=state.sourceStates||[],visible=new Set((state.positions||[]).map(p=>refreshTargetKey(p)));
 const cards=rows.filter(x=>visible.has(x.instrument_key)).map(x=>{
  const fund=state.funds?.[x.isin],q=x.last_success_at?new Date(x.last_success_at).toLocaleString('es-ES'):null;
  return `<div class="quality-row"><strong>${esc(fund?.name||x.isin)}</strong><div>${esc(x.source_name||'Fuente pública')}</div><div class="muted">${q?'Última descarga correcta: '+esc(q):'Pendiente de la primera descarga'}</div>${x.status==='failed'?`<div class="metric-negative">La fuente ha fallado: ${esc(refreshSafeDetail(x.error))}</div>${x.fallback_at?'<div class="muted">Se utilizó EODHD manualmente. La incidencia de la fuente sigue pendiente.</div>':''}${state.readonly?'':`<button class="btn small" data-public-retry="${esc(x.instrument_key)}">Reintentar fuente</button> <button class="btn small" data-eod-fallback="${esc(x.instrument_key)}">Actualizar desde EODHD</button>`}`:''}</div>`;
 }).join('');
 return `<details class="refresh-report"><summary>Descarga diaria · fuentes y estado</summary><div class="muted">Un VL con hasta 4 días de antigüedad es normal. Más antigüedad se muestra como aviso, no como fallo de la fuente.</div>${cards||'<div class="muted">La primera descarga diaria está pendiente.</div>'}</details>`;
}
async function manualPublicTarget(key,action='public'){
 const target=refreshTargets().find(x=>x.key===key);if(!target)return;
 await exclusiveMarketRefresh(async()=>{
 setRefreshProgress(true,action==='eodhd'?'Consultando EODHD manualmente…':'Reintentando fuente…',0,1);
 try{const row=await refreshOneTarget(target,action);if(action==='eodhd')await refreshEodQuota();if(!await syncFromCloud(false,{priceChanges:true}))throw Error('No se pudo leer el resultado guardado');
 const old=state.refreshReport?.rows||[],rows=old.some(x=>x.key===key)?old.map(x=>x.key===key?row:x):[...old,row];state.refreshReport={finishedAt:new Date().toISOString(),...refreshReportSummary(rows),rows};saveCache();renderAll();setRefreshProgress(false,row.error||'Datos guardados y leídos desde Supabase.',1,1,row.status==='failed'?'error':'ok');if(row.status==='failed')alert(row.error);
 }catch(e){setRefreshProgress(false,e.message,0,1,'error');alert(e.message)}
 });
}
