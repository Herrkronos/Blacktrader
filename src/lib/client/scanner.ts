"use client";
// Chancen-Scanner (geteilt von Übersicht und Chancen): je Wert alle drei Zeithorizonte + Langfristiger Einstieg.
import { effectiveWeights, learnedParams, refreshTrainerParams } from "./trainerParams";
import { useSyncExternalStore } from "react";
import { analyze, type AnalysisResult } from "../analysis/analyze";
import { findLongTermZone, type LongTermZone } from "../analysis/longterm";
import { getData } from "../store/store";
import type { Candle, Horizon, ResolvedAsset } from "../types";
import { api } from "./api";
import { SCAN_PRESETS } from "./presets";

export interface HorizonResult {
  res: AnalysisResult;
  candles: Candle[];
}

export interface ScanEntry {
  asset: ResolvedAsset;
  horizons: Partial<Record<Horizon, HorizonResult>>;
  /** Langfristiger Einstiegsbereich (blau), berechnet auf dem langfristigen (sonst mittelfristigen) Zeitraum */
  longterm: LongTermZone | null;
  ltHorizon?: Horizon;
  /** Kerzen, auf denen der Bereich berechnet wurde (zum Einzeichnen) */
  ltCandles?: Candle[];
}

export interface ScanState {
  at: number | null;
  entries: ScanEntry[];
  busy: boolean;
  progress: number;
  checked: number;
  failed: number;
}

let state: ScanState = { at: null, entries: [], busy: false, progress: 0, checked: 0, failed: 0 };
const listeners = new Set<() => void>();
const emit = (patch: Partial<ScanState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function useScan(): ScanState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

export function scanAssets(): ResolvedAsset[] {
  const map = new Map<string, ResolvedAsset>();
  for (const a of [...getData().watchlist, ...SCAN_PRESETS]) if (!map.has(`${a.kind}:${a.symbol}`)) map.set(`${a.kind}:${a.symbol}`, a);
  return [...map.values()];
}

/** Startet die Suche (falls nicht schon aktiv). `maxAgeMs`: vorhandenes Ergebnis wiederverwenden, wenn jünger. */
export async function runScan(maxAgeMs = 15 * 60e3) {
  if (state.busy) return;
  if (state.at && Date.now() - state.at < maxAgeMs) return;
  const { settings } = getData();
  const assets = scanAssets();
  const jobs = assets.flatMap((asset) => (["short", "medium", "long"] as Horizon[]).map((horizon) => ({ asset, horizon })));
  const byAsset = new Map<string, ScanEntry>();
  let done = 0;
  let failed = 0;
  emit({ busy: true, progress: 0 });
  await Promise.race([refreshTrainerParams(), new Promise((r) => setTimeout(r, 3000))]);
  await pool(jobs, 4, async ({ asset, horizon }) => {
    const key = `${asset.kind}:${asset.symbol}`;
    const entry = byAsset.get(key) ?? { asset, horizons: {}, longterm: null };
    byAsset.set(key, entry);
    try {
      const interval = settings.intervals[horizon];
      const { candles } = await api.candles(asset, interval, 60e3);
      const params = learnedParams(asset.kind, horizon);
      let res = analyze({ symbol: asset.symbol, name: asset.name, candles, horizon, interval, weights: effectiveWeights(settings, asset.kind, horizon), kind: asset.kind, currency: asset.currency, params });
      if (res && res.decision.level !== "neutral") {
        // Kandidat: mit Firmenzahlen und Nachrichten vollständig bewerten (gleiche Analyse wie bisher)
        const [f, n] = await Promise.allSettled([api.fundamentals(asset), api.news(asset)]);
        res = analyze({
          symbol: asset.symbol,
          name: asset.name,
          candles,
          horizon,
          interval,
          weights: effectiveWeights(settings, asset.kind, horizon),
          kind: asset.kind,
          currency: asset.currency,
          params,
          fundamentals: f.status === "fulfilled" ? f.value.fundamentals : null,
          news: n.status === "fulfilled" ? n.value.news : [],
        });
      }
      if (res) entry.horizons[horizon] = { res, candles: candles.slice(-150) };
      // Langfristiger Einstieg: auf dem langfristigen Zeitraum, sonst auf dem mittelfristigen
      if ((horizon === "long" || (horizon === "medium" && entry.ltHorizon !== "long")) && candles.length >= 150) {
        const z = findLongTermZone(candles);
        if (z && z.status !== "invalidiert") {
          entry.longterm = z;
          entry.ltHorizon = horizon;
          entry.ltCandles = candles.slice(-150);
        }
      }
    } catch {
      failed++;
    }
    done++;
    emit({ progress: done / jobs.length });
  });
  emit({ busy: false, at: Date.now(), entries: [...byAsset.values()], checked: jobs.length, failed });
}

export type SignalKind = "trade" | "short" | "longterm";

/** Abstand vom Kurs bis zur Oberkante des Langfrist-Bereichs in % (0 = im Bereich) */
export function longTermDistance(z: LongTermZone, price: number): number {
  return price <= z.zoneTop ? 0 : ((price - z.zoneTop) / price) * 100;
}

/** Abstand vom aktuellen Kurs bis zum Einstieg in % (0 = jetzt in der Zone) */
export function entryDistance(res: AnalysisResult): number {
  const p = res.plan;
  if (!p || p.orderType !== "limit") return 0;
  return (Math.abs(res.price - p.entry) / res.price) * 100;
}

/** Arten von Signalen, die ein Eintrag hat. */
export function entryKinds(e: ScanEntry): SignalKind[] {
  const out: SignalKind[] = [];
  const active = Object.values(e.horizons).filter((h) => h && h.res.decision.level !== "neutral" && h.res.plan) as HorizonResult[];
  if (active.some((h) => h.res.plan!.direction === "long")) out.push("trade");
  if (active.some((h) => h.res.plan!.direction === "short")) out.push("short");
  if (e.longterm && e.longterm.status !== "invalidiert") out.push("longterm");
  return out;
}
