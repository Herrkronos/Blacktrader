import { describe, expect, it } from "vitest";
import { FEATURES } from "../src/lib/config/features";
import { buildScenario, closedUntil, decideScenario, type TF, type TFView } from "../src/lib/analysis/scenario";
import type { LongTermZone } from "../src/lib/analysis/longterm";
import { candlesFromWaypoints } from "./helpers";

const plan = (dir: "long" | "short") => ({ direction: dir, entry: dir === "long" ? 100 : 110, stop: dir === "long" ? 95 : 115, targets: [dir === "long" ? 110 : 100], riskReward: 2, orderType: "limit" as const, zoneStart: 101, zoneEnd: 99 });
function view(tf: TF, dir: 1 | -1 | 0, signal: "long" | "short" | null = null): TFView {
  const res = {
    plan: signal ? plan(signal) : null,
    decision: { level: signal ? (signal === "long" ? "buy" : "sell") : "neutral" },
    elliott: { contested: false, best: { patternLabel: "Impuls", phase: "Welle 3 läuft", bias: dir || 1, targets: [98], stop: 90 } },
  } as unknown as TFView["res"];
  return { tf, res, dir, signal };
}
const lt = (status: LongTermZone["status"] = "zulaufend"): LongTermZone =>
  ({ start: { time: 1, price: 80 }, high: { time: 2, price: 160 }, zoneTop: 110, zoneBottom: 89, invalidation: 80, targets: [160, 200], tranches: [110, 100, 89], status, deepest: 120, context: "neuer Trend", key: "k" }) as LongTermZone;

describe("Ein Szenario pro Wert", () => {
  it("liefert immer genau eines von Kernposition / Trade / Short / Warten", () => {
    const cases: [TFView[], LongTermZone | null][] = [
      [[view("1w", 1), view("1d", 1, "long")], null],
      [[view("1w", -1), view("1d", -1, "short")], null],
      [[view("1w", 1), view("1d", 1)], lt()],
      [[view("1w", 0), view("1d", 0)], null],
    ];
    const kinds = cases.map(([v, z]) => decideScenario(v, z).kind);
    expect(kinds).toEqual(["trade", "short", "core", "wait"]);
  });

  it("Trade: Richtung von oben, Einstieg aus der feinsten Zeiteinheit mit Signal, Begründung mit Zeiteinheiten", () => {
    const s = decideScenario([view("1w", 1), view("1d", 1, "long"), view("1h", 1, "long")], null);
    expect(s.kind).toBe("trade");
    expect(s.tf).toBe("1h");
    expect(s.invalidation).toBe(95);
    expect(s.summary).toMatch(/Wochenchart/);
    expect(s.summary).toMatch(/1h-Chart/);
  });

  it("Warten bei Widerspruch: Woche aufwärts, Tag zeigt Verkauf", () => {
    const s = decideScenario([view("1w", 1), view("1d", -1, "short")], null);
    expect(s.kind).toBe("wait");
    expect(s.waitFor).toMatch(/widersprüchlich/);
  });

  it("Warten bei Widerspruch zwischen Monat und Woche", () => {
    const s = decideScenario([view("1M", -1), view("1w", 1), view("1d", 1, "long")], lt());
    expect(s.kind).toBe("wait");
  });

  it("Warten bei Kauf und Verkauf auf verschiedenen untergeordneten Zeiteinheiten (kein Kompromiss)", () => {
    const s = decideScenario([view("1w", 1), view("1d", 1, "long"), view("1h", -1, "short")], null);
    expect(s.kind).toBe("wait");
  });

  it("Warten sagt, worauf gewartet wird", () => {
    const s = decideScenario([view("1w", 1), view("1d", -1)], null);
    expect(s.kind).toBe("wait");
    expect(s.waitFor).toMatch(/Warten, bis die Korrektur unter 98/);
  });

  it("Kernposition nicht gegen eine abwärts gerichtete Woche", () => {
    expect(decideScenario([view("1w", -1), view("1d", -1)], lt()).kind).toBe("wait");
  });

  it("nur abgeschlossene Kerzen (kein Blick in die Zukunft)", () => {
    const c = candlesFromWaypoints([100, 120, 110, 130], 20, 0.001);
    const t = c[30].time + 1;
    expect(closedUntil(c, 3600, t).every((x) => x.time + 3600 <= t)).toBe(true);
  });

  it("buildScenario läuft mit echten Kerzen durch", () => {
    const d = candlesFromWaypoints([100, 150, 130, 180, 160, 210, 190], 40, 0.002);
    const s = buildScenario({ symbol: "X", name: "X", frames: { "1d": d } });
    expect(["core", "trade", "short", "wait"]).toContain(s.kind);
  });

  it("Feature-Flag: neues Modell bleibt aus, solange es nicht nachweislich besser ist", () => {
    expect(FEATURES.scenarioModel).toBe(false);
  });
});

describe("Modellvergleich alt gegen neu", () => {
  it("läuft auf denselben Testdaten und sieht nicht in die Zukunft", async () => {
    const { compareModels, runNewModel } = await import("../src/lib/trainer/compare");
    const { aggregateCandles } = await import("../src/lib/data/aggregate");
    const d = candlesFromWaypoints([100, 150, 130, 180, 160, 210, 170, 240, 200, 260], 60, 0.003);
    const mk = (c: typeof d) => ({ name: "X", kind: "stock" as const, frames: { "1w": aggregateCandles(c, 7 * 86400), "1d": c }, testStart: c[Math.floor(c.length * 0.6)].time });
    const r = compareModels([mk(d)]);
    expect(r.rows[0].klass).toBe("stock");
    // Kurse nach einem Zeitpunkt ändern darf frühere, abgeschlossene Trades nicht verändern
    const cut = d[d.length - 40].time;
    const changed = d.map((c) => (c.time > cut ? { ...c, open: c.open * 0.5, high: c.high * 0.5, low: c.low * 0.5, close: c.close * 0.5 } : c));
    const a = runNewModel(mk(d)).trades.filter((t) => t.exitTime < cut - 7 * 86400);
    const b = runNewModel(mk(changed)).trades.filter((t) => t.exitTime < cut - 7 * 86400);
    expect(b).toEqual(a);
  }, 120_000);
});
