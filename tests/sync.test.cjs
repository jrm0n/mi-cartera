const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const core=fs.readFileSync(path.resolve(__dirname,'../core.js'),'utf8');
function setup(rows,delay=0){
 const c={Set,Map,JSON,Promise,encodeURIComponent,rows,calls:[],active:0,maxActive:0};
 c.selectPaged=async(table,query)=>{
  c.active++;c.maxActive=Math.max(c.maxActive,c.active);
  const ids=JSON.parse('['+decodeURIComponent(query.match(/&isin=in\.\(([^)]*)\)/)[1])+']'),cut=query.match(/fetched_at=gte\.([^&]+)/)?.[1];
  c.calls.push({ids,incremental:!!cut});
  try{if(delay)await new Promise(resolve=>setTimeout(resolve,delay));return rows.filter(r=>ids.includes(r.isin)&&(!cut||r.fetched_at>=decodeURIComponent(cut))).map(r=>({...r}))}finally{c.active--}
 };
 vm.createContext(c);vm.runInContext(core.slice(core.indexOf('const CLOUD_QUERIES'),core.indexOf('let activeCloudSync')),c);
 return c;
}
const row=(isin,date,nav,time='2026-10-16T18:00:00Z')=>({isin,nav_date:date,nav,fetched_at:time});
test('la actualización incremental incorpora cotizaciones anteriores y corrige valores existentes sin duplicar',async()=>{
 const cached=[row('A','2026-10-15',10),row('A','2026-10-16',11)],db=[row('A','2026-10-15',12,'2026-10-17T18:00:00Z'),row('A','2026-10-16',11),row('A','2010-01-04',3,'2026-10-17T18:00:00Z'),row('A','2026-10-17',13,'2026-10-17T18:00:00Z')];
 const c=setup(db),before=JSON.stringify(cached),result=await c.readPriceChanges('fund_navs','isin',['A'],cached,['isin','nav_date'],true);
 assert.equal(result.length,4);assert.equal(result.find(r=>r.nav_date==='2026-10-15').nav,12);assert.ok(result.some(r=>r.nav_date==='2010-01-04'));assert.equal(JSON.stringify(cached),before);assert.ok(c.calls.every(call=>call.incremental));
});
test('un fondo nuevo se descarga completo mientras los existentes solo solicitan cambios',async()=>{
 const c=setup([row('A','2026-10-16',11),row('B','2008-01-02',2),row('B','2026-10-16',12)]),result=await c.readPriceChanges('fund_navs','isin',['A','B'],[row('A','2026-10-16',11)],['isin','nav_date'],true);
 assert.equal(result.length,3);assert.ok(c.calls.find(x=>x.ids[0]==='B'&&!x.incremental));assert.ok(c.calls.find(x=>x.ids[0]==='A'&&x.incremental));
});
test('la sustitución completa elimina filas antiguas del fondo sustituido sin releer el resto',async()=>{
 const c=setup([row('A','2026-10-16',15),row('B','2026-10-16',20)]),cached=[row('A','2010-01-01',1),row('A','2026-10-16',10),row('B','2026-10-16',20)];
 const result=await c.readPriceChanges('fund_navs','isin',['A','B'],cached,['isin','nav_date'],true,['A']);
 assert.equal(result.filter(r=>r.isin==='A').length,1);assert.equal(result.find(r=>r.isin==='A').nav,15);assert.ok(c.calls.find(x=>x.ids[0]==='A'&&!x.incremental));assert.ok(c.calls.find(x=>x.ids[0]==='B'&&x.incremental));
});
test('una copia sin fecha de descarga válida se vuelve a leer completamente',async()=>{
 const c=setup([row('A','2026-10-16',12)]),result=await c.readPriceChanges('fund_navs','isin',['A'],[{isin:'A',nav_date:'2010-01-01',nav:1}],['isin','nav_date'],true);assert.equal(result.length,1);assert.equal(result[0].nav,12);assert.equal(c.calls[0].incremental,false);
});
test('no devuelve precios de instrumentos que ya no están solicitados ni altera la copia tras un fallo',async()=>{
 const c=setup([row('A','2026-10-16',10)]),cached=[row('A','2026-10-16',10),row('REMOVED','2026-10-16',20)];
 const result=await c.readPriceChanges('fund_navs','isin',['A'],cached,['isin','nav_date'],true);assert.equal(result.length,1);
 c.selectPaged=async()=>{throw Error('offline')};await assert.rejects(c.readPriceChanges('fund_navs','isin',['A'],cached,['isin','nav_date'],true),/offline/);assert.equal(cached.length,2);
});
test('la carga completa consulta varios fondos en paralelo y conserva todas sus filas',async()=>{
 const rows=['A','B','C','D','E','F'].map(id=>row(id,'2026-10-16',10)),c=setup(rows,5),result=await c.selectForValues('fund_navs','isin',rows.map(r=>r.isin));assert.equal(result.length,6);assert.equal(c.maxActive,3);assert.deepEqual(Array.from(result,r=>r.isin),rows.map(r=>r.isin));
});
test('consultar estados no se considera una escritura ni provoca repetir una sincronización',async()=>{
 const c={session:{access_token:'token',user:{id:'u'}},sessionEpoch:1,state:{readonly:false},serverMutationRevision:0,SUPABASE_URL:'https://example.invalid',SUPABASE_KEY:'key',fetchWithTimeout:async(url,options,ms,consume)=>consume({ok:true,status:200,text:async()=>'[]'})};
 vm.createContext(c);vm.runInContext(core.slice(core.indexOf('async function rest('),core.indexOf('const select=')),c);
 await c.rest('rpc/get_owned_data_status_v1',{method:'POST'});await c.rest('rpc/list_portfolio_viewers_v1',{method:'POST'});assert.equal(c.serverMutationRevision,0);
 c.state.readonly=true;await c.rest('rpc/read_portfolio_fast_v1',{method:'POST'});assert.equal(c.serverMutationRevision,0);await assert.rejects(c.rest('rpc/retry_owned_data_v1',{method:'POST'}),/solo lectura/);c.state.readonly=false;
 await c.rest('rpc/retry_owned_data_v1',{method:'POST'});assert.equal(c.serverMutationRevision,1);await c.rest('operations?id=eq.1',{method:'PATCH'});assert.equal(c.serverMutationRevision,2);
});
test('los errores REST conservan el código y estado para diagnóstico y control de acceso',async()=>{
 const c={session:{access_token:'token',user:{id:'u'}},sessionEpoch:1,state:{readonly:false},serverMutationRevision:0,SUPABASE_URL:'https://example.invalid',SUPABASE_KEY:'key',fetchWithTimeout:async(url,options,ms,consume)=>consume({ok:false,status:500,text:async()=>' {"code":"57014","message":"statement timeout"}'})};
 vm.createContext(c);vm.runInContext(core.slice(core.indexOf('async function rest('),core.indexOf('const select=')),c);
 await assert.rejects(c.rest('rpc/read_portfolio_fast_v1',{method:'POST'}),e=>e.message==='statement timeout'&&e.code==='57014'&&e.httpStatus===500);
});
