"use client";
// Depot (früher Journal): nur selbst übernommene Papier-Trades, als Karten-Liste.
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { EquityChart } from "@/components/EquityChart";
import { Legend } from "@/components/Legend";
import { Sheet } from "@/components/Sheet";
import { tradeCurrency, tradeReturnEur } from "@/lib/client/eur";
import { money } from "@/lib/analysis/persona";
import { performance } from "@/lib/analysis/stats";
import { eurPerUnit } from "@/lib/fx";
import { instrumentKey, useMarket } from "@/lib/client/market";
import { actions, useAppData, type Trade } from "@/lib/store/store";
import { HORIZON_LABEL } from "@/lib/types";

const signed = (x: number, d = 2) => `${x >= 0 ? "+" : ""}${x.toFixed(d).replace(".", ",")} %`;

function Tile({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="card px-3 py-2.5">
      <div className="label">{label}</div>
      <div className={`num text-[19px] font-semibold ${tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-stone-50"}`}>{value}</div>
    </div>
  );
}

function statusText(t: Trade) {
  if (t.status === "pending") return { text: "wartend", cls: "badge-wait" };
  if (t.status === "open") return { text: t.trailing ? "offen · Stop läuft mit" : "offen", cls: "badge-muted" };
  const r = t.closeReason;
  return {
    text: r === "target" ? "geschlossen · Ziel" : r === "stop" ? "geschlossen · Stop" : r === "cancelled" ? "verfallen" : r === "welle5" ? "geschlossen · Welle 5" : r === "trendbruch" ? "geschlossen · Trendbruch" : "geschlossen",
    cls: "badge-muted",
  };
}

function TradeCard({ t, price, onAction }: { t: Trade; price?: number; onAction: (t: Trade) => void }) {
  const [dx, setDx] = useState(0);
  const start = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const isLt = t.strategy === "core" || t.strategy === "longterm" || !!t.promotedAt;
  const edge = isLt ? "edge-core" : t.direction === "long" ? "edge-trade" : "edge-short";
  const kind = t.promotedAt ? <span className="badge-core">Blau (hochgestuft)</span> : t.strategy === "longterm" || t.strategy === "core" ? <span className="badge-core">Langfristig</span> : t.direction === "long" ? <span className="badge-trade">Trade</span> : <span className="badge-short">Short</span>;
  const cur = t.status === "closed" ? t.exit : price ?? t.lastPrice;
  const ret = t.status === "closed" ? t.returnPct : t.status === "open" && cur ? tradeReturnEur(t, cur) : undefined;
  const st = statusText(t);
  return (
    <div className="relative">
      {/* Aktionen hinter der Karte (nur beim Wischen nach links sichtbar) */}
      <div className={`absolute inset-y-0 right-0 flex items-center pr-3 transition-opacity ${dx < 0 ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        <button className="btn-primary" onClick={() => onAction(t)}>
          Aktionen
        </button>
      </div>
      <article
        className={`card relative p-4 transition-transform ${edge}`}
        style={{ transform: `translateX(${dx}px)` }}
        onTouchStart={(e) => (start.current = e.touches[0].clientX)}
        onTouchMove={(e) => start.current != null && setDx(Math.min(0, Math.max(-120, e.touches[0].clientX - start.current)))}
        onTouchEnd={() => {
          setDx(dx < -60 ? -120 : 0);
          start.current = null;
        }}
        onClick={() => (dx ? setDx(0) : setOpen(!open))}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[16px] font-semibold text-stone-50">{t.name}</div>
            <div className="text-[13px] text-stone-400">
              {t.symbol} · {HORIZON_LABEL[t.horizon]}
            </div>
          </div>
          <div className="text-right">
            <div className={`num text-[19px] font-semibold ${ret == null ? "text-amber-300" : ret >= 0 ? "text-up" : "text-down"}`}>{ret == null ? "–" : signed(ret)}</div>
            <div className="text-[13px] text-stone-400">{t.status === "closed" ? "Ergebnis" : "Stand"}</div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {kind}
          <span className={st.cls}>{st.text}</span>
          {t.unverified && <span className="badge-wait">Herkunft unklar</span>}
        </div>
        <div className="num mt-2 grid grid-cols-3 gap-2 text-[14px]">
          <span>
            <span className="label block">Einstieg</span>
            {money(t.entry, tradeCurrency(t))}
          </span>
          <span>
            <span className="label block">{t.status === "closed" ? "Ausstieg" : "Kurs"}</span>
            {cur != null ? money(cur, tradeCurrency(t)) : "–"}
          </span>
          <span>
            <span className="label block">Stop / Ziel</span>
            {isLt ? `${t.stop ? money(t.stop, tradeCurrency(t)) : "kein Stop"} / ${t.targets[0] != null ? money(t.targets[0], tradeCurrency(t)) : "–"}` : `${money(t.stop, tradeCurrency(t))} / ${t.targets[0] != null ? money(t.targets[0], tradeCurrency(t)) : "–"}`}
          </span>
        </div>
        {open && (
          <div className="mt-3 space-y-2 border-t border-white/10 pt-3 text-[14px] text-stone-300">
            <p className="text-stone-400">Übernommen am {new Date(t.openedAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</p>
            <p className="whitespace-pre-wrap">{t.reason}</p>
            {t.promotedAt && (
              <p className="rounded-xl bg-sky-500/10 p-2.5 text-[13px] text-sky-100">
                Hochgestuft zu Blau am {new Date(t.promotedAt).toLocaleDateString("de-DE")}: {t.promoteReason}
                {t.initialStop != null && t.initialStop !== t.stop ? ` Stop von ${money(t.initialStop, tradeCurrency(t))} auf ${money(t.stop, tradeCurrency(t))} nachgezogen.` : ""}
              </p>
            )}
            {t.strategy === "longterm" && (
              <div className="space-y-1 rounded-xl bg-sky-500/10 p-2.5 text-[13px] text-sky-100">
                <p>Teile: {(t.tranches ?? []).map((x) => `${money(x.price, tradeCurrency(t))} ${x.filledAt ? "✓" : "wartet"}`).join(" · ") || "–"}</p>
                {(t.partials ?? []).map((p, i) => (
                  <p key={i}>
                    Teilausstieg {Math.round(p.fraction * 100)} % bei {money(p.price, tradeCurrency(t))} ({new Date(p.at).toLocaleDateString("de-DE")})
                  </p>
                ))}
                {t.lastActionText && <p className="text-sky-200">Letzte Meldung: {t.lastActionText}</p>}
              </div>
            )}
            <button
              className="btn w-full"
              onClick={(e) => {
                e.stopPropagation();
                onAction(t);
              }}
            >
              Aktionen
            </button>
          </div>
        )}
      </article>
    </div>
  );
}

export default function DepotPage() {
  const trades = useAppData((d) => d.trades);
  const notice = useAppData((d) => d.migrationNotice);
  const { live } = useMarket();
  // Signalart statt Zeitraum: Blau (langfristig / hochgestuft) · Grün (Trade) · Rot (Short). Der Zeitraum steht nur noch als Info am Trade.
  const [art, setArt] = useState<"all" | "blau" | "gruen" | "rot">("all");
  const [action, setAction] = useState<Trade | null>(null);
  const [exitPrice, setExitPrice] = useState("");

  const filtered = useMemo(
    () =>
      trades
        .filter((t) => {
          if (art === "all") return true;
          const blue = t.strategy === "core" || t.strategy === "longterm" || !!t.promotedAt;
          return art === "blau" ? blue : art === "gruen" ? !blue && t.direction === "long" : !blue && t.direction === "short";
        })
        .sort((a, b) => (a.status === "closed" ? 1 : 0) - (b.status === "closed" ? 1 : 0) || b.openedAt - a.openedAt),
    [trades, art],
  );
  const closed = filtered.filter((t) => t.status === "closed" && t.returnPct != null);
  const stats = performance(closed.map((t) => ({ returnPct: t.returnPct!, closedAt: t.closedAt! })));
  const openRets = filtered
    .filter((t) => t.status === "open")
    .map((t) => {
      const p = live[instrumentKey(t)]?.price ?? t.lastPrice;
      return p ? tradeReturnEur(t, p) : null;
    })
    .filter((x): x is number => x != null);
  const openAvg = openRets.length ? openRets.reduce((a, b) => a + b, 0) / openRets.length : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] text-gold">Depot</h1>
          <p className="text-[15px] text-stone-400">Nur Trades, die du selbst übernommen hast.</p>
        </div>
        <Legend />
      </div>

      {notice && (notice.removedAuto > 0 || notice.unverified > 0) && (
        <div className="card edge-wait space-y-2 p-4 text-[15px]">
          <p className="font-semibold text-stone-100">Depot bereinigt</p>
          {notice.removedAuto > 0 && (
            <p className="text-stone-300">
              {notice.removedAuto === 1 ? "1 automatisch erzeugter Kernpositions-Eintrag wurde" : `${notice.removedAuto} automatisch erzeugte Kernpositions-Einträge wurden`} entfernt.
            </p>
          )}
          {notice.unverified > 0 && <p className="text-stone-300">Bei {notice.unverified === 1 ? "1 älteren Trade" : `${notice.unverified} älteren Trades`} ist nicht erkennbar, ob du sie selbst übernommen hast. Sollen sie bleiben?</p>}
          <p className="text-[13px] text-stone-500">Vorher wurde ein Backup gespeichert (Mehr → Backups).</p>
          <div className="flex gap-2">
            {notice.unverified > 0 ? (
              <>
                <button className="btn flex-1" onClick={() => actions.resolveUnverified(false)}>
                  Entfernen
                </button>
                <button className="btn-primary flex-1" onClick={() => actions.resolveUnverified(true)}>
                  Behalten
                </button>
              </>
            ) : (
              <button className="btn w-full" onClick={() => actions.dismissMigrationNotice()}>
                Verstanden
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Tile label="Gesamt (abgeschlossen)" value={signed(stats.totalReturn)} tone={stats.totalReturn >= 0 ? "up" : "down"} />
        <Tile label="Offene Trades jetzt" value={openAvg == null ? "–" : signed(openAvg)} tone={openAvg == null ? undefined : openAvg >= 0 ? "up" : "down"} />
        <Tile label="Trefferquote" value={`${(stats.winRate * 100).toFixed(0)} % (${stats.wins}/${stats.trades})`} />
        <Tile label="Ø Gewinn / Verlust" value={`${stats.avgWin.toFixed(1).replace(".", ",")} / ${stats.avgLoss.toFixed(1).replace(".", ",")} %`} />
        <Tile label="Max. Rückgang" value={signed(stats.maxDrawdown, 1)} tone={stats.maxDrawdown < 0 ? "down" : undefined} />
        <Tile label="Gewinnfaktor" value={stats.profitFactor == null ? "∞" : stats.profitFactor.toFixed(2).replace(".", ",")} />
      </div>
      <div className="card p-3">
        <div className="label mb-1">Kumulierte Rendite</div>
        <EquityChart data={stats.curve} height={180} />
      </div>

      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 [scrollbar-width:none]">
        {(
          [
            ["all", "Alle"],
            ["blau", "Blau"],
            ["gruen", "Grün"],
            ["rot", "Rot"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setArt(k)} className={`chip shrink-0 ${art === k ? "border-gold bg-white/10 font-semibold text-gold-light" : "border-white/10 text-stone-400"}`}>
            {l}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card p-5 text-center text-[15px] text-stone-300">
          Noch keine Trades. Übernimm eine Einstiegsmöglichkeit unter{" "}
          <Link href="/chancen" className="text-gold underline">
            Chancen
          </Link>{" "}
          mit „Als Papier-Trade übernehmen“.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((t) => (
            <TradeCard
              key={t.id}
              t={t}
              price={live[instrumentKey(t)]?.price}
              onAction={(x) => {
                setAction(x);
                setExitPrice(String(+((live[instrumentKey(x)]?.price ?? x.lastPrice ?? x.entry) * (eurPerUnit(tradeCurrency(x)) ?? 1)).toPrecision(6)));
              }}
            />
          ))}
        </div>
      )}

      <Sheet open={!!action} onClose={() => setAction(null)} title={action ? `${action.name} – Aktionen` : ""}>
        {action && (
          <div className="space-y-3">
            {action.status === "open" && (
              <>
                <label className="block text-[14px] text-stone-300">
                  Ausstiegskurs in €
                  <input className="input mt-1 num" value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} inputMode="decimal" />
                </label>
                <button
                  className="btn-primary w-full"
                  onClick={() => {
                    const exitEur = parseFloat(exitPrice.replace(",", "."));
                    if (!(exitEur > 0)) return;
                    // Eingabe in Euro → Börsenkurs in der Originalwährung; Ergebnis in Euro (mit Wechselkurs)
                    const fx = eurPerUnit(tradeCurrency(action)) ?? 1;
                    const exit = exitEur / fx;
                    actions.updateTrade(action.id, { status: "closed", exit, closedAt: Date.now(), closeReason: "manual", returnPct: tradeReturnEur(action, exit), fxExit: fx });
                    setAction(null);
                  }}
                >
                  Trade jetzt schließen
                </button>
              </>
            )}
            {action.status === "pending" && (
              <button
                className="btn-primary w-full"
                onClick={() => {
                  actions.updateTrade(action.id, { status: "closed", closedAt: Date.now(), closeReason: "cancelled" });
                  setAction(null);
                }}
              >
                Wartende Order löschen
              </button>
            )}
            <button
              className="btn-danger w-full"
              onClick={() => {
                actions.removeTrade(action.id);
                setAction(null);
              }}
            >
              Aus dem Depot entfernen
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
