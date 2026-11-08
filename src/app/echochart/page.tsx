"use client";
import { useMemo, useState } from "react";
import { EquityChart } from "@/components/EquityChart";
import { HorizonToggle, Stat } from "@/components/ui";
import type { BacktestResult } from "@/lib/analysis/backtest";
import { runZoneBacktestAsync } from "@/lib/analysis/zoneBacktest";
import { DEFAULT_PARAMS } from "@/lib/analysis/params";
import { learnedParams } from "@/lib/client/trainerParams";
import { signalFromAnalysis } from "@/lib/trainer/engine";
import { runCoreBacktestAsync, type CoreResult } from "@/lib/analysis/core";
import { fmtPrice } from "@/lib/analysis/persona";
import { LOOKBACKS, loadHistory, planHistory } from "@/lib/client/history";
import { SCAN_GROUPS } from "@/lib/client/presets";
import { useAppData } from "@/lib/store/store";
import { HORIZON_INTERVALS, type Candle, type Horizon, type Interval, type ResolvedAsset } from "@/lib/types";

const fmtDate = (t: number) => new Date(t * 1000).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

export default function EchoChartPage() {
  const watchlist = useAppData((d) => d.watchlist);
  const intervals = useAppData((d) => d.settings.intervals);
  const [key, setKey] = useState<string>("");
  const [horizon, setHorizon] = useState<Horizon>("medium");
  const [interval, setInterval_] = useState<Interval>(intervals.medium);
  const [days, setDays] = useState(365);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<{ label: string; p: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [core, setCore] = useState<CoreResult | null>(null);
  const [result, setResult] = useState<(BacktestResult & { symbol: string; bars: number; from: number; to: number; note?: string; interval: Interval }) | null>(null);

  // Auswahl: Watchlist + feste Gruppen (Aktien, Krypto, Rohstoffe)
  const options = useMemo(() => {
    const groups: { title: string; assets: ResolvedAsset[] }[] = [];
    if (watchlist.length) groups.push({ title: "Meine Watchlist", assets: watchlist });
    for (const g of SCAN_GROUPS) groups.push({ title: g.title, assets: g.assets });
    return groups;
  }, [watchlist]);
  const all = options.flatMap((g) => g.assets);
  const asset = all.find((a) => `${a.kind}:${a.symbol}` === key) ?? all[0];
  const plan = asset ? planHistory(asset, interval, days) : null;

  const run = async () => {
    if (!asset || !plan?.ok) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setPhase({ label: "Kurse laden", p: 0 });
      const candles = await loadHistory(plan, interval, days, (p) => setPhase({ label: "Kurse laden", p }));
      if (candles.length < 150) throw new Error(`Zu wenig Kursdaten (${candles.length} Kerzen, mindestens 150 nötig).`);
      setPhase({ label: "Analyst spielt die Vergangenheit durch", p: 0 });
      setCore(null);
      const params = learnedParams(asset.kind, horizon);
      // Gelernte Werte wie in der App (Standardwerte = identisch zur Zielzonen-Erkennung)
      const learned = JSON.stringify(params) !== JSON.stringify(DEFAULT_PARAMS);
      const opts = learned ? { warmup: 200, signalAt: (h: Candle[]) => signalFromAnalysis(h, { kind: asset.kind, horizon: horizon, interval }, params) } : { warmup: 200 };
      const r = await runZoneBacktestAsync(candles, opts, (p) => setPhase({ label: "Zonen-Trades werden durchgespielt", p }));
      const c = candles.length >= 260 ? await runCoreBacktestAsync(candles, {}, (p) => setPhase({ label: "Kernposition (Welle 5 / Boden) wird durchgespielt", p })) : null;
      setCore(c);
      setResult({ ...r, symbol: asset.name, bars: candles.length, from: candles[0].time, to: candles[candles.length - 1].time, note: plan.note, interval });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setPhase(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl text-gold sm:text-3xl">EchoChart</h1>
        <p className="text-sm text-stone-300">Das Echo der Vergangenheit: Wie viel hättest du verdient, wenn du den Signalen des Analysten früher gefolgt wärst?</p>
        <details className="mt-1 text-sm text-stone-400">
          <summary className="cursor-pointer text-gold/80">So funktioniert&apos;s</summary>
          <ol className="mt-2 list-inside list-decimal space-y-1">
            <li>Wert, Kerzengröße und „Wie weit zurück?“ wählen, dann „EchoChart starten“ tippen.</li>
            <li>Die App spielt die vergangenen Kurse Schritt für Schritt durch – der Analyst kennt dabei immer nur, was bis zu diesem Tag passiert war.</li>
            <li>Bei jedem Signal legt der Analyst eine Order in seine Kaufzone (bzw. Verkaufszone). Nur wenn der Kurs dorthin kommt, wird der Übungs-Trade eröffnet und bei Ziel oder Stop geschlossen.</li>
            <li>Am Ende siehst du den Gewinn, die Trefferquote und den Vergleich mit „einfach kaufen und halten“.</li>
          </ol>
          <p className="mt-2 text-xs text-stone-500">Firmenzahlen und Nachrichten von damals fehlen und zählen neutral. Berührt der Kurs Stop und Ziel in derselben Kerze, wird vorsichtig mit dem Stop gerechnet. Gute Ergebnisse von früher sind keine Garantie für die Zukunft.</p>
        </details>
      </div>

      <div className="panel space-y-3 p-3">
        <label className="block text-xs text-stone-400">
          Wert
          <select className="input mt-1" value={asset ? `${asset.kind}:${asset.symbol}` : ""} onChange={(e) => {
              setKey(e.target.value);
              setResult(null);
            }}>
            {options.map((g) => (
              <optgroup key={g.title} label={g.title}>
                {g.assets.map((a) => (
                  <option key={`${g.title}-${a.kind}:${a.symbol}`} value={`${a.kind}:${a.symbol}`}>
                    {a.name} ({a.symbol})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-4">
          <div className="text-xs text-stone-400">
            Zeitraum der Signale
            <div className="mt-1">
              <HorizonToggle
                value={horizon}
                onChange={(h) => {
                  if (!h) return;
                  setResult(null);
                  setHorizon(h);
                  setInterval_(intervals[h]);
                }}
              />
            </div>
          </div>
          <div className="text-xs text-stone-400">
            Kerzengröße
            <div className="mt-1 flex gap-1">
              {HORIZON_INTERVALS[horizon].map((iv) => (
                <button key={iv} onClick={() => { setInterval_(iv); setResult(null); }} className={`chip ${iv === interval ? "border-gold bg-gold/20 text-gold-light" : "border-stone-700 text-stone-400"}`}>
                  {{ "5m": "5 Min", "15m": "15 Min", "1h": "1 Std", "4h": "4 Std", "1d": "1 Tag", "1w": "1 Woche", "1M": "1 Monat" }[iv]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="text-xs text-stone-400">
          Wie weit zurück?
          <div className="mt-1 flex flex-wrap gap-1">
            {LOOKBACKS.map((l) => {
              const ok = asset ? planHistory(asset, interval, l.days).ok : false;
              return (
                <button
                  key={l.days}
                  onClick={() => { setDays(l.days); setResult(null); }}
                  className={`chip ${l.days === days ? "border-gold bg-gold/20 text-gold-light" : ok ? "border-stone-700 text-stone-300" : "border-stone-800 text-stone-600 line-through"}`}
                >
                  {l.label}
                </button>
              );
            })}
          </div>
        </div>
        {plan && !plan.ok && <p className="text-sm text-amber-300">{plan.reason}</p>}
        {plan?.ok && (
          <p className="text-xs text-stone-500">
            ca. {plan.candlesEstimate.toLocaleString("de-DE")} Kerzen · Quelle: {plan.source === "binance" ? "Binance" : "Yahoo Finance"}
            {plan.note ? ` · ${plan.note}` : ""}
          </p>
        )}
        <button className="btn-primary w-full sm:w-auto" disabled={!asset || busy || !plan?.ok} onClick={run}>
          {busy ? "Läuft …" : "EchoChart starten"}
        </button>
        {phase && (
          <div>
            <div className="mb-1 flex justify-between text-xs text-stone-400">
              <span>{phase.label}</span>
              <span>{Math.round(phase.p * 100)} %</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-stone-800">
              <div className="h-full bg-gold transition-all" style={{ width: `${phase.p * 100}%` }} />
            </div>
          </div>
        )}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {result && (
        <p className="text-sm text-stone-300">
          <b className="text-gold-light">{result.symbol}</b> · {fmtDate(result.from)} – {fmtDate(result.to)} · {result.bars.toLocaleString("de-DE")} Kerzen ({result.interval})
          {result.note ? <span className="block text-xs text-stone-500">{result.note}</span> : null}
        </p>
      )}
      {result && (
        <div className="panel space-y-3 p-3">
          <div className="panel-title">Vergleich</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {core ? (
            <Stat
              accent="core"
              label="Kernposition (Welle 5 / Boden)"
              value={`${core.stats.totalReturn >= 0 ? "+" : ""}${core.stats.totalReturn.toFixed(1)} %`}
              tone={core.stats.totalReturn >= 0 ? "up" : "down"}
              hint={`${core.segments.length} Phasen · ${(core.exposure * 100).toFixed(0)} % der Zeit investiert · größter Rückgang ${core.maxDrawdown.toFixed(1)} %`}
            />
            ) : (
              <Stat accent="core" label="Kernposition (Welle 5 / Boden)" value="–" hint="Zu wenig Kerzen – längeren Zeitraum wählen" />
            )}
            <Stat
              accent="trade"
              label="Zonen-Trades"
              value={`${result.stats.totalReturn >= 0 ? "+" : ""}${result.stats.totalReturn.toFixed(1)} %`}
              tone={result.stats.totalReturn >= 0 ? "up" : "down"}
              hint={`${result.trades.length} Trades · Trefferquote ${(result.stats.winRate * 100).toFixed(0)} %`}
            />
            <Stat
              label="Einfach gehalten"
              value={`${(core?.buyAndHold ?? result.buyAndHold) >= 0 ? "+" : ""}${(core?.buyAndHold ?? result.buyAndHold).toFixed(1)} %`}
              hint={core ? `größter Rückgang ${core.holdMaxDrawdown.toFixed(1)} %` : undefined}
            />
          </div>
          {result.trades.length > 0 && result.trades.length < 10 && <p className="text-xs text-amber-300">Weniger als 10 Zonen-Trades – statistisch nicht belastbar.</p>}
          {core && (
          <>
          <div className="text-xs text-stone-400">Kernposition – Gewinnkurve (gestrichelt: einfach gehalten)</div>
          <EquityChart data={core.curve} compare={core.buyAndHold} />
          <details className="text-sm">
            <summary className="cursor-pointer text-sky-300">Alle {core.segments.length} Phasen der Kernposition anzeigen</summary>
            <table className="mt-2 w-full text-xs">
              <tbody>
                {[...core.segments].reverse().map((sg) => (
                  <tr key={sg.entryTime} className="core-row">
                    <td className="px-2 py-1">{new Date(sg.entryTime * 1000).toLocaleDateString("de-DE")} – {new Date(sg.exitTime * 1000).toLocaleDateString("de-DE")}</td>
                    <td className="num px-2 py-1 text-right">{fmtPrice(sg.entry)} → {fmtPrice(sg.exit)}</td>
                    <td className="px-2 py-1">{sg.reason === "welle5" ? "Welle 5 – Gewinn mitgenommen" : sg.reason === "trendbruch" ? "Trendbruch" : "läuft noch"}</td>
                    <td className={`num px-2 py-1 text-right ${sg.returnPct >= 0 ? "text-up" : "text-down"}`}>{`${sg.returnPct >= 0 ? "+" : ""}${sg.returnPct.toFixed(2)} %`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          </>
          )}
          <p className="text-[13px] text-stone-500">
            Kernposition: im Aufwärtstrend halten, nach erkannter 5. Welle Gewinne mitnehmen, nach einem Boden (abgeschlossene Korrektur) wieder einsteigen. „Größter Rückgang“ = stärkster Verlust vom Höchststand zwischendurch.
          </p>
        </div>
      )}

    </div>
  );
}
