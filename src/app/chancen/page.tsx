"use client";
// Chancen-Scanner: durchsucht bekannte Aktien und Coins in allen drei Zeithorizonten nach Einstiegssignalen.
import { useEffect, useState } from "react";
import { TradeDialog } from "@/components/TradeDialog";
import { SignalBadge } from "@/components/ui";
import { analyze, type AnalysisResult } from "@/lib/analysis/analyze";
import { api } from "@/lib/client/api";
import { hasOpenTrade, openPaperTrade } from "@/lib/client/autotrade";
import { SCAN_GROUPS, SCAN_PRESETS } from "@/lib/client/presets";
import { actions, getData, useAppData, type WatchItem } from "@/lib/store/store";
import { HORIZON_LABEL, type AssetKind, type Horizon, type ResolvedAsset } from "@/lib/types";

interface Hit {
  asset: ResolvedAsset;
  res: AnalysisResult;
}

// Ergebnis bleibt beim Seitenwechsel erhalten
let lastScan: { at: number; hits: Hit[]; checked: number; failed: number } | null = null;

/** Abstand vom aktuellen Kurs bis zum Einstieg in % (0 = jetzt in der Zone) */
function distance(h: Hit): number {
  const p = h.res.plan;
  if (!p || p.orderType !== "limit") return 0;
  return (Math.abs(h.res.price - p.entry) / h.res.price) * 100;
}

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
  const [groupFilter, setGroupFilter] = useState<AssetKind | "all">("all");
  const [dialog, setDialog] = useState<Hit | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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
        if (first && first.decision.level !== "neutral") {
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
    hits.sort((a, b) => distance(a) - distance(b));
    lastScan = { at: Date.now(), hits, checked: jobs.length, failed };
    setScan(lastScan);
    setBusy(false);
  };

  useEffect(() => {
    if (!lastScan || Date.now() - lastScan.at > 15 * 60e3) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hits = (scan?.hits ?? []).filter((h) => (horizonFilter === "all" || h.res.horizon === horizonFilter) && (groupFilter === "all" || h.asset.kind === groupFilter));
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
            Der Analyst prüft 15 Aktien, 8 Kryptowährungen und 7 Rohstoffe (plus deine Watchlist) in allen drei Zeiträumen und zeigt nur echte Einstiegsmöglichkeiten.
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
        {(["all", ...SCAN_GROUPS.map((g) => g.kind)] as const).map((k) => {
          const n = (scan?.hits ?? []).filter((h) => k === "all" || h.asset.kind === k).length;
          return (
            <button key={k} onClick={() => setGroupFilter(k)} className={`chip ${groupFilter === k ? "border-gold bg-gold text-black" : "border-gold/40 text-gold-light"}`}>
              {k === "all" ? "Alle" : SCAN_GROUPS.find((g) => g.kind === k)!.title} {scan ? `(${n})` : ""}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1">
        {(["all", "short", "medium", "long"] as const).map((h) => (
          <button key={h} onClick={() => setHorizonFilter(h)} className={`chip ${horizonFilter === h ? "border-gold bg-gold/20 text-gold-light" : "border-stone-700 text-stone-400"}`}>
            {h === "all" ? "Alle Zeiträume" : HORIZON_LABEL[h]}
          </button>
        ))}
      </div>

      {scan && !busy && (scan.hits.length === 0) && (
        <p className="text-sm text-stone-400">Gerade erfüllt kein Wert die Ansprüche des Analysten. Lieber kein Trade als ein schwacher – die Suche läuft bei jedem Öffnen neu.</p>
      )}

      {SCAN_GROUPS.filter((g) => groupFilter === "all" || g.kind === groupFilter).map((g) => {
        const groupHits = hits.filter((h) => h.asset.kind === g.kind);
        return (
          <section key={g.kind} className="space-y-2">
            <h2 className="flex items-baseline gap-2 text-lg text-gold">
              {g.title}
              <span className="font-sans text-xs text-stone-500">
                {g.assets.map((x) => x.name).join(" · ")}
              </span>
            </h2>
            {scan && !busy && groupHits.length === 0 && (
              <p className="panel px-4 py-3 text-sm text-stone-400">Keine Einstiege {horizonFilter === "all" ? "" : `(${HORIZON_LABEL[horizonFilter]}) `}– abwarten.</p>
            )}
            <div className="grid gap-3 md:grid-cols-2">
        {(expanded[g.kind] ? groupHits : groupHits.slice(0, 6)).map((h) => {
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
                <div className="flex flex-col items-end gap-1">
                  <SignalBadge level={h.res.decision.level} />
                  {distance(h) === 0 ? (
                    <span className="chip border-emerald-500/50 text-emerald-300">Jetzt in der Zone</span>
                  ) : (
                    <span className="chip border-sky-500/40 text-sky-300">wartet · noch {distance(h).toFixed(1).replace(".", ",")} %</span>
                  )}
                </div>
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
            {groupHits.length > 6 && (
              <button className="btn w-full text-xs" onClick={() => setExpanded((e) => ({ ...e, [g.kind]: !e[g.kind] }))}>
                {expanded[g.kind] ? "Weniger anzeigen" : `Alle ${groupHits.length} anzeigen`}
              </button>
            )}
          </section>
        );
      })}
      {scan && !busy && (
        <p className="text-xs text-stone-500">
          Letzte Suche: {new Date(scan.at).toLocaleTimeString("de-DE")} · {scan.checked} Prüfungen{scan.failed ? ` · ${scan.failed} ohne Daten` : ""} · {trades.filter((t) => t.status !== "closed").length} laufende/wartende Papier-Trades
        </p>
      )}
      {dialog && <TradeDialog item={{ ...dialog.asset, id: "scan", addedAt: 0 } as WatchItem} analysis={dialog.res} onClose={() => setDialog(null)} />}
    </div>
  );
}
