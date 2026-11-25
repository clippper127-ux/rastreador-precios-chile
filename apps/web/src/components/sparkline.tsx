"use client";

import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";

/** Mini gráfico de tendencia (sin ejes ni tooltip). Escalón: el precio se mantiene hasta que cambia. */
export function Sparkline({ data, trend }: { data: { t: number; price: number }[]; trend: "down" | "up" | "flat" }) {
  if (data.length < 2) {
    return <div aria-hidden className="h-10 rounded-md border border-dashed border-border/70" />;
  }
  const color = trend === "down" ? "var(--deal)" : trend === "up" ? "var(--danger)" : "var(--muted-foreground)";
  return (
    <div aria-hidden className="h-10">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line type="stepAfter" dataKey="price" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
