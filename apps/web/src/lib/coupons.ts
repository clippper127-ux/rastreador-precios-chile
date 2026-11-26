import "server-only";
import { schema } from "@rastreador/db";
import { and, desc, eq, gte, ilike, inArray, isNull, or } from "drizzle-orm";
import { db } from "./db";

export interface CouponRow {
  id: number;
  code: string;
  store: string | null;
  benefit: string | null;
  minPurchase: number | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  channelTitle: string;
  messageUrl: string | null;
}

export const NO_STORE = "sin-tienda";

/**
 * Cupones de los últimos `days` días, solo de canales y grupos que el usuario tiene activos en el Radar.
 * Filtros: tienda (o NO_STORE) y texto libre (código, tienda o beneficio).
 */
export async function getCoupons(userId: string, opts: { store?: string; q?: string; days?: number } = {}) {
  const d = db();
  const subs = await d
    .select({ id: schema.dealSubscriptions.channelId })
    .from(schema.dealSubscriptions)
    .where(and(eq(schema.dealSubscriptions.userId, userId), eq(schema.dealSubscriptions.enabled, true)));
  const channelIds = subs.map((s) => s.id);
  if (!channelIds.length) return { coupons: [] as CouponRow[], stores: [] as { name: string; count: number }[] };

  const since = new Date(Date.now() - (opts.days ?? 14) * 86_400_000);
  const base = and(inArray(schema.dealCoupons.channelId, channelIds), gte(schema.dealCoupons.lastSeenAt, since));
  const rows = await d
    .select({ c: schema.dealCoupons, ch: schema.dealChannels, post: { externalId: schema.dealPosts.externalId } })
    .from(schema.dealCoupons)
    .innerJoin(schema.dealChannels, eq(schema.dealChannels.id, schema.dealCoupons.channelId))
    .leftJoin(schema.dealPosts, eq(schema.dealPosts.id, schema.dealCoupons.postId))
    .where(
      and(
        base,
        opts.store === NO_STORE ? isNull(schema.dealCoupons.store) : opts.store ? eq(schema.dealCoupons.store, opts.store) : undefined,
        opts.q
          ? or(
              ilike(schema.dealCoupons.code, `%${opts.q}%`),
              ilike(schema.dealCoupons.store, `%${opts.q}%`),
              ilike(schema.dealCoupons.benefit, `%${opts.q}%`),
            )
          : undefined,
      ),
    )
    .orderBy(desc(schema.dealCoupons.lastSeenAt))
    .limit(200);

  const all = await d.select({ store: schema.dealCoupons.store }).from(schema.dealCoupons).where(base);
  const counts = new Map<string, number>();
  for (const r of all) counts.set(r.store ?? NO_STORE, (counts.get(r.store ?? NO_STORE) ?? 0) + 1);

  return {
    coupons: rows.map(
      ({ c, ch, post }): CouponRow => ({
        id: c.id,
        code: c.code,
        store: c.store,
        benefit: c.benefit,
        minPurchase: c.minPurchase,
        firstSeenAt: c.firstSeenAt,
        lastSeenAt: c.lastSeenAt,
        channelTitle: ch.title ?? ch.handle ?? "Telegram",
        messageUrl: ch.handle && post?.externalId ? `https://t.me/${ch.handle}/${post.externalId}` : null,
      }),
    ),
    stores: [...counts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => (a.name === NO_STORE ? 1 : b.name === NO_STORE ? -1 : b.count - a.count)),
  };
}
