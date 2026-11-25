"use client";

import { formatCLP } from "@rastreador/core";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";

export interface ChartListing {
  id: string;
  storeName: string;
  lastCheckedAt: number | null;
  current?: { noCard?: number; withCard?: number };
}
export interface ChartPoint {
  t: number;
  listingId: string;
  noCard?: number;
  withCard?: number;
}

const RANGES = [
  { id: "7d", label: "7 días", days: 7 },
  { id: "30d", label: "30 días", days: 30 },
  { id: "90d", label: "90 días", days: 90 },
  { id: "all", label: "Todo", days: Infinity },
] as const;

// Colores por tienda (categóricos, legibles en claro y oscuro).
const SERIES = ["var(--brand)", "var(--deal)", "var(--caution)", "var(--card-price)", "var(--danger)"];

const dateFmt = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short" });
const dateTimeFmt = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { id: T; label: string }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition-colors",
            value === o.id ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PriceHistoryChart({
  listings,
  points,
  allTimeMin,
  targetPrice,
}: {
  listings: ChartListing[];
  points: ChartPoint[];
  allTimeMin?: number;
  targetPrice?: number | null;
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("30d");
  const [basis, setBasis] = useState<"noCard" | "withCard">("noCard");

  const data = useMemo(() => {
    const days = RANGES.find((r) => r.id === range)!.days;
    const from = Number.isFinite(days) ? Date.now() - days * 86_400_000 : -Infinity;
    // Una fila por instante; cada tienda en su columna. El "último chequeo" cierra la línea hasta hoy.
    const rows = new Map<number, { t: number } & Record<string, number>>();
    const add = (t: number, listingId: string, value?: number) => {
      if (value == null) return;
      const row = rows.get(t) ?? ({ t } as { t: number } & Record<string, number>);
      row[listingId] = value;
      rows.set(t, row);
    };
    for (const l of listings) {
      const own = points.filter((p) => p.listingId === l.id);
      // Valor vigente al inicio del rango (para que la línea no empiece en blanco).
      const before = own.filter((p) => p.t < from).at(-1);
      if (before) add(from, l.id, before[basis]);
      for (const p of own) if (p.t >= from) add(p.t, l.id, p[basis]);
      if (l.lastCheckedAt && l.current) add(Math.max(l.lastCheckedAt, from), l.id, l.current[basis]);
    }
    return [...rows.values()].sort((a, b) => a.t - b.t);
  }, [listings, points, range, basis]);

  const hasData = data.length >= 1;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Segmented label="Rango" value={range} onChange={setRange} options={RANGES} />
        <Segmented
          label="Precio"
          value={basis}
          onChange={setBasis}
          options={[
            { id: "noCard", label: "Sin tarjeta" },
            { id: "withCard", label: "Con tarjeta" },
          ]}
        />
      </div>

      {!hasData ? (
        <div className="grid h-64 place-items-center rounded-xl border border-dashed text-sm text-muted-foreground">
          El historial empieza con el primer chequeo.
        </div>
      ) : (
        <figure aria-label="Historial de precio por tienda" className="h-64 sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(t) => dateFmt.format(t)}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={(v) => `$${Math.round(v / 1000)}k`}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                width={48}
                domain={["auto", "auto"]}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  fontSize: 12,
                  boxShadow: "var(--shadow-lift)",
                }}
                labelFormatter={(t) => dateTimeFmt.format(Number(t))}
                formatter={(v, key) => [formatCLP(Number(v)), listings.find((l) => l.id === key)?.storeName ?? ""]}
              />
              {allTimeMin != null && basis === "noCard" && (
                <ReferenceLine
                  y={allTimeMin}
                  stroke="var(--deal)"
                  strokeDasharray="4 4"
                  label={{ value: `Mínimo ${formatCLP(allTimeMin)}`, position: "insideBottomLeft", fontSize: 11, fill: "var(--deal)" }}
                />
              )}
              {targetPrice != null && (
                <ReferenceLine
                  y={targetPrice}
                  stroke="var(--brand)"
                  strokeDasharray="2 4"
                  label={{ value: `Objetivo ${formatCLP(targetPrice)}`, position: "insideTopLeft", fontSize: 11, fill: "var(--brand)" }}
                />
              )}
              {listings.map((l, i) => (
                <Line
                  key={l.id}
                  dataKey={l.id}
                  name={l.storeName}
                  type="stepAfter"
                  stroke={SERIES[i % SERIES.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </figure>
      )}

      {listings.length > 1 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {listings.map((l, i) => (
            <li key={l.id} className="flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-full" style={{ background: SERIES[i % SERIES.length] }} />
              {l.storeName}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
