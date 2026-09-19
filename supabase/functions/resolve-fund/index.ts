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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publishableKey = envJsonKey("SUPABASE_PUBLISHABLE_KEYS") ?? Deno.env.get("SUPABASE_ANON_KEY");
    const secretKey = envJsonKey("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const eodhdToken = Deno.env.get("EODHD_API_TOKEN");

    if (!supabaseUrl || !publishableKey || !secretKey || !eodhdToken) {
      return json({ ok: false, error: "SERVER_CONFIGURATION_INCOMPLETE" }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return json({ ok: false, error: "AUTH_REQUIRED" }, 401);
    }

    const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: publishableKey, Authorization: authHeader },
    });
    if (!authResponse.ok) return json({ ok: false, error: "INVALID_SESSION" }, 401);

    const body = await req.json().catch(() => ({}));
    const isin = normalizeIsin(body?.isin);
    const includeHistory = body?.include_history === true;
    const forceMetadata = body?.force_metadata === true;

    if (!validIsin(isin)) return json({ ok: false, error: "INVALID_ISIN", isin }, 400);

    const dbHeaders = {
      apikey: secretKey,
      "Content-Type": "application/json",
    };

    async function db(path: string, init: RequestInit = {}) {
      const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
        ...init,
        headers: { ...dbHeaders, ...(init.headers ?? {}) },
      });
      const text = await response.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!response.ok) {
        throw new Error(`DB_${response.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
      }
      return data;
    }

    const existingRows = await db(
      `funds?isin=eq.${encodeURIComponent(isin)}&select=isin,name,manager,currency,theme,category,category_source,benchmark,data_provider,provider_symbol,instrument_type,metadata_source,metadata_fetched_at,category_fetched_at&limit=1`
    );
    const existing = Array.isArray(existingRows) ? existingRows[0] ?? null : null;

    let providerSymbol = existing?.provider_symbol ?? null;
    let name = existing?.name && existing.name !== isin ? existing.name : null;
    let currency = existing?.currency ?? null;
    let searchResult: any = null;
    let instrumentType = existing?.instrument_type ?? null;

    if (!providerSymbol || !name || forceMetadata) {
      const searchUrl = new URL(`https://eodhd.com/api/search/${encodeURIComponent(isin)}`);
      searchUrl.searchParams.set("api_token", eodhdToken);
      searchUrl.searchParams.set("fmt", "json");
      searchUrl.searchParams.set("limit", "10");

      const searchResponse = await fetch(searchUrl);
      if (!searchResponse.ok) {
        return json({ ok: false, error: "EODHD_SEARCH_FAILED", status: searchResponse.status }, 502);
      }
      const results = await searchResponse.json();
      if (!Array.isArray(results)) return json({ ok: false, error: "EODHD_INVALID_SEARCH_RESPONSE" }, 502);

      const exact = results.filter((r: any) => normalizeIsin(r?.ISIN) === isin);
      searchResult = exact.find((r: any) => r?.Exchange === "EUFUND") ?? exact.find((r: any) => r?.isPrimary === true) ?? exact[0] ?? null;
      if (!searchResult) return json({ ok: false, error: "INSTRUMENT_NOT_FOUND", isin }, 404);

      providerSymbol = `${searchResult.Code}.${searchResult.Exchange}`;
      name = String(searchResult.Name || isin).trim();
      currency = String(searchResult.Currency || currency || "EUR").trim().toUpperCase();
      instrumentType = String(searchResult.Type || instrumentType || "").trim().toUpperCase() || null;
    }

    const nowIso = new Date().toISOString();
    let category = existing?.category ?? null;
    let categorySource = existing?.category_source ?? null;
    let manager = existing?.manager ?? null;
    let benchmark = existing?.benchmark ?? null;
    let vdos: any = { ok: false, sourceUrl: null, category: null, manager: null, benchmark: null };
    let finect: any = { ok: false, sourceUrl: null, category: null, manager: null, benchmark: null };

    // Refresh public metadata only when something useful is missing or explicitly requested.
    if (forceMetadata || !category || !manager || !benchmark) {
      vdos = await fetchVdos(isin);
      if (vdos.category) {
        category = vdos.category;
        categorySource = "VDOS/Quefondos";
      }
      if (!manager && vdos.manager) manager = vdos.manager;
      if (!benchmark && vdos.benchmark) benchmark = vdos.benchmark;

      if (!category || !manager || !benchmark) {
        finect = await fetchFinect(isin, name || isin);
        if (!category && finect.category) {
          category = finect.category;
          categorySource = "Finect (datos Morningstar)";
        }
        if (!manager && finect.manager) manager = finect.manager;
        if (!benchmark && finect.benchmark) benchmark = finect.benchmark;
      }
    }

    const fundPayload: Record<string, unknown> = {
      isin,
      name: name || isin,
      currency: currency || "EUR",
      data_provider: "EODHD",
      provider_symbol: providerSymbol,
      instrument_type: instrumentType,
      metadata_source: "EODHD Search API",
      metadata_fetched_at: nowIso,
      active: true,
    };
    if (!existing) fundPayload.theme = "Sin clasificar";
    if (category) {
      fundPayload.category = category;
      fundPayload.category_source = categorySource;
      fundPayload.category_fetched_at = nowIso;
    }
    if (manager) fundPayload.manager = manager;
    if (benchmark) fundPayload.benchmark = benchmark;

    const upserted = await db(`funds?on_conflict=isin`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(fundPayload),
    });
    const fund = Array.isArray(upserted) ? upserted[0] : upserted;

    // Search API gives the latest published close for a newly resolved ISIN.
    if (searchResult?.previousClose != null && searchResult?.previousCloseDate) {
      await db(`fund_navs?on_conflict=isin,nav_date`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          isin,
          nav_date: searchResult.previousCloseDate,
          nav: Number(searchResult.previousClose),
          currency: currency || "EUR",
          source: "EODHD Search API",
          fetched_at: nowIso,
        }),
      });
    }

    let historyFetched = false;
    let historyRowsInserted = 0;

    if (includeHistory && providerSymbol) {
      const oldest = await db(
        `fund_navs?isin=eq.${encodeURIComponent(isin)}&select=nav_date&order=nav_date.asc&limit=1`
      );
      const oldestDate = Array.isArray(oldest) ? oldest[0]?.nav_date : null;
      const threshold = new Date();
      threshold.setUTCDate(threshold.getUTCDate() - 330);
      const hasUsefulHistory = oldestDate && new Date(`${oldestDate}T00:00:00Z`) <= threshold;

      if (!hasUsefulHistory) {
        const from = new Date();
        from.setUTCFullYear(from.getUTCFullYear() - 1);
        from.setUTCDate(from.getUTCDate() - 7);
        const fromIso = from.toISOString().slice(0, 10);

        const historyUrl = new URL(`https://eodhd.com/api/eod/${encodeURIComponent(providerSymbol)}`);
        historyUrl.searchParams.set("api_token", eodhdToken);
        historyUrl.searchParams.set("fmt", "json");
        historyUrl.searchParams.set("from", fromIso);

        const historyResponse = await fetch(historyUrl);
        if (!historyResponse.ok) {
          const message = await historyResponse.text();
          return json({
            ok: false,
            error: "EODHD_HISTORY_FAILED",
            status: historyResponse.status,
            details: message.slice(0, 500),
            fund,
          }, 502);
        }

        const history = await historyResponse.json();
        if (!Array.isArray(history)) return json({ ok: false, error: "EODHD_INVALID_HISTORY_RESPONSE", fund }, 502);

        const navRows = history
          .map((row: any) => ({
            isin,
            nav_date: row?.date,
            nav: Number(row?.adjusted_close ?? row?.close),
            currency: currency || "EUR",
            source: "EODHD EOD API",
            fetched_at: nowIso,
          }))
          .filter((row: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(row.nav_date)) && Number.isFinite(row.nav) && row.nav > 0);

        if (navRows.length) {
          for (let i = 0; i < navRows.length; i += 250) {
            const chunk = navRows.slice(i, i + 250);
            await db(`fund_navs?on_conflict=isin,nav_date`, {
              method: "POST",
              headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
              body: JSON.stringify(chunk),
            });
          }
        }
        historyFetched = true;
        historyRowsInserted = navRows.length;
      }
    }

    const latestRows = await db(
      `fund_navs?isin=eq.${encodeURIComponent(isin)}&select=nav_date,nav,currency,source,fetched_at&order=nav_date.desc&limit=1`
    );
    const latest = Array.isArray(latestRows) ? latestRows[0] ?? null : null;

    return json({
      ok: true,
      isin,
      fund: {
        isin,
        name: fund?.name ?? name ?? isin,
        manager: fund?.manager ?? manager ?? null,
        currency: fund?.currency ?? currency ?? null,
        category: fund?.category ?? category ?? null,
        category_source: fund?.category_source ?? categorySource ?? null,
        benchmark: fund?.benchmark ?? benchmark ?? null,
        provider: "EODHD",
        provider_symbol: providerSymbol,
        instrument_type: fund?.instrument_type ?? instrumentType ?? null,
        metadata_source: "EODHD Search API",
      },
      latest_nav: latest ? {
        date: latest.nav_date,
        nav: Number(latest.nav),
        currency: latest.currency,
        source: latest.source,
        fetched_at: latest.fetched_at,
      } : null,
      history: {
        requested: includeHistory,
        fetched: historyFetched,
        rows_inserted: historyRowsInserted,
      },
      sources: {
        identity_nav: "EODHD",
        category: fund?.category_source ?? categorySource ?? null,
        manager: vdos.manager ? "VDOS/Quefondos" : (finect.manager ? "Finect" : null),
        benchmark: vdos.benchmark ? "VDOS/Quefondos" : (finect.benchmark ? "Finect (datos Morningstar)" : null),
        vdos_url: vdos.sourceUrl,
        finect_url: finect.sourceUrl,
      },
    });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: "UNEXPECTED_ERROR", details: String(error) }, 500);
  }
});
