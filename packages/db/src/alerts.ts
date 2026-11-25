import {
  bestPriceNoCard,
  bestPriceWithCard,
  evaluateAlerts,
  formatAlertText,
  type PriceState,
} from "@rastreador/core";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "./client";
import * as schema from "./schema";

/*
 * Alertas: encolar (al guardar un precio nuevo) y entregar (Telegram, correo o solo en la app).
 * Lo comparten el worker, la API de la extensión y el ingreso manual.
 */

type Channel = "telegram" | "email" | "app";

/**
 * Evalúa las reglas de cada usuario que sigue el listing y deja alertas "pending".
 * Llamar justo después de insertar un snapshot (solo hay snapshot cuando el precio o stock cambió).
 */
export async function queueAlertsForSnapshot(
  db: Database,
  args: { listingId: string; snapshotId: number; prev: PriceState | null; next: PriceState; sellerType?: string | null },
): Promise<number> {
  const followers = await db
    .select({ watch: schema.watches, link: schema.watchListings, profile: schema.profiles })
    .from(schema.watchListings)
    .innerJoin(schema.watches, eq(schema.watches.id, schema.watchListings.watchId))
    .leftJoin(schema.profiles, eq(schema.profiles.id, schema.watches.userId))
    .where(
      and(
        eq(schema.watchListings.listingId, args.listingId),
        eq(schema.watchListings.enabled, true),
        eq(schema.watches.active, true),
      ),
    );
  if (!followers.length) return 0;

  // Mínimo histórico ANTES de este snapshot, con stock, en ambas bases de precio.
  const [hist] = await db.execute<{ n: number; min_no_card: number | null; min_with_card: number | null }>(sql`
    select count(*)::int as n,
      min(least(price_offer, price_normal)) filter (where stock_status in ('in_stock','preorder')) as min_no_card,
      min(least(price_card, price_offer, price_normal)) filter (where stock_status in ('in_stock','preorder')) as min_with_card
    from price_snapshots where listing_id = ${args.listingId} and id <> ${args.snapshotId}
  `);

  let queued = 0;
  for (const { watch, link, profile } of followers) {
    const result = evaluateAlerts({
      rules: {
        targetPrice: watch.targetPrice,
        dropPct: watch.dropPct != null ? Number(watch.dropPct) : null,
        notifyAllTimeLow: watch.notifyAllTimeLow,
        notifyRestock: watch.notifyRestock,
        priceBasis: watch.priceBasis,
        excludeThirdParty: watch.excludeThirdParty,
        targetArmed: link.targetArmed,
      },
      prev: args.prev,
      next: args.next,
      previousMin: (watch.priceBasis === "with_card" ? hist?.min_with_card : hist?.min_no_card) ?? null,
      previousSnapshots: hist?.n ?? 0,
      sellerType: args.sellerType,
    });

    if (result.targetArmed !== link.targetArmed) {
      await db
        .update(schema.watchListings)
        .set({ targetArmed: result.targetArmed })
        .where(and(eq(schema.watchListings.watchId, watch.id), eq(schema.watchListings.listingId, args.listingId)));
    }
    if (!result.events.length) continue;

    const wanted = new Set(watch.channels);
    const channels: Channel[] = [];
    if (wanted.has("telegram") && profile?.telegramChatId) channels.push("telegram");
    if (wanted.has("email") && profile?.emailAlerts) channels.push("email");
    if (!channels.length) channels.push("app"); // al menos queda en la página de Alertas

    for (const ev of result.events) {
      for (const channel of channels) {
        const inserted = await db
          .insert(schema.alerts)
          .values({
            userId: watch.userId,
            watchId: watch.id,
            listingId: args.listingId,
            snapshotId: args.snapshotId,
            kind: ev.kind,
            dedupeKey: `${ev.kind}:${watch.id}:${args.listingId}:${args.snapshotId}`,
            channel,
            payload: { reason: ev.reason, price: ev.price, attempts: 0 },
          })
          .onConflictDoNothing()
          .returning({ id: schema.alerts.id });
        queued += inserted.length;
      }
    }
  }
  return queued;
}

// ─── Entrega ────────────────────────────────────────────────────────────────

export interface Transport {
  telegram(chatId: number, text: string): Promise<void>;
  email(to: string, subject: string, text: string): Promise<void>;
}

export interface DeliveryConfig {
  appUrl: string;
  telegramToken?: string;
  resendApiKey?: string;
  /** Sin dominio propio, Resend solo permite enviar desde onboarding@resend.dev a tu propio correo. */
  resendFrom?: string;
}

export function httpTransport(cfg: DeliveryConfig): Transport {
  return {
    async telegram(chatId, text) {
      if (!cfg.telegramToken) throw new Error("Falta TELEGRAM_BOT_TOKEN");
      const res = await fetch(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Telegram ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
    async email(to, subject, text) {
      if (!cfg.resendApiKey) throw new Error("Falta RESEND_API_KEY");
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: cfg.resendFrom ?? "Rastreador <onboarding@resend.dev>", to: [to], subject, text }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}

const MAX_ATTEMPTS = 3;

/**
 * Envía las alertas pendientes. Agrupa las del mismo usuario + listing + snapshot + canal en UN mensaje
 * (p. ej. "bajó del objetivo" y "mínimo histórico" juntos). Reintenta hasta 3 veces en pasadas siguientes.
 */
export async function deliverPendingAlerts(
  db: Database,
  cfg: DeliveryConfig,
  transport: Transport = httpTransport(cfg),
): Promise<{ sent: number; failed: number }> {
  const rows = await db.execute<{
    id: string;
    user_id: string;
    listing_id: string;
    snapshot_id: number | null;
    channel: Channel;
    payload: { reason: string; price: number; attempts?: number };
    product_id: string;
    product_name: string;
    store_name: string;
    url: string;
    price_normal: number | null;
    price_offer: number | null;
    price_card: number | null;
    card_name: string | null;
    chat_id: number | null;
    email: string | null;
  }>(sql`
    select a.id, a.user_id, a.listing_id, a.snapshot_id, a.channel, a.payload,
           p.id as product_id, p.canonical_name as product_name, s.name as store_name, l.url,
           l.price_normal, l.price_offer, l.price_card, l.card_name,
           pr.telegram_chat_id as chat_id, u.email
    from alerts a
    join listings l on l.id = a.listing_id
    join products p on p.id = l.product_id
    join stores s on s.id = l.store_id
    left join profiles pr on pr.id = a.user_id
    left join auth.users u on u.id = a.user_id
    where a.status = 'pending'
    order by a.created_at
    limit 200
  `);

  type Row = (typeof rows)[number];
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.user_id}|${r.listing_id}|${r.snapshot_id}|${r.channel}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  let sent = 0;
  let failed = 0;
  for (const group of groups.values()) {
    const g = group[0]!;
    const ids = group.map((r) => r.id);
    const prices = { priceNormal: g.price_normal ?? undefined, priceOffer: g.price_offer ?? undefined, priceCard: g.price_card ?? undefined };
    const noCard = bestPriceNoCard(prices);
    const withCard = bestPriceWithCard(prices);
    const msg = formatAlertText({
      productName: g.product_name.replace(/^Pendiente:\s*/, ""),
      storeName: g.store_name,
      reasons: group.map((r) => r.payload.reason),
      priceNoCard: noCard,
      priceCard: withCard != null && noCard != null && withCard < noCard ? withCard : undefined,
      cardName: g.card_name,
      productUrl: `${cfg.appUrl.replace(/\/+$/, "")}/producto/${g.product_id}`,
      storeUrl: g.url,
    });

    try {
      if (g.channel === "telegram") {
        if (!g.chat_id) throw new Error("Telegram no vinculado");
        await transport.telegram(g.chat_id, msg.text);
      } else if (g.channel === "email") {
        if (!g.email) throw new Error("Usuario sin correo");
        await transport.email(g.email, msg.subject, msg.text);
      }
      await db.execute(sql`update alerts set status = 'sent', sent_at = now() where id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
      sent += ids.length;
    } catch (err) {
      const attempts = (g.payload.attempts ?? 0) + 1;
      const status = attempts >= MAX_ATTEMPTS ? "failed" : "pending";
      await db.execute(sql`
        update alerts set status = ${status},
          payload = payload || ${JSON.stringify({ attempts, error: (err as Error).message.slice(0, 300) })}::jsonb
        where id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
      if (status === "failed") failed += ids.length;
    }
  }
  return { sent, failed };
}

