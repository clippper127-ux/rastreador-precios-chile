import type { Verdict, VerdictResult } from "@rastreador/core";
import { CalendarClock, CircleHelp, Minus, ThumbsUp, TrendingUp, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STYLE: Record<Verdict, { icon: typeof Trophy; badge: "deal" | "caution" | "outline" | "brand" | "default"; tone: string }> = {
  buen_momento: { icon: Trophy, badge: "deal", tone: "bg-deal-soft text-deal" },
  buen_precio: { icon: ThumbsUp, badge: "deal", tone: "bg-deal-soft text-deal" },
  promedio: { icon: Minus, badge: "outline", tone: "bg-muted text-foreground" },
  algo_caro: { icon: TrendingUp, badge: "caution", tone: "bg-caution-soft text-caution" },
  espera: { icon: CalendarClock, badge: "brand", tone: "bg-accent text-accent-foreground" },
  faltan_datos: { icon: CircleHelp, badge: "default", tone: "bg-muted text-muted-foreground" },
};

/** Insignia compacta para el dashboard (no se muestra si faltan datos, para no llenar de ruido). */
export function VerdictBadge({ v }: { v: VerdictResult }) {
  if (v.verdict === "faltan_datos") return null;
  const s = STYLE[v.verdict];
  return (
    <Badge variant={s.badge} title={v.reasons.join(" ")}>
      <s.icon aria-hidden />
      {v.label}
    </Badge>
  );
}

/** "¿Compro ahora o espero?" con las razones (reglas simples y explicables). */
export function VerdictPanel({ v }: { v: VerdictResult }) {
  const s = STYLE[v.verdict];
  return (
    <section aria-labelledby="veredicto" className={cn("rounded-xl p-4", s.tone)}>
      <p className="text-xs font-medium tracking-wide uppercase opacity-80">¿Compro ahora o espero?</p>
      <h2 id="veredicto" className="mt-1 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <s.icon aria-hidden className="size-5" />
        {v.label}
      </h2>
      {v.reasons.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {v.reasons.map((r) => (
            <li key={r} className="flex gap-2">
              <span aria-hidden>·</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
