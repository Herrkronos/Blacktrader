"use client";
// Lokaler Speicher (localStorage) für Watchlist, Trades und Einstellungen – kein Server, kein Login.
import { useRef, useSyncExternalStore } from "react";
import { DEFAULT_WEIGHTS, type SignalLevel, type Weights } from "../analysis/score";
import { HORIZON_DEFAULT_INTERVAL, type Horizon, type Interval, type ResolvedAsset } from "../types";

export interface WatchItem extends ResolvedAsset {
  id: string;
  addedAt: number;
  /** Eigener Horizont (überschreibt den globalen) */
  horizon?: Horizon;
}

export interface Trade {
  id: string;
  symbol: string;
  name: string;
  kind: ResolvedAsset["kind"];
  binanceSymbol?: string;
  yahooSymbol?: string;
  direction: "long" | "short";
  horizon: Horizon;
  interval: Interval;
  entry: number;
  stop: number;
  targets: number[];
  openedAt: number;
  reason: string;
  score: number;
  signal: SignalLevel;
  pattern?: string;
  /** pending = wartende Limit-Order in der Zone */
  status: "pending" | "open" | "closed";
  orderType?: "limit" | "market";
  cancelAbove?: number;
  /** Ablauf der wartenden Order (ms) */
  expiresAt?: number;
  lastPrice?: number;
  exit?: number;
  closedAt?: number;
  closeReason?: "target" | "stop" | "manual" | "cancelled";
  returnPct?: number;
}

export interface Settings {
  weights: Weights;
  globalHorizon: Horizon;
  intervals: Record<Horizon, Interval>;
  pollSeconds: number;
  notifications: boolean;
  sound: boolean;
  /** Schließen bei erstem oder letztem Kursziel */
  closeAtTarget: "first" | "last";
  /** Expertenansicht: Wellenzählung, Fachbegriffe, Detailwerte */
  expertMode: boolean;
  /** Signale automatisch als Papier-Trades übernehmen */
  autoTrade: boolean;
  keys: {
    finnhub: string;
    alphavantage: string;
    openfigi: string;
    llm: string;
    llmProvider: "anthropic" | "openai";
    llmModel: string;
  };
}

export interface AppData {
  version: 1;
  watchlist: WatchItem[];
  trades: Trade[];
  settings: Settings;
  /** Letztes Signal je Wert+Horizont (für Alarme) */
  signals: Record<string, { level: SignalLevel; time: number }>;
}

export const DEFAULT_SETTINGS: Settings = {
  weights: DEFAULT_WEIGHTS,
  globalHorizon: "medium",
  intervals: { ...HORIZON_DEFAULT_INTERVAL },
  pollSeconds: 30,
  notifications: false,
  sound: true,
  closeAtTarget: "first",
  expertMode: false,
  autoTrade: true,
  keys: { finnhub: "", alphavantage: "", openfigi: "", llm: "", llmProvider: "anthropic", llmModel: "" },
};

const DEFAULT_DATA: AppData = { version: 1, watchlist: [], trades: [], settings: DEFAULT_SETTINGS, signals: {} };
const KEY = "black-ship-trading-analyst:v1";

let data: AppData = DEFAULT_DATA;
let loaded = false;
const listeners = new Set<() => void>();

function sanitize(raw: unknown): AppData {
  const d = (raw ?? {}) as Partial<AppData>;
  const s = (d.settings ?? {}) as Partial<Settings>;
  return {
    version: 1,
    watchlist: Array.isArray(d.watchlist) ? d.watchlist.filter((w) => w && w.id && w.symbol) : [],
    trades: Array.isArray(d.trades) ? d.trades.filter((t) => t && t.id && t.symbol) : [],
    signals: d.signals && typeof d.signals === "object" ? d.signals : {},
    settings: {
      ...DEFAULT_SETTINGS,
      ...s,
      weights: { ...DEFAULT_SETTINGS.weights, ...(s.weights ?? {}) },
      intervals: { ...DEFAULT_SETTINGS.intervals, ...(s.intervals ?? {}) },
      keys: { ...DEFAULT_SETTINGS.keys, ...(s.keys ?? {}) },
      pollSeconds: Math.min(60, Math.max(15, Number(s.pollSeconds) || DEFAULT_SETTINGS.pollSeconds)),
    },
  };
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) data = sanitize(JSON.parse(raw));
  } catch {
    data = DEFAULT_DATA;
  }
  window.addEventListener("storage", (e) => {
    if (e.key === KEY && e.newValue) {
      try {
        data = sanitize(JSON.parse(e.newValue));
        listeners.forEach((l) => l());
      } catch {
        /* ignorieren */
      }
    }
  });
}

function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* Speicher voll oder gesperrt */
  }
}

export function getData(): AppData {
  load();
  return data;
}

export function update(fn: (d: AppData) => AppData) {
  load();
  data = fn(data);
  persist();
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  load();
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Selektor-Hook. Das Ergebnis wird je Datenstand gecacht, damit abgeleitete Arrays stabil bleiben. */
export function useAppData<T>(selector: (d: AppData) => T): T {
  const memo = useRef<{ src: AppData; value: T } | null>(null);
  const select = (src: AppData) => {
    if (memo.current && memo.current.src === src) return memo.current.value;
    const value = selector(src);
    memo.current = { src, value };
    return value;
  };
  return useSyncExternalStore(
    subscribe,
    () => select(getData()),
    () => select(DEFAULT_DATA),
  );
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// --- Aktionen
export const actions = {
  addWatch(asset: ResolvedAsset) {
    update((d) => {
      if (d.watchlist.some((w) => w.kind === asset.kind && w.symbol === asset.symbol)) return d;
      return { ...d, watchlist: [...d.watchlist, { ...asset, id: uid(), addedAt: Date.now() }] };
    });
  },
  removeWatch(id: string) {
    update((d) => ({ ...d, watchlist: d.watchlist.filter((w) => w.id !== id) }));
  },
  setItemHorizon(id: string, horizon: Horizon | undefined) {
    update((d) => ({ ...d, watchlist: d.watchlist.map((w) => (w.id === id ? { ...w, horizon } : w)) }));
  },
  setSettings(patch: Partial<Settings>) {
    update((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  },
  setKeys(patch: Partial<Settings["keys"]>) {
    update((d) => ({ ...d, settings: { ...d.settings, keys: { ...d.settings.keys, ...patch } } }));
  },
  addTrade(t: Omit<Trade, "id" | "status"> & { status?: Trade["status"] }) {
    update((d) => ({ ...d, trades: [...d.trades, { ...t, id: uid(), status: t.status ?? "open" }] }));
  },
  updateTrade(id: string, patch: Partial<Trade>) {
    update((d) => ({ ...d, trades: d.trades.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  },
  removeTrade(id: string) {
    update((d) => ({ ...d, trades: d.trades.filter((t) => t.id !== id) }));
  },
  setSignal(key: string, level: SignalLevel) {
    update((d) => ({ ...d, signals: { ...d.signals, [key]: { level, time: Date.now() } } }));
  },
  exportJson(includeKeys = false): string {
    const d = getData();
    const out = includeKeys ? d : { ...d, settings: { ...d.settings, keys: { ...DEFAULT_SETTINGS.keys, llmProvider: d.settings.keys.llmProvider } } };
    return JSON.stringify({ app: "black-ship-trading-analyst", exportedAt: new Date().toISOString(), ...out }, null, 2);
  },
  importJson(json: string, keepKeys = true) {
    const parsed = sanitize(JSON.parse(json));
    update((d) => ({ ...parsed, settings: keepKeys && !parsed.settings.keys.llm && !parsed.settings.keys.finnhub ? { ...parsed.settings, keys: d.settings.keys } : parsed.settings }));
  },
  reset() {
    update(() => DEFAULT_DATA);
  },
};
