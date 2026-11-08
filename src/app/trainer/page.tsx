"use client";
// Mehr → Trainer: wie gut der Analyst auf unbekannten Daten trifft, was gelernt wurde, Versionen.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { HORIZON_LABEL, KIND_LABEL, type AssetKind, type Horizon } from "@/lib/types";
import { startTraining, stopTraining, TOKEN_KEY, useTraining } from "@/lib/client/trainingSession";
import { DURATIONS, phaseLabel } from "@/lib/trainer/session";
import { CELL_KEYS, type CellKey } from "@/lib/trainer/universe";

interface M {
  trades: number;
  hitRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  perMonth: number;
}
interface Status {
  storage: "kv" | "memory";
  adminRequired: boolean;
  target: number;
  minSignals: number;
  current: number;
  versions: { id: number; createdAt: string; reason: string; parent?: number; params: Record<string, Record<string, unknown>>; cell?: string; hitRate?: number }[];
  cells: { cell: string; status: { updated: string; version: number; oos: M; series: number; bestSeen?: M; note?: string } | null }[];
  live: Record<string, (M & { open: number; expired: number }) | undefined>;
  signals: { total: number; recent: { id: string; symbol: string; horizon: Horizon; kind: AssetKind; direction: "long" | "short"; entry: number; status: string; createdAt: string; strength: number; returnPct?: number }[] };
  log: { date: string; kind: string; cell?: string; version?: number; change?: string; reason: string }[];
  history: { date: string; cell: string; source: "backtest" | "live"; hitRate: number; profitFactor: number; trades: number; version: number }[];
  finalTests: { version: number; date: string; cells: Record<string, M> }[];
  job: { type: string; cell?: string; phase?: string; done: number; total: number; version?: number } | null;
  lastRun?: string;
  lastRunNote?: string;
}

const KINDS: AssetKind[] = ["stock", "crypto", "commodity"];
const HORIZONS: Horizon[] = ["short", "medium", "long"];
const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")} %`;
const num = (x: number, d = 2) => x.toFixed(d).replace(".", ",");
const date = (s: string) => new Date(s).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
const cellLabel = (c: string) => {
  const [k, h] = c.split(":") as [AssetKind, Horizon];
  return `${KIND_LABEL[k] ?? k} · ${HORIZON_LABEL[h] ?? h}`;
};
const mins = (ms: number) => {
  const m = Math.max(0, Math.ceil(ms / 60e3));
  return m >= 90 ? `${Math.floor(m / 60)} Std. ${m % 60} Min.` : `${m} Min.`;
};

function TrainingPanel({ onDone }: { onDone: () => void }) {
  const t = useTraining();
  const [dur, setDur] = useState(DURATIONS[0].ms);
  const [area, setArea] = useState<"all" | CellKey>("all");
  const st = t.session;
  const running = t.running;
  useEffect(() => {
    if (st && !running) onDone();
  }, [running, st, onDone]);
  const pctDone = st ? Math.min(100, (st.elapsedMs / st.cfg.durationMs) * 100) : 0;
  const cell = st && st.cellIdx < st.cfg.cells.length ? st.cfg.cells[st.cellIdx] : null;
  return (
    <section className="card space-y-3 p-4">
      <h2 className="text-[17px] text-gold-light">Training starten</h2>
      <p className="text-[14px] text-stone-400">Rechnet auf diesem Gerät im Hintergrund (die App bleibt bedienbar). Am Ende jedes Bereichs wird alt gegen neu auf unbekannten Daten verglichen – gespeichert wird nur, was besser ist.</p>
      {!running && (
        <>
          <div className="flex flex-wrap gap-2">
            {DURATIONS.map((d) => (
              <button key={d.ms} className={`btn ${dur === d.ms ? "btn-primary" : ""}`} onClick={() => setDur(d.ms)}>
                {d.label}
              </button>
            ))}
          </div>
          <select className="input" value={area} onChange={(e) => setArea(e.target.value as "all" | CellKey)}>
            <option value="all">Alle 9 Bereiche nacheinander</option>
            {CELL_KEYS.map((c) => (
              <option key={c} value={c}>
                Nur {cellLabel(c)}
              </option>
            ))}
          </select>
          <button className="btn btn-primary w-full" onClick={() => void startTraining(dur, area === "all" ? [...CELL_KEYS] : [area])}>
            Training starten ({DURATIONS.find((d) => d.ms === dur)?.label})
          </button>
        </>
      )}
      {st && (
        <div className="space-y-2">
          <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${pctDone}%` }} />
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-[14px] text-stone-300">
            <span className="num">{pctDone.toFixed(0)} %</span>
            <span>{running ? `noch ${mins(st.cfg.durationMs - st.elapsedMs)}` : st.status === "stopped" ? "gestoppt" : "fertig"}</span>
          </div>
          {running && (
            <>
              <p className="text-[14px] text-stone-200">
                <b>{phaseLabel(st.phase)}</b>
                {st.detail ? <span className="text-stone-400"> · {st.detail}</span> : null}
              </p>
              {cell && (
                <p className="text-[13px] text-stone-400">
                  Bereich {st.cellIdx + 1} von {st.cfg.cells.length}: {cellLabel(cell)}
                </p>
              )}
              {st.live && st.live.old != null && (
                <p className="text-[14px] text-stone-300">
                  Beste Trefferquote (unbekannte Daten): <b className="num text-stone-100">{st.live.best != null ? pct(st.live.best) : "–"}</b> · alter Stand <span className="num">{pct(st.live.old)}</span>
                </p>
              )}
              <p className="text-[13px] text-stone-500">{t.wakeLock ? "Bildschirm bleibt an, solange trainiert wird." : "Tipp: App geöffnet lassen – im Hintergrund pausiert das Training."}</p>
              <button className="btn btn-danger w-full" onClick={stopTraining}>
                Stopp (aktuellen Bereich noch auswerten)
              </button>
            </>
          )}
          {st.results.length > 0 && (
            <ul className="space-y-1.5">
              {st.results.map((r) => {
                const msg = t.messages[`${st.cfg.id}:${r.cell}`];
                const ok = msg?.startsWith("Verbessert");
                return (
                  <li key={r.cell} className={`rounded-xl p-2.5 text-[14px] ${ok ? "bg-emerald-500/10 text-emerald-200" : "bg-white/5 text-stone-300"}`}>
                    <b className="text-stone-100">{cellLabel(r.cell)}:</b> {msg ?? (r.base ? "wird gespeichert …" : r.reasons[0])}
                    {r.base && r.cand && <span className="block text-[12px] text-stone-500">{r.cand.trades} Signale · PF {num(r.base.profitFactor)} → {num(r.cand.profitFactor)} · Rückgang {num(r.base.maxDrawdown, 1)} → {num(r.cand.maxDrawdown, 1)} %</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function weightsOf(v: { params: Record<string, Record<string, unknown>>; cell?: string }): string {
  const w = (v.cell ? v.params[v.cell]?.weights : undefined) as { elliott: number; fundamental: number; volume: number } | undefined;
  return w ? `${w.elliott} / ${w.fundamental} / ${w.volume}` : "60 / 20 / 20";
}

function MetricLine({ m }: { m: M }) {
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-[13px] text-stone-400">
      <span>
        Ø Gewinn <b className="num text-up">{num(m.avgWin)} %</b>
      </span>
      <span>
        Ø Verlust <b className="num text-down">{num(m.avgLoss)} %</b>
      </span>
      <span>
        Profit-Faktor <b className="num text-stone-200">{num(m.profitFactor)}</b>
      </span>
      <span>
        Max. Rückgang <b className="num text-stone-200">{num(m.maxDrawdown, 1)} %</b>
      </span>
      <span>
        Signale/Monat <b className="num text-stone-200">{num(m.perMonth, 1)}</b>
      </span>
      <span>
        Signale <b className="num text-stone-200">{m.trades}</b>
      </span>
    </div>
  );
}

function HitBar({ value, target }: { value: number; target: number }) {
  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-white/10">
      <div className={`h-full rounded-full ${value >= target ? "bg-emerald-500" : "bg-gold"}`} style={{ width: `${Math.min(100, value * 100)}%` }} />
      <div className="absolute top-0 h-full w-0.5 bg-white/70" style={{ left: `${target * 100}%` }} title="Ziel" />
    </div>
  );
}

export default function TrainerPage() {
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [chartCell, setChartCell] = useState("stock:medium");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/trainer", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Fehler");
      setS(j);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    try {
      setToken(localStorage.getItem(TOKEN_KEY) ?? "");
    } catch {
      /* egal */
    }
  }, [load]);

  const post = async (path: string, label: string, confirmText?: string, body?: unknown) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(label);
    setMsg(null);
    try {
      try {
        localStorage.setItem(TOKEN_KEY, token);
      } catch {
        /* egal */
      }
      const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "x-trainer-token": token } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      setMsg(j.note ?? (r.ok ? "Erledigt" : "Fehler"));
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const cellMap = useMemo(() => Object.fromEntries((s?.cells ?? []).map((c) => [c.cell, c.status])), [s]);
  // Ehrliche Gesamtaussage: beste gültige Trefferquote (≥ Mindestanzahl Signale) auf unbekannten Daten
  const honest = useMemo(() => {
    if (!s) return null;
    const valid = s.cells.filter((c) => c.status && c.status.oos.trades >= s.minSignals);
    const best = valid.reduce<{ cell: string; m: M } | null>((a, c) => {
      const m = c.status!.bestSeen && c.status!.bestSeen.trades >= s.minSignals && c.status!.bestSeen.hitRate > c.status!.oos.hitRate ? c.status!.bestSeen : c.status!.oos;
      return !a || m.hitRate > a.m.hitRate ? { cell: c.cell, m } : a;
    }, null);
    return { validCount: valid.length, best };
  }, [s]);
  const chartData = useMemo(() => {
    if (!s) return [];
    return s.history
      .filter((h) => h.cell === chartCell)
      .map((h) => ({ t: Date.parse(h.date), [h.source]: Math.round(h.hitRate * 1000) / 10 }));
  }, [s, chartCell]);
  const finalDone = s?.finalTests.some((f) => f.version === s.current);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-[22px] text-gold">Trainer</h1>
        <Link href="/mehr" className="text-[15px] text-stone-400">
          Zurück
        </Link>
      </div>
      <section className="card space-y-2 p-4 text-[15px] text-stone-300">
        <p>
          Der Trainer lernt nachts nur die <b className="text-stone-100">Feineinstellung</b> (z. B. wie empfindlich Wellen erkannt werden, RSI- und Volumen-Schwellen, Mindest-Signalstärke) – getrennt für Aktien, Krypto und Rohstoffe und je Zeitraum.
        </p>
        <p className="text-stone-400">
          Fest und nie verändert: Elliott-Regeln, Stop, Ziele, Chance-Risiko, Positionsgröße. Gewichtung nur in festen Grenzen (Elliott mindestens 60 %). Mindest-Signalstärke und Filter werden nur strenger. Neue Werte werden nur übernommen, wenn sie auf <b>unbekannten</b> Daten besser sind.
        </p>
      </section>

      <TrainingPanel onDone={() => void load()} />

      {err && <p className="card p-4 text-[15px] text-down">Trainer nicht erreichbar: {err}</p>}
      {s?.storage === "memory" && (
        <section className="card space-y-1 border border-amber-500/40 p-4 text-[15px] text-amber-200">
          <b>Kein dauerhafter Speicher verbunden.</b>
          <p className="text-amber-100/80">Ergebnisse gehen beim Neustart verloren. In Vercel: Projekt → Storage → „Upstash for Redis“ (KV) verbinden. Danach neu bereitstellen.</p>
        </section>
      )}

      {s && honest && (
        <section className="card space-y-2 p-4">
          <h2 className="text-[17px] text-gold-light">Ziel: {pct(s.target)} Trefferquote</h2>
          {honest.best ? (
            <p className="text-[15px] text-stone-300">
              Aktuell erreichbar (unbekannte Daten): <b className={honest.best.m.hitRate >= s.target ? "text-up" : "text-stone-100"}>{pct(honest.best.m.hitRate)}</b> bei {cellLabel(honest.best.cell)}.{" "}
              {honest.best.m.hitRate < s.target && <>Das Ziel von {pct(s.target)} wird mit der festen Methode derzeit nicht erreicht.</>}
            </p>
          ) : (
            <p className="text-[15px] text-stone-300">Noch keine Zelle mit mindestens {s.minSignals} Signalen – erst dann ist eine Trefferquote aussagekräftig.</p>
          )}
          <p className="text-[13px] text-stone-500">Wichtig ist nicht nur die Trefferquote: Mit festem Stop und Nachziehen nach Ziel 1 bringen wenige große Gewinne viele kleine Verluste wieder herein (siehe Profit-Faktor).</p>
        </section>
      )}

      {s &&
        KINDS.map((k) => (
          <section key={k} className="card space-y-3 p-4">
            <h2 className="text-[17px] text-gold-light">{KIND_LABEL[k]}</h2>
            {HORIZONS.map((h) => {
              const c = `${k}:${h}`;
              const st = cellMap[c];
              const live = s.live[c];
              const valid = st && st.oos.trades >= s.minSignals;
              return (
                <div key={h} className="panel space-y-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[15px] font-medium text-stone-100">{HORIZON_LABEL[h]}</span>
                    {st ? (
                      <span className={`num text-[17px] font-semibold ${st.oos.hitRate >= s.target ? "text-up" : "text-stone-100"}`}>{pct(st.oos.hitRate)}</span>
                    ) : (
                      <span className="text-[14px] text-stone-500">noch nicht trainiert</span>
                    )}
                  </div>
                  {st && (
                    <>
                      <HitBar value={st.oos.hitRate} target={s.target} />
                      <p className={`text-[13px] ${valid ? "text-emerald-300" : "text-amber-300"}`}>
                        {valid ? "Aussagekräftig" : `Noch nicht aussagekräftig (${st.oos.trades} von ${s.minSignals} Signalen)`} · {st.series} Werte · Version {st.version} · {date(st.updated)}
                      </p>
                      <MetricLine m={st.oos} />
                      {st.note && <p className="text-[13px] text-stone-500">{st.note}</p>}
                    </>
                  )}
                  {live && live.trades + live.open > 0 && (
                    <p className="text-[13px] text-stone-400">
                      Echte Signale seit Start: {live.trades} abgeschlossen{live.trades ? `, Trefferquote ${pct(live.hitRate)}, Profit-Faktor ${num(live.profitFactor)}` : ""} · {live.open} laufen · {live.expired} verfallen
                    </p>
                  )}
                </div>
              );
            })}
          </section>
        ))}

      {s && (
        <section className="card space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[17px] text-gold-light">Verlauf der Trefferquote</h2>
            <select className="input max-w-[220px]" value={chartCell} onChange={(e) => setChartCell(e.target.value)}>
              {s.cells.map((c) => (
                <option key={c.cell} value={c.cell}>
                  {cellLabel(c.cell)}
                </option>
              ))}
            </select>
          </div>
          {chartData.length === 0 ? (
            <p className="text-[15px] text-stone-400">Noch keine Messpunkte.</p>
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(201,162,74,0.08)" vertical={false} />
                  <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tick={{ fill: "#8f887a", fontSize: 12 }} tickFormatter={(t: number) => new Date(t).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} />
                  <YAxis domain={[0, 100]} tick={{ fill: "#8f887a", fontSize: 12 }} tickFormatter={(v: number) => `${v} %`} width={44} />
                  <Tooltip contentStyle={{ background: "#0b0b0b", border: "1px solid rgba(201,162,74,0.3)", fontSize: 12 }} labelFormatter={(t) => new Date(Number(t)).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} formatter={(v, n) => [`${v} %`, n === "backtest" ? "Unbekannte Prüfdaten" : "Echte Signale"]} />
                  <ReferenceLine y={s.target * 100} stroke="#10b981" strokeDasharray="4 4" label={{ value: "Ziel", fill: "#6ee7b7", fontSize: 11, position: "insideTopLeft" }} />
                  <Line type="monotone" dataKey="backtest" stroke="#C9A24A" strokeWidth={2} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
                  <Line type="monotone" dataKey="live" stroke="#60a5fa" strokeWidth={2} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="text-[13px] text-stone-500">Gold = unbekannte Prüfdaten (Walk-Forward) · Blau = echte Signale aus dem Signal-Protokoll</p>
        </section>
      )}

      {s && (
        <section className="card space-y-3 p-4">
          <h2 className="text-[17px] text-gold-light">Versionen</h2>
          <ul className="space-y-2">
            {[...s.versions].reverse().slice(0, 20).map((v) => (
              <li key={v.id} className={`rounded-xl p-3 ${v.id === s.current ? "border border-gold/50 bg-gold/10" : "bg-white/5"}`}>
                <div className="flex items-center justify-between gap-2 text-[15px]">
                  <b className="text-stone-100">Version {v.id}</b>
                  <span className="text-[13px] text-stone-400">{date(v.createdAt)}</span>
                </div>
                <p className="text-[14px] text-stone-300">{v.reason}</p>
                <p className="text-[13px] text-stone-400">
                  {v.hitRate != null ? <>Trefferquote {pct(v.hitRate)} · </> : null}
                  Gewichtung {weightsOf(v)}
                </p>
                {v.id === s.current ? (
                  <p className="text-[13px] text-gold">Aktiv für alle Nutzer</p>
                ) : (
                  <button className="btn mt-1 text-xs" disabled={!!busy} onClick={() => post("/api/trainer/rollback", "rollback", `Auf Version ${v.id} zurücksetzen? Gilt sofort für alle Nutzer.`, { to: v.id })}>
                    Zurücksetzen auf diese Version
                  </button>
                )}
              </li>
            ))}
          </ul>
          {s.adminRequired && <input className="input" type="password" placeholder="Zugangscode (TRAINER_ADMIN_TOKEN)" value={token} onChange={(e) => setToken(e.target.value)} />}
          <div className="flex flex-wrap gap-2">
            <button className="btn" disabled={!!busy || s.versions.length < 2 || s.current === s.versions[0].id} onClick={() => post("/api/trainer/rollback", "rollback", "Auf die vorherige Version zurücksetzen? Gilt sofort für alle Nutzer.")}>
              {busy === "rollback" ? "…" : "Auf vorherige Version zurücksetzen"}
            </button>
            <button className="btn" disabled={!!busy} onClick={() => post("/api/trainer/run", "run")}>
              {busy === "run" ? "Lernt … (bis 1 Minute)" : "Lernschritt jetzt ausführen"}
            </button>
          </div>
          {s.job && (
            <p className="text-[13px] text-stone-400">
              Läuft gerade: {s.job.type === "final" ? `Abschlusstest Version ${s.job.version}` : `${cellLabel(s.job.cell!)} – ${s.job.phase === "in" ? "Lerndaten" : "unbekannte Prüfdaten"}`} ({s.job.done} / {s.job.total})
            </p>
          )}
          {s.lastRun && (
            <p className="text-[13px] text-stone-500">
              Letzter Lauf {date(s.lastRun)}: {s.lastRunNote}
            </p>
          )}
          {msg && <p className="text-[14px] text-stone-200">{msg}</p>}
        </section>
      )}

      {s && (
        <section className="card space-y-3 p-4">
          <h2 className="text-[17px] text-gold-light">Abschlusstest (gesperrte letzte 12 Monate)</h2>
          <p className="text-[14px] text-stone-400">Die letzten 12 Monate werden beim Lernen nie benutzt. Jede Version darf nur einmal darauf getestet werden – so bleibt das Ergebnis ehrlich.</p>
          {s.finalTests
            .slice()
            .reverse()
            .map((f) => (
              <div key={f.version} className="panel space-y-1 p-3 text-[14px]">
                <b className="text-stone-100">
                  Version {f.version} · {date(f.date)}
                </b>
                {Object.entries(f.cells).map(([c, m]) => (
                  <p key={c} className="text-stone-300">
                    {cellLabel(c)}: <span className="num">{m.trades ? `${pct(m.hitRate)} · PF ${num(m.profitFactor)} · ${m.trades} Signale` : "keine Signale"}</span>
                  </p>
                ))}
              </div>
            ))}
          <button className="btn" disabled={!!busy || finalDone} onClick={() => post("/api/trainer/final-test", "final", "Abschlusstest jetzt starten? Für diese Version nur einmal möglich.")}>
            {finalDone ? "Für diese Version bereits getestet" : busy === "final" ? "Testet … (ggf. mehrmals tippen)" : s.job?.type === "final" ? "Abschlusstest fortsetzen" : "Abschlusstest starten"}
          </button>
        </section>
      )}

      {s && (
        <section className="card space-y-3 p-4">
          <h2 className="text-[17px] text-gold-light">Änderungsprotokoll</h2>
          {s.log.length === 0 && <p className="text-[15px] text-stone-400">Noch keine Einträge.</p>}
          <ul className="space-y-2">
            {s.log.slice(0, 60).map((e, i) => (
              <li key={i} className="rounded-xl bg-white/5 p-3 text-[14px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`font-medium ${e.kind === "angenommen" ? "text-up" : e.kind === "abgelehnt" ? "text-stone-300" : "text-gold"}`}>
                    {e.kind[0].toUpperCase() + e.kind.slice(1)}
                    {e.cell ? ` · ${cellLabel(e.cell)}` : ""}
                  </span>
                  <span className="text-[13px] text-stone-500">{date(e.date)}</span>
                </div>
                {e.change && <p className="text-stone-400">Geprüft: {e.change}</p>}
                <p className="text-stone-300">{e.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {s && s.signals.total > 0 && (
        <section className="card space-y-2 p-4">
          <h2 className="text-[17px] text-gold-light">Signal-Protokoll ({s.signals.total})</h2>
          <p className="text-[13px] text-stone-500">Jedes Signal des Analysten wird intern mit Eingaben und späterem Ausgang gespeichert – getrennt von deinem Journal.</p>
          <ul className="divide-y divide-white/5 text-[14px]">
            {s.signals.recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                <span className="text-stone-200">
                  <b className={r.direction === "long" ? "text-up" : "text-down"}>{r.direction === "long" ? "Kauf" : "Short"}</b> {r.symbol} · {HORIZON_LABEL[r.horizon]}
                </span>
                <span className="text-stone-400">
                  {r.status}
                  {r.returnPct != null ? ` ${num(r.returnPct)} %` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
