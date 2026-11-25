import { bestPriceNoCard, parseListingUrl, sanitizeCapture } from "@rastreador/core";
import { schema } from "@rastreador/db";
import { and, asc, eq, gte } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { userIdFromToken } from "@/lib/extension-token";
import { deliverSoon } from "@/lib/notify";
import { ensureTracked, recordCapture, takeRateLimit, userFollowsListing } from "@/lib/track";

/**
 * API de la extensión.
 * POST { capture: CapturedProduct, follow?: boolean }  con  Authorization: Bearer rpe_...
 *
 * - Solo acepta fichas de producto de tiendas soportadas.
 * - Si nadie sigue esa ficha y follow=false, NO guarda nada (no registramos tu navegación).
 * - Si alguien la sigue, el precio que estás viendo se guarda como snapshot "extension".
 * - follow=true: empiezas a seguirla (con el precio de la página como primer punto).
 * Responde con el estado y un resumen para el panel (mínimo histórico + últimos puntos).
 */
export const dynamic = "force-dynamic";

const LIMIT_PER_MIN = 60;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Prueba de conexión desde el popup de la extensión: solo valida el token. */
export async function GET(request: NextRequest) {
  const userId = await userIdFromToken(db(), request.headers.get("authorization"));
  return userId ? json({ ok: true }) : json({ error: "token_invalido" }, 401);
}

export async function POST(request: NextRequest) {
  const d = db();
  const userId = await userIdFromToken(d, request.headers.get("authorization"));
  if (!userId) return json({ error: "token_invalido" }, 401);
  if (!(await takeRateLimit(d, `ingest:${userId}`, LIMIT_PER_MIN, 60))) return json({ error: "demasiadas_solicitudes" }, 429);

  let body: { capture?: unknown; follow?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "json_invalido" }, 400);
  }
  const capture = sanitizeCapture(body.capture);
  if (!capture) return json({ error: "captura_invalida" }, 400);

  const parsed = parseListingUrl(capture.url);
  if (!parsed.ok) return json({ error: parsed.reason }, 400);
  capture.url = parsed.url;

  const store = await d.query.stores.findFirst({ where: eq(schema.stores.id, parsed.storeId) });
  if (!store) return json({ error: "unsupported" }, 400);

  let listing = await d.query.listings.findFirst({ where: eq(schema.listings.url, parsed.url) });
  const wantsFollow = body.follow === true;

  if (!listing && !wantsFollow) return json({ tracked: false, storeName: parsed.storeName });

  let followed = listing ? await userFollowsListing(d, userId, listing.id) : false;
  if (wantsFollow && !followed) {
    const ids = await ensureTracked(d, userId, parsed, capture);
    listing = await d.query.listings.findFirst({ where: eq(schema.listings.id, ids.listingId) });
    followed = true;
  }
  const { changed } = await recordCapture(d, listing!.id, capture, "extension", userId);
  if (changed) deliverSoon();

  // Resumen para el panel: últimos 90 días del listing.
  const since = new Date(Date.now() - 90 * 86_400_000);
  const snaps = await d
    .select()
    .from(schema.priceSnapshots)
    .where(and(eq(schema.priceSnapshots.listingId, listing!.id), gte(schema.priceSnapshots.observedAt, since)))
    .orderBy(asc(schema.priceSnapshots.observedAt));
  const points = snaps
    .map((s) => ({
      t: s.observedAt.getTime(),
      price: bestPriceNoCard({ priceNormal: s.priceNormal ?? undefined, priceOffer: s.priceOffer ?? undefined }),
    }))
    .filter((p): p is { t: number; price: number } => p.price != null);
  const min = points.length ? Math.min(...points.map((p) => p.price)) : undefined;

  return json({
    tracked: followed,
    changed,
    productId: listing!.productId,
    storeName: parsed.storeName,
    minPrice90d: min,
    points: points.slice(-40),
  });
}
