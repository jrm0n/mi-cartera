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

async function fetchVdos(isin: string) {
  const sourceUrl = `https://www.quefondos.com/es/fondos/ficha/index.html?isin=${encodeURIComponent(isin)}`;
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "MiCartera/0.3 (+personal portfolio data resolver)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!response.ok) return { sourceUrl, ok: false, status: response.status };
    const html = await response.text();
    const text = decodeHtml(html);
    const category = between(text, /Categoría VDOS\s*:\s*/i, /Rating VDOS\s*:/i);
    const manager = between(text, /Gestora\s*:\s*/i, /Categoría VDOS\s*:/i);
    const benchmark = between(text, /Referencia\s*:\s*/i, /Última valoración|Valor liquidativo|Rentabilidades/i);
    return {
      sourceUrl,
      ok: true,
      category: category?.slice(0, 240) ?? null,
      manager: manager?.slice(0, 240) ?? null,
      benchmark: benchmark?.slice(0, 240) ?? null,
    };
  } catch (error) {
    return { sourceUrl, ok: false, error: String(error) };
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

    // The function performs its own user validation. When deploying it from the
    // Dashboard, disable the legacy JWT gateway check for this function.
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
      `funds?isin=eq.${encodeURIComponent(isin)}&select=isin,name,manager,currency,theme,category,category_source,benchmark,data_provider,provider_symbol,metadata_source,metadata_fetched_at&limit=1`
    );
    const existing = Array.isArray(existingRows) ? existingRows[0] ?? null : null;

    let providerSymbol = existing?.provider_symbol ?? null;
    let name = existing?.name && existing.name !== isin ? existing.name : null;
    let currency = existing?.currency ?? null;
    let searchResult: any = null;

    if (!providerSymbol || !name || forceMetadata) {
      const searchUrl = new URL(`https://eodhd.com/api/search/${encodeURIComponent(isin)}`);
      searchUrl.searchParams.set("api_token", eodhdToken);
      searchUrl.searchParams.set("fmt", "json");
      searchUrl.searchParams.set("type", "fund");
      searchUrl.searchParams.set("limit", "10");

      const searchResponse = await fetch(searchUrl);
      if (!searchResponse.ok) {
        return json({ ok: false, error: "EODHD_SEARCH_FAILED", status: searchResponse.status }, 502);
      }
      const results = await searchResponse.json();
      if (!Array.isArray(results)) return json({ ok: false, error: "EODHD_INVALID_SEARCH_RESPONSE" }, 502);

      const exact = results.filter((r: any) => normalizeIsin(r?.ISIN) === isin && String(r?.Type ?? "").toUpperCase() === "FUND");
      searchResult = exact.find((r: any) => r?.Exchange === "EUFUND") ?? exact.find((r: any) => r?.isPrimary === true) ?? exact[0] ?? null;
      if (!searchResult) return json({ ok: false, error: "FUND_NOT_FOUND", isin }, 404);

      providerSymbol = `${searchResult.Code}.${searchResult.Exchange}`;
      name = String(searchResult.Name || isin).trim();
      currency = String(searchResult.Currency || currency || "EUR").trim().toUpperCase();
    }

    // VDOS/Quefondos is used only for fields explicitly published on the fund
    // page (category, manager and reference index). No category is inferred.
    const vdos = await fetchVdos(isin);
    const nowIso = new Date().toISOString();

    const fundPayload: Record<string, unknown> = {
      isin,
      name: name || isin,
      currency: currency || "EUR",
      data_provider: "EODHD",
      provider_symbol: providerSymbol,
      metadata_source: "EODHD Search API",
      metadata_fetched_at: nowIso,
      active: true,
    };
    if (!existing) fundPayload.theme = "Sin clasificar";
    if (vdos.ok && vdos.category) {
      fundPayload.category = vdos.category;
      fundPayload.category_source = "VDOS/Quefondos";
      fundPayload.category_fetched_at = nowIso;
    }
    if (vdos.ok && vdos.manager) fundPayload.manager = vdos.manager;
    if (vdos.ok && vdos.benchmark) fundPayload.benchmark = vdos.benchmark;

    const upserted = await db(`funds?on_conflict=isin`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(fundPayload),
    });
    const fund = Array.isArray(upserted) ? upserted[0] : upserted;

    // Search API already gives the latest published close; persist it without
    // consuming a second EODHD call.
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
          // Keep request bodies modest if a provider returns more rows than expected.
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
        manager: fund?.manager ?? vdos.manager ?? null,
        currency: fund?.currency ?? currency ?? null,
        category: fund?.category ?? vdos.category ?? null,
        category_source: fund?.category_source ?? (vdos.category ? "VDOS/Quefondos" : null),
        benchmark: fund?.benchmark ?? vdos.benchmark ?? null,
        provider: "EODHD",
        provider_symbol: providerSymbol,
        metadata_source: "EODHD Search API",
      },
      latest_nav: latest ? {
        date: latest.nav_date,
        nav: Number(latest.nav),
        currency: latest.currency,
        source: latest.source,
      } : null,
      history: {
        requested: includeHistory,
        fetched: historyFetched,
        rows_inserted: historyRowsInserted,
      },
      sources: {
        identity_nav: "EODHD",
        category: vdos.category ? "VDOS/Quefondos" : null,
        vdos_url: vdos.sourceUrl,
      },
    });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: "UNEXPECTED_ERROR", details: String(error) }, 500);
  }
});
