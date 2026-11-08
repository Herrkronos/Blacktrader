// LERNBARE Stellschrauben (Trainer). Standardwerte = bisherige feste Werte → ohne Training identisches Verhalten.
// Gewichtung, Regeln und Risiko stehen in locked-config.ts und sind hier bewusst NICHT enthalten.
import type { AssetKind, Horizon } from "../types";

export interface LearnableParams {
  /** ZigZag-Empfindlichkeit (ATR-Faktor) der Zielzonen */
  zoneAtrMult: number;
  /** ZigZag-Empfindlichkeit der drei Wellengrade (fein, mittel, grob) */
  elliottDegrees: [number, number, number];
  /** Breite der Fibonacci-Toleranzbänder (Faktor auf die Standardtoleranz) */
  fibToleranceScale: number;
  /** Ranking alternativer Zählungen: Gewicht der Fibo-Passung (Rest = Grundwert) */
  rankFibWeight: number;
  /** Ranking: Stärke des Kontext-Abschlags (0 = ignorieren, 1 = Standard) */
  rankContextStrength: number;
  /** RSI-Schwellen */
  rsiOverbought: number;
  rsiOversold: number;
  /** Wie frisch eine RSI-Divergenz sein muss (Kerzen) */
  divergenceRecentBars: number;
  /** Volumen: "starkes Volumen" ab relativem Volumen */
  relVolHigh: number;
  /** Volumen: Ausbruch gilt als bestätigt ab relativem Volumen */
  relVolBreakout: number;
  /** Volumen: "dünnes Volumen" unter relativem Volumen */
  relVolLow: number;
  /** Gewichte einzelner Fundamental-Kennzahlen INNERHALB der 20 % (Name → Gewicht) */
  fundamentalWeights: Record<string, number>;
  /** Anteil der News am Fundamental/News-Teil (Rest = Kennzahlen), INNERHALB der 20 % */
  newsShare: number;
  /** Halbwertszeit der News-Gewichtung in Stunden */
  newsHalfLifeHours: number;
  /** Mindest-Signalstärke (0–100), ab der ein Signal angezeigt wird (0 = alle) */
  minStrength: number;
}

export const DEFAULT_PARAMS: LearnableParams = Object.freeze({
  zoneAtrMult: 4,
  elliottDegrees: [1.5, 2.5, 4] as [number, number, number],
  fibToleranceScale: 1,
  rankFibWeight: 0.65,
  rankContextStrength: 1,
  rsiOverbought: 70,
  rsiOversold: 30,
  divergenceRecentBars: 20,
  relVolHigh: 1.5,
  relVolBreakout: 1.3,
  relVolLow: 0.6,
  fundamentalWeights: {},
  newsShare: 0.4,
  newsHalfLifeHours: 36,
  minStrength: 0,
}) as LearnableParams;

/** Erlaubte Bereiche (der Trainer darf nur innerhalb dieser Grenzen und nur diese Schlüssel verändern). */
export const PARAM_BOUNDS: Record<Exclude<keyof LearnableParams, "fundamentalWeights" | "elliottDegrees">, [number, number]> = {
  zoneAtrMult: [2.5, 6],
  fibToleranceScale: [0.6, 1.6],
  rankFibWeight: [0.4, 0.85],
  rankContextStrength: [0, 1.5],
  rsiOverbought: [65, 80],
  rsiOversold: [20, 35],
  divergenceRecentBars: [10, 40],
  relVolHigh: [1.2, 2.2],
  relVolBreakout: [1.1, 2],
  relVolLow: [0.4, 0.8],
  newsShare: [0.2, 0.6],
  newsHalfLifeHours: [12, 72],
  minStrength: [0, 70],
};

export const LEARNABLE_KEYS = Object.keys(DEFAULT_PARAMS) as (keyof LearnableParams)[];

/** Parameter je Anlageklasse und Horizont (z. B. "crypto:short"). */
export type ParamSet = Partial<Record<`${AssetKind}:${Horizon}`, Partial<LearnableParams>>>;

/** Wählt die Parameter für Klasse + Horizont (fehlende Werte = Standard). */
export function resolveParams(set: ParamSet | null | undefined, kind?: AssetKind, horizon?: Horizon): LearnableParams {
  const own = kind && horizon ? set?.[`${kind}:${horizon}`] : undefined;
  return { ...DEFAULT_PARAMS, ...(own ?? {}) };
}

/** Prüft einen Parametersatz: nur erlaubte Schlüssel, nur erlaubte Bereiche. */
export function validateParams(p: Partial<LearnableParams>): string[] {
  const errors: string[] = [];
  for (const [k, v] of Object.entries(p)) {
    if (!LEARNABLE_KEYS.includes(k as keyof LearnableParams)) {
      errors.push(`Nicht lernbar: ${k}`);
      continue;
    }
    const b = (PARAM_BOUNDS as Record<string, [number, number]>)[k];
    if (b && (typeof v !== "number" || v < b[0] || v > b[1])) errors.push(`${k} außerhalb ${b[0]}–${b[1]}`);
    if (k === "elliottDegrees" && (!Array.isArray(v) || v.length !== 3 || v.some((x) => x < 1 || x > 7) || !(v[0] < v[1] && v[1] < v[2]))) errors.push("elliottDegrees ungültig");
    if (k === "fundamentalWeights" && (typeof v !== "object" || Object.values(v as object).some((x) => typeof x !== "number" || x < 0 || x > 3))) errors.push("fundamentalWeights ungültig");
  }
  return errors;
}
