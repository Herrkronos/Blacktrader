// Trainer-Kern: Signal-Backtest mit lernbaren Werten, Kennzahlen, Walk-Forward und Annahmeregeln.
// Methode, Gewichtung und Risiko bleiben fest (locked-config.ts) – hier werden nur LearnableParams variiert.
import { analyze } from "../analysis/analyze";
import type { BacktestTrade } from "../analysis/backtest";
import { DEFAULT_PARAMS, PARAM_BOUNDS, validateParams, type LearnableParams } from "../analysis/params";
import { runZoneBacktest } from "../analysis/zoneBacktest";
import type { ZoneSetup } from "../analysis/zones";
import type { AssetKind, Candle, Horizon, Interval } from "../types";

export interface Metrics {
  trades: number;
  hitRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  /** Signale pro Monat */
  perMonth: number;
}

export function metrics(trades: Pick<BacktestTrade, "returnPct" | "exitTime">[], months: number): Metrics {
  const wins = trades.filter((t) => t.returnPct > 0);
  const losses = trades.filter((t) => t.returnPct <= 0);
  const gw = wins.reduce((a, t) => a + t.returnPct, 0);
  const gl = -losses.reduce((a, t) => a + t.returnPct, 0);
  let eq = 1;
  let peak = 1;
  let dd = 0;
  for (const t of [...trades].sort((a, b) => a.exitTime - b.exitTime)) {
    eq *= 1 + t.returnPct / 100;
    peak = Math.max(peak, eq);
    dd = Math.min(dd, eq / peak - 1);
  }
  return {
    trades: trades.length,
    hitRate: trades.length ? wins.length / trades.length : 0,
    avgWin: wins.length ? gw / wins.length : 0,
    avgLoss: losses.length ? -gl / losses.length : 0,
    profitFactor: gl > 0 ? gw / gl : wins.length ? 99 : 0,
    maxDrawdown: dd * 100,
    perMonth: months > 0 ? trades.length / months : 0,
  };
}

export interface Series {
  name: string;
  kind: AssetKind;
  horizon: Horizon;
  interval: Interval;
  candles: Candle[];
}

/** Analyse → Signal (gleiche Logik wie in der App, inkl. lernbarer Werte). */
export function signalFromAnalysis(hist: Candle[], s: Pick<Series, "kind" | "horizon" | "interval">, params: LearnableParams): ZoneSetup | null {
  const r = analyze({ symbol: "T", name: "T", candles: hist, horizon: s.horizon, interval: s.interval, kind: s.kind, params });
  if (!r || !r.plan || r.decision.level === "neutral") return null;
  const p = r.plan;
  return {
    direction: p.direction,
    a: { index: 0, time: 0, price: 0, type: "L", confirmed: true },
    b: { index: 0, time: 0, price: p.cancelAbove ?? p.entry, type: "H", confirmed: true },
    zoneStart: p.zoneStart ?? p.entry,
    zoneEnd: p.zoneEnd ?? p.entry,
    entry: p.entry,
    stop: p.stop,
    targets: p.targets,
    riskReward: p.riskReward,
    cancelAbove: p.cancelAbove ?? p.entry,
    inZone: p.orderType === "market",
    atr: (p.trailDistance ?? 0) / 4,
  };
}

/** Backtest einer Kursreihe mit Parametern (Trade-Regeln fest). */
export function backtestSeries(s: Series, params: LearnableParams, opts: { warmup?: number; step?: number } = {}) {
  return runZoneBacktest(s.candles, { warmup: opts.warmup ?? 150, step: opts.step, signalAt: (h) => signalFromAnalysis(h, s, params) });
}

const monthsOf = (c: Candle[]) => (c.length > 1 ? (c[c.length - 1].time - c[0].time) / (30.44 * 86400) : 0);

/** Teilt die letzten `months` Monate als gesperrten Abschlusstest ab. */
export function splitHoldout(c: Candle[], months = 12): { train: Candle[]; holdout: Candle[] } {
  if (!c.length) return { train: [], holdout: [] };
  const cut = c[c.length - 1].time - months * 30.44 * 86400;
  const i = c.findIndex((x) => x.time >= cut);
  return { train: i < 0 ? c : c.slice(0, i), holdout: i < 0 ? [] : c.slice(i) };
}

export interface Fold {
  /** Kerzenbereich, auf dem gelernt wird */
  train: [number, number];
  /** Folgender, unbekannter Bereich (inkl. Vorlauf für Indikatoren) */
  test: [number, number];
}

/** Walk-Forward: Lernen auf A, Prüfen auf dem folgenden B, dann weiterrollen. */
export function walkForwardFolds(n: number, folds = 4, warmup = 150): Fold[] {
  const usable = n - warmup;
  if (usable < 100) return [];
  const block = Math.floor(usable / (folds + 1));
  const out: Fold[] = [];
  for (let k = 0; k < folds; k++) {
    const trainEnd = warmup + block * (k + 1);
    const testEnd = Math.min(n, trainEnd + block);
    out.push({ train: [0, trainEnd], test: [trainEnd - warmup, testEnd] });
  }
  return out;
}

export interface Evaluation {
  oos: Metrics;
  /** Trades nur aus den Prüfbereichen */
  oosTrades: number;
}

/** Bewertet Parameter NUR auf den unbekannten Prüfbereichen der Folds. */
export function evaluateOOS(series: Series[], params: LearnableParams, folds = 4, step?: number): Evaluation {
  const trades: BacktestTrade[] = [];
  let months = 0;
  for (const s of series) {
    for (const f of walkForwardFolds(s.candles.length, folds)) {
      const slice = s.candles.slice(f.test[0], f.test[1]);
      const startTime = s.candles[f.test[0] + Math.min(150, f.test[1] - f.test[0] - 1)]?.time ?? 0;
      const r = backtestSeries({ ...s, candles: slice }, params, { step });
      trades.push(...r.trades.filter((t) => t.entryTime >= startTime));
      months += monthsOf(slice.slice(150));
    }
  }
  return { oos: metrics(trades, months), oosTrades: trades.length };
}

export const MIN_SIGNALS_VALID = 200;
export const TARGET_HIT_RATE = 0.65;

export interface Decision {
  accept: boolean;
  reasons: string[];
}

/**
 * Regeln gegen Selbstbetrug: nur übernehmen, wenn auf UNBEKANNTEN Daten
 * Trefferquote höher, Profit-Faktor nicht niedriger, Signale/Monat höchstens −40 %, genug Signale.
 */
export function decide(base: Metrics, cand: Metrics): Decision {
  const reasons: string[] = [];
  if (cand.trades < MIN_SIGNALS_VALID) reasons.push(`zu wenige Signale (${cand.trades} < ${MIN_SIGNALS_VALID})`);
  if (cand.hitRate <= base.hitRate) reasons.push(`Trefferquote nicht besser (${(cand.hitRate * 100).toFixed(1)} % ≤ ${(base.hitRate * 100).toFixed(1)} %)`);
  if (cand.profitFactor < base.profitFactor) reasons.push(`Profit-Faktor gesunken (${cand.profitFactor.toFixed(2)} < ${base.profitFactor.toFixed(2)})`);
  if (base.perMonth > 0 && cand.perMonth < base.perMonth * 0.6) reasons.push(`zu wenige Signale pro Monat (−${Math.round((1 - cand.perMonth / base.perMonth) * 100)} %)`);
  return { accept: reasons.length === 0, reasons };
}

const NUMERIC_KEYS = Object.keys(PARAM_BOUNDS) as (keyof typeof PARAM_BOUNDS)[];
const STEP: Record<string, number> = { zoneAtrMult: 0.5, fibToleranceScale: 0.15, rankFibWeight: 0.05, rankContextStrength: 0.25, rsiOverbought: 3, rsiOversold: 3, divergenceRecentBars: 5, relVolHigh: 0.15, relVolBreakout: 0.15, relVolLow: 0.1, newsShare: 0.1, newsHalfLifeHours: 12, minStrength: 5 };

/** Kleine Schritte um die aktuellen Werte (vorsichtiges Nachjustieren). */
export function neighbours(p: LearnableParams, keys: (keyof typeof PARAM_BOUNDS)[] = NUMERIC_KEYS): { params: LearnableParams; change: string }[] {
  const out: { params: LearnableParams; change: string }[] = [];
  for (const k of keys) {
    const [lo, hi] = PARAM_BOUNDS[k];
    for (const dir of [-1, 1]) {
      const v = Math.round((p[k] + dir * STEP[k]) * 1000) / 1000;
      if (v < lo || v > hi) continue;
      const params = { ...p, [k]: v };
      if (validateParams(params).length) continue;
      out.push({ params, change: `${k} ${p[k]} → ${v}` });
    }
  }
  // Wellengrade gemeinsam verschieben
  for (const f of [0.85, 1.15]) {
    const d = p.elliottDegrees.map((x) => Math.round(x * f * 100) / 100) as [number, number, number];
    const params = { ...p, elliottDegrees: d };
    if (!validateParams(params).length) out.push({ params, change: `elliottDegrees ${p.elliottDegrees.join("/")} → ${d.join("/")}` });
  }
  return out;
}

/** Bewertung NUR auf den Lernbereichen (Zeitraum A jedes Folds, ohne Prüfbereiche). */
export function evaluateInSample(series: Series[], params: LearnableParams, folds = 4, step?: number): Metrics {
  const trades: BacktestTrade[] = [];
  let months = 0;
  for (const s of series) {
    const fs = walkForwardFolds(s.candles.length, folds);
    if (!fs.length) continue;
    // Lernbereich = alles vor dem ersten Prüfbereich des letzten Folds
    const end = fs[fs.length - 1].train[1];
    const slice = s.candles.slice(0, end);
    trades.push(...backtestSeries({ ...s, candles: slice }, params, { step }).trades);
    months += monthsOf(slice.slice(150));
  }
  return metrics(trades, months);
}

export interface TrainStepResult {
  accepted: boolean;
  params: LearnableParams;
  /** Prüfdaten (unbekannt): aktueller Stand */
  base: Metrics;
  /** Ausgewählter Kandidat (Auswahl nur auf Lerndaten) und sein Ergebnis auf den Prüfdaten */
  best?: { change: string; inSample: Metrics; oos: Metrics; decision: Decision };
  tried: number;
}

/**
 * Ein Lernschritt (Walk-Forward):
 * 1. Kandidaten (kleine Schritte) NUR auf den Lerndaten bewerten und den besten auswählen.
 * 2. Diesen einen Kandidaten auf den unbekannten Prüfdaten gegen den aktuellen Stand testen.
 * 3. Übernehmen nur, wenn er dort die Regeln gegen Selbstbetrug erfüllt.
 */
export function trainStep(series: Series[], current: LearnableParams = DEFAULT_PARAMS, opts: { maxCandidates?: number; folds?: number; step?: number; keys?: (keyof typeof PARAM_BOUNDS)[] } = {}): TrainStepResult {
  const cands = neighbours(current, opts.keys).slice(0, opts.maxCandidates ?? 40);
  const baseIn = evaluateInSample(series, current, opts.folds, opts.step);
  let chosen: { change: string; params: LearnableParams; inSample: Metrics } | null = null;
  for (const c of cands) {
    const m = evaluateInSample(series, c.params, opts.folds, opts.step);
    // Vorauswahl auf Lerndaten: Trefferquote höher, Profit-Faktor nicht schlechter, Signalmenge ≥ 60 %
    if (m.hitRate <= baseIn.hitRate || m.profitFactor < baseIn.profitFactor || m.perMonth < baseIn.perMonth * 0.6) continue;
    if (!chosen || m.hitRate > chosen.inSample.hitRate) chosen = { change: c.change, params: c.params, inSample: m };
  }
  const base = evaluateOOS(series, current, opts.folds, opts.step).oos;
  if (!chosen) return { accepted: false, params: current, base, tried: cands.length };
  const oos = evaluateOOS(series, chosen.params, opts.folds, opts.step).oos;
  const decision = decide(base, oos);
  return { accepted: decision.accept, params: decision.accept ? chosen.params : current, base, best: { change: chosen.change, inSample: chosen.inSample, oos, decision }, tried: cands.length };
}
