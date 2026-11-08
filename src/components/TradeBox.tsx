"use client";
// Einfache, anfängerfreundliche Darstellung eines Trading-Einstiegs: Kaufen bei / Verlust begrenzen / Ziel.
import type { TradePlan } from "@/lib/analysis/score";
import { money } from "@/lib/analysis/persona";

const pct = (a: number, b: number) => `${((Math.abs(b - a) / a) * 100).toFixed(1).replace(".", ",")} %`;

/** Ein kurzer Satz in Alltagssprache. */
export function simpleReason(plan: TradePlan, currency?: string): string {
  const long = plan.direction === "long";
  if (plan.orderType === "limit")
    return long
      ? `Der Kurs steigt im großen Trend. Gekauft wird erst nach einem kleinen Rücksetzer auf ${money(plan.entry, currency)}.`
      : `Der Kurs fällt im großen Trend. Verkauft wird erst nach einer kleinen Erholung auf ${money(plan.entry, currency)}.`;
  return long
    ? "Der Kurs steigt im großen Trend und ist gerade etwas zurückgefallen – ein guter Moment zum Kaufen."
    : "Der Kurs fällt im großen Trend und hat sich gerade etwas erholt – ein guter Moment zum Verkaufen.";
}

/** Einzeilige Kurzfassung, z. B. für die Watchlist. */
export function simpleLine(plan: TradePlan, currency?: string): string {
  const long = plan.direction === "long";
  const verb = plan.orderType === "limit" ? (long ? "Kaufen bei" : "Verkaufen bei") : long ? "Jetzt kaufen" : "Jetzt verkaufen";
  return `${verb} ${money(plan.entry, currency)} · Stop ${money(plan.stop, currency)} · Ziel ${money(plan.targets[0], currency)}`;
}

export function TradeBox({ plan, currency }: { plan: TradePlan; currency?: string }) {
  const long = plan.direction === "long";
  const row = "flex items-baseline justify-between gap-3 border-b border-white/5 py-1.5 last:border-0";
  return (
    <div className="rounded-lg bg-black/30 px-3 py-1">
      <div className={row}>
        <span className="text-sm text-stone-300">{long ? "Kaufen bei" : "Verkaufen bei"}</span>
        <span className="num text-lg font-semibold text-stone-50">{money(plan.entry, currency)}</span>
      </div>
      <div className={row}>
        <span className="text-sm text-stone-300">Verlust begrenzen bei</span>
        <span className="num font-semibold text-red-300">
          {money(plan.stop, currency)} <span className="text-xs font-normal">(−{pct(plan.entry, plan.stop)})</span>
        </span>
      </div>
      <div className={row}>
        <span className="text-sm text-stone-300">Ziel</span>
        <span className="num font-semibold text-emerald-300">
          {money(plan.targets[0], currency)} <span className="text-xs font-normal">(+{pct(plan.entry, plan.targets[0])})</span>
        </span>
      </div>
    </div>
  );
}
