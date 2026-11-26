import type { RawPost } from "@rastreador/core";
import type { Database } from "@rastreador/db";
import { ingestReaderChat, readerChatState, updateEngagement } from "@rastreador/db/radar";
import { Api, TelegramClient } from "telegram";
import { LogLevel } from "telegram/extensions/Logger.js";
import { StringSession } from "telegram/sessions/index.js";
import { alertVerification, checkReaderHealth } from "./reader-health";

/*
 * Lector de grupos con una cuenta de Telegram DEDICADA (no la personal), vía la API oficial (MTProto).
 * Sirve para grupos que no aceptan bots: lee los grupos y canales donde esa cuenta es miembro.
 * Solo lee: no escribe, no reacciona y no marca mensajes como leídos.
 * Configuración: TG_API_ID y TG_API_HASH (my.telegram.org) + TG_SESSION (pnpm telegram:login).
 */

export interface ReaderConfig {
  apiId: number;
  apiHash: string;
  session: string;
}

export function readerConfig(): ReaderConfig | undefined {
  const apiId = Number(process.env.TG_API_ID);
  const apiHash = process.env.TG_API_HASH?.trim();
  const session = process.env.TG_SESSION?.trim();
  return apiId && apiHash && session ? { apiId, apiHash, session } : undefined;
}

export function readerClient(cfg: { apiId: number; apiHash: string; session?: string }) {
  const client = new TelegramClient(new StringSession(cfg.session ?? ""), cfg.apiId, cfg.apiHash, {
    connectionRetries: 3,
    // Si Telegram pide esperar (flood wait) hasta 60 s, se espera; si es más, se corta la pasada.
    floodSleepThreshold: 60,
  });
  client.setLogLevel(LogLevel.ERROR);
  return client;
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

/** Mensaje de Telegram → mensaje del radar (texto + links del texto, de los enlaces con texto y de los botones). */
export function toRawPost(m: Api.Message): RawPost | undefined {
  const text = m.message ?? "";
  const links = new Set<string>(text.match(URL_RE) ?? []);
  for (const e of m.entities ?? []) {
    if (e instanceof Api.MessageEntityTextUrl) links.add(e.url);
  }
  if (m.replyMarkup instanceof Api.ReplyInlineMarkup) {
    for (const row of m.replyMarkup.rows) {
      for (const b of row.buttons) if (b instanceof Api.KeyboardButtonUrl) links.add(b.url);
    }
  }
  if (!text.trim() && !links.size) return undefined;
  const reactions = (m.reactions?.results ?? []).reduce((n, r) => n + (r.count ?? 0), 0);
  const replyTo = m.replyTo instanceof Api.MessageReplyHeader ? m.replyTo.replyToMsgId : undefined;
  return { id: m.id, postedAt: new Date(m.date * 1000), text, links: [...links], reactions, replies: m.replies?.replies ?? 0, replyTo };
}

/** Lee mensajes nuevos de todos los grupos y canales de la cuenta dedicada. */
export async function pollReaderAccount(db: Database, cfg: ReaderConfig): Promise<{ chats: number; newPosts: number; errors: number }> {
  const client = readerClient(cfg);
  await client.connect();
  try {
    if (!(await client.checkAuthorization())) throw new Error("La sesión de Telegram ya no es válida: vuelve a correr pnpm telegram:login");
    return await readChats(db, client);
  } finally {
    await client.disconnect();
    await client.destroy().catch(() => {});
  }
}

export interface ChatInfo {
  chatId: number;
  title: string;
  handle?: string;
  broadcast: boolean;
}

/** Grupos y canales de la cuenta (id con el formato de Telegram, igual que message.chatId). */
export async function listChats(client: TelegramClient): Promise<{ info: ChatInfo; entity: Api.TypeEntityLike }[]> {
  const dialogs = await client.getDialogs({ limit: 200 });
  return dialogs
    .filter((d) => (d.isGroup || d.isChannel) && d.entity)
    .map((d) => ({
      entity: d.entity!,
      info: {
        chatId: Number(d.id),
        title: d.title ?? d.name ?? "Grupo",
        handle: "username" in d.entity! && d.entity!.username ? d.entity!.username : undefined,
        broadcast: !d.isGroup,
      },
    }));
}

/** Mensaje de Telegram → mensaje del radar, contando respuestas entre los mensajes leídos. */
export function toRawPosts(msgs: Api.Message[]): RawPost[] {
  // En grupos, las respuestas se cuentan como mensajes que responden a otro (en canales viene en m.replies).
  const replyCount = new Map<number, number>();
  for (const m of msgs) {
    const to = m.replyTo instanceof Api.MessageReplyHeader ? m.replyTo.replyToMsgId : undefined;
    if (to) replyCount.set(to, (replyCount.get(to) ?? 0) + 1);
  }
  return msgs
    .map((m): RawPost | undefined => {
      const p = toRawPost(m);
      return p && { ...p, replies: Math.max(p.replies ?? 0, replyCount.get(m.id) ?? 0) };
    })
    .filter((p): p is RawPost => !!p);
}

/** Relee los últimos mensajes de cada grupo: guarda los nuevos y actualiza reacciones/respuestas de los recientes. */
export async function readChats(db: Database, client: TelegramClient): Promise<{ chats: number; newPosts: number; errors: number }> {
  let chats = 0;
  let newPosts = 0;
  let errors = 0;
  const token = process.env.TELEGRAM_BOT_TOKEN || undefined;
  const list = await listChats(client);
  // Avisos de verificación pendiente, privados de bots y grupos de los que sacaron a la cuenta.
  await checkReaderHealth(db, client, token, new Set(list.map((c) => c.info.chatId))).catch((err: Error) =>
    console.error("Revisión de la cuenta:", err.message.slice(0, 200)),
  );
  for (const { info, entity } of list) {
    chats++;
    try {
      const state = await readerChatState(db, info.chatId);
      // Se leen los últimos 150 (primera vez: 20, como punto de partida que no se avisa).
      const msgs = (await client.getMessages(entity, { limit: state ? 150 : 20 })).filter((m): m is Api.Message => m instanceof Api.Message);
      for (const m of msgs) if (m.mentioned) await alertVerification(db, token, info, m);
      const posts = toRawPosts(msgs);
      newPosts += await ingestReaderChat(db, info, posts);
      if (state) await updateEngagement(db, `u:${info.chatId}`, posts.filter((p) => p.id <= state.lastPostId));
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      errors++;
      console.error(`Grupo ${chats}:`, (err as Error).message.slice(0, 200));
    }
  }
  return { chats, newPosts, errors };
}
