import { AdapterError, type AdapterContext, type StoreAdapter } from "../adapter";
import { toCLP } from "../price";
import { extractJsonLd, findJsonLdOfType, itemListUrls, parseJsonLdProduct } from "../structured";
import type { CLP, ProductSnapshot, SearchResult } from "../types";
import { hostMatches } from "../url";

/**
 * Adaptador para tiendas en Salesforce Commerce Cloud (Hites, La Polar, Abcdin).
 * - Ficha: JSON-LD Product (título, SKU, marca, imagen, stock, precio pagado) + bloque `.prices`
 *   del HTML para el precio normal ("list") y, si existe, el precio con tarjeta de la tienda.
 * - Búsqueda: JSON-LD ItemList (solo donde robots.txt la permite: Hites sí, La Polar/Abcdin no).
 */

export interface SfccConfig {
  id: string;
  name: string;
  domain: string;
  /** null = la búsqueda no está permitida por robots.txt → modo "link". */
  searchUrl: ((q: string) => string) | null;
  cardName?: string;
  /** Patrón de URL de ficha de producto. */
  productPath: RegExp;
}

interface PriceBlock {
  sales?: CLP;
  list?: CLP;
  card?: CLP;
}

function valueIn(fragment: string | undefined): CLP | undefined {
  if (!fragment) return undefined;
  return toCLP(fragment.match(/class="value"[^>]*content="([\d.]+)"/)?.[1]);
}

/** Separa cada bloque `class="prices..."` y lee sus precios "sales", "list" y tarjeta. */
export function parsePriceBlocks(html: string): PriceBlock[] {
  // Ficha: class="prices js-update-price"; listado de búsqueda: class="prices-section".
  const parts = html.split(/class="prices(?:-section)?[\s"]/).slice(1);
  return parts.map((part) => {
    const block = part.slice(0, 6_000);
    const sales = block.match(/class="price-item sales[^"]*"([\s\S]*?)<\/h5>/)?.[1];
    const list = block.match(/class="price-item list[^"]*"([\s\S]*?)<\/(?:span|h5)>\s*<\/(?:span|h5)>/)?.[1]
      ?? block.match(/class="price-item list[^"]*"([\s\S]{0,400})/)?.[1];
    const card = block.match(/class="price-item[^"]*(?:card|tarjeta|hites-price|cmr)[^"]*"([\s\S]{0,400})/i)?.[1];
    return { sales: valueIn(sales), list: valueIn(list), card: valueIn(card) };
  });
}

/** Elige el bloque de precios de la ficha principal: el que coincide con el precio del JSON-LD. */
export function pickMainBlock(blocks: PriceBlock[], ldPrice?: CLP): PriceBlock | undefined {
  if (ldPrice != null) {
    const match = blocks.find((b) => b.sales === ldPrice || (b.sales == null && b.list === ldPrice));
    if (match) return match;
  }
  return blocks[0];
}

export function parseSfccProduct(html: string, url: string, cfg: Pick<SfccConfig, "id" | "cardName">): ProductSnapshot {
  const product = findJsonLdOfType(extractJsonLd(html), "Product")[0];
  if (!product) {
    throw new AdapterError("parse", "La ficha no trae JSON-LD Product", cfg.id);
  }
  const ld = parseJsonLdProduct(product);
  if (!ld.title) throw new AdapterError("parse", "JSON-LD sin nombre de producto", cfg.id);

  const block = pickMainBlock(parsePriceBlocks(html), ld.price);
  const priceOffer = block?.sales ?? (block?.list == null ? ld.price : undefined);
  const priceNormal = block?.list ?? ld.listPrice ?? (priceOffer == null ? ld.price : undefined);

  return {
    url,
    title: ld.title,
    brand: ld.brand,
    sku: ld.sku,
    ean: ld.ean,
    imageUrl: ld.imageUrl,
    priceNormal,
    // Si oferta y normal son iguales, no hay oferta real.
    priceOffer: priceOffer != null && priceOffer !== priceNormal ? priceOffer : undefined,
    priceCard: block?.card,
    cardName: block?.card ? cfg.cardName : undefined,
    stockStatus: ld.stockStatus,
    sellerType: "store",
    source: "server",
    fetchedAt: new Date(),
  };
}

function decodeAttr(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&([a-z])(acute|tilde|uml);/gi, (_, c: string, k: string) =>
      ({ acute: { a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" }, tilde: { n: "ñ", N: "Ñ" }, uml: { u: "ü" } } as Record<string, Record<string, string>>)[k.toLowerCase()]?.[c] ?? c,
    )
    .replace(/&amp;/g, "&");
}

/**
 * Listado de búsqueda SFCC: cada producto trae un JSON de analítica (data-gtmselectitem) con nombre, marca,
 * precio, precio con tarjeta y vendedor (marketplace); el precio normal sale del bloque .prices del producto.
 */
export function parseSfccSearch(html: string, cfg: Pick<SfccConfig, "id" | "domain" | "cardName">): SearchResult[] {
  const parts = html.split(/<div class="product-tile /).slice(1);
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  for (const part of parts.slice(0, 40)) {
    const tile = part.slice(0, 15_000);
    const raw = tile.match(/data-gtmselectitem="([^"]+)"/)?.[1];
    const href = tile.match(/href="([^"#]+\.html)[^"]*"/)?.[1];
    if (!raw || !href) continue;
    let item: { item_name?: string; item_brand?: string; price?: number; hites_price?: number | null; marketplace?: string } | undefined;
    try {
      const data = JSON.parse(decodeAttr(raw)) as { item?: typeof item };
      item = data.item;
    } catch {
      continue;
    }
    if (!item?.item_name) continue;
    const url = new URL(href, `https://www.${cfg.domain}`).toString();
    if (seen.has(url)) continue;
    seen.add(url);
    const block = parsePriceBlocks(tile)[0];
    const price = toCLP(item.price);
    const list = block?.list;
    const card = toCLP(item.hites_price ?? undefined) ?? block?.card;
    const marketplace = item.marketplace?.trim();
    const own = !marketplace || /^hites|^la ?polar|^abc/i.test(marketplace);
    out.push({
      storeId: cfg.id,
      url,
      title: decodeAttr(item.item_name).trim(),
      brand: item.item_brand ? decodeAttr(item.item_brand) : undefined,
      imageUrl: tile.match(/<img[^>]+src="(https:[^"]+)"/)?.[1],
      priceNormal: list ?? price,
      priceOffer: list != null && price != null && price < list ? price : undefined,
      priceCard: card != null && price != null && card < price ? card : undefined,
      cardName: card != null && price != null && card < price ? cfg.cardName : undefined,
      stockStatus: "in_stock",
      seller: marketplace,
      sellerType: own ? "store" : "third_party",
    });
  }
  return out;
}

export function createSfccAdapter(cfg: SfccConfig): StoreAdapter {
  return {
    id: cfg.id,
    name: cfg.name,
    domain: cfg.domain,
    searchMode: cfg.searchUrl ? "server" : "link",
    searchUrl: (q) => (cfg.searchUrl ?? ((x: string) => `https://www.${cfg.domain}/search?q=${encodeURIComponent(x)}`))(q),
    matchesUrl: (url) => hostMatches(url, cfg.domain) && cfg.productPath.test(new URL(url).pathname),

    async getProduct(url: string, ctx: AdapterContext) {
      const res = await ctx.fetch(url);
      if (res.status === 404 || res.status === 410) throw new AdapterError("not_found", `HTTP ${res.status}`, cfg.id, res.status);
      const html = await res.text();
      return parseSfccProduct(html, url, cfg);
    },

    ...(cfg.searchUrl && {
      async search(query: string, ctx: AdapterContext): Promise<SearchResult[]> {
        const res = await ctx.fetch(cfg.searchUrl!(query));
        const html = await res.text();
        const tiles = parseSfccSearch(html, cfg);
        if (tiles.length) return tiles;
        // Respaldo: el ItemList trae URLs sin precios.
        return itemListUrls(extractJsonLd(html)).slice(0, 20).map((u) => ({
          storeId: cfg.id,
          url: new URL(u, `https://www.${cfg.domain}`).toString(),
          title: "",
          stockStatus: "unknown" as const,
        }));
      },
    }),
  };
}

export const hites = createSfccAdapter({
  id: "hites",
  name: "Hites",
  domain: "hites.com",
  searchUrl: (q) => `https://www.hites.com/search?q=${encodeURIComponent(q)}`,
  cardName: "Tarjeta Hites",
  productPath: /\.html$/,
});

export const lapolar = createSfccAdapter({
  id: "lapolar",
  name: "La Polar",
  domain: "lapolar.cl",
  searchUrl: null,
  cardName: "Tarjeta La Polar",
  productPath: /\.html$/,
});

export const abcdin = createSfccAdapter({
  id: "abcdin",
  name: "Abcdin",
  domain: "abc.cl",
  searchUrl: null,
  cardName: "Tarjeta abcvisa",
  productPath: /\.html$/,
});
