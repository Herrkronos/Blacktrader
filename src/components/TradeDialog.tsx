"use client";
import { useState } from "react";
import type { AnalysisResult } from "@/lib/analysis/analyze";
import { fmtPrice, plainSetup } from "@/lib/analysis/persona";
import { actions, type WatchItem } from "@/lib/store/store";

export function TradeDialog({ item, analysis, onClose }: { item: WatchItem; analysis: AnalysisResult; onClose: () => void }) {
  const plan = analysis.plan;
  const c = analysis.commentary;
  const [direction, setDirection] = useState<"long" | "short">(plan?.direction ?? (analysis.total >= 50 ? "long" : "short"));
  const [entry, setEntry] = useState(String(+(plan?.entry ?? analysis.price).toPrecision(6)));
  const [stop, setStop] = useState(plan ? String(+plan.stop.toPrecision(6)) : "");
  const [targets, setTargets] = useState(plan ? plan.targets.map((t) => +t.toPrecision(6)).join("; ") : "");
  const [reason, setReason] = useState([c.summary, c.reason, c.risk].filter(Boolean).join("\n"));
  const [err, setErr] = useState<string | null>(null);

  const save = () => {
    const e = parseFloat(entry.replace(",", "."));
    const s = parseFloat(stop.replace(",", "."));
    const ts = targets.split(/[;\s]+/).map((x) => parseFloat(x.replace(",", "."))).filter((x) => Number.isFinite(x));
    const dir = direction === "long" ? 1 : -1;
    if (!(e > 0) || !(s > 0) || ts.length === 0) return setErr("Einstieg, Stop und mindestens ein Kursziel angeben.");
    if ((e - s) * dir <= 0) return setErr(`Der Stop muss bei ${direction === "long" ? "Long unter" : "Short über"} dem Einstieg liegen.`);
    if (ts.some((t) => (t - e) * dir <= 0)) return setErr("Kursziele müssen in Trade-Richtung liegen.");
    actions.addTrade({
      symbol: item.symbol,
      name: item.name,
      kind: item.kind,
      binanceSymbol: item.binanceSymbol,
      yahooSymbol: item.yahooSymbol,
      direction,
      horizon: analysis.horizon,
      interval: analysis.interval,
      entry: e,
      stop: s,
      targets: ts,
      openedAt: Date.now(),
      reason,
      score: analysis.total,
      signal: analysis.decision.level,
      pattern: plainSetup(analysis.elliott.best),
      lastPrice: analysis.price,
    });
    onClose();
  };

  const rr = (() => {
    const e = parseFloat(entry.replace(",", "."));
    const s = parseFloat(stop.replace(",", "."));
    const t = parseFloat(targets.split(/[;\s]+/)[0]?.replace(",", ".") ?? "");
    return e && s && t && Math.abs(e - s) > 0 ? Math.abs(t - e) / Math.abs(e - s) : null;
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center" onClick={onClose}>
      <div className="panel max-h-[90dvh] w-full max-w-xl overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg text-gold">Papier-Trade übernehmen</h2>
        <p className="mb-3 text-xs text-stone-400">
          {item.symbol} · {analysis.horizon === "short" ? "Kurzfristig" : analysis.horizon === "medium" ? "Mittelfristig" : "Langfristig"} ({analysis.interval}) · Kurs {fmtPrice(analysis.price)}
        </p>
        {analysis.decision.level === "neutral" && (
          <p className="mb-3 rounded-lg border border-wine-light/40 bg-wine/20 p-2 text-xs text-red-200">
            Der Analyst empfiehlt hier keinen Einstieg: {c.reason} Du kannst den Trade trotzdem zum Üben erfassen.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 flex gap-2">
            {(["long", "short"] as const).map((d) => (
              <button key={d} type="button" onClick={() => setDirection(d)} className={`flex-1 rounded-lg border py-2 text-sm ${direction === d ? (d === "long" ? "border-emerald-500 bg-emerald-600/20 text-emerald-200" : "border-red-500 bg-wine/40 text-red-200") : "border-stone-700 text-stone-400"}`}>
                {d === "long" ? "Steigende Kurse (Long)" : "Fallende Kurse (Short)"}
              </button>
            ))}
          </label>
          <label className="text-xs text-stone-400">
            Einstieg
            <input className="input mt-1" value={entry} onChange={(e) => setEntry(e.target.value)} inputMode="decimal" />
          </label>
          <label className="text-xs text-stone-400">
            Stop-Loss
            <input className="input mt-1" value={stop} onChange={(e) => setStop(e.target.value)} inputMode="decimal" />
          </label>
          <label className="col-span-2 text-xs text-stone-400">
            Kursziele (mit ; trennen)
            <input className="input mt-1" value={targets} onChange={(e) => setTargets(e.target.value)} />
          </label>
          <label className="col-span-2 text-xs text-stone-400">
            Begründung
            <textarea className="input mt-1 h-40 text-xs" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>
        {rr != null && <p className="mt-2 text-xs text-stone-400">Chance : Risiko (bis Ziel 1): <span className={rr >= 1.5 ? "text-emerald-400" : "text-red-400"}>{rr.toFixed(2)} : 1</span></p>}
        {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn-primary" onClick={save}>
            Trade eröffnen
          </button>
        </div>
      </div>
    </div>
  );
}
