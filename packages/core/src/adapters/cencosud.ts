import { AdapterError, type AdapterContext, type StoreAdapter } from "../adapter";
import { toCLP } from "../price";
import { extractJsonLd, findJsonLdOfType, itemListUrls, parseJsonLdProduct } from "../structured";
import type { CLP, ProductSnapshot, SearchResult } from "../types";
import { hostMatches } from "../url";

/**
 * Supermercados Cencosud (Jumbo, Santa Isabel): sitio sobre catálogo VTEX.
 * - Ficha: JSON-LD Product (nombre, marca, EAN, stock, precio que se paga).
 * - Precio "antes": el <span class="... line-through ..."> junto al precio; precio por unidad: "ppum-price".
 * - Búsqueda: JSON-LD ItemList con nombre, URL, imagen y precio de cada producto.
 */

export interface CencosudConfig {
  id: string;
  name: string;
  domain: string;
}

const MONEY = /\$\s*(?:<!--\s*-->)?\s*([\d.]+)/;

/** Primer precio tachado del HTML que sea mayor que el precio que se paga (el "antes" de la ficha). */
export function strikePriceAfter(html: string, paid?: CLP): CLP | undefined {
  for (const m of html.matchAll(/class="[^"]*line-through[^"]*"[^>]*>([\s\S]{0,60}?)<\/span>/g)) {
    const v = toCLP(m[1]!.match(MONEY)?.[1]);
    if (v != null && (paid == null || v > paid)) return v;
  }
  return undefined;
}

/** "$1.490 x kg" → { price: 1490, unit: "kg" }. Solo el primero de la página (el de la ficha). */
export function unitPrice(html: string): { price: CLP; unit: string } | undefined {
  const m = html.match(/ppum-price[\s\S]{0,400}?\$\s*([\d.]+)\s*x\s*([a-zA-Z]{1,6})/);
  const price = toCLP(m?.[1]);
  return price != null && m?.[2] ? { price, unit: m[2].toLowerCase() } : undefined;
}

export function parseCencosudProduct(html: string, url: string, storeId: string): ProductSnapshot & { unitPrice?: { price: CLP; unit: string } } {
  const node = findJsonLdOfType(extractJsonLd(html), "Product")[0];
  if (!node) throw new AdapterError("parse", "La ficha no trae JSON-LD Product", storeId);
  const ld = parseJsonLdProduct(node);
  if (!ld.title || ld.price == null) throw new AdapterError("parse", "JSON-LD sin nombre o precio", storeId);

  // El tachado de la ficha aparece después del <h1>; así no se toma el de recomendados de arriba.
  const afterTitle = html.slice(Math.max(0, html.search(/<h1[\s>]/)));
  const strike = strikePriceAfter(afterTitle, ld.price);
  return {
    url,
    title: ld.title,
    brand: ld.brand,
    sku: ld.sku,
    ean: ld.ean,
    imageUrl: ld.imageUrl,
    priceNormal: strike ?? ld.price,
    priceOffer: strike != null ? ld.price : undefined,
    stockStatus: ld.stockStatus,
    sellerType: "store",
    source: "server",
    fetchedAt: new Date(),
    unitPrice: unitPrice(afterTitle),
  };
}

export function parseCencosudSearch(html: string, storeId: string): SearchResult[] {
  const out: SearchResult[] = [];
  for (const list of findJsonLdOfType(extractJsonLd(html), "ItemList")) {
    const items = Array.isArray(list.itemListElement) ? (list.itemListElement as Record<string, unknown>[]) : [];
    for (const it of items) {
      const node = (it.item as Record<string, unknown> | undefined) ?? it;
      const p = parseJsonLdProduct(node);
      const url = (p.url ?? (it.url as string | undefined)) as string | undefined;
      if (!p.title || !url || p.price == null) continue;
      out.push({
        storeId,
        url,
        title: p.title,
        brand: p.brand,
        ean: p.ean,
        imageUrl: p.imageUrl,
        priceNormal: p.price,
        stockStatus: p.stockStatus,
        sellerType: "store",
      });
    }
  }
  return out;
}

export function createCencosudAdapter(cfg: CencosudConfig): StoreAdapter {
  const searchUrl = (q: string) => `https://www.${cfg.domain}/busqueda?ft=${encodeURIComponent(q)}`;
  return {
    id: cfg.id,
    name: cfg.name,
    domain: cfg.domain,
    searchMode: "server",
    searchUrl,
    matchesUrl: (url) => hostMatches(url, cfg.domain) && /\/p\/?$/.test(new URL(url).pathname),
    async getProduct(url: string, ctx: AdapterContext) {
      const res = await ctx.fetch(url);
      if (res.status === 404 || res.status === 410) throw new AdapterError("not_found", `HTTP ${res.status}`, cfg.id, res.status);
      return parseCencosudProduct(await res.text(), url, cfg.id);
    },
    async search(query: string, ctx: AdapterContext) {
      const res = await ctx.fetch(searchUrl(query));
      const html = await res.text();
      const results = parseCencosudSearch(html, cfg.id);
      return results.length
        ? results
        : itemListUrls(extractJsonLd(html)).map((u) => ({ storeId: cfg.id, url: u, title: "", stockStatus: "unknown" as const }));
    },
  };
}

export const jumbo = createCencosudAdapter({ id: "jumbo", name: "Jumbo", domain: "jumbo.cl" });
export const santaisabel = createCencosudAdapter({ id: "santaisabel", name: "Santa Isabel", domain: "santaisabel.cl" });
