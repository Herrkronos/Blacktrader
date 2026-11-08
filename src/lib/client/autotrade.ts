"use client";
// Papier-Trades aus einem Analyse-Ergebnis anlegen (manuell oder automatisch).
import type { AnalysisResult } from "../analysis/analyze";
import type { CoreStatus } from "../analysis/core";
import { plainSetup } from "../analysis/persona";
import { tradeReturnPct } from "../analysis/stats";
import { actions, getData } from "../store/store";
import type { ResolvedAsset } from "../types";

const INTERVAL_MS = { "5m": 300e3, "15m": 900e3, "1h": 3600e3, "4h": 14400e3, "1d": 86400e3, "1w": 604800e3, "1M": 2592000e3 } as const;

type Asset = Pick<ResolvedAsset, "kind" | "symbol" | "name" | "binanceSymbol" | "yahooSymbol">;

export function hasOpenTrade(symbol: string, horizon: AnalysisResult["horizon"]): boolean {
  return getData().trades.some((t) => t.status !== "closed" && t.symbol === symbol && t.horizon === horizon && t.strategy !== "core");
}

/** Legt einen Papier-Trade an, sofern ein Signal mit Plan vorliegt und noch keiner offen ist. */
export function openPaperTrade(asset: Asset, res: AnalysisResult): boolean {
  const plan = res.plan;
  if (!plan || res.decision.level === "neutral" || hasOpenTrade(asset.symbol, res.horizon)) return false;
  const c = res.commentary;
  const limit = plan.orderType === "limit";
  actions.addTrade({
    status: limit ? "pending" : "open",
    orderType: plan.orderType,
    cancelAbove: plan.cancelAbove,
    trailDistance: plan.trailDistance,
    wave5Exit: plan.wave5Exit || undefined,
    initialStop: plan.stop,
    // Wartende Order verfällt nach 60 Kerzen (wie im EchoChart gemessen)
    expiresAt: limit ? Date.now() + 60 * INTERVAL_MS[res.interval] : undefined,
    symbol: asset.symbol,
    name: asset.name,
    kind: asset.kind,
    binanceSymbol: asset.binanceSymbol,
    yahooSymbol: asset.yahooSymbol,
    direction: plan.direction,
    horizon: res.horizon,
    interval: res.interval,
    entry: plan.entry,
    stop: plan.stop,
    targets: plan.targets,
    openedAt: Date.now(),
    reason: [c.summary, c.reason, c.risk].filter(Boolean).join("\n"),
    score: res.total,
    signal: res.decision.level,
    pattern: plainSetup(res.elliott.best),
    lastPrice: res.price,
  });
  return true;
}

/** Offene Kernposition für Wert + Horizont */
export function openCoreTrade(symbol: string, horizon: AnalysisResult["horizon"]) {
  return getData().trades.find((t) => t.status === "open" && t.strategy === "core" && t.symbol === symbol && t.horizon === horizon);
}

const CORE_EXIT_TEXT = { welle5: "Welle 5 beendet – Gewinne mitgenommen", trendbruch: "Aufwärtstrend gebrochen – verkauft" } as const;

/**
 * Schließt eine SELBST übernommene Kernposition, wenn der Analyst das Ende der 5. Welle erkennt oder der Trend bricht.
 * Es werden niemals automatisch Positionen eröffnet.
 */
export function syncCoreTrade(asset: Asset, res: AnalysisResult, status: CoreStatus): string | null {
  const open = openCoreTrade(asset.symbol, res.horizon);
  if (status.state !== "hold" && open) {
    const reason = status.state === "wait-bottom" ? "welle5" : "trendbruch";
    actions.updateTrade(open.id, { status: "closed", exit: res.price, closedAt: Date.now(), closeReason: reason, returnPct: tradeReturnPct("long", open.entry, res.price), lastPrice: res.price });
    return `${CORE_EXIT_TEXT[reason]} (${tradeReturnPct("long", open.entry, res.price) >= 0 ? "+" : ""}${tradeReturnPct("long", open.entry, res.price).toFixed(2)} %)`;
  }
  return null;
}

/** Kernposition selbst übernehmen (über Chancen oder Watchlist). */
export function openManualCoreTrade(asset: Asset, res: Pick<AnalysisResult, "horizon" | "interval" | "price" | "total">, note: string): boolean {
  if (openCoreTrade(asset.symbol, res.horizon)) return false;
  actions.addTrade({
    strategy: "core",
    symbol: asset.symbol,
    name: asset.name,
    kind: asset.kind,
    binanceSymbol: asset.binanceSymbol,
    yahooSymbol: asset.yahooSymbol,
    direction: "long",
    horizon: res.horizon,
    interval: res.interval,
    entry: res.price,
    stop: 0,
    targets: [],
    openedAt: Date.now(),
    reason: `Kernposition: ${note}. Gehalten wird, bis der Analyst das Ende der 5. Welle erkennt oder der Aufwärtstrend bricht.`,
    score: res.total,
    signal: "buy",
    pattern: note,
    lastPrice: res.price,
  });
  return true;
}
