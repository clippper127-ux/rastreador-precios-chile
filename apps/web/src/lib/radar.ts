import "server-only";
import { DEAL_CATEGORIES, dealCategories } from "@rastreador/core";
import { recentSummaries } from "@rastreador/db/summaries";
import { schema } from "@rastreador/db";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "./db";

export interface RadarSource {
  id: string;
  kind: "channel" | "group";
  title: string;
  handle: string | null;
  enabled: boolean;
  lastCheckedAt: Date | null;
  lastError: string | null;
}

export interface RadarPost {
  id: number;
  channelTitle: string;
  channelHandle: string | null;
  externalId: number;
  postedAt: Date;
  text: string;
  storeLinks: { url: string; storeId: string; storeName: string }[];
  prices: number[];
  discountPct: number | null;
  flags: string[];
  reasons: string[] | null;
  categories: string[];
}

export async function getRadar(userId: string) {
  const d = db();
  const subs = await d
    .select({ sub: schema.dealSubscriptions, channel: schema.dealChannels })
    .from(schema.dealSubscriptions)
    .innerJoin(schema.dealChannels, eq(schema.dealChannels.id, schema.dealSubscriptions.channelId))
    .where(eq(schema.dealSubscriptions.userId, userId))
    .orderBy(desc(schema.dealSubscriptions.createdAt));

  const sources: RadarSource[] = subs.map(({ sub, channel }) => ({
    id: channel.id,
    kind: channel.kind,
    title: channel.title ?? channel.handle ?? channel.id,
    handle: channel.handle,
    enabled: sub.enabled,
    lastCheckedAt: channel.lastCheckedAt,
    lastError: channel.lastError,
  }));

  const ids = sources.filter((s) => s.enabled).map((s) => s.id);
  const rows = ids.length
    ? await d
        .select({ post: schema.dealPosts, channel: schema.dealChannels, match: schema.dealMatches })
        .from(schema.dealPosts)
        .innerJoin(schema.dealChannels, eq(schema.dealChannels.id, schema.dealPosts.channelId))
        .leftJoin(
          schema.dealMatches,
          and(eq(schema.dealMatches.postId, schema.dealPosts.id), eq(schema.dealMatches.userId, userId)),
        )
        .where(and(inArray(schema.dealPosts.channelId, ids), gte(schema.dealPosts.postedAt, new Date(Date.now() - 7 * 86_400_000))))
        .orderBy(desc(schema.dealPosts.postedAt))
        .limit(80)
    : [];

  const posts: RadarPost[] = rows.map(({ post, channel, match }) => ({
    id: post.id,
    channelTitle: channel.title ?? channel.handle ?? "",
    channelHandle: channel.handle,
    externalId: post.externalId,
    postedAt: post.postedAt,
    text: post.text,
    storeLinks: post.storeLinks as RadarPost["storeLinks"],
    prices: post.prices,
    discountPct: post.discountPct,
    flags: post.flags,
    reasons: match?.reasons ?? null,
    categories: dealCategories(post.text).map((c) => DEAL_CATEGORIES[c].label),
  }));

  const profile = await d.query.profiles.findFirst({ where: eq(schema.profiles.id, userId) });
  return {
    sources,
    posts,
    keywords: profile?.radarKeywords ?? [],
    priceErrors: profile?.radarPriceErrors ?? true,
    hotLevel: profile?.radarHotLevel ?? 2,
    hotWords: profile?.radarHotWords ?? [],
    catsInclude: profile?.radarCatsInclude ?? [],
    catsExclude: profile?.radarCatsExclude ?? [],
    blockWords: profile?.radarBlockWords ?? [],
    telegramLinked: !!profile?.telegramChatId,
    summaries: (await recentSummaries(d, userId)).map(({ s: x, title, handle }) => ({
      id: x.id,
      chat: title ?? handle ?? "Chat",
      title: x.title,
      bullets: x.bullets,
      messageCount: x.messageCount,
      createdAt: x.createdAt,
      url: handle && x.firstExternalId ? `https://t.me/${handle}/${x.firstExternalId}` : null,
    })),
    aiEnabled: !!process.env.LLM_API_KEY?.trim(),
  };
}
