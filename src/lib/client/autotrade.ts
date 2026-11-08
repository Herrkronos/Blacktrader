"use client";
// Papier-Trades aus einem Analyse-Ergebnis anlegen (manuell oder automatisch).
import type { AnalysisResult } from "../analysis/analyze";
import { plainSetup } from "../analysis/persona";
import { actions, getData } from "../store/store";
import type { ResolvedAsset } from "../types";

type Asset = Pick<ResolvedAsset, "kind" | "symbol" | "name" | "binanceSymbol" | "yahooSymbol">;

export function hasOpenTrade(symbol: string, horizon: AnalysisResult["horizon"]): boolean {
  return getData().trades.some((t) => t.status === "open" && t.symbol === symbol && t.horizon === horizon);
}

/** Legt einen Papier-Trade an, sofern ein Signal mit Plan vorliegt und noch keiner offen ist. */
export function openPaperTrade(asset: Asset, res: AnalysisResult): boolean {
  const plan = res.plan;
  if (!plan || res.decision.level === "neutral" || hasOpenTrade(asset.symbol, res.horizon)) return false;
  const c = res.commentary;
  actions.addTrade({
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
