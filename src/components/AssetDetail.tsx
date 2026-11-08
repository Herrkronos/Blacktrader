"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { analyze } from "@/lib/analysis/analyze";
import { fmtPrice } from "@/lib/analysis/persona";
import { api } from "@/lib/client/api";
import { binanceStream } from "@/lib/client/binanceWs";
import { itemHorizon, useLive } from "@/lib/client/market";
import { actions, useAppData } from "@/lib/store/store";
import { HORIZON_INTERVALS, type Candle, type Fundamentals, type Interval, type NewsItem } from "@/lib/types";
import { Commentary, FundamentalsPanel, NewsPanel, SignalCard, VolumePanel, WavePanel } from "./AnalysisPanels";
import { PriceChart } from "./PriceChart";
import { TradeDialog } from "./TradeDialog";
import { Change, HorizonToggle, StatusDot } from "./ui";

export function AssetDetail() {
  const id = useSearchParams().get("id");
  const item = useAppData((d) => d.watchlist.find((w) => w.id === id));
  const settings = useAppData((d) => d.settings);
  const live = useLive(item);
  const horizon = item ? itemHorizon(item, settings.globalHorizon) : settings.globalHorizon;
  const [interval, setInterval_] = useState<Interval>(settings.intervals[horizon]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [source, setSource] = useState<string>("");
  const [fundamentals, setFundamentals] = useState<Fundamentals | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAlt, setShowAlt] = useState(true);
  const [trade, setTrade] = useState(false);

  useEffect(() => {
    if (!HORIZON_INTERVALS[horizon].includes(interval)) setInterval_(settings.intervals[horizon]);
  }, [horizon, interval, settings.intervals]);

  // Kerzen laden + periodisch aktualisieren
  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api.candles(item, interval, 15e3);
        if (cancelled) return;
        setCandles(r.candles);
        setSource(r.source);
        setError(null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    setLoading(true);
    load();
    const t = setInterval(load, interval === "5m" || interval === "15m" ? 60e3 : 300e3);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [item?.id, interval]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live-Kerze (Binance-Kline-Stream)
  useEffect(() => {
    if (!item?.binanceSymbol || !binanceStream || source !== "Binance") return;
    return binanceStream.subscribe(`${item.binanceSymbol}@kline_${interval}`, (m) => {
      const k = m.k as { t: number; o: string; h: string; l: string; c: string; v: string };
      const c: Candle = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v };
      setCandles((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (c.time === last.time) return [...prev.slice(0, -1), c];
        if (c.time > last.time) return [...prev, c];
        return prev;
      });
    });
  }, [item?.binanceSymbol, interval, source]);

  useEffect(() => {
    if (!item) return;
    api.fundamentals(item).then((r) => setFundamentals(r.fundamentals)).catch(() => setFundamentals(null));
    api.news(item).then((r) => setNews(r.news)).catch(() => setNews([]));
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live-Kurs in die letzte Kerze übernehmen (Aktien/Polling)
  const chartCandles = useMemo(() => {
    if (!live?.price || candles.length === 0 || source === "Binance") return candles;
    const last = candles[candles.length - 1];
    if (Math.abs(live.price - last.close) / last.close > 0.2) return candles;
    return [...candles.slice(0, -1), { ...last, close: live.price, high: Math.max(last.high, live.price), low: Math.min(last.low, live.price) }];
  }, [candles, live?.price, source]);

  const analysis = useMemo(
    () => (item && chartCandles.length >= 30 ? analyze({ symbol: item.symbol, name: item.name, candles: chartCandles, horizon, interval, fundamentals, news, weights: settings.weights, kind: item.kind, currency: live?.currency ?? item.currency }) : null),
    [item, chartCandles, horizon, interval, fundamentals, news, settings.weights, live?.currency],
  );

  if (!item)
    return (
      <div className="panel p-6 text-sm text-stone-400">
        Wert nicht in der Watchlist. <Link href="/" className="text-gold underline">Zurück</Link>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Link href="/" className="text-xs text-stone-400 hover:text-gold">← Watchlist</Link>
          <h1 className="text-2xl text-gold sm:text-3xl">
            {item.symbol} <span className="font-sans text-base font-normal text-stone-300">{item.name}</span>
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
            <span className="num text-xl text-stone-100">{live?.price != null ? fmtPrice(live.price) : analysis ? fmtPrice(analysis.price) : "–"}</span>
            <Change value={live?.changePct} />
            <StatusDot status={live?.status} title={live?.error ?? live?.source} />
            <span className="text-xs text-stone-500">
              {item.isin ? `${item.isin} · ` : ""}
              {item.exchange ?? ""} {source ? `· Kerzen: ${source}` : ""}
            </span>
          </div>
          {item.kind === "stock" && <p className="mt-1 text-xs text-amber-300/80">Aktienkurse per Polling (alle {settings.pollSeconds} s), je nach Börse verzögert.</p>}
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <HorizonToggle allowDefault value={item.horizon} onChange={(h) => actions.setItemHorizon(item.id, h)} />
          <div className="flex gap-1">
            {HORIZON_INTERVALS[horizon].map((iv) => (
              <button key={iv} onClick={() => setInterval_(iv)} className={`chip ${iv === interval ? "border-gold bg-gold/20 text-gold-light" : "border-stone-700 text-stone-400 hover:border-gold/50"}`}>
                {iv}
              </button>
            ))}
            <label className="ml-2 flex items-center gap-1 text-xs text-stone-400">
              <input type="checkbox" checked={showAlt} onChange={(e) => setShowAlt(e.target.checked)} className="accent-[#C9A24A]" />
              Alternative
            </label>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="panel p-2 lg:col-span-2">
          {error && <p className="p-3 text-sm text-red-400">Kursdaten nicht verfügbar: {error}</p>}
          {loading && candles.length === 0 && !error && <p className="p-3 text-sm text-stone-400">Lade Kerzen …</p>}
          {candles.length > 0 && <PriceChart candles={chartCandles} best={analysis?.elliott.best} alternative={analysis?.elliott.alternative} plan={analysis?.plan} showAlternative={showAlt} />}
          <p className="px-2 pb-1 text-[11px] text-stone-500">Gold = Primärzählung, gestrichelt = Alternative. Linien: Kursziele (gold), Retracements (grau), Invalidierung (rot). Unten: RSI(14).</p>
        </div>
        {analysis ? <SignalCard a={analysis} onTrade={() => setTrade(true)} /> : <div className="panel p-4 text-sm text-stone-400">{candles.length > 0 && candles.length < 30 ? "Zu wenig Historie für eine Analyse." : "Analyse wird berechnet …"}</div>}
      </div>

      {analysis && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Commentary a={analysis} item={item} />
            <WavePanel a={analysis} />
          </div>
          <div className="space-y-4">
            <VolumePanel a={analysis} />
            <FundamentalsPanel a={analysis} f={fundamentals} />
            <NewsPanel news={news} score={analysis.fundamental.newsScore} />
          </div>
        </div>
      )}
      {trade && analysis && <TradeDialog item={item} analysis={analysis} onClose={() => setTrade(false)} />}
    </div>
  );
}
