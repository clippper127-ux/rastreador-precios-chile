import { bestPriceNoCard, formatCLP, type PriceFields } from "@rastreador/core";
import { CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Muestra siempre por separado el mejor precio sin tarjeta y el precio con tarjeta de la tienda.
 * El "antes" se tacha solo si es mayor que el precio que se paga.
 */
export function PriceBlock({
  prices,
  size = "default",
  className,
}: {
  prices: PriceFields;
  size?: "default" | "lg";
  className?: string;
}) {
  const noCard = bestPriceNoCard(prices);
  const showNormal = prices.priceNormal != null && noCard != null && prices.priceNormal > noCard;
  const showCard = prices.priceCard != null && (noCard == null || prices.priceCard < noCard);

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "tabular font-semibold tracking-tight",
            size === "lg" ? "text-3xl sm:text-4xl" : "text-xl",
          )}
        >
          {formatCLP(noCard)}
        </span>
        {showNormal && (
          <span className="tabular text-sm text-muted-foreground line-through">
            <span className="sr-only">Precio normal </span>
            {formatCLP(prices.priceNormal)}
          </span>
        )}
      </div>
      {showCard && (
        <div className="flex items-center gap-1.5 text-sm text-card-price">
          <CreditCard aria-hidden className="size-4" />
          <span className="tabular font-medium">{formatCLP(prices.priceCard)}</span>
          <span className="text-muted-foreground">con {prices.cardName ?? "tarjeta de la tienda"}</span>
        </div>
      )}
    </div>
  );
}
