import { variantOf } from "./search";

/*
 * Precio por unidad desde el título: "Detergente 3 L" → $/L, "Arroz 1 kg" → $/kg, "Pack 6 x 350 ml" → $/L
 * (6 × 350 ml), "Pañales 50 un" → $ c/u. Sirve para comparar formatos distintos en supermercado y farmacia.
 */

export interface UnitPrice {
  /** Precio por kg, L o unidad, redondeado. */
  value: number;
  unit: "kg" | "L" | "un";
  /** Cantidad total que se usó para calcularlo (en g, ml o unidades). */
  qty: number;
}

export function unitPriceFromTitle(title: string, price: number | null | undefined): UnitPrice | undefined {
  if (!price || price <= 0) return undefined;
  const v = variantOf(title);
  const num = (t: string | undefined) => (t ? Number(t.replace(/[a-z]+$/, "").replace("_", ".")) : undefined);
  const g = num(v.find((t) => /^\d+(_\d+)?g$/.test(t)));
  const ml = num(v.find((t) => /^\d+(_\d+)?ml$/.test(t)));
  const un = num(v.find((t) => /^\d+un$/.test(t)));
  // Con un solo tipo de medida es inequívoco; si hay peso y volumen a la vez, mejor no adivinar.
  if (g && ml) return undefined;
  const packs = un && un > 1 ? un : 1;
  if (g) {
    const qty = g * packs;
    return { value: Math.round((price / qty) * 1000), unit: "kg", qty };
  }
  if (ml) {
    const qty = ml * packs;
    return { value: Math.round((price / qty) * 1000), unit: "L", qty };
  }
  if (un && un > 1) return { value: Math.round(price / un), unit: "un", qty: un };
  return undefined;
}

/** "$1.990/kg", "$12.450/L", "$350 c/u". */
export function formatUnitPrice(u: UnitPrice): string {
  const n = `$${u.value.toLocaleString("es-CL")}`;
  return u.unit === "un" ? `${n} c/u` : `${n}/${u.unit}`;
}
