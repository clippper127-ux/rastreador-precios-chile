import { parseListingUrl } from "./adapters";
import type { AdapterContext } from "./adapter";
import type { SearchResult } from "./types";

/*
 * SoloTodo (solotodo.cl): comparador chileno con API pública y sin clave (publicapi.solotodo.com).
 * Reúne precios de Falabella, Paris, Ripley, Lider, PC Factory y otras tiendas que bloquean a nuestro servidor.
 * Uso moderado: pocas requests, caché y User-Agent honesto. Fuerte en tecnología y electro; débil en supermercado.
 *
 * Precios: "normal_price" = cualquier medio de pago; "offer_price" = con el medio de pago preferente de la tienda
 * (p. ej. "Tarjeta Abcdin" o transferencia). Por eso la oferta se guarda como precio con tarjeta/medio específico.
 */

export const SOLOTODO_API = "https://publicapi.solotodo.com";
const CHILE = 1;

/** Tiendas de SoloTodo (id) → nuestras tiendas. Los "Marketplace" (vendedores terceros) se ignoran. */
export const SOLOTODO_STORES: Record<number, string> = {
  9: "falabella",
  11: "paris",
  18: "ripley",
  43: "lider",
  12: "pcfactory",
  87: "hites",
  5: "lapolar",
  30: "abcdin",
  67: "sodimac",
  170: "tottus",
  197: "jumbo",
  4088: "santaisabel",
  260: "mercadolibre",
};

/** Medio de pago del precio "oferta" de SoloTodo, por tienda (campo preferred_payment_method de /stores/, 2026-11-25). */
const PAYMENT: Record<number, string> = {
  9: "Tarjeta CMR",
  11: "Tarjeta Cencosud",
  18: "Tarjeta Ripley",
  43: "Tarjeta Lider BCI",
  87: "Tarjeta Hites",
  5: "Tarjeta La Polar",
  30: "Tarjeta Abcdin",
  67: "Tarjeta CMR",
  170: "Tarjeta CMR",
};

export interface SoloTodoEntity {
  id: number;
  name: string;
  store: number;
  sku: string | null;
  ean: string | null;
  external_url: string;
  picture_urls?: string[] | null;
  seller?: unknown;
  active_registry: { is_available: boolean; normal_price: string; offer_price: string } | null;
  product?: { id: number; name: string } | null;
}

export type SoloTodoOffer = SearchResult & { solotodoEntityId: number };

const clp = (s: string | undefined | null) => {
  const n = s == null ? NaN : Math.round(Number(s));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Convierte una "entity" de SoloTodo (una publicación en una tienda) en precio para nuestra tienda, si la seguimos. */
export function offerFromEntity(e: SoloTodoEntity, brand?: string): SoloTodoOffer | undefined {
  const storeId = SOLOTODO_STORES[e.store];
  if (!storeId || !e.active_registry) return undefined;
  const parsed = parseListingUrl(e.external_url);
  if (!parsed.ok || parsed.storeId !== storeId) return undefined;
  const normal = clp(e.active_registry.normal_price);
  const offer = clp(e.active_registry.offer_price);
  const withPayment = offer && normal && offer < normal ? offer : undefined;
  return {
    solotodoEntityId: e.id,
    storeId,
    url: parsed.url,
    title: (e.name || e.product?.name || "").trim(),
    brand,
    sku: e.sku ?? undefined,
    ean: e.ean ?? undefined,
    imageUrl: e.picture_urls?.[0] ?? undefined,
    priceNormal: normal ?? offer,
    priceCard: withPayment,
    cardName: withPayment ? (PAYMENT[e.store] ?? "Medio de pago específico") : undefined,
    stockStatus: e.active_registry.is_available ? "in_stock" : "out_of_stock",
    sellerType: e.seller ? "third_party" : "store",
  };
}

async function getJson<T>(ctx: AdapterContext, url: string): Promise<T> {
  const res = await ctx.fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`SoloTodo respondió ${res.status}`);
  return (await res.json()) as T;
}

interface BrowseResponse {
  results: { product_entries: { product: { id: number; name: string; brand?: { name: string } } }[] }[];
}
interface AvailableResponse {
  results: { product: { id: number; name: string; brand?: { name: string } }; entities: SoloTodoEntity[] }[];
}

/**
 * Busca en SoloTodo y devuelve precios por tienda (solo tiendas que seguimos y fichas que reconocemos).
 * 2 requests: búsqueda (máx. `limit` productos) + publicaciones disponibles de esos productos.
 */
export async function solotodoSearch(query: string, ctx: AdapterContext, limit = 12): Promise<SoloTodoOffer[]> {
  const browse = await getJson<BrowseResponse>(
    ctx,
    `${SOLOTODO_API}/products/browse/?search=${encodeURIComponent(query)}&countries=${CHILE}&page_size=${limit}&exclude_refurbished=true`,
  );
  const products = browse.results.flatMap((r) => r.product_entries.map((e) => e.product)).slice(0, limit);
  if (!products.length) return [];
  const ids = products.map((p) => `ids=${p.id}`).join("&");
  const avail = await getJson<AvailableResponse>(
    ctx,
    `${SOLOTODO_API}/products/available_entities/?${ids}&countries=${CHILE}&exclude_refurbished=true`,
  );
  const out: SoloTodoOffer[] = [];
  for (const r of avail.results) {
    const brand = r.product.brand?.name ?? products.find((p) => p.id === r.product.id)?.brand?.name;
    for (const e of r.entities) {
      const o = offerFromEntity(e, brand);
      // Se mantiene el título de la tienda (la búsqueda exacta lo compara con lo que escribiste);
      // el producto de SoloTodo se usa para agrupar sin mezclar versiones.
      if (o && o.title) out.push({ ...o, solotodoProductId: r.product.id });
    }
  }
  return out;
}

/** Precio actual de una publicación ya conocida (1 request). */
export async function solotodoEntity(id: number, ctx: AdapterContext): Promise<SoloTodoEntity> {
  return getJson<SoloTodoEntity>(ctx, `${SOLOTODO_API}/entities/${id}/`);
}
