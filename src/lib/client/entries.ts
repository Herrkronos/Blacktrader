"use client";
// Verlauf der Einstiege je Wert (auf dem Gerät gespeichert): aktueller Einstieg + alte (graue) Einstiege.
import { doneKeys, updateHistory, type BestEntry, type HistEntry } from "../analysis/bestEntry";
import type { Candle } from "../types";

export interface EntryHistory {
  current?: HistEntry;
  past: HistEntry[];
}

const KEY = "bt-entry-history-v1";
let cache: Record<string, EntryHistory> | null = null;

function load(): Record<string, EntryHistory> {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    cache = {};
  }
  return cache!;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache ?? {}));
  } catch {
    /* Speicher voll oder gesperrt – Verlauf bleibt nur für diese Sitzung */
  }
}

export const assetKey = (a: { kind: string; symbol: string }) => `${a.kind}:${a.symbol}`;

export function getHistory(key: string): EntryHistory {
  return load()[key] ?? { past: [] };
}

/** Kennungen erledigter/ungültiger Einstiege eines Werts */
export const doneFor = (key: string) => doneKeys(getHistory(key));

/** Neuen Einstieg eintragen; alter wird grau (erledigt/ungültig/abgelöst). */
export function recordEntry(key: string, next: BestEntry, candles: Candle[], now = Math.floor(Date.now() / 1000)): EntryHistory {
  const all = load();
  const h = updateHistory(all[key] ?? { past: [] }, next, now, candles);
  all[key] = h;
  save();
  return h;
}

/** Alle Verläufe (für das Backup) */
export const allHistories = () => ({ ...load() });
