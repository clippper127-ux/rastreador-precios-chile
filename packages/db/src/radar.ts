import {
  analyzeDealText,
  blockedByFilters,
  channelHandle,
  chatBuzz,
  dealFingerprint,
  HOT_LEVELS,
  hotScore,
  formatCLP,
  matchDeal,
  parseChannelPage,
  storeLinks,
  type Interest,
  type RawPost,
} from "@rastreador/core";
import { and, eq, gt, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
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
/** Links para comprar: sin imágenes, buscadores ni Telegram; abre los de afiliados (?dl=, ?url=). Máx. 5. */
export function buyLinks(resolved: string[], raw: string[]): string[] {
  const out: string[] = [];
  for (let u of [...resolved, ...raw]) {
    if (!/^https?:\/\//i.test(u)) continue;
    try {
      const url = new URL(u);
      const inner = ["dl", "url", "u", "to", "redirect"].map((k) => url.searchParams.get(k)).find((v) => v && /^https?:\/\//i.test(v));
      if (inner) u = inner;
      const h = new URL(u);
      const host = h.hostname.toLowerCase();
      if (/^(www\.)?(t\.me|telegram\.me)$|(^|\.)google\.[a-z.]+$/.test(host)) continue;
      if (/\.(jpe?g|png|gif|webp|avif|svg|mp4)$/i.test(h.pathname) || /(^|\.)(cdn|img|images|static|assets)\b|vtexassets|cdn\.shopify|cloudfront|mlstatic/.test(host) || /\/(files|arquivos)\//.test(h.pathname)) continue;
    } catch {
      continue;
    }
    if (!out.includes(u)) out.push(u);
  }
  return out.slice(0, 5);
}

export async function storePosts(db: Database, channelId: string, posts: RawPost[]): Promise<number[]> {
  const inserted: number[] = [];
  // Links resueltos de a 8 mensajes en paralelo (con cientos de mensajes nuevos, de a uno era muy lento).
  const resolvedAll: string[][] = [];
  for (let i = 0; i < posts.length; i += 8) {
    resolvedAll.push(
      ...(await Promise.all(
        // Máx. 2 links por mensaje (acortadores/afiliados → ficha de la tienda); solo links útiles, no imágenes.
        posts.slice(i, i + 8).map((p) => Promise.all(buyLinks(p.links, []).slice(0, 2).map((l) => resolveLink(l)))),
      )),
    );
  }
  for (const [idx, p] of posts.entries()) {
    const resolved = resolvedAll[idx] ?? [];
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
        reactions: p.reactions ?? 0,
        replies: p.replies ?? 0,
        links: buyLinks(resolved, p.links),
        fingerprint: dealFingerprint(p.text, links.map((l) => l.url)),
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
    .where(and(eq(schema.dealChannels.kind, "channel"), sql`${schema.dealChannels.id} like 'c:%'`, eq(schema.dealSubscriptions.enabled, true)));

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

type Filters = { include: string[]; exclude: string[]; blockWords: string[] };

function filtersOf(p: typeof schema.profiles.$inferSelect | null | undefined): Filters {
  return { include: p?.radarCatsInclude ?? [], exclude: p?.radarCatsExclude ?? [], blockWords: p?.radarBlockWords ?? [] };
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
  const cache = new Map<string, { interests: Interest[]; keywords: string[]; priceErrors: boolean; filters: Filters }>();
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
          filters: filtersOf(profile),
        };
        cache.set(sub.userId, ctx);
      }
      const m = matchDeal(
        { text: post.text, storeUrls: (post.storeLinks as { url: string }[]).map((l) => l.url), flags: post.flags as never },
        ctx.interests,
        ctx.keywords,
        { priceErrors: ctx.priceErrors, blocked: blockedByFilters(post.text, ctx.filters).blocked },
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
    // Se "reserva" el aviso antes de mandarlo: si el PC y GitHub corren a la vez, solo uno lo envía.
    const claimed = await db
      .update(schema.dealMatches)
      .set({ notifiedAt: new Date() })
      .where(and(eq(schema.dealMatches.userId, match.userId), eq(schema.dealMatches.postId, match.postId), isNull(schema.dealMatches.notifiedAt)))
      .returning({ postId: schema.dealMatches.postId });
    if (!claimed.length) continue;
    const store = (post.storeLinks as { url: string; storeName: string }[]).map((l) => `🛒 ${l.storeName}: ${l.url}`);
    // Si no reconocemos la tienda, igual va el link del mensaje para comprar.
    const links = store.length ? store : buyLinks(post.links, []).slice(0, 2).map((u) => `🛒 Comprar: ${u}`);
    const original = channel.handle ? `💬 Mensaje original: https://t.me/${channel.handle}/${post.externalId}` : "";
    const text = [
      `📣 ${channel.title ?? "Radar"}`,
      ...match.reasons.map((r) => `• ${r}`),
      post.prices.length ? `Precios: ${post.prices.map((p) => formatCLP(p)).join(" · ")}` : "",
      "",
      post.text.slice(0, 600),
      ...(links.length ? ["", ...links] : []),
      original,
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
      // Se libera para reintentar en la próxima pasada (hasta que pasen 2 días).
      await db
        .update(schema.dealMatches)
        .set({ notifiedAt: null })
        .where(and(eq(schema.dealMatches.userId, match.userId), eq(schema.dealMatches.postId, match.postId)));
      continue;
    }
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

// ─── Grupos leídos con una cuenta de Telegram dedicada (MTProto) ──────────────

/** Estado de un grupo leído por la cuenta dedicada (id "u:<chat_id>"); `undefined` si es la primera vez. */
export async function readerChatState(db: Database, chatId: number) {
  return db.query.dealChannels.findFirst({ where: eq(schema.dealChannels.id, `u:${chatId}`) });
}

/**
 * Guarda mensajes de un grupo que lee la cuenta dedicada y los cruza con los suscriptores.
 * La primera vez que aparece un grupo se suscribe a quienes tienen Telegram vinculado y sus mensajes
 * recientes se guardan sin avisar (son anteriores). Devuelve cuántos mensajes nuevos se guardaron.
 */
export async function ingestReaderChat(
  db: Database,
  chat: { chatId: number; title: string; handle?: string; broadcast?: boolean },
  posts: RawPost[],
): Promise<number> {
  const id = `u:${chat.chatId}`;
  const existing = await readerChatState(db, chat.chatId);
  if (!existing) {
    await db
      .insert(schema.dealChannels)
      .values({ id, kind: chat.broadcast ? "channel" : "group", chatId: chat.chatId, handle: chat.handle ?? null, title: chat.title, lastPostId: 0 });
    // Se suscribe a quienes tienen Telegram vinculado (los que recibirán los avisos).
    const owners = await db.select({ id: schema.profiles.id }).from(schema.profiles).where(isNotNull(schema.profiles.telegramChatId));
    for (const a of owners) {
      await db.insert(schema.dealSubscriptions).values({ userId: a.id, channelId: id }).onConflictDoNothing();
    }
  }
  const fresh = posts.filter((p) => p.id > (existing?.lastPostId ?? 0));
  const ids = await storePosts(db, id, fresh);
  if (existing) await matchPosts(db, ids);
  await db
    .update(schema.dealChannels)
    .set({
      title: chat.title,
      kind: chat.broadcast ? "channel" : "group",
      lastPostId: Math.max(existing?.lastPostId ?? 0, ...posts.map((p) => p.id)),
      lastCheckedAt: new Date(),
      lastError: null,
    })
    .where(eq(schema.dealChannels.id, id));
  return existing ? ids.length : 0;
}

// ─── Ofertas destacadas ───────────────────────────────────────────────────────

const HOT_WINDOW_MS = 6 * 3_600_000;

/** Actualiza reacciones y respuestas de mensajes recientes ya guardados (las ofertas buenas "explotan" después). */
export async function updateEngagement(db: Database, channelId: string, posts: RawPost[]): Promise<void> {
  const since = Date.now() - HOT_WINDOW_MS;
  const recent = posts.filter((p) => p.postedAt.getTime() >= since);
  if (!recent.length) return;
  // Una sola lectura y solo se actualiza lo que cambió (antes: un UPDATE por mensaje, lento desde GitHub).
  const rows = await db
    .select({ externalId: schema.dealPosts.externalId, reactions: schema.dealPosts.reactions, replies: schema.dealPosts.replies, links: schema.dealPosts.links })
    .from(schema.dealPosts)
    .where(and(eq(schema.dealPosts.channelId, channelId), inArray(schema.dealPosts.externalId, recent.map((p) => p.id))));
  const byId = new Map(rows.map((r) => [r.externalId, r]));
  for (const p of recent) {
    const cur = byId.get(p.id);
    if (!cur) continue;
    // Solo completa links si el mensaje no tenía (no pisa los ya resueltos al guardarlo).
    const bl = cur.links.length ? [] : buyLinks(p.links, p.links);
    if (cur.reactions === (p.reactions ?? 0) && cur.replies === (p.replies ?? 0) && !bl.length) continue;
    await db
      .update(schema.dealPosts)
      .set({ reactions: p.reactions ?? 0, replies: p.replies ?? 0, ...(bl.length > 0 && { links: bl }) })
      .where(and(eq(schema.dealPosts.channelId, channelId), eq(schema.dealPosts.externalId, p.id)));
  }
}

/**
 * Revisa los mensajes de las últimas 6 h y marca como "oferta destacada" los que pasan el umbral
 * de cada usuario (con tope diario y sin repetir la misma oferta vista en otro grupo).
 */
export async function scoreHotPosts(db: Database): Promise<number> {
  // 9 h de contexto para medir la conversación; se avisan solo mensajes de las últimas 6 h.
  const context = await db
    .select()
    .from(schema.dealPosts)
    .where(gte(schema.dealPosts.postedAt, new Date(Date.now() - HOT_WINDOW_MS - 3 * 3_600_000)));
  const posts = context.filter((p) => p.postedAt.getTime() >= Date.now() - HOT_WINDOW_MS);
  if (!posts.length) return 0;
  const buzz = new Map<number, { count: number; word: string }>();
  const byChannel = new Map<string, typeof context>();
  for (const p of context) byChannel.set(p.channelId, [...(byChannel.get(p.channelId) ?? []), p]);
  const groups = new Set(
    (await db.select({ id: schema.dealChannels.id }).from(schema.dealChannels).where(eq(schema.dealChannels.kind, "group"))).map((c) => c.id),
  );
  // La conversación solo cuenta en chats donde la gente escribe (no en canales automáticos).
  for (const [ch, list] of byChannel) if (groups.has(ch)) for (const [id, b] of chatBuzz(list)) buzz.set(id, b);

  const subs = await db
    .select({ sub: schema.dealSubscriptions, profile: schema.profiles })
    .from(schema.dealSubscriptions)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.dealSubscriptions.userId))
    .where(and(eq(schema.dealSubscriptions.enabled, true), gt(schema.profiles.radarHotLevel, 0)));
  if (!subs.length) return 0;

  // Mínimo histórico de las publicaciones enlazadas que ya conocemos.
  const urls = [...new Set(posts.flatMap((p) => (p.storeLinks as { url: string }[]).map((l) => l.url)))];
  const histMin = new Map<string, number>();
  if (urls.length) {
    const rows = await db
      .select({
        url: schema.listings.url,
        min: sql<number | null>`min(least(coalesce(${schema.priceSnapshots.priceCard}, ${schema.priceSnapshots.priceNormal}), ${schema.priceSnapshots.priceNormal}))::int`,
      })
      .from(schema.listings)
      .innerJoin(schema.priceSnapshots, eq(schema.priceSnapshots.listingId, schema.listings.id))
      .where(inArray(schema.listings.url, urls))
      .groupBy(schema.listings.url);
    for (const r of rows) if (r.min) histMin.set(r.url, r.min);
  }

  let marked = 0;
  for (const { sub, profile } of subs) {
    const level = HOT_LEVELS[profile.radarHotLevel as 1 | 2 | 3];
    if (!level) continue;
    const recent = await db
      .select({ fingerprint: schema.dealPosts.fingerprint, channelId: schema.dealPosts.channelId, at: schema.dealMatches.createdAt })
      .from(schema.dealMatches)
      .innerJoin(schema.dealPosts, eq(schema.dealPosts.id, schema.dealMatches.postId))
      .where(
        and(
          eq(schema.dealMatches.userId, sub.userId),
          eq(schema.dealMatches.hot, true),
          gte(schema.dealMatches.createdAt, new Date(Date.now() - 86_400_000)),
        ),
      );
    const seen = new Set(recent.map((r) => r.fingerprint));
    const perChannel = new Map<string, number>();
    for (const m of recent) {
      if (m.at.getTime() >= Date.now() - HOT_WINDOW_MS) perChannel.set(m.channelId, (perChannel.get(m.channelId) ?? 0) + 1);
    }
    let used = recent.length;
    const already = new Set(
      (
        await db
          .select({ postId: schema.dealMatches.postId })
          .from(schema.dealMatches)
          .where(and(eq(schema.dealMatches.userId, sub.userId), inArray(schema.dealMatches.postId, posts.map((p) => p.id))))
      ).map((r) => r.postId),
    );

    const candidates = posts
      .filter((p) => p.channelId === sub.channelId && p.postedAt >= sub.createdAt && !already.has(p.id))
      .map((p) => {
        const links = (p.storeLinks as { url: string }[]).map((l) => l.url);
        const mins = links.map((u) => histMin.get(u)).filter((n): n is number => !!n);
        const r = hotScore(
          {
            text: p.text,
            prices: p.prices,
            discountPct: p.discountPct,
            flags: p.flags,
            reactions: p.reactions,
            replies: p.replies,
            historicalMin: mins.length ? Math.min(...mins) : null,
            buzz: buzz.get(p.id),
            hasLink: p.links.length > 0 || (p.storeLinks as unknown[]).length > 0,
          },
          profile.radarHotWords,
        );
        return { p, ...r };
      })
      .filter((c) => c.score >= level.minScore && !blockedByFilters(c.p.text, filtersOf(profile)).blocked)
      .sort((a, b) => b.score - a.score);

    for (const c of candidates) {
      if (used >= level.dailyCap) break;
      if (c.p.fingerprint && seen.has(c.p.fingerprint)) continue;
      // Máx. 2 por grupo en la ventana: un canal que publica en lote no copa los avisos.
      if ((perChannel.get(c.p.channelId) ?? 0) >= 2) continue;
      const rows = await db
        .insert(schema.dealMatches)
        .values({ userId: sub.userId, postId: c.p.id, reasons: [`🔥 Oferta destacada: ${c.reasons.join(" · ")}`], hot: true })
        .onConflictDoNothing()
        .returning({ postId: schema.dealMatches.postId });
      if (rows.length) {
        marked++;
        used++;
        if (c.p.fingerprint) seen.add(c.p.fingerprint);
        perChannel.set(c.p.channelId, (perChannel.get(c.p.channelId) ?? 0) + 1);
      }
    }
  }
  return marked;
}
