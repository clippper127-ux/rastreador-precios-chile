import type { ProductSnapshot, SearchResult } from "./types";

export type SearchMode = "server" | "link";

/**
 * Cada tienda es un adaptador independiente con esta interfaz.
 * Agregar una tienda = un archivo de adaptador + una fila en `stores` + fixtures de prueba.
 */
export interface StoreAdapter {
  /** "falabella", "paris", ... Coincide con `stores.id`. */
  id: string;
  name: string;
  /** Dominio principal, sin "www.". */
  domain: string;
  /** "server": el worker busca. "link": la app abre la búsqueda de la tienda y la extensión captura. */
  searchMode: SearchMode;
  /** URL de búsqueda en la tienda, para el botón "Buscar en X". */
  searchUrl(query: string): string;
  /** ¿Esta URL es una ficha de producto de esta tienda? */
  matchesUrl(url: string): boolean;
  /** Solo existe si `searchMode === "server"`. */
  search?(query: string, ctx: AdapterContext): Promise<SearchResult[]>;
  getProduct(url: string, ctx: AdapterContext): Promise<ProductSnapshot>;
}

/** Lo que el worker le entrega a un adaptador: un fetch que ya respeta el rate limit y el User-Agent honesto. */
export interface AdapterContext {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  signal?: AbortSignal;
}

export type AdapterErrorKind = "blocked" | "not_found" | "parse" | "network" | "timeout";

/**
 * Error tipado. `blocked` (403/429, desafío, captcha, HTML sin producto) hace que el worker
 * aplique backoff exponencial a la tienda completa y deje de intentar. Nunca se reintenta agresivamente.
 */
export class AdapterError extends Error {
  constructor(
    public readonly kind: AdapterErrorKind,
    message: string,
    public readonly storeId?: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

/** Heurística común para detectar bloqueo en una respuesta HTTP. */
export function looksBlocked(status: number, body?: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  if (!body) return false;
  const b = body.slice(0, 20_000).toLowerCase();
  return (
    b.includes("cf-challenge") ||
    b.includes("challenge-platform") ||
    b.includes("captcha") ||
    b.includes("access denied") ||
    b.includes("_abck") // Akamai Bot Manager
  );
}
