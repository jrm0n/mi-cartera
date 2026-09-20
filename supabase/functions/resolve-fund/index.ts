const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function envJsonKey(name: string, key = "default") {
  const raw = Deno.env.get(name);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.[key] ?? null;
  } catch {
    return null;
  }
}

function normalizeIsin(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function validIsin(isin: string) {
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) return false;
  const expanded = [...isin]
    .map((c) => /[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)
    .join("");
  let sum = 0;
  let doubleDigit = false;
  for (let i = expanded.length - 1; i >= 0; i--) {
    let n = Number(expanded[i]);
    if (doubleDigit) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function decodeHtml(text: string) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú")
    .replace(/&ntilde;/gi, "ñ")
    .replace(/&Aacute;/g, "Á")
    .replace(/&Eacute;/g, "É")
    .replace(/&Iacute;/g, "Í")
    .replace(/&Oacute;/g, "Ó")
    .replace(/&Uacute;/g, "Ú")
    .replace(/&Ntilde;/g, "Ñ")
    .replace(/&euro;|&#8364;/gi, "€")
    .replace(/\s+/g, " ")
    .trim();
}

function between(text: string, start: RegExp, end: RegExp) {
  const a = text.match(start);
  if (!a || a.index == null) return null;
  const from = a.index + a[0].length;
  const tail = text.slice(from);
  const b = tail.match(end);
  const value = (b && b.index != null ? tail.slice(0, b.index) : tail).trim();
  return value || null;
}

function cleanField(value: string | null, max = 240) {
  if (!value) return null;
  const v = value.replace(/\s+/g, " ").trim();
  if (!v || /^n\/?a$/i.test(v) || /^-+$/.test(v)) return null;
  return v.slice(0, max);
}

function finectSlug(name: string) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function fetchVdos(isin: string) {
  // The mobile fiche is simpler and exposes Gestora / Categoría VDOS as plain text.
  const sourceUrl = `https://www.quefondos.com/m/es/fondos/ficha/?isin=${encodeURIComponent(isin)}`;
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MiCartera/0.3.3; personal portfolio resolver)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!response.ok) return { sourceUrl, ok: false, status: response.status, category: null, manager: null, benchmark: null };
    const text = decodeHtml(await response.text());
    const category = cleanField(between(text, /Categoría VDOS\s*:?\s*/i, /Rating VDOS\s*:?/i));
    const manager = cleanField(between(text, /Gestora\s*:?\s*/i, /Categoría VDOS\s*:?/i));
    const benchmark = cleanField(between(text, /Referencia\s*:?\s*/i, /Última valoración|Valor liquidativo|Rentabilidades|Política de inversión/i));
    return { sourceUrl, ok: !!(category || manager || benchmark), status: response.status, category, manager, benchmark };
  } catch (error) {
    return { sourceUrl, ok: false, error: String(error), category: null, manager: null, benchmark: null };
  }
}

async function fetchFinect(isin: string, name: string) {
  const slug = finectSlug(name);
  const sourceUrl = `https://www.finect.com/fondos-inversion/${encodeURIComponent(isin)}-${slug}`;
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MiCartera/0.3.3; personal portfolio resolver)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!response.ok) return { sourceUrl, ok: false, status: response.status, category: null, manager: null, benchmark: null };
    const text = decodeHtml(await response.text());
    // Restrict parsing to the information block so menu/footer repetitions do not pollute fields.
    const marker = text.search(/\bInformación\b/i);
    const info = marker >= 0 ? text.slice(marker) : text;
    const manager = cleanField(between(info, /\bGestora\s*/i, /\bCategoría\s*/i));
    const category = cleanField(between(info, /\bCategoría\s*/i, /\bBenchmark\s*/i));
    const benchmark = cleanField(between(info, /\bBenchmark\s*/i, /\bFondo indexado\b/i));
    const validPage = info.includes(isin) || text.includes(isin);
    return {
      sourceUrl: response.url || sourceUrl,
      ok: validPage && !!(category || manager || benchmark),
      status: response.status,
      category: validPage ? category : null,
      manager: validPage ? manager : null,
      benchmark: validPage ? benchmark : null,
    };
  } catch (error) {
    return { sourceUrl, ok: false, error: String(error), category: null, manager: null, benchmark: null };
  }
}


function exchangeDisplayName(code: string) {
  const key = String(code || "").toUpperCase();
  const names: Record<string, string> = {
    TDG: "Tradegate", TGAT: "Tradegate", TGATE: "Tradegate", TRADEGATE: "Tradegate",
    XETRA: "Xetra", F: "Frankfurt", FRA: "Frankfurt", LSE: "London Stock Exchange",
    SW: "SIX Swiss Exchange", SIX: "SIX Swiss Exchange", PA: "Euronext Paris",
    AS: "Euronext Amsterdam", MI: "Borsa Italiana", EUFUND: "Fondo europeo (EUFUND)",
  };
  return names[key] || key || "Mercado sin identificar";
}

function isTradegateListing(listing: any) {
  const code = String(listing?.exchange_code || "").toUpperCase();
  const name = String(listing?.exchange_name || "").toLowerCase();
  const sym = String(listing?.provider_symbol || "");
  return sym.startsWith("TRADEGATE:") || ["TDG","TGAT","TGATE","TRADEGATE"].includes(code) || name.includes("tradegate");
}

function parseDecimal(value: string | null) {
  if (!value) return null;
  const n = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function fetchTradegate(isin: string) {
  const sourceUrl = `https://www.tradegatebsx.com/orderbuch.php?isin=${encodeURIComponent(isin)}&lang=en`;
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MiCartera/0.3.8; personal portfolio resolver)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!response.ok) return { ok: false, sourceUrl, status: response.status };
    const text = decodeHtml(await response.text());
    if (!text.includes(isin)) return { ok: false, sourceUrl, status: response.status };
    const escapedIsin = isin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const info = text.match(new RegExp(
      `WKN\\s+Code\\s+ISIN\\s+Trading Currency\\s+\\S+\\s+([A-Z0-9.\\-]+)\\s+${escapedIsin}\\s+([A-Z]{3})`, "i"
    ));
    const ticker = info?.[1]?.trim() ?? null;
    const currency = info?.[2]?.trim().toUpperCase() ?? null;
    const lastMatch = text.match(/\bLast\s+([0-9]+(?:[.,][0-9]+)?)(?=\s+(?:Change|Turnover|Volume|Ø-price))/i);
    const last = parseDecimal(lastMatch?.[1] ?? null);
    const dateMatch = text.match(/Last Update:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    const priceDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;
    if (!ticker || !currency) return { ok: false, sourceUrl, status: response.status };
    const instrumentType = /\bETF\s*\(/i.test(text) || /\bETF\b/i.test(text) ? "ETF" : null;
    return {
      ok: true, sourceUrl: response.url || sourceUrl, ticker, currency, last, priceDate, instrumentType,
      providerSymbol: `TRADEGATE:${isin}`, exchangeCode: "TGAT", exchangeName: "Tradegate",
    };
  } catch (error) {
    return { ok: false, sourceUrl, error: String(error) };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publishableKey = envJsonKey("SUPABASE_PUBLISHABLE_KEYS") ?? Deno.env.get("SUPABASE_ANON_KEY");
    const secretKey = envJsonKey("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const eodhdToken = Deno.env.get("EODHD_API_TOKEN");
    if (!supabaseUrl || !publishableKey || !secretKey || !eodhdToken) return json({ ok:false,error:"SERVER_CONFIGURATION_INCOMPLETE" },500);

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) return json({ ok:false,error:"AUTH_REQUIRED" },401);
    const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers:{ apikey:publishableKey, Authorization:authHeader } });
    if (!authResponse.ok) return json({ ok:false,error:"INVALID_SESSION" },401);

    const body = await req.json().catch(() => ({}));
    const isin = normalizeIsin(body?.isin);
    const includeHistory = body?.include_history === true;
    const forceMetadata = body?.force_metadata === true;
    const requestedListingSymbol = String(body?.listing_symbol ?? "").trim() || null;
    if (!validIsin(isin)) return json({ ok:false,error:"INVALID_ISIN",isin },400);

    const dbHeaders = { apikey: secretKey, "Content-Type":"application/json" };
    async function db(path:string, init:RequestInit={}) {
      const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { ...init, headers:{ ...dbHeaders, ...(init.headers ?? {}) } });
      const text = await response.text(); let data:any=null; try{data=text?JSON.parse(text):null}catch{data=text}
      if(!response.ok) throw new Error(`DB_${response.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
      return data;
    }

    const existingRows = await db(`funds?isin=eq.${encodeURIComponent(isin)}&select=isin,name,manager,currency,theme,category,category_source,benchmark,data_provider,provider_symbol,instrument_type,metadata_source,metadata_fetched_at,category_fetched_at&limit=1`);
    const existing = Array.isArray(existingRows) ? existingRows[0] ?? null : null;
    let listings:any[] = await db(`instrument_listings?isin=eq.${encodeURIComponent(isin)}&select=provider_symbol,isin,ticker,exchange_code,exchange_name,currency,instrument_type,is_primary,source,fetched_at&order=is_primary.desc,exchange_code.asc,ticker.asc`);
    if(!Array.isArray(listings)) listings=[];

    let searchResults:any[]=[];
    const needSearch = forceMetadata || !existing || !listings.some(l=>l.source === "EODHD Search API") || !existing?.name || existing?.name===isin;
    if(needSearch){
      const searchUrl=new URL(`https://eodhd.com/api/search/${encodeURIComponent(isin)}`);
      searchUrl.searchParams.set("api_token",eodhdToken); searchUrl.searchParams.set("fmt","json"); searchUrl.searchParams.set("limit","50");
      const searchResponse=await fetch(searchUrl);
      if(!searchResponse.ok) return json({ok:false,error:"EODHD_SEARCH_FAILED",status:searchResponse.status},502);
      const results=await searchResponse.json(); if(!Array.isArray(results)) return json({ok:false,error:"EODHD_INVALID_SEARCH_RESPONSE"},502);
      const seen=new Set<string>();
      searchResults=results.filter((r:any)=>{ if(normalizeIsin(r?.ISIN)!==isin||!r?.Code||!r?.Exchange)return false; const symbol=`${r.Code}.${r.Exchange}`; if(seen.has(symbol))return false; seen.add(symbol); return true; });
      if(!searchResults.length && !existing) return json({ok:false,error:"INSTRUMENT_NOT_FOUND",isin},404);
      const nowIso=new Date().toISOString();
      const rows=searchResults.map((r:any)=>({provider_symbol:`${r.Code}.${r.Exchange}`,isin,ticker:String(r.Code),exchange_code:String(r.Exchange),exchange_name:exchangeDisplayName(String(r.Exchange)),currency:r.Currency?String(r.Currency).toUpperCase():null,instrument_type:r.Type?String(r.Type).toUpperCase():null,is_primary:r.isPrimary===true,source:"EODHD Search API",fetched_at:nowIso}));
      if(rows.length) await db(`instrument_listings?on_conflict=provider_symbol`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows)});
      const prices=searchResults.filter((r:any)=>r?.previousClose!=null&&r?.previousCloseDate).map((r:any)=>({provider_symbol:`${r.Code}.${r.Exchange}`,price_date:r.previousCloseDate,price:Number(r.previousClose),currency:r.Currency?String(r.Currency).toUpperCase():null,source:"EODHD Search API",fetched_at:nowIso})).filter((r:any)=>Number.isFinite(r.price)&&r.price>0);
      if(prices.length) await db(`listing_prices?on_conflict=provider_symbol,price_date`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(prices)});
      listings=[...listings.filter(l=>l.source!=="EODHD Search API"),...rows];
    }

    let instrumentType=String(searchResults.find((r:any)=>r?.Type)?.Type ?? listings.find((r:any)=>r?.instrument_type)?.instrument_type ?? existing?.instrument_type ?? "").toUpperCase()||null;
    let tradegate:any={ok:false,sourceUrl:null};
    if(String(instrumentType||"").includes("ETF") || String(requestedListingSymbol||"").startsWith("TRADEGATE:")){
      tradegate=await fetchTradegate(isin);
      if(tradegate.ok){
        const nowIso=new Date().toISOString();
        if(tradegate.instrumentType) instrumentType=tradegate.instrumentType;
        const row={provider_symbol:tradegate.providerSymbol,isin,ticker:tradegate.ticker,exchange_code:tradegate.exchangeCode,exchange_name:tradegate.exchangeName,currency:tradegate.currency,instrument_type:tradegate.instrumentType||instrumentType||"ETF",is_primary:false,source:"Tradegate Exchange",fetched_at:nowIso};
        await db(`instrument_listings?on_conflict=provider_symbol`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(row)});
        listings=[...listings.filter((l:any)=>l.provider_symbol!==row.provider_symbol),row];
        if(tradegate.last!=null&&tradegate.priceDate) await db(`listing_prices?on_conflict=provider_symbol,price_date`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({provider_symbol:row.provider_symbol,price_date:tradegate.priceDate,price:tradegate.last,currency:tradegate.currency,source:"Tradegate Exchange",fetched_at:nowIso})});
      }
    }

    // Tradegate debe tener una única identidad canónica. Si la fuente directa está disponible,
    // no devolvemos aliases EODHD de Tradegate al cliente para evitar precios de otro listado.
    if(tradegate.ok){
      const exact=listings.find((l:any)=>l.provider_symbol===tradegate.providerSymbol);
      listings=[...listings.filter((l:any)=>!isTradegateListing(l)),...(exact?[exact]:[])];
    }

    const requiresListing=listings.length>1||String(instrumentType||"").includes("ETF");
    let selectedListing:any=null;
    if(requestedListingSymbol){
      const requestedRaw=(await db(`instrument_listings?provider_symbol=eq.${encodeURIComponent(requestedListingSymbol)}&select=provider_symbol,isin,ticker,exchange_code,exchange_name,currency,instrument_type,is_primary,source,fetched_at&limit=1`));
      const raw=Array.isArray(requestedRaw)?requestedRaw[0]??null:null;
      const wantsTradegate=String(requestedListingSymbol).startsWith("TRADEGATE:")||isTradegateListing(raw);
      if(wantsTradegate){
        if(!tradegate.ok)return json({ok:false,error:"TRADEGATE_QUOTE_UNAVAILABLE",isin},502);
        selectedListing=listings.find((l:any)=>l.provider_symbol===tradegate.providerSymbol)??null;
      }else{
        selectedListing=listings.find((l:any)=>l.provider_symbol===requestedListingSymbol)??null;
      }
      if(!selectedListing)return json({ok:false,error:"LISTING_NOT_FOUND",listing_symbol:requestedListingSymbol,isin},400);
    }
    else if(!requiresListing){ selectedListing=listings.find((l:any)=>l.exchange_code==="EUFUND")??listings.find((l:any)=>l.is_primary===true)??listings[0]??null; }

    const selectedSearch=selectedListing?searchResults.find((r:any)=>`${r.Code}.${r.Exchange}`===selectedListing.provider_symbol):null;
    const name=String(selectedSearch?.Name ?? searchResults[0]?.Name ?? existing?.name ?? isin).trim();
    const masterCurrency=String(existing?.currency ?? searchResults[0]?.Currency ?? selectedListing?.currency ?? "EUR").toUpperCase();
    const nowIso=new Date().toISOString();

    let category=existing?.category??null, categorySource=existing?.category_source??null, manager=existing?.manager??null, benchmark=existing?.benchmark??null;
    let vdos:any={ok:false,sourceUrl:null,category:null,manager:null,benchmark:null}; let finect:any={ok:false,sourceUrl:null,category:null,manager:null,benchmark:null};
    if(forceMetadata||!category||!manager||!benchmark){
      vdos=await fetchVdos(isin); if(vdos.category){category=vdos.category;categorySource="VDOS/Quefondos"} if(!manager&&vdos.manager)manager=vdos.manager;if(!benchmark&&vdos.benchmark)benchmark=vdos.benchmark;
      if(!category||!manager||!benchmark){ finect=await fetchFinect(isin,name||isin); if(!category&&finect.category){category=finect.category;categorySource="Finect (datos Morningstar)"} if(!manager&&finect.manager)manager=finect.manager;if(!benchmark&&finect.benchmark)benchmark=finect.benchmark; }
    }

    const fundPayload:Record<string,unknown>={isin,name,currency:masterCurrency,data_provider:"EODHD",provider_symbol:requiresListing?null:(selectedListing?.provider_symbol??null),instrument_type:instrumentType,metadata_source:"EODHD Search API",metadata_fetched_at:nowIso,active:true};
    if(!existing)fundPayload.theme="Sin clasificar"; if(category){fundPayload.category=category;fundPayload.category_source=categorySource;fundPayload.category_fetched_at=nowIso} if(manager)fundPayload.manager=manager;if(benchmark)fundPayload.benchmark=benchmark;
    const upserted=await db(`funds?on_conflict=isin`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify(fundPayload)}); const fund=Array.isArray(upserted)?upserted[0]:upserted;

    let historyFetched=false,historyRowsInserted=0,historyReason:string|null=null;
    if(selectedListing&&includeHistory&&String(selectedListing.provider_symbol).startsWith("TRADEGATE:")){
      historyReason="EXACT_TRADEGATE_HISTORY_UNAVAILABLE";
    }else if(selectedListing&&includeHistory){
      const oldest=await db(`listing_prices?provider_symbol=eq.${encodeURIComponent(selectedListing.provider_symbol)}&select=price_date&order=price_date.asc&limit=1`); const oldestDate=Array.isArray(oldest)?oldest[0]?.price_date:null;
      const threshold=new Date();threshold.setUTCDate(threshold.getUTCDate()-330); const hasUseful=oldestDate&&new Date(`${oldestDate}T00:00:00Z`)<=threshold;
      if(!hasUseful){
        const from=new Date();from.setUTCFullYear(from.getUTCFullYear()-1);from.setUTCDate(from.getUTCDate()-7);
        const historyUrl=new URL(`https://eodhd.com/api/eod/${encodeURIComponent(selectedListing.provider_symbol)}`);historyUrl.searchParams.set("api_token",eodhdToken);historyUrl.searchParams.set("fmt","json");historyUrl.searchParams.set("from",from.toISOString().slice(0,10));
        const hr=await fetch(historyUrl);if(!hr.ok){const msg=await hr.text();return json({ok:false,error:"EODHD_HISTORY_FAILED",status:hr.status,details:msg.slice(0,500),fund},502)} const history=await hr.json();if(!Array.isArray(history))return json({ok:false,error:"EODHD_INVALID_HISTORY_RESPONSE",fund},502);
        const rows=history.map((r:any)=>({provider_symbol:selectedListing.provider_symbol,price_date:r?.date,price:Number(r?.adjusted_close??r?.close),currency:selectedListing.currency||masterCurrency,source:"EODHD EOD API",fetched_at:nowIso})).filter((r:any)=>/^\d{4}-\d{2}-\d{2}$/.test(String(r.price_date))&&Number.isFinite(r.price)&&r.price>0);
        for(let i=0;i<rows.length;i+=250)await db(`listing_prices?on_conflict=provider_symbol,price_date`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows.slice(i,i+250))}); historyFetched=true;historyRowsInserted=rows.length;
      }
    }

    if(!requiresListing&&selectedListing){
      const prices=await db(`listing_prices?provider_symbol=eq.${encodeURIComponent(selectedListing.provider_symbol)}&select=price_date,price,currency,source,fetched_at&order=price_date.asc&limit=2000`);
      const navRows=(Array.isArray(prices)?prices:[]).map((r:any)=>({isin,nav_date:r.price_date,nav:Number(r.price),currency:r.currency||masterCurrency,source:r.source,fetched_at:r.fetched_at||nowIso}));
      for(let i=0;i<navRows.length;i+=250)await db(`fund_navs?on_conflict=isin,nav_date`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(navRows.slice(i,i+250))});
    }

    let latest:any=null;
    if(selectedListing){ const rows=await db(`listing_prices?provider_symbol=eq.${encodeURIComponent(selectedListing.provider_symbol)}&select=price_date,price,currency,source,fetched_at&order=price_date.desc&limit=1`); const r=Array.isArray(rows)?rows[0]??null:null;if(r)latest={date:r.price_date,nav:Number(r.price),currency:r.currency,source:r.source,fetched_at:r.fetched_at}; }
    else if(!requiresListing){ const rows=await db(`fund_navs?isin=eq.${encodeURIComponent(isin)}&select=nav_date,nav,currency,source,fetched_at&order=nav_date.desc&limit=1`);const r=Array.isArray(rows)?rows[0]??null:null;if(r)latest={date:r.nav_date,nav:Number(r.nav),currency:r.currency,source:r.source,fetched_at:r.fetched_at}; }

    return json({ok:true,isin,fund:{isin,name:fund?.name??name,manager:fund?.manager??manager??null,currency:fund?.currency??masterCurrency,category:fund?.category??category??null,category_source:fund?.category_source??categorySource??null,benchmark:fund?.benchmark??benchmark??null,provider:"EODHD",provider_symbol:requiresListing?null:(selectedListing?.provider_symbol??null),instrument_type:fund?.instrument_type??instrumentType??null,metadata_source:"EODHD Search API"},requires_listing:requiresListing,listings:listings.map((l:any)=>({provider_symbol:l.provider_symbol,ticker:l.ticker,exchange_code:l.exchange_code,exchange_name:l.exchange_name||exchangeDisplayName(l.exchange_code),currency:l.currency,instrument_type:l.instrument_type,is_primary:l.is_primary===true,source:l.source})),selected_listing:selectedListing?{provider_symbol:selectedListing.provider_symbol,ticker:selectedListing.ticker,exchange_code:selectedListing.exchange_code,exchange_name:selectedListing.exchange_name||exchangeDisplayName(selectedListing.exchange_code),currency:selectedListing.currency,source:selectedListing.source}:null,latest_nav:latest,history:{requested:includeHistory,fetched:historyFetched,rows_inserted:historyRowsInserted,reason:historyReason},sources:{identity_nav:selectedListing&&String(selectedListing.provider_symbol).startsWith("TRADEGATE:")?"Tradegate Exchange":"EODHD",category:fund?.category_source??categorySource??null,manager:vdos.manager?"VDOS/Quefondos":(finect.manager?"Finect":null),benchmark:vdos.benchmark?"VDOS/Quefondos":(finect.benchmark?"Finect (datos Morningstar)":null),vdos_url:vdos.sourceUrl,finect_url:finect.sourceUrl,tradegate_url:tradegate.sourceUrl??null}});
  } catch(error){ console.error(error); return json({ok:false,error:"UNEXPECTED_ERROR",details:String(error)},500); }
});
