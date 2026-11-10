// Order-Zettel für flatex: Stückzahl für 500 € und alle Preise in Euro (wie du sie bei flatex eingibst).
// Aktien/Rohstoffe: ganze Stück; Krypto: Bruchteile (4 Nachkommastellen). Blau: 3 Teile à ca. 166,67 €.
import { eurPerUnit } from "../fx";
import { ACCOUNT } from "./account";
import { tradeCurrency } from "./eur";

const fmt = (x: number) => x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: x < 1 ? 4 : 2 });
const fmtQty = (q: number) => q.toLocaleString("de-DE", { maximumFractionDigits: 4 });

export interface SlipInput {
  kind: string;
  symbol: string;
  name: string;
  currency?: string;
  direction: "long" | "short";
  /** Preise in der Börsenwährung */
  entry: number;
  stop?: number;
  targets?: number[];
  /** Langfrist (blau): Teil-Orders in der Börsenwährung; ungültig-Grenze statt Stop */
  tranches?: number[];
  invalidation?: number;
  limit?: boolean;
}

export interface OrderSlip {
  fx: number;
  entryEur: number;
  stopEur?: number;
  targetEur?: number;
  /** je Order: Stück und Limit in € */
  orders: { qty: number; limitEur: number; amountEur: number }[];
  totalEur: number;
  /** 1 Stück kostet mehr als der Einsatz */
  tooExpensive: boolean;
  text: string;
}

export function qtyFor(kind: string, budget: number, priceEur: number): number {
  if (!(priceEur > 0)) return 0;
  const q = budget / priceEur;
  return kind === "crypto" ? Math.floor(q * 1e4) / 1e4 : Math.floor(q);
}

export function makeOrderSlip(i: SlipInput): OrderSlip {
  const fx = eurPerUnit(tradeCurrency({ symbol: i.symbol, kind: i.kind as never, currency: i.currency })) ?? 1;
  const e = (x: number) => x * fx;
  const prices = i.tranches?.length ? i.tranches : [i.entry];
  const budget = ACCOUNT.stake / prices.length;
  const orders = prices.map((p) => {
    const qty = qtyFor(i.kind, budget, e(p));
    return { qty, limitEur: e(p), amountEur: qty * e(p) };
  });
  const stopEur = i.stop != null && i.stop > 0 ? e(i.stop) : undefined;
  const targetEur = i.targets?.[0] != null ? e(i.targets[0]) : undefined;
  const verb = i.direction === "long" ? "Kauf" : "Verkauf (Short)";
  const lines = [
    `${i.name} (${i.symbol})`,
    ...orders.map((o, k) => `${orders.length > 1 ? `Teil ${k + 1}: ` : ""}${i.limit === false && orders.length === 1 ? `${verb} ${fmtQty(o.qty)} Stück (Markt, ca. ${fmt(o.limitEur)} €)` : `Limit-${verb} ${fmtQty(o.qty)} Stück zu ${fmt(o.limitEur)} €`} = ${fmt(o.amountEur)} €`),
    stopEur != null ? `Stop-Loss: ${fmt(stopEur)} €` : i.invalidation != null ? `Kein fester Stop – ungültig unter ${fmt(e(i.invalidation))} € (Schlusskurs)` : "",
    targetEur != null ? `Ziel: ${fmt(targetEur)} €` : "",
  ].filter(Boolean);
  return { fx, entryEur: e(i.entry), stopEur, targetEur, orders, totalEur: orders.reduce((s, o) => s + o.amountEur, 0), tooExpensive: orders.some((o) => o.qty === 0), text: lines.join("\n") };
}
