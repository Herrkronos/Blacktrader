// Auswahl einer bullischen Wellenzählung für die Kernposition (nur Anzeige/Filter, Analyse unverändert).
import type { AnalysisResult } from "../analysis/analyze";
import type { WaveCount } from "../analysis/elliott";

/**
 * Bullische Zählung = erwartete nächste Bewegung aufwärts:
 * Aufwärts-Impuls (1-2, 1-2-3-4) oder abgeschlossene Abwärtskorrektur (A-B-C, Flat, Dreieck, W-X-Y).
 * Ausgeschlossen: abgeschlossener Aufwärts-Impuls (dann wird eine Korrektur erwartet).
 */
export function bullishCount(res: AnalysisResult | null | undefined): WaveCount | undefined {
  if (!res) return undefined;
  const ok = res.elliott.counts.filter(
    (c) =>
      c.bias === 1 &&
      ((c.pattern === "impulse" && c.direction === 1 && !c.complete && c.labels.length % 2 === 0) ||
        (c.direction === -1 && c.complete && c.pattern !== "impulse" && c.pattern !== "leading-diagonal") ||
        (c.pattern === "ending-diagonal" && c.direction === -1)),
  );
  // Aufwärts-Impulse bevorzugen, dann nach Wahrscheinlichkeit
  return ok.sort((a, b) => Number(b.pattern === "impulse") - Number(a.pattern === "impulse") || b.quality - a.quality)[0];
}
