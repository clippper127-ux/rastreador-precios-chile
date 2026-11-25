import {
  analyzeDealText,
  channelHandle,
  formatCLP,
  matchDeal,
  parseChannelPage,
  storeLinks,
  type Interest,
  type RawPost,
} from "@rastreador/core";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Transport } from "./alerts";
import type { Database } from "./client";
import * as schema from "./schema";
import { resolveLink } from "./telegram";

/*
 * Radar de ofertas de Telegram:
 * - canales públicos: se leen desde su vista web pública (https://t.me/s/<canal>), sin cuenta;
 * - grupos: el bot recibe los mensajes si lo agregas y activas /radar (ver telegram.ts).
 * Se guardan los mensajes, se cruzan con lo que sigue cada usuario y sus palabras clave, y se avisa.
 */

const UA = process.env.WORKER_USER_AGENT ?? "RastreadorPreciosPersonal/0.1 (uso personal; seguimiento de precios)";

export async function fetchChannelPage(handle: string): Promise<{ title?: string; posts: RawPost[] }> {
  const res = await fetch(`https://t.me/s/${handle}`, {
    headers: { "user-agent": UA, "accept-language": "es-CL,es;q=0.9" },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  // Si el canal no existe o no es público, t.me redirige a la página del canal (sin vista web).
  if (res.status !== 200) throw new Error(res.status >= 300 && res.status < 400 ? "no_publico" : `HTTP ${res.status}`);
  return parseChannelPage(await res.text(), handle);
}

/** Suscribe al usuario a un canal público (verifica que tenga vista web pública). */
export async function subscribeChannel(db: Database, userId: string, input: string): Promise<{ ok: true; title: string } | { error: string }> {
  const handle = channelHandle(input);
  if (!handle) return { error: "Escribe el canal como @nombre o t.me/nombre." };
  let page: Awaited<ReturnType<typeof fetchChannelPage>>;
  try {
    page = await fetchChannelPage(handle);
  } catch (err) {
    return {
      error:
        (err as Error).message === "no_publico"
          ? "Ese canal no es público o no existe. Para grupos privados, agrega el bot al grupo y escribe /radar."
          : "Telegram no respondió. Intenta de nuevo.",
    };
  }
  if (!page.posts.length && !page.title) return { error: "Ese canal no muestra mensajes públicos." };
  const id = `c:${handle}`;
  const lastPostId = Math.max(0, ...page.posts.map((p) => p.id));
  await db
    .insert(schema.dealChannels)
    .values({ id, kind: "channel", handle, title: page.title ?? `@${handle}`, lastPostId: 0 })
    .onConflictDoUpdate({ target: schema.dealChannels.id, set: { title: page.title ?? `@${handle}` } });
  await db
    .insert(schema.dealSubscriptions)
    .values({ userId, channelId: id })
    .onConflictDoUpdate({ target: [schema.dealSubscriptions.userId, schema.dealSubscriptions.channelId], set: { enabled: true } });
  // Guarda los mensajes recientes para que el usuario vea el canal de inmediato (no se avisan: son anteriores).
  await storePosts(db, id, page.posts);
  await db.update(schema.dealChannels).set({ lastPostId, lastCheckedAt: new Date() }).where(eq(schema.dealChannels.id, id));
  return { ok: true, title: page.title ?? `@${handle}` };
}

/** Guarda mensajes nuevos (resuelve links acortados, detecta tiendas, precios y señales). Devuelve los ids insertados. */
export async function storePosts(db: Database, channelId: string, posts: RawPost[]): Promise<number[]> {
  const inserted: number[] = [];
  for (const p of posts) {
    // Resolver como máximo 3 links por mensaje (acortadores/afiliados → ficha de la tienda).
    const resolved = await Promise.all(p.links.slice(0, 3).map((l) => resolveLink(l)));
    const links = storeLinks([...resolved, ...p.links]);
    const a = analyzeDealText(p.text);
    const rows = await db
      .insert(schema.dealPosts)
      .values({
        channelId,
        externalId: p.id,
        postedAt: p.postedAt,
        text: p.text,
        storeLinks: links,
        prices: a.prices,
        discountPct: a.discountPct ?? null,
        flags: a.flags,
      })
      .onConflictDoNothing()
      .returning({ id: schema.dealPosts.id });
    if (rows[0]) inserted.push(rows[0].id);
  }
  return inserted;
}

/** Lee los canales públicos con al menos un suscriptor activo. Una request por canal, 1,5 s entre canales. */
export async function pollPublicChannels(db: Database): Promise<{ channels: number; newPosts: number; errors: number }> {
  const channels = await db
    .selectDistinct({ channel: schema.dealChannels })
    .from(schema.dealChannels)
    .innerJoin(schema.dealSubscriptions, eq(schema.dealSubscriptions.channelId, schema.dealChannels.id))
    .where(and(eq(schema.dealChannels.kind, "channel"), eq(schema.dealSubscriptions.enabled, true)));

  let newPosts = 0;
  let errors = 0;
  for (const [i, { channel }] of channels.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1500));
    try {
      const page = await fetchChannelPage(channel.handle!);
      const fresh = page.posts.filter((p) => p.id > channel.lastPostId);
      const ids = await storePosts(db, channel.id, fresh);
      newPosts += ids.length;
      await matchPosts(db, ids);
      await db
        .update(schema.dealChannels)
        .set({
          lastPostId: Math.max(channel.lastPostId, ...page.posts.map((p) => p.id)),
          lastCheckedAt: new Date(),
          lastError: null,
          ...(page.title && { title: page.title }),
        })
        .where(eq(schema.dealChannels.id, channel.id));
    } catch (err) {
      errors++;
      await db
        .update(schema.dealChannels)
        .set({ lastCheckedAt: new Date(), lastError: (err as Error).message.slice(0, 200) })
        .where(eq(schema.dealChannels.id, channel.id));
    }
  }
  return { channels: channels.length, newPosts, errors };
}

async function interestsOf(db: Database, userId: string): Promise<Interest[]> {
  const rows = await db.execute<{ product_id: string; name: string; urls: string[] | null }>(sql`
    select p.id as product_id, p.canonical_name as name, array_agg(l.url) filter (where l.url is not null) as urls
    from watches w
    join products p on p.id = w.product_id
    left join watch_listings wl on wl.watch_id = w.id and wl.enabled
    left join listings l on l.id = wl.listing_id
    where w.user_id = ${userId} and w.active
    group by p.id, p.canonical_name`);
  return rows.map((r) => ({ productId: r.product_id, name: r.name.replace(/^Pendiente:\s*/, ""), listingUrls: r.urls ?? [] }));
}

/** Cruza mensajes nuevos con los suscriptores del canal (solo mensajes posteriores a la suscripción). */
export async function matchPosts(db: Database, postIds: number[]): Promise<number> {
  if (!postIds.length) return 0;
  const posts = await db.select().from(schema.dealPosts).where(inArray(schema.dealPosts.id, postIds));
  const cache = new Map<string, { interests: Interest[]; keywords: string[]; priceErrors: boolean }>();
  let matched = 0;

  for (const post of posts) {
    const subs = await db
      .select({ sub: schema.dealSubscriptions, profile: schema.profiles })
      .from(schema.dealSubscriptions)
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.dealSubscriptions.userId))
      .where(and(eq(schema.dealSubscriptions.channelId, post.channelId), eq(schema.dealSubscriptions.enabled, true)));
    for (const { sub, profile } of subs) {
      if (post.postedAt < sub.createdAt) continue;
      let ctx = cache.get(sub.userId);
      if (!ctx) {
        ctx = {
          interests: await interestsOf(db, sub.userId),
          keywords: profile?.radarKeywords ?? [],
          priceErrors: profile?.radarPriceErrors ?? true,
        };
        cache.set(sub.userId, ctx);
      }
      const m = matchDeal(
        { text: post.text, storeUrls: (post.storeLinks as { url: string }[]).map((l) => l.url), flags: post.flags as never },
        ctx.interests,
        ctx.keywords,
        { priceErrors: ctx.priceErrors },
      );
      if (!m) continue;
      const rows = await db
        .insert(schema.dealMatches)
        .values({ userId: sub.userId, postId: post.id, reasons: m.reasons, productIds: m.productIds })
        .onConflictDoNothing()
        .returning({ postId: schema.dealMatches.postId });
      matched += rows.length;
    }
  }
  return matched;
}

/** Avisa las coincidencias pendientes (Telegram si está vinculado; si no, correo si está activo). */
export async function notifyDealMatches(db: Database, appUrl: string, transport: Transport): Promise<number> {
  const rows = await db
    .select({ match: schema.dealMatches, post: schema.dealPosts, channel: schema.dealChannels, profile: schema.profiles })
    .from(schema.dealMatches)
    .innerJoin(schema.dealPosts, eq(schema.dealPosts.id, schema.dealMatches.postId))
    .innerJoin(schema.dealChannels, eq(schema.dealChannels.id, schema.dealPosts.channelId))
    .leftJoin(schema.profiles, eq(schema.profiles.id, schema.dealMatches.userId))
    .where(and(isNull(schema.dealMatches.notifiedAt), gt(schema.dealMatches.createdAt, new Date(Date.now() - 2 * 86_400_000))))
    .limit(100);

  let sent = 0;
  for (const { match, post, channel, profile } of rows) {
    const links = (post.storeLinks as { url: string; storeName: string }[]).map((l) => `${l.storeName}: ${l.url}`);
    const text = [
      `📣 ${channel.title ?? "Radar"}`,
      ...match.reasons.map((r) => `• ${r}`),
      post.prices.length ? `Precios: ${post.prices.map((p) => formatCLP(p)).join(" · ")}` : "",
      "",
      post.text.slice(0, 600),
      ...(links.length ? ["", ...links] : []),
      "",
      `Radar: ${appUrl.replace(/\/+$/, "")}/radar`,
    ]
      .filter((l, i, arr) => l !== "" || arr[i - 1] !== "")
      .join("\n");
    try {
      if (profile?.telegramChatId) await transport.telegram(profile.telegramChatId, text);
      else if (profile?.emailAlerts) {
        const [u] = await db.execute<{ email: string | null }>(sql`select email from auth.users where id = ${match.userId}`);
        if (u?.email) await transport.email(u.email, `Radar: ${match.reasons[0]}`, text);
      }
      sent++;
    } catch {
      // Se reintenta en la próxima pasada (hasta que pasen 2 días).
      continue;
    }
    await db
      .update(schema.dealMatches)
      .set({ notifiedAt: new Date() })
      .where(and(eq(schema.dealMatches.userId, match.userId), eq(schema.dealMatches.postId, match.postId)));
  }
  return sent;
}

// ─── Grupos (vía bot) ─────────────────────────────────────────────────────────

export async function enableGroupRadar(db: Database, userId: string, chatId: number, title: string) {
  const id = `g:${chatId}`;
  await db
    .insert(schema.dealChannels)
    .values({ id, kind: "group", chatId, title })
    .onConflictDoUpdate({ target: schema.dealChannels.id, set: { title } });
  await db
    .insert(schema.dealSubscriptions)
    .values({ userId, channelId: id })
    .onConflictDoUpdate({ target: [schema.dealSubscriptions.userId, schema.dealSubscriptions.channelId], set: { enabled: true } });
}

export async function disableGroupRadar(db: Database, userId: string, chatId: number) {
  await db
    .update(schema.dealSubscriptions)
    .set({ enabled: false })
    .where(and(eq(schema.dealSubscriptions.userId, userId), eq(schema.dealSubscriptions.channelId, `g:${chatId}`)));
}

/** Mensaje de un grupo con radar activo → se guarda y se cruza. Ignora grupos sin radar. */
export async function ingestGroupMessage(db: Database, chatId: number, post: RawPost): Promise<boolean> {
  const id = `g:${chatId}`;
  const channel = await db.query.dealChannels.findFirst({ where: eq(schema.dealChannels.id, id) });
  if (!channel) return false;
  const ids = await storePosts(db, id, [post]);
  await matchPosts(db, ids);
  if (ids.length) {
    await db
      .update(schema.dealChannels)
      .set({ lastPostId: Math.max(channel.lastPostId, post.id), lastCheckedAt: new Date() })
      .where(eq(schema.dealChannels.id, id));
  }
  return ids.length > 0;
}
