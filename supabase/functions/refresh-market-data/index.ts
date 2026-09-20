const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
}

function envJsonKey(name: string, key = "default") {
  const raw = Deno.env.get(name); if (!raw) return null;
  try { const parsed = JSON.parse(raw); return parsed?.[key] ?? null; } catch { return null; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok:false,error:"METHOD_NOT_ALLOWED" },405);
  try {
    const supabaseUrl=Deno.env.get("SUPABASE_URL");
    const publishableKey=envJsonKey("SUPABASE_PUBLISHABLE_KEYS") ?? Deno.env.get("SUPABASE_ANON_KEY");
    const secretKey=envJsonKey("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!supabaseUrl||!publishableKey||!secretKey) return json({ok:false,error:"SERVER_CONFIGURATION_INCOMPLETE"},500);

    const dbHeaders={apikey:secretKey,"Content-Type":"application/json"};
    async function db(path:string,init:RequestInit={}){
      const r=await fetch(`${supabaseUrl}/rest/v1/${path}`,{...init,headers:{...dbHeaders,...(init.headers??{})}});
      const text=await r.text();let data:any=null;try{data=text?JSON.parse(text):null}catch{data=text}
      if(!r.ok) throw new Error(`DB_${r.status}: ${typeof data==='string'?data:JSON.stringify(data)}`);return data;
    }

    // Public scheduler endpoint, protected against quota exhaustion by an 18-hour server-side lock.
    const cutoff=new Date(Date.now()-18*3600*1000).toISOString();
    const recent=await db(`market_refresh_runs?started_at=gte.${encodeURIComponent(cutoff)}&status=in.(running,success)&select=id,started_at,status&order=started_at.desc&limit=1`);
    if(Array.isArray(recent)&&recent.length) return json({ok:true,skipped:true,reason:"RECENT_REFRESH",last:recent[0]});

    const created=await db('market_refresh_runs',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({status:'running'})});
    const runId=Array.isArray(created)?created[0]?.id:null;

    const ops=await db('operations?status=eq.completed&shares_delta=not.is.null&select=isin,listing_symbol,shares_delta,operation_date&order=operation_date.asc&limit=20000');
    const net=new Map<string,{isin:string,listing_symbol:string|null,shares:number}>();
    for(const o of Array.isArray(ops)?ops:[]){const key=`${o.isin}|${o.listing_symbol||''}`;const x=net.get(key)||{isin:o.isin,listing_symbol:o.listing_symbol||null,shares:0};x.shares+=Number(o.shares_delta)||0;net.set(key,x)}
    const active=[...net.values()].filter(x=>x.shares>1e-10).slice(0,18);
    let successes=0,failures=0;const details:any[]=[];
    for(const item of active){
      try{
        const r=await fetch(`${supabaseUrl}/functions/v1/resolve-fund`,{method:'POST',headers:{'Content-Type':'application/json',apikey:publishableKey,Authorization:`Bearer ${secretKey}`},body:JSON.stringify({isin:item.isin,listing_symbol:item.listing_symbol,include_history:true,refresh_quote:true})});
        const body=await r.json().catch(()=>({}));if(!r.ok||body?.ok===false)throw new Error(body?.error||`HTTP_${r.status}`);successes++;details.push({isin:item.isin,listing_symbol:item.listing_symbol,ok:true});
      }catch(error){failures++;details.push({isin:item.isin,listing_symbol:item.listing_symbol,ok:false,error:String(error).slice(0,180)})}
    }
    if(runId!=null) await db(`market_refresh_runs?id=eq.${runId}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({finished_at:new Date().toISOString(),status:failures?'partial':'success',instruments:active.length,successes,failures,details})});
    return json({ok:true,skipped:false,instruments:active.length,successes,failures,limited:net.size>18});
  }catch(error){console.error(error);return json({ok:false,error:"UNEXPECTED_ERROR",details:String(error)},500)}
});
