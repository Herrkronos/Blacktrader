// EchoChart für Zielzonen: wartende Limit-Order in der Zone, Einstieg nur bei Erreichen.
import type { Candle } from "../types";
import type { BacktestResult, BacktestTrade } from "./backtest";
import { MIN_RISK_REWARD } from "./score";
import { performance, tradeReturnPct } from "./stats";
import { DEFAULT_ZONE_OPTIONS, findZoneSetup, type ZoneOptions } from "./zones";

export interface ZoneBacktestOptions {
  zone?: Partial<ZoneOptions>;
  warmup?: number;
  step?: number;
  window?: number;
  /** Wie lange eine Order in der Zone wartet (Kerzen) */
  maxWait?: number;
  /** Wie lange ein Trade maximal läuft (Kerzen) */
  maxHold?: number;
  /** Welches Ziel schließt den Trade (0 = Ziel 1) */
  targetIndex?: number;
}

function* steps(candles: Candle[], opts: ZoneBacktestOptions): Generator<number, BacktestResult> {
  const zo = { ...DEFAULT_ZONE_OPTIONS, ...(opts.zone ?? {}) };
  const warmup = opts.warmup ?? 120;
  const step = opts.step ?? Math.max(1, Math.ceil((candles.length - warmup) / 5000));
  const window = opts.window ?? 400;
  const maxWait = opts.maxWait ?? 60;
  const maxHold = opts.maxHold ?? 200;
  const ti = opts.targetIndex ?? 0;
  const trades: BacktestTrade[] = [];
  let evaluated = 0;
  let i = warmup;
  while (i < candles.length - 1) {
    if (evaluated % 50 === 0) yield (i - warmup) / Math.max(1, candles.length - 1 - warmup);
    evaluated++;
    const setup = findZoneSetup(candles.slice(Math.max(0, i + 1 - window), i + 1), zo);
    if (!setup || setup.riskReward < MIN_RISK_REWARD) {
      i += step;
      continue;
    }
    const dir = setup.direction === "long" ? 1 : -1;
    const target = setup.targets[Math.min(ti, setup.targets.length - 1)];
    // 1) Warten auf Einstieg
    let fillIdx = -1;
    let fill = 0;
    if (setup.inZone) {
      fillIdx = i;
      fill = candles[i].close;
    } else {
      for (let j = i + 1; j < candles.length && j <= i + maxWait; j++) {
        const c = candles[j];
        if ((dir === 1 ? c.high > setup.cancelAbove : c.low < setup.cancelAbove) && !(dir === 1 ? c.low <= setup.entry : c.high >= setup.entry)) {
          break; // Setup verfällt: neues Extrem ohne Einstieg
        }
        if (dir === 1 ? c.low <= setup.entry : c.high >= setup.entry) {
          fillIdx = j;
          fill = dir === 1 ? Math.min(setup.entry, c.open) : Math.max(setup.entry, c.open);
          break;
        }
      }
    }
    if (fillIdx < 0) {
      i += step;
      continue;
    }
    // 2) Trade verwalten (Stop zuerst, wenn beides in derselben Kerze)
    let exitIdx = -1;
    let exit = 0;
    let reason: BacktestTrade["reason"] = "end";
    for (let j = fillIdx + (setup.inZone ? 1 : 0); j < candles.length && j <= fillIdx + maxHold; j++) {
      const c = candles[j];
      if (j === fillIdx) {
        // Einstiegskerze: nur Stop prüfen (Reihenfolge innerhalb der Kerze unbekannt)
        if (dir === 1 ? c.low <= setup.stop : c.high >= setup.stop) {
          exitIdx = j;
          exit = setup.stop;
          reason = "stop";
          break;
        }
        continue;
      }
      if (dir === 1 ? c.low <= setup.stop : c.high >= setup.stop) {
        exitIdx = j;
        exit = dir === 1 ? Math.min(setup.stop, c.open) : Math.max(setup.stop, c.open);
        reason = "stop";
        break;
      }
      if (dir === 1 ? c.high >= target : c.low <= target) {
        exitIdx = j;
        exit = target;
        reason = "target";
        break;
      }
    }
    if (exitIdx < 0) {
      exitIdx = Math.min(candles.length - 1, fillIdx + maxHold);
      exit = candles[exitIdx].close;
      reason = exitIdx === candles.length - 1 ? "end" : "timeout";
    }
    trades.push({
      direction: setup.direction,
      entryTime: candles[fillIdx].time,
      entry: fill,
      stop: setup.stop,
      target,
      exitTime: candles[exitIdx].time,
      exit,
      reason,
      returnPct: tradeReturnPct(setup.direction, fill, exit),
      score: setup.riskReward,
      pattern: setup.direction === "long" ? "Kaufzone im Aufwärtstrend" : "Verkaufszone im Abwärtstrend",
    });
    i = exitIdx + 1;
  }
  const stats = performance(trades.map((t) => ({ returnPct: t.returnPct, closedAt: t.exitTime * 1000 })));
  const first = candles[Math.min(warmup, candles.length - 1)]?.close ?? 0;
  const lastC = candles[candles.length - 1]?.close ?? 0;
  return { trades, stats, buyAndHold: first ? ((lastC - first) / first) * 100 : 0, evaluatedBars: evaluated };
}

export function runZoneBacktest(candles: Candle[], opts: ZoneBacktestOptions = {}): BacktestResult {
  const g = steps(candles, opts);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

export async function runZoneBacktestAsync(candles: Candle[], opts: ZoneBacktestOptions, onProgress?: (p: number) => void): Promise<BacktestResult> {
  const g = steps(candles, opts);
  let r = g.next();
  let last = Date.now();
  while (!r.done) {
    if (Date.now() - last > 40) {
      onProgress?.(r.value);
      await new Promise((res) => setTimeout(res, 0));
      last = Date.now();
    }
    r = g.next();
  }
  onProgress?.(1);
  return r.value;
}
