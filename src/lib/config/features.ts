// Feature-Flags.
//
// scenarioModel: EIN Szenario pro Wert (alle Zeiteinheiten gemeinsam) statt drei getrennter Zeiträume.
// Aktiviert wird es nur, wenn es auf denselben unbekannten Testdaten besser ist als das alte Modell
// (Trefferquote höher UND Profit-Faktor/Drawdown nicht schlechter UND Signale/Monat höchstens −40 %).
// Messung: DATA_DIR=<ordner> npx tsx scripts/compare-models.ts (Ergebnis siehe README „Modellvergleich“).
// Stand der Messung: NICHT besser → bleibt AUS.
export const FEATURES = {
  scenarioModel: false,
} as const;
