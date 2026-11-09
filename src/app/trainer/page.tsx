"use client";
// Mehr → Trainer: Ziel, aktueller Stand je Anlageklasse (mit Aufschlüsselung nach Horizont), Training starten.
// Stände kommen je Klasse × Horizont getrennt aus Server + lokaler Kopie (jüngerer gewinnt) – ein Lauf für eine
// Klasse kann die anderen nie überschreiben.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { IconInfo } from "@/components/Icons";
import { refreshTrainerParams, useTrainerCells } from "@/lib/client/trainerParams";
import { startTraining, stopTraining, TOKEN_KEY, useTraining } from "@/lib/client/trainingSession";
import { TARGET_HIT_RATE } from "@/lib/trainer/engine";
import { classStanding, goalProgress, goalReached } from "@/lib/trainer/goal";
import { DURATIONS } from "@/lib/trainer/session";
import { CELL_KEYS, type CellKey } from "@/lib/trainer/universe";
import { HORIZON_LABEL, KIND_LABEL, type AssetKind, type Horizon } from "@/lib/types";

const KINDS: AssetKind[] = ["stock", "crypto", "commodity"];
const HORIZONS: Horizon[] = ["short", "medium", "long"];
const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")} %`;
const mins = (ms: number) => {
  const m = Math.max(0, Math.ceil(ms / 60e3));
  return m >= 90 ? `noch ${Math.floor(m / 60)} Std. ${m % 60} Min.` : `noch ${m} Min.`;
};

function Delta({ now, prev }: { now?: number | null; prev?: number | null }) {
  if (now == null || prev == null) return <span className="text-stone-500">–</span>;
  const d = (now - prev) * 100;
  if (Math.abs(d) < 0.05) return <span className="text-stone-500">–</span>;
  const s = Math.abs(d).toFixed(1).replace(".", ",");
  return d > 0 ? <span className="text-up">↑ +{s}</span> : <span className="text-down">↓ −{s}</span>;
}

export default function TrainerPage() {
  const cells = useTrainerCells();
  const t = useTraining();
  const [kind, setKind] = useState<AssetKind>("stock");
  const [dur, setDur] = useState(DURATIONS[0].ms);
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState(true);
  const [adminRequired, setAdminRequired] = useState(false);
  const [info, setInfo] = useState(false);

  useEffect(() => {
    void refreshTrainerParams(true);
    try {
      setHasToken(!!localStorage.getItem(TOKEN_KEY));
    } catch {
      /* ohne Speicher */
    }
    fetch("/api/trainer", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setAdminRequired(!!j.adminRequired))
      .catch(() => {});
  }, []);

  const target = TARGET_HIT_RATE;
  const rows = useMemo(() => HORIZONS.map((h) => ({ h, rec: cells[`${kind}:${h}` as CellKey] })), [cells, kind]);
  const total = useMemo(() => classStanding(rows.map((r) => ({ cell: `${kind}:${r.h}`, status: r.rec?.current ? { oos: r.rec.current } : null })), kind), [rows, kind]);
  const prevTotal = useMemo(
    () => classStanding(rows.map((r) => ({ cell: `${kind}:${r.h}`, status: r.rec?.previous ?? r.rec?.current ? { oos: (r.rec?.previous ?? r.rec?.current)! } : null })), kind),
    [rows, kind],
  );
  const reached = total.hitRate != null && goalReached(total.hitRate, target);

  const st = t.session;
  const running = t.running;
  const progress = st ? Math.min(100, (st.elapsedMs / st.cfg.durationMs) * 100) : 0;
  const curCell = st && running && st.cellIdx < st.cfg.cells.length ? st.cfg.cells[st.cellIdx] : null;
  const saves = st ? t.messages[st.cfg.id] ?? [] : [];

  const start = () => {
    if (token) {
      try {
        localStorage.setItem(TOKEN_KEY, token);
        setHasToken(true);
      } catch {
        /* egal */
      }
    }
    void startTraining(
      dur,
      CELL_KEYS.filter((c) => c.startsWith(`${kind}:`)),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[22px] text-gold">Trainer</h1>
        <Link href="/mehr" className="text-[15px] text-stone-400">
          Zurück
        </Link>
      </div>

      <section className="card space-y-3 p-4">
        <div className="text-center">
          <div className="text-[14px] text-stone-400">Ziel · {KIND_LABEL[kind]}</div>
          <div className="num text-[40px] font-semibold leading-tight text-gold">{Math.round(target * 100)} %</div>
          <div className={`num text-[19px] ${reached ? "text-up" : "text-stone-100"}`}>Aktuell {total.hitRate != null ? pct(total.hitRate) : "–"}</div>
        </div>
        <div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
            <div className={`h-full rounded-full transition-all ${reached ? "bg-emerald-500" : "bg-gold"}`} style={{ width: `${goalProgress(total.hitRate, target)}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[12px] text-stone-500">
            <span>0 %</span>
            <span>{Math.round(target * 100)} %</span>
          </div>
        </div>

        <div className="rounded-xl bg-white/5 px-3 py-2 text-[15px]">
          <div className="grid grid-cols-[1fr_auto_4.5rem] items-center gap-x-3 py-1">
            <span className="flex items-center gap-1.5 font-medium text-stone-100">
              Gesamt
              <button aria-label="Was bedeutet Gesamt?" className="flex h-7 w-7 items-center justify-center text-stone-400" onClick={() => setInfo((v) => !v)}>
                <IconInfo className="h-4 w-4" />
              </button>
            </span>
            <span className="num text-right font-medium text-stone-100">{total.hitRate != null ? pct(total.hitRate) : "–"}</span>
            <span className="num text-right text-[14px]">
              <Delta now={total.hitRate} prev={prevTotal.hitRate} />
            </span>
          </div>
          {info && <p className="pb-1 text-[13px] text-stone-400">Gesamt = Durchschnitt aller Horizonte, gewichtet nach Anzahl der Signale.</p>}
          {rows.map(({ h, rec }) => (
            <div key={h} className="grid grid-cols-[1fr_auto_4.5rem] items-center gap-x-3 border-t border-white/5 py-1.5">
              <span className="text-stone-300">{HORIZON_LABEL[h]}</span>
              <span className="num text-right text-stone-200">{rec?.current ? pct(rec.current.hitRate) : "–"}</span>
              <span className="num text-right text-[14px]">
                <Delta now={rec?.current?.hitRate} prev={rec?.previous?.hitRate} />
              </span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/5 p-1">
          {KINDS.map((k) => (
            <button key={k} className={`min-h-[44px] rounded-lg text-[15px] ${k === kind ? "bg-gold/20 font-medium text-gold-light" : "text-stone-400"}`} onClick={() => setKind(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-[17px] text-gold-light">Training</h2>
        {!running ? (
          <>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {DURATIONS.map((d) => (
                <button key={d.ms} className={`btn min-h-[44px] px-2 ${dur === d.ms ? "btn-primary" : ""}`} onClick={() => setDur(d.ms)}>
                  {d.label}
                </button>
              ))}
            </div>
            {adminRequired && !hasToken && <input className="input" type="password" placeholder="Zugangscode" value={token} onChange={(e) => setToken(e.target.value)} />}
            <button className="btn btn-primary min-h-[48px] w-full" onClick={start}>
              Start · {KIND_LABEL[kind]}
            </button>
          </>
        ) : (
          <button className="btn btn-danger min-h-[48px] w-full" onClick={stopTraining}>
            Stopp
          </button>
        )}
        {st && (running || progress > 0) && (
          <div className="space-y-1">
            {curCell && (
              <p className="text-[14px] text-stone-300">
                Trainiert gerade: <span className="text-stone-100">{KIND_LABEL[curCell.split(":")[0] as AssetKind]} · {HORIZON_LABEL[curCell.split(":")[1] as Horizon]}</span>
                {st.focus ? <> · {st.focus}</> : null}
              </p>
            )}
            <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="flex justify-between text-[14px] text-stone-300">
              <span className="num">{progress.toFixed(0)} %</span>
              <span>{running ? mins(st.cfg.durationMs - st.elapsedMs) : st.status === "stopped" ? "gestoppt" : "fertig"}</span>
            </div>
          </div>
        )}
        {st && saves.length > 0 && (
          <div className="space-y-1">
            {saves.map((m, i) => (
              <p key={i} className={`text-[15px] ${m.startsWith("Gespeichert") ? "text-up" : "text-amber-300"}`}>
                {m}
              </p>
            ))}
          </div>
        )}
        {st && !running && st.results.length > 0 && !saves.some((m) => m.startsWith("Gespeichert")) && (
          <p className="text-[15px] text-stone-300">{st.results.every((r) => !r.base) ? "Keine Kursdaten erreichbar – alter Stand bleibt" : "Keine Verbesserung – alter Stand bleibt"}</p>
        )}
      </section>
    </div>
  );
}
