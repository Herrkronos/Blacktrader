// Web Worker: Trainingssitzung rechnet hier, damit die App flüssig bleibt.
import type { Candle } from "../types";
import { runSession, checkpoint, type CellOutcome, type SessionState } from "./session";
import type { SeriesSpec } from "./universe";

let stop = false;
const pending = new Map<string, (ok: boolean) => void>();
let seq = 0;

async function load(spec: SeriesSpec): Promise<Candle[] | null> {
  const url = `/api/history?yahoo=${encodeURIComponent(spec.symbol)}&interval=${spec.interval}&days=${spec.days}`;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 429) {
        await new Promise((res) => setTimeout(res, 3000 * (i + 1)));
        continue;
      }
      if (!r.ok) return null;
      const j = (await r.json()) as { candles?: Candle[] };
      return j.candles ?? null;
    } catch {
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
  return null;
}

let lastPost = 0;
self.onmessage = async (e: MessageEvent) => {
  const m = e.data as { type: "start"; state: SessionState } | { type: "stop" } | { type: "saved"; id: string; ok?: boolean };
  if (m.type === "stop") stop = true;
  else if (m.type === "saved") pending.get(m.id)?.(m.ok ?? true), pending.delete(m.id);
  else if (m.type === "start") {
    stop = false;
    const st = await runSession(m.state, {
      load,
      shouldStop: () => stop,
      onProgress: (s) => {
        if (Date.now() - lastPost < 400 && s.status === "running") return;
        lastPost = Date.now();
        postMessage({ type: "progress", state: checkpoint(s) });
      },
      // Besserer Stand: sofort an die App geben (sie speichert beim Server und lokal) und auf Bestätigung warten
      onImprovement: (cell, r, baseParams, s) =>
        new Promise<boolean>((res) => {
          const id = `imp:${++seq}`;
          pending.set(id, (ok) => res(ok));
          postMessage({ type: "improve", id, cell, result: r, baseParams, state: checkpoint(s) });
          setTimeout(() => pending.has(id) && (pending.delete(id), res(false)), 60_000);
        }),
      onMeasured: (cell, base, baseParams) => postMessage({ type: "measured", cell, base, baseParams }),
      // Abschluss eines Bereichs (nur Anzeige)
      onCellDone: (o: CellOutcome, s) =>
        new Promise<void>((res) => {
          const id = `${o.cell}:${s.cellIdx}`;
          pending.set(id, () => res());
          postMessage({ type: "cell", id, outcome: o, state: checkpoint(s) });
          setTimeout(() => pending.has(id) && (pending.delete(id), res()), 30_000);
        }),
    });
    postMessage({ type: "progress", state: checkpoint(st) });
  }
};
