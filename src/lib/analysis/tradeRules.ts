// Die Handelsregeln von Blacktrader an EINER Stelle – gleich für Chancen, Turnier und EchoChart:
//  Grün/Rot: Sektor-Regel (Tech-Werte bei schwachem NASDAQ nicht grün), Shorts nur bei bärischem Gesamtmarkt,
//            Chance bis zum Ziel mindestens 15 %, Potenzial in der oberen Hälfte (≥ MIN_POTENTIAL).
//  Blau:     Blau-Regel (Ungültig-Grenze höchstens 40 %, Chance mindestens 40 %).
import type { Candle } from "../types";
import { TECH_SYMBOLS } from "./bestEntry";
import { basePotential, MIN_POTENTIAL, passesBlueRule } from "./potential";

export type Regime = "bullisch" | "neutral" | "baerisch";

export interface RuleCtx {
  symbol: string;
  /** NASDAQ 100 unter der 200-Tage-Linie zum Zeitpunkt t (Sektor-Regel) */
  techWeakAt: (t: number) => boolean;
  /** Marktlage des S&P 500 zum Zeitpunkt t */
  regimeAt: (t: number) => Regime | null;
}

export interface RuledTrade {
  color: "gruen" | "rot";
  short: boolean;
  riskPct?: number;
  chancePct?: number;
}

/** Grüner/roter Trade nach den Regeln erlaubt? (null = aussortiert) */
export function greenRedTrade(t: { direction: string; entryTime: number; entry: number; stop?: number; target?: number }, ctx: RuleCtx): RuledTrade | null {
  const short = t.direction === "short";
  if (!short && TECH_SYMBOLS.has(ctx.symbol) && ctx.techWeakAt(t.entryTime)) return null;
  if (short && ctx.regimeAt(t.entryTime) !== "baerisch") return null;
  const riskPct = t.stop != null ? (Math.abs(t.entry - t.stop) / t.entry) * 100 : undefined;
  const chancePct = t.target != null ? (Math.abs(t.target - t.entry) / t.entry) * 100 : undefined;
  if (chancePct != null && chancePct < 15) return null;
  if (basePotential(chancePct, riskPct, short ? "rot" : "gruen") < MIN_POTENTIAL) return null;
  return { color: short ? "rot" : "gruen", short, riskPct, chancePct };
}

/** Blauer Langfrist-Trade: Ungültig-Grenze und Chance ab der Oberkante, Blau-Regel */
export function blueTrade(t: { invalidation?: number; target?: number; zoneTop?: number }): { riskPct?: number; chancePct?: number; ok: boolean } {
  const riskPct = t.invalidation != null && t.zoneTop ? ((t.zoneTop - t.invalidation) / t.zoneTop) * 100 : undefined;
  const chancePct = t.target != null && t.zoneTop ? ((t.target - t.zoneTop) / t.zoneTop) * 100 : undefined;
  return { riskPct, chancePct, ok: passesBlueRule(chancePct, riskPct) };
}

/** Sektor-Regel aus NASDAQ-100-Tageskerzen: Schlusskurs unter dem 200-Tage-Schnitt */
export function makeTechWeakAt(ndx: Candle[] | null | undefined): (t: number) => boolean {
  const cl = (ndx ?? []).map((c) => c.close);
  return (t: number) => {
    if (!ndx?.length) return false;
    let i = ndx.length - 1;
    while (i > 0 && ndx[i].time > t) i--;
    if (i < 200) return false;
    let m = 0;
    for (let k = i - 199; k <= i; k++) m += cl[k];
    return cl[i] < m / 200;
  };
}
