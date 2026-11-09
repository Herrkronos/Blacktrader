"use client";
import { AddAsset } from "@/components/AddAsset";
import { AssetCard, type HorizonView } from "@/components/AssetCard";
import { useAssetSheet } from "@/components/AssetSheet";
import { Legend } from "@/components/Legend";
import { instrumentKey, itemHorizon, useMarket } from "@/lib/client/market";
import { useScan } from "@/lib/client/scanner";
import { actions, useAppData } from "@/lib/store/store";
import type { Horizon } from "@/lib/types";

export default function WatchlistPage() {
  const watchlist = useAppData((d) => d.watchlist);
  const global = useAppData((d) => d.settings.globalHorizon);
  const { live, analyses } = useMarket();
  const scan = useScan();
  const { open, sheet } = useAssetSheet();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[22px] text-gold">Watchlist</h1>
        <Legend />
      </div>
      <AddAsset />
      {watchlist.length === 0 && (
        <div className="card p-6 text-center text-[15px] text-stone-300">
          <p className="font-semibold text-stone-100">Noch keine Werte</p>
          <p className="mt-1 text-stone-400">Suche oben nach einem Namen („Apple“), Symbol (BTC, SAP.DE) oder einer ISIN.</p>
        </div>
      )}
      {watchlist.map((w) => {
        const a = analyses[w.id];
        const lv = live[instrumentKey(w)];
        const h: Horizon = a?.horizon ?? itemHorizon(w, global);
        // Alle Zeiträume aus dem Chancen-Scan, der eigene Zeitraum mit Live-Analyse
        const entry = scan.entries.find((e) => e.asset.kind === w.kind && e.asset.symbol === w.symbol);
        const views: Partial<Record<Horizon, HorizonView>> = {};
        for (const [k, v] of Object.entries(entry?.horizons ?? {})) if (v) views[k as Horizon] = { res: v.res, candles: v.candles };
        views[h] = { res: a?.result ?? null, candles: a?.candles ?? views[h]?.candles ?? [] };
        return (
          <AssetCard
            key={w.id}
            asset={w}
            views={views}
            longterm={entry?.longterm ?? a?.longterm}
            ltCandles={entry?.longterm ? entry.ltCandles : a?.candles}
            ltHorizon={entry?.longterm ? entry.ltHorizon : h}
            initial={h}
            price={lv?.price}
            changePct={lv?.changePct}
            status={lv?.status}
            source={lv?.source}
            onOpen={(x) => open(w, x)}
            onRemove={() => actions.removeWatch(w.id)}
          />
        );
      })}
      {sheet}
    </div>
  );
}
