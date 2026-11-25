import { cn } from "@/lib/utils";

/** Barra del total de una lista respecto a su presupuesto. */
export function BudgetBar({ total, budget }: { total: number; budget: number | null }) {
  if (!budget) return null;
  const pct = Math.min(100, (total / budget) * 100);
  const under = total <= budget;
  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-muted"
      role="meter"
      aria-label="Total respecto al presupuesto"
      aria-valuenow={Math.round((total / budget) * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={cn("h-full rounded-full", under ? "bg-deal" : "bg-caution")} style={{ width: `${Math.max(pct, 2)}%` }} />
    </div>
  );
}
