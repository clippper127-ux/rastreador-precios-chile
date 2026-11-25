import "server-only";
import {
  adapters,
  isAllowed,
  parseQuery,
  parseRobots,
  type ParsedQuery,
  type RobotsRules,
  type SearchResult,
} from "@rastreador/core";
import { schema } from "@rastreador/db";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "./db";
import { takeRateLimit } from "./track";

/*
 * Búsqueda en servidor: solo tiendas con adaptador de servidor y búsqueda permitida por robots.txt
 * (hoy: Hites). Una request por tienda y consulta, caché de 30 min, máximo 6 búsquedas/min por tienda
 * entre todos los usuarios. Las tiendas que bloquean se buscan con la extensión.
 */

const UA = process.env.WORKER_USER_AGENT ?? "RastreadorPreciosPersonal/0.1 (uso personal; seguimiento de precios)";
const CACHE_MS = 30 * 60_000;
const cache = new Map<string, { at: number; results: SearchResult[] }>();
const robotsCache = new Map<string, { at: number; rules: RobotsRules }>();

export function queryKey(q: ParsedQuery): string {
  return [...q.tokens].sort().join(" ");
}

async function robotsFor(origin: string): Promise<RobotsRules> {
  const hit = robotsCache.get(origin);
  if (hit && Date.now() - hit.at < 6 * 3_600_000) return hit.rules;
  let rules: RobotsRules = { allow: [], disallow: [] };
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(6_000) });
    if (res.ok) rules = parseRobots(await res.text(), UA);
  } catch {
    /* sin robots: se asume permitido */
  }
  robotsCache.set(origin, { at: Date.now(), rules });
  return rules;
}

export interface StoreSearchOutcome {
  storeId: string;
  storeName: string;
  status: "ok" | "cached" | "limited" | "blocked" | "error";
  results: SearchResult[];
}

export async function searchServerStores(q: ParsedQuery): Promise<StoreSearchOutcome[]> {
  const d = db();
  const enabled = new Set((await d.select().from(schema.stores)).filter((s) => s.enabled && s.searchMode === "server").map((s) => s.id));
  const searchable = adapters.filter((a) => a.searchMode === "server" && a.search && enabled.has(a.id));

  return Promise.all(
    searchable.map(async (a): Promise<StoreSearchOutcome> => {
      const base = { storeId: a.id, storeName: a.name };
      const key = `${a.id}|${queryKey(q)}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < CACHE_MS) return { ...base, status: "cached", results: hit.results };
      if (!(await takeRateLimit(d, `search:${a.id}`, 6, 60))) return { ...base, status: "limited", results: [] };

      const url = new URL(a.searchUrl(q.raw));
      if (!isAllowed(await robotsFor(url.origin), url.pathname + url.search)) return { ...base, status: "blocked", results: [] };
      try {
        const results = await a.search!(q.raw, {
          fetch: (u, init) =>
            fetch(u, {
              ...init,
              headers: { "user-agent": UA, "accept-language": "es-CL,es;q=0.9", ...init?.headers },
              signal: AbortSignal.timeout(10_000),
            }),
        });
        const withData = results.filter((r) => r.title);
        cache.set(key, { at: Date.now(), results: withData });
        return { ...base, status: "ok", results: withData };
      } catch (err) {
        console.warn(`Búsqueda en ${a.name} falló:`, (err as Error).message, (err as { cause?: unknown }).cause);
        return { ...base, status: "error", results: [] };
      }
    }),
  );
}

/** Resultados que la extensión capturó para esta consulta en las últimas 2 horas (los más recientes por tienda). */
export async function capturedResults(userId: string, q: ParsedQuery): Promise<{ storeId: string; results: SearchResult[] }[]> {
  const rows = await db()
    .select()
    .from(schema.searchCaptures)
    .where(
      and(
        eq(schema.searchCaptures.userId, userId),
        eq(schema.searchCaptures.queryKey, queryKey(q)),
        gte(schema.searchCaptures.createdAt, new Date(Date.now() - 2 * 3_600_000)),
      ),
    )
    .orderBy(desc(schema.searchCaptures.createdAt));
  const latest = new Map<string, SearchResult[]>();
  for (const r of rows) if (!latest.has(r.storeId)) latest.set(r.storeId, r.results as SearchResult[]);
  return [...latest].map(([storeId, results]) => ({ storeId, results }));
}

export { parseQuery };
