// Zustand des Trainers: Parameter-Versionen, Änderungsprotokoll, Verlauf, laufender Lern-Job.
// Reine Datenlogik ohne Speicherzugriff (testbar).
import type { LearnableParams, ParamSet } from "../analysis/params";
import { metrics, type Metrics } from "./engine";
import type { CellKey, SeriesSpec } from "./universe";

export interface ParamVersion {
  id: number;
  createdAt: string;
  params: ParamSet;
  reason: string;
  parent?: number;
}

export type LogKind = "angenommen" | "abgelehnt" | "zurückgesetzt" | "abschlusstest" | "info";

export interface LogEntry {
  date: string;
  kind: LogKind;
  cell?: CellKey;
  version?: number;
  change?: string;
  reason: string;
  base?: Metrics;
  cand?: Metrics;
}

export interface HistoryPoint {
  date: string;
  cell: CellKey;
  /** "backtest" = unbekannte Prüfdaten (Walk-Forward), "live" = abgeschlossene Signale aus dem Protokoll */
  source: "backtest" | "live";
  hitRate: number;
  profitFactor: number;
  trades: number;
  version: number;
}

export interface CellStatus {
  updated: string;
  version: number;
  /** Aktueller Stand auf unbekannten Prüfdaten */
  oos: Metrics;
  series: number;
  /** Beste Trefferquote, die ein geprüfter Kandidat auf unbekannten Daten erreicht hat */
  bestSeen?: Metrics;
  note?: string;
}

export interface FinalTest {
  version: number;
  date: string;
  cells: Partial<Record<CellKey, Metrics>>;
}

/** Ergebnis einer Arbeitseinheit (eine Reihe, ein Parametersatz): Rendite % und Ausstiegszeit je Trade. */
export interface UnitResult {
  r: number[];
  t: number[];
  months: number;
}

export interface TrainJob {
  type: "train";
  cell: CellKey;
  baseVersion: number;
  startedAt: string;
  phase: "in" | "oos";
  /** Index 0 = aktueller Stand, danach Kandidaten */
  candidates: { change: string; params: LearnableParams }[];
  specs: SeriesSpec[];
  /** results[Kandidat][Reihe] */
  results: (UnitResult | null)[][];
  /** In Phase "oos": [Stand, gewählter Kandidat] */
  chosen?: number;
  inSample?: Metrics[];
  failed: string[];
}

export interface FinalJob {
  type: "final";
  version: number;
  startedAt: string;
  cellIdx: number;
  specs: Partial<Record<CellKey, SeriesSpec[]>>;
  results: Partial<Record<CellKey, (UnitResult | null)[]>>;
  failed: string[];
}

export interface TrainerState {
  schema: 1;
  versions: ParamVersion[];
  current: number;
  log: LogEntry[];
  history: HistoryPoint[];
  cells: Partial<Record<CellKey, CellStatus>>;
  job: TrainJob | FinalJob | null;
  /** Nächste Zelle in der Reihenfolge */
  rotation: number;
  /** Zähler für die Auswahl der Stellschrauben */
  round: number;
  finalTests: FinalTest[];
  lastRun?: string;
  lastRunNote?: string;
}

export const MAX_LOG = 400;
export const MAX_HISTORY = 3000;

export function initialState(now = new Date()): TrainerState {
  return {
    schema: 1,
    versions: [{ id: 1, createdAt: now.toISOString(), params: {}, reason: "Ausgangsstand: feste Methode mit Standardwerten" }],
    current: 1,
    log: [{ date: now.toISOString(), kind: "info", version: 1, reason: "Trainer gestartet (Version 1 = Standardwerte)" }],
    history: [],
    cells: {},
    job: null,
    rotation: 0,
    round: 0,
    finalTests: [],
  };
}

export const currentVersion = (s: TrainerState): ParamVersion => s.versions.find((v) => v.id === s.current) ?? s.versions[0];

export function addLog(s: TrainerState, e: Omit<LogEntry, "date"> & { date?: string }): void {
  s.log.unshift({ date: new Date().toISOString(), ...e });
  if (s.log.length > MAX_LOG) s.log.length = MAX_LOG;
}

export function addHistory(s: TrainerState, p: HistoryPoint): void {
  s.history.push(p);
  if (s.history.length > MAX_HISTORY) s.history.splice(0, s.history.length - MAX_HISTORY);
}

/** Neue Version mit geänderten Werten für eine Zelle (alle anderen Zellen bleiben). */
export function addVersion(s: TrainerState, cell: CellKey, params: Partial<LearnableParams>, reason: string): ParamVersion {
  const cur = currentVersion(s);
  const v: ParamVersion = {
    id: Math.max(...s.versions.map((x) => x.id)) + 1,
    createdAt: new Date().toISOString(),
    params: { ...cur.params, [cell]: params },
    reason,
    parent: cur.id,
  };
  s.versions.push(v);
  s.current = v.id;
  return v;
}

/** Zurück auf die vorherige Version (Vorgänger der aktuellen). */
export function rollback(s: TrainerState): ParamVersion | null {
  const cur = currentVersion(s);
  const prevId = cur.parent ?? s.versions.filter((v) => v.id < cur.id).map((v) => v.id).sort((a, b) => b - a)[0];
  const prev = s.versions.find((v) => v.id === prevId);
  if (!prev) return null;
  s.current = prev.id;
  if (s.job?.type === "train") s.job = null; // laufender Lernschritt bezog sich auf die alte Version
  addLog(s, { kind: "zurückgesetzt", version: prev.id, reason: `Zurückgesetzt von Version ${cur.id} auf Version ${prev.id}` });
  return prev;
}

/** Nur geänderte Werte speichern (Unterschied zu den Standardwerten). */
export function diffParams(p: LearnableParams, defaults: LearnableParams): Partial<LearnableParams> {
  const out: Partial<LearnableParams> = {};
  for (const k of Object.keys(p) as (keyof LearnableParams)[]) {
    if (JSON.stringify(p[k]) !== JSON.stringify(defaults[k])) (out as Record<string, unknown>)[k] = p[k];
  }
  return out;
}

export function toUnit(trades: { returnPct: number; exitTime: number }[], months: number): UnitResult {
  return { r: trades.map((t) => Math.round(t.returnPct * 100) / 100), t: trades.map((t) => t.exitTime), months: Math.round(months * 100) / 100 };
}

export function unitMetrics(units: (UnitResult | null)[]): Metrics {
  const trades: { returnPct: number; exitTime: number }[] = [];
  let months = 0;
  for (const u of units) {
    if (!u) continue;
    u.r.forEach((r, i) => trades.push({ returnPct: r, exitTime: u.t[i] }));
    months += u.months;
  }
  return metrics(trades, months);
}
