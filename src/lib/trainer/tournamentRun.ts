// Turnier rechnen (im Web Worker): Kursdaten laden, Trades aller 8 Teilnehmer erzeugen und 50 Versuche à 5 Jahre
// in echter Zeit durchspielen. Blacktrader spielt in 5 Runden zu je 10 Versuchen; zwischen den Runden lernt er
// (Strenge-Regeln unverändert) und spielt die nächste Runde mit seinem neuesten gespeicherten Stand.
import { TECH_SYMBOLS } from "../analysis/bestEntry";
import { runLongTermEcho } from "../analysis/longterm";
import type { LearnableParams } from "../analysis/params";
import type { AssetKind, Candle, Horizon } from "../types";
import { backtestSeries } from "./engine";
import { basePotential, MIN_POTENTIAL } from "../analysis/potential";
import { benchmarkRun, makeWindows, OPPONENTS, regimeIndex, rank, RULES, runWindow, SCENARIOS, summarizeRuns, type ContestantResult, type PoolTrade, type RunResult, type Scenario, type Series, type TournamentReport, type Window } from "./tournament";
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
const DESC = "Elliott-Wellen + Fundamental/News + Volumen/RSI, ein Einstieg pro Wert (blau/grün/rot), Sektor-Regel";

/** Vergleichsmaßstab: echter, bei flatex handelbarer ETF (Xetra, Euro, thesaurierend → Dividenden im Kurs) */
export const BENCHMARK = { symbol: "SXR8.DE", name: "Vergleich: S&P-500-ETF (iShares Core, SXR8)", desc: "echter ETF in Euro, Dividenden wiederangelegt – alles kaufen, 5 Jahre liegen lassen" };

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
  /** Trades in Euro umrechnen (Wechselkurs am Kauf- und Verkaufstag) */
  toEur: (pool: PoolTrade[]) => PoolTrade[];
  /** Marktlage des S&P 500 zum Zeitpunkt t */
  regimeAt: (t: number) => "bullisch" | "neutral" | "baerisch" | null;
  bots: ContestantResult[];
  /** Vergleich: echter S&P-500-ETF (handelt nicht mit) */
  benchmark?: ContestantResult | null;
  note: string;
}

/** Daten laden, Zeiträume festlegen und die 9 Gegner spielen lassen (die lernen nicht mit). */
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
  P(0, "Kursdaten laden: S&P 500, NASDAQ 100 und Euro/Dollar");
  const [spx, ndx, eurusd, etf] = await Promise.all([io.load(idx("^GSPC")), io.load(idx("^NDX")), io.load(idx("EURUSD=X")), io.load(idx(BENCHMARK.symbol))]);
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
  const closeAt = (c: Candle[] | null | undefined, t: number) => {
    if (!c?.length) return null;
    if (c[0].time > t) return c[0].close;
    let lo = 0;
    let hi = c.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (c[mid].time <= t) lo = mid;
      else hi = mid - 1;
    }
    return c[lo].close;
  };
  // Alles in Euro: Werte außerhalb des Euro-Raums (US-Aktien, Krypto, Rohstoffe) mit dem Euro/Dollar-Kurs des Tages
  const EUR_SUFFIX = [".DE", ".F", ".VI", ".PA", ".AS", ".MI", ".MC", ".BR"];
  const inEur = (sym: string) => EUR_SUFFIX.some((x) => sym.toUpperCase().endsWith(x));
  const eurPer = (sym: string, t: number) => {
    if (inEur(sym)) return 1;
    const r = closeAt(eurusd, t);
    return r && r > 0 ? 1 / r : 1;
  };
  const toEur = (pool: PoolTrade[]): PoolTrade[] =>
    pool.map((p) => ({ ...p, r: ((1 + p.r / 100) * (eurPer(p.sym, p.exit) / eurPer(p.sym, p.entry)) - 1) * 100, px: p.px != null ? p.px * eurPer(p.sym, p.entry) : p.px }));
  const priceAt = (sym: string, t: number) => {
    const c = closeAt(bySym.get(sym), t);
    return c == null ? null : c * eurPer(sym, t);
  };
  const data: Series[] = assets.map((a) => ({ symbol: a.symbol, candles: a.daily }));
  const bots: ContestantResult[] = [];
  for (let k = 0; k < OPPONENTS.length; k++) {
    if (io.shouldStop()) return null;
    const o = OPPONENTS[k];
    P(0.6 + (0.4 * k) / OPPONENTS.length, `${o.name} handelt`);
    await tick();
    const pool = toEur(o.build(data).filter((t) => t.entry >= from));
    bots.push(summarizeRuns(o.id, o.name, o.desc, windows.map((w) => ({ w, r: runWindow(pool, w, priceAt) }))));
  }
  // Vergleich nur, wenn der ETF den ganzen Zeitraum abdeckt (Kurs in Euro, Dividenden im Kurs enthalten)
  const benchmark = etf && etf.length > 300 && etf[0].time <= from + 7 * 86400 ? summarizeRuns("etf", BENCHMARK.name, BENCHMARK.desc, windows.map((w) => ({ w, r: benchmarkRun(etf, w) }))) : null;
  const cnt: Partial<Record<Scenario, number>> = {};
  for (const w of windows) cnt[w.scenario] = (cnt[w.scenario] ?? 0) + 1;
  const note = `Alle Beträge in Euro (Wechselkurs am Kauf- und Verkaufstag${eurusd?.length ? "" : " – Euro/Dollar-Kurs nicht erreichbar, ohne Umrechnung"}). ${assets.length} Werte (Aktien, Krypto, Rohstoffe), Daten ab ${new Date(from * 1000).toLocaleDateString("de-DE")}, ${windows.length} Zeiträume à 5 Jahre (${SCENARIOS.filter((s) => cnt[s]).map((s) => `${cnt[s]}× ${s === "baerisch" ? "bärisch" : s}`).join(", ")}). Rohstoffe kurzfristig (Stundenkerzen) sind nicht enthalten.`;
  return { assets, windows, from, priceAt, techWeakAt, toEur, regimeAt: regimeIndex(spx), bots, benchmark, note };
}

/** Alle Trades von Blacktrader mit einem Parameter-Stand (grün/rot: Tag + Woche; blau: Langfrist-Bereich). */
export async function blacktraderPool(prep: Prepared, params: Params, io: TournamentIO, span: [number, number], label: string): Promise<PoolTrade[] | null> {
  const out: PoolTrade[] = [];
  const { assets, from, techWeakAt, regimeAt } = prep;
  for (let k = 0; k < assets.length; k++) {
    if (io.shouldStop()) return null;
    const a = assets[k];
    io.onProgress(span[0] + ((span[1] - span[0]) * k) / assets.length, `${label}: ${a.symbol}`);
    const tech = TECH_SYMBOLS.has(a.symbol);
    const green = (t: { direction: string; reason: string; entryTime: number; exitTime: number; returnPct: number; entry: number; stop?: number; target?: number; score?: number }) => {
      if (t.reason === "end" || t.entryTime < from) return;
      const short = t.direction === "short";
      if (!short && tech && techWeakAt(t.entryTime)) return; // Sektor-Regel (nur grüne Tech-Trades)
      if (short && regimeAt(t.entryTime) !== "baerisch") return; // Shorts nur bei bärischem Gesamtmarkt (wie in der App)
      const riskPct = t.stop != null ? (Math.abs(t.entry - t.stop) / t.entry) * 100 : undefined;
      const chancePct = t.target != null ? (Math.abs(t.target - t.entry) / t.entry) * 100 : undefined;
      if (chancePct != null && chancePct < 15) return; // wie in den Chancen: Chance bis zum Ziel mindestens 15 %
      if (basePotential(chancePct, riskPct, short ? "rot" : "gruen") < MIN_POTENTIAL) return; // nur die obere Hälfte (wie in den Chancen)
      out.push({ sym: a.symbol, entry: t.entryTime, exit: t.exitTime, r: t.returnPct, px: t.entry, color: short ? "rot" : "gruen", short, riskPct, chancePct });
    };
    try {
      if (a.daily.length > 300) for (const t of backtestSeries({ name: a.symbol, kind: a.kind, horizon: "medium", interval: "1d", candles: a.daily }, params(a.kind, "medium"), { step: 1 }).trades) green(t);
      if (a.weekly && a.weekly.length > 200) {
        for (const t of backtestSeries({ name: a.symbol, kind: a.kind, horizon: "long", interval: "1w", candles: a.weekly }, params(a.kind, "long"), { step: 1 }).trades) green(t);
        for (const t of runLongTermEcho(a.weekly, undefined, 1).trades) {
          if (t.result === "offen" || t.entryTime < from) continue;
          // Ungültig-Grenze und Chance, gemessen ab der Oberkante des Bereichs
          const riskPct = t.invalidation != null && t.zoneTop ? ((t.zoneTop - t.invalidation) / t.zoneTop) * 100 : undefined;
          const chancePct = t.target != null && t.zoneTop ? ((t.target - t.zoneTop) / t.zoneTop) * 100 : undefined;
          if (basePotential(chancePct, riskPct, "blau") < MIN_POTENTIAL) continue; // nur die obere Hälfte (wie in den Chancen)
          out.push({ sym: a.symbol, entry: t.entryTime, exit: t.exitTime, r: t.returnPct, px: t.entry, color: "blau", riskPct, chancePct });
        }
      }
    } catch {
      /* Wert überspringen */
    }
    await tick();
  }
  return prep.toEur(out);
}

/** Versuche einer Runde (Runde b spielt die Zeiträume b, b+5, b+10, … – so ist jede Runde gemischt). */
export const roundWindows = (prep: Prepared, round: number) => prep.windows.map((w, i) => ({ w, i })).filter((x) => x.i % RULES.rounds === round);

export function playRound(prep: Prepared, pool: PoolTrade[], round: number): { w: Window; r: RunResult }[] {
  return roundWindows(prep, round).map(({ w }) => ({ w, r: runWindow(pool, w, prep.priceAt) }));
}

export function buildReport(prep: Prepared, btRuns: { w: Window; r: RunResult }[], rounds: TournamentReport["rounds"], finalPool: PoolTrade[], improvedCells: TournamentReport["improvedCells"]): TournamentReport {
  const bt = summarizeRuns("blacktrader", "Blacktrader", DESC, btRuns);
  const ranking = rank([bt, ...prep.bots.map((b) => ({ ...b, rankByScenario: {} }))]);
  const only = (c: "blau" | "gruen" | "rot") => {
    const p = finalPool.filter((t) => t.color === c);
    return p.length ? summarizeRuns(`bt-${c}`, `Blacktrader nur ${c === "blau" ? "Blau" : c === "gruen" ? "Grün" : "Rot"}`, "", prep.windows.map((w) => ({ w, r: runWindow(p, w, prep.priceAt) }))) : null;
  };
  const scenarioCount: Partial<Record<Scenario, number>> = {};
  for (const w of prep.windows) scenarioCount[w.scenario] = (scenarioCount[w.scenario] ?? 0) + 1;
  return { v: 2, at: new Date().toISOString(), rules: { ...RULES }, ranking, scenarioCount, rounds, split: { blau: only("blau"), gruen: only("gruen"), rot: only("rot") }, benchmark: prep.benchmark ?? null, improvedCells, note: prep.note };
}
