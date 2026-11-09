// Vergleich ALT (drei getrennte Zeiträume) gegen NEU (ein Szenario pro Wert) auf denselben unbekannten Testdaten.
// Beide Modelle nutzen dieselben Trade-Regeln (Einstieg in der Zone, Stop, Ziel 1, Nachziehen) und denselben
// Langfrist-Bereich. Jedes Signal sieht nur Kerzen, die zum Entscheidungszeitpunkt abgeschlossen waren.
import { DEFAULT_PARAMS } from "../analysis/params";
import { runLongTermEcho, type LongTermZone } from "../analysis/longterm";
import { buildScenario, closedUntil, TF_SECONDS, type ScenarioKind, type TF } from "../analysis/scenario";
import { runZoneBacktest } from "../analysis/zoneBacktest";
import type { ZoneSetup } from "../analysis/zones";
import type { AssetKind, Candle } from "../types";
import { metrics, signalFromAnalysis, type Metrics } from "./engine";

export interface CompareSeries {
  name: string;
  kind: AssetKind;
  frames: Partial<Record<TF, Candle[]>>;
  /** Beginn der Testdaten (Unix-Sekunden) – davor nur Vorlauf */
  testStart: number;
}

export interface SimTrade {
  kind: Exclude<ScenarioKind, "wait">;
  entryTime: number;
  exitTime: number;
  returnPct: number;
}

/** Ein einzelnes Setup ab Kerze `from` durchspielen (dieselben Regeln wie im EchoChart). */
function simulateSetup(c: Candle[], from: number, setup: ZoneSetup): { entryTime: number; exitTime: number; returnPct: number } | null {
  const slice = c.slice(from);
  if (slice.length < 2) return null;
  const r = runZoneBacktest(slice, { warmup: 0, step: 1, window: 1, signalAt: (h) => (h[h.length - 1].time === slice[0].time ? setup : null) });
  const t = r.trades[0];
  return t ? { entryTime: t.entryTime, exitTime: t.exitTime, returnPct: t.returnPct } : null;
}

/** Langfrist-Bereich ab Kerze `from`: drei Teile, Erfolg = Ziel 1, ungültig = Schluss unter dem Wellenstart. */
function simulateCore(c: Candle[], from: number, z: LongTermZone): { entryTime: number; exitTime: number; returnPct: number } | null {
  const fills: number[] = [];
  let first = 0;
  for (let j = from + 1; j < c.length; j++) {
    const k = c[j];
    for (const t of z.tranches) if (!fills.includes(t) && k.low <= t) (fills.push(t), (first ||= k.time));
    const entry = () => fills.reduce((s, x) => s + x, 0) / fills.length;
    if (k.close < z.invalidation) return fills.length ? { entryTime: first, exitTime: k.time, returnPct: ((k.close - entry()) / entry()) * 100 } : null;
    if (k.high >= z.targets[0]) return fills.length ? { entryTime: first, exitTime: k.time, returnPct: ((z.targets[0] - entry()) / entry()) * 100 } : null;
  }
  return null; // offen – zählt nicht
}

const lastClosedIdx = (c: Candle[], sec: number, t: number) => {
  let i = c.length - 1;
  while (i >= 0 && c[i].time + sec > t) i--;
  return i;
};

/** ALT: jede Zeiteinheit (1h, Tag, Woche) für sich + Langfrist-Bereich auf der Woche. */
export function runOldModel(s: CompareSeries): SimTrade[] {
  const out: SimTrade[] = [];
  const horizonTf: TF[] = ["1h", "1d", "1w"];
  for (const tf of horizonTf) {
    const c = s.frames[tf];
    if (!c || c.length < 200) continue;
    const hz = tf === "1h" ? "short" : tf === "1d" ? "medium" : "long";
    const r = runZoneBacktest(c, { warmup: 150, signalAt: (h) => signalFromAnalysis(h, { kind: s.kind, horizon: hz, interval: tf }, DEFAULT_PARAMS) });
    for (const t of r.trades) if (t.entryTime >= s.testStart && t.reason !== "end") out.push({ kind: t.direction === "long" ? "trade" : "short", entryTime: t.entryTime, exitTime: t.exitTime, returnPct: t.returnPct });
  }
  const lc = s.frames["1w"] && s.frames["1w"]!.length >= 200 ? s.frames["1w"]! : s.frames["1d"];
  if (lc) for (const t of runLongTermEcho(lc, undefined, 1).trades) if (t.entryTime >= s.testStart && t.result !== "offen") out.push({ kind: "core", entryTime: t.entryTime, exitTime: t.exitTime, returnPct: t.returnPct });
  return out;
}

/** NEU: an jedem Tagesschluss im Testzeitraum EIN Szenario; eine Position je Wert gleichzeitig. */
export function runNewModel(s: CompareSeries, stepSec?: number): { trades: SimTrade[]; decisions: Record<ScenarioKind, number> } {
  const trades: SimTrade[] = [];
  const decisions: Record<ScenarioKind, number> = { core: 0, trade: 0, short: 0, wait: 0 };
  const exec = s.frames["1d"] ?? s.frames["4h"] ?? s.frames["1h"];
  if (!exec) return { trades, decisions };
  const end = exec[exec.length - 1].time;
  // Entscheidung so oft wie die feinste vorhandene Zeiteinheit schließt (fairer Vergleich mit dem alten 1h-Modell)
  const finest = (["1h", "4h", "1d"] as TF[]).find((tf) => s.frames[tf]);
  stepSec ??= finest ? TF_SECONDS[finest] : 86400;
  const seenCore = new Set<string>();
  let busyUntil = 0;
  for (let t = s.testStart; t <= end; t += stepSec) {
    if (t < busyUntil) continue;
    const frames: Partial<Record<TF, Candle[]>> = {};
    for (const [tf, c] of Object.entries(s.frames) as [TF, Candle[]][]) frames[tf] = closedUntil(c, TF_SECONDS[tf], t);
    const sc = buildScenario({ symbol: s.name, name: s.name, kind: s.kind, frames, now: t * 1000 });
    decisions[sc.kind]++;
    if ((sc.kind === "trade" || sc.kind === "short") && sc.plan && sc.tf) {
      const c = s.frames[sc.tf]!;
      const i = lastClosedIdx(c, TF_SECONDS[sc.tf], t);
      const p = sc.plan;
      const setup: ZoneSetup = {
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
        wave5Exit: !!p.wave5Exit,
      };
      const r = i >= 0 ? simulateSetup(c, i, setup) : null;
      if (r && r.exitTime < c[c.length - 1].time) {
        trades.push({ kind: sc.kind, ...r });
        busyUntil = r.exitTime;
      }
    } else if (sc.kind === "core" && sc.lt && !seenCore.has(sc.lt.key)) {
      seenCore.add(sc.lt.key);
      const c = s.frames["1w"] && s.frames["1w"]!.length >= 150 ? s.frames["1w"]! : s.frames["1d"]!;
      const i = lastClosedIdx(c, TF_SECONDS[c === s.frames["1w"] ? "1w" : "1d"], t);
      const r = i >= 0 ? simulateCore(c, i, sc.lt) : null;
      if (r) {
        trades.push({ kind: "core", ...r });
        busyUntil = r.exitTime;
      }
    }
  }
  return { trades, decisions };
}

export interface CompareRow {
  klass: AssetKind;
  old: Metrics;
  neu: Metrics;
  oldByKind: Record<string, Metrics>;
  neuByKind: Record<string, Metrics>;
}

const monthsBetween = (a: number, b: number) => Math.max(1, (b - a) / (30.44 * 86400));

export function compareModels(series: CompareSeries[]): { rows: CompareRow[]; decisions: Record<ScenarioKind, number> } {
  const by = new Map<AssetKind, { old: SimTrade[]; neu: SimTrade[]; months: number }>();
  const decisions: Record<ScenarioKind, number> = { core: 0, trade: 0, short: 0, wait: 0 };
  for (const s of series) {
    const g = by.get(s.kind) ?? { old: [], neu: [], months: 0 };
    g.old.push(...runOldModel(s));
    const n = runNewModel(s);
    g.neu.push(...n.trades);
    for (const k of Object.keys(decisions) as ScenarioKind[]) decisions[k] += n.decisions[k];
    const exec = s.frames["1d"] ?? s.frames["1h"]!;
    g.months += monthsBetween(s.testStart, exec[exec.length - 1].time);
    by.set(s.kind, g);
  }
  const rows: CompareRow[] = [];
  for (const [klass, g] of by) {
    const m = (ts: SimTrade[]) => metrics(ts.map((t) => ({ returnPct: t.returnPct, exitTime: t.exitTime })), g.months);
    const byKind = (ts: SimTrade[]) => Object.fromEntries(["core", "trade", "short"].map((k) => [k, m(ts.filter((t) => t.kind === k))]));
    rows.push({ klass, old: m(g.old), neu: m(g.neu), oldByKind: byKind(g.old), neuByKind: byKind(g.neu) });
  }
  return { rows, decisions };
}

/** Ist NEU besser? Trefferquote höher UND alle Strenge-Regeln (PF, Drawdown, Signale/Monat ≥ 60 %). */
export function newModelBetter(old: Metrics, neu: Metrics): { better: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (neu.hitRate <= old.hitRate) reasons.push("Trefferquote nicht höher");
  if (neu.profitFactor < old.profitFactor) reasons.push("Profit-Faktor niedriger");
  if (neu.maxDrawdown < old.maxDrawdown) reasons.push("max. Rückgang größer");
  if (old.perMonth > 0 && neu.perMonth < old.perMonth * 0.6) reasons.push("mehr als 40 % weniger Signale");
  return { better: reasons.length === 0, reasons };
}
