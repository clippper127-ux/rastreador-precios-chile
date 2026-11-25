import "server-only";
import {
  bestPriceNoCard,
  bestPriceWithCard,
  buildSegments,
  computeStats,
  type PriceStats,
  type StockStatus,
} from "@rastreador/core";
import { schema } from "@rastreador/db";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { db } from "./db";

/*
 * Lecturas de "lo mío". TODAS reciben el userId de la sesión y filtran por él.
 */

export interface ListingView {
  id: string;
  storeId: string;
  storeName: string;
  url: string;
  title: string;
  imageUrl: string | null;
  priceNormal: number | null;
  priceOffer: number | null;
  priceCard: number | null;
  cardName: string | null;
  stockStatus: StockStatus;
  lastCheckedAt: Date | null;
  lastSource: string | null;
  lastError: string | null;
  storeStatus: string;
  bestNoCard?: number;
  bestWithCard?: number;
  pending: boolean;
}

export interface SparkPoint {
  t: number;
  price: number;
}

export interface WatchCard {
  watchId: string;
  productId: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  listings: ListingView[];
  best?: ListingView;
  bestNoCard?: number;
  bestWithCard?: number;
  /** Variación del mejor precio sin tarjeta vs. el valor anterior (en %). */
  changePct?: number;
  spark: SparkPoint[];
  pending: boolean;
  createdAt: Date;
}

function toView(l: typeof schema.listings.$inferSelect, stores: Map<string, typeof schema.stores.$inferSelect>): ListingView {
  const prices = {
    priceNormal: l.priceNormal ?? undefined,
    priceOffer: l.priceOffer ?? undefined,
    priceCard: l.priceCard ?? undefined,
  };
  const inStock = l.stockStatus !== "out_of_stock" && l.stockStatus !== "discontinued";
  const store = stores.get(l.storeId);
  return {
    id: l.id,
    storeId: l.storeId,
    storeName: store?.name ?? l.storeId,
    url: l.url,
    title: l.title,
    imageUrl: l.imageUrl,
    priceNormal: l.priceNormal,
    priceOffer: l.priceOffer,
    priceCard: l.priceCard,
    cardName: l.cardName,
    stockStatus: l.stockStatus,
    lastCheckedAt: l.lastCheckedAt,
    lastSource: l.lastSource,
    lastError: l.lastError,
    storeStatus: store?.status ?? "ok",
    bestNoCard: inStock ? bestPriceNoCard(prices) : undefined,
    bestWithCard: inStock ? bestPriceWithCard(prices) : undefined,
    pending: l.lastCheckedAt == null,
  };
}

function minBy<T>(items: T[], key: (t: T) => number | undefined): T | undefined {
  let best: T | undefined;
  let bestVal = Infinity;
  for (const it of items) {
    const v = key(it);
    if (v != null && v < bestVal) {
      best = it;
      bestVal = v;
    }
  }
  return best;
}

async function storesMap() {
  const rows = await db().select().from(schema.stores);
  return new Map(rows.map((s) => [s.id, s]));
}

/** Dashboard: productos que sigo con su mejor precio actual, variación y sparkline (30 días). */
export async function listWatchCards(userId: string): Promise<WatchCard[]> {
  const d = db();
  const watches = await d
    .select({ watch: schema.watches, product: schema.products })
    .from(schema.watches)
    .innerJoin(schema.products, eq(schema.products.id, schema.watches.productId))
    .where(and(eq(schema.watches.userId, userId), eq(schema.watches.active, true)))
    .orderBy(asc(schema.watches.createdAt));
  if (!watches.length) return [];

  const links = await d
    .select({ watchId: schema.watchListings.watchId, listing: schema.listings })
    .from(schema.watchListings)
    .innerJoin(schema.listings, eq(schema.listings.id, schema.watchListings.listingId))
    .where(
      and(
        inArray(schema.watchListings.watchId, watches.map((w) => w.watch.id)),
        eq(schema.watchListings.enabled, true),
      ),
    );

  const listingIds = links.map((l) => l.listing.id);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const snaps = listingIds.length
    ? await d
        .select()
        .from(schema.priceSnapshots)
        .where(and(inArray(schema.priceSnapshots.listingId, listingIds), gte(schema.priceSnapshots.observedAt, since)))
        .orderBy(asc(schema.priceSnapshots.observedAt))
    : [];
  const stores = await storesMap();

  return watches.map(({ watch, product }) => {
    const listings = links.filter((l) => l.watchId === watch.id).map((l) => toView(l.listing, stores));
    const best = minBy(listings, (l) => l.bestNoCard);
    const bestWithCard = minBy(listings, (l) => l.bestWithCard)?.bestWithCard;

    // Sparkline y variación del listing más barato.
    const series = best ? snaps.filter((s) => s.listingId === best.id) : [];
    const spark: SparkPoint[] = series
      .map((s) => ({
        t: s.observedAt.getTime(),
        price: bestPriceNoCard({ priceNormal: s.priceNormal ?? undefined, priceOffer: s.priceOffer ?? undefined }),
      }))
      .filter((p): p is SparkPoint => p.price != null);
    if (best?.bestNoCard != null && best.lastCheckedAt) spark.push({ t: best.lastCheckedAt.getTime(), price: best.bestNoCard });
    const prev = spark.length >= 2 ? spark[spark.length - 2]!.price : undefined;
    const changePct =
      prev && best?.bestNoCard != null && prev !== best.bestNoCard ? ((best.bestNoCard - prev) / prev) * 100 : undefined;

    return {
      watchId: watch.id,
      productId: product.id,
      name: product.canonicalName.replace(/^Pendiente:\s*/, ""),
      brand: product.brand,
      imageUrl: product.imageUrl ?? best?.imageUrl ?? null,
      listings,
      best,
      bestNoCard: best?.bestNoCard,
      bestWithCard,
      changePct,
      spark,
      pending: listings.every((l) => l.pending),
      createdAt: watch.createdAt,
    };
  });
}

export interface HistoryPoint {
  t: number;
  listingId: string;
  noCard?: number;
  withCard?: number;
  stock: StockStatus;
  source: string;
}

export interface ProductDetail {
  watchId: string;
  productId: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  targetPrice: number | null;
  listings: ListingView[];
  history: HistoryPoint[];
  /** Estadísticas del mejor listing (sin tarjeta), ponderadas por tiempo. */
  stats: PriceStats | null;
  allTimeMin?: { price: number; t: number; storeName: string };
  bestNoCard?: number;
  bestWithCard?: number;
  best?: ListingView;
}

/** Detalle de un producto que sigo. Devuelve null si no es mío (404). */
export async function getProductDetail(userId: string, productId: string): Promise<ProductDetail | null> {
  const d = db();
  const [row] = await d
    .select({ watch: schema.watches, product: schema.products })
    .from(schema.watches)
    .innerJoin(schema.products, eq(schema.products.id, schema.watches.productId))
    .where(and(eq(schema.watches.userId, userId), eq(schema.watches.productId, productId)))
    .limit(1);
  if (!row) return null;

  const links = await d
    .select({ listing: schema.listings })
    .from(schema.watchListings)
    .innerJoin(schema.listings, eq(schema.listings.id, schema.watchListings.listingId))
    .where(eq(schema.watchListings.watchId, row.watch.id));
  const stores = await storesMap();
  const listings = links.map((l) => toView(l.listing, stores));
  const ids = listings.map((l) => l.id);

  const snaps = ids.length
    ? await d
        .select()
        .from(schema.priceSnapshots)
        .where(inArray(schema.priceSnapshots.listingId, ids))
        .orderBy(asc(schema.priceSnapshots.observedAt))
    : [];

  const history: HistoryPoint[] = snaps.map((s) => {
    const p = { priceNormal: s.priceNormal ?? undefined, priceOffer: s.priceOffer ?? undefined, priceCard: s.priceCard ?? undefined };
    return {
      t: s.observedAt.getTime(),
      listingId: s.listingId,
      noCard: bestPriceNoCard(p),
      withCard: bestPriceWithCard(p),
      stock: s.stockStatus,
      source: s.source,
    };
  });

  const best = minBy(listings, (l) => l.bestNoCard);
  let stats: PriceStats | null = null;
  if (best?.lastCheckedAt) {
    const own = snaps
      .filter((s) => s.listingId === best.id)
      .map((s) => ({
        observedAt: s.observedAt,
        priceNormal: s.priceNormal ?? undefined,
        priceOffer: s.priceOffer ?? undefined,
        priceCard: s.priceCard ?? undefined,
        stockStatus: s.stockStatus,
      }));
    stats = computeStats(buildSegments(own, best.lastCheckedAt, "no_card"));
  }

  const minPoint = minBy(history, (h) => (h.stock === "out_of_stock" ? undefined : h.noCard));
  return {
    watchId: row.watch.id,
    productId: row.product.id,
    name: row.product.canonicalName.replace(/^Pendiente:\s*/, ""),
    brand: row.product.brand,
    imageUrl: row.product.imageUrl ?? best?.imageUrl ?? null,
    targetPrice: row.watch.targetPrice,
    listings,
    history,
    stats,
    allTimeMin: minPoint?.noCard
      ? { price: minPoint.noCard, t: minPoint.t, storeName: listings.find((l) => l.id === minPoint.listingId)?.storeName ?? "" }
      : undefined,
    bestNoCard: best?.bestNoCard,
    bestWithCard: minBy(listings, (l) => l.bestWithCard)?.bestWithCard,
    best,
  };
}
