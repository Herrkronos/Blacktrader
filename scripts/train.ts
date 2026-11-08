// Erst-Training offline auf vorhandenen CSV-Kursreihen (gleiche Regeln wie der nächtliche Trainer).
// Aufruf: DATA_DIR=<ordner> npx tsx scripts/train.ts
// Ergebnis: Bericht je Anlageklasse × Horizont (Walk-Forward, unbekannte Prüfdaten) und einmaliger Abschlusstest.
import fs from "node:fs";
import path from "node:path";
import { aggregateCandles } from "../src/lib/data/aggregate";
import { runJob, startFinalJob, startTrainJob, type Universe } from "../src/lib/trainer/job";
import { initialState } from "../src/lib/trainer/state";
import type { CellKey, SeriesSpec } from "../src/lib/trainer/universe";
import type { Candle } from "../src/lib/types";

const DIR = process.env.DATA_DIR ?? "data";
const ROUNDS = Number(process.env.ROUNDS ?? 3);

function readCsv(file: string): Candle[] {
  const lines = fs.readFileSync(path.join(DIR, file), "utf8").trim().split("\n");
  const head = lines[0].toLowerCase().split(",");
  const idx = (k: string) => head.findIndex((h) => h === k);
  const iT = Math.max(0, idx("time"), idx("date"));
  const [iO, iH, iL, iC, iV] = ["open", "high", "low", "close", "volume"].map(idx);
  return lines
    .slice(1)
    .map((l) => {
      const c = l.split(",");
      const raw = c[iT];
      const time = /^\d+$/.test(raw) ? Number(raw) : Math.floor(Date.parse(raw.length <= 10 ? `${raw}T00:00:00Z` : raw.replace(" ", "T") + "Z") / 1000);
      return { time, open: +c[iO], high: +c[iH], low: +c[iL], close: +c[iC], volume: iV >= 0 ? +c[iV] || 0 : 0 };
    })
    .filter((c) => Number.isFinite(c.close) && c.close > 0);
}

// Verfügbare Reihen (Datei, Zusammenfassung in Sekunden)
const SOURCES: Record<string, { file: string; agg?: number; lastYears?: number }> = {
  "SPY 1d": { file: "SPY_D.csv", lastYears: 5 },
  "GOOG 1d": { file: "GOOG.csv", lastYears: 5 },
  "SPY 1w": { file: "SPY_D.csv", agg: 7 * 86400, lastYears: 15 },
  "Gold13 1h": { file: "xau2013_5m.csv", agg: 3600 },
  "Gold16 1h": { file: "xau2016_5m.csv", agg: 3600 },
  "Gold17 1h": { file: "xau2017_5m.csv", agg: 3600 },
};
const UNI: Partial<Record<CellKey, SeriesSpec[]>> = {
  "stock:medium": ["SPY 1d", "GOOG 1d"].map((symbol) => ({ symbol, kind: "stock", horizon: "medium", interval: "1d", days: 0, step: 1 })),
  "stock:long": [{ symbol: "SPY 1w", kind: "stock", horizon: "long", interval: "1w", days: 0, step: 1 }],
  "commodity:short": ["Gold13 1h", "Gold16 1h", "Gold17 1h"].map((symbol) => ({ symbol, kind: "commodity", horizon: "short", interval: "1h", days: 0, step: 1 })),
};
const uni: Universe = (c) => UNI[c] ?? [];
const cache = new Map<string, Candle[]>();
const load = async (s: SeriesSpec) => {
  if (!cache.has(s.symbol)) {
    const src = SOURCES[s.symbol];
    let c = readCsv(src.file);
    if (src.agg) c = aggregateCandles(c, src.agg);
    if (src.lastYears) c = c.filter((x) => x.time >= c[c.length - 1].time - src.lastYears! * 365 * 86400);
    cache.set(s.symbol, c);
  }
  return cache.get(s.symbol)!;
};

async function main() {
  const s = initialState();
  const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
  for (let r = 0; r < ROUNDS; r++) {
    for (const cell of Object.keys(UNI) as CellKey[]) {
      startTrainJob(s, cell, uni);
      while (s.job) await runJob(s, load, Date.now() + 600_000, { universe: uni, maxJobs: 0 });
      const st = s.cells[cell]!;
      console.log(`Runde ${r + 1} ${cell}: Prüfdaten ${pct(st.oos.hitRate)} | ${st.oos.trades} Signale | PF ${st.oos.profitFactor.toFixed(2)} | Ø+ ${st.oos.avgWin.toFixed(2)} % Ø− ${st.oos.avgLoss.toFixed(2)} % | DD ${st.oos.maxDrawdown.toFixed(1)} % | ${s.log[0].kind}: ${s.log[0].change} – ${s.log[0].reason}`);
    }
  }
  // Einmaliger Abschlusstest auf den gesperrten letzten 12 Monaten
  startFinalJob(s, uni);
  while (s.job) await runJob(s, load, Date.now() + 600_000, { universe: uni, maxJobs: 0 });
  const f = s.finalTests[0];
  for (const [c, m] of Object.entries(f.cells)) if (m.trades) console.log(`Abschlusstest ${c}: ${pct(m.hitRate)} | ${m.trades} Signale | PF ${m.profitFactor.toFixed(2)}`);
  console.log(`Versionen: ${s.versions.length} (aktiv ${s.current})`);
  fs.writeFileSync(path.join(DIR, "train-report.json"), JSON.stringify(s, null, 1));
}
void main();
