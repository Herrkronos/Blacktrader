// Regelbasierte Texterzeugung im Stil des Black-Ship-Analysten:
// selbstbewusst im Ton, ehrlich in der Sache. Unsichere Setups werden als unsicher benannt.
import type { ElliottResult, WaveCount } from "./elliott";
import type { FundamentalResult } from "./fundamental";
import { SIGNAL_LABEL, type SignalDecision, type TradePlan } from "./score";
import type { VolumeRsiResult } from "./volume";
import type { NewsItem } from "../types";

export interface Commentary {
  /** Kurzfassung in Alltagssprache, z. B. „Einstieg bei 12,50 € · Stop bei 10,00 €“ */
  summary: string;
  /** Ein-Satz-Begründung, z. B. „Einstieg in die Aktie, da sie einen lokalen Boden ausgebildet hat.“ */
  reason: string;
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

const CURRENCY_SIGN: Record<string, string> = { EUR: "€", USD: "$", USDT: "$", USDC: "$", GBP: "£", GBp: "Pence", CHF: "CHF", JPY: "¥" };

/** Preis mit Währungszeichen, z. B. „12,50 €“. */
export function money(x: number, currency?: string): string {
  const sign = currency ? CURRENCY_SIGN[currency] ?? currency : "";
  return sign ? `${fmtPrice(x)} ${sign}` : fmtPrice(x);
}

export type AssetKindNoun = "stock" | "crypto";

/** Einfacher Grund in Alltagssprache aus der besten Wellenzählung. */
export function plainReason(c: WaveCount | undefined, it: string): string {
  if (!c) return `${it} zeigt kein klares Muster`;
  const up = c.bias === 1;
  const n = c.labels.length;
  switch (c.pattern) {
    case "impulse":
      if (!c.complete && n === 2)
        return up
          ? `${it} nach dem Rücksetzer einen lokalen Boden ausgebildet hat – jetzt sollte die stärkste Aufwärtswelle folgen`
          : `${it} nach der Erholung ein lokales Hoch ausgebildet hat – jetzt sollte die stärkste Abwärtswelle folgen`;
      if (!c.complete && n === 3) return up ? `${it} nach dem starken Abverkauf vor einer Erholung steht` : `${it} nach dem starken Anstieg eine Verschnaufpause einlegen dürfte`;
      if (!c.complete && n === 4) return up ? `die Zwischenkorrektur beendet ist und noch eine letzte Aufwärtswelle folgen sollte` : `die Zwischenerholung beendet ist und noch eine letzte Abwärtswelle folgen sollte`;
      return up ? `der Abwärtstrend ausgelaufen ist und ${it} einen Boden ausbildet` : `der Aufwärtstrend ausgelaufen ist – ein Rücksetzer ist jetzt wahrscheinlich`;
    case "ending-diagonal":
      return up ? `sich der Abwärtstrend in einem Keil erschöpft hat – eine Umkehr nach oben ist wahrscheinlich` : `sich der Aufwärtstrend in einem Keil erschöpft hat – eine Umkehr nach unten ist wahrscheinlich`;
    case "leading-diagonal":
      return up ? `nach dem ersten Abwärtsschub eine Gegenbewegung nach oben fällig ist` : `nach dem ersten Aufwärtsschub ein Rücksetzer fällig ist`;
    case "zigzag":
      if (!c.complete) return up ? `nach dem Rücksetzer noch eine weitere Aufwärtsbewegung folgen sollte` : `nach der Erholung noch eine weitere Abwärtsbewegung folgen sollte`;
    // fallthrough
    default:
      if (c.pattern.startsWith("triangle")) return up ? `die Seitwärtsphase beendet ist – ein Ausbruch nach oben wird erwartet` : `die Seitwärtsphase beendet ist – ein Ausbruch nach unten wird erwartet`;
      return up ? `die Korrektur abgeschlossen ist und ${it} einen lokalen Boden ausgebildet hat` : `die Erholung ausgelaufen ist und ${it} ein lokales Hoch ausgebildet hat`;
  }
}

const VETO_PLAIN: [RegExp, string][] = [
  [/Chance-Risiko/, "der mögliche Gewinn steht in keinem guten Verhältnis zum Risiko"],
  [/zu unsicher/, "das Chartbild noch zu unklar ist"],
  [/Alternative/, "der Chart genauso gut in die andere Richtung laufen kann"],
  [/Kein sauberer Plan/, "sich kein sinnvoller Stop festlegen lässt"],
  [/widerspricht/, "sich Chartbild und Gesamtbewertung widersprechen"],
];

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
  kind?: AssetKindNoun;
  currency?: string;
}): Commentary {
  const { symbol, elliott, fundamental, volume, total, decision, plan } = input;
  const seed = `${symbol}${decision.level}`;
  const best = elliott.best;
  const label = SIGNAL_LABEL[decision.level];

  // --- Kurzfassung in Alltagssprache
  const noun = input.kind === "crypto" ? "den Coin" : "die Aktie";
  const it = input.kind === "crypto" ? "der Coin" : "die Aktie";
  const pron = input.kind === "crypto" ? "er" : "sie";
  const cur = input.currency;
  let summary: string;
  let reason: string;
  if (decision.level !== "neutral" && plan) {
    const t = plan.targets.slice(0, 2).map((x) => money(x, cur)).join(" bzw. ");
    summary =
      plan.direction === "long"
        ? `Einstieg bei ${money(plan.entry, cur)} · Stop bei ${money(plan.stop, cur)} · Ziel ${t}`
        : `Short-Einstieg bei ${money(plan.entry, cur)} · Stop bei ${money(plan.stop, cur)} · Ziel ${t}`;
    const why = plainReason(best, pron);
    reason = plan.direction === "long" ? `Einstieg in ${noun}, da ${why}.` : `Ausstieg bzw. Short in ${noun}, da ${why}.`;
  } else {
    summary = "Kein Einstieg";
    const veto = decision.vetoes.map((v) => VETO_PLAIN.find(([re]) => re.test(v))?.[1]).find(Boolean);
    const lean = best ? ` Tendenz: ${best.bias === 1 ? "eher aufwärts" : "eher abwärts"}, weil ${plainReason(best, pron)}.` : "";
    reason = veto ? `Noch nicht einsteigen, da ${veto}.${lean}` : `Abwarten – ${it} zeigt aktuell kein klares Signal.${lean}`;
  }

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

  return { summary, reason, headline, elliott: ew, fundamental: fParts.join(" "), volume: vol, plan: planText, invalidation, verdict };
}
