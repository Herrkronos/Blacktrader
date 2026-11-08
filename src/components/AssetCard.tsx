"use client";
// Analyse-Karte (Chancen, Watchlist, Übersicht):
// Zeile 1 Name/Kurs · Zeile 2 Mini-Chart · Zeile 3 Einstieg/Stop/Ziel · Zeile 4 Score + Badge · max. 2 Buttons.
import { useMemo, useRef, useState } from "react";
import type { AnalysisResult } from "@/lib/analysis/analyze";
import type { CoreStatus } from "@/lib/analysis/core";
import { money } from "@/lib/analysis/persona";
import { haptic } from "@/lib/client/alerts";
import { hasOpenTrade, openCoreTrade, openManualCoreTrade, openPaperTrade } from "@/lib/client/autotrade";
import type { LiveStatus } from "@/lib/client/market";
import { actions, getData, useAppData } from "@/lib/store/store";
import { HORIZON_LABEL, type Candle, type Horizon, type ResolvedAsset } from "@/lib/types";
import { MiniChart } from "./MiniChart";
import { ConfirmSheet } from "./Sheet";
import { StatusPill } from "./StatusPill";

export interface HorizonView {
  res: AnalysisResult | null;
  candles: Candle[];
}

const HORIZONS: Horizon[] = ["short", "medium", "long"];
const RISK_LIMIT = 15; // % Abstand Einstieg–Stop, ab dem "Hohes Risiko" angezeigt wird

const pctStr = (a: number, b: number) => `${((Math.abs(b - a) / a) * 100).toFixed(1).replace(".", ",")} %`;

/**
 * Signalstärke 0–100 (nur Anzeige): je höher, desto stärker das Signal – für Kauf und Short gleich.
 * Kauf = Gesamtscore, Short = 100 − Gesamtscore (ein niedriger Score bedeutet ein starkes Short-Signal).
 */
export function signalStrength(res: AnalysisResult | null | undefined): number | null {
  if (!res || !res.plan || res.decision.level === "neutral") return null;
  return res.plan.direction === "long" ? res.total : 100 - res.total;
}

/** Erklärung, wenn die Zeiträume unterschiedliche Richtungen zeigen. */
export function conflictText(views: Partial<Record<Horizon, HorizonView>>): string | null {
  const dirs = HORIZONS.map((h) => {
    const r = views[h]?.res;
    return r && r.plan && r.decision.level !== "neutral" ? { h, dir: r.plan.direction } : null;
  }).filter(Boolean) as { h: Horizon; dir: "long" | "short" }[];
  if (!dirs.some((d) => d.dir === "long") || !dirs.some((d) => d.dir === "short")) return null;
  const parts = dirs.map((d) => `${HORIZON_LABEL[d.h]} ${d.dir === "long" ? "Aufwärtstrend" : "Korrektur (fallend)"}`);
  return `${parts.join(", ")}. Das ist kein Widerspruch: Kurze Rücksetzer gibt es oft auch in einem längeren Aufwärtstrend. Wer langfristig denkt, richtet sich nach dem längeren Zeitraum.`;
}

export function AssetCard({
  asset,
  views,
  core,
  initial,
  price,
  changePct,
  status,
  source,
  onOpen,
  onRemove,
  focus,
}: {
  asset: ResolvedAsset;
  views: Partial<Record<Horizon, HorizonView>>;
  core?: CoreStatus | null;
  initial?: Horizon;
  price?: number;
  changePct?: number;
  status?: LiveStatus;
  source?: string;
  onOpen: (h: Horizon) => void;
  onRemove?: () => void;
  /** "core" = nur die Kernposition zeigen (Filter Kernposition) */
  focus?: "core";
}) {
  const available = HORIZONS.filter((h) => views[h]);
  const firstActive = available.find((h) => views[h]?.res?.plan && views[h]?.res?.decision.level !== "neutral");
  const [h, setH] = useState<Horizon>(initial && views[initial] ? initial : firstActive ?? available[0] ?? "medium");
  const [confirm, setConfirm] = useState<null | "trade" | "core">(null);
  const touch = useRef<number | null>(null);
  const trades = useAppData((d) => d.trades);
  const view = views[h];
  const res = view?.res ?? null;
  const coreFocus = focus === "core";
  const plan = !coreFocus && res && res.decision.level !== "neutral" ? res.plan : null;
  const strength = coreFocus ? null : signalStrength(res);
  const cur = asset.currency;
  const myCore = trades.find((t) => t.status === "open" && t.strategy === "core" && t.symbol === asset.symbol);
  const coreActive = !!myCore || core?.state === "hold";
  const isNachkauf = !!plan && plan.direction === "long" && coreActive;
  const riskPct = plan ? (Math.abs(plan.entry - plan.stop) / plan.entry) * 100 : 0;
  const lastPrice = price ?? res?.price;
  const conflict = useMemo(() => conflictText(views), [views]);
  const tradeOpen = res ? hasOpenTrade(asset.symbol, res.horizon) : false;

  const edge = coreFocus ? "edge-core" : plan ? (plan.direction === "long" ? "edge-trade" : "edge-short") : coreActive ? "edge-core" : "";
  const badge = plan ? (
    plan.direction === "long" ? (
      <span className="badge-trade">{isNachkauf ? "Nachkauf" : "Trade"}</span>
    ) : (
      <span className="badge-short">Short</span>
    )
  ) : coreActive ? (
    <span className="badge-core">Kernposition</span>
  ) : (
    <span className="badge-muted">Abwarten</span>
  );

  // Wischen zwischen Zeiträumen
  const swipe = (dx: number) => {
    const i = available.indexOf(h);
    const next = dx < 0 ? available[i + 1] : available[i - 1];
    if (next) setH(next);
  };

  const coreLine = (() => {
    if (myCore) {
      const p = lastPrice ? ((lastPrice - myCore.entry) / myCore.entry) * 100 : null;
      return `Deine Kernposition: gekauft am ${new Date(myCore.openedAt).toLocaleDateString("de-DE")} bei ${money(myCore.entry, cur)}${p != null ? ` · ${p >= 0 ? "+" : ""}${p.toFixed(1).replace(".", ",")} %` : ""}`;
    }
    if (!core) return null;
    const d = core.last ? new Date(core.last.time * 1000).toLocaleDateString("de-DE") : null;
    if (core.state === "hold") return `Kernpositions-Signal${d ? ` seit ${d}` : ""} (historisch) – Aufwärtstrend intakt`;
    if (core.state === "wait-bottom") return `Gewinnmitnahme-Signal${d ? ` am ${d}` : ""} (historisch) – warten auf Boden`;
    return null;
  })();

  return (
    <article
      className={`card space-y-3 p-4 ${edge}`}
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current == null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        if (Math.abs(dx) > 60) swipe(dx);
        touch.current = null;
      }}
    >
      {/* Zeile 1 */}
      <div className="flex items-start justify-between gap-3">
        <button className="min-w-0 text-left" onClick={() => onOpen(h)}>
          <div className="truncate text-[17px] font-semibold text-stone-50">{asset.name}</div>
          <div className="text-[13px] text-stone-400">{asset.symbol}</div>
        </button>
        <div className="text-right">
          <div className="value">{lastPrice != null ? money(lastPrice, cur) : "–"}</div>
          <div className="flex items-center justify-end gap-1.5">
            {changePct != null && <span className={`num text-[14px] ${changePct >= 0 ? "text-up" : "text-down"}`}>{`${changePct >= 0 ? "+" : ""}${changePct.toFixed(2).replace(".", ",")} %`}</span>}
            {status && <StatusPill status={status} source={source} />}
          </div>
        </div>
      </div>

      {available.length > 1 && !coreFocus && (
        <div className="seg w-full" role="tablist" aria-label="Zeitraum">
          {available.map((x) => {
            const r = views[x]?.res;
            const dot = r?.plan && r.decision.level !== "neutral" ? (r.plan.direction === "long" ? "bg-emerald-400" : "bg-red-400") : "bg-stone-600";
            return (
              <button key={x} aria-pressed={x === h} onClick={() => setH(x)} className="flex flex-1 items-center justify-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${dot}`} />
                {HORIZON_LABEL[x]}
              </button>
            );
          })}
        </div>
      )}

      {/* Zeile 2 */}
      {view && <MiniChart candles={view.candles} plan={plan} best={res?.elliott.best} />}

      {/* Zeile 3 */}
      {plan ? (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-white/5 px-1 py-2">
            <div className="label">{plan.orderType === "limit" ? "Einstieg (warten)" : "Einstieg"}</div>
            <div className="num text-[17px] font-semibold text-stone-50">{money(plan.entry, cur)}</div>
            {lastPrice != null && plan.orderType === "limit" && <div className="num text-[13px] text-amber-300">noch {pctStr(lastPrice, plan.entry)}</div>}
          </div>
          <div className="rounded-xl bg-white/5 px-1 py-2">
            <div className="label">Stop</div>
            <div className="num text-[17px] font-semibold text-red-300">{money(plan.stop, cur)}</div>
            <div className="num text-[13px] text-red-300/80">−{pctStr(plan.entry, plan.stop)}</div>
          </div>
          <div className="rounded-xl bg-white/5 px-1 py-2">
            <div className="label">Ziel</div>
            <div className="num text-[17px] font-semibold text-emerald-300">{money(plan.targets[0], cur)}</div>
            <div className="num text-[13px] text-emerald-300/80">+{pctStr(plan.entry, plan.targets[0])}</div>
          </div>
        </div>
      ) : coreFocus && core ? (
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl bg-sky-500/10 px-1 py-2">
            <div className="label">{core.state === "hold" ? "Signal seit" : "Letztes Signal"}</div>
            <div className="num text-[17px] font-semibold text-sky-200">{core.last ? new Date(core.last.time * 1000).toLocaleDateString("de-DE") : "–"}</div>
            {core.last && <div className="num text-[13px] text-stone-400">bei {money(core.last.price, cur)}</div>}
          </div>
          <div className="rounded-xl bg-sky-500/10 px-1 py-2">
            <div className="label">Seitdem</div>
            {core.last && lastPrice != null ? (
              <div className={`num text-[17px] font-semibold ${lastPrice >= core.last.price ? "text-up" : "text-down"}`}>
                {`${lastPrice >= core.last.price ? "+" : "−"}${pctStr(core.last.price, lastPrice)}`}
              </div>
            ) : (
              <div className="num text-[17px] font-semibold text-stone-400">–</div>
            )}
            <div className="text-[13px] text-stone-400">Verkauf: Welle 5 / Trendbruch</div>
          </div>
        </div>
      ) : (
        <p className="text-[15px] text-stone-300">{res ? "Kein Einstieg – abwarten." : "Keine Daten für diesen Zeitraum."}</p>
      )}

      {/* Zeile 4: Signalstärke – je höher, desto stärker (Kauf und Short gleich) */}
      <div className="flex items-center gap-3">
        {coreFocus ? (
          <span className="flex-1 text-[14px] text-stone-400">Langfristig halten – ohne Punkte, solange der Trend intakt ist.</span>
        ) : (
          <>
            <span className="label shrink-0">Stärke</span>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/10" aria-label={`Signalstärke ${strength?.toFixed(0) ?? "–"} von 100`}>
              <div className={`h-full rounded-full ${strength == null ? "bg-stone-600" : strength >= 65 ? "bg-emerald-400" : strength >= 55 ? "bg-gold" : "bg-stone-400"}`} style={{ width: `${Math.max(2, Math.min(100, strength ?? 0))}%` }} />
            </div>
            <span className="num text-[15px] font-semibold text-stone-200">{strength != null ? strength.toFixed(0) : "–"}</span>
          </>
        )}
        {coreFocus ? <span className="badge-core">Kernposition</span> : badge}
        {plan && riskPct > RISK_LIMIT && <span className="badge-risk">Hohes Risiko</span>}
      </div>

      {!coreFocus && (coreLine || isNachkauf || conflict) && (
        <div className="space-y-1.5 text-[14px]">
          {isNachkauf && <p className="text-sky-200">Nachkauf-Zone zur bestehenden Kernposition.</p>}
          {coreLine && <p className={myCore ? "text-sky-200" : "text-stone-400"}>{coreLine}</p>}
          {conflict && <p className="text-stone-400">{conflict}</p>}
          {plan && riskPct > RISK_LIMIT && <p className="text-red-300">Stop {pctStr(plan.entry, plan.stop)} entfernt – nur mit kleiner Positionsgröße.</p>}
        </div>
      )}

      {/* Max. 2 Buttons */}
      <div className="flex gap-2">
        <button className="btn flex-1" onClick={() => onOpen(h)}>
          Analyse ansehen
        </button>
        {plan && res && !tradeOpen ? (
          <button className="btn-primary flex-1" onClick={() => setConfirm("trade")}>
            {isNachkauf ? "Nachkauf übernehmen" : "Als Papier-Trade übernehmen"}
          </button>
        ) : !plan && core?.state === "hold" && !myCore && view?.res ? (
          <button className="btn-primary flex-1" onClick={() => setConfirm("core")}>
            Kernposition übernehmen
          </button>
        ) : onRemove ? (
          <button className="btn flex-1" onClick={onRemove}>
            Entfernen
          </button>
        ) : null}
      </div>

      <ConfirmSheet
        open={confirm === "trade"}
        title={isNachkauf ? "Nachkauf als Papier-Trade" : "Papier-Trade übernehmen"}
        confirm={plan?.orderType === "limit" ? "Order legen" : "Trade eröffnen"}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (res && openPaperTrade(asset, res)) {
            if (getData().settings.haptics) haptic(30);
          }
        }}
        text={
          plan ? (
            <div className="space-y-2">
              <p>
                {asset.name} · {HORIZON_LABEL[h]}: {plan.direction === "long" ? "auf steigende Kurse" : "auf fallende Kurse"}.
              </p>
              <p className="num">
                Einstieg {money(plan.entry, cur)} · Stop {money(plan.stop, cur)} · Ziel {money(plan.targets[0], cur)}
              </p>
              {plan.orderType === "limit" && <p className="text-amber-300">Wartende Order: Der Trade startet erst, wenn der Kurs {money(plan.entry, cur)} erreicht.</p>}
              <p className="text-[13px] text-stone-400">Einstieg, Stop und Ziele kommen unverändert vom Analysten.</p>
            </div>
          ) : null
        }
      />
      <ConfirmSheet
        open={confirm === "core"}
        title="Kernposition übernehmen"
        confirm="Übernehmen"
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const r = views.medium?.res ?? view?.res;
          if (r && openManualCoreTrade(asset, r, "Kernposition selbst übernommen")) {
            // Wert überwachen, damit die Position bei Welle 5 / Trendbruch geschlossen werden kann
            actions.addWatch(asset);
            if (getData().settings.haptics) haptic(30);
          }
        }}
        text={
          <div className="space-y-2">
            <p>
              Langfristig halten: {asset.name} zum aktuellen Kurs {lastPrice != null ? money(lastPrice, cur) : ""}.
            </p>
            <p className="text-stone-400">Geschlossen wird, wenn der Analyst das Ende der 5. Welle erkennt oder der große Aufwärtstrend bricht. Der Wert wird dazu in deine Watchlist aufgenommen.</p>
          </div>
        }
      />
    </article>
  );
}

export { openCoreTrade };
