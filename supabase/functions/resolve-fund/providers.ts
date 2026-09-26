export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

export function envJsonKey(name: string, key = "default") {
  const raw = Deno.env.get(name);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.[key] ?? null;
  } catch {
    return null;
  }
}

export function normalizeIsin(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export function validIsin(isin: string) {
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

export function decodeHtml(text: string) {
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

export function between(text: string, start: RegExp, end: RegExp) {
  const a = text.match(start);
  if (!a || a.index == null) return null;
  const from = a.index + a[0].length;
  const tail = text.slice(from);
  const b = tail.match(end);
  const value = (b && b.index != null ? tail.slice(0, b.index) : tail).trim();
  return value || null;
}

export function cleanField(value: string | null, max = 240) {
  if (!value) return null;
  const v = value.replace(/\s+/g, " ").trim();
  if (!v || /^n\/?a$/i.test(v) || /^-+$/.test(v)) return null;
  return v.slice(0, max);
}

export function parseEuropeanNumber(value: string | null) {
  if (!value) return null;
  const compact = value.replace(/\s/g, "");
  const normalized = compact.includes(",")
    ? compact.replace(/\./g, "").replace(",", ".")
    : compact;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function finectSlug(name: string) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function fetchVdos(isin: string) {
  // The mobile fiche exposes metadata and the latest published NAV as plain text.
  const sourceUrl = `https://www.quefondos.com/m/es/fondos/ficha/?isin=${encodeURIComponent(isin)}`;
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MiCartera/0.10.0; personal portfolio resolver)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!response.ok) return { sourceUrl, ok: false, status: response.status, name: null, category: null, manager: null, benchmark: null, nav: null, navDate: null, navCurrency: null };
    const html = await response.text();
    const text = decodeHtml(html);
    const h2 = html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
    const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const rawName = decodeHtml(h2?.[1] ?? title?.[1] ?? "")
      .replace(/\s*[-|·]\s*(?:Quefondos|VDOS).*$/i, "")
      .trim();
    const name = cleanField(rawName, 200);
    const category = cleanField(between(text, /Categoría VDOS\s*:?\s*/i, /Rating VDOS\s*:?/i));
    const manager = cleanField(between(text, /Gestora\s*:?\s*/i, /Categoría VDOS\s*:?/i));
    const benchmark = cleanField(between(text, /Referencia\s*:?\s*/i, /Última valoración|Valor liquidativo|Rentabilidades|Política de inversión/i));
    const valuation = between(text, /Última valoración\s*/i, /Evolución histórica|Rentabilidades acumuladas|Rentabilidades anuales/i) ?? text;
    const navMatch = valuation.match(/Valor liquidativo\s*:?\s*([0-9][0-9.\s]*(?:,[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\s*([A-Z]{3})/i);
    const dateMatch = valuation.match(/\bFecha\s*:?\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/i);
    const nav = parseEuropeanNumber(navMatch?.[1] ?? null);
    const navCurrency = navMatch?.[2]?.toUpperCase() ?? null;
    const navDate = dateMatch
      ? `${dateMatch[3]}-${String(dateMatch[2]).padStart(2,"0")}-${String(dateMatch[1]).padStart(2,"0")}`
      : null;
    return { sourceUrl:response.url || sourceUrl, ok: !!(name || category || manager || benchmark || (nav && navDate)), status: response.status, name, category, manager, benchmark, nav, navDate, navCurrency };
  } catch (error) {
    return { sourceUrl, ok: false, error: String(error), name: null, category: null, manager: null, benchmark: null, nav: null, navDate: null, navCurrency: null };
  }
}

export async function fetchFinect(isin: string, name: string) {
  const slug = finectSlug(name);
  const sourceUrl = `https://www.finect.com/fondos-inversion/${encodeURIComponent(isin)}-${slug}`;
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MiCartera/0.4.4; personal portfolio resolver)",
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


export function exchangeDisplayName(code: string) {
  const key = String(code || "").toUpperCase();
  const names: Record<string, string> = {
    TDG: "Tradegate", TGAT: "Tradegate", TGATE: "Tradegate", TRADEGATE: "Tradegate",
    XETRA: "Xetra", F: "Frankfurt", FRA: "Frankfurt", LSE: "London Stock Exchange",
    SW: "SIX Swiss Exchange", SIX: "SIX Swiss Exchange", PA: "Euronext Paris",
    AS: "Euronext Amsterdam", MI: "Borsa Italiana", EUFUND: "Fondo europeo (EUFUND)",
  };
  return names[key] || key || "Mercado sin identificar";
}

export function isTradegateListing(listing: any) {
  const code = String(listing?.exchange_code || "").toUpperCase();
  const name = String(listing?.exchange_name || "").toLowerCase();
  const sym = String(listing?.provider_symbol || "");
  return sym.startsWith("TRADEGATE:") || ["TDG","TGAT","TGATE","TRADEGATE"].includes(code) || name.includes("tradegate");
}

export function parseDecimal(value: string | null) {
  if (!value) return null;
  const n = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type OfficialSeriesRow = { date: string; price: number };
export type OfficialSeriesResult = {
  ok: boolean;
  source: string | null;
  sourceUrl: string | null;
  currency: string | null;
  rows: OfficialSeriesRow[];
  reason?: string;
  status?: number;
  error?: string;
};

/*
 * Official NAV adapters.
 *
 * This is deliberately based on the manager/name, not on one particular ISIN.
 * Adding support for another management company only requires a new adapter;
 * the freshness comparison and database writes below remain unchanged.
 */
export async function fetchOfficialCsvSeries(isin: string): Promise<OfficialSeriesResult> {
  const source = "La Financière de l'Echiquier · histórico oficial";
  const sourceUrl = `https://cdn.lfde.com/xml/${encodeURIComponent(isin)}.csv`;
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MiCartera/0.10.0; personal portfolio resolver)",
        "Accept": "text/csv,text/plain,application/octet-stream,*/*",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
    });
    if (!response.ok) return { ok:false, source, sourceUrl, currency:"EUR", rows:[], status:response.status, reason:"OFFICIAL_SOURCE_HTTP_ERROR" };

    const lines = (await response.text())
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (normalizeIsin(lines[0]) !== isin) {
      return { ok:false, source, sourceUrl, currency:"EUR", rows:[], reason:"OFFICIAL_SOURCE_ISIN_MISMATCH" };
    }

    const headerIndex = lines.findIndex((line) => /^Date;Fonds(?:;|$)/i.test(line));
    if (headerIndex < 0) return { ok:false, source, sourceUrl, currency:"EUR", rows:[], reason:"OFFICIAL_SOURCE_INVALID_FORMAT" };

    const byDate = new Map<string, OfficialSeriesRow>();
    for (const line of lines.slice(headerIndex + 1)) {
      const cells = line.split(";");
      const date = String(cells[0] ?? "").trim();
      const price = parseDecimal(String(cells[1] ?? "").trim());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !price) continue;
      byDate.set(date, { date, price });
    }
    const rows = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
    if (!rows.length) return { ok:false, source, sourceUrl, currency:"EUR", rows:[], reason:"OFFICIAL_SOURCE_EMPTY" };
    return { ok:true, source, sourceUrl:response.url || sourceUrl, currency:"EUR", rows };
  } catch (error) {
    return { ok:false, source, sourceUrl, currency:"EUR", rows:[], reason:"OFFICIAL_SOURCE_UNAVAILABLE", error:String(error) };
  }
}

export async function fetchOfficialFundSeries(isin: string): Promise<OfficialSeriesResult> {
  // El adaptador se intenta para cualquier ISIN y valida que el propio archivo
  // declare exactamente ese ISIN. No hay listas de fondos ni reglas por nombre.
  return await fetchOfficialCsvSeries(isin);
}

export function calendarAgeDays(date: string | null | undefined) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const quote = new Date(`${date}T00:00:00Z`).getTime();
  const today = new Date();
  const utcToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.floor((utcToday - quote) / 86400000));
}

export function validCurrency(value: unknown) {
  return /^[A-Z]{3}$/.test(String(value ?? "").toUpperCase());
}

export function validQuoteDate(value: unknown) {
  const date=String(value??"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
  const time=new Date(`${date}T00:00:00Z`).getTime();
  if(!Number.isFinite(time))return false;
  const tomorrow=new Date();tomorrow.setUTCDate(tomorrow.getUTCDate()+1);tomorrow.setUTCHours(23,59,59,999);
  return time<=tomorrow.getTime();
}

export async function fetchTradegate(isin: string) {
  const sourceUrl = `https://www.tradegatebsx.com/orderbuch.php?isin=${encodeURIComponent(isin)}&lang=en`;
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MiCartera/0.4.4; personal portfolio resolver)",
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


export function parseShortEuropeanDate(value: string) {
  const m = String(value || "").match(/\b(\d{1,2})\.\s*(Jan|Feb|Mär|Mar|Apr|Mai|May|Jun|Jul|Aug|Sep|Okt|Oct|Nov|Dez|Dec)\b/i);
  if (!m) return null;
  const months: Record<string, number> = {
    jan: 1, feb: 2, mär: 3, mar: 3, apr: 4, mai: 5, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12,
  };
  const month = months[m[2].toLowerCase()];
  if (!month) return null;
  const day = Number(m[1]);
  const now = new Date();
  let year = now.getUTCFullYear();
  let candidate = new Date(Date.UTC(year, month - 1, day));
  // Around New Year, a December quote belongs to the previous year.
  if (candidate.getTime() > now.getTime() + 3 * 86400000) {
    year -= 1;
    candidate = new Date(Date.UTC(year, month - 1, day));
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function htmlTableCells(rowHtml: string) {
  const cells: string[] = [];
  for (const m of rowHtml.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)) {
    cells.push(decodeHtml(m[1]));
  }
  return cells;
}

export async function fetchBoersennewsTradegateReference(isin: string) {
  const sourceUrl = `https://www.boersennews.de/markt/fonds/detail/${encodeURIComponent(isin.toLowerCase())}/`;
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MiCartera/0.4.6; personal portfolio resolver)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
    });
    if (!response.ok) return { ok: false, sourceUrl, status: response.status, close: null, priceDate: null, source: null };
    const html = await response.text();
    if (!html.toUpperCase().includes(isin.toUpperCase())) return { ok: false, sourceUrl, status: response.status, close: null, priceDate: null, source: null };

    // Prefer the exchange table row. It is keyed by the venue name and the last cell is the quoted course.
    for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      if (!/Tradegate/i.test(row[1])) continue;
      const cells = htmlTableCells(row[1]);
      if (!cells.length || !cells.some((c) => /^Tradegate$/i.test(c.trim()))) continue;
      const priceCell = [...cells].reverse().find((c) => /(?:EUR|€)/i.test(c) && /\d/.test(c));
      const priceMatch = priceCell?.match(/([0-9]{1,4}(?:[.,][0-9]{1,4}))\s*(?:EUR|€)/i);
      const close = parseDecimal(priceMatch?.[1] ?? null);
      const dateCell = cells.find((c) => /\b\d{1,2}\.\s*(?:Jan|Feb|Mär|Mar|Apr|Mai|May|Jun|Jul|Aug|Sep|Okt|Oct|Nov|Dez|Dec)\b/i.test(c));
      const priceDate = dateCell ? parseShortEuropeanDate(dateCell) : null;
      if (close && priceDate) {
        return { ok: true, sourceUrl: response.url || sourceUrl, close, priceDate, source: "boersennews.de · Tradegate reference close" };
      }
    }

    // Fallback for pages where the table is flattened or partly rendered by the server.
    const text = decodeHtml(html);
    const idx = text.search(/\bTradegate\b/i);
    if (idx >= 0) {
      const segment = text.slice(idx, idx + 700);
      const dateMatch = segment.match(/\b\d{1,2}\.\s*(?:Jan|Feb|Mär|Mar|Apr|Mai|May|Jun|Jul|Aug|Sep|Okt|Oct|Nov|Dez|Dec)\b/i);
      const priceMatches = [...segment.matchAll(/([0-9]{1,4}(?:[.,][0-9]{1,4}))\s*(?:EUR|€)/gi)];
      const close = priceMatches.length ? parseDecimal(priceMatches[priceMatches.length - 1][1]) : null;
      const priceDate = dateMatch ? parseShortEuropeanDate(dateMatch[0]) : null;
      if (close && priceDate) {
        return { ok: true, sourceUrl: response.url || sourceUrl, close, priceDate, source: "boersennews.de · Tradegate reference close" };
      }
    }
    return { ok: false, sourceUrl: response.url || sourceUrl, close: null, priceDate: null, source: null };
  } catch (error) {
    return { ok: false, sourceUrl, error: String(error), close: null, priceDate: null, source: null };
  }
}


export function marketScreenerAbsoluteUrl(base: string, href: string) {
  try { return new URL(href, base).toString(); } catch { return null; }
}

export function parseMarketScreenerDate(segment: string) {
  const iso = segment.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const eu = segment.match(/\b(\d{2})[.\/-](\d{2})[.\/-](20\d{2})\b/);
  if (eu) return `${eu[3]}-${eu[2]}-${eu[1]}`;
  return null;
}

export function isMarketScreenerInstrumentUrl(value: string) {
  try {
    const u = new URL(value);
    if (!/(^|\.)marketscreener\.com$/i.test(u.hostname)) return false;
    return /\/(?:quote|cotizacion|kurs|quotazioni|koers)\/(?:etf|stock)\//i.test(u.pathname);
  } catch { return false; }
}

export function normalizeSearchHref(base: string, rawHref: string) {
  const href = rawHref.replace(/&amp;/gi, '&').trim();
  try {
    const u = new URL(href, base);
    const uddg = u.searchParams.get('uddg');
    if (uddg) {
      const decoded = decodeURIComponent(uddg);
      if (isMarketScreenerInstrumentUrl(decoded)) return decoded.split('#')[0];
    }
    if (isMarketScreenerInstrumentUrl(u.toString())) return u.toString().split('#')[0];
  } catch { /* ignore */ }
  return null;
}

export async function parseMarketScreenerTradegatePage(sourceUrl: string, isin: string, headers: Record<string,string>) {
  try {
    const r = await fetch(sourceUrl, { headers, redirect: 'follow' });
    if (!r.ok) return null;
    const html = await r.text();
    const text = decodeHtml(html);
    if (!text.includes(isin) || !/Tradegate/i.test(text)) return null;

    // The instrument page must itself correspond to the Tradegate listing.
    const marketMarker = text.search(/(?:Market Closed|Mercado cerrado|B[öo]rse geschlossen|Mercato chiuso|March[ée] ferm[ée]|Beurs gesloten)\s*-\s*Tradegate/i);
    if (marketMarker < 0) return null;

    const segment = text.slice(marketMarker, marketMarker + 2200);
    const priceDate = parseMarketScreenerDate(segment);
    let close: number | null = null;

    // Main header price immediately after the closed-market marker.
    const headerPrice = segment.match(/([0-9]{1,4}(?:[.,][0-9]{1,4}))\s*(?:EUR|€)/i);
    close = parseDecimal(headerPrice?.[1] ?? null);

    // Fallback: first quote row for the latest date on the Tradegate page.
    if (!close) {
      const quoteRow = text.match(/(?:Quotes|Cotizaciones|Kurse|Quotazioni)[\s\S]{0,1800}?(20\d{2}-\d{2}-\d{2}|\d{2}[.\/-]\d{2}[.\/-]20\d{2})\s+(?:€\s*)?([0-9]{1,4}(?:[.,][0-9]{1,4}))/i);
      close = parseDecimal(quoteRow?.[2] ?? null);
    }

    if (!close || !priceDate) return null;
    return { ok: true, sourceUrl: r.url || sourceUrl, close, priceDate, source: 'MarketScreener · Tradegate close' };
  } catch { return null; }
}

export async function discoverMarketScreenerTradegatePage(isin: string, headers: Record<string,string>) {
  const query = `site:marketscreener.com \"${isin}\" Tradegate ETF`;
  const searchUrls = [
    `https://www.marketscreener.com/search/?q=${encodeURIComponent(isin)}`,
    `https://de.marketscreener.com/suchen/wertpapiere?q=${encodeURIComponent(isin)}`,
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
  ];
  const candidates: string[] = [];

  for (const searchUrl of searchUrls) {
    try {
      const r = await fetch(searchUrl, { headers, redirect: 'follow' });
      if (!r.ok) continue;
      const html = await r.text();
      for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
        const abs = normalizeSearchHref(r.url || searchUrl, m[1]);
        if (abs && !candidates.includes(abs)) candidates.push(abs);
      }
      // Some search engines expose result URLs as plain text rather than hrefs.
      for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+marketscreener\.com\/[^\s"'<>]+/gi)) {
        const raw = m[0].replace(/&amp;/gi, '&');
        if (isMarketScreenerInstrumentUrl(raw) && !candidates.includes(raw)) candidates.push(raw);
      }
    } catch { /* try next discovery source */ }
  }
  return candidates.slice(0, 20);
}

export async function fetchMarketScreenerTradegateClose(isin: string, cachedUrl: string | null = null) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
    'Cache-Control': 'no-cache',
  };

  const directCandidates: string[] = [];
  if (cachedUrl && isMarketScreenerInstrumentUrl(cachedUrl)) directCandidates.push(cachedUrl);

  const discovered = await discoverMarketScreenerTradegatePage(isin, headers);
  for (const u of discovered) if (!directCandidates.includes(u)) directCandidates.push(u);

  for (const baseUrl of directCandidates) {
    const urls = [baseUrl, `${baseUrl.replace(/\/$/, '')}/quotes/`, `${baseUrl.replace(/\/$/, '')}/cotizaciones/`];
    for (const sourceUrl of urls) {
      const parsed = await parseMarketScreenerTradegatePage(sourceUrl, isin, headers);
      if (parsed) return parsed;
    }
  }

  return { ok: false, sourceUrl: cachedUrl, close: null, priceDate: null, source: null };
}


export function proxyListingScore(target: any, candidate: any) {
  if (!candidate || candidate.provider_symbol === target?.provider_symbol || isTradegateListing(candidate)) return -1e9;
  let score = 0;
  const tc = String(target?.currency || "").toUpperCase();
  const cc = String(candidate?.currency || "").toUpperCase();
  const ex = String(candidate?.exchange_code || "").toUpperCase();
  if (tc && cc && tc === cc) score += 1000;
  if (ex === "XETRA") score += 300;
  if (ex === "F") score += 150;
  if (String(candidate?.ticker || "").toUpperCase() === String(target?.ticker || "").toUpperCase()) score += 100;
  if (candidate?.is_primary === true) score += 50;
  if (String(candidate?.source || "").includes("EODHD")) score += 30;
  return score;
}

export function chooseProxyListing(target: any, listings: any[]) {
  const candidates = (listings || [])
    .filter((l: any) => l?.provider_symbol && String(l.provider_symbol).includes(".") && !isTradegateListing(l) && l.provider_symbol !== target?.provider_symbol)
    .map((l: any) => ({ listing: l, score: proxyListingScore(target, l) }))
    .filter((x: any) => x.score > -1e8)
    .sort((a: any, b: any) => b.score - a.score);
  return candidates[0]?.listing ?? null;
}

export function daysBetween(a: string, b: string) {
  return Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86400000;
}

export function nearestRowByDate(rows: any[], date: string, maxGapDays = 7) {
  let best: any = null;
  for (const row of rows || []) {
    if (!row?.price_date || !Number.isFinite(Number(row?.price))) continue;
    const gap = daysBetween(row.price_date, date);
    if (gap > maxGapDays) continue;
    if (!best || gap < best.gap || (gap === best.gap && row.price_date <= date && best.row.price_date > date)) best = { row, gap };
  }
  return best?.row ?? null;
}

export function nearestFxByDate(rows: any[], date: string, maxGapDays = 5) {
  let best: any = null;
  for (const row of rows || []) {
    if (!row?.date || !Number.isFinite(Number(row?.price))) continue;
    const gap = daysBetween(row.date, date);
    if (gap > maxGapDays) continue;
    if (!best || gap < best.gap || (gap === best.gap && row.date <= date && best.row.date > date)) best = { row, gap };
  }
  return best?.row ?? null;
}

