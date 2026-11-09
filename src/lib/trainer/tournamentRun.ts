// Turnier rechnen (im Web Worker): Kursdaten laden, Trades aller 8 Teilnehmer erzeugen und 50 Versuche à 5 Jahre
// in echter Zeit durchspielen. Blacktrader spielt in 5 Runden zu je 10 Versuchen; zwischen den Runden lernt er
// (Strenge-Regeln unverändert) und spielt die nächste Runde mit seinem neuesten gespeicherten Stand.
import { TECH_SYMBOLS } from "../analysis/bestEntry";
import { runLongTermEcho } from "../analysis/longterm";
import type { LearnableParams } from "../analysis/params";
import type { AssetKind, Candle, Horizon } from "../types";
import { backtestSeries } from "./engine";
import { makeWindows, OPPONENTS, rank, RULES, runWindow, SCENARIOS, summarizeRuns, type ContestantResult, type PoolTrade, type RunResult, type Scenario, type Series, type TournamentReport, type Window } from "./tournament";
import { universe, type CellKey, type SeriesSpec } from "./universe";

export interface TournamentIO {
  load: (spec: SeriesSpec) => Promise<Candle[] | null>;
  onProgress: (fraction: number, text: string) => void;
  shouldStop: () => boolean;
  extra?: { symbol: string; kind: AssetKind; yahooSymbol?: string }[];
}

export type Params = (kind: AssetKind, horizon: Horizon) => LearnableParams;

const KINDS: AssetKind[] = ["stock", "crypto", "commodity"];
const DAYS = 15 * 365;
const tick = () => new Promise((r) => setTimeout(r, 0));
const DESC = "Elliott-Wellen + Fundamental/News + Volumen/RSI, ein Einstieg pro Wert (blau/grün), keine Shorts, Sektor-Regel";

interface Asset {
  symbol: string;
  kind: AssetKind;
  daily: Candle[];
  weekly: Candle[] | null;
}

export interface Prepared {
  assets: Asset[];
  windows: Window[];
  from: number;
  priceAt: (sym: string, t: number) => number | null;
  techWeakAt: (t: number) => boolean;
  bots: ContestantResult[];
  note: string;
}

/** Daten laden, Zeiträume festlegen und die 7 Gegner spielen lassen (die lernen nicht mit). */
export async function prepareTournament(io: TournamentIO, span: [number, number] = [0, 1]): Promise<Prepared | null> {
  const P = (f: number, t: string) => io.onProgress(span[0] + (span[1] - span[0]) * f, t);
  const specs = new Map<string, { kind: AssetKind; daily: SeriesSpec; weekly: SeriesSpec }>();
  for (const kind of KINDS) {
    const d = universe(`${kind}:medium` as CellKey);
    const w = universe(`${kind}:long` as CellKey);
    d.forEach((s, i) => specs.set(s.symbol, { kind, daily: { ...s, days: DAYS }, weekly: w[i] ?? { ...s, interval: "1w", days: DAYS } }));
  }
  for (const e of io.extra ?? []) {
    const symbol = e.yahooSymbol ?? (e.kind === "crypto" ? `${e.symbol}-USD` : e.symbol);
    if (specs.has(symbol) || symbol.startsWith("^")) continue;
    specs.set(symbol, { kind: e.kind, daily: { symbol, kind: e.kind, horizon: "medium", interval: "1d", days: DAYS, step: 1 }, weekly: { symbol, kind: e.kind, horizon: "long", interval: "1w", days: DAYS, step: 1 } });
  }
  const idx = (symbol: string): SeriesSpec => ({ symbol, kind: "stock", horizon: "medium", interval: "1d", days: DAYS, step: 1 });
  P(0, "Kursdaten laden: S&P 500 und NASDAQ 100");
  const [spx, ndx] = await Promise.all([io.load(idx("^GSPC")), io.load(idx("^NDX"))]);
  if (!spx || spx.length < 1600) return null;
  const ndxCl = (ndx ?? []).map((c) => c.close);
  const techWeakAt = (t: number) => {
    if (!ndx?.length) return false;
    let i = ndx.length - 1;
    while (i > 0 && ndx[i].time > t) i--;
    if (i < 200) return false;
    let m = 0;
    for (let k = i - 199; k <= i; k++) m += ndxCl[k];
    return ndxCl[i] < m / 200;
  };
  const assets: Asset[] = [];
  const list = [...specs.entries()];
  for (let k = 0; k < list.length; k++) {
    if (io.shouldStop()) return null;
    const [symbol, s] = list[k];
    P((0.6 * k) / list.length, `Kursdaten laden: ${symbol}`);
    const [daily, weekly] = await Promise.all([io.load(s.daily), io.load(s.weekly)]);
    if (daily && daily.length > 300) assets.push({ symbol, kind: s.kind, daily, weekly });
  }
  if (assets.length < 10) return null;
  const from = spx[200].time;
  const windows = makeWindows(spx, from);
  if (!windows.length) return null;
  const bySym = new Map(assets.map((a) => [a.symbol, a.daily]));
  const priceAt = (sym: string, t: number) => {
    const c = bySym.get(sym);
    if (!c?.length || c[0].time > t) return null;
    let lo = 0;
    let hi = c.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (c[mid].time <= t) lo = mid;
      else hi = mid - 1;
    }
    return c[lo].close;
  };
  const data: Series[] = assets.map((a) => ({ symbol: a.symbol, candles: a.daily }));
  const bots: ContestantResult[] = [];
  for (let k = 0; k < OPPONENTS.length; k++) {
    if (io.shouldStop()) return null;
    const o = OPPONENTS[k];
    P(0.6 + (0.4 * k) / OPPONENTS.length, `${o.name} handelt`);
    await tick();
    const pool = o.build(data).filter((t) => t.entry >= from);
    bots.push(summarizeRuns(o.id, o.name, o.desc, windows.map((w) => ({ w, r: runWindow(pool, w, priceAt) }))));
  }
  const cnt: Partial<Record<Scenario, number>> = {};
  for (const w of windows) cnt[w.scenario] = (cnt[w.scenario] ?? 0) + 1;
  const note = `${assets.length} Werte (Aktien, Krypto, Rohstoffe), Daten ab ${new Date(from * 1000).toLocaleDateString("de-DE")}, ${windows.length} Zeiträume à 5 Jahre (${SCENARIOS.filter((s) => cnt[s]).map((s) => `${cnt[s]}× ${s === "baerisch" ? "bärisch" : s}`).join(", ")}). Rohstoffe kurzfristig (Stundenkerzen) sind nicht enthalten.`;
  return { assets, windows, from, priceAt, techWeakAt, bots, note };
}

/** Alle Kauf-Trades von Blacktrader mit einem Parameter-Stand (grün: Tag + Woche; blau: Langfrist-Bereich). */
export async function blacktraderPool(prep: Prepared, params: Params, io: TournamentIO, span: [number, number], label: string): Promise<PoolTrade[] | null> {
  const out: PoolTrade[] = [];
  const { assets, from, techWeakAt } = prep;
  for (let k = 0; k < assets.length; k++) {
    if (io.shouldStop()) return null;
    const a = assets[k];
    io.onProgress(span[0] + ((span[1] - span[0]) * k) / assets.length, `${label}: ${a.symbol}`);
    const tech = TECH_SYMBOLS.has(a.symbol);
    const green = (t: { direction: string; reason: string; entryTime: number; exitTime: number; returnPct: number; entry: number }) => {
      if (t.direction !== "long" || t.reason === "end" || t.entryTime < from) return;
      if (tech && techWeakAt(t.entryTime)) return; // Sektor-Regel
      out.push({ sym: a.symbol, entry: t.entryTime, exit: t.exitTime, r: t.returnPct, px: t.entry, color: "gruen" });
    };
    try {
      if (a.daily.length > 300) for (const t of backtestSeries({ name: a.symbol, kind: a.kind, horizon: "medium", interval: "1d", candles: a.daily }, params(a.kind, "medium"), { step: 1 }).trades) green(t);
      if (a.weekly && a.weekly.length > 200) {
        for (const t of backtestSeries({ name: a.symbol, kind: a.kind, horizon: "long", interval: "1w", candles: a.weekly }, params(a.kind, "long"), { step: 1 }).trades) green(t);
        for (const t of runLongTermEcho(a.weekly, undefined, 1).trades) if (t.result !== "offen" && t.entryTime >= from) out.push({ sym: a.symbol, entry: t.entryTime, exit: t.exitTime, r: t.returnPct, px: t.entry, color: "blau" });
      }
    } catch {
      /* Wert überspringen */
    }
    await tick();
  }
  return out;
}

/** Versuche einer Runde (Runde b spielt die Zeiträume b, b+5, b+10, … – so ist jede Runde gemischt). */
export const roundWindows = (prep: Prepared, round: number) => prep.windows.map((w, i) => ({ w, i })).filter((x) => x.i % RULES.rounds === round);

export function playRound(prep: Prepared, pool: PoolTrade[], round: number): { w: Window; r: RunResult }[] {
  return roundWindows(prep, round).map(({ w }) => ({ w, r: runWindow(pool, w, prep.priceAt) }));
}

export function buildReport(prep: Prepared, btRuns: { w: Window; r: RunResult }[], rounds: TournamentReport["rounds"], finalPool: PoolTrade[], improvedCells: TournamentReport["improvedCells"]): TournamentReport {
  const bt = summarizeRuns("blacktrader", "Blacktrader", DESC, btRuns);
  const ranking = rank([bt, ...prep.bots.map((b) => ({ ...b, rankByScenario: {} }))]);
  const only = (c: "blau" | "gruen") => {
    const p = finalPool.filter((t) => t.color === c);
    return p.length ? summarizeRuns(`bt-${c}`, `Blacktrader nur ${c === "blau" ? "Blau" : "Grün"}`, "", prep.windows.map((w) => ({ w, r: runWindow(p, w, prep.priceAt) }))) : null;
  };
  const scenarioCount: Partial<Record<Scenario, number>> = {};
  for (const w of prep.windows) scenarioCount[w.scenario] = (scenarioCount[w.scenario] ?? 0) + 1;
  return { v: 2, at: new Date().toISOString(), rules: { ...RULES }, ranking, scenarioCount, rounds, split: { blau: only("blau"), gruen: only("gruen") }, improvedCells, note: prep.note };
}
