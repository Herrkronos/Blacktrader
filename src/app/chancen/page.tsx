"use client";
// Chancen: alle Werte (Watchlist + feste Liste) in allen Zeiträumen – Trade (grün), Short (rot), Langfristig (blau).
import { useEffect, useMemo, useState } from "react";
import { AssetCard, signalStrength, type HorizonView } from "@/components/AssetCard";
import { useAssetSheet } from "@/components/AssetSheet";
import { Legend } from "@/components/Legend";
import { ConfirmSheet } from "@/components/Sheet";
import { haptic } from "@/lib/client/alerts";
import { openPaperTrade } from "@/lib/client/autotrade";
import { entryDistance, longTermDistance, entryKinds, runScan, useScan, type ScanEntry, type SignalKind } from "@/lib/client/scanner";
import { SCAN_GROUPS } from "@/lib/client/presets";
import { getData } from "@/lib/store/store";
import type { AssetKind, Horizon } from "@/lib/types";

type KindFilter = "all" | SignalKind;
const KIND_FILTERS: { k: KindFilter; label: string; cls: string }[] = [
  { k: "all", label: "Alle", cls: "border-gold/60 text-gold-light" },
  { k: "trade", label: "Trade", cls: "border-emerald-400/60 text-emerald-300" },
  { k: "short", label: "Short", cls: "border-red-400/60 text-red-300" },
  { k: "longterm", label: "Langfristig", cls: "border-sky-400/60 text-sky-300" },
];

function views(e: ScanEntry): Partial<Record<Horizon, HorizonView>> {
  const v: Partial<Record<Horizon, HorizonView>> = {};
  for (const [k, x] of Object.entries(e.horizons)) if (x) v[k as Horizon] = { res: x.res, candles: x.candles };
  return v;
}

/**
 * Sortierung: Langfristig = im Bereich zuerst, dann nach Abstand zur Oberkante; sonst nach Signalstärke (höher = besser),
 * bei Gleichstand der näher am Einstieg liegende Wert.
 */
function sortKey(e: ScanEntry, filter: KindFilter): [number, number] {
  if (filter === "longterm") {
    const z = e.longterm;
    if (!z) return [1000, 0];
    const price = e.horizons[e.ltHorizon ?? "long"]?.res.price ?? z.zoneTop;
    return [longTermDistance(z, price), 0];
  }
  const active = Object.values(e.horizons).filter(
    (h) => h && h.res.plan && h.res.decision.level !== "neutral" && (filter === "all" || (filter === "trade" ? h.res.plan.direction === "long" : h.res.plan.direction === "short")),
  );
  if (!active.length) return [1000, 0];
  const best = Math.max(...active.map((h) => signalStrength(h!.res) ?? 0));
  const dist = Math.min(...active.map((h) => entryDistance(h!.res)));
  return [-best, dist];
}

export default function ChancenPage() {
  const scan = useScan();
  const [kind, setKind] = useState<KindFilter>("all");
  const [group, setGroup] = useState<AssetKind | "all">("all");
  const [confirmAll, setConfirmAll] = useState(false);
  const [more, setMore] = useState(10);
  const { open, sheet } = useAssetSheet();

  useEffect(() => {
    runScan();
  }, []);

  const list = useMemo(
    () =>
      scan.entries
        .filter((e) => (group === "all" || e.asset.kind === group) && entryKinds(e).length > 0 && (kind === "all" || entryKinds(e).includes(kind)))
        .sort((a, b) => {
          const ka = sortKey(a, kind);
          const kb = sortKey(b, kind);
          return ka[0] - kb[0] || ka[1] - kb[1];
        }),
    [scan.entries, kind, group],
  );
  const counts = useMemo(() => {
    const c: Record<KindFilter, number> = { all: 0, trade: 0, short: 0, longterm: 0 };
    for (const e of scan.entries) {
      if (group !== "all" && e.asset.kind !== group) continue;
      const ks = entryKinds(e);
      if (ks.length) c.all++;
      ks.forEach((k) => c[k]++);
    }
    return c;
  }, [scan.entries, group]);

  const tradable = list.flatMap((e) =>
    Object.values(e.horizons)
      .filter((h) => h && h.res.plan && h.res.decision.level !== "neutral" && (kind === "all" || kind === "longterm" || (kind === "trade" ? h.res.plan.direction === "long" : h.res.plan.direction === "short")))
      .map((h) => ({ asset: e.asset, res: h!.res })),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-[22px] text-gold">Chancen</h1>
          <p className="text-[15px] text-stone-400">15 Aktien, 8 Krypto, 7 Rohstoffe und deine Watchlist – in allen Zeiträumen.</p>
        </div>
        <Legend />
      </div>

      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none]">
        {KIND_FILTERS.map((f) => (
          <button key={f.k} onClick={() => setKind(f.k)} className={`chip shrink-0 ${kind === f.k ? `${f.cls} bg-white/10 font-semibold` : "border-white/10 text-stone-400"}`}>
            {f.label} {scan.at ? `(${counts[f.k]})` : ""}
          </button>
        ))}
      </div>
      <div className="seg w-full">
        {[{ k: "all" as const, t: "Alle" }, ...SCAN_GROUPS.map((g) => ({ k: g.kind, t: g.title }))].map((g) => (
          <button key={g.k} aria-pressed={group === g.k} onClick={() => setGroup(g.k)} className="flex-1">
            {g.t}
          </button>
        ))}
      </div>

      {scan.busy && (
        <div className="card p-3">
          <div className="mb-1.5 flex justify-between text-[14px] text-stone-300">
            <span>Analyst sucht Chancen …</span>
            <span className="num">{Math.round(scan.progress * 100)} %</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-gold transition-all" style={{ width: `${scan.progress * 100}%` }} />
          </div>
        </div>
      )}

      {!scan.busy && scan.at && list.length === 0 && (
        <div className="card p-5 text-center text-[15px] text-stone-300">Gerade keine passenden Einstiege. Lieber kein Trade als ein schwacher – die Suche läuft bei jedem Öffnen neu.</div>
      )}

      {list.slice(0, more).map((e) => {
        const v = views(e);
        const ltProps = { longterm: e.longterm, ltCandles: e.ltCandles, ltHorizon: e.ltHorizon };
        if (kind === "longterm")
          return <AssetCard key={`${e.asset.kind}:${e.asset.symbol}`} asset={e.asset} views={v} {...ltProps} initial={e.ltHorizon ?? "long"} focus="longterm" onOpen={(h) => open(e.asset, h)} />;
        // Zeitraum mit dem stärksten passenden Signal zuerst zeigen
        const initial = (["short", "medium", "long"] as Horizon[])
          .filter((h) => {
            const p = v[h]?.res?.plan;
            if (!p || v[h]?.res?.decision.level === "neutral") return false;
            return kind === "all" || (kind === "trade" ? p.direction === "long" : p.direction === "short");
          })
          .sort((x, y) => (signalStrength(v[y]?.res) ?? 0) - (signalStrength(v[x]?.res) ?? 0))[0];
        return <AssetCard key={`${e.asset.kind}:${e.asset.symbol}`} asset={e.asset} views={v} {...ltProps} initial={initial ?? "medium"} onOpen={(h) => open(e.asset, h)} />;
      })}
      {list.length > more && (
        <button className="btn w-full" onClick={() => setMore(more + 10)}>
          Weitere {Math.min(10, list.length - more)} anzeigen
        </button>
      )}

      <div className="flex gap-2">
        <button className="btn flex-1" onClick={() => runScan(0)} disabled={scan.busy}>
          Neu suchen
        </button>
        {tradable.length > 0 && kind !== "longterm" && (
          <button className="btn flex-1" onClick={() => setConfirmAll(true)}>
            Alle als Papier-Trades
          </button>
        )}
      </div>
      {scan.at && !scan.busy && (
        <p className="text-[13px] text-stone-500">
          Letzte Suche {new Date(scan.at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} · {scan.checked} Prüfungen{scan.failed ? ` · ${scan.failed} ohne Daten` : ""}
        </p>
      )}

      <ConfirmSheet
        open={confirmAll}
        title="Alle als Papier-Trades übernehmen?"
        confirm={`${tradable.length} übernehmen`}
        onClose={() => setConfirmAll(false)}
        onConfirm={() => {
          let n = 0;
          for (const t of tradable) if (openPaperTrade(t.asset, t.res)) n++;
          if (n && getData().settings.haptics) haptic(30);
        }}
        text={
          <p>
            Es werden {tradable.length} Papier-Trades ins Journal übernommen (bereits laufende werden übersprungen). Einstieg, Stop und Ziele kommen unverändert vom Analysten.
          </p>
        }
      />
      {sheet}
    </div>
  );
}
