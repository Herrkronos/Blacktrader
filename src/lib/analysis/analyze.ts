// Fasst alle Analyse-Module zu einem Ergebnis zusammen.
import { HORIZON_LABEL, type Candle, type Fundamentals, type Horizon, type Interval, type NewsItem } from "../types";
import { analyzeElliott, type ElliottResult } from "./elliott";
import { analyzeFundamentals, type FundamentalResult } from "./fundamental";
import { writeCommentary, type Commentary } from "./persona";
import { buildPlan, decideSignal, DEFAULT_WEIGHTS, totalScore, type SignalDecision, type TradePlan, type Weights } from "./score";
import { analyzeVolumeRsi, type VolumeRsiResult } from "./volume";

export interface AnalysisResult {
  symbol: string;
  horizon: Horizon;
  interval: Interval;
  price: number;
  time: number;
  elliott: ElliottResult;
  fundamental: FundamentalResult;
  volume: VolumeRsiResult;
  total: number;
  decision: SignalDecision;
  plan: TradePlan | null;
  commentary: Commentary;
}

export interface AnalyzeInput {
  symbol: string;
  name: string;
  candles: Candle[];
  horizon: Horizon;
  interval: Interval;
  fundamentals?: Fundamentals | null;
  news?: NewsItem[];
  weights?: Weights;
  /** Aktueller Live-Kurs (überschreibt den letzten Schlusskurs) */
  livePrice?: number;
  now?: number;
}

const MAX_CANDLES = 600;

export function analyze(input: AnalyzeInput): AnalysisResult | null {
  let candles = input.candles.slice(-MAX_CANDLES);
  if (candles.length < 30) return null;
  if (input.livePrice && input.livePrice > 0) {
    const last = { ...candles[candles.length - 1] };
    last.close = input.livePrice;
    last.high = Math.max(last.high, input.livePrice);
    last.low = Math.min(last.low, input.livePrice);
    candles = [...candles.slice(0, -1), last];
  }
  const price = candles[candles.length - 1].close;
  const elliott = analyzeElliott(candles);
  const fundamental = analyzeFundamentals(input.fundamentals ?? null, input.news ?? [], input.now);
  const volume = analyzeVolumeRsi(candles, elliott.best);
  const total = totalScore({ elliott: elliott.score, fundamental: fundamental.score, volume: volume.score }, input.weights ?? DEFAULT_WEIGHTS);
  const plan = buildPlan(elliott.best, price);
  const decision = decideSignal(total, {
    elliottConfidence: elliott.confidence,
    contested: elliott.contested,
    plan,
    elliottBias: elliott.best?.bias,
  });
  const commentary = writeCommentary({
    symbol: input.symbol,
    name: input.name,
    price,
    elliott,
    fundamental,
    volume,
    total,
    decision,
    plan,
    news: input.news ?? [],
    horizonLabel: HORIZON_LABEL[input.horizon],
  });
  return {
    symbol: input.symbol,
    horizon: input.horizon,
    interval: input.interval,
    price,
    time: candles[candles.length - 1].time,
    elliott,
    fundamental,
    volume,
    total,
    decision,
    plan,
    commentary,
  };
}
