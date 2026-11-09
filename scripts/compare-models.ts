// Vergleich ALT (drei Zeiträume) gegen NEU (ein Szenario pro Wert) auf denselben unbekannten Testdaten (letzte 40 %).
// Aufruf: DATA_DIR=<ordner> npx tsx scripts/compare-models.ts
import fs from "node:fs";
import path from "node:path";
import { aggregateCandles } from "../src/lib/data/aggregate";
import { compareModels, newModelBetter, type CompareSeries } from "../src/lib/trainer/compare";
import type { Metrics } from "../src/lib/trainer/engine";
import type { AssetKind, Candle } from "../src/lib/types";

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
  }).filter((c) => Number.isFinite(c.close) && c.close > 0).sort((a, b) => a.time - b.time);
}
const exists = (f: string) => fs.existsSync(path.join(DIR, f));
const series: CompareSeries[] = [];
function daily(name: string, file: string, kind: AssetKind, years?: number) {
  if (!exists(file)) return;
  let d = readCsv(file);
  if (years) d = d.filter((c) => c.time >= d[d.length - 1].time - years * 365 * 86400);
  series.push({ name, kind, frames: { "1M": aggregateCandles(d, 30 * 86400), "1w": aggregateCandles(d, 7 * 86400), "1d": d }, testStart: d[Math.floor(d.length * 0.6)].time });
}
function intraday(name: string, files: string[], kind: AssetKind) {
  if (!files.every(exists)) return;
  const b = files.flatMap(readCsv).sort((a, c) => a.time - c.time);
  const h1 = aggregateCandles(b, 3600);
  series.push({ name, kind, frames: { "1w": aggregateCandles(b, 7 * 86400), "1d": aggregateCandles(b, 86400), "4h": aggregateCandles(b, 4 * 3600), "1h": h1 }, testStart: h1[Math.floor(h1.length * 0.6)].time });
}
daily("SPY", "SPY_D.csv", "stock", 20);
daily("GOOG", "GOOG.csv", "stock");
intraday("Gold 2016–17", ["xau2016_5m.csv", "xau2017_5m.csv"], "commodity");
intraday("Gold 2013", ["xau2013_5m.csv"], "commodity");

const t0 = Date.now();
const { rows, decisions } = compareModels(series);
const p = (x: number) => `${(x * 100).toFixed(1)} %`;
const f = (m: Metrics) => `${p(m.hitRate).padStart(7)} | ${String(m.trades).padStart(4)} | PF ${m.profitFactor.toFixed(2).padStart(5)} | DD ${m.maxDrawdown.toFixed(1).padStart(6)} % | ${m.perMonth.toFixed(2)}/M`;
console.log(`Reihen: ${series.map((s) => s.name).join(", ")} · Dauer ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(`Entscheidungen NEU: Kernposition ${decisions.core}, Trade ${decisions.trade}, Short ${decisions.short}, Warten ${decisions.wait}`);
for (const r of rows) {
  console.log(`\n${r.klass}`);
  console.log(`  ALT  ${f(r.old)}`);
  console.log(`  NEU  ${f(r.neu)}`);
  for (const k of ["core", "trade", "short"]) console.log(`    ${k.padEnd(6)} ALT ${f(r.oldByKind[k])}  ||  NEU ${f(r.neuByKind[k])}`);
  const d = newModelBetter(r.old, r.neu);
  console.log(`  → ${d.better ? "NEU besser" : `NEU nicht besser (${d.reasons.join(", ")})`}`);
}
console.log(JSON.stringify({ rows: rows.map((r) => ({ klass: r.klass, old: r.old, neu: r.neu })), decisions }));
