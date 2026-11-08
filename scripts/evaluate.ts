// Messwerkzeug: lässt den Analysten (EchoChart-Logik) über echte historische Kursreihen laufen.
// Aufruf: DATA_DIR=<ordner> npx tsx scripts/evaluate.ts
// Jede Reihe wird geteilt: erste 60 % = Entwicklung, letzte 40 % = unabhängige Prüfung.
import fs from "node:fs";
import path from "node:path";
import { runBacktest, type BacktestTrade } from "../src/lib/analysis/backtest";
import type { AnalyzerFilters } from "../src/lib/analysis/analyze";
import { runZoneBacktest } from "../src/lib/analysis/zoneBacktest";
import { runCoreBacktest } from "../src/lib/analysis/core";
import type { ZoneOptions } from "../src/lib/analysis/zones";
import { aggregateCandles } from "../src/lib/data/aggregate";
import type { Candle, Horizon, Interval } from "../src/lib/types";

const DIR = process.env.DATA_DIR ?? "data";

function readCsv(file: string): Candle[] {
  const lines = fs.readFileSync(path.join(DIR, file), "utf8").trim().split("\n");
  const head = lines[0].toLowerCase().split(",");
  const idx = (k: string) => head.findIndex((h) => h === k);
  const iT = Math.max(0, idx("time"), idx("date"));
  const [iO, iH, iL, iC, iV] = ["open", "high", "low", "close", "volume"].map(idx);
  return lines.slice(1).map((l) => {
    const c = l.split(",");
    const raw = c[iT];
    const time = /^\d+$/.test(raw) ? Number(raw) : Math.floor(Date.parse(raw.length <= 10 ? `${raw}T00:00:00Z` : raw.replace(" ", "T") + "Z") / 1000);
    return { time, open: +c[iO], high: +c[iH], low: +c[iL], close: +c[iC], volume: iV >= 0 ? +c[iV] || 0 : 0 };
  }).filter((c) => Number.isFinite(c.close) && c.close > 0);
}

interface Job {
  name: string;
  candles: Candle[];
  horizon: Horizon;
  interval: Interval;
}

function jobs(): Job[] {
  const out: Job[] = [];
  const add = (name: string, file: string, horizon: Horizon, interval: Interval, aggSec?: number) => {
    if (!fs.existsSync(path.join(DIR, file))) return;
    let c = readCsv(file);
    if (aggSec) c = aggregateCandles(c, aggSec);
    out.push({ name, candles: c, horizon, interval });
  };
  add("SPY 1d", "SPY_D.csv", "medium", "1d");
  add("SPY 1w", "SPY_D.csv", "long", "1w", 7 * 86400);
  add("GOOG 1d", "GOOG.csv", "medium", "1d");
  add("EURUSD 1h", "EURUSD.csv", "short", "1h");
  add("EURUSD 4h", "EURUSD.csv", "medium", "4h", 4 * 3600);
  add("Gold 5m", "xau2016_5m.csv", "short", "5m");
  add("Gold 15m", "xau2016_5m.csv", "short", "15m", 900);
  add("Gold 1h", "xau2016_5m.csv", "short", "1h", 3600);
  add("Gold 4h", "xau2016_5m.csv", "medium", "4h", 4 * 3600);
  return out;
}

type Row = { trades: number; wins: number; pf: number; ret: number; avgW: number; avgL: number };
function summarize(ts: BacktestTrade[]): Row {
  const w = ts.filter((t) => t.returnPct > 0);
  const l = ts.filter((t) => t.returnPct <= 0);
  const gw = w.reduce((a, t) => a + t.returnPct, 0);
  const gl = -l.reduce((a, t) => a + t.returnPct, 0);
  return {
    trades: ts.length,
    wins: w.length,
    pf: gl > 0 ? gw / gl : w.length ? 99 : 0,
    ret: (ts.reduce((e, t) => e * (1 + t.returnPct / 100), 1) - 1) * 100,
    avgW: w.length ? gw / w.length : 0,
    avgL: l.length ? -gl / l.length : 0,
  };
}
const fmt = (r: Row) =>
  `${String(r.trades).padStart(4)} Trades | Treffer ${(r.trades ? (r.wins / r.trades) * 100 : 0).toFixed(0).padStart(3)} % | PF ${r.pf.toFixed(2).padStart(5)} | Ø +${r.avgW.toFixed(2)} / ${r.avgL.toFixed(2)} % | Summe ${r.ret.toFixed(1).padStart(7)} %`;

const FILTERS: Partial<AnalyzerFilters> = JSON.parse(process.env.FILTERS ?? "{}");

const ZONE: Partial<ZoneOptions> | null = process.env.ZONE ? JSON.parse(process.env.ZONE) : null;
const run = (c: Candle[], j: { horizon: Horizon; interval: Interval }, f: Partial<AnalyzerFilters> = FILTERS) =>
  ZONE ? runZoneBacktest(c, { zone: ZONE, ...JSON.parse(process.env.ZONEBT ?? "{}") }) : runBacktest(c, { horizon: j.horizon, interval: j.interval, filters: f });

if (process.env.CORE) {
  // Kernposition: Entwicklung/Prüfung je Reihe + frische Gold-Jahre; Vergleich mit Halten, Zonen und 50/50-Kombination
  const q = Number(process.env.CORE);
  const extra: Job[] = [];
  for (const f of ["xau2013_5m.csv", "xau2017_5m.csv"])
    if (fs.existsSync(path.join(DIR, f))) {
      const b = readCsv(f);
      extra.push({ name: `${f.slice(0, 7)} 1h`, candles: aggregateCandles(b, 3600), horizon: "short", interval: "1h" });
      extra.push({ name: `${f.slice(0, 7)} 4h`, candles: aggregateCandles(b, 14400), horizon: "medium", interval: "4h" });
    }
  const tot = { dev: [0, 0, 0, 0, 0], test: [0, 0, 0, 0, 0], fresh: [0, 0, 0, 0, 0] };
  for (const j of [...jobs().filter((x) => !x.name.includes("5m") && !x.name.includes("15m")), ...extra]) {
    const isFresh = extra.includes(j);
    const cut = Math.floor(j.candles.length * 0.6);
    const parts: [string, Candle[]][] = isFresh ? [["fresh", j.candles]] : [["dev", j.candles.slice(0, cut)], ["test", j.candles.slice(Math.max(0, cut - 400))]];
    for (const [part, c] of parts) {
      const core = runCoreBacktest(c, { minQuality: q, ...(process.env.CORE_DEG ? { degrees: process.env.CORE_DEG.split(",") } : {}) });
      const zone = runZoneBacktest(c, { warmup: 200 });
      const zr = (zone.trades.reduce((e, t) => e * (1 + t.returnPct / 100), 1) - 1) * 100;
      const combo = (0.5 * (1 + core.stats.totalReturn / 100) + 0.5 * (1 + zr / 100) - 1) * 100;
      const row = [core.buyAndHold, core.stats.totalReturn, zr, combo, core.exposure * 100];
      row.forEach((v, k) => (tot[part as keyof typeof tot][k] += v));
      console.log(
        `${j.name.padEnd(12)} ${part.padEnd(5)} Halten ${core.buyAndHold.toFixed(1).padStart(7)} % | Kern ${core.stats.totalReturn.toFixed(1).padStart(7)} % (${core.segments.length} Phasen, ${(core.exposure * 100).toFixed(0)} % investiert, MaxDD ${core.maxDrawdown.toFixed(1)} % vs Halten ${core.holdMaxDrawdown.toFixed(1)} %) | Zonen ${zr.toFixed(1).padStart(6)} % | 50/50 ${combo.toFixed(1).padStart(7)} %`,
      );
    }
  }
  for (const [k, v] of Object.entries(tot)) console.log(`SUMME ${k.padEnd(5)} Halten ${v[0].toFixed(0)} | Kern ${v[1].toFixed(0)} | Zonen ${v[2].toFixed(0)} | 50/50 ${v[3].toFixed(0)}`);
  process.exit(0);
}

if (process.env.FRESH) {
  // Völlig frische Daten (bei keiner Entscheidung verwendet): ganze Reihe, alle Versionen im Vergleich
  const versions: [string, (c: Candle[], iv: Interval, h: Horizon) => BacktestTrade[]][] = [
    ["Alter Analyst (Sofort)", (c, iv, h) => runBacktest(c, { horizon: h, interval: iv, filters: { trend: "off", minStopAtr: 0 } }).trades],
    ["Zielzonen, Ziel 1", (c) => runZoneBacktest(c, { exitMode: "fixed" }).trades],
    ["Zielzonen + laufen lassen", (c) => runZoneBacktest(c, {}).trades],
  ];
  for (const file of process.env.FRESH.split(",")) {
    const base = readCsv(file);
    for (const [label, sec, iv, h] of [["5m", 0, "5m", "short"], ["15m", 900, "15m", "short"], ["1h", 3600, "1h", "short"], ["4h", 14400, "4h", "medium"]] as const) {
      const c = sec ? aggregateCandles(base, sec) : base;
      const bh = ((c[c.length - 1].close - c[120].close) / c[120].close) * 100;
      for (const [name, fn] of versions) console.log(`${file.slice(0, 7)} ${label.padEnd(4)} ${name.padEnd(26)} ${fmt(summarize(fn(c, iv, h)))} | Halten ${bh.toFixed(1)} %`);
    }
  }
  for (const [name] of versions) void name;
  process.exit(0);
}

if (process.env.EXITGRID) {
  const js = jobs();
  const combos: Record<string, unknown>[] = [{ exitMode: "fixed" }, { exitMode: "fixed", confirmEntry: true }];
  for (const exitMode of ["trail", "partial"]) for (const trailAtr of [2, 3, 4]) for (const confirmEntry of [false, true]) combos.push({ exitMode, trailAtr, confirmEntry });
  for (const o of combos) {
    const ts: BacktestTrade[] = [];
    const per: string[] = [];
    for (const j of js) {
      const cut = Math.floor(j.candles.length * 0.6);
      const r = runZoneBacktest(j.candles.slice(0, cut), o as never);
      ts.push(...r.trades);
      per.push(`${j.name}:${summarize(r.trades).pf.toFixed(1)}`);
    }
    console.log(`${JSON.stringify(o).padEnd(60)} ${fmt(summarize(ts))} | ${per.join(" ")}`);
  }
  process.exit(0);
}

if (process.env.ZONEGRID) {
  const js = jobs();
  for (const trendFilter of [true, false])
    for (const atrMult of [2.5, 4])
      for (const entryRetrace of [0.618, 0.705])
        for (const target1Ext of [0, 0.272]) {
          const z = { trendFilter, atrMult, entryRetrace, target1Ext };
          const ts: BacktestTrade[] = [];
          const per: string[] = [];
          for (const j of js) {
            const cut = Math.floor(j.candles.length * 0.6);
            const r = runZoneBacktest(j.candles.slice(0, cut), { zone: z });
            ts.push(...r.trades);
            per.push(`${j.name}:${summarize(r.trades).pf.toFixed(1)}`);
          }
          console.log(`${JSON.stringify(z).padEnd(76)} ${fmt(summarize(ts))} | ${per.join(" ")}`);
        }
  process.exit(0);
}

if (process.env.GRID) {
  // Nur Entwicklungsteil – die Prüfdaten bleiben für die Endkontrolle unberührt
  const js = jobs();
  const combos: Partial<AnalyzerFilters>[] = [];
  for (const trend of ["off", "no-counter", "with"] as const)
    for (const confirm of [false, true])
      for (const minStopAtr of [0, 1, 1.5, 2, 3]) combos.push({ trend, confirm, minStopAtr });
  for (const f of combos) {
    const ts: BacktestTrade[] = [];
    const per: string[] = [];
    for (const j of js) {
      const cut = Math.floor(j.candles.length * 0.6);
      const r = runBacktest(j.candles.slice(0, cut), { horizon: j.horizon, interval: j.interval, filters: f });
      ts.push(...r.trades);
      const sm = summarize(r.trades);
      per.push(`${j.name}:${sm.pf.toFixed(1)}`);
    }
    console.log(`${JSON.stringify(f).padEnd(52)} ${fmt(summarize(ts))} | ${per.join(" ")}`);
  }
  process.exit(0);
}

const all: { part: string; t: BacktestTrade }[] = [];
for (const j of jobs()) {
  const cut = Math.floor(j.candles.length * 0.6);
  for (const [part, c] of [
    ["Entwicklung", j.candles.slice(0, cut)],
    ["Prüfung", j.candles.slice(Math.max(0, cut - 400))],
  ] as const) {
    const r = run(c, j);
    // In der Prüfungs-Hälfte nur Trades nach dem Schnitt zählen
    const ts = part === "Prüfung" ? r.trades.filter((t) => t.entryTime >= j.candles[cut].time) : r.trades;
    ts.forEach((t) => all.push({ part, t }));
    console.log(`${j.name.padEnd(10)} ${part.padEnd(11)} ${String(c.length).padStart(6)} Kerzen | ${fmt(summarize(ts))}`);
  }
}
for (const part of ["Entwicklung", "Prüfung"]) {
  const ts = all.filter((x) => x.part === part).map((x) => x.t);
  console.log(`\nGESAMT ${part}: ${fmt(summarize(ts))}`);
  const by = new Map<string, BacktestTrade[]>();
  for (const t of ts) {
    const k = `${t.direction === "long" ? "↑" : "↓"} ${t.pattern}`;
    by.set(k, [...(by.get(k) ?? []), t]);
  }
  for (const [k, v] of [...by.entries()].sort((a, b) => b[1].length - a[1].length)) console.log(`   ${k.padEnd(40)} ${fmt(summarize(v))}`);
}
