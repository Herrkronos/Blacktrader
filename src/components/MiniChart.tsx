"use client";
// Kleiner SVG-Chart für Karten: Kursverlauf, Wellenzählung, Einstiegszone (gold), Stop (rot), Ziel (grün).
import type { WaveCount } from "@/lib/analysis/elliott";
import type { TradePlan } from "@/lib/analysis/score";
import type { Candle } from "@/lib/types";

export function MiniChart({ candles, plan, best, height = 92 }: { candles: Candle[]; plan?: TradePlan | null; best?: WaveCount; height?: number }) {
  const data = candles.slice(-90);
  if (data.length < 5) return <div style={{ height }} className="rounded-xl bg-white/5" />;
  const W = 320;
  const H = height;
  const pad = 6;
  const levels = [...data.map((c) => c.high), ...data.map((c) => c.low)];
  if (plan) levels.push(plan.stop, plan.targets[0], plan.zoneStart ?? plan.entry, plan.zoneEnd ?? plan.entry);
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  const y = (p: number) => pad + (1 - (p - lo) / (hi - lo || 1)) * (H - 2 * pad);
  const x = (i: number) => (i / (data.length - 1)) * (W - 40);
  const t0 = data[0].time;
  const tN = data[data.length - 1].time;
  const xt = (t: number) => x(((t - t0) / (tN - t0 || 1)) * (data.length - 1));
  const path = data.map((c, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(c.close).toFixed(1)}`).join("");
  const up = data[data.length - 1].close >= data[0].close;
  const pivots = best?.pivots.filter((p) => p.time >= t0) ?? [];
  const lastX = x(data.length - 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img" aria-label="Mini-Chart mit Zonen">
      {plan && (
        <>
          <rect x={lastX - 70} width={W - lastX + 70} y={Math.min(y(plan.zoneStart ?? plan.entry), y(plan.zoneEnd ?? plan.entry)) - 1} height={Math.max(3, Math.abs(y(plan.zoneStart ?? plan.entry) - y(plan.zoneEnd ?? plan.entry)) + 2)} fill="rgba(201,162,74,0.28)" rx="2" />
          <line x1={lastX - 70} x2={W} y1={y(plan.stop)} y2={y(plan.stop)} stroke="#f87171" strokeWidth="1.5" strokeDasharray="4 3" />
          <line x1={lastX - 70} x2={W} y1={y(plan.targets[0])} y2={y(plan.targets[0])} stroke="#34d399" strokeWidth="1.5" strokeDasharray="4 3" />
        </>
      )}
      <path d={path} fill="none" stroke={up ? "#d6c08a" : "#bfb6a3"} strokeWidth="1.6" />
      {pivots.length > 1 && (
        <polyline points={pivots.map((p) => `${xt(p.time).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ")} fill="none" stroke="#C9A24A" strokeWidth="1" opacity="0.7" />
      )}
      {pivots.map((p, i) => {
        const label = i === 0 ? "" : best!.labels[best!.pivots.indexOf(p) - 1];
        if (!label) return null;
        return (
          <text key={p.time} x={xt(p.time)} y={p.type === "H" ? y(p.price) - 4 : y(p.price) + 12} fontSize="11" fill="#e3c57a" textAnchor="middle" fontFamily="Inter, sans-serif">
            {label}
          </text>
        );
      })}
    </svg>
  );
}
