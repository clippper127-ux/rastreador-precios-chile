import { parseListingUrl } from "../adapters";
import { toCLP } from "../price";
import { parseQuery, relevance, tokenize } from "../search";
import type { CLP } from "../types";

/*
 * Radar de ofertas: lee mensajes de canales/grupos de Telegram, detecta links de tiendas, precios y
 * señales ("error de precio", "% dcto") y los cruza con lo que sigues y tus palabras clave.
 * Todo puro (sin red ni base de datos) para poder testearlo.
 */

export interface RawPost {
  /** Id del mensaje dentro del canal/grupo. */
  id: number;
  postedAt: Date;
  text: string;
  links: string[];
  /** Total de reacciones y de respuestas (solo grupos leídos con la cuenta dedicada). */
  reactions?: number;
  replies?: number;
  /** Id del mensaje al que responde, si es una respuesta. */
  replyTo?: number;
}

// ─── Vista web pública de canales: https://t.me/s/<canal> ───────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e: string) => {
      if (e.startsWith("#x")) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (e.startsWith("#") && e !== "#39") return String.fromCodePoint(parseInt(e.slice(1), 10));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Normaliza "@canal", "t.me/canal", "https://t.me/s/canal" → "canal". Devuelve null si no es un nombre válido. */
export function channelHandle(input: string): string | null {
  const m = input.trim().match(/^(?:@|(?:https?:\/\/)?(?:www\.)?t(?:elegram)?\.me\/(?:s\/)?)?([A-Za-z][A-Za-z0-9_]{3,31})\/?$/);
  return m ? m[1]!.toLowerCase() : null;
}

export function parseChannelPage(html: string, handle: string): { title?: string; posts: RawPost[] } {
  const title = htmlToText(html.match(/class="tgme_channel_info_header_title"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "") || undefined;
  const posts: RawPost[] = [];
  const blocks = html.split(/<div class="tgme_widget_message_wrap/).slice(1);
  for (const b of blocks) {
    const post = b.match(/data-post="([^"/]+)\/(\d+)"/);
    if (!post || post[1]!.toLowerCase() !== handle.toLowerCase()) continue;
    const textHtml = b.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    const time = b.match(/<time datetime="([^"]+)"/)?.[1];
    const links = [...b.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"/g)]
      .map((m) => m[1]!.replace(/&amp;/g, "&"))
      .filter((u) => !/^https?:\/\/(t\.me|telegram\.org|telesco\.pe)\//.test(u));
    posts.push({
      id: Number(post[2]),
      postedAt: time ? new Date(time) : new Date(),
      text: htmlToText(textHtml).slice(0, 4000),
      links: [...new Set(links)].slice(0, 10),
    });
  }
  return { title, posts };
}

// ─── Análisis de un mensaje ─────────────────────────────────────────────────

export type DealFlag = "error_precio" | "descuento" | "cupon" | "liquidacion" | "envio_gratis";

const FLAGS: [DealFlag, RegExp][] = [
  ["error_precio", /error\s+de\s+precio|precio\s+err[oó]neo|preciazo|bug\s+de\s+precio|price\s+error|\bbug\b/i],
  ["cupon", /cup[oó]n|c[oó]digo\s+(de\s+)?descuento|\bcode\b/i],
  ["liquidacion", /liquidaci[oó]n|outlet|remate/i],
  ["envio_gratis", /env[ií]o\s+gratis|despacho\s+gratis/i],
  ["descuento", /\d{2}\s?%\s*(dcto|desc|off)|descuento/i],
];

export interface DealAnalysis {
  /** Precios en CLP que aparecen en el texto ($12.990, 12.990 CLP...). */
  prices: CLP[];
  /** Mayor % de descuento mencionado. */
  discountPct?: number;
  flags: DealFlag[];
}

export function analyzeDealText(text: string): DealAnalysis {
  const prices = [...text.matchAll(/\$\s?(\d{1,3}(?:\.\d{3})+|\d{3,})(?!\d)|(\d{1,3}(?:\.\d{3})+)\s*(?:clp|pesos)/gi)]
    .map((m) => toCLP(m[1] ?? m[2]))
    .filter((p): p is CLP => p != null && p >= 100 && p < 100_000_000);
  const real = text.match(/(\d{1,2})\s?%\s*real/i);
  const realPct = real ? Number(real[1]) : undefined;
  const pcts = [...text.matchAll(/(\d{1,2})\s?%/g)].map((m) => Number(m[1])).filter((n) => n > 0 && n < 100);
  return {
    prices: [...new Set(prices)],
    // "80% OFF (67% Real)": algunos canales calculan el descuento real contra el precio habitual; manda ese.
    discountPct: realPct ?? (pcts.length ? Math.max(...pcts) : undefined),
    flags: FLAGS.filter(([, re]) => re.test(text)).map(([f]) => f),
  };
}

/** Links del mensaje que son fichas de tiendas soportadas (ya resueltos si venían acortados). */
export function storeLinks(urls: string[]): { url: string; storeId: string; storeName: string }[] {
  const out = new Map<string, { url: string; storeId: string; storeName: string }>();
  for (const u of urls) {
    const p = parseListingUrl(u);
    if (p.ok) out.set(p.url, { url: p.url, storeId: p.storeId, storeName: p.storeName });
  }
  return [...out.values()];
}

// ─── Coincidencias con lo que le interesa al usuario ─────────────────────────

export interface Interest {
  productId: string;
  name: string;
  listingUrls: string[];
}

export interface DealMatch {
  reasons: string[];
  productIds: string[];
}

/**
 * ¿Le interesa este mensaje al usuario? Coincide si:
 * - trae un link a una publicación que sigue,
 * - menciona un producto que sigue (marca + modelo; relevancia alta),
 * - contiene una de sus palabras clave,
 * - o es un "error de precio" y el usuario pidió avisos de errores de precio.
 */
export function matchDeal(
  post: { text: string; storeUrls: string[]; flags: DealFlag[] },
  interests: Interest[],
  keywords: string[],
  /** blocked: el mensaje cae en una categoría o palabra filtrada (no se avisa como error de precio). */
  opts: { priceErrors: boolean; blocked?: boolean; evidence?: boolean } = { priceErrors: true },
): DealMatch | null {
  const reasons: string[] = [];
  const productIds = new Set<string>();
  const urls = new Set(post.storeUrls);

  for (const it of interests) {
    if (it.listingUrls.some((u) => urls.has(u))) {
      reasons.push(`Link a "${it.name}", que sigues`);
      productIds.add(it.productId);
      continue;
    }
    const q = parseQuery(it.name);
    // Un código de modelo fuerte (letras + números, 5+ caracteres: "wh1000xm5") basta por sí solo.
    const postTokens = new Set(tokenize(post.text));
    const strong = q.models.filter((m) => m.length >= 5 && /[a-z]/.test(m) && /\d/.test(m));
    const strongHit = strong.length > 0 && strong.every((m) => postTokens.has(m));
    // Si no, solo nombres con algo distintivo (modelo o 3+ palabras) y casi todas sus palabras presentes.
    if (strongHit || ((q.models.length || q.tokens.length >= 3) && relevance(q, post.text) >= 0.8)) {
      reasons.push(`Menciona "${it.name}", que sigues`);
      productIds.add(it.productId);
    }
  }
  for (const k of keywords) {
    const kq = parseQuery(k);
    if (kq.tokens.length && relevance(kq, post.text) === 1) reasons.push(`Contiene "${k}"`);
  }
  if (opts.priceErrors && !opts.blocked && opts.evidence !== false && post.flags.includes("error_precio")) reasons.push("Posible error de precio");

  return reasons.length ? { reasons, productIds: [...productIds] } : null;
}

export * from "./hot";

export * from "./categories";
export * from "./coupons";
