import {
  AdapterError,
  adapterById,
  adapters,
  hasPriceStateChanged,
  type ProductSnapshot,
  type StockStatus,
} from "@rastreador/core";
import { schema, type Database } from "@rastreador/db";
import { eq, sql } from "drizzle-orm";
import { politeFetch } from "./http";

/**
 * Una pasada del worker:
 * 1. Reclama listings vencidos (FOR UPDATE SKIP LOCKED + locked_until) de tiendas activas, no pausadas
 *    ni bloqueadas, cuya cadena de fuentes incluye "server".
 * 2. Por tienda en paralelo; dentro de cada tienda en serie, reservando turno en `store_rate`
 *    (rate limit global compartido entre GitHub Actions y tu PC).
 * 3. Guarda snapshot solo si cambió precio o stock; siempre actualiza last_checked_at y next_check_at.
 * 4. Bloqueo → backoff exponencial de la tienda completa (1 h, 2 h, 4 h... tope 48 h) y se deja de intentar.
 */

const BATCH = 60;
const LOCK_MINUTES = 15;
const MAX_BACKOFF_HOURS = 48;

type Listing = typeof schema.listings.$inferSelect;
type Store = typeof schema.stores.$inferSelect;

export interface PassSummary {
  claimed: number;
  checked: number;
  snapshots: number;
  errors: number;
  blockedStores: string[];
  byStore: Record<string, { ok: number; errors: number; lastError?: string }>;
}

async function claimDueListings(db: Database): Promise<Listing[]> {
  const rows = await db.execute<{ id: string }>(sql`
    with due as (
      select l.id
      from listings l
      join stores s on s.id = l.store_id
      where l.status = 'active'
        and l.next_check_at <= now()
        and (l.locked_until is null or l.locked_until < now())
        and s.enabled and not s.paused
        and (s.blocked_until is null or s.blocked_until < now())
        and 'server' = any(s.source_chain)
        -- Solo tiendas con adaptador de servidor (las de la extensión se actualizan desde el navegador).
        and s.id in (${sql.join(adapters.map((a) => sql`${a.id}`), sql`, `)})
      order by l.next_check_at
      limit ${BATCH}
      for update of l skip locked
    )
    update listings set locked_until = now() + make_interval(mins => ${LOCK_MINUTES})
    where id in (select id from due)
    returning id
  `);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  return db.query.listings.findMany({ where: (l, { inArray }) => inArray(l.id, ids) });
}

/** Reserva el próximo turno para la tienda y espera hasta él (rate limit global en Postgres). */
async function waitStoreTurn(db: Database, store: Store) {
  const gapMs = Math.ceil(60_000 / Math.max(1, store.maxRequestsPerMin));
  const [row] = await db.execute<{ slot: Date }>(sql`
    update store_rate
    set next_allowed_at = greatest(now(), next_allowed_at) + make_interval(secs => ${gapMs / 1000})
    where store_id = ${store.id}
    returning next_allowed_at - make_interval(secs => ${gapMs / 1000}) as slot
  `);
  const wait = row ? new Date(row.slot).getTime() - Date.now() : 0;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

function nextCheck(store: Store): Date {
  // Pequeño desorden (±10%) para que no todo venza a la vez.
  const minutes = store.minCheckIntervalMin * (0.9 + Math.random() * 0.2);
  return new Date(Date.now() + minutes * 60_000);
}

async function saveResult(db: Database, listing: Listing, store: Store, snap: ProductSnapshot): Promise<boolean> {
  const prev = {
    priceNormal: listing.priceNormal ?? undefined,
    priceOffer: listing.priceOffer ?? undefined,
    priceCard: listing.priceCard ?? undefined,
    cardName: listing.cardName ?? undefined,
    stockStatus: listing.stockStatus as StockStatus,
  };
  const neverChecked = listing.lastCheckedAt == null;
  const changed = neverChecked || hasPriceStateChanged(prev, snap);
  const now = new Date();

  await db.transaction(async (tx) => {
    if (changed) {
      await tx.insert(schema.priceSnapshots).values({
        listingId: listing.id,
        observedAt: now,
        priceNormal: snap.priceNormal ?? null,
        priceOffer: snap.priceOffer ?? null,
        priceCard: snap.priceCard ?? null,
        cardName: snap.cardName ?? null,
        stockStatus: snap.stockStatus,
        source: snap.source,
      });
    }
    await tx
      .update(schema.listings)
      .set({
        title: snap.title,
        imageUrl: snap.imageUrl ?? listing.imageUrl,
        externalId: snap.sku ?? listing.externalId,
        ean: snap.ean ?? listing.ean,
        seller: snap.seller ?? listing.seller,
        sellerType: snap.sellerType ?? listing.sellerType,
        priceNormal: snap.priceNormal ?? null,
        priceOffer: snap.priceOffer ?? null,
        priceCard: snap.priceCard ?? null,
        cardName: snap.cardName ?? null,
        stockStatus: snap.stockStatus,
        shippingInfo: snap.shippingInfo ?? null,
        lastSource: snap.source,
        lastCheckedAt: now,
        ...(changed && { lastChangedAt: now }),
        nextCheckAt: nextCheck(store),
        attempts: 0,
        lockedUntil: null,
        lastError: null,
      })
      .where(eq(schema.listings.id, listing.id));

    // Completa el producto canónico la primera vez (nombre "pendiente", sin marca/imagen).
    await tx.execute(sql`
      update products set
        canonical_name = case when canonical_name like 'Pendiente:%' then ${snap.title} else canonical_name end,
        brand = coalesce(brand, ${snap.brand ?? null}),
        image_url = coalesce(image_url, ${snap.imageUrl ?? null}),
        ean = coalesce(ean, ${snap.ean ?? null})
      where id = ${listing.productId}
        and (${snap.ean ?? null}::text is null or not exists (select 1 from products p2 where p2.ean = ${snap.ean ?? null} and p2.id <> ${listing.productId}))
    `);
  });
  return changed;
}

async function markListingError(db: Database, listing: Listing, err: AdapterError | Error) {
  const attempts = listing.attempts + 1;
  // Reintento creciente por listing: 30 min, 1 h, 2 h... tope 24 h.
  const minutes = Math.min(30 * 2 ** (attempts - 1), 24 * 60);
  const notFound = err instanceof AdapterError && err.kind === "not_found";
  await db
    .update(schema.listings)
    .set({
      attempts,
      lastError: `${err instanceof AdapterError ? err.kind : "error"}: ${err.message}`.slice(0, 500),
      lockedUntil: null,
      nextCheckAt: new Date(Date.now() + minutes * 60_000),
      ...(notFound && { stockStatus: "discontinued" as const, lastCheckedAt: new Date() }),
    })
    .where(eq(schema.listings.id, listing.id));
}

async function markStoreBlocked(db: Database, store: Store, err: AdapterError) {
  const level = store.backoffLevel + 1;
  const hours = Math.min(2 ** (level - 1), MAX_BACKOFF_HOURS);
  await db
    .update(schema.stores)
    .set({
      status: "blocked",
      backoffLevel: level,
      blockedUntil: new Date(Date.now() + hours * 3_600_000),
      lastErrorAt: new Date(),
      lastError: err.message.slice(0, 500),
    })
    .where(eq(schema.stores.id, store.id));
}

async function processStore(db: Database, store: Store, listings: Listing[], summary: PassSummary) {
  const adapter = adapterById(store.id);
  const stats = (summary.byStore[store.id] = { ok: 0, errors: 0 } as PassSummary["byStore"][string]);
  if (!adapter) {
    // Tienda activa sin adaptador de servidor: libera los listings para que no queden bloqueados.
    for (const l of listings) await markListingError(db, l, new Error("Sin adaptador de servidor"));
    stats.errors = listings.length;
    return;
  }

  const ctx = {
    fetch: async (url: string, init?: RequestInit) => {
      await waitStoreTurn(db, store);
      return politeFetch(url, { ...init, storeId: store.id, minDelayMs: 0 });
    },
  };

  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i]!;
    try {
      const snap = await adapter.getProduct(listing.url, ctx);
      const changed = await saveResult(db, listing, store, snap);
      summary.checked++;
      stats.ok++;
      if (changed) summary.snapshots++;
    } catch (e) {
      const err = e as AdapterError | Error;
      summary.errors++;
      stats.errors++;
      stats.lastError = err.message;
      if (err instanceof AdapterError && err.kind === "blocked") {
        await markStoreBlocked(db, store, err);
        summary.blockedStores.push(store.id);
        // No seguir golpeando una tienda que bloquea: libera el resto para después del backoff.
        for (const rest of listings.slice(i)) {
          await db.update(schema.listings).set({ lockedUntil: null }).where(eq(schema.listings.id, rest.id));
        }
        return;
      }
      await markListingError(db, listing, err);
    }
  }

  if (stats.ok > 0) {
    await db
      .update(schema.stores)
      .set({
        status: stats.errors > 0 ? "degraded" : "ok",
        backoffLevel: 0,
        blockedUntil: null,
        lastSuccessAt: new Date(),
        ...(stats.errors > 0 && { lastErrorAt: new Date(), lastError: stats.lastError?.slice(0, 500) }),
      })
      .where(eq(schema.stores.id, store.id));
  } else if (stats.errors > 0) {
    await db
      .update(schema.stores)
      .set({ status: "degraded", lastErrorAt: new Date(), lastError: stats.lastError?.slice(0, 500) })
      .where(eq(schema.stores.id, store.id));
  }
}

export async function runPass(db: Database): Promise<PassSummary> {
  const summary: PassSummary = { claimed: 0, checked: 0, snapshots: 0, errors: 0, blockedStores: [], byStore: {} };
  const listings = await claimDueListings(db);
  summary.claimed = listings.length;
  if (!listings.length) return summary;

  const stores = await db.query.stores.findMany();
  const byStore = new Map<string, Listing[]>();
  for (const l of listings) byStore.set(l.storeId, [...(byStore.get(l.storeId) ?? []), l]);

  await Promise.all(
    [...byStore].map(([storeId, ls]) => processStore(db, stores.find((s) => s.id === storeId)!, ls, summary)),
  );
  return summary;
}
