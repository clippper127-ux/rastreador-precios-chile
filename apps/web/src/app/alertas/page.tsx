import { formatCLP } from "@rastreador/core";
import { BellOff, Mail, PackageCheck, Send, Smartphone, Target, TrendingDown, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/time";
import { listAlerts, type AlertRow } from "@/lib/watches";

export const metadata: Metadata = { title: "Alertas" };

const KIND: Record<AlertRow["kind"], { icon: typeof Target; label: string }> = {
  target: { icon: Target, label: "Precio objetivo" },
  drop_pct: { icon: TrendingDown, label: "Bajó de precio" },
  all_time_low: { icon: Trophy, label: "Mínimo histórico" },
  restock: { icon: PackageCheck, label: "Volvió el stock" },
};
const CHANNEL: Record<string, { icon: typeof Send; label: string }> = {
  telegram: { icon: Send, label: "Telegram" },
  email: { icon: Mail, label: "Correo" },
  app: { icon: Smartphone, label: "Solo en la app" },
};

export default async function AlertasPage() {
  const user = await requireUser("/alertas");
  const alerts = await listAlerts(user.id);

  return (
    <>
      <PageHeader title="Alertas" description="Avisos de los productos que sigues." />
      {!alerts.length ? (
        <EmptyState
          icon={BellOff}
          title="Sin alertas por ahora"
          description="Cuando un producto que sigues baje de tu precio objetivo, llegue a su mínimo o vuelva a tener stock, lo verás aquí."
        />
      ) : (
        <ol className="flex flex-col gap-3">
          {alerts.map((a) => {
            const k = KIND[a.kind];
            const ch = CHANNEL[a.channel] ?? CHANNEL.app!;
            return (
              <li key={a.id}>
                <Link
                  href={`/producto/${a.productId}`}
                  className="flex gap-4 rounded-xl border bg-card p-4 shadow-soft transition-shadow hover:shadow-lift"
                >
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-deal-soft text-deal">
                    <k.icon aria-hidden className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <p className="truncate font-medium">{a.productName}</p>
                      <time className="text-xs text-muted-foreground" dateTime={a.createdAt.toISOString()}>
                        {timeAgo(a.createdAt)}
                      </time>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {a.reason || k.label} · {a.storeName}
                      {a.price != null && <span className="tabular font-medium text-foreground"> · {formatCLP(a.price)}</span>}
                    </p>
                    <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <ch.icon aria-hidden className="size-3.5" /> {ch.label}
                      </span>
                      {a.status === "pending" && <Badge variant="caution">Enviando…</Badge>}
                      {a.status === "failed" && (
                        <Badge variant="danger" title={a.error}>
                          No se pudo enviar
                        </Badge>
                      )}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
