const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function setup({cache=false,sync=true,session=true,noAccess=false}={}){
 const elements=new Map();
 const el=id=>{if(!elements.has(id)){const classes=new Set();elements.set(id,{hidden:true,textContent:'',inert:false,setAttribute(){},focus(){},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,on){if(on)classes.add(x);else classes.delete(x)}}})}return elements.get(id)};
 let complete;const cloud=new Promise(resolve=>complete=()=>{if(noAccess)c.showAuth();resolve(sync)});
 const c={console:{...console,error(){}},Date,Intl,Set,Number,SUPABASE_URL:'url',SUPABASE_KEY:'key',session:null,cloudSnapshot:null,state:{portfolios:[],positions:[],funds:{}},listingHistory:{},document:{getElementById:el,querySelectorAll:()=>[],body:el('body')},acceptInvitation:async()=>false,loadSession:()=>session?{access_token:'saved',user:{id:'u'}}:null,ensureCalls:0,ensureSession:async()=>{c.ensureCalls++;return session},cacheReads:0,loadCache:async()=>{c.cacheReads++;if(cache)c.state.portfolios=[{id:'p'}];return cache},updateAccessMode(){},renders:0,shows:0,renderAll(){c.renders++},showApp(){c.shows++;el('authGate').classList.add('hidden');el('app').classList.remove('auth-hidden')},showAuth(){el('authGate').classList.remove('hidden');el('app').classList.add('auth-hidden')},setAuthMessage(){},status:'',setCloudStatus(message){c.status=message},syncCalls:0,syncOptions:null,syncFromCloud:(notice,options)=>{c.syncCalls++;c.syncOptions=options;return cloud}};
 vm.createContext(c);const core=fs.readFileSync(path.join(root,'core.js'),'utf8');vm.runInContext(core.slice(core.indexOf('// Bloqueo visual compartido'),core.indexOf('const THEME_KEY')),c);const source=fs.readFileSync(path.join(root,'app.js'),'utf8');vm.runInContext(source.slice(source.indexOf('let startupRunning'),source.indexOf('async function acceptInvitation')),c);
 return {c,el,complete};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('con copia arranca mostrando la última cartera sin renovar sesión ni consultar Supabase',async()=>{const {c,el}=setup({cache:true});await c.init();assert.equal(c.cacheReads,1);assert.equal(c.ensureCalls,0);assert.equal(c.syncCalls,0);assert.equal(c.renders,1);assert.equal(el('manualLoadPrompt').hidden,true);assert.ok(c.status.includes('copia guardada'));assert.equal(el('dataBusyOverlay').hidden,true)});
test('sin copia muestra Actualizar sin consultar Supabase automáticamente',async()=>{const {c,el}=setup();await c.init();assert.equal(c.cacheReads,1);assert.equal(c.syncCalls,0);assert.equal(c.renders,0);assert.equal(el('manualLoadPrompt').hidden,false);assert.equal(el('dataBusyOverlay').hidden,true)});
test('un fallo de lectura local no se presenta como un primer uso sin copia',async()=>{const {c,el}=setup();c.cacheLoadStatus='unavailable';await c.init();assert.match(el('manualLoadMessage').textContent,/No se pudo recuperar/);assert.ok(!el('manualLoadMessage').textContent.includes('Todavía no hay'))});
test('un fallo temporal al renovar sesión conserva visible la cartera cargada',async()=>{const {c,el}=setup({cache:true});await c.init();c.cloudSnapshot={};c.ensureSession=async()=>{throw Error('timeout')};await c.loadPortfolioOnDemand();assert.equal(el('manualLoadPrompt').hidden,true);assert.ok(c.status.includes('copia local'))});
test('Actualizar lee la copia y los cambios, bloquea durante la carga y muestra datos al terminar',async()=>{const {c,el,complete}=setup({cache:true});await c.init();const pending=c.loadPortfolioOnDemand();await tick();assert.equal(c.cacheReads,2);assert.equal(c.syncCalls,1);assert.equal(c.syncOptions.priceChanges,true);assert.equal(el('dataBusyOverlay').hidden,false);assert.equal(el('app').inert,true);complete();await pending;assert.equal(el('manualLoadPrompt').hidden,true);assert.equal(el('dataBusyOverlay').hidden,true);assert.equal(c.renders,2)});
test('sin copia y con fallo conserva la pantalla de Actualizar y permite reintentar',async()=>{const {c,el,complete}=setup({sync:false});await c.init();const pending=c.loadPortfolioOnDemand();await tick();complete();await pending;assert.equal(el('manualLoadPrompt').hidden,false);assert.ok(el('manualLoadMessage').textContent.includes('reintentar'));assert.equal(c.renders,0);assert.equal(el('app').inert,false)});
test('sin copia muestra el mensaje y código real del error de sincronización',async()=>{
 const {c,el,complete}=setup({sync:false});c.lastCloudSyncError={message:'Lectura bloqueada',code:'42501'};
 await c.init();const pending=c.loadPortfolioOnDemand();await tick();complete();await pending;
 assert.match(el('manualLoadMessage').textContent,/Lectura bloqueada \(42501\)/);assert.equal(el('app').inert,false);
});
test('con copia mantiene visibles los datos guardados si Actualizar falla',async()=>{const {c,el,complete}=setup({cache:true,sync:false});await c.init();assert.equal(c.renders,1);const pending=c.loadPortfolioOnDemand();await tick();complete();await pending;assert.equal(c.renders,2);assert.equal(el('manualLoadPrompt').hidden,true);assert.ok(c.status.includes('copia local'))});
test('sin sesión muestra el acceso sin consultar la cartera',async()=>{const {c,el}=setup({session:false});await c.init();assert.equal(el('authGate').classList.contains('hidden'),false);assert.equal(c.syncCalls,0);assert.equal(c.cacheReads,0)});
test('una cuenta sin acceso mantiene el mensaje de autenticación al intentar actualizar',async()=>{const {c,el,complete}=setup({noAccess:true,sync:false});await c.init();const pending=c.loadPortfolioOnDemand();await tick();complete();await pending;assert.equal(el('authGate').classList.contains('hidden'),false);assert.equal(c.renders,0)});
test('dos pulsaciones rápidas no duplican la carga y un error inesperado retira el bloqueo',async()=>{const {c,el,complete}=setup();await c.init();const a=c.loadPortfolioOnDemand(),b=c.loadPortfolioOnDemand();await tick();assert.equal(c.syncCalls,1);complete();await Promise.all([a,b]);assert.equal(el('dataBusyOverlay').hidden,true);c.syncFromCloud=async()=>{throw Error('network')};await c.loadPortfolioOnDemand();assert.equal(el('app').inert,false)});
test('Inicio muestra únicamente fecha y turno, independiente de la sincronización',()=>{
 const {c,el}=setup();const source=fs.readFileSync(path.join(root,'analysis.js'),'utf8');vm.runInContext(source.slice(0,source.indexOf('function renderHome()')),c);
 c.state.positions=[{isin:'A'},{isin:'B'}];c.state.sourceStates=[{isin:'A',last_success_at:'2026-10-12T04:08:00Z'},{isin:'B',last_success_at:'2026-10-12T16:19:00Z'},{isin:'C',last_success_at:'2026-10-12T19:00:00Z'}];c.state.cloudSyncedAt='2026-10-12T19:33:00Z';c.renderHomeDates();assert.equal(el('lastUpdate').textContent,'12/10/2026 · 18:00');
 c.state.sourceStates=[{isin:'A',last_success_at:'2026-10-12T04:08:00Z'}];c.renderHomeDates();assert.equal(el('lastUpdate').textContent,'12/10/2026 · 06:00');
 assert.equal(c.portfolioDownloadSlot('2026-12-12T05:19:00Z'),'12/12/2026 · 06:00');
 assert.equal(c.portfolioDownloadSlot('2026-12-12T17:19:00Z'),'12/12/2026 · 18:00');
 assert.equal(c.portfolioDownloadSlot('2026-10-12T02:00:00Z'),'11/10/2026 · 18:00');
 c.state.sourceStates=[];c.state.lastNavUpdate='2026-10-09';c.renderHomeDates();assert.equal(el('lastUpdate').textContent,'9/10/2026');
 c.state.lastNavUpdate=null;c.renderHomeDates();assert.equal(el('lastUpdate').textContent,'—');
});
test('las descargas recuperan histórico aunque el precio reciente esté al día',()=>{
 const c={state:{sourceStates:[]}};vm.createContext(c);const source=fs.readFileSync(path.join(root,'market.js'),'utf8');vm.runInContext(source.slice(source.indexOf('function refreshNeedsFullHistory'),source.indexOf('function refreshSafeDetail')),c);
 assert.equal(c.refreshNeedsFullHistory({key:'A|',navDate:'2026-10-17'}),true);
 c.state.sourceStates=[{instrument_key:'A|',metadata:{history_v1:{version:1,status:'pending'}}}];assert.equal(c.refreshNeedsFullHistory({key:'A|',navDate:'2026-10-17'}),true);
 c.state.sourceStates[0].metadata.history_v1.status='available';assert.equal(c.refreshNeedsFullHistory({key:'A|'}),false);
});
test('el histórico de fondos vendidos sigue incluido entre los objetivos de descarga',()=>{
 const c={state:{portfolios:[{id:'p',active:true}]},cloudSnapshot:{accounts:[{id:'a',portfolio_id:'p',active:true}],ops:[{isin:'SOLD',account_id:'a',status:'completed',listing_symbol:null},{isin:'PENDING',account_id:'a',status:'pending'}],recurringRules:[],navs:[],listingPrices:[],funds:[]},expandRecurringRules:()=>({operations:[]}),buildPositions:()=>[]};vm.createContext(c);const source=fs.readFileSync(path.join(root,'market.js'),'utf8');vm.runInContext(source.slice(source.indexOf('function allPortfolioMarketPositions'),source.indexOf('function refreshTargets')),c);
 const positions=c.allPortfolioMarketPositions();assert.equal(positions.length,1);assert.equal(positions[0].isin,'SOLD');
});
