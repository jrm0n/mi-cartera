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
 const code=String(err?.code||err?.payload?.error||err?.message||'ERROR_DESCONOCIDO').toUpperCase(),known={INSTRUMENT_NOT_FOUND:'El ISIN no aparece en ninguna fuente disponible.',EODHD_SEARCH_FAILED:'EODHD no respondió al buscar el ISIN.',EODHD_SEARCH_UNAVAILABLE:'No se pudo conectar con EODHD.',EODHD_HISTORY_FAILED:'EODHD no devolvió el histórico solicitado.',TRADEGATE_QUOTE_UNAVAILABLE:'Tradegate no devolvió una cotización válida.',LISTING_NOT_FOUND:'La bolsa seleccionada ya no está disponible.',SERVER_CONFIGURATION_INCOMPLETE:'Falta configurar alguna credencial del servicio de actualización.',INVALID_SESSION:'La sesión de Supabase ha caducado.'};return known[code]||String(err?.message||'Error de actualización');
}
async function refreshOneTarget(target){
 const startedAt=new Date().toISOString();try{const result=await resolveFund(target.isin,true,false,target.listingSymbol||null,true),quote=result?.latest_nav||null,stale=result?.quote_status?.stale===true||!quote?.date,status=!quote?.date?'failed':stale?'stale':'updated';return{...target,status,source:quote?.source||result?.sources?.identity_nav||null,quoteDate:quote?.date||null,quoteValue:Number.isFinite(+quote?.nav)?+quote.nav:null,currency:quote?.currency||null,historyReason:result?.history?.reason||null,historyRows:+result?.history?.rows_inserted||0,diagnostics:result?.diagnostics||[],error:status==='failed'?'No se obtuvo un VL/precio válido.':null,startedAt,finishedAt:new Date().toISOString()}}catch(err){return{...target,status:'failed',source:null,quoteDate:null,quoteValue:null,currency:null,historyReason:null,historyRows:0,diagnostics:err?.payload?.diagnostics||[],error:refreshErrorText(err),errorCode:err?.code||err?.payload?.error||null,startedAt,finishedAt:new Date().toISOString()}}
}
async function runRefreshTargets(targets){
 const rows=new Array(targets.length);let cursor=0,completed=0;const workers=Math.min(3,Math.max(1,targets.length));async function worker(){while(true){const index=cursor++;if(index>=targets.length)return;const target=targets[index];setRefreshProgress(true,`Actualizando ${completed+1} de ${targets.length}: ${target.name}`,completed,targets.length);rows[index]=await refreshOneTarget(target);completed++;const errors=rows.filter(Boolean).filter(x=>x.status==='failed').length;setCloudStatus(`Actualizando todos los perfiles… ${completed}/${targets.length}`);setRefreshProgress(true,`Procesados ${completed} de ${targets.length}`,completed,targets.length,errors?'warn':'ok')}}await Promise.all(Array.from({length:workers},()=>worker()));return rows;
}
function refreshReportSummary(rows){return{updated:rows.filter(x=>x.status==='updated').length,stale:rows.filter(x=>x.status==='stale').length,failed:rows.filter(x=>x.status==='failed').length}}
async function refreshAllMarketData(showNotice=true){
 setRefreshProgress(true,'Cargando los fondos de todos los perfiles…',0,0);await syncFromCloud(false);const targets=refreshTargets();setCloudStatus(`Actualizando todos los perfiles… 0/${targets.length}`);setRefreshProgress(true,targets.length?'Preparando todos los perfiles…':'No hay posiciones que actualizar',0,targets.length);if(!targets.length){setRefreshProgress(false,'No hay posiciones que actualizar.',0,0);return{updated:0,stale:0,failed:0,rows:[]}}
 const rows=await runRefreshTargets(targets);await syncFromCloud(false);const summary=refreshReportSummary(rows);state.refreshReport={startedAt:rows[0]?.startedAt||new Date().toISOString(),finishedAt:new Date().toISOString(),...summary,rows};saveCache();localStorage.setItem(AUTO_REFRESH_KEY,new Date().toISOString());const parts=[`${summary.updated} actualizados`];if(summary.stale)parts.push(`${summary.stale} atrasados`);if(summary.failed)parts.push(`${summary.failed} con error`);const resultText=`Todos los perfiles procesados: ${parts.join(', ')}.`;setRefreshProgress(false,resultText,targets.length,targets.length,summary.failed?'error':summary.stale?'warn':'ok');setCloudStatus(`Sincronizado con Supabase · ${resultText}`,summary.failed?'error':summary.stale?'warn':'');renderAnalysis();if(showNotice)alert(resultText);return{...summary,rows}
}
async function retryRefreshKeys(keys){
 const wanted=new Set(keys),old=state.refreshReport?.rows||[],targets=old.filter(x=>wanted.has(x.key)).map(x=>({key:x.key,isin:x.isin,listingSymbol:x.listingSymbol||null,name:x.name||x.isin,navDate:x.quoteDate||null,portfolios:x.portfolios||[]}));if(!targets.length)return;setRefreshProgress(true,'Reintentando instrumentos fallidos…',0,targets.length);const retried=await runRefreshTargets(targets);await syncFromCloud(false);const byKey=new Map(retried.map(x=>[x.key,x])),rows=old.map(x=>byKey.get(x.key)||x),summary=refreshReportSummary(rows);state.refreshReport={startedAt:state.refreshReport?.startedAt||new Date().toISOString(),finishedAt:new Date().toISOString(),...summary,rows};saveCache();const text=`Reintento completado: ${retried.filter(x=>x.status==='updated').length} actualizados, ${retried.filter(x=>x.status==='stale').length} atrasados y ${retried.filter(x=>x.status==='failed').length} con error.`;setRefreshProgress(false,text,targets.length,targets.length,retried.some(x=>x.status==='failed')?'error':retried.some(x=>x.status==='stale')?'warn':'ok');renderAll();alert(text)
}
window.retryRefreshTarget=key=>retryRefreshKeys([key]);window.retryFailedRefreshes=()=>retryRefreshKeys((state.refreshReport?.rows||[]).filter(x=>x.status==='failed').map(x=>x.key));
async function refreshPortfolio(){const button=document.getElementById('refreshBtn');if(button?.disabled)return;state.lastValue=total();saveCache();try{await refreshAllMarketData(true)}catch(err){console.error(err);setRefreshProgress(false,'No se pudo completar la actualización.',0,1,'error');alert('No se pudo actualizar la cartera: '+err.message)}}
function startupRefreshDue(){const raw=localStorage.getItem(AUTO_REFRESH_KEY);if(!raw)return true;const t=Date.parse(raw);if(!Number.isFinite(t))return true;return Date.now()-t>=12*3600*1000}
async function refreshOnStartup(){if(!state.positions.length||!startupRefreshDue())return;state.lastValue=total();saveCache();const el=document.getElementById('sinceUpdate');if(el)el.innerHTML='<span class="muted">Actualizando…</span>';setCloudStatus('Actualizando mercados…');try{await refreshAllMarketData(false)}catch(err){console.warn('Auto refresh',err);setRefreshProgress(false,'La actualización automática quedó pendiente.',0,1,'warn');setCloudStatus('Sincronizado con Supabase · actualización pendiente','warn')}}
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
