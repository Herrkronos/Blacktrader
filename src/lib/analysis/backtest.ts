// Backtest: Walk-Forward über historische Kerzen – zu jedem Zeitpunkt sieht die Analyse nur die Vergangenheit.
import type { Candle, Horizon, Interval } from "../types";
import { analyze } from "./analyze";
import { plainSetup } from "./persona";
import type { Weights } from "./score";
import { performance, tradeReturnPct, type PerformanceStats } from "./stats";

export interface BacktestTrade {
  direction: "long" | "short";
  entryTime: number;
  entry: number;
  stop: number;
  target: number;
  exitTime: number;
  exit: number;
  reason: "target" | "stop" | "timeout" | "end";
  returnPct: number;
  score: number;
  pattern: string;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  stats: PerformanceStats;
  buyAndHold: number;
  evaluatedBars: number;
}

export interface BacktestOptions {
  horizon: Horizon;
  interval: Interval;
  weights?: Weights;
  warmup?: number;
  /** Analyse nur jede n-te Kerze (Geschwindigkeit) */
  step?: number;
  maxHoldBars?: number;
  window?: number;
}

/**
 * Fundamentaldaten/News sind historisch nicht verfügbar und fließen neutral (50) ein.
 * Treffen Stop und Ziel in derselben Kerze, wird konservativ der Stop angenommen.
 */
export function runBacktest(candles: Candle[], opts: BacktestOptions): BacktestResult {
  const warmup = opts.warmup ?? 120;
  const step = opts.step ?? Math.max(1, Math.floor((candles.length - warmup) / 200));
  const maxHold = opts.maxHoldBars ?? 120;
  const window = opts.window ?? 400;
  const trades: BacktestTrade[] = [];
  let evaluated = 0;
  let i = warmup;
  while (i < candles.length - 1) {
    const hist = candles.slice(Math.max(0, i + 1 - window), i + 1);
    const res = analyze({ symbol: "BT", name: "Backtest", candles: hist, horizon: opts.horizon, interval: opts.interval, weights: opts.weights, news: [], fundamentals: null });
    evaluated++;
    if (!res || res.decision.level === "neutral" || !res.plan) {
      i += step;
      continue;
    }
    const plan = res.plan;
    const dir = plan.direction === "long" ? 1 : -1;
    const target = plan.targets[0];
    let exitIdx = -1;
    let exit = 0;
    let reason: BacktestTrade["reason"] = "end";
    for (let j = i + 1; j < candles.length && j <= i + maxHold; j++) {
      const c = candles[j];
      const hitStop = dir === 1 ? c.low <= plan.stop : c.high >= plan.stop;
      const hitTarget = dir === 1 ? c.high >= target : c.low <= target;
      if (hitStop) {
        exitIdx = j;
        exit = dir === 1 ? Math.min(plan.stop, c.open) : Math.max(plan.stop, c.open);
        reason = "stop";
        break;
      }
      if (hitTarget) {
        exitIdx = j;
        exit = target;
        reason = "target";
        break;
      }
    }
    if (exitIdx < 0) {
      exitIdx = Math.min(candles.length - 1, i + maxHold);
      exit = candles[exitIdx].close;
      reason = exitIdx === candles.length - 1 && exitIdx < i + maxHold ? "end" : "timeout";
    }
    trades.push({
      direction: plan.direction,
      entryTime: candles[i].time,
      entry: plan.entry,
      stop: plan.stop,
      target,
      exitTime: candles[exitIdx].time,
      exit,
      reason,
      returnPct: tradeReturnPct(plan.direction, plan.entry, exit),
      score: res.total,
      pattern: plainSetup(res.elliott.best),
    });
    i = exitIdx + 1;
  }
  const stats = performance(trades.map((t) => ({ returnPct: t.returnPct, closedAt: t.exitTime * 1000 })));
  const first = candles[Math.min(warmup, candles.length - 1)]?.close ?? 0;
  const lastC = candles[candles.length - 1]?.close ?? 0;
  return { trades, stats, buyAndHold: first ? ((lastC - first) / first) * 100 : 0, evaluatedBars: evaluated };
}
