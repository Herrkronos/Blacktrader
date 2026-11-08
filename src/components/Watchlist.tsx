"use client";
import Link from "next/link";
import { fmtPrice } from "@/lib/analysis/persona";
import { instrumentKey, itemHorizon, useMarket } from "@/lib/client/market";
import { actions, useAppData } from "@/lib/store/store";
import { HorizonToggle, ScoreBar, SignalBadge, StatusDot, Change } from "./ui";

export function Watchlist() {
  const watchlist = useAppData((d) => d.watchlist);
  const global = useAppData((d) => d.settings.globalHorizon);
  const intervals = useAppData((d) => d.settings.intervals);
  const { live, analyses } = useMarket();

  if (watchlist.length === 0)
    return (
      <div className="panel p-6 text-center text-sm text-stone-400">
        <p className="font-display text-gold">Die Watchlist ist leer.</p>
        <p className="mt-2">Füge eine ISIN oder ein Symbol hinzu – z. B. <b>US0378331005</b> (Apple), <b>SAP.DE</b>, <b>BTC</b> oder <b>ETH</b>.</p>
      </div>
    );

  return (
    <div className="panel overflow-hidden">
      {/* Mobile: Karten */}
      <ul className="divide-y divide-gold/10 md:hidden">
        {watchlist.map((w) => {
          const lv = live[instrumentKey(w)];
          const a = analyses[w.id];
          const h = itemHorizon(w, global);
          return (
            <li key={w.id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/analyse?id=${w.id}`} className="min-w-0">
                  <div className="font-semibold text-gold-light">{w.symbol}</div>
                  <div className="truncate text-xs text-stone-400">{w.name}</div>
                </Link>
                <div className="text-right">
                  <div className="num text-stone-100">{lv?.price != null ? fmtPrice(lv.price) : "–"}</div>
                  <div className="text-xs">
                    <Change value={lv?.changePct} />
                  </div>
                </div>
              </div>
              {a?.result && a.result.decision.level !== "neutral" && (
                <p className={`mt-2 rounded-md border px-2 py-1 text-sm font-medium ${a.result.plan?.direction === "short" ? "sell-bg text-red-100" : "trade-bg text-emerald-100"}`}>{a.result.commentary.summary}</p>
              )}
              {a?.core && (
                <p className={`mt-2 rounded-md border px-2 py-1 text-xs ${a.core.state === "hold" ? "core-bg text-sky-100" : "border-stone-700 text-stone-400"}`}>
                  Kernposition: {a.core.state === "hold" ? "Halten" : a.core.state === "wait-bottom" ? "Gewinne mitgenommen – warten auf Boden" : "nicht investiert"}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <SignalBadge level={a?.result?.decision.level} small />
                <div className="w-24">
                  <ScoreBar value={a?.result?.total ?? 50} />
                </div>
                <StatusDot status={lv?.status} title={lv?.error ?? lv?.source} />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <HorizonToggle size="sm" allowDefault value={w.horizon} onChange={(v) => actions.setItemHorizon(w.id, v)} />
                <span className="text-[11px] text-stone-500">{intervals[h]}</span>
                <button onClick={() => actions.removeWatch(w.id)} className="text-xs text-stone-500 hover:text-red-400" aria-label="Entfernen">
                  Entfernen
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {/* Desktop: Tabelle */}
      <table className="hidden w-full text-sm md:table">
        <thead className="border-b border-gold/20 text-left text-[11px] uppercase tracking-wider text-stone-400">
          <tr>
            <th className="px-4 py-3">Wert</th>
            <th className="px-2 py-3 text-right">Kurs</th>
            <th className="px-2 py-3 text-right">Tag</th>
            <th className="px-2 py-3">Signal</th>
            <th className="px-2 py-3">Score</th>
            <th className="px-2 py-3">Horizont</th>
            <th className="px-2 py-3">Status</th>
            <th className="px-2 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gold/10">
          {watchlist.map((w) => {
            const lv = live[instrumentKey(w)];
            const a = analyses[w.id];
            const h = itemHorizon(w, global);
            return (
              <tr key={w.id} className="hover:bg-gold/5">
                <td className="px-4 py-2.5">
                  <Link href={`/analyse?id=${w.id}`} className="group block">
                    <div className="font-semibold text-gold-light group-hover:underline">{w.symbol}</div>
                    <div className="max-w-[260px] truncate text-xs text-stone-400">
                      {w.name}
                      {w.isin ? ` · ${w.isin}` : ""}
                    </div>
                    {a?.core && (
                      <div className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[11px] ${a.core.state === "hold" ? "core-tag" : "text-stone-400"}`}>
                        Kern: {a.core.state === "hold" ? "Halten" : a.core.state === "wait-bottom" ? "Gewinne mitgenommen, warten auf Boden" : "nicht investiert"}
                      </div>
                    )}
                    {a?.result && a.result.decision.level !== "neutral" && (
                      <div className={`mt-1 max-w-[340px] rounded px-1.5 py-0.5 text-xs ${a.result.plan?.direction === "short" ? "sell-tag" : "trade-tag"}`}>{a.result.commentary.summary}</div>
                    )}
                  </Link>
                </td>
                <td className="num px-2 py-2.5 text-right text-stone-100">{lv?.price != null ? fmtPrice(lv.price) : "–"}</td>
                <td className="px-2 py-2.5 text-right">
                  <Change value={lv?.changePct} />
                </td>
                <td className="px-2 py-2.5">
                  {a?.loading && !a.result ? <span className="text-xs text-stone-500">analysiere …</span> : a?.error && !a.result ? <span className="text-xs text-red-400" title={a.error}>Fehler</span> : <SignalBadge level={a?.result?.decision.level} />}
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="num w-8 text-right text-stone-200">{a?.result ? Math.round(a.result.total) : "–"}</span>
                    <div className="w-20">
                      <ScoreBar value={a?.result?.total ?? 50} />
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex items-center gap-2">
                    <HorizonToggle size="sm" allowDefault value={w.horizon} onChange={(v) => actions.setItemHorizon(w.id, v)} />
                    <span className="text-[11px] text-stone-500">{intervals[h]}</span>
                  </div>
                </td>
                <td className="px-2 py-2.5">
                  <StatusDot status={lv?.status} title={lv?.error ?? lv?.source} />
                </td>
                <td className="px-2 py-2.5 text-right">
                  <button onClick={() => actions.removeWatch(w.id)} className="text-stone-500 hover:text-red-400" aria-label="Entfernen" title="Entfernen">
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
