// Blacktrader handelt nur auf steigende Kurse: Ein Short-Ergebnis der Analyse wird zu „Abwarten“.
// Die Wellen-, Firmen- und Volumen-Beschreibung bleibt (das sind Fakten), Plan, Signal und Texte zum Short entfallen.
import type { AnalysisResult } from "./analyze";

export const WAIT_FALLING = "Der Chart zeigt fallende Kurse – Blacktrader wartet, bis die Korrektur abgeschlossen ist und sich ein Kauf-Einstieg bildet.";

export function longOnly<T extends AnalysisResult | null | undefined>(res: T): T {
  if (!res || res.plan?.direction !== "short") return res;
  const r = res as AnalysisResult;
  return {
    ...r,
    plan: null,
    waitNote: WAIT_FALLING,
    decision: { ...r.decision, level: "neutral", vetoes: [WAIT_FALLING, ...r.decision.vetoes] },
    commentary: {
      ...r.commentary,
      summary: "Abwarten – kein Kauf-Einstieg",
      reason: WAIT_FALLING,
      risk: "",
      headline: "Abwarten",
      plan: "Kein Einstieg: Blacktrader kauft nur und handelt keine fallenden Kurse.",
      invalidation: "–",
      verdict: "Abwarten, bis sich ein Kauf-Einstieg bildet.",
    },
  } as T;
}
