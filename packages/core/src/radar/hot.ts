import { foldText } from "../search";

/** Minúsculas, sin tildes, solo letras y números separados por un espacio. */
function normalizeText(s: string): string {
  return foldText(s).replace(/[^a-z0-9ñ]+/g, " ").trim();
}

/*
 * "Ofertas destacadas": puntaje para avisar ofertas buenas aunque no sean algo que sigues.
 * Suma señales del texto (descuento, caída de precio, palabras), de la reacción del grupo
 * (reacciones y respuestas) y del historial (precio bajo el mínimo conocido).
 */

export type HotLevel = 0 | 1 | 2 | 3;

/** 0 = apagado, 1 = pocas, 2 = normal, 3 = muchas. Umbral de puntaje y tope de avisos por día. */
export const HOT_LEVELS: Record<Exclude<HotLevel, 0>, { label: string; minScore: number; dailyCap: number }> = {
  1: { label: "Pocas", minScore: 7, dailyCap: 5 },
  2: { label: "Normal", minScore: 5, dailyCap: 10 },
  3: { label: "Muchas", minScore: 4, dailyCap: 20 },
};

/** Palabras que suelen acompañar una oferta muy buena (se suman a las del usuario). */
export const HOT_WORDS = [
  "regalado",
  "regalada",
  "corran",
  "corre",
  "vuela",
  "volando",
  "ganga",
  "oferton",
  "preciazo",
  "baratisimo",
  "baratisima",
  "imperdible",
  "precio historico",
  "minimo historico",
  "se va a acabar",
  "quedan pocos",
  "quedan pocas",
  "ultimas unidades",
  "a luca",
  "🔥🔥",
];

export interface HotInput {
  text: string;
  prices: number[];
  discountPct?: number | null;
  flags: string[];
  reactions?: number;
  replies?: number;
  /** Mínimo histórico conocido de la publicación enlazada, si la hay. */
  historicalMin?: number | null;
  /** Conversación en el chat: cuántos otros mensajes hablan de lo mismo en ±3 h. */
  buzz?: { count: number; word: string } | null;
  /** El mensaje trae un link para comprar. */
  hasLink?: boolean;
}

export interface HotResult {
  score: number;
  reasons: string[];
}

function wordHits(text: string, words: string[]): string[] {
  const norm = ` ${normalizeText(text)} `;
  const raw = text.toLowerCase();
  const hits = new Set<string>();
  for (const w of words) {
    const nw = normalizeText(w);
    // Emojis u otros símbolos: se buscan tal cual; palabras: como palabra completa, sin tildes.
    if (!nw) {
      if (w && raw.includes(w)) hits.add(w);
    } else if (norm.includes(` ${nw} `)) hits.add(w);
  }
  return [...hits];
}

export function hotScore(p: HotInput, extraWords: string[] = []): HotResult {
  let score = 0;
  const reasons: string[] = [];

  const d = p.discountPct ?? 0;
  if (d >= 40) {
    // 90 % o más casi siempre es un error de precio (p. ej. $24.990 → $25).
    // 80 %+ ya es oferta destacada por sí sola en sensibilidad Normal.
    score += d >= 90 ? 6 : d >= 80 ? 5 : d >= 60 ? 3 : d >= 50 ? 2 : 1;
    reasons.push(d >= 90 ? `−${d}% (¿error de precio?)` : `−${d}%`);
  }

  // Precio antes → después en el mismo mensaje (solo si hay 2 o 3 precios: con más suele ser una lista).
  if (p.prices.length >= 2 && p.prices.length <= 3) {
    const lo = Math.min(...p.prices);
    const hi = Math.max(...p.prices);
    const ratio = lo / hi;
    if (ratio <= 0.5 && (d < 40 || Math.round((1 - ratio) * 100) > d + 5)) {
      score += ratio <= 0.3 ? 3 : 2;
      reasons.push(`baja de precio de ${Math.round((1 - ratio) * 100)}%`);
    }
  }

  if (p.flags.includes("error_precio")) {
    score += 3;
    reasons.push("posible error de precio");
  }

  const hits = wordHits(p.text, [...HOT_WORDS, ...extraWords]);
  if (hits.length) {
    score += Math.min(3, hits.length);
    reasons.push(`dice "${hits.slice(0, 2).join('", "')}"`);
  }

  // Reacciones, respuestas y conversación solo cuentan si el mensaje parece una oferta
  // (precio, descuento, link o palabra de oferta): si no, una charla animada pasaría por oferta.
  const looksLikeDeal = p.prices.length > 0 || d > 0 || !!p.hasLink || hits.length > 0 || p.flags.includes("error_precio");
  const r = looksLikeDeal ? (p.reactions ?? 0) : 0;
  if (r >= 8) {
    score += r >= 30 ? 3 : r >= 15 ? 2 : 1;
    reasons.push(`${r} reacciones`);
  }
  const rep = looksLikeDeal ? (p.replies ?? 0) : 0;
  if (rep >= 3) {
    score += rep >= 10 ? 3 : rep >= 5 ? 2 : 1;
    reasons.push(`${rep} respuestas`);
  }

  if (looksLikeDeal && p.buzz && p.buzz.count >= 4) {
    // Señal fuerte en chats: varias personas comentando el mismo producto en poco rato.
    score += p.buzz.count >= 7 ? 5 : 4;
    reasons.push(`${p.buzz.count} mensajes hablando de "${p.buzz.word}"`);
  }

  if (p.historicalMin && p.prices.length) {
    const lo = Math.min(...p.prices);
    if (lo <= p.historicalMin * 0.98) {
      score += 3;
      reasons.push("bajo su mínimo histórico");
    }
  }

  return { score, reasons };
}

/** Huella para no avisar la misma oferta repetida en varios grupos: primer link de tienda o el inicio del texto. */
export function dealFingerprint(text: string, storeUrls: string[]): string {
  if (storeUrls[0]) return `u:${storeUrls[0]}`;
  const words = normalizeText(text.replace(/https?:\/\/\S+/g, " "))
    .split(" ")
    .filter((w) => w.length > 2)
    .slice(0, 10);
  return `t:${words.join(" ")}`;
}

/** Palabras de chat que no dicen de qué producto se habla. */
const CHAT_STOP = new Set(
  "hola gracias alguien sabe tienen tiene donde cuando ahora todavia aun igual pero porque para como esta estan esto esta este eso cual cuales mismo misma hace hacer sale salio llego llegan compre compra comprar pedido pedi precio precios oferta ofertas descuento link tienda tiendas envio despacho stock queda quedan otra otro todos todas nada algo mucho muy bien buen buena malo mala jaja jajaja jajajaja creo parece puede pueden sirve dale bueno chile pesos lucas luca black friday cyber grupo grupos vip canal comunidad admin admins telegram whatsapp mensaje mensajes gente dscto dcto descto historial anterior anteriore precio off falabella paris ripley lider tottus jumbo santa isabel sodimac easy hites abcdin lapolar polar pcfactory mercadolibre mercado libre aliexpress amazon temu shein preunic salcobrand cruzverde ahumada knasta solotodo unimarc walmart".split(" "),
);

function topicWords(text: string): Set<string> {
  return new Set(
    normalizeText(text.replace(/https?:\/\/\S+/g, " "))
      .split(" ")
      .filter((w) => w.length >= 5 && !/^\d+$/.test(w) && !CHAT_STOP.has(w))
      // Plural simple → singular ("cepillos" = "cepillo", "bloqueadores" = "bloqueador").
      .map((w) => w.replace(/(es|s)$/, "")),
  );
}

/**
 * "Se está hablando de esto": para cada mensaje de un chat, cuántos OTROS mensajes en ±3 h
 * comparten una palabra de producto con él. Se ignoran palabras que aparecen en más del 35 % de los
 * mensajes del período (temas de todo el día, como el nombre de la tienda del evento).
 */
export function chatBuzz(posts: { id: number; text: string; postedAt: Date }[], windowMs = 3 * 3_600_000): Map<number, { count: number; word: string }> {
  const words = posts.map((p) => topicWords(p.text));
  const freq = new Map<string, number>();
  for (const ws of words) for (const w of ws) freq.set(w, (freq.get(w) ?? 0) + 1);
  const maxFreq = Math.max(4, Math.ceil(posts.length * 0.35));
  const out = new Map<number, { count: number; word: string }>();
  posts.forEach((p, i) => {
    let best = { count: 0, word: "" };
    for (const w of words[i]!) {
      if ((freq.get(w) ?? 0) > maxFreq) continue;
      let n = 0;
      posts.forEach((q, j) => {
        if (j !== i && Math.abs(q.postedAt.getTime() - p.postedAt.getTime()) <= windowMs && words[j]!.has(w)) n++;
      });
      if (n > best.count) best = { count: n, word: w };
    }
    if (best.count) out.set(p.id, best);
  });
  return out;
}
