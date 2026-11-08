"use client";
import { useState } from "react";
import { EquityChart } from "@/components/EquityChart";
import { HorizonToggle, Stat } from "@/components/ui";
import { runBacktest, type BacktestResult } from "@/lib/analysis/backtest";
import { fmtPrice } from "@/lib/analysis/persona";
import { api } from "@/lib/client/api";
import { useAppData } from "@/lib/store/store";
import { HORIZON_INTERVALS, type Horizon, type Interval } from "@/lib/types";

export default function BacktestPage() {
  const watchlist = useAppData((d) => d.watchlist);
  const weights = useAppData((d) => d.settings.weights);
  const intervals = useAppData((d) => d.settings.intervals);
  const [id, setId] = useState<string>("");
  const [horizon, setHorizon] = useState<Horizon>("medium");
  const [interval, setInterval_] = useState<Interval>(intervals.medium);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(BacktestResult & { symbol: string; bars: number }) | null>(null);

  const item = watchlist.find((w) => w.id === id) ?? watchlist[0];

  const run = async () => {
    if (!item) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { candles } = await api.candles(item, interval, 60e3);
      if (candles.length < 150) throw new Error(`Zu wenig Historie (${candles.length} Kerzen, mindestens 150 nötig).`);
      await new Promise((r) => setTimeout(r, 20)); // UI zuerst aktualisieren
      const r = runBacktest(candles, { horizon, interval, weights });
      setResult({ ...r, symbol: item.symbol, bars: candles.length });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const s = result?.stats;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl text-gold sm:text-3xl">Backtest</h1>
        <p className="text-sm text-stone-400">
          Walk-Forward auf historischen Kerzen: Zu jedem Zeitpunkt sieht die Analyse nur die Vergangenheit. Fundamentaldaten und News sind historisch nicht verfügbar und zählen neutral. Stop und Ziel in derselben Kerze werden konservativ als Stop gewertet.
        </p>
      </div>
      <div className="panel flex flex-col gap-3 p-3 sm:flex-row sm:items-end">
        <label className="flex-1 text-xs text-stone-400">
          Wert aus der Watchlist
          <select className="input mt-1" value={item?.id ?? ""} onChange={(e) => setId(e.target.value)}>
            {watchlist.length === 0 && <option value="">– Watchlist leer –</option>}
            {watchlist.map((w) => (
              <option key={w.id} value={w.id}>
                {w.symbol} – {w.name}
              </option>
            ))}
          </select>
        </label>
        <div className="text-xs text-stone-400">
          Horizont
          <div className="mt-1">
            <HorizonToggle
              value={horizon}
              onChange={(h) => {
                if (!h) return;
                setHorizon(h);
                setInterval_(intervals[h]);
              }}
            />
          </div>
        </div>
        <div className="text-xs text-stone-400">
          Kerzen
          <div className="mt-1 flex gap-1">
            {HORIZON_INTERVALS[horizon].map((iv) => (
              <button key={iv} onClick={() => setInterval_(iv)} className={`chip ${iv === interval ? "border-gold bg-gold/20 text-gold-light" : "border-stone-700 text-stone-400"}`}>
                {iv}
              </button>
            ))}
          </div>
        </div>
        <button className="btn-primary sm:w-40" disabled={!item || busy} onClick={run}>
          {busy ? "Rechne …" : "Backtest starten"}
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {result && s && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Strategie" value={`${s.totalReturn >= 0 ? "+" : ""}${s.totalReturn.toFixed(1)} %`} tone={s.totalReturn >= 0 ? "up" : "down"} hint={`${result.symbol} · ${result.bars} Kerzen`} />
            <Stat label="Buy & Hold" value={`${result.buyAndHold >= 0 ? "+" : ""}${result.buyAndHold.toFixed(1)} %`} />
            <Stat label="Trades" value={s.trades} hint={`Trefferquote ${(s.winRate * 100).toFixed(0)} %`} />
            <Stat label="Ø Gewinn / Verlust" value={`${s.avgWin.toFixed(1)} / ${s.avgLoss.toFixed(1)} %`} />
            <Stat label="Max. Drawdown" value={`${s.maxDrawdown.toFixed(1)} %`} tone="down" />
            <Stat label="Profit-Faktor" value={s.profitFactor == null ? "∞" : s.profitFactor.toFixed(2)} hint={`${result.evaluatedBars} Analysen`} />
          </div>
          {s.trades < 10 && <p className="text-xs text-amber-300">Weniger als 10 Trades – statistisch nicht belastbar. Ehrlich gesagt: Das ist eine Anekdote, kein Beweis.</p>}
          <div className="panel p-3">
            <div className="panel-title mb-2">Equity-Kurve</div>
            <EquityChart data={s.curve} compare={result.buyAndHold} />
          </div>
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-gold/20 text-left text-[11px] uppercase tracking-wider text-stone-400">
                <tr>
                  <th className="px-3 py-2">Einstieg</th>
                  <th className="px-2 py-2">Richtung</th>
                  <th className="px-2 py-2">Muster</th>
                  <th className="px-2 py-2 text-right">Einstieg</th>
                  <th className="px-2 py-2 text-right">Exit</th>
                  <th className="px-2 py-2">Grund</th>
                  <th className="px-2 py-2 text-right">Rendite</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gold/10">
                {result.trades.map((t) => (
                  <tr key={t.entryTime}>
                    <td className="px-3 py-1.5 text-xs text-stone-400">{new Date(t.entryTime * 1000).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className={`px-2 py-1.5 ${t.direction === "long" ? "text-up" : "text-down"}`}>{t.direction === "long" ? "Long" : "Short"}</td>
                    <td className="px-2 py-1.5 text-xs">{t.pattern}</td>
                    <td className="num px-2 py-1.5 text-right">{fmtPrice(t.entry)}</td>
                    <td className="num px-2 py-1.5 text-right">{fmtPrice(t.exit)}</td>
                    <td className="px-2 py-1.5 text-xs">{{ target: "Ziel", stop: "Stop", timeout: "Zeitlimit", end: "Datenende" }[t.reason]}</td>
                    <td className={`num px-2 py-1.5 text-right ${t.returnPct >= 0 ? "text-up" : "text-down"}`}>{`${t.returnPct >= 0 ? "+" : ""}${t.returnPct.toFixed(2)} %`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
