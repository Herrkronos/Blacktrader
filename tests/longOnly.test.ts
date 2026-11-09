import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "../src/lib/analysis/analyze";
import { longOnly, WAIT_FALLING } from "../src/lib/analysis/longOnly";

const res = (direction: "long" | "short") =>
  ({
    plan: { direction, entry: 119.81, stop: 175.1, targets: [-2.14, -101.9], riskReward: 2, orderType: "limit" },
    decision: { level: direction === "long" ? "buy" : "sell", vetoes: [], rawLevel: "sell" },
    commentary: { summary: "Verkaufszone 119,81 $–142,84 $", reason: "Einstieg auf fallende Kurse …", risk: "x", headline: "h", elliott: "Wellen", fundamental: "f", volume: "v", plan: "p", invalidation: "i", verdict: "v" },
  }) as unknown as AnalysisResult;

describe("Blacktrader kauft nur", () => {
  it("Short wird zu Abwarten – ohne Verkaufszone, Stop oder Ziel", () => {
    const r = longOnly(res("short"))!;
    expect(r.plan).toBeNull();
    expect(r.decision.level).toBe("neutral");
    expect(r.waitNote).toBe(WAIT_FALLING);
    expect(JSON.stringify(r.commentary)).not.toMatch(/Verkaufszone|fallende Kurse …|-2,14/);
    expect(r.commentary.elliott).toBe("Wellen"); // Fakten bleiben
  });
  it("Kauf-Einstieg bleibt unverändert", () => {
    const a = res("long");
    expect(longOnly(a)).toBe(a);
  });
});
