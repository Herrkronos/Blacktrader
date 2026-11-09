import { describe, expect, it } from "vitest";
import { cagr, makeWindows, OPPONENTS, rank, regimeIndex, reportLines, RULES, runWindow, summarizeRuns, type PoolTrade, type Series, type Window } from "../src/lib/trainer/tournament";
import type { Candle } from "../src/lib/types";

// Kursverlauf mit Auf und Ab (deterministisch)
function series(n: number, seed = 1, drift = 0.0004, wave = 0.01): Candle[] {
  let p = 100;
  let s = seed;
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    s = (s * 16807) % 2147483647;
    const r = (s / 2147483647 - 0.5) * 0.04 + drift + wave * Math.sin(i / 40);
    const o = p;
    p = Math.max(1, p * (1 + r));
    out.push({ time: 1_400_000_000 + i * 86400, open: o, high: Math.max(o, p) * 1.005, low: Math.min(o, p) * 0.995, close: p, volume: 1000 });
  }
  return out;
}

const DAY = 86400;
const W = (from: number, years = 5): Window => ({ from, to: from + years * 365.25 * DAY, scenario: "gemischt" });
const T = (sym: string, d0: number, d1: number, r: number): PoolTrade => ({ sym, entry: 1_500_000_000 + d0 * DAY, exit: 1_500_000_000 + d1 * DAY, r, px: 100 });
const flat = () => 100;

describe("Turnier: Regeln", () => {
  it("5.000 € Start, 5 Jahre, 50 Versuche, 7 Gegner, KESt 27,5 %", () => {
    expect(RULES).toMatchObject({ start: 5000, years: 5, reps: 50, stake: 500, tax: 0.275 });
    expect(OPPONENTS).toHaveLength(7);
  });
  it("ohne Trades bleibt das Geld liegen", () => {
    const r = runWindow([], W(1_500_000_000), flat);
    expect(r.end).toBe(5000);
    expect(r.trades).toBe(0);
  });
  it("Gewinn wird nach Gebühren und 27,5 % KESt pro Kalenderjahr gerechnet", () => {
    // ein Trade +10 % auf 500 €: 50 € Gewinn − 1 € Gebühr = 49 €, davon 27,5 % KESt
    const r = runWindow([T("A", 10, 40, 10)], W(1_500_000_000), flat);
    expect(r.trades).toBe(1);
    expect(r.tax).toBeCloseTo(49 * 0.275, 6);
    expect(r.profit).toBeCloseTo(49 * 0.725, 6);
  });
  it("Verluste werden im selben Jahr verrechnet", () => {
    const r = runWindow([T("A", 10, 40, 10), T("B", 50, 80, -10)], W(1_500_000_000), flat);
    expect(r.tax).toBe(0);
  });
  it("nur 500 € je Trade und nur mit genug Geld: höchstens 10 Trades gleichzeitig", () => {
    const many = Array.from({ length: 15 }, (_, i) => T(`S${i}`, 10, 100, 1));
    expect(runWindow(many, W(1_500_000_000), flat).trades).toBe(10);
  });
  it("wer kein Geld mehr hat, scheidet aus", () => {
    const crash = Array.from({ length: 30 }, (_, i) => T(`S${i % 10}`, 10 + i * 40, 30 + i * 40, -95));
    expect(runWindow(crash, W(1_500_000_000), flat).broke).toBe(true);
  });
  it("offene Positionen werden am Ende zum Tageskurs bewertet", () => {
    const r = runWindow([T("A", 10, 5000, 50)], W(1_500_000_000), () => 120);
    expect(r.end).toBeCloseTo(5000 + (100 - 1) * 0.725, 6);
  });
  it("50 Zeiträume à 5 Jahre mit Marktlage", () => {
    const spx = series(15 * 252, 3, 0.0004);
    const ws = makeWindows(spx, spx[200].time);
    expect(ws).toHaveLength(50);
    expect(ws.every((w) => w.to - w.from > 4.9 * 365 * DAY)).toBe(true);
    expect(ws.every((w) => ["bullisch", "neutral", "baerisch", "gemischt"].includes(w.scenario))).toBe(true);
  });
  it("Rangliste nach Ø Rendite pro Jahr; Auswertung nennt Trades und Gewinn nach KESt", () => {
    const w = W(1_500_000_000);
    const good = summarizeRuns("blacktrader", "Blacktrader", "", [{ w, r: runWindow([T("A", 10, 40, 20)], w, flat) }]);
    const bad = summarizeRuns("x", "Schlecht", "", [{ w, r: runWindow([T("A", 10, 40, -20)], w, flat) }]);
    const list = rank([bad, good]);
    expect(list[0].name).toBe("Blacktrader");
    expect(cagr(5000)).toBe(0);
    const lines = reportLines({ v: 2, at: "x", rules: { ...RULES }, ranking: list, scenarioCount: {} });
    expect(lines[0]).toContain("Platz 1 von 2");
    expect(lines[0]).toContain("Trades in 5 Jahren");
    expect(lines[0]).toContain("nach KESt");
  });
  it("Marktlage: steigender Index = bullisch, fallender = bärisch", () => {
    const up = series(400, 1, 0.003, 0);
    const down = series(400, 2, -0.003, 0);
    expect(regimeIndex(up)(up[399].time)).toBe("bullisch");
    expect(regimeIndex(down)(down[399].time)).toBe("baerisch");
    expect(regimeIndex(up)(up[50].time)).toBeNull();
  });
});

describe("Turnier: kein Teilnehmer schaut in die Zukunft", () => {
  const data: Series[] = [{ symbol: "X", candles: series(1500, 5) }, { symbol: "Y", candles: series(1500, 9, -0.0002) }];
  for (const o of OPPONENTS.filter((x) => x.id !== "zufall" && x.id !== "ki")) {
    it(`${o.name}: Trades bis zu einem Tag ändern sich nicht, wenn spätere Kurse fehlen`, () => {
      const cut = 1100;
      const full = o.build(data);
      const part = o.build(data.map((d) => ({ ...d, candles: d.candles.slice(0, cut) })));
      const limit = data[0].candles[cut - 1].time;
      const done = (l: PoolTrade[]) => l.filter((t) => t.exit < limit).map((t) => `${t.sym}:${t.entry}:${t.exit}:${t.r.toFixed(6)}`).sort();
      expect(done(part)).toEqual(done(full));
      expect(full.length).toBeGreaterThan(0);
    });
  }
});
