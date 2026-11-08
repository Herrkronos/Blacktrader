import { describe, expect, it } from "vitest";
import { coreStatus, runCoreBacktest } from "../src/lib/analysis/core";
import { candlesFromWaypoints } from "./helpers";

describe("Kernposition (Welle 5 / Boden)", () => {
  it("hält im laufenden Aufwärtstrend und schützt im Abwärtstrend", () => {
    const pts = [100];
    for (let i = 0; i < 14; i++) pts.push(pts[pts.length - 1] * (i % 2 ? 0.93 : 1.15));
    const up = candlesFromWaypoints(pts, 20, 0.003, 2);
    const r = runCoreBacktest(up, { warmup: 120 });
    expect(r.exposure).toBeGreaterThan(0.3);
    expect(r.maxDrawdown).toBeLessThanOrEqual(0);
    const down = candlesFromWaypoints(pts.map((p) => 10000 / p), 20, 0.003, 2);
    const d = runCoreBacktest(down, { warmup: 120 });
    expect(d.stats.totalReturn).toBeGreaterThan(d.buyAndHold);
  });
  it("liefert einen Live-Status", () => {
    const c = candlesFromWaypoints([100, 120, 110, 140, 128, 160, 150, 175, 165, 190], 20, 0.003, 3);
    const s = coreStatus(c)!;
    expect(["hold", "wait-bottom", "flat"]).toContain(s.state);
  });
});
