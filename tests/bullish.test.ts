import { describe, expect, it } from "vitest";
import { bullishCount } from "../src/lib/client/bullish";
import type { AnalysisResult } from "../src/lib/analysis/analyze";
import type { WaveCount } from "../src/lib/analysis/elliott";

const wc = (o: Partial<WaveCount>) => ({ quality: 0.5, ...o }) as WaveCount;
const res = (counts: WaveCount[]) => ({ elliott: { counts } }) as unknown as AnalysisResult;

describe("Kernposition nur mit bullischer Wellenzählung", () => {
  it("Abwärts-Impuls 1-2 ist nicht bullisch", () => {
    expect(bullishCount(res([wc({ pattern: "impulse", direction: -1, bias: -1, complete: false, labels: ["1", "2"] })]))).toBeUndefined();
  });
  it("Aufwärts-Impuls 1-2 (Welle 3 aufwärts erwartet) ist bullisch", () => {
    const c = wc({ pattern: "impulse", direction: 1, bias: 1, complete: false, labels: ["1", "2"] });
    expect(bullishCount(res([c]))).toBe(c);
  });
  it("abgeschlossene A-B-C-Korrektur abwärts ist bullisch", () => {
    const c = wc({ pattern: "zigzag", direction: -1, bias: 1, complete: true, labels: ["A", "B", "C"] });
    expect(bullishCount(res([c]))).toBe(c);
  });
  it("abgeschlossener Aufwärts-Impuls 1-5 (Korrektur erwartet) ist nicht bullisch", () => {
    expect(bullishCount(res([wc({ pattern: "impulse", direction: 1, bias: -1, complete: true, labels: ["1", "2", "3", "4", "5"] })]))).toBeUndefined();
  });
  it("Aufwärts-Impuls wird einer Korrektur vorgezogen", () => {
    const imp = wc({ pattern: "impulse", direction: 1, bias: 1, complete: false, labels: ["1", "2", "3", "4"], quality: 0.4 });
    const zz = wc({ pattern: "zigzag", direction: -1, bias: 1, complete: true, labels: ["A", "B", "C"], quality: 0.7 });
    expect(bullishCount(res([zz, imp]))).toBe(imp);
  });
});
