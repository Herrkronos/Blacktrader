"use client";
import { Fragment, useMemo, useState } from "react";
import { EquityChart } from "@/components/EquityChart";
import { SignalBadge, Stat } from "@/components/ui";
import { fmtPrice } from "@/lib/analysis/persona";
import { performance, tradeReturnPct } from "@/lib/analysis/stats";
import { instrumentKey, useMarket } from "@/lib/client/market";
import { actions, useAppData, type Trade } from "@/lib/store/store";
import { HORIZON_LABEL, type Horizon } from "@/lib/types";

export default function JournalPage() {
  const trades = useAppData((d) => d.trades);
  const { live } = useMarket();
  const [horizon, setHorizon] = useState<Horizon | "all">("all");
  const [asset, setAsset] = useState<string>("all");
  const [open, setOpen] = useState<string | null>(null);

  const assets = useMemo(() => [...new Set(trades.map((t) => t.symbol))].sort(), [trades]);
  const filtered = trades.filter((t) => (horizon === "all" || t.horizon === horizon) && (asset === "all" || t.symbol === asset));
  const closed = filtered.filter((t) => t.status === "closed" && t.returnPct != null);
  const openTrades = filtered.filter((t) => t.status === "open");
  const stats = performance(closed.map((t) => ({ returnPct: t.returnPct!, closedAt: t.closedAt! })));

  const closeManually = (t: Trade) => {
    const lv = live[instrumentKey(t)];
    const suggestion = lv?.price ?? t.lastPrice ?? t.entry;
    const input = window.prompt(`Ausstiegskurs für ${t.symbol}:`, String(+suggestion.toPrecision(6)));
    if (!input) return;
    const exit = parseFloat(input.replace(",", "."));
    if (!(exit > 0)) return;
    actions.updateTrade(t.id, { status: "closed", exit, closedAt: Date.now(), closeReason: "manual", returnPct: tradeReturnPct(t.direction, t.entry, exit) });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl text-gold sm:text-3xl">Trade-Journal</h1>
          <p className="text-sm text-stone-400">Papier-Trades werden mit Live-Kursen verfolgt und bei Ziel oder Stop automatisch geschlossen.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="input w-auto" value={horizon} onChange={(e) => setHorizon(e.target.value as Horizon | "all")}>
            <option value="all">Alle Horizonte</option>
            {(["short", "medium", "long"] as Horizon[]).map((h) => (
              <option key={h} value={h}>
                {HORIZON_LABEL[h]}
              </option>
            ))}
          </select>
          <select className="input w-auto" value={asset} onChange={(e) => setAsset(e.target.value)}>
            <option value="all">Alle Werte</option>
            {assets.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Kumuliert" value={`${stats.totalReturn >= 0 ? "+" : ""}${stats.totalReturn.toFixed(2)} %`} tone={stats.totalReturn >= 0 ? "up" : "down"} />
        <Stat label="Trefferquote" value={`${(stats.winRate * 100).toFixed(0)} %`} hint={`${stats.wins} / ${stats.trades} Trades`} />
        <Stat label="Ø Gewinn" value={`+${stats.avgWin.toFixed(2)} %`} tone="up" />
        <Stat label="Ø Verlust" value={`${stats.avgLoss.toFixed(2)} %`} tone="down" />
        <Stat label="Max. Drawdown" value={`${stats.maxDrawdown.toFixed(2)} %`} tone="down" />
        <Stat label="Profit-Faktor" value={stats.profitFactor == null ? "∞" : stats.profitFactor.toFixed(2)} hint={`${openTrades.length} offen`} />
      </div>

      <div className="panel p-3">
        <div className="panel-title mb-2">Performance – kumulierte Rendite</div>
        <EquityChart data={stats.curve} />
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-gold/20 text-left text-[11px] uppercase tracking-wider text-stone-400">
            <tr>
              <th className="px-3 py-2">Wert</th>
              <th className="px-2 py-2">Datum</th>
              <th className="px-2 py-2">Horizont</th>
              <th className="px-2 py-2">Signal</th>
              <th className="px-2 py-2 text-right">Einstieg</th>
              <th className="px-2 py-2 text-right">Stop</th>
              <th className="px-2 py-2 text-right">Ziel(e)</th>
              <th className="px-2 py-2 text-right">Kurs / Exit</th>
              <th className="px-2 py-2 text-right">Rendite</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gold/10">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="p-6 text-center text-stone-400">
                  Noch keine Trades. Übernimm ein Signal auf der Analyse-Seite.
                </td>
              </tr>
            )}
            {[...filtered].sort((a, b) => b.openedAt - a.openedAt).map((t) => {
              const lv = live[instrumentKey(t)];
              const cur = t.status === "open" ? lv?.price ?? t.lastPrice : t.exit;
              const ret = t.status === "closed" ? t.returnPct : cur ? tradeReturnPct(t.direction, t.entry, cur) : undefined;
              return (
                <Fragment key={t.id}>
                  <tr className="cursor-pointer hover:bg-gold/5" onClick={() => setOpen(open === t.id ? null : t.id)}>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-gold-light">{t.symbol}</div>
                      <div className={`text-xs ${t.direction === "long" ? "text-up" : "text-down"}`}>{t.direction === "long" ? "Long" : "Short"}</div>
                    </td>
                    <td className="px-2 py-2 text-xs text-stone-400">{new Date(t.openedAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="px-2 py-2 text-xs">{HORIZON_LABEL[t.horizon]} <span className="text-stone-500">{t.interval}</span></td>
                    <td className="px-2 py-2"><SignalBadge level={t.signal} small /></td>
                    <td className="num px-2 py-2 text-right">{fmtPrice(t.entry)}</td>
                    <td className="num px-2 py-2 text-right text-down">{fmtPrice(t.stop)}</td>
                    <td className="num px-2 py-2 text-right text-up">{t.targets.map(fmtPrice).join(" / ")}</td>
                    <td className="num px-2 py-2 text-right">{cur ? fmtPrice(cur) : "–"}</td>
                    <td className={`num px-2 py-2 text-right ${ret == null ? "" : ret >= 0 ? "text-up" : "text-down"}`}>{ret == null ? "–" : `${ret >= 0 ? "+" : ""}${ret.toFixed(2)} %`}</td>
                    <td className="px-2 py-2 text-xs">
                      {t.status === "open" ? <span className="text-gold-light">offen</span> : <span className="text-stone-400">{t.closeReason === "target" ? "Ziel" : t.closeReason === "stop" ? "Stop" : "manuell"}</span>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      {t.status === "open" && (
                        <button className="btn mr-1 px-2 py-1 text-xs" onClick={() => closeManually(t)}>
                          Schließen
                        </button>
                      )}
                      <button className="text-stone-500 hover:text-red-400" onClick={() => window.confirm("Trade löschen?") && actions.removeTrade(t.id)} title="Löschen">
                        ✕
                      </button>
                    </td>
                  </tr>
                  {open === t.id && (
                    <tr>
                      <td colSpan={11} className="bg-black/40 px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap text-stone-300">
                        <b className="text-gold">Begründung{t.pattern ? ` · ${t.pattern}` : ""} · Score {t.score.toFixed(0)}</b>
                        {"\n"}
                        {t.reason}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
