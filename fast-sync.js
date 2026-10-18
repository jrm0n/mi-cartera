// Una instantánea de lectura con las mismas políticas de acceso de Supabase.
let fastSyncAvailable=null;
async function readCloudSnapshot(previous,options={}){
 if(options.priceChanges){
  try{const result=await readFastCloudSnapshot(previous);if(result)return result}
  catch(error){
   // Los fallos de sesión/acceso no deben provocar otra lectura con otra identidad.
   if(error?.httpStatus===401||error?.httpStatus===403||/La sesión cambió|No hay sesión|Sesión caducada/.test(String(error?.message||'')))throw error;
   console.warn('La lectura agrupada falló; se intenta una lectura completa por páginas.',error);
   setCloudStatus('Reintentando la carga por partes…');
   // Una lectura fallida o incompleta nunca se mezcla con la copia anterior.
   return readStandardCloudSnapshot(null,{...options,priceChanges:false});
  }
 }
 return readStandardCloudSnapshot(previous,options);
}
async function fastDateHash(rows,dateColumn){
 const dates=rows.map(row=>row[dateColumn]).sort().join(',');
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(dates));
 return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function fastGroupRows(rows,column){const groups=new Map();for(const row of rows||[]){if(!groups.has(row[column]))groups.set(row[column],[]);groups.get(row[column]).push(row)}return groups}
async function fastCacheMarks(previous){
 const result={fund_navs:Object.create(null),listing_prices:Object.create(null)};
 const sources=new Map((previous?.sourceStates||[]).map(s=>[s.instrument_key,s]));
 for(const [table,column,dateColumn,manifestName] of [['fund_navs','isin','nav_date','nav'],['listing_prices','provider_symbol','price_date','listing']]){
  const groups=fastGroupRows(table==='fund_navs'?previous?.navs:previous?.listingPrices,column),saved=new Map((previous?.fastManifest?.[manifestName]||[]).map(m=>[m.key,m]));
  await Promise.all([...groups].map(async([key,rows])=>{
   if(rows.some(row=>!/^\d{4}-\d{2}-\d{2}T/.test(String(row.fetched_at||''))))return;
   const at=rows.reduce((latest,row)=>row.fetched_at>latest?row.fetched_at:latest,''),prior=saved.get(key);
   const date_hash=prior?.count===rows.length&&prior.at===at?prior.date_hash:await fastDateHash(rows,dateColumn);
   result[table][key]={count:rows.length,at,date_hash,...(table==='fund_navs'?{source_success:sources.get(key+'|')?.last_success_at||null}:{})};
  }));
  for(const [key,prior] of saved)if(prior.count===0&&!groups.has(key))result[table][key]={count:0,at:null,date_hash:prior.date_hash,...(table==='fund_navs'?{source_success:sources.get(key+'|')?.last_success_at||null}:{})};
 }
 return result;
}
async function fastMergePrices(previous,updates,manifest,column,dateColumn){
 const old=fastGroupRows(previous,column),changed=fastGroupRows(updates,column),groups=[],mismatches=[];
 for(const entry of manifest){
  if(!entry||typeof entry.key!=='string'||!Number.isInteger(entry.count)||entry.count<0||!/^[a-f0-9]{64}$/.test(entry.date_hash))throw Error('FAST_RPC_FORMAT');
  const baseline=entry.full?[]:old.get(entry.key)||[],delta=changed.get(entry.key)||[];
  let rows=baseline;
  if(delta.length||entry.full){const byDate=new Map(baseline.map(row=>[row[dateColumn],row]));for(const row of delta)byDate.set(row[dateColumn],row);rows=[...byDate.values()]}
  if(rows.length!==entry.count||(!entry.unchanged||entry.full)&&await fastDateHash(rows,dateColumn)!==entry.date_hash)mismatches.push(entry.key);
  groups.push(rows);
 }
 const keep=manifest.filter(m=>m.count>0).length===old.size&&manifest.every(m=>m.count===0||!m.full&&!(changed.get(m.key)?.length)&&old.has(m.key));
 return {rows:keep?(previous||[]):groups.flat(),mismatches};
}
async function readFastCloudSnapshot(previous){
 if(fastSyncAvailable===false||!globalThis.crypto?.subtle)return null;
 const marks=await fastCacheMarks(previous);
 for(let attempt=0;attempt<2;attempt++){
  let result;
  try{result=await rpc('read_portfolio_fast_v1',{p_cached:marks})}
  catch(error){
   const message=String(error?.message||'');
   if(/PGRST202|42883|could not find.*read_portfolio_fast_v1|function.*read_portfolio_fast_v1.*does not exist/i.test(message)){fastSyncAvailable=false;return null}
   throw error;
  }
  const arrays=['portfolios','accounts','ops','transfers','recurringRules','funds','listings','sourceStates','navs','listingPrices','storedFx','navManifest','listingManifest'];
  if(result?.version!==1||arrays.some(key=>!Array.isArray(result[key]))){fastSyncAvailable=false;return null}
  const [nav,listing]=await Promise.all([
   fastMergePrices(previous?.navs,result.navs,result.navManifest,'isin','nav_date'),
   fastMergePrices(previous?.listingPrices,result.listingPrices,result.listingManifest,'provider_symbol','price_date')
  ]);
  if(nav.mismatches.length||listing.mismatches.length){
   if(attempt)throw Error('No se pudo verificar la integridad del histórico descargado. Se conserva la última copia.');
   for(const key of nav.mismatches)delete marks.fund_navs[key];
   for(const key of listing.mismatches)delete marks.listing_prices[key];
   continue;
  }
  fastSyncAvailable=true;
  return {...result,navs:nav.rows,listingPrices:listing.rows,fastManifest:{nav:result.navManifest,listing:result.listingManifest}};
 }
 return null;
}
