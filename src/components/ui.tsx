"use client";
import { SIGNAL_LABEL, type SignalLevel } from "@/lib/analysis/score";
import type { LiveStatus } from "@/lib/client/market";
import { HORIZON_LABEL, type Horizon } from "@/lib/types";

const SIGNAL_STYLE: Record<SignalLevel, string> = {
  "strong-buy": "border-emerald-400/60 bg-emerald-500/20 text-emerald-200",
  buy: "border-emerald-500/40 bg-emerald-600/10 text-emerald-300",
  neutral: "border-stone-500/40 bg-stone-500/10 text-stone-300",
  sell: "border-red-500/40 bg-wine/30 text-red-300",
  "strong-sell": "border-red-400/60 bg-wine/60 text-red-100",
};

/** Legende: Blau = Kernposition, Grün = Kauf-Einstieg, Rot = Verkaufs-Einstieg */
export function EntryLegend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-400">
      <span className="core-tag">Kernposition</span> = langfristig, Welle 5 / Boden
      <span className="trade-tag">Kauf</span> = Trading-Einstieg auf steigende Kurse
      <span className="sell-tag">Verkauf</span> = Trading-Einstieg auf fallende Kurse
    </div>
  );
}

export function SignalBadge({ level, small }: { level?: SignalLevel; small?: boolean }) {
  if (!level) return <span className="text-xs text-stone-500">–</span>;
  return <span className={`inline-block whitespace-nowrap rounded-md border ${small ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-1 text-xs"} font-medium ${SIGNAL_STYLE[level]}`}>{SIGNAL_LABEL[level]}</span>;
}

const STATUS: Record<LiveStatus, { label: string; cls: string }> = {
  live: { label: "Live", cls: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" },
  delayed: { label: "Verzögert", cls: "bg-amber-400" },
  offline: { label: "Offline", cls: "bg-red-500" },
  loading: { label: "Lädt", cls: "bg-stone-500 animate-pulse" },
};

export function StatusDot({ status, title }: { status?: LiveStatus; title?: string }) {
  const s = STATUS[status ?? "loading"];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-stone-300" title={title}>
      <span className={`h-2 w-2 rounded-full ${s.cls}`} />
      {s.label}
    </span>
  );
}

export function ScoreBar({ value, label }: { value: number; label?: string }) {
  const color = value >= 58 ? "bg-emerald-500" : value <= 42 ? "bg-wine-light" : "bg-gold";
  return (
    <div className="min-w-[80px]">
      {label && (
        <div className="mb-1 flex justify-between text-xs text-stone-400">
          <span>{label}</span>
          <span className="num text-stone-200">{Math.round(value)}</span>
        </div>
      )}
      <div className="relative h-1.5 overflow-hidden rounded-full bg-stone-800">
        <div className="absolute inset-y-0 left-1/2 w-px bg-stone-600" />
        <div className={`h-full ${color}`} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

export function HorizonToggle({ value, onChange, allowDefault, size = "md" }: { value?: Horizon; onChange: (h: Horizon | undefined) => void; allowDefault?: boolean; size?: "sm" | "md" }) {
  const opts: (Horizon | undefined)[] = allowDefault ? [undefined, "short", "medium", "long"] : ["short", "medium", "long"];
  return (
    <div className="inline-flex rounded-lg border border-gold/25 bg-black/50 p-0.5">
      {opts.map((h) => (
        <button
          key={h ?? "global"}
          type="button"
          onClick={() => onChange(h)}
          className={`rounded-md ${size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "px-3 py-1 text-xs"} transition ${value === h ? "bg-gold text-black" : "text-stone-300 hover:text-gold-light"}`}
        >
          {h ? (size === "sm" ? HORIZON_LABEL[h].slice(0, 4) + "." : HORIZON_LABEL[h]) : "Global"}
        </button>
      ))}
    </div>
  );
}

export function Change({ value }: { value?: number }) {
  if (value == null || !Number.isFinite(value)) return <span className="text-stone-500">–</span>;
  return <span className={`num ${value >= 0 ? "text-up" : "text-down"}`}>{`${value >= 0 ? "+" : ""}${value.toFixed(2)} %`}</span>;
}

export function Stat({ label, value, hint, tone, accent }: { label: string; value: React.ReactNode; hint?: string; tone?: "up" | "down"; accent?: "core" | "trade" }) {
  return (
    <div className={`panel px-3 py-2 ${accent === "core" ? "core-bg" : accent === "trade" ? "trade-bg" : ""}`}>
      <div className="text-[11px] uppercase tracking-wider text-stone-400">{label}</div>
      <div className={`num text-lg font-semibold ${tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-stone-100"}`}>{value}</div>
      {hint && <div className="text-[11px] text-stone-500">{hint}</div>}
    </div>
  );
}
