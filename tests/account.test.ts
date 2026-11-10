import { describe, expect, it } from "vitest";
import { ACCOUNT, computeAccount } from "../src/lib/client/account";
import { summarizeHolding, totalTax } from "../src/lib/client/holdings";
import type { Trade } from "../src/lib/store/store";

const T = (id: string, openedAt: number, r?: number, closedAt?: number, extra: Partial<Trade> = {}): Trade =>
  ({ id, symbol: id, name: id, kind: "stock", horizon: "medium", interval: "1d", direction: "long", entry: 100, stop: 90, targets: [120], openedAt, reason: "", score: 50, signal: "buy", pattern: "", status: closedAt ? "closed" : "open", returnPct: r, closedAt, source: "manual", ...extra }) as Trade;
const Y = Date.UTC(2026, 0, 10);
const D = 86400e3;

describe("Blacktrader-Konto im Depot", () => {
  it("8.000 € Start, 500 € je Trade, 7,90 € je Order, 27,5 % KESt auf den Gewinn", () => {
    expect(ACCOUNT).toMatchObject({ start: 8000, stake: 500, fee: 7.9, tax: 0.275 });
    const [a] = computeAccount([T("A", Y, 10, Y + D)], [], () => null);
    // +10 % auf 500 € = 50 €, 2 × 7,90 € Gebühr, 13,75 € KESt
    expect(a.equity).toBeCloseTo(8000 + 50 - 15.8 - 13.75, 6);
    expect(a.fees).toBeCloseTo(15.8, 6);
    expect(a.tax).toBeCloseTo(13.75, 6);
    expect(a.closed).toBe(1);
    expect(a.wins).toBe(1);
  });
  it("Verlust im selben Jahr holt KESt zurück; offene Trades zum aktuellen Kurs bewertet", () => {
    const [a] = computeAccount([T("A", Y, 10, Y + D), T("B", Y + 2 * D, -10, Y + 3 * D), T("C", Y + 4 * D)], [], () => 20);
    expect(a.tax).toBeCloseTo(0, 6);
    expect(a.open).toBe(1);
    expect(a.equity).toBeCloseTo(8000 - 4 * 7.9 - 7.9 + 100, 6);
  });
  it("ohne Geld keine neuen Trades; ohne Geld und ohne offene Position pleite – Neustart beginnt eine neue Runde", () => {
    const many = Array.from({ length: 16 }, (_, i) => T(`S${i}`, Y + i));
    const [a] = computeAccount(many, [], () => 0);
    expect(a.blocked).toBe(true);
    expect(a.broke).toBe(false);
    const lost = Array.from({ length: 16 }, (_, i) => T(`L${i}`, Y + i * D, -100, Y + i * D + 1000));
    const [b] = computeAccount(lost, [], () => null);
    expect(b.broke).toBe(true);
    const rounds = computeAccount(lost, [Y + 20 * D], () => null);
    expect(rounds).toHaveLength(2);
    expect(rounds[1].equity).toBe(8000);
    expect(rounds[1].broke).toBe(false);
  });
});

describe("Konto mit echtem Betrag (Stück × Kurs)", () => {
  it("rechnet mit dem eingesetzten Betrag statt pauschal 500 €", () => {
    const [a] = computeAccount([T("U", Y, 10, Y + D, { stakeEur: 506.56 })], [], () => null);
    expect(a.equity).toBeCloseTo(8000 + 50.656 - 15.8 - 50.656 * 0.275, 6);
  });
});

describe("Buy & Hold", () => {
  it("gleitender Durchschnittspreis, verkaufter Gewinn, Gebühren, KESt je Jahr verrechnet", () => {
    const s = summarizeHolding({
      txs: [
        { id: "1", type: "buy", date: "2025-01-02", price: 100, qty: 10, fee: 7.9 },
        { id: "2", type: "buy", date: "2025-06-02", price: 200, qty: 10, fee: 7.9 },
        { id: "3", type: "sell", date: "2026-03-01", price: 180, qty: 5, fee: 7.9 },
      ],
    });
    expect(s.avg).toBeCloseTo(150, 6);
    expect(s.qty).toBe(15);
    expect(s.realized).toBeCloseTo(150, 6);
    expect(s.fees).toBeCloseTo(23.7, 6);
    expect(s.tax).toBeCloseTo(150 * 0.275, 6);
    const loss = summarizeHolding({ txs: [{ id: "a", type: "buy", date: "2026-01-01", price: 50, qty: 10, fee: 0 }, { id: "b", type: "sell", date: "2026-05-01", price: 40, qty: 10, fee: 0 }] });
    expect(loss.qty).toBe(0);
    expect(totalTax([s, loss])).toBeCloseTo(50 * 0.275, 6);
  });
});
