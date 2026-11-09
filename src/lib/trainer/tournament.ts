// Turnier: Blacktrader gegen 7 andere Analysten/Bots – fair und ohne Blick in die Zukunft.
//
// Jeder Teilnehmer erzeugt aus DENSELBEN Kursdaten (alle Werte: Aktien, Krypto, Rohstoffe) seine Kauf-Trades.
// Jedes Signal kennt nur Kerzen bis zu seinem Tag; Einstieg und Ausstieg zum Eröffnungskurs der nächsten Kerze.
// Jeder Trade bekommt die Marktlage beim Einstieg (S&P 500: bullisch / neutral / bärisch).
//
// Ein Durchgang: 5.000 € Startkapital, 500 Trades, 500 € je Trade (bzw. Restgeld), 0,2 % Gebühren je Trade,
// 26,5 % KESt auf Gewinne (je ca. 55 Trades ≈ 1 Jahr, Verlustausgleich im selben Zeitraum).
// 50 Durchgänge mit den Szenarien bullisch, neutral, bärisch und gemischt (Marktlage wechselt in Phasen).
// Alle Teilnehmer bekommen in Durchgang k dieselbe Szenario-Folge (gleicher Zufalls-Startwert).
// Hat ein Teilnehmer in einer Marktlage keinen Trade, bleibt das Geld liegen (nicht handeln ist erlaubt).
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
}

export interface Series {
  symbol: string;
  candles: Candle[];
}

export const RULES = { start: 5000, trades: 500, reps: 50, stake: 500, fee: 0.002, tax: 0.265, tradesPerYear: 55 } as const;

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

const trade = (sym: string, c: Candle[], i: number, j: number): PoolTrade | null => (j < c.length && i < j && c[i].open > 0 ? { sym, entry: c[i].time, exit: c[j].time, r: (c[j].open / c[i].open - 1) * 100 } : null);

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
// Simulation

export interface RunResult {
  end: number;
  low: number;
  /** Trade-Nummer, bei der das Geld aufgebraucht war */
  broke: number | null;
  taken: number;
  wins: number;
}

export function simulate(byRegime: Record<Regime, number[]>, seed: number, scenario: Scenario): RunResult {
  const r = rng(seed * 7919 + 13);
  let cap: number = RULES.start;
  let low: number = cap;
  let ypnl = 0;
  let taken = 0;
  let wins = 0;
  let done = 0;
  const regimes: Regime[] = ["bullisch", "neutral", "baerisch"];
  while (done < RULES.trades) {
    const reg: Regime = scenario === "gemischt" ? regimes[Math.floor(r() * 3)] : scenario;
    const len = scenario === "gemischt" ? 30 + Math.floor(r() * 51) : RULES.trades;
    for (let k = 0; k < len && done < RULES.trades; k++) {
      const pool = byRegime[reg];
      const pick = pool.length ? pool[Math.floor(r() * pool.length)] : null;
      done++;
      if (pick != null) {
        const stake = Math.min(RULES.stake, cap);
        const g = (stake * pick) / 100 - stake * RULES.fee;
        cap += g;
        ypnl += g;
        taken++;
        if (pick > 0) wins++;
      }
      if (done % RULES.tradesPerYear === 0) {
        cap -= Math.max(0, ypnl) * RULES.tax;
        ypnl = 0;
      }
      low = Math.min(low, cap);
      if (cap < 50) return { end: Math.max(0, cap), low, broke: done, taken, wins };
    }
  }
  cap -= Math.max(0, ypnl) * RULES.tax;
  return { end: cap, low, broke: null, taken, wins };
}

const median = (x: number[]) => {
  if (!x.length) return 0;
  const s = [...x].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (x: number[], q: number) => {
  if (!x.length) return 0;
  const s = [...x].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
};

export interface ContestantResult {
  id: string;
  name: string;
  desc: string;
  /** Anzahl Trades im Pool */
  pool: number;
  median: number;
  p10: number;
  p90: number;
  /** Pleiten von 50 Durchgängen */
  broke: number;
  winRate: number;
  /** Median-Endkapital je Szenario */
  byScenario: Record<Scenario, number>;
  /** Rang je Szenario (1 = bester) */
  rankByScenario: Record<Scenario, number>;
  rank: number;
}

export interface TournamentReport {
  at: string;
  rules: typeof RULES;
  /** Teilnehmer, nach Rang sortiert */
  ranking: ContestantResult[];
  /** Blacktrader VOR dem Training (gleiche Durchgänge) – für „wo hat er sich verbessert“ */
  before?: ContestantResult | null;
  /** Bereiche, die das Training verbessert hat (Zonen-Quote alt → neu) */
  improvedCells?: { cell: string; old: number | null; neu: number | null }[];
  note?: string;
}

/** Wertet einen Teilnehmer über alle Durchgänge aus. */
export function evaluate(id: string, name: string, desc: string, pool: PoolTrade[], regimeOf: (t: number) => Regime | null, reps = RULES.reps): ContestantResult {
  const byRegime: Record<Regime, number[]> = { bullisch: [], neutral: [], baerisch: [] };
  for (const t of pool) {
    const g = regimeOf(t.entry);
    if (g) byRegime[g].push(t.r);
  }
  const ends: number[] = [];
  const per: Record<Scenario, number[]> = { bullisch: [], neutral: [], baerisch: [], gemischt: [] };
  let broke = 0;
  let taken = 0;
  let wins = 0;
  for (let k = 0; k < reps; k++) {
    const sc = SCENARIOS[k % SCENARIOS.length];
    const res = simulate(byRegime, k + 1, sc);
    ends.push(res.end);
    per[sc].push(res.end);
    if (res.broke != null) broke++;
    taken += res.taken;
    wins += res.wins;
  }
  const byScenario = Object.fromEntries(SCENARIOS.map((s) => [s, median(per[s])])) as Record<Scenario, number>;
  return { id, name, desc, pool: pool.length, median: median(ends), p10: quantile(ends, 0.1), p90: quantile(ends, 0.9), broke, winRate: taken ? wins / taken : 0, byScenario, rankByScenario: { bullisch: 0, neutral: 0, baerisch: 0, gemischt: 0 }, rank: 0 };
}

/** Rangliste: nach Median-Endkapital, je Szenario ebenso. */
export function rank(list: ContestantResult[]): ContestantResult[] {
  const out = [...list].sort((a, b) => b.median - a.median);
  out.forEach((c, i) => (c.rank = i + 1));
  for (const s of SCENARIOS) [...out].sort((a, b) => b.byScenario[s] - a.byScenario[s]).forEach((c, i) => (c.rankByScenario[s] = i + 1));
  return out;
}

/** Rang, den ein Teilnehmer gegen die anderen hätte (für den Stand vor dem Training). */
export function rankAgainst(c: ContestantResult, others: ContestantResult[]): ContestantResult {
  const all = rank([...others.filter((o) => o.id !== c.id).map((o) => ({ ...o, rankByScenario: { ...o.rankByScenario } })), { ...c, rankByScenario: { ...c.rankByScenario } }]);
  return all.find((x) => x.id === c.id)!;
}

// ---------------------------------------------------------------------------------------------
// Auswertung in Worten

export function reportLines(rep: TournamentReport, previous?: TournamentReport | null): string[] {
  const bt = rep.ranking.find((c) => c.id === "blacktrader");
  if (!bt) return [];
  const eur = (x: number) => `${Math.round(x).toLocaleString("de-DE")} €`;
  const lines: string[] = [];
  lines.push(`Blacktrader belegt Platz ${bt.rank} von ${rep.ranking.length} (Median ${eur(bt.median)} aus 5.000 € nach KESt).`);
  const best = SCENARIOS.filter((s) => bt.rankByScenario[s] === 1).map((s) => SCENARIO_LABEL[s]);
  if (best.length) lines.push(`Platz 1 im Szenario ${best.join(", ")}.`);
  const weak = SCENARIOS.filter((s) => bt.rankByScenario[s] > 3).map((s) => `${SCENARIO_LABEL[s]} (Platz ${bt.rankByScenario[s]})`);
  if (weak.length) lines.push(`Schwächer: ${weak.join(", ")}.`);
  if (bt.broke) lines.push(`In ${bt.broke} von ${rep.rules.reps} Durchgängen war das Geld aufgebraucht.`);
  if (rep.before) {
    const d = bt.median - rep.before.median;
    if (Math.abs(d) < 1) lines.push("Das Training hat am Turnier-Ergebnis nichts geändert.");
    else lines.push(`Durch das Training ${d > 0 ? "verbessert" : "verschlechtert"}: ${eur(rep.before.median)} → ${eur(bt.median)} (Platz ${rep.before.rank} → ${bt.rank}).`);
    const better = SCENARIOS.filter((s) => bt.byScenario[s] - rep.before!.byScenario[s] > 1).map((s) => `${SCENARIO_LABEL[s]} +${eur(bt.byScenario[s] - rep.before!.byScenario[s])}`);
    if (better.length) lines.push(`Verbessert in: ${better.join(", ")}.`);
  }
  if (previous) {
    const pb = previous.ranking.find((c) => c.id === "blacktrader");
    if (pb) lines.push(`Gegenüber der letzten Auswertung: Platz ${pb.rank} → ${bt.rank}, Median ${eur(pb.median)} → ${eur(bt.median)}.`);
  }
  return lines;
}
