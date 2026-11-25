import { formatCLP } from "@rastreador/core";
import { Clock, CreditCard, Loader2, PackageX, Store, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { isStale, timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { WatchCard as WatchCardData } from "@/lib/watches";
import { Sparkline } from "./sparkline";

export function WatchCard({ card }: { card: WatchCardData }) {
  const trend = card.changePct == null ? "flat" : card.changePct < 0 ? "down" : "up";
  const best = card.best;
  const allOut = !card.pending && card.listings.every((l) => l.bestNoCard == null);
  const showCard = card.bestWithCard != null && card.bestNoCard != null && card.bestWithCard < card.bestNoCard;

  return (
    <Link
      href={`/producto/${card.productId}`}
      className="group flex flex-col rounded-xl border bg-card p-4 shadow-soft transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-lift sm:p-5"
    >
      <div className="flex gap-4">
        <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-muted">
          {card.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- imágenes de tiendas de muchos dominios
            <img src={card.imageUrl} alt="" loading="lazy" className="size-full object-contain mix-blend-multiply dark:mix-blend-normal" />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 leading-snug font-medium group-hover:text-brand">{card.name}</h2>
          {card.brand && <p className="mt-0.5 text-xs tracking-wide text-muted-foreground uppercase">{card.brand}</p>}
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        {card.pending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Obteniendo precio…
          </div>
        ) : allOut ? (
          <Badge variant="danger">
            <PackageX aria-hidden />
            Sin stock
          </Badge>
        ) : (
          <div>
            <p className="tabular text-2xl font-semibold tracking-tight">{formatCLP(card.bestNoCard)}</p>
            {showCard && (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-card-price">
                <CreditCard aria-hidden className="size-3.5" />
                <span className="tabular font-medium">{formatCLP(card.bestWithCard)}</span> con tarjeta
              </p>
            )}
          </div>
        )}
        {card.changePct != null && (
          <Badge variant={trend === "down" ? "deal" : "danger"}>
            {trend === "down" ? <TrendingDown aria-hidden /> : <TrendingUp aria-hidden />}
            <span className="tabular">
              {card.changePct > 0 ? "+" : ""}
              {card.changePct.toFixed(0)}%
            </span>
          </Badge>
        )}
      </div>

      <div className="mt-3">
        <Sparkline data={card.spark} trend={trend} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          <Store aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">
            {best ? best.storeName : card.listings[0]?.storeName}
            {card.listings.length > 1 && ` · ${card.listings.length} tiendas`}
          </span>
        </span>
        {!card.pending && best && (
          <span className={cn("flex shrink-0 items-center gap-1", isStale(best.lastCheckedAt) && "text-caution")}>
            <Clock aria-hidden className="size-3.5" />
            {timeAgo(best.lastCheckedAt)}
          </span>
        )}
      </div>
    </Link>
  );
}
