const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),{webcrypto,createHash}=require('node:crypto');
const source=fs.readFileSync(path.resolve(__dirname,'../fast-sync.js'),'utf8');
const row=(date,price=10,at='2026-10-01T18:00:00Z')=>({isin:'A',nav_date:date,nav:price,fetched_at:at,currency:'EUR'});
const hash=rows=>createHash('sha256').update(rows.map(r=>r.nav_date).sort().join(',')).digest('hex');
function manifest(rows,{full=false,unchanged=false,key='A'}={}){return{key,count:rows.length,at:rows.map(r=>r.fetched_at).sort().at(-1)||null,date_hash:hash(rows),full,unchanged,source_success:null}}
function response(rows,m){return{version:1,portfolios:[],accounts:[],ops:[],transfers:[],recurringRules:[],funds:[],listings:[],sourceStates:[],navs:rows,listingPrices:[],storedFx:[],navManifest:[m],listingManifest:[]}}
function setup(rpc=async()=>{throw Error('unexpected')}){const c={crypto:webcrypto,TextEncoder,Uint8Array,Set,Map,JSON,Promise,Array,Object,Number,Error,rpc};vm.createContext(c);vm.runInContext(source,c);return c}
test('los puntos de control incluyen la huella de fechas y omiten series sin sello válido',async()=>{
 const c=setup(),rows=[row('2026-10-01'),row('2026-10-02')],marks=await c.fastCacheMarks({navs:[...rows,{isin:'BAD',nav_date:'2026-10-01',nav:1}],listingPrices:[]});assert.equal(marks.fund_navs.A.date_hash,hash(rows));assert.equal(marks.fund_navs.BAD,undefined);
});
test('una serie sin cambios reutiliza las filas locales sin transferir precios',async()=>{
 const rows=[row('2026-10-01'),row('2026-10-02')],c=setup(async()=>response([],manifest(rows,{unchanged:true}))),result=await c.readFastCloudSnapshot({navs:rows,listingPrices:[]});assert.equal(result.navs,rows);assert.equal(result.navs.length,2);
});
test('un ETF sin serie de VL no obliga a reconstruir el histórico de los demás fondos',async()=>{
 const rows=[row('2026-10-01')],empty=manifest([],{full:true,key:'ETF'}),c=setup();
 const merged=await c.fastMergePrices(rows,[],[manifest(rows,{unchanged:true}),empty],'isin','nav_date');assert.equal(merged.rows,rows);
 const marks=await c.fastCacheMarks({navs:rows,listingPrices:[],fastManifest:{nav:[empty],listing:[]}});assert.equal(marks.fund_navs.ETF.count,0);
});
test('borrado e inserción con el mismo recuento obligan a reconstruir solo la serie afectada',async()=>{
 const old=[row('2026-10-01'),row('2026-10-02')],next=[row('2026-10-01'),row('2026-10-03',12,'2026-10-03T18:00:00Z')],calls=[];
 const c=setup(async(name,body)=>{calls.push(JSON.parse(JSON.stringify(body)));return response(calls.length===1?[next[1]]:next,manifest(next,{full:calls.length>1}))});
 const result=await c.readFastCloudSnapshot({navs:old,listingPrices:[]});assert.equal(calls.length,2);assert.equal(calls[1].p_cached.fund_navs.A,undefined);assert.equal(result.navs.length,2);assert.ok(!result.navs.some(r=>r.nav_date==='2026-10-02'));
});
test('si se elimina toda la serie, no conserva cotizaciones antiguas en la copia',async()=>{
 const old=[row('2026-10-01')],c=setup(async()=>response([],manifest([],{full:true}))),result=await c.readFastCloudSnapshot({navs:old,listingPrices:[]});assert.equal(result.navs.length,0);
});
test('una corrección actualiza el valor exacto y conserva el resto del histórico',async()=>{
 const old=[row('2026-10-01'),row('2026-10-02')],next=[row('2026-10-01',99,'2026-10-03T18:00:00Z'),old[1]],c=setup(async()=>response([next[0]],manifest(next))),result=await c.readFastCloudSnapshot({navs:old,listingPrices:[]});assert.equal(result.navs.length,2);assert.equal(result.navs.find(r=>r.nav_date==='2026-10-01').nav,99);assert.equal(old[0].nav,10);
});
test('sin función SQL mantiene la ruta estándar y no repite una consulta ausente',async()=>{
 let calls=0;const c=setup(async()=>{calls++;throw Error('Could not find the function public.read_portfolio_fast_v1')});assert.equal(await c.readFastCloudSnapshot(null),null);assert.equal(await c.readFastCloudSnapshot(null),null);assert.equal(calls,1);
});
test('un error de conexión no se confunde con falta de instalación ni devuelve datos parciales',async()=>{
 const c=setup(async()=>{throw Error('offline')});await assert.rejects(c.readFastCloudSnapshot(null),/offline/);
});
test('si la lectura rápida agota el tiempo, repite una lectura completa sin mezclar la copia',async()=>{
 const c=setup(async()=>{throw Error('canceling statement due to statement timeout')}),calls=[],previous={navs:[row('2026-10-01')]};
 c.console={warn(){}};c.setCloudStatus=()=>{};const snapshot={navs:[row('2026-10-02',15)]};
 c.readStandardCloudSnapshot=async(prior,options)=>{calls.push({prior,options});return snapshot};
 assert.equal(await c.readCloudSnapshot(previous,{priceChanges:true}),snapshot);assert.equal(calls.length,1);assert.equal(calls[0].prior,null);assert.equal(calls[0].options.priceChanges,false);assert.equal(previous.navs[0].nav,10);
});
test('un fallo de acceso no inicia otra consulta y conserva el error original',async()=>{
 const error=Object.assign(Error('Acceso denegado'),{httpStatus:403}),c=setup(async()=>{throw error});let fallback=false;
 c.readStandardCloudSnapshot=async()=>{fallback=true};await assert.rejects(c.readCloudSnapshot({navs:[],listingPrices:[]},{priceChanges:true}),e=>e===error);assert.equal(fallback,false);
});
test('si ambas lecturas fallan, devuelve el error concreto de la alternativa',async()=>{
 const c=setup(async()=>{throw Error('statement timeout')});c.console={warn(){}};c.setCloudStatus=()=>{};
 const error=Object.assign(Error('Acceso a operaciones denegado'),{code:'42501'});c.readStandardCloudSnapshot=async()=>{throw error};
 await assert.rejects(c.readCloudSnapshot({navs:[],listingPrices:[]},{priceChanges:true}),e=>e===error);
});
test('la actualización rápida que funciona no añade consultas alternativas',async()=>{
 const rows=[row('2026-10-01')],c=setup(async()=>response(rows,manifest(rows,{full:true})));c.readStandardCloudSnapshot=async()=>{throw Error('No debe consultarse')};
 const actual=await c.readCloudSnapshot({navs:[],listingPrices:[]},{priceChanges:true});assert.equal(actual.navs.length,1);
});
test('sin copia se descarga directamente por páginas, sin intentar la RPC completa',async()=>{
 const c=setup(async()=>{throw Error('No debe invocarse la RPC')});let prior,options;
 c.readStandardCloudSnapshot=async(p,o)=>{prior=p;options=o;return {navs:[]}};
 await c.readCloudSnapshot(null,{priceChanges:true});assert.equal(prior,null);assert.equal(options.priceChanges,true);
});
