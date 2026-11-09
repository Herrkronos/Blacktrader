// Turnier: Blacktrader gegen 7 andere Analysten/Bots – fair und ohne Blick in die Zukunft.
//
// Jeder Teilnehmer erzeugt aus DENSELBEN Kursdaten (alle Werte: Aktien, Krypto, Rohstoffe, 15 Jahre) seine Kauf-Trades.
// Jedes Signal kennt nur Kerzen bis zu seinem Tag; Einstieg und Ausstieg zum Eröffnungskurs der nächsten Kerze.
//
// Ein Versuch = 5 Jahre ECHTE Zeit: 5.000 € Startkapital, 500 € je Trade (nur wenn genug Geld da ist, je Wert höchstens
// eine Position), 0,2 % Gebühren je Trade, 27,5 % KESt (Österreich) auf den Netto-Gewinn jedes Kalenderjahres
// (Verluste nur im selben Jahr verrechenbar). Offene Positionen werden am Ende zum Tageskurs bewertet und versteuert.
// Wer kein Geld mehr für einen Trade hat und keine offene Position hält, scheidet aus.
// 50 Versuche mit verschiedenen Startzeitpunkten – für alle Teilnehmer dieselben. Jeder Zeitraum wird nach der
// Marktlage (S&P 500) als bullisch, neutral, bärisch oder gemischt eingeordnet. Gewertet wird der Durchschnitt.
import { ema, rsi, sma } from "../analysis/indicators";
import type { Candle } from "../types";

export type Regime = "bullisch" | "neutral" | "baerisch";
export type Scenario = Regime | "gemischt";
export const SCENARIOS: Scenario[] = ["bullisch", "neutral", "baerisch", "gemischt"];
export const SCENARIO_LABEL: Record<Scenario, string> = { bullisch: "Bullisch", neutral: "Neutral", baerisch: "Bärisch", gemischt: "Gemischt" };

export interface PoolTrade {
  sym: string;
  entry: number;
  exit: number;
  /** Rendite in % (vor Gebühren) */
  r: number;
  /** Einstiegskurs (für die Bewertung offener Positionen am Ende) */
  px?: number;
  /** Nur Blacktrader: blauer oder grüner Einstieg */
  color?: "blau" | "gruen";
}

export interface Series {
  symbol: string;
  candles: Candle[];
}

export const RULES = { start: 5000, years: 5, reps: 50, stake: 500, fee: 0.002, tax: 0.275, rounds: 5 } as const;

// ---------------------------------------------------------------------------------------------
// Marktlage aus dem S&P 500 (nur Vergangenheit)

export function regimeIndex(spx: Candle[]) {
  const closes = spx.map((c) => c.close);
  const s = sma(closes, 200);
  const times = spx.map((c) => c.time);
  return (t: number): Regime | null => {
    let lo = 0;
    let hi = times.length - 1;
    if (!times.length || t < times[0]) return null;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (times[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    const i = lo;
    const m = s[i];
    if (m == null || i < 100) return null;
    const r = closes[i] / closes[i - 100] - 1;
    return closes[i] > m && r > 0.05 ? "bullisch" : closes[i] < m && r < -0.05 ? "baerisch" : "neutral";
  };
}

// ---------------------------------------------------------------------------------------------
// Die 7 Gegner (Tageskerzen, nur Kauf-Einstiege)

const trade = (sym: string, c: Candle[], i: number, j: number): PoolTrade | null => (j < c.length && i < j && c[i].open > 0 ? { sym, entry: c[i].time, exit: c[j].time, r: (c[j].open / c[i].open - 1) * 100, px: c[i].open } : null);

/** Kleiner, reproduzierbarer Zufallsgenerator */
export function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

function zufall(data: Series[], seed = 7, n = 3000, hold = 20): PoolTrade[] {
  const r = rng(seed);
  const out: PoolTrade[] = [];
  const usable = data.filter((d) => d.candles.length > 250);
  for (let k = 0; k < n && usable.length; k++) {
    const d = usable[Math.floor(r() * usable.length)];
    const i = 201 + Math.floor(r() * (d.candles.length - hold - 203));
    const t = trade(d.symbol, d.candles, i, i + hold);
    if (t) out.push(t);
  }
  return out;
}

function kaufenHalten(data: Series[]): PoolTrade[] {
  const out: PoolTrade[] = [];
  for (const { symbol, candles: c } of data) for (let i = 201; i + 126 < c.length; i += 21) {
    const t = trade(symbol, c, i, i + 126);
    if (t) out.push(t);
  }
  return out;
}

function trendfolger(data: Series[]): PoolTrade[] {
  const out: PoolTrade[] = [];
  for (const { symbol, candles: c } of data) {
    const cl = c.map((x) => x.close);
    const m = sma(cl, 200);
    let inAt = -1;
    for (let i = 201; i < c.length - 1; i++) {
      if (m[i] == null || m[i - 1] == null) continue;
      if (inAt < 0 && cl[i] > m[i]! && cl[i - 1] <= m[i - 1]!) inAt = i + 1;
      else if (inAt >= 0 && cl[i] < m[i]!) {
        const t = trade(symbol, c, inAt, i + 1);
        if (t) out.push(t);
        inAt = -1;
      }
    }
  }
  return out;
}

function rsiBot(data: Series[]): PoolTrade[] {
  const out: PoolTrade[] = [];
  for (const { symbol, candles: c } of data) {
    const cl = c.map((x) => x.close);
    const r = rsi(cl);
    let inAt = -1;
    for (let i = 30; i < c.length - 1; i++) {
      if (r[i] == null) continue;
      if (inAt < 0 && r[i]! < 30) inAt = i + 1;
      else if (inAt >= 0 && i >= inAt && (r[i]! > 55 || i - inAt >= 20 || cl[i] < c[inAt].open * 0.9)) {
        const t = trade(symbol, c, inAt, i + 1);
        if (t) out.push(t);
        inAt = -1;
      }
    }
  }
  return out;
}

function macdBot(data: Series[]): PoolTrade[] {
  const out: PoolTrade[] = [];
  for (const { symbol, candles: c } of data) {
    const cl = c.map((x) => x.close);
    const e12 = ema(cl, 12);
    const e26 = ema(cl, 26);
    const macd = cl.map((_, i) => (e12[i] != null && e26[i] != null ? e12[i]! - e26[i]! : 0));
    const sig = ema(macd.slice(26), 9);
    const sg = (i: number) => (i >= 26 ? sig[i - 26] : null);
    let inAt = -1;
    for (let i = 40; i < c.length - 1; i++) {
      const a = sg(i);
      const b = sg(i - 1);
      if (a == null || b == null) continue;
      const up = macd[i] > a && macd[i - 1] <= b;
      const down = macd[i] < a && macd[i - 1] >= b;
      if (inAt < 0 && up) inAt = i + 1;
      else if (inAt >= 0 && down) {
        const t = trade(symbol, c, inAt, i + 1);
        if (t) out.push(t);
        inAt = -1;
      }
    }
  }
  return out;
}

function ausbruch(data: Series[]): PoolTrade[] {
  const out: PoolTrade[] = [];
  for (const { symbol, candles: c } of data) {
    let inAt = -1;
    for (let i = 56; i < c.length - 1; i++) {
      let hi = -Infinity;
      for (let k = i - 55; k < i; k++) hi = Math.max(hi, c[k].high);
      let lo = Infinity;
      for (let k = i - 20; k < i; k++) lo = Math.min(lo, c[k].low);
      if (inAt < 0 && c[i].close > hi) inAt = i + 1;
      else if (inAt >= 0 && c[i].close < lo) {
        const t = trade(symbol, c, inAt, i + 1);
        if (t) out.push(t);
        inAt = -1;
      }
    }
  }
  return out;
}

/** KI-Bot: logistische Regression, lernt je Kalenderjahr NUR mit Fällen, deren Ergebnis vor Jahresbeginn feststand. */
function kiBot(data: Series[]): PoolTrade[] {
  type Row = { sym: string; c: Candle[]; i: number; f: number[]; y: number; known: number };
  const rows: Row[] = [];
  for (const { symbol, candles: c } of data) {
    const cl = c.map((x) => x.close);
    const r = rsi(cl);
    const m = sma(cl, 200);
    for (let i = 200; i < c.length - 22; i++) {
      if (m[i] == null || r[i] == null) continue;
      const lr: number[] = [];
      for (let k = i - 19; k <= i; k++) lr.push(Math.log(cl[k] / cl[k - 1]));
      const mean = lr.reduce((a, b) => a + b, 0) / lr.length;
      const vol = Math.sqrt(lr.reduce((a, b) => a + (b - mean) ** 2, 0) / lr.length);
      rows.push({ sym: symbol, c, i, f: [cl[i] / cl[i - 5] - 1, cl[i] / cl[i - 20] - 1, cl[i] / cl[i - 60] - 1, r[i]! / 100, cl[i] / m[i]! - 1, vol], y: c[i + 21].open > c[i + 1].open ? 1 : 0, known: c[i + 21].time });
    }
  }
  if (rows.length < 2000) return [];
  const year = (t: number) => new Date(t * 1000).getUTCFullYear();
  let t0 = Infinity;
  let t1 = -Infinity;
  for (const x of rows) {
    const t = x.c[x.i].time;
    if (t < t0) t0 = t;
    if (t > t1) t1 = t;
  }
  const out: PoolTrade[] = [];
  for (let Y = year(t0); Y <= year(t1); Y++) {
    const y0 = Date.UTC(Y, 0, 1) / 1000;
    const y1 = Date.UTC(Y + 1, 0, 1) / 1000;
    const all = rows.filter((x) => x.known < y0);
    // Rechenzeit (Handy): höchstens ~30.000 Lernfälle, gleichmäßig verteilt
    const stride = Math.max(1, Math.ceil(all.length / 30000));
    const tr = stride > 1 ? all.filter((_, n) => n % stride === 0) : all;
    const te = rows.filter((x) => x.c[x.i].time >= y0 && x.c[x.i].time < y1);
    if (tr.length < 1000 || !te.length) continue;
    const d = tr[0].f.length;
    const mu = Array(d).fill(0);
    const sd = Array(d).fill(0);
    for (const x of tr) x.f.forEach((v, k) => (mu[k] += v / tr.length));
    for (const x of tr) x.f.forEach((v, k) => (sd[k] += (v - mu[k]) ** 2 / tr.length));
    for (let k = 0; k < d; k++) sd[k] = Math.sqrt(sd[k]) + 1e-9;
    const X = tr.map((x) => x.f.map((v, k) => (v - mu[k]) / sd[k]));
    const w = Array(d).fill(0);
    let b = 0;
    for (let it = 0; it < 200; it++) {
      const g = Array(d).fill(0);
      let gb = 0;
      for (let n = 0; n < X.length; n++) {
        let z = b;
        for (let k = 0; k < d; k++) z += X[n][k] * w[k];
        const e = 1 / (1 + Math.exp(-z)) - tr[n].y;
        for (let k = 0; k < d; k++) g[k] += e * X[n][k];
        gb += e;
      }
      for (let k = 0; k < d; k++) w[k] -= (0.1 * g[k]) / X.length;
      b -= (0.1 * gb) / X.length;
    }
    const busy = new Map<string, number>();
    for (const x of te) {
      let z = b;
      x.f.forEach((v, k) => (z += ((v - mu[k]) / sd[k]) * w[k]));
      if (1 / (1 + Math.exp(-z)) > 0.58 && x.c[x.i].time >= (busy.get(x.sym) ?? 0)) {
        const t = trade(x.sym, x.c, x.i + 1, x.i + 21);
        if (t) {
          out.push(t);
          busy.set(x.sym, t.exit);
        }
      }
    }
  }
  return out;
}

export interface Opponent {
  id: string;
  name: string;
  desc: string;
  build: (data: Series[]) => PoolTrade[];
}

export const OPPONENTS: Opponent[] = [
  { id: "zufall", name: "Zufalls-Bot", desc: "kauft an zufälligen Tagen, hält 20 Tage", build: (d) => zufall(d) },
  { id: "halten", name: "Kaufen & Halten", desc: "kauft jeden Monat, hält ein halbes Jahr", build: kaufenHalten },
  { id: "trend", name: "Trendfolger", desc: "kauft über der 200-Tage-Linie, verkauft darunter", build: trendfolger },
  { id: "rsi", name: "RSI-Bot", desc: "kauft bei RSI unter 30, verkauft bei Erholung", build: rsiBot },
  { id: "macd", name: "MACD-Bot", desc: "kauft beim MACD-Kreuz nach oben, verkauft beim Kreuz nach unten", build: macdBot },
  { id: "ausbruch", name: "Ausbruchs-Bot", desc: "kauft beim 55-Tage-Hoch, verkauft beim 20-Tage-Tief (Turtle)", build: ausbruch },
  { id: "ki", name: "KI-Bot", desc: "lernende KI (logistische Regression), lernt jedes Jahr neu", build: kiBot },
];

// ---------------------------------------------------------------------------------------------
// Ein Versuch: 5 Jahre echte Zeit

export interface Window {
  from: number;
  to: number;
  scenario: Scenario;
}

export interface RunResult {
  end: number;
  /** Gewinn nach Gebühren und KESt */
  profit: number;
  tax: number;
  trades: number;
  wins: number;
  low: number;
  /** ausgeschieden (kein Geld mehr) */
  broke: boolean;
}

const YEAR = 365.25 * 86400;
const yearOf = (t: number) => new Date(t * 1000).getUTCFullYear();

/**
 * Spielt die Trades eines Teilnehmers im Zeitraum chronologisch durch.
 * `priceAt(sym, t)` liefert den letzten Schlusskurs bis t (für offene Positionen am Ende).
 */
export function runWindow(pool: PoolTrade[], w: Window, priceAt: (sym: string, t: number) => number | null): RunResult {
  type Ev = { t: number; kind: 0 | 1; i: number };
  const trades = pool.filter((p) => p.entry >= w.from && p.entry < w.to);
  const ev: Ev[] = [];
  trades.forEach((p, i) => {
    ev.push({ t: p.entry, kind: 1, i });
    if (p.exit <= w.to) ev.push({ t: p.exit, kind: 0, i });
  });
  // Ausstiege vor Einstiegen am selben Tag; sonst nach Zeit und Wert (eindeutig, für alle gleich)
  ev.sort((a, b) => a.t - b.t || a.kind - b.kind || trades[a.i].sym.localeCompare(trades[b.i].sym));
  let cash: number = RULES.start;
  const open = new Map<number, number>(); // Trade-Index → Einsatz
  const openSym = new Set<string>();
  let year = yearOf(w.from);
  let pnlYear = 0;
  let tax = 0;
  let taken = 0;
  let wins = 0;
  let low: number = cash;
  let broke = false;
  const settleYear = () => {
    const t = Math.max(0, pnlYear) * RULES.tax;
    cash -= t;
    tax += t;
    pnlYear = 0;
  };
  const close = (i: number, r: number) => {
    const stake = open.get(i)!;
    const g = (stake * r) / 100 - stake * RULES.fee;
    cash += stake + g;
    pnlYear += g;
    if (g > 0) wins++;
    open.delete(i);
    openSym.delete(trades[i].sym);
  };
  for (const e of ev) {
    while (yearOf(e.t) > year) {
      settleYear();
      year++;
    }
    if (e.kind === 0) {
      if (open.has(e.i)) close(e.i, trades[e.i].r);
    } else if (!broke) {
      const p = trades[e.i];
      if (openSym.has(p.sym) || cash < RULES.stake) {
        // ohne Geld und ohne offene Position: ausgeschieden
        if (cash < RULES.stake && open.size === 0) broke = true;
        continue;
      }
      cash -= RULES.stake;
      open.set(e.i, RULES.stake);
      openSym.add(p.sym);
      taken++;
    }
    let eq = cash;
    for (const v of open.values()) eq += v;
    low = Math.min(low, eq);
  }
  // Ende: offene Positionen zum Tageskurs bewerten und verkaufen, letztes Jahr versteuern
  for (const i of [...open.keys()]) {
    const p = trades[i];
    const now = priceAt(p.sym, w.to);
    close(i, now && p.px ? (now / p.px - 1) * 100 : 0);
  }
  while (yearOf(w.to) > year) {
    settleYear();
    year++;
  }
  settleYear();
  if (cash < RULES.stake) broke = true;
  return { end: cash, profit: cash - RULES.start, tax, trades: taken, wins, low: Math.min(low, cash), broke };
}

/** 50 Zeiträume à 5 Jahre (gleichmäßig verteilte Startzeitpunkte) mit ihrer Marktlage. */
export function makeWindows(spx: Candle[], from: number, reps: number = RULES.reps, years: number = RULES.years): Window[] {
  const last = spx[spx.length - 1].time;
  const lastStart = last - years * YEAR;
  if (lastStart <= from) return [];
  const regimeOf = regimeIndex(spx);
  const out: Window[] = [];
  for (let k = 0; k < reps; k++) {
    const a = from + ((lastStart - from) * k) / Math.max(1, reps - 1);
    const b = a + years * YEAR;
    const cnt = { bullisch: 0, neutral: 0, baerisch: 0 };
    let n = 0;
    for (const c of spx) {
      if (c.time < a || c.time > b) continue;
      const g = regimeOf(c.time);
      if (g) (cnt[g]++, n++);
    }
    const sh = (g: Regime) => (n ? cnt[g] / n : 0);
    // Bärenmärkte dauern nur Monate (2015/16, 2018, 2020, 2022): ab 15 % Bärentagen zählt ein 5-Jahres-Zeitraum als
    // bärisch (er enthält dann einen Crash bzw. Bärenmarkt), ab 55 % Bullentagen als bullisch, unter 45 % als neutral.
    const scenario: Scenario = sh("baerisch") >= 0.15 ? "baerisch" : sh("bullisch") >= 0.55 ? "bullisch" : sh("bullisch") < 0.45 ? "neutral" : "gemischt";
    out.push({ from: Math.round(a), to: Math.round(b), scenario });
  }
  return out;
}

const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0);
export const cagr = (end: number) => (end > 0 ? Math.pow(end / RULES.start, 1 / RULES.years) - 1 : -1);

export interface ContestantResult {
  id: string;
  name: string;
  desc: string;
  /** Versuche */
  runs: number;
  /** Durchschnitt der Versuche */
  avgEnd: number;
  avgProfit: number;
  avgTax: number;
  avgTrades: number;
  /** Ø Rendite pro Jahr (nach Gebühren und KESt) */
  avgPerYear: number;
  /** schlechtester / bester Versuch (Rendite pro Jahr) */
  worstPerYear: number;
  bestPerYear: number;
  winRate: number;
  /** ausgeschieden (kein Geld mehr) in so vielen Versuchen */
  broke: number;
  byScenario: Partial<Record<Scenario, { n: number; avgPerYear: number }>>;
  rankByScenario: Partial<Record<Scenario, number>>;
  rank: number;
}

/** Fasst die Versuche eines Teilnehmers zusammen. */
export function summarizeRuns(id: string, name: string, desc: string, runs: { w: Window; r: RunResult }[]): ContestantResult {
  const py = runs.map((x) => cagr(x.r.end));
  const byScenario: ContestantResult["byScenario"] = {};
  for (const s of SCENARIOS) {
    const xs = runs.filter((x) => x.w.scenario === s);
    if (xs.length) byScenario[s] = { n: xs.length, avgPerYear: mean(xs.map((x) => cagr(x.r.end))) };
  }
  const trades = runs.reduce((a, x) => a + x.r.trades, 0);
  const wins = runs.reduce((a, x) => a + x.r.wins, 0);
  return {
    id,
    name,
    desc,
    runs: runs.length,
    avgEnd: mean(runs.map((x) => x.r.end)),
    avgProfit: mean(runs.map((x) => x.r.profit)),
    avgTax: mean(runs.map((x) => x.r.tax)),
    avgTrades: mean(runs.map((x) => x.r.trades)),
    avgPerYear: mean(py),
    worstPerYear: py.length ? Math.min(...py) : 0,
    bestPerYear: py.length ? Math.max(...py) : 0,
    winRate: trades ? wins / trades : 0,
    broke: runs.filter((x) => x.r.broke).length,
    byScenario,
    rankByScenario: {},
    rank: 0,
  };
}

/** Rangliste nach Ø Rendite pro Jahr; je Szenario ebenso. */
export function rank(list: ContestantResult[]): ContestantResult[] {
  const out = [...list].sort((a, b) => b.avgPerYear - a.avgPerYear);
  out.forEach((c, i) => (c.rank = i + 1));
  for (const s of SCENARIOS)
    out
      .filter((c) => c.byScenario[s])
      .sort((a, b) => b.byScenario[s]!.avgPerYear - a.byScenario[s]!.avgPerYear)
      .forEach((c, i) => (c.rankByScenario[s] = i + 1));
  return out;
}

export interface TournamentReport {
  /** Version des Berichts (2 = 5-Jahres-Versuche) */
  v: 2;
  at: string;
  rules: typeof RULES;
  ranking: ContestantResult[];
  /** Zeiträume je Szenario */
  scenarioCount: Partial<Record<Scenario, number>>;
  /** Blacktrader je Runde (er lernt zwischen den Runden) */
  rounds?: { round: number; avgPerYear: number; changed: boolean }[];
  /** Blacktrader getrennt: nur blaue bzw. nur grüne Einstiege (mit dem Endstand) */
  split?: { blau: ContestantResult | null; gruen: ContestantResult | null };
  /** Bereiche, die das Lernen verbessert hat (Zonen-Quote alt → neu) */
  improvedCells?: { cell: string; old: number | null; neu: number | null }[];
  note?: string;
}

// ---------------------------------------------------------------------------------------------
// Auswertung in Worten

export const pct1 = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1).replace(".", ",")} %`;
export const eur0 = (x: number) => `${x < 0 ? "−" : ""}${Math.round(Math.abs(x)).toLocaleString("de-DE")} €`;

export function reportLines(rep: TournamentReport, previous?: TournamentReport | null): string[] {
  const bt = rep.ranking.find((c) => c.id === "blacktrader");
  if (!bt) return [];
  const lines: string[] = [];
  lines.push(`Blacktrader belegt Platz ${bt.rank} von ${rep.ranking.length}: Ø ${pct1(bt.avgPerYear)} pro Jahr, Ø ${Math.round(bt.avgTrades)} Trades in 5 Jahren, Ø Gewinn nach KESt ${eur0(bt.avgProfit)} (KESt Ø ${eur0(bt.avgTax)}).`);
  const top = rep.ranking[0];
  if (top.id !== "blacktrader") lines.push(`Bester: ${top.name} mit Ø ${pct1(top.avgPerYear)} pro Jahr.`);
  const best = SCENARIOS.filter((s) => bt.rankByScenario[s] === 1).map((s) => SCENARIO_LABEL[s]);
  if (best.length) lines.push(`Platz 1 in: ${best.join(", ")}.`);
  if (bt.broke) lines.push(`In ${bt.broke} von ${bt.runs} Versuchen ist Blacktrader ausgeschieden (kein Geld mehr).`);
  if (rep.rounds && rep.rounds.length > 1) {
    const a = rep.rounds[0];
    const z = rep.rounds[rep.rounds.length - 1];
    const changed = rep.rounds.filter((r) => r.changed).length;
    lines.push(changed ? `Während des Turniers verbessert: Runde 1 ${pct1(a.avgPerYear)} → Runde ${z.round} ${pct1(z.avgPerYear)} pro Jahr (${changed}× neuer Stand gespeichert).` : "Während des Turniers wurde kein besserer Stand gefunden – alter Stand bleibt.");
  }
  if (rep.split?.blau && rep.split?.gruen) lines.push(`Nur Blau: Ø ${pct1(rep.split.blau.avgPerYear)} pro Jahr · nur Grün: Ø ${pct1(rep.split.gruen.avgPerYear)} pro Jahr.`);
  if (previous) {
    const pb = previous.ranking.find((c) => c.id === "blacktrader");
    if (pb) lines.push(`Gegenüber der letzten Auswertung: Platz ${pb.rank} → ${bt.rank}, ${pct1(pb.avgPerYear)} → ${pct1(bt.avgPerYear)} pro Jahr.`);
  }
  return lines;
}
