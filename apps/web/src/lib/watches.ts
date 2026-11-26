import "server-only";
import {
  bestPriceNoCard,
  bestPriceWithCard,
  buildSegments,
  computeStats,
  formatUnitPrice,
  unitPriceFromTitle,
  type PriceStats,
  type StockStatus,
} from "@rastreador/core";
import { schema } from "@rastreador/db";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "./db";
import { computeInsights, saleEvents, toTimed, type Insights } from "./insights";

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
  /** Precio por kg, L o unidad según el título ("$2.997/L"), si tiene medida. */
  unitPrice?: string;
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
  insights: Insights;
}

function unitLabel(title: string, price: number | undefined): string | undefined {
  const u = unitPriceFromTitle(title, price);
  return u && formatUnitPrice(u);
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
    unitPrice: unitLabel(l.title, inStock ? bestPriceNoCard(prices) : undefined),
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
  // 90 días: el veredicto usa estadísticas de 90 días; el sparkline muestra los últimos 30.
  const since = new Date(Date.now() - 90 * 86_400_000);
  const sparkFrom = Date.now() - 30 * 86_400_000;
  const events = await saleEvents();
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
    const series = best ? snaps.filter((s) => s.listingId === best.id && s.observedAt.getTime() >= sparkFrom) : [];
    const byListing = new Map(listings.map((l) => [l.id, snaps.filter((s) => s.listingId === l.id).map(toTimed)]));
    const insights = computeInsights(listings, byListing, events);
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
      insights,
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
  alertSettings: {
    targetPrice: number | null;
    dropPct: string | null;
    notifyAllTimeLow: boolean;
    notifyRestock: boolean;
    excludeThirdParty: boolean;
    priceBasis: "no_card" | "with_card" | "both";
    channels: string[];
  };
  hasThirdParty: boolean;
  listings: ListingView[];
  history: HistoryPoint[];
  /** Estadísticas del mejor listing (sin tarjeta), ponderadas por tiempo. */
  stats: PriceStats | null;
  allTimeMin?: { price: number; t: number; storeName: string };
  bestNoCard?: number;
  bestWithCard?: number;
  best?: ListingView;
  insights: Insights;
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
  const byListing = new Map(listings.map((l) => [l.id, snaps.filter((s) => s.listingId === l.id).map(toTimed)]));
  const insights = computeInsights(listings, byListing, await saleEvents());
  return {
    watchId: row.watch.id,
    productId: row.product.id,
    name: row.product.canonicalName.replace(/^Pendiente:\s*/, ""),
    brand: row.product.brand,
    imageUrl: row.product.imageUrl ?? best?.imageUrl ?? null,
    targetPrice: row.watch.targetPrice,
    alertSettings: {
      targetPrice: row.watch.targetPrice,
      dropPct: row.watch.dropPct,
      notifyAllTimeLow: row.watch.notifyAllTimeLow,
      notifyRestock: row.watch.notifyRestock,
      excludeThirdParty: row.watch.excludeThirdParty,
      priceBasis: row.watch.priceBasis,
      channels: row.watch.channels,
    },
    hasThirdParty: links.some((l) => l.listing.sellerType === "third_party"),
    listings,
    history,
    stats,
    allTimeMin: minPoint?.noCard
      ? { price: minPoint.noCard, t: minPoint.t, storeName: listings.find((l) => l.id === minPoint.listingId)?.storeName ?? "" }
      : undefined,
    bestNoCard: best?.bestNoCard,
    bestWithCard: minBy(listings, (l) => l.bestWithCard)?.bestWithCard,
    best,
    insights,
  };
}

export interface AlertRow {
  id: string;
  kind: "target" | "drop_pct" | "all_time_low" | "restock";
  channel: string;
  status: "pending" | "sent" | "failed";
  reason: string;
  price: number | null;
  createdAt: Date;
  productId: string;
  productName: string;
  storeName: string;
  error?: string;
}

/** Historial de alertas del usuario (más recientes primero). */
export async function listAlerts(userId: string, limit = 100): Promise<AlertRow[]> {
  const rows = await db()
    .select({ alert: schema.alerts, product: schema.products, store: schema.stores })
    .from(schema.alerts)
    .innerJoin(schema.listings, eq(schema.listings.id, schema.alerts.listingId))
    .innerJoin(schema.products, eq(schema.products.id, schema.listings.productId))
    .innerJoin(schema.stores, eq(schema.stores.id, schema.listings.storeId))
    .where(eq(schema.alerts.userId, userId))
    .orderBy(desc(schema.alerts.createdAt))
    .limit(limit);
  return rows.map(({ alert, product, store }) => {
    const payload = (alert.payload ?? {}) as { reason?: string; price?: number; error?: string };
    return {
      id: alert.id,
      kind: alert.kind,
      channel: alert.channel,
      status: alert.status,
      reason: payload.reason ?? "",
      price: payload.price ?? null,
      createdAt: alert.createdAt,
      productId: product.id,
      productName: product.canonicalName.replace(/^Pendiente:\s*/, ""),
      storeName: store.name,
      error: payload.error,
    };
  });
}
