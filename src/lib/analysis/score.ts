// Gesamtberechnung, Signalstufen und Trade-Plan.
import type { WaveCount } from "./elliott";

export interface Weights {
  elliott: number;
  fundamental: number;
  volume: number;
}

export const DEFAULT_WEIGHTS: Weights = { elliott: 60, fundamental: 20, volume: 20 };

export type SignalLevel = "strong-buy" | "buy" | "neutral" | "sell" | "strong-sell";

export const SIGNAL_LABEL: Record<SignalLevel, string> = {
  "strong-buy": "Starker Kauf",
  buy: "Kauf",
  neutral: "Neutral",
  sell: "Verkauf",
  "strong-sell": "Starker Verkauf",
};

export function normalizeWeights(w: Weights): Weights {
  const s = w.elliott + w.fundamental + w.volume;
  if (!(s > 0)) return { elliott: 0.6, fundamental: 0.2, volume: 0.2 };
  return { elliott: w.elliott / s, fundamental: w.fundamental / s, volume: w.volume / s };
}

/** Gesamtscore = w_E × Elliott + w_F × Fundamental/News + w_V × Volumen/RSI (Standard 0,6/0,2/0,2). */
export function totalScore(parts: { elliott: number; fundamental: number; volume: number }, weights: Weights = DEFAULT_WEIGHTS): number {
  const w = normalizeWeights(weights);
  return Math.round((w.elliott * parts.elliott + w.fundamental * parts.fundamental + w.volume * parts.volume) * 10) / 10;
}

export function levelFromScore(score: number): SignalLevel {
  if (score >= 72) return "strong-buy";
  if (score >= 58) return "buy";
  if (score <= 28) return "strong-sell";
  if (score <= 42) return "sell";
  return "neutral";
}

export interface TradePlan {
  direction: "long" | "short";
  entry: number;
  stop: number;
  targets: number[];
  riskReward: number;
}

export const MIN_RISK_REWARD = 1.5;

/** Plan aus der besten Zählung: Stop = Invalidierung, Ziele = Fibo-Ziele jenseits des Einstiegs. */
export function buildPlan(count: WaveCount | undefined, price: number): TradePlan | null {
  if (!count) return null;
  const dir = count.bias;
  const risk = (price - count.stop) * dir;
  if (!(risk > 0)) return null;
  const targets = count.targets
    .filter((t) => (t - price) * dir > 0)
    .sort((a, b) => (a - b) * dir)
    .slice(0, 3);
  if (targets.length === 0) return null;
  const reward = Math.abs(targets[0] - price);
  return {
    direction: dir === 1 ? "long" : "short",
    entry: price,
    stop: count.stop,
    targets,
    riskReward: Math.round((reward / risk) * 100) / 100,
  };
}

export interface SignalDecision {
  level: SignalLevel;
  rawLevel: SignalLevel;
  /** Gründe, warum kein Trade empfohlen wird (falls neutralisiert) */
  vetoes: string[];
}

/**
 * Lieber kein Trade als ein schwaches Signal: Signale werden neutralisiert, wenn die Wellenzählung
 * unsicher ist, das Chance-Risiko-Verhältnis nicht reicht oder Elliott der Gesamtrichtung widerspricht.
 */
export function decideSignal(
  score: number,
  opts: { elliottConfidence: number; contested: boolean; plan: TradePlan | null; elliottBias?: 1 | -1 },
): SignalDecision {
  const rawLevel = levelFromScore(score);
  const vetoes: string[] = [];
  if (rawLevel !== "neutral") {
    const dir = rawLevel.includes("buy") ? 1 : -1;
    if (opts.elliottConfidence < 0.25) vetoes.push("Wellenzählung zu unsicher");
    if (opts.contested) vetoes.push("Alternative Zählung mit Gegenrichtung fast gleichwertig");
    if (!opts.plan) vetoes.push("Kein sauberer Plan mit Stop und Ziel ableitbar");
    else {
      if ((opts.plan.direction === "long" ? 1 : -1) !== dir) vetoes.push("Elliott-Szenario widerspricht der Gesamtrichtung");
      if (opts.plan.riskReward < MIN_RISK_REWARD) vetoes.push(`Chance-Risiko ${opts.plan.riskReward.toFixed(2)} unter ${MIN_RISK_REWARD}`);
    }
  }
  return { level: vetoes.length ? "neutral" : rawLevel, rawLevel, vetoes };
}
