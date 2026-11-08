"use client";
// Gelernte Werte des Trainers (für alle Nutzer gleich). Ohne Verbindung: zuletzt bekannter Stand bzw. Standardwerte.
import { useSyncExternalStore } from "react";
import { clampWeights, resolveParams, validateParams, validateWeights, type LearnableParams, type ParamSet, type WeightSet } from "../analysis/params";
import type { AssetKind, Horizon } from "../types";

const KEY = "bsh-trainer-params";
let state: { version: number; params: ParamSet } = { version: 0, params: {} };
const subs = new Set<() => void>();

try {
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
  if (raw) state = sanitize(JSON.parse(raw)) ?? state;
} catch {
  /* ohne Speicher */
}

/** Nur gültige, lernbare Werte übernehmen (gesperrte Werte können so nie ankommen). */
function sanitize(x: unknown): typeof state | null {
  if (!x || typeof x !== "object") return null;
  const { version, params } = x as { version?: unknown; params?: unknown };
  if (typeof version !== "number" || !params || typeof params !== "object") return null;
  const clean: ParamSet = {};
  for (const [cell, p] of Object.entries(params as Record<string, Partial<LearnableParams>>)) {
    if (!/^(stock|crypto|commodity):(short|medium|long)$/.test(cell) || !p || typeof p !== "object") continue;
    if (validateParams(p).length === 0) clean[cell as keyof ParamSet] = p;
  }
  return { version, params: clean };
}

let loading: Promise<void> | null = null;
export function refreshTrainerParams(force = false): Promise<void> {
  if (force) loading = null;
  loading ??= fetch(force ? `/api/trainer/params?t=${Date.now()}` : "/api/trainer/params", force ? { cache: "no-store" } : undefined)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const next = sanitize(j);
      if (next && next.version !== state.version) {
        state = next;
        try {
          localStorage.setItem(KEY, JSON.stringify(state));
        } catch {
          /* egal */
        }
        subs.forEach((f) => f());
      }
    })
    .catch(() => {})
    .finally(() => {
      setTimeout(() => (loading = null), 10 * 60e3);
    });
  return loading;
}

export const trainerVersion = () => state.version;
export const trainerParamSet = () => state;
export function learnedParams(kind: AssetKind | undefined, horizon: Horizon): LearnableParams {
  return resolveParams(state.params, kind, horizon);
}
/** Gewichtung, die die Analyse verwendet: eigene (manuell, begrenzt) oder die vom Trainer gelernte. */
export function effectiveWeights(settings: { weights: WeightSet; weightsMode?: "trainer" | "manual" }, kind: AssetKind | undefined, horizon: Horizon): WeightSet {
  if (settings.weightsMode === "manual") return validateWeights(settings.weights).length ? clampWeights(settings.weights, "elliott") : settings.weights;
  return learnedParams(kind, horizon).weights;
}

export function useTrainerVersion(): number {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state.version,
    () => 0,
  );
}

/** Vom Trainer gelernte Gewichtungen je Klasse/Horizont (nur Abweichungen vom Standard). */
export function learnedWeightCells(): { cell: string; weights: WeightSet }[] {
  return Object.entries(state.params)
    .filter(([, p]) => p?.weights)
    .map(([cell, p]) => ({ cell, weights: p!.weights! }));
}
