import { describe, expect, it, vi } from "vitest";

describe("Depot: eine Position je Wert (Erstkauf + Nachkauf)", () => {
  it("Summe, Teilverkauf zum Ø Einstieg, Gebühr nur einmal, Stop für alles, Orders ändern", async () => {
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; } };
    vi.stubGlobal("window", { localStorage: ls, addEventListener: () => {} });
    const base = { strategy: "longterm", status: "open", symbol: "SAP.DE", name: "SAP", kind: "stock", currency: "EUR", horizon: "long", interval: "1w", direction: "long", stop: 0, targets: [300], source: "manual", fxEntry: 1, partials: [], remaining: 1, lt: { zoneTop: 200, zoneBottom: 160, invalidation: 140, targets: [300], key: "k" } };
    const t1 = { ...base, id: "a", entry: 200, openedAt: 1, stakeEur: 500, tranches: [{ price: 200, filledAt: 1, qty: 1, eur: 200 }, { price: 150, qty: 2, eur: 300 }] };
    const t2 = { ...base, id: "b", entry: 100, openedAt: 2, nachkauf: true, stakeEur: 300, tranches: [{ price: 100, filledAt: 2, qty: 3, eur: 300 }] };
    store.set("black-ship-trading-analyst:v1", JSON.stringify({ version: 1, watchlist: [], settings: {}, signals: {}, migrations: ["v2-manual-journal", "v3-blacktrader"], trades: [t1, t2] }));
    const { getData } = await import("../src/lib/store/store");
    const P = await import("../src/lib/client/position");
    const { computeAccount } = await import("../src/lib/client/account");
    const group = () => P.blueGroups(getData().trades).get("stock:SAP.DE") ?? [];
    expect(group().map((t) => t.id)).toEqual(["a", "b"]);
    const s = P.positionSummary(group(), 125);
    expect(s.shares).toBe(4);
    expect(s.invested).toBe(500);
    expect(s.avgEur).toBe(125);
    expect(s.reserved).toBe(300);
    expect(s.profit).toBeCloseTo(0, 6);

    // Stop über dem Kurs geht nicht, darunter schon – für beide Käufe, Gebühr nur einmal
    expect(P.setPositionStop(group(), 125, 125)).toContain("0,5 %");
    expect(P.setPositionStop(group(), 110, 125)).toBeNull();
    expect(group().map((t) => [t.stop, !!t.sellFeeShared])).toEqual([[110, false], [110, true]]);
    P.clearPositionStop(group());

    // Wartende Order ändern: 150 € → 140 €, 3 Stück
    expect(P.updateWaitingOrder(group()[0], 1, 140, 3)).toBeNull();
    expect(group()[0].tranches![1]).toMatchObject({ price: 140, qty: 3, eur: 420 });
    expect(group()[0].stakeEur).toBe(620);

    // Hälfte verkaufen (2 von 4 Stück) zu 150 €: Gewinn = 2 × (150 − 125) = 50 €, eine Verkaufsgebühr
    expect(P.sellPosition(group(), 2, 150, false)).toContain("2 Stück");
    const s2 = P.positionSummary(group(), 150);
    expect(s2.shares).toBeCloseTo(2, 9);
    expect(s2.invested).toBeCloseTo(250, 9);
    const [a, b] = group();
    expect(a.partials![0].noFee).toBeUndefined();
    expect(b.partials![0].noFee).toBe(true);

    // Rest verkaufen und wartende Order löschen → beide geschlossen; Konto: Gewinn 50 + 50 = 100 €, Gebühren 2 Käufe + 2 Verkaufs-Orders
    P.sellPosition(group(), 2, 150, true);
    expect(group()).toHaveLength(0);
    const acc = computeAccount(getData().trades, [], () => null).at(-1)!;
    expect(acc.fees).toBeCloseTo(4 * 7.9, 6);
    expect(acc.equity).toBeCloseTo(8000 + 100 - 4 * 7.9 - 100 * 0.275, 6);
  });
});
