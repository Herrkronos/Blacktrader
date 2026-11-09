import { describe, expect, it } from "vitest";
import { allowedHorizons, closeInHistory, doneKeys, longTermOutcome, marketContext, pickBestEntry, updateHistory, type BestEntry } from "../src/lib/analysis/bestEntry";
import { checkPromotion, trailStop } from "../src/lib/analysis/promotion";
import type { LongTermZone } from "../src/lib/analysis/longterm";
import type { AnalysisResult } from "../src/lib/analysis/analyze";

const res = (dir: "long" | "short" | null, zone: [number, number] = [100, 95], extra: Partial<AnalysisResult> = {}) =>
  ({
    plan: dir ? { direction: dir, entry: zone[0], stop: zone[1] - 5, targets: [zone[0] + 20], riskReward: 2, zoneStart: zone[0], zoneEnd: zone[1], orderType: "limit" } : null,
    decision: { level: dir ? "buy" : "neutral", vetoes: dir ? [] : ["Keine Einstiegszone in Reichweite"], rawLevel: "neutral" },
    commentary: { reason: "Boden ausgebildet", summary: "Einstieg" },
    elliott: { best: { phase: "Korrektur läuft", bias: 1, pivots: [], targets: [], patternLabel: "Impuls", pattern: "impulse", complete: false, direction: 1 }, contested: false, counts: [] },
    ...extra,
  }) as unknown as AnalysisResult;
const lt = (status: LongTermZone["status"] = "zulaufend"): LongTermZone =>
  ({ start: { time: 1, price: 50 }, high: { time: 2, price: 150 }, zoneTop: 88, zoneBottom: 61, invalidation: 50, targets: [150, 200], tranches: [88, 75, 61], status, deepest: 100, context: "neuer Trend", key: "k1" }) as LongTermZone;
const bull = { spBull: true, techWeak: false };

describe("Ein Einstieg pro Wert", () => {
  it("liefert immer genau einen Einstieg (Blau / Grün / Gelb)", () => {
    expect(pickBestEntry({ symbol: "KO", kind: "stock", views: { medium: res("long") }, ctx: bull }).color).toBe("gruen");
    expect(pickBestEntry({ symbol: "KO", kind: "stock", views: {}, lt: lt(), ctx: bull }).color).toBe("blau");
    expect(pickBestEntry({ symbol: "KO", kind: "stock", views: { medium: res(null) }, ctx: bull }).color).toBe("gelb");
  });
  it("Blau im Bereich hat Vorrang, sonst Grün vor zulaufendem Blau", () => {
    expect(pickBestEntry({ symbol: "KO", kind: "stock", views: { medium: res("long") }, lt: lt("in-zone"), ctx: bull }).color).toBe("blau");
    expect(pickBestEntry({ symbol: "KO", kind: "stock", views: { medium: res("long") }, lt: lt("zulaufend"), ctx: bull }).color).toBe("gruen");
  });
  it("keine Shorts: ein Short-Signal ergibt Gelb mit Hinweis", () => {
    const e = pickBestEntry({ symbol: "KO", kind: "stock", views: { medium: res("short") }, ctx: bull });
    expect(e.color).toBe("gelb");
    expect(e.waitFor).toMatch(/fallende Kurse/);
  });
  it("Aktien und Krypto ohne kurzfristig; Rohstoffe kurzfristig nur im bullischen Markt", () => {
    expect(allowedHorizons("stock", bull)).not.toContain("short");
    expect(allowedHorizons("crypto", bull)).not.toContain("short");
    expect(allowedHorizons("commodity", bull)).toContain("short");
    expect(allowedHorizons("commodity", { spBull: false, techWeak: false })).not.toContain("short");
    expect(pickBestEntry({ symbol: "AAPL", kind: "stock", views: { short: res("long") }, ctx: bull }).color).toBe("gelb");
  });
  it("Sektor-Regel: Tech schwach → keine grünen Tech-Trades, Dividendenwerte weiter", () => {
    const weak = { spBull: false, techWeak: true };
    expect(pickBestEntry({ symbol: "NVDA", kind: "stock", views: { medium: res("long") }, ctx: weak }).color).toBe("gelb");
    expect(pickBestEntry({ symbol: "KO", kind: "stock", views: { medium: res("long") }, ctx: weak }).color).toBe("gruen");
    expect(pickBestEntry({ symbol: "NVDA", kind: "stock", views: {}, lt: lt(), ctx: weak }).color).toBe("blau");
  });
  it("Marktlage aus Tageskerzen", () => {
    const up = Array.from({ length: 260 }, (_, i) => ({ time: i, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1 }));
    expect(marketContext(up, up)).toEqual({ spBull: true, techWeak: false });
  });
});

describe("Alte Einstiege werden grau", () => {
  const k = (time: number, low: number, close: number) => ({ time, open: close, high: Math.max(close, low), low, close, volume: 1 });
  const green: BestEntry = { color: "gruen", key: "g1", zoneTop: 100, zoneBottom: 95, stop: 90, targets: [120], invalidation: 90, reason: "" };
  it("abgelöst, wenn ein anderer Einstieg aktuell wird", () => {
    let h = updateHistory({ past: [] }, green, 10);
    h = updateHistory(h, { ...green, key: "g2", zoneTop: 110 }, 20);
    expect(h.current?.key).toBe("g2");
    expect(h.past[0]).toMatchObject({ key: "g1", status: "abgelöst", to: 20 });
  });
  it("erledigt: in die Zone eingetaucht und oben wieder heraus – wird danach nicht mehr gezeigt", () => {
    let h = updateHistory({ past: [] }, green, 10);
    h = updateHistory(h, green, 40, [k(20, 97, 98), k(30, 99, 103)]);
    expect(h.past[0]).toMatchObject({ key: "g1", status: "erledigt" });
    expect(doneKeys(h).has("g1")).toBe(true);
    expect(pickBestEntry({ symbol: "KO", kind: "stock", views: {}, lt: lt(), ctx: bull, done: new Set(["blau:k1"]) }).color).toBe("gelb");
  });
  it("ungültig, wenn der Kurs unter den Stop schließt", () => {
    let h = updateHistory({ past: [] }, green, 10);
    h = updateHistory(h, green, 40, [k(20, 85, 86)]);
    expect(h.past[0].status).toBe("ungültig");
  });
});

describe("Hochstufung Grün → Blau", () => {
  const weekly = res(null, [0, 0], { elliott: { best: { phase: "Welle 3 läuft", pattern: "impulse", complete: false, direction: 1, bias: 1, targets: [180, 220], patternLabel: "Impuls", pivots: [] }, contested: false } as never });
  const daily = res(null, [0, 0], { elliott: { best: { pivots: [{ type: "L", price: 108, confirmed: true }, { type: "H", price: 130, confirmed: true }] }, contested: false } as never });
  it("Wochenchart bestätigt → hochgestuft, Stop auf das letzte Korrekturtief nachgezogen", () => {
    const p = checkPromotion({ direction: "long", entry: 100, stop: 90, targets: [120] }, weekly, daily, 135);
    expect(p).not.toBeNull();
    expect(p!.stop).toBe(108);
    expect(p!.targets).toEqual([180, 220]);
  });
  it("Stop wird nie zurückgesetzt", () => {
    expect(trailStop(110, 108, 135)).toBe(110);
    expect(trailStop(100, 108, 135)).toBe(108);
    expect(trailStop(100, 140, 135)).toBe(100); // nicht über den Kurs
    expect(checkPromotion({ direction: "long", entry: 100, stop: 115, targets: [120] }, weekly, daily, 135)!.stop).toBe(115);
  });
  it("keine Hochstufung ohne Bestätigung oder im Verlust", () => {
    expect(checkPromotion({ direction: "long", entry: 100, stop: 90, targets: [120] }, res(null, [0, 0], { elliott: { best: undefined, contested: false, counts: [] } } as never), daily, 135)).toBeNull();
    expect(checkPromotion({ direction: "long", entry: 100, stop: 90, targets: [120] }, weekly, daily, 95)).toBeNull();
  });
});

describe("Blauer Bereich ab dem Hoch von Welle 1 geprüft", () => {
  const z = { start: { time: 0, price: 50 }, high: { time: 10, price: 150 }, zoneTop: 88, zoneBottom: 61, invalidation: 50, targets: [150, 200], tranches: [88, 75, 61], status: "zulaufend", deepest: 80, context: "neuer Trend", key: "k9" } as LongTermZone;
  const c = (time: number, low: number, close: number) => ({ time, open: close, high: close + 1, low, close, volume: 1 });
  it("eingetaucht und oben wieder heraus → erledigt (grau), auch wenn vorher nie angezeigt", () => {
    const o = longTermOutcome(z, [c(11, 120, 125), c(12, 85, 90), c(13, 88, 95), c(14, 96, 100)]);
    expect(o?.status).toBe("erledigt");
    expect(o?.at).toBe(13);
    const h = closeInHistory({ past: [] }, o!.entry, o!.status, o!.at);
    expect(doneKeys(h).has("blau:k9")).toBe(true);
    // danach wird Blau nicht mehr als aktueller Einstieg gezeigt
    expect(pickBestEntry({ symbol: "X", kind: "stock", views: {}, lt: z, ctx: bull, done: doneKeys(h) }).color).toBe("gelb");
  });
  it("noch nicht eingetaucht → bleibt aktuell", () => {
    expect(longTermOutcome(z, [c(11, 120, 125), c(12, 95, 100)])).toBeNull();
  });
  it("Schlusskurs unter dem Wellenstart → ungültig", () => {
    expect(longTermOutcome(z, [c(11, 70, 75), c(12, 45, 48)])?.status).toBe("ungültig");
  });
});
