"use client";
import { AddAsset } from "@/components/AddAsset";
import { HorizonToggle } from "@/components/ui";
import { Watchlist } from "@/components/Watchlist";
import { actions, useAppData } from "@/lib/store/store";

export default function Dashboard() {
  const horizon = useAppData((d) => d.settings.globalHorizon);
  const poll = useAppData((d) => d.settings.pollSeconds);
  const hasStocks = useAppData((d) => d.watchlist.some((w) => w.kind === "stock"));
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl text-gold sm:text-3xl">Watchlist</h1>
          <p className="text-sm text-stone-400">Elliott 60 % · Fundamental/News 20 % · Volumen/RSI 20 % – getrennt je Zeithorizont.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-stone-400">Globaler Horizont</span>
          <HorizonToggle value={horizon} onChange={(h) => h && actions.setSettings({ globalHorizon: h })} />
        </div>
      </div>
      <AddAsset />
      <Watchlist />
      {hasStocks && (
        <p className="text-xs text-stone-500">
          Hinweis: Aktienkurse kommen per Polling alle {poll} s von Yahoo Finance und sind je nach Börse bis zu 15–20 Minuten verzögert. Krypto-Kurse laufen live per Binance-WebSocket.
        </p>
      )}
    </div>
  );
}
