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

function describeCount(c: WaveCount): string {
  const hard = c.rules.filter((r) => r.hard);
  const soft = c.rules.filter((r) => !r.hard && !r.passed);
  const dir = c.direction === 1 ? "aufwärts" : "abwärts";
  let s = `${c.patternLabel} (${dir}, Grad ${c.degree}): ${c.phase}. `;
  s += `${hard.length} harte ${hard.length === 1 ? "Regel" : "Regeln"} geprüft, alle erfüllt. Fibo-Passung ${pct(c.fib)}, Wahrscheinlichkeit ca. ${pct(c.probability)}.`;
  if (soft.length) s += ` Schönheitsfehler: ${soft.map((r) => r.name).join("; ")}.`;
  if (c.notes.length) s += ` ${c.notes.join(" ")}`;
  return s;
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

  // --- Überschrift
  let headline: string;
  if (decision.level === "neutral") {
    headline =
      decision.vetoes.length && decision.rawLevel !== "neutral"
        ? pick(seed, [
            `Kein Trade. Die Zahlen locken mit „${SIGNAL_LABEL[decision.rawLevel]}“, aber ich kaufe keine Hoffnung.`,
            `Kein Trade. Ein halbes Setup ist kein Setup – ${decision.vetoes[0]}.`,
          ])
        : pick(seed, [
            "Kein Trade. Das Bild ist unentschieden, und ich zahle nicht für Unklarheit.",
            "Neutral. Geduld ist hier die einzige professionelle Position.",
            "Kein Trade. Wer hier handelt, spielt – ich spiele nicht.",
          ]);
  } else if (decision.level.includes("buy")) {
    headline = pick(seed, [
      `${label}. Struktur, Momentum und Plan stehen – ich gehe long, während die Masse noch zögert.`,
      `${label}. Das ist ein Setup mit Kante. Ich nehme es, mit klarem Stop.`,
      `${label}. Die Wellenstruktur spricht eine deutliche Sprache.`,
    ]);
  } else {
    headline = pick(seed, [
      `${label}. Die Struktur kippt – ich bin auf der Short-Seite oder draußen.`,
      `${label}. Hier verteidige ich Kapital statt Meinungen.`,
      `${label}. Wer jetzt noch blind kauft, ignoriert die Wellen.`,
    ]);
  }

  // --- Elliott
  let ew: string;
  if (!best) ew = "Keine regelkonforme Wellenzählung. Ich erfinde keine Wellen, wo keine sind.";
  else {
    ew = `Primärzählung – ${describeCount(best)}`;
    if (elliott.alternative) ew += ` Alternative – ${describeCount(elliott.alternative)}`;
    if (elliott.contested) ew += " Die Alternative ist fast gleichwertig und zeigt in die Gegenrichtung. Das ist ehrlich gesagt ein Münzwurf.";
    else if (elliott.confidence < 0.35) ew += " Die Zählung ist schwach belegt. Ich nehme sie zur Kenntnis, nicht als Fundament.";
    else if (elliott.confidence > 0.7) ew += " Saubere Struktur – so sieht Lehrbuch aus.";
  }

  // --- Fundamental & News
  const fParts: string[] = [];
  if (fundamental.items.length) {
    const strong = fundamental.items.filter((i) => i.score >= 65).map((i) => `${i.name} ${i.value} (${i.comment})`);
    const weak = fundamental.items.filter((i) => i.score < 45).map((i) => `${i.name} ${i.value} (${i.comment})`);
    fParts.push(`Fundamentalscore ${fundamental.fundamentalScore}.`);
    if (strong.length) fParts.push(`Stärken: ${strong.join(", ")}.`);
    if (weak.length) fParts.push(`Schwächen: ${weak.join(", ")}.`);
  } else fParts.push("Keine verlässlichen Fundamentaldaten verfügbar – dieser Teil zählt neutral.");
  const recent = input.news.slice(0, 3);
  if (fundamental.newsScore != null) {
    const mood = fundamental.newsScore > 58 ? "freundlich" : fundamental.newsScore < 42 ? "belastet" : "gemischt";
    fParts.push(`Nachrichtenlage der letzten 72 h: ${mood} (${fundamental.newsCount} Meldungen, Score ${fundamental.newsScore}).`);
    if (recent.length)
      fParts.push(
        `Relevant: ${recent.map((n) => `„${n.title}“ (${n.source}, ${n.sentiment === "positive" ? "positiv" : n.sentiment === "negative" ? "negativ" : "neutral"})`).join("; ")}.`,
      );
    fParts.push("Schlagzeilen bewegen Kurse kurzfristig – Struktur entscheidet langfristig.");
  } else fParts.push("Keine frischen Nachrichten. Ruhe ist kein Signal.");
  if (fundamental.warnings.length) fParts.push(`Achtung: ${fundamental.warnings.join(" ")}`);

  // --- Volumen & RSI
  const vol = volume.findings.join(" ") || "Keine auswertbaren Volumen-/RSI-Daten.";

  // --- Plan
  let planText: string;
  if (!plan) planText = "Kein belastbarer Plan: Ohne definierten Stop gibt es keinen Trade. Punkt.";
  else {
    planText =
      `${plan.direction === "long" ? "Long" : "Short"} – Einstieg ${fmtPrice(plan.entry)}, Stop-Loss ${fmtPrice(plan.stop)}, ` +
      `Kursziele ${plan.targets.map(fmtPrice).join(" / ")}. Chance-Risiko ${plan.riskReward.toFixed(2)} : 1. ` +
      `Teil-Scores: Elliott ${elliott.score}, Fundamental/News ${fundamental.score}, Volumen/RSI ${volume.score} → Gesamt ${total.toFixed(1)}.`;
    if (plan.riskReward < 1.5) planText += " Das CRV ist mir zu dünn. Mittelmaß handle ich nicht.";
  }

  const invalidation = best
    ? `Invalidierung bei ${fmtPrice(best.stop)}: ${best.bias === 1 ? "Fällt" : "Steigt"} der Kurs ${best.bias === 1 ? "darunter" : "darüber"}, ist die Zählung „${best.patternLabel}“ falsch. Dann bin ich raus – ohne Diskussion, ohne Nachkaufen.`
    : "Ohne Zählung kein Invalidierungslevel – auch deshalb kein Trade.";

  let verdict: string;
  if (decision.level === "neutral") {
    verdict = decision.vetoes.length
      ? `Fazit ${input.horizonLabel}: Kein Trade. Gründe: ${decision.vetoes.join("; ")}. Ich warte auf ein Setup, das meinen Ansprüchen genügt.`
      : `Fazit ${input.horizonLabel}: Neutral (${total.toFixed(1)}). Ich beobachte, ich handle nicht.`;
  } else {
    const conf = elliott.confidence > 0.6 ? "hoher" : "mittlerer";
    verdict = `Fazit ${input.horizonLabel}: ${label} mit ${conf} Überzeugung. Positionsgröße so wählen, dass der Stop schmerzt, aber nicht verletzt. Eigenverantwortung – immer.`;
  }

  return { headline, elliott: ew, fundamental: fParts.join(" "), volume: vol, plan: planText, invalidation, verdict };
}
