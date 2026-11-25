import {
  classifyPriceCandidates,
  falabellaFromSearchItem,
  normalizeListingUrl,
  queryFromSearchUrl,
  type CapturedProduct,
  type ExtensionStore,
} from "@rastreador/core";
import { collectCandidates } from "./dom";

/*
 * Páginas de resultados de búsqueda de las tiendas que bloquean al servidor.
 * Solo lee lo que el usuario está viendo; se envía a la app cuando el usuario lo pide
 * (o automáticamente si abrió esta búsqueda desde la app, con #rq=<consulta>).
 */

const RQ_KEY = "rastreador:rq";

/** Consulta pedida desde la app: viene en #rq= y se guarda por pestaña (las tiendas cambian la URL al navegar). */
export function queryFromApp(): string | undefined {
  const m = location.hash.match(/[#&]rq=([^&]+)/);
  if (m) {
    const q = decodeURIComponent(m[1]!).slice(0, 120);
    try {
      sessionStorage.setItem(RQ_KEY, q);
    } catch {
      /* almacenamiento bloqueado */
    }
    return q;
  }
  try {
    return sessionStorage.getItem(RQ_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function isSearchPage(store: ExtensionStore): boolean {
  if (store.productPath.test(location.pathname)) return false;
  return !!queryFromSearchUrl(location.href) || !!queryFromApp();
}

const firstHref = location.href;

function falabellaResults(): CapturedProduct[] {
  // __NEXT_DATA__ solo es válido si no hubo navegación interna desde la carga.
  if (location.href !== firstHref) return [];
  try {
    const nd = JSON.parse(document.getElementById("__NEXT_DATA__")?.textContent ?? "null");
    const results = nd?.props?.pageProps?.results;
    return Array.isArray(results) ? results.filter((r) => r?.url && r?.displayName).map(falabellaFromSearchItem) : [];
  } catch {
    return [];
  }
}

/** Tarjeta de producto: sube desde el link hasta un contenedor con precio y poco texto. */
function tileFor(a: Element): HTMLElement | null {
  let el: HTMLElement | null = a as HTMLElement;
  for (let i = 0; i < 7 && el; i++) {
    const text = el.innerText ?? "";
    if (/\$\s?\d/.test(text) && text.length < 1500) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * Nombre del producto en la tarjeta. Orden de preferencia (no "el más largo": en varias tiendas el link
 * envuelve toda la tarjeta y su texto incluye precios y cuotas): nombre/título → alt de imagen → title → link.
 */
function titleIn(tile: HTMLElement, a: HTMLAnchorElement): string {
  const named = [...tile.querySelectorAll("[class*=name i],[class*=title i],h2,h3,h4")]
    .map((e) => e.textContent?.trim())
    .find((t) => !!t && t.length > 5 && t.length <= 150 && !t.includes("$"));
  const candidates = [named, tile.querySelector("img")?.getAttribute("alt"), a.getAttribute("title"), a.textContent?.trim()];
  const ok = candidates.find((t): t is string => !!t && t.length > 5 && t.length <= 150 && !t.includes("$"));
  return ok?.replace(/\s+/g, " ").trim() ?? "";
}

function genericResults(store: ExtensionStore): CapturedProduct[] {
  const seen = new Set<string>();
  const out: CapturedProduct[] = [];
  for (const a of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    let url: string;
    try {
      const u = new URL(a.href);
      if (!store.productPath.test(u.pathname)) continue;
      u.search = "";
      url = normalizeListingUrl(u.toString());
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    const tile = tileFor(a);
    if (!tile) continue;
    const title = titleIn(tile, a);
    const prices = classifyPriceCandidates(collectCandidates(tile));
    if (!title || (prices.priceNormal ?? prices.priceOffer) == null) continue;
    seen.add(url);
    const seller = tile.innerText.match(/vendido por\s*:?\s*([^\n]{2,40})/i)?.[1]?.trim();
    out.push({
      url,
      title,
      imageUrl: tile.querySelector("img")?.src || undefined,
      ...prices,
      cardName: prices.priceCard != null ? store.cardName : undefined,
      stockStatus: /agotado|sin stock/i.test(tile.innerText) ? "out_of_stock" : "in_stock",
      seller,
      sellerType: seller ? (store.ownSellers.test(seller) ? "store" : "third_party") : undefined,
    });
    if (out.length >= 48) break;
  }
  return out;
}

export function captureSearchResults(store: ExtensionStore): CapturedProduct[] {
  if (store.id === "falabella") {
    const fromData = falabellaResults();
    if (fromData.length) return fromData;
  }
  return genericResults(store);
}
