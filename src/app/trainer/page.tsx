"use client";
// Mehr → Trainer: Ziel, aktueller Stand je Anlageklasse, Training starten. Bewusst schlicht –
// Versionen, Verlauf und Details laufen im Hintergrund weiter (API /api/trainer), werden hier nicht angezeigt.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { startTraining, stopTraining, TOKEN_KEY, useTraining } from "@/lib/client/trainingSession";
import { classStanding, goalProgress, goalReached } from "@/lib/trainer/goal";
import { DURATIONS } from "@/lib/trainer/session";
import { CELL_KEYS } from "@/lib/trainer/universe";
import type { Metrics } from "@/lib/trainer/engine";
import { KIND_LABEL, type AssetKind } from "@/lib/types";

interface Status {
  target: number;
  adminRequired: boolean;
  cells: { cell: string; status: { oos: Metrics } | null }[];
}

const KINDS: AssetKind[] = ["stock", "crypto", "commodity"];
const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")} %`;
const mins = (ms: number) => {
  const m = Math.max(0, Math.ceil(ms / 60e3));
  return m >= 90 ? `noch ${Math.floor(m / 60)} Std. ${m % 60} Min.` : `noch ${m} Min.`;
};

export default function TrainerPage() {
  const [s, setS] = useState<Status | null>(null);
  const [kind, setKind] = useState<AssetKind>("stock");
  const [dur, setDur] = useState(DURATIONS[0].ms);
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const t = useTraining();

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/trainer", { cache: "no-store" });
      if (r.ok) setS(await r.json());
    } catch {
      /* Anzeige bleibt leer */
    }
  }, []);
  useEffect(() => {
    void load();
    try {
      setHasToken(!!localStorage.getItem(TOKEN_KEY));
    } catch {
      /* ohne Speicher */
    }
  }, [load]);
  // Nach dem Training den Stand neu laden
  useEffect(() => {
    if (t.session && !t.running) void load();
  }, [t.running, t.session, load]);

  const target = s?.target ?? 0.7;
  const standing = useMemo(() => (s ? classStanding(s.cells, kind) : { hitRate: null, trades: 0 }), [s, kind]);
  const reached = standing.hitRate != null && goalReached(standing.hitRate, target);
  const st = t.session;
  const running = t.running;
  const progress = st ? Math.min(100, (st.elapsedMs / st.cfg.durationMs) * 100) : 0;

  // Kurze Meldung nach dem Training
  const result = useMemo(() => {
    if (!st || running || !st.results.length) return null;
    const saved = st.results.map((r) => t.messages[`${st.cfg.id}:${r.cell}`]).filter((m): m is string => !!m && m.startsWith("Verbessert"));
    if (saved.length) return saved.map((m) => m.replace(/\s*\(Version \d+\)$/, ""));
    if (st.results.every((r) => !r.base)) return ["Keine Kursdaten erreichbar – alter Stand bleibt"];
    return ["Keine Verbesserung – alter Stand bleibt"];
  }, [st, running, t.messages]);

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

      <section className="card space-y-4 p-5">
        <div className="text-center">
          <div className="text-[15px] text-stone-400">Ziel · {KIND_LABEL[kind]}</div>
          <div className="num text-[44px] font-semibold leading-tight text-gold">{Math.round(target * 100)} %</div>
          <div className={`num text-[20px] ${reached ? "text-up" : "text-stone-100"}`}>Aktuell {standing.hitRate != null ? pct(standing.hitRate) : "–"}</div>
          {standing.hitRate == null && <div className="text-[13px] text-stone-500">noch nicht trainiert</div>}
        </div>
        <div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
            <div className={`h-full rounded-full transition-all ${reached ? "bg-emerald-500" : "bg-gold"}`} style={{ width: `${goalProgress(standing.hitRate, target)}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[12px] text-stone-500">
            <span>0 %</span>
            <span>{Math.round(target * 100)} %</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/5 p-1">
          {KINDS.map((k) => (
            <button key={k} className={`min-h-[44px] rounded-lg text-[15px] ${k === kind ? "bg-gold/20 font-medium text-gold-light" : "text-stone-400"}`} onClick={() => setKind(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </section>

      <section className="card space-y-3 p-5">
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
            {s?.adminRequired && !hasToken && <input className="input" type="password" placeholder="Zugangscode" value={token} onChange={(e) => setToken(e.target.value)} />}
            <button className="btn btn-primary min-h-[48px] w-full" onClick={start}>
              Start
            </button>
          </>
        ) : (
          <button className="btn btn-danger min-h-[48px] w-full" onClick={stopTraining}>
            Stopp
          </button>
        )}
        {st && (running || progress > 0) && (
          <div className="space-y-1">
            <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="flex justify-between text-[14px] text-stone-300">
              <span className="num">{progress.toFixed(0)} %</span>
              <span>{running ? mins(st.cfg.durationMs - st.elapsedMs) : st.status === "stopped" ? "gestoppt" : "fertig"}</span>
            </div>
          </div>
        )}
        {result && (
          <div className="space-y-1">
            {result.map((m) => (
              <p key={m} className={`text-[15px] ${m.startsWith("Verbessert") ? "text-up" : "text-stone-300"}`}>
                {m}
              </p>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
