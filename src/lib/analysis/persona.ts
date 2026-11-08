// Regelbasierte Texterzeugung im Stil des Black-Ship-Analysten:
// selbstbewusst im Ton, ehrlich in der Sache. Unsichere Setups werden als unsicher benannt.
import type { ElliottResult, WaveCount } from "./elliott";
import type { FundamentalResult } from "./fundamental";
import { SIGNAL_LABEL, type SignalDecision, type TradePlan } from "./score";
import type { VolumeRsiResult } from "./volume";
import type { NewsItem } from "../types";

export interface Commentary {
  headline: string;
  elliott: string;
  fundamental: string;
  volume: string;
  plan: string;
  invalidation: string;
  verdict: string;
}

function pick<T>(seed: string, options: T[]): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return options[Math.abs(h) % options.length];
}

export function fmtPrice(x: number): string {
  const abs = Math.abs(x);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 8;
  return x.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

function shortCount(c: WaveCount): string {
  return `${c.patternLabel} ${c.direction === 1 ? "↑" : "↓"} (${c.degree}): ${c.phase} – ${pct(c.probability)}`;
}

export function writeCommentary(input: {
  symbol: string;
  name: string;
  price: number;
  elliott: ElliottResult;
  fundamental: FundamentalResult;
  volume: VolumeRsiResult;
  total: number;
  decision: SignalDecision;
  plan: TradePlan | null;
  news: NewsItem[];
  horizonLabel: string;
}): Commentary {
  const { symbol, elliott, fundamental, volume, total, decision, plan } = input;
  const seed = `${symbol}${decision.level}`;
  const best = elliott.best;
  const label = SIGNAL_LABEL[decision.level];

  // --- Überschrift (kurz)
  let headline: string;
  if (decision.level === "neutral")
    headline =
      decision.vetoes.length && decision.rawLevel !== "neutral"
        ? `Kein Trade – ${decision.vetoes[0]}.`
        : pick(seed, ["Kein Trade. Unklares Bild.", "Neutral. Geduld ist die Position.", "Kein Trade. Ich spiele nicht."]);
  else if (decision.level.includes("buy"))
    headline = pick(seed, [`${label}. Setup mit Kante – long.`, `${label}. Struktur steht, ich gehe long.`]);
  else headline = pick(seed, [`${label}. Die Struktur kippt.`, `${label}. Kapital schützen.`]);

  // --- Elliott (1–2 Sätze)
  let ew = best ? shortCount(best) + "." : "Keine regelkonforme Zählung.";
  if (best && elliott.alternative) ew += ` Alt.: ${elliott.alternative.patternLabel} (${pct(elliott.alternative.probability)}).`;
  if (elliott.contested) ew += " Münzwurf – Alternative fast gleich stark.";
  else if (best && elliott.confidence < 0.35) ew += " Schwach belegt.";

  // --- Fundamental & News (1 Satz)
  const fParts: string[] = [];
  if (fundamental.fundamentalScore != null) {
    const top = [...fundamental.items].sort((a, b) => b.score - a.score);
    const strong = top[0]?.score >= 65 ? `+ ${top[0].name} ${top[0].value}` : "";
    const weak = top[top.length - 1]?.score < 45 ? `− ${top[top.length - 1].name} ${top[top.length - 1].value}` : "";
    fParts.push(`Score ${fundamental.fundamentalScore}${strong || weak ? ` (${[strong, weak].filter(Boolean).join(", ")})` : ""}.`);
  } else fParts.push("Keine Fundamentaldaten (neutral).");
  if (fundamental.newsScore != null) {
    const mood = fundamental.newsScore > 58 ? "freundlich" : fundamental.newsScore < 42 ? "belastet" : "gemischt";
    fParts.push(`News ${mood} (${fundamental.newsCount}).`);
  }
  if (fundamental.warnings.length) fParts.push(fundamental.warnings[0]);

  // --- Volumen & RSI (max. 2 Befunde)
  const vol = volume.findings.slice(0, 2).join(" ") || "Keine Volumen-/RSI-Daten.";

  // --- Plan
  const planText = plan
    ? `${plan.direction === "long" ? "Long" : "Short"} ${fmtPrice(plan.entry)} · Stop ${fmtPrice(plan.stop)} · Ziel ${plan.targets.slice(0, 2).map(fmtPrice).join(" / ")} · CRV ${plan.riskReward.toFixed(2)}`
    : "Kein Plan ohne definierten Stop.";

  const invalidation = best
    ? `${best.bias === 1 ? "Unter" : "Über"} ${fmtPrice(best.stop)} ist die Zählung falsch – dann raus.`
    : "Kein Invalidierungslevel.";

  const verdict =
    decision.level === "neutral"
      ? `${input.horizonLabel}: abwarten (${total.toFixed(0)}/100).`
      : `${input.horizonLabel}: ${label} (${total.toFixed(0)}/100), Konfidenz ${elliott.confidence > 0.6 ? "hoch" : "mittel"}.`;

  return { headline, elliott: ew, fundamental: fParts.join(" "), volume: vol, plan: planText, invalidation, verdict };
}
