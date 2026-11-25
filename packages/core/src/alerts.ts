import { effectivePrice, formatCLP, type PriceBasis, type PriceState } from "./price";
import type { CLP } from "./types";

/*
 * Reglas de alerta (puras, sin base de datos). Se evalúan cada vez que entra un precio nuevo
 * para un listing, por cada usuario que lo sigue.
 */

export type AlertKind = "target" | "drop_pct" | "all_time_low" | "restock";

export interface WatchRules {
  targetPrice: CLP | null;
  dropPct: number | null;
  notifyAllTimeLow: boolean;
  notifyRestock: boolean;
  priceBasis: PriceBasis;
  excludeThirdParty: boolean;
  /** Estado de "bajo el objetivo": false mientras el precio siga bajo el objetivo (no repetir). */
  targetArmed: boolean;
}

export interface AlertInput {
  rules: WatchRules;
  prev: PriceState | null;
  next: PriceState;
  /** Mínimo histórico del listing ANTES de este precio (según la base del watch). */
  previousMin: CLP | null;
  /** Cantidad de precios guardados antes de este. Sin historial no hay "mínimo histórico". */
  previousSnapshots: number;
  sellerType?: string | null;
}

export interface AlertEvent {
  kind: AlertKind;
  price: CLP;
  /** Texto corto en español para el mensaje. */
  reason: string;
}

export interface AlertEvaluation {
  events: AlertEvent[];
  /** Nuevo valor de target_armed para guardar. */
  targetArmed: boolean;
}

const inStock = (s: PriceState | null) => !!s && (s.stockStatus === "in_stock" || s.stockStatus === "preorder");

export function evaluateAlerts(input: AlertInput): AlertEvaluation {
  const { rules, prev, next } = input;
  const events: AlertEvent[] = [];
  const price = effectivePrice(next, rules.priceBasis);
  const prevPrice = prev ? effectivePrice(prev, rules.priceBasis) : undefined;
  let targetArmed = rules.targetArmed;

  if (rules.excludeThirdParty && input.sellerType === "third_party") return { events, targetArmed };

  // Volvió el stock.
  if (rules.notifyRestock && prev && !inStock(prev) && prev.stockStatus !== "unknown" && inStock(next) && price != null) {
    events.push({ kind: "restock", price, reason: "Volvió a tener stock" });
  }

  if (price == null || !inStock(next)) return { events, targetArmed };

  // Bajo el precio objetivo: avisa una vez y se rearma cuando el precio vuelve a subir sobre el objetivo.
  if (rules.targetPrice != null) {
    if (price <= rules.targetPrice) {
      if (targetArmed) {
        events.push({ kind: "target", price, reason: `Bajó de tu precio objetivo (${formatCLP(rules.targetPrice)})` });
        targetArmed = false;
      }
    } else {
      targetArmed = true;
    }
  }

  // Baja de X% respecto al precio anterior.
  if (rules.dropPct != null && rules.dropPct > 0 && prevPrice != null && price < prevPrice) {
    const pct = ((prevPrice - price) / prevPrice) * 100;
    if (pct >= rules.dropPct) {
      events.push({ kind: "drop_pct", price, reason: `Bajó ${Math.round(pct)}% (antes ${formatCLP(prevPrice)})` });
    }
  }

  // Nuevo mínimo histórico (estrictamente menor que todo lo anterior).
  if (rules.notifyAllTimeLow && input.previousSnapshots > 0 && input.previousMin != null && price < input.previousMin) {
    events.push({ kind: "all_time_low", price, reason: `Mínimo histórico (antes ${formatCLP(input.previousMin)})` });
  }

  return { events, targetArmed };
}

export interface AlertMessageInput {
  productName: string;
  storeName: string;
  reasons: string[];
  priceNoCard?: CLP;
  priceCard?: CLP;
  cardName?: string | null;
  productUrl: string;
  storeUrl: string;
}

/** Mensaje en texto plano (Telegram y asunto/cuerpo del correo). */
export function formatAlertText(m: AlertMessageInput): { subject: string; text: string } {
  const headline = m.reasons[0] ?? "Cambio de precio";
  const price = m.priceNoCard != null ? formatCLP(m.priceNoCard) : "";
  const lines = [
    `🔔 ${m.productName}`,
    `${m.storeName}: ${price}${m.priceCard != null ? ` · ${formatCLP(m.priceCard)} con ${m.cardName ?? "tarjeta"}` : ""}`,
    ...m.reasons.map((r) => `• ${r}`),
    "",
    `Ver historial: ${m.productUrl}`,
    `Ir a la tienda: ${m.storeUrl}`,
  ];
  return { subject: `${headline}: ${m.productName}${price ? ` a ${price}` : ""}`.slice(0, 150), text: lines.join("\n") };
}
