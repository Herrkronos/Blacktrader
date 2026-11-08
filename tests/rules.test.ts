import { describe, expect, it } from "vitest";
import { openPaperTrade } from "../src/lib/client/autotrade";
import { analyze } from "../src/lib/analysis/analyze";
import { decideSignal, MIN_RISK_REWARD } from "../src/lib/analysis/score";
import { candlesFromWaypoints } from "./helpers";

describe("Kein Einstieg = kein Trade", () => {
  it("Mindest-Chance-Risiko bleibt bei 1,5", () => {
    expect(MIN_RISK_REWARD).toBe(1.5);
  });
  it("ohne Signal wird kein Papier-Trade eröffnet", () => {
    const res = analyze({ symbol: "T", name: "T", candles: candlesFromWaypoints([100, 101, 100, 101, 100, 101], 10, 0.001), horizon: "medium", interval: "1d" })!;
    const neutral = { ...res, decision: { level: "neutral" as const, rawLevel: "neutral" as const, vetoes: [] } };
    expect(openPaperTrade({ kind: "stock", symbol: "T", name: "T" }, neutral)).toBe(false);
    expect(openPaperTrade({ kind: "stock", symbol: "T", name: "T" }, { ...res, plan: null, decision: { level: "buy", rawLevel: "buy", vetoes: [] } })).toBe(false);
  });
  it("ein starker Score ohne gutes Chance-Risiko bleibt neutral", () => {
    const plan = { direction: "long" as const, entry: 100, stop: 90, targets: [105], riskReward: 0.5 };
    expect(decideSignal(90, { elliottConfidence: 1, contested: false, plan }).level).toBe("neutral");
  });
});
