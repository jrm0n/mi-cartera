// Gestión: observación de datos y ejecuciones; nunca modifica cotizaciones.
let dataStatusSnapshot=null,dataStatusError='',dataStatusLoading=false,dataStatusUser=null,dataStatusGeneration=0;
let dataStatusPortfolio='all',dataStatusTab='updates',dataPositionMemo=null;
function dataOwnedPortfolios(){return(state.portfolios||[]).filter(p=>p.active!==false&&p.user_id===session?.user?.id)}
function dataPositionSnapshot(){
 const ids=new Set(dataOwnedPortfolios().map(p=>p.id)),snapshot=cloudSnapshot;
 if(!snapshot)return{accounts:[],positions:state.positions||[],ops:[],portfolios:dataOwnedPortfolios()};
 const inputs=[state.portfolios,snapshot.funds,snapshot.accounts,snapshot.accounts?.length,snapshot.ops,snapshot.ops?.length,snapshot.recurringRules,snapshot.navs,snapshot.listingPrices,state.listings,state.fxRates,session?.user?.id,[...ids].join('|'),dataToday()];
 if(dataPositionMemo&&inputs.every((value,index)=>value===dataPositionMemo.inputs[index]))return dataPositionMemo.value;
 const accounts=(snapshot.accounts||[]).filter(a=>a.active!==false&&ids.has(a.portfolio_id)),accountIds=new Set(accounts.map(a=>a.id));
 const ops=(snapshot.ops||[]).filter(o=>accountIds.has(o.account_id)),rules=(snapshot.recurringRules||[]).filter(r=>accountIds.has(r.account_id));
 const recurring=expandRecurringRules(rules,snapshot.navs||[],snapshot.listingPrices||[]);
 const previousNavs=navHistory,previousPrices=listingHistory;let positions;
 try{positions=buildPositions([...ops,...recurring.operations],accounts,snapshot.funds||[],snapshot.navs||[],snapshot.listingPrices||[])}
 finally{navHistory=previousNavs;listingHistory=previousPrices}
 const value={accounts,positions,ops:[...ops,...recurring.operations],portfolios:dataOwnedPortfolios()};dataPositionMemo={inputs,value};return value;
}
function portfolioPositionEntityCounts(){
 const snapshot=dataPositionSnapshot(),byAccount=new Map(snapshot.accounts.map(a=>[a.id,a])),sets={};
 for(const p of snapshot.positions){if(!(p.shares>1e-10))continue;const account=byAccount.get(p.accountId);if(!account)continue;(sets[account.portfolio_id]??=new Set()).add(account.institution_code)}
 return Object.fromEntries(Object.entries(sets).map(([id,entities])=>[id,entities.size]));
}
function dataDate(value,withTime=false){
 if(!value)return 'Sin registro';const d=new Date(value.length===10?value+'T12:00:00Z':value);if(!Number.isFinite(d.getTime()))return 'Fecha no válida';
 return d.toLocaleString('es-ES',{timeZone:'Europe/Madrid',day:'2-digit',month:'2-digit',year:'numeric',...(withTime?{hour:'2-digit',minute:'2-digit'}:{})});
}
function dataToday(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=t=>parts.find(p=>p.type===t).value;return `${get('year')}-${get('month')}-${get('day')}`}
function dataQuoteWarnings(rows,expectedCurrency,today=dataToday()){
 const warnings=[],byDate=new Map(),valid=[];let invalid=false,future=false,currency=false,duplicates=false,conflict=false;
 for(const row of rows){
  const day=row.nav_date||row.price_date,price=Number(row.nav??row.price),code=String(row.currency||'').toUpperCase();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day||'')||!Number.isFinite(Date.parse(day))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day||!(price>0)){invalid=true;continue}
  if(day>today){future=true;continue}
  if(code&&expectedCurrency&&code!==expectedCurrency)currency=true;
  if(byDate.has(day)){duplicates=true;if(Math.abs(byDate.get(day)-price)>1e-8)conflict=true}else{byDate.set(day,price);valid.push({date:day,price})}
 }
 valid.sort((a,b)=>a.date.localeCompare(b.date));
 if(invalid)warnings.push('Hay precios no válidos o fechas no válidas.');
 if(future)warnings.push('Hay cotizaciones con fecha futura.');
 if(currency)warnings.push('Hay cotizaciones cuya divisa difiere de la ficha del instrumento.');
 if(duplicates)warnings.push(conflict?'Hay precios distintos para la misma fecha.':'Hay fechas de cotización duplicadas.');
 const recent=valid.filter(r=>r.date>=new Date(Date.parse(today)-90*86400000).toISOString().slice(0,10));
 let largest=null;
 for(let i=1;i<recent.length;i++){
  const a=recent[i-1],b=recent[i],gap=(Date.parse(b.date)-Date.parse(a.date))/86400000,change=(b.price/a.price-1)*100;
  if(gap<=7&&Math.abs(change)>=15&&(!largest||Math.abs(change)>Math.abs(largest.change)))largest={date:b.date,change};
 }
 if(largest)warnings.push(`Movimiento del ${formatNumberES(largest.change,2,2)} % el ${dataDate(largest.date)}: revisar (umbral de aviso: 15 %).`);
 return warnings;
}
function dataInstrumentRows(filter=dataStatusPortfolio){
 if(dataStatusUser!==session?.user?.id){dataStatusSnapshot=null;dataStatusError='';dataStatusUser=session?.user?.id}
 const snapshot=dataPositionSnapshot(),accounts=new Map(snapshot.accounts.map(a=>[a.id,a])),portfolios=new Map(snapshot.portfolios.map(p=>[p.id,p.name])),map=new Map();
 function add(isin,symbol,accountId,current){
  if(!isin)return;const account=accounts.get(accountId);if(!account)return;const key=refreshTargetKey({isin,listingSymbol:symbol}),prior=map.get(key)||{key,isin,listingSymbol:symbol||null,portfolioIds:new Set(),portfolios:new Set(),currentPortfolioIds:new Set(),current:false};
  prior.portfolioIds.add(account.portfolio_id);prior.portfolios.add(portfolios.get(account.portfolio_id)||'Cartera');if(current)prior.currentPortfolioIds.add(account.portfolio_id);map.set(key,prior);
 }
 for(const p of snapshot.positions)if(p.shares>1e-10)add(p.isin,p.listingSymbol,p.accountId,true);
 for(const o of snapshot.ops)if(o.status==='completed')add(o.isin,o.listing_symbol,o.account_id,false);
 const sources=new Map((state.sourceStates||[]).map(s=>[s.instrument_key,s]));
 const queue=new Map((dataStatusSnapshot?.queue||[]).map(q=>[q.instrument_key,q]));
 return [...map.values()].filter(x=>filter==='all'||x.portfolioIds.has(filter)).map(x=>{
  x.current=filter==='all'?x.currentPortfolioIds.size>0:x.currentPortfolioIds.has(filter);
  const fund=state.funds?.[x.isin]||{},listing=x.listingSymbol?state.listings?.[x.listingSymbol]:null,source=sources.get(x.key)||{},history=source.metadata?.history_v1||{},q=queue.get(x.key)||{};
  const raw=x.listingSymbol?(cloudSnapshot?.listingPrices||[]).filter(r=>r.provider_symbol===x.listingSymbol):(cloudSnapshot?.navs||[]).filter(r=>r.isin===x.isin);
  const rows=raw.filter(r=>Number(r.nav??r.price)>0&&/^\d{4}-\d{2}-\d{2}$/.test(r.nav_date||r.price_date||'')).sort((a,b)=>(a.nav_date||a.price_date).localeCompare(b.nav_date||b.price_date));
  const last=rows.at(-1),first=rows[0],date=last?.nav_date||last?.price_date||null,currency=String(listing?.currency||fund.currency||'').toUpperCase();
  const errors=[];if(source.status==='failed')errors.push(refreshSafeDetail(source.error||'La última descarga de la fuente falló.'));if(history.error)errors.push(refreshSafeDetail(history.error));if(q.status==='failed'||q.error)errors.push(refreshSafeDetail(q.error||'El trabajo de descarga falló.'));
  const warnings=dataQuoteWarnings(raw,currency);
  if(history.status==='unavailable'&&x.isin!=='IE00B3VXGD32')warnings.push('El histórico permanece incompleto según la fuente.');
  if(!rows.length)warnings.push('Sin cotizaciones guardadas.');
  else if(x.current&&(Date.parse(dataToday())-Date.parse(date))/86400000>4)warnings.push(`Último precio con más de 4 días de antigüedad (${dataDate(date)}). No demuestra un fallo de la fuente.`);
  if(q.status==='running'&&q.lease_until&&Date.parse(q.lease_until)<Date.now())warnings.push('El trabajo superó su plazo; espera a su recuperación automática o reintenta.');
  if(q.status==='pending'&&q.attempts>=3)warnings.push('La cola ha agotado los intentos; requiere revisión.');
  return{...x,current:filter==='all'?x.currentPortfolioIds.size>0:x.currentPortfolioIds.has(filter),name:fund.name||x.isin,source,history,queue:q,rows,first:first?.nav_date||first?.price_date,date,last,currency,errors:[...new Set(errors)],warnings};
 }).sort((a,b)=>Number(b.current)-Number(a.current)||a.name.localeCompare(b.name,'es'));
}
function dataHistoryLabel(row){
 if(row.isin==='IE00B3VXGD32')return 'Excluido de recuperación por tu elección';
 if(row.history.status==='available'&&row.history.coverage_basis==='initial_gap_tolerance')return `Disponible · margen inicial de ${row.history.initial_gap_days} días`;
 return({available:'Disponible según la fuente',pending:'Recuperando histórico',unavailable:'Histórico incompleto'})[row.history.status]||'Sin estado histórico confirmado';
}
function dataQueueLabel(row){if(!dataStatusSnapshot)return 'Cola no consultada';return({pending:'En cola',running:'Procesando',done:'Trabajo terminado',failed:'Error de descarga'})[row.queue.status]||'Sin trabajo registrado'}
function dataRetryHtml(row){return state.readonly||row.isin==='IE00B3VXGD32'?'':`<button class="btn small" type="button" data-status-retry="${esc(row.key)}">Reintentar descarga</button>`}
function renderDataStatus(){
 const host=document.getElementById('dataStatusContents');if(!host||state.readonly)return;
 if(dataStatusUser!==session?.user?.id){dataStatusSnapshot=null;dataStatusError='';dataStatusUser=session?.user?.id}
 const owned=dataOwnedPortfolios();if(dataStatusPortfolio!=='all'&&!owned.some(p=>p.id===dataStatusPortfolio))dataStatusPortfolio='all';
 const opened=new Set([...host.querySelectorAll('details[open][data-instrument-key]')].map(d=>d.dataset.instrumentKey));
 const rows=dataInstrumentRows(),issues=rows.filter(r=>r.errors.length||r.warnings.length),runs=dataStatusSnapshot?.runs||[];
 // Los resúmenes de ejecución se limitan a todas las carteras propias; nunca se
 // reinterpretan como recuentos de una sola cartera al aplicar el filtro de fondos.
 const runLabel={running:'En curso',partial:'Terminado con errores',success:'Terminado'};
 const runHtml=runs.length?runs.map(r=>`<div class="data-status-row"><strong>${esc(r.local_slot)} · ${runLabel[r.status]||'Sin confirmar'}</strong><div>Trabajos: ${r.total} · procesados: ${r.processed} · con error: ${r.failed} · en cola: ${r.pending} · ejecutándose: ${r.running}</div><div class="muted">Inicio: ${dataDate(r.started_at,true)}${r.finished_at?` · Fin: ${dataDate(r.finished_at,true)}`:''}</div></div>`).join(''):'<p class="muted">Todavía no hay ejecuciones registradas para tus instrumentos. El registro empieza al instalar esta actualización; no reconstruye turnos anteriores.</p>';
 const detail=rows.map(r=>`<details class="data-instrument" data-instrument-key="${esc(r.key)}" ${opened.has(r.key)?'open':''}><summary><span><strong>${esc(r.name)}</strong><span class="data-status-meta">${esc(r.isin)}${r.listingSymbol?` · ${esc(r.listingSymbol)}`:''} · ${esc([...r.portfolios].join(', '))}</span></span><span class="data-state ${r.errors.length?'data-error':r.warnings.length?'data-warning':''}">${r.errors.length?'Error':r.warnings.length?'Revisar':r.queue.status==='pending'||r.queue.status==='running'||r.history.status==='pending'?'En curso':'Sin incidencias detectadas'}</span></summary><div class="data-instrument-body"><div>${r.current?'Posición actual':'Instrumento histórico, sin posición actual'}</div><dl class="data-status-grid"><div><dt>Último VL / precio guardado</dt><dd>${r.last?priceMoney(Number(r.last.nav??r.last.price),r.currency||r.last.currency||'EUR'):'Sin datos'} · ${dataDate(r.date)}</dd></div><div><dt>Fuente del último precio</dt><dd>${esc(r.last?.source||r.source.source_name||'Sin identificar')}</dd></div><div><dt>Cobertura guardada</dt><dd>${r.rows.length} cotizaciones · ${dataDate(r.first)} → ${dataDate(r.date)}</dd></div><div><dt>Histórico</dt><dd>${dataHistoryLabel(r)}${r.history.next_to?` · siguiente bloque hasta ${dataDate(r.history.next_to)}`:''}</dd></div><div><dt>Fuente histórica</dt><dd>${esc(r.history.source||'Sin identificar')}</dd></div><div><dt>Cola</dt><dd>${dataQueueLabel(r)}</dd></div><div><dt>Último intento</dt><dd>${dataDate(r.source.last_attempt_at,true)}</dd></div><div><dt>Última descarga correcta</dt><dd>${dataDate(r.source.last_success_at,true)}</dd></div></dl>${r.errors.map(e=>`<p class="data-error">${esc(e)}</p>`).join('')}${r.warnings.map(w=>`<p class="data-warning">${esc(w)}</p>`).join('')}${dataRetryHtml(r)}</div></details>`).join('');
 const incidentHtml=issues.map(r=>`<div class="data-status-row"><strong>${esc(r.name)}</strong><div class="data-status-meta">${esc(r.isin)} · ${esc([...r.portfolios].join(', '))}</div>${r.errors.map(e=>`<p class="data-error">${esc(e)}</p>`).join('')}${r.warnings.map(w=>`<p class="data-warning">${esc(w)}</p>`).join('')}${dataRetryHtml(r)}</div>`).join('')||'<p>No se han detectado incidencias con los controles disponibles.</p>';
 host.innerHTML=`<div class="segmented data-status-tabs" role="tablist" aria-label="Estado de datos">${[['updates','Actualizaciones'],['funds','Fondos'],['issues','Incidencias']].map(([id,label])=>`<button type="button" role="tab" id="data-tab-${id}" aria-controls="data-panel-${id}" aria-selected="${dataStatusTab===id}" data-status-tab="${id}" class="${dataStatusTab===id?'active':''}">${label}</button>`).join('')}</div><div class="data-status-actions"><button class="btn small" type="button" id="reloadDataStatus" ${dataStatusLoading?'disabled':''}>${dataStatusLoading?'Consultando…':'Sincronizar estado'}</button><label>Instrumentos de<select id="dataStatusPortfolio" class="search"><option value="all">Todas mis carteras</option>${owned.map(p=>`<option value="${esc(p.id)}" ${dataStatusPortfolio===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label></div><p class="muted">Datos de cartera: ${dataDate(state.cloudSyncedAt,true)} · Cola y ejecuciones: ${dataDate(dataStatusSnapshot?.checked_at,true)}</p>${dataStatusError?`<p class="data-warning" role="status">${esc(dataStatusError)}</p>`:''}<section role="tabpanel" id="data-panel-updates" aria-labelledby="data-tab-updates" ${dataStatusTab!=='updates'?'hidden':''}><h3>Actualizaciones del servidor</h3><p class="muted">Todas tus carteras. Cada ejecución muestra los trabajos realmente encolados, también si continúan recuperando históricos. «Procesado» no garantiza un VL más reciente ni un histórico sin huecos.</p>${runHtml}</section><section role="tabpanel" id="data-panel-funds" aria-labelledby="data-tab-funds" ${dataStatusTab!=='funds'?'hidden':''}><h3>Detalle por fondo e instrumento</h3><p class="muted">${rows.length} instrumentos; ${rows.filter(r=>r.current).length} con posición actual. «Disponible» conserva el criterio de cobertura de la fuente y no certifica todas las sesiones.</p>${detail||'<p>Sin instrumentos registrados en esta selección.</p>'}</section><section role="tabpanel" id="data-panel-issues" aria-labelledby="data-tab-issues" ${dataStatusTab!=='issues'?'hidden':''}><h3>Incidencias</h3><p class="muted">${issues.length} instrumentos requieren atención. Se comprueban fechas duplicadas o futuras, divisas y movimientos de al menos el 15 % entre cotizaciones próximas en los últimos 90 días. Son avisos para revisar; no prueban un error ni modifican precios.</p>${incidentHtml}</section>`;
 host.querySelectorAll('[data-status-tab]').forEach(button=>button.onclick=()=>{dataStatusTab=button.dataset.statusTab;host.querySelectorAll('[data-status-tab]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-selected',String(b===button))});host.querySelectorAll('[role=tabpanel]').forEach(panel=>panel.hidden=panel.id!=='data-panel-'+dataStatusTab)});
 document.getElementById('reloadDataStatus').onclick=()=>reloadDataStatus(true);
 document.getElementById('dataStatusPortfolio').onchange=e=>{dataStatusPortfolio=e.target.value;renderDataStatus()};
 host.querySelectorAll('[data-status-retry]').forEach(button=>button.onclick=()=>retryDataStatusInstrument(button.dataset.statusRetry));
}
async function loadDataStatus(){
 const user=session?.user?.id;if(!user||state.readonly)return;
 if(dataStatusUser!==user){dataStatusSnapshot=null;dataStatusError='';dataStatusUser=user}
 const generation=++dataStatusGeneration;dataStatusLoading=true;renderDataStatus();
 try{const result=await rpc('get_owned_data_status_v1',{});if(session?.user?.id!==user||generation!==dataStatusGeneration)return;if(!Array.isArray(result?.queue)||!Array.isArray(result?.runs))throw Error('Respuesta de estado incompleta');dataStatusSnapshot=result;dataStatusError=''}
 catch(error){if(session?.user?.id!==user||generation!==dataStatusGeneration)return;dataStatusError='No se pudo leer la cola y las ejecuciones. Comprueba la instalación de 034-estado-datos.txt y la conexión. Los precios e históricos mostrados proceden de la última sincronización.'}
 finally{if(session?.user?.id===user&&generation===dataStatusGeneration){dataStatusLoading=false;renderDataStatus()}}
}
async function reloadDataStatus(sync=false){
 if(dataStatusLoading)return;
 if(sync){const ok=await syncFromCloud(false,{priceChanges:true});if(!ok){dataStatusError='No se pudo sincronizar. Se conserva la última lectura disponible.';renderDataStatus();return}}
 await loadDataStatus();
}
async function retryDataStatusInstrument(key){
 if(state.readonly||!session?.user?.id)return;
 const target=dataInstrumentRows().find(r=>r.key===key);if(!target)return;
 await withAppBusy('Actualizando datos…',async()=>{
  try{await rpc('retry_owned_data_v1',{p_isin:target.isin,p_symbol:target.listingSymbol||''});await loadDataStatus()}
  catch(error){dataStatusError='No se pudo encolar el reintento. '+refreshSafeDetail(error.message);renderDataStatus()}
 });
}

function renderDataHealthNotice(){
 const host=document.getElementById('dataHealthNotice');if(!host)return;
 if(state.readonly||!session?.user?.id){host.hidden=true;return}
 const rows=dataInstrumentRows('all').filter(row=>row.currentPortfolioIds.has(state.activePortfolioId));
 host.hidden=!rows.some(row=>row.errors.length||row.warnings.length);
}
function openDataIncidents(){dataStatusPortfolio=state.activePortfolioId;dataStatusTab='issues';navigate('access')}
