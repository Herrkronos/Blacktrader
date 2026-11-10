// Nachkauf nur bei Blau (getestet 1963–2026): Liegt ein Wert schon im Depot, darf nur bei einem WEITEREN blauen
// Einstieg nachgekauft werden – höchstens 4 × 250 € (Klumpenrisiko begrenzt). Grüne/rote Signale für einen Wert, der
// schon im Depot liegt, werden nicht zusätzlich gehandelt (eine Position je Wert, wie im Test).
import type { LongTermZone } from "../analysis/longterm";
import { getData, type Trade } from "../store/store";
import { ADD } from "./account";

/** Offene Positionen (inkl. wartender Orders) eines Werts im Blacktrader-Depot */
export const openPositions = (symbol: string, trades: Trade[] = getData().trades) => trades.filter((t) => t.status !== "closed" && t.strategy !== "core" && t.symbol === symbol);

export interface NachkaufState {
  /** Wert liegt im Depot */
  held: boolean;
  /** bereits gemachte Nachkäufe (offen) */
  done: number;
  /** noch möglich */
  left: number;
  /** jetzt möglich (blauer Einstieg, noch nicht genutzt, Finanzen nicht schwach) */
  allowed: boolean;
  reason?: string;
}

export function nachkaufState(symbol: string, lt: Pick<LongTermZone, "key"> | null | undefined, trades: Trade[] = getData().trades, weakFinance = false): NachkaufState {
  const pos = openPositions(symbol, trades);
  const held = pos.length > 0;
  const done = pos.filter((t) => t.nachkauf).length;
  const left = Math.max(0, ADD.max - done);
  if (!held) return { held, done, left, allowed: false };
  if (!lt) return { held, done, left, allowed: false, reason: "Nachkauf nur bei einem blauen Einstieg." };
  if (pos.some((t) => t.lt?.key === lt.key)) return { held, done, left, allowed: false, reason: "Diesen blauen Bereich hast du schon gekauft." };
  if (left <= 0) return { held, done, left, allowed: false, reason: `Schon ${ADD.max} Nachkäufe – mehr nicht (Klumpenrisiko).` };
  if (weakFinance) return { held, done, left, allowed: false, reason: "Finanzen schwach – kein Nachkauf." };
  return { held, done, left, allowed: true };
}
