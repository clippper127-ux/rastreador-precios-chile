import { schema, type Database } from "@rastreador/db";
import { sendTelegram } from "@rastreador/db/telegram";
import { and, eq, isNotNull, like } from "drizzle-orm";
import { Api, type TelegramClient } from "telegram";

/*
 * Avisos sobre la cuenta dedicada (por el bot, a quienes tienen Telegram vinculado):
 * - un grupo pide verificación (mensaje que la menciona o le responde, con botones o palabras de verificación);
 * - un bot le escribe por privado (muchos bots de verificación lo hacen);
 * - ya no está en un grupo que se leía (la sacaron o la bloquearon).
 * Nunca se responde ni se toca un botón: la verificación la haces tú desde la app con esa cuenta.
 * Cada aviso se manda una sola vez (marca en bot_state).
 */

const VERIFY_RE = /verific|captcha|no soy (un )?robot|not a robot|humano|human|bot[oó]n|button|pulsa|presiona|toca|click|confirm|resuelve|solve|antispam|anti-spam/i;

/** ¿Este mensaje le pide verificar a la cuenta dedicada? */
export function asksVerification(m: Api.Message): boolean {
  if (!m.mentioned) return false;
  const hasButtons = m.replyMarkup instanceof Api.ReplyInlineMarkup;
  return hasButtons || VERIFY_RE.test(m.message ?? "");
}

/** Manda un aviso una sola vez por `key` (marca en bot_state). */
async function alertOnce(db: Database, token: string | undefined, key: string, text: string): Promise<boolean> {
  const rows = await db
    .insert(schema.botState)
    .values({ id: key, lastUpdateId: 0 })
    .onConflictDoNothing()
    .returning({ id: schema.botState.id });
  if (!rows.length || !token) return false;
  const owners = await db.select({ chat: schema.profiles.telegramChatId }).from(schema.profiles).where(isNotNull(schema.profiles.telegramChatId));
  for (const o of owners) await sendTelegram(token, o.chat!, text).catch(() => {});
  return true;
}

const link = (info: { handle?: string }, msgId?: number) => (info.handle ? `https://t.me/${info.handle}${msgId ? `/${msgId}` : ""}` : "");

/** Mensaje de un grupo que pide verificación → aviso. */
export async function alertVerification(
  db: Database,
  token: string | undefined,
  info: { chatId: number; title: string; handle?: string },
  m: Api.Message,
): Promise<void> {
  if (!asksVerification(m)) return;
  await alertOnce(
    db,
    token,
    `verif:${info.chatId}:${m.id}`,
    [
      `⚠️ "${info.title}" le pide verificación a la cuenta dedicada.`,
      "Abre Telegram con esa cuenta, entra al grupo y responde (botón, captcha o pregunta). Si no, suelen sacarla en pocos minutos.",
      `Lo que dice: «${(m.message ?? "").slice(0, 200)}»`,
      link(info, m.id) || `Búscalo en Telegram como "${info.title}".`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
}

/**
 * Revisa privados de bots y grupos que desaparecieron. Llamar con la lista actual de diálogos.
 * `current`: ids de los grupos/canales en los que la cuenta está ahora.
 */
export async function checkReaderHealth(db: Database, client: TelegramClient, token: string | undefined, current: Set<number>): Promise<void> {
  // 1) Bots que le escribieron por privado y no se han leído.
  const dialogs = await client.getDialogs({ limit: 100 });
  // Nuestro propio bot (la cuenta dedicada también recibe sus avisos) y BotFather no cuentan: si no, cada
  // aviso del bot generaría otro aviso.
  const ownBotId = token?.split(":")[0];
  for (const d of dialogs) {
    const e = d.entity;
    if (!(e instanceof Api.User) || !e.bot || !d.unreadCount || !d.message) continue;
    if (e.id.toString() === ownBotId || e.username?.toLowerCase() === "botfather") continue;
    await alertOnce(
      db,
      token,
      `botdm:${e.id.toString()}:${d.message.id}`,
      [
        `⚠️ El bot ${e.username ? `@${e.username}` : (e.firstName ?? "")} le escribió por privado a la cuenta dedicada (posible verificación de un grupo).`,
        "Ábrelo con esa cuenta y responde tú. Lo que dice:",
        `«${(d.message.message ?? "").slice(0, 300)}»`,
        e.username ? `Abrir el bot: https://t.me/${e.username}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  // 2) Grupos que se leían y ya no están en la cuenta (la sacaron o la bloquearon).
  const known = await db
    .select({ id: schema.dealChannels.id, chatId: schema.dealChannels.chatId, title: schema.dealChannels.title, handle: schema.dealChannels.handle })
    .from(schema.dealChannels)
    .where(and(like(schema.dealChannels.id, "u:%"), isNotNull(schema.dealChannels.chatId)));
  for (const k of known) {
    const key = `gone:${k.chatId}`;
    if (current.has(k.chatId!)) {
      // Volvió a estar: se borra la marca para avisar de nuevo si vuelve a salir.
      await db.delete(schema.botState).where(eq(schema.botState.id, key));
      continue;
    }
    await alertOnce(
      db,
      token,
      key,
      [
        `⚠️ La cuenta dedicada ya no está en "${k.title ?? k.handle ?? "un grupo"}": la sacaron o la bloquearon, y ya no se lee.`,
        "Si te dice \"grupo no disponible\", el grupo la bloqueó: solo un admin puede desbloquearla. Si no, vuelve a unirla y responde la verificación si la piden.",
        k.handle ? `https://t.me/${k.handle}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }
}
