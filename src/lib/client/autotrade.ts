"use client";
// Papier-Trades aus einem Analyse-Ergebnis anlegen (manuell oder automatisch).
import type { AnalysisResult } from "../analysis/analyze";
import { plainSetup } from "../analysis/persona";
import { actions, getData } from "../store/store";
import type { ResolvedAsset } from "../types";

const INTERVAL_MS = { "5m": 300e3, "15m": 900e3, "1h": 3600e3, "4h": 14400e3, "1d": 86400e3, "1w": 604800e3, "1M": 2592000e3 } as const;

type Asset = Pick<ResolvedAsset, "kind" | "symbol" | "name" | "binanceSymbol" | "yahooSymbol">;

export function hasOpenTrade(symbol: string, horizon: AnalysisResult["horizon"]): boolean {
  return getData().trades.some((t) => t.status !== "closed" && t.symbol === symbol && t.horizon === horizon);
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
