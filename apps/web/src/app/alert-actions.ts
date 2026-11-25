"use server";

import { schema } from "@rastreador/db";
import { createTelegramLink, processTelegramUpdates, sendTelegram, unlinkTelegram } from "@rastreador/db/telegram";
import { httpTransport } from "@rastreador/db/alerts";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { deliveryConfig } from "@/lib/notify";
import { getUser } from "@/lib/supabase/server";

async function userOrLogin() {
  const user = await getUser();
  if (!user) redirect("/login?next=/configuracion");
  return user;
}

export type ActionMsg = { ok: string } | { error: string } | { link: string } | undefined;

const NO_BOT = "Falta configurar el bot: agrega TELEGRAM_BOT_TOKEN en .env (ver README → Alertas).";

export async function linkTelegram(): Promise<ActionMsg> {
  const user = await userOrLogin();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { error: NO_BOT };
  try {
    const { url } = await createTelegramLink(db(), user.id, token);
    return { link: url };
  } catch (err) {
    return { error: `Telegram no respondió: ${(err as Error).message}` };
  }
}

/** Lee los mensajes del bot ahora mismo (para no esperar la próxima pasada del worker). */
export async function checkTelegram(): Promise<ActionMsg> {
  const user = await userOrLogin();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { error: NO_BOT };
  try {
    await processTelegramUpdates(db(), { token, appUrl: deliveryConfig().appUrl });
  } catch (err) {
    return { error: `Telegram no respondió: ${(err as Error).message}` };
  }
  const p = await db().query.profiles.findFirst({ where: eq(schema.profiles.id, user.id) });
  revalidatePath("/configuracion");
  return p?.telegramChatId ? { ok: "✓ Telegram vinculado" } : { error: "Aún no recibimos tu /start. Abre el link y toca Iniciar." };
}

export async function disconnectTelegram(): Promise<void> {
  const user = await userOrLogin();
  await unlinkTelegram(db(), user.id);
  revalidatePath("/configuracion");
}

export async function testTelegram(): Promise<ActionMsg> {
  const user = await userOrLogin();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const p = await db().query.profiles.findFirst({ where: eq(schema.profiles.id, user.id) });
  if (!token || !p?.telegramChatId) return { error: "Telegram no está vinculado." };
  try {
    await sendTelegram(token, p.telegramChatId, "🔔 Prueba: así te llegarán los avisos de precio.");
    return { ok: "Mensaje enviado" };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function setEmailAlerts(enabled: boolean): Promise<void> {
  const user = await userOrLogin();
  await db()
    .insert(schema.profiles)
    .values({ id: user.id, emailAlerts: enabled })
    .onConflictDoUpdate({ target: schema.profiles.id, set: { emailAlerts: enabled } });
  revalidatePath("/configuracion");
}

export async function testEmail(): Promise<ActionMsg> {
  const user = await userOrLogin();
  const cfg = deliveryConfig();
  if (!cfg.resendApiKey) return { error: "Falta RESEND_API_KEY en .env (ver README → Alertas)." };
  if (!user.email) return { error: "Tu cuenta no tiene correo." };
  try {
    await httpTransport(cfg).email(user.email, "Prueba de avisos · Rastreador", "Así te llegarán los avisos de precio.");
    return { ok: `Correo enviado a ${user.email}` };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

function clp(v: FormDataEntryValue | null): number | null {
  const raw = String(v ?? "").replace(/[^\d]/g, "");
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Reglas de alerta de un producto que sigo. */
export async function saveAlertSettings(productId: string, _prev: ActionMsg, form: FormData): Promise<ActionMsg> {
  const user = await getUser();
  if (!user) redirect("/login");
  const dropRaw = Number.parseFloat(String(form.get("dropPct") ?? "").replace(",", "."));
  const channels = ["telegram", "email"].filter((c) => form.get(`ch_${c}`) === "on");
  // Casillas: sin tarjeta y/o con tarjeta. Las dos (o ninguna) = "ambos precios".
  const noCard = form.get("basis_no_card") === "on";
  const withCard = form.get("basis_with_card") === "on";
  const basis = noCard && !withCard ? "no_card" : withCard && !noCard ? "with_card" : "both";
  const target = clp(form.get("target"));

  const d = db();
  const [watch] = await d
    .update(schema.watches)
    .set({
      targetPrice: target,
      dropPct: Number.isFinite(dropRaw) && dropRaw > 0 && dropRaw < 100 ? String(Math.round(dropRaw * 10) / 10) : null,
      notifyAllTimeLow: form.get("notifyAllTimeLow") === "on",
      notifyRestock: form.get("notifyRestock") === "on",
      excludeThirdParty: form.get("excludeThirdParty") === "on",
      priceBasis: basis,
      channels: channels.length ? channels : ["telegram"],
    })
    .where(and(eq(schema.watches.userId, user.id), eq(schema.watches.productId, productId)))
    .returning();
  if (!watch) return { error: "No sigues este producto." };
  // Un objetivo nuevo vuelve a quedar "armado" para avisar la próxima vez que baje.
  await d.update(schema.watchListings).set({ targetArmed: true }).where(eq(schema.watchListings.watchId, watch.id));
  revalidatePath(`/producto/${productId}`);
  return { ok: "Alertas guardadas" };
}
