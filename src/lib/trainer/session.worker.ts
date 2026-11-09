// Web Worker: Trainingssitzung rechnet hier, damit die App flüssig bleibt.
import { resolveParams } from "../analysis/params";
import type { AssetKind, Candle, Horizon } from "../types";
import { primaryRate } from "./engine";
import { runSession, checkpoint, type CellOutcome, type SessionIO, type SessionState } from "./session";
import { cagr, RULES, type PoolTrade, type TournamentReport } from "./tournament";
import { blacktraderPool, buildReport, playRound, prepareTournament } from "./tournamentRun";
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
    const st = m.state;
    const post = (force = false) => {
      if (!force && Date.now() - lastPost < 400) return;
      lastPost = Date.now();
      postMessage({ type: "progress", state: checkpoint(st) });
    };
    const T = (progress: number, text: string, round?: number) => {
      st.tournament = { progress, text, round };
      post();
    };
    const io: SessionIO = {
      load,
      shouldStop: () => stop,
      onProgress: () => post(),
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
      // Abschluss eines Bereichs (nur Anzeige)
      onCellDone: (o: CellOutcome, s) =>
        new Promise<void>((res) => {
          const id = `${o.cell}:${s.cellIdx}`;
          pending.set(id, () => res());
          postMessage({ type: "cell", id, outcome: o, state: checkpoint(s) });
          setTimeout(() => pending.has(id) && (pending.delete(id), res()), 30_000);
        }),
    };
    const tio = { load, extra: st.cfg.extra, shouldStop: () => stop, onProgress: (f: number, text: string) => T(f, text, st.tournament?.round) };
    // Turnier: vorbereiten, dann 5 Runden – vor jeder Runde lernt Blacktrader (ein Fünftel der Zeit) und speichert sofort
    try {
      T(0, "Turnier vorbereiten");
      const prep = await prepareTournament({ ...tio, onProgress: (f, t) => T(f * 0.15, t) });
      if (!prep) {
        st.tournament = { progress: 1, text: "", done: true, failed: stop ? "Gestoppt" : "Keine Kursdaten für das Turnier erreichbar" };
      } else {
        const runs: ReturnType<typeof playRound> = [];
        const rounds: NonNullable<TournamentReport["rounds"]> = [];
        let lastKey = "";
        let pool: PoolTrade[] | null = null;
        const R = RULES.rounds;
        for (let b = 0; b < R && !stop; b++) {
          const base = 0.15 + (0.85 * b) / R;
          const step = 0.85 / R;
          // Lernen (Strenge-Regeln wie im Training, Verbesserungen werden sofort gespeichert)
          if (st.cfg.durationMs > 0 && st.cellIdx < st.cfg.cells.length && st.elapsedMs < st.cfg.durationMs) {
            const until = (st.cfg.durationMs * (b + 1)) / R;
            const t0 = st.elapsedMs;
            await runSession(st, {
              ...io,
              pauseAtMs: until,
              onProgress: (s) => {
                const f = Math.min(1, (s.elapsedMs - t0) / Math.max(1, until - t0));
                st.tournament = { progress: base + step * 0.7 * f, text: `Runde ${b + 1}/${R}: Blacktrader lernt${s.focus ? ` · ${s.focus}` : ""}`, round: b + 1 };
                post();
              },
            });
            if (stop) break;
            st.status = "running";
          }
          // Spielen mit dem neuesten Stand
          const params = (k: AssetKind, h: Horizon) => st.saved?.[`${k}:${h}` as CellKey]?.params ?? resolveParams(st.cfg.paramSet, k, h);
          const key = JSON.stringify(["stock", "crypto", "commodity"].flatMap((k) => ["medium", "long"].map((h) => params(k as AssetKind, h as Horizon))));
          const changed = b > 0 && key !== lastKey;
          if (key !== lastKey || !pool) {
            st.tournament = { progress: base + step * 0.7, text: `Runde ${b + 1}/${R}: Blacktrader handelt`, round: b + 1 };
            pool = await blacktraderPool(prep, params, { ...tio, onProgress: (f, t) => T(f, t, b + 1) }, [base + step * 0.7, base + step], `Runde ${b + 1}/${R}: Blacktrader handelt`);
            lastKey = key;
          }
          if (!pool) break;
          const played = playRound(prep, pool, b);
          runs.push(...played);
          rounds.push({ round: b + 1, avgPerYear: played.reduce((a, x) => a + cagr(x.r.end), 0) / Math.max(1, played.length), changed });
          T(base + step, `Runde ${b + 1}/${R} gespielt`, b + 1);
        }
        if (!stop && pool && runs.length === prep.windows.length) {
          const improvedCells = st.results.filter((r) => r.accept && r.base && r.cand).map((r) => ({ cell: r.cell, old: primaryRate(r.base!), neu: primaryRate(r.cand!) }));
          const report = buildReport(prep, runs, rounds, pool, improvedCells);
          if (st.cfg.durationMs === 0) report.note = `${report.note ?? ""} Ohne Lernen gespielt.`.trim();
          postMessage({ type: "report", report });
          st.tournament = { progress: 1, text: "Auswertung fertig", done: true };
        } else {
          st.tournament = { progress: 1, text: "", done: true, failed: "Gestoppt – keine Auswertung" };
        }
      }
    } catch (err) {
      st.tournament = { progress: 1, text: "", done: true, failed: `Turnier fehlgeschlagen: ${(err as Error).message}` };
    }
    st.status = stop ? "stopped" : "done";
    st.phase = "done";
    postMessage({ type: "progress", state: checkpoint(st) });
  }
};
