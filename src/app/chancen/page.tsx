"use client";
// Chancen: alle Werte (Watchlist + feste Liste) – je Wert GENAU EIN Einstieg von Blacktrader: Blau (langfristig) oder Grün (Trade).
// Gelb (kein Einstieg) erscheint nur in der Watchlist.
import { useEffect, useMemo, useState } from "react";
import { AssetCard, signalStrength } from "@/components/AssetCard";
import { useAssetSheet } from "@/components/AssetSheet";
import { Legend } from "@/components/Legend";
import { ConfirmSheet } from "@/components/Sheet";
import { haptic } from "@/lib/client/alerts";
import { openPaperTrade } from "@/lib/client/autotrade";
import { bestDistance, runScan, useScan, type ScanEntry, type SignalKind } from "@/lib/client/scanner";
import { SCAN_GROUPS } from "@/lib/client/presets";
import { getData } from "@/lib/store/store";
import type { AssetKind } from "@/lib/types";

type KindFilter = "all" | SignalKind;
const KIND_FILTERS: { k: KindFilter; label: string; cls: string }[] = [
  { k: "all", label: "Alle", cls: "border-gold/60 text-gold-light" },
  { k: "blau", label: "Blau", cls: "border-sky-400/60 text-sky-300" },
  { k: "gruen", label: "Grün", cls: "border-emerald-400/60 text-emerald-300" },
];

/** Sortierung: zuerst Werte, deren Kurs schon in der Zone liegt, dann nach Nähe; bei Gleichstand das stärkere Signal. */
function sortKey(e: ScanEntry): [number, number] {
  return [bestDistance(e), -(signalStrength(e.best.res) ?? 0)];
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
        .filter((e) => (group === "all" || e.asset.kind === group) && e.best.color !== "gelb" && (kind === "all" || e.best.color === kind))
        .sort((a, b) => {
          const ka = sortKey(a);
          const kb = sortKey(b);
          return ka[0] - kb[0] || ka[1] - kb[1];
        }),
    [scan.entries, kind, group],
  );
  const counts = useMemo(() => {
    const c: Record<KindFilter, number> = { all: 0, blau: 0, gruen: 0 };
    for (const e of scan.entries) {
      if (group !== "all" && e.asset.kind !== group) continue;
      if (e.best.color === "gelb") continue;
      c.all++;
      c[e.best.color]++;
    }
    return c;
  }, [scan.entries, group]);

  const tradable = list.filter((e) => e.best.color === "gruen" && e.best.res).map((e) => ({ asset: e.asset, res: e.best.res! }));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-[22px] text-gold">Chancen</h1>
          <p className="text-[15px] text-stone-400">15 Aktien, 8 Krypto, 7 Rohstoffe und deine Watchlist – Blacktrader zeigt je Wert den besten Einstieg.</p>
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
            <span>Blacktrader sucht Chancen …</span>
            <span className="num">{Math.round(scan.progress * 100)} %</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-gold transition-all" style={{ width: `${scan.progress * 100}%` }} />
          </div>
        </div>
      )}

      {!scan.busy && scan.at && list.length === 0 && (
        <div className="card p-5 text-center text-[15px] text-stone-300">Gerade keine passenden Einstiege. Lieber kein Trade als ein schwacher – Blacktrader sucht bei jedem Öffnen neu.</div>
      )}

      {list.slice(0, more).map((e) => (
        <AssetCard key={`${e.asset.kind}:${e.asset.symbol}`} asset={e.asset} entry={e} onOpen={(h) => open(e.asset, h)} />
      ))}
      {list.length > more && (
        <button className="btn w-full" onClick={() => setMore(more + 10)}>
          Weitere {Math.min(10, list.length - more)} anzeigen
        </button>
      )}

      <div className="flex gap-2">
        <button className="btn flex-1" onClick={() => runScan(0)} disabled={scan.busy}>
          Neu suchen
        </button>
        {tradable.length > 0 && kind !== "blau" && (
          <button className="btn flex-1" onClick={() => setConfirmAll(true)}>
            Alle als Papier-Trades
          </button>
        )}
      </div>
      {scan.at && !scan.busy && (
        <p className="text-[13px] text-stone-500">
          Letzte Suche {new Date(scan.at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} · {scan.checked} Prüfungen{scan.failed ? ` · ${scan.failed} ohne Daten` : ""}
          {scan.ctx.spBull != null && ` · Gesamtmarkt ${scan.ctx.spBull ? "bullisch" : "nicht bullisch"}`}
          {scan.ctx.techWeak && " · Tech-Markt schwach: keine grünen Tech-Trades"}
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
            Es werden {tradable.length} Papier-Trades ins Journal übernommen (bereits laufende werden übersprungen). Einstieg, Stop und Ziele kommen unverändert von Blacktrader.
          </p>
        }
      />
      {sheet}
    </div>
  );
}
