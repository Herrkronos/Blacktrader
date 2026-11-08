"use client";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function EquityChart({ data, compare }: { data: { time: number; cumulative: number }[]; compare?: number }) {
  if (data.length === 0) return <p className="p-6 text-center text-sm text-stone-400">Noch keine geschlossenen Trades.</p>;
  const points = [{ time: data[0].time - 1, cumulative: 0 }, ...data];
  const last = points[points.length - 1].cumulative;
  const color = last >= 0 ? "#C9A24A" : "#a32234";
  const sameDay = points[points.length - 1].time - points[0].time < 2 * 86400e3;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.5} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(201,162,74,0.08)" vertical={false} />
          <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tick={{ fill: "#8f887a", fontSize: 10 }} tickFormatter={(t: number) =>
              sameDay ? new Date(t).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : new Date(t).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })
            } />
          <YAxis tick={{ fill: "#8f887a", fontSize: 10 }} tickFormatter={(v: number) => `${v.toFixed(0)} %`} width={48} />
          <Tooltip
            contentStyle={{ background: "#0b0b0b", border: "1px solid rgba(201,162,74,0.3)", fontSize: 12 }}
            labelFormatter={(t) => new Date(Number(t)).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
            formatter={(v) => [`${Number(v).toFixed(2)} %`, "Kumulierte Rendite"]}
          />
          <ReferenceLine y={0} stroke="#57534e" />
          {compare != null && <ReferenceLine y={compare} stroke="#78716c" strokeDasharray="4 4" label={{ value: `Einfach gehalten ${compare.toFixed(1)} %`, fill: "#a8a29e", fontSize: 10, position: "insideTopLeft" }} />}
          <Area type="stepAfter" dataKey="cumulative" stroke={color} fill="url(#eq)" strokeWidth={2} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
