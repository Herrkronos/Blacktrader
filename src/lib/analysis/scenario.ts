// EIN Szenario pro Wert (statt drei getrennter Zeiträume), im Stil professioneller Elliott-Dienste:
// Die übergeordnete Wellenzählung (Monat/Woche) bestimmt die Richtung, die untergeordneten Zeiteinheiten
// (Tag/4h/1h) liefern Einstieg, Stop und Timing. Widersprechen sich die Zeiteinheiten → "Warten".
// Wichtig: Einstieg, Stop und Ziele kommen UNVERÄNDERT aus der bestehenden Analyse (analyze/zones) bzw. dem
// Langfrist-Bereich (longterm). Das Szenario wählt nur aus und filtert – es macht Einstiege nie leichter.
import type { Candle, Fundamentals, Horizon, Interval, NewsItem } from "../types";
import { analyze, type AnalysisResult } from "./analyze";
import { findLongTermZone, type LongTermZone } from "./longterm";
import type { LearnableParams, WeightSet } from "./params";
import type { TradePlan } from "./score";

export type ScenarioKind = "core" | "trade" | "short" | "wait";
export type TF = "1M" | "1w" | "1d" | "4h" | "1h";

export const TF_LABEL: Record<TF, string> = { "1M": "Monatschart", "1w": "Wochenchart", "1d": "Tageschart", "4h": "4h-Chart", "1h": "1h-Chart" };
export const TF_INTERVAL: Record<TF, Interval> = { "1M": "1M", "1w": "1w", "1d": "1d", "4h": "4h", "1h": "1h" };
/** Zuordnung zu den bisherigen Zeiträumen (nur für lernbare Werte und Texte der Analyse) */
export const TF_HORIZON: Record<TF, Horizon> = { "1M": "long", "1w": "long", "1d": "medium", "4h": "medium", "1h": "short" };
export const HIGHER_TFS: TF[] = ["1M", "1w"];
/** Untergeordnete Zeiteinheiten (grob → fein); der Einstieg kommt aus der feinsten mit Signal */
export const LOWER_TFS: TF[] = ["1d", "4h", "1h"];
export const ALL_TFS: TF[] = [...HIGHER_TFS, ...LOWER_TFS];

export interface TFView {
  tf: TF;
  res: AnalysisResult | null;
  /** Richtung der Wellenzählung dieser Zeiteinheit (1 = aufwärts, −1 = abwärts, 0 = unklar) */
  dir: 1 | -1 | 0;
  /** Aktives Signal dieser Zeiteinheit (bestehende Analyse) */
  signal: "long" | "short" | null;
}

export interface Scenario {
  kind: ScenarioKind;
  /** Zeiteinheit, aus der Einstieg, Stop und Ziele stammen */
  tf?: TF;
  plan?: TradePlan | null;
  lt?: LongTermZone | null;
  /** Ergebnis der Ausführungs-Zeiteinheit */
  res?: AnalysisResult | null;
  /** Ungültig, wenn … (Stop bzw. Wellenstart) */
  invalidation?: number;
  /** Übergeordnete Richtung */
  htfDir: 1 | -1 | 0;
  /** Begründung mit Bezug auf die Zeiteinheiten */
  reasons: string[];
  /** Kurzfassung in einem Satz */
  summary: string;
  /** Bei "Warten": worauf gewartet wird */
  waitFor?: string;
  views: TFView[];
}

export interface ScenarioInput {
  symbol: string;
  name: string;
  kind?: "stock" | "crypto" | "commodity";
  currency?: string;
  frames: Partial<Record<TF, Candle[]>>;
  fundamentals?: Fundamentals | null;
  news?: NewsItem[];
  /** Lernbare Werte je Zeiteinheit (Standard: Standardwerte) */
  paramsFor?: (tf: TF) => Partial<LearnableParams> | undefined;
  weightsFor?: (tf: TF) => WeightSet | undefined;
  livePrice?: number;
  now?: number;
  /** Format für Preise in Texten */
  fmt?: (n: number) => string;
}

const dirWord = (d: 1 | -1 | 0) => (d === 1 ? "aufwärts" : d === -1 ? "abwärts" : "unklar");

function viewOf(tf: TF, candles: Candle[] | undefined, inp: ScenarioInput): TFView | null {
  if (!candles || candles.length < 60) return null;
  const res = analyze({
    symbol: inp.symbol,
    name: inp.name,
    candles,
    horizon: TF_HORIZON[tf],
    interval: TF_INTERVAL[tf],
    kind: inp.kind,
    currency: inp.currency,
    fundamentals: inp.fundamentals,
    news: inp.news,
    params: inp.paramsFor?.(tf),
    weights: inp.weightsFor?.(tf),
    livePrice: LOWER_TFS.includes(tf) ? inp.livePrice : undefined,
    now: inp.now,
  });
  if (!res) return null;
  const best = res.elliott.best;
  const dir: 1 | -1 | 0 = !best || res.elliott.contested ? 0 : best.bias;
  const signal = res.plan && res.decision.level !== "neutral" ? res.plan.direction : null;
  return { tf, res, dir, signal };
}

const phaseOf = (v: TFView) => (v.res?.elliott.best ? `${v.res.elliott.best.patternLabel} – ${v.res.elliott.best.phase}` : "keine saubere Wellenzählung");

/** Berechnet das EINE Szenario für einen Wert aus allen verfügbaren Zeiteinheiten. */
export function buildScenario(inp: ScenarioInput): Scenario {
  const fmt = inp.fmt ?? ((n: number) => n.toFixed(2));
  const views = ALL_TFS.map((tf) => viewOf(tf, inp.frames[tf], inp)).filter((v): v is TFView => !!v);
  const ltSource = inp.frames["1w"] && inp.frames["1w"]!.length >= 150 ? inp.frames["1w"] : inp.frames["1d"];
  const ltRaw = ltSource && ltSource.length >= 150 ? findLongTermZone(ltSource) : null;
  return decideScenario(views, ltRaw, fmt);
}

/**
 * Entscheidung aus den Zeiteinheiten (reine Logik, testbar): genau EIN Szenario.
 * Widersprüche zwischen Zeiteinheiten → Warten (kein Kompromiss-Signal).
 */
export function decideScenario(views: TFView[], ltRaw: LongTermZone | null, fmt: (n: number) => string = (n) => n.toFixed(2)): Scenario {
  const higher = views.filter((v) => HIGHER_TFS.includes(v.tf));
  const lower = views.filter((v) => LOWER_TFS.includes(v.tf));
  const reasons = views.map((v) => `${TF_LABEL[v.tf]}: ${phaseOf(v)} (${dirWord(v.dir)})`);
  const base = { reasons, views };

  // 1) Übergeordnete Richtung: Monat und Woche dürfen sich nicht widersprechen
  const hd = higher.map((v) => v.dir).filter((d) => d !== 0);
  const htfConflict = hd.includes(1) && hd.includes(-1);
  const htfDir: 1 | -1 | 0 = htfConflict ? 0 : ((hd[hd.length - 1] ?? 0) as 1 | -1 | 0); // Woche (feiner) hat Vorrang
  const wait = (waitFor: string, extra?: Partial<Scenario>): Scenario => ({ kind: "wait", htfDir, ...base, summary: `Warten: ${waitFor}`, waitFor, ...extra });

  if (htfConflict) {
    const m = higher.find((v) => v.tf === "1M")!;
    const w = higher.find((v) => v.tf === "1w")!;
    return wait(`Monatschart (${dirWord(m.dir)}) und Wochenchart (${dirWord(w.dir)}) widersprechen sich – warten, bis beide übereinstimmen.`);
  }

  // 2) Signale der untergeordneten Zeiteinheiten (bestehende Analyse, unverändert)
  const sigs = lower.filter((v) => v.signal);
  const longs = sigs.filter((v) => v.signal === "long");
  const shorts = sigs.filter((v) => v.signal === "short");

  // 3) Kernposition (blau): Langfrist-Bereich auf Woche (sonst Tag), nur wenn die übergeordnete Richtung nicht abwärts ist
  const lt = ltRaw && ltRaw.status !== "invalidiert" && htfDir !== -1 ? ltRaw : null;
  const coreScenario = (): Scenario => ({
    kind: "core",
    htfDir,
    lt,
    invalidation: lt!.invalidation,
    ...base,
    reasons: [...reasons, `→ Kernposition: langfristiger Einstieg in drei Teilen ${fmt(lt!.zoneTop)} – ${fmt(lt!.zoneBottom)}, ungültig unter ${fmt(lt!.invalidation)}.`],
    summary: `Kernposition: Einstiegsbereich ${fmt(lt!.zoneTop)} – ${fmt(lt!.zoneBottom)} (${lt!.status === "in-zone" ? "Kurs im Bereich" : "zulaufend"}).`,
  });

  if (longs.length && shorts.length) {
    if (lt && lt.status === "in-zone") return coreScenario();
    return wait(`${longs.map((v) => TF_LABEL[v.tf]).join(", ")} zeigt Kauf, ${shorts.map((v) => TF_LABEL[v.tf]).join(", ")} zeigt Verkauf – widersprüchlich. Warten, bis die Zeiteinheiten übereinstimmen.`);
  }
  // Einstieg aus der FEINSTEN Zeiteinheit mit Signal (genauer Einstieg/Stop), Richtung von oben
  const pick = (longs.length ? longs : shorts)[(longs.length ? longs : shorts).length - 1];
  const planDir = pick ? (pick.signal === "long" ? 1 : -1) : 0;

  if (pick) {
    if (htfDir === 0) {
      if (lt && planDir === 1) return coreScenario();
      return wait(`${TF_LABEL[pick.tf]} zeigt ${planDir === 1 ? "Kauf" : "Verkauf"}, aber die übergeordnete Richtung ist unklar – warten, bis der Wochenchart Richtung zeigt.`);
    }
    if (planDir !== htfDir) {
      if (lt && lt.status === "in-zone") return coreScenario();
      const hv = higher.find((v) => v.dir === htfDir)!;
      return wait(`${TF_LABEL[hv.tf]} erwartet ${dirWord(htfDir)}, ${TF_LABEL[pick.tf]} zeigt ${planDir === 1 ? "Kauf" : "Verkauf"} – widersprüchlich, kein Kompromiss-Signal.`);
    }
    // Kernposition hat Vorrang, wenn der Kurs bereits im blauen Bereich ist
    if (lt && lt.status === "in-zone" && planDir === 1) return coreScenario();
    const plan = pick.res!.plan!;
    const hv = higher.find((v) => v.dir === htfDir);
    const zone = plan.zoneStart != null && plan.zoneEnd != null ? `${fmt(Math.max(plan.zoneStart, plan.zoneEnd))} – ${fmt(Math.min(plan.zoneStart, plan.zoneEnd))}` : fmt(plan.entry);
    const line = `${hv ? `${TF_LABEL[hv.tf]}: ${phaseOf(hv)}, ` : ""}${TF_LABEL[pick.tf]}: ${phaseOf(pick)} → ${planDir === 1 ? "Trade" : "Short"}-Einstieg in der Zone ${zone}.`;
    return {
      kind: planDir === 1 ? "trade" : "short",
      tf: pick.tf,
      plan,
      res: pick.res,
      lt: null,
      invalidation: plan.stop,
      htfDir,
      ...base,
      reasons: [...reasons, `→ ${line}`],
      summary: line,
    };
  }

  // 4) Kein Trade-Signal: Kernposition, sonst Warten mit Begründung
  if (lt) return coreScenario();
  if (htfDir === 0) return wait("Die übergeordnete Wellenzählung ist unklar – warten, bis der Wochenchart eine Richtung zeigt.");
  const d = lower.find((v) => v.tf === "1d") ?? lower[0];
  const best = d?.res?.elliott.best;
  if (d && best && best.bias !== htfDir) {
    const lvl = best.targets[0];
    return wait(`${TF_LABEL[d.tf]}: ${best.phase}. Warten, bis die Korrektur${lvl ? ` ${htfDir === 1 ? "unter" : "über"} ${fmt(lvl)}` : ""} abgeschlossen ist – danach Einstieg ${htfDir === 1 ? "auf steigende" : "auf fallende"} Kurse prüfen.`, { invalidation: best.stop });
  }
  return wait(`Übergeordnet ${dirWord(htfDir)}, aber keine saubere Einstiegszone – warten auf den nächsten Rücksetzer.`);
}

/** Schließt nur VOLLSTÄNDIG abgeschlossene Kerzen bis zum Zeitpunkt t ein (kein Blick in die Zukunft). */
export function closedUntil(c: Candle[], tfSec: number, t: number): Candle[] {
  let hi = c.length;
  while (hi > 0 && c[hi - 1].time + tfSec > t) hi--;
  return c.slice(Math.max(0, hi - 600), hi);
}

export const TF_SECONDS: Record<TF, number> = { "1M": 30 * 86400, "1w": 7 * 86400, "1d": 86400, "4h": 4 * 3600, "1h": 3600 };
