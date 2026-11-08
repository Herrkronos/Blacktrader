// Fortsetzbarer Server-Job mit Zeitbudget (Vercel-Funktionen laufen max. 60 s).
// Je Zelle (Anlageklasse × Horizont) ein Walk-Forward-Lernschritt (walkforward.ts), danach Entscheidung
// nach den Strenge-Regeln. Die letzten 12 Monate bleiben gesperrt (einmaliger Abschlusstest je Version).
import { DEFAULT_PARAMS, resolveParams, type LearnableParams } from "../analysis/params";
import type { AssetKind, Candle, Horizon } from "../types";
import { holdoutSeries, MIN_SIGNALS_VALID, type Metrics } from "./engine";
import { addHistory, addLog, addVersion, currentVersion, diffParams, toUnit, unitMetrics, type FinalJob, type TrainerState, type TrainJob, type UnitResult } from "./state";
import { CELL_KEYS, universe, type CellKey, type SeriesSpec } from "./universe";
import { advanceWF, initWF, type WFResult } from "./walkforward";

export type Loader = (spec: SeriesSpec) => Promise<Candle[]>;
export type Universe = (cell: CellKey) => SeriesSpec[];

export const SERVER_CANDIDATES = 6;
const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")} %`;

export function startTrainJob(s: TrainerState, cell?: CellKey, uni: Universe = universe): TrainJob {
  const c = cell ?? CELL_KEYS[s.rotation % CELL_KEYS.length];
  if (!cell) s.rotation = (s.rotation + 1) % CELL_KEYS.length;
  const [kind, horizon] = c.split(":") as [AssetKind, Horizon];
  const base = resolveParams(currentVersion(s).params, kind, horizon);
  const wf = initWF(c, uni(c), base, { maxSteps: 1, candidatesPerStep: SERVER_CANDIDATES, rotation: s.round * SERVER_CANDIDATES });
  s.round++;
  const job: TrainJob = { type: "train", cell: c, baseVersion: s.current, startedAt: new Date().toISOString(), wf };
  s.job = job;
  return job;
}

export function startFinalJob(s: TrainerState, uni: Universe = universe): FinalJob {
  const job: FinalJob = {
    type: "final",
    version: s.current,
    startedAt: new Date().toISOString(),
    cellIdx: 0,
    specs: Object.fromEntries(CELL_KEYS.map((c) => [c, uni(c)])),
    results: Object.fromEntries(CELL_KEYS.map((c) => [c, uni(c).map(() => null)])),
    failed: [],
  };
  s.job = job;
  return job;
}

/**
 * Ergebnis eines Walk-Forward-Laufs übernehmen oder verwerfen (Server-Lauf und Browser-Training).
 * Gibt die Ergebnis-Meldung zurück ("Verbessert: … – gespeichert" bzw. "Keine Verbesserung … – alter Stand bleibt").
 */
export function applyResult(s: TrainerState, cell: CellKey, r: WFResult, source: string, seriesCount: number): string {
  let msg: string;
  let shown: Metrics = r.base;
  if (r.decision.accept) {
    const v = addVersion(s, cell, diffParams(r.deployed, DEFAULT_PARAMS as LearnableParams), `${source} ${cell}: ${pct(r.base.hitRate)} → ${pct(r.cand.hitRate)} (${r.changes})`, r.cand.hitRate);
    msg = `Verbessert: ${pct(r.base.hitRate)} → ${pct(r.cand.hitRate)} – gespeichert (Version ${v.id})`;
    addLog(s, { kind: "angenommen", cell, version: v.id, change: r.changes, reason: `${source}: ${msg}. Profit-Faktor ${r.base.profitFactor.toFixed(2)} → ${r.cand.profitFactor.toFixed(2)}`, base: r.base, cand: r.cand });
    shown = r.cand;
  } else {
    msg = `Keine Verbesserung (${pct(r.cand.hitRate)}) – alter Stand bleibt`;
    addLog(s, { kind: "abgelehnt", cell, version: s.current, change: r.changes, reason: `${source}: ${msg}. ${r.decision.reasons.join("; ")}`, base: r.base, cand: r.cand });
  }
  const prev = s.cells[cell];
  const bestSeen = [prev?.bestSeen, r.base, r.cand].filter((m): m is Metrics => !!m && m.trades >= MIN_SIGNALS_VALID).sort((a, b) => b.hitRate - a.hitRate)[0] ?? prev?.bestSeen ?? r.base;
  s.cells[cell] = {
    updated: new Date().toISOString(),
    version: s.current,
    oos: shown,
    series: seriesCount,
    bestSeen,
    note: shown.trades < MIN_SIGNALS_VALID ? `erst ${shown.trades} von ${MIN_SIGNALS_VALID} Signalen – Trefferquote noch nicht aussagekräftig` : undefined,
  };
  addHistory(s, { date: new Date().toISOString(), cell, source: "backtest", hitRate: shown.hitRate, profitFactor: shown.profitFactor, trades: shown.trades, version: s.current });
  return msg;
}

class SeriesCache {
  private m = new Map<string, Candle[] | null>();
  constructor(private load: Loader) {}
  async get(spec: SeriesSpec): Promise<Candle[] | null> {
    const k = `${spec.symbol}:${spec.interval}`;
    if (!this.m.has(k)) {
      try {
        const c = await this.load(spec);
        this.m.set(k, c.length >= 300 ? c : null);
      } catch {
        this.m.set(k, null);
      }
    }
    return this.m.get(k) ?? null;
  }
}

/** Bearbeitet den laufenden Job, bis die Zeit um ist. Gibt kurze Notizen zurück. */
export async function runJob(s: TrainerState, load: Loader, deadline: number, opts: { now?: () => number; universe?: Universe; /** Höchstens so viele Jobs abschließen (Tests) */ maxJobs?: number } = {}): Promise<string[]> {
  const now = opts.now ?? Date.now;
  const notes: string[] = [];
  const cache = new SeriesCache(load);
  let guard = 0;
  let finished = 0;
  while (now() < deadline && guard++ < 50) {
    if (!s.job) {
      if (opts.maxJobs != null && finished >= opts.maxJobs) break;
      startTrainJob(s, undefined, opts.universe);
    }
    const job = s.job!;
    if (job.type === "train" && job.baseVersion !== s.current) {
      s.job = null; // Version wurde zwischenzeitlich geändert
      continue;
    }
    const done = job.type === "train" ? await stepTrain(s, job, cache, deadline, now, notes) : await stepFinal(s, job, cache, deadline, now, notes);
    if (!done) break; // Zeit um – beim nächsten Lauf weiter
    if (!s.job) finished++;
  }
  return notes;
}

async function stepTrain(s: TrainerState, job: TrainJob, cache: SeriesCache, deadline: number, now: () => number, notes: string[]): Promise<boolean> {
  const done = await advanceWF(job.wf, { load: (sp) => cache.get(sp), deadline, now });
  if (!done) return false;
  const ok = job.wf.info.filter((x) => x && x !== "failed").length;
  if (!job.wf.result || ok === 0) {
    notes.push(`${job.cell}: keine Kursdaten erreichbar – übersprungen`);
  } else {
    notes.push(`${job.cell}: ${applyResult(s, job.cell, job.wf.result, "Nachtlauf", ok)}`);
  }
  s.job = null;
  return true;
}

async function stepFinal(s: TrainerState, job: FinalJob, cache: SeriesCache, deadline: number, now: () => number, notes: string[]): Promise<boolean> {
  const version = s.versions.find((v) => v.id === job.version) ?? currentVersion(s);
  while (job.cellIdx < CELL_KEYS.length) {
    const cell = CELL_KEYS[job.cellIdx];
    const [kind, horizon] = cell.split(":") as [AssetKind, Horizon];
    const params = resolveParams(version.params, kind, horizon);
    const specs = job.specs[cell] ?? [];
    const res = job.results[cell]!;
    for (let j = 0; j < specs.length; j++) {
      if (res[j] != null) continue;
      if (now() >= deadline) return false;
      const full = await cache.get(specs[j]);
      if (!full) {
        job.failed.push(`${cell} ${specs[j].symbol}`);
        res[j] = EMPTY;
        continue;
      }
      const r = holdoutSeries({ name: specs[j].symbol, kind, horizon, interval: specs[j].interval, candles: full }, params, 12, specs[j].step);
      res[j] = toUnit(r.trades, r.months);
    }
    job.cellIdx++;
  }
  const cells = Object.fromEntries(CELL_KEYS.map((c) => [c, unitMetrics(job.results[c]!)]));
  s.finalTests.push({ version: job.version, date: new Date().toISOString(), cells });
  const summary = CELL_KEYS.filter((c) => cells[c].trades).map((c) => `${c} ${pct(cells[c].hitRate)} (${cells[c].trades})`).join(", ") || "keine Signale";
  addLog(s, { kind: "abschlusstest", version: job.version, reason: `Einmaliger Abschlusstest auf den gesperrten letzten 12 Monaten: ${summary}` });
  notes.push("Abschlusstest fertig");
  s.job = null;
  return true;
}

const EMPTY: UnitResult = { r: [], t: [], months: 0 };
