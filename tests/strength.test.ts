import { describe, expect, it } from "vitest";
import { signalStrength } from "../src/components/AssetCard";
import type { AnalysisResult } from "../src/lib/analysis/analyze";

const res = (total: number, direction: "long" | "short" | null, level = "buy") =>
  ({ total, plan: direction ? { direction } : null, decision: { level } }) as unknown as AnalysisResult;

describe("Signalstärke (nur Kauf-Einstiege, Blacktrader zeigt keine Shorts)", () => {
  it("Kauf = Gesamtscore", () => {
    expect(signalStrength(res(72, "long"))).toBe(72);
  });
  it("kein Signal oder Short = keine Stärke", () => {
    expect(signalStrength(res(50, null, "neutral"))).toBeNull();
    expect(signalStrength(res(60, "long", "neutral"))).toBeNull();
    expect(signalStrength(res(25, "short", "strong-sell"))).toBeNull();
  });
});
