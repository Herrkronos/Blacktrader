// Ziel-Anzeige des Trainers: Stand je Anlageklasse und ob das Ziel erreicht ist.
import { TARGET_HIT_RATE, type Metrics } from "./engine";
import type { AssetKind } from "../types";

export const goalReached = (hitRate: number, target = TARGET_HIT_RATE) => hitRate >= target;

/** Stand einer Anlageklasse: Trefferquote auf unbekannten Daten über alle Horizonte (nach Signalanzahl gewichtet). */
export function classStanding(cells: { cell: string; status: { oos: Metrics } | null }[], kind: AssetKind): { hitRate: number | null; trades: number } {
  let wins = 0;
  let trades = 0;
  for (const c of cells) {
    if (!c.cell.startsWith(`${kind}:`) || !c.status) continue;
    wins += c.status.oos.hitRate * c.status.oos.trades;
    trades += c.status.oos.trades;
  }
  return { hitRate: trades > 0 ? wins / trades : null, trades };
}

/** Füllstand des Balkens 0 … Ziel (in %, max. 100). */
export const goalProgress = (hitRate: number | null, target = TARGET_HIT_RATE) => (hitRate == null ? 0 : Math.min(100, (hitRate / target) * 100));
