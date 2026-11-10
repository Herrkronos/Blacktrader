// Haupt- und Alternativszenario der Elliott-Zählung als Anteile (zusammen 100 %).
//
// Blacktrader handelt immer nur das Hauptszenario. Ist die Alternative fast gleich stark, gibt es keinen neuen
// Einstieg („Notfall“) – das ist die bestehende Münzwurf-Regel der Analyse (Gegenrichtung mit ≥ 85 % der Qualität ≈
// Alternative ≥ 42 %). Wird die Alternative wahrscheinlicher, wird sie automatisch zum Hauptszenario (die Zählung
// mit der höchsten Wahrscheinlichkeit ist immer das Hauptszenario).
import type { ElliottResult } from "./elliott";

export type ScenarioState = "gilt" | "notfall";

export interface ScenarioShare {
  /** Anteil Hauptszenario (0–1) */
  main: number;
  /** Anteil Alternative (0–1) */
  alt: number;
  /** Alternative zeigt in die Gegenrichtung */
  opposite: boolean;
  state: ScenarioState;
}

export function scenarioShare(e: Pick<ElliottResult, "best" | "alternative" | "contested"> | null | undefined): ScenarioShare | null {
  const b = e?.best;
  if (!b) return null;
  const a = e.alternative;
  const pb = b.probability;
  const pa = a?.probability ?? 0;
  const sum = pb + pa;
  const main = sum > 0 ? pb / sum : 1;
  return { main, alt: 1 - main, opposite: !!a && a.bias !== b.bias, state: e.contested ? "notfall" : "gilt" };
}
