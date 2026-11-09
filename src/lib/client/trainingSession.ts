"use client";
// Steuerung der Trainingssitzung im Browser: Web Worker, Speichern des Fortschritts, Bildschirm-Sperre verhindern,
// Ergebnisse an den Server (der nur speichert, wenn es auf unbekannten Daten besser ist).
import { useSyncExternalStore } from "react";
import { SCAN_PRESETS } from "./presets";
import { cellSummary, refreshTrainerParams, saveLocalCell, trainerParamSet } from "./trainerParams";
import { applyProposal, emptyRecord, summarize, type CellSummary } from "../trainer/cells";
import type { LearnableParams } from "../analysis/params";
import type { WFResult } from "../trainer/walkforward";
import type { Metrics } from "../trainer/engine";
import { getData } from "../store/store";
import type { CellOutcome, SessionState } from "../trainer/session";
import { CELL_KEYS, type CellKey } from "../trainer/universe";

const KEY = "bsh-training-session";
const MSG_KEY = "bsh-training-messages";
export const TOKEN_KEY = "bsh-trainer-token";

interface View {
  session: SessionState | null;
  /** Bestätigungen je Sitzung ("Gespeichert: …") */
  messages: Record<string, string[]>;
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

/**
 * Besseren Stand SOFORT speichern: zuerst beim Server (prüft alles erneut, atomar je Zelle), dann lokal.
 * Ist der Server nicht erreichbar, wird nach denselben Regeln nur lokal gespeichert.
 * Lehnt der Server ab (z. B. Ausgangsstand geändert), wird nichts gespeichert.
 */
async function saveImprovement(cell: CellKey, r: WFResult, baseParams: LearnableParams): Promise<{ ok: boolean; message: string }> {
  let token = "";
  try {
    token = localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    /* ohne Speicher */
  }
  try {
    const res = await fetch("/api/trainer/propose", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "x-trainer-token": token } : {}) },
      body: JSON.stringify({ cell, baseParams, base: r.base, cand: r.cand, deployed: r.deployed }),
    });
    const j = (await res.json().catch(() => ({}))) as { saved?: boolean; note?: string; record?: CellSummary };
    if (res.ok && j.saved && j.record) {
      saveLocalCell(j.record);
      void refreshTrainerParams(true);
      return { ok: true, message: j.note ?? "Gespeichert" };
    }
    if (res.status < 500) return { ok: false, message: res.status === 401 ? "Zugangscode fehlt – nicht gespeichert" : "" };
  } catch {
    /* Server nicht erreichbar → lokal */
  }
  // Nur lokal, mit denselben Regeln
  const cur = cellSummary(cell);
  const rec = { ...emptyRecord(cell), ...(cur ?? {}), versions: [{ id: cur?.version ?? 1, savedAt: cur?.updatedAt ?? "", params: cur?.params ?? {}, standing: cur?.current ?? null, reason: "" }] };
  const out = applyProposal(rec, { baseParams, base: r.base, cand: r.cand, deployed: r.deployed, source: "Browser-Training (lokal)" });
  if (!out.saved) return { ok: false, message: "" };
  saveLocalCell(summarize(out.record));
  return { ok: true, message: `${out.message} (auf diesem Gerät)` };
}

/** Erste Messung einer Zelle merken (ändert keine gelernten Werte; vorhandene Stände bleiben unberührt). */
async function saveMeasurement(cell: CellKey, base: Metrics, baseParams: LearnableParams) {
  if (cellSummary(cell)?.current) return;
  try {
    const res = await fetch("/api/trainer/propose", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...tokenHeader() },
      body: JSON.stringify({ cell, baseParams, base, cand: base, deployed: baseParams }),
    });
    const j = (await res.json().catch(() => ({}))) as { record?: CellSummary };
    if (res.ok && j.record?.current) {
      saveLocalCell(j.record);
      return;
    }
    if (res.status < 500) return;
  } catch {
    /* lokal */
  }
  const cur = cellSummary(cell);
  if (cur?.current) return;
  saveLocalCell({ cell, params: cur?.params ?? {}, current: base, previous: null, updatedAt: new Date().toISOString(), version: cur?.version ?? 1 });
}

function tokenHeader(): Record<string, string> {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    return t ? { "x-trainer-token": t } : {};
  } catch {
    return {};
  }
}

function spawn(state: SessionState) {
  worker?.terminate();
  worker = new Worker(new URL("../trainer/session.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = async (e: MessageEvent) => {
    const m = e.data as
      | { type: "progress"; state: SessionState }
      | { type: "cell"; id: string; outcome: CellOutcome; state: SessionState }
      | { type: "improve"; id: string; cell: CellKey; result: WFResult; baseParams: LearnableParams; state: SessionState }
      | { type: "measured"; cell: CellKey; base: Metrics; baseParams: LearnableParams; state?: undefined };
    if (m.type === "measured") {
      void saveMeasurement(m.cell, m.base, m.baseParams);
      return;
    }
    write(KEY, m.state);
    if (m.type === "improve") {
      const r = await saveImprovement(m.cell, m.result, m.baseParams);
      if (r.message) {
        const list = [...(view.messages[m.state.cfg.id] ?? []), r.message];
        const messages = { ...view.messages, [m.state.cfg.id]: list };
        write(MSG_KEY, messages);
        emit({ messages });
      }
      worker?.postMessage({ type: "saved", id: m.id, ok: r.ok });
    } else if (m.type === "cell") {
      worker?.postMessage({ type: "saved", id: m.id, ok: true });
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
  const raw = read<Record<string, unknown>>(MSG_KEY) ?? {};
  const messages = Object.fromEntries(Object.entries(raw).filter(([, v]) => Array.isArray(v))) as Record<string, string[]>;
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
