"use client";
import { useState } from "react";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AnalysisResult } from "@/lib/analysis/analyze";
import type { WaveCount } from "@/lib/analysis/elliott";
import { compactNumber } from "@/lib/analysis/fundamental";
import { fmtPrice, money } from "@/lib/analysis/persona";
import type { CoreStatus } from "@/lib/analysis/core";
import { SIGNAL_LABEL } from "@/lib/analysis/score";
import { api } from "@/lib/client/api";
import { useAppData } from "@/lib/store/store";
import type { Fundamentals, NewsItem } from "@/lib/types";
import { ScoreBar, SignalBadge } from "./ui";

export function SignalCard({ a, onTrade }: { a: AnalysisResult; onTrade: () => void }) {
  const w = a.weights;
  const sum = w.elliott + w.fundamental + w.volume || 1;
  const expert = useAppData((d) => d.settings.expertMode);
  return (
    <div className={`panel space-y-3 p-4 ${a.plan && a.decision.level !== "neutral" ? (a.plan.direction === "short" ? "sell-bg" : "trade-bg") : ""}`}>
      <div className="flex items-center justify-between">
        <span className="panel-title">
          Signal{" "}
          {a.plan?.direction === "short" && a.decision.level !== "neutral" ? (
            <span className="sell-tag ml-1 align-middle">Verkauf</span>
          ) : (
            <span className="trade-tag ml-1 align-middle">Kauf</span>
          )}
        </span>
        <SignalBadge level={a.decision.level} />
      </div>
      <div className="flex items-end gap-2">
        <span className="num font-display text-4xl text-gold-light">{a.total.toFixed(0)}</span>
        <span className="pb-1 text-sm text-stone-400">/ 100 {expert ? "Gesamtscore" : "Punkte (über 50 = eher steigend)"}</span>
      </div>
      <ScoreBar value={a.elliott.score} label={expert ? `Elliott (${Math.round((w.elliott / sum) * 100)} %)` : "Chartbild"} />
      <ScoreBar value={a.fundamental.score} label={expert ? `Fundamental/News (${Math.round((w.fundamental / sum) * 100)} %)` : "Firmenzahlen & Nachrichten"} />
      <ScoreBar value={a.volume.score} label={expert ? `Volumen/RSI (${Math.round((w.volume / sum) * 100)} %)` : "Kaufinteresse"} />
      {expert && a.decision.vetoes.length > 0 && (
        <div className="rounded-lg border border-gold/20 bg-black/40 p-2 text-xs text-stone-300">
          Roh-Signal „{SIGNAL_LABEL[a.decision.rawLevel]}“ neutralisiert: {a.decision.vetoes.join("; ")}.
        </div>
      )}
      {a.plan && (expert || a.decision.level !== "neutral") ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt className="text-stone-400">Richtung</dt>
          <dd className={a.plan.direction === "long" ? "text-up" : "text-down"}>{a.plan.direction === "long" ? "Auf steigende Kurse" : "Auf fallende Kurse"}</dd>
          {a.plan.zoneStart != null && (
            <>
              <dt className="text-stone-400">{a.plan.direction === "long" ? "Kaufzone" : "Verkaufszone"}</dt>
              <dd className="num">
                {fmtPrice(a.plan.zoneStart)} – {fmtPrice(a.plan.zoneEnd!)}
              </dd>
            </>
          )}
          <dt className="text-stone-400">Einstieg</dt>
          <dd className="num">
            {fmtPrice(a.plan.entry)} {a.plan.orderType === "limit" ? <span className="text-xs text-amber-300">(wartet, bis der Kurs dort ist)</span> : a.plan.orderType === "market" ? <span className="text-xs text-emerald-300">(jetzt in der Zone)</span> : null}
          </dd>
          <dt className="text-stone-400">{expert ? "Stop-Loss" : "Stop (Verlustgrenze)"}</dt>
          <dd className="num text-down">{fmtPrice(a.plan.stop)}</dd>
          <dt className="text-stone-400">Kursziele</dt>
          <dd className="num text-up">{a.plan.targets.map(fmtPrice).join(" / ")}</dd>
          <dt className="text-stone-400">{expert ? "CRV" : "Chance : Risiko"}</dt>
          <dd className={`num ${a.plan.riskReward >= 1.5 ? "text-up" : "text-down"}`}>{a.plan.riskReward.toFixed(2)} : 1</dd>
        </dl>
      ) : (
        <p className="text-sm text-stone-400">Aktuell kein Einstieg geplant.</p>
      )}
      {a.plan && a.decision.level !== "neutral" ? (
        <button className="btn-primary w-full" onClick={onTrade}>
          {a.plan.orderType === "limit" ? "Order in die Zone legen (Papier-Trade)" : "Als Papier-Trade übernehmen"}
        </button>
      ) : (
        <p className="rounded-lg border border-stone-700 p-2 text-center text-xs text-stone-400">Kein Einstieg – kein Trade möglich.</p>
      )}
    </div>
  );
}

export function Commentary({ a, item }: { a: AnalysisResult; item: { symbol: string; name: string } }) {
  const hasKey = useAppData((d) => !!d.settings.keys.llm);
  const expert = useAppData((d) => d.settings.expertMode);
  const [llm, setLlm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const c = a.commentary;
  const sections: [string, string][] = [
    ["Wellen", c.elliott],
    ["Fundamental", c.fundamental],
    ["Volumen/RSI", c.volume],
    ["Plan", c.plan],
    ["Invalidierung", c.invalidation],
  ];
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const facts = [`Wert: ${item.name} (${item.symbol})`, `Signal: ${SIGNAL_LABEL[a.decision.level]}`, `Kurzfassung: ${c.summary}`, `Grund: ${c.reason}`, ...sections.map(([k, v]) => `${k}: ${v}`), `Fazit: ${c.verdict}`].join("\n");
      setLlm(await api.llm(facts));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel space-y-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="panel-title">Begründung</span>
        {hasKey && (
          <button className="btn text-xs" onClick={run} disabled={busy}>
            {busy ? "formuliert …" : "Mit LLM ausformulieren"}
          </button>
        )}
      </div>
      <p className={`text-lg font-semibold leading-snug ${a.decision.level === "neutral" ? "text-stone-200" : a.plan?.direction === "short" ? "text-red-300" : "text-emerald-300"}`}>{c.summary}</p>
      <p className="text-base leading-relaxed text-stone-100">{c.reason}</p>
      {llm && <div className="whitespace-pre-wrap text-sm leading-relaxed text-stone-300">{llm}</div>}
      {c.risk && <p className="text-sm text-stone-300">{c.risk}</p>}
      {(
      <details className="text-sm" open={expert}>
        <summary className="cursor-pointer text-xs text-gold/80">Details zur Analyse</summary>
        <p className="mt-2 font-display text-sm text-gold-light">{c.headline}</p>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
          {sections.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="pt-0.5 text-[13px] text-gold/80">{k}</dt>
              <dd className="text-stone-300">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs italic text-stone-400">{c.verdict}</p>
      </details>
      )}
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}

function CountBlock({ c, title }: { c: WaveCount; title: string }) {
  return (
    <div className="rounded-lg border border-gold/15 bg-black/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[13px] text-stone-400">{title}</div>
          <div className="font-semibold text-gold-light">{c.patternLabel}</div>
        </div>
        <div className="text-right text-xs text-stone-400">
          <div>Wahrscheinlichkeit <span className="num text-stone-100">{Math.round(c.probability * 100)} %</span></div>
          <div>Fibo-Passung <span className="num text-stone-100">{Math.round(c.fib * 100)} %</span> · Grad {c.degree}</div>
        </div>
      </div>
      <p className="mt-1 text-sm text-stone-300">{c.phase}</p>
      <p className="mt-1 text-xs text-stone-400">Wellen: {c.labels.join(" – ")} · {c.direction === 1 ? "aufwärts" : "abwärts"}{c.extension ? ` · Extension W${c.extension}` : ""}</p>
      <ul className="mt-2 space-y-0.5 text-xs">
        {c.rules.map((r) => (
          <li key={r.name} className={r.passed ? "text-emerald-300" : "text-amber-300"}>
            {r.passed ? "✓" : "!"} {r.name} {r.hard ? "" : "(Richtlinie)"}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-1">
        {c.levels.map((l) => (
          <span key={l.label + l.price} className={`chip ${l.kind === "invalidation" ? "border-wine-light/50 text-red-300" : l.kind === "target" ? "border-gold/40 text-gold-light" : "border-stone-600 text-stone-400"}`}>
            {l.label}: {fmtPrice(l.price)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function WavePanel({ a }: { a: AnalysisResult }) {
  const { best, alternative, counts } = a.elliott;
  return (
    <div className="panel space-y-3 p-4">
      <div className="flex items-center justify-between">
        <span className="panel-title">Elliott-Wellen</span>
        <span className="text-xs text-stone-400">Score {a.elliott.score} · Konfidenz {Math.round(a.elliott.confidence * 100)} %</span>
      </div>
      {!best && <p className="text-sm text-stone-400">Keine regelkonforme Zählung gefunden.</p>}
      {best && <CountBlock c={best} title="Primärzählung" />}
      {alternative && <CountBlock c={alternative} title="Alternative" />}
      {a.elliott.contested && <p className="text-xs text-amber-300">Achtung: Primär- und Alternativzählung zeigen in entgegengesetzte Richtungen und sind fast gleichwertig.</p>}
      {counts.length > 2 && (
        <details className="text-xs text-stone-400">
          <summary className="cursor-pointer text-gold/80">Weitere {counts.length - 2} geprüfte Zählungen</summary>
          <table className="mt-2 w-full">
            <tbody>
              {counts.slice(2).map((c) => (
                <tr key={c.id} className="border-t border-gold/10">
                  <td className="py-1">{c.patternLabel}</td>
                  <td>{c.labels.join("-")}</td>
                  <td>{c.degree}</td>
                  <td className={c.bias === 1 ? "text-up" : "text-down"}>{c.bias === 1 ? "↑" : "↓"}</td>
                  <td className="num text-right">{Math.round(c.probability * 100)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

const fmtPct = (x?: number) => (x == null ? "–" : `${(x * 100).toFixed(1)} %`);
const fmtNum = (x?: number, d = 2) => (x == null ? "–" : x.toLocaleString("de-DE", { maximumFractionDigits: d }));

const fmtPctF = (x?: number) => (x == null ? null : `${(x * 100).toFixed(1).replace(".", ",")} %`);
const fmtNumF = (x?: number, d = 2) => (x == null ? null : x.toLocaleString("de-DE", { maximumFractionDigits: d }));

/** Fundamentalzahlen: immer echte Werte mit kurzer Einordnung; ohne Daten sichtbarer Grund. */
export function FundamentalsPanel({ a, f, note, kind }: { a: AnalysisResult; f: Fundamentals | null; note?: string; kind?: string }) {
  if (kind === "commodity")
    return (
      <div className="card p-4">
        <div className="panel-title mb-1">Fundamentalzahlen</div>
        <p className="text-[15px] text-stone-400">Rohstoffe haben keine Firmenzahlen – bewertet werden Chartbild, Nachrichten und Kaufinteresse.</p>
      </div>
    );
  const comment = (name: string) => a.fundamental.items.find((i) => i.name === name);
  const rows: [string, string | null, string?][] = !f
    ? []
    : f.kind === "stock"
      ? [
          ["KGV (Preis je Gewinn)", fmtNumF(f.pe), "KGV"],
          ["KUV (Preis je Umsatz)", fmtNumF(f.ps), "KUV"],
          ["KBV (Preis je Buchwert)", fmtNumF(f.pb), "KBV"],
          ["Gewinnwachstum", fmtPctF(f.epsGrowth), "EPS-Wachstum"],
          ["Umsatzwachstum", fmtPctF(f.revenueGrowth), "Umsatzwachstum"],
          ["Gewinnmarge", fmtPctF(f.profitMargin), "Nettomarge"],
          ["Verschuldung (Schulden/Eigenkapital)", f.debtToEquity == null ? null : `${fmtNumF(f.debtToEquity / 100)}×`, "Verschuldung (D/E)"],
          ["Freier Geldzufluss", f.freeCashflow == null ? null : compactNumber(f.freeCashflow), "Free Cashflow"],
          ["Dividendenrendite", fmtPctF(f.dividendYield), "Dividendenrendite"],
          ["Marktkapitalisierung", f.marketCap == null ? null : compactNumber(f.marketCap)],
          ["Nächste Quartalszahlen", f.nextEarnings ? new Date(f.nextEarnings).toLocaleDateString("de-DE") : null],
        ]
      : [
          ["Marktkapitalisierung", f.marketCap == null ? null : `${compactNumber(f.marketCap)} $`, "Marktkapitalisierung"],
          ["Rang", fmtNumF(f.marketCapRank, 0)],
          ["Handelsvolumen 24 h", f.volume24h == null ? null : `${compactNumber(f.volume24h)} $`, "Volumen / Market Cap"],
          ["Coins im Umlauf", f.circulatingSupply == null ? null : compactNumber(f.circulatingSupply), "Angebot im Umlauf"],
          ["Maximale Menge", f.maxSupply == null ? "unbegrenzt" : compactNumber(f.maxSupply)],
          ["Entwickler-Aktivität (Commits 4 Wochen)", fmtNumF(f.devCommits4w, 0), "Entwicklung (Commits 4 W.)"],
          ["Abstand zum Höchststand", f.athChangePct == null ? null : `${fmtNumF(f.athChangePct, 1)} %`],
        ];
  const shown = rows.filter(([, v]) => v != null);
  const s = a.fundamental.fundamentalScore;
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="panel-title">{f?.kind === "crypto" || kind === "crypto" ? "Kennzahlen" : "Fundamentalzahlen"}</span>
        {s != null && <span className={`text-[13px] ${s >= 58 ? "text-up" : s <= 42 ? "text-down" : "text-stone-400"}`}>{s >= 58 ? "eher gut" : s <= 42 ? "eher schwach" : "durchschnittlich"} ({s})</span>}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-xl bg-white/5 p-3 text-[15px] text-stone-300">
          Keine Daten verfügbar – Grund: {note ?? (f ? "Die Quelle hat keine Kennzahlen zu diesem Wert geliefert." : "Die Datenquelle hat nicht geantwortet.")}
          <span className="mt-1 block text-[13px] text-stone-500">Tipp: Ein kostenloser Finnhub-Schlüssel (Mehr → Einstellungen) liefert Zahlen für US-Aktien zuverlässiger.</span>
        </p>
      ) : (
        <ul className="divide-y divide-white/5">
          {shown.map(([label, value, key]) => {
            const c = key ? comment(key) : undefined;
            return (
              <li key={label} className="flex items-baseline justify-between gap-3 py-2">
                <span className="text-[15px] text-stone-300">{label}</span>
                <span className="text-right">
                  <span className="num text-[16px] font-semibold text-stone-50">{value}</span>
                  {c && <span className={`block text-[13px] ${c.score >= 60 ? "text-up" : c.score < 45 ? "text-down" : "text-stone-400"}`}>{c.comment}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {f && <p className="mt-2 text-[13px] text-stone-500">Quelle: {f.source}</p>}
      {a.fundamental.warnings.map((w) => (
        <p key={w} className="mt-2 text-[14px] text-amber-300">
          {w}
        </p>
      ))}
    </div>
  );
}

export function NewsPanel({ news, score }: { news: NewsItem[]; score: number | null }) {
  return (
    <div className="panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="panel-title">Nachrichten (3 Tage)</span>
        <span className="text-xs text-stone-400">Stimmung: {score == null ? "–" : score > 58 ? "positiv" : score < 42 ? "negativ" : "gemischt"}</span>
      </div>
      {news.length === 0 ? (
        <p className="text-sm text-stone-400">Keine aktuellen Meldungen gefunden.</p>
      ) : (
        <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {news.slice(0, 15).map((n) => (
            <li key={n.link + n.title} className="flex gap-2 text-sm">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.sentiment === "positive" ? "bg-emerald-400" : n.sentiment === "negative" ? "bg-red-500" : "bg-stone-500"}`} title={n.sentiment} />
              <div className="min-w-0">
                <a href={n.link} target="_blank" rel="noopener noreferrer" className="block min-h-[44px] py-1 text-[15px] text-stone-200 hover:text-gold-light">
                  {n.title}
                </a>
                {n.translated && n.originalTitle && <div className="text-[13px] italic text-stone-500">Original: {n.originalTitle}</div>}
                <div className="text-[13px] text-stone-500">
                  {n.source} · {new Date(n.published).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
                  {n.translated ? " · übersetzt" : n.lang === "en" ? " · EN" : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function VolumePanel({ a }: { a: AnalysisResult }) {
  const v = a.volume;
  const data = v.profile?.bins.map((b) => ({ price: (b.low + b.high) / 2, share: +(b.share * 100).toFixed(2), hvn: v.profile!.highVolumeZones.some((z) => b.low >= z.low - 1e-9 && b.high <= z.high + 1e-9) })).reverse() ?? [];
  return (
    <div className="panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="panel-title">Volumen & RSI</span>
        <span className="text-xs text-stone-400">Score {v.score}</span>
      </div>
      <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-black/40 p-2">
          <div className="text-stone-400">RSI(14)</div>
          <div className={`num text-base ${v.rsiState === "überkauft" ? "text-down" : v.rsiState === "überverkauft" ? "text-up" : "text-stone-100"}`}>{v.rsi?.toFixed(1) ?? "–"}</div>
        </div>
        <div className="rounded-lg bg-black/40 p-2">
          <div className="text-stone-400">Rel. Volumen</div>
          <div className="num text-base text-stone-100">{v.relVolume ? `${v.relVolume.toFixed(2)}×` : "–"}</div>
        </div>
        <div className="rounded-lg bg-black/40 p-2">
          <div className="text-stone-400">OBV-Trend</div>
          <div className={`text-base ${v.obvTrend > 0 ? "text-up" : v.obvTrend < 0 ? "text-down" : "text-stone-300"}`}>{v.obvTrend > 0 ? "steigend" : v.obvTrend < 0 ? "fallend" : "flach"}</div>
        </div>
      </div>
      <ul className="mb-3 space-y-1 text-sm text-stone-300">
        {v.findings.map((f) => (
          <li key={f}>· {f}</li>
        ))}
      </ul>
      {data.length > 0 && (
        <>
          <div className="mb-1 text-[13px] text-stone-400">Volume Profile (POC {fmtPrice(v.profile!.poc)})</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 4, right: 8, top: 0, bottom: 0 }} barCategoryGap={1}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="price" width={64} tick={{ fill: "#8f887a", fontSize: 13 }} tickFormatter={(x: number) => fmtPrice(x)} interval={2} />
                <Tooltip cursor={{ fill: "rgba(201,162,74,0.08)" }} contentStyle={{ background: "#0b0b0b", border: "1px solid rgba(201,162,74,0.3)", fontSize: 12 }} formatter={(x) => [`${x} %`, "Volumenanteil"]} labelFormatter={(l) => fmtPrice(Number(l))} />
                <ReferenceLine y={data.reduce((best, d) => (d.share > best.share ? d : best), data[0]).price} stroke="#C9A24A" strokeDasharray="3 3" />
                <Bar dataKey="share" isAnimationActive={false}>
                  {data.map((d) => (
                    <Cell key={d.price} fill={d.hvn ? "#C9A24A" : "rgba(201,162,74,0.35)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

const CORE_EVENT_TEXT: Record<string, string> = {
  einstieg: "Aufwärtstrend bestätigt – eingestiegen",
  welle5: "Welle 5 beendet – Gewinne mitgenommen",
  trendbruch: "Aufwärtstrend gebrochen – verkauft",
  boden: "Boden gefunden – wieder eingestiegen",
  "neues-hoch": "Neues Hoch – wieder eingestiegen",
};

export function CoreCard({ core, currency }: { core: CoreStatus | null | undefined; currency?: string }) {
  if (!core) return null;
  const title =
    core.state === "hold" ? "Halten" : core.state === "wait-bottom" ? "Gewinne mitgenommen – warten auf Boden" : "Nicht investiert – kein Aufwärtstrend";
  const text =
    core.state === "hold"
      ? "Der große Aufwärtstrend läuft und die 5. Welle ist noch nicht beendet. Die Kernposition wird gehalten."
      : core.state === "wait-bottom"
        ? `Der Analyst hat das Ende der 5. Welle erkannt${core.wave5Top ? ` (Hoch bei ${money(core.wave5Top, currency)})` : ""}. Wieder eingestiegen wird, sobald nach der Korrektur ein Boden gefunden ist${core.wave5Top ? ` oder der Kurs über ${money(core.wave5Top, currency)} steigt` : ""}.`
        : "Gekauft wird erst wieder, wenn der große Trend nach oben dreht.";
  const tone = core.state === "hold" ? "border-emerald-500/40 text-emerald-300" : core.state === "wait-bottom" ? "border-sky-500/40 text-sky-300" : "border-stone-600 text-stone-300";
  return (
    <div className={`panel space-y-2 p-4 ${core.state === "hold" ? "core-bg" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="panel-title">
          Kernposition <span className="core-tag ml-1 align-middle">langfristig</span>
        </span>
        <span className={`chip ${tone}`}>{title}</span>
      </div>
      <p className="text-sm text-stone-200">{text}</p>
      {core.last && (
        <p className="text-xs text-stone-400">
          Letztes Ereignis: {CORE_EVENT_TEXT[core.last.type]} am {new Date(core.last.time * 1000).toLocaleDateString("de-DE")} bei {money(core.last.price, currency)}.
        </p>
      )}
      <p className="text-[13px] text-stone-500">Kernposition = im Aufwärtstrend halten, nach der 5. Welle Gewinne mitnehmen, nach einem Boden wieder einsteigen. Läuft zusätzlich zu den Zonen-Trades.</p>
    </div>
  );
}
