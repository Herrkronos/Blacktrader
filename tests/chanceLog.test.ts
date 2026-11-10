import { describe, expect, it } from "vitest";
import { chanceStats, evaluateChance, type ChanceLogEntry } from "../src/lib/client/chanceLog";
import { makeOrderSlip, qtyFor } from "../src/lib/client/orderSlip";

const c = (time: number, low: number, high: number, close = (low + high) / 2) => ({ time, open: close, high, low, close, volume: 0 });
const base: ChanceLogEntry = { key: "k", symbol: "X", name: "X", kind: "stock", color: "gruen", dir: "long", zoneTop: 100, zoneBottom: 95, stop: 90, target: 120, from: 0 };

describe("Live-Bilanz der Chancen", () => {
  it("Ziel nach dem Einstieg = Treffer; Stop zuerst = Stop; Ziel ohne Einstieg = verpasst", () => {
    expect(evaluateChance(base, [c(1, 101, 105), c(2, 99, 104), c(3, 110, 121)]).result).toBe("ziel");
    expect(evaluateChance(base, [c(1, 99, 104), c(2, 89, 100)]).result).toBe("stop");
    expect(evaluateChance(base, [c(1, 105, 122)]).result).toBe("verpasst");
    const open = evaluateChance(base, [c(1, 99, 104)]);
    expect(open.result).toBeUndefined();
    expect(open.entered).toBe(1);
    // Blau: nur Schlusskurs unter der Ungültig-Grenze zählt
    expect(evaluateChance({ ...base, color: "blau" }, [c(1, 99, 104), c(2, 88, 95, 92)]).result).toBeUndefined();
    // nur Kerzen nach dem Eintragen
    expect(evaluateChance({ ...base, from: 5 }, [c(1, 99, 125)]).result).toBeUndefined();
    const s = chanceStats([{ ...base, result: "ziel" }, { ...base, result: "stop" }, { ...base, result: "ziel" }, base]);
    expect(s.hitRate).toBeCloseTo(2 / 3, 6);
    expect(s.open).toBe(1);
  });
});

describe("Order-Zettel für flatex", () => {
  it("ganze Stück für 500 € bei Aktien, Bruchteile bei Krypto, Blau in drei Teilen", () => {
    expect(qtyFor("stock", 500, 119.15)).toBe(4);
    expect(qtyFor("crypto", 500, 61593.88)).toBeCloseTo(0.0081, 6);
    const s = makeOrderSlip({ kind: "stock", symbol: "SAP.DE", name: "SAP", currency: "EUR", direction: "long", entry: 200, stop: 180, targets: [240] });
    expect(s.orders[0]).toMatchObject({ qty: 2, limitEur: 200 });
    expect(s.text).toContain("Limit-Kauf 2 Stück zu 200,00 €");
    expect(s.text).toContain("Stop-Loss: 180,00 €");
    const lt = makeOrderSlip({ kind: "stock", symbol: "SAP.DE", name: "SAP", currency: "EUR", direction: "long", entry: 100, tranches: [100, 90, 80], invalidation: 70, targets: [150] });
    expect(lt.orders.map((o) => o.qty)).toEqual([1, 1, 2]);
    expect(lt.text).toContain("ungültig unter 70,00 €");
  });
});
