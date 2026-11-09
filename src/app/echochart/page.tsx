"use client";
// EchoChart: Hätte der Analyst früher richtig gelegen? Einfach gehalten – eine große Zahl, ein Bild, Details zum Aufklappen.
import { useMemo, useState } from "react";
import { ZoneHistoryChart } from "@/components/ZoneHistoryChart";
import { HorizonToggle } from "@/components/ui";
import { runEcho, summarize, type EchoKind, type EchoZone } from "@/lib/analysis/echoZones";
import { fmtPrice } from "@/lib/analysis/persona";
import { INTERVAL_SECONDS, LOOKBACKS, loadHistory, planHistory, YAHOO_MAX_DAYS } from "@/lib/client/history";
import { SCAN_GROUPS } from "@/lib/client/presets";
import { learnedParams } from "@/lib/client/trainerParams";
import { useAppData } from "@/lib/store/store";
import { HORIZON_LABEL, type AssetKind, type Candle, type Horizon, type ResolvedAsset } from "@/lib/types";

const fmtDate = (t: number) => new Date(t * 1000).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
const pct = (x: number) => `${Math.round(x * 100)} %`;
const KIND_TEXT: Record<EchoKind, string> = { trade: "Kauf", short: "Short", core: "Kernposition" };
const KIND_CLS: Record<EchoKind, string> = { trade: "text-emerald-300", short: "text-red-300", core: "text-sky-300" };
const GROUP_KEYS: Record<string, AssetKind> = { "gruppe:stock": "stock", "gruppe:crypto": "crypto", "gruppe:commodity": "commodity" };

interface AssetResult {
  asset: ResolvedAsset;
  zones: EchoZone[];
  candles: Candle[];
  tradeHit: number | null;
  tradeReturn: number | null;
  trades: number;
  error?: string;
}

export default function EchoChartPage() {
  const watchlist = useAppData((d) => d.watchlist);
  const intervals = useAppData((d) => d.settings.intervals);
  const [key, setKey] = useState<string>("");
  const [horizon, setHorizon] = useState<Horizon>("medium");
  const [days, setDays] = useState(365);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ label: string; p: number } | null>(null);
  const [results, setResults] = useState<AssetResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const interval = intervals[horizon];

  const options = useMemo(() => {
    const groups: { title: string; assets: ResolvedAsset[] }[] = [];
    if (watchlist.length) groups.push({ title: "Meine Watchlist", assets: watchlist });
    for (const g of SCAN_GROUPS) groups.push({ title: g.title, assets: g.assets });
    return groups;
  }, [watchlist]);
  const all = options.flatMap((g) => g.assets);
  const groupKind = GROUP_KEYS[key];
  const targets: ResolvedAsset[] = groupKind ? SCAN_GROUPS.find((g) => g.kind === groupKind)!.assets : [all.find((a) => `${a.kind}:${a.symbol}` === key) ?? all[0]].filter(Boolean);
  const label = groupKind ? `Alle ${SCAN_GROUPS.find((g) => g.kind === groupKind)!.title}` : targets[0]?.name ?? "";
  const plan = targets[0] ? planHistory(targets[0], interval, days) : null;

  const reset = () => {
    setResults(null);
    setError(null);
  };

  const run = async () => {
    if (!targets.length || !plan?.ok) return;
    setBusy(true);
    reset();
    const out: AssetResult[] = [];
    for (const [i, a] of targets.entries()) {
      const step = (p: number, what: string) => setProgress({ label: targets.length > 1 ? `${a.name} (${i + 1} von ${targets.length}) – ${what}` : what, p: (i + p) / targets.length });
      try {
        // Vorlauf automatisch dazuladen: der Analyst braucht ca. 200 Kerzen, um die Wellen zu zählen.
        // Gezählt werden danach nur Zonen im gewählten Zeitraum.
        const periodStart = Date.now() / 1000 - days * 86400;
        let loadDays = days + Math.ceil((220 * INTERVAL_SECONDS[interval]) / 86400);
        let pl = planHistory(a, interval, loadDays);
        if (!pl.ok && YAHOO_MAX_DAYS[interval] < loadDays) {
          loadDays = Math.max(days, YAHOO_MAX_DAYS[interval]);
          pl = planHistory(a, interval, loadDays);
        }
        if (!pl.ok) throw new Error(pl.reason);
        step(0, "Kurse laden");
        const candles = await loadHistory(pl, interval, loadDays, (p) => step(p * 0.3, "Kurse laden"));
        if (candles.length < 200)
          throw new Error(
            `Zu kurze Kursgeschichte: ${a.name} hat für „${HORIZON_LABEL[horizon]}“ erst ${candles.length} Kerzen, der Analyst braucht etwa 200, um die Wellen zu zählen. Tipp: einen kürzeren Zeitraum wählen (z. B. Mittelfristig).`,
          );
        const r = await runEcho(candles, { kind: a.kind, horizon, interval, params: learnedParams(a.kind, horizon) }, (p) => step(0.3 + p * 0.7, "Analyst spielt die Vergangenheit durch"));
        const t = r.trades.trades.filter((x) => x.entryTime >= periodStart);
        out.push({
          asset: a,
          zones: r.zones.filter((z) => z.t >= periodStart),
          candles: candles.filter((c) => c.time >= periodStart),
          trades: t.length,
          tradeHit: t.length ? t.filter((x) => x.returnPct > 0).length / t.length : null,
          tradeReturn: t.length ? (t.reduce((e, x) => e * (1 + x.returnPct / 100), 1) - 1) * 100 : null,
        });
      } catch (e) {
        out.push({ asset: a, zones: [], candles: [], trades: 0, tradeHit: null, tradeReturn: null, error: (e as Error).message });
      }
    }
    setResults(out);
    setProgress(null);
    setBusy(false);
    if (out.every((r) => r.error)) setError(out[0]?.error ?? "Keine Daten");
    // Ergebnis still für den Trainer aufbewahren
    const zs = out.flatMap((r) => r.zones.map((z) => ({ symbol: r.asset.symbol, ...z })));
    void fetch("/api/trainer/echo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label, horizon, interval, days, summary: summarize(zs), zones: zs }) }).catch(() => {});
  };

  const allZones = results?.flatMap((r) => r.zones) ?? [];
  const sum = summarize(allZones);
  const single = results && results.length === 1 ? results[0] : null;
  const tradesAll = results?.reduce((s, r) => s + r.trades, 0) ?? 0;
  const tradeHit = results && tradesAll ? results.reduce((s, r) => s + (r.tradeHit ?? 0) * r.trades, 0) / tradesAll : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] text-gold">EchoChart</h1>
        <p className="text-[15px] text-stone-300">Hätte der Analyst früher richtig gelegen? Wähle einen Wert oder eine ganze Gruppe.</p>
      </div>

      <section className="card space-y-3 p-4">
        <select
          className="input"
          value={key || (all[0] ? `${all[0].kind}:${all[0].symbol}` : "")}
          onChange={(e) => {
            setKey(e.target.value);
            reset();
          }}
        >
          <optgroup label="Ganze Gruppe">
            {SCAN_GROUPS.map((g) => (
              <option key={g.kind} value={`gruppe:${g.kind}`}>
                Alle {g.title} ({g.assets.length})
              </option>
            ))}
          </optgroup>
          {options.map((g) => (
            <optgroup key={g.title} label={g.title}>
              {g.assets.map((a) => (
                <option key={`${g.title}-${a.kind}:${a.symbol}`} value={`${a.kind}:${a.symbol}`}>
                  {a.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <div>
          <div className="label mb-1">Zeitraum</div>
          <HorizonToggle
            value={horizon}
            onChange={(h) => {
              if (!h) return;
              setHorizon(h);
              reset();
            }}
          />
        </div>
        <div>
          <div className="label mb-1">Wie weit zurück?</div>
          <div className="flex flex-wrap gap-1.5">
            {LOOKBACKS.map((l) => {
              const ok = targets[0] ? planHistory(targets[0], interval, l.days).ok : false;
              return (
                <button
                  key={l.days}
                  disabled={!ok}
                  onClick={() => {
                    setDays(l.days);
                    reset();
                  }}
                  className={`chip ${l.days === days ? "border-gold bg-gold/20 text-gold-light" : ok ? "border-stone-700 text-stone-300" : "border-stone-800 text-stone-600"}`}
                >
                  {l.label}
                </button>
              );
            })}
          </div>
        </div>
        {plan && !plan.ok && <p className="text-[14px] text-amber-300">{plan.reason}</p>}
        <button className="btn-primary min-h-[48px] w-full" disabled={busy || !plan?.ok} onClick={run}>
          {busy ? "Läuft …" : "Prüfen"}
        </button>
        {progress && (
          <div className="space-y-1">
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${Math.round(progress.p * 100)}%` }} />
            </div>
            <p className="text-[13px] text-stone-400">{progress.label}</p>
          </div>
        )}
      </section>

      {error && <p className="text-[15px] text-red-300">{error}</p>}

      {results && !error && (
        <section className="card space-y-3 p-4">
          <div className="text-center">
            <div className="text-[14px] text-stone-400">
              {label} · {HORIZON_LABEL[horizon]}
            </div>
            <div className={`num text-[44px] font-semibold leading-tight ${sum.rate != null && sum.rate >= 0.7 ? "text-up" : "text-gold"}`}>{sum.rate != null ? pct(sum.rate) : "–"}</div>
            <p className="text-[15px] text-stone-200">{sum.zones ? `Von ${sum.zones} Zonen haben ${sum.held} gehalten.` : "In diesem Zeitraum gab es keine Zone."}</p>
          </div>
          {sum.zones > 0 && (
            <div className="grid grid-cols-3 gap-2 text-center text-[13px]">
              {(["trade", "short", "core"] as EchoKind[]).map((k) => (
                <div key={k} className="rounded-xl bg-white/5 px-1 py-2">
                  <div className={KIND_CLS[k]}>{KIND_TEXT[k]}</div>
                  <div className="num text-stone-200">{sum.byKind[k].zones ? `${sum.byKind[k].held} / ${sum.byKind[k].zones}` : "–"}</div>
                </div>
              ))}
            </div>
          )}
          {single && single.candles.length > 0 && <ZoneHistoryChart candles={single.candles} zones={single.zones} />}
          {tradeHit != null && (
            <p className="text-center text-[13px] text-stone-400">
              Trades bis zum Ziel: {pct(tradeHit)} Treffer{single?.tradeReturn != null ? ` · Ergebnis ${single.tradeReturn >= 0 ? "+" : ""}${single.tradeReturn.toFixed(1).replace(".", ",")} %` : ""}
            </p>
          )}

          {!single && (
            <ul className="divide-y divide-white/5 text-[14px]">
              {[...results]
                .sort((a, b) => (summarize(b.zones).rate ?? -1) - (summarize(a.zones).rate ?? -1))
                .map((r) => {
                  const s = summarize(r.zones);
                  return (
                    <li key={r.asset.symbol} className="flex items-center justify-between gap-2 py-2">
                      <span className="text-stone-200">{r.asset.name}</span>
                      <span className="num text-stone-400">{r.error ? (r.error.startsWith("Zu kurze") ? "zu kurze Kursgeschichte" : "keine Daten") : s.zones ? `${s.held}/${s.zones} · ${pct(s.rate!)}` : "keine Zone"}</span>
                    </li>
                  );
                })}
            </ul>
          )}

          {allZones.length > 0 && (
            <details className="text-[14px]">
              <summary className="cursor-pointer text-gold-light">Alle Zonen anzeigen</summary>
              <ul className="mt-2 divide-y divide-white/5">
                {[...(single ? single.zones.map((z) => ({ z, name: "" })) : results.flatMap((r) => r.zones.map((z) => ({ z, name: r.asset.name }))))]
                  .sort((a, b) => b.z.t - a.z.t)
                  .slice(0, 150)
                  .map(({ z, name }, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="min-w-0">
                        <span className="text-stone-400">{fmtDate(z.t)}</span> <span className={KIND_CLS[z.kind]}>{KIND_TEXT[z.kind]}</span>
                        {name && <span className="text-stone-400"> · {name}</span>}
                        <span className="num block text-[13px] text-stone-500">
                          {fmtPrice(z.top)} – {fmtPrice(z.bottom)}
                        </span>
                      </span>
                      <span className={`shrink-0 font-semibold ${z.ok ? "text-up" : "text-down"}`}>{z.ok ? "✓ gehalten" : "✗ gescheitert"}</span>
                    </li>
                  ))}
              </ul>
            </details>
          )}

          <details className="text-[13px] text-stone-400">
            <summary className="cursor-pointer">Wie wird gezählt?</summary>
            <p className="mt-1">
              Wie bei HKCM: Eine Zone hat gehalten, wenn der Kurs hineinläuft, vor der Unterkante dreht und oben wieder herausläuft (bei Short umgekehrt). Fällt er vorher unter die Unterkante, ist sie gescheitert. Zonen, die der Kurs nie erreicht hat, zählen nicht. Der Analyst kennt dabei immer nur die Kurse bis zum jeweiligen Tag. Gute Ergebnisse von früher sind keine Garantie für die Zukunft.
            </p>
          </details>
        </section>
      )}
    </div>
  );
}
