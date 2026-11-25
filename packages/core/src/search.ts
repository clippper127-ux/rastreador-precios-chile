import { bestPriceNoCard, bestPriceWithCard } from "./price";
import type { CLP, SearchResult } from "./types";

/*
 * Búsqueda unificada SIN IA: normalización de texto, relevancia y agrupación entre tiendas.
 * Orden de confianza para decir "es el mismo producto": EAN → marca + modelo + título parecido.
 * Una IA (opcional, Fase 5+) solo desempataría casos dudosos; la app funciona completa sin ella.
 */

const STOPWORDS = new Set(
  "de del la las el los y o con sin para por en un una unos unas al a mas más tipo nuevo nueva original oferta envio envío gratis pack x"
    .split(" "),
);

export function foldText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Tokens comparables: sin tildes, sin palabras vacías, plurales simples a singular, "wh-1000xm5" → "wh1000xm5". */
export function tokenize(s: string): string[] {
  const folded = foldText(s)
    // sinónimos de consolas: "PlayStation 5", "Play Station 5" → "ps5"
    .replace(/\bplay\s?station\s?(\d)\b/g, "ps$1")
    // une códigos de modelo con guion: "wh-ch720n" → "whch720n", "wf-c510" → "wfc510"
    .replace(/\b([a-z]{1,4})-([a-z]{0,4}\d\w*)\b/g, "$1$2")
    // y con espacio cuando sigue un número: "wh 1000xm5", "ps 5"
    .replace(/\b([a-z]{1,4})\s(\d\w*)\b/g, "$1$2")
    .replace(/(\d+)\s*(gb|tb|mb|w|hz|mah|l|ml|kg|g|cm|mm|pulgadas|")/g, "$1$2");
  return folded
    .split(/[^a-z0-9"]+/)
    .map((t) => (t.length > 4 && t.endsWith("es") && !/\d/.test(t) ? t.slice(0, -2) : t.length > 3 && t.endsWith("s") && !/\d/.test(t) ? t.slice(0, -1) : t))
    .map((t) => SYNONYMS[t] ?? t)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Palabras que las tiendas escriben de varias formas (ya sin tildes y en singular). */
const SYNONYMS: Record<string, string> = {
  televisor: "tv",
  television: "tv",
  televisore: "tv",
  laptop: "notebook",
  console: "consola",
  headphone: "audifono",
  celular: "smartphone",
};

/** Tokens con dígitos: modelos, capacidades y tallas (lo que distingue productos parecidos). */
export function modelTokens(tokens: string[]): string[] {
  return tokens.filter((t) => /\d/.test(t));
}

export interface ParsedQuery {
  raw: string;
  tokens: string[];
  models: string[];
}

export function parseQuery(q: string): ParsedQuery {
  const raw = q.trim().replace(/\s+/g, " ").slice(0, 120);
  const tokens = tokenize(raw);
  return { raw, tokens, models: modelTokens(tokens) };
}

/** 0..1: cuánto del texto buscado aparece en el título. Los modelos (con números) son obligatorios. */
export function relevance(query: ParsedQuery, title: string): number {
  if (!query.tokens.length) return 0;
  const t = new Set(tokenize(title));
  const joined = [...t].join(" ");
  if (query.models.some((m) => !t.has(m) && !joined.includes(m))) return 0;
  const hits = query.tokens.filter((q) => t.has(q) || [...t].some((x) => x.startsWith(q) || q.startsWith(x))).length;
  return hits / query.tokens.length;
}

/**
 * Palabras que indican un accesorio, juego o repuesto "para" el producto buscado.
 * Si aparecen ANTES de lo buscado ("Bolso para PS5", "Base cargadora consola PS5") y no las escribiste, no es lo que buscas.
 */
const ACCESSORY = new Set(
  // Solo cosas que casi siempre son "para" otro producto (no "juego", "base" ni "kit": "Juego de sábanas", "Base cama").
  ("bolso funda estuche case carcasa cover skin vinilo sticker protector mica lamina videojuego control joystick mando " +
    "cable cargador cargadora soporte adaptador repuesto correa giftcard membresia suscripcion")
    .split(" "),
);

/**
 * ¿El título corresponde exactamente a lo buscado?
 * - Con 1 a 3 palabras se exigen todas; con más, se tolera que falte una palabra genérica (nunca un modelo).
 * - Se descartan accesorios y juegos ("Bolso para PS5") salvo que los hayas buscado.
 */
export function matchesQuery(query: ParsedQuery, title: string, brand?: string): boolean {
  if (!query.tokens.length) return false;
  // La marca va al final: así "Funda Sony…" sigue teniendo el accesorio antes de lo buscado.
  const words = tokenize(`${title} ${brand ?? ""}`);
  const set = new Set(words);
  const joined = words.join(" ");
  if (query.models.some((m) => !set.has(m) && !joined.includes(m))) return false;
  const hit = (q: string) => words.findIndex((x) => x === q || x.startsWith(q) || (q.startsWith(x) && x.length >= 3));
  const positions = query.tokens.map(hit);
  const missing = positions.filter((p) => p < 0).length;
  if (missing > (query.tokens.length > 3 ? 1 : 0)) return false;

  const first = Math.min(...positions.filter((p) => p >= 0));
  const wanted = new Set(query.tokens);
  const accessoryBefore = words.slice(0, first).some((w) => ACCESSORY.has(w) && !wanted.has(w));
  // "... para PS5", "compatible con PS5": accesorio aunque la palabra no esté en la lista.
  const raw = foldText(title);
  const forOther = /\b(para|compatible( con)?|compatibles)\b/.test(raw) && !/\b(para|compatible)\b/.test(foldText(query.raw))
    ? (() => {
        const idx = raw.search(/\b(para|compatible)\b/);
        const before = tokenize(raw.slice(0, idx));
        // Accesorio si antes de "para" no aparece nada de lo buscado.
        return !query.tokens.some((q) => before.some((x) => x === q || x.startsWith(q)));
      })()
    : false;
  return !accessoryBefore && !forOther;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/** ¿Son el mismo producto? EAN manda; si no, marca compatible + modelos iguales + títulos parecidos. */
export function sameProduct(a: SearchResult, b: SearchResult): boolean {
  if (a.ean && b.ean) return a.ean === b.ean;
  const brandA = a.brand ? foldText(a.brand) : undefined;
  const brandB = b.brand ? foldText(b.brand) : undefined;
  if (brandA && brandB && brandA !== brandB && !brandA.includes(brandB) && !brandB.includes(brandA)) return false;

  const ta = new Set(tokenize(`${a.brand ?? ""} ${a.title}`));
  const tb = new Set(tokenize(`${b.brand ?? ""} ${b.title}`));
  const ma = modelTokens([...ta]);
  const mb = modelTokens([...tb]);
  const sim = jaccard(ta, tb);
  if (ma.length && mb.length) {
    // Todos los modelos del título más corto deben estar en el otro (evita juntar 128 GB con 256 GB).
    // Tolera una letra final de diferencia ("whch720" ≈ "whch720n"), pero nunca en números ("128gb" ≠ "256gb").
    const [short, long] = ma.length <= mb.length ? [ma, mb] : [mb, ma];
    const close = (x: string, y: string) =>
      x === y || (/[a-z]$/.test(x.length > y.length ? x : y) && Math.abs(x.length - y.length) === 1 && (x.startsWith(y) || y.startsWith(x)));
    if (!short.every((m) => long.some((l) => close(m, l)))) return false;
    // Código de modelo fuerte (letras + números, 5+ caracteres, p. ej. "whch720n"): casi único → basta un título algo parecido.
    // Modelos débiles ("15", "128gb") se repiten entre productos → exigir títulos más parecidos.
    const strong = short.some((m) => m.length >= 5 && /[a-z]/.test(m) && /\d/.test(m));
    return sim >= (strong ? 0.1 : 0.35);
  }
  return sim >= 0.6;
}

export interface ResultGroup {
  key: string;
  title: string;
  brand?: string;
  imageUrl?: string;
  items: (SearchResult & { bestNoCard?: CLP; bestWithCard?: CLP })[];
  bestNoCard?: CLP;
  bestWithCard?: CLP;
  relevance: number;
}

/**
 * Agrupa resultados de varias tiendas. Un grupo no repite tienda (variantes de color de la misma tienda
 * quedan como grupos aparte). Orden: relevancia y luego precio.
 */
export function groupResults(results: SearchResult[], query?: ParsedQuery, opts: { loose?: boolean } = {}): ResultGroup[] {
  const groups: ResultGroup[] = [];
  // Búsqueda por código de barras: la tienda ya filtró por EAN; se descartan solo los que traen OTRO EAN.
  const ean = query ? eanFromQuery(query) : undefined;
  for (const r of results) {
    const text = `${r.brand ?? ""} ${r.title}`;
    const rel = ean ? (r.ean && r.ean !== ean ? 0 : 1) : query ? relevance(query, text) : 1;
    if (query && rel < 0.5) continue;
    // Por defecto, solo coincidencias exactas (sin accesorios ni juegos); `loose` muestra también las parecidas.
    if (query && !ean && !opts.loose && !matchesQuery(query, r.title, r.brand)) continue;
    const item = { ...r, bestNoCard: bestPriceNoCard(r), bestWithCard: bestPriceWithCard(r) };
    const g = groups.find((g) => !g.items.some((i) => i.storeId === r.storeId) && g.items.some((i) => sameProduct(i, r)));
    if (g) {
      g.items.push(item);
      g.relevance = Math.max(g.relevance, rel);
    } else {
      groups.push({ key: r.ean ?? `${r.storeId}:${r.url}`, title: r.title, brand: r.brand, imageUrl: r.imageUrl, items: [item], relevance: rel });
    }
  }
  for (const g of groups) {
    g.items.sort((a, b) => (a.bestNoCard ?? Infinity) - (b.bestNoCard ?? Infinity));
    const inStock = g.items.filter((i) => i.stockStatus !== "out_of_stock" && i.stockStatus !== "discontinued");
    g.bestNoCard = Math.min(...inStock.map((i) => i.bestNoCard ?? Infinity));
    g.bestWithCard = Math.min(...inStock.map((i) => i.bestWithCard ?? Infinity));
    if (!Number.isFinite(g.bestNoCard)) g.bestNoCard = undefined;
    if (!Number.isFinite(g.bestWithCard)) g.bestWithCard = undefined;
    g.imageUrl ??= g.items.find((i) => i.imageUrl)?.imageUrl;
    // El título más descriptivo del grupo.
    g.title = g.items.map((i) => i.title).sort((a, b) => b.length - a.length)[0] ?? g.title;
  }
  return groups.sort((a, b) => b.relevance - a.relevance || b.items.length - a.items.length || (a.bestNoCard ?? Infinity) - (b.bestNoCard ?? Infinity));
}

/**
 * Consulta escrita en la página de búsqueda de una tienda (para emparejar capturas de la extensión).
 * Falabella ?Ntt=, Paris ?q=, Ripley /search/<q>, Lider ?q= o ?query=, Hites/SFCC ?q=.
 */
export function queryFromSearchUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const fromParam = u.searchParams.get("Ntt") ?? u.searchParams.get("q") ?? u.searchParams.get("query") ?? u.searchParams.get("ft");
    if (fromParam) return fromParam.trim() || undefined;
    const m = u.pathname.match(/\/(?:search|busqueda|buscar)\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]!).replace(/[+_-]+/g, " ").trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

/** ¿Es un código de barras EAN-8/UPC-A/EAN-13/GTIN-14 válido (dígito verificador incluido)? */
export function isValidEan(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** Si la consulta es solo un código de barras, lo devuelve. */
export function eanFromQuery(q: ParsedQuery): string | undefined {
  const raw = q.raw.replace(/\s+/g, "");
  return isValidEan(raw) ? raw : undefined;
}
