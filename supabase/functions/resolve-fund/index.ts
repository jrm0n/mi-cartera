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

function parseEuropeanNumber(value: string | null) {
  if (!value) return null;
  const compact = value.replace(/\s/g, "");
  const normalized = compact.includes(",")
    ? compact.replace(/\./g, "").replace(",", ".")
    : compact;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function finectSlug(name: string) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function fetchVdos(isin: string) {
  // The mobile fiche exposes metadata and the latest published NAV as plain text.
  const sourceUrl = `https://www.quefondos.com/m/es/fondos/ficha/?isin=${encodeURIComponent(isin)}`;
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MiCartera/0.9.2; personal portfolio resolver)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!response.ok) return { sourceUrl, ok: false, status: response.status, category: null, manager: null, benchmark: null, nav: null, navDate: null, navCurrency: null };
    const text = decodeHtml(await response.text());
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
    return { sourceUrl:response.url || sourceUrl, ok: !!(category || manager || benchmark || (nav && navDate)), status: response.status, category, manager, benchmark, nav, navDate, navCurrency };
  } catch (error) {
    return { sourceUrl, ok: false, error: String(error), category: null, manager: null, benchmark: null, nav: null, navDate: null, navCurrency: null };
  }
}

async function fetchFinect(isin: string, name: string) {
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

type OfficialSeriesRow = { date: string; price: number };
type OfficialSeriesResult = {
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
async function fetchLfdeOfficialSeries(isin: string): Promise<OfficialSeriesResult> {
  const source = "La Financière de l'Echiquier · histórico oficial";
  const sourceUrl = `https://cdn.lfde.com/xml/${encodeURIComponent(isin)}.csv`;
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MiCartera/0.9.2; personal portfolio resolver)",
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

async function fetchOfficialFundSeries(input: {
  isin: string;
  name?: string | null;
  manager?: string | null;
}): Promise<OfficialSeriesResult> {
  const identity = `${input.name ?? ""} ${input.manager ?? ""}`;
  if (/\b(?:LFDE|Echiquier|Financi[eè]re de l['’ ]Echiquier)\b/i.test(identity)) {
    return await fetchLfdeOfficialSeries(input.isin);
  }
  return { ok:false, source:null, sourceUrl:null, currency:null, rows:[], reason:"NO_OFFICIAL_ADAPTER" };
}

function calendarAgeDays(date: string | null | undefined) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const quote = new Date(`${date}T00:00:00Z`).getTime();
  const today = new Date();
  const utcToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.floor((utcToday - quote) / 86400000));
}

async function fetchTradegate(isin: string) {
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


function parseShortEuropeanDate(value: string) {
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

function htmlTableCells(rowHtml: string) {
  const cells: string[] = [];
  for (const m of rowHtml.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)) {
    cells.push(decodeHtml(m[1]));
  }
  return cells;
}

async function fetchBoersennewsTradegateReference(isin: string) {
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


function marketScreenerAbsoluteUrl(base: string, href: string) {
  try { return new URL(href, base).toString(); } catch { return null; }
}

function parseMarketScreenerDate(segment: string) {
  const iso = segment.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const eu = segment.match(/\b(\d{2})[.\/-](\d{2})[.\/-](20\d{2})\b/);
  if (eu) return `${eu[3]}-${eu[2]}-${eu[1]}`;
  return null;
}

function isMarketScreenerInstrumentUrl(value: string) {
  try {
    const u = new URL(value);
    if (!/(^|\.)marketscreener\.com$/i.test(u.hostname)) return false;
    return /\/(?:quote|cotizacion|kurs|quotazioni|koers)\/(?:etf|stock)\//i.test(u.pathname);
  } catch { return false; }
}

function normalizeSearchHref(base: string, rawHref: string) {
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

async function parseMarketScreenerTradegatePage(sourceUrl: string, isin: string, headers: Record<string,string>) {
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

async function discoverMarketScreenerTradegatePage(isin: string, headers: Record<string,string>) {
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

async function fetchMarketScreenerTradegateClose(isin: string, cachedUrl: string | null = null) {
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


function proxyListingScore(target: any, candidate: any) {
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

function chooseProxyListing(target: any, listings: any[]) {
  const candidates = (listings || [])
    .filter((l: any) => l?.provider_symbol && String(l.provider_symbol).includes(".") && !isTradegateListing(l) && l.provider_symbol !== target?.provider_symbol)
    .map((l: any) => ({ listing: l, score: proxyListingScore(target, l) }))
    .filter((x: any) => x.score > -1e8)
    .sort((a: any, b: any) => b.score - a.score);
  return candidates[0]?.listing ?? null;
}

function daysBetween(a: string, b: string) {
  return Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86400000;
}

function nearestRowByDate(rows: any[], date: string, maxGapDays = 7) {
  let best: any = null;
  for (const row of rows || []) {
    if (!row?.price_date || !Number.isFinite(Number(row?.price))) continue;
    const gap = daysBetween(row.price_date, date);
    if (gap > maxGapDays) continue;
    if (!best || gap < best.gap || (gap === best.gap && row.price_date <= date && best.row.price_date > date)) best = { row, gap };
  }
  return best?.row ?? null;
}

function nearestFxByDate(rows: any[], date: string, maxGapDays = 5) {
  let best: any = null;
  for (const row of rows || []) {
    if (!row?.date || !Number.isFinite(Number(row?.price))) continue;
    const gap = daysBetween(row.date, date);
    if (gap > maxGapDays) continue;
    if (!best || gap < best.gap || (gap === best.gap && row.date <= date && best.row.date > date)) best = { row, gap };
  }
  return best?.row ?? null;
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
      const exact=await db(`listing_prices?provider_symbol=eq.${encodeURIComponent(symbol)}&is_approximate=eq.false&select=price_date,price,currency,source,fetched_at&order=price_date.asc&limit=2500`);
      const exactRows=Array.isArray(exact)?exact:[];
      const oldest=exactRows[0]?.price_date??null;
      const threshold=new Date();threshold.setUTCDate(threshold.getUTCDate()-330);
      const useful=oldest&&new Date(`${oldest}T00:00:00Z`)<=threshold;
      if((fullHistory&&!useful)||refreshRecent){
        const from=new Date();
        if(fullHistory&&!useful){from.setUTCFullYear(from.getUTCFullYear()-1);from.setUTCDate(from.getUTCDate()-7)}
        else from.setUTCDate(from.getUTCDate()-10);
        const fetched=await fetchEodSeries(symbol,from.toISOString().slice(0,10));
        if(!fetched.ok) return {ok:false,error:"EODHD_HISTORY_FAILED",status:fetched.status,details:fetched.details,rows:exactRows,fetched:false,inserted:0};
        const now=new Date().toISOString();
        const rows=fetched.rows.map((x:any)=>({provider_symbol:symbol,price_date:x.date,price:x.price,currency:listing.currency||null,source:"EODHD EOD API",fetched_at:now,is_approximate:false,proxy_symbol:null,calibration_factor:null,approximation_method:null,calibration_date:null}));
        for(let i=0;i<rows.length;i+=250) await db(`listing_prices?on_conflict=provider_symbol,price_date`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows.slice(i,i+250))});
        const all=await db(`listing_prices?provider_symbol=eq.${encodeURIComponent(symbol)}&is_approximate=eq.false&select=price_date,price,currency,source,fetched_at&order=price_date.asc&limit=2500`);
        return {ok:true,rows:Array.isArray(all)?all:rows,fetched:true,inserted:rows.length};
      }
      return {ok:true,rows:exactRows,fetched:false,inserted:0};
    }

    const existingRows = await db(`funds?isin=eq.${encodeURIComponent(isin)}&select=isin,name,manager,currency,theme,category,category_source,benchmark,data_provider,provider_symbol,instrument_type,metadata_source,metadata_fetched_at,category_fetched_at&limit=1`);
    const existing = Array.isArray(existingRows) ? existingRows[0] ?? null : null;
    let listings:any[] = await db(`instrument_listings?isin=eq.${encodeURIComponent(isin)}&select=provider_symbol,isin,ticker,exchange_code,exchange_name,currency,instrument_type,is_primary,source,fetched_at,valuation_source_url,valuation_source_name,valuation_source_checked_at&order=is_primary.desc,exchange_code.asc,ticker.asc`);
    if(!Array.isArray(listings)) listings=[];

    let searchResults:any[]=[];
    const wantsTradegateRefresh = refreshQuote && String(requestedListingSymbol||"").startsWith("TRADEGATE:");
    const needSearch = forceMetadata || wantsTradegateRefresh || !existing || !listings.some(l=>l.source === "EODHD Search API") || !existing?.name || existing?.name===isin;
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
    const name=String(selectedSearch?.Name ?? searchResults[0]?.Name ?? existing?.name ?? isin).trim();
    const masterCurrency=String(existing?.currency ?? searchResults[0]?.Currency ?? selectedListing?.currency ?? "EUR").toUpperCase();
    const nowIso=new Date().toISOString();

    let category=existing?.category??null, categorySource=existing?.category_source??null, manager=existing?.manager??null, benchmark=existing?.benchmark??null;
    let vdos:any={ok:false,sourceUrl:null,category:null,manager:null,benchmark:null,nav:null,navDate:null,navCurrency:null}; let finect:any={ok:false,sourceUrl:null,category:null,manager:null,benchmark:null};
    const needsGenericFundQuote=!requiresListing&&(includeHistory||refreshQuote);
    if(forceMetadata||!category||!manager||!benchmark||needsGenericFundQuote){
      vdos=await fetchVdos(isin); if(vdos.category){category=vdos.category;categorySource="VDOS/Quefondos"} if(!manager&&vdos.manager)manager=vdos.manager;if(!benchmark&&vdos.benchmark)benchmark=vdos.benchmark;
      if(!category||!manager||!benchmark){ finect=await fetchFinect(isin,name||isin); if(!category&&finect.category){category=finect.category;categorySource="Finect (datos Morningstar)"} if(!manager&&finect.manager)manager=finect.manager;if(!benchmark&&finect.benchmark)benchmark=finect.benchmark; }
    }

    const fundPayload:Record<string,unknown>={isin,name,currency:masterCurrency,data_provider:"EODHD",provider_symbol:requiresListing?null:(selectedListing?.provider_symbol??null),instrument_type:instrumentType,metadata_source:"EODHD Search API",metadata_fetched_at:nowIso,active:true};
    if(!existing)fundPayload.theme="Sin clasificar"; if(category){fundPayload.category=category;fundPayload.category_source=categorySource;fundPayload.category_fetched_at=nowIso} if(manager)fundPayload.manager=manager;if(benchmark)fundPayload.benchmark=benchmark;
    const upserted=await db(`funds?on_conflict=isin`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify(fundPayload)}); const fund=Array.isArray(upserted)?upserted[0]:upserted;

    let historyFetched=false,historyRowsInserted=0,historyReason:string|null=null;
    let historyApproximate=false, proxyInfo:any=null;
    const officialSeries:OfficialSeriesResult = (!requiresListing && (includeHistory || refreshQuote))
      ? await fetchOfficialFundSeries({ isin, name:fund?.name ?? name, manager:fund?.manager ?? manager })
      : { ok:false, source:null, sourceUrl:null, currency:null, rows:[], reason:"NOT_REQUESTED" };
    const officialRows = officialSeries.ok
      ? (includeHistory ? officialSeries.rows : officialSeries.rows.slice(0, 30))
      : [];
    const vdosQuote = Number(vdos?.nav)>0 && /^\d{4}-\d{2}-\d{2}$/.test(String(vdos?.navDate||""))
      ? { date:String(vdos.navDate), price:Number(vdos.nav), currency:String(vdos.navCurrency||masterCurrency).toUpperCase(), source:"VDOS/Quefondos · última valoración" }
      : null;

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

    return json({ok:true,isin,fund:{isin,name:fund?.name??name,manager:fund?.manager??manager??null,currency:fund?.currency??masterCurrency,category:fund?.category??category??null,category_source:fund?.category_source??categorySource??null,benchmark:fund?.benchmark??benchmark??null,provider:"EODHD",provider_symbol:requiresListing?null:(selectedListing?.provider_symbol??null),instrument_type:fund?.instrument_type??instrumentType??null,metadata_source:"EODHD Search API"},requires_listing:requiresListing,listings:listings.map((l:any)=>({provider_symbol:l.provider_symbol,ticker:l.ticker,exchange_code:l.exchange_code,exchange_name:l.exchange_name||exchangeDisplayName(l.exchange_code),currency:l.currency,instrument_type:l.instrument_type,is_primary:l.is_primary===true,source:l.source,valuation_source_name:l.valuation_source_name??null})),selected_listing:selectedListing?{provider_symbol:selectedListing.provider_symbol,ticker:selectedListing.ticker,exchange_code:selectedListing.exchange_code,exchange_name:selectedListing.exchange_name||exchangeDisplayName(selectedListing.exchange_code),currency:selectedListing.currency,source:selectedListing.source,valuation_source_name:selectedListing.valuation_source_name??null}:null,latest_nav:latest,quote_status:quoteStatus,history:{requested:includeHistory,fetched:historyFetched,rows_inserted:historyRowsInserted,reason:historyReason,approximate:historyApproximate,proxy:proxyInfo},sources:{identity_nav:latest?.source??(selectedListing&&String(selectedListing.provider_symbol).startsWith("TRADEGATE:")?"Tradegate Exchange":"EODHD"),official_nav_url:officialSeries.sourceUrl,category:fund?.category_source??categorySource??null,manager:vdos.manager?"VDOS/Quefondos":(finect.manager?"Finect":null),benchmark:vdos.benchmark?"VDOS/Quefondos":(finect.benchmark?"Finect (datos Morningstar)":null),vdos_url:vdos.sourceUrl,finect_url:finect.sourceUrl,tradegate_url:tradegate.sourceUrl??null,history_proxy:proxyInfo}});
  } catch(error){ console.error(error); return json({ok:false,error:"UNEXPECTED_ERROR",details:String(error)},500); }
});
