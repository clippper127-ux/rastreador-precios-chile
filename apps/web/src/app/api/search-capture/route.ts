import {
  extensionStoreForUrl,
  parseListingUrl,
  parseQuery,
  queryFromSearchUrl,
  sanitizeCapture,
  type SearchResult,
} from "@rastreador/core";
import { schema } from "@rastreador/db";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { userIdFromToken } from "@/lib/extension-token";
import { queryKey } from "@/lib/search";
import { takeRateLimit } from "@/lib/track";

/**
 * La extensión envía los resultados de una página de búsqueda de tienda QUE EL USUARIO ABRIÓ
 * (solo cuando el usuario toca "Enviar a Rastreador"). Se guardan ~2 h para mostrarlos en /buscar.
 * POST { pageUrl, query?, results: CapturedProduct[] }
 */
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  const d = db();
  const userId = await userIdFromToken(d, request.headers.get("authorization"));
  if (!userId) return json({ error: "token_invalido" }, 401);
  if (!(await takeRateLimit(d, `search-capture:${userId}`, 20, 60))) return json({ error: "demasiadas_solicitudes" }, 429);

  let body: { pageUrl?: unknown; query?: unknown; results?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "json_invalido" }, 400);
  }
  // La consulta viene explícita cuando la búsqueda se abrió desde la app (#rq=); si no, de la URL de la tienda.
  const raw =
    (typeof body.query === "string" && body.query.trim().slice(0, 120)) ||
    (typeof body.pageUrl === "string" ? queryFromSearchUrl(body.pageUrl) : undefined);
  if (!raw) return json({ error: "sin_consulta" }, 400);
  const q = parseQuery(raw);
  if (!q.tokens.length) return json({ error: "sin_consulta" }, 400);

  // La tienda la define la página donde está el usuario; solo se aceptan fichas de esa tienda.
  const pageStore = typeof body.pageUrl === "string" ? extensionStoreForUrl(body.pageUrl) : undefined;
  if (!pageStore) return json({ error: "tienda_no_soportada" }, 400);
  const storeId = pageStore.id;

  const items = Array.isArray(body.results) ? body.results.slice(0, 60) : [];
  const results: SearchResult[] = [];
  for (const it of items) {
    const cap = sanitizeCapture(it);
    if (!cap) continue;
    const parsed = parseListingUrl(cap.url);
    if (!parsed.ok || parsed.storeId !== storeId) continue;
    results.push({ ...cap, url: parsed.url, storeId: parsed.storeId });
  }
  if (!results.length) return json({ error: "sin_resultados" }, 400);

  await d.insert(schema.searchCaptures).values({ userId, queryKey: queryKey(q), storeId, results });
  return json({ ok: true, query: q.raw, count: results.length });
}
