import { toCLP } from "../price";
import { parseJsonLdProduct } from "../structured";
import type { CLP, SellerType, StockStatus } from "../types";

/*
 * Captura desde el navegador (extensión). Todo aquí es puro (sin DOM) para poder testearlo:
 * la extensión junta "candidatos" desde la página que el usuario está viendo y estas funciones deciden.
 */

/** Tiendas que se actualizan con la extensión (bloquean al servidor). */
export interface ExtensionStore {
  id: string;
  name: string;
  /** Dominio registrable; se aceptan subdominios (simple.ripley.cl). */
  domain: string;
  productPath: RegExp;
  cardName: string;
  /** Nombres de vendedor que significan "vendido por la tienda". */
  ownSellers: RegExp;
  /** "falabella": misma plataforma que Falabella (Sodimac, Tottus) → __NEXT_DATA__ con productData/results. */
  platform?: "falabella";
}

export const EXTENSION_STORES: ExtensionStore[] = [
  {
    id: "falabella",
    name: "Falabella",
    domain: "falabella.com",
    productPath: /^\/falabella-cl\/product\/\d+/,
    cardName: "CMR",
    ownSellers: /^(falabella|sodimac|tottus)/i,
    platform: "falabella",
  },
  {
    id: "sodimac",
    name: "Sodimac",
    domain: "sodimac.cl",
    productPath: /^\/sodimac-cl\/(articulo|product)\/\d+/,
    cardName: "CMR",
    ownSellers: /^(sodimac|falabella|homecenter)/i,
    platform: "falabella",
  },
  {
    id: "tottus",
    name: "Tottus",
    domain: "tottus.cl",
    productPath: /^\/tottus-cl\/(articulo|product)\/\d+/,
    cardName: "CMR",
    ownSellers: /^(tottus|falabella)/i,
    platform: "falabella",
  },
  {
    id: "pcfactory",
    name: "PC Factory",
    domain: "pcfactory.cl",
    productPath: /^\/producto\/\d+/,
    cardName: "precio efectivo/transferencia",
    ownSellers: /^pc ?factory/i,
  },
  {
    id: "paris",
    name: "Paris",
    domain: "paris.cl",
    productPath: /-\d{6,}\.html$/,
    cardName: "Tarjeta Cencosud",
    ownSellers: /^paris/i,
  },
  {
    id: "ripley",
    name: "Ripley",
    domain: "ripley.cl",
    productPath: /-\d{8,}p$/,
    cardName: "Tarjeta Ripley",
    ownSellers: /^ripley/i,
  },
  {
    // El servidor recibe "verificación de cuenta" (barrera anti-bots): se lee desde tu navegador.
    id: "mercadolibre",
    name: "Mercado Libre",
    domain: "mercadolibre.cl",
    // Publicación: /MLC-123456789-titulo-_JM · Catálogo: /titulo/p/MLC12345 · Producto de vendedor: /up/MLCU123
    productPath: /^\/MLC-?\d+|\/p\/MLC\d+|\/up\/MLCU\d+/i,
    cardName: "Mercado Pago",
    ownSellers: /tienda oficial|mercado ?libre/i,
  },
  {
    id: "lider",
    name: "Lider",
    domain: "lider.cl",
    productPath: /\/ip\//,
    cardName: "Tarjeta Lider BCI",
    ownSellers: /^(lider|walmart)/i,
  },
];

export function extensionStoreForUrl(url: string): ExtensionStore | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return EXTENSION_STORES.find((s) => host === s.domain || host.endsWith(`.${s.domain}`));
  } catch {
    return undefined;
  }
}

/** Lo que la extensión envía al backend (y lo que el panel muestra antes de enviar). */
export interface CapturedProduct {
  url: string;
  title: string;
  brand?: string;
  sku?: string;
  ean?: string;
  imageUrl?: string;
  priceNormal?: CLP;
  priceOffer?: CLP;
  priceCard?: CLP;
  cardName?: string;
  stockStatus: StockStatus;
  seller?: string;
  sellerType?: SellerType;
}

// ─── Clasificación genérica de precios visibles ──────────────────────────────

export interface PriceCandidate {
  value: CLP;
  /** Texto tachado (line-through). */
  crossed: boolean;
  /** Texto cercano: "Normal", "Internet", "T. Crédito", "Oferta"... */
  label: string;
  /** Hay un logo/ícono de tarjeta junto al precio (alt/aria/clase con tarjeta, cmr, cencosud...). */
  cardHint: boolean;
}

const CARD_RE = /t\.?\s*cr[eé]dito|tarjeta|cmr|cencosud|ripley|lider\s*bci|card|credit/i;
const NORMAL_RE = /normal|antes|lista|regular|referencia/i;
const OFFER_RE = /internet|oferta|evento|online|precio|ahora|todo medio/i;

/**
 * Decide normal / oferta / tarjeta a partir de lo que se ve junto al título.
 * Reglas, en orden: tarjeta por etiqueta o logo; normal por tachado o etiqueta; oferta = el menor del resto.
 * Si solo hay un precio, es el normal (lo que paga cualquiera).
 */
export function classifyPriceCandidates(cands: PriceCandidate[]): Pick<CapturedProduct, "priceNormal" | "priceOffer" | "priceCard"> {
  const valid = cands.filter((c) => Number.isInteger(c.value) && c.value >= 100 && c.value < 100_000_000);
  if (!valid.length) return {};

  const card = valid.filter((c) => c.cardHint || CARD_RE.test(c.label));
  const rest = valid.filter((c) => !card.includes(c));
  const normal = rest.filter((c) => c.crossed || (NORMAL_RE.test(c.label) && !OFFER_RE.test(c.label)));
  const offer = rest.filter((c) => !normal.includes(c));

  const min = (xs: PriceCandidate[]) => (xs.length ? Math.min(...xs.map((x) => x.value)) : undefined);
  const max = (xs: PriceCandidate[]) => (xs.length ? Math.max(...xs.map((x) => x.value)) : undefined);

  let priceNormal = max(normal);
  let priceOffer = min(offer);
  // Un solo precio sin tachar y sin "normal": ese es el precio normal.
  if (priceNormal == null && priceOffer != null && offer.length === 1) {
    priceNormal = priceOffer;
    priceOffer = undefined;
  }
  if (priceOffer != null && priceNormal != null && priceOffer >= priceNormal) priceOffer = undefined;

  const payWithoutCard = priceOffer ?? priceNormal;
  let priceCard = min(card);
  if (priceCard != null && payWithoutCard != null && priceCard >= payWithoutCard) priceCard = undefined;

  return { priceNormal, priceOffer, priceCard };
}

// ─── Falabella: __NEXT_DATA__ (exacto) ────────────────────────────────────────

interface FalabellaPrice {
  type: string;
  price: string[];
  crossed?: boolean;
}

function falabellaPrices(prices: FalabellaPrice[] | undefined) {
  const get = (...types: string[]) => {
    const values = (prices ?? [])
      .filter((p) => types.includes(p.type))
      .map((p) => toCLP(p.price?.[0]))
      .filter((v): v is CLP => v != null);
    return values.length ? Math.min(...values) : undefined;
  };
  const priceNormal = get("normalPrice");
  const priceOffer = get("internetPrice", "eventPrice");
  const priceCard = get("cmrPrice");
  return { priceNormal: priceNormal ?? priceOffer, priceOffer: priceNormal != null ? priceOffer : undefined, priceCard };
}

/** Lee la ficha (plataforma Falabella: Falabella, Sodimac, Tottus) desde __NEXT_DATA__. Elige la variante del skuId de la URL. */
export function falabellaFromNextData(nextData: unknown, url: string, store: ExtensionStore = EXTENSION_STORES[0]!): CapturedProduct | null {
  const pd = (nextData as { props?: { pageProps?: { productData?: Record<string, unknown> } } })?.props?.pageProps
    ?.productData as
    | {
        id: string;
        name: string;
        brandName?: string;
        primaryVariantId?: string;
        variants?: {
          id: string;
          name?: string;
          isPurchaseable?: boolean;
          prices?: FalabellaPrice[];
          offerings?: { sellerName?: string }[];
          medias?: { url?: string }[];
        }[];
      }
    | undefined;
  if (!pd?.variants?.length) return null;

  const skuInUrl = new URL(url).pathname.split("/").filter(Boolean).pop();
  const variant =
    pd.variants.find((v) => v.id === skuInUrl) ??
    pd.variants.find((v) => v.id === pd.primaryVariantId) ??
    pd.variants[0]!;
  const seller = variant.offerings?.[0]?.sellerName?.trim();

  return {
    url,
    title: (variant.name ?? pd.name).replace(/\s+/g, " ").trim(),
    brand: pd.brandName,
    sku: variant.id,
    imageUrl: variant.medias?.[0]?.url,
    ...falabellaPrices(variant.prices),
    cardName: variant.prices?.some((p) => p.type === "cmrPrice") ? store.cardName : undefined,
    stockStatus: variant.isPurchaseable === false ? "out_of_stock" : "in_stock",
    seller,
    sellerType: seller ? (store.ownSellers.test(seller) ? "store" : "third_party") : undefined,
  };
}

/** Item de resultados de búsqueda (plataforma Falabella: mismo formato de precios). */
export function falabellaFromSearchItem(
  item: {
    url: string;
    displayName: string;
    brand?: string;
    skuId?: string;
    sellerName?: string;
    prices?: FalabellaPrice[];
  },
  store: ExtensionStore = EXTENSION_STORES[0]!,
): CapturedProduct {
  return {
    url: item.url,
    title: item.displayName,
    brand: item.brand,
    sku: item.skuId,
    ...falabellaPrices(item.prices),
    cardName: item.prices?.some((p) => p.type === "cmrPrice") ? store.cardName : undefined,
    stockStatus: "unknown",
    seller: item.sellerName,
    sellerType: item.sellerName ? (store.ownSellers.test(item.sellerName) ? "store" : "third_party") : undefined,
  };
}

// ─── Genérico: JSON-LD + metadatos + precios visibles ─────────────────────────

export interface GenericPageData {
  url: string;
  jsonLdProduct?: Record<string, unknown>;
  ogTitle?: string;
  ogImage?: string;
  h1?: string;
  candidates: PriceCandidate[];
  /** Texto "Agotado", "Sin stock"... cerca del botón de compra. */
  outOfStockHint?: boolean;
  sellerText?: string;
}

export function genericCapture(page: GenericPageData, store: ExtensionStore): CapturedProduct | null {
  const ld = page.jsonLdProduct ? parseJsonLdProduct(page.jsonLdProduct) : undefined;
  const title = (page.h1 ?? ld?.title ?? page.ogTitle)?.replace(/\s+/g, " ").trim();
  if (!title) return null;

  let prices = classifyPriceCandidates(page.candidates);
  // Sin precios visibles reconocibles: usar el del JSON-LD como precio normal.
  if (prices.priceNormal == null && ld?.price != null) prices = { priceNormal: ld.listPrice ?? ld.price, priceOffer: ld.listPrice ? ld.price : undefined };

  const seller = page.sellerText?.trim() || ld?.seller;
  return {
    url: page.url,
    title,
    brand: ld?.brand,
    sku: ld?.sku,
    ean: ld?.ean,
    imageUrl: ld?.imageUrl ?? page.ogImage,
    ...prices,
    cardName: prices.priceCard != null ? store.cardName : undefined,
    stockStatus: page.outOfStockHint ? "out_of_stock" : ld && ld.stockStatus !== "unknown" ? ld.stockStatus : "in_stock",
    seller,
    sellerType: seller ? (store.ownSellers.test(seller) ? "store" : "third_party") : undefined,
  };
}

// ─── Validación del payload en el backend ─────────────────────────────────────

const STOCK = new Set<StockStatus>(["in_stock", "preorder", "out_of_stock", "discontinued", "unknown"]);

function price(v: unknown): CLP | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= 100 && v < 100_000_000 ? v : undefined;
}
function text(v: unknown, max: number): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
}
function httpsUrl(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString().slice(0, 1000) : undefined;
  } catch {
    return undefined;
  }
}

/** Valida y limpia lo que llega de la extensión. Devuelve null si no sirve. */
export function sanitizeCapture(input: unknown): CapturedProduct | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const url = httpsUrl(o.url);
  const title = text(o.title, 300);
  if (!url || !title) return null;
  const out: CapturedProduct = {
    url,
    title,
    brand: text(o.brand, 100),
    sku: text(o.sku, 100),
    ean: typeof o.ean === "string" && /^\d{8,14}$/.test(o.ean) ? o.ean : undefined,
    imageUrl: httpsUrl(o.imageUrl),
    priceNormal: price(o.priceNormal),
    priceOffer: price(o.priceOffer),
    priceCard: price(o.priceCard),
    cardName: text(o.cardName, 60),
    stockStatus: STOCK.has(o.stockStatus as StockStatus) ? (o.stockStatus as StockStatus) : "unknown",
    seller: text(o.seller, 120),
    sellerType: o.sellerType === "store" || o.sellerType === "official" || o.sellerType === "third_party" ? o.sellerType : undefined,
  };
  if (out.priceNormal == null && out.priceOffer == null && out.priceCard == null) return null;
  return out;
}

