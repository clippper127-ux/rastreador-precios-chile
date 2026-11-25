"use server";

import { EXTENSION_STORES, adapters, parseListingUrl, sanitizeCapture, type StockStatus } from "@rastreador/core";
import { schema } from "@rastreador/db";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { issueExtensionToken, revokeExtensionToken } from "@/lib/extension-token";
import { deliverSoon } from "@/lib/notify";
import { getUser } from "@/lib/supabase/server";
import { ensureTracked, recordCapture, userFollowsListing } from "@/lib/track";

export type TrackResult = { error: string } | undefined;

const SUPPORTED = [...adapters.map((a) => a.name), ...EXTENSION_STORES.map((s) => s.name)].join(", ");
const REASONS: Record<string, string> = {
  invalid: "Eso no parece un link válido.",
  unsupported: `Todavía no seguimos esa tienda. Por ahora: ${SUPPORTED}.`,
  not_product: "Ese link no es la ficha de un producto. Abre el producto y copia su link.",
};

/**
 * Seguir un producto pegando el link de la ficha. No hace scraping:
 * - tiendas de servidor: el worker trae el precio en la próxima pasada;
 * - tiendas de extensión: el precio llega cuando abres la ficha con la extensión (o lo ingresas a mano).
 */
export async function trackUrl(rawUrl: string): Promise<TrackResult> {
  const user = await getUser();
  if (!user) redirect(`/login?next=/`);

  const parsed = parseListingUrl(rawUrl);
  if (!parsed.ok) return { error: REASONS[parsed.reason] ?? "No pudimos usar ese link." };

  const d = db();
  const store = await d.query.stores.findFirst({ where: eq(schema.stores.id, parsed.storeId) });
  if (!store?.enabled) return { error: `${parsed.storeName} todavía no está activa.` };

  const { productId } = await ensureTracked(d, user.id, parsed);
  revalidatePath("/seguimientos");
  redirect(`/producto/${productId}?nuevo=1`);
}

/** Dejar de seguir. Archiva el listing si ya nadie lo sigue (el worker deja de revisarlo). */
export async function unwatch(productId: string): Promise<void> {
  const user = await getUser();
  if (!user) redirect("/login");
  const d = db();
  await d.transaction(async (tx) => {
    const [watch] = await tx
      .delete(schema.watches)
      .where(and(eq(schema.watches.userId, user.id), eq(schema.watches.productId, productId)))
      .returning();
    if (!watch) return;
    await tx.execute(sql`
      update listings l set status = 'archived'
      where l.product_id = ${productId}
        and not exists (
          select 1 from watch_listings wl join watches w on w.id = wl.watch_id
          where wl.listing_id = l.id and w.active
        )
    `);
  });
  revalidatePath("/seguimientos");
  redirect("/seguimientos");
}

function clpFromForm(v: FormDataEntryValue | null): number | undefined {
  const raw = String(v ?? "").replace(/[^\d]/g, "");
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export type ManualResult = { ok: true } | { error: string } | undefined;

/** "Actualizar precio a mano": cuando nada más funciona. Se guarda con source = manual. */
export async function manualPrice(listingId: string, _prev: ManualResult, formData: FormData): Promise<ManualResult> {
  const user = await getUser();
  if (!user) redirect("/login");
  const d = db();
  if (!(await userFollowsListing(d, user.id, listingId))) return { error: "No sigues esta publicación." };
  const listing = await d.query.listings.findFirst({ where: eq(schema.listings.id, listingId) });
  if (!listing) return { error: "No encontramos la publicación." };

  const stock = String(formData.get("stock") ?? "in_stock") as StockStatus;
  const capture = sanitizeCapture({
    url: listing.url,
    title: listing.title,
    priceNormal: clpFromForm(formData.get("normal")),
    priceOffer: clpFromForm(formData.get("offer")),
    priceCard: clpFromForm(formData.get("card")),
    cardName: clpFromForm(formData.get("card")) ? (listing.cardName ?? "Tarjeta de la tienda") : undefined,
    stockStatus: stock,
  });
  if (!capture) return { error: "Ingresa al menos un precio (en pesos, sin decimales)." };
  if (capture.priceOffer && capture.priceNormal && capture.priceOffer >= capture.priceNormal) {
    return { error: "La oferta debería ser menor que el precio normal." };
  }
  const { changed } = await recordCapture(d, listingId, capture, "manual", user.id);
  if (changed) deliverSoon();
  revalidatePath(`/producto/${listing.productId}`);
  revalidatePath("/seguimientos");
  return { ok: true };
}

export type TokenResult = { token: string } | { error: string } | undefined;

/** Genera (o regenera) el token de la extensión. El anterior deja de funcionar. */
export async function createExtensionToken(): Promise<TokenResult> {
  const user = await getUser();
  if (!user) redirect("/login");
  const token = await issueExtensionToken(db(), user.id);
  revalidatePath("/configuracion");
  return { token };
}

export async function deleteExtensionToken(): Promise<void> {
  const user = await getUser();
  if (!user) redirect("/login");
  await revokeExtensionToken(db(), user.id);
  revalidatePath("/configuracion");
}

export interface FollowItem {
  url: string;
  title: string;
  brand?: string;
  imageUrl?: string;
  priceNormal?: number;
  priceOffer?: number;
  priceCard?: number;
  cardName?: string;
  stockStatus?: string;
  seller?: string;
  sellerType?: string;
}

/**
 * Seguir un grupo de la búsqueda: UN producto con las tiendas que elegiste.
 * El precio del listado queda como primer punto del historial (se confirma en la próxima revisión o visita).
 */
export async function followGroup(items: FollowItem[]): Promise<TrackResult> {
  const user = await getUser();
  if (!user) redirect("/login?next=/buscar");
  const d = db();
  let productId: string | undefined;
  for (const it of items.slice(0, 10)) {
    const parsed = parseListingUrl(it.url);
    if (!parsed.ok) continue;
    const cap = sanitizeCapture({ ...it, url: parsed.url, stockStatus: it.stockStatus ?? "unknown" });
    const ids = await ensureTracked(d, user.id, parsed, cap ?? { title: it.title }, productId);
    productId ??= ids.productId;
    if (cap) await recordCapture(d, ids.listingId, cap, parsed.mode === "server" ? "server" : "extension", user.id);
  }
  if (!productId) return { error: "No pudimos seguir esas publicaciones." };
  revalidatePath("/seguimientos");
  redirect(`/producto/${productId}?nuevo=1`);
}
