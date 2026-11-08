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
  const w = useAppData((d) => d.settings.weights);
  const sum = w.elliott + w.fundamental + w.volume || 1;
  const expert = useAppData((d) => d.settings.expertMode);
  return (
    <div className="panel space-y-3 p-4">
      <div className="flex items-center justify-between">
        <span className="panel-title">Signal</span>
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
            {fmtPrice(a.plan.entry)} {a.plan.orderType === "limit" ? <span className="text-xs text-sky-300">(wartet, bis der Kurs dort ist)</span> : a.plan.orderType === "market" ? <span className="text-xs text-emerald-300">(jetzt in der Zone)</span> : null}
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
      {expert && (
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-gold/80">Details zur Analyse</summary>
        <p className="mt-2 font-display text-sm text-gold-light">{c.headline}</p>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
          {sections.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="pt-0.5 text-[11px] uppercase tracking-wider text-gold/80">{k}</dt>
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
          <div className="text-[11px] uppercase tracking-wider text-stone-400">{title}</div>
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

const SIMPLE_NAMES: Record<string, string> = {
  KGV: "Bewertung (Preis je Gewinn)",
  KUV: "Preis im Verhältnis zum Umsatz",
  KBV: "Preis im Verhältnis zum Firmenwert",
  "EPS-Wachstum": "Gewinnwachstum",
  Umsatzwachstum: "Umsatzwachstum",
  Nettomarge: "Gewinnmarge",
  "Verschuldung (D/E)": "Schulden",
  "Free Cashflow": "Freier Geldzufluss",
  Dividendenrendite: "Dividende",
  Marktkapitalisierung: "Größe",
  "Volumen / Market Cap": "Handelsaktivität",
  "Angebot im Umlauf": "Coins im Umlauf",
  "Entwicklung (Commits 4 W.)": "Aktivität der Entwickler",
};

export function FundamentalsPanel({ a, f }: { a: AnalysisResult; f: Fundamentals | null }) {
  const expert = useAppData((d) => d.settings.expertMode);
  if (!expert) {
    const items = a.fundamental.items;
    const s = a.fundamental.fundamentalScore;
    return (
      <div className="panel p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="panel-title">{f?.kind === "crypto" ? "Kennzahlen" : "Firmenzahlen"}</span>
          {s != null && <span className={`text-xs ${s >= 58 ? "text-up" : s <= 42 ? "text-down" : "text-stone-400"}`}>{s >= 58 ? "eher gut" : s <= 42 ? "eher schwach" : "durchschnittlich"}</span>}
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-stone-400">Keine Zahlen verfügbar.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {items.map((i) => (
              <li key={i.name} className="flex justify-between gap-3">
                <span className="text-stone-300">{SIMPLE_NAMES[i.name] ?? i.name}</span>
                <span className={`text-right ${i.score >= 60 ? "text-up" : i.score < 45 ? "text-down" : "text-stone-300"}`}>{i.comment}</span>
              </li>
            ))}
          </ul>
        )}
        {a.fundamental.warnings.map((w) => (
          <p key={w} className="mt-2 text-xs text-amber-300">
            {w}
          </p>
        ))}
      </div>
    );
  }
  const rows: [string, string][] = !f
    ? []
    : f.kind === "stock"
      ? [
          ["KGV", fmtNum(f.pe)],
          ["KUV", fmtNum(f.ps)],
          ["KBV", fmtNum(f.pb)],
          ["EPS-Wachstum", fmtPct(f.epsGrowth)],
          ["Umsatzwachstum", fmtPct(f.revenueGrowth)],
          ["Nettomarge", fmtPct(f.profitMargin)],
          ["Verschuldung D/E", f.debtToEquity == null ? "–" : `${fmtNum(f.debtToEquity / 100)}×`],
          ["Free Cashflow", f.freeCashflow == null ? "–" : compactNumber(f.freeCashflow)],
          ["Marktkapitalisierung", f.marketCap == null ? "–" : compactNumber(f.marketCap)],
          ["Dividendenrendite", fmtPct(f.dividendYield)],
          ["Nächste Quartalszahlen", f.nextEarnings ? new Date(f.nextEarnings).toLocaleDateString("de-DE") : "–"],
        ]
      : [
          ["Marktkapitalisierung", f.marketCap == null ? "–" : `${compactNumber(f.marketCap)} $`],
          ["Rang", fmtNum(f.marketCapRank, 0)],
          ["Volumen 24h", f.volume24h == null ? "–" : `${compactNumber(f.volume24h)} $`],
          ["Volumen / MCap", f.volume24h && f.marketCap ? fmtPct(f.volume24h / f.marketCap) : "–"],
          ["Umlauf", f.circulatingSupply == null ? "–" : compactNumber(f.circulatingSupply)],
          ["Max. Angebot", f.maxSupply == null ? "unbegrenzt" : compactNumber(f.maxSupply)],
          ["Änderung 7 T / 30 T", `${fmtNum(f.change7d, 1)} % / ${fmtNum(f.change30d, 1)} %`],
          ["Abstand ATH", f.athChangePct == null ? "–" : `${fmtNum(f.athChangePct, 1)} %`],
          ["Commits (4 W.)", fmtNum(f.devCommits4w, 0)],
          ["GitHub-Sterne", fmtNum(f.devStars, 0)],
        ];
  return (
    <div className="panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="panel-title">Fundamentaldaten</span>
        <span className="text-xs text-stone-400">Score {a.fundamental.fundamentalScore ?? "–"}{f ? ` · ${f.source}` : ""}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-stone-400">Nicht verfügbar – zählt neutral (50). Optional: Finnhub-/Alpha-Vantage-Key in den Einstellungen.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-stone-400">{k}</dt>
              <dd className="num text-right text-stone-100">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {a.fundamental.warnings.map((w) => (
        <p key={w} className="mt-2 text-xs text-amber-300">
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
                <a href={n.link} target="_blank" rel="noopener noreferrer" className="text-stone-200 hover:text-gold-light hover:underline">
                  {n.title}
                </a>
                <div className="text-[11px] text-stone-500">
                  {n.source} · {new Date(n.published).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
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
          <div className="mb-1 text-[11px] uppercase tracking-wider text-stone-400">Volume Profile (POC {fmtPrice(v.profile!.poc)})</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 4, right: 8, top: 0, bottom: 0 }} barCategoryGap={1}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="price" width={64} tick={{ fill: "#8f887a", fontSize: 10 }} tickFormatter={(x: number) => fmtPrice(x)} interval={2} />
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
    <div className="panel space-y-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="panel-title">Kernposition</span>
        <span className={`chip ${tone}`}>{title}</span>
      </div>
      <p className="text-sm text-stone-200">{text}</p>
      {core.last && (
        <p className="text-xs text-stone-400">
          Letztes Ereignis: {CORE_EVENT_TEXT[core.last.type]} am {new Date(core.last.time * 1000).toLocaleDateString("de-DE")} bei {money(core.last.price, currency)}.
        </p>
      )}
      <p className="text-[11px] text-stone-500">Kernposition = im Aufwärtstrend halten, nach der 5. Welle Gewinne mitnehmen, nach einem Boden wieder einsteigen. Läuft zusätzlich zu den Zonen-Trades.</p>
    </div>
  );
}
