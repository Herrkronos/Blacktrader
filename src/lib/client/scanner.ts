"use client";
// Chancen-Scanner (geteilt von Übersicht, Chancen und Watchlist): Blacktrader rechnet die Zeiträume im Hintergrund
// und wählt GENAU EINEN aktuellen Einstieg pro Wert (blau / grün / rot / gelb). Shorts nur bei bärischem Gesamtmarkt, Aktien und Krypto ohne
// kurzfristige Signale, Rohstoffe kurzfristig nur bei bullischem Gesamtmarkt (S&P 500).
import { effectiveWeights, learnedParams, refreshTrainerParams } from "./trainerParams";
import { useSyncExternalStore } from "react";
import { analyze, type AnalysisResult } from "../analysis/analyze";
import { findLongTermZone, type LongTermZone } from "../analysis/longterm";
import { HORIZON_RANK, longTermOutcome, marketContext, pickBestEntry, type BestEntry, type HistEntry, type MarketContext } from "../analysis/bestEntry";
import { money } from "../analysis/persona";
import { applyPromotions } from "./promote";
import { refreshFx } from "./fx";
import { assetKey, closeEntry, doneFor, getHistory, recordEntry, type EntryHistory } from "./entries";
import { getData } from "../store/store";
import type { Candle, Horizon, ResolvedAsset } from "../types";
import { api } from "./api";
import { inUniverse, UNIVERSE_ASSETS } from "./presets";

export interface HorizonResult {
  res: AnalysisResult;
  candles: Candle[];
}

export interface ScanEntry {
  asset: ResolvedAsset;
  horizons: Partial<Record<Horizon, HorizonResult>>;
  /** Langfristiger Einstiegsbereich (blau), berechnet auf dem langfristigen (sonst mittelfristigen) Zeitraum */
  longterm: LongTermZone | null;
  ltHorizon?: Horizon;
  /** Kerzen, auf denen der Bereich berechnet wurde (zum Einzeichnen) */
  ltCandles?: Candle[];
  /** Der EINE aktuelle Einstieg (blau / grün / gelb) */
  best: BestEntry;
  /** Verlauf: aktueller + alte (graue) Einstiege */
  history: EntryHistory;
}

export interface ScanState {
  at: number | null;
  entries: ScanEntry[];
  busy: boolean;
  progress: number;
  checked: number;
  failed: number;
  /** Marktlage (S&P 500 / NASDAQ 100) */
  ctx: MarketContext;
}

let state: ScanState = { at: null, entries: [], busy: false, progress: 0, checked: 0, failed: 0, ctx: { spBull: null, techWeak: null } };
const listeners = new Set<() => void>();
const emit = (patch: Partial<ScanState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function useScan(): ScanState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

export function scanAssets(): ResolvedAsset[] {
  const map = new Map<string, ResolvedAsset>();
  const d = getData();
  // Offene Trades mitrechnen (für Hochstufung und nachgezogenen Stop)
  const fromTrades: ResolvedAsset[] = d.trades.filter((t) => t.status !== "closed").map((t) => ({ kind: t.kind, symbol: t.symbol, name: t.name, binanceSymbol: t.binanceSymbol, yahooSymbol: t.yahooSymbol }));
  // Alle Trainings-Werte (für die Chancen) + Watchlist (nur für die Watchlist) + offene Trades
  for (const a of [...d.watchlist, ...UNIVERSE_ASSETS, ...fromTrades]) if (!map.has(`${a.kind}:${a.symbol}`)) map.set(`${a.kind}:${a.symbol}`, a);
  return [...map.values()];
}

/** Startet die Suche (falls nicht schon aktiv). `maxAgeMs`: vorhandenes Ergebnis wiederverwenden, wenn jünger. */
export async function runScan(maxAgeMs = 15 * 60e3) {
  if (state.busy) return;
  if (state.at && Date.now() - state.at < maxAgeMs) return;
  const { settings } = getData();
  const assets = scanAssets();
  emit({ busy: true, progress: 0 });
  await Promise.race([refreshTrainerParams(), new Promise((r) => setTimeout(r, 3000))]);
  // Wechselkurse zuerst – alle Beträge werden in Euro angezeigt
  const [ctx] = await Promise.all([fetchMarketContext(), Promise.race([refreshFx(), new Promise((r) => setTimeout(r, 4000))])]);
  // Nur die Zeiträume, die ein Signal liefern dürfen oder für den blauen Bereich gebraucht werden
  const horizonsFor = (kind: ResolvedAsset["kind"]): Horizon[] => (["short", "medium", "long"] as Horizon[]).filter((h) => h !== "short" || (kind === "commodity" && ctx.spBull === true && HORIZON_RANK.commodity.includes("short")));
  const jobs = assets.flatMap((asset) => horizonsFor(asset.kind).map((horizon) => ({ asset, horizon })));
  const byAsset = new Map<string, Omit<ScanEntry, "best" | "history"> & { full: Partial<Record<Horizon, Candle[]>> }>();
  let done = 0;
  let failed = 0;
  await pool(jobs, 6, async ({ asset, horizon }) => {
    const key = assetKey(asset);
    const entry = byAsset.get(key) ?? { asset, horizons: {}, longterm: null, full: {} };
    byAsset.set(key, entry);
    try {
      const interval = settings.intervals[horizon];
      const { candles } = await api.candles(asset, interval, 60e3);
      const params = learnedParams(asset.kind, horizon);
      let res = analyze({ symbol: asset.symbol, name: asset.name, candles, horizon, interval, weights: effectiveWeights(settings, asset.kind, horizon), kind: asset.kind, currency: asset.currency, params });
      if (res && res.decision.level !== "neutral") {
        // Kandidat: mit Firmenzahlen und Nachrichten vollständig bewerten (gleiche Analyse wie bisher)
        const [f, n] = await Promise.allSettled([api.fundamentals(asset), api.news(asset)]);
        res = analyze({
          symbol: asset.symbol,
          name: asset.name,
          candles,
          horizon,
          interval,
          weights: effectiveWeights(settings, asset.kind, horizon),
          kind: asset.kind,
          currency: asset.currency,
          params,
          fundamentals: f.status === "fulfilled" ? f.value.fundamentals : null,
          news: n.status === "fulfilled" ? n.value.news : [],
        });
      }
      if (res) entry.horizons[horizon] = { res, candles: candles.slice(-150) };
      entry.full[horizon] = candles;
      // Langfristiger Einstieg: auf dem langfristigen Zeitraum, sonst auf dem mittelfristigen
      if ((horizon === "long" || (horizon === "medium" && entry.ltHorizon !== "long")) && candles.length >= 150) {
        const z = findLongTermZone(candles);
        if (z && z.status !== "invalidiert") {
          entry.longterm = z;
          entry.ltHorizon = horizon;
          entry.ltCandles = candles.slice(-150);
        }
      }
    } catch {
      failed++;
    }
    done++;
    emit({ progress: done / jobs.length });
  });
  const entries: ScanEntry[] = [...byAsset.values()].map(({ full, ...e }) => {
    const key = assetKey(e.asset);
    const cur = e.asset.currency;
    // Blauer Bereich schon erledigt (eingetaucht und oben heraus) oder ungültig? → grau, nicht mehr aktuell
    // (Liegt der Schlusskurs gerade wieder IM Bereich, bleibt er aktiv.)
    if (e.longterm) {
      const lc = full[e.ltHorizon ?? "long"] ?? [];
      const nowIn = (lc.at(-1)?.close ?? Infinity) <= e.longterm.zoneTop;
      const o = nowIn ? null : longTermOutcome(e.longterm, lc);
      if (o) closeEntry(key, o.entry, o.status, o.at);
    }
    const candlesOf = (h?: HistEntry) => (!h ? [] : h.color === "blau" ? full[e.ltHorizon ?? "long"] ?? [] : h.horizon ? full[h.horizon] ?? [] : []);
    const pick = () =>
      pickBestEntry({
        symbol: e.asset.symbol,
        kind: e.asset.kind,
        views: Object.fromEntries(Object.entries(e.horizons).map(([h, v]) => [h, v?.res ?? null])),
        lt: e.longterm,
        ctx,
        done: doneFor(key),
        fmt: (n) => money(n, cur),
      });
    let best = pick();
    let history = recordEntry(key, best, candlesOf(getHistory(key).current));
    // Ist der laufende Einstieg gerade erledigt/ungültig geworden, gleich den nächsten wählen
    if (history.current && doneFor(key).has(history.current.key)) {
      best = pick();
      history = recordEntry(key, best, []);
    }
    return { ...e, best, history };
  });
  emit({ busy: false, at: Date.now(), entries, checked: jobs.length, failed, ctx });
  try {
    applyPromotions(entries);
  } catch {
    /* Hochstufung beim nächsten Durchlauf */
  }
}

/** Marktlage aus den Tageskerzen von S&P 500 und NASDAQ 100 (nur Vergangenheit). */
async function fetchMarketContext(): Promise<MarketContext> {
  const idx = (yahooSymbol: string) => ({ kind: "stock" as const, symbol: yahooSymbol, name: yahooSymbol, yahooSymbol });
  const [sp, nd] = await Promise.allSettled([api.candles(idx("^GSPC"), "1d", 15 * 60e3), api.candles(idx("^NDX"), "1d", 15 * 60e3)]);
  return marketContext(sp.status === "fulfilled" ? sp.value.candles : null, nd.status === "fulfilled" ? nd.value.candles : null);
}

/** Signalart des aktuellen Einstiegs (Chancen-Filter: Alle · Blau · Grün · Rot) */
export type SignalKind = "blau" | "gruen" | "rot";

/** Abstand vom Kurs bis zur Oberkante des Langfrist-Bereichs in % (0 = im Bereich) */
export function longTermDistance(z: LongTermZone, price: number): number {
  return price <= z.zoneTop ? 0 : ((price - z.zoneTop) / price) * 100;
}

/** Abstand vom aktuellen Kurs bis zur Oberkante der Einstiegszone in % (0 = jetzt in der Zone) */
export function bestDistance(e: ScanEntry): number {
  const b = e.best;
  const price = lastPrice(e);
  if (b.zoneTop == null || b.zoneBottom == null || price == null) return 1000;
  // Short: Kurs muss bis zur Unterkante steigen
  if (b.color === "rot") return price >= b.zoneBottom ? 0 : ((b.zoneBottom - price) / price) * 100;
  return price <= b.zoneTop ? 0 : ((price - b.zoneTop) / price) * 100;
}

/** Gehört der Eintrag in die Chancen? (nur Trainings-Werte, nicht reine Watchlist-Werte) */
export const isChance = (e: ScanEntry) => inUniverse(e.asset);

/**
 * Gemessene Stärke je Signalart im Turnier (Ø Rendite pro Jahr, relativ zu Grün = 1):
 * Grün +22,7 %, Blau +5,8 %, Rot (nur bei bärischem Markt) schwächer – so steht nicht automatisch das höchste Ziel oben.
 */
const COLOR_WEIGHT = { gruen: 1, blau: 0.35, rot: 0.6 } as const;

/**
 * Potenzial eines Einstiegs (für die Rangliste der Chancen):
 * Chance bis zum Ziel in % (gedeckelt bei 60 %, damit „Mondziele“ nicht alles verdrängen), gewichtet mit
 * Chance/Risiko (gedeckelt bei 4), Signalstärke, Nähe zur Zone und der im Turnier gemessenen Stärke der Signalart.
 */
export function potential(e: ScanEntry): { score: number; chancePct: number; riskPct: number } | null {
  const b = e.best;
  if (b.color === "gelb" || b.zoneTop == null || b.zoneBottom == null || !b.targets?.length) return null;
  const short = b.color === "rot";
  const entry = short ? b.zoneBottom : b.zoneTop;
  const limit = b.color === "blau" ? b.invalidation : b.stop;
  if (!entry || limit == null) return null;
  const chancePct = (Math.abs(b.targets[0] - entry) / entry) * 100;
  const riskPct = Math.max(0.5, (Math.abs(entry - limit) / entry) * 100);
  const crv = Math.min(4, chancePct / riskPct);
  const strength = b.res ? (b.res.plan?.direction === "short" ? 100 - b.res.total : b.res.total) : 55;
  const dist = bestDistance(e);
  const near = dist === 0 ? 1 : Math.max(0.25, 1 - dist / 15);
  const weight = COLOR_WEIGHT[b.color as keyof typeof COLOR_WEIGHT] ?? 1;
  return { score: Math.min(60, chancePct) * (crv / 2) * (strength / 60) * near * weight, chancePct, riskPct };
}

/** Letzter bekannter Kurs eines Eintrags */
export function lastPrice(e: ScanEntry): number | undefined {
  for (const h of ["short", "medium", "long"] as Horizon[]) if (e.horizons[h]) return e.horizons[h]!.res.price;
  return e.ltCandles?.at(-1)?.close;
}

/** Abstand vom aktuellen Kurs bis zum Einstieg in % (0 = jetzt in der Zone) */
export function entryDistance(res: AnalysisResult): number {
  const p = res.plan;
  if (!p || p.orderType !== "limit") return 0;
  return (Math.abs(res.price - p.entry) / res.price) * 100;
}
