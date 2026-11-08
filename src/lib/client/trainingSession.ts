"use client";
// Steuerung der Trainingssitzung im Browser: Web Worker, Speichern des Fortschritts, Bildschirm-Sperre verhindern,
// Ergebnisse an den Server (der nur speichert, wenn es auf unbekannten Daten besser ist).
import { useSyncExternalStore } from "react";
import { SCAN_PRESETS } from "./presets";
import { refreshTrainerParams, trainerParamSet } from "./trainerParams";
import { getData } from "../store/store";
import type { CellOutcome, SessionState } from "../trainer/session";
import { CELL_KEYS, type CellKey } from "../trainer/universe";

const KEY = "bsh-training-session";
const MSG_KEY = "bsh-training-messages";
export const TOKEN_KEY = "bsh-trainer-token";

interface View {
  session: SessionState | null;
  messages: Record<string, string>;
  running: boolean;
  wakeLock: boolean;
}
let view: View = { session: null, messages: {}, running: false, wakeLock: false };
const subs = new Set<() => void>();
const emit = (patch: Partial<View>) => {
  view = { ...view, ...patch };
  subs.forEach((f) => f());
};

function read<T>(k: string): T | null {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* Speicher voll – Fortschritt nur im Arbeitsspeicher */
  }
}

let worker: Worker | null = null;
let lock: { release: () => Promise<void> } | null = null;

async function acquireWakeLock() {
  try {
    const wl = (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    if (!wl || lock) return;
    lock = await wl.request("screen");
    emit({ wakeLock: true });
  } catch {
    emit({ wakeLock: false });
  }
}
function releaseWakeLock() {
  lock?.release().catch(() => {});
  lock = null;
  emit({ wakeLock: false });
}
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && view.running) {
      lock = null;
      void acquireWakeLock();
    }
  });
}

async function submit(o: CellOutcome, baseParams: unknown): Promise<string> {
  if (!o.base || !o.cand) return o.reasons[0] ?? "Kein Ergebnis";
  try {
    let token = "";
    try {
      token = localStorage.getItem(TOKEN_KEY) ?? "";
    } catch {
      /* ohne Speicher */
    }
    const r = await fetch("/api/trainer/propose", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "x-trainer-token": token } : {}) },
      body: JSON.stringify({ cell: o.cell, baseParams, base: o.base, cand: o.cand, deployed: o.deployed, series: o.series }),
    });
    const j = (await r.json().catch(() => ({}))) as { note?: string; saved?: boolean };
    if (j.saved) await refreshTrainerParams(true);
    return j.note ?? (r.ok ? "Gespeichert" : "Nicht gespeichert");
  } catch (e) {
    return `Nicht gespeichert: ${(e as Error).message}`;
  }
}

function spawn(state: SessionState) {
  worker?.terminate();
  worker = new Worker(new URL("../trainer/session.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = async (e: MessageEvent) => {
    const m = e.data as { type: "progress"; state: SessionState } | { type: "cell"; id: string; outcome: CellOutcome; state: SessionState };
    write(KEY, m.state);
    if (m.type === "cell") {
      const msg = await submit(m.outcome, m.state.cfg.baseParams[m.outcome.cell]);
      const messages = { ...view.messages, [`${m.state.cfg.id}:${m.outcome.cell}`]: msg };
      write(MSG_KEY, messages);
      emit({ messages });
      worker?.postMessage({ type: "saved", id: m.id });
    }
    const running = m.state.status === "running";
    emit({ session: m.state, running });
    if (!running) {
      releaseWakeLock();
      worker?.terminate();
      worker = null;
    }
  };
  worker.onerror = () => {
    emit({ running: false });
    releaseWakeLock();
  };
  worker.postMessage({ type: "start", state });
  emit({ session: state, running: true });
  void acquireWakeLock();
}

/** Neue Sitzung starten. */
export async function startTraining(durationMs: number, cells: CellKey[] = [...CELL_KEYS]) {
  if (view.running) return;
  await refreshTrainerParams(true);
  const { version, params } = trainerParamSet();
  const d = getData();
  const extra = [...SCAN_PRESETS, ...d.watchlist].map((a) => ({ symbol: a.symbol, kind: a.kind, yahooSymbol: a.yahooSymbol }));
  const { newSession } = await import("../trainer/session");
  const { resolveParams } = await import("../analysis/params");
  const baseParams = Object.fromEntries(cells.map((c) => {
    const [k, h] = c.split(":") as [never, never];
    return [c, resolveParams(params, k, h)];
  }));
  const st = newSession({ id: String(Date.now()), durationMs, cells, baseVersion: version, paramSet: params, extra, baseParams });
  write(KEY, st);
  spawn(st);
}

export function stopTraining() {
  worker?.postMessage({ type: "stop" });
}

/** Nach dem Neuladen: laufende Sitzung fortsetzen. */
let resumed = false;
export function resumeTraining() {
  if (resumed || typeof window === "undefined") return;
  resumed = true;
  const st = read<SessionState>(KEY);
  const messages = read<Record<string, string>>(MSG_KEY) ?? {};
  emit({ session: st, messages });
  if (st && st.status === "running") spawn(st);
}

export function useTraining(): View {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => view,
    () => view,
  );
}
