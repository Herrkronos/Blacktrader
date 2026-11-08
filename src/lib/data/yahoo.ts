// Yahoo Finance (inoffiziell, ohne Key). Kurse sind je nach Börse teils verzögert.
import "server-only";
import type { Candle, Interval, Quote, StockFundamentals } from "../types";
import { aggregateCandles } from "./aggregate";
import { cached, fetchJson, fetchRaw, UA, UpstreamError } from "./http";

const BASES = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];

const INTERVAL_MAP: Record<Interval, { interval: string; range: string; aggregate?: number }> = {
  "5m": { interval: "5m", range: "1mo" },
  "15m": { interval: "15m", range: "1mo" },
  "1h": { interval: "60m", range: "1y" },
  "4h": { interval: "60m", range: "2y", aggregate: 4 * 3600 },
  "1d": { interval: "1d", range: "5y" },
  "1w": { interval: "1wk", range: "10y" },
  "1M": { interval: "1mo", range: "max" },
};

interface ChartResponse {
  chart: {
    result?: {
      meta: {
        symbol: string;
        currency?: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        regularMarketTime?: number;
        longName?: string;
        shortName?: string;
        exchangeName?: string;
        fullExchangeName?: string;
        instrumentType?: string;
      };
      timestamp?: number[];
      indicators: { quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[] };
    }[];
    error?: { description?: string } | null;
  };
}

async function chart(symbol: string, interval: string, range: string): Promise<ChartResponse> {
  let lastErr: unknown;
  for (const base of BASES) {
    try {
      const url = `${base}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false&events=div%2Csplit`;
      const data = await fetchJson<ChartResponse>(url);
      if (data.chart.error) throw new UpstreamError(`Yahoo: ${data.chart.error.description ?? "Fehler"}`, 404);
      return data;
    } catch (e) {
      lastErr = e;
      if (e instanceof UpstreamError && e.status === 404) throw e;
    }
  }
  throw lastErr;
}

export async function yahooCandles(symbol: string, iv: Interval): Promise<Candle[]> {
  const m = INTERVAL_MAP[iv];
  const ttl = iv === "5m" ? 30e3 : iv === "15m" ? 60e3 : iv === "1h" || iv === "4h" ? 120e3 : iv === "1d" ? 300e3 : 3600e3;
  return cached(`yc:${symbol}:${iv}`, ttl, async () => {
    const data = await chart(symbol, m.interval, m.range);
    const r = data.chart.result?.[0];
    if (!r?.timestamp) throw new UpstreamError("Yahoo: keine Kursdaten", 404);
    const q = r.indicators.quote[0];
    const out: Candle[] = [];
    r.timestamp.forEach((t, i) => {
      const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
      if (o == null || h == null || l == null || c == null) return;
      out.push({ time: t, open: o, high: h, low: l, close: c, volume: q.volume[i] ?? 0 });
    });
    return m.aggregate ? aggregateCandles(out, m.aggregate) : out;
  });
}

export interface YahooMeta {
  symbol: string;
  name: string;
  currency?: string;
  exchange?: string;
  instrumentType?: string;
}

export async function yahooQuote(symbol: string): Promise<Quote & { meta: YahooMeta }> {
  return cached(`yq:${symbol}`, 10e3, async () => {
    const data = await chart(symbol, "5m", "1d");
    const r = data.chart.result?.[0];
    if (!r || r.meta.regularMarketPrice == null) throw new UpstreamError("Yahoo: kein Kurs", 404);
    const m = r.meta;
    const prev = m.previousClose ?? m.chartPreviousClose ?? m.regularMarketPrice!;
    const time = m.regularMarketTime ?? Math.floor(Date.now() / 1000);
    return {
      symbol,
      price: m.regularMarketPrice!,
      changePct: prev ? ((m.regularMarketPrice! - prev) / prev) * 100 : 0,
      currency: m.currency,
      time,
      // Yahoo liefert für viele Börsen 15+ Minuten verzögerte Kurse; Krypto ist nahezu Echtzeit.
      delayed: m.instrumentType !== "CRYPTOCURRENCY" || Date.now() / 1000 - time > 120,
      source: "Yahoo Finance",
      meta: {
        symbol: m.symbol,
        name: m.longName ?? m.shortName ?? m.symbol,
        currency: m.currency,
        exchange: m.fullExchangeName ?? m.exchangeName,
        instrumentType: m.instrumentType,
      },
    };
  });
}

export interface YahooSearchQuote {
  symbol: string;
  shortname?: string;
  longname?: string;
  exchange?: string;
  exchDisp?: string;
  quoteType?: string;
}

export async function yahooSearch(q: string): Promise<YahooSearchQuote[]> {
  return cached(`ys:${q.toUpperCase()}`, 3600e3, async () => {
    const data = await fetchJson<{ quotes?: YahooSearchQuote[] }>(
      `${BASES[1]}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0&enableFuzzyQuery=false`,
    );
    return (data.quotes ?? []).filter((x) => x.symbol && ["EQUITY", "ETF", "CRYPTOCURRENCY", "INDEX", "MUTUALFUND", "FUTURE", "CURRENCY"].includes(x.quoteType ?? ""));
  });
}

// --- Fundamentaldaten über quoteSummary (benötigt Cookie + Crumb)
let crumbCache: { cookie: string; crumb: string; expires: number } | null = null;

async function getCrumb(): Promise<{ cookie: string; crumb: string }> {
  if (crumbCache && crumbCache.expires > Date.now()) return crumbCache;
  const r1 = await fetchRaw("https://fc.yahoo.com", { headers: { "User-Agent": UA } });
  const setCookies = typeof r1.headers.getSetCookie === "function" ? r1.headers.getSetCookie() : [r1.headers.get("set-cookie") ?? ""];
  const cookie = setCookies.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  if (!cookie) throw new UpstreamError("Yahoo: kein Cookie erhalten");
  const r2 = await fetchRaw(`${BASES[1]}/v1/test/getcrumb`, { headers: { Cookie: cookie } });
  const crumb = (await r2.text()).trim();
  if (!r2.ok || !crumb || crumb.includes("<")) throw new UpstreamError("Yahoo: kein Crumb erhalten");
  crumbCache = { cookie, crumb, expires: Date.now() + 30 * 60e3 };
  return crumbCache;
}

type Raw = { raw?: number } | undefined;
const v = (x: Raw) => (x && typeof x.raw === "number" && Number.isFinite(x.raw) ? x.raw : undefined);

export async function yahooFundamentals(symbol: string): Promise<StockFundamentals> {
  return cached(`yf:${symbol}`, 6 * 3600e3, async () => {
    const { cookie, crumb } = await getCrumb();
    const modules = "summaryDetail,defaultKeyStatistics,financialData,calendarEvents,price";
    const data = await fetchJson<{
      quoteSummary: { result?: Record<string, Record<string, unknown>>[]; error?: unknown };
    }>(`${BASES[1]}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`, {
      headers: { Cookie: cookie },
    });
    const r = data.quoteSummary.result?.[0];
    if (!r) throw new UpstreamError("Yahoo: keine Fundamentaldaten", 404);
    const sd = (r.summaryDetail ?? {}) as Record<string, Raw>;
    const ks = (r.defaultKeyStatistics ?? {}) as Record<string, Raw>;
    const fd = (r.financialData ?? {}) as Record<string, Raw>;
    const ce = (r.calendarEvents ?? {}) as { earnings?: { earningsDate?: { raw?: number }[] } };
    const pr = (r.price ?? {}) as Record<string, Raw> & { currency?: string };
    const earn = ce.earnings?.earningsDate?.[0]?.raw;
    return {
      kind: "stock",
      pe: v(sd.trailingPE) ?? v(sd.forwardPE),
      ps: v(sd.priceToSalesTrailing12Months),
      pb: v(ks.priceToBook),
      epsGrowth: v(fd.earningsGrowth) ?? v(ks.earningsQuarterlyGrowth),
      revenueGrowth: v(fd.revenueGrowth),
      profitMargin: v(fd.profitMargins) ?? v(ks.profitMargins),
      debtToEquity: v(fd.debtToEquity),
      freeCashflow: v(fd.freeCashflow),
      marketCap: v(sd.marketCap) ?? v(pr.marketCap),
      dividendYield: v(sd.dividendYield) ?? v(sd.trailingAnnualDividendYield),
      nextEarnings: earn ? new Date(earn * 1000).toISOString() : undefined,
      currency: pr.currency,
      source: "Yahoo Finance",
    };
  });
}
