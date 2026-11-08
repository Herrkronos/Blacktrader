// Kernposition: Im bestätigten Aufwärtstrend halten, nach beendeter 5. Welle Gewinne mitnehmen,
// nach gefundenem Boden (abgeschlossene Korrektur / neue Welle 1-2) wieder einsteigen.
import type { Candle } from "../types";
import { analyzeElliott, type WaveCount } from "./elliott";
import { ema } from "./indicators";
import { LOCKED } from "./locked-config";
import { performance, tradeReturnPct, type PerformanceStats } from "./stats";

export type CoreState = "flat" | "hold" | "wait-bottom";

export interface CoreOptions {
  /** Mindestqualität einer Zählung, damit sie zählt */
  minQuality: number;
  /** Berücksichtigte Wellengrade */
  degrees: string[];
  warmup: number;
  window: number;
  step?: number;
}

/** Gewählt auf Entwicklungsdaten, bestätigt auf Prüf- und frischen Gold-Daten – siehe scripts/evaluate.ts (CORE). */
export const DEFAULT_CORE_OPTIONS: CoreOptions = { minQuality: LOCKED.core.minQuality, degrees: [...LOCKED.core.degrees], warmup: 200, window: 400 };

export interface CoreSignal {
  trendUp: boolean;
  /** Impuls aufwärts abgeschlossen (Welle 5 beendet) */
  wave5Done?: WaveCount;
  /** Boden gefunden (Korrektur beendet bzw. Welle 1-2 aufwärts) */
  bottom?: WaveCount;
}

/** Bewertet den aktuellen Stand für die Kernposition. */
export function coreSignal(candles: Candle[], o: CoreOptions = DEFAULT_CORE_OPTIONS): CoreSignal {
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const e200 = ema(closes, Math.min(200, Math.floor(closes.length * 0.6)))[closes.length - 1];
  const e50 = ema(closes, 50)[closes.length - 1];
  const trendUp = e200 != null && e50 != null && price > e200 && e50 > e200;
  const el = analyzeElliott(candles);
  const ok = (c: WaveCount) => o.degrees.includes(c.degree) && c.quality >= o.minQuality;
  const wave5Done = el.counts.find((c) => ok(c) && c.complete && c.direction === 1 && (c.pattern === "impulse" || c.pattern === "ending-diagonal"));
  const bottom = el.counts.find(
    (c) =>
      ok(c) &&
      c.bias === 1 &&
      ((c.complete && c.direction === -1 && c.pattern !== "impulse" && c.pattern !== "ending-diagonal" && c.pattern !== "leading-diagonal") ||
        (c.pattern === "impulse" && !c.complete && c.labels.length === 2 && c.direction === 1)),
  );
  return { trendUp, wave5Done, bottom };
}

export interface CoreSegment {
  entryTime: number;
  entry: number;
  exitTime: number;
  exit: number;
  reason: "welle5" | "trendbruch" | "ende";
  returnPct: number;
}

export interface CoreResult {
  segments: CoreSegment[];
  stats: PerformanceStats;
  buyAndHold: number;
  /** Anteil der Zeit investiert */
  exposure: number;
  /** Größter Rückgang Kerze für Kerze (Kernposition bzw. Halten), in % */
  maxDrawdown: number;
  holdMaxDrawdown: number;
  /** Equity-Kurve (Zeit, kumuliert %) */
  curve: { time: number; cumulative: number }[];
}

export interface CoreEvent {
  index: number;
  type: "einstieg" | "welle5" | "trendbruch" | "boden" | "neues-hoch";
}

type CoreRun = { state: CoreState; events: CoreEvent[]; wave5Top: number; lastSignal: CoreSignal | null };

/** Zustandsmaschine über einen Kerzenbereich (gemeinsam für EchoChart und Live-Status). Generator mit Fortschritt. */
function* coreSteps(candles: Candle[], from: number, step: number, o: CoreOptions): Generator<number, CoreRun> {
  let state: CoreState = "flat";
  let wave5Top = Infinity;
  const events: CoreEvent[] = [];
  let lastSignal: CoreSignal | null = null;
  let n = 0;
  for (let i = from; i < candles.length; i += step) {
    if (++n % 25 === 0) yield (i - from) / Math.max(1, candles.length - from);
    const sig = coreSignal(candles.slice(Math.max(0, i + 1 - o.window), i + 1), o);
    lastSignal = sig;
    const price = candles[i].close;
    if (state === "hold") {
      if (!sig.trendUp) {
        events.push({ index: i, type: "trendbruch" });
        state = "flat";
      } else if (sig.wave5Done) {
        events.push({ index: i, type: "welle5" });
        wave5Top = sig.wave5Done.pivots[sig.wave5Done.pivots.length - 1].price;
        state = "wait-bottom";
      }
    } else if (state === "wait-bottom") {
      if (!sig.trendUp && price < wave5Top) state = "flat";
      else if (sig.bottom || price > wave5Top) {
        events.push({ index: i, type: sig.bottom ? "boden" : "neues-hoch" });
        state = "hold";
      }
    } else if (sig.trendUp && !sig.wave5Done) {
      events.push({ index: i, type: "einstieg" });
      state = "hold";
    }
  }
  return { state, events, wave5Top, lastSignal };
}

export function runCoreStates(candles: Candle[], from: number, step: number, o: CoreOptions): CoreRun {
  const g = coreSteps(candles, from, step, o);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

export interface CoreStatus {
  state: CoreState;
  /** Letztes Ereignis (Kerzen-Index, Zeit, Kurs) */
  last?: { type: CoreEvent["type"]; time: number; price: number };
  wave5Top?: number;
}

/** Aktueller Stand der Kernposition: Zustandsmaschine über die letzten `lookback` Kerzen. */
export function coreStatus(candles: Candle[], lookback = 150, o: CoreOptions = DEFAULT_CORE_OPTIONS): CoreStatus | null {
  if (candles.length < 120) return null;
  const from = Math.max(Math.min(o.warmup, candles.length - 1), candles.length - lookback);
  const r = runCoreStates(candles, from, 1, o);
  const ev = r.events[r.events.length - 1];
  return {
    state: r.state,
    last: ev ? { type: ev.type, time: candles[ev.index].time, price: candles[ev.index].close } : undefined,
    wave5Top: Number.isFinite(r.wave5Top) ? r.wave5Top : undefined,
  };
}

/** EchoChart der Kernposition (nur long). */
export function runCoreBacktest(candles: Candle[], opts: Partial<CoreOptions> = {}): CoreResult {
  const o = { ...DEFAULT_CORE_OPTIONS, ...opts };
  const step = o.step ?? Math.max(1, Math.ceil((candles.length - o.warmup) / 4000));
  return buildCoreResult(candles, o, runCoreStates(candles, o.warmup, step, o));
}

/** Wie runCoreBacktest, gibt aber zwischendurch die Oberfläche frei. */
export async function runCoreBacktestAsync(candles: Candle[], opts: Partial<CoreOptions> = {}, onProgress?: (p: number) => void): Promise<CoreResult> {
  const o = { ...DEFAULT_CORE_OPTIONS, ...opts };
  const step = o.step ?? Math.max(1, Math.ceil((candles.length - o.warmup) / 4000));
  const g = coreSteps(candles, o.warmup, step, o);
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
  return buildCoreResult(candles, o, r.value);
}

function buildCoreResult(candles: Candle[], o: CoreOptions, run: CoreRun): CoreResult {
  const { state, events } = run;
  const segments: CoreSegment[] = [];
  let investedBars = 0;
  let entryIdx = -1;
  for (const ev of events) {
    if (ev.type === "einstieg" || ev.type === "boden" || ev.type === "neues-hoch") entryIdx = ev.index;
    else if (entryIdx >= 0) {
      const e = candles[entryIdx].close;
      const x = candles[ev.index].close;
      segments.push({ entryTime: candles[entryIdx].time, entry: e, exitTime: candles[ev.index].time, exit: x, reason: ev.type === "welle5" ? "welle5" : "trendbruch", returnPct: tradeReturnPct("long", e, x) });
      investedBars += ev.index - entryIdx;
      entryIdx = -1;
    }
  }
  if (state === "hold" && entryIdx >= 0) {
    const i = candles.length - 1;
    const e = candles[entryIdx].close;
    segments.push({ entryTime: candles[entryIdx].time, entry: e, exitTime: candles[i].time, exit: candles[i].close, reason: "ende", returnPct: tradeReturnPct("long", e, candles[i].close) });
    investedBars += i - entryIdx;
  }
  const stats = performance(segments.map((s) => ({ returnPct: s.returnPct, closedAt: s.exitTime * 1000 })));
  const first = candles[o.warmup]?.close ?? candles[0].close;
  const last = candles[candles.length - 1].close;
  // Equity Kerze für Kerze (investiert = Kursveränderung, sonst unverändert)
  const inv = new Uint8Array(candles.length);
  for (const sgm of segments) for (let k = 0; k < candles.length; k++) if (candles[k].time > sgm.entryTime && candles[k].time <= sgm.exitTime) inv[k] = 1;
  let eq = 1, peak = 1, dd = 0, hpeak = first, hdd = 0;
  const curve: CoreResult["curve"] = [];
  for (let k = o.warmup + 1; k < candles.length; k++) {
    if (inv[k]) eq *= candles[k].close / candles[k - 1].close;
    peak = Math.max(peak, eq);
    dd = Math.min(dd, eq / peak - 1);
    hpeak = Math.max(hpeak, candles[k].close);
    hdd = Math.min(hdd, candles[k].close / hpeak - 1);
    if (k % Math.max(1, Math.floor(candles.length / 400)) === 0 || k === candles.length - 1) curve.push({ time: candles[k].time * 1000, cumulative: (eq - 1) * 100 });
  }
  return {
    segments,
    stats,
    buyAndHold: ((last - first) / first) * 100,
    exposure: investedBars / Math.max(1, candles.length - o.warmup),
    maxDrawdown: dd * 100,
    holdMaxDrawdown: hdd * 100,
    curve,
  };
}
