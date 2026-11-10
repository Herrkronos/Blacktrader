"use client";
// Langfrist-Positionen (blau) als Papier-Trades: Einstieg in drei Teilen, kein fester Stop.
// Teilausstieg / Stop / Ausstieg NUR, wenn Blacktrader eine geänderte Zählung meldet (assessLongTerm).
import { makeOrderSlip } from "./orderSlip";
import { toEurReturn, tradeCurrency } from "./eur";
import { eurPerUnit } from "../fx";
import { analyzeElliott } from "../analysis/elliott";
import { assessLongTerm, blendedReturn, type LongTermAction, type LongTermZone } from "../analysis/longterm";
import { money } from "../analysis/persona";
import { actions, getData, type Trade } from "../store/store";
import { ADD, canAfford, freeCash, noMoney, noTwice } from "./account";
import { nachkaufState, openPositions } from "./nachkauf";
import type { Candle, Horizon, Interval, ResolvedAsset } from "../types";

type Asset = Pick<ResolvedAsset, "symbol" | "name" | "kind" | "binanceSymbol" | "yahooSymbol" | "currency" | "isin" | "exchange" | "coingeckoId">;

export const openLongTerm = (symbol: string) => getData().trades.find((t) => t.strategy === "longterm" && t.status !== "closed" && t.symbol === symbol);

/**
 * Langfristigen Einstieg übernehmen: drei wartende Teil-Orders im Bereich (500 €).
 * `nachkauf`: Wert liegt schon im Depot → nur ein weiterer blauer Bereich, eine Order zu 250 € an der Oberkante
 * (höchstens 4 Nachkäufe, siehe nachkauf.ts).
 */
export function openLongTermTrade(asset: Asset, z: LongTermZone, horizon: Horizon, interval: Interval, price: number, opts: { nachkauf?: boolean } = {}): boolean {
  const nk = opts.nachkauf === true;
  if (nk ? !nachkaufState(asset.symbol, z).allowed : openPositions(asset.symbol).length > 0) {
    if (!nk) noTwice();
    return false;
  }
  const levels = nk ? [z.zoneTop] : [...z.tranches];
  const slip = makeOrderSlip({ kind: asset.kind, symbol: asset.symbol, name: asset.name, currency: asset.currency, direction: "long", entry: z.zoneTop, tranches: levels, budget: nk ? ADD.stake : undefined });
  const amount = slip.totalEur > 0 ? slip.totalEur : undefined;
  if (!canAfford(getData().trades, getData().accountResets, amount)) {
    noMoney(freeCash(getData().trades, getData().accountResets));
    return false;
  }
  const now = Date.now();
  const tranches = levels.map((p) => ({ price: p, filledAt: price <= p ? now : undefined }));
  const filled = tranches.filter((t) => t.filledAt);
  actions.addTrade({
    strategy: "longterm",
    status: filled.length ? "open" : "pending",
    orderType: "limit",
    symbol: asset.symbol,
    name: asset.name,
    kind: asset.kind,
    binanceSymbol: asset.binanceSymbol,
    yahooSymbol: asset.yahooSymbol,
    currency: asset.currency,
    direction: "long",
    horizon,
    interval,
    entry: filled.length ? Math.min(price, ...filled.map((t) => t.price)) : levels[0],
    stop: 0,
    targets: [...z.targets],
    openedAt: now,
    nachkauf: nk || undefined,
    reason: nk ? `Nachkauf (250 €) im neuen blauen Bereich ${money(z.zoneTop, asset.currency)} – ${money(z.zoneBottom, asset.currency)}. Kein fester Stop – ungültig bei Schlusskurs unter ${money(z.invalidation, asset.currency)}.` : `Langfristiger Einstieg in drei Teilen ${money(z.zoneTop, asset.currency)} – ${money(z.zoneBottom, asset.currency)}. Kein fester Stop – ungültig bei Schlusskurs unter ${money(z.invalidation, asset.currency)}. Teilausstieg oder Stop nur, wenn sich die Wellenzählung ändert.`,
    score: 0,
    signal: "buy",
    pattern: "Langfrist-Einstiegsbereich",
    lastPrice: price,
    lt: { zoneTop: z.zoneTop, zoneBottom: z.zoneBottom, invalidation: z.invalidation, targets: [...z.targets], key: z.key },
    tranches,
    partials: [],
    remaining: 1,
    source: "manual",
    shares: slip.orders.reduce((s, o) => s + o.qty, 0),
    stakeEur: amount,
  });
  actions.addWatch(asset as ResolvedAsset); // überwachen, damit Blacktrader Meldungen geben kann
  return true;
}

export const filledTranches = (t: Trade) => (t.tranches ?? []).filter((x) => x.filledAt);
export const avgEntry = (t: Trade) => {
  const f = filledTranches(t);
  return f.length ? f.reduce((s, x) => s + x.price, 0) / f.length : t.entry;
};

/** Laufende Kurse: Teil-Orders ausführen, gesetzten Stop prüfen. Gibt eine Meldung zurück, wenn etwas passiert. */
export function trackLongTerm(t: Trade, price: number): string | null {
  if (t.strategy !== "longterm" || t.status === "closed") return null;
  const now = Date.now();
  let changed = false;
  const tranches = (t.tranches ?? []).map((x) => {
    if (!x.filledAt && t.lastActionKey == null && price <= x.price) {
      changed = true;
      return { ...x, filledAt: now, price: Math.min(x.price, price) };
    }
    return x;
  });
  let msg: string | null = null;
  if (changed) {
    const n = tranches.filter((x) => x.filledAt).length;
    const f = tranches.filter((x) => x.filledAt);
    actions.updateTrade(t.id, { tranches, status: "open", entry: f.reduce((s, x) => s + x.price, 0) / f.length, lastPrice: price });
    msg = `Teil ${n} von 3 gekauft bei ${money(price, tradeCurrency(t))}.`;
  }
  if (t.status === "open" && t.stop > 0 && price <= t.stop) {
    closeLongTerm({ ...t, tranches }, price, "stop");
    return `Stop bei ${money(t.stop, tradeCurrency(t))} erreicht – Rest verkauft.`;
  }
  return msg;
}

export function closeLongTerm(t: Trade, price: number, reason: Trade["closeReason"]) {
  const filled = filledTranches(t);
  if (!filled.length) {
    actions.updateTrade(t.id, { status: "closed", closedAt: Date.now(), closeReason: "cancelled", lastPrice: price });
    return;
  }
  const entry = avgEntry(t);
  actions.updateTrade(t.id, { status: "closed", exit: price, closedAt: Date.now(), closeReason: reason, returnPct: toEurReturn(blendedReturn(entry, t.partials ?? [], price), t), fxExit: eurPerUnit(tradeCurrency(t)) ?? undefined, lastPrice: price, remaining: 0 });
}

/** Meldung von Blacktrader auf die Position anwenden (Papier-Trade folgt der Meldung). */
export function applyLongTermAction(t: Trade, a: LongTermAction, price: number): string {
  const filled = filledTranches(t).length;
  const base = { lastActionKey: a.key, lastActionText: a.reason };
  if (a.kind === "ausstieg" || !filled) {
    actions.updateTrade(t.id, base);
    closeLongTerm({ ...t, ...base }, price, a.kind === "ausstieg" ? "invalidiert" : "zaehlung");
    return filled ? a.reason : "Zählung geändert – wartende Teil-Orders gestrichen.";
  }
  if (a.kind === "teilausstieg") {
    const remaining = t.remaining ?? 1;
    const fraction = remaining * a.fraction;
    actions.updateTrade(t.id, { ...base, partials: [...(t.partials ?? []), { fraction, price, at: Date.now(), reason: a.reason }], remaining: remaining - fraction, stop: a.stop, tranches: (t.tranches ?? []).filter((x) => x.filledAt) });
    return `${a.reason} Verkauft bei ${money(price, tradeCurrency(t))}, Stop ${money(a.stop, tradeCurrency(t))}.`;
  }
  actions.updateTrade(t.id, { ...base, stop: a.stop, tranches: (t.tranches ?? []).filter((x) => x.filledAt) });
  return `${a.reason} Stop ${money(a.stop, tradeCurrency(t))}.`;
}

/** Bewertung mit Kerzen der Positions-Kerzengröße (Wellenzählung auf denselben Kerzen). */
export function checkLongTermWithCandles(t: Trade, candles: Candle[]): string | null {
  if (t.strategy !== "longterm" || t.status === "closed" || !t.lt || candles.length < 60) return null;
  const elliott = analyzeElliott(candles.slice(-600));
  const a = assessLongTerm({ direction: "long", entry: avgEntry(t), invalidation: t.lt.invalidation, stop: t.stop || undefined, remaining: t.remaining ?? 1, lastActionKey: t.lastActionKey }, candles, elliott);
  if (!a) return null;
  return applyLongTermAction(t, a, candles[candles.length - 1].close);
}
