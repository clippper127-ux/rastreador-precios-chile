import { toCLP } from "./price";
import type { CLP, StockStatus } from "./types";

/*
 * Extracción de datos estructurados sin DOM (funciona en Node, en el worker y en la extensión).
 * Orden de preferencia en todos los adaptadores: API → JSON-LD (schema.org) → JSON embebido → HTML.
 */

type Json = Record<string, unknown>;

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(decodeEntities(text));
    } catch {
      return undefined;
    }
  }
}

/** Todos los nodos JSON-LD de la página, aplanando arrays y @graph. */
export function extractJsonLd(html: string): Json[] {
  const out: Json[] = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const visit = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object") {
      const obj = node as Json;
      out.push(obj);
      if (Array.isArray(obj["@graph"])) (obj["@graph"] as unknown[]).forEach(visit);
    }
  };
  for (const m of html.matchAll(re)) visit(tryParse(m[1]!.trim()));
  return out;
}

/** JSON de Next.js (`<script id="__NEXT_DATA__">`), si la tienda usa Next. */
export function extractNextData(html: string): Json | undefined {
  const m = html.match(/<script[^>]*id\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  const parsed = m ? tryParse(m[1]!.trim()) : undefined;
  return parsed && typeof parsed === "object" ? (parsed as Json) : undefined;
}

function hasType(node: Json, type: string): boolean {
  const t = node["@type"];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

export function findJsonLdOfType(nodes: Json[], type: string): Json[] {
  return nodes.filter((n) => hasType(n, type));
}

/** URLs de un ItemList (páginas de búsqueda / categoría). */
export function itemListUrls(nodes: Json[]): string[] {
  const urls: string[] = [];
  for (const list of findJsonLdOfType(nodes, "ItemList")) {
    const items = Array.isArray(list.itemListElement) ? (list.itemListElement as Json[]) : [];
    for (const it of items) {
      const item = (it.item as Json | undefined) ?? it;
      const url = (item.url ?? it.url) as string | undefined;
      if (typeof url === "string") urls.push(url);
    }
  }
  return urls;
}

const AVAILABILITY: Record<string, StockStatus> = {
  instock: "in_stock",
  instoreonly: "in_stock",
  onlineonly: "in_stock",
  limitedavailability: "in_stock",
  preorder: "preorder",
  presale: "preorder",
  backorder: "preorder",
  outofstock: "out_of_stock",
  soldout: "out_of_stock",
  discontinued: "discontinued",
};

export function availabilityToStock(value: unknown): StockStatus {
  if (typeof value !== "string") return "unknown";
  const key = value.split("/").pop()!.toLowerCase();
  return AVAILABILITY[key] ?? "unknown";
}

export interface JsonLdProduct {
  title?: string;
  brand?: string;
  sku?: string;
  ean?: string;
  imageUrl?: string;
  url?: string;
  /** Precio de la oferta principal (lo que se paga sin tarjeta). */
  price?: CLP;
  /** Si la oferta trae un precio de lista / "antes". */
  listPrice?: CLP;
  stockStatus: StockStatus;
  seller?: string;
}

function first<T>(v: T | T[] | undefined): T | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function str(v: unknown): string | undefined {
  if (typeof v === "string") return decodeEntities(v).trim() || undefined;
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object" && typeof (v as Json).name === "string") return str((v as Json).name);
  return undefined;
}

/** Lee un nodo schema.org/Product. Precios convertidos a CLP enteros; ignora monedas distintas de CLP. */
export function parseJsonLdProduct(node: Json): JsonLdProduct {
  const offersRaw = node.offers as Json | Json[] | undefined;
  const offers: Json[] = Array.isArray(offersRaw) ? offersRaw : offersRaw ? [offersRaw] : [];
  const flat: Json[] = offers.flatMap((o) =>
    hasType(o, "AggregateOffer") && Array.isArray(o.offers) ? (o.offers as Json[]) : [o],
  );
  const clp = flat.filter((o) => !o.priceCurrency || o.priceCurrency === "CLP");

  const prices = clp
    .map((o) => toCLP(o.price ?? o.lowPrice))
    .filter((p): p is CLP => p != null);
  const listPrices = clp
    .flatMap((o) => {
      const spec = o.priceSpecification as Json | Json[] | undefined;
      const specs = Array.isArray(spec) ? spec : spec ? [spec] : [];
      return specs
        .filter((s) => String(s.priceType ?? "").toLowerCase().includes("listprice") || String(s.priceType ?? "").toLowerCase().includes("strikethrough"))
        .map((s) => toCLP(s.price));
    })
    .filter((p): p is CLP => p != null);

  const image = first(node.image as unknown);
  const imageUrl = typeof image === "string" ? image : str((image as Json | undefined)?.url);

  return {
    title: str(node.name),
    brand: str(node.brand),
    sku: str(node.sku) ?? str(node.mpn),
    ean: str(node.gtin13) ?? str(node.gtin) ?? str(node.gtin14) ?? str(node.gtin12),
    imageUrl,
    url: str(node.url),
    price: prices.length ? Math.min(...prices) : undefined,
    listPrice: listPrices.length ? Math.max(...listPrices) : undefined,
    stockStatus: availabilityToStock(first(clp.map((o) => o.availability))),
    seller: str(first(clp.map((o) => o.seller))),
  };
}
