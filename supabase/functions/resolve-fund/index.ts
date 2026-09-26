import { corsHeaders, json, envJsonKey, normalizeIsin, validIsin, fetchVdos, fetchFinect, exchangeDisplayName, isTradegateListing, fetchOfficialFundSeries, calendarAgeDays, validCurrency, validQuoteDate, fetchTradegate, fetchBoersennewsTradegateReference, fetchMarketScreenerTradegateClose, chooseProxyListing, nearestRowByDate, nearestFxByDate } from "./providers.ts";
import type { OfficialSeriesResult } from "./providers.ts";

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
    const bearer=authHeader.slice(7).trim();
    const internalServiceCall=bearer===secretKey;
    if(!internalServiceCall){
      const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers:{ apikey:publishableKey, Authorization:authHeader } });
      if (!authResponse.ok) return json({ ok:false,error:"INVALID_SESSION" },401);
    }

    const body = await req.json().catch(() => ({}));
    const isin = normalizeIsin(body?.isin);
    const includeHistory = body?.include_history === true;
    const forceMetadata = body?.force_metadata === true;
    const refreshQuote = body?.refresh_quote === true;
    const requestedListingSymbol = String(body?.listing_symbol ?? "").trim() || null;
    if (!validIsin(isin)) return json({ ok:false,error:"INVALID_ISIN",isin },400);

    const dbHeaders = { apikey: secretKey, "Content-Type":"application/json" };
    async function db(path:string, init:RequestInit={}) {
      const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { ...init, headers:{ ...dbHeaders, ...(init.headers ?? {}) } });
      const text = await response.text(); let data:any=null; try{data=text?JSON.parse(text):null}catch{data=text}
      if(!response.ok) throw new Error(`DB_${response.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
      return data;
    }

    async function fetchEodSeries(symbol:string, from:string) {
      const u=new URL(`https://eodhd.com/api/eod/${encodeURIComponent(symbol)}`);
      u.searchParams.set("api_token",eodhdToken);u.searchParams.set("fmt","json");u.searchParams.set("from",from);
      const r=await fetch(u);
      if(!r.ok) return {ok:false,status:r.status,details:(await r.text()).slice(0,500),rows:[] as any[]};
      const data=await r.json();
      if(!Array.isArray(data)) return {ok:false,status:502,details:"Invalid EOD response",rows:[] as any[]};
      const rows=data.map((x:any)=>({date:x?.date,price:Number(x?.adjusted_close??x?.close)})).filter((x:any)=>/^\d{4}-\d{2}-\d{2}$/.test(String(x.date))&&Number.isFinite(x.price)&&x.price>0);
      return {ok:true,status:r.status,details:null,rows};
    }

    async function ensureListingHistory(listing:any, fullHistory:boolean, refreshRecent:boolean) {
      const symbol=String(listing.provider_symbol);
      const exact=await db(`listing_prices?provider_symbol=eq.${encodeURIComponent(symbol)}&is_approximate=eq.false&select=price_date,price,currency,source,fetched_at&order=price_date.asc&limit=10000`);
      const exactRows=Array.isArray(exact)?exact:[];
      const oldest=exactRows[0]?.price_date??null;
      const threshold=new Date();threshold.setUTCFullYear(threshold.getUTCFullYear()-5);threshold.setUTCDate(threshold.getUTCDate()+14);
      const useful=oldest&&new Date(`${oldest}T00:00:00Z`)<=threshold;
      if((fullHistory&&!useful)||refreshRecent){
        const from=new Date();
        if(fullHistory&&!useful){from.setUTCFullYear(1900,0,1);from.setUTCHours(0,0,0,0)}
        else from.setUTCDate(from.getUTCDate()-10);
        const fetched=await fetchEodSeries(symbol,from.toISOString().slice(0,10));
        if(!fetched.ok) return {ok:false,error:"EODHD_HISTORY_FAILED",status:fetched.status,details:fetched.details,rows:exactRows,fetched:false,inserted:0};
        const now=new Date().toISOString();
        const rows=fetched.rows.map((x:any)=>({provider_symbol:symbol,price_date:x.date,price:x.price,currency:listing.currency||null,source:"EODHD EOD API",fetched_at:now,is_approximate:false,proxy_symbol:null,calibration_factor:null,approximation_method:null,calibration_date:null}));
        for(let i=0;i<rows.length;i+=250) await db(`listing_prices?on_conflict=provider_symbol,price_date`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows.slice(i,i+250))});
        const all=await db(`listing_prices?provider_symbol=eq.${encodeURIComponent(symbol)}&is_approximate=eq.false&select=price_date,price,currency,source,fetched_at&order=price_date.asc&limit=10000`);
        return {ok:true,rows:Array.isArray(all)?all:rows,fetched:true,inserted:rows.length};
      }
      return {ok:true,rows:exactRows,fetched:false,inserted:0};
    }

    const existingRows = await db(`funds?isin=eq.${encodeURIComponent(isin)}&select=isin,name,manager,currency,theme,category,category_source,benchmark,data_provider,provider_symbol,instrument_type,metadata_source,metadata_fetched_at,category_fetched_at&limit=1`);
    const existing = Array.isArray(existingRows) ? existingRows[0] ?? null : null;
    let listings:any[] = await db(`instrument_listings?isin=eq.${encodeURIComponent(isin)}&select=provider_symbol,isin,ticker,exchange_code,exchange_name,currency,instrument_type,is_primary,source,fetched_at,valuation_source_url,valuation_source_name,valuation_source_checked_at&order=is_primary.desc,exchange_code.asc,ticker.asc`);
    if(!Array.isArray(listings)) listings=[];

    const diagnostics:any[]=[];
    let vdos:any={ok:false,attempted:false,sourceUrl:null,name:null,category:null,manager:null,benchmark:null,nav:null,navDate:null,navCurrency:null};
    let finect:any={ok:false,attempted:false,sourceUrl:null,category:null,manager:null,benchmark:null};
    async function ensureVdos(){
      if(vdos.attempted)return vdos;
      vdos={...(await fetchVdos(isin)),attempted:true};
      diagnostics.push({source:"VDOS/Quefondos",ok:vdos.ok===true,status:vdos.status??null,detail:vdos.ok?"Ficha localizada":(vdos.error||"Sin datos válidos"),url:vdos.sourceUrl??null});
      return vdos;
    }

    let searchResults:any[]=[];
    let searchFailure:any=null;
    const wantsTradegateRefresh = refreshQuote && String(requestedListingSymbol||"").startsWith("TRADEGATE:");
    const needSearch = forceMetadata || wantsTradegateRefresh || !existing || !listings.some(l=>l.source === "EODHD Search API") || !existing?.name || existing?.name===isin;
    if(needSearch){
      const searchUrl=new URL(`https://eodhd.com/api/search/${encodeURIComponent(isin)}`);
      searchUrl.searchParams.set("api_token",eodhdToken); searchUrl.searchParams.set("fmt","json"); searchUrl.searchParams.set("limit","50");
      try{
        const searchResponse=await fetch(searchUrl);
        if(!searchResponse.ok){searchFailure={error:"EODHD_SEARCH_FAILED",status:searchResponse.status};}
        else{
          const results=await searchResponse.json();
          if(!Array.isArray(results))searchFailure={error:"EODHD_INVALID_SEARCH_RESPONSE",status:502};
          else{
            const seen=new Set<string>();
            searchResults=results.filter((r:any)=>{ if(normalizeIsin(r?.ISIN)!==isin||!r?.Code||!r?.Exchange)return false; const symbol=`${r.Code}.${r.Exchange}`; if(seen.has(symbol))return false; seen.add(symbol); return true; });
          }
        }
      }catch(error){searchFailure={error:"EODHD_SEARCH_UNAVAILABLE",status:502,details:String(error)}}
      diagnostics.push({source:"EODHD Search API",ok:searchResults.length>0,status:searchFailure?.status??200,detail:searchResults.length?`${searchResults.length} cotizaciones localizadas`:(searchFailure?.error||"ISIN no localizado")});
      if((searchFailure||!searchResults.length)&&!existing)await ensureVdos();
      if(!searchResults.length&&!existing&&!vdos.ok)return json({ok:false,error:searchFailure?.error||"INSTRUMENT_NOT_FOUND",status:searchFailure?.status??404,isin,diagnostics},searchFailure?502:404);
      const nowIso=new Date().toISOString();
      // El fondo maestro debe existir antes que sus cotizaciones. Así el alta de
      // cualquier ISIN no depende de crear previamente un registro desde el cliente.
      const shellName=String(searchResults[0]?.Name??vdos.name??isin).trim()||isin;
      const shellCurrency=String(searchResults[0]?.Currency??vdos.navCurrency??existing?.currency??"EUR").toUpperCase();
      await db(`funds?on_conflict=isin`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({isin,name:shellName,currency:/^[A-Z]{3}$/.test(shellCurrency)?shellCurrency:"EUR",theme:existing?.theme||"Sin clasificar",data_provider:searchResults.length?"EODHD":"VDOS/Quefondos",metadata_source:searchResults.length?"EODHD Search API":"VDOS/Quefondos",metadata_fetched_at:nowIso,active:true})});
      const rows=searchResults.map((r:any)=>({provider_symbol:`${r.Code}.${r.Exchange}`,isin,ticker:String(r.Code),exchange_code:String(r.Exchange),exchange_name:exchangeDisplayName(String(r.Exchange)),currency:r.Currency?String(r.Currency).toUpperCase():null,instrument_type:r.Type?String(r.Type).toUpperCase():null,is_primary:r.isPrimary===true,source:"EODHD Search API",fetched_at:nowIso}));
      if(rows.length) await db(`instrument_listings?on_conflict=provider_symbol`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows)});
      const prices=searchResults.filter((r:any)=>r?.previousClose!=null&&r?.previousCloseDate).map((r:any)=>({provider_symbol:`${r.Code}.${r.Exchange}`,price_date:r.previousCloseDate,price:Number(r.previousClose),currency:r.Currency?String(r.Currency).toUpperCase():null,source:"EODHD Search API",fetched_at:nowIso,is_approximate:false,proxy_symbol:null,calibration_factor:null,approximation_method:null,calibration_date:null})).filter((r:any)=>Number.isFinite(r.price)&&r.price>0);
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
        const cachedTradegate = listings.find((l:any)=>l.provider_symbol===tradegate.providerSymbol) ?? null;
        const row={provider_symbol:tradegate.providerSymbol,isin,ticker:tradegate.ticker,exchange_code:tradegate.exchangeCode,exchange_name:tradegate.exchangeName,currency:tradegate.currency,instrument_type:tradegate.instrumentType||instrumentType||"ETF",is_primary:false,source:"Tradegate Exchange",fetched_at:nowIso,valuation_source_url:cachedTradegate?.valuation_source_url??null,valuation_source_name:cachedTradegate?.valuation_source_name??null,valuation_source_checked_at:cachedTradegate?.valuation_source_checked_at??null};
        await db(`instrument_listings?on_conflict=provider_symbol`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(row)});
        listings=[...listings.filter((l:any)=>l.provider_symbol!==row.provider_symbol),row];
        let valuationPrice=tradegate.last, valuationDate=tradegate.priceDate, valuationSource="Tradegate Exchange · Last (fallback)";
        let marketClose=await fetchMarketScreenerTradegateClose(isin, row.valuation_source_url ?? null);
        // MarketScreener can block/disallow server-side discovery. In that case use a
        // deterministic ISIN URL at boersennews.de, whose Tradegate row currently
        // matches the broker-style reference/close used by DEGIRO for this instrument.
        if(!(marketClose.ok && marketClose.close && marketClose.priceDate)){
          const altClose=await fetchBoersennewsTradegateReference(isin);
          if(altClose.ok && altClose.close && altClose.priceDate) marketClose=altClose;
        }
        if(marketClose.ok && marketClose.close && marketClose.priceDate){
          row.valuation_source_url = marketClose.sourceUrl;
          row.valuation_source_name = marketClose.source;
          row.valuation_source_checked_at = nowIso;
          await db(`instrument_listings?provider_symbol=eq.${encodeURIComponent(row.provider_symbol)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({valuation_source_url:row.valuation_source_url,valuation_source_name:row.valuation_source_name,valuation_source_checked_at:row.valuation_source_checked_at})});
          const direct=Number(tradegate.last);
          const close=Number(marketClose.close);
          const sameOrNewer=!tradegate.priceDate||String(marketClose.priceDate)>=String(tradegate.priceDate);
          const plausible=!Number.isFinite(direct)||direct<=0||Math.abs(close/direct-1)<=0.05;
          if(Number.isFinite(close)&&close>0&&sameOrNewer&&plausible){
            valuationPrice=close; valuationDate=marketClose.priceDate; valuationSource=marketClose.source;
          }
        }
        const eodTg=searchResults.filter((r:any)=>{
          const l={provider_symbol:`${r.Code}.${r.Exchange}`,exchange_code:String(r.Exchange||""),exchange_name:exchangeDisplayName(String(r.Exchange||""))};
          return isTradegateListing(l)&&r?.previousClose!=null&&r?.previousCloseDate&&String(r?.Currency||"").toUpperCase()===String(tradegate.currency||"").toUpperCase();
        }).sort((a:any,b:any)=>String(b.previousCloseDate).localeCompare(String(a.previousCloseDate)))[0]??null;
        if(eodTg && !(marketClose.ok && marketClose.close && marketClose.priceDate)){
          const eodPrice=Number(eodTg.previousClose), direct=Number(tradegate.last), sameOrNewer=!tradegate.priceDate||String(eodTg.previousCloseDate)>=String(tradegate.priceDate);
          const plausible=!Number.isFinite(direct)||direct<=0||Math.abs(eodPrice/direct-1)<=0.05;
          if(Number.isFinite(eodPrice)&&eodPrice>0&&sameOrNewer&&plausible){valuationPrice=eodPrice;valuationDate=String(eodTg.previousCloseDate);valuationSource="EODHD previous close · Tradegate";}
        }
        if(valuationPrice!=null&&valuationDate) await db(`listing_prices?on_conflict=provider_symbol,price_date`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({provider_symbol:row.provider_symbol,price_date:valuationDate,price:valuationPrice,currency:tradegate.currency,source:valuationSource,fetched_at:nowIso,is_approximate:false,proxy_symbol:null,calibration_factor:null,approximation_method:null,calibration_date:null})});
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
      const requestedRaw=(await db(`instrument_listings?provider_symbol=eq.${encodeURIComponent(requestedListingSymbol)}&select=provider_symbol,isin,ticker,exchange_code,exchange_name,currency,instrument_type,is_primary,source,fetched_at,valuation_source_url,valuation_source_name,valuation_source_checked_at&limit=1`));
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
    if(!existing?.name||existing?.name===isin||forceMetadata||(!requiresListing&&(includeHistory||refreshQuote)))await ensureVdos();
    const name=String(selectedSearch?.Name ?? searchResults[0]?.Name ?? vdos.name ?? existing?.name ?? isin).trim();
    const masterCurrency=String(selectedListing?.currency ?? searchResults[0]?.Currency ?? vdos.navCurrency ?? existing?.currency ?? "EUR").toUpperCase();
    const nowIso=new Date().toISOString();

    let category=existing?.category??null, categorySource=existing?.category_source??null, manager=existing?.manager??null, benchmark=existing?.benchmark??null;
    const needsGenericFundQuote=!requiresListing&&(includeHistory||refreshQuote);
    if(forceMetadata||!category||!manager||!benchmark||needsGenericFundQuote){
      await ensureVdos(); if(vdos.category){category=vdos.category;categorySource="VDOS/Quefondos"} if(!manager&&vdos.manager)manager=vdos.manager;if(!benchmark&&vdos.benchmark)benchmark=vdos.benchmark;
      if(!category||!manager||!benchmark){ finect={...(await fetchFinect(isin,name||isin)),attempted:true};diagnostics.push({source:"Finect",ok:finect.ok===true,status:finect.status??null,detail:finect.ok?"Metadatos localizados":(finect.error||"Sin metadatos válidos"),url:finect.sourceUrl??null});if(!category&&finect.category){category=finect.category;categorySource="Finect (datos Morningstar)"} if(!manager&&finect.manager)manager=finect.manager;if(!benchmark&&finect.benchmark)benchmark=finect.benchmark; }
    }

    const identityProvider=searchResults.length||listings.some((l:any)=>l.source==="EODHD Search API")?"EODHD":(vdos.ok?"VDOS/Quefondos":existing?.data_provider||"Sin fuente");
    const metadataSource=identityProvider==="EODHD"?"EODHD Search API":(vdos.ok?"VDOS/Quefondos":existing?.metadata_source||null);
    const fundPayload:Record<string,unknown>={isin,name,currency:/^[A-Z]{3}$/.test(masterCurrency)?masterCurrency:(existing?.currency||"EUR"),data_provider:identityProvider,provider_symbol:requiresListing?null:(selectedListing?.provider_symbol??null),instrument_type:instrumentType,metadata_source:metadataSource,metadata_fetched_at:nowIso,active:true};
    if(!existing)fundPayload.theme="Sin clasificar"; if(category){fundPayload.category=category;fundPayload.category_source=categorySource;fundPayload.category_fetched_at=nowIso} if(manager)fundPayload.manager=manager;if(benchmark)fundPayload.benchmark=benchmark;
    const upserted=await db(`funds?on_conflict=isin`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify(fundPayload)}); const fund=Array.isArray(upserted)?upserted[0]:upserted;

    let historyFetched=false,historyRowsInserted=0,historyReason:string|null=null;
    let historyApproximate=false, proxyInfo:any=null;
    const officialSeries:OfficialSeriesResult = (!requiresListing && (includeHistory || refreshQuote))
      ? await fetchOfficialFundSeries(isin)
      : { ok:false, source:null, sourceUrl:null, currency:null, rows:[], reason:"NOT_REQUESTED" };
    if(!requiresListing&&(includeHistory||refreshQuote))diagnostics.push({source:officialSeries.ok?(officialSeries.source||"Histórico oficial por ISIN"):"Histórico oficial por ISIN",ok:officialSeries.ok,status:officialSeries.status??null,detail:officialSeries.ok?`${officialSeries.rows.length} valores localizados`:(officialSeries.reason||officialSeries.error||"No disponible"),url:officialSeries.sourceUrl??null});
    const officialRows = officialSeries.ok
      ? (includeHistory ? officialSeries.rows : officialSeries.rows.slice(0, 30))
      : [];
    const vdosCurrency=String(vdos?.navCurrency||masterCurrency).toUpperCase();
    const vdosQuote = Number(vdos?.nav)>0 && validQuoteDate(vdos?.navDate) && validCurrency(vdosCurrency)
      ? { date:String(vdos.navDate), price:Number(vdos.nav), currency:String(vdos.navCurrency||masterCurrency).toUpperCase(), source:"VDOS/Quefondos · última valoración" }
      : null;
    if(vdos.attempted&&vdos.ok)diagnostics.push({source:"VDOS/Quefondos · VL",ok:!!vdosQuote,status:vdos.status??null,detail:vdosQuote?`${vdosQuote.date} · ${vdosQuote.price} ${vdosQuote.currency}`:"VL rechazado por fecha, importe o divisa no válidos",url:vdos.sourceUrl??null});

    if(selectedListing && (includeHistory || refreshQuote)){
      const targetIsTradegate=isTradegateListing(selectedListing);
      if(targetIsTradegate){
        const proxy=chooseProxyListing(selectedListing,listings);
        if(!proxy){
          historyReason="NO_PROXY_LISTING_AVAILABLE";
        }else{
          const proxyHistory=await ensureListingHistory(proxy,includeHistory,refreshQuote);
          if(!proxyHistory.ok){
            historyReason="PROXY_HISTORY_UNAVAILABLE";
          }else{
            const targetExact=await db(`listing_prices?provider_symbol=eq.${encodeURIComponent(selectedListing.provider_symbol)}&is_approximate=eq.false&select=price_date,price,currency,source,fetched_at&order=price_date.desc&limit=50`);
            const targetRows=Array.isArray(targetExact)?targetExact:[];
            const anchorTarget=targetRows[0]??null;
            const anchorProxy=anchorTarget?nearestRowByDate(proxyHistory.rows,anchorTarget.price_date,7):null;
            if(!anchorTarget||!anchorProxy){
              historyReason="PROXY_CALIBRATION_UNAVAILABLE";
            }else{
              const targetCurrency=String(selectedListing.currency||anchorTarget.currency||"").toUpperCase();
              const proxyCurrency=String(proxy.currency||anchorProxy.currency||"").toUpperCase();
              let method="same_currency_factor",fxSymbol:string|null=null,fxInverted=false,fxRows:any[]=[];
              let anchorBase=Number(anchorProxy.price);
              if(targetCurrency&&proxyCurrency&&targetCurrency!==proxyCurrency){
                method="fx_adjusted";
                const from=proxyHistory.rows[0]?.price_date ?? (()=>{const d=new Date();d.setUTCFullYear(d.getUTCFullYear()-1);return d.toISOString().slice(0,10)})();
                let fx=await fetchEodSeries(`${proxyCurrency}${targetCurrency}.FOREX`,from);
                if(fx.ok){fxSymbol=`${proxyCurrency}${targetCurrency}.FOREX`;fxRows=fx.rows;}
                else{
                  fx=await fetchEodSeries(`${targetCurrency}${proxyCurrency}.FOREX`,from);
                  if(fx.ok){fxSymbol=`${targetCurrency}${proxyCurrency}.FOREX`;fxInverted=true;fxRows=fx.rows;}
                }
                const aFx=nearestFxByDate(fxRows,anchorTarget.price_date,7);
                if(!aFx){historyReason="FX_HISTORY_UNAVAILABLE";}
                else anchorBase*=fxInverted?(1/Number(aFx.price)):Number(aFx.price);
              }
              if(!historyReason){
                const factor=Number(anchorTarget.price)/anchorBase;
                const exactDates=new Set(targetRows.map((r:any)=>r.price_date));
                const now=new Date().toISOString();
                // Rebuild the approximate segment atomically enough for this use case:
                // exact target rows are never deleted and therefore always win.
                await db(`listing_prices?provider_symbol=eq.${encodeURIComponent(selectedListing.provider_symbol)}&is_approximate=eq.true`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
                const approx:any[]=[];
                for(const pr of proxyHistory.rows){
                  if(pr.price_date>anchorTarget.price_date||exactDates.has(pr.price_date))continue;
                  let converted=Number(pr.price);
                  if(method==="fx_adjusted"){
                    const fr=nearestFxByDate(fxRows,pr.price_date,5);if(!fr)continue;
                    converted*=fxInverted?(1/Number(fr.price)):Number(fr.price);
                  }
                  const price=converted*factor;
                  if(!Number.isFinite(price)||price<=0)continue;
                  approx.push({provider_symbol:selectedListing.provider_symbol,price_date:pr.price_date,price,currency:targetCurrency||selectedListing.currency||null,source:`Histórico aproximado · proxy ${proxy.exchange_name||proxy.exchange_code||proxy.provider_symbol}`,fetched_at:now,is_approximate:true,proxy_symbol:proxy.provider_symbol,calibration_factor:factor,approximation_method:method,calibration_date:anchorTarget.price_date});
                }
                for(let i=0;i<approx.length;i+=250) await db(`listing_prices?on_conflict=provider_symbol,price_date`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(approx.slice(i,i+250))});
                await db(`listing_history_proxies?on_conflict=target_symbol`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({target_symbol:selectedListing.provider_symbol,proxy_symbol:proxy.provider_symbol,method,calibration_date:anchorTarget.price_date,calibration_factor:factor,target_currency:targetCurrency||null,proxy_currency:proxyCurrency||null,fx_symbol:fxSymbol,fx_inverted:fxInverted,source:"Mi Cartera proxy history",updated_at:now})});
                historyFetched=proxyHistory.fetched||approx.length>0;historyRowsInserted=approx.length;historyApproximate=true;historyReason="PROXY_HISTORY";
                proxyInfo={target_symbol:selectedListing.provider_symbol,proxy_symbol:proxy.provider_symbol,proxy_exchange:proxy.exchange_name||exchangeDisplayName(proxy.exchange_code),proxy_ticker:proxy.ticker,method,calibration_date:anchorTarget.price_date,calibration_factor:factor,target_currency:targetCurrency,proxy_currency:proxyCurrency,fx_symbol:fxSymbol,fx_inverted:fxInverted};
              }
            }
          }
        }
      }else if(officialRows.length){
        const rows=officialRows.map((x)=>({
          provider_symbol:selectedListing.provider_symbol,
          price_date:x.date,
          price:x.price,
          currency:officialSeries.currency||selectedListing.currency||masterCurrency,
          source:officialSeries.source,
          fetched_at:nowIso,
          is_approximate:false,
          proxy_symbol:null,
          calibration_factor:null,
          approximation_method:null,
          calibration_date:null,
        }));
        for(let i=0;i<rows.length;i+=250) await db(`listing_prices?on_conflict=provider_symbol,price_date`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows.slice(i,i+250))});
        historyFetched=true;
        historyRowsInserted=rows.length;
        historyReason="OFFICIAL_MANAGER_HISTORY";
      }else{
        const exactHistory=await ensureListingHistory(selectedListing,includeHistory,refreshQuote);
        if(!exactHistory.ok){
          if(includeHistory&&!vdosQuote) return json({ok:false,error:"EODHD_HISTORY_FAILED",status:exactHistory.status,details:exactHistory.details,fund},502);
          historyReason=vdosQuote?"EODHD_FAILED_VDOS_AVAILABLE":"QUOTE_REFRESH_FAILED";
        }else{
          historyFetched=exactHistory.fetched;historyRowsInserted=exactHistory.inserted;
        }
      }
    }

    // Traditional funds without a usable listing can still be refreshed directly
    // from an official manager series. The newest date wins naturally in fund_navs.
    if(!requiresListing && officialRows.length){
      const directNavRows=officialRows.map((x)=>({
        isin,
        nav_date:x.date,
        nav:x.price,
        currency:officialSeries.currency||masterCurrency,
        source:officialSeries.source,
        fetched_at:nowIso,
      }));
      for(let i=0;i<directNavRows.length;i+=250) await db(`fund_navs?on_conflict=isin,nav_date`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(directNavRows.slice(i,i+250))});
      if(!selectedListing){
        historyFetched=true;
        historyRowsInserted=directNavRows.length;
        historyReason="OFFICIAL_MANAGER_HISTORY";
      }
    }

    // Generic fallback for traditional funds. VDOS publishes the latest NAV,
    // currency and date for many ISINs from different management companies.
    // An official-manager value keeps priority when both sources have the same date.
    if(!requiresListing && vdosQuote && officialRows[0]?.date!==vdosQuote.date){
      if(selectedListing){
        await db(`listing_prices?on_conflict=provider_symbol,price_date`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({
          provider_symbol:selectedListing.provider_symbol,
          price_date:vdosQuote.date,
          price:vdosQuote.price,
          currency:vdosQuote.currency,
          source:vdosQuote.source,
          fetched_at:nowIso,
          is_approximate:false,
          proxy_symbol:null,
          calibration_factor:null,
          approximation_method:null,
          calibration_date:null,
        })});
      }
      await db(`fund_navs?on_conflict=isin,nav_date`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({
        isin,
        nav_date:vdosQuote.date,
        nav:vdosQuote.price,
        currency:vdosQuote.currency,
        source:vdosQuote.source,
        fetched_at:nowIso,
      })});
      historyFetched=true;
      historyRowsInserted+=1;
      if(!historyReason||historyReason==="QUOTE_REFRESH_FAILED"||historyReason==="EODHD_FAILED_VDOS_AVAILABLE") historyReason="VDOS_LATEST_NAV";
    }

    if(!requiresListing&&selectedListing){
      const prices=await db(`listing_prices?provider_symbol=eq.${encodeURIComponent(selectedListing.provider_symbol)}&select=price_date,price,currency,source,fetched_at&order=price_date.asc&limit=2000`);
      const navRows=(Array.isArray(prices)?prices:[]).map((r:any)=>({isin,nav_date:r.price_date,nav:Number(r.price),currency:r.currency||masterCurrency,source:r.source,fetched_at:r.fetched_at||nowIso}));
      for(let i=0;i<navRows.length;i+=250)await db(`fund_navs?on_conflict=isin,nav_date`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(navRows.slice(i,i+250))});
    }

    let latest:any=null;
    if(selectedListing){ const rows=await db(`listing_prices?provider_symbol=eq.${encodeURIComponent(selectedListing.provider_symbol)}&select=price_date,price,currency,source,fetched_at,is_approximate,proxy_symbol,calibration_factor,approximation_method,calibration_date&order=price_date.desc,is_approximate.asc&limit=1`); const r=Array.isArray(rows)?rows[0]??null:null;if(r)latest={date:r.price_date,nav:Number(r.price),currency:r.currency,source:r.source,fetched_at:r.fetched_at,is_approximate:r.is_approximate===true,proxy_symbol:r.proxy_symbol??null,calibration_factor:r.calibration_factor==null?null:Number(r.calibration_factor),approximation_method:r.approximation_method??null}; }
    else if(!requiresListing){ const rows=await db(`fund_navs?isin=eq.${encodeURIComponent(isin)}&select=nav_date,nav,currency,source,fetched_at&order=nav_date.desc&limit=1`);const r=Array.isArray(rows)?rows[0]??null:null;if(r)latest={date:r.nav_date,nav:Number(r.nav),currency:r.currency,source:r.source,fetched_at:r.fetched_at}; }

    const quoteAgeDays=calendarAgeDays(latest?.date);
    const quoteStatus={
      date:latest?.date??null,
      age_days:quoteAgeDays,
      stale:quoteAgeDays==null?true:quoteAgeDays>5,
      max_age_days:5,
      source:latest?.source??null,
      official_source_available:officialSeries.ok,
      official_source_url:officialSeries.sourceUrl,
      official_source_reason:officialSeries.ok?null:officialSeries.reason??null,
      generic_fallback_available:!!vdosQuote,
      generic_fallback_url:vdos.sourceUrl??null,
    };

    diagnostics.push({source:"Resultado guardado",ok:!!latest&&!quoteStatus.stale,status:null,detail:latest?`${latest.date} · ${latest.nav} ${latest.currency||masterCurrency}${quoteStatus.stale?" · atrasado":""}`:"Sin VL/precio válido",url:null});

    return json({ok:true,isin,fund:{isin,name:fund?.name??name,manager:fund?.manager??manager??null,currency:fund?.currency??masterCurrency,category:fund?.category??category??null,category_source:fund?.category_source??categorySource??null,benchmark:fund?.benchmark??benchmark??null,provider:identityProvider,provider_symbol:requiresListing?null:(selectedListing?.provider_symbol??null),instrument_type:fund?.instrument_type??instrumentType??null,metadata_source:metadataSource},requires_listing:requiresListing,listings:listings.map((l:any)=>({provider_symbol:l.provider_symbol,ticker:l.ticker,exchange_code:l.exchange_code,exchange_name:l.exchange_name||exchangeDisplayName(l.exchange_code),currency:l.currency,instrument_type:l.instrument_type,is_primary:l.is_primary===true,source:l.source,valuation_source_name:l.valuation_source_name??null})),selected_listing:selectedListing?{provider_symbol:selectedListing.provider_symbol,ticker:selectedListing.ticker,exchange_code:selectedListing.exchange_code,exchange_name:selectedListing.exchange_name||exchangeDisplayName(selectedListing.exchange_code),currency:selectedListing.currency,source:selectedListing.source,valuation_source_name:selectedListing.valuation_source_name??null}:null,latest_nav:latest,quote_status:quoteStatus,history:{requested:includeHistory,fetched:historyFetched,rows_inserted:historyRowsInserted,reason:historyReason,approximate:historyApproximate,proxy:proxyInfo},sources:{identity_nav:latest?.source??(selectedListing&&String(selectedListing.provider_symbol).startsWith("TRADEGATE:")?"Tradegate Exchange":identityProvider),official_nav_url:officialSeries.sourceUrl,category:fund?.category_source??categorySource??null,manager:vdos.manager?"VDOS/Quefondos":(finect.manager?"Finect":null),benchmark:vdos.benchmark?"VDOS/Quefondos":(finect.benchmark?"Finect (datos Morningstar)":null),vdos_url:vdos.sourceUrl,finect_url:finect.sourceUrl,tradegate_url:tradegate.sourceUrl??null,history_proxy:proxyInfo},diagnostics});
  } catch(error){ console.error(error); return json({ok:false,error:"UNEXPECTED_ERROR",details:String(error)},500); }
});
