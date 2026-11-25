import type { StoreAdapter } from "../adapter";
import { EXTENSION_STORES } from "../capture";
import { normalizeListingUrl } from "../url";
import { jumbo, santaisabel } from "./cencosud";
import { abcdin, hites, lapolar } from "./sfcc";

/**
 * Registro de adaptadores de servidor. Agregar una tienda = un archivo aquí + una línea en esta lista
 * + su fila en packages/db/src/seed.ts + fixtures y tests.
 * Los adaptadores no hacen requests por su cuenta: reciben `fetch` del worker (rate limit, robots, UA).
 */
export const adapters: StoreAdapter[] = [hites, lapolar, abcdin, jumbo, santaisabel];

export function adapterById(id: string): StoreAdapter | undefined {
  return adapters.find((a) => a.id === id);
}

export function adapterForUrl(url: string): StoreAdapter | undefined {
  try {
    return adapters.find((a) => a.matchesUrl(url));
  } catch {
    return undefined;
  }
}

export type ParsedListingUrl =
  | { ok: true; url: string; storeId: string; storeName: string; mode: "server" | "extension" }
  | { ok: false; reason: "invalid" | "unsupported" | "not_product"; storeName?: string };

function hostIs(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Valida un link (pegado por el usuario o enviado por la extensión): URL válida, tienda soportada
 * y ficha de producto. Normaliza la URL para que la misma ficha no se guarde dos veces.
 */
export function parseListingUrl(input: string): ParsedListingUrl {
  let url: string;
  try {
    url = normalizeListingUrl(input);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const u = new URL(url);
  const host = u.hostname;

  const server = adapters.find((a) => hostIs(host, a.domain));
  if (server) {
    if (!server.matchesUrl(url)) return { ok: false, reason: "not_product", storeName: server.name };
    return { ok: true, url, storeId: server.id, storeName: server.name, mode: "server" };
  }

  const ext = EXTENSION_STORES.find((s) => hostIs(host, s.domain));
  if (ext) {
    if (!ext.productPath.test(u.pathname)) return { ok: false, reason: "not_product", storeName: ext.name };
    // En estas tiendas la ficha se identifica por la ruta; el query es tracking o variante visual.
    u.search = "";
    return { ok: true, url: u.toString(), storeId: ext.id, storeName: ext.name, mode: "extension" };
  }
  return { ok: false, reason: "unsupported" };
}

export { createSfccAdapter, parseSfccProduct } from "./sfcc";
export { createCencosudAdapter, parseCencosudProduct } from "./cencosud";
