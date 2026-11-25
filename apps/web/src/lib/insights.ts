import "server-only";
import {
  bestPriceNoCard,
  buildSegments,
  buyOrWait,
  computeStats,
  detectFakeDiscount,
  nextEvent,
  type FakeDiscount,
  type SaleEvent,
  type TimedSnapshot,
  type VerdictResult,
} from "@rastreador/core";
import { schema } from "@rastreador/db";
import { gte } from "drizzle-orm";
import { cache } from "react";
import { db } from "./db";

/** Eventos futuros o en curso (una consulta por request). */
export const saleEvents = cache(async (): Promise<SaleEvent[]> => {
  const rows = await db()
    .select()
    .from(schema.saleEvents)
    .where(gte(schema.saleEvents.endsOn, new Date(Date.now() - 86_400_000)));
  return rows.map((e) => ({ name: e.name, startsOn: e.startsOn, endsOn: e.endsOn }));
});

export interface ListingForInsights {
  id: string;
  priceNormal: number | null;
  priceOffer: number | null;
  bestNoCard?: number;
  lastCheckedAt: Date | null;
}

export interface Insights {
  verdict: VerdictResult;
  /** Descuento falso por listing (solo los que lo tienen). */
  fake: Record<string, FakeDiscount>;
}

/**
 * Veredicto "¿compro ahora o espero?" y descuentos falsos de un producto, a partir de sus listings
 * y snapshots (de todas sus tiendas). Estadísticas de 90 días del listing más barato.
 */
export function computeInsights(
  listings: ListingForInsights[],
  snaps: Map<string, TimedSnapshot[]>,
  events: SaleEvent[],
  now = new Date(),
): Insights {
  const fake: Record<string, FakeDiscount> = {};
  for (const l of listings) {
    if (!l.lastCheckedAt) continue;
    const f = detectFakeDiscount(
      snaps.get(l.id) ?? [],
      { priceNormal: l.priceNormal ?? undefined, priceOffer: l.priceOffer ?? undefined },
      l.lastCheckedAt,
      now,
    );
    if (f) fake[l.id] = f;
  }

  const priced = listings.filter((l) => l.bestNoCard != null && l.lastCheckedAt);
  const best = priced.sort((a, b) => a.bestNoCard! - b.bestNoCard!)[0];
  const others = priced.filter((l) => l !== best).map((l) => l.bestNoCard!);

  const stats = best
    ? computeStats(buildSegments(snaps.get(best.id) ?? [], best.lastCheckedAt!, "no_card", { from: new Date(now.getTime() - 90 * 86_400_000) }))
    : null;
  const allPrices = [...snaps.values()]
    .flat()
    .filter((s) => s.stockStatus !== "out_of_stock" && s.stockStatus !== "discontinued")
    .map((s) => bestPriceNoCard(s))
    .filter((p): p is number => p != null);

  const verdict = buyOrWait({
    current: best?.bestNoCard,
    stats,
    allTimeMin: allPrices.length ? Math.min(...allPrices) : undefined,
    otherStoresMin: others.length ? Math.min(...others) : undefined,
    fakeDiscount: best ? fake[best.id] : undefined,
    upcoming: nextEvent(events, now),
  });
  return { verdict, fake };
}

export function toTimed(s: typeof schema.priceSnapshots.$inferSelect): TimedSnapshot {
  return {
    observedAt: s.observedAt,
    priceNormal: s.priceNormal ?? undefined,
    priceOffer: s.priceOffer ?? undefined,
    priceCard: s.priceCard ?? undefined,
    stockStatus: s.stockStatus,
  };
}
