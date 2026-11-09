import { describe, expect, it } from "vitest";
import { evaluate, OPPONENTS, rank, regimeIndex, reportLines, RULES, simulate, type PoolTrade, type Series } from "../src/lib/trainer/tournament";
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

describe("Turnier: Regeln", () => {
  it("5.000 € Start, 500 Trades, 50 Durchgänge, 7 Gegner", () => {
    expect(RULES).toMatchObject({ start: 5000, trades: 500, reps: 50 });
    expect(OPPONENTS).toHaveLength(7);
  });
  it("gleicher Startwert → gleiches Ergebnis; ohne Trades bleibt das Geld liegen", () => {
    const pool = { bullisch: [2, -1, 3], neutral: [1, -2], baerisch: [-1, 1] };
    expect(simulate(pool, 3, "gemischt")).toEqual(simulate(pool, 3, "gemischt"));
    expect(simulate({ bullisch: [], neutral: [], baerisch: [] }, 1, "bullisch").end).toBe(5000);
  });
  it("Gebühren und KESt: lauter +1-%-Trades bringen weniger als ohne Abzüge", () => {
    const r = simulate({ bullisch: [1], neutral: [1], baerisch: [1] }, 1, "bullisch");
    expect(r.end).toBeGreaterThan(5000);
    expect(r.end).toBeLessThan(5000 + 500 * 500 * 0.01);
  });
  it("Pleite wird erkannt", () => {
    const r = simulate({ bullisch: [-50], neutral: [-50], baerisch: [-50] }, 1, "baerisch");
    expect(r.broke).not.toBeNull();
  });
  it("Rangliste nach Median-Endkapital, Platz je Szenario", () => {
    const reg = (t: number) => (["bullisch", "neutral", "baerisch"] as const)[t % 3];
    const good: PoolTrade[] = Array.from({ length: 50 }, (_, i) => ({ sym: "A", entry: i, exit: i + 1, r: 2 }));
    const bad: PoolTrade[] = good.map((t) => ({ ...t, r: -1 }));
    const list = rank([evaluate("b", "Schlecht", "", bad, reg), evaluate("blacktrader", "Blacktrader", "", good, reg)]);
    expect(list[0].name).toBe("Blacktrader");
    expect(list[0].rank).toBe(1);
    expect(list[0].rankByScenario.bullisch).toBe(1);
    expect(reportLines({ at: "x", rules: RULES, ranking: list })[0]).toContain("Platz 1 von 2");
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
