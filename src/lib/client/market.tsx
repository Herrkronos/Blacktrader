"use client";
// Zentrale Echtzeit-Überwachung: Live-Kurse (Binance-WebSocket bzw. Polling), Analysen der Watchlist,
// Signal-Alarme und automatische Verfolgung offener Papier-Trades.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { analyze, type AnalysisResult } from "../analysis/analyze";
import { SIGNAL_LABEL } from "../analysis/score";
import { tradeReturnPct } from "../analysis/stats";
import { fmtPrice } from "../analysis/persona";
import { actions, getData, useAppData, type Trade, type WatchItem } from "../store/store";
import type { Candle, Fundamentals, Horizon, Interval, NewsItem, ResolvedAsset } from "../types";
import { notify } from "./alerts";
import { api } from "./api";
import { binanceStream } from "./binanceWs";

export type LiveStatus = "live" | "delayed" | "offline" | "loading";

export interface LiveState {
  price?: number;
  changePct?: number;
  currency?: string;
  time?: number;
  status: LiveStatus;
  source?: string;
  error?: string;
  updated?: number;
}

export interface ItemAnalysis {
  horizon: Horizon;
  interval: Interval;
  result: AnalysisResult | null;
  candles: Candle[];
  fundamentals: Fundamentals | null;
  news: NewsItem[];
  candleSource?: string;
  error?: string;
  loading: boolean;
}

type Instrument = Pick<ResolvedAsset, "kind" | "symbol" | "name" | "binanceSymbol" | "yahooSymbol" | "coingeckoId">;

export const instrumentKey = (a: Pick<ResolvedAsset, "kind" | "symbol">) => `${a.kind}:${a.symbol}`;

interface Ctx {
  live: Record<string, LiveState>;
  analyses: Record<string, ItemAnalysis>;
  refresh: (id?: string) => void;
}

const MarketContext = createContext<Ctx>({ live: {}, analyses: {}, refresh: () => {} });

export const useMarket = () => useContext(MarketContext);
export const useLive = (a?: Pick<ResolvedAsset, "kind" | "symbol">) => useContext(MarketContext).live[a ? instrumentKey(a) : ""] as LiveState | undefined;

const candleRefreshMs = (iv: Interval) => (iv === "5m" ? 60e3 : iv === "15m" ? 120e3 : iv === "1h" ? 300e3 : iv === "4h" ? 600e3 : 1800e3);

export function itemHorizon(item: WatchItem, global: Horizon): Horizon {
  return item.horizon ?? global;
}

export function MarketProvider({ children }: { children: ReactNode }) {
  const watchlist = useAppData((d) => d.watchlist);
  const openTrades = useAppData((d) => d.trades.filter((t) => t.status === "open"));
  const settings = useAppData((d) => d.settings);
  const [live, setLive] = useState<Record<string, LiveState>>({});
  const [analyses, setAnalyses] = useState<Record<string, ItemAnalysis>>({});
  const [reloadTick, setReloadTick] = useState(0);
  const liveRef = useRef(live);
  liveRef.current = live;

  // Alle zu überwachenden Instrumente: Watchlist + offene Trades
  const instruments = useMemo(() => {
    const map = new Map<string, Instrument>();
    for (const w of watchlist) map.set(instrumentKey(w), w);
    for (const t of openTrades) if (!map.has(instrumentKey(t))) map.set(instrumentKey(t), { kind: t.kind, symbol: t.symbol, name: t.name, binanceSymbol: t.binanceSymbol, yahooSymbol: t.yahooSymbol });
    return [...map.values()];
  }, [watchlist, openTrades]);
  const instrumentsKey = instruments.map((i) => `${instrumentKey(i)}|${i.binanceSymbol ?? ""}|${i.yahooSymbol ?? ""}`).join(",");

  // ---- Live-Kurse
  useEffect(() => {
    const cleanups: (() => void)[] = [];
    const pollMs = settings.pollSeconds * 1000;
    const set = (key: string, patch: Partial<LiveState>) =>
      setLive((prev) => ({ ...prev, [key]: { ...(prev[key] ?? { status: "loading" }), ...patch } }));

    for (const inst of instruments) {
      const key = instrumentKey(inst);
      let lastWs = 0;
      const poll = async () => {
        // Bei aktivem WebSocket kein Polling nötig
        if (inst.binanceSymbol && Date.now() - lastWs < 30e3) return;
        try {
          const q = await api.quote(inst);
          set(key, { price: q.price, changePct: q.changePct, currency: q.currency, time: q.time, status: q.delayed ? "delayed" : "live", source: q.source, error: undefined, updated: Date.now() });
        } catch (e) {
          const prev = liveRef.current[key];
          const stale = !prev?.updated || Date.now() - prev.updated > pollMs * 3;
          set(key, { status: stale ? "offline" : prev?.status ?? "offline", error: (e as Error).message });
        }
      };
      poll();
      const t = setInterval(poll, inst.binanceSymbol ? Math.max(pollMs, 20e3) : pollMs);
      cleanups.push(() => clearInterval(t));
      if (inst.binanceSymbol && binanceStream) {
        cleanups.push(
          binanceStream.subscribe(`${inst.binanceSymbol}@miniTicker`, (m) => {
            lastWs = Date.now();
            const c = Number(m.c);
            const o = Number(m.o);
            set(key, { price: c, changePct: o ? ((c - o) / o) * 100 : 0, currency: "USDT", time: Math.floor(Number(m.E) / 1000), status: "live", source: "Binance WebSocket", error: undefined, updated: Date.now() });
          }),
        );
      }
    }
    // Veraltete Werte als offline markieren
    const staleTimer = setInterval(() => {
      const now = Date.now();
      setLive((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [k, v] of Object.entries(prev)) {
          if (v.updated && now - v.updated > Math.max(pollMs * 3, 90e3) && v.status !== "offline") {
            next[k] = { ...v, status: "offline" };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 15e3);
    cleanups.push(() => clearInterval(staleTimer));
    return () => cleanups.forEach((c) => c());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrumentsKey, settings.pollSeconds]);

  // ---- Rohdaten für Analysen (Kerzen, Fundamentaldaten, News)
  const raw = useRef<Record<string, { candles: Candle[]; fundamentals: Fundamentals | null; news: NewsItem[]; source?: string; error?: string; version: number; horizon: Horizon; interval: Interval }>>({});
  const [dataVersion, setDataVersion] = useState(0);
  const watchKey = watchlist.map((w) => `${w.id}:${itemHorizon(w, settings.globalHorizon)}:${settings.intervals[itemHorizon(w, settings.globalHorizon)]}`).join(",");

  useEffect(() => {
    const timers: ReturnType<typeof setInterval>[] = [];
    let cancelled = false;
    const ids = new Set(watchlist.map((w) => w.id));
    for (const k of Object.keys(raw.current)) if (!ids.has(k)) delete raw.current[k];
    setAnalyses((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => ids.has(k))));

    for (const item of watchlist) {
      const horizon = itemHorizon(item, settings.globalHorizon);
      const interval = settings.intervals[horizon];
      const loadCandles = async () => {
        try {
          const r = await api.candles(item, interval, candleRefreshMs(interval) / 2);
          if (cancelled) return;
          raw.current[item.id] = { ...(raw.current[item.id] ?? { fundamentals: null, news: [] }), candles: r.candles, source: r.source, error: undefined, version: Date.now(), horizon, interval };
        } catch (e) {
          if (cancelled) return;
          raw.current[item.id] = { ...(raw.current[item.id] ?? { fundamentals: null, news: [], candles: [] }), error: (e as Error).message, version: Date.now(), horizon, interval } as never;
        }
        setDataVersion((v) => v + 1);
      };
      const loadExtras = async () => {
        const [f, n] = await Promise.allSettled([api.fundamentals(item), api.news(item)]);
        if (cancelled) return;
        const cur = raw.current[item.id] ?? { candles: [], version: 0, horizon, interval, fundamentals: null, news: [] };
        raw.current[item.id] = {
          ...cur,
          fundamentals: f.status === "fulfilled" ? f.value.fundamentals : cur.fundamentals,
          news: n.status === "fulfilled" ? n.value.news : cur.news,
          version: Date.now(),
        };
        setDataVersion((v) => v + 1);
      };
      setAnalyses((prev) => ({ ...prev, [item.id]: { ...(prev[item.id] ?? { result: null, candles: [], fundamentals: null, news: [] }), horizon, interval, loading: true } }));
      loadCandles();
      loadExtras();
      timers.push(setInterval(loadCandles, candleRefreshMs(interval)));
      timers.push(setInterval(loadExtras, 20 * 60e3));
    }
    return () => {
      cancelled = true;
      timers.forEach(clearInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey, reloadTick]);

  // ---- Analyse-Takt: berechnet bei neuen Daten/Kursen neu (max. alle 5 s), Alarme + Trade-Verfolgung
  const lastCalc = useRef<Record<string, { version: number; price?: number; at: number }>>({});
  useEffect(() => {
    const run = () => {
      const d = getData();
      const next: Record<string, ItemAnalysis> = {};
      for (const item of d.watchlist) {
        const r = raw.current[item.id];
        if (!r) continue;
        const lv = liveRef.current[instrumentKey(item)];
        const prev = lastCalc.current[item.id];
        const priceMoved = lv?.price && prev?.price ? Math.abs(lv.price - prev.price) / prev.price > 0.0005 : lv?.price !== prev?.price;
        if (prev && prev.version === r.version && !priceMoved) continue;
        if (prev && Date.now() - prev.at < 5000 && prev.version === r.version) continue;
        lastCalc.current[item.id] = { version: r.version, price: lv?.price, at: Date.now() };
        const result =
          r.candles.length >= 30
            ? analyze({ symbol: item.symbol, name: item.name, candles: r.candles, horizon: r.horizon, interval: r.interval, fundamentals: r.fundamentals, news: r.news, weights: d.settings.weights, livePrice: lv?.price, kind: item.kind, currency: lv?.currency ?? item.currency })
            : null;
        next[item.id] = { horizon: r.horizon, interval: r.interval, result, candles: r.candles, fundamentals: r.fundamentals, news: r.news, candleSource: r.source, error: r.error ?? (r.candles.length < 30 && r.candles.length > 0 ? "Zu wenig Historie für eine Analyse" : undefined), loading: false };
        if (result) checkSignal(item, r.horizon, result);
      }
      if (Object.keys(next).length) setAnalyses((p) => ({ ...p, ...next }));
      trackTrades(d.trades, liveRef.current);
    };
    run();
    const t = setInterval(run, 5000);
    return () => clearInterval(t);
  }, [dataVersion, settings.weights]);

  const refresh = (id?: string) => {
    if (id) delete lastCalc.current[id];
    else lastCalc.current = {};
    setReloadTick((x) => x + 1);
  };

  return <MarketContext.Provider value={{ live, analyses, refresh }}>{children}</MarketContext.Provider>;
}

function checkSignal(item: WatchItem, horizon: Horizon, res: AnalysisResult) {
  const d = getData();
  const key = `${item.id}:${horizon}`;
  const prev = d.signals[key];
  const level = res.decision.level;
  if (prev?.level === level) return;
  actions.setSignal(key, level);
  if (!prev || level === "neutral") return; // erstes Signal bzw. Rückfall auf neutral: kein Alarm
  const buy = level.includes("buy");
  notify(
    `${SIGNAL_LABEL[level]}: ${item.symbol}`,
    `${res.commentary.summary}. ${res.commentary.reason}`,
    { sound: d.settings.sound, notifications: d.settings.notifications, kind: buy ? "buy" : "sell" },
  );
}

const lastTradeWrite: Record<string, number> = {};

function trackTrades(trades: Trade[], live: Record<string, LiveState>) {
  const s = getData().settings;
  for (const t of trades) {
    if (t.status !== "open") continue;
    const lv = live[instrumentKey(t)];
    if (!lv?.price || lv.status === "offline") continue;
    const price = lv.price;
    const dir = t.direction === "long" ? 1 : -1;
    const sortedTargets = [...t.targets].sort((a, b) => (a - b) * dir);
    const target = s.closeAtTarget === "last" ? sortedTargets[sortedTargets.length - 1] : sortedTargets[0];
    let closeReason: Trade["closeReason"] | null = null;
    let exit = price;
    if ((price - t.stop) * dir <= 0) {
      closeReason = "stop";
      exit = price;
    } else if (target != null && (price - target) * dir >= 0) {
      closeReason = "target";
      exit = price;
    }
    if (closeReason) {
      const returnPct = tradeReturnPct(t.direction, t.entry, exit);
      actions.updateTrade(t.id, { status: "closed", exit, closedAt: Date.now(), closeReason, returnPct, lastPrice: price });
      notify(
        `Trade geschlossen: ${t.symbol}`,
        `${closeReason === "target" ? "Kursziel erreicht" : "Stop-Loss ausgelöst"} bei ${fmtPrice(exit)} · ${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(2)} %`,
        { sound: s.sound, notifications: s.notifications, kind: closeReason === "target" ? "buy" : "sell" },
      );
    } else if (!lastTradeWrite[t.id] || Date.now() - lastTradeWrite[t.id] > 30e3) {
      lastTradeWrite[t.id] = Date.now();
      if (t.lastPrice !== price) actions.updateTrade(t.id, { lastPrice: price });
    }
  }
}
