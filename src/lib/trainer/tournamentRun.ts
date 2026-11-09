// Turnier rechnen (im Web Worker): Kursdaten laden, Trades aller 8 Teilnehmer erzeugen, 50 Durchgänge simulieren.
// Blacktrader wird zweimal gerechnet – mit dem Stand VOR und NACH dem Training (gleiche Durchgänge) –,
// damit die Auswertung zeigt, wo er sich verbessert hat.
import { TECH_SYMBOLS } from "../analysis/bestEntry";
import { runLongTermEcho } from "../analysis/longterm";
import type { LearnableParams } from "../analysis/params";
import type { AssetKind, Candle, Horizon } from "../types";
import { backtestSeries } from "./engine";
import { evaluate, OPPONENTS, rank, rankAgainst, regimeIndex, RULES, type PoolTrade, type Series, type TournamentReport } from "./tournament";
import { universe, type CellKey, type SeriesSpec } from "./universe";

export interface TournamentIO {
  load: (spec: SeriesSpec) => Promise<Candle[] | null>;
  onProgress: (fraction: number, text: string) => void;
  shouldStop: () => boolean;
  extra?: { symbol: string; kind: AssetKind; yahooSymbol?: string }[];
}

type Params = (kind: AssetKind, horizon: Horizon) => LearnableParams;

const KINDS: AssetKind[] = ["stock", "crypto", "commodity"];
const DAYS = 15 * 365;
const tick = () => new Promise((r) => setTimeout(r, 0));

interface Asset {
  symbol: string;
  kind: AssetKind;
  daily: Candle[];
  weekly: Candle[] | null;
}

/** Trades von Blacktrader: grün (Tag + Woche, nur Kauf) und blau (Langfrist-Bereich), mit Sektor-Regel. */
async function blacktraderPool(assets: Asset[], params: Params, techWeakAt: (t: number) => boolean, io: TournamentIO, from: number, span: [number, number], label: string): Promise<PoolTrade[] | null> {
  const out: PoolTrade[] = [];
  for (let k = 0; k < assets.length; k++) {
    if (io.shouldStop()) return null;
    const a = assets[k];
    io.onProgress(span[0] + ((span[1] - span[0]) * k) / assets.length, `${label}: ${a.symbol}`);
    const tech = TECH_SYMBOLS.has(a.symbol);
    const green = (t: { direction: string; reason: string; entryTime: number; exitTime: number; returnPct: number }) => {
      if (t.direction !== "long" || t.reason === "end" || t.entryTime < from) return;
      if (tech && techWeakAt(t.entryTime)) return; // Sektor-Regel
      out.push({ sym: a.symbol, entry: t.entryTime, exit: t.exitTime, r: t.returnPct });
    };
    try {
      if (a.daily.length > 300) for (const t of backtestSeries({ name: a.symbol, kind: a.kind, horizon: "medium", interval: "1d", candles: a.daily }, params(a.kind, "medium"), { step: 1 }).trades) green(t);
      if (a.weekly && a.weekly.length > 200) {
        for (const t of backtestSeries({ name: a.symbol, kind: a.kind, horizon: "long", interval: "1w", candles: a.weekly }, params(a.kind, "long"), { step: 1 }).trades) green(t);
        for (const t of runLongTermEcho(a.weekly, undefined, 1).trades) if (t.result !== "offen" && t.entryTime >= from) out.push({ sym: a.symbol, entry: t.entryTime, exit: t.exitTime, r: t.returnPct });
      }
    } catch {
      /* Wert überspringen */
    }
    await tick();
  }
  return out;
}

export async function runTournament(io: TournamentIO, before: Params, after: Params, improvedCells: TournamentReport["improvedCells"], sameParams: boolean): Promise<TournamentReport | null> {
  // 1) Daten: alle Werte aller Bereiche (Tages- und Wochenkerzen, 15 Jahre) + S&P 500 / NASDAQ 100.
  //    15 Jahre, damit mehrere Bärenmärkte enthalten sind (2011, 2015/16, 2018, 2020, 2022).
  const specs = new Map<string, { kind: AssetKind; daily: SeriesSpec; weekly: SeriesSpec }>();
  for (const kind of KINDS) {
    const d = universe(`${kind}:medium` as CellKey);
    const w = universe(`${kind}:long` as CellKey);
    d.forEach((s, i) => specs.set(s.symbol, { kind, daily: { ...s, days: DAYS }, weekly: w[i] ?? { ...s, interval: "1w", days: 15 * 365 } }));
  }
  for (const e of io.extra ?? []) {
    const symbol = e.yahooSymbol ?? (e.kind === "crypto" ? `${e.symbol}-USD` : e.symbol);
    if (specs.has(symbol) || symbol.startsWith("^")) continue;
    specs.set(symbol, { kind: e.kind, daily: { symbol, kind: e.kind, horizon: "medium", interval: "1d", days: DAYS, step: 1 }, weekly: { symbol, kind: e.kind, horizon: "long", interval: "1w", days: 15 * 365, step: 1 } });
  }
  const idx = (symbol: string): SeriesSpec => ({ symbol, kind: "stock", horizon: "medium", interval: "1d", days: DAYS, step: 1 });
  io.onProgress(0, "Kursdaten laden: S&P 500 und NASDAQ 100");
  const [spx, ndx] = await Promise.all([io.load(idx("^GSPC")), io.load(idx("^NDX"))]);
  if (!spx || spx.length < 300) return null;
  const regimeOf = regimeIndex(spx);
  const ndxCl = (ndx ?? []).map((c) => c.close);
  const techWeakAt = (t: number) => {
    if (!ndx?.length) return false;
    let i = ndx.length - 1;
    while (i > 0 && ndx[i].time > t) i--;
    if (i < 200) return false;
    const m = ndxCl.slice(i - 199, i + 1).reduce((a, b) => a + b, 0) / 200;
    return ndxCl[i] < m;
  };

  const assets: Asset[] = [];
  const list = [...specs.entries()];
  for (let k = 0; k < list.length; k++) {
    if (io.shouldStop()) return null;
    const [symbol, s] = list[k];
    io.onProgress(0.02 + (0.28 * k) / list.length, `Kursdaten laden: ${symbol}`);
    const [daily, weekly] = await Promise.all([io.load(s.daily), io.load(s.weekly)]);
    if (daily && daily.length > 300) assets.push({ symbol, kind: s.kind, daily, weekly });
  }
  if (assets.length < 10) return null;
  // Gemeinsames Zeitfenster für alle Teilnehmer: ab dem Tag, an dem die Marktlage feststeht
  const from = spx[200].time;
  const inWindow = (p: PoolTrade[]) => p.filter((t) => t.entry >= from);
  const spanYears = (spx[spx.length - 1].time - from) / (365.25 * 86400);

  // 2) Die 7 Gegner (Tageskerzen)
  const data: Series[] = assets.map((a) => ({ symbol: a.symbol, candles: a.daily }));
  const results = [];
  for (let k = 0; k < OPPONENTS.length; k++) {
    if (io.shouldStop()) return null;
    const o = OPPONENTS[k];
    io.onProgress(0.3 + (0.1 * k) / OPPONENTS.length, `${o.name} handelt`);
    await tick();
    results.push(evaluate(o.id, o.name, o.desc, inWindow(o.build(data)), regimeOf, undefined, spanYears));
  }

  // 3) Blacktrader vor und nach dem Training
  const desc = "Elliott-Wellen + Fundamental/News + Volumen/RSI, ein Einstieg pro Wert (blau/grün), keine Shorts, Sektor-Regel";
  const afterPool = await blacktraderPool(assets, after, techWeakAt, io, from, [0.4, sameParams ? 0.95 : 0.68], "Blacktrader handelt");
  if (!afterPool) return null;
  const bt = evaluate("blacktrader", "Blacktrader", desc, afterPool, regimeOf, undefined, spanYears);
  let beforeRes = bt;
  if (!sameParams) {
    const beforePool = await blacktraderPool(assets, before, techWeakAt, io, from, [0.68, 0.95], "Blacktrader vor dem Training");
    if (!beforePool) return null;
    beforeRes = evaluate("blacktrader", "Blacktrader", desc, beforePool, regimeOf, undefined, spanYears);
  }
  io.onProgress(0.97, "Rangliste erstellen");
  const ranking = rank([bt, ...results]);
  const before0 = rankAgainst(beforeRes, ranking);
  return {
    at: new Date().toISOString(),
    rules: { ...RULES },
    ranking,
    before: before0,
    improvedCells,
    note: `${assets.length} Werte (Aktien, Krypto, Rohstoffe), Zeitraum ab ${new Date(from * 1000).toLocaleDateString("de-DE")}. Rohstoffe kurzfristig (Stundenkerzen) sind nicht enthalten.`,
  };
}
