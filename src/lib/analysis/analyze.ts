// Fasst alle Analyse-Module zu einem Ergebnis zusammen.
import { HORIZON_LABEL, type Candle, type Fundamentals, type Horizon, type Interval, type NewsItem } from "../types";
import { analyzeElliott, type ElliottResult } from "./elliott";
import { atr, ema } from "./indicators";
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

/** Zusätzliche, strengere Prüfungen (machen Einstiege nie leichter). */
export interface AnalyzerFilters {
  /** Nur in Richtung des übergeordneten Trends (EMA 50/200) handeln */
  trend: "off" | "no-counter" | "with";
  /** Letzte Kerze muss in Signalrichtung schließen */
  confirm: boolean;
  /** Mindestabstand des Stops in ATR */
  minStopAtr: number;
}

/**
 * Standard nach Messung auf echten Kursreihen (S&P 500, Google, EUR/USD, Gold 2016):
 * Trendfilter + Stop mit mind. 2 ATR Abstand verbesserten Trefferquote und Gewinnfaktor
 * auf Entwicklungs- und Prüfdaten gegenüber ohne Filter. Siehe scripts/evaluate.ts.
 */
export const DEFAULT_FILTERS: AnalyzerFilters = { trend: "with", confirm: false, minStopAtr: 2 };

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
  filters?: Partial<AnalyzerFilters>;
  kind?: "stock" | "crypto" | "commodity";
  /** Währung für Texte, z. B. EUR */
  currency?: string;
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
  const f = { ...DEFAULT_FILTERS, ...(input.filters ?? {}) };
  const closes = candles.map((c) => c.close);
  const atrNow = atr(candles)[candles.length - 1] ?? price * 0.01;
  const plan = buildPlan(elliott.best, price, f.minStopAtr * atrNow);
  const extraVetoes: string[] = [];
  if (plan && f.trend !== "off") {
    const e200 = ema(closes, Math.min(200, Math.floor(closes.length * 0.6)))[closes.length - 1];
    const e50 = ema(closes, 50)[closes.length - 1];
    const dir = plan.direction === "long" ? 1 : -1;
    const trend = e200 == null || e50 == null ? 0 : price > e200 && e50 > e200 ? 1 : price < e200 && e50 < e200 ? -1 : 0;
    if (trend === -dir) extraVetoes.push("Gegen den übergeordneten Trend");
    else if (f.trend === "with" && trend === 0) extraVetoes.push("Kein klarer übergeordneter Trend");
  }
  if (plan && f.confirm) {
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const dir = plan.direction === "long" ? 1 : -1;
    if (!((last.close - last.open) * dir > 0 && (last.close - prev.close) * dir > 0)) extraVetoes.push("Noch keine Bestätigung durch den Kurs");
  }
  const decision = decideSignal(total, {
    elliottConfidence: elliott.confidence,
    contested: elliott.contested,
    plan,
    elliottBias: elliott.best?.bias,
    extraVetoes,
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
    kind: input.kind,
    currency: input.currency,
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
