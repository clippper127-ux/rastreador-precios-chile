import type { CLP, PriceFields, StockStatus } from "./types";

const clpFormatter = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

export function formatCLP(value: CLP | null | undefined): string {
  if (value == null) return "—";
  return clpFormatter.format(value);
}

/** Convierte "$1.299.990", "1299990", 1299990.4 a entero CLP. Devuelve undefined si no es un precio válido. */
export function toCLP(value: unknown): CLP | undefined {
  if (value == null) return undefined;
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
  }
  if (typeof value === "string") {
    // En Chile el punto separa miles y la coma decimales.
    const cleaned = value.replace(/[^\d,]/g, "").split(",")[0] ?? "";
    if (!cleaned) return undefined;
    const n = Number.parseInt(cleaned, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  return undefined;
}

function minDefined(...values: (CLP | null | undefined)[]): CLP | undefined {
  const nums = values.filter((v): v is CLP => typeof v === "number" && v > 0);
  return nums.length ? Math.min(...nums) : undefined;
}

/** Mejor precio que paga cualquiera (oferta o normal). */
export function bestPriceNoCard(p: PriceFields): CLP | undefined {
  return minDefined(p.priceOffer, p.priceNormal);
}

/** Mejor precio si tienes la tarjeta de la tienda. Nunca es mayor que el precio sin tarjeta. */
export function bestPriceWithCard(p: PriceFields): CLP | undefined {
  return minDefined(p.priceCard, p.priceOffer, p.priceNormal);
}

/** "both": avisa si cualquiera de los dos precios (sin tarjeta o con tarjeta) cumple la condición. */
export type PriceBasis = "no_card" | "with_card" | "both";

export function effectivePrice(p: PriceFields, basis: PriceBasis): CLP | undefined {
  // "both" usa el menor de los dos: si cualquiera baja, cuenta.
  return basis === "no_card" ? bestPriceNoCard(p) : bestPriceWithCard(p);
}

export interface PriceState extends PriceFields {
  stockStatus: StockStatus;
}

/** Solo se guarda un snapshot nuevo si cambia algún precio o el stock. */
export function hasPriceStateChanged(prev: PriceState | null | undefined, next: PriceState): boolean {
  if (!prev) return true;
  return (
    (prev.priceNormal ?? null) !== (next.priceNormal ?? null) ||
    (prev.priceOffer ?? null) !== (next.priceOffer ?? null) ||
    (prev.priceCard ?? null) !== (next.priceCard ?? null) ||
    (prev.cardName ?? null) !== (next.cardName ?? null) ||
    prev.stockStatus !== next.stockStatus
  );
}
