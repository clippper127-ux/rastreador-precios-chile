import { foldText } from "../search";

/*
 * Temas que "se calientan" en un chat: una palabra de contenido (producto, tienda, tarjeta, banco...) que aparece
 * en varios mensajes en poco rato. Sirve para pedirle a la IA un resumen de esa conversación.
 */

/** Palabras de chat que no son un tema. (A diferencia de las ofertas, aquí tarjetas y bancos SÍ son tema.) */
const STOP = new Set(
  "pagina paginas web algun alguna alguno algunos original mandaste mande manda pasa paso pasar foto fotos video hombre hombres mujer mujeres persona personas hola gracias alguien sabe tienen tiene donde cuando ahora todavia igual pero porque para como esta estan esto este eso cual cuales mismo misma hace hacer sale salio llego llegan compre compra comprar pedido precio precios oferta ofertas descuento link tienda tiendas envio despacho stock queda quedan otra otro todos todas nada algo mucho muy bien buen buena malo mala jaja jajaja jajajaja creo parece puede pueden sirve dale bueno chile pesos lucas luca grupo grupos mensaje mensajes gente cosa cosas verdad tambien entonces despues antes siempre nunca solo sola dice dicen decir hice tengo tenia estoy estaba fueron favor hasta desde sobre entre"
    .split(" "),
);

function words(text: string): Set<string> {
  return new Set(
    foldText(text.replace(/https?:\/\/\S+/g, " "))
      .replace(/[^a-z0-9ñ]+/g, " ")
      .split(" ")
      .filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !STOP.has(w))
      .map((w) => w.replace(/(es|s)$/, "")),
  );
}

export interface ChatTopic {
  word: string;
  /** Mensajes del tema, del más antiguo al más nuevo. */
  postIds: number[];
}

/**
 * Temas con al menos `minMessages` mensajes que mencionan la misma palabra dentro de `windowMs`.
 * Ignora palabras que aparecen en más del 40 % de los mensajes del período (temas de todo el día).
 * Devuelve como máximo `max` temas, los más comentados primero, sin repetir mensajes entre temas.
 */
export function chatTopics(
  posts: { id: number; text: string; postedAt: Date }[],
  opts: { minMessages?: number; windowMs?: number; max?: number } = {},
): ChatTopic[] {
  const min = opts.minMessages ?? 6;
  const windowMs = opts.windowMs ?? 60 * 60_000;
  const sorted = [...posts].sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
  const ws = sorted.map((p) => words(p.text));
  const freq = new Map<string, number>();
  for (const s of ws) for (const w of s) freq.set(w, (freq.get(w) ?? 0) + 1);
  const tooCommon = Math.max(min + 2, Math.ceil(sorted.length * 0.4));

  const candidates: ChatTopic[] = [];
  for (const [word, n] of freq) {
    if (n < min || n > tooCommon) continue;
    const idx = sorted.map((_, i) => i).filter((i) => ws[i]!.has(word));
    // La ventana más concurrida para esta palabra.
    let best: number[] = [];
    let start = 0;
    for (let end = 0; end < idx.length; end++) {
      while (sorted[idx[end]!]!.postedAt.getTime() - sorted[idx[start]!]!.postedAt.getTime() > windowMs) start++;
      if (end - start + 1 > best.length) best = idx.slice(start, end + 1);
    }
    if (best.length >= min) candidates.push({ word, postIds: best.map((i) => sorted[i]!.id) });
  }
  candidates.sort((a, b) => b.postIds.length - a.postIds.length);
  const used = new Set<number>();
  const out: ChatTopic[] = [];
  for (const c of candidates) {
    if (out.length >= (opts.max ?? 3)) break;
    // Mismo grupo de mensajes con otra palabra ("tarjeta"/"mach"): es el mismo tema.
    if (c.postIds.filter((id) => used.has(id)).length > c.postIds.length / 2) continue;
    c.postIds.forEach((id) => used.add(id));
    out.push(c);
  }
  return out;
}

/** Quita lo que identifica a personas antes de mandar texto a la IA: @usuarios, correos y teléfonos. */
export function anonymize(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[correo]")
    .replace(/@\w{3,}/g, "@usuario")
    .replace(/(\+?56\s?)?9[\s.-]?\d{4}[\s.-]?\d{4}/g, "[teléfono]")
    .replace(/https?:\/\/t\.me\/\S+/g, "[link de Telegram]");
}
