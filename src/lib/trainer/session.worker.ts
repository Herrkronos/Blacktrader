// Web Worker: Trainingssitzung rechnet hier, damit die App flüssig bleibt.
import { resolveParams } from "../analysis/params";
import type { AssetKind, Candle, Horizon } from "../types";
import { primaryRate } from "./engine";
import { runSession, checkpoint, type CellOutcome, type SessionState } from "./session";
import { runTournament } from "./tournamentRun";
import type { CellKey, SeriesSpec } from "./universe";

let stop = false;
const pending = new Map<string, (ok: boolean) => void>();
let seq = 0;

// Kursdaten einmal laden und für Training und Turnier wiederverwenden
const cache = new Map<string, Promise<Candle[] | null>>();
function load(spec: SeriesSpec): Promise<Candle[] | null> {
  const k = `${spec.symbol}|${spec.interval}|${spec.days}`;
  if (!cache.has(k)) cache.set(k, fetchSeries(spec).then((c) => (c ? c : (cache.delete(k), null))));
  return cache.get(k)!;
}

async function fetchSeries(spec: SeriesSpec): Promise<Candle[] | null> {
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
      onProtocol: (cell, entries) => postMessage({ type: "protocol", cell, entries }),
      // Nach dem Training: Turnier gegen 7 Bots (50 Durchgänge × 500 Trades) und Auswertung
      afterTraining: async (s) => {
        s.tournament = { progress: 0, text: "Turnier vorbereiten" };
        const before = (k: AssetKind, h: Horizon) => resolveParams(s.cfg.paramSet, k, h);
        const after = (k: AssetKind, h: Horizon) => s.saved?.[`${k}:${h}` as CellKey]?.params ?? before(k, h);
        const same = !Object.keys(s.saved ?? {}).some((c) => c.endsWith(":medium") || c.endsWith(":long"));
        const improvedCells = s.results.filter((r) => r.accept && r.base && r.cand).map((r) => ({ cell: r.cell, old: primaryRate(r.base!), neu: primaryRate(r.cand!) }));
        try {
          const report = await runTournament(
            {
              load,
              extra: s.cfg.extra,
              shouldStop: () => stop,
              onProgress: (f, text) => {
                s.tournament = { progress: f, text };
                if (Date.now() - lastPost < 400) return;
                lastPost = Date.now();
                postMessage({ type: "progress", state: checkpoint(s) });
              },
            },
            before,
            after,
            improvedCells,
            same,
          );
          if (stop) s.status = "stopped";
          if (report) postMessage({ type: "report", report });
          s.tournament = report ? { progress: 1, text: "Auswertung fertig", done: true } : { progress: 1, text: "", done: true, failed: stop ? "Gestoppt" : "Keine Kursdaten für das Turnier erreichbar" };
        } catch (err) {
          s.tournament = { progress: 1, text: "", done: true, failed: `Turnier fehlgeschlagen: ${(err as Error).message}` };
        }
      },
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
