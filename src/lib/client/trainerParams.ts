"use client";
// Gelernte Werte des Trainers (für alle Nutzer gleich). Ohne Verbindung: zuletzt bekannter Stand bzw. Standardwerte.
import { useSyncExternalStore } from "react";
import { resolveParams, validateParams, type LearnableParams, type ParamSet } from "../analysis/params";
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
export function refreshTrainerParams(): Promise<void> {
  loading ??= fetch("/api/trainer/params")
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
export function learnedParams(kind: AssetKind | undefined, horizon: Horizon): LearnableParams {
  return resolveParams(state.params, kind, horizon);
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
