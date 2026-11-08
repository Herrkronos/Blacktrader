// Fortsetzbarer Lern-Job mit Zeitbudget (Vercel-Funktionen laufen max. 60 s).
// Ablauf je Zelle (Anlageklasse × Horizont):
//   Phase "in":  aktueller Stand + wenige Kandidaten (kleine Schritte) NUR auf den Lerndaten bewerten.
//   Phase "oos": den besten Kandidaten und den Stand auf den UNBEKANNTEN Prüfdaten (Walk-Forward) vergleichen.
//   Entscheidung nach den Regeln gegen Selbstbetrug (decide). Die letzten 12 Monate bleiben gesperrt.
import { DEFAULT_PARAMS, resolveParams, type LearnableParams } from "../analysis/params";
import type { AssetKind, Candle, Horizon } from "../types";
import { decide, effectiveKeys, holdoutSeries, inSampleSeries, MIN_SIGNALS_VALID, neighbours, oosSeries, preselect, splitHoldout, type Metrics, type Series } from "./engine";
import { addHistory, addLog, addVersion, currentVersion, diffParams, toUnit, unitMetrics, type FinalJob, type TrainerState, type TrainJob, type UnitResult } from "./state";
import { CELL_KEYS, universe, type CellKey, type SeriesSpec } from "./universe";

export type Loader = (spec: SeriesSpec) => Promise<Candle[]>;

export const CANDIDATES_PER_ROUND = 6;
const FOLDS = 4;
const pct = (x: number) => `${(x * 100).toFixed(1)} %`;

export type Universe = (cell: CellKey) => SeriesSpec[];

export function startTrainJob(s: TrainerState, cell?: CellKey, uni: Universe = universe): TrainJob {
  const c = cell ?? CELL_KEYS[s.rotation % CELL_KEYS.length];
  if (!cell) s.rotation = (s.rotation + 1) % CELL_KEYS.length;
  const [kind, horizon] = c.split(":") as [AssetKind, Horizon];
  const current = resolveParams(currentVersion(s).params, kind, horizon);
  const all = neighbours(current, effectiveKeys(current), false);
  const off = all.length ? (s.round * CANDIDATES_PER_ROUND) % all.length : 0;
  const picked = [...all.slice(off), ...all.slice(0, off)].slice(0, CANDIDATES_PER_ROUND);
  s.round++;
  const candidates = [{ change: "aktueller Stand", params: current }, ...picked];
  const specs = uni(c);
  const job: TrainJob = {
    type: "train",
    cell: c,
    baseVersion: s.current,
    startedAt: new Date().toISOString(),
    phase: "in",
    candidates,
    specs,
    results: candidates.map(() => specs.map(() => null)),
    failed: [],
  };
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

const EMPTY: UnitResult = { r: [], t: [], months: 0 };

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

function toSeries(spec: SeriesSpec, candles: Candle[]): Series {
  return { name: spec.symbol, kind: spec.kind, horizon: spec.horizon, interval: spec.interval, candles };
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
  const specs = job.specs;
  for (let j = 0; j < specs.length; j++) {
    if (job.results.every((row) => row[j] != null)) continue;
    if (now() >= deadline) return false;
    const spec = specs[j];
    const full = await cache.get(spec);
    if (!full) {
      if (!job.failed.includes(spec.symbol)) job.failed.push(spec.symbol);
      job.results.forEach((row) => (row[j] = EMPTY));
      continue;
    }
    const series = toSeries(spec, splitHoldout(full, 12).train); // letzte 12 Monate gesperrt
    for (let i = 0; i < job.results.length; i++) {
      if (job.results[i][j] != null) continue;
      if (now() >= deadline) return false;
      const params = job.phase === "in" ? job.candidates[i].params : job.candidates[i === 0 ? 0 : job.chosen!].params;
      const r = job.phase === "in" ? inSampleSeries(series, params, FOLDS, spec.step) : oosSeries(series, params, FOLDS, spec.step);
      job.results[i][j] = toUnit(r.trades, r.months);
    }
  }
  if (job.phase === "in") {
    const ins = job.results.map((row) => unitMetrics(row));
    job.inSample = ins;
    let best = -1;
    for (let i = 1; i < ins.length; i++) if (preselect(ins[0], ins[i]) && (best < 0 || ins[i].hitRate > ins[best].hitRate)) best = i;
    job.phase = "oos";
    job.chosen = best > 0 ? best : undefined;
    job.results = (best > 0 ? [0, best] : [0]).map(() => job.specs.map(() => null));
    notes.push(`${job.cell}: Lerndaten bewertet (${ins.length - 1} Kandidaten)`);
    return true;
  }
  finishTrain(s, job, notes);
  return true;
}

function finishTrain(s: TrainerState, job: TrainJob, notes: string[]) {
  if (job.failed.length >= job.specs.length) {
    // Keine Kursdaten erreichbar: nichts bewerten, nichts überschreiben
    notes.push(`${job.cell}: keine Kursdaten erreichbar – übersprungen`);
    s.job = null;
    return;
  }
  const base = unitMetrics(job.results[0]);
  const prev = s.cells[job.cell];
  const tried = job.candidates.slice(1).map((c) => c.change).join(", ") || "keine";
  let accepted = false;
  let shown: Metrics = base;
  let best = prev?.bestSeen && prev.bestSeen.hitRate > base.hitRate ? prev.bestSeen : base;
  if (job.chosen != null) {
    const cand = unitMetrics(job.results[1]);
    const change = job.candidates[job.chosen].change;
    if (cand.trades >= Math.min(MIN_SIGNALS_VALID, base.trades) && cand.hitRate > best.hitRate) best = cand;
    const d = decide(base, cand);
    if (d.accept) {
      const v = addVersion(s, job.cell, diffParams(job.candidates[job.chosen].params, DEFAULT_PARAMS as LearnableParams), `${job.cell}: ${change}`);
      addLog(s, { kind: "angenommen", cell: job.cell, version: v.id, change, reason: `Auf unbekannten Daten besser: Trefferquote ${pct(base.hitRate)} → ${pct(cand.hitRate)}, Profit-Faktor ${base.profitFactor.toFixed(2)} → ${cand.profitFactor.toFixed(2)}`, base, cand });
      shown = cand;
      accepted = true;
    } else {
      addLog(s, { kind: "abgelehnt", cell: job.cell, version: s.current, change, reason: `Auf unbekannten Daten nicht übernommen: ${d.reasons.join("; ")}`, base, cand });
    }
  } else {
    addLog(s, { kind: "abgelehnt", cell: job.cell, version: s.current, change: tried, reason: "Kein Kandidat war schon auf den Lerndaten besser (Trefferquote höher, Profit-Faktor nicht niedriger)", base });
  }
  const valid = shown.trades >= MIN_SIGNALS_VALID;
  s.cells[job.cell] = {
    updated: new Date().toISOString(),
    version: s.current,
    oos: shown,
    series: job.specs.length - job.failed.length,
    bestSeen: best,
    note: [valid ? undefined : `erst ${shown.trades} von ${MIN_SIGNALS_VALID} Signalen – Trefferquote noch nicht aussagekräftig`, job.failed.length ? `ohne Daten: ${job.failed.join(", ")}` : undefined].filter(Boolean).join(" · ") || undefined,
  };
  addHistory(s, { date: new Date().toISOString(), cell: job.cell, source: "backtest", hitRate: shown.hitRate, profitFactor: shown.profitFactor, trades: shown.trades, version: s.current });
  notes.push(`${job.cell}: ${accepted ? "neue Werte übernommen" : "unverändert"} (Prüfdaten ${pct(shown.hitRate)}, ${shown.trades} Signale)`);
  s.job = null;
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
      const r = holdoutSeries(toSeries(specs[j], full), params, 12, specs[j].step);
      res[j] = toUnit(r.trades, r.months);
    }
    job.cellIdx++;
  }
  const cells = Object.fromEntries(CELL_KEYS.map((c) => [c, unitMetrics(job.results[c]!)]));
  s.finalTests.push({ version: job.version, date: new Date().toISOString(), cells });
  const summary = CELL_KEYS.map((c) => `${c} ${pct(cells[c].hitRate)} (${cells[c].trades})`).join(", ");
  addLog(s, { kind: "abschlusstest", version: job.version, reason: `Einmaliger Abschlusstest auf den gesperrten letzten 12 Monaten: ${summary}` });
  notes.push("Abschlusstest fertig");
  s.job = null;
  return true;
}
