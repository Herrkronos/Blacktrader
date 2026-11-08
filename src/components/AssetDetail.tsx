"use client";
// Detailansicht eines Werts (als Bottom-Sheet oder eigene Seite): großer Chart mit Wellenzählung und
// Fibo-Zonen, Signal mit Teil-Scores, Kernposition, Begründung, Fundamentalzahlen, News.
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { analyze } from "@/lib/analysis/analyze";
import { coreStatus } from "@/lib/analysis/core";
import { money } from "@/lib/analysis/persona";
import { api } from "@/lib/client/api";
import { binanceStream } from "@/lib/client/binanceWs";
import { useLive } from "@/lib/client/market";
import { SCAN_PRESETS } from "@/lib/client/presets";
import { actions, useAppData } from "@/lib/store/store";
import { HORIZON_INTERVALS, HORIZON_LABEL, type Candle, type Fundamentals, type Horizon, type Interval, type NewsItem, type ResolvedAsset } from "@/lib/types";
import { Commentary, CoreCard, FundamentalsPanel, NewsPanel, SignalCard, VolumePanel, WavePanel } from "./AnalysisPanels";
import { PriceChart } from "./PriceChart";
import { StatusPill } from "./StatusPill";
import { TradeDialog } from "./TradeDialog";

type DetailAsset = ResolvedAsset & { id?: string };
const HORIZONS: Horizon[] = ["short", "medium", "long"];

export function AssetDetailView({ asset, initialHorizon }: { asset: DetailAsset; initialHorizon?: Horizon }) {
  const settings = useAppData((d) => d.settings);
  const live = useLive(asset);
  const [horizon, setHorizon] = useState<Horizon>(initialHorizon ?? settings.globalHorizon);
  const [interval, setInterval_] = useState<Interval>(settings.intervals[initialHorizon ?? settings.globalHorizon]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [source, setSource] = useState("");
  const [fundamentals, setFundamentals] = useState<Fundamentals | null>(null);
  const [fundNote, setFundNote] = useState<string | undefined>();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [trade, setTrade] = useState(false);
  const touch = useRef<number | null>(null);

  useEffect(() => {
    if (!HORIZON_INTERVALS[horizon].includes(interval)) setInterval_(settings.intervals[horizon]);
  }, [horizon, interval, settings.intervals]);

  // Kerzen laden + periodisch aktualisieren
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api.candles(asset, interval, 15e3);
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
  }, [asset.symbol, asset.kind, interval]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live-Kerze (Binance)
  useEffect(() => {
    if (!asset.binanceSymbol || !binanceStream || source !== "Binance") return;
    return binanceStream.subscribe(`${asset.binanceSymbol}@kline_${interval}`, (m) => {
      const k = m.k as { t: number; o: string; h: string; l: string; c: string; v: string };
      const c: Candle = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v };
      setCandles((prev) => {
        if (!prev.length) return prev;
        const last = prev[prev.length - 1];
        if (c.time === last.time) return [...prev.slice(0, -1), c];
        if (c.time > last.time) return [...prev, c];
        return prev;
      });
    });
  }, [asset.binanceSymbol, interval, source]);

  useEffect(() => {
    api
      .fundamentals(asset)
      .then((r) => {
        setFundamentals(r.fundamentals);
        setFundNote(r.note);
      })
      .catch((e) => {
        setFundamentals(null);
        setFundNote((e as Error).message);
      });
    api.news(asset).then((r) => setNews(r.news)).catch(() => setNews([]));
  }, [asset.symbol, asset.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const chartCandles = useMemo(() => {
    if (!live?.price || candles.length === 0 || source === "Binance") return candles;
    const last = candles[candles.length - 1];
    if (Math.abs(live.price - last.close) / last.close > 0.2) return candles;
    return [...candles.slice(0, -1), { ...last, close: live.price, high: Math.max(last.high, live.price), low: Math.min(last.low, live.price) }];
  }, [candles, live?.price, source]);

  const core = useMemo(() => (candles.length >= 120 ? coreStatus(candles) : null), [candles]);
  const currency = live?.currency ?? asset.currency;
  const analysis = useMemo(
    () =>
      chartCandles.length >= 30
        ? analyze({ symbol: asset.symbol, name: asset.name, candles: chartCandles, horizon, interval, fundamentals, news, weights: settings.weights, kind: asset.kind, currency })
        : null,
    [asset.symbol, asset.name, asset.kind, chartCandles, horizon, interval, fundamentals, news, settings.weights, currency],
  );

  const changeHorizon = (h: Horizon) => {
    setHorizon(h);
    setInterval_(settings.intervals[h]);
    if (asset.id) actions.setItemHorizon(asset.id, h);
  };

  return (
    <div
      className="space-y-4"
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current == null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        const i = HORIZONS.indexOf(horizon);
        if (Math.abs(dx) > 80 && (e.target as HTMLElement).closest("canvas") == null) {
          const next = dx < 0 ? HORIZONS[i + 1] : HORIZONS[i - 1];
          if (next) changeHorizon(next);
        }
        touch.current = null;
      }}
    >
      <div className="ls-hide flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] text-stone-400">
            {asset.symbol}
            {asset.isin ? ` · ${asset.isin}` : ""}
            {asset.exchange ? ` · ${asset.exchange}` : ""}
          </div>
          <div className="num text-[24px] font-semibold text-stone-50">{live?.price != null ? money(live.price, currency) : analysis ? money(analysis.price, currency) : "–"}</div>
          <div className="flex items-center gap-2">
            {live?.changePct != null && <span className={`num text-[15px] ${live.changePct >= 0 ? "text-up" : "text-down"}`}>{`${live.changePct >= 0 ? "+" : ""}${live.changePct.toFixed(2).replace(".", ",")} %`}</span>}
            <StatusPill status={live?.status} source={live?.source ?? source} />
          </div>
        </div>
      </div>

      <div className="ls-row space-y-3">
      <div className="seg w-full" role="tablist" aria-label="Zeitraum">
        {HORIZONS.map((h) => (
          <button key={h} aria-pressed={h === horizon} onClick={() => changeHorizon(h)} className="flex-1">
            {HORIZON_LABEL[h]}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5">
        {HORIZON_INTERVALS[horizon].map((iv) => (
          <button key={iv} onClick={() => setInterval_(iv)} className={`chip ${iv === interval ? "border-gold bg-gold/15 text-gold-light" : "border-white/15 text-stone-300"}`}>
            {iv}
          </button>
        ))}
      </div>
      </div>

      <div className="card chart-wrap overflow-hidden p-1">
        {error && <p className="p-3 text-[15px] text-red-300">Kursdaten nicht verfügbar: {error}</p>}
        {loading && candles.length === 0 && !error && <p className="p-3 text-[15px] text-stone-400">Lade Kerzen …</p>}
        {candles.length > 0 && (
          <PriceChart
            candles={chartCandles}
            best={analysis?.elliott.best}
            alternative={analysis?.elliott.alternative}
            plan={analysis?.decision.level !== "neutral" ? analysis?.plan : null}
            showAlternative={false}
            simple={false}
            height={typeof window !== "undefined" && window.matchMedia("(orientation: landscape) and (max-height: 500px)").matches ? Math.max(240, window.innerHeight - 110) : 360}
            coreEntry={core?.state === "hold" ? core.last?.price : undefined}
          />
        )}
        <p className="px-2 pb-1.5 text-[13px] text-stone-400">Gold: Wellenzählung · Grün: Einstieg/Ziele · Rot: Stop · Blau: Kernposition. Zoomen mit zwei Fingern, Antippen zeigt den Kurs.</p>
      </div>

      {analysis ? (
        <>
          <SignalCard a={analysis} onTrade={() => setTrade(true)} />
          <CoreCard core={core} currency={currency} />
          <Commentary a={analysis} item={asset} />
          <FundamentalsPanel a={analysis} f={fundamentals} note={fundNote} kind={asset.kind} />
          <NewsPanel news={news} score={analysis.fundamental.newsScore} />
          <details className="card p-4">
            <summary className="cursor-pointer text-[15px] font-medium text-gold-light">Wellenzählung im Detail</summary>
            <div className="mt-3">
              <WavePanel a={analysis} />
            </div>
          </details>
          <details className="card p-4">
            <summary className="cursor-pointer text-[15px] font-medium text-gold-light">Volumen & RSI im Detail</summary>
            <div className="mt-3">
              <VolumePanel a={analysis} />
            </div>
          </details>
        </>
      ) : (
        <div className="card p-4 text-[15px] text-stone-400">{candles.length > 0 && candles.length < 30 ? "Zu wenig Historie für eine Analyse." : "Analyse wird berechnet …"}</div>
      )}
      {trade && analysis && <TradeDialog item={{ ...asset, id: asset.id ?? "detail", addedAt: 0 }} analysis={analysis} onClose={() => setTrade(false)} />}
    </div>
  );
}

/** Eigene Seite /analyse?id=… (Watchlist) bzw. ?sym=…&kind=… (Chancen) – z. B. für Links aus Benachrichtigungen. */
export function AssetDetail() {
  const params = useSearchParams();
  const id = params.get("id");
  const sym = params.get("sym");
  const kind = params.get("kind");
  const watch = useAppData((d) => d.watchlist);
  const asset = (id ? watch.find((w) => w.id === id) : undefined) ?? watch.find((w) => w.symbol === sym && w.kind === kind) ?? SCAN_PRESETS.find((p) => p.symbol === sym && p.kind === kind);
  if (!asset) return <div className="card p-6 text-[15px] text-stone-400">Wert nicht gefunden.</div>;
  return (
    <div className="space-y-3">
      <h1 className="text-[22px] text-gold">{asset.name}</h1>
      <AssetDetailView asset={asset} initialHorizon={"horizon" in asset ? (asset as { horizon?: Horizon }).horizon : undefined} />
    </div>
  );
}
