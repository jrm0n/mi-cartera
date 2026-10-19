const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),core=fs.readFileSync(path.join(root,'core.js'),'utf8'),market=fs.readFileSync(path.join(root,'market.js'),'utf8');
function setup(){
 const nodes=new Map();
 function element(id){if(!nodes.has(id)){const classes=new Set();nodes.set(id,{hidden:true,inert:false,isConnected:true,textContent:'',attrs:{},setAttribute(k,v){this.attrs[k]=v},focus(){c.document.activeElement=this},closest(){return null},classList:{toggle(k,on){if(on)classes.add(k);else classes.delete(k)},contains(k){return classes.has(k)}}})}return nodes.get(id)}
 const c={console,Map,Symbol,Promise,session:{user:{id:'u'}},sessionEpoch:1,serverMutationRevision:0,alert(){},document:{getElementById:element,body:element('body')}};c.document.activeElement=element('button');vm.createContext(c);
 vm.runInContext(core.slice(core.indexOf('// Bloqueo visual compartido'),core.indexOf('const THEME_KEY')),c);
 return{c,element};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('bloquea navegación, acceso, formularios y visor; restaura el foco al acabar',()=>{
 const {c,element}=setup(),focus=c.document.activeElement,release=c.beginAppBusy();
 assert.equal(element('dataBusyOverlay').hidden,false);assert.equal(element('app').attrs['aria-busy'],'true');
 for(const id of ['app','authGate','opBackdrop','detailBackdrop','viewerSyncOverlay'])assert.equal(element(id).inert,true,id);
 release();release();assert.equal(element('dataBusyOverlay').hidden,true);assert.equal(element('app').inert,false);assert.equal(c.document.activeElement,focus);
});
test('una sincronización anidada no desbloquea mientras otra tarea continúa',()=>{
 const {c,element}=setup(),a=c.beginAppBusy('Cargando datos…'),b=c.beginAppBusy();
 assert.equal(element('dataBusyLabel').textContent,'Cargando datos…');b();assert.equal(element('dataBusyOverlay').hidden,false);a();assert.equal(element('dataBusyOverlay').hidden,true);
});
test('un rechazo de red siempre retira la barra y permite reintentar',async()=>{
 const {c,element}=setup();await assert.rejects(c.withAppBusy('Actualizando datos…',async()=>{throw Error('Sin conexión')}),/Sin conexión/);
 assert.equal(element('app').inert,false);assert.equal(element('dataBusyOverlay').hidden,true);
});
test('sincronizaciones simultáneas comparten la lectura y se desbloquean al terminar',async()=>{
 const {c,element}=setup();let finish,calls=0;c.performCloudSync=()=>{calls++;return new Promise(r=>finish=r)};
 vm.runInContext(core.slice(core.indexOf('let activeCloudSync'),core.indexOf('async function performCloudSync')),c);
 const a=c.syncFromCloud(),b=c.syncFromCloud();assert.equal(calls,1);assert.equal(element('app').inert,true);finish(true);assert.equal(await a,true);assert.equal(await b,true);assert.equal(element('dataBusyOverlay').hidden,true);
});
test('descarga manual conserva el bloqueo entre sus sincronizaciones internas',async()=>{
 const {c,element}=setup();vm.runInContext(market.slice(market.indexOf('let marketRefreshPromise'),market.indexOf('// Los estados del descargador diario')),c);
 let finish;const a=c.exclusiveMarketRefresh(async()=>{await c.withAppBusy('Actualizando datos…',async()=>{});assert.equal(element('app').inert,true);await new Promise(r=>finish=r)});
 const b=c.exclusiveMarketRefresh(()=>assert.fail('No debe duplicar la descarga'));assert.equal(a,b);await tick();assert.equal(element('app').inert,true);finish();await a;assert.equal(element('app').inert,false);
});
test('error en descarga manual libera el bloqueo compartido',async()=>{
 const {c,element}=setup();vm.runInContext(market.slice(market.indexOf('let marketRefreshPromise'),market.indexOf('// Los estados del descargador diario')),c);
 await assert.rejects(c.exclusiveMarketRefresh(async()=>{throw Error('Proveedor caído')}),/Proveedor caído/);assert.equal(element('dataBusyOverlay').hidden,true);
});
