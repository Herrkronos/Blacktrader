"use client";
// Übersicht: Gesamtperformance, Top-3-Chancen, offene Trades (live), News zur Watchlist.
import Link from "next/link";
import { useEffect, useMemo } from "react";
import { COLOR_LABEL, signalStrength } from "@/components/AssetCard";
import { useAssetSheet } from "@/components/AssetSheet";
import { EquityChart } from "@/components/EquityChart";
import { IconChevron } from "@/components/Icons";
import { money } from "@/lib/analysis/persona";
import { performance, tradeReturnPct } from "@/lib/analysis/stats";
import { instrumentKey, useMarket } from "@/lib/client/market";
import { bestDistance, runScan, useScan } from "@/lib/client/scanner";
import { useAppData } from "@/lib/store/store";
import { HORIZON_LABEL, type NewsItem } from "@/lib/types";

const signed = (x: number, d = 2) => `${x >= 0 ? "+" : ""}${x.toFixed(d).replace(".", ",")} %`;

function Section({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[18px] text-gold-light">{title}</h2>
        {href && (
          <Link href={href} className="flex min-h-[44px] items-center gap-0.5 px-1 text-[14px] text-stone-400">
            Alle <IconChevron className="h-4 w-4" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export default function Uebersicht() {
  const trades = useAppData((d) => d.trades);
  const watchlist = useAppData((d) => d.watchlist);
  const { live, analyses } = useMarket();
  const scan = useScan();
  const { open, sheet } = useAssetSheet();

  useEffect(() => {
    runScan();
  }, []);

  const closed = trades.filter((t) => t.status === "closed" && t.returnPct != null);
  const stats = performance(closed.map((t) => ({ returnPct: t.returnPct!, closedAt: t.closedAt! })));
  const openTrades = trades.filter((t) => t.status !== "closed");
  const openPerf = openTrades
    .filter((t) => t.status === "open")
    .map((t) => {
      const p = live[instrumentKey(t)]?.price ?? t.lastPrice;
      return p ? tradeReturnPct(t.direction, t.entry, p) : null;
    })
    .filter((x): x is number => x != null);

  const top = useMemo(() => {
    // Je Wert genau ein Einstieg (blau oder grün); zuerst die, deren Kurs schon in der Zone ist, dann das stärkere Signal
    const items = scan.entries.filter((e) => e.best.color !== "gelb").map((e) => ({ e, d: bestDistance(e), s: signalStrength(e.best.res) ?? 0 }));
    return items.sort((a, b) => a.d - b.d || b.s - a.s).slice(0, 3);
  }, [scan.entries]);

  const news = useMemo(() => {
    const all: (NewsItem & { sym: string })[] = [];
    for (const w of watchlist) for (const n of analyses[w.id]?.news ?? []) all.push({ ...n, sym: w.symbol });
    const seen = new Set<string>();
    return all
      .sort((a, b) => b.published.localeCompare(a.published))
      .filter((n) => (seen.has(n.title) ? false : (seen.add(n.title), true)))
      .slice(0, 5);
  }, [watchlist, analyses]);

  return (
    <div className="space-y-6">
      <section className="card p-4">
        <div className="label">Gesamtperformance (abgeschlossene Papier-Trades)</div>
        <div className={`num text-[36px] font-semibold leading-tight ${stats.totalReturn >= 0 ? "text-up" : "text-down"}`}>{signed(stats.totalReturn)}</div>
        <div className="mt-0.5 text-[14px] text-stone-400">
          {stats.trades} abgeschlossen · Trefferquote {(stats.winRate * 100).toFixed(0)} %{openPerf.length ? ` · offene Trades jetzt ${signed(openPerf.reduce((a, b) => a + b, 0) / openPerf.length)}` : ""}
        </div>
        {stats.curve.length > 0 ? (
          <div className="mt-2">
            <EquityChart data={stats.curve} height={90} minimal />
          </div>
        ) : (
          <p className="mt-2 text-[14px] text-stone-500">Sobald du Papier-Trades übernimmst und diese geschlossen werden, erscheint hier deine Kurve.</p>
        )}
      </section>

      <Section title="Top 3 Chancen heute" href="/chancen">
        {scan.busy && top.length === 0 && <div className="card p-4 text-[15px] text-stone-400">Blacktrader sucht Chancen … {Math.round(scan.progress * 100)} %</div>}
        {!scan.busy && top.length === 0 && <div className="card p-4 text-[15px] text-stone-400">Gerade keine sauberen Einstiege.</div>}
        {top.map(({ e, d }) => {
          const { asset, best: b } = e;
          const blue = b.color === "blau";
          return (
            <button key={`${asset.kind}-${asset.symbol}`} onClick={() => open(asset, b.horizon ?? e.ltHorizon ?? "medium")} className={`card w-full p-3.5 text-left ${blue ? "edge-core" : "edge-trade"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[16px] font-semibold text-stone-50">{asset.name}</div>
                  <div className="text-[13px] text-stone-400">{asset.symbol}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={blue ? "badge-core" : "badge-trade"}>
                    {COLOR_LABEL[b.color]}
                    {!blue && signalStrength(b.res) != null ? ` · Stärke ${signalStrength(b.res)!.toFixed(0)}` : ""}
                  </span>
                  <span className={d === 0 ? "text-[13px] text-emerald-300" : "text-[13px] text-amber-300"}>{d === 0 ? "jetzt in der Zone" : `noch ${d.toFixed(1).replace(".", ",")} %`}</span>
                </div>
              </div>
              <div className="num mt-2 grid grid-cols-3 gap-2 text-[14px]">
                <span>
                  <span className="label block">Einstieg</span>
                  {money(b.zoneTop!, asset.currency)}
                </span>
                <span className="text-red-300">
                  <span className="label block">{blue ? "Ungültig unter" : "Stop"}</span>
                  {money((blue ? b.invalidation : b.stop)!, asset.currency)}
                </span>
                <span className="text-emerald-300">
                  <span className="label block">Ziel</span>
                  {b.targets?.[0] != null ? money(b.targets[0], asset.currency) : "–"}
                </span>
              </div>
            </button>
          );
        })}
      </Section>

      <Section title="Offene Trades" href="/journal">
        {openTrades.length === 0 ? (
          <div className="card p-4 text-[15px] text-stone-400">Keine offenen Trades. Übernimm eine Chance mit „Als Papier-Trade übernehmen“.</div>
        ) : (
          <div className="card divide-y divide-white/5">
            {openTrades.slice(0, 6).map((t) => {
              const p = live[instrumentKey(t)]?.price ?? t.lastPrice;
              const r = t.status === "open" && p ? tradeReturnPct(t.direction, t.entry, p) : null;
              const edge = t.strategy === "core" || t.strategy === "longterm" || t.promotedAt ? "edge-core" : t.direction === "long" ? "edge-trade" : "edge-short";
              return (
                <div key={t.id} className={`flex min-h-[56px] items-center justify-between gap-3 rounded-none px-4 py-2.5 ${edge}`}>
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-medium text-stone-100">{t.name}</div>
                    <div className="text-[13px] text-stone-400">
                      {t.promotedAt ? "Blau (hochgestuft)" : t.strategy === "longterm" || t.strategy === "core" ? "Langfristig" : t.direction === "long" ? "Trade" : "Short"} · {HORIZON_LABEL[t.horizon]} · {t.status === "pending" ? "wartet auf Einstieg" : "offen"}
                    </div>
                  </div>
                  <div className={`num text-[18px] font-semibold ${r == null ? "text-amber-300" : r >= 0 ? "text-up" : "text-down"}`}>{r == null ? "wartet" : signed(r)}</div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="News zur Watchlist">
        {news.length === 0 ? (
          <div className="card p-4 text-[15px] text-stone-400">{watchlist.length ? "Noch keine aktuellen Meldungen." : "Füge Werte zur Watchlist hinzu, um hier Meldungen zu sehen."}</div>
        ) : (
          <ul className="card divide-y divide-white/5">
            {news.map((n) => (
              <li key={n.link + n.title}>
                <a href={n.link} target="_blank" rel="noopener noreferrer" className="flex min-h-[56px] gap-3 px-4 py-3 active:bg-white/5">
                  <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${n.sentiment === "positive" ? "bg-emerald-400" : n.sentiment === "negative" ? "bg-red-400" : "bg-stone-500"}`} />
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-[15px] text-stone-100" title={n.originalTitle}>
                      {n.title}
                    </span>
                    <span className="text-[13px] text-stone-500">
                      {n.sym} · {n.source} · {new Date(n.published).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      {n.translated ? " · übersetzt" : n.lang === "en" ? " · EN" : ""}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {sheet}
    </div>
  );
}
