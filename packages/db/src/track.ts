import { hasPriceStateChanged, type CapturedProduct, type PriceSource } from "@rastreador/core";
import { queueAlertsForSnapshot } from "./alerts";
import type { Database } from "./client";
import * as schema from "./schema";
import { and, eq, sql } from "drizzle-orm";

/*
 * Escrituras compartidas por el buscador (pegar link), la API de la extensión y el ingreso manual.
 * Reciben siempre el userId de una sesión o token validado.
 */

export interface ListingRef {
  url: string;
  storeId: string;
  storeName: string;
}

function slugTitle(url: string, fallback: string) {
  const last = new URL(url).pathname.split("/").filter(Boolean);
  const slug = decodeURIComponent(
    // Falabella: /product/{id}/{slug}/{sku} → el slug es el penúltimo.
    last.length >= 3 && /^\d+$/.test(last[last.length - 1]!) ? last[last.length - 2]! : last[last.length - 1] ?? "",
  )
    .replace(/\.html$/, "")
    .replace(/-?\d{6,}p?$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return slug || fallback;
}

/** Crea (si hace falta) producto + listing y deja al usuario siguiéndolo. Devuelve los ids. */
export async function ensureTracked(
  db: Database,
  userId: string,
  ref: ListingRef,
  hint?: Pick<CapturedProduct, "title" | "brand" | "imageUrl" | "ean">,
  /** Para seguir un grupo de búsqueda: agrega esta tienda al producto ya creado. */
  intoProductId?: string,
): Promise<{ productId: string; listingId: string }> {
  return db.transaction(async (tx) => {
    let listing = await tx.query.listings.findFirst({ where: eq(schema.listings.url, ref.url) });
    if (listing && intoProductId && listing.productId !== intoProductId) {
      // El link ya existe en otro producto. Se mueve solo si no le quita nada a nadie:
      // ese producto tiene únicamente este link y ninguna otra persona lo sigue.
      const oldId = listing.productId;
      const [counts] = (await tx.execute(sql`
        select
          (select count(*) from watches where product_id = ${oldId} and user_id <> ${userId})::int as others,
          (select count(*) from listings where product_id = ${oldId})::int as links
      `)) as unknown as { others: number; links: number }[];
      if (counts?.others === 0 && counts.links === 1) {
        await tx.update(schema.listings).set({ productId: intoProductId }).where(eq(schema.listings.id, listing.id));
        await tx.delete(schema.watches).where(and(eq(schema.watches.userId, userId), eq(schema.watches.productId, oldId)));
        await tx.delete(schema.products).where(eq(schema.products.id, oldId));
        listing = { ...listing, productId: intoProductId };
      }
    }
    if (!listing) {
      const name = hint?.title ?? `Pendiente: ${slugTitle(ref.url, ref.storeName)}`;
      const [product] = intoProductId
        ? [{ id: intoProductId }]
        : await tx
            .insert(schema.products)
            .values({ canonicalName: name, brand: hint?.brand ?? null, imageUrl: hint?.imageUrl ?? null })
            .returning();
      [listing] = await tx
        .insert(schema.listings)
        .values({
          productId: product!.id,
          storeId: ref.storeId,
          url: ref.url,
          title: hint?.title ?? slugTitle(ref.url, "Pendiente"),
          imageUrl: hint?.imageUrl ?? null,
        })
        .returning();
    } else if (listing.status === "archived") {
      await tx
        .update(schema.listings)
        .set({ status: "active", nextCheckAt: sql`now()` })
        .where(eq(schema.listings.id, listing.id));
    }

    const [watch] = await tx
      .insert(schema.watches)
      .values({ userId, productId: listing!.productId })
      .onConflictDoUpdate({ target: [schema.watches.userId, schema.watches.productId], set: { active: true } })
      .returning();
    await tx
      .insert(schema.watchListings)
      .values({ watchId: watch!.id, listingId: listing!.id })
      .onConflictDoUpdate({
        target: [schema.watchListings.watchId, schema.watchListings.listingId],
        set: { enabled: true },
      });
    return { productId: listing!.productId, listingId: listing!.id };
  });
}

/**
 * Registra un precio capturado (extensión o manual) en un listing existente.
 * Igual que el worker: snapshot solo si cambió precio o stock; siempre actualiza "último chequeo".
 */
export async function recordCapture(
  db: Database,
  listingId: string,
  cap: CapturedProduct,
  source: Extract<PriceSource, "server" | "extension" | "manual">,
  userId: string,
): Promise<{ changed: boolean; snapshotId?: number }> {
  const listing = await db.query.listings.findFirst({ where: eq(schema.listings.id, listingId) });
  if (!listing) return { changed: false };

  const prev = {
    priceNormal: listing.priceNormal ?? undefined,
    priceOffer: listing.priceOffer ?? undefined,
    priceCard: listing.priceCard ?? undefined,
    cardName: listing.cardName ?? undefined,
    stockStatus: listing.stockStatus,
  };
  const changed = listing.lastCheckedAt == null || hasPriceStateChanged(prev, cap);
  const now = new Date();
  let snapshotId: number | undefined;

  await db.transaction(async (tx) => {
    if (changed) {
      const [snap] = await tx.insert(schema.priceSnapshots).values({
        listingId,
        observedAt: now,
        priceNormal: cap.priceNormal ?? null,
        priceOffer: cap.priceOffer ?? null,
        priceCard: cap.priceCard ?? null,
        cardName: cap.cardName ?? null,
        stockStatus: cap.stockStatus,
        source,
        reportedBy: userId,
      }).returning({ id: schema.priceSnapshots.id });
      snapshotId = snap?.id;
    }
    await tx
      .update(schema.listings)
      .set({
        // El ingreso manual no trae título/imagen nuevos: conserva los actuales.
        title: source === "manual" ? listing.title : cap.title,
        imageUrl: cap.imageUrl ?? listing.imageUrl,
        externalId: cap.sku ?? listing.externalId,
        ean: cap.ean ?? listing.ean,
        seller: cap.seller ?? listing.seller,
        sellerType: cap.sellerType ?? listing.sellerType,
        priceNormal: cap.priceNormal ?? null,
        priceOffer: cap.priceOffer ?? null,
        priceCard: cap.priceCard ?? null,
        cardName: cap.cardName ?? null,
        stockStatus: cap.stockStatus,
        lastSource: source,
        lastCheckedAt: now,
        ...(changed && { lastChangedAt: now }),
        lastError: null,
      })
      .where(eq(schema.listings.id, listingId));

    if (source !== "manual") {
      await tx.execute(sql`
        update products set
          canonical_name = case when canonical_name like 'Pendiente:%' then ${cap.title} else canonical_name end,
          brand = coalesce(brand, ${cap.brand ?? null}),
          image_url = coalesce(image_url, ${cap.imageUrl ?? null})
        where id = ${listing.productId}
      `);
    }
  });

  if (snapshotId != null) {
    await queueAlertsForSnapshot(db, {
      listingId,
      snapshotId,
      prev: listing.lastCheckedAt == null ? null : prev,
      next: cap,
      sellerType: cap.sellerType ?? listing.sellerType,
    });
  }
  return { changed, snapshotId };
}

/** ¿El usuario sigue este listing? */
export async function userFollowsListing(db: Database, userId: string, listingId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.watches.id })
    .from(schema.watchListings)
    .innerJoin(schema.watches, eq(schema.watches.id, schema.watchListings.watchId))
    .where(
      and(
        eq(schema.watchListings.listingId, listingId),
        eq(schema.watches.userId, userId),
        eq(schema.watches.active, true),
        eq(schema.watchListings.enabled, true),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Ventana fija: true si todavía hay cupo. Atómico en Postgres (sirve con varias instancias de Vercel). */
export async function takeRateLimit(db: Database, key: string, limit: number, windowSec: number): Promise<boolean> {
  const [row] = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count)
    values (${key}, to_timestamp(floor(extract(epoch from now()) / ${windowSec}) * ${windowSec}), 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count
  `);
  // Limpieza perezosa de ventanas viejas (barato: índice por PK).
  if (Math.random() < 0.02) await db.execute(sql`delete from rate_limits where window_start < now() - interval '1 day'`);
  return (row?.count ?? 0) <= limit;
}
