"use client";
// Chancen-Scanner: durchsucht bekannte Aktien und Coins in allen drei Zeithorizonten nach Einstiegssignalen.
import { useEffect, useState } from "react";
import { TradeDialog } from "@/components/TradeDialog";
import { SignalBadge } from "@/components/ui";
import { analyze, type AnalysisResult } from "@/lib/analysis/analyze";
import { api } from "@/lib/client/api";
import { hasOpenTrade, openPaperTrade } from "@/lib/client/autotrade";
import { SCAN_PRESETS } from "@/lib/client/presets";
import { actions, getData, useAppData, type WatchItem } from "@/lib/store/store";
import { HORIZON_LABEL, type Horizon, type ResolvedAsset } from "@/lib/types";

interface Hit {
  asset: ResolvedAsset;
  res: AnalysisResult;
}

// Ergebnis bleibt beim Seitenwechsel erhalten
let lastScan: { at: number; hits: Hit[]; checked: number; failed: number } | null = null;

async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

export default function ChancenPage() {
  const watchlist = useAppData((d) => d.watchlist);
  const trades = useAppData((d) => d.trades);
  const [scan, setScan] = useState(lastScan);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [horizonFilter, setHorizonFilter] = useState<Horizon | "all">("all");
  const [dialog, setDialog] = useState<Hit | null>(null);

  const assets = (() => {
    const map = new Map<string, ResolvedAsset>();
    for (const a of [...watchlist, ...SCAN_PRESETS]) if (!map.has(`${a.kind}:${a.symbol}`)) map.set(`${a.kind}:${a.symbol}`, a);
    return [...map.values()];
  })();

  const run = async () => {
    setBusy(true);
    setProgress(0);
    const { settings } = getData();
    const jobs = assets.flatMap((asset) => (["short", "medium", "long"] as Horizon[]).map((horizon) => ({ asset, horizon })));
    const hits: Hit[] = [];
    let done = 0;
    let failed = 0;
    await pool(jobs, 4, async ({ asset, horizon }) => {
      try {
        const interval = settings.intervals[horizon];
        const { candles } = await api.candles(asset, interval, 60e3);
        const first = analyze({ symbol: asset.symbol, name: asset.name, candles, horizon, interval, weights: settings.weights, kind: asset.kind, currency: asset.currency });
        if (first && first.decision.rawLevel !== "neutral") {
          // Kandidat: mit Firmenzahlen und Nachrichten vollständig bewerten
          const [f, n] = await Promise.allSettled([api.fundamentals(asset), api.news(asset)]);
          const full = analyze({
            symbol: asset.symbol,
            name: asset.name,
            candles,
            horizon,
            interval,
            weights: settings.weights,
            kind: asset.kind,
            currency: asset.currency,
            fundamentals: f.status === "fulfilled" ? f.value.fundamentals : null,
            news: n.status === "fulfilled" ? n.value.news : [],
          });
          if (full && full.decision.level !== "neutral") hits.push({ asset, res: full });
        }
      } catch {
        failed++;
      }
      done++;
      setProgress(done / jobs.length);
    });
    hits.sort((a, b) => Math.abs(b.res.total - 50) - Math.abs(a.res.total - 50));
    lastScan = { at: Date.now(), hits, checked: jobs.length, failed };
    setScan(lastScan);
    setBusy(false);
  };

  useEffect(() => {
    if (!lastScan || Date.now() - lastScan.at > 15 * 60e3) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hits = (scan?.hits ?? []).filter((h) => horizonFilter === "all" || h.res.horizon === horizonFilter);
  const takeAll = () => {
    let n = 0;
    for (const h of hits) if (openPaperTrade(h.asset, h.res)) n++;
    window.alert(n ? `${n} Papier-Trade(s) eröffnet – zu sehen im Journal.` : "Alle Chancen sind bereits als Trade offen.");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl text-gold sm:text-3xl">Chancen</h1>
          <p className="text-sm text-stone-400">
            Der Analyst prüft {assets.length} bekannte Aktien und Coins (plus deine Watchlist) in allen drei Zeiträumen und zeigt nur echte Einstiegsmöglichkeiten.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={run} disabled={busy}>
            {busy ? `Suche … ${Math.round(progress * 100)} %` : "Neu suchen"}
          </button>
          {hits.length > 0 && (
            <button className="btn-primary" onClick={takeAll}>
              Alle als Papier-Trades
            </button>
          )}
        </div>
      </div>

      {busy && (
        <div className="h-1.5 overflow-hidden rounded-full bg-stone-800">
          <div className="h-full bg-gold transition-all" style={{ width: `${progress * 100}%` }} />
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {(["all", "short", "medium", "long"] as const).map((h) => (
          <button key={h} onClick={() => setHorizonFilter(h)} className={`chip ${horizonFilter === h ? "border-gold bg-gold/20 text-gold-light" : "border-stone-700 text-stone-400"}`}>
            {h === "all" ? "Alle Zeiträume" : HORIZON_LABEL[h]}
          </button>
        ))}
      </div>

      {scan && !busy && hits.length === 0 && (
        <div className="panel p-6 text-center text-sm text-stone-300">
          <p className="font-display text-gold">Gerade keine sauberen Einstiege.</p>
          <p className="mt-2 text-stone-400">
            {scan.checked} Prüfungen, keine erfüllt die Ansprüche des Analysten. Lieber kein Trade als ein schwacher. Schau später wieder vorbei – die Suche läuft bei jedem Öffnen neu.
          </p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {hits.map((h) => {
          const c = h.res.commentary;
          const open = hasOpenTrade(h.asset.symbol, h.res.horizon);
          const inList = watchlist.some((w) => w.kind === h.asset.kind && w.symbol === h.asset.symbol);
          return (
            <div key={`${h.asset.symbol}-${h.res.horizon}`} className="panel space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-gold-light">
                    {h.asset.name} <span className="text-xs font-normal text-stone-400">{h.asset.symbol}</span>
                  </div>
                  <div className="text-xs text-stone-400">
                    {HORIZON_LABEL[h.res.horizon]} ({h.res.interval}) · {h.res.total.toFixed(0)} Punkte
                  </div>
                </div>
                <SignalBadge level={h.res.decision.level} />
              </div>
              <p className={`font-semibold ${h.res.plan?.direction === "short" ? "text-red-300" : "text-emerald-300"}`}>{c.summary}</p>
              <p className="text-sm text-stone-200">{c.reason}</p>
              {c.risk && <p className="text-xs text-stone-400">{c.risk}</p>}
              <div className="flex flex-wrap gap-2 pt-1">
                {open ? (
                  <span className="chip border-gold/40 text-gold-light">Trade läuft (Journal)</span>
                ) : (
                  <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => setDialog(h)}>
                    Als Papier-Trade übernehmen
                  </button>
                )}
                {!inList && (
                  <button className="btn px-3 py-1.5 text-xs" onClick={() => actions.addWatch(h.asset)}>
                    + Watchlist
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {scan && !busy && (
        <p className="text-xs text-stone-500">
          Letzte Suche: {new Date(scan.at).toLocaleTimeString("de-DE")} · {scan.checked} Prüfungen{scan.failed ? ` · ${scan.failed} ohne Daten` : ""} · {trades.filter((t) => t.status === "open").length} offene Papier-Trades
        </p>
      )}
      {dialog && <TradeDialog item={{ ...dialog.asset, id: "scan", addedAt: 0 } as WatchItem} analysis={dialog.res} onClose={() => setDialog(null)} />}
    </div>
  );
}
