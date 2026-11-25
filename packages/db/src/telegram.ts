import { EXTENSION_STORES, adapters, parseListingUrl } from "@rastreador/core";
import { and, eq, gt, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { Database } from "./client";
import * as schema from "./schema";
import { disableGroupRadar, enableGroupRadar, ingestGroupMessage } from "./radar";
import { ensureTracked } from "./track";

/*
 * Bot de Telegram SIN webhook: se leen los mensajes con getUpdates (en cada pasada del worker
 * y al pulsar "Verificar" en Ajustes). Así funciona igual en tu PC, sin URL pública.
 *
 * Comandos:
 *   /start <código>  vincula el chat con tu cuenta (código de Ajustes, vence en 15 min)
 *   /stop            desvincula
 *   cualquier mensaje con links de tiendas (p. ej. reenviado desde un grupo de ofertas) → los sigue
 */

const API = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

async function tg<T>(token: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(API(token, method), {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? res.status}`);
  return json.result;
}

let cachedUsername: string | undefined;
export async function getBotUsername(token: string): Promise<string> {
  cachedUsername ??= (await tg<{ username: string }>(token, "getMe")).username;
  return cachedUsername;
}

/** Genera un código de vinculación (15 min) y devuelve el link t.me para abrir el bot. */
export async function createTelegramLink(db: Database, userId: string, token: string): Promise<{ url: string; code: string }> {
  const code = randomBytes(9).toString("base64url");
  await db
    .insert(schema.profiles)
    .values({ id: userId, telegramLinkCode: code, telegramLinkExpiresAt: new Date(Date.now() + 15 * 60_000) })
    .onConflictDoUpdate({
      target: schema.profiles.id,
      set: { telegramLinkCode: code, telegramLinkExpiresAt: new Date(Date.now() + 15 * 60_000) },
    });
  return { url: `https://t.me/${await getBotUsername(token)}?start=${code}`, code };
}

export async function unlinkTelegram(db: Database, userId: string) {
  await db.update(schema.profiles).set({ telegramChatId: null, telegramLinkCode: null }).where(eq(schema.profiles.id, userId));
}

export async function sendTelegram(token: string, chatId: number, text: string) {
  await tg(token, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
}

// ─── Links en mensajes (grupos de ofertas) ──────────────────────────────────

interface TgEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
}
interface TgMessage {
  message_id: number;
  date?: number;
  from?: { id: number };
  chat: { id: number; type: string; title?: string };
  text?: string;
  caption?: string;
  entities?: TgEntity[];
  caption_entities?: TgEntity[];
}

/** URLs de un mensaje: texto plano y links con texto ("Ver oferta" → url). */
export function urlsInMessage(msg: Pick<TgMessage, "text" | "caption" | "entities" | "caption_entities">): string[] {
  const text = msg.text ?? msg.caption ?? "";
  const entities = msg.entities ?? msg.caption_entities ?? [];
  const urls = new Set<string>();
  for (const e of entities) {
    if (e.type === "text_link" && e.url) urls.add(e.url);
    if (e.type === "url") urls.add(text.slice(e.offset, e.offset + e.length));
  }
  for (const m of text.matchAll(/https?:\/\/[^\s<>()]+/g)) urls.add(m[0].replace(/[.,;!?)]+$/, ""));
  return [...urls].map((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`)).slice(0, 5);
}

/** Sigue redirecciones de links acortados o de afiliados hasta llegar a la tienda (máx. 5 saltos). */
export async function resolveLink(url: string): Promise<string> {
  let current = url;
  for (let i = 0; i < 5; i++) {
    if (parseListingUrl(current).ok) return current;
    // Solo https a dominios públicos: nunca IPs, localhost ni redes internas.
    const u = new URL(current);
    if (u.protocol !== "https:" || /^(localhost|[\d.]+|\[.*\])$/i.test(u.hostname) || !u.hostname.includes(".")) return current;
    try {
      const res = await fetch(current, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8_000) });
      const loc = res.headers.get("location");
      if (!loc || res.status < 300 || res.status >= 400) return current;
      current = new URL(loc, current).toString();
    } catch {
      return current;
    }
  }
  return current;
}

const SUPPORTED = [...adapters.map((a) => a.name), ...EXTENSION_STORES.map((s) => s.name)].join(", ");

async function handleLinks(db: Database, userId: string, urls: string[], appUrl: string): Promise<string> {
  const lines: string[] = [];
  for (const raw of urls) {
    const url = await resolveLink(raw);
    const parsed = parseListingUrl(url);
    if (!parsed.ok) {
      if (parsed.reason === "not_product") lines.push(`• ${parsed.storeName}: ese link no es la ficha de un producto.`);
      continue;
    }
    const store = await db.query.stores.findFirst({ where: eq(schema.stores.id, parsed.storeId) });
    if (!store?.enabled) {
      lines.push(`• ${parsed.storeName} todavía no está activa.`);
      continue;
    }
    const { productId } = await ensureTracked(db, userId, parsed);
    const how = parsed.mode === "server" ? "el precio llega en la próxima revisión" : "abre la ficha con la extensión para traer el precio";
    lines.push(`✅ Siguiendo en ${parsed.storeName} (${how}).\n${appUrl.replace(/\/+$/, "")}/producto/${productId}`);
  }
  return lines.length
    ? lines.join("\n\n")
    : `No encontré links de tiendas que siga. Por ahora: ${SUPPORTED}.`;
}

/**
 * Grupos y canales donde está el bot (radar de ofertas):
 *   /radar      activa el radar en este grupo para quien lo escribe (debe tener su cuenta vinculada)
 *   /radar_off  lo desactiva
 *   otros mensajes → se guardan y se cruzan con lo que siguen los suscriptores
 * Para que el bot vea TODOS los mensajes de un grupo: @BotFather → /setprivacy → Disable, y volver a agregarlo.
 */
async function handleGroupMessage(db: Database, token: string, msg: TgMessage) {
  const text = (msg.text ?? msg.caption ?? "").trim();
  const cmd = text.match(/^\/(radar_off|radar)(?:@\w+)?\b/i)?.[1]?.toLowerCase();
  if (cmd) {
    const owner = msg.from
      ? await db.query.profiles.findFirst({ where: eq(schema.profiles.telegramChatId, msg.from.id), columns: { id: true } })
      : undefined;
    if (!owner) {
      await sendTelegram(token, msg.chat.id, "Para usar el radar aquí, primero vincula tu cuenta: escríbeme por privado o ve a Ajustes → Telegram.");
      return;
    }
    if (cmd === "radar") {
      await enableGroupRadar(db, owner.id, msg.chat.id, msg.chat.title ?? "Grupo");
      await sendTelegram(token, msg.chat.id, "📡 Radar activado: te avisaré por privado cuando aquí aparezcan ofertas de lo que sigues o de tus palabras clave.");
    } else {
      await disableGroupRadar(db, owner.id, msg.chat.id);
      await sendTelegram(token, msg.chat.id, "Radar desactivado en este grupo.");
    }
    return;
  }
  if (!text && !msg.entities?.length && !msg.caption_entities?.length) return;
  await ingestGroupMessage(db, msg.chat.id, {
    id: msg.message_id,
    postedAt: msg.date ? new Date(msg.date * 1000) : new Date(),
    text: text.slice(0, 4000),
    links: urlsInMessage(msg),
  });
}

/**
 * Lee mensajes nuevos del bot y los procesa. Seguro de llamar desde varios lugares:
 * el offset se guarda en bot_state y Telegram no repite updates confirmados.
 */
export async function processTelegramUpdates(
  db: Database,
  cfg: { token: string; appUrl: string },
): Promise<{ processed: number; linked: number; tracked: number }> {
  const [state] = await db.select().from(schema.botState).where(eq(schema.botState.id, "telegram"));
  const updates = await tg<{ update_id: number; message?: TgMessage; channel_post?: TgMessage }[]>(cfg.token, "getUpdates", {
    offset: (state?.lastUpdateId ?? 0) + 1,
    timeout: 0,
    allowed_updates: ["message", "channel_post"],
  });

  let linked = 0;
  let tracked = 0;
  for (const u of updates) {
    const msg = u.message ?? u.channel_post;
    if (!msg) continue;
    if (msg.chat.type !== "private") {
      try {
        await handleGroupMessage(db, cfg.token, msg);
      } catch (err) {
        console.warn("Telegram: error en mensaje de grupo:", (err as Error).message);
      }
      continue;
    }
    const chatId = msg.chat.id;
    const text = (msg.text ?? "").trim();

    try {
      const start = text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{6,40})$/);
      if (start) {
        const [profile] = await db
          .update(schema.profiles)
          .set({ telegramChatId: chatId, telegramLinkCode: null, telegramLinkExpiresAt: null })
          .where(and(eq(schema.profiles.telegramLinkCode, start[1]!), gt(schema.profiles.telegramLinkExpiresAt, new Date())))
          .returning({ id: schema.profiles.id });
        if (profile) {
          linked++;
          await sendTelegram(cfg.token, chatId, "✅ Listo: te avisaré aquí cuando bajen los precios que sigues.\n\nTambién puedes reenviarme ofertas con links de tiendas y las sigo por ti.");
        } else {
          await sendTelegram(cfg.token, chatId, "Ese código venció o no es válido. Genera uno nuevo en Ajustes → Telegram.");
        }
        continue;
      }
      if (/^\/start/.test(text)) {
        await sendTelegram(cfg.token, chatId, "Hola 👋 Para vincularme, entra a la app → Ajustes → Telegram → Vincular.");
        continue;
      }

      const owner = await db.query.profiles.findFirst({ where: eq(schema.profiles.telegramChatId, chatId), columns: { id: true } });
      if (/^\/stop/.test(text)) {
        if (owner) await unlinkTelegram(db, owner.id);
        await sendTelegram(cfg.token, chatId, "Listo, ya no te enviaré avisos. Puedes volver a vincularme desde Ajustes.");
        continue;
      }
      const urls = urlsInMessage(msg);
      if (!owner) {
        await sendTelegram(cfg.token, chatId, "Primero vincula tu cuenta: app → Ajustes → Telegram → Vincular.");
        continue;
      }
      if (urls.length) {
        const reply = await handleLinks(db, owner.id, urls, cfg.appUrl);
        tracked += (reply.match(/✅/g) ?? []).length;
        await sendTelegram(cfg.token, chatId, reply);
      } else {
        await sendTelegram(cfg.token, chatId, `Reenvíame una oferta o pega el link de un producto (${SUPPORTED}) y lo sigo.`);
      }
    } catch (err) {
      console.warn("Telegram: error procesando un mensaje:", (err as Error).message);
    }
  }

  if (updates.length) {
    const last = updates[updates.length - 1]!.update_id;
    await db
      .insert(schema.botState)
      .values({ id: "telegram", lastUpdateId: last })
      .onConflictDoUpdate({ target: schema.botState.id, set: { lastUpdateId: last, updatedAt: sql`now()` } });
  }
  return { processed: updates.length, linked, tracked };
}
