"use client";
// Lokaler Speicher (localStorage) für Watchlist, Trades und Einstellungen – kein Server, kein Login.
import { clampWeights, validateWeights } from "../analysis/params";
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
  /** Nachzieh-Abstand ab Ziel 1 */
  trailDistance?: number;
  /** Nach Ziel 1 bei erkanntem Wellen-5-Ende Gewinn sichern (vom Trainer gelernt) */
  wave5Exit?: boolean;
  /** true, sobald Ziel 1 erreicht ist (Stop läuft mit) */
  trailing?: boolean;
  /** ursprünglicher Stop (für Anzeige) */
  initialStop?: number;
  lastPrice?: number;
  exit?: number;
  closedAt?: number;
  closeReason?: "target" | "stop" | "manual" | "cancelled" | "welle5" | "trendbruch" | "invalidiert" | "zaehlung";
  /** "longterm" = Langfristiger Einstieg (blau); "core" = alte Kernposition (vor dem Update); sonst Zonen-Trade */
  strategy?: "zone" | "core" | "longterm";
  /** Langfrist-Bereich (nur strategy "longterm") */
  lt?: { zoneTop: number; zoneBottom: number; invalidation: number; targets: number[]; key: string };
  /** Einstieg in Teilen (Langfrist): Preis und Zeitpunkt der Ausführung */
  tranches?: { price: number; filledAt?: number }[];
  /** Teilausstiege (Anteil der Position, Kurs, Zeitpunkt, Grund) */
  partials?: { fraction: number; price: number; at: number; reason: string }[];
  /** Noch gehaltener Anteil der gekauften Position (1 = alles) */
  remaining?: number;
  /** Letzte Meldung von Blacktrader zu dieser Position (wird nur einmal gesendet) */
  lastActionKey?: string;
  lastActionText?: string;
  /** "manual" = vom Nutzer selbst übernommen (nur solche Trades gehören ins Journal) */
  source?: "manual";
  /** Herkunft unklar (vor dem Update angelegt) – Nutzer entscheidet einmalig */
  unverified?: boolean;
  returnPct?: number;
  /** Hochstufung GRÜN → BLAU (Blacktrader): Zeitpunkt und Grund */
  promotedAt?: number;
  promoteReason?: string;
}

export interface Settings {
  weights: Weights;
  /** "trainer" = gelernte Gewichtung verwenden, "manual" = eigene Regler (gleiche Grenzen) */
  weightsMode: "trainer" | "manual";
  globalHorizon: Horizon;
  intervals: Record<Horizon, Interval>;
  pollSeconds: number;
  notifications: boolean;
  sound: boolean;
  /** Schließen bei erstem oder letztem Kursziel */
  closeAtTarget: "first" | "last";
  /** Expertenansicht: Wellenzählung, Fachbegriffe, Detailwerte */
  expertMode: boolean;
  /** Veraltet: automatisches Papiertrading (entfernt, bleibt aus Kompatibilitätsgründen immer false) */
  autoTrade: boolean;
  /** Vibration bei Alarm und Trade-Übernahme */
  haptics: boolean;
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
  /** Bereits ausgeführte Daten-Migrationen */
  migrations: string[];
  /** Hinweis nach der Migration (einmalig anzeigen) */
  migrationNotice?: { removedAuto: number; unverified: number; backupKey: string; at: number } | null;
}

export const DEFAULT_SETTINGS: Settings = {
  weights: DEFAULT_WEIGHTS,
  weightsMode: "trainer",
  globalHorizon: "medium",
  intervals: { ...HORIZON_DEFAULT_INTERVAL },
  pollSeconds: 30,
  notifications: false,
  sound: true,
  closeAtTarget: "first",
  expertMode: false,
  autoTrade: false,
  haptics: true,
  keys: { finnhub: "", alphavantage: "", openfigi: "", llm: "", llmProvider: "anthropic", llmModel: "" },
};

const DEFAULT_DATA: AppData = { version: 1, watchlist: [], trades: [], settings: DEFAULT_SETTINGS, signals: {}, migrations: [], migrationNotice: null };
export const BACKUP_PREFIX = "black-ship-trading-analyst:backup:";
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
    migrations: Array.isArray(d.migrations) ? d.migrations : [],
    migrationNotice: d.migrationNotice ?? null,
    settings: {
      ...DEFAULT_SETTINGS,
      ...s,
      ...normalizeWeightSettings(s),
      intervals: { ...DEFAULT_SETTINGS.intervals, ...(s.intervals ?? {}) },
      keys: { ...DEFAULT_SETTINGS.keys, ...(s.keys ?? {}) },
      pollSeconds: Math.min(60, Math.max(15, Number(s.pollSeconds) || DEFAULT_SETTINGS.pollSeconds)),
      autoTrade: false,
    },
  };
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      data = sanitize(JSON.parse(raw));
      migrate(raw);
    }
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

/**
 * v2: Journal enthält nur noch selbst übernommene Trades.
 * Vorher vollständiges Backup; automatisch erzeugte Kernpositions-Einträge entfernen;
 * Trades mit unklarer Herkunft markieren (Nutzer entscheidet im Journal).
 */
function migrate(rawBefore: string) {
  const backedUp = migrateV2(rawBefore);
  migrateV3(rawBefore, backedUp);
}

/**
 * v3 (Blacktrader-Update): ein Einstieg pro Wert, keine Zeitraum-Umschalter mehr.
 * Daten bleiben unverändert (offene Trades behalten ihren Zeitraum als Info-Label) – vorher JSON-Backup.
 */
function migrateV3(rawBefore: string, alreadyBackedUp: boolean) {
  if (data.migrations.includes("v3-blacktrader")) return;
  try {
    // Ein Backup des Rohstands genügt (bei gleichzeitiger v2-Migration existiert es schon)
    if (!alreadyBackedUp) window.localStorage.setItem(`${BACKUP_PREFIX}${new Date().toISOString()}-vor-blacktrader`, rawBefore);
  } catch {
    /* Speicher voll: Daten werden ohnehin nicht verändert */
  }
  data = { ...data, migrations: [...data.migrations, "v3-blacktrader"] };
  persist();
}

function migrateV2(rawBefore: string): boolean {
  if (data.migrations.includes("v2-manual-journal")) return false;
  const backupKey = `${BACKUP_PREFIX}${new Date().toISOString()}`;
  try {
    window.localStorage.setItem(backupKey, rawBefore);
  } catch {
    /* Speicher voll: Migration trotzdem, Hinweis zeigt fehlendes Backup */
  }
  const auto = data.trades.filter((t) => t.strategy === "core" && t.source !== "manual");
  const rest = data.trades.filter((t) => !(t.strategy === "core" && t.source !== "manual"));
  const unverified = rest.filter((t) => t.source !== "manual");
  data = {
    ...data,
    trades: rest.map((t) => (t.source === "manual" ? t : { ...t, unverified: true })),
    settings: { ...data.settings, autoTrade: false },
    migrations: [...data.migrations, "v2-manual-journal"],
    migrationNotice: auto.length || unverified.length ? { removedAuto: auto.length, unverified: unverified.length, backupKey, at: Date.now() } : null,
  };
  persist();
  return true;
}

export function listBackups(): { key: string; date: string }[] {
  const out: { key: string; date: string }[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)!;
      if (k.startsWith(BACKUP_PREFIX)) out.push({ key: k, date: k.slice(BACKUP_PREFIX.length) });
    }
  } catch {
    /* nicht verfügbar */
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export function readBackup(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
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
  /** Nur für selbst übernommene Trades (source = manual). */
  addTrade(t: Omit<Trade, "id" | "status"> & { status?: Trade["status"] }) {
    update((d) => ({ ...d, trades: [...d.trades, { ...t, id: uid(), status: t.status ?? "open", source: "manual" }] }));
  },
  updateTrade(id: string, patch: Partial<Trade>) {
    update((d) => ({ ...d, trades: d.trades.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  },
  /** Entscheidung zu Trades mit unklarer Herkunft */
  resolveUnverified(keep: boolean) {
    update((d) => ({
      ...d,
      trades: keep ? d.trades.map((t) => (t.unverified ? { ...t, unverified: false, source: "manual" as const } : t)) : d.trades.filter((t) => !t.unverified),
      migrationNotice: d.migrationNotice ? { ...d.migrationNotice, unverified: 0 } : null,
    }));
  },
  dismissMigrationNotice() {
    update((d) => ({ ...d, migrationNotice: null }));
  },
  restoreBackup(key: string) {
    const raw = readBackup(key);
    if (!raw) throw new Error("Backup nicht gefunden");
    const parsed = sanitize(JSON.parse(raw));
    // Wiederhergestellt: Trades gelten als selbst übernommen, Migration nicht erneut ausführen
    update(() => ({ ...parsed, trades: parsed.trades.map((t) => ({ ...t, source: "manual" as const, unverified: false })), migrations: [...new Set([...parsed.migrations, "v2-manual-journal", "v3-blacktrader"])], migrationNotice: null }));
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

/** Gewichtung immer in den festen Grenzen (Elliott ≥ 60 %, andere ≥ 10 %, Summe 100 %). Alte eigene Werte bleiben als "manuell". */
function normalizeWeightSettings(s: Partial<Settings>): Pick<Settings, "weights" | "weightsMode"> {
  const w = { ...DEFAULT_SETTINGS.weights, ...(s.weights ?? {}) };
  const custom = w.elliott !== DEFAULT_WEIGHTS.elliott || w.fundamental !== DEFAULT_WEIGHTS.fundamental || w.volume !== DEFAULT_WEIGHTS.volume;
  const mode = s.weightsMode ?? (custom ? "manual" : "trainer");
  const sum = w.elliott + w.fundamental + w.volume || 100;
  const scaled = { elliott: (w.elliott / sum) * 100, fundamental: (w.fundamental / sum) * 100, volume: (w.volume / sum) * 100 };
  return { weightsMode: mode, weights: validateWeights(w).length ? clampWeights(scaled, "elliott") : w };
}
